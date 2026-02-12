// Readr - Content Script
// Activates reader mode on the current page

(function () {
  // Prevent running multiple times
  if (document.body.classList.contains("readr-active")) {
    return;
  }

  // Mark that we're in reader mode (for toggle detection)
  sessionStorage.setItem("__readrActive", "true");

  // Clone the document for Readability parsing
  const documentClone = document.cloneNode(true);

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

  // Look for hero image, but skip if the same image is already at the start of Readability's content
  let heroImageHTML = '';
  const heroImage = findHeroImage();
  // console.log(`[Readr] findHeroImage returned: ${heroImage ? heroImage.src?.substring(0, 60) + '...' : 'null'}`);
  if (heroImage) {
    const isDuplicate = isHeroImageInContent(heroImage.src, article.content);
    // console.log(`[Readr] isHeroImageInContent: ${isDuplicate}`);
    if (!isDuplicate) {
      heroImageHTML = `<figure class="readr-hero"><img src="${escapeAttr(heroImage.src)}" alt="${escapeAttr(heroImage.alt || '')}">${heroImage.caption ? `<figcaption>${escapeHTML(heroImage.caption)}</figcaption>` : ''}</figure>`;
    }
  }

  // Clean up trailing structural elements (hr, headings without content)
  const cleanedContent = trimTrailingStructuralElements(article.content);

  // Build the reader view
  const readerHTML = `
    <!DOCTYPE html>
    <html lang="${document.documentElement.lang || "en"}">
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
        cleaned = cleaned.substring(0, bestBreak + (cleaned.charAt(bestBreak) === ',' ? 0 : 4));
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
    console.log('[Readr] findHeroImage called');

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
          } else {
            console.log('[Readr] Figure img failed isValidHeroImage');
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
      // console.log(`[Readr] Checking priority img: ${img.src?.substring(0, 60)}...`);
      if (isValidHeroImageLight(img)) {
        console.log('[Readr] Priority img passed validation');
        return extractImageData(img);
      } else {
        console.log('[Readr] Priority img failed isValidHeroImageLight');
      }
    }

    // 3. Look for images that have a figcaption nearby (semantic caption signal)
    // Sites like The Verge use figcaption without figure wrapper
    const captionedImg = findImageWithNearbyCaptions();
    // console.log(`[Readr] findImageWithNearbyCaptions returned: ${captionedImg ? 'img found' : 'null'}`);
    if (captionedImg && isValidHeroImageLight(captionedImg)) {
      return extractImageData(captionedImg);
    }

    console.log('[Readr] No hero image found');
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

    // Square-ish images (0.85 to 1.15 ratio) are often logos, not article images
    // Article hero images are typically landscape (16:9, 4:3, 3:2)
    if (aspectRatio >= 0.85 && aspectRatio <= 1.15) return false;

    // Run common checks
    return isValidHeroImageLight(img);
  }

  // Lighter validation for images with strong signals (fetchpriority="high", nearby figcaption)
  // Skips dimension checks since dimensions may not be available for CSS-sized images
  function isValidHeroImageLight(img) {
    // Check if image is visible
    const style = window.getComputedStyle(img);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      console.log('[Readr] isValidHeroImageLight: rejected - not visible');
      return false;
    }

    // Skip images inside nav, header (site header), footer, aside
    const parent = img.closest('nav, header, footer, aside, [role="navigation"], [role="banner"]');
    if (parent) {
      // console.log(`[Readr] isValidHeroImageLight: rejected - inside ${parent.tagName}`);
      return false;
    }

    // Skip tiny images and icons based on URL/class
    const src = img.src || img.dataset.src || '';
    if (isLikelyLogo(src)) {
      console.log('[Readr] isValidHeroImageLight: rejected - isLikelyLogo(src)');
      return false;
    }

    // Also check class name for logo indicators
    const className = (img.className || '').toLowerCase();
    if (className.includes('logo') || className.includes('brand') || className.includes('icon')) {
      console.log('[Readr] isValidHeroImageLight: rejected - logo/brand/icon in class');
      return false;
    }

    // Skip lazy-load placeholders
    if (src.includes('data:image/') && src.length < 1000) {
      console.log('[Readr] isValidHeroImageLight: rejected - data:image placeholder');
      return false;
    }
    if (img.classList.contains('lazy') && !img.src) {
      console.log('[Readr] isValidHeroImageLight: rejected - lazy without src');
      return false;
    }

    console.log('[Readr] isValidHeroImageLight: passed all checks');
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

  // Check if a hero image (by URL) is already in the first few elements of content
  function isHeroImageInContent(heroSrc, content) {
    if (!heroSrc) return false;

    const temp = document.createElement('div');
    temp.innerHTML = content;

    // Check first 3 top-level elements for this specific image
    const firstElements = temp.querySelectorAll(':scope > *:nth-child(-n+3)');
    for (const el of firstElements) {
      const imgs = el.tagName === 'IMG' ? [el] : el.querySelectorAll('img');
      for (const img of imgs) {
        const imgSrc = img.src || img.getAttribute('src') || '';
        // Compare base URLs (ignore query params which may differ)
        const heroBase = heroSrc.split('?')[0];
        const imgBase = imgSrc.split('?')[0];
        if (heroBase && imgBase && heroBase === imgBase) {
          return true;
        }
      }
    }
    return false;
  }

  function checkForLeadImage(content) {
    // Check if the article content has a legitimate lead image near the start
    const temp = document.createElement('div');
    temp.innerHTML = content;

    // Only check the first 3 top-level elements for a lead image
    // If the image isn't in the first few elements, it's not a lead image
    const firstElements = temp.querySelectorAll(':scope > *:nth-child(-n+3)');
    for (const el of firstElements) {
      let img = null;

      if (el.tagName === 'IMG') {
        img = el;
      } else if (el.tagName === 'FIGURE') {
        img = el.querySelector('img');
      } else {
        // Check if this element contains an image AND has minimal text
        // (to avoid matching paragraphs that happen to have inline images)
        const elText = el.textContent?.trim() || '';
        if (elText.length < 50) {
          img = el.querySelector('img');
        }
      }

      if (img && isLikelyLeadImage(img)) {
        // console.log(`[Readr] checkForLeadImage: found lead image in first elements: ${img.src?.substring(0, 80)}...`);
        return true;
      }
    }

    console.log('[Readr] checkForLeadImage: no lead image found in first 3 elements');
    return false;
  }

  function isLikelyLeadImage(img) {
    // Check if an image is likely a lead/hero image vs logo/avatar/author photo

    const src = (img.src || img.dataset.src || '').toLowerCase();
    const alt = (img.alt || '').toLowerCase();
    const className = (img.className || '').toLowerCase();
    const parentClass = (img.parentElement?.className || '').toLowerCase();

    // Skip obvious non-lead images based on class names
    const skipClasses = ['avatar', 'author', 'profile', 'logo', 'icon', 'thumbnail', 'thumb', 'gravatar', 'photo-author', 'byline'];
    for (const skip of skipClasses) {
      if (className.includes(skip) || parentClass.includes(skip)) {
        return false;
      }
    }

    // Skip based on alt text
    const skipAltPatterns = ['avatar', 'author', 'profile', 'headshot', 'portrait', 'logo', 'icon'];
    for (const pattern of skipAltPatterns) {
      if (alt.includes(pattern)) {
        return false;
      }
    }

    // Skip based on URL patterns
    const skipUrlPatterns = ['avatar', 'author', 'profile', 'gravatar', 'logo', 'icon', 'favicon', 'badge', 'thumb', 'thumbnail', '50x50', '64x64', '96x96', '100x100', '128x128', '150x150'];
    for (const pattern of skipUrlPatterns) {
      if (src.includes(pattern)) {
        return false;
      }
    }

    // Check explicit dimensions if available
    const width = parseInt(img.getAttribute('width')) || 0;
    const height = parseInt(img.getAttribute('height')) || 0;

    // If dimensions are set and small, it's not a lead image
    if ((width > 0 && width < 200) || (height > 0 && height < 150)) {
      return false;
    }

    // If dimensions are set and large enough, it's likely a lead image
    if (width >= 400 || height >= 250) {
      return true;
    }

    // Check if inside a figure (strong signal for lead image)
    if (img.closest('figure')) {
      return true;
    }

    // Check parent context - skip if in author/byline sections
    const parent = img.parentElement;
    if (parent) {
      const parentTag = parent.tagName.toLowerCase();
      const parentText = parent.textContent || '';

      // If the parent has very little text and isn't a figure, might be a standalone small image
      if (parentTag === 'p' && parentText.trim().length < 20) {
        // Could be a small inline image, be cautious
        // But if no dimensions are specified, give it benefit of the doubt
        return width === 0 && height === 0;
      }
    }

    // Default: if we can't determine, assume it might be a lead image
    // (better to not add a duplicate hero than to miss that there's already one)
    return true;
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
        right: 20px;
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
        margin-right: 16px;
        opacity: 0.5;
      }

      .readr-site-only::before {
        content: none;
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
        padding: 0 0 0 20px;
        border-left: 3px solid var(--reader-blockquote-border);
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
        padding-left: 1.5em;
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
        text-align: left;
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
          right: 12px;
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
