# Readr

A Chrome extension that transforms cluttered web articles into a clean, distraction-free reading experience. When activated, it uses Mozilla's Readability library to extract the main article content, then displays it in an elegant card-based layout with automatic dark mode support. The extension intelligently finds hero images, cleans up messy bylines that contain concatenated dates or metadata, and removes trailing junk like empty list items, orphaned headings, and promotional sections. Users can exit reader mode with the Escape key or close button. The minimal, Safari-inspired design focuses on typography and readability, with responsive layouts for all screen sizes. Supports all Chromium-based browsers, including Dia, Arc, Atlas, Brave, and Edge. 

<img width="3616" height="2986" alt="CleanShot 2026-02-02 at 20 29 39@2x" src="https://github.com/user-attachments/assets/cf77b14a-894a-4feb-b39f-ed214025ee3d" />

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
