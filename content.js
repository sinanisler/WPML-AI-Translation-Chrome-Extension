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
    if (namespace !== 'sync') return;
    if (changes.openrouterApiKey) apiKey = changes.openrouterApiKey.newValue || "";
    if (changes.openrouterSelectedModel) selectedModel = changes.openrouterSelectedModel.newValue || selectedModel;
    if (changes.systemPrompt) systemPrompt = resolvePrompt(changes.systemPrompt.newValue);
  });

  // ---------------------------------------------------------------------------
  // ATE DOM helpers (new React/Virtuoso editor)
  // ---------------------------------------------------------------------------
  const SEL = {
    scroller: '[data-virtuoso-scroller]',
    segment: '[data-at-segment-id]',
    originalText: '.AT-segment_list__original .eate-SegmentItem\\.styles__SegmentTextContainer',
    translationText: '.AT-segment_list__translation',
    chip: '.eate-Chip\\.styles__ChipContentStyled',
    addButton: '.AT-segment_list__add_translation_button',
    editorIframe: 'iframe.tox-edit-area__iframe',
    nextSegment: '.AT-editor__next_segment',
    header: '[class*="eate-SegmentListHeader.styles__Container"]',
  };

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
  const getSegmentEl = (id) => document.querySelector(`[data-at-segment-id="${id}"]`);

  // Reads the "Original: German / Translation: English" labels in the segment list header
  const getLanguages = () => {
    const out = { source: "", target: "" };
    let labels = document.querySelectorAll(`${SEL.header} .eate-SegmentListHeader\\.styles__SegmentType`);
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
    const opened = el.className.includes('ate-segment-opened');
    return {
      id: el.dataset.atSegmentId,
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
    if (!scroller) throw new Error("Segment list not found on this page.");
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
      return !el || !el.className.includes('ate-segment-opened');
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
            console.error(`[AI Translate] Segment ${seg.id} failed:`, e);
          }
        }
      }

      setStatus(stopRequested
        ? `Stopped. ${stats.done} translated, ${stats.failed} failed.`
        : `Done. ${stats.done} translated${stats.failed ? `, ${stats.failed} failed` : ''}.`);
    } catch (e) {
      stopAll(); // cancel the remaining batch requests
      if (e.name !== 'AbortError') {
        console.error("[AI Translate] Translate all failed:", e);
        setStatus(`Error: ${e.message}${e.fatal ? ' — check your API key / credits in the extension popup.' : ''} (${stats.done} translated before stopping)`);
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
    const segEl = document.querySelector(`${SEL.segment}.ate-segment-opened`);
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
        console.error("[AI Translate] Segment translation failed:", e);
        setStatus(`Error: ${e.message}`);
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
  // UI: toolbar placed right under the "Original / Translation" header
  // ---------------------------------------------------------------------------
  let panel, statusEl;

  const setStatus = (msg) => {
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
      <span class="wai-title">⚡ AI Translation</span>
      <button class="wai-run wai-all">Translate All</button>
      <button class="wai-run wai-one">Translate Segment</button>
      <button class="wai-stop" disabled>Stop</button>
      <span class="wai-status">Ready.</span>`;
    panel.querySelector('.wai-all').addEventListener('click', translateAll);
    panel.querySelector('.wai-one').addEventListener('click', translateCurrent);
    panel.querySelector('.wai-stop').addEventListener('click', stopAll);
    statusEl = panel.querySelector('.wai-status');
  };

  // (Re)inserts the toolbar after the header; React may re-render the header and drop it.
  const mountPanel = () => {
    const header = document.querySelector(SEL.header);
    if (!header) return;
    if (!panel) buildPanel();
    if (header.nextElementSibling !== panel) header.after(panel);
  };

  mountPanel();
  new MutationObserver(mountPanel).observe(document.body, { childList: true, subtree: true });
})();
