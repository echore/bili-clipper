// extension/content.js

// ─── Bilibili API helpers ────────────────────────────────────────────────────

/** Extract BV ID from current URL, e.g. /video/BV1xx411c7mD → "BV1xx411c7mD" */
function getBvId() {
  const match = window.location.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

/** Fetch video metadata: { aid, cid, title } */
async function getVideoInfo(bvid) {
  const res = await fetch(
    `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
    { credentials: "include" }
  );
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Bilibili API error: ${data.message}`);
  return {
    aid: data.data.aid,
    cid: data.data.cid,
    title: data.data.title,
  };
}

/** Returns array of subtitle objects from player wbi/v2 API.
 *  Uses aid (numeric) + cid — NOT bvid.
 *  Filters out entries with empty subtitle_url.
 */
async function getSubtitleList(aid, cid) {
  const res = await fetch(
    `https://api.bilibili.com/x/player/wbi/v2?aid=${aid}&cid=${cid}`,
    { credentials: "include" }
  );
  const data = await res.json();
  const subtitles = data.data?.subtitle?.subtitles ?? [];
  return subtitles.filter((s) => s.subtitle_url);
}

/** Fetch subtitle JSON and return full transcript as plain text.
 *  Handles http:// → https:// conversion.
 */
async function fetchSubtitleText(subtitleUrl) {
  const url = subtitleUrl.startsWith("http://")
    ? subtitleUrl.replace("http://", "https://")
    : subtitleUrl.startsWith("//")
    ? "https:" + subtitleUrl
    : subtitleUrl;
  const res = await fetch(url, { credentials: "include" });
  const data = await res.json();
  return data.body.map((item) => item.content).join("\n");
}

/** Ping the local server. Returns true if running. */
async function isServerRunning() {
  try {
    const res = await fetch("http://localhost:27182/health", {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Get settings from chrome.storage.local with defaults. */
async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      {
        vault_path: "~/Documents/Obsidian Vault",
        folder: "Raw",
        output: "obsidian",
        model: "large-v3-turbo",
      },
      resolve
    );
  });
}

// ─── Clip Bar UI ─────────────────────────────────────────────────────────────

let _clipBar = null;
let _isProcessing = false;
let _videoData = null; // { bvid, aid, title, cid, subtitles }

function ensureSpinStyle() {
  if (!document.getElementById("bili-clipper-style")) {
    const s = document.createElement("style");
    s.id = "bili-clipper-style";
    s.textContent = "@keyframes bili-spin{to{transform:rotate(360deg)}}";
    document.head.appendChild(s);
  }
}

function injectClipBar() {
  if (document.getElementById("bili-clipper-bar")) return;

  const anchor =
    document.querySelector(".video-info-title") ||
    document.querySelector("#viewbox_report .title");
  if (!anchor) return;

  _clipBar = document.createElement("div");
  _clipBar.id = "bili-clipper-bar";
  _clipBar.style.cssText =
    "display:flex;align-items:center;justify-content:space-between;" +
    "padding:8px 12px;margin:8px 0;border-radius:8px;font-size:13px;" +
    "font-family:-apple-system,sans-serif;transition:all 0.2s;" +
    "background:#f4f0ff;border:1px solid #7c3aed;";

  anchor.parentNode.insertBefore(_clipBar, anchor.nextSibling);
  renderLoading();
  loadVideoDataAndRenderIdle();
}

async function loadVideoDataAndRenderIdle() {
  const bvid = getBvId();
  if (!bvid) return;
  try {
    const { aid, cid, title } = await getVideoInfo(bvid);
    const subtitles = await getSubtitleList(aid, cid);
    _videoData = { bvid, aid, title, cid, subtitles };
    renderIdle(subtitles.length > 0);
  } catch (err) {
    renderError("无法加载视频信息");
    console.error("[Bili Clipper]", err);
  }
}

function renderLoading() {
  _clipBar.innerHTML =
    `<span style="color:#6d28d9;font-size:12px;">📎 Bili Clipper 加载中…</span>`;
}

function renderIdle(hasSubtitles) {
  const badge = hasSubtitles
    ? `<span style="background:#dcfce7;color:#166534;padding:1px 7px;border-radius:4px;font-size:11px;font-weight:600;">CC 字幕 ✓</span>`
    : `<span style="background:#fef3c7;color:#92400e;padding:1px 7px;border-radius:4px;font-size:11px;font-weight:600;">Whisper 转录</span>`;

  _clipBar.style.background = "#f4f0ff";
  _clipBar.style.borderColor = "#7c3aed";
  _clipBar.innerHTML =
    `<div style="display:flex;align-items:center;gap:8px;">` +
    `<span>📎</span><span style="color:#4c1d95;font-weight:500;">Clip to Obsidian</span>${badge}</div>` +
    `<button id="bili-clipper-btn" style="padding:4px 14px;background:#7c3aed;color:white;` +
    `border:none;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600;">Clip</button>`;

  document.getElementById("bili-clipper-btn").addEventListener("click", () => {
    if (!_isProcessing) handleClip();
  });
}

function renderProcessing(message) {
  ensureSpinStyle();
  _clipBar.style.background = "#f4f0ff";
  _clipBar.style.borderColor = "#7c3aed";
  _clipBar.innerHTML =
    `<div style="display:flex;align-items:center;gap:8px;">` +
    `<div style="width:14px;height:14px;border:2px solid #7c3aed;border-top-color:transparent;` +
    `border-radius:50%;animation:bili-spin 0.8s linear infinite;"></div>` +
    `<span style="color:#4c1d95;">${message}</span></div>`;
}

function renderSuccess(path) {
  _clipBar.style.background = "#f0fdf4";
  _clipBar.style.borderColor = "#16a34a";
  _clipBar.innerHTML =
    `<span style="color:#15803d;">✓ 已存入 ${path}</span>` +
    `<button onclick="window._biliClipperReset()" style="padding:2px 10px;background:none;` +
    `border:1px solid #16a34a;color:#16a34a;border-radius:4px;font-size:11px;cursor:pointer;">再次 Clip</button>`;
}

function renderError(message) {
  _clipBar.style.background = "#fff1f2";
  _clipBar.style.borderColor = "#ef4444";
  _clipBar.innerHTML =
    `<span style="color:#dc2626;">⚠ ${message}</span>` +
    `<a href="https://github.com/liyachen/bili-clipper#troubleshooting" ` +
    `target="_blank" style="color:#dc2626;font-size:11px;text-decoration:underline;">查看帮助</a>`;
}

window._biliClipperReset = function () {
  _clipBar.style.background = "#f4f0ff";
  _clipBar.style.borderColor = "#7c3aed";
  loadVideoDataAndRenderIdle();
};

// ─── Clip flow ────────────────────────────────────────────────────────────────

async function handleClip() {
  if (!_videoData) return;
  _isProcessing = true;

  const settings = await getSettings();
  const { bvid, title, subtitles } = _videoData;

  try {
    if (settings.output !== "clipboard") {
      const ok = await isServerRunning();
      if (!ok) {
        renderError("本地服务未运行 — 请运行 install.sh");
        _isProcessing = false;
        return;
      }
    }

    if (subtitles.length > 0) {
      renderProcessing("正在提取字幕…");
      const transcript = await fetchSubtitleText(subtitles[0].subtitle_url);
      await deliverTranscript(bvid, title, transcript, settings);
    } else {
      renderProcessing("转录中（约 2 分钟）…");
      const res = await fetch("http://localhost:27182/clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bvid,
          title,
          config: { ...settings, bvid },
        }),
      });
      const result = await res.json();
      if (result.success) renderSuccess(result.path);
      else renderError(result.error || "转录失败");
    }
  } catch (err) {
    renderError("错误: " + err.message);
  } finally {
    _isProcessing = false;
  }
}

async function deliverTranscript(bvid, title, transcript, settings) {
  if (settings.output === "clipboard") {
    await navigator.clipboard.writeText(transcript);
    renderSuccess("已复制到剪贴板");
    return;
  }

  const res = await fetch("http://localhost:27182/clip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bvid, title, transcript, config: { ...settings, bvid } }),
  });
  const result = await res.json();
  if (result.success) renderSuccess(result.path);
  else renderError(result.error || "写入失败");
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  if (document.querySelector(".video-info-title, #viewbox_report")) {
    injectClipBar();
    return;
  }
  const obs = new MutationObserver(() => {
    if (document.querySelector(".video-info-title, #viewbox_report")) {
      obs.disconnect();
      injectClipBar();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

init();
