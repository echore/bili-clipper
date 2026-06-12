// extension/content.js

// ─── Bilibili API helpers ────────────────────────────────────────────────────

function getBvId() {
  const match = window.location.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

function getPageParam() {
  const p = parseInt(new URLSearchParams(window.location.search).get("p"), 10);
  return Number.isInteger(p) && p > 0 ? p : 1;
}

async function getVideoInfo(bvid, page = 1) {
  const res = await fetch(
    `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
    { credentials: "include" }
  );
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Bilibili API error: ${data.message}`);
  const d = data.data;
  const pages = d.pages || [];
  // 顶层 d.cid 恒等于 P1 的 cid（2026-06-12 实测），多P视频必须从 pages 取当前分P的 cid
  const pageInfo = pages[page - 1] || pages[0] || null;
  const isMultiPage = pages.length > 1;
  return {
    aid: d.aid,
    cid: pageInfo ? pageInfo.cid : d.cid,
    page: pageInfo ? pageInfo.page : 1,
    title:
      isMultiPage && pageInfo && pageInfo.part
        ? `${d.title} - P${pageInfo.page} ${pageInfo.part}`
        : d.title,
    desc: d.desc || "",
    author: d.owner?.name || "",
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

function buildEmbedIframe(bvid, cid, aid, page) {
  return (
    `<iframe src="https://player.bilibili.com/player.html` +
    `?bvid=${bvid}&cid=${cid}&aid=${aid}&page=${page}&autoplay=0" ` +
    `scrolling="no" border="0" frameborder="no" framespacing="0" ` +
    `allowfullscreen="true" style="width:100%;aspect-ratio:16/9;"></iframe>`
  );
}

async function getSettings() {
  const s = await new Promise((resolve) =>
    chrome.storage.local.get(
      {
        vault_name: "",
        folder: "",
        output: "",            // legacy enum, kept for migration only
        destinations: null,    // array of "obsidian" | "notion" | "clipboard"
        notion_token: "",
        notion_database_id: "",
      },
      resolve
    )
  );
  if (!Array.isArray(s.destinations)) {
    // Read-time fallback from the legacy `output` enum. Not persisted here:
    // the popup/welcome UI owns writing `destinations` once it migrates.
    const legacyMap = {
      obsidian: ["obsidian"],
      clipboard: ["clipboard"],
      both: ["obsidian", "clipboard"],
    };
    s.destinations = legacyMap[s.output] || ["obsidian"];
  }
  return s;
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

function buildVideoUrl(bvid, page) {
  const base = `https://www.bilibili.com/video/${bvid}`;
  return page > 1 ? `${base}?p=${page}` : base;
}

/** Metadata shared by all destinations. */
function buildNoteMeta(title, bvid, page, author, method) {
  return {
    title,
    sourceUrl: bvid ? buildVideoUrl(bvid, page) : "",
    author: author || "",
    date: new Date().toISOString().split("T")[0],
    tags: ["transcript", "bilibili"],
    method,
  };
}

function formatFrontmatter(meta) {
  return [
    `---`,
    `title: "${meta.title.replace(/"/g, '\\"')}"`,
    `source: ${meta.sourceUrl}`,
    `platform: bilibili`,
    `author: "${meta.author.replace(/"/g, '\\"')}"`,
    `date: ${meta.date}`,
    `tags: [${meta.tags.join(", ")}]`,
    `transcript_method: ${meta.method}`,
    `---`,
  ].join("\n");
}

/** Body shared by all destinations; `embed` is iframe HTML (Obsidian) or a plain URL (Notion). */
function formatNoteBody(subtitleSection, desc, embed) {
  const lines = [embed, ``];
  if (desc && desc.trim()) lines.push(`## 简介`, ``, desc.trim(), ``);
  lines.push(`## 字幕`, ``, subtitleSection);
  return lines.join("\n");
}

// ─── Destination writers ─────────────────────────────────────────────────────
// Each writer: (payload, settings) → Promise<{ok: boolean, detail?: string}>
// payload: { title, meta, obsidianNote, notionBody }

async function writeToClipboard(payload) {
  await navigator.clipboard.writeText(payload.obsidianNote);
  return { ok: true };
}

async function writeToObsidian(payload, settings) {
  // Obsidian URI reads content from clipboard (&clipboard) — clipboard is the transport
  await navigator.clipboard.writeText(payload.obsidianNote);
  const folder = (settings.folder || "").trim().replace(/^\/+|\/+$/g, "");
  const filename = sanitizeFilename(payload.title) + ".md";
  const notePath = folder ? folder + "/" + filename : filename;
  const params = new URLSearchParams();
  if (settings.vault_name) params.set("vault", settings.vault_name);
  params.set("file", notePath);
  const link = document.createElement("a");
  // Obsidian URI handler requires %20 for spaces, not + (URLSearchParams default)
  link.href = "obsidian://new?" + params.toString().replace(/\+/g, "%20") + "&clipboard";
  link.click();
  return { ok: true };
}

async function writeToNotion(payload) {
  const resp = await chrome.runtime.sendMessage({
    type: "CLIP_TO_NOTION",
    meta: payload.meta,
    body: payload.notionBody,
  });
  return resp || { ok: false, detail: "后台无响应" };
}

const WRITERS = { obsidian: writeToObsidian, clipboard: writeToClipboard, notion: writeToNotion };
const DEST_LABELS = { obsidian: "Obsidian", notion: "Notion", clipboard: "剪贴板" };

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
  const page = getPageParam();
  try {
    const { aid, cid, page: resolvedPage, title, desc, author } = await getVideoInfo(bvid, page);
    const { subtitles, chapters } = await getPlayerData(aid, cid);
    if (subtitles.length === 0) {
      renderNoSubtitles();
      return;
    }
    _videoData = { bvid, aid, cid, page: resolvedPage, title, desc, author, subtitles, chapters };
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
    `<span>📎</span><span style="color:#4c1d95;font-weight:500;">Bili Clipper</span>${badge}</div>` +
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

function renderResults(results) {
  const summary = results
    .map((r) => `${r.ok ? "✓" : "✗"} ${DEST_LABELS[r.dest]}`)
    .join("　");
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    const hint = results.some((r) => r.dest === "obsidian")
      ? "如未自动打开，请启动 Obsidian 或检查 Vault 名称是否正确"
      : "";
    renderSuccess(summary, hint);
  } else {
    renderError(`${summary} — ${failed[0].detail || "写入失败"}`);
  }
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
  const dests = settings.destinations.filter((d) => WRITERS[d]);

  const needsObsidianSetup = dests.includes("obsidian") && !settings.vault_name;
  const needsNotionSetup =
    dests.includes("notion") && (!settings.notion_token || !settings.notion_database_id);
  // dests can be empty when destinations contains only not-yet-registered writers
  // (e.g. "notion" before Phase 2) — surfaced as setup-required rather than crashing
  if (dests.length === 0 || needsObsidianSetup || needsNotionSetup) {
    renderSetupRequired();
    return;
  }

  _isProcessing = true;
  const { bvid, aid, cid, page, title, desc, author, subtitles, chapters } = _videoData;

  try {
    renderProcessing("正在提取字幕…");
    const items = await fetchSubtitleItems(subtitles[0].subtitle_url);
    const subtitleSection = buildSubtitleSection(items, chapters);
    const meta = buildNoteMeta(title, bvid, page, author, "cc_subtitle");
    const payload = {
      title,
      meta,
      obsidianNote:
        formatFrontmatter(meta) + "\n\n" +
        formatNoteBody(subtitleSection, desc, buildEmbedIframe(bvid, cid, aid, page)),
      notionBody: formatNoteBody(subtitleSection, desc, meta.sourceUrl),
    };

    const results = [];
    for (const dest of dests) {
      renderProcessing(`正在写入 ${DEST_LABELS[dest]}…`);
      try {
        results.push({ dest, ...(await WRITERS[dest](payload, settings)) });
      } catch (err) {
        results.push({ dest, ok: false, detail: err.message });
      }
    }
    renderResults(results);
    if (results.some((r) => r.ok)) {
      saveClipHistory({ title, url: buildVideoUrl(bvid, page) });
    }
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
// B 站是 SPA，站内切换视频/分P走 History API。pushState/replaceState 由
// page-hook.js 在主世界拦截后派发 bili-clipper:navigation 事件（isolated
// world 直接改写 history 对页面无效）；popstate（前进/后退）两个世界都能收到。

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

window.addEventListener("bili-clipper:navigation", handleNavigation);
window.addEventListener("popstate", handleNavigation);

init();
