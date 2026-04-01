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

## Image Container Preprocessing (Experimental)

Added `preprocessImageContainers()` in content.js to fix images being stripped on sites like MacStories.

**Problem**: Readability's negative regex includes "media", so `div.media-wrapper` elements get stripped even when they contain legitimate article images.

**Solution**: Before running Readability, convert divs matching `/media|image-container|img-wrapper|photo-wrapper/i` that contain images into `<figure>` elements. Also strips SVG-only links (like "view full size" icons) from these containers.

**Status**: Under testing. May need to be removed or refined if it causes issues on other sites.

## Substack Image Preprocessing

Added `preprocessSubstackImages()` in content.js to fix images being stripped on Substack.

**Problem**: Substack wraps images in `<a class="image-link image2">` inside `<figure>`. The link contains a `<picture>` element, overlay buttons with SVGs, etc. Readability sees a bad link-to-text ratio and strips the whole link, losing the image.

**Solution**: Before running Readability, find `figure a.image-link.image2` links, extract the `<img>` out, and place it directly in the `<figure>`. The link and its button/SVG junk are removed.

## Hero Image Deduplication Logic

When a hero image is found and also appears in the Readability article content:

- **Early** (within first 3 top-level content elements): Treated as a duplicate — removed from content, hero is kept.
- **Later** (deeper in the article): Treated as an intentional illustration — hero is suppressed, content is left alone.
- **Not found**: Hero is shown as-is.

The `findHeroImageInContent()` function drills past Readability's wrapper divs (`div#readability-page-1 > div > article > div`) to find the actual content container before counting element positions.

## Diagnostics Panel

There is a commented-out diagnostics overlay in content.js (search for `readr-debug`). To enable it:
1. Uncomment the overlay block
2. Add tracking variables before the hero dedup logic: `heroImageCandidate` (set to `heroImage` after `findHeroImage()`), `heroAction` (string), and make `dupPosition` available in the outer scope.

It shows hero image src, contentHasLeadImage, dupPosition, action taken, article metadata, and raw Readability HTML output. Has a copy button for easy sharing.