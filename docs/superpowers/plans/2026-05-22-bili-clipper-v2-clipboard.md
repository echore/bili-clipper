# Bili Clipper v2 — Clipboard + obsidian:// Refactor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Obsidian Local REST API integration with a clipboard + `obsidian://` URI approach, so users need zero Obsidian plugins and zero API key configuration.

**Architecture:** The Chrome extension now handles all Obsidian writing: for CC subtitle videos it formats the note and calls `obsidian://new?clipboard` directly (no server involved at all); for Whisper videos the server transcribes and returns the formatted note text, then the extension does the same clipboard → URI flow. The server's only job is transcription — it never touches the filesystem or Obsidian.

**Tech Stack:** Python 3.11+ / FastAPI / mlx-whisper / yt-dlp / Chrome MV3 vanilla JS / `obsidian://` URI scheme (built into Obsidian, no plugin needed)

**Project directory:** `/Users/liyachen/Documents/fang/bili-clipper`

**Git baseline tag:** `v0.1-rest-api` — if anything goes wrong, `git reset --hard v0.1-rest-api` restores the previous working state.

---

## Background: Why This Change

The previous architecture used Obsidian Local REST API (a community plugin) to write notes. This required users to:
1. Install the Local REST API plugin inside Obsidian
2. Enable its HTTP server
3. Copy an API key and paste it into the extension popup

**Root cause:** The local FastAPI server runs as a launchd daemon, which macOS TCC (Transparency, Consent, and Control) blocks from writing to `~/Documents`. The REST API plugin was a workaround. The clipboard approach avoids TCC entirely — the Chrome extension runs in the browser with full user context, clipboard access is unrestricted, and `obsidian://new?clipboard` is handled by the Obsidian app itself with its own permissions.

**What users will see after this change:** Click Clip → Obsidian opens/focuses → note appears at `Raw/[title].md` inside their vault. No dialog asking for API key. No plugin to install.

---

## How `obsidian://new?clipboard` Works

Obsidian registers `obsidian://` as a URI scheme at install time (macOS system-level, no extra plugin). The `new` action accepts:
- `vault=VaultName` — display name of the vault (e.g. `Obsidian Vault`, NOT the full path)
- `name=folder%2Ffilename.md` — relative path within vault
- `clipboard` — flag telling Obsidian to read note content from clipboard instead of the URL

Flow:
```
extension formats markdown note
      ↓
navigator.clipboard.writeText(noteContent)   ← full content in clipboard
      ↓
open obsidian://new?vault=...&name=...&clipboard
      ↓
macOS routes URI → Obsidian app
      ↓
Obsidian reads clipboard → creates note at vault/folder/title.md
```

This is identical to how Obsidian Web Clipper works (see `obsidian-note-creator.ts` in their source).

---

## File Map

```
Files to MODIFY:
  server/writer.py          write_note() (async, httpx) → format_note() (sync, returns string)
  server/server.py          remove /open + OpenRequest; update /clip response; add /vaults; remove httpx/obsidian config
  server/requirements.txt   remove httpx
  extension/content.js      add formatNote(), sanitizeFilename(), clipToObsidian(); refactor handleClip()
  extension/popup.html      replace obsidian_api_key field with vault_name + auto-detect button
  extension/popup.js        replace obsidian_api_key with vault_name; add /vaults auto-detect

Files to UPDATE (tests):
  tests/test_writer.py      rewrite for format_note() — simpler, no temp dirs needed
```

---

## Task 1: Refactor writer.py — write_note() → format_note()

**Files:**
- Modify: `server/writer.py`
- Modify: `server/requirements.txt`
- Modify: `tests/test_writer.py`

- [ ] **Step 1: Write failing tests first**

```python
# tests/test_writer.py  — replace entire file
import pytest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "server"))

from writer import format_note


def test_format_note_returns_string():
    config = {"bvid": "BV123"}
    result = format_note("My Video", "transcript text", config, "cc_subtitle")
    assert isinstance(result, str)


def test_format_note_contains_frontmatter():
    config = {"bvid": "BV123"}
    result = format_note("My Video", "transcript text", config, "cc_subtitle")
    assert "title: My Video" in result
    assert "platform: bilibili" in result
    assert "transcript_method: cc_subtitle" in result
    assert "transcript text" in result


def test_format_note_includes_source_url():
    config = {"bvid": "BV1abc123XY"}
    result = format_note("Title", "text", config, "cc_subtitle")
    assert "BV1abc123XY" in result
    assert "bilibili.com/video" in result


def test_format_note_starts_with_frontmatter_delimiter():
    config = {"bvid": "BV123"}
    result = format_note("Title", "text", config, "cc_subtitle")
    assert result.startswith("---")


def test_format_note_handles_missing_bvid():
    config = {}
    result = format_note("Title", "text", config, "cc_subtitle")
    assert isinstance(result, str)
    assert "title: Title" in result
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd /Users/liyachen/Documents/fang/bili-clipper
.venv/bin/pytest tests/test_writer.py -v
```

Expected: `ImportError: cannot import name 'format_note' from 'writer'`

- [ ] **Step 3: Replace writer.py**

```python
# server/writer.py  — replace entire file
from datetime import date


def format_note(title: str, transcript: str, config: dict, method: str) -> str:
    """Format transcript as a markdown note with YAML frontmatter.

    Returns the complete note content as a string.
    Does NOT write to disk — the caller (extension or test) handles delivery.
    """
    bvid = config.get("bvid", "")
    source_url = f"https://www.bilibili.com/video/{bvid}" if bvid else ""

    return f"""---
title: {title}
source: {source_url}
platform: bilibili
date: {date.today().isoformat()}
tags: [transcript, bilibili]
transcript_method: {method}
---

{transcript}
"""
```

- [ ] **Step 4: Remove httpx from requirements.txt**

```
# server/requirements.txt  — replace entire file
fastapi>=0.110.0
uvicorn>=0.29.0
mlx-whisper>=0.4.0
yt-dlp>=2024.1.0
pytest>=8.0.0
pytest-asyncio>=0.23.0
```

(httpx was only used in writer.py — it's no longer needed.)

- [ ] **Step 5: Run tests — expect pass**

```bash
.venv/bin/pytest tests/test_writer.py -v
```

Expected:
```
PASSED tests/test_writer.py::test_format_note_returns_string
PASSED tests/test_writer.py::test_format_note_contains_frontmatter
PASSED tests/test_writer.py::test_format_note_includes_source_url
PASSED tests/test_writer.py::test_format_note_starts_with_frontmatter_delimiter
PASSED tests/test_writer.py::test_format_note_handles_missing_bvid
5 passed
```

- [ ] **Step 6: Run transcriber tests to confirm nothing broke**

```bash
.venv/bin/pytest tests/test_transcriber.py -v
```

Expected: `3 passed`

- [ ] **Step 7: Commit**

```bash
git add server/writer.py server/requirements.txt tests/test_writer.py
git commit -m "refactor(server): writer — format_note() returns string, drop httpx/REST API"
```

---

## Task 2: Update server.py — remove /open, update /clip, add /vaults

**Files:**
- Modify: `server/server.py`

The goal: `/clip` now returns `{"success": true, "note": "...full markdown..."}` instead of `{"success": true, "path": "Raw/Title.md"}`. The extension copies `note` to clipboard. No more Obsidian REST API calls anywhere in the server.

Also add `/vaults` — reads Obsidian's own config file to return vault names so the popup can auto-detect.

- [ ] **Step 1: Replace server.py**

```python
# server/server.py  — replace entire file
import json
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import uvicorn

from transcriber import download_audio, transcribe
from writer import format_note

app = FastAPI(title="Bili Clipper Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class Config(BaseModel):
    folder: str = "Raw"
    output: str = "obsidian"
    model: str = "large-v3-turbo"
    bvid: Optional[str] = None


class ClipRequest(BaseModel):
    bvid: str
    title: str
    transcript: Optional[str] = None  # if provided, skip transcription
    config: Config = Config()


@app.get("/health")
def health():
    return {"status": "ok", "model": "mlx-community/whisper-large-v3-turbo"}


@app.get("/vaults")
def list_vaults():
    """Return Obsidian vault names from Obsidian's own config file.
    Used by the extension popup for auto-detection — no manual vault path entry needed.
    """
    config_path = (
        Path.home() / "Library" / "Application Support" / "obsidian" / "obsidian.json"
    )
    if not config_path.exists():
        return {"vaults": []}
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
        vaults = [
            {"name": Path(v["path"]).name, "path": v["path"]}
            for v in data.get("vaults", {}).values()
            if "path" in v
        ]
        return {"vaults": vaults}
    except Exception:
        return {"vaults": []}


@app.post("/clip")
async def clip(req: ClipRequest):
    """Transcribe (if needed) and format a note.

    If transcript is provided (CC subtitle fast path): just format and return.
    If no transcript: download audio via yt-dlp and transcribe with mlx-whisper.

    Returns the formatted markdown note content — the extension writes it to Obsidian
    via clipboard + obsidian:// URI (no file I/O on the server side).
    """
    try:
        config = req.config.model_dump()
        config["bvid"] = req.bvid  # ensure bvid is in config for source URL

        if req.transcript:
            note = format_note(req.title, req.transcript, config, method="cc_subtitle")
        else:
            audio_path = await download_audio(req.bvid)
            transcript_text = await transcribe(audio_path, req.config.model)
            note = format_note(
                req.title,
                transcript_text,
                config,
                method=f"whisper_{req.config.model}",
            )
        return {"success": True, "note": note}
    except Exception as e:
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=27182, log_level="info")
```

- [ ] **Step 2: Verify /health and /vaults with curl**

```bash
# Start server in background
.venv/bin/python server/server.py &
sleep 2

# Health check
curl -s http://localhost:27182/health
```

Expected: `{"status":"ok","model":"mlx-community/whisper-large-v3-turbo"}`

```bash
# Vault auto-detection
curl -s http://localhost:27182/vaults
```

Expected (example): `{"vaults":[{"name":"Obsidian Vault","path":"/Users/liyachen/Documents/Obsidian Vault"}]}`

```bash
# Fast-path /clip test
curl -s -X POST http://localhost:27182/clip \
  -H "Content-Type: application/json" \
  -d '{"bvid":"BV1xx","title":"Test","transcript":"大家好","config":{"folder":"Raw","bvid":"BV1xx"}}'
```

Expected: `{"success":true,"note":"---\ntitle: Test\n...大家好\n"}`

```bash
kill %1
```

- [ ] **Step 3: Commit**

```bash
git add server/server.py
git commit -m "refactor(server): /clip returns note string; add /vaults; remove /open + httpx"
```

---

## Task 3: Update content.js — clipboard + obsidian:// flow

**Files:**
- Modify: `extension/content.js`

This is the biggest change. Three new helper functions replace the old `openInObsidian` + `deliverTranscript` pattern. The CC subtitle path no longer calls the server at all.

**Expected UX after this change:**
- User clicks Clip on a video with CC subtitles
- Bar shows "正在提取字幕…" for ~1 second
- Obsidian opens (or focuses if already open) and a new note appears at `Raw/[title].md`
- Bar shows "✓ 已存入 Raw/[title].md"

- [ ] **Step 1: Replace the entire content.js**

```javascript
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
  return { aid: data.data.aid, cid: data.data.cid, title: data.data.title };
}

async function getSubtitleList(aid, cid) {
  const res = await fetch(
    `https://api.bilibili.com/x/player/wbi/v2?aid=${aid}&cid=${cid}`,
    { credentials: "include" }
  );
  const data = await res.json();
  const subtitles = data.data?.subtitle?.subtitles ?? [];
  return subtitles.filter((s) => s.subtitle_url);
}

async function fetchSubtitleText(subtitleUrl) {
  const url = subtitleUrl.startsWith("http://")
    ? subtitleUrl.replace("http://", "https://")
    : subtitleUrl.startsWith("//")
    ? "https:" + subtitleUrl
    : subtitleUrl;
  const res = await fetch(url);
  const data = await res.json();
  return data.body.map((item) => item.content).join("\n");
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

/** Format transcript as a markdown note with YAML frontmatter. */
function formatNote(title, transcript, bvid, method) {
  const today = new Date().toISOString().split("T")[0];
  const sourceUrl = bvid ? `https://www.bilibili.com/video/${bvid}` : "";
  return `---
title: ${title}
source: ${sourceUrl}
platform: bilibili
date: ${today}
tags: [transcript, bilibili]
transcript_method: ${method}
---

${transcript}
`;
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
  params.set("name", notePath);

  const link = document.createElement("a");
  link.href = "obsidian://new?" + params.toString() + "&clipboard";
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
  if (!_videoData) return;
  _isProcessing = true;

  const settings = await getSettings();
  const { bvid, title, subtitles } = _videoData;
  const folder = settings.folder || "Raw";
  const filename = sanitizeFilename(title) + ".md";
  const notePath = folder + "/" + filename;

  try {
    if (subtitles.length > 0) {
      // ── CC subtitle fast path ──────────────────────────────────────────────
      // No server call needed. Extract subtitle, format note, clip to Obsidian.
      renderProcessing("正在提取字幕…");
      const transcript = await fetchSubtitleText(subtitles[0].subtitle_url);
      const note = formatNote(title, transcript, bvid, "cc_subtitle");
      await clipToObsidian(note, title, settings);

      if (settings.output === "clipboard") {
        renderSuccess("已复制到剪贴板");
      } else {
        renderSuccess(notePath);
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
        renderSuccess(notePath);
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
```

- [ ] **Step 2: Reload extension in Chrome and verify bar appears**

1. Go to `chrome://extensions`
2. Click the reload icon on Bili Clipper
3. Navigate to any Bilibili video page
4. Confirm: purple Clip bar appears below the title with correct CC / Whisper badge

- [ ] **Step 3: Test CC subtitle path manually**

1. Open a Bilibili video that has CC subtitles (look for "字幕" option in the player)
2. Confirm bar shows "CC 字幕 ✓" badge
3. Click Clip
4. Obsidian should open/focus and create the note at `Raw/[title].md`
5. Bar shows "✓ 已存入 Raw/[title].md"
6. Open Obsidian and confirm the note exists with correct frontmatter

- [ ] **Step 4: Commit**

```bash
git add extension/content.js
git commit -m "feat(extension): clipboard + obsidian:// URI — no more REST API dependency"
```

---

## Task 4: Update popup — vault_name replaces obsidian_api_key

**Files:**
- Modify: `extension/popup.html`
- Modify: `extension/popup.js`

The popup now has a "Vault 名称" field instead of "Obsidian API Key". An auto-detect button calls `/vaults` on the local server to fill it in. If the server isn't running, the user types the vault name manually (it's just the display name, e.g. `Obsidian Vault`).

- [ ] **Step 1: Replace popup.html**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { width: 280px; padding: 16px; font-family: -apple-system, sans-serif; font-size: 13px; color: #1e1b4b; }
    h2 { font-size: 14px; margin-bottom: 16px; display: flex; align-items: center; gap: 6px; }
    .row { margin-bottom: 14px; }
    label { display: block; font-size: 10px; font-weight: 700; text-transform: uppercase;
            letter-spacing: 0.05em; color: #6b7280; margin-bottom: 5px; }
    .input-row { display: flex; gap: 4px; }
    input, select { width: 100%; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 6px;
                    font-size: 12px; color: #111; }
    input:focus, select:focus { outline: 2px solid #7c3aed; border-color: transparent; }
    .btn-auto { padding: 6px 8px; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 6px;
                font-size: 11px; color: #374151; cursor: pointer; white-space: nowrap; flex-shrink: 0; }
    .btn-auto:hover { background: #e5e7eb; }
    .seg { display: flex; gap: 4px; }
    .seg button { flex: 1; padding: 5px 2px; border: 1px solid #d1d5db; border-radius: 6px;
                  cursor: pointer; background: white; font-size: 11px; color: #374151; }
    .seg button.active { background: #7c3aed; color: white; border-color: #7c3aed; }
    .status { display: flex; align-items: center; gap: 8px; padding-top: 12px;
              border-top: 1px solid #f3f4f6; font-size: 12px; color: #6b7280; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #d1d5db; flex-shrink: 0; }
    .dot.ok { background: #22c55e; }
    .dot.err { background: #ef4444; }
  </style>
</head>
<body>
  <h2><span>📎</span> Bili Clipper</h2>

  <div class="row">
    <label>Vault 名称</label>
    <div class="input-row">
      <input type="text" id="vault_name" placeholder="Obsidian Vault">
      <button class="btn-auto" id="btn-detect">自动检测</button>
    </div>
  </div>

  <div class="row">
    <label>目标文件夹</label>
    <input type="text" id="folder" placeholder="Raw">
  </div>

  <div class="row">
    <label>输出目标</label>
    <div class="seg" id="output-seg">
      <button class="active" data-value="obsidian">Obsidian</button>
      <button data-value="clipboard">剪贴板</button>
      <button data-value="both">两者</button>
    </div>
  </div>

  <div class="row">
    <label>ASR 模型</label>
    <select id="model">
      <option value="large-v3-turbo">large-v3-turbo（推荐）</option>
      <option value="medium">medium</option>
      <option value="base">base</option>
    </select>
  </div>

  <div class="status">
    <div class="dot" id="dot"></div>
    <span id="srv-label">检查本地服务…</span>
  </div>

  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Replace popup.js**

```javascript
// extension/popup.js

// ─── Load + render saved settings ────────────────────────────────────────────
chrome.storage.local.get(
  { vault_name: "", folder: "Raw", output: "obsidian", model: "large-v3-turbo" },
  (s) => {
    document.getElementById("vault_name").value = s.vault_name;
    document.getElementById("folder").value = s.folder;
    document.getElementById("model").value = s.model;
    document.querySelectorAll("#output-seg button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.value === s.output);
    });
  }
);

// ─── Save on any change ───────────────────────────────────────────────────────
function save() {
  const output =
    document.querySelector("#output-seg button.active")?.dataset.value ?? "obsidian";
  chrome.storage.local.set({
    vault_name: document.getElementById("vault_name").value.trim(),
    folder: document.getElementById("folder").value.trim(),
    output,
    model: document.getElementById("model").value,
  });
}

["vault_name", "folder", "model"].forEach((id) =>
  document.getElementById(id).addEventListener("change", save)
);

document.querySelectorAll("#output-seg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#output-seg button").forEach((b) =>
      b.classList.remove("active")
    );
    btn.classList.add("active");
    save();
  });
});

// ─── Auto-detect vault name from local server ─────────────────────────────────
document.getElementById("btn-detect").addEventListener("click", async () => {
  const btn = document.getElementById("btn-detect");
  btn.textContent = "检测中…";
  btn.disabled = true;
  try {
    const res = await fetch("http://localhost:27182/vaults", {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (data.vaults.length === 0) {
      btn.textContent = "未找到";
    } else {
      // Pick first vault; if multiple, user can manually adjust
      document.getElementById("vault_name").value = data.vaults[0].name;
      save();
      btn.textContent = "已检测 ✓";
    }
  } catch {
    btn.textContent = "需启动服务";
  } finally {
    btn.disabled = false;
    setTimeout(() => { btn.textContent = "自动检测"; }, 2000);
  }
});

// ─── Server health check ──────────────────────────────────────────────────────
(async () => {
  const dot = document.getElementById("dot");
  const label = document.getElementById("srv-label");
  try {
    const res = await fetch("http://localhost:27182/health", {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      dot.classList.add("ok");
      label.textContent = "本地服务运行中 · :27182";
    } else throw new Error();
  } catch {
    dot.classList.add("err");
    label.textContent = "本地服务未运行（CC 字幕仍可用）";
  }
})();
```

- [ ] **Step 3: Reload extension and verify popup**

1. Reload extension in `chrome://extensions`
2. Click the Bili Clipper icon in toolbar
3. Confirm: "Vault 名称" field appears (no API key field)
4. Start the server: `.venv/bin/python server/server.py &`
5. Click "自动检测" → vault name should fill in automatically
6. Kill server: `kill %1`
7. Re-open popup → red dot + "本地服务未运行（CC 字幕仍可用）"

- [ ] **Step 4: Commit**

```bash
git add extension/popup.html extension/popup.js
git commit -m "feat(popup): vault_name replaces obsidian_api_key; auto-detect from /vaults"
```

---

## Task 5: Deploy server update + end-to-end verification

**Files:**
- No code changes — this task deploys the server changes from Tasks 1–2 to the install directory and verifies the full flow.

**IMPORTANT — Deployment is 4 atomic steps. All four must complete before calling it done:**
```
cp files → launchctl bootout → launchctl bootstrap → curl /health verify
```
Missing any step = old code still running in memory.

- [ ] **Step 1: Deploy updated server files**

```bash
# Copy updated server files to install directory
cp /Users/liyachen/Documents/fang/bili-clipper/server/server.py \
   /Users/liyachen/Documents/fang/bili-clipper/server/writer.py \
   ~/.local/share/bili-clipper/

# Restart the launchd service (4-step atomic)
launchctl bootout gui/$(id -u) com.bili-clipper.server 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.bili-clipper.server.plist

# Wait for startup
sleep 3

# Verify — MUST see 200 OK before calling deployment done
curl -s http://localhost:27182/health
```

Expected: `{"status":"ok","model":"mlx-community/whisper-large-v3-turbo"}`

If the curl fails: `tail -20 ~/.local/share/bili-clipper/server.log` and fix before continuing.

- [ ] **Step 2: End-to-end test — CC subtitle video**

1. Open a Bilibili video with CC subtitles in Chrome
2. Confirm bar shows "CC 字幕 ✓" badge
3. Open the extension popup → click "自动检测" → confirm vault name fills in
4. Click Clip
5. Obsidian opens/focuses and note appears at `Raw/[title].md`
6. Bar shows "✓ 已存入 Raw/[title].md"
7. In Obsidian, open the note and verify frontmatter contains `platform: bilibili` and `transcript_method: cc_subtitle`

- [ ] **Step 3: Confirm server NOT needed for CC subtitle path**

1. Stop the server: `launchctl bootout gui/$(id -u) com.bili-clipper.server`
2. Wait 3 seconds
3. Open a Bilibili video with CC subtitles
4. Click Clip → should still work (no "本地服务未运行" error)
5. Obsidian note created successfully
6. Restart server: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.bili-clipper.server.plist`

- [ ] **Step 4: Confirm Whisper path shows correct error when server is down**

1. With server stopped (from step above, before restarting):
2. Open a Bilibili video WITHOUT subtitles
3. Clip bar shows "Whisper 转录" badge
4. Click Clip → bar shows "⚠ 本地服务未运行 — Whisper 转录需要本地服务"
5. Start server back up (see step 3 above)

- [ ] **Step 5: Final commit + tag**

```bash
git add -A
git commit -m "chore: deploy v2 — clipboard+obsidian:// integration complete"
git tag v0.2-clipboard
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Remove Local REST API dependency → Tasks 1–3 (writer.py, server.py, content.js)
- [x] CC subtitle path works without server → Task 3 (`handleClip` CC branch has no server call)
- [x] Whisper path still works (server returns `note` string) → Tasks 2–3
- [x] `obsidian://new?clipboard` flow → Task 3 (`clipToObsidian`)
- [x] Clipboard-only output mode → Task 3 (`clipToObsidian` with `output === "clipboard"`)
- [x] Vault name configuration → Task 4 (popup)
- [x] Auto-detect vault from obsidian.json → Tasks 2 (`/vaults` endpoint) + 4 (popup button)
- [x] Deployment 4-step atomic → Task 5 Step 1
- [x] Server not needed for CC subtitles (verified) → Task 5 Step 3
- [x] Error message for Whisper when server down → Task 3 (renderError), Task 5 Step 4

**No placeholders:** verified — all steps have exact code or exact commands.

**Type consistency:**
- `format_note(title, transcript, config, method)` defined in Task 1, used in Task 2 server.py ✓
- `clipToObsidian(noteContent, title, settings)` defined and used in Task 3 ✓
- `getSettings()` returns `{vault_name, folder, output, model}` — consistent with popup.js defaults in Task 4 ✓
- `/vaults` endpoint defined in Task 2, called in Task 4 popup.js ✓
- `/clip` returns `{success, note}` defined in Task 2, consumed in Task 3 `handleClip` Whisper branch ✓

**Retro lessons applied:**
- TCC: clipboard approach completely bypasses TCC — extension runs in browser context, clipboard always accessible, obsidian:// handled by Obsidian itself ✓
- Deployment 4-step atomic in Task 5 Step 1 ✓
- UI alignment: Task 3 Step 3 describes exactly what user will see (Obsidian opens, note appears) ✓
- No API keys printed anywhere ✓
