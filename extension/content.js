// extension/content.js

// ─── Bilibili API helpers ────────────────────────────────────────────────────

function getBvId() {
  const match = window.location.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

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
    desc: data.data.desc || "",
    author: data.data.owner?.name || "",
  };
}

async function getPlayerData(aid, cid) {
  const res = await fetch(
    `https://api.bilibili.com/x/player/wbi/v2?aid=${aid}&cid=${cid}`,
    { credentials: "include" }
  );
  const data = await res.json();
  const subtitles = (data.data?.subtitle?.subtitles ?? []).filter((s) => s.subtitle_url);
  const chapters = (data.data?.view_points ?? [])
    .map((item) => ({
      title: String(item.content || item.title || "").trim(),
      from: Number(item.from ?? item.start ?? 0),
      to: Number(item.to ?? item.end ?? 0),
    }))
    .filter((c) => c.title);
  return { subtitles, chapters };
}

async function fetchSubtitleItems(subtitleUrl) {
  const url = subtitleUrl.startsWith("http://")
    ? subtitleUrl.replace("http://", "https://")
    : subtitleUrl.startsWith("//")
    ? "https:" + subtitleUrl
    : subtitleUrl;
  const res = await fetch(url);
  const data = await res.json();
  return data.body || [];
}

function formatChapterTimestamp(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function mergeItemsIntoParagraphs(items, gapThreshold = 2) {
  const HARD_END = /[。？！…]+$/;   // sentence-ending punctuation → always break
  const SOFT_END = /[，、]+$/;       // comma → break only when text is long enough
  const MAX_CHARS = 120;             // last-resort hard cap for punctuation-free content
  const SOFT_MIN = 40;               // minimum chars before a comma triggers a break

  const paragraphs = [];
  let current = [];
  let paraStart = null;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (current.length === 0) paraStart = item.from;
    current.push(item.content);

    const text = current.join("");
    const gap = i + 1 < items.length ? items[i + 1].from - item.to : Infinity;

    const shouldBreak =
      HARD_END.test(text) ||                          // 1. sentence end
      gap > gapThreshold ||                           // 2. natural pause
      (text.length >= SOFT_MIN && SOFT_END.test(item.content)) || // 3. comma after enough text
      text.length >= MAX_CHARS;                       // 4. hard cap fallback

    if (shouldBreak) {
      paragraphs.push({ time: paraStart, text });
      current = [];
      paraStart = null;
    }
  }

  if (current.length) paragraphs.push({ time: paraStart, text: current.join("") });

  return paragraphs
    .map(p => `**${formatChapterTimestamp(p.time)}** · ${p.text}`)
    .join("\n\n");
}

function buildSubtitleSection(items, chapters) {
  if (!items || items.length === 0) return "（暂无字幕）";
  if (!chapters || chapters.length === 0) {
    return mergeItemsIntoParagraphs(items);
  }
  const lines = [];
  // items before the first chapter
  const pre = items.filter((item) => item.from < chapters[0].from);
  if (pre.length > 0) {
    lines.push(mergeItemsIntoParagraphs(pre));
    lines.push("");
  }
  for (let i = 0; i < chapters.length; i++) {
    const start = chapters[i].from;
    const end = i + 1 < chapters.length ? chapters[i + 1].from : Infinity;
    const slice = items.filter((item) => item.from >= start && item.from < end);
    if (slice.length === 0) continue;
    lines.push(`### ${chapters[i].title} \`${formatChapterTimestamp(start)}\``);
    lines.push("");
    lines.push(mergeItemsIntoParagraphs(slice));
    lines.push("");
  }
  return lines.join("\n").trim();
}

function buildEmbedIframe(bvid, cid, aid) {
  return (
    `<iframe src="https://player.bilibili.com/player.html` +
    `?bvid=${bvid}&cid=${cid}&aid=${aid}&page=1&autoplay=0" ` +
    `scrolling="no" border="0" frameborder="no" framespacing="0" ` +
    `allowfullscreen="true" style="width:100%;aspect-ratio:16/9;"></iframe>`
  );
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      {
        vault_name: "",   // display name of the Obsidian vault, e.g. "Obsidian Vault"
        folder: "",
        output: "obsidian",
      },
      resolve
    );
  });
}

// ─── Note formatting helpers ─────────────────────────────────────────────────

/** Remove characters not allowed in filenames, truncate to 100 chars. */
function sanitizeFilename(title) {
  return title
    .replace(/[/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

/** Format transcript as a markdown note with YAML frontmatter, embed, and chapter-structured subtitles. */
function formatNote(title, subtitleSection, bvid, aid, cid, method, author, desc) {
  const today = new Date().toISOString().split("T")[0];
  const sourceUrl = bvid ? `https://www.bilibili.com/video/${bvid}` : "";
  const lines = [
    `---`,
    `title: "${title.replace(/"/g, '\\"')}"`,
    `source: ${sourceUrl}`,
    `platform: bilibili`,
    `author: "${(author || "").replace(/"/g, '\\"')}"`,
    `date: ${today}`,
    `tags: [transcript, bilibili]`,
    `transcript_method: ${method}`,
    `---`,
    ``,
    buildEmbedIframe(bvid, cid, aid),
    ``,
  ];
  if (desc && desc.trim()) {
    lines.push(`## 简介`, ``, desc.trim(), ``);
  }
  lines.push(`## 字幕`, ``, subtitleSection);
  return lines.join("\n");
}

/** Copy note to clipboard and open obsidian://new?clipboard to create the note.
 *
 *  What the user will see: Obsidian opens (or focuses), and a new note appears
 *  at vault/folder/title.md. No dialog, no API key — the OS routes the URI
 *  to Obsidian (works on macOS, Windows, and Linux), which reads the content
 *  from clipboard.
 *
 *  If output === "clipboard": copies to clipboard only, does NOT open Obsidian.
 */
async function clipToObsidian(noteContent, title, settings) {
  // Always copy to clipboard first (used as transport to Obsidian, or as final output)
  await navigator.clipboard.writeText(noteContent);

  if (settings.output === "clipboard") return;  // clipboard-only mode

  const folder = (settings.folder || "").trim().replace(/^\/+|\/+$/g, "");
  const vaultName = settings.vault_name || "";
  const filename = sanitizeFilename(title) + ".md";
  const notePath = folder ? folder + "/" + filename : filename;

  // Build obsidian://new URI
  // &clipboard tells Obsidian to read content from clipboard (no URL length limit)
  const params = new URLSearchParams();
  if (vaultName) params.set("vault", vaultName);
  params.set("file", notePath);

  const link = document.createElement("a");
  // Obsidian URI handler requires %20 for spaces, not + (URLSearchParams default)
  link.href = "obsidian://new?" + params.toString().replace(/\+/g, "%20") + "&clipboard";
  link.click();
}

// ─── Clip history ────────────────────────────────────────────────────────────

function saveClipHistory({ title, url }) {
  chrome.storage.local.get({ clip_history: [] }, ({ clip_history }) => {
    const entry = { title, url, time: Date.now() };
    const updated = [entry, ...clip_history.filter((e) => e.url !== url)].slice(0, 20);
    chrome.storage.local.set({ clip_history: updated });
  });
}

// ─── Clip Bar UI ─────────────────────────────────────────────────────────────

let _clipBar = null;
let _collapsed = false;
let _isProcessing = false;
let _videoData = null;

// Expanded bar base style — position:fixed keeps it out of the page DOM flow entirely
const _BAR_BASE =
  "position:fixed;top:20px;right:20px;z-index:99999;width:300px;" +
  "display:flex;align-items:center;justify-content:space-between;" +
  "padding:10px 14px;border-radius:10px;font-size:13px;" +
  "font-family:-apple-system,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.15);gap:8px;";

const _COLLAPSE_BTN =
  `<button data-bili-collapse style="width:20px;height:20px;border-radius:50%;` +
  `background:rgba(0,0,0,0.08);border:none;cursor:pointer;font-size:13px;` +
  `color:#666;flex-shrink:0;line-height:1;">−</button>`;

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
  if (!getBvId()) return;

  _clipBar = document.createElement("div");
  _clipBar.id = "bili-clipper-bar";
  _clipBar.style.cssText = _BAR_BASE + "background:#f4f0ff;border:1.5px solid #7c3aed;";

  document.body.appendChild(_clipBar);

  // Event delegation — survives innerHTML replacements in render functions
  _clipBar.addEventListener("click", (e) => {
    if (e.target.closest("[data-bili-collapse]")) toggleCollapse();
  });

  renderLoading();
  loadVideoDataAndRenderIdle();
}

function toggleCollapse() {
  if (!_collapsed) {
    _collapsed = true;
    _clipBar.style.cssText =
      "position:fixed;top:20px;right:20px;z-index:99999;" +
      "width:42px;height:42px;border-radius:50%;background:#7c3aed;" +
      "box-shadow:0 4px 12px rgba(124,58,237,0.4);cursor:pointer;" +
      "display:flex;align-items:center;justify-content:center;";
    _clipBar.innerHTML = '<span style="font-size:18px;">📎</span>';
    _clipBar.addEventListener("click", _expandBar);
  } else {
    _expandBar();
  }
}

function _expandBar() {
  _collapsed = false;
  _clipBar.removeEventListener("click", _expandBar);
  if (_videoData) renderIdle();
  else renderLoading();
}

async function loadVideoDataAndRenderIdle() {
  const bvid = getBvId();
  if (!bvid) return;
  try {
    const { aid, cid, title, desc, author } = await getVideoInfo(bvid);
    const { subtitles, chapters } = await getPlayerData(aid, cid);
    if (subtitles.length === 0) {
      renderNoSubtitles();
      return;
    }
    _videoData = { bvid, aid, cid, title, desc, author, subtitles, chapters };
    renderIdle();
  } catch (err) {
    renderError("无法加载视频信息");
    console.error("[Bili Clipper]", err);
  }
}

function renderNoSubtitles() {
  _clipBar.style.cssText = _BAR_BASE + "background:#f9fafb;border:1.5px solid #d1d5db;";
  _clipBar.innerHTML =
    `<div style="display:flex;align-items:center;gap:8px;">` +
    `<span>📎</span>` +
    `<span style="color:#6b7280;">此视频无 CC 字幕</span>` +
    `<span style="background:#f3f4f6;color:#9ca3af;padding:1px 7px;border-radius:4px;font-size:11px;border:1px solid #e5e7eb;">无字幕</span>` +
    `</div>` + _COLLAPSE_BTN;

}

function renderLoading() {
  _clipBar.style.cssText = _BAR_BASE + "background:#f4f0ff;border:1.5px solid #7c3aed;";
  _clipBar.innerHTML =
    `<span style="color:#6d28d9;font-size:12px;">📎 Bili Clipper 加载中…</span>` + _COLLAPSE_BTN;

}

function renderIdle() {
  const badge = `<span style="background:#dcfce7;color:#166534;padding:1px 7px;border-radius:4px;font-size:11px;font-weight:600;">CC 字幕 ✓</span>`;

  _clipBar.style.cssText = _BAR_BASE + "background:#f4f0ff;border:1.5px solid #7c3aed;";
  _clipBar.innerHTML =
    `<div style="display:flex;align-items:center;gap:8px;">` +
    `<span>📎</span><span style="color:#4c1d95;font-weight:500;">Clip to Obsidian</span>${badge}</div>` +
    `<div style="display:flex;align-items:center;gap:6px;">` +
    `<button id="bili-clipper-btn" style="padding:4px 14px;background:#7c3aed;color:white;` +
    `border:none;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600;">Clip</button>` +
    _COLLAPSE_BTN + `</div>`;

  document.getElementById("bili-clipper-btn").addEventListener("click", () => {
    if (!_isProcessing) handleClip();
  });

}

function renderProcessing(message) {
  ensureSpinStyle();
  _clipBar.style.cssText = _BAR_BASE + "background:#f4f0ff;border:1.5px solid #7c3aed;";
  _clipBar.innerHTML =
    `<div style="display:flex;align-items:center;gap:8px;">` +
    `<div style="width:14px;height:14px;border:2px solid #7c3aed;border-top-color:transparent;` +
    `border-radius:50%;animation:bili-spin 0.8s linear infinite;"></div>` +
    `<span style="color:#4c1d95;">${message}</span></div>` + _COLLAPSE_BTN;

}

function renderSuccess(message, subtitle = "") {
  const subtitleHtml = subtitle
    ? `<span style="color:#6b7280;font-size:11px;flex:1;min-width:0;">${subtitle}</span>`
    : "";
  _clipBar.style.cssText = _BAR_BASE + "background:#f0fdf4;border:1.5px solid #16a34a;";
  _clipBar.innerHTML =
    `<span style="color:#15803d;flex-shrink:0;">✓ ${message}</span>` + subtitleHtml + _COLLAPSE_BTN;

}

function renderError(message) {
  _clipBar.style.cssText = _BAR_BASE + "background:#fff1f2;border:1.5px solid #ef4444;";
  _clipBar.innerHTML =
    `<span style="color:#dc2626;flex:1;min-width:0;">⚠ ${message}</span>` +
    `<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">` +
    `<a href="https://github.com/echore/bilibili-to-obsidian#troubleshooting" ` +
    `target="_blank" style="color:#dc2626;font-size:11px;text-decoration:underline;">帮助</a>` +
    _COLLAPSE_BTN + `</div>`;

}

function renderSetupRequired() {
  _clipBar.style.cssText = _BAR_BASE + "background:#fffbeb;border:1.5px solid #f59e0b;";
  _clipBar.innerHTML =
    `<span style="color:#92400e;flex:1;min-width:0;">⚙ 请先完成初始设置</span>` +
    `<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">` +
    `<button id="bili-open-setup" style="padding:3px 12px;background:#f59e0b;color:white;` +
    `border:none;border-radius:5px;font-size:11px;cursor:pointer;font-weight:600;">打开设置 →</button>` +
    _COLLAPSE_BTN + `</div>`;
  document.getElementById("bili-open-setup").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_WELCOME" });
  });

}

// ─── Clip flow ────────────────────────────────────────────────────────────────

async function handleClip() {
  if (_isProcessing || !_videoData) return;

  const settings = await getSettings();

  // Guard: vault name required for Obsidian output
  if (!settings.vault_name && settings.output !== "clipboard") {
    renderSetupRequired();
    return;
  }

  _isProcessing = true;
  const { bvid, aid, cid, title, desc, author, subtitles, chapters } = _videoData;
  const folder = (settings.folder || "").trim().replace(/^\/+|\/+$/g, "");
  const filename = sanitizeFilename(title) + ".md";
  const notePath = folder ? folder + "/" + filename : filename;

  try {
    // ── CC subtitle path ─────────────────────────────────────────────────────
    renderProcessing("正在提取字幕…");
    const items = await fetchSubtitleItems(subtitles[0].subtitle_url);
    const subtitleSection = buildSubtitleSection(items, chapters);
    const note = formatNote(title, subtitleSection, bvid, aid, cid, "cc_subtitle", author, desc);
    await clipToObsidian(note, title, settings);

    if (settings.output === "clipboard") {
      renderSuccess("已复制到剪贴板");
    } else {
      renderSuccess("已保存到 Obsidian", "如未自动打开，请启动 Obsidian 或检查 Vault 名称是否正确");
    }
    saveClipHistory({ title, url: `https://www.bilibili.com/video/${bvid}` });
  } catch (err) {
    renderError("错误: " + err.message);
  } finally {
    _isProcessing = false;
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  injectClipBar();
}

// ─── SPA navigation ───────────────────────────────────────────────────────────
// Bilibili is a SPA — navigating between videos changes the URL via History API
// without a full page reload. We intercept pushState/replaceState and listen for
// popstate to reset the clip bar when the user navigates to a different video.

let _currentUrl = location.href;

function handleNavigation() {
  const newUrl = location.href;
  if (newUrl === _currentUrl) return;
  _currentUrl = newUrl;

  if (!newUrl.includes("/video/")) return;

  if (_clipBar) { _clipBar.remove(); _clipBar = null; }
  _videoData = null;
  _isProcessing = false;
  _collapsed = false;

  init();
}

const _origPushState = history.pushState.bind(history);
history.pushState = function (...args) {
  _origPushState(...args);
  handleNavigation();
};

const _origReplaceState = history.replaceState.bind(history);
history.replaceState = function (...args) {
  _origReplaceState(...args);
  handleNavigation();
};

window.addEventListener("popstate", handleNavigation);

init();
