(function () {
  let apiKey = "";
  let selectedModel = "google/gemini-2.5-flash"; // Default for OpenRouter
  let systemPrompt = ""; // Will be loaded from storage    

  // Default system prompt (only used if nothing is saved)
  const DEFAULT_SYSTEM_PROMPT = `You are a translation tool. Follow these rules strictly:

1. ONLY translate text from the source language to the target language
2. NEVER add explanations, definitions, etymology, or commentary
3. Return ONLY the translated text - nothing more
4. Keep these AS-IS without translation:
   - Brand names or names (Nike, Alex, McDonald's, etc.)
   - Product names and model numbers
   - URLs, email addresses, and technical identifiers
   - HTML tags and attributes
   - Single words that are proper nouns
   - Text already in the target language
   - Very short strings (1-2 words) that are ambiguous

5. If the text is already in the target language, return it EXACTLY as provided
6. If uncertain whether something is a name/brand, keep it unchanged
7. Preserve all formatting, spacing, and HTML structure exactly

Output format: Return ONLY the translation. No quotes, no language labels, no explanations.`;

  // Load settings from storage
  const loadSettings = async () => {
    try {
      const result = await chrome.storage.sync.get([
        'openrouterApiKey',
        'openrouterSelectedModel',
        'systemPrompt'
      ]);

      apiKey = result.openrouterApiKey || "";
      selectedModel = result.openrouterSelectedModel || "openai/gpt-4o-mini";
      systemPrompt = result.systemPrompt || DEFAULT_SYSTEM_PROMPT;

      console.log('Settings loaded:', {
        hasApiKey: !!apiKey,
        model: selectedModel,
        promptLength: systemPrompt.length
      });
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  // Initialize settings
  loadSettings();

  // Listen for storage changes to update settings in real-time
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
      if (changes.openrouterApiKey) {
        apiKey = changes.openrouterApiKey.newValue || "";
      }
      if (changes.openrouterSelectedModel) {
        selectedModel = changes.openrouterSelectedModel.newValue || "openai/gpt-4o-mini";
      }
      if (changes.systemPrompt) {
        systemPrompt = changes.systemPrompt.newValue || systemPrompt;
      }
    }
  });

  let stopTranslation = false; // Global variable for stopping the translation
  let currentAbortController = null; // Controller for aborting fetch requests

  // Smart iframe finder: tries known selectors, then scans all iframes for #tinymce
  const findEditorIframe = () => {
    const selectors = [
      ".mce-panel iframe",
      ".mce-edit-area iframe",
      "iframe[id*='otgs-editor']",
      "iframe[id*='_ifr']",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.contentDocument && el.contentDocument.querySelector("#tinymce")) {
        console.log(`[AI Translate] iframe found via selector: "${sel}" (id=${el.id})`);
        return el;
      }
    }
    // Last resort: scan every iframe on the page
    const allIframes = document.querySelectorAll("iframe");
    console.log(`[AI Translate] Scanning all ${allIframes.length} iframes on page...`);
    for (const iframe of allIframes) {
      try {
        if (iframe.contentDocument && iframe.contentDocument.querySelector("#tinymce")) {
          console.log(`[AI Translate] iframe found via full scan (id=${iframe.id}, src=${iframe.src})`);
          return iframe;
        }
      } catch (e) { /* cross-origin, skip */ }
    }
    console.error("[AI Translate] No iframe with #tinymce found on page. All iframes:", [...allIframes].map(f => ({ id: f.id, src: f.src })));
    return null;
  };

  const tryToAddButtons = () => {
    const targetElement = document.querySelector(".otgs-editor-container .nav");
    if (targetElement) {
      // Check if buttons already exist
      if (targetElement.querySelector('.translate-wpm-button')) {
        return true; // Buttons already added
      }

      // Add "Translate with AI" button
      const translateButton = document.createElement("button");
      translateButton.textContent = "AI Translate";
      translateButton.className = "translate-wpm-button";
      translateButton.addEventListener("click", () => translateWithAI(false));
      targetElement.appendChild(translateButton);

      // Add "Auto Translate" button
      const autoTranslateButton = document.createElement("button");
      autoTranslateButton.textContent = "AI Translate All";
      autoTranslateButton.className = "auto-translate-button";
      autoTranslateButton.addEventListener("click", () => translateWithAI(true));
      targetElement.appendChild(autoTranslateButton);

      // Add "Stop" button
      const stopButton = document.createElement("button");
      stopButton.textContent = "Stop";
      stopButton.className = "stop-translation-button";
      stopButton.addEventListener("click", () => {
        stopTranslation = true; // Set the global variable to stop

        // Immediately abort any ongoing fetch request
        if (currentAbortController) {
          currentAbortController.abort();
          currentAbortController = null;
        }

        // Re-enable any disabled buttons and remove working class
        const translateBtn = document.querySelector(".translate-wpm-button");
        const autoTranslateBtn = document.querySelector(".auto-translate-button");
        if (translateBtn) {
          translateBtn.disabled = false;
          translateBtn.classList.remove('working');
        }
        if (autoTranslateBtn) {
          autoTranslateBtn.disabled = false;
          autoTranslateBtn.classList.remove('working');
        }

        console.log("Translation stopped by user - immediate abort");
      });
      targetElement.appendChild(stopButton);

      console.log("Translation buttons added successfully!");
      return true;
    } else {
      console.log("Target element not found.");
      return false;
    }
  };

  const translateWithAI = async (autoTranslate) => {
    // Reset stop flag at the start of new translation
    stopTranslation = false;

    // Check if API key is configured
    if (!apiKey) {
      alert("Please configure your OpenRouter API key in the extension popup first.");
      return;
    }

    // Capture the original text and target language
    const iframe = findEditorIframe();
    let originalText = "";
    if (iframe && iframe.contentDocument) {
      const targetElement = iframe.contentDocument.querySelector("#tinymce");
      if (targetElement) {
        originalText = targetElement.innerHTML; // Capture the inner HTML
      }
    }

    const translationSpans = document.querySelectorAll(".translation div span");
    const translateBtn = document.querySelector(".translate-wpm-button");
    const autoTranslateBtn = document.querySelector(".auto-translate-button");

    if (originalText && translationSpans && translationSpans.length > 1) {
      const targetLanguage = translationSpans[1].textContent;

      // Disable both buttons during translation
      if (translateBtn) {
        translateBtn.disabled = true;
        if (!autoTranslate) translateBtn.classList.add('working');
      }
      if (autoTranslateBtn) {
        autoTranslateBtn.disabled = true;
        if (autoTranslate) autoTranslateBtn.classList.add('working');
      }

      await sendTranslation(originalText, targetLanguage, autoTranslate);
    } else {
      console.log("Required elements not found for translation.");
      alert("Could not find text to translate. Please make sure you're on a WPML translation page.");
    }
  };

  const sendTranslation = async (originalText, targetLanguage, autoTranslate) => {
    // Create a new AbortController for this request
    currentAbortController = new AbortController();

    const translateBtn = document.querySelector(".translate-wpm-button");
    const autoTranslateBtn = document.querySelector(".auto-translate-button");

    try {
      // Early check for stop flag
      if (stopTranslation) {
        console.log("[AI Translate] Stopped before API call.");
        return;
      }

      const requestBody = {
        model: selectedModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Translate the following text to ${targetLanguage}:\n\n${originalText}` }
        ],
        max_tokens: 4000
      };

      console.log("[AI Translate] Sending request:", {
        model: selectedModel,
        targetLanguage,
        textLength: originalText.length,
        textPreview: originalText.substring(0, 100),
        url: "https://openrouter.ai/api/v1/chat/completions",
        hasApiKey: !!apiKey,
        apiKeyPrefix: apiKey ? apiKey.substring(0, 8) + "..." : "MISSING"
      });
      console.log("[AI Translate] Full request body:", JSON.stringify(requestBody));

      const fetchStart = Date.now();
      console.log("[AI Translate] Fetch started at", new Date().toISOString());

      // Heartbeat: log every 5s so you can see it's still waiting
      const heartbeatInterval = setInterval(() => {
        console.log(`[AI Translate] Still waiting for response... ${Math.round((Date.now() - fetchStart) / 1000)}s elapsed`);
      }, 5000);

      // Timeout after 60 seconds
      const timeoutId = setTimeout(() => {
        console.error("[AI Translate] Request TIMED OUT after 60 seconds! Aborting.");
        currentAbortController.abort();
      }, 60000);

      let response;
      try {
        response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "HTTP-Referer": "https://wpml.org",
            "X-Title": "WPML AI Translation"
          },
          body: JSON.stringify(requestBody),
          signal: currentAbortController.signal
        });
      } finally {
        clearInterval(heartbeatInterval);
        clearTimeout(timeoutId);
      }

      console.log("[AI Translate] Response received in", Date.now() - fetchStart, "ms");
      console.log("[AI Translate] Response status:", response.status, response.statusText);
      console.log("[AI Translate] Response headers:", {
        contentType: response.headers.get("content-type"),
        xRequestId: response.headers.get("x-request-id"),
        xRatelimitRequests: response.headers.get("x-ratelimit-limit-requests"),
        xRatelimitRemaining: response.headers.get("x-ratelimit-remaining-requests"),
      });

      // Check for stop flag after receiving response
      if (stopTranslation) {
        console.log("[AI Translate] Stopped after receiving response.");
        return;
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        console.error("[AI Translate] Error response body:", errorText);
        let errorMsg = "Unknown error";
        try { errorMsg = JSON.parse(errorText)?.error?.message || errorText; } catch {}
        throw new Error(`API responded with status code ${response.status}: ${errorMsg}`);
      }

      console.log("[AI Translate] Parsing response JSON...");
      const data = await response.json();
      console.log("[AI Translate] OpenRouter raw response:", JSON.stringify(data).substring(0, 500));

      // Check for stop flag again after parsing response
      if (stopTranslation) {
        console.log("[AI Translate] Stopped after parsing response.");
        return;
      }

      // Parse the chat completions response
      const translation = data?.choices?.[0]?.message?.content?.trim() ?? "";
      console.log("[AI Translate] Extracted translation:", translation ? translation.substring(0, 150) + (translation.length > 150 ? "..." : "") : "(empty)");
      console.log("[AI Translate] Finish reason:", data?.choices?.[0]?.finish_reason);
      console.log("[AI Translate] Usage:", data?.usage);

      if (translation) {
        // Final check before applying translation
        if (stopTranslation) {
          console.log("[AI Translate] Stopped before applying result.");
          return;
        }

        const iframe = findEditorIframe();
        if (iframe && iframe.contentDocument) {
          const targetElement = iframe.contentDocument.querySelector("#tinymce");
          if (targetElement) {
            // Guard: verify the iframe still shows what we were translating
            const currentContent = targetElement.innerHTML;
            if (currentContent !== originalText) {
              console.warn("[AI Translate] Iframe content changed during API call — re-translating current content instead of skipping.");
              await sendTranslation(currentContent, targetLanguage, autoTranslate);
              return;
            }

            console.log("[AI Translate] Applying translation to iframe...");
            targetElement.innerHTML = translation;

            // Trigger change event to notify WPML
            const event = new Event('input', { bubbles: true });
            targetElement.dispatchEvent(event);
            console.log("[AI Translate] Translation applied and input event dispatched.");
          } else {
            console.error("[AI Translate] Target element (#tinymce) not found inside iframe.");
          }
        } else {
          console.error("[AI Translate] Iframe (.mce-panel iframe) not found.");
        }

        // If autoTranslate is true, proceed with the automation
        if (autoTranslate && !stopTranslation) {
          automationProcess();
        }
      } else {
        console.error("[AI Translate] Empty translation received. Full response:", JSON.stringify(data));
        throw new Error("No translation received from API");
      }
    } catch (error) {
      // Handle AbortError specifically
      if (error.name === 'AbortError') {
        console.log("[AI Translate] Request was aborted by user");
        return;
      }

      console.error("[AI Translate] Error with OpenRouter API:", error.name, error.message, error);
      alert(`Translation failed: ${error.message}`);
    } finally {
      // Re-enable both buttons and remove working class
      if (translateBtn) {
        translateBtn.disabled = false;
        translateBtn.classList.remove('working');
      }
      if (autoTranslateBtn) {
        autoTranslateBtn.disabled = false;
        autoTranslateBtn.classList.remove('working');
      }
      currentAbortController = null; // Clear the controller
      // Note: Don't reset stopTranslation here to preserve user intent
    }
  };

  const waitForElement = (selector, timeout = 5000) => {
    return new Promise((resolve) => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  };

  const automationProcess = async () => {
    if (stopTranslation) {
      console.log("Automation stopped.");
      return;
    }

    const saveButton = await waitForElement(".save-sentence-btn");
    if (saveButton) {
      saveButton.click();
      console.log("Save button clicked, waiting for next translation...");

      setTimeout(() => {
        if (stopTranslation) return;

        const addTranslationElement = document.querySelector(".add-translation");
        if (addTranslationElement) {
          console.log("Continuing auto translation...");
          document.querySelector(".auto-translate-button").click();
        } else {
          console.log("No more translations found, auto-translate completed.");
        }
      }, 1000);
    } else {
      console.log("Save button not found after waiting, stopping auto-translate.");
    }
  };

  // Observer to add buttons when the target element is available
  const observer = new MutationObserver((mutations, obs) => {
    if (tryToAddButtons()) {
      obs.disconnect();
    }
  });

  // Initial attempt to add buttons
  if (!tryToAddButtons()) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
