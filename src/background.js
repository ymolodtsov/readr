// Readr - Background Service Worker
// Handles extension icon click and injects content script

// Set uninstall survey URL
chrome.runtime.setUninstallURL('https://tally.so/r/RGzPAP');

chrome.action.onClicked.addListener(async (tab) => {
  // Don't run on chrome:// or edge:// pages
  if (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") ||
      tab.url.startsWith("chrome-extension://") || tab.url.startsWith("about:")) {
    return;
  }

  try {
    // Check if reader mode is already active (only check DOM state, not sessionStorage)
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body && document.body.classList.contains("readr-active"),
    });

    if (result.result) {
      // Reader mode is active, exit by reloading the page
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => location.reload(),
      });
      return;
    }

    // Clear any stale sessionStorage from previous sessions
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => sessionStorage.removeItem("__readrActive"),
    });

    // YouTube: extract data via MAIN world before injecting content script
    const isYouTube = /^https?:\/\/(www\.)?youtube\.com\/watch/i.test(tab.url);
    if (isYouTube) {
      const videoId = new URL(tab.url).searchParams.get("v");
      if (!videoId) return;

      // Strip CSP and X-Frame-Options from YouTube embed responses so the
      // player can initialize. Also strip CSP from the main frame to prevent
      // the parent page's CSP from interfering after DOM replacement.
      try {
        await chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [tab.id, tab.id + 100000, tab.id + 200000],
          addRules: [{
            id: tab.id,
            priority: 1,
            action: {
              type: "modifyHeaders",
              responseHeaders: [
                { header: "content-security-policy", operation: "remove" },
                { header: "x-frame-options", operation: "remove" },
              ],
            },
            condition: {
              tabIds: [tab.id],
              resourceTypes: ["sub_frame"],
            },
          }, {
            id: tab.id + 100000,
            priority: 1,
            action: {
              type: "modifyHeaders",
              responseHeaders: [
                { header: "content-security-policy", operation: "remove" },
              ],
            },
            condition: {
              tabIds: [tab.id],
              resourceTypes: ["main_frame"],
            },
          }],
        });
      } catch (e) {
        console.warn("Readr: failed to set CSP rule:", e);
      }

      // Extract YouTube data from page context (MAIN world bypasses CSP)
      let ytData = null;
      try {
        const [dataResult] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: () => {
            var pr = window.ytInitialPlayerResponse;
            if (!pr && window.ytplayer) pr = window.ytplayer.bootstrapPlayerResponse;
            if (!pr || !pr.videoDetails) return null;

            var title = pr.videoDetails.title || "";
            var channel = pr.videoDetails.author || "";

            // Traverse JSON to find chapterRenderer nodes
            var chapters = [];
            var seen = new WeakSet();
            function visit(node) {
              if (!node || typeof node !== "object" || seen.has(node)) return;
              seen.add(node);
              if (Array.isArray(node)) { for (var i = 0; i < node.length; i++) visit(node[i]); return; }
              if (node.chapterRenderer) {
                var cr = node.chapterRenderer;
                var t = cr.title;
                var text = t && (t.simpleText || (t.runs ? t.runs.map(function(r) { return r.text || ""; }).join("") : ""));
                var millis = cr.timeRangeStartMillis;
                if (text && typeof millis === "number") {
                  chapters.push({ time: Math.max(0, Math.floor(millis / 1000)), title: text.trim() });
                }
              }
              var keys = Object.keys(node);
              for (var i = 0; i < keys.length; i++) visit(node[keys[i]]);
            }
            visit(pr);

            // Fallback: parse timestamps from description
            if (!chapters.length) {
              var description = pr.videoDetails.shortDescription || "";
              description.split("\n").forEach(function(line) {
                var m = line.match(/^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+(.+)/);
                if (m) {
                  var h = m[1] ? parseInt(m[1]) : 0;
                  chapters.push({ time: h * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]), title: m[4].trim() });
                }
              });
            }

            // Deduplicate and sort
            var byTime = {};
            chapters.forEach(function(ch) { byTime[ch.time] = ch; });
            chapters = Object.values(byTime).sort(function(a, b) { return a.time - b.time; });

            // Get caption track URL
            var captionUrl = null;
            var captions = pr.captions && pr.captions.playerCaptionsTracklistRenderer;
            if (captions && captions.captionTracks && captions.captionTracks.length) {
              var tracks = captions.captionTracks;
              var track = tracks[0];
              for (var j = 0; j < tracks.length; j++) {
                if (tracks[j].languageCode === "en") { track = tracks[j]; break; }
              }
              captionUrl = track.baseUrl;
            }

            return { title: title, channel: channel, captionUrl: captionUrl, chapters: chapters };
          },
        });
        ytData = dataResult?.result || null;
      } catch (e) {
        console.warn("Readr: YouTube data extraction failed:", e);
      }

      // If no caption URL from inline data, try InnerTube API (iOS client first, like Defuddle)
      if (ytData && !ytData.captionUrl) {
        try {
          const [apiResult] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: async (vid) => {
              var clients = [
                { clientName: "IOS", clientVersion: "20.10.3" },
                { clientName: "WEB", clientVersion: "2.20240101.00.00" },
              ];
              for (var ctx of clients) {
                try {
                  var resp = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ context: { client: ctx }, videoId: vid }),
                  });
                  if (!resp.ok) continue;
                  var data = await resp.json();
                  var tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                  if (!tracks || !tracks.length) continue;
                  var track = tracks[0];
                  for (var j = 0; j < tracks.length; j++) {
                    if (tracks[j].languageCode === "en") { track = tracks[j]; break; }
                  }
                  if (track.baseUrl) return track.baseUrl;
                } catch { continue; }
              }
              return null;
            },
            args: [videoId],
          });
          if (apiResult?.result) ytData.captionUrl = apiResult.result;
        } catch (e) {
          console.warn("Readr: InnerTube API fallback failed:", e);
        }
      }

      // Fetch transcript - try from content script first, then background service worker
      let transcriptText = "";
      if (ytData?.captionUrl) {
        try {
          // Fetch caption XML using the URL as-is (don't modify - URL is signed)
          const [transcriptResult] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: async (url) => {
              try {
                const resp = await fetch(url);
                if (!resp.ok) return "";
                return await resp.text();
              } catch { return ""; }
            },
            args: [ytData.captionUrl],
          });
          transcriptText = transcriptResult?.result || "";
        } catch (e) {
          console.warn("Readr: transcript fetch failed:", e);
        }
      } else {
        console.log("[Readr] no captionUrl, skipping primary fetch");
      }

      // If transcript is still empty, try InnerTube API for fresh caption URLs
      // (inline URLs may be stale/expired after SPA navigation)
      if (!transcriptText) {
        try {
          const [freshResult] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: async (vid) => {
              // Try iOS client first (no User-Agent needed in browser extensions),
              // then WEB client as fallback - same strategy as Defuddle
              var clients = [
                { clientName: "IOS", clientVersion: "20.10.3" },
                { clientName: "WEB", clientVersion: "2.20240101.00.00" },
              ];
              for (var ctx of clients) {
                try {
                  var resp = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ context: { client: ctx }, videoId: vid }),
                  });
                  if (!resp.ok) continue;
                  var data = await resp.json();
                  var tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                  if (!tracks || !tracks.length) continue;
                  var track = tracks[0];
                  for (var j = 0; j < tracks.length; j++) {
                    if (tracks[j].languageCode === "en") { track = tracks[j]; break; }
                  }
                  if (!track.baseUrl) continue;
                  // Fetch caption XML using URL as-is (signed, don't modify)
                  var captionResp = await fetch(track.baseUrl);
                  if (!captionResp.ok) continue;
                  var text = await captionResp.text();
                  if (text) return text;
                } catch { continue; }
              }
              return "";
            },
            args: [videoId],
          });
          transcriptText = freshResult?.result || "";
        } catch (e) {
          console.warn("Readr: InnerTube transcript fallback failed:", e);
        }
      }


      // Store data in sessionStorage for content script to read
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (data) => sessionStorage.setItem("__readrYTData", JSON.stringify(data)),
          args: [{
            title: ytData?.title || "",
            channel: ytData?.channel || "",
            chapters: ytData?.chapters || [],
            transcriptText,
          }],
        });
      } catch (e) {
        console.warn("Readr: failed to store YouTube data:", e);
      }
    }

    // Inject Readability library first
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/readability.js"],
    });

    // Inject and execute content script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/content.js"],
    });
  } catch (error) {
    console.error("Readr error:", error);
  }
});

// Clean up CSP rules when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tabId, tabId + 100000, tabId + 200000],
  }).catch(() => {});
});
