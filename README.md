# WPML AI Translation Chrome Extension

A Chrome extension that adds AI-powered translation capabilities to WPML (WordPress Multilingual Plugin) translation pages using OpenAI or OpenRouter APIs.

<img width="568" height="363" alt="image" src="https://github.com/user-attachments/assets/80c6197d-460c-4cfc-a761-a5281dc7dca4" />


<img width="1896" height="1028" alt="image" src="https://github.com/user-attachments/assets/48ad29de-38f6-4a37-a7c8-ae159ff9646c" />





## Features

### 🚀 Latest Features (v1.2)

#### Dual Provider Support
- **OpenAI Integration**: Direct access to OpenAI's GPT models
- **OpenRouter Integration**: Access to multiple AI providers through OpenRouter
- **Seamless Switching**: Easily switch between providers with separate API key storage
- **Provider-Specific Models**: Automatically loads available models based on selected provider

#### Advanced Translation Control
- **Dynamic Model Loading**: Automatically fetches available models from your API provider
- **Custom System Prompts**: Full control over translation behavior with editable prompts
- **Intelligent Translation Rules**: Built-in rules to preserve brand names, HTML tags, and proper nouns
- **Real-time Settings Sync**: Changes apply instantly without page refresh

#### User Interface
- **Modern Popup Design**: Clean, intuitive interface with proper form validation
- **API Key Status Indicator**: Visual confirmation when API keys are saved
- **Model Information Display**: Shows model details like context length and ownership
- **Provider Selection**: Easy toggle between OpenAI and OpenRouter

#### Core Translation Features
- **AI Translate**: Translate individual text segments with one click
- **AI Translate All**: Automatically translate and save multiple segments in sequence
- **Stop Functionality**: Immediate abort of ongoing translations with proper cleanup
- **Visual Feedback**: Animated buttons show translation progress
- **Error Handling**: Clear error messages and validation throughout

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension folder
5. The extension icon will appear in your Chrome toolbar

## Setup

### Quick Start

1. Click the extension icon in your Chrome toolbar
2. Choose your preferred provider (OpenAI or OpenRouter)
3. Enter your API key:
   - **OpenAI**: Get from [platform.openai.com](https://platform.openai.com/api-keys)
   - **OpenRouter**: Get from [openrouter.ai/keys](https://openrouter.ai/keys)
4. The model list will load automatically
5. Select your preferred AI model from the dropdown
6. (Optional) Customize the system prompt to control translation behavior
7. Click "Save All Settings"

### System Prompt Configuration

The extension includes a sophisticated default system prompt that:
- Ensures clean, translation-only output
- Preserves brand names, proper nouns, and technical terms
- Maintains HTML structure and formatting
- Avoids adding unnecessary explanations or commentary

You can customize this prompt in the settings to match your specific translation needs.

## Usage

### On WPML Translation Pages

1. Navigate to any WPML translation page (`*.ate.wpml.org/dashboard*`)
2. The extension automatically adds three buttons to the interface:

   - **AI Translate**: Translate the current text segment
   - **AI Translate All**: Automatically translate all remaining segments sequentially
   - **Stop**: Immediately stop the auto-translation process

### Translation Workflow

**Single Translation:**
1. Review the source text
2. Click "AI Translate"
3. The translated text appears in the editor
4. Review and save manually

**Batch Translation:**
1. Click "AI Translate All"
2. Watch as segments are translated and saved automatically
3. Click "Stop" at any time to pause the process
4. Translation stops immediately with proper cleanup

## Supported Models

### OpenAI Models
The extension automatically loads all available models from your OpenAI account:
- **GPT-4 Series**: Latest models (gpt-4, gpt-4-turbo, etc.) - recommended for highest quality
- **GPT-3.5 Series**: Faster and more cost-effective options
- **Other Models**: Any compatible text generation models in your account

### OpenRouter Models
Access to a wide variety of models from multiple providers:
- OpenAI models (GPT-4, GPT-3.5, etc.)
- Anthropic Claude models
- Google models
- Meta Llama models
- And many more providers

The extension displays model context length and other relevant information to help you choose.

## Requirements

- **Browser**: Chrome or Chromium-based browser
- **API Access**: Valid API key from either:
  - OpenAI account with available credits
  - OpenRouter account with available credits
- **Website**: Access to WPML translation pages (`*.ate.wpml.org/dashboard*`)

## Settings Storage

All settings are securely stored using Chrome's sync storage:
- **OpenAI API Key** (encrypted by Chrome)
- **OpenRouter API Key** (encrypted by Chrome)
- **Selected Models** (separate for each provider)
- **Custom System Prompt**
- **Provider Selection**

Settings automatically sync across your Chrome instances when signed into Chrome.

## Troubleshooting

### Common Issues

1. **"Please configure your API key"**
   - Open the extension popup
   - Select your provider (OpenAI or OpenRouter)
   - Enter a valid API key
   - Click "Save All Settings"

2. **"Error loading models"**
   - Verify your API key is correct and active
   - Check that your account has sufficient credits
   - Ensure stable internet connectivity
   - For OpenRouter: Make sure you've added credits to your account

3. **Translation buttons not appearing**
   - Confirm you're on a WPML translation page (`*.ate.wpml.org/dashboard*`)
   - Refresh the page (F5)
   - Wait a few seconds for the page to fully load
   - Check browser console (F12) for any errors

4. **Translation fails or returns errors**
   - **API Credits**: Verify your account has available credits
   - **Rate Limits**: You may be hitting API rate limits
   - **Model Access**: Ensure the selected model is available for your account tier
   - **Network**: Check for firewall or proxy issues blocking API requests

5. **Settings not saving**
   - Make sure to click "Save All Settings" button
   - Check that you've selected a model from the dropdown
   - Verify the system prompt is not empty

6. **Stop button not working**
   - The extension uses immediate abort functionality
   - Current request stops within milliseconds
   - If auto-translate continues, refresh the page

### Debug Information

1. Open browser Developer Tools (F12)
2. Go to Console tab
3. Look for messages starting with:
   - "Settings loaded:" - Shows loaded configuration
   - "Translation stopped" - Confirms stop action
   - "Error with OpenAI API:" - Shows API errors
4. Check Network tab for failed API requests

### API Key Validation

- **OpenAI keys** start with `sk-` or `sk-proj-`
- **OpenRouter keys** start with `sk-or-v1-`
- Keys are stored securely and encrypted by Chrome
- Each provider stores its key separately

## Development

### File Structure
```
├── manifest.json          # Extension configuration (Manifest V3)
├── popup.html             # Extension popup interface
├── popup.js              # Popup functionality, settings, and API integration
├── content.js            # Main translation logic and WPML page integration
├── background.js         # Background service worker (minimal)
├── style.css             # Button styling and animations
├── icon16.png           # Extension icon (16x16)
├── icon48.png           # Extension icon (48x48)
├── icon128.png          # Extension icon (128x128)
├── license.txt          # License information
└── README.md            # Documentation
```

### Key Technical Features

#### Provider Architecture
- **Dual Provider Support**: Separate storage for OpenAI and OpenRouter credentials
- **Dynamic API Endpoints**: Automatically switches between provider endpoints
- **Model Loading**: Provider-specific model fetching and formatting

#### Translation Engine
- **AbortController**: Immediate cancellation of in-flight API requests
- **Real-time Sync**: Chrome storage listeners for instant settings updates
- **Error Recovery**: Comprehensive try-catch blocks with user feedback
- **State Management**: Proper cleanup on stop/abort actions

#### UI/UX Features
- **Modern CSS**: Grid and Flexbox layouts with smooth transitions
- **Visual Feedback**: Animated buttons with loading states (⚡ icon rotation)
- **Form Validation**: Input validation before API calls
- **Accessibility**: Proper ARIA labels and keyboard navigation
- **Responsive Design**: Mobile-friendly popup interface

#### Security
- **Chrome Storage Sync**: Encrypted API key storage
- **Input Sanitization**: Proper validation of user inputs
- **HTTPS Only**: All API calls use secure connections
- **No Data Collection**: Extension doesn't collect or transmit user data

### Extension Permissions

```json
"permissions": [
  "activeTab",    // Access to current WPML translation page
  "storage"       // Store settings and API keys
]
```

### Content Script Injection

The extension only runs on WPML translation pages:
```javascript
"matches": ["*://*.ate.wpml.org/dashboard*"]
```

This ensures the extension only activates when needed, minimizing resource usage.

## License

See `license.txt` for license information.

## Support

- ❤ [Support this project on GitHub Sponsors](https://github.com/sponsors/sinanisler)
- 🐛 [Report bugs or request features](https://github.com/sinanisler/WPML-AI-Translation-Chrome-Extension/issues)
- ⭐ Star this repository if you find it helpful!

## Changelog

### v1.2 (Current)
#### Major Features
- ✨ **Dual Provider Support**: Added OpenRouter alongside OpenAI
- 🔄 **Provider Switching**: Seamlessly switch between providers with independent settings
- 🎯 **Separate API Key Storage**: Each provider maintains its own API key and model selection
- 🚀 **Dynamic Model Loading**: Fetches available models based on selected provider
- 📊 **Enhanced Model Info**: Displays context length, ownership, and creation dates

#### Improvements
- 🎨 **UI Refinements**: Radio buttons for provider selection
- 🔐 **Better Security**: Provider-specific encrypted key storage
- ⚡ **Performance**: Optimized model loading and caching
- 🛡️ **Error Handling**: Provider-specific error messages
- 📝 **System Prompt**: Updated default prompt with better translation rules

#### Bug Fixes
- Fixed model list not updating when switching providers
- Fixed API key status not reflecting correct provider
- Improved stop button immediate abort functionality

### v1.0
- 🎉 Initial release
- ✅ Basic OpenAI integration
- ✅ Single and auto-translation features
- ✅ Custom system prompts
- ✅ Stop functionality
- ✅ Modern popup UI

## Roadmap

Planned features for future releases:

- [ ] Translation memory/cache to reduce API costs
- [ ] Glossary support for consistent term translation
- [ ] Translation history and undo functionality
- [ ] Batch export/import of translations
- [ ] Custom API endpoint configuration
- [ ] Translation quality scoring
- [ ] Multi-language simultaneous translation
- [ ] Statistics dashboard (costs, usage, etc.)

## Contributing

Contributions are welcome! Please feel free to:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Credits

Developed by [Sinan Isler](https://github.com/sinanisler)

Built with:
- Chrome Extension Manifest V3
- OpenAI API
- OpenRouter API
- Modern JavaScript (ES6+)
- Chrome Storage API

---

**Note**: This extension requires valid API keys and active credits from OpenAI and/or OpenRouter. API usage costs are determined by your provider's pricing structure.
