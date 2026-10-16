// Runs in the editor page's own JS world (manifest "world": "MAIN") so it can see the
// editor's own fetch/XHR calls, which the content script cannot. It only reports
// method, URL (secrets stripped), status and the JSON response *shape* (keys and
// types, no values) to content.js, which uses them for diagnostics.
(function () {
  if (window.__waiRecorder || !new URLSearchParams(location.search).get('id')) return; // ATE job pages only
  window.__waiRecorder = true;

  const SECRET_PARAMS = /^(signature|shared_key|private_key|token|uuid|key)$/i;
  const MAX_JSON_CHARS = 2000000;

  const sanitizeUrl = (u) => {
    try {
      const url = new URL(u, location.href);
      for (const k of [...url.searchParams.keys()]) if (SECRET_PARAMS.test(k)) url.searchParams.set(k, '…');
      return url.toString();
    } catch {
      return String(u).slice(0, 300);
    }
  };

  const shapeOf = (v, depth = 0) => {
    if (Array.isArray(v)) return v.length ? [shapeOf(v[0], depth + 1), `×${v.length}`] : [];
    if (v && typeof v === 'object') {
      if (depth > 4) return '{…}';
      const out = {};
      Object.keys(v).slice(0, 40).forEach((k) => { out[k] = shapeOf(v[k], depth + 1); });
      return out;
    }
    return v === null ? 'null' : typeof v;
  };

  const post = (entry) => window.postMessage({ source: 'wai-recorder', entry }, location.origin);

  const isJson = (contentType) => /json/i.test(contentType || '');

  // fetch
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
    const url = sanitizeUrl(typeof input === 'string' ? input : input?.url || String(input));
    let res;
    try {
      res = await origFetch.apply(this, arguments);
    } catch (e) {
      post({ method, url, status: 0, error: String(e?.message || e) });
      throw e;
    }
    // Recording must never break the editor's own request
    try {
      const entry = { method, url, status: res.status };
      if (isJson(res.headers.get('content-type'))) {
        res.clone().text()
          .then((t) => post(t.length < MAX_JSON_CHARS ? { ...entry, shape: shapeOf(JSON.parse(t)) } : entry))
          .catch(() => post(entry));
      } else {
        post(entry);
      }
    } catch {}
    return res;
  };

  // XMLHttpRequest (the editor uses axios, which is XHR based)
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__wai = { method: String(method || 'GET').toUpperCase(), url: sanitizeUrl(url) };
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__wai) {
      this.addEventListener('loadend', () => {
        const entry = { ...this.__wai, status: this.status };
        try {
          if (isJson(this.getResponseHeader('content-type'))) {
            let data = null;
            if (this.responseType === 'json') data = this.response;
            else if ((this.responseType === '' || this.responseType === 'text') && this.responseText.length < MAX_JSON_CHARS) {
              data = JSON.parse(this.responseText);
            }
            if (data !== null) entry.shape = shapeOf(data);
          }
        } catch {}
        post(entry);
      });
    }
    return origSend.apply(this, arguments);
  };
})();
