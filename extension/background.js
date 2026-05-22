// extension/background.js
chrome.runtime.onInstalled.addListener(() => {
  console.log("[Bili Clipper] Installed");
});

// All localhost:27182 fetches live in content.js — MV3 service workers are
// ephemeral and get terminated by Chrome before long (or even short) async
// responses complete, causing "message channel closed" errors. Content scripts
// can reach http://localhost directly (exempt from mixed-content policy).
