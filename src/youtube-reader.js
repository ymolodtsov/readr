// Readr - YouTube Reader Mode
// Runs as an extension page (chrome-extension:// origin) so YouTube embeds work

(async function () {
  // Video ID and return URL come from URL params (always available)
  const params = new URLSearchParams(location.search);
  const videoId = params.get("v");
  const returnUrl = params.get("returnUrl");

  if (!videoId) {
    document.title = "Readr";
    document.body.textContent = "No video data. Click the Readr icon on a YouTube video.";
    return;
  }

  // Extra data (chapters, transcript) comes from session storage (best-effort)
  let title = "", channel = "", chapters = [], transcriptText = "";
  try {
    const { readrYTData } = await chrome.storage.session.get("readrYTData");
    if (readrYTData) {
      await chrome.storage.session.remove("readrYTData");
      title = readrYTData.title || "";
      channel = readrYTData.channel || "";
      chapters = readrYTData.chapters || [];
      transcriptText = readrYTData.transcriptText || "";
    }
  } catch {
    // storage.session may not be available - video embed still works
  }

  // Parse transcript
  const segments = parseTranscript(transcriptText || "");
  const hasChapters = chapters.length > 0;
  const hasTranscript = segments.length > 0;

  // Build chapters HTML
  const chaptersHTML = hasChapters
    ? chapters
        .map(
          (ch) =>
            `<div class="readr-yt-chapter" data-time="${ch.time}">
        <span class="readr-yt-chapter-time">${formatTime(ch.time)}</span>
        <span class="readr-yt-chapter-title">${esc(ch.title)}</span>
      </div>`
        )
        .join("")
    : "";

  // Build transcript HTML
  const transcriptHTML = hasTranscript ? buildTranscriptHTML(segments, chapters) : "";

  // Build and write the full page
  document.open();
  document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#121212" media="(prefers-color-scheme: dark)">
  <title>${esc(title || "Readr")}</title>
  <style>${getStyles()}</style>
</head>
<body class="readr-active readr-yt">
  <button class="readr-close" title="Exit Reader View" aria-label="Exit Reader View">
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  </button>
  <div class="readr-yt-layout ${hasChapters ? "has-chapters" : ""}">
    ${
      hasChapters
        ? `
    <aside class="readr-yt-chapters">
      <h2 class="readr-yt-chapters-heading">CHAPTERS</h2>
      ${chaptersHTML}
    </aside>`
        : ""
    }
    <div class="readr-yt-video">
      <iframe id="readr-yt-player"
        src="https://www.youtube.com/embed/${esc(encodeURIComponent(videoId))}?autoplay=0&rel=0&playsinline=1"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen></iframe>
      <h1 class="readr-yt-title">${esc(title)}</h1>
      ${channel ? `<p class="readr-yt-channel">${esc(channel)}</p>` : ""}
    </div>
    ${
      hasTranscript
        ? `
    <div class="readr-yt-transcript-wrap">
      <h2 class="readr-yt-transcript-heading">Transcript</h2>
      ${transcriptHTML}
    </div>`
        : ""
    }
  </div>
</body>
</html>`);
  document.close();

  // Close button → go back to YouTube
  document.querySelector(".readr-close").addEventListener("click", () => {
    if (returnUrl) {
      window.location.href = returnUrl;
    } else {
      history.back();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (returnUrl) {
        window.location.href = returnUrl;
      } else {
        history.back();
      }
    }
  });

  // Set up seeking and chapter tracking
  setupInteractivity();

  // --- Helper functions ---

  function parseTranscript(text) {
    if (!text) return [];
    const trimmed = text.trim();
    // XML format (srv1)
    if (trimmed.startsWith("<?xml") || trimmed.startsWith("<transcript")) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, "text/xml");
      const nodes = doc.querySelectorAll("text");
      const segments = [];
      for (const t of nodes) {
        const txt = t.textContent.trim();
        if (txt) {
          segments.push({
            start: parseFloat(t.getAttribute("start")) || 0,
            dur: parseFloat(t.getAttribute("dur")) || 0,
            text: txt,
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
          .filter((e) => e.segs)
          .map((e) => ({
            start: (e.tStartMs || 0) / 1000,
            dur: (e.dDurationMs || 0) / 1000,
            text: e.segs
              .map((s) => s.utf8 || "")
              .join("")
              .trim(),
          }))
          .filter((s) => s.text);
      }
    } catch {}
    return [];
  }

  function buildTranscriptHTML(segments, chapters) {
    if (!segments.length) return "";
    if (!chapters.length) return buildSection(null, segments);
    let html = "";
    for (let i = 0; i < chapters.length; i++) {
      const start = chapters[i].time;
      const end = i + 1 < chapters.length ? chapters[i + 1].time : Infinity;
      const segs = segments.filter((s) => s.start >= start && s.start < end);
      if (segs.length) html += buildSection(chapters[i].title, segs);
    }
    return html;
  }

  function buildSection(title, segments) {
    let html = '<div class="readr-yt-transcript-section">';
    if (title) html += `<h3>${esc(title)}</h3>`;
    const INTERVAL = 60;
    let paraStart = segments[0].start;
    let texts = [];
    for (const seg of segments) {
      if (seg.start - paraStart >= INTERVAL && texts.length) {
        html += `<p><a class="readr-yt-ts" data-time="${paraStart}">${formatTime(paraStart)}</a> &middot; ${texts.join(" ")}</p>`;
        paraStart = seg.start;
        texts = [];
      }
      texts.push(esc(seg.text));
    }
    if (texts.length) {
      html += `<p><a class="readr-yt-ts" data-time="${paraStart}">${formatTime(paraStart)}</a> &middot; ${texts.join(" ")}</p>`;
    }
    html += "</div>";
    return html;
  }

  function formatTime(seconds) {
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  function esc(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function setupInteractivity() {
    const iframe = document.getElementById("readr-yt-player");
    if (!iframe) return;

    // Seeking without enablejsapi (not supported from chrome-extension:// origins).
    // Reload the iframe with start= parameter and autoplay.
    function seekTo(seconds) {
      const s = Math.max(0, Math.floor(seconds));
      iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&start=${s}&rel=0&playsinline=1`;
    }

    // Chapter clicks
    document.querySelectorAll(".readr-yt-chapter").forEach((el) => {
      el.addEventListener("click", () => {
        seekTo(parseFloat(el.dataset.time));
        // Highlight clicked chapter
        document.querySelectorAll(".readr-yt-chapter").forEach((c) => c.classList.remove("active"));
        el.classList.add("active");
      });
    });

    // Transcript timestamp clicks
    document.querySelectorAll(".readr-yt-ts").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        seekTo(parseFloat(el.dataset.time));
      });
    });
  }

  function getStyles() {
    return `
      :root {
        --reader-bg: #f8f8f8;
        --reader-text: #1d1d1f;
        --reader-text-secondary: #6e6e73;
        --reader-link: #0066cc;
        --reader-border: #e5e5e5;
        --reader-code-bg: #f5f5f7;
        --reader-selection: rgba(0, 102, 204, 0.2);
        --reader-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 8px 30px rgba(0, 0, 0, 0.06);
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --reader-bg: #121212;
          --reader-text: #e8e8e8;
          --reader-text-secondary: #a1a1a6;
          --reader-link: #6bb8ff;
          --reader-border: #333333;
          --reader-code-bg: #2a2a2a;
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
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        line-height: 1.7;
        min-height: 100vh;
      }

      ::selection { background: var(--reader-selection); }

      .readr-close {
        position: fixed;
        top: 20px;
        right: 20px;
        width: 36px;
        height: 36px;
        border: none;
        border-radius: 50%;
        background: var(--reader-code-bg);
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
      .readr-close:hover { opacity: 1; transform: scale(1.05); }
      .readr-close:active { transform: scale(0.95); }
      .readr-close:focus { outline: 2px solid var(--reader-link); outline-offset: 2px; }
      .readr-close svg { width: 14px; height: 14px; }

      /* YouTube layout */
      .readr-yt-layout {
        min-height: 100vh;
        padding: 40px;
        max-width: 900px;
        margin: 0 auto;
      }

      .readr-yt-layout.has-chapters {
        display: grid;
        grid-template-columns: 280px 1fr;
        grid-template-rows: auto 1fr;
        grid-template-areas:
          "chapters video"
          "chapters transcript";
        gap: 0;
        max-width: 1200px;
        padding: 0;
      }

      .readr-yt-chapters {
        grid-area: chapters;
        padding: 40px 24px;
        position: sticky;
        top: 0;
        height: 100vh;
        overflow-y: auto;
      }

      .readr-yt-chapters-heading {
        font-size: 0.75rem;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--reader-text-secondary);
        margin: 0 0 20px;
      }

      .readr-yt-chapter {
        display: flex;
        gap: 16px;
        padding: 10px 12px;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.15s;
        margin: 0 -12px;
      }
      .readr-yt-chapter:hover { background: var(--reader-code-bg); }
      .readr-yt-chapter.active { background: var(--reader-code-bg); }
      .readr-yt-chapter.active .readr-yt-chapter-time { color: var(--reader-link); }

      .readr-yt-chapter-time {
        font-family: "SF Mono", SFMono-Regular, ui-monospace, Menlo, monospace;
        font-size: 0.85rem;
        color: var(--reader-text-secondary);
        white-space: nowrap;
        min-width: 40px;
      }

      .readr-yt-chapter-title {
        font-size: 0.9rem;
        color: var(--reader-text);
        line-height: 1.4;
      }

      .readr-yt-video {
        grid-area: video;
        padding: 40px 40px 0;
      }
      .readr-yt-layout:not(.has-chapters) .readr-yt-video { padding: 0; }

      .readr-yt-video iframe {
        width: 100%;
        aspect-ratio: 16/9;
        border: none;
        border-radius: 8px;
        display: block;
      }

      .readr-yt-title {
        font-size: 1.3rem;
        font-weight: 600;
        margin: 20px 0 4px;
        line-height: 1.3;
        letter-spacing: -0.01em;
        color: var(--reader-text);
      }

      .readr-yt-channel {
        margin: 0;
        color: var(--reader-text-secondary);
        font-size: 0.9rem;
      }

      .readr-yt-transcript-wrap {
        grid-area: transcript;
        padding: 32px 40px 80px;
      }
      .readr-yt-layout:not(.has-chapters) .readr-yt-transcript-wrap { padding: 32px 0 80px; }

      .readr-yt-transcript-heading {
        font-size: 1.3rem;
        font-weight: 600;
        margin: 0 0 24px;
        color: var(--reader-text);
      }

      .readr-yt-transcript-section h3 {
        font-size: 1.1rem;
        font-weight: 600;
        margin: 28px 0 12px;
        color: var(--reader-text);
      }
      .readr-yt-transcript-section:first-child h3:first-child { margin-top: 0; }

      .readr-yt-transcript-section p {
        margin: 0 0 16px;
        line-height: 1.7;
        font-size: 1rem;
        color: var(--reader-text);
      }

      .readr-yt-ts {
        color: var(--reader-link);
        text-decoration: underline;
        text-decoration-thickness: 1px;
        text-underline-offset: 2px;
        cursor: pointer;
        font-weight: 600;
      }
      .readr-yt-ts:hover { text-decoration-thickness: 2px; }

      @media (max-width: 900px) {
        .readr-yt-layout.has-chapters {
          grid-template-columns: 1fr;
          grid-template-rows: auto auto auto;
          grid-template-areas: "video" "chapters" "transcript";
        }
        .readr-yt-chapters {
          position: static;
          height: auto;
          border-right: none;
          border-top: 1px solid var(--reader-border);
          border-bottom: 1px solid var(--reader-border);
          padding: 24px;
        }
        .readr-yt-video,
        .readr-yt-layout.has-chapters .readr-yt-video { padding: 24px 24px 0; }
        .readr-yt-transcript-wrap,
        .readr-yt-layout.has-chapters .readr-yt-transcript-wrap { padding: 24px 24px 60px; }
      }

      @media (max-width: 600px) {
        .readr-yt-layout { padding: 16px; }
        .readr-yt-video,
        .readr-yt-layout.has-chapters .readr-yt-video { padding: 16px 16px 0; }
        .readr-yt-chapters { padding: 20px 16px; }
        .readr-yt-transcript-wrap,
        .readr-yt-layout.has-chapters .readr-yt-transcript-wrap { padding: 20px 16px 50px; }
        .readr-yt-title { font-size: 1.1rem; }
      }

      @media print {
        .readr-close { display: none; }
        .readr-yt-chapters { display: none; }
        .readr-yt-video iframe { display: none; }
      }
    `;
  }
})();
