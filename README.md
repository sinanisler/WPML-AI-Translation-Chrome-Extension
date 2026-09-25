# WPML AI Translation Chrome Extension

**If you saved time and money with this project. Support it 😉**

<a href="https://github.com/sponsors/sinanisler">
<img src="https://img.shields.io/badge/Consider_Supporting_My_Projects_❤-GitHub-d46" width="330" height="auto" />
</a>
<br><br>

<a href="https://www.youtube.com/watch?v=PTTz4GTiCUI">
<img width="981" height="546" alt="image" src="https://github.com/user-attachments/assets/ac15c10f-85d4-498d-8d48-f4683bde6881" />
</a>


A Chrome extension that adds AI-powered translation to the WPML Advanced Translation Editor (ATE), using any model available on OpenRouter.

<img width="610" height="318" alt="image" src="https://github.com/user-attachments/assets/457adcde-cd1a-48d9-8797-cfce38472703" />


<img width="1896" height="1028" alt="image" src="https://github.com/user-attachments/assets/48ad29de-38f6-4a37-a7c8-ae159ff9646c" />




## What's new in 2.0

WPML retired the old translation editor. Version 2.0 is rebuilt for the new editor and is much faster:

- **Works with the new WPML editor**: the toolbar sits right under the *Original / Translation* language header.
- **⚡ Fast Translate (API)**: translates and saves the whole job directly through the editor's backend. No clicking through segments, and the editor reloads with everything filled in.
- **Batch translation**: segments are sent to the AI in batches (about 30 per request, 3 requests in parallel) instead of one request per segment.
- **Page-aware translations**: the AI gets the page title, each segment's element type (heading, rich text…) and the surrounding text, so terminology stays consistent across the page.
- **Code-safe**: HTML tags, attributes (class, id, href…), `{{variables}}`, `%s` placeholders, `[shortcodes]`, URLs and emails are locked before translation and restored exactly afterwards. A translation that damages them is rejected and retried. Values WPML flags as code (CSS keywords, numbers…) are skipped.
- **Improved default prompt**: short labels and headings (e.g. "Vorteile:") get translated too, and names and brands stay as they are.
- **Reset prompt button**: one click restores the default system prompt.

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the extension folder
5. The extension icon appears in your Chrome toolbar

## Setup

1. Click the extension icon
2. Enter your OpenRouter API key (get one at [openrouter.ai/keys](https://openrouter.ai/keys)). The model list loads automatically
3. Pick a model
4. (Optional) Adjust the system prompt. The ↺ icon resets it to the default
5. Click **Save All Settings**

Settings apply immediately. There's no need to reload the WPML page.

## Usage

Open any job in the WPML Advanced Translation Editor (`*.ate.wpml.org`). A toolbar appears under the language header:

| Button | What it does |
|---|---|
| **⚡ Fast Translate (API)** | Recommended. Loads all segments, translates them in batches and saves them directly. The editor reloads when done. |
| **Translate All** | Same batch translation, but fills and saves each segment through the editor UI. Slower, but you can watch it work. |
| **Translate Segment** | Translates the currently open segment in place without saving, so you can review it first (press ↓ to save). |
| **Stop** | Cancels running AI requests and stops the loop. |

Segments count as untranslated when they're empty or when their "translation" is still an unchanged copy of the source text. Segments you already translated are never touched.

**Tips**
- Don't edit segments while ⚡ Fast Translate is running. The editor only shows the new translations after it reloads.
- Review the result, then use WPML's **Save and Complete** as usual.
- If a run is stopped or some segments fail, just run it again. Only the remaining segments are sent.

## Models

Any chat model on OpenRouter works: OpenAI, Anthropic Claude, Google Gemini, Meta Llama and many more.
**My recommendation is Gemini 3 Flash. Fast, smart, cheap and great at multiple languages!**

The popup shows each model's context length to help you choose.

## Requirements

- Chrome or another Chromium-based browser
- An OpenRouter account with credits
- Access to the WPML Advanced Translation Editor (`*.ate.wpml.org`)

## Troubleshooting

- **Toolbar not visible**: reload the extension in `chrome://extensions/`, then refresh the editor tab.
- **"status 401 … check your API key"**: the OpenRouter key is wrong or revoked. Update it in the popup.
- **Details**: open DevTools on the editor page. All extension logs start with `[AI Translate]`.
