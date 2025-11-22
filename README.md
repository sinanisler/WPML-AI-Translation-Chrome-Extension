# WPML AI Translation Chrome Extension


**If you saved time and money with this solution support it 😉**

[![Sponsor me](https://img.shields.io/badge/Consider_Supporting_My_Projects_❤-GitHub-d46)](https://github.com/sponsors/sinanisler)



A Chrome extension that adds AI-powered translation capabilities to WPML (WordPress Multilingual Plugin) translation pages using OpenAI or OpenRouter APIs.

<img width="610" height="318" alt="image" src="https://github.com/user-attachments/assets/457adcde-cd1a-48d9-8797-cfce38472703" />


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


- **Modern CSS**: Grid and Flexbox layouts with smooth transitions
- **Visual Feedback**: Animated buttons with loading states (⚡ icon rotation)
- **Form Validation**: Input validation before API calls
- **Accessibility**: Proper ARIA labels and keyboard navigation
- **Responsive Design**: Mobile-friendly popup interface
