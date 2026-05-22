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
  const paragraphs = [];
  let current = [];
  for (let i = 0; i < items.length; i++) {
    current.push(items[i].content);
    const gap = i + 1 < items.length ? items[i + 1].from - items[i].to : Infinity;
    if (gap > gapThreshold) {
      paragraphs.push(current.join(""));
      current = [];
    }
  }
  if (current.length) paragraphs.push(current.join(""));
  return paragraphs.join("\n\n");
}

function buildSubtitleSection(items, chapters) {
  if (!items || items.length === 0) return "（暂无字幕）";
  if (!chapters || chapters.length === 0) {
    return mergeItemsIntoParagraphs(items);
  }
  const lines = [];
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

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      {
        vault_name: "",   // display name of the Obsidian vault, e.g. "Obsidian Vault"
        folder: "Raw",
        output: "obsidian",
        model: "large-v3-turbo",
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
    lines.push(`## 简介`, ``, desc.trim(), ``, `## 字幕`, ``);
  }
  lines.push(subtitleSection);
  return lines.join("\n");
}

/** Copy note to clipboard and open obsidian://new?clipboard to create the note.
 *
 *  What the user will see: Obsidian opens (or focuses), and a new note appears
 *  at vault/folder/title.md. No dialog, no API key — macOS routes the URI
 *  directly to Obsidian, which reads the content from clipboard.
 *
 *  If output === "clipboard": copies to clipboard only, does NOT open Obsidian.
 */
async function clipToObsidian(noteContent, title, settings) {
  // Always copy to clipboard first (used as transport to Obsidian, or as final output)
  await navigator.clipboard.writeText(noteContent);

  if (settings.output === "clipboard") return;  // clipboard-only mode

  const folder = settings.folder || "Raw";
  const vaultName = settings.vault_name || "";
  const filename = sanitizeFilename(title) + ".md";
  const notePath = folder + "/" + filename;

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

// ─── Clip Bar UI ─────────────────────────────────────────────────────────────

let _clipBar = null;
let _isProcessing = false;
let _videoData = null;

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
    const { aid, cid, title, desc, author } = await getVideoInfo(bvid);
    const { subtitles, chapters } = await getPlayerData(aid, cid);
    _videoData = { bvid, aid, cid, title, desc, author, subtitles, chapters };
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

function renderSuccess(message) {
  _clipBar.style.background = "#f0fdf4";
  _clipBar.style.borderColor = "#16a34a";
  _clipBar.innerHTML =
    `<span style="color:#15803d;">✓ ${message}</span>` +
    `<button id="bili-clipper-reset-btn" style="padding:2px 10px;background:none;` +
    `border:1px solid #16a34a;color:#16a34a;border-radius:4px;font-size:11px;cursor:pointer;">再次 Clip</button>`;
  document.getElementById("bili-clipper-reset-btn").addEventListener("click", () => {
    renderLoading();
    loadVideoDataAndRenderIdle();
  });
}

function renderError(message) {
  _clipBar.style.background = "#fff1f2";
  _clipBar.style.borderColor = "#ef4444";
  _clipBar.innerHTML =
    `<span style="color:#dc2626;">⚠ ${message}</span>` +
    `<a href="https://github.com/liyachen/bili-clipper#troubleshooting" ` +
    `target="_blank" style="color:#dc2626;font-size:11px;text-decoration:underline;">查看帮助</a>`;
}

// ─── Clip flow ────────────────────────────────────────────────────────────────

async function handleClip() {
  if (_isProcessing || !_videoData) return;
  _isProcessing = true;

  const settings = await getSettings();
  const { bvid, aid, cid, title, desc, author, subtitles, chapters } = _videoData;
  const folder = settings.folder || "Raw";
  const filename = sanitizeFilename(title) + ".md";
  const notePath = folder + "/" + filename;

  try {
    if (subtitles.length > 0) {
      // ── CC subtitle fast path ──────────────────────────────────────────────
      renderProcessing("正在提取字幕…");
      const items = await fetchSubtitleItems(subtitles[0].subtitle_url);
      const subtitleSection = buildSubtitleSection(items, chapters);
      const note = formatNote(title, subtitleSection, bvid, aid, cid, "cc_subtitle", author, desc);
      await clipToObsidian(note, title, settings);

      if (settings.output === "clipboard") {
        renderSuccess("已复制到剪贴板");
      } else {
        renderSuccess("已存入 " + notePath);
      }
    } else {
      // ── Whisper path ───────────────────────────────────────────────────────
      // Server needed for transcription only. Server does NOT write any files.
      const ok = await isServerRunning();
      if (!ok) {
        renderError("本地服务未运行 — Whisper 转录需要本地服务");
        return;
      }

      renderProcessing("转录中（约 2 分钟）…");
      const res = await fetch("http://localhost:27182/clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bvid,
          title,
          config: {
            folder: settings.folder || "Raw",
            output: settings.output || "obsidian",
            model: settings.model || "large-v3-turbo",
            bvid,
            aid: String(aid || ""),
            cid: String(cid || ""),
            author: author || "",
            desc: desc || "",
          },
        }),
      });
      const data = await res.json();
      if (!data.success) {
        renderError(data.error || "转录失败");
        return;
      }

      await clipToObsidian(data.note, title, settings);

      if (settings.output === "clipboard") {
        renderSuccess("已复制到剪贴板");
      } else {
        renderSuccess("已存入 " + notePath);
      }
    }
  } catch (err) {
    renderError("错误: " + err.message);
  } finally {
    _isProcessing = false;
  }
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
