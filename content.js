(function () {
  let openAIKey = "";
  let selectedModel = "gpt-5-mini"; // Default fallback
  let systemPrompt = ""; // Will be loaded from storage
  
  // Default system prompt (only used if nothing is saved)
  const DEFAULT_SYSTEM_PROMPT = `You are a translation tool. Follow these rules strictly:

1. ONLY translate text from the source language to the target language
2. NEVER add explanations, definitions, etymology, or commentary
3. Return ONLY the translated text - nothing more
4. Keep these AS-IS without translation:
   - Brand names (Nike, JETSET, McDonald's, etc.)
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
      const result = await chrome.storage.sync.get(['apiKey', 'selectedModel', 'systemPrompt']);
      openAIKey = result.apiKey || "";
  selectedModel = result.selectedModel || "gpt-5-mini";
      systemPrompt = result.systemPrompt || DEFAULT_SYSTEM_PROMPT;
      
      console.log('Settings loaded:', { 
        hasApiKey: !!openAIKey, 
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
      if (changes.apiKey) {
        openAIKey = changes.apiKey.newValue || "";
      }
      if (changes.selectedModel) {
        selectedModel = changes.selectedModel.newValue || "gpt-5-mini";
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
        
        // Re-enable any disabled buttons
        const translateBtn = document.querySelector(".translate-wpm-button");
        const autoTranslateBtn = document.querySelector(".auto-translate-button");
        if (translateBtn) translateBtn.disabled = false;
        if (autoTranslateBtn) autoTranslateBtn.disabled = false;
        
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
    const button = autoTranslate ? document.querySelector(".auto-translate-button") : document.querySelector(".translate-wpm-button");

    if (originalText && translationSpans && translationSpans.length > 1) {
      const targetLanguage = translationSpans[1].textContent;
      button.disabled = true; // Disable the button
      await sendToOpenAI(originalText, targetLanguage, button, autoTranslate);
    } else {
      console.log("Required elements not found for translation.");
      alert("Could not find text to translate. Please make sure you're on a WPML translation page.");
    }
  };

  const sendToOpenAI = async (originalText, targetLanguage, button, autoTranslate) => {
    // Create a new AbortController for this request
    currentAbortController = new AbortController();

    try {
      // Early check for stop flag
      if (stopTranslation) {
        console.log("Translation stopped before API call.");
        return;
      }

      // Use the latest OpenAI Responses API endpoint
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openAIKey}`,
        },
        body: JSON.stringify({
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
        }),
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

      // Check for stop flag again after parsing response
      if (stopTranslation) {
        console.log("Translation stopped after parsing response.");
        return;
      }
      // Parse the OpenAI Responses payload
      let translation = "";

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
      
      console.error("Error with OpenAI API:", error);
      alert(`Translation failed: ${error.message}`);
    } finally {
      button.disabled = false; // Re-enable the button
      currentAbortController = null; // Clear the controller
      // Note: Don't reset stopTranslation here to preserve user intent
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
      }, 1000); // Wait for 1 second
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
