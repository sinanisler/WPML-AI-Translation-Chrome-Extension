(function () {
  let openAIKey = "";
  let selectedModel = "gpt-4o"; // Default fallback
  let systemPrompt = "Translate the following text into the desired language. If the text is already in the desired language or too short, return it exactly as-is, without any changes or annotations. Maintain any syntax or HTML tags. Never add language names, comments, or suggestions.";
  
  // Load settings from storage
  const loadSettings = async () => {
    try {
      const result = await chrome.storage.sync.get(['apiKey', 'selectedModel', 'systemPrompt']);
      openAIKey = result.apiKey || "";
      selectedModel = result.selectedModel || "gpt-4o";
      systemPrompt = result.systemPrompt || "Translate the following text into the desired language. If the text is already in the desired language or too short, return it exactly as-is, without any changes or annotations. Maintain any syntax or HTML tags. Never add language names, comments, or suggestions.";
      
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
        selectedModel = changes.selectedModel.newValue || "gpt-4o";
      }
      if (changes.systemPrompt) {
        systemPrompt = changes.systemPrompt.newValue || systemPrompt;
      }
    }
  });

  let stopTranslation = false; // Global variable for stopping the translation

  const tryToAddButtons = () => {
    const targetElement = document.querySelector(".otgs-editor-container .nav");
    if (targetElement) {
      // Check if buttons already exist
      if (targetElement.querySelector('.translate-wpm-button')) {
        return true; // Buttons already added
      }

      // Add "Translate with AI" button
      const translateButton = document.createElement("button");
      translateButton.textContent = "Translate with AI";
      translateButton.className = "translate-wpm-button";
      translateButton.addEventListener("click", () => translateWithAI(false));
      targetElement.appendChild(translateButton);

      // Add "Auto Translate" button
      const autoTranslateButton = document.createElement("button");
      autoTranslateButton.textContent = "Auto Translate";
      autoTranslateButton.className = "auto-translate-button";
      autoTranslateButton.addEventListener("click", () => translateWithAI(true));
      targetElement.appendChild(autoTranslateButton);

      // Add "Stop" button
      const stopButton = document.createElement("button");
      stopButton.textContent = "Stop";
      stopButton.className = "stop-translation-button";
      stopButton.addEventListener("click", () => {
        stopTranslation = true; // Set the global variable to stop
        console.log("Translation stopped by user");
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
    // Ensure translation is not already stopped
    if (stopTranslation) {
      console.log("Translation stopped.");
      return;
    }

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
    const prompt = `${originalText} translate to ${targetLanguage}`;

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openAIKey}`,
        },
        body: JSON.stringify({
          model: selectedModel,
          input: prompt,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API responded with status code ${response.status}: ${errorData.error?.message || 'Unknown error'}`);
      }

      const data = await response.json();

      if (stopTranslation) {
        console.log("Translation stopped.");
        return;
      }

      // Parse the new response structure
      if (data && data.output && Array.isArray(data.output)) {
        // Find the message output (usually the last one or type "message")
        const messageOutput = data.output.find(item => item.type === "message") || data.output[data.output.length - 1];
        
        if (messageOutput && messageOutput.content && Array.isArray(messageOutput.content)) {
          const textContent = messageOutput.content.find(item => item.type === "output_text");
          
          if (textContent && textContent.text) {
            const translation = textContent.text.trim();
            console.log("Translation completed:", translation.substring(0, 100) + "...");

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
            if (autoTranslate) {
              automationProcess();
            }
          } else {
            throw new Error("No text content found in response");
          }
        } else {
          throw new Error("No message content found in response");
        }
      } else {
        throw new Error("Invalid or unexpected response structure from API");
      }
    } catch (error) {
      console.error("Error with OpenAI API:", error);
      alert(`Translation failed: ${error.message}`);
    } finally {
      button.disabled = false; // Re-enable the button
      stopTranslation = false; // Reset the stop flag
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
