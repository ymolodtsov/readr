# Readr

A Chrome extension that provides a clean, opinionated reader view with automatic dark mode support.

## Overview

Readr uses Mozilla's Readability library to extract article content from web pages and presents it in a clean, distraction-free format.

## Architecture

- **manifest.json** - Chrome extension manifest (v3)
- **src/background.js** - Service worker that handles extension icon clicks and script injection
- **src/readability.js** - Mozilla Readability library for article extraction
- **src/content.js** - Main content script that activates reader mode
- **reader.html** - Template for the reader view (not actively used - styles are inline)

## How It Works

1. User clicks extension icon
2. background.js checks if reader mode is already active
3. If not active, injects readability.js then content.js
4. content.js clones the document, parses it with Readability
5. The page is replaced with a clean reader view containing inline styles

## Key Features

- Automatic dark mode via `prefers-color-scheme`
- Hero image detection and display
- Byline cleaning (removes concatenated dates/metadata)
- Lead image detection (avoids duplicating images already in content)
- Escape key and close button to exit reader mode
- Responsive design for various screen sizes

## Development

Load as unpacked extension in Chrome:
1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select this directory

## Optional: Restorable Overlay Approach

The current implementation replaces page content entirely (`document.write`), requiring a page reload to exit reader mode.

A "restorable" overlay approach was explored where the original page is preserved behind a fixed overlay, allowing instant exit without reload. However, this causes a visible scroll jump when engaging reader mode.



1. **Reorder operations + scrollbar compensation** - Add overlay before applying scroll lock, plus `width: 100%` and `paddingRight` on body to compensate for scrollbar disappearing. Result: Broke list bullet point styling in reader view.

2. **Reorder operations only** - Add overlay before scroll lock, keeping original CSS (`left`/`right` instead of `width`/`paddingRight`). Result: Did not fix the scroll jump.

The `position: fixed` with negative `top` approach causes a visible flash regardless of operation order. May revisit with a different scroll-lock technique in the future.


Do not try to go this route again unless the user specifically requests it. 