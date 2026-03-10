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
    const iframe = document.querySelector(".mce-panel iframe");
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
        console.log("Translation stopped before API call.");
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

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer": "https://wpml.org",
          "X-Title": "WPML AI Translation"
        },
        body: JSON.stringify(requestBody),
        signal: currentAbortController.signal // Add abort signal
      });

      // Check for stop flag after receiving response
      if (stopTranslation) {
        console.log("Translation stopped after receiving response.");
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API responded with status code ${response.status}: ${errorData.error?.message || 'Unknown error'}`);
      }

      const data = await response.json();
      console.log("OpenRouter raw response:", JSON.stringify(data).substring(0, 300));

      // Check for stop flag again after parsing response
      if (stopTranslation) {
        console.log("Translation stopped after parsing response.");
        return;
      }

      // Parse the chat completions response
      const translation = data?.choices?.[0]?.message?.content?.trim() ?? "";

      if (translation) {
        console.log("Translation completed:", translation.substring(0, 100) + "...");

        // Final check before applying translation
        if (stopTranslation) {
          console.log("Translation stopped before applying result.");
          return;
        }

        const iframe = document.querySelector(".mce-panel iframe");
        if (iframe && iframe.contentDocument) {
          const targetElement = iframe.contentDocument.querySelector("#tinymce");
          if (targetElement) {
            // Guard: verify the iframe still shows what we were translating
            const currentContent = targetElement.innerHTML;
            if (currentContent !== originalText) {
              console.warn("Iframe content changed during API call — re-translating current content instead of skipping.");
              await sendTranslation(currentContent, targetLanguage, autoTranslate);
              return;
            }

            targetElement.innerHTML = translation;

            // Trigger change event to notify WPML
            const event = new Event('input', { bubbles: true });
            targetElement.dispatchEvent(event);
          } else {
            console.error("Target element for translation replacement not found inside the iframe.");
          }
        } else {
          console.error("Iframe not found.");
        }

        // If autoTranslate is true, proceed with the automation
        if (autoTranslate && !stopTranslation) {
          automationProcess();
        }
      } else {
        throw new Error("No translation received from API");
      }
    } catch (error) {
      // Handle AbortError specifically
      if (error.name === 'AbortError') {
        console.log("Translation request was aborted by user");
        return;
      }

      console.error("Error with OpenRouter API:", error);
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
