# WPML AI Translation Chrome Extension

A Chrome extension that adds AI-powered translation capabilities to WPML (WordPress Multilingual Plugin) translation pages using OpenAI's API.

<img width="568" height="363" alt="image" src="https://github.com/user-attachments/assets/80c6197d-460c-4cfc-a761-a5281dc7dca4" />


<img width="1896" height="1028" alt="image" src="https://github.com/user-attachments/assets/48ad29de-38f6-4a37-a7c8-ae159ff9646c" />





## Features

### 🚀 Recent Improvements (v2.0)

- **Dynamic Model Support**: Automatically loads available OpenAI models from your API key
- **Improved Popup UI**: Clean, modern interface with better UX
- **Custom System Prompts**: Editable system prompts for better translation control
- **Real-time Settings**: Settings sync instantly without page refresh
- **Better Error Handling**: Clear error messages and validation
- **API Key Status**: Visual indicator showing if API key is saved
- **Model Information**: Display model owner and creation date

### Core Features

- **Single Translation**: Translate individual text segments
- **Auto Translation**: Automatically translate and save multiple segments
- **Stop Functionality**: Ability to stop auto-translation at any time
- **Real-time Updates**: Settings changes apply immediately

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension folder
5. The extension icon will appear in your Chrome toolbar

## Setup

1. Click the extension icon in your Chrome toolbar
2. Enter your OpenAI API key (starts with `sk-`)
3. Select your preferred AI model from the dropdown
4. Customize the system prompt if desired (optional)
5. Click "Save Settings"

## Usage

1. Navigate to a WPML translation page
2. The extension will automatically add three buttons:
   - **Translate with AI**: Translate the current text segment
   - **Auto Translate**: Automatically translate all remaining segments
   - **Stop**: Stop the auto-translation process

### System Prompt

The default system prompt is:
```
Translate the following text into the desired language. If the text is already in the desired language or too short, return it exactly as-is, without any changes or annotations. Maintain any syntax or HTML tags. Never add language names, comments, or suggestions.
```

You can customize this prompt in the extension popup to better suit your translation needs.

## Supported Models

The extension automatically loads all available models from your OpenAI account, including:
- GPT-4 models (recommended for best quality)
- GPT-3.5 models
- Other compatible text generation models

## Requirements

- Chrome browser
- Valid OpenAI API key
- Access to WPML translation pages

## Settings Storage

All settings are stored locally in Chrome's sync storage:
- API Key (encrypted by Chrome)
- Selected Model
- Custom System Prompt

Settings sync across your Chrome instances if you're signed into Chrome.

## Troubleshooting

### Common Issues

1. **"Please configure your OpenAI API key"**
   - Open the extension popup and enter a valid API key

2. **"Error loading models"**
   - Check that your API key is valid and has sufficient credits
   - Ensure you have internet connectivity

3. **Translation buttons not appearing**
   - Make sure you're on a WPML translation page
   - Refresh the page and wait a few seconds

4. **Translation fails**
   - Check your OpenAI account credits and usage limits
   - Verify the selected model is available for your account

### Debug Information

Check the browser console (F12) for detailed error messages and logs.

## Development

### File Structure
```
├── manifest.json          # Extension configuration
├── popup.html             # Extension popup interface
├── popup.js              # Popup functionality and settings
├── content.js            # Main translation logic
├── background.js         # Background service worker
├── style.css             # Button and UI styling
└── README.md            # This file
```

### Key Features in Code

- **Dynamic Model Loading**: Fetches models from OpenAI API
- **Real-time Settings Sync**: Uses Chrome storage change listeners
- **Improved Error Handling**: Comprehensive try-catch blocks
- **Modern UI**: CSS Grid and Flexbox layouts
- **Accessibility**: Proper ARIA labels and focus management

## License

See `license.txt` for license information.

## Changelog

### v2.0 (Latest)
- Complete UI overhaul with modern design
- Dynamic OpenAI model loading
- Editable system prompts
- Real-time settings synchronization
- Improved error handling and user feedback
- Better button styling and animations
- API key status indicator

### v1.0
- Basic translation functionality
- Static model selection (gpt-4o)
- Simple popup interface
- Auto-translation feature
