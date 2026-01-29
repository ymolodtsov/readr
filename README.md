# Readr

A clean, opinionated Reader View Chrome extension with automatic dark mode support. Supports all major Chromium-based browsers, including Dia, Arc, Comet, and Brave. 

![screenl](https://github.com/user-attachments/assets/c94e0ffc-f387-45cf-b969-bd8bf574ec84)

## Features

- **One-click activation** — Click the extension icon to toggle reader mode
- **Clean typography** — System font stack, comfortable line height, optimal reading width
- **Auto dark mode** — Automatically matches your system preference
- **Hero image recovery** — Intelligently finds and displays the article's lead image
- **Minimal UI** — Just the content, no distractions

## Installation

1. Clone this repository or download as ZIP
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked" and select the `readr` folder
5. The Readr icon will appear in your toolbar

## Usage

1. Navigate to any article page
2. Click the Readr icon in your toolbar
3. Press **Escape** or click the **×** button to exit reader mode

## How It Works

Readr uses [Mozilla's Readability](https://github.com/mozilla/readability) algorithm (the same one powering Firefox Reader View) to extract article content. It then presents the content in a clean, card-based layout with:

- Smart hero image detection via `og:image`, common CSS patterns, and size heuristics
- Automatic byline cleanup to remove concatenated metadata
- Full dark mode support via CSS `prefers-color-scheme`

## License

MIT
