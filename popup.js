// Default system prompt
const DEFAULT_SYSTEM_PROMPT = `You are a translation tool. Follow these rules strictly:

1. ONLY translate text from the source language to the target language
2. NEVER add explanations, definitions, etymology, or commentary
3. Return ONLY the translated text - nothing more
4. Keep these AS-IS without translation:
   - Brand names (Nike, Alex, McDonald's, etc.)
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

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadSavedSettings();
  setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
  document.getElementById('refresh-models').addEventListener('click', loadModels);
  document.getElementById('save-settings').addEventListener('click', saveAllSettings);
  document.getElementById('api-key').addEventListener('input', handleApiKeyInput);
}

// Handle API key input changes
function handleApiKeyInput() {
  const apiKey = document.getElementById('api-key').value.trim();
  const refreshButton = document.getElementById('refresh-models');
  const modelSelect = document.getElementById('model-select');
  
  if (apiKey && apiKey.startsWith('sk-')) {
    refreshButton.disabled = false;
    modelSelect.disabled = false;
    loadModels();
  } else {
    refreshButton.disabled = true;
    modelSelect.disabled = true;
    const modelList = document.getElementById('model-list');
    modelList.innerHTML = '<option value="Enter valid API key first"></option>';
  }
}

// Load saved settings
async function loadSavedSettings() {
  try {
    const result = await chrome.storage.sync.get(['apiKey', 'selectedModel', 'systemPrompt']);
    
    // Load API key
    if (result.apiKey) {
      document.getElementById('api-key').value = result.apiKey;
      document.getElementById('refresh-models').disabled = false;
      document.getElementById('model-select').disabled = false;
      // Update status AFTER the DOM is fully ready
      setTimeout(() => updateApiKeyStatus(true), 100);
      await loadModels();
    } else {
      setTimeout(() => updateApiKeyStatus(false), 100);
    }
    
    // Load selected model
    if (result.selectedModel) {
      document.getElementById('model-select').value = result.selectedModel;
    }
    
    // Load system prompt
    const systemPrompt = result.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    document.getElementById('system-prompt').value = systemPrompt;
    
  } catch (error) {
    console.error('Error loading settings:', error);
    showStatus('Error loading settings', 'error');
  }
}

// Load available models from OpenAI API
async function loadModels() {
  const apiKey = document.getElementById('api-key').value.trim();
  const modelSelect = document.getElementById('model-select');
  const modelList = document.getElementById('model-list');
  const refreshButton = document.getElementById('refresh-models');
  
  if (!apiKey) {
    showStatus('Please enter API key first', 'error');
    return;
  }
  
  // Show loading state
  modelList.innerHTML = '<option value="Loading models..."></option>';
  refreshButton.disabled = true;
  
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`API responded with status ${response.status}`);
    }
    
    const data = await response.json();
    
    // Filter and sort models (prioritize GPT models)
    const models = data.data
      .filter(model => model.id.includes('gpt') || model.id.includes('text'))
      .sort((a, b) => {
        // Prioritize newer GPT models
        if (a.id.includes('gpt-4') && !b.id.includes('gpt-4')) return -1;
        if (!a.id.includes('gpt-4') && b.id.includes('gpt-4')) return 1;
        if (a.id.includes('gpt-3.5') && !b.id.includes('gpt-3.5')) return -1;
        if (!a.id.includes('gpt-3.5') && b.id.includes('gpt-3.5')) return 1;
        return a.id.localeCompare(b.id);
      });
    
    // Populate datalist options
    modelList.innerHTML = '';
    
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      
      // Add additional info as data attributes
      option.dataset.ownedBy = model.owned_by;
      option.dataset.created = model.created;
      
      modelList.appendChild(option);
    });
    
    // Restore previously selected model
    const savedSettings = await chrome.storage.sync.get(['selectedModel']);
    if (savedSettings.selectedModel) {
      modelSelect.value = savedSettings.selectedModel;
      updateModelInfo(savedSettings.selectedModel);
    }
    
    showStatus(`Loaded ${models.length} models successfully`, 'success');
    
  } catch (error) {
    console.error('Error loading models:', error);
    modelList.innerHTML = '<option value="Error loading models"></option>';
    showStatus('Error loading models. Check your API key.', 'error');
  } finally {
    refreshButton.disabled = false;
  }
}

// Save all settings (API key, model, and system prompt)
async function saveAllSettings() {
  const apiKey = document.getElementById('api-key').value.trim();
  const selectedModel = document.getElementById('model-select').value.trim();
  const systemPrompt = document.getElementById('system-prompt').value.trim();
  
  // Validate model
  if (!selectedModel) {
    showStatus('Please select a model', 'error');
    return;
  }
  
  // Validate system prompt
  if (!systemPrompt) {
    showStatus('Please enter a system prompt', 'error');
    return;
  }
  
  try {
    await chrome.storage.sync.set({
      apiKey,
      selectedModel,
      systemPrompt
    });
    
    updateApiKeyStatus(true);
    showStatus('All settings saved successfully!', 'success');
    updateModelInfo(selectedModel);
    
    // Enable model controls if not already
    document.getElementById('refresh-models').disabled = false;
    document.getElementById('model-select').disabled = false;
    
  } catch (error) {
    console.error('Error saving settings:', error);
    showStatus('Error saving settings', 'error');
  }
}

// Update API key status indicator
function updateApiKeyStatus(isSaved) {
  const statusElement = document.getElementById('api-key-status');
  if (isSaved) {
    statusElement.textContent = '✓ Saved';
    statusElement.className = 'api-key-status saved';
  } else {
    statusElement.textContent = '✗ Not saved';
    statusElement.className = 'api-key-status not-saved';
  }
}

// Update model info display
function updateModelInfo(modelId) {
  const modelInfoElement = document.getElementById('model-info');
  const option = document.querySelector(`#model-list option[value="${modelId}"]`);
  
  if (option) {
    const ownedBy = option.dataset.ownedBy;
    const created = option.dataset.created;
    const createdDate = created ? new Date(parseInt(created) * 1000).toLocaleDateString() : 'Unknown';
    
    modelInfoElement.textContent = `Owner: ${ownedBy || 'Unknown'} | Created: ${createdDate}`;
  } else {
    modelInfoElement.textContent = '';
  }
}

// Show status message
function showStatus(message, type = 'info') {
  const statusElement = document.getElementById('status');
  statusElement.textContent = message;
  statusElement.className = `status ${type}`;
  statusElement.style.display = 'block';
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    statusElement.style.display = 'none';
  }, 5000);
}

// Listen for model input changes
document.addEventListener('DOMContentLoaded', () => {
  const modelSelect = document.getElementById('model-select');
  if (modelSelect) {
    modelSelect.addEventListener('input', (e) => {
      updateModelInfo(e.target.value);
    });
  }
});
