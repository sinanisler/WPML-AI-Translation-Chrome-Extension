(function () {
  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  let apiKey = "";
  let selectedModel = "openai/gpt-5.6-luna";
  let systemPrompt = "";

  // Default system prompt (only used if nothing custom is saved)
  const DEFAULT_SYSTEM_PROMPT = `You are a professional website translator. Translate the given text fully and naturally into the target language, the way a native-speaking copywriter would write it for this website.

Rules:
1. Translate EVERY word of normal language, including short labels, single words, headings and list items (e.g. "Vorteile:" -> "Benefits:", "Anwendungen" -> "Applications"). Short text is NOT a reason to leave it untranslated.
2. Keep exactly as-is: brand names, company and product names, model numbers, personal names, URLs, email addresses, file names, code, CSS class names, IDs, variables and placeholders.
3. Tokens like ⟦1⟧, ⟦2⟧ are protected placeholders for markup or code. Copy every one of them unchanged, exactly once, in the position that fits the translated sentence. Never translate, remove, merge or add placeholders.
4. Keep punctuation style, capitalization style (e.g. lowercase stays lowercase), numbers and units consistent with the source.
5. Only if the text is already entirely in the target language, return it unchanged.
6. Never add explanations, notes, quotes or language labels.

Output: ONLY the translated text.`;

  // Batch tuning
  const BATCH_MAX_ITEMS = 30;
  const BATCH_MAX_CHARS = 6000;
  const BATCH_CONCURRENCY = 3;
  const REQUEST_TIMEOUT_MS = 120000;

  // The pre-2.0 default prompt told the model to skip short strings, which left words
  // untranslated. A stored, unedited copy of it is upgraded to the current default.
  const isLegacyDefaultPrompt = (p) =>
    /^You are a translation tool. Follow these rules strictly:/.test((p || "").trim()) &&
    (p || "").includes("Very short strings (1-2 words) that are ambiguous");

  const resolvePrompt = (stored) =>
    !stored || isLegacyDefaultPrompt(stored) ? DEFAULT_SYSTEM_PROMPT : stored;

  const loadSettings = async () => {
    try {
      const result = await chrome.storage.sync.get([
        'openrouterApiKey',
        'openrouterSelectedModel',
        'systemPrompt'
      ]);
      apiKey = result.openrouterApiKey || "";
      selectedModel = result.openrouterSelectedModel || selectedModel;
      systemPrompt = resolvePrompt(result.systemPrompt);
      console.log('[AI Translate] Settings loaded:', { hasApiKey: !!apiKey, model: selectedModel });
    } catch (error) {
      console.error('[AI Translate] Error loading settings:', error);
    }
  };

  loadSettings();

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.ateAdapter) applyAdapter(changes.ateAdapter.newValue);
    if (namespace !== 'sync') return;
    if (changes.openrouterApiKey) apiKey = changes.openrouterApiKey.newValue || "";
    if (changes.openrouterSelectedModel) selectedModel = changes.openrouterSelectedModel.newValue || selectedModel;
    if (changes.systemPrompt) systemPrompt = resolvePrompt(changes.systemPrompt.newValue);
  });

  // ---------------------------------------------------------------------------
  // Adapter: everything that depends on WPML's markup or API. Built-in defaults below;
  // an override written by "Fix with AI" (validated, tested and confirmed by the user)
  // is kept in chrome.storage.local, so a WPML change can be fixed without a release.
  // ---------------------------------------------------------------------------
  const DEFAULT_ADAPTER = {
    // "auto" = API_ENDPOINT from the editor's inline config, else the page origin
    apiHost: "auto",
    // Relative to {apiHost}/api
    routes: {
      job: "jobs/{job}",
      page: "jobs/{job}/pages/{page}",
      save: "jobs/{job}/segments/{seg}/save",
    },
    jobParams: { v: 3, atbd_ignore: false },
    // Dot paths into the API JSON
    fields: {
      jobSegments: "page_data.segments",
      firstPageNumber: "page_data.page_number",
      pages: "pages",
      pageNumber: "page_number",
      pageSegments: "segments",
      xliffId: "job.base_xliff.id",
      sourceLanguage: "job.source_language.name",
      targetLanguage: "job.target_language.name",
      segmentId: "id",
      segmentSource: "original_content",
      segmentTarget: "translated_content",
      segmentStatus: "status",
      segmentUnclear: "unclear",
      segmentContext: "context",
    },
    segmentIdAttr: "data-at-segment-id",
    openedClass: "ate-segment-opened",
    // Each entry is a list of fallbacks, best first
    selectors: {
      scroller: ['[data-virtuoso-scroller]'],
      segment: ['[data-at-segment-id]'],
      originalText: ['.AT-segment_list__original .eate-SegmentItem\\.styles__SegmentTextContainer'],
      translationText: ['.AT-segment_list__translation'],
      chip: ['.eate-Chip\\.styles__ChipContentStyled'],
      addButton: ['.AT-segment_list__add_translation_button'],
      editorIframe: ['iframe.tox-edit-area__iframe'],
      nextSegment: ['.AT-editor__next_segment'],
      header: ['[class*="eate-SegmentListHeader.styles__Container"]'],
      headerLabel: ['.eate-SegmentListHeader\\.styles__SegmentType'],
    },
  };

  const isPlainObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  // Deep merge of plain objects; arrays and values from the patch replace the base
  const mergeAdapter = (base, patch) => {
    const out = { ...base };
    for (const [k, v] of Object.entries(patch || {})) {
      out[k] = isPlainObj(v) && isPlainObj(base[k]) ? mergeAdapter(base[k], v) : v;
    }
    return out;
  };

  let adapter = DEFAULT_ADAPTER;
  let SEL = {}; // adapter.selectors joined into CSS selector lists
  const applyAdapter = (override) => {
    adapter = mergeAdapter(DEFAULT_ADAPTER, override || {});
    SEL = Object.fromEntries(Object.entries(adapter.selectors)
      .map(([k, list]) => [k, Array.isArray(list) ? list.join(', ') : String(list)]));
  };
  applyAdapter();
  chrome.storage.local.get('ateAdapter')
    .then((r) => {
      if (!r.ateAdapter) return;
      applyAdapter(r.ateAdapter);
      console.log('[AI Translate] Using adapter override:', r.ateAdapter);
    })
    .catch(() => {});

  const pick = (obj, path) => String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const F = (name) => adapter.fields[name];

  // ---------------------------------------------------------------------------
  // Diagnostics data: recent network calls (recorder.js sees the editor's own
  // requests; ateRequest logs the extension's) and the last error. Secrets are
  // stripped from URLs and responses are kept only as shapes (keys/types, no values).
  // ---------------------------------------------------------------------------
  const SECRET_PARAMS = /^(signature|shared_key|private_key|token|uuid|key)$/i;
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
    if (isPlainObj(v)) {
      if (depth > 4) return '{…}';
      const out = {};
      Object.keys(v).slice(0, 40).forEach((k) => { out[k] = shapeOf(v[k], depth + 1); });
      return out;
    }
    return v === null ? 'null' : typeof v;
  };

  const netLog = [];
  const logNet = (entry) => {
    netLog.push({ time: new Date().toISOString(), ...entry });
    if (netLog.length > 40) netLog.shift();
  };
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'wai-recorder' || !isPlainObj(e.data.entry)) return;
    logNet({ ...e.data.entry, from: 'editor' });
  });

  let lastError = null;
  const rememberError = (e) => {
    lastError = { message: e?.message || String(e), status: e?.status, url: e?.url, time: new Date().toISOString() };
  };

  // Errors that point at a WPML change (not a bad OpenRouter key etc.): "Fix with AI" can help
  const diagError = (message, url, status) => {
    const e = new Error(message);
    e.diagnosable = true;
    if (url) e.url = sanitizeUrl(url);
    if (status != null) e.status = status;
    return e;
  };

  const errorHint = (e) => e.fatal
    ? ' — check your API key / credits in the extension popup.'
    : e.diagnosable ? ' — use "Fix with AI" in the extension popup (Editor tools).' : '';

  // ---------------------------------------------------------------------------
  // ATE DOM helpers (new React/Virtuoso editor)
  // ---------------------------------------------------------------------------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const waitFor = async (fn, timeout = 5000, interval = 50) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (stopRequested) return null;
      const v = fn();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  };

  const getScroller = () => document.querySelector(SEL.scroller);
  const getSegmentEl = (id) => document.querySelector(`[${adapter.segmentIdAttr}="${id}"]`);
  const isOpened = (el) => typeof el?.className === 'string' && el.className.includes(adapter.openedClass);

  // Reads the "Original: German / Translation: English" labels in the segment list header
  const getLanguages = () => {
    const out = { source: "", target: "" };
    let labels = document.querySelector(SEL.header)?.querySelectorAll(SEL.headerLabel) || [];
    if (!labels.length) labels = document.querySelectorAll('div, span, p');
    labels.forEach((el) => {
      if (el.children.length) return;
      const t = el.textContent.trim();
      if (t !== 'Original' && t !== 'Translation') return;
      const lines = el.parentElement.innerText.split('\n').map((s) => s.trim()).filter(Boolean);
      const lang = lines[lines.indexOf(t) + 1];
      if (lang) out[t === 'Original' ? 'source' : 'target'] = lang;
    });
    return out;
  };

  const readSegmentInfo = (el) => {
    const src = el.querySelector(SEL.originalText);
    const source = src ? src.innerText.trim() : "";
    const saved = el.querySelector(SEL.translationText)?.innerText.trim() || "";
    const opened = isOpened(el);
    return {
      id: el.getAttribute(adapter.segmentIdAttr),
      source,
      context: el.querySelector(SEL.chip)?.textContent.trim() || "",
      // Needs translating when: "+" is shown (empty), an open editor has nothing saved yet,
      // or the saved "translation" is just an unchanged copy of the source.
      untranslated: !!el.querySelector(SEL.addButton) || (opened && !saved) || (!!saved && saved === source),
    };
  };

  // Walks the virtualized list top to bottom and collects every segment.
  const collectSegments = async () => {
    const scroller = getScroller();
    if (!scroller) throw diagError("Segment list not found on this page.");
    const seen = new Map();
    const originalTop = scroller.scrollTop;
    const step = Math.max(300, Math.floor(scroller.clientHeight * 0.8));

    const grab = () => {
      document.querySelectorAll(SEL.segment).forEach((el) => {
        const info = readSegmentInfo(el);
        if (!info.id || seen.has(info.id)) return;
        info.scrollTop = scroller.scrollTop;
        info.order = seen.size;
        seen.set(info.id, info);
      });
    };

    scroller.scrollTop = 0;
    await sleep(200);
    let lastTop = -1;
    while (!stopRequested) {
      grab();
      if (scroller.scrollTop === lastTop || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
        await sleep(200);
        grab();
        break;
      }
      lastTop = scroller.scrollTop;
      scroller.scrollTop += step;
      await sleep(180);
    }
    scroller.scrollTop = originalTop;
    return [...seen.values()];
  };

  // Scrolls until a segment is rendered, using the position recorded while collecting.
  const revealSegment = async (seg) => {
    let el = getSegmentEl(seg.id);
    if (el) {
      scrollListTo(el);
      return el;
    }
    const scroller = getScroller();
    if (!scroller) return null;
    scroller.scrollTop = seg.scrollTop;
    el = await waitFor(() => getSegmentEl(seg.id), 1500);
    if (!el) {
      // Fallback: sweep near the recorded position
      for (const delta of [-400, 400, -800, 800, -1600, 1600]) {
        scroller.scrollTop = Math.max(0, seg.scrollTop + delta);
        el = await waitFor(() => getSegmentEl(seg.id), 600);
        if (el) break;
      }
    }
    if (el) scrollListTo(el);
    return el;
  };

  // Centers a row inside the segment list only. scrollIntoView() would also scroll
  // the page's outer containers and push the WPML header/footer out of place.
  const scrollListTo = (el) => {
    const sc = getScroller();
    if (!sc) return;
    const r = el.getBoundingClientRect();
    const s = sc.getBoundingClientRect();
    sc.scrollTop += (r.top - s.top) - (s.height - Math.min(r.height, s.height)) / 2;
  };

  // The ATE page itself never scrolls; undo any shift caused by editor focus.
  const resetPageScroll = () => {
    let p = getScroller()?.parentElement;
    while (p) {
      if (p.scrollTop) p.scrollTop = 0;
      if (p.scrollLeft) p.scrollLeft = 0;
      p = p.parentElement;
    }
    if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
  };

  const getOpenEditorBody = (segEl) => {
    const iframe = segEl?.querySelector(SEL.editorIframe);
    return iframe?.contentDocument?.querySelector('#tinymce') || null;
  };

  // Opens the segment's editor (clicks "+", which also copies the source in).
  const openSegmentEditor = async (seg) => {
    const el = await revealSegment(seg);
    if (!el) return null;
    let body = getOpenEditorBody(el);
    if (body) return body;
    const add = el.querySelector(SEL.addButton);
    if (add) add.click();
    else (el.querySelector('.AT-segment_list__translation_container') || el).click();
    return await waitFor(() => getOpenEditorBody(getSegmentEl(seg.id)), 5000);
  };

  // Editor HTML without the spellchecker's wrapper spans
  const cleanEditorHtml = (body) => {
    const clone = body.cloneNode(true);
    clone.querySelectorAll('span.error-spellcheck, span[data-word]').forEach((s) => s.replaceWith(...s.childNodes));
    clone.querySelectorAll('[data-mce-bogus]').forEach((n) => n.remove());
    return clone.innerHTML.trim();
  };

  // True if the editor content carries markup beyond plain paragraphs
  const hasRichMarkup = (html) => /<(?!\/?(p|br)\b)[a-z]/i.test(html);

  const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const textToHtml = (text) =>
    text.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');

  const writeToEditor = (body, html) => {
    body.innerHTML = html;
    body.dispatchEvent(new Event('input', { bubbles: true }));
    body.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
  };

  // "Next segment" commits the open segment (verified: it saves and opens the following one).
  const commitSegment = async (seg) => {
    const next = document.querySelector(SEL.nextSegment);
    if (!next) return false;
    next.click();
    const ok = await waitFor(() => {
      const el = getSegmentEl(seg.id);
      return !el || !isOpened(el);
    }, 5000);
    return !!ok;
  };

  // ---------------------------------------------------------------------------
  // OpenRouter
  // ---------------------------------------------------------------------------
  const activeControllers = new Set();

  const callOpenRouter = async (messages, extra = {}) => {
    const controller = new AbortController();
    activeControllers.add(controller);
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer": "https://wpml.org",
          "X-Title": "WPML AI Translation"
        },
        body: JSON.stringify({ model: selectedModel, messages, max_tokens: 16000, ...extra }),
        signal: controller.signal
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        let errorMsg = errorText;
        try { errorMsg = JSON.parse(errorText)?.error?.message || errorText; } catch {}
        const err = new Error(`API responded with status ${response.status}: ${errorMsg}`);
        // Bad key / no credits / forbidden: retrying other segments is pointless
        err.fatal = [401, 402, 403].includes(response.status);
        throw err;
      }
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content?.trim() ?? "";
      if (!content) throw new Error("Empty response from API");
      return content;
    } finally {
      clearTimeout(timeoutId);
      activeControllers.delete(controller);
    }
  };

  // ---------------------------------------------------------------------------
  // Protection: markup/code is swapped for ⟦n⟧ placeholders before the AI sees it
  // and restored afterwards, so tags, attributes, class names, IDs, variables,
  // shortcodes and URLs can never be translated or broken.
  // ---------------------------------------------------------------------------
  const PROTECT_RE = new RegExp([
    '<[^>]+>',                               // HTML tags incl. class/id/attributes
    '\\{\\{[\\s\\S]*?\\}\\}',                // {{ template vars }}
    '\\{[A-Za-z0-9_.$:-]+\\}',               // {var}, {0}
    '%(?:\\d+\\$)?[sdfu]',                   // printf placeholders %s %1$s
    '\\[\\/?[a-z][\\w-]*(?:\\s[^\\]]*)?\\]', // [shortcodes]
    'https?:\\/\\/[^\\s<>"]+',               // URLs
    '[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+',      // emails
    '&(?:[a-z]+|#\\d+|#x[0-9a-f]+);',        // HTML entities
    '\\$[A-Za-z_]\\w*',                      // $variables
  ].join('|'), 'gi');

  const protect = (text) => {
    const tokens = [];
    const masked = text.replace(PROTECT_RE, (m) => {
      tokens.push(m);
      return `⟦${tokens.length}⟧`;
    });
    return { masked, tokens };
  };

  // Puts the originals back; throws if the model dropped, duplicated or invented a placeholder.
  const restore = (translated, tokens) => {
    const found = translated.match(/⟦\d+⟧/g) || [];
    const expected = tokens.map((_, i) => `⟦${i + 1}⟧`);
    if (found.length !== expected.length || expected.some((t) => !found.includes(t))) {
      throw new Error(`Placeholder mismatch (expected ${expected.length}, got ${found.length})`);
    }
    return translated.replace(/⟦(\d+)⟧/g, (_, n) => tokens[Number(n) - 1]);
  };

  // ---------------------------------------------------------------------------
  // Context: page title, element type and neighbouring segments, so the model
  // understands what each piece of text means and where it sits on the page.
  // ---------------------------------------------------------------------------
  let segmentIndex = []; // all segments in page order (filled by collectSegments)

  const getPageTitle = () => {
    const lbl = [...document.querySelectorAll('div, span, p')]
      .find((el) => !el.children.length && el.textContent.trim() === 'Translating');
    return lbl?.parentElement?.innerText.replace(/^Translating\s*/, '').trim() || document.title;
  };

  const buildContext = (id, label, list = segmentIndex, radius = 3) => {
    const i = list.findIndex((s) => s.id === id);
    const pick = (arr) => arr.map((s) => s.source).filter(Boolean);
    return {
      page: getPageTitle(),
      element: label || "",
      before: i >= 0 ? pick(list.slice(Math.max(0, i - radius), i)) : [],
      after: i >= 0 ? pick(list.slice(i + 1, i + 1 + radius)) : [],
    };
  };

  const contextBlock = (ctx) => {
    if (!ctx) return "";
    const lines = [`Page: "${ctx.page}"`];
    if (ctx.element) lines.push(`Element type: ${ctx.element}`);
    if (ctx.before.length) lines.push(`Text before it on the page:\n- ${ctx.before.join('\n- ')}`);
    if (ctx.after.length) lines.push(`Text after it on the page:\n- ${ctx.after.join('\n- ')}`);
    return `CONTEXT (for understanding only — do NOT translate or output this):\n${lines.join('\n')}\n\n`;
  };

  const translateSingle = async (text, langs, ctx) => {
    const { masked, tokens } = protect(text);
    const ask = () => callOpenRouter([
      { role: "system", content: systemPrompt },
      { role: "user", content: `${contextBlock(ctx)}Translate the following text from ${langs.source || 'the source language'} to ${langs.target}. Output only the translation.\n\nTEXT:\n${masked}` }
    ]);
    try {
      return restore(await ask(), tokens);
    } catch (e) {
      if (e.fatal || e.name === 'AbortError' || !/Placeholder/.test(e.message)) throw e;
      console.warn("[AI Translate] Placeholder mismatch, retrying once:", e.message);
      return restore(await ask(), tokens);
    }
  };

  const parseJsonLoose = (text) => {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(cleaned); } catch {}
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("Could not parse JSON from model response");
  };

  // Translates a batch of segments in one request. Returns { id: translation }.
  // Items whose placeholders don't survive are left out and retried individually.
  const translateBatch = async (batch, langs) => {
    const payload = {};
    const tokensById = {};
    batch.forEach((s) => {
      const { masked, tokens } = protect(s.source);
      tokensById[s.id] = tokens;
      payload[s.id] = s.context ? { element: s.context, text: masked } : { text: masked };
    });

    const instructions = `Page: "${getPageTitle()}"\n\n` +
      `You will receive a JSON object of text segments from this web page, keyed by segment ID, in the order they appear on the page. ` +
      `"element" tells you what kind of element the text is (heading, basic text, rich text, title…). ` +
      `Read all segments first to understand the page's topic and meaning, then translate every "text" from ${langs.source || 'the source language'} to ${langs.target}, ` +
      `using the surrounding segments as context and keeping terminology consistent across the page. ` +
      `Apply all rules from the system prompt to each segment.\n\n` +
      `Respond with ONLY a JSON object mapping each segment ID to its translated string, e.g. {"123": "translated text"}. ` +
      `Include every ID exactly once. No markdown, no comments.`;

    const content = await callOpenRouter([
      { role: "system", content: systemPrompt },
      { role: "user", content: `${instructions}\n\n${JSON.stringify(payload, null, 1)}` }
    ], { response_format: { type: "json_object" } });

    const parsed = parseJsonLoose(content);
    const result = {};
    batch.forEach((s) => {
      let v = parsed[s.id];
      if (v && typeof v === 'object') v = v.text;
      if (typeof v !== 'string' || !v.trim()) return;
      try {
        result[s.id] = restore(v.trim(), tokensById[s.id]);
      } catch (e) {
        console.warn(`[AI Translate] Segment ${s.id}: ${e.message}, will retry individually.`);
      }
    });
    return result;
  };

  const makeBatches = (segments) => {
    const batches = [];
    let cur = [];
    let chars = 0;
    for (const s of segments) {
      if (cur.length && (cur.length >= BATCH_MAX_ITEMS || chars + s.source.length > BATCH_MAX_CHARS)) {
        batches.push(cur);
        cur = [];
        chars = 0;
      }
      cur.push(s);
      chars += s.source.length;
    }
    if (cur.length) batches.push(cur);
    return batches;
  };

  // Runs batch requests with limited concurrency; returns one promise per batch.
  const startBatchTranslations = (batches, langs) => {
    let running = 0;
    const queue = [];
    const next = () => {
      if (running >= BATCH_CONCURRENCY || !queue.length) return;
      running++;
      const { batch, resolve } = queue.shift();
      translateBatch(batch, langs)
        .then((r) => resolve({ ok: true, result: r }))
        .catch((e) => resolve({ ok: false, error: e }))
        .finally(() => { running--; next(); });
    };
    const promises = batches.map((batch) => new Promise((resolve) => queue.push({ batch, resolve })));
    for (let i = 0; i < BATCH_CONCURRENCY; i++) next();
    return promises;
  };

  // ---------------------------------------------------------------------------
  // Flows
  // ---------------------------------------------------------------------------
  let stopRequested = false;
  let busy = false;

  const ensureReady = () => {
    if (!apiKey) {
      alert("Please configure your OpenRouter API key in the extension popup first.");
      return null;
    }
    const langs = getLanguages();
    if (!langs.target) {
      alert("Could not detect the target language on this page.");
      return null;
    }
    return langs;
  };

  const translateAll = async () => {
    const langs = ensureReady();
    if (!langs || busy) return;
    busy = true;
    stopRequested = false;
    setBusyUI(true);

    const stats = { done: 0, failed: 0, total: 0 };
    try {
      setStatus("Scanning segments…");
      const all = await collectSegments();
      segmentIndex = all;
      if (!all.length) throw diagError("No segments found. The ATE segment markup may have changed.");
      const todo = all.filter((s) => s.untranslated && s.source);
      stats.total = todo.length;
      console.log(`[AI Translate] ${all.length} segments found, ${todo.length} untranslated.`, langs);
      if (!todo.length) {
        setStatus("Nothing to translate — all segments have a translation.");
        return;
      }

      const batches = makeBatches(todo);
      setStatus(`Translating ${todo.length} segments in ${batches.length} batch(es)…`);
      const batchPromises = startBatchTranslations(batches, langs);

      for (let b = 0; b < batches.length && !stopRequested; b++) {
        const res = await batchPromises[b];
        if (stopRequested) break;
        if (!res.ok && res.error?.fatal) throw res.error;
        const translations = res.ok ? res.result : {};
        if (!res.ok) console.error(`[AI Translate] Batch ${b + 1} failed, falling back to single requests:`, res.error);

        for (const seg of batches[b]) {
          if (stopRequested) break;
          setStatus(`Filling ${stats.done + stats.failed + 1} / ${stats.total}…`);
          try {
            // Get the translation BEFORE opening the editor: opening copies the source in
            // and WPML autosaves it, so a failed request must never reach that point.
            const ctx = buildContext(seg.id, seg.context);
            const text = translations[seg.id] || await translateSingle(seg.source, langs, ctx);
            if (stopRequested) break;

            const body = await openSegmentEditor(seg);
            if (!body) throw new Error("Editor did not open");

            const editorHtml = cleanEditorHtml(body);
            // Inline tags present: translate the real editor HTML so markup survives
            const html = hasRichMarkup(editorHtml) ? await translateSingle(editorHtml, langs, ctx) : textToHtml(text);
            if (stopRequested) break;

            const liveBody = getOpenEditorBody(getSegmentEl(seg.id)) || body;
            writeToEditor(liveBody, html);
            await sleep(120);
            const committed = await commitSegment(seg);
            resetPageScroll();
            if (!committed) throw new Error("Could not commit segment");
            stats.done++;
          } catch (e) {
            if (e.fatal) throw e;
            stats.failed++;
            rememberError(e);
            console.error(`[AI Translate] Segment ${seg.id} failed:`, e);
          }
        }
      }

      setStatus(stopRequested
        ? `Stopped. ${stats.done} translated, ${stats.failed} failed.`
        : `Done. ${stats.done} translated${stats.failed ? `, ${stats.failed} failed` : ''}.` +
          (stats.failed && !stats.done ? ' If this keeps happening, use "Fix with AI" in the extension popup.' : ''));
    } catch (e) {
      stopAll(); // cancel the remaining batch requests
      if (e.name !== 'AbortError') {
        rememberError(e);
        console.error("[AI Translate] Translate all failed:", e);
        setStatus(`Error: ${e.message}${errorHint(e)} (${stats.done} translated before stopping)`);
      }
    } finally {
      busy = false;
      setBusyUI(false);
    }
  };

  // Translates the currently open segment in place (no commit, so it can be reviewed).
  const translateCurrent = async () => {
    const langs = ensureReady();
    if (!langs || busy) return;
    const segEl = [...document.querySelectorAll(SEL.segment)].find(isOpened);
    const body = getOpenEditorBody(segEl);
    if (!body) {
      alert("Open a segment first (click its + button).");
      return;
    }
    busy = true;
    stopRequested = false;
    setBusyUI(true);
    try {
      setStatus("Translating current segment…");
      const info = readSegmentInfo(segEl);
      const editorHtml = cleanEditorHtml(body);
      // Neighbours from the rows currently rendered around this segment
      const visible = [...document.querySelectorAll(SEL.segment)].map(readSegmentInfo);
      const ctx = buildContext(info.id, info.context, visible);
      const html = hasRichMarkup(editorHtml)
        ? await translateSingle(editorHtml, langs, ctx)
        : textToHtml(await translateSingle(info.source || body.innerText.trim(), langs, ctx));
      if (!stopRequested) {
        writeToEditor(getOpenEditorBody(getSegmentEl(info.id)) || body, html);
        resetPageScroll();
        setStatus("Segment translated — review and press ↓ to save.");
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        rememberError(e);
        console.error("[AI Translate] Segment translation failed:", e);
        setStatus(`Error: ${e.message}${errorHint(e)}`);
      }
    } finally {
      busy = false;
      setBusyUI(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Direct ATE API (no UI). ATE signs every request with HMAC-SHA1 over
  // `method + url + "?" + query` using the job's private key (kept by ATE in
  // localStorage). POST/PUT bodies are included as `body=md5(json)` in the
  // signed params. Endpoints used:
  //   GET  api/jobs/{job}?v=3                     -> job info + all segments
  //   POST api/jobs/{job}/segments/{seg}/save     -> save one translation
  // ---------------------------------------------------------------------------
  // The editor UI and its API live on different hosts (e.g. prod-edge-eate.wpml.org and prod-edge-ate.wpml.org).
  // The API host is in the editor's inline config (`var API_ENDPOINT = '...'`); fall back to the page origin.
  const readPageConfig = (name) => {
    const re = new RegExp(`\\bvar\\s+${name}\\s*=\\s*'([^']+)'`);
    for (const s of document.scripts) {
      const m = s.textContent.match(re);
      if (m) return m[1];
    }
    return null;
  };
  const apiBase = (ad = adapter) =>
    `${(ad.apiHost && ad.apiHost !== 'auto' ? ad.apiHost : readPageConfig('API_ENDPOINT') || location.origin).replace(/\/+$/, '')}/api`;

  const routePath = (name, vars, ad = adapter) =>
    ad.routes[name].replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(vars[k]));

  const STATUS_HINTS = {
    400: 'request rejected, parameters may have changed',
    401: 'signature or job keys rejected; reload the editor, if it persists the signing may have changed',
    403: 'signature or job keys rejected; reload the editor, if it persists the signing may have changed',
    404: 'route or API host changed',
    422: 'payload rejected, fields may have changed',
    500: 'ATE server error',
  };
  const SEGMENT_STATUS_UNTRANSLATED = 0;
  const SEGMENT_STATUS_COMPLETED = 2;
  const SAVE_CONCURRENCY = 4;

  const md5 = (str) => {
    const cmn = (q, a, b, x, s, t) => { a = (a + q + x + t) | 0; return (((a << s) | (a >>> (32 - s))) + b) | 0; };
    const ff = (a, b, c, d, x, s, t) => cmn((b & c) | (~b & d), a, b, x, s, t);
    const gg = (a, b, c, d, x, s, t) => cmn((b & d) | (c & ~d), a, b, x, s, t);
    const hh = (a, b, c, d, x, s, t) => cmn(b ^ c ^ d, a, b, x, s, t);
    const ii = (a, b, c, d, x, s, t) => cmn(c ^ (b | ~d), a, b, x, s, t);
    const R = [
      [ff, [7, 12, 17, 22], (i) => i, [-680876936, -389564586, 606105819, -1044525330, -176418897, 1200080426, -1473231341, -45705983, 1770035416, -1958414417, -42063, -1990404162, 1804603682, -40341101, -1502002290, 1236535329]],
      [gg, [5, 9, 14, 20], (i) => (5 * i + 1) % 16, [-165796510, -1069501632, 643717713, -373897302, -701558691, 38016083, -660478335, -405537848, 568446438, -1019803690, -187363961, 1163531501, -1444681467, -51403784, 1735328473, -1926607734]],
      [hh, [4, 11, 16, 23], (i) => (3 * i + 5) % 16, [-378558, -2022574463, 1839030562, -35309556, -1530992060, 1272893353, -155497632, -1094730640, 681279174, -358537222, -722521979, 76029189, -640364487, -421815835, 530742520, -995338651]],
      [ii, [6, 10, 15, 21], (i) => (7 * i) % 16, [-198630844, 1126891415, -1416354905, -57434055, 1700485571, -1894986606, -1051523, -2054922799, 1873313359, -30611744, -1560198380, 1309151649, -145523070, -1120210379, 718787259, -343485551]],
    ];
    const bytes = new TextEncoder().encode(str);
    const n = bytes.length;
    const blocks = ((n + 8) >>> 6) + 1;
    const w = new Int32Array(blocks * 16);
    for (let i = 0; i < n; i++) w[i >> 2] |= bytes[i] << ((i % 4) * 8);
    w[n >> 2] |= 0x80 << ((n % 4) * 8);
    w[blocks * 16 - 2] = n * 8;
    const st = [1732584193, -271733879, -1732584194, 271733878];
    for (let b = 0; b < blocks; b++) {
      const k = w.subarray(b * 16, b * 16 + 16);
      let [a, bb, c, d] = st;
      for (const [fn, shifts, idx, T] of R) {
        for (let i = 0; i < 16; i++) {
          const t = fn(a, bb, c, d, k[idx(i)], shifts[i % 4], T[i]);
          a = d; d = c; c = bb; bb = t;
        }
      }
      st[0] = (st[0] + a) | 0; st[1] = (st[1] + bb) | 0; st[2] = (st[2] + c) | 0; st[3] = (st[3] + d) | 0;
    }
    return st.map((v) => [0, 8, 16, 24].map((s) => ((v >>> s) & 255).toString(16).padStart(2, '0')).join('')).join('');
  };

  const b64utf8 = (s) => {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };

  const hmacSha1Base64 = async (message, key) => {
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message)));
    return btoa(String.fromCharCode(...sig));
  };

  // Same encoding as ATE's Uri.buildQueryString (key order matters for the signature)
  const buildQuery = (o) => Object.keys(o).map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(o[k])}`).join('&');

  const getJobId = () => new URLSearchParams(location.search).get('id');

  const getAteKeys = (jobId) => {
    const privateKey = localStorage.getItem(`ate_private_key_${jobId}`);
    const sharedKey = localStorage.getItem(`ate_shared_key_${jobId}`);
    if (!privateKey || !sharedKey) throw new Error("ATE keys not found for this job — reload the editor page.");
    return { privateKey, sharedKey };
  };

  const ateRequest = async (method, path, params = {}, body = null, ad = adapter) => {
    const jobId = getJobId();
    const { privateKey, sharedKey } = getAteKeys(jobId);
    const url = `${apiBase(ad)}/${path}`;
    const query = { ...params, ui_language_code: 'en', shared_key: sharedKey, uuid: crypto.randomUUID() };
    const bodyStr = body ? JSON.stringify(body) : null;
    const signed = bodyStr ? { ...query, body: md5(bodyStr) } : query;
    const signature = await hmacSha1Base64(`${method.toLowerCase()}${url}?${buildQuery(signed)}`, privateKey);
    let response;
    try {
      response = await fetch(`${url}?${buildQuery(query)}&signature=${encodeURIComponent(signature)}`, {
        method,
        headers: bodyStr ? { 'Content-Type': 'application/json;charset=UTF-8' } : {},
        body: bodyStr,
      });
    } catch (e) {
      logNet({ from: 'extension', method, url: sanitizeUrl(url), status: 0, error: e.message });
      throw diagError(`ATE API ${method} ${path} could not be reached (network/CORS); the API host may have changed.`, url, 0);
    }
    if (!response.ok) {
      logNet({ from: 'extension', method, url: sanitizeUrl(url), status: response.status });
      throw diagError(`ATE API ${method} ${path} failed: ${response.status} (${STATUS_HINTS[response.status] || 'unexpected response'})`, url, response.status);
    }
    const json = await response.json();
    logNet({ from: 'extension', method, url: sanitizeUrl(url), status: response.status, shape: shapeOf(json) });
    return json;
  };

  const fetchJob = (ad = adapter) =>
    ateRequest('GET', routePath('job', { job: getJobId() }, ad), { ...ad.jobParams }, null, ad);

  // The job response only embeds the first page; the rest come from the page route
  const fetchPage = (pageNumber, ad = adapter) =>
    ateRequest('GET', routePath('page', { job: getJobId(), page: pageNumber }, ad), {}, null, ad);

  const fetchAllSegments = async (data) => {
    const segments = [...(pick(data, F('jobSegments')) || [])];
    const firstPage = pick(data, F('firstPageNumber')) ?? 0;
    const pages = pick(data, F('pages')) || [];
    for (const p of pages) {
      const n = pick(p, F('pageNumber'));
      if (n === firstPage) continue;
      setStatus(`Loading page ${n + 1} / ${pages.length}…`);
      const page = await fetchPage(n);
      segments.push(...(pick(page, F('pageSegments')) || []));
    }
    return segments;
  };

  const saveSegmentViaApi = async (segmentId, xliffId, translatedText) => {
    const totalMarkers = (translatedText.match(/<(g|x)\b/g) || []).length;
    const res = await ateRequest('POST', routePath('save', { job: getJobId(), seg: segmentId }), {}, {
      changed_markers: 0, // markers are restored verbatim from the source
      status: SEGMENT_STATUS_COMPLETED,
      total_markers: totalMarkers,
      translated_text: b64utf8(translatedText),
      xliff_id: xliffId,
    });
    if (res?.code !== 200) throw diagError(res?.message || `Save rejected (response: ${JSON.stringify(shapeOf(res))})`);
    return res;
  };

  // Segments worth translating: real text (ATE flags code/CSS/number values as
  // "unclear" and hides them in the editor), still untranslated or just a copy of the source.
  const needsTranslation = (s) => {
    const src = pick(s, F('segmentSource'));
    return !pick(s, F('segmentUnclear')) &&
      src &&
      !/^<!\[CDATA\[/.test(src) &&
      (pick(s, F('segmentStatus')) === SEGMENT_STATUS_UNTRANSLATED || pick(s, F('segmentTarget')) === src);
  };

  const toSegment = (s) => ({
    id: String(pick(s, F('segmentId'))),
    source: pick(s, F('segmentSource')),
    context: pick(s, F('segmentContext')) || "",
  });

  const runLimited = async (items, limit, worker) => {
    let i = 0;
    const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length && !stopRequested) await worker(items[i++]);
    });
    await Promise.all(lanes);
  };

  const translateAllViaApi = async () => {
    if (!apiKey) {
      alert("Please configure your OpenRouter API key in the extension popup first.");
      return;
    }
    if (busy) return;
    busy = true;
    stopRequested = false;
    setBusyUI(true);
    const stats = { done: 0, failed: 0, total: 0 };
    try {
      setStatus("Loading job from ATE…");
      const data = await fetchJob();
      const xliffId = pick(data, F('xliffId'));
      const segments = await fetchAllSegments(data);
      if (!segments.length) throw diagError("Job loaded but no segments found; the API response format may have changed.");
      if (!xliffId) throw diagError("Could not read the job's xliff id; the API response format may have changed.");

      const langs = {
        source: pick(data, F('sourceLanguage')) || getLanguages().source,
        target: pick(data, F('targetLanguage')) || getLanguages().target,
      };
      const visible = segments.filter((s) => !pick(s, F('segmentUnclear')));
      if (visible.length && !visible.some((s) => pick(s, F('segmentSource')))) {
        throw diagError("Segments have no source text field; the API response format may have changed.");
      }
      segmentIndex = visible.map(toSegment);
      const todo = visible.filter(needsTranslation).map(toSegment);
      stats.total = todo.length;
      console.log(`[AI Translate] API: ${segments.length} segments, ${visible.length} text, ${todo.length} to translate.`, langs);
      if (!todo.length) {
        setStatus("Nothing to translate — all segments have a translation.");
        return;
      }

      const batches = makeBatches(todo);
      setStatus(`Translating ${todo.length} segments in ${batches.length} batch(es)…`);
      const batchPromises = startBatchTranslations(batches, langs);

      for (let b = 0; b < batches.length && !stopRequested; b++) {
        const res = await batchPromises[b];
        if (stopRequested) break;
        if (!res.ok && res.error?.fatal) throw res.error;
        const translations = res.ok ? res.result : {};
        if (!res.ok) console.error(`[AI Translate] Batch ${b + 1} failed, falling back to single requests:`, res.error);

        await runLimited(batches[b], SAVE_CONCURRENCY, async (seg) => {
          try {
            const text = translations[seg.id] || await translateSingle(seg.source, langs, buildContext(seg.id, seg.context));
            if (stopRequested) return;
            await saveSegmentViaApi(seg.id, xliffId, text);
            stats.done++;
          } catch (e) {
            if (e.fatal) throw e;
            stats.failed++;
            rememberError(e);
            console.error(`[AI Translate] API segment ${seg.id} failed:`, e);
          }
          setStatus(`Saved ${stats.done} / ${stats.total}${stats.failed ? ` (${stats.failed} failed)` : ''}…`);
        });
      }

      if (stopRequested) {
        setStatus(`Stopped. ${stats.done} saved, ${stats.failed} failed. Reload the page to see them.`);
      } else {
        setStatus(`Done. ${stats.done} saved${stats.failed ? `, ${stats.failed} failed` : ''}. Reloading editor…`);
        // The editor UI doesn't know about API saves; reload so it shows them
        setTimeout(() => location.reload(), 1500);
      }
    } catch (e) {
      stopAll();
      if (e.name !== 'AbortError') {
        rememberError(e);
        console.error("[AI Translate] API translate failed:", e);
        setStatus(`Error: ${e.message}${errorHint(e)} (${stats.done} saved before stopping)`);
      }
    } finally {
      busy = false;
      setBusyUI(false);
    }
  };

  const stopAll = () => {
    stopRequested = true;
    activeControllers.forEach((c) => c.abort());
    activeControllers.clear();
    setStatus("Stopping…");
  };

  // ---------------------------------------------------------------------------
  // Health check + diagnostics bundle (no page text, keys or signatures)
  // ---------------------------------------------------------------------------
  const countMatches = (selector) => {
    try { return document.querySelectorAll(selector).length; } catch { return 'invalid'; }
  };

  const runHealthCheck = () => {
    let ateKeys = false;
    try { getAteKeys(getJobId()); ateKeys = true; } catch {}
    return {
      jobId: !!getJobId(),
      ateKeys,
      apiBase: apiBase(),
      header: countMatches(SEL.header),
      segmentList: countMatches(SEL.scroller),
      segments: countMatches(SEL.segment),
    };
  };

  const healthProblems = (h) => [
    !h.ateKeys && 'ATE job keys missing',
    !h.header && 'header not found',
    !h.segmentList && 'segment list not found',
    !h.segments && 'no segment rows',
  ].filter(Boolean);

  // Only these exact UI labels are kept as text in the DOM outline
  const UI_LABELS = new Set(['Original', 'Translation', 'Translating']);

  const nodeSig = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id && !/\d{3,}/.test(el.id)) s += `#${el.id}`;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 6) : [];
    if (cls.length) s += ` class="${cls.join(' ')}"`;
    const attrs = [...el.attributes].map((a) => a.name)
      .filter((n) => n.startsWith('data-') || n === 'role' || n === 'contenteditable');
    if (attrs.length) s += ` [${attrs.join(' ')}]`;
    return s;
  };

  // Indented tag/class/data-* outline of the page; runs of identical siblings are collapsed
  const domOutline = (root, maxLines = 700) => {
    const lines = [];
    const walk = (el, depth) => {
      if (lines.length >= maxLines || depth > 40) return;
      if (/^(script|style|svg|noscript|link|meta|iframe)$/i.test(el.tagName) || el.id === 'wai-panel') return;
      let line = '  '.repeat(depth) + nodeSig(el);
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
      if (UI_LABELS.has(own)) line += ` "${own}"`;
      else if (own) line += ' (text)';
      lines.push(line);
      const kids = [...el.children];
      for (let i = 0; i < kids.length; i++) {
        let j = i;
        while (j + 1 < kids.length && nodeSig(kids[j + 1]) === nodeSig(kids[i])) j++;
        walk(kids[i], depth + 1);
        if (j > i) lines.push(`${'  '.repeat(depth + 1)}… ${j - i} more like the above`);
        i = j;
      }
    };
    walk(root, 0);
    return lines.join('\n');
  };

  const collectDiagnostics = () => ({
    extensionVersion: chrome.runtime.getManifest().version,
    ateAppVersion: readPageConfig('AppVersion'),
    pageConfig: { API_ENDPOINT: readPageConfig('API_ENDPOINT') },
    page: location.origin + location.pathname,
    lastError,
    health: runHealthCheck(),
    adapter,
    selectorMatches: Object.fromEntries(Object.entries(adapter.selectors)
      .map(([k, list]) => [k, list.map((s) => ({ selector: s, matches: countMatches(s) }))])),
    network: netLog.slice(-30),
    domOutline: domOutline(document.body),
  });

  // Runs once after the toolbar mounts: reports broken pieces and ATE version changes
  const checkHealth = async () => {
    if (busy) return;
    const problems = healthProblems(runHealthCheck());
    const version = readPageConfig('AppVersion');
    let note = '';
    try {
      const { lastAteVersion } = await chrome.storage.local.get('lastAteVersion');
      if (version && lastAteVersion && version !== lastAteVersion) note = `ATE updated ${lastAteVersion} → ${version}. `;
      if (version) await chrome.storage.local.set({ lastAteVersion: version });
    } catch {}
    if (busy) return;
    if (problems.length) setStatus(`${note}⚠ ${problems.join(', ')}. Open the extension popup → Editor tools → Fix with AI.`);
    else if (note) setStatus(`${note}Health check OK.`);
  };

  // ---------------------------------------------------------------------------
  // Fix with AI: the model sees the diagnostics and may only return a patch to the
  // adapter. The patch is validated, dry-run tested and shown to the user before
  // it is stored; "Undo Fix" restores the previous adapter.
  // ---------------------------------------------------------------------------
  const FIX_SYSTEM_PROMPT = `You maintain a Chrome extension that automates the WPML Advanced Translation Editor (ATE). WPML changed its page or API and the extension's "adapter" (API host, routes, response field paths, CSS selectors) may no longer match.

You receive diagnostics: the current adapter, how many elements each selector matches, recent network calls made by the editor itself (from: "editor") and by the extension (from: "extension") with method, URL, status and the JSON response shape (keys and types only), the last error, and an outline of the page DOM (tags, classes, data-* attribute names).

Find what changed by comparing the extension's failing calls and selectors with what the editor itself does. Respond with ONLY a JSON object:
{"diagnosis": "<one or two sentences>", "confidence": "high" | "medium" | "low", "patch": { ...only the adapter keys that must change... }}

Patch rules:
- Allowed keys: apiHost ("auto" or an https origin on wpml.org, no path), routes.job / routes.page / routes.save (paths relative to {apiHost}/api using {job}, {page}, {seg}), jobParams (query params of the job request), fields.<name> (dot paths into the API JSON), segmentIdAttr (a data-* attribute), openedClass (a class name), selectors.<name> (array of CSS selectors, best first).
- Only use names that already exist in the current adapter.
- Every change must be backed by evidence in the diagnostics. If you cannot tell, return an empty patch and explain in diagnosis.
- For selectors prefer stable hooks (data-* attributes, role) and keep the old selector as a later fallback.
- editorIframe, nextSegment and addButton only exist while a segment editor is open; translationText and chip may legitimately match nothing. Zero matches there is not a problem by itself.`;

  const OPTIONAL_SELECTORS = new Set(['editorIframe', 'nextSegment', 'addButton', 'translationText', 'chip']);

  const isWpmlOrigin = (u) => {
    try {
      const x = new URL(u);
      return x.protocol === 'https:' && x.pathname === '/' && !x.search &&
        (x.hostname === 'wpml.org' || x.hostname.endsWith('.wpml.org'));
    } catch {
      return false;
    }
  };

  const validatePatch = (patch) => {
    if (!isPlainObj(patch)) return ['patch is not an object'];
    const errors = [];
    const checkMap = (key, val, test) => {
      if (!isPlainObj(val)) return errors.push(`${key} must be an object`);
      for (const [k, v] of Object.entries(val)) {
        if (!(k in DEFAULT_ADAPTER[key])) errors.push(`unknown ${key}.${k}`);
        else {
          const problem = test(k, v);
          if (problem) errors.push(`${key}.${k}: ${problem}`);
        }
      }
    };
    for (const [key, val] of Object.entries(patch)) {
      switch (key) {
        case 'apiHost':
          if (val !== 'auto' && !isWpmlOrigin(val)) errors.push('apiHost must be "auto" or an https wpml.org origin');
          break;
        case 'segmentIdAttr':
          if (typeof val !== 'string' || !/^data-[a-z0-9-]+$/.test(val)) errors.push('segmentIdAttr must be a data-* attribute');
          break;
        case 'openedClass':
          if (typeof val !== 'string' || !/^[\w-]+$/.test(val)) errors.push('openedClass must be a class name');
          break;
        case 'jobParams':
          if (!isPlainObj(val) || Object.values(val).some((v) => !['string', 'number', 'boolean'].includes(typeof v))) {
            errors.push('jobParams must be an object of simple values');
          }
          break;
        case 'routes':
          checkMap('routes', val, (k, v) => {
            if (typeof v !== 'string' || /:\/\/|\.\.|^\/|[?#\s]/.test(v)) return 'must be a relative path';
            if (!v.includes('{job}')) return 'must contain {job}';
            if (k === 'page' && !v.includes('{page}')) return 'must contain {page}';
            if (k === 'save' && !v.includes('{seg}')) return 'must contain {seg}';
            return null;
          });
          break;
        case 'fields':
          checkMap('fields', val, (k, v) => (typeof v === 'string' && /^[\w.]+$/.test(v) ? null : 'must be a dot path'));
          break;
        case 'selectors':
          checkMap('selectors', val, (k, v) => {
            if (!Array.isArray(v) || !v.length || v.length > 6) return 'must be a list of 1-6 selectors';
            for (const s of v) {
              if (typeof s !== 'string' || s.length > 300) return 'invalid selector';
              try { document.querySelector(s); } catch { return `invalid CSS: ${s}`; }
            }
            return null;
          });
          break;
        default:
          errors.push(`unknown key ${key}`);
      }
    }
    return errors;
  };

  const normalizePatch = (p) => (p.apiHost && p.apiHost !== 'auto' ? { ...p, apiHost: new URL(p.apiHost).origin } : p);

  // Read-only checks of a candidate adapter; writes (the save route) are never tested
  const dryRun = async (candidate, patch) => {
    const results = [];
    for (const k of Object.keys(patch.selectors || {})) {
      const n = countMatches(candidate.selectors[k].join(', '));
      results.push({ check: `selector ${k}`, ok: n > 0 || OPTIONAL_SELECTORS.has(k), detail: `${n} match(es)` });
    }
    if (patch.segmentIdAttr) {
      const n = countMatches(`[${candidate.segmentIdAttr}]`);
      results.push({ check: 'segmentIdAttr', ok: n > 0, detail: `${n} element(s)` });
    }
    if (patch.apiHost || patch.routes?.job || patch.routes?.page || patch.jobParams || patch.fields) {
      try {
        const data = await fetchJob(candidate);
        const segs = pick(data, candidate.fields.jobSegments);
        results.push({
          check: 'load job via API',
          ok: Array.isArray(segs) && segs.length > 0,
          detail: Array.isArray(segs) ? `${segs.length} segments on the first page` : 'no segment list at fields.jobSegments',
        });
        if (patch.routes?.page) {
          const pages = pick(data, candidate.fields.pages) || [];
          const n = pages.length ? pick(pages[0], candidate.fields.pageNumber) : 0;
          await fetchPage(n, candidate);
          results.push({ check: 'load page via API', ok: true, detail: `page ${n}` });
        }
      } catch (e) {
        results.push({ check: 'API read', ok: false, detail: e.message });
      }
    }
    if (patch.routes?.save) {
      results.push({ check: 'save route', ok: null, detail: 'not tested (it would write data); confirm manually' });
    }
    return results;
  };

  const fixWithAi = async () => {
    if (!apiKey) {
      alert("Please configure your OpenRouter API key in the extension popup first.");
      return;
    }
    if (busy) return;
    busy = true;
    stopRequested = false;
    setBusyUI(true);
    try {
      setStatus('Asking AI to diagnose…');
      const reply = parseJsonLoose(await callOpenRouter([
        { role: 'system', content: FIX_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(collectDiagnostics()) },
      ], { response_format: { type: 'json_object' } }));
      console.log('[AI Translate] AI diagnosis:', reply);
      const patch = reply.patch || {};
      if (!isPlainObj(patch) || !Object.keys(patch).length) {
        setStatus(`AI: ${reply.diagnosis || 'no change suggested.'}`);
        return;
      }
      const errors = validatePatch(patch);
      if (errors.length) {
        setStatus(`AI suggestion rejected: ${errors.join('; ')}`);
        return;
      }
      const clean = normalizePatch(patch);
      setStatus('Testing the suggested fix…');
      const results = await dryRun(mergeAdapter(adapter, clean), clean);
      const failed = results.some((r) => r.ok === false);
      const summary = [
        `AI diagnosis (${reply.confidence || 'unknown'} confidence): ${reply.diagnosis || ''}`,
        '',
        'Suggested change:',
        JSON.stringify(clean, null, 2),
        '',
        'Test results:',
        ...(results.length ? results.map((r) => `${r.ok === true ? '✔' : r.ok === false ? '✘' : '?'} ${r.check}: ${r.detail}`) : ['(nothing testable)']),
        '',
        failed ? 'Some tests FAILED. Apply anyway?' : 'Apply this fix?',
      ].join('\n');
      if (!confirm(summary)) {
        setStatus('AI fix not applied.');
        return;
      }
      const { ateAdapter: prev } = await chrome.storage.local.get('ateAdapter');
      const override = mergeAdapter(prev || {}, clean);
      await chrome.storage.local.set({ ateAdapter: override, ateAdapterPrev: prev || {} });
      applyAdapter(override);
      setStatus('Fix applied. Try again; "Undo Fix" restores the previous settings.');
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('[AI Translate] Fix with AI failed:', e);
        setStatus(`Fix with AI failed: ${e.message}`);
      }
    } finally {
      busy = false;
      setBusyUI(false);
    }
  };

  const undoFix = async () => {
    if (busy) return;
    try {
      const { ateAdapter, ateAdapterPrev } = await chrome.storage.local.get(['ateAdapter', 'ateAdapterPrev']);
      if (!ateAdapter) {
        setStatus('Already using the built-in settings.');
        return;
      }
      const restore = ateAdapterPrev && Object.keys(ateAdapterPrev).length ? ateAdapterPrev : null;
      if (restore) await chrome.storage.local.set({ ateAdapter: restore });
      else await chrome.storage.local.remove('ateAdapter');
      await chrome.storage.local.remove('ateAdapterPrev');
      applyAdapter(restore);
      setStatus(restore ? 'Restored the previous settings.' : 'Restored the built-in settings.');
    } catch (e) {
      setStatus(`Undo failed: ${e.message}`);
    }
  };

  // ---------------------------------------------------------------------------
  // UI: toolbar placed right under the "Original / Translation" header
  // ---------------------------------------------------------------------------
  let panel, statusEl;
  let lastStatus = "";

  const setStatus = (msg) => {
    lastStatus = msg;
    if (statusEl) statusEl.textContent = msg;
    console.log(`[AI Translate] ${msg}`);
  };

  const setBusyUI = (isBusy) => {
    if (!panel) return;
    panel.querySelectorAll('.wai-run').forEach((b) => { b.disabled = isBusy; });
    panel.querySelector('.wai-stop').disabled = !isBusy;
    panel.classList.toggle('wai-busy', isBusy);
  };

  const buildPanel = () => {
    panel = document.createElement('div');
    panel.id = 'wai-panel';
    panel.innerHTML = `
      <span class="wai-title"></span>
      <button class="wai-run wai-all">Translate All</button>
      <button class="wai-run wai-one">Translate Segment</button>
      <button class="wai-run wai-api" title="Translates and saves through the ATE API directly — fastest, reloads the editor when done">Fast Translate (API)</button>
      <button class="wai-stop" disabled>Stop</button>
      <span class="wai-status">Ready.</span>`;
    panel.querySelector('.wai-all').addEventListener('click', translateAll);
    panel.querySelector('.wai-one').addEventListener('click', translateCurrent);
    panel.querySelector('.wai-api').addEventListener('click', translateAllViaApi);
    panel.querySelector('.wai-stop').addEventListener('click', stopAll);
    statusEl = panel.querySelector('.wai-status');
    setTimeout(checkHealth, 4000); // give the editor time to render its segment list
  };

  // (Re)inserts the toolbar after the header; React may re-render the header and drop it.
  // If the header selector stops matching (ATE changed its markup), the toolbar is pinned
  // to the top of the page instead of silently not appearing.
  let warnedNoHeader = false;
  const mountPanel = () => {
    // The extension now runs on every wpml.org page: only ATE job pages (?id=...) get a toolbar
    if (!getJobId()) return;
    const header = document.querySelector(SEL.header);
    if (!header && !document.querySelector(SEL.scroller)) return;
    if (!panel) buildPanel();
    panel.classList.toggle('wai-floating', !header);
    if (!header) {
      if (!warnedNoHeader) {
        warnedNoHeader = true;
        console.warn(`[AI Translate] Header not found with selector ${SEL.header}. Toolbar placed at top of page; ATE markup has probably changed.`);
      }
      if (panel.parentElement !== document.body) document.body.prepend(panel);
      return;
    }
    if (header.nextElementSibling !== panel) header.after(panel);
  };

  // Popup "Editor tools": messages from the extension popup. They don't depend on the
  // toolbar, so they keep working when WPML's page changes and the toolbar can't be placed.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('wai-')) return;
    if (!getJobId()) {
      sendResponse({ ok: false, status: 'This tab is not an ATE job page.' });
      return;
    }
    const toolbarShown = () => !!panel?.isConnected;
    const run = async (fn) => {
      if (busy) return { ok: false, status: 'A run is already in progress.' };
      await fn();
      // The popup may have closed (e.g. behind a confirm dialog); show the result on the page
      if (!toolbarShown() && lastStatus) alert(`AI Translation: ${lastStatus}`);
      return { ok: true, status: lastStatus };
    };
    switch (msg.type) {
      case 'wai-health': {
        const health = runHealthCheck();
        sendResponse({
          ok: true, health, problems: healthProblems(health),
          ateVersion: readPageConfig('AppVersion'), toolbar: toolbarShown(), busy,
        });
        return;
      }
      case 'wai-diagnostics':
        sendResponse({ ok: true, diagnostics: collectDiagnostics() });
        return;
      case 'wai-fix':
        run(fixWithAi).then(sendResponse);
        return true;
      case 'wai-undo':
        run(undoFix).then(sendResponse);
        return true;
      case 'wai-fast':
        run(translateAllViaApi).then(sendResponse);
        return true;
    }
  });

  mountPanel();
  new MutationObserver(mountPanel).observe(document.body, { childList: true, subtree: true });
})();
