// Readr - Background Service Worker
// Handles extension icon click and injects content script

chrome.action.onClicked.addListener(async (tab) => {
  // Don't run on chrome:// or edge:// pages
  if (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") ||
      tab.url.startsWith("chrome-extension://") || tab.url.startsWith("about:")) {
    return;
  }

  try {
    // Check if reader mode is already active
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        return document.body.classList.contains("readr-active") ||
               sessionStorage.getItem("__readrActive") === "true";
      },
    });

    if (result.result) {
      // Reader mode is active, exit by reloading the page
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          sessionStorage.removeItem("__readrActive");
          location.reload();
        },
      });
    } else {
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
    }
  } catch (error) {
    console.error("Readr error:", error);
  }
});
