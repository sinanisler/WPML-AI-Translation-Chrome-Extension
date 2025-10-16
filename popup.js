// Default system prompt
const DEFAULT_SYSTEM_PROMPT = "Translate the following text into the desired language. If the text is already in the desired language or too short, return it exactly as-is, without any changes or annotations. Maintain any syntax or HTML tags. Never add language names, comments, or suggestions.";

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadSavedSettings();
  setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
  document.getElementById('save-api-key').addEventListener('click', saveApiKey);
  document.getElementById('refresh-models').addEventListener('click', loadModels);
  document.getElementById('save-settings').addEventListener('click', saveSettings);
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
    modelSelect.innerHTML = '<option value="">Enter valid API key first</option>';
  }
}

// Load saved settings
async function loadSavedSettings() {
  try {
    const result = await chrome.storage.sync.get(['apiKey', 'selectedModel', 'systemPrompt']);
    
    // Load API key
    if (result.apiKey) {
      document.getElementById('api-key').value = result.apiKey;
      updateApiKeyStatus(true);
      document.getElementById('refresh-models').disabled = false;
      document.getElementById('model-select').disabled = false;
      await loadModels();
    } else {
      updateApiKeyStatus(false);
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

// Save API key
async function saveApiKey() {
  const apiKey = document.getElementById('api-key').value.trim();
  
  if (!apiKey) {
    showStatus('Please enter an API key', 'error');
    return;
  }
  
  if (!apiKey.startsWith('sk-')) {
    showStatus('Invalid API key format', 'error');
    return;
  }
  
  try {
    await chrome.storage.sync.set({ apiKey });
    updateApiKeyStatus(true);
    showStatus('API key saved successfully!', 'success');
    
    // Enable model loading
    document.getElementById('refresh-models').disabled = false;
    document.getElementById('model-select').disabled = false;
    await loadModels();
    
  } catch (error) {
    console.error('Error saving API key:', error);
    showStatus('Error saving API key', 'error');
  }
}

// Load available models from OpenAI API
async function loadModels() {
  const apiKey = document.getElementById('api-key').value.trim();
  const modelSelect = document.getElementById('model-select');
  const refreshButton = document.getElementById('refresh-models');
  
  if (!apiKey) {
    showStatus('Please enter API key first', 'error');
    return;
  }
  
  // Show loading state
  modelSelect.innerHTML = '<option value="">Loading models...</option>';
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
    
    // Populate select options
    modelSelect.innerHTML = '<option value="">Select a model...</option>';
    
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.id;
      
      // Add additional info as data attributes
      option.dataset.ownedBy = model.owned_by;
      option.dataset.created = model.created;
      
      modelSelect.appendChild(option);
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
    modelSelect.innerHTML = '<option value="">Error loading models</option>';
    showStatus('Error loading models. Check your API key.', 'error');
  } finally {
    refreshButton.disabled = false;
  }
}

// Save all settings
async function saveSettings() {
  const selectedModel = document.getElementById('model-select').value;
  const systemPrompt = document.getElementById('system-prompt').value.trim();
  
  if (!selectedModel) {
    showStatus('Please select a model', 'error');
    return;
  }
  
  if (!systemPrompt) {
    showStatus('Please enter a system prompt', 'error');
    return;
  }
  
  try {
    await chrome.storage.sync.set({
      selectedModel,
      systemPrompt
    });
    
    showStatus('Settings saved successfully!', 'success');
    updateModelInfo(selectedModel);
    
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
  const option = document.querySelector(`option[value="${modelId}"]`);
  
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

// Listen for model selection changes
document.addEventListener('DOMContentLoaded', () => {
  const modelSelect = document.getElementById('model-select');
  if (modelSelect) {
    modelSelect.addEventListener('change', (e) => {
      updateModelInfo(e.target.value);
    });
  }
});
