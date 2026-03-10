(function () {
  let openAIKey = "";
  let selectedModel = "gpt-5-mini"; // Default fallback for OpenAI
  let systemPrompt = ""; // Will be loaded from storage
  let provider = "openai"; // Default provider
  
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
        'openaiApiKey', 
        'openaiSelectedModel', 
        'openrouterApiKey', 
        'openrouterSelectedModel', 
        'systemPrompt', 
        'provider'
      ]);
      
      provider = result.provider || "openai";
      
      // Load API key and model based on provider
      if (provider === 'openai') {
        openAIKey = result.openaiApiKey || "";
        selectedModel = result.openaiSelectedModel || "gpt-5-mini";
      } else {
        openAIKey = result.openrouterApiKey || "";
        selectedModel = result.openrouterSelectedModel || "openai/gpt-5-mini";
      }
      
      systemPrompt = result.systemPrompt || DEFAULT_SYSTEM_PROMPT;
      
      console.log('Settings loaded:', { 
        hasApiKey: !!openAIKey, 
        provider: provider,
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
      // If provider changed, reload all settings
      if (changes.provider) {
        loadSettings();
        return;
      }
      
      // Update OpenAI settings
      if (changes.openaiApiKey && provider === 'openai') {
        openAIKey = changes.openaiApiKey.newValue || "";
      }
      if (changes.openaiSelectedModel && provider === 'openai') {
        selectedModel = changes.openaiSelectedModel.newValue || "gpt-5-mini";
      }
      
      // Update OpenRouter settings
      if (changes.openrouterApiKey && provider === 'openrouter') {
        openAIKey = changes.openrouterApiKey.newValue || "";
      }
      if (changes.openrouterSelectedModel && provider === 'openrouter') {
        selectedModel = changes.openrouterSelectedModel.newValue || "openai/gpt-5-mini";
      }
      
      // Update system prompt
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
    if (!openAIKey) {
      alert("Please configure your OpenAI API key in the extension popup first.");
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
      
      await sendToOpenAI(originalText, targetLanguage, autoTranslate);
    } else {
      console.log("Required elements not found for translation.");
      alert("Could not find text to translate. Please make sure you're on a WPML translation page.");
    }
  };

  const sendToOpenAI = async (originalText, targetLanguage, autoTranslate) => {
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [3000, 6000, 12000]; // Exponential backoff: 3s, 6s, 12s

    const translateBtn = document.querySelector(".translate-wpm-button");
    const autoTranslateBtn = document.querySelector(".auto-translate-button");

    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (stopTranslation) break;

      // Wait before retrying
      if (attempt > 1) {
        const delay = RETRY_DELAYS[attempt - 2];
        console.warn(`Attempt ${attempt - 1} failed: ${lastError?.message}. Retrying in ${delay / 1000}s...`);
        const label = `Retrying ${attempt - 1}/${MAX_RETRIES - 1}...`;
        if (autoTranslate && autoTranslateBtn) autoTranslateBtn.textContent = label;
        if (!autoTranslate && translateBtn) translateBtn.textContent = label;
        await new Promise(resolve => setTimeout(resolve, delay));
        if (stopTranslation) break;
      }

      currentAbortController = new AbortController();

      try {
        if (stopTranslation) break;

        // Determine API endpoint and request body based on provider
        let apiUrl, requestBody;

        if (provider === 'openai') {
          apiUrl = "https://api.openai.com/v1/responses";
          requestBody = {
            model: selectedModel,
            instructions: systemPrompt,
            input: [
              {
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: `Translate the following text to ${targetLanguage}:\n\n${originalText}`
                  }
                ]
              }
            ],
            max_output_tokens: 4000
          };
        } else {
          // OpenRouter uses the standard chat completions API
          apiUrl = "https://openrouter.ai/api/v1/chat/completions";
          requestBody = {
            model: selectedModel,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `Translate the following text to ${targetLanguage}:\n\n${originalText}` }
            ],
            max_tokens: 4000
          };
        }

        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openAIKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: currentAbortController.signal
        });

        if (stopTranslation) break;

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const err = new Error(`API error ${response.status}: ${errorData.error?.message || 'Unknown error'}`);
          // Don't retry auth/permission errors
          if (response.status === 401 || response.status === 403) {
            lastError = err;
            break;
          }
          throw err;
        }

        const data = await response.json();

        if (stopTranslation) break;

        let translation = "";

        if (provider === 'openai') {
          // Parse OpenAI Responses API format
          if (data && typeof data.output_text === "string" && data.output_text.trim().length > 0) {
            translation = data.output_text.trim();
          }
          if (!translation && Array.isArray(data?.output)) {
            for (const item of data.output) {
              if (item?.type === "message" && Array.isArray(item.content)) {
                const textChunk = item.content.find(chunk => chunk?.type === "output_text" || chunk?.type === "text");
                if (textChunk?.text) {
                  translation = textChunk.text.trim();
                  break;
                }
              }
            }
          }
        } else {
          // Parse OpenRouter / chat completions format
          translation = data?.choices?.[0]?.message?.content?.trim() || "";
        }

        if (!translation) {
          throw new Error("No translation received from API");
        }

        // Success — apply the translation
        console.log("Translation completed:", translation.substring(0, 100) + "...");

        if (stopTranslation) break;

        const iframe = document.querySelector(".mce-panel iframe");
        if (iframe && iframe.contentDocument) {
          const targetElement = iframe.contentDocument.querySelector("#tinymce");
          if (targetElement) {
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

        lastError = null; // Clear error — this attempt succeeded
        break; // Exit retry loop

      } catch (error) {
        if (error.name === 'AbortError') {
          console.log("Translation request was aborted by user");
          lastError = null;
          break;
        }
        lastError = error;
        console.warn(`Attempt ${attempt}/${MAX_RETRIES} failed:`, error.message);
      } finally {
        currentAbortController = null;
      }
    }

    // Restore button states and text
    if (translateBtn) {
      translateBtn.disabled = false;
      translateBtn.classList.remove('working');
      translateBtn.textContent = "AI Translate";
    }
    if (autoTranslateBtn) {
      autoTranslateBtn.disabled = false;
      autoTranslateBtn.classList.remove('working');
      autoTranslateBtn.textContent = "AI Translate All";
    }

    if (stopTranslation) return;

    if (lastError) {
      console.error(`All ${MAX_RETRIES} attempts failed. Last error:`, lastError.message);
      if (autoTranslate) {
        // Skip this item and keep going instead of stopping everything
        console.warn("Skipping current item and continuing auto-translate...");
        automationProcess();
      } else {
        alert(`Translation failed after ${MAX_RETRIES} attempts: ${lastError.message}`);
      }
    } else if (autoTranslate) {
      automationProcess();
    }
  };

  const automationProcess = () => {
    if (stopTranslation) {
      console.log("Automation stopped.");
      return;
    }

    const saveButton = document.querySelector(".save-sentence-btn");
    if (saveButton) {
      saveButton.click(); // Click the save button
      console.log("Save button clicked, waiting for next translation...");
      
      setTimeout(() => {
        if (stopTranslation) return;
        
        const addTranslationElement = document.querySelector(".add-translation");
        if (addTranslationElement) {
          console.log("Continuing auto translation...");
          document.querySelector(".auto-translate-button").click(); // Click Auto Translate again
        } else {
          console.log("No more translations found, auto-translate completed.");
        }
      }, 900); // Wait for a second
    } else {
      console.log("Save button not found, stopping auto-translate.");
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
