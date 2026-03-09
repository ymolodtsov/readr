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

  // Preprocess: Convert image wrapper divs to figures
  // Readability's negative regex matches "media" in class names like "media-wrapper",
  // causing it to strip these divs. Converting to <figure> gives them protection.
  preprocessImageContainers(documentClone);

  // Parse the article using Readability
  const reader = new Readability(documentClone);
  const article = reader.parse();

  if (!article) {
    alert("Readr couldn't extract article content from this page.");
    sessionStorage.removeItem("__readrActive");
    return;
  }

  // Clean up the byline (Readability sometimes concatenates metadata)
  const cleanedByline = cleanByline(article.byline);

  // Look for hero image, but skip if the content already starts with an image
  let heroImageHTML = '';
  const contentHasLeadImage = checkForLeadImage(article.content);
  if (!contentHasLeadImage) {
    const heroImage = findHeroImage();
    if (heroImage) {
      heroImageHTML = `<figure class="readr-hero"><img src="${escapeAttr(heroImage.src)}" alt="${escapeAttr(heroImage.alt || '')}">${heroImage.caption ? `<figcaption>${escapeHTML(heroImage.caption)}</figcaption>` : ''}</figure>`;
    }
  }

  // Clean up the article content
  let cleanedContent = trimTrailingStructuralElements(article.content);
  cleanedContent = removeTinyImages(cleanedContent);
  cleanedContent = removeOrphanedBios(cleanedContent);
  cleanedContent = removeImageOnlyParagraphs(cleanedContent);
  cleanedContent = deduplicateImages(cleanedContent);

  // Build the reader view
  const readerHTML = `
    <!DOCTYPE html>
    <html lang="${document.documentElement.lang || "en"}" dir="${docDir}">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
            <h1 class="readr-title">${escapeHTML(article.title)}</h1>
            ${cleanedByline || article.siteName ? `
            <div class="readr-meta">
              ${cleanedByline ? `<span class="readr-byline">${escapeHTML(cleanedByline)}</span>` : ""}
              ${article.siteName ? `<span class="readr-site${cleanedByline ? '' : ' readr-site-only'}">${escapeHTML(article.siteName)}</span>` : ""}
            </div>
            ` : ""}
            ${article.excerpt ? `<p class="readr-excerpt">${escapeHTML(article.excerpt)}</p>` : ""}
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

  // DEBUG: Add test overlay showing raw Readability output
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
  //     <span>Readability Raw Output</span>
  //     <button id="readr-debug-copy">Copy</button>
  //     <span onclick="document.getElementById('readr-debug').remove()">✕</span>
  //   </div>
  //   <div id="readr-debug-content">
  //     <h4>title</h4>
  //     <pre>${escapeHTML(article.title)}</pre>
  //     <h4>byline</h4>
  //     <pre>${escapeHTML(article.byline || '(none)')}</pre>
  //     <h4>siteName</h4>
  //     <pre>${escapeHTML(article.siteName || '(none)')}</pre>
  //     <h4>excerpt</h4>
  //     <pre>${escapeHTML(article.excerpt || '(none)')}</pre>
  //     <h4>content (raw HTML)</h4>
  //     <pre>${escapeHTML(article.content)}</pre>
  //   </div>
  // `;
  // document.body.appendChild(debugOverlay);
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

  // Remove orphaned author bios - paragraphs starting with "is [job title]"
  // This happens when Readability extracts the author name to byline but leaves the bio
  function removeOrphanedBios(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html;

    const paragraphs = temp.querySelectorAll('p');
    for (const p of paragraphs) {
      const text = p.textContent.trim();
      // Match "is [optional a/an] [optional adjective] [job title]" at the start
      if (/^is\s+(an?\s+)?(\w+[\s-])*?(editor|writer|reporter|journalist|correspondent|contributor|columnist|critic|analyst|producer|photographer|author|host|co-host)\b/i.test(text)) {
        removeElementAndCleanup(p);
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

    // Check if this is actually an orphaned bio fragment (no author name)
    // e.g., "is editor-at-large and Vergecast co-host..." without the name
    if (/^is\s+(an?\s+)?(\w+[\s-])*?(editor|writer|reporter|journalist|correspondent|contributor|columnist|critic|analyst|producer|photographer|author|host|co-host)\b/i.test(cleaned)) {
      return '';
    }

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

    return { src: makeAbsolute(src), alt, caption };
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

  // Preprocess image containers to prevent Readability from stripping them
  // Converts divs with "media" in class name to <figure> elements
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

      .readr-content table {
        width: 100%;
        margin: 1.5em 0;
        border-collapse: collapse;
        font-size: 0.95rem;
      }

      .readr-content th, .readr-content td {
        padding: 12px 16px;
        text-align: start;
        border-bottom: 1px solid var(--reader-border);
      }

      .readr-content th {
        font-weight: 600;
        background: var(--reader-code-bg);
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
        .readr-content pre {
          margin-left: -8px;
          margin-right: -8px;
        }
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
