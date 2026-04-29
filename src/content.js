// Readr - Content Script
// Activates reader mode on the current page

(function () {
  // Prevent running multiple times
  if (document.body.classList.contains("readr-active")) {
    return;
  }

  // Mark that we're in reader mode (for toggle detection)
  sessionStorage.setItem("__readrActive", "true");

  // Detect text direction (RTL vs LTR)
  const docDir = document.documentElement.dir ||
                 document.body.dir ||
                 window.getComputedStyle(document.body).direction ||
                 'ltr';

  // Clone the document for Readability parsing
  const documentClone = document.cloneNode(true);

  // Preprocess: Remove author bios before Readability processes
  // The Verge uses spans with "dangerously-set-cms-markup" class for author bios
  // that start with "is a [job title]..." - removing these prevents orphaned bio fragments
  preprocessAuthorBios(documentClone);

  // Preprocess: Unwrap Substack image links so Readability preserves the images
  preprocessSubstackImages(documentClone);

  // Preprocess: Merge split article content containers (e.g., Ars Technica splits
  // post-content into multiple divs separated by ads). Readability scores each
  // independently and may only pick one, losing the beginning of the article.
  preprocessSplitContent(documentClone);

  // Preprocess: Convert image wrapper divs to figures
  // Readability's negative regex matches "media" in class names like "media-wrapper",
  // causing it to strip these divs. Converting to <figure> gives them protection.
  preprocessImageContainers(documentClone);

  // Detect special site modes
  const isXThread = /^https?:\/\/(x\.com|twitter\.com)\//i.test(window.location.href);
  const isYouTube = /^https?:\/\/(www\.)?youtube\.com\/watch/i.test(window.location.href);

  // YouTube: show embedded player with chapters and transcript
  if (isYouTube) {
    activateYouTubeMode();
    return;
  }

  let article, cleanedByline, heroImageHTML, cleanedContent, xAuthor;

  if (isXThread) {
    // Extract content directly from the DOM — Readability mangles X's structure
    const xResult = extractXThread(document);
    article = { title: document.title, byline: '', siteName: 'X', excerpt: '' };
    xAuthor = parseXAuthor(article.title);
    cleanedByline = '';
    heroImageHTML = '';
    cleanedContent = xResult;
  } else {
    // Parse the article using Readability
    const reader = new Readability(documentClone);
    article = reader.parse();

    if (!article) {
      alert("Readr couldn't extract article content from this page.");
      sessionStorage.removeItem("__readrActive");
      return;
    }

    xAuthor = null;

    // Clean up the byline (Readability sometimes concatenates metadata)
    cleanedByline = cleanByline(article.byline);

    // Look for hero image, but skip if the content already starts with an image
    heroImageHTML = '';
    let heroImage = null;
    const contentHasLeadImage = checkForLeadImage(article.content);
    if (!contentHasLeadImage) {
      heroImage = findHeroImage();
      if (heroImage) {
        heroImageHTML = buildHeroImageHTML(heroImage);
      }
    }

    // Clean up the article content
    cleanedContent = trimTrailingStructuralElements(article.content);
    if (heroImageHTML) {
      const dupPosition = findHeroImageInContent(cleanedContent, heroImage.src);
      if (dupPosition === 'early') {
        cleanedContent = removeHeroImageFromContent(cleanedContent, heroImage.src);
      } else if (dupPosition === 'later') {
        heroImageHTML = '';
      }
    }
    cleanedContent = removeTinyImages(cleanedContent);
    cleanedContent = removeImageOnlyParagraphs(cleanedContent);
    cleanedContent = deduplicateImages(cleanedContent);
    cleanedContent = wrapTables(cleanedContent);
  }

  // Build the reader view
  const readerHTML = `
    <!DOCTYPE html>
    <html lang="${document.documentElement.lang || "en"}" dir="${docDir}">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
      <meta name="theme-color" content="#121212" media="(prefers-color-scheme: dark)">
      <title>${escapeHTML(article.title)}</title>
      <style>${getInlineStyles()}</style>
    </head>
    <body class="readr-active">
      <div class="readr-page">
        <button class="readr-close" title="Exit Reader View" aria-label="Exit Reader View">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
        <article class="readr-container">
          <header class="readr-header">
            ${isXThread && xAuthor ? `
            <div class="readr-x-author">
              <span class="readr-x-name">${escapeHTML(xAuthor.name)}</span>
              ${xAuthor.handle ? `<span class="readr-x-handle">@${escapeHTML(xAuthor.handle)}</span>` : ''}
            </div>
            ` : `
            <h1 class="readr-title">${escapeHTML(article.title)}</h1>
            ${cleanedByline || article.siteName ? `
            <div class="readr-meta">
              ${cleanedByline ? `<span class="readr-byline">${escapeHTML(cleanedByline)}</span>` : ""}
              ${article.siteName ? `<span class="readr-site${cleanedByline ? '' : ' readr-site-only'}">${escapeHTML(article.siteName)}</span>` : ""}
            </div>
            ` : ""}
            ${article.excerpt ? `<p class="readr-excerpt">${escapeHTML(article.excerpt)}</p>` : ""}
            `}
          </header>
          ${heroImageHTML}
          <div class="readr-content">
            ${cleanedContent}
          </div>
        </article>
      </div>
    </body>
    </html>
  `;

  // Replace the page content
  document.open();
  document.write(readerHTML);
  document.close();

  // Set up close button handler after document is ready
  document.querySelector(".readr-close").addEventListener("click", exitReaderMode);

  // Also allow Escape key to exit
  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
      exitReaderMode();
    }
  });

  // Set up scrollable table indicators
  setupTableScrollIndicators();

  // DEBUG: Diagnostics panel — uncomment to enable. See CLAUDE.md for details.
  //
  // const debugOverlay = document.createElement('div');
  // debugOverlay.id = 'readr-debug';
  // debugOverlay.innerHTML = `
  //   <style>
  //     #readr-debug {
  //       position: fixed;
  //       bottom: 20px;
  //       right: 20px;
  //       width: 500px;
  //       max-height: 80vh;
  //       background: #1e1e1e;
  //       color: #e8e8e8;
  //       border-radius: 8px;
  //       box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  //       font-family: monospace;
  //       font-size: 12px;
  //       z-index: 10000;
  //       overflow: hidden;
  //     }
  //     #readr-debug-header {
  //       padding: 10px 14px;
  //       background: #333;
  //       font-weight: bold;
  //       cursor: pointer;
  //       display: flex;
  //       justify-content: space-between;
  //       gap: 12px;
  //     }
  //     #readr-debug-header span:last-child { cursor: pointer; }
  //     #readr-debug-copy {
  //       background: #555;
  //       border: none;
  //       color: #e8e8e8;
  //       padding: 2px 8px;
  //       border-radius: 4px;
  //       cursor: pointer;
  //       font-size: 11px;
  //     }
  //     #readr-debug-copy:hover { background: #666; }
  //     #readr-debug-content {
  //       padding: 14px;
  //       overflow: auto;
  //       max-height: calc(80vh - 40px);
  //     }
  //     #readr-debug pre {
  //       margin: 0;
  //       white-space: pre-wrap;
  //       word-break: break-all;
  //     }
  //     #readr-debug h4 {
  //       margin: 12px 0 6px;
  //       color: #6bb8ff;
  //     }
  //     #readr-debug h4:first-child { margin-top: 0; }
  //   </style>
  //   <div id="readr-debug-header">
  //     <span>Readr Diagnostics</span>
  //     <button id="readr-debug-copy">Copy</button>
  //     <span id="readr-debug-close" style="cursor:pointer">✕</span>
  //   </div>
  //   <div id="readr-debug-content">
  //     <h4>isXThread</h4>
  //     <pre>${isXThread}</pre>
  //     ${isXThread ? `<h4>xAuthor</h4><pre>${escapeHTML(JSON.stringify(xAuthor))}</pre>` : ''}
  //     <h4>title</h4>
  //     <pre>${escapeHTML(article.title)}</pre>
  //     <h4>content (cleaned HTML)</h4>
  //     <pre>${escapeHTML(cleanedContent)}</pre>
  //   </div>
  // `;
  // document.body.appendChild(debugOverlay);
  // document.getElementById('readr-debug-close').addEventListener('click', () => {
  //   document.getElementById('readr-debug').remove();
  // });
  // document.getElementById('readr-debug-copy').addEventListener('click', () => {
  //   const text = document.getElementById('readr-debug-content').innerText;
  //   navigator.clipboard.writeText(text).then(() => {
  //     document.getElementById('readr-debug-copy').textContent = 'Copied!';
  //     setTimeout(() => {
  //       document.getElementById('readr-debug-copy').textContent = 'Copy';
  //     }, 1500);
  //   });
  // });

  function exitReaderMode() {
    sessionStorage.removeItem("__readrActive");
    location.reload();
  }

  // Set up scroll indicators for table wrappers
  function setupTableScrollIndicators() {
    const containers = document.querySelectorAll('.readr-table-container');

    for (const container of containers) {
      const scroll = container.querySelector('.readr-table-scroll');
      if (!scroll) continue;

      const checkScroll = () => {
        const isScrollable = scroll.scrollWidth > scroll.clientWidth;
        const isScrolledEnd = scroll.scrollLeft + scroll.clientWidth >= scroll.scrollWidth - 5;

        container.classList.toggle('is-scrollable', isScrollable && !isScrolledEnd);
      };

      // Check initially
      checkScroll();

      // Check on scroll
      scroll.addEventListener('scroll', checkScroll, { passive: true });

      // Check on resize
      window.addEventListener('resize', checkScroll, { passive: true });
    }
  }

  // Remove trailing structural elements (hr, headings) with no paragraph content after them
  function trimTrailingStructuralElements(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html;

    const structuralTags = ['HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];

    // Clean up empty list items from all lists
    const lists = temp.querySelectorAll('ul, ol');
    for (const list of lists) {
      // Remove empty <li> items from the end
      while (list.lastElementChild) {
        const lastItem = list.lastElementChild;
        if (lastItem.tagName === 'LI' && !lastItem.textContent.trim()) {
          lastItem.remove();
        } else {
          break;
        }
      }
      // If list is now empty, remove it
      if (!list.children.length) {
        list.remove();
      }
    }

    // Check if an element has any real paragraph content (not just headings/divs)
    function hasParagraphContent(el) {
      // Has a <p> with actual text
      const paragraphs = el.querySelectorAll('p');
      for (const p of paragraphs) {
        if (p.textContent.trim().length > 0) return true;
      }
      // Has other content elements like lists, blockquotes, figures
      if (el.querySelector('ul, ol, blockquote, figure, pre, table')) return true;
      return false;
    }

    // Find the actual content container (Readability wraps in div#readability-page-1)
    let container = temp;
    const wrapper = temp.querySelector('#readability-page-1, .page');
    if (wrapper) {
      container = wrapper;
    }

    // Work backwards from the end, removing trailing structural elements
    let changed = true;
    while (changed) {
      changed = false;
      const lastChild = container.lastElementChild;
      if (!lastChild) break;

      // Check if the last element is a structural element (hr or heading)
      if (structuralTags.includes(lastChild.tagName)) {
        lastChild.remove();
        changed = true;
        continue;
      }

      // Check if it's a container with no real paragraph content (only headings/divs)
      if (['DIV', 'SECTION', 'ARTICLE'].includes(lastChild.tagName) && !hasParagraphContent(lastChild)) {
        lastChild.remove();
        changed = true;
      }
    }

    return temp.innerHTML;
  }

  // Remove images with explicit small dimensions (e.g., 36x36 avatars)
  function removeTinyImages(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html;

    const images = temp.querySelectorAll('img');
    for (const img of images) {
      const width = parseInt(img.getAttribute('width')) || 0;
      const height = parseInt(img.getAttribute('height')) || 0;

      if ((width > 0 && width <= 100) || (height > 0 && height <= 100)) {
        removeElementAndCleanup(img);
      }
    }

    return temp.innerHTML;
  }

  // Remove paragraphs that contain only "Image" text (leftover from image alt/caption extraction)
  function removeImageOnlyParagraphs(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html;

    const paragraphs = temp.querySelectorAll('p');
    for (const p of paragraphs) {
      const text = p.textContent.trim();
      if (text === 'Image') {
        removeElementAndCleanup(p);
      }
    }

    return temp.innerHTML;
  }

  // Wrap tables in a scrollable container for wide tables
  function wrapTables(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html;

    const tables = temp.querySelectorAll('table');
    for (const table of tables) {
      // Skip if already wrapped
      if (table.parentElement.classList.contains('readr-table-scroll')) continue;

      // Create nested structure: container (has gradient) > scroll (scrolls) > table
      const container = document.createElement('div');
      container.className = 'readr-table-container';

      const scroll = document.createElement('div');
      scroll.className = 'readr-table-scroll';

      table.parentNode.insertBefore(container, table);
      scroll.appendChild(table);
      container.appendChild(scroll);
    }

    return temp.innerHTML;
  }

  // Extract the base filename without size suffix for flexible matching
  // e.g., "photo-1024x853.jpg" → "photo" and "photo.jpg" → "photo"
  function getBaseFilename(url) {
    try {
      const pathname = new URL(url, window.location.href).pathname;
      const filename = pathname.split('/').pop();
      return filename.replace(/\.[^.]+$/, '').replace(/-\d+x\d+$/, '');
    } catch (e) {
      return url;
    }
  }

  // Check if the hero image appears in the article content and where.
  // Returns 'early' if near the top (first 3 top-level elements),
  // 'later' if deeper in the article, or null if not found.
  function findHeroImageInContent(html, heroSrc) {
    if (!heroSrc) return null;

    const temp = document.createElement('div');
    temp.innerHTML = html;

    const heroBase = getBaseFilename(heroSrc);

    // Drill down past Readability's wrapper divs to find the actual content container
    // (e.g., div#readability-page-1 > div > article > div)
    let contentRoot = temp;
    while (contentRoot.children.length === 1 && !contentRoot.children[0].matches('p, figure, img')) {
      contentRoot = contentRoot.children[0];
    }
    const topLevelChildren = Array.from(contentRoot.children);

    for (const img of temp.querySelectorAll('img')) {
      const src = img.src || img.dataset.src || img.dataset.lazySrc || '';
      if (!src) continue;

      if (getBaseFilename(src) === heroBase) {
        // Find which top-level element of the content container holds this image
        let ancestor = img;
        while (ancestor.parentElement && ancestor.parentElement !== contentRoot) {
          ancestor = ancestor.parentElement;
        }
        const index = topLevelChildren.indexOf(ancestor);
        return (index !== -1 && index <= 2) ? 'early' : 'later';
      }
    }

    return null;
  }

  // Remove the hero image from the article content to prevent duplicates
  function removeHeroImageFromContent(html, heroSrc) {
    if (!heroSrc) return html;

    const temp = document.createElement('div');
    temp.innerHTML = html;

    const heroBase = getBaseFilename(heroSrc);
    const imgs = temp.querySelectorAll('img');

    for (const img of imgs) {
      const src = img.src || img.dataset.src || img.dataset.lazySrc || '';
      if (!src) continue;

      const imgBase = getBaseFilename(src);
      if (imgBase === heroBase) {
        // Remove the figure/container wrapping the image, or just the image
        const figure = img.closest('figure');
        if (figure) {
          figure.remove();
        } else {
          // If the image is the only child in a p or div, remove the container
          const parent = img.parentElement;
          if (parent && (parent.tagName === 'P' || parent.tagName === 'DIV') &&
              parent.children.length === 1 && !parent.textContent.trim()) {
            parent.remove();
          } else {
            img.remove();
          }
        }
        break; // Only remove the first match
      }
    }

    return temp.innerHTML;
  }

  // Unwrap custom image elements and remove nearby duplicate images
  function deduplicateImages(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html;

    // First, unwrap custom image wrapper elements like <progressive-image>
    // These can cause duplicate rendering (the wrapper + the inner img)
    const customWrappers = temp.querySelectorAll('progressive-image, lazy-image, [data-progressive-image]');
    for (const wrapper of customWrappers) {
      const img = wrapper.querySelector('img');
      if (img) {
        wrapper.replaceWith(img);
      } else {
        wrapper.remove();
      }
    }

    // Remove duplicate images only if they appear close together (within 3 elements)
    // This catches double-extraction bugs without breaking legitimate repeated images
    const images = Array.from(temp.querySelectorAll('img'));

    function getImageId(img) {
      const src = img.src || img.getAttribute('src') || '';
      if (!src) return null;
      const match = src.match(/([^\/]+\.(jpg|jpeg|png|gif|webp|avif))/i);
      return match ? match[1].toLowerCase() : src.split('?')[0].toLowerCase();
    }

    function getElementIndex(el) {
      // Get a rough position in the document by counting preceding elements
      let count = 0;
      let node = el;
      while (node) {
        node = node.previousElementSibling;
        count++;
      }
      // Also factor in parent depth
      let parent = el.parentElement;
      while (parent && parent !== temp) {
        let parentCount = 0;
        let pNode = parent;
        while (pNode) {
          pNode = pNode.previousElementSibling;
          parentCount++;
        }
        count += parentCount * 10; // Weight parent position more
        parent = parent.parentElement;
      }
      return count;
    }

    // Build a map of image ID to list of {img, index}
    const imageMap = new Map();
    for (const img of images) {
      const id = getImageId(img);
      if (!id) continue;
      const index = getElementIndex(img);
      if (!imageMap.has(id)) {
        imageMap.set(id, []);
      }
      imageMap.get(id).push({ img, index });
    }

    // For each duplicate group, remove images that are close to an earlier one
    for (const [id, occurrences] of imageMap) {
      if (occurrences.length < 2) continue;

      // Sort by index
      occurrences.sort((a, b) => a.index - b.index);

      // Remove duplicates that are within 30 index units of a previous occurrence
      for (let i = 1; i < occurrences.length; i++) {
        const gap = occurrences[i].index - occurrences[i - 1].index;
        if (gap < 30) {
          removeElementAndCleanup(occurrences[i].img);
        }
      }
    }

    return temp.innerHTML;
  }

  // Remove an element and clean up empty parent containers
  function removeElementAndCleanup(el) {
    if (!el || !el.parentElement) return;

    let parent = el.parentElement;
    el.remove();

    // Walk up and remove empty containers (with depth limit to prevent infinite loops)
    let depth = 0;
    const maxDepth = 20;
    const seen = new Set();

    while (parent && depth < maxDepth && !seen.has(parent)) {
      seen.add(parent);

      // Don't remove the main content wrapper
      if (parent.id === 'readability-page-1' || parent.classList.contains('page')) break;

      // Stop if parent has content
      if (parent.textContent.trim() || parent.querySelector('img, video, iframe')) break;

      const grandparent = parent.parentElement;
      parent.remove();
      parent = grandparent;
      depth++;
    }
  }

  // Clean up byline that may have concatenated metadata
  function cleanByline(byline) {
    if (!byline) return '';

    let cleaned = byline;

    // Remove common date/time patterns that get concatenated
    // "Publishedyesterday" "Updated08:01" etc.
    cleaned = cleaned.replace(/Published\s*/gi, '');
    cleaned = cleaned.replace(/Updated\s*/gi, '');
    cleaned = cleaned.replace(/Posted\s*/gi, '');
    cleaned = cleaned.replace(/Modified\s*/gi, '');
    cleaned = cleaned.replace(/Edited\s*/gi, '');

    // Remove time patterns like "08:01", "12:30 PM"
    cleaned = cleaned.replace(/\d{1,2}:\d{2}\s*(AM|PM|am|pm)?\s*/g, '');

    // Remove relative dates
    cleaned = cleaned.replace(/\b(yesterday|today|tomorrow)\b\s*/gi, '');
    cleaned = cleaned.replace(/\b\d+\s*(hours?|minutes?|mins?|days?|weeks?|months?)\s*ago\b\s*/gi, '');

    // Remove absolute dates like "January 15, 2024" or "15 Jan 2024" or "2024-01-15"
    cleaned = cleaned.replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4}\b\s*/gi, '');
    cleaned = cleaned.replace(/\b\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\b\s*/gi, '');
    cleaned = cleaned.replace(/\b\d{4}-\d{2}-\d{2}\b\s*/g, '');

    // Remove stray numbers at the end (reading time, comment count, etc.)
    cleaned = cleaned.replace(/\d+\s*$/, '');

    // Remove "X min read" patterns
    cleaned = cleaned.replace(/\d+\s*min(ute)?\s*read\s*/gi, '');

    // Remove common separators that got concatenated
    cleaned = cleaned.replace(/\s*[|•·]\s*$/g, '');
    cleaned = cleaned.replace(/^\s*[|•·]\s*/g, '');

    // Normalize whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    // If the result is too long, it's probably still corrupted - truncate at a reasonable point
    if (cleaned.length > 150) {
      // Try to find a natural break point (comma, "and", etc.)
      const breakPoints = [
        cleaned.lastIndexOf(' and ', 150),
        cleaned.lastIndexOf(', ', 150),
        cleaned.lastIndexOf(' in ', 150),
      ];
      const bestBreak = Math.max(...breakPoints);
      if (bestBreak > 50) {
        // Truncate before the separator
        cleaned = cleaned.substring(0, bestBreak).trim();
      } else {
        cleaned = cleaned.substring(0, 150).trim();
      }
    }

    // If after all cleaning we have something too short or just numbers, discard it
    if (cleaned.length < 3 || /^\d+$/.test(cleaned)) {
      return '';
    }

    return cleaned;
  }

  // Extract author name and handle from X/Twitter title
  // Title format: "Author Name on X: \"tweet text...\" / X"
  function parseXAuthor(title) {
    const match = title.match(/^(.+?)\s+on\s+X:/);
    const name = match ? match[1].trim() : null;

    // Extract handle from URL: x.com/username/status/...
    const urlMatch = window.location.pathname.match(/^\/([^/]+)\//);
    const handle = urlMatch ? urlMatch[1] : null;

    if (!name && !handle) return null;
    return { name: name || handle, handle };
  }

  // Extract X thread content directly from the live DOM, bypassing Readability.
  // Reads [data-testid="tweetText"] elements to preserve @mentions, links, and images.
  function extractXThread(doc) {
    const tweetTexts = doc.querySelectorAll('[data-testid="tweetText"]');
    if (tweetTexts.length === 0) return '<p>Could not extract tweets from this page.</p>';

    const fragments = [];
    for (let i = 0; i < tweetTexts.length; i++) {
      if (i > 0) {
        fragments.push('<div class="readr-x-sep"></div>');
      }
      // Use textContent to get clean inline text with @mentions preserved
      const text = tweetTexts[i].textContent;

      // Split on double newlines to create proper paragraphs
      const parts = text.split(/\n\s*\n/);
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed) {
          fragments.push(`<p>${escapeHTML(trimmed)}</p>`);
        }
      }
    }

    return fragments.join('\n');
  }

  // YouTube mode: extract chapters, transcript, and display in reader view with embedded player
  function activateYouTubeMode() {
    const videoId = new URL(window.location.href).searchParams.get('v');
    if (!videoId) {
      alert("Readr couldn't find a video ID on this page.");
      sessionStorage.removeItem("__readrActive");
      return;
    }

    // Read YouTube data (extracted by background script via MAIN world, stored in sessionStorage)
    const ytData = extractYouTubePageData();
    const title = ytData.title || document.title.replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, '');
    const channel = ytData.channel || '';
    const chapters = ytData.chapters || [];
    const hasChapters = chapters.length > 0;
    const pagePlayer = findYouTubePagePlayer();
    const usePagePlayer = !!pagePlayer;

    // Parse transcript (already fetched by background script)
    const segments = ytData.transcriptText ? parseYTTranscriptResponse(ytData.transcriptText) : [];
    const hasTranscript = segments.length > 0;

    // Build chapters HTML
    const chaptersHTML = hasChapters ? chapters.map(ch =>
      `<div class="readr-yt-chapter" data-time="${ch.time}">
        <span class="readr-yt-chapter-time">${formatYTTime(ch.time)}</span>
        <span class="readr-yt-chapter-title">${escapeHTML(ch.title)}</span>
      </div>`
    ).join('') : '';

    // Build transcript HTML
    const transcriptHTML = hasTranscript ? buildYTTranscriptHTML(segments, chapters) : '';

    // Build the reader view via DOM replacement (NOT document.write).
    // document.write() reopens the document which re-evaluates CSP headers.
    // replaceWith swaps elements without reopening the document.
    const bodyHTML = `
  <button class="readr-close" title="Exit Reader View" aria-label="Exit Reader View">
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  </button>
  <div class="readr-yt-layout ${hasChapters ? 'has-chapters' : ''}">
    ${hasChapters ? `
    <aside class="readr-yt-chapters">
      ${chaptersHTML}
    </aside>` : ''}
    <div class="readr-yt-main">
      <div class="readr-yt-card">
        <div class="readr-yt-video">
          ${usePagePlayer ? `
          <div id="readr-yt-page-player"></div>` : `
          <iframe id="readr-yt-player" data-video-id="${escapeAttr(videoId)}"
            src="https://www.youtube.com/embed/${escapeAttr(encodeURIComponent(videoId))}"
            title="YouTube video player"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerpolicy="strict-origin-when-cross-origin"
            allowfullscreen></iframe>`}
        </div>
        <div class="readr-yt-info">
          <h1 class="readr-yt-title">${escapeHTML(title)}</h1>
          ${channel ? `<p class="readr-yt-channel">${escapeHTML(channel)}</p>` : ''}
        </div>
        ${hasTranscript ? `
        <div class="readr-yt-transcript-wrap">
          ${transcriptHTML}
        </div>` : ''}
      </div>
    </div>
  </div>`;

    if (usePagePlayer) {
      // Keep YouTube's loaded head CSS/scripts so the real player UI survives.
      // Readr's UI styles are injected only into the shadow root below.
      document.title = title;
      document.documentElement.removeAttribute('class');
      document.documentElement.removeAttribute('style');
      document.documentElement.setAttribute('lang', 'en');
    } else {
      // Clean the html element of YouTube's classes/attributes.
      document.documentElement.removeAttribute('class');
      document.documentElement.removeAttribute('style');
      document.documentElement.setAttribute('lang', 'en');

      // Replace head: clear YouTube's styles and scripts, inject ours.
      const newHead = document.createElement('head');
      newHead.innerHTML = `
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${escapeHTML(title)}</title>
        <style>${getInlineStyles()}${getYouTubeStyles()}</style>`;
      document.head.replaceWith(newHead);
    }

    // Replace body: swap YouTube's UI with reader view
    const newBody = document.createElement('body');
    newBody.className = 'readr-active readr-yt';
    newBody.style.margin = '0';
    newBody.style.minHeight = '100vh';
    document.body.replaceWith(newBody);
    const updatePageBackground = createReaderBackgroundSync(document.documentElement, newBody);

    if (usePagePlayer) {
      const host = document.createElement('div');
      host.id = 'readr-yt-shadow-host';
      host.style.display = 'block';
      host.style.width = '100%';
      host.style.minHeight = '100vh';
      updatePageBackground(host);
      newBody.appendChild(host);

      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `<style>${getInlineStyles()}${getYouTubeStyles()}</style>${bodyHTML}`;
      mountYouTubePagePlayer(pagePlayer, host);

      shadow.querySelector('.readr-close').addEventListener('click', exitReaderMode);
      setupYouTubeInteractivity(shadow);
    } else {
      newBody.innerHTML = bodyHTML;

      // Remove any stray YouTube stylesheets that survived the head swap.
      document.querySelectorAll('link[rel="stylesheet"], style:not([data-readr])').forEach(el => {
        if (!el.closest('head')) el.remove();
      });

      document.querySelector('.readr-close').addEventListener('click', exitReaderMode);
      setupYouTubeInteractivity(document);
    }

    // Set up Escape handler
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') exitReaderMode();
    });
  }

  // Read YouTube data stored by the background script (extracted via MAIN world
  // to bypass YouTube's CSP which blocks inline script injection)
  function extractYouTubePageData() {
    const stored = sessionStorage.getItem('__readrYTData');
    sessionStorage.removeItem('__readrYTData');
    if (stored) {
      try {
        const data = JSON.parse(stored);
        if (data) return data;
      } catch {}
    }
    // Fallback: basic info from DOM
    return {
      title: document.title.replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, ''),
      channel: '',
      captionUrl: null,
      chapters: []
    };
  }

  // Decode HTML entities in transcript text (e.g., &#39; → ')
  function decodeHTMLEntities(text) {
    const el = document.createElement('textarea');
    el.innerHTML = text;
    return el.value;
  }

  // Parse transcript response (handles both XML and JSON3 formats)
  function parseYTTranscriptResponse(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith('<?xml') || trimmed.startsWith('<transcript')) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/xml');
      const nodes = doc.querySelectorAll('text');
      const segments = [];
      for (const t of nodes) {
        const txt = decodeHTMLEntities(t.textContent.trim());
        if (txt) {
          segments.push({
            start: parseFloat(t.getAttribute('start')) || 0,
            dur: parseFloat(t.getAttribute('dur')) || 0,
            text: txt
          });
        }
      }
      return segments;
    }
    // JSON3 format
    try {
      const json = JSON.parse(text);
      if (json.events) {
        return json.events
          .filter(e => e.segs)
          .map(e => ({
            start: (e.tStartMs || 0) / 1000,
            dur: (e.dDurationMs || 0) / 1000,
            text: decodeHTMLEntities(e.segs.map(s => s.utf8 || '').join('').trim())
          }))
          .filter(s => s.text);
      }
    } catch (e) {}
    return [];
  }

  // Build transcript HTML, grouped by chapters if available
  function buildYTTranscriptHTML(segments, chapters) {
    if (!segments.length) return '';
    if (!chapters.length) {
      return buildYTTranscriptSection(null, segments);
    }
    let html = '';
    for (let i = 0; i < chapters.length; i++) {
      const startTime = chapters[i].time;
      const endTime = i + 1 < chapters.length ? chapters[i + 1].time : Infinity;
      const chapterSegs = segments.filter(s => s.start >= startTime && s.start < endTime);
      if (chapterSegs.length) {
        html += buildYTTranscriptSection(chapters[i].title, chapterSegs);
      }
    }
    return html;
  }

  // Build a single transcript section (one chapter or the entire transcript)
  function buildYTTranscriptSection(title, segments) {
    let html = '<div class="readr-yt-transcript-section">';
    if (title) {
      html += `<h3>${escapeHTML(title)}</h3>`;
    }
    // Merge segments into paragraphs of ~60 seconds
    const INTERVAL = 60;
    let paraStart = segments[0].start;
    let paraTexts = [];
    for (const seg of segments) {
      if (seg.start - paraStart >= INTERVAL && paraTexts.length) {
        html += `<p><a class="readr-yt-ts" data-time="${paraStart}">${formatYTTime(paraStart)}</a> &middot; ${paraTexts.join(' ')}</p>`;
        paraStart = seg.start;
        paraTexts = [];
      }
      paraTexts.push(escapeHTML(seg.text));
    }
    if (paraTexts.length) {
      html += `<p><a class="readr-yt-ts" data-time="${paraStart}">${formatYTTime(paraStart)}</a> &middot; ${paraTexts.join(' ')}</p>`;
    }
    html += '</div>';
    return html;
  }

  // Format seconds as m:ss or h:mm:ss
  function formatYTTime(seconds) {
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  // Set up YouTube player seeking and active chapter tracking
  function setupYouTubeInteractivity(root = document) {
    const iframe = root.getElementById ? root.getElementById('readr-yt-player') : root.querySelector('#readr-yt-player');
    const pagePlayer = document.querySelector('.readr-yt-page-player');
    if (!iframe && !pagePlayer) return;

    const videoId = iframe?.dataset.videoId;
    const pageVideo = pagePlayer?.querySelector('video');
    if (pageVideo) {
      pageVideo.addEventListener('timeupdate', () => updateYTActiveChapter(pageVideo.currentTime, root));
    }

    // Seek by reloading the embed with a start time parameter
    function seekTo(seconds) {
      const s = Math.max(0, Math.floor(seconds));
      if (pagePlayer) {
        seekYouTubePagePlayer(pagePlayer, s);
      } else if (iframe) {
        iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&start=${s}`;
      }
    }

    // Chapter clicks
    root.querySelectorAll('.readr-yt-chapter').forEach(el => {
      el.addEventListener('click', () => {
        seekTo(parseFloat(el.dataset.time));
        root.querySelectorAll('.readr-yt-chapter').forEach(c => c.classList.remove('active'));
        el.classList.add('active');
      });
    });

    // Transcript timestamp clicks
    root.querySelectorAll('.readr-yt-ts').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        seekTo(parseFloat(el.dataset.time));
      });
    });
  }

  function findYouTubePagePlayer() {
    const player = document.querySelector('#movie_player');
    if (player && player.querySelector('video')) return player;
    return null;
  }

  function seekYouTubePagePlayer(player, seconds) {
    const video = player.querySelector('video');
    if (!video) return;
    video.currentTime = seconds;
    const playResult = video.play();
    if (playResult && typeof playResult.catch === 'function') {
      playResult.catch(() => {});
    }
  }

  function mountYouTubePagePlayer(player, host) {
    const mount = host.shadowRoot.getElementById('readr-yt-page-player');
    if (!mount) return;

    const slot = document.createElement('slot');
    slot.name = 'yt-player';
    mount.replaceWith(slot);

    player.slot = 'yt-player';
    player.classList.add('readr-yt-page-player');
    player.style.display = 'block';
    player.style.position = 'relative';
    player.style.overflow = 'hidden';
    player.style.background = '#000';
    host.appendChild(player);

    const resize = () => {
      const container = host.shadowRoot.querySelector('.readr-yt-video');
      const rect = (container || player).getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(width * 9 / 16));
      player.style.width = '100%';
      player.style.height = `${height}px`;
      if (typeof player.setSize === 'function') {
        player.setSize(width, height);
      }
    };

    resize();
    requestAnimationFrame(resize);
    window.addEventListener('resize', resize);
  }

  function getReaderBackgroundColor() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? '#121212'
      : '#f8f8f8';
  }

  function createReaderBackgroundSync(...elements) {
    const syncedElements = new Set(elements.filter(Boolean));

    const apply = (...moreElements) => {
      moreElements.filter(Boolean).forEach(el => syncedElements.add(el));
      const bg = getReaderBackgroundColor();
      syncedElements.forEach(el => {
        el.style.backgroundColor = bg;
      });
    };

    apply();

    if (window.matchMedia) {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => apply();
      if (media.addEventListener) {
        media.addEventListener('change', listener);
      } else if (media.addListener) {
        media.addListener(listener);
      }
    }

    return apply;
  }

  // Highlight the current chapter based on video playback time
  function updateYTActiveChapter(currentTime, root = document) {
    const chapters = root.querySelectorAll('.readr-yt-chapter');
    let activeIndex = -1;
    chapters.forEach((ch, i) => {
      if (currentTime >= parseFloat(ch.dataset.time)) activeIndex = i;
      ch.classList.remove('active');
    });
    if (activeIndex >= 0) {
      chapters[activeIndex].classList.add('active');
    }
  }

  // YouTube-specific styles
  function getYouTubeStyles() {
    return `
      /* Reset YouTube's interference */
      html, body.readr-yt { all: unset; }
      body.readr-yt {
        display: block;
        margin: 0;
        padding: 0;
        background-color: var(--reader-bg) !important;
        color: var(--reader-text) !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
        font-size: 18px !important;
        line-height: 1.7 !important;
        min-height: 100vh;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }

      :host {
        --reader-bg: #f8f8f8;
        --reader-card-bg: #ffffff;
        --reader-text: #1d1d1f;
        --reader-text-secondary: #6e6e73;
        --reader-link: #0066cc;
        --reader-border: #e5e5e5;
        --reader-code-bg: #f5f5f7;
        --reader-selection: rgba(0, 102, 204, 0.2);
        --reader-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 8px 30px rgba(0, 0, 0, 0.06);
        display: block;
        box-sizing: border-box;
        width: 100%;
        min-height: 100vh;
        background-color: var(--reader-bg);
        color: var(--reader-text);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: 18px;
        line-height: 1.7;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }

      @media (prefers-color-scheme: dark) {
        :host {
          --reader-bg: #121212;
          --reader-card-bg: #1e1e1e;
          --reader-text: #e8e8e8;
          --reader-text-secondary: #a1a1a6;
          --reader-link: #6bb8ff;
          --reader-border: #333333;
          --reader-code-bg: #2a2a2a;
          --reader-selection: rgba(107, 184, 255, 0.3);
          --reader-shadow: 0 1px 3px rgba(0, 0, 0, 0.3), 0 8px 30px rgba(0, 0, 0, 0.25);
        }
      }

      .readr-yt-layout {
        display: block !important;
        min-height: 100vh;
        padding: 40px 24px 80px;
      }

      .readr-yt-layout.has-chapters {
        display: grid !important;
        grid-template-columns: 260px 1fr;
        grid-template-areas: "chapters main";
        gap: 0;
        max-width: none;
        padding: 0;
      }

      /* Chapters sidebar */
      .readr-yt-chapters {
        grid-area: chapters;
        padding: 32px 20px;
        position: sticky;
        top: 0;
        height: 100vh;
        overflow-y: auto;
      }

      .readr-yt-chapters-heading {
        font-size: 0.7rem !important;
        font-weight: 600 !important;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--reader-text-secondary) !important;
        margin: 0 0 16px !important;
        padding: 0 !important;
      }

      .readr-yt-chapter {
        display: flex !important;
        gap: 12px;
        padding: 6px 8px;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.15s;
        margin: 0 -8px;
      }

      .readr-yt-chapter:hover { background: var(--reader-code-bg); }
      .readr-yt-chapter.active { background: var(--reader-code-bg); }
      .readr-yt-chapter.active .readr-yt-chapter-time { color: var(--reader-link); }

      .readr-yt-chapter-time {
        font-family: "SF Mono", SFMono-Regular, ui-monospace, Menlo, monospace !important;
        font-size: 0.78rem !important;
        color: var(--reader-text-secondary) !important;
        white-space: nowrap;
        width: 44px;
        flex-shrink: 0;
        text-align: right;
        line-height: 1.4;
      }

      .readr-yt-chapter-title {
        font-size: 0.82rem !important;
        color: var(--reader-text) !important;
        line-height: 1.4;
      }

      /* Main content area */
      .readr-yt-main {
        grid-area: main;
        padding: 40px;
        display: flex;
        justify-content: center;
      }

      .readr-yt-layout:not(.has-chapters) .readr-yt-main {
        max-width: 900px;
        margin: 0 auto;
        padding: 0;
      }

      /* Card container for video + transcript */
      .readr-yt-card {
        background: var(--reader-card-bg);
        border-radius: 12px;
        box-shadow: var(--reader-shadow);
        overflow: hidden;
        max-width: 840px;
        width: 100%;
      }

      .readr-yt-video iframe {
        width: 100% !important;
        aspect-ratio: 16/9;
        border: none !important;
        display: block !important;
        background: #000 !important;
      }

      ::slotted(.readr-yt-page-player) {
        width: 100% !important;
        display: block !important;
        background: #000 !important;
      }

      .readr-yt-info {
        padding: 20px 32px 0;
      }

      .readr-yt-title {
        font-size: 1.3rem !important;
        font-weight: 600 !important;
        margin: 0 0 4px !important;
        line-height: 1.3;
        letter-spacing: -0.01em;
        color: var(--reader-text) !important;
      }

      .readr-yt-channel {
        margin: 0 !important;
        color: var(--reader-text-secondary) !important;
        font-size: 0.9rem !important;
      }

      /* Transcript inside the card */
      .readr-yt-transcript-wrap {
        padding: 24px 32px 40px;
      }

      .readr-yt-transcript-heading {
        font-size: 1.3rem !important;
        font-weight: 600 !important;
        margin: 0 0 20px !important;
        color: var(--reader-text) !important;
      }

      .readr-yt-transcript-section h3 {
        font-size: 1.05rem !important;
        font-weight: 600 !important;
        margin: 24px 0 10px !important;
        color: var(--reader-text) !important;
      }

      .readr-yt-transcript-section:first-child h3:first-child {
        margin-top: 0 !important;
      }

      .readr-yt-transcript-section p {
        margin: 0 0 14px !important;
        line-height: 1.7 !important;
        font-size: 1rem !important;
        color: var(--reader-text) !important;
      }

      .readr-yt-ts {
        color: var(--reader-link) !important;
        text-decoration: underline;
        text-decoration-thickness: 1px;
        text-underline-offset: 2px;
        cursor: pointer;
        font-weight: 600;
      }
      .readr-yt-ts:hover { text-decoration-thickness: 2px; }

      /* Responsive: chapters below video on narrow screens */
      @media (max-width: 900px) {
        .readr-yt-layout.has-chapters {
          display: flex !important;
          flex-direction: column;
        }

        .readr-yt-chapters {
          position: static;
          height: auto;
          border-right: none;
          border-bottom: 1px solid var(--reader-border);
          order: -1;
          padding: 20px 24px;
        }

        .readr-yt-main {
          padding: 24px;
        }
      }

      @media (max-width: 600px) {
        .readr-yt-main { padding: 16px; }
        .readr-yt-chapters { padding: 16px; }
        .readr-yt-info { padding: 16px 20px 0; }
        .readr-yt-transcript-wrap { padding: 16px 20px 32px; }
        .readr-yt-card { border-radius: 8px; }
        .readr-yt-title { font-size: 1.1rem !important; }
      }

      @media print {
        .readr-close { display: none !important; }
        .readr-yt-chapters { display: none !important; }
        .readr-yt-video iframe { display: none !important; }
      }
    `;
  }

  function buildHeroImageHTML(hero) {
    let imgAttrs = `src="${escapeAttr(hero.src)}" alt="${escapeAttr(hero.alt || '')}"`;
    if (hero.srcset) imgAttrs += ` srcset="${escapeAttr(hero.srcset)}"`;
    if (hero.sizes) imgAttrs += ` sizes="${escapeAttr(hero.sizes)}"`;

    let imgTag;
    if (hero.sourceElements && hero.sourceElements.length > 0) {
      const sources = hero.sourceElements.map(s => {
        let attrs = `srcset="${escapeAttr(s.srcset)}"`;
        if (s.type) attrs += ` type="${escapeAttr(s.type)}"`;
        if (s.media) attrs += ` media="${escapeAttr(s.media)}"`;
        if (s.sizes) attrs += ` sizes="${escapeAttr(s.sizes)}"`;
        return `<source ${attrs}>`;
      }).join('');
      imgTag = `<picture>${sources}<img ${imgAttrs}></picture>`;
    } else {
      imgTag = `<img ${imgAttrs}>`;
    }

    const caption = hero.caption ? `<figcaption>${escapeHTML(hero.caption)}</figcaption>` : '';
    return `<figure class="readr-hero">${imgTag}${caption}</figure>`;
  }

  // Find the hero/lead image of the article
  // Conservative approach: only use strong semantic signals
  // We'd rather show no hero than show a wrong image (logo, brand image, etc.)
  function findHeroImage() {
    // 1. Look for images in semantic figure elements within article content
    const figureSelectors = [
      'article figure:first-of-type img',
      'main figure:first-of-type img',
      '[role="main"] figure:first-of-type img',
    ];

    for (const selector of figureSelectors) {
      try {
        const img = document.querySelector(selector);
        if (img) {
          // console.log(`[Readr] Found figure img with selector: ${selector}`);
          if (isValidHeroImage(img)) {
            return extractImageData(img);
          }
        }
      } catch (e) {
        // Invalid selector, skip
      }
    }

    // 2. Look for images with fetchpriority="high" (explicit LCP signal)
    // This is a strong signal that the site considers this their hero image
    // Query broadly - isValidHeroImageLight will reject nav/header/footer
    const priorityImgs = document.querySelectorAll('img[fetchpriority="high"]');
    // console.log(`[Readr] Found ${priorityImgs.length} img(s) with fetchpriority="high"`);
    for (const img of priorityImgs) {
      if (isValidHeroImageLight(img)) {
        return extractImageData(img);
      }
    }

    // 3. Look for images that have a figcaption nearby (semantic caption signal)
    // Sites like The Verge use figcaption without figure wrapper
    const captionedImg = findImageWithNearbyCaptions();
    if (captionedImg && isValidHeroImageLight(captionedImg)) {
      return extractImageData(captionedImg);
    }

    return null;
  }

  // Find an image that has a figcaption in a nearby container
  // This catches cases like The Verge where figcaption exists without figure
  function findImageWithNearbyCaptions() {
    // Look for figcaptions in the main content area
    const figcaptions = document.querySelectorAll('article figcaption, main figcaption, [role="main"] figcaption');

    for (const caption of figcaptions) {
      // Walk up to find a container that also has an img
      let container = caption.parentElement;
      let depth = 0;

      while (container && depth < 4) {
        const img = container.querySelector('img');
        if (img && img !== caption.querySelector('img')) {
          // Found an image in the same container as a figcaption
          // Make sure it's near the top (first such image we find)
          return img;
        }
        container = container.parentElement;
        depth++;
      }
    }

    return null;
  }

  function isValidHeroImage(img) {
    // Get actual dimensions
    const width = img.naturalWidth || img.width || parseInt(img.getAttribute('width')) || 0;
    const height = img.naturalHeight || img.height || parseInt(img.getAttribute('height')) || 0;

    // Must have reasonable dimensions for a hero image
    if (width < 400 || height < 200) return false;

    // Check aspect ratio (filter out banners and logos)
    const aspectRatio = width / height;
    if (aspectRatio < 0.5 || aspectRatio > 4) return false;

    // Square-ish images (0.85 to 1.15 ratio) are often logos or profile pics, not article images
    // But only reject if they're small - large square images can be legitimate hero images
    if (aspectRatio >= 0.85 && aspectRatio <= 1.15 && width < 600) return false;

    // Run common checks
    return isValidHeroImageLight(img);
  }

  // Lighter validation for images with strong signals (fetchpriority="high", nearby figcaption)
  // Skips dimension checks since dimensions may not be available for CSS-sized images
  function isValidHeroImageLight(img) {
    // Check if image is visible
    try {
      const style = window.getComputedStyle(img);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
    } catch (e) {
      // getComputedStyle can fail on detached elements
      return false;
    }

    // Skip images inside nav, header (site header), footer, aside
    const parent = img.closest('nav, header, footer, aside, [role="navigation"], [role="banner"]');
    if (parent) {
      return false;
    }

    // Skip tiny images and icons based on URL/class
    const src = img.src || img.dataset.src || '';
    if (isLikelyLogo(src)) {
      return false;
    }

    // Also check class name for logo indicators
    const className = (img.className || '').toLowerCase();
    if (className.includes('logo') || className.includes('brand') || className.includes('icon')) {
      return false;
    }

    // Skip lazy-load placeholders
    if (src.includes('data:image/') && src.length < 1000) {
      return false;
    }
    if (img.classList.contains('lazy') && !img.src) {
      return false;
    }

    return true;
  }

  function isLikelyLogo(url) {
    if (!url) return true;
    const lower = url.toLowerCase();

    // Common logo/icon patterns in URLs
    if (lower.includes('logo') ||
        lower.includes('icon') ||
        lower.includes('avatar') ||
        lower.includes('favicon') ||
        lower.includes('badge') ||
        lower.includes('sprite') ||
        lower.includes('1x1') ||
        lower.includes('pixel') ||
        lower.includes('profile') ||
        lower.includes('brand')) {
      return true;
    }

    // Check for small dimension patterns in URLs (e.g., /32x32/, _64x64., -100x100)
    // Match patterns like: 32x32, 64x64, 100x100, 128x128, 150x150, 200x200, etc.
    const smallDimensionPattern = /[_\-\/]?(\d{2,3})x(\d{2,3})[_\-\.\/]/;
    const match = lower.match(smallDimensionPattern);
    if (match) {
      const width = parseInt(match[1]);
      const height = parseInt(match[2]);
      // If both dimensions are under 300, it's likely a logo/icon
      if (width < 300 && height < 300) {
        return true;
      }
    }

    return false;
  }

  function extractImageData(img) {
    const src = img.src || img.dataset.src || img.dataset.lazySrc || '';
    const alt = img.alt || '';
    const srcset = img.getAttribute('srcset') || '';
    const sizes = img.getAttribute('sizes') || '';

    // If inside a <picture>, also grab <source> srcsets
    let sourceElements = [];
    const picture = img.closest('picture');
    if (picture) {
      for (const source of picture.querySelectorAll('source')) {
        const sSrcset = source.getAttribute('srcset');
        if (sSrcset) {
          sourceElements.push({
            srcset: sSrcset,
            type: source.getAttribute('type') || '',
            media: source.getAttribute('media') || '',
            sizes: source.getAttribute('sizes') || '',
          });
        }
      }
    }

    // Try to find caption
    let caption = '';

    // First check if inside a figure
    const figure = img.closest('figure');
    if (figure) {
      const figcaption = figure.querySelector('figcaption');
      if (figcaption) {
        caption = figcaption.textContent.trim();
      }
    }

    // If no caption yet, look for figcaption in nearby container
    // (handles sites like The Verge that use figcaption without figure)
    if (!caption) {
      let container = img.parentElement;
      let depth = 0;
      while (container && depth < 4 && !caption) {
        const figcaption = container.querySelector('figcaption');
        if (figcaption) {
          caption = figcaption.textContent.trim();
        }
        container = container.parentElement;
        depth++;
      }
    }

    return { src: makeAbsolute(src), alt, caption, srcset, sizes, sourceElements };
  }

  function makeAbsolute(url) {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) {
      return url.startsWith('//') ? 'https:' + url : url;
    }
    try {
      return new URL(url, window.location.href).href;
    } catch (e) {
      return url;
    }
  }

  function checkForLeadImage(content) {
    // Check if the article content starts with an image (figure or img)
    const temp = document.createElement('div');
    temp.innerHTML = content;

    // Walk the DOM to find the first "content" element (skipping wrapper divs)
    // Content elements are: p, figure, img, h1-h6, blockquote, ul, ol, table, pre
    const contentTags = ['P', 'FIGURE', 'IMG', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'TABLE', 'PRE'];

    function findFirstContentElement(el) {
      for (const child of el.children) {
        if (contentTags.includes(child.tagName)) {
          return child;
        }
        // If it's a div/section/article, look inside it
        if (['DIV', 'SECTION', 'ARTICLE'].includes(child.tagName)) {
          const found = findFirstContentElement(child);
          if (found) return found;
        }
      }
      return null;
    }

    const firstContent = findFirstContentElement(temp);
    if (!firstContent) return false;

    // Check if the first content element is an image or figure with image
    if (firstContent.tagName === 'IMG') {
      return true;
    }
    if (firstContent.tagName === 'FIGURE' && firstContent.querySelector('img')) {
      return true;
    }

    return false;
  }

  // Preprocess author bios to remove them before Readability
  // The Verge uses spans with "dangerously-set-cms-markup" class for author bios
  function preprocessAuthorBios(doc) {
    // Target spans with The Verge's CMS markup class that contain author bios
    const bioSpans = doc.querySelectorAll('span[class*="dangerously-set-cms-markup"]');

    for (const span of bioSpans) {
      const text = span.textContent.trim();
      // Check if it starts with "is a/an [words] [job title]"
      if (/^is\s+(an?\s+)?/i.test(text)) {
        // Remove the bio span and its preceding author name span if present
        const parent = span.parentElement;
        if (parent) {
          // The author name span typically comes right before in the same container
          // Remove the entire parent container to get both name and bio
          parent.remove();
        } else {
          span.remove();
        }
      }
    }
  }

  // Preprocess image containers to prevent Readability from stripping them
  // Converts divs with "media" in class name to <figure> elements
  // Some sites (e.g., Ars Technica) split article content into multiple containers
  // with ads between them. Readability scores each independently and may only pick
  // the largest chunk, losing the rest. Merge them before Readability runs.
  function preprocessSplitContent(doc) {
    // Look for multiple sibling-ish containers with the same content class
    const contentSelectors = [
      '.post-content',
      '.article-content',
      '.entry-content',
      '.story-body',
    ];

    for (const selector of contentSelectors) {
      const containers = doc.querySelectorAll(selector);
      if (containers.length < 2) continue;

      // Use the first container as the merge target
      const first = containers[0];

      for (let i = 1; i < containers.length; i++) {
        // Move all children from subsequent containers into the first
        while (containers[i].firstChild) {
          first.appendChild(containers[i].firstChild);
        }
        // Remove the now-empty container
        containers[i].remove();
      }

      // Also remove ad containers that were between the content divs
      // (they're now orphaned siblings or already outside)
      break; // Only process the first matching selector
    }
  }

  // Substack wraps images in <a> tags with overlay buttons inside <figure>.
  // Readability sees a bad link-to-text ratio and strips the whole link, losing the image.
  // Fix: extract the <img> out of the link and place it directly in the <figure>.
  function preprocessSubstackImages(doc) {
    // Substack-specific: the link has both image-link and image2 classes,
    // and contains a div.image2-inset with a <picture> element
    const links = doc.querySelectorAll('figure a.image-link.image2');
    for (const link of links) {
      const figure = link.closest('figure');
      if (!figure) continue;

      const img = link.querySelector('img');
      if (!img) continue;

      // Insert the img directly into the figure, before the link
      figure.insertBefore(img, link);

      // Remove the link (contains buttons, SVGs, picture/source elements we don't need)
      link.remove();
    }
  }

  function preprocessImageContainers(doc) {
    // Readability's negative pattern includes "media", which strips divs like "media-wrapper"
    // Find divs that contain images and have problematic class names
    const mediaPattern = /media|image-container|img-wrapper|photo-wrapper/i;
    const divs = doc.querySelectorAll('div');

    for (const div of divs) {
      const className = div.className || '';
      if (!mediaPattern.test(className)) continue;

      // Check if this div contains an image
      const img = div.querySelector('img');
      if (!img) continue;

      // Remove "view full size" links and other icon-only links before converting
      const iconLinks = div.querySelectorAll('a svg, a[class*="full-size"], a[class*="zoom"], a[class*="expand"]');
      for (const el of iconLinks) {
        // Remove the parent link if it only contains an SVG
        const link = el.closest('a');
        if (link && link.querySelector('svg') && !link.textContent.trim()) {
          link.remove();
        } else if (el.tagName === 'svg') {
          el.remove();
        }
      }

      // Convert div to figure
      const figure = doc.createElement('figure');

      // Copy attributes except class (to avoid triggering negative patterns)
      for (const attr of div.attributes) {
        if (attr.name !== 'class') {
          figure.setAttribute(attr.name, attr.value);
        }
      }

      // Move children to figure
      while (div.firstChild) {
        const child = div.firstChild;

        // Convert caption paragraphs to figcaption
        if (child.nodeType === 1 && child.tagName === 'P' &&
            /caption|credit/i.test(child.className || '')) {
          const figcaption = doc.createElement('figcaption');
          figcaption.innerHTML = child.innerHTML;
          figure.appendChild(figcaption);
          child.remove();
        } else {
          figure.appendChild(child);
        }
      }

      // Replace the div with the figure
      div.parentNode.replaceChild(figure, div);
    }
  }

  // Helper function to escape HTML
  function escapeHTML(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // Helper function to escape HTML attributes
  function escapeAttr(str) {
    if (!str) return "";
    return str.replace(/&/g, '&amp;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');
  }

  // Inline styles for reader view
  function getInlineStyles() {
    return `
      :root {
        --reader-bg: #f8f8f8;
        --reader-card-bg: #ffffff;
        --reader-text: #1d1d1f;
        --reader-text-secondary: #6e6e73;
        --reader-link: #0066cc;
        --reader-link-visited: #551a8b;
        --reader-border: #e5e5e5;
        --reader-code-bg: #f5f5f7;
        --reader-blockquote-border: #d2d2d7;
        --reader-selection: rgba(0, 102, 204, 0.2);
        --reader-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 8px 30px rgba(0, 0, 0, 0.06);
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --reader-bg: #121212;
          --reader-card-bg: #1e1e1e;
          --reader-text: #e8e8e8;
          --reader-text-secondary: #a1a1a6;
          --reader-link: #6bb8ff;
          --reader-link-visited: #c792ea;
          --reader-border: #333333;
          --reader-code-bg: #2a2a2a;
          --reader-blockquote-border: #404040;
          --reader-selection: rgba(107, 184, 255, 0.3);
          --reader-shadow: 0 1px 3px rgba(0, 0, 0, 0.3), 0 8px 30px rgba(0, 0, 0, 0.25);
        }
      }

      * { box-sizing: border-box; }

      html {
        font-size: 18px;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }

      body.readr-active {
        margin: 0;
        padding: 0;
        background-color: var(--reader-bg);
        color: var(--reader-text);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
          "Helvetica Neue", Arial, sans-serif;
        line-height: 1.7;
        min-height: 100vh;
      }

      ::selection { background: var(--reader-selection); }

      /* Page wrapper for background */
      .readr-page {
        min-height: 100vh;
        padding: 40px 24px 80px;
      }

      /* Card container - Safari-inspired */
      .readr-container {
        max-width: 840px;
        margin: 0 auto;
        background: var(--reader-card-bg);
        border-radius: 12px;
        box-shadow: var(--reader-shadow);
        padding: 48px 56px 56px;
        position: relative;
      }

      .readr-close {
        position: fixed;
        top: 20px;
        inset-inline-end: 20px;
        width: 36px;
        height: 36px;
        border: none;
        border-radius: 50%;
        background: var(--reader-card-bg);
        color: var(--reader-text-secondary);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: var(--reader-shadow);
        opacity: 0.9;
        transition: opacity 0.2s ease, transform 0.15s ease;
        z-index: 1000;
      }

      .readr-close:hover {
        opacity: 1;
        transform: scale(1.05);
      }

      .readr-close:active {
        transform: scale(0.95);
      }

      .readr-close:focus {
        outline: 2px solid var(--reader-link);
        outline-offset: 2px;
      }

      .readr-close svg {
        width: 14px;
        height: 14px;
      }

      .readr-header {
        margin-bottom: 32px;
        padding-bottom: 24px;
        border-bottom: 1px solid var(--reader-border);
      }

      .readr-title {
        font-size: 2rem;
        font-weight: 700;
        line-height: 1.25;
        margin: 0 0 16px;
        letter-spacing: -0.025em;
        color: var(--reader-text);
      }

      .readr-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 16px;
        color: var(--reader-text-secondary);
        font-size: 0.9rem;
      }

      .readr-byline { font-style: normal; }

      .readr-site {
        color: var(--reader-text-secondary);
      }

      .readr-site::before {
        content: "\\2022";
        margin-inline-end: 16px;
        opacity: 0.5;
      }

      .readr-site-only::before {
        content: none;
      }

      .readr-excerpt {
        margin: 16px 0 0;
        color: var(--reader-text-secondary);
        font-size: 0.9rem;
        font-style: italic;
        line-height: 1.5;
      }

      /* Hero image */
      .readr-hero {
        margin: 0 -56px 32px;
        padding: 0;
      }

      .readr-hero img {
        width: 100%;
        height: auto;
        display: block;
        border-radius: 0;
      }

      .readr-hero figcaption {
        margin-top: 12px;
        padding: 0 56px;
        color: var(--reader-text-secondary);
        font-size: 0.85rem;
        text-align: center;
      }

      .readr-content { font-size: 1.05rem; }
      .readr-content p { margin: 0 0 1.4em; }

      .readr-content h1, .readr-content h2, .readr-content h3,
      .readr-content h4, .readr-content h5, .readr-content h6 {
        margin: 1.8em 0 0.7em;
        line-height: 1.3;
        font-weight: 600;
        letter-spacing: -0.01em;
        color: var(--reader-text);
      }

      .readr-content h1 { font-size: 1.6rem; }
      .readr-content h2 { font-size: 1.4rem; }
      .readr-content h3 { font-size: 1.2rem; }
      .readr-content h4, .readr-content h5, .readr-content h6 { font-size: 1.05rem; }

      .readr-content a {
        color: var(--reader-link);
        text-decoration: underline;
        text-decoration-thickness: 1px;
        text-underline-offset: 2px;
        transition: color 0.15s ease;
      }

      .readr-content a:visited { color: var(--reader-link-visited); }
      .readr-content a:hover { text-decoration-thickness: 2px; }

      .readr-content img {
        max-width: 100%;
        height: auto;
        display: block;
        margin: 1.5em auto;
        border-radius: 6px;
      }

      .readr-content figure {
        margin: 2em -20px;
        padding: 0;
      }

      .readr-content figcaption {
        margin-top: 10px;
        padding: 0 20px;
        color: var(--reader-text-secondary);
        font-size: 0.85rem;
        text-align: center;
      }

      .readr-content blockquote {
        margin: 1.5em 0;
        padding: 0;
        padding-inline-start: 20px;
        border-inline-start: 3px solid var(--reader-blockquote-border);
        color: var(--reader-text-secondary);
        font-style: italic;
      }

      .readr-content blockquote p:last-child { margin-bottom: 0; }

      .readr-content code {
        font-family: "SF Mono", SFMono-Regular, ui-monospace, Menlo, Monaco,
          "Cascadia Mono", "Segoe UI Mono", monospace;
        font-size: 0.88em;
        background: var(--reader-code-bg);
        padding: 2px 6px;
        border-radius: 4px;
      }

      .readr-content pre {
        margin: 1.5em -20px;
        padding: 16px 20px;
        background: var(--reader-code-bg);
        border-radius: 8px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }

      .readr-content pre code {
        background: none;
        padding: 0;
        font-size: 0.85rem;
        line-height: 1.6;
      }

      .readr-content ul, .readr-content ol {
        margin: 1.4em 0;
        padding-inline-start: 1.5em;
      }

      .readr-content li { margin-bottom: 0.4em; }
      .readr-content li > ul, .readr-content li > ol { margin: 0.4em 0; }

      /* Table container - holds the fixed gradient overlay */
      .readr-table-container {
        position: relative;
        margin: 1.5em -20px;
      }

      /* Inner scroll wrapper */
      .readr-table-scroll {
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }

      /* Scroll indicator gradient - fixed to container edge */
      .readr-table-container::after {
        content: '';
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        width: 40px;
        background: linear-gradient(to right, transparent, var(--reader-card-bg));
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      /* Show gradient when scrollable */
      .readr-table-container.is-scrollable::after {
        opacity: 1;
      }

      .readr-content table {
        min-width: 100%;
        margin: 0;
        padding: 0 20px;
        border-collapse: collapse;
        font-size: 0.95rem;
      }

      .readr-content th, .readr-content td {
        padding: 12px 16px;
        text-align: start;
        border-bottom: 1px solid var(--reader-border);
        white-space: nowrap;
      }

      .readr-content th {
        font-weight: 600;
        background: var(--reader-code-bg);
      }

      .readr-content th:first-child,
      .readr-content td:first-child {
        padding-left: 20px;
      }

      .readr-content th:last-child,
      .readr-content td:last-child {
        padding-right: 20px;
      }

      .readr-content tr:last-child td { border-bottom: none; }

      .readr-content hr {
        margin: 2.5em 0;
        border: none;
        border-top: 1px solid var(--reader-border);
      }

      .readr-content sup {
        font-size: 0.75em;
        vertical-align: super;
        line-height: 0;
      }

      .readr-content sup a { text-decoration: none; }

      .readr-content iframe, .readr-content video {
        max-width: 100%;
        margin: 1.5em auto;
        display: block;
        border-radius: 6px;
      }

      /* Responsive */
      @media (max-width: 900px) {
        .readr-page {
          padding: 24px 16px 60px;
        }

        .readr-container {
          padding: 32px 28px 40px;
          border-radius: 10px;
        }

        .readr-hero {
          margin-left: -28px;
          margin-right: -28px;
        }

        .readr-hero figcaption {
          padding: 0 28px;
        }

        .readr-content figure {
          margin-left: -12px;
          margin-right: -12px;
        }

        .readr-content pre {
          margin-left: -12px;
          margin-right: -12px;
          border-radius: 0;
        }

        .readr-table-container {
          margin-left: -12px;
          margin-right: -12px;
        }

        .readr-content table {
          padding: 0 12px;
        }

        .readr-content th:first-child,
        .readr-content td:first-child {
          padding-left: 12px;
        }

        .readr-content th:last-child,
        .readr-content td:last-child {
          padding-right: 12px;
        }
      }

      @media (max-width: 600px) {
        html { font-size: 16px; }

        .readr-page {
          padding: 16px 12px 50px;
        }

        .readr-container {
          padding: 24px 20px 32px;
          border-radius: 8px;
        }

        .readr-hero {
          margin-left: -20px;
          margin-right: -20px;
        }

        .readr-hero figcaption {
          padding: 0 20px;
        }

        .readr-title { font-size: 1.6rem; }

        .readr-close {
          top: 12px;
          inset-inline-end: 12px;
          width: 32px;
          height: 32px;
        }

        .readr-close svg {
          width: 12px;
          height: 12px;
        }

        .readr-content figure,
        .readr-content pre,
        .readr-table-container {
          margin-left: -8px;
          margin-right: -8px;
        }

        .readr-content table {
          padding: 0 8px;
        }

        .readr-content th:first-child,
        .readr-content td:first-child {
          padding-left: 8px;
        }

        .readr-content th:last-child,
        .readr-content td:last-child {
          padding-right: 8px;
        }
      }

      /* X/Twitter thread styles */
      .readr-x-author {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin-bottom: 8px;
      }

      .readr-x-name {
        font-size: 1.4rem;
        font-weight: 700;
        color: var(--reader-text);
        line-height: 1.3;
      }

      .readr-x-handle {
        font-size: 0.95rem;
        color: var(--reader-text-secondary);
        font-weight: 400;
      }

      .readr-x-sep {
        display: flex;
        justify-content: center;
        margin: 1.2em 0;
      }

      .readr-x-sep::before {
        content: '';
        width: 40px;
        height: 1.5px;
        background: var(--reader-border);
        opacity: 0.75;
      }

      @media print {
        .readr-close { display: none; }
        .readr-page { padding: 0; }
        .readr-container {
          max-width: none;
          padding: 0;
          box-shadow: none;
          border-radius: 0;
        }
        .readr-hero { margin: 0 0 24px; }
        body.readr-active { background: white; color: black; }
      }
    `;
  }
})();
