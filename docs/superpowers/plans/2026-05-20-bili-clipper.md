# Bili Clipper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension that injects a Clip bar on Bilibili video pages, extracts transcripts (via Bilibili's subtitle API or local Whisper), and writes formatted notes to an Obsidian vault.

**Architecture:** Three components — a Chrome MV3 extension (content script injects the Clip bar; popup handles settings), a local FastAPI server on port 27182 (handles yt-dlp audio download, faster-whisper transcription, and vault file writing), and a bash install script (sets up the Python env and registers a launchd daemon). The extension talks to the server over localhost HTTP.

**Tech Stack:** Python 3.11+ / uv / FastAPI / uvicorn / faster-whisper / yt-dlp / Chrome Manifest V3 / vanilla JS / bash / launchd (macOS)

**Design Spec:** `/Users/liyachen/Documents/Obsidian Vault/Raw/Superpower/2026-05-20-bili-clipper-design.md`

**Key Reference:** [`kangchainx/video-text-chrome-extension`](https://github.com/kangchainx/video-text-chrome-extension) — MIT, same stack (FastAPI + yt-dlp + faster-whisper + Chrome extension). Borrow patterns from its server setup and extension structure. [`IndieKKY/bilibili-subtitle`](https://github.com/IndieKKY/bilibili-subtitle) — reference for Bilibili API calls.

---

## File Map

```
bili-clipper/
├── extension/
│   ├── manifest.json       # MV3 manifest — permissions, content scripts, popup
│   ├── content.js          # Injects Clip bar; calls Bilibili API; drives all UI states
│   ├── background.js       # Minimal service worker (MV3 requires it)
│   ├── popup.html          # Settings panel HTML
│   ├── popup.js            # Settings load/save + server health check
│   └── icons/              # icon16/48/128.png (generated in Task 6)
├── server/
│   ├── server.py           # FastAPI app: GET /health, POST /clip
│   ├── transcriber.py      # yt-dlp download + faster-whisper transcription
│   ├── writer.py           # Formats markdown note + writes to vault
│   └── requirements.txt
├── tests/
│   ├── test_writer.py
│   └── test_transcriber.py
├── install.sh              # One-liner installer: uv + deps + launchd
├── uninstall.sh
└── README.md
```

---

## Task 1: Project Setup

**Files:**
- Create: `.gitignore`
- Create: `README.md` (stub)

- [ ] **Step 1: Git init + .gitignore**

```bash
cd /Users/liyachen/Documents/fang/bili-clipper
git init
cat > .gitignore << 'EOF'
__pycache__/
*.py[cod]
.venv/
*.egg-info/
dist/
.DS_Store
*.log
EOF
```

- [ ] **Step 2: Stub README**

```bash
cat > README.md << 'EOF'
# Bili Clipper

Chrome extension — clip Bilibili video transcripts to Obsidian.

## Install
```bash
curl -sSL https://raw.githubusercontent.com/YOUR_HANDLE/bili-clipper/main/install.sh | bash
```
Then load `extension/` in Chrome: `chrome://extensions` → Developer mode → Load unpacked.

## Requirements
- macOS (M-series recommended)
- Python 3.11+
- Chrome
EOF
```

- [ ] **Step 3: Initial commit**

```bash
git add .gitignore README.md
git commit -m "chore: project scaffold"
```

---

## Task 2: Python Server — /health Endpoint

**Files:**
- Create: `server/requirements.txt`
- Create: `server/server.py`

- [ ] **Step 1: Write requirements.txt**

```
fastapi>=0.110.0
uvicorn>=0.29.0
faster-whisper>=1.0.0
yt-dlp>=2024.1.0
pytest>=8.0.0
httpx>=0.27.0
```

- [ ] **Step 2: Write server.py with /health only**

```python
# server/server.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

app = FastAPI(title="Bili Clipper Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
def health():
    return {"status": "ok", "model": "large-v3-turbo"}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=27182, log_level="info")
```

- [ ] **Step 3: Set up venv and install deps**

```bash
cd /Users/liyachen/Documents/fang/bili-clipper
uv venv --python python3.11 .venv
uv pip install -r server/requirements.txt --python .venv/bin/python
```

- [ ] **Step 4: Verify /health works**

```bash
# Terminal 1
.venv/bin/python server/server.py &
sleep 2

# Terminal 2
curl http://localhost:27182/health
```

Expected output:
```json
{"status":"ok","model":"large-v3-turbo"}
```

```bash
kill %1   # stop background server
```

- [ ] **Step 5: Commit**

```bash
git add server/requirements.txt server/server.py .venv/   # .venv is gitignored but add the others
git add server/
git commit -m "feat(server): FastAPI skeleton with /health endpoint"
```

---

## Task 3: writer.py — Note Formatter + Vault Writer

**Files:**
- Create: `server/writer.py`
- Create: `tests/test_writer.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_writer.py
import pytest
import tempfile
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "server"))

from writer import sanitize_filename, write_note


def test_sanitize_removes_illegal_chars():
    result = sanitize_filename('video: "hello/world"')
    assert "/" not in result
    assert ":" not in result
    assert '"' not in result
    assert "hello" in result


def test_sanitize_truncates_long_titles():
    result = sanitize_filename("a" * 200)
    assert len(result) <= 100


def test_write_note_creates_file():
    with tempfile.TemporaryDirectory() as tmp:
        config = {"vault_path": tmp, "folder": "Raw", "bvid": "BV1234567890"}
        path = write_note("Test Title", "Hello transcript", config, method="cc_subtitle")
        assert (Path(tmp) / path).exists()


def test_write_note_frontmatter():
    with tempfile.TemporaryDirectory() as tmp:
        config = {"vault_path": tmp, "folder": "Raw", "bvid": "BV123"}
        path = write_note("My Video", "transcript text", config, method="cc_subtitle")
        content = (Path(tmp) / path).read_text()
        assert "title: My Video" in content
        assert "platform: bilibili" in content
        assert "transcript_method: cc_subtitle" in content
        assert "transcript text" in content
        assert "BV123" in content


def test_write_note_handles_duplicate_filename():
    with tempfile.TemporaryDirectory() as tmp:
        config = {"vault_path": tmp, "folder": "Raw", "bvid": "BV123"}
        path1 = write_note("Same Title", "first", config, method="cc_subtitle")
        path2 = write_note("Same Title", "second", config, method="cc_subtitle")
        assert path1 != path2
        assert (Path(tmp) / path1).exists()
        assert (Path(tmp) / path2).exists()


def test_write_note_creates_folder_if_missing():
    with tempfile.TemporaryDirectory() as tmp:
        config = {"vault_path": tmp, "folder": "Clips/Bilibili", "bvid": "BV123"}
        path = write_note("Video", "text", config, method="cc_subtitle")
        assert (Path(tmp) / path).exists()
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd /Users/liyachen/Documents/fang/bili-clipper
.venv/bin/pytest tests/test_writer.py -v
```

Expected: `ModuleNotFoundError: No module named 'writer'`

- [ ] **Step 3: Write writer.py**

```python
# server/writer.py
import re
from datetime import date
from pathlib import Path


def sanitize_filename(title: str) -> str:
    """Remove characters not allowed in filenames, truncate to 100 chars."""
    sanitized = re.sub(r'[/\\:*?"<>|]', "", title)
    return sanitized[:100].strip()


def write_note(title: str, transcript: str, config: dict, method: str) -> str:
    """Format transcript as markdown and write to Obsidian vault.

    Returns the path relative to vault_path (e.g. 'Raw/My Video.md').
    """
    vault_path = Path(config["vault_path"]).expanduser()
    folder = config.get("folder", "Raw")
    bvid = config.get("bvid", "")

    target_dir = vault_path / folder
    target_dir.mkdir(parents=True, exist_ok=True)

    filename = sanitize_filename(title) + ".md"
    target = target_dir / filename

    # Handle duplicate: append today's date
    if target.exists():
        filename = f"{sanitize_filename(title)}-{date.today().isoformat()}.md"
        target = target_dir / filename

    source_url = f"https://www.bilibili.com/video/{bvid}" if bvid else ""

    content = f"""---
title: {title}
source: {source_url}
platform: bilibili
date: {date.today().isoformat()}
tags: [transcript, bilibili]
transcript_method: {method}
---

{transcript}
"""
    target.write_text(content, encoding="utf-8")
    return str(target.relative_to(vault_path))
```

- [ ] **Step 4: Run tests — expect pass**

```bash
.venv/bin/pytest tests/test_writer.py -v
```

Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add server/writer.py tests/test_writer.py
git commit -m "feat(server): writer module — format + write vault notes"
```

---

## Task 4: transcriber.py — yt-dlp + faster-whisper

**Files:**
- Create: `server/transcriber.py`
- Create: `tests/test_transcriber.py`

- [ ] **Step 1: Write failing tests (mocked — no real download)**

```python
# tests/test_transcriber.py
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock, AsyncMock
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "server"))


def test_transcribe_joins_segments():
    """Transcribe should join all segment texts into one string."""
    seg1, seg2 = MagicMock(), MagicMock()
    seg1.text = "大家好"
    seg2.text = "今天分享"

    mock_model = MagicMock()
    mock_model.transcribe.return_value = ([seg1, seg2], MagicMock())

    with patch("transcriber.get_model", return_value=mock_model):
        from transcriber import transcribe
        result = transcribe(Path("fake.wav"), "large-v3-turbo")

    assert result == "大家好今天分享"


def test_transcribe_uses_vad_filter():
    """Transcribe should always pass vad_filter=True."""
    mock_model = MagicMock()
    mock_model.transcribe.return_value = ([], MagicMock())

    with patch("transcriber.get_model", return_value=mock_model):
        from transcriber import transcribe
        transcribe(Path("fake.wav"), "large-v3-turbo")

    call_kwargs = mock_model.transcribe.call_args[1]
    assert call_kwargs.get("vad_filter") is True


def test_get_model_caches():
    """get_model should return the same instance on repeated calls."""
    import transcriber
    transcriber._model_cache.clear()

    mock_instance = MagicMock()
    with patch("transcriber.WhisperModel", return_value=mock_instance) as MockClass:
        from transcriber import get_model
        m1 = get_model("large-v3-turbo")
        m2 = get_model("large-v3-turbo")

    assert m1 is m2
    assert MockClass.call_count == 1
    transcriber._model_cache.clear()
```

- [ ] **Step 2: Run tests — expect failure**

```bash
.venv/bin/pytest tests/test_transcriber.py -v
```

Expected: `ModuleNotFoundError: No module named 'transcriber'`

- [ ] **Step 3: Write transcriber.py**

```python
# server/transcriber.py
import asyncio
import tempfile
from pathlib import Path
from faster_whisper import WhisperModel

_model_cache: dict[str, WhisperModel] = {}


def get_model(model_name: str = "large-v3-turbo") -> WhisperModel:
    """Return cached WhisperModel, loading it on first call."""
    if model_name not in _model_cache:
        # device="auto" uses MPS on Apple Silicon, falls back to CPU
        _model_cache[model_name] = WhisperModel(
            model_name, device="auto", compute_type="auto"
        )
    return _model_cache[model_name]


def transcribe(audio_path: Path, model_name: str = "large-v3-turbo") -> str:
    """Transcribe audio file. Returns full transcript as a single string."""
    model = get_model(model_name)
    segments, _info = model.transcribe(
        str(audio_path),
        language="zh",
        beam_size=5,
        vad_filter=True,      # silence removal
        vad_parameters={"min_silence_duration_ms": 500},
    )
    return "".join(s.text for s in segments)


async def download_audio(bvid: str) -> Path:
    """Download audio from Bilibili video using yt-dlp. Returns path to wav file."""
    tmp_dir = Path(tempfile.mkdtemp(prefix="bili-clipper-"))
    output_template = str(tmp_dir / "audio.%(ext)s")

    proc = await asyncio.create_subprocess_exec(
        "yt-dlp",
        "-x",
        "--audio-format", "wav",
        "--audio-quality", "0",
        "--no-playlist",
        "-o", output_template,
        f"https://www.bilibili.com/video/{bvid}",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _stdout, stderr = await proc.communicate()

    if proc.returncode != 0:
        raise RuntimeError(f"yt-dlp failed: {stderr.decode()}")

    wav_files = list(tmp_dir.glob("*.wav"))
    if not wav_files:
        # yt-dlp may have produced a different format; find anything
        audio_files = [f for f in tmp_dir.iterdir() if f.is_file()]
        if not audio_files:
            raise RuntimeError("No audio file downloaded")
        return audio_files[0]

    return wav_files[0]
```

- [ ] **Step 4: Run tests — expect pass**

```bash
.venv/bin/pytest tests/test_transcriber.py -v
```

Expected: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add server/transcriber.py tests/test_transcriber.py
git commit -m "feat(server): transcriber — yt-dlp download + faster-whisper"
```

---

## Task 5: server.py — Wire /clip Endpoint

**Files:**
- Modify: `server/server.py`

- [ ] **Step 1: Replace server.py with full version**

```python
# server/server.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import uvicorn

from transcriber import download_audio, transcribe
from writer import write_note

app = FastAPI(title="Bili Clipper Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class Config(BaseModel):
    vault_path: str = "~/Documents/Obsidian Vault"
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
    return {"status": "ok", "model": "large-v3-turbo"}


@app.post("/clip")
async def clip(req: ClipRequest):
    try:
        if req.transcript:
            # Fast path: subtitle already extracted by extension
            path = write_note(
                req.title,
                req.transcript,
                req.config.model_dump(),
                method="cc_subtitle",
            )
        else:
            # Whisper path: download audio and transcribe
            audio_path = await download_audio(req.bvid)
            transcript_text = transcribe(audio_path, req.config.model)
            path = write_note(
                req.title,
                transcript_text,
                req.config.model_dump(),
                method=f"whisper_{req.config.model}",
            )
        return {"success": True, "path": path}
    except Exception as e:
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=27182, log_level="info")
```

- [ ] **Step 2: Test /clip with subtitle (fast path) using curl**

```bash
# Start server in background
.venv/bin/python server/server.py &
sleep 2

# Test fast path — subtitle already extracted
curl -s -X POST http://localhost:27182/clip \
  -H "Content-Type: application/json" \
  -d '{
    "bvid": "BV1xx411c7mD",
    "title": "Test Video",
    "transcript": "大家好，这是一段测试转录文本。",
    "config": {
      "vault_path": "/tmp/test-vault",
      "folder": "Raw",
      "output": "obsidian",
      "model": "large-v3-turbo",
      "bvid": "BV1xx411c7mD"
    }
  }'
```

Expected:
```json
{"success": true, "path": "Raw/Test Video.md"}
```

```bash
# Verify the file was written
cat /tmp/test-vault/Raw/Test\ Video.md
kill %1
```

- [ ] **Step 3: Commit**

```bash
git add server/server.py
git commit -m "feat(server): /clip endpoint wires transcriber + writer"
```

---

## Task 6: Chrome Extension — Manifest + Icons

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/icons/icon16.png`, `icon48.png`, `icon128.png`

- [ ] **Step 1: Write manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Bili Clipper",
  "version": "0.1.0",
  "description": "Clip Bilibili video transcripts to Obsidian",
  "permissions": ["storage", "clipboardWrite"],
  "host_permissions": [
    "https://www.bilibili.com/*",
    "https://api.bilibili.com/*",
    "http://localhost:27182/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://www.bilibili.com/video/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  }
}
```

- [ ] **Step 2: Generate placeholder icons with Python**

```bash
cd /Users/liyachen/Documents/fang/bili-clipper
.venv/bin/python - << 'EOF'
# Generates simple purple square icons (replace with real icons later)
import struct, zlib

def make_png(size, color=(124, 58, 237)):
    def chunk(name, data):
        c = zlib.crc32(name + data) & 0xffffffff
        return struct.pack(">I", len(data)) + name + data + struct.pack(">I", c)
    
    r, g, b = color
    raw = b""
    for _ in range(size):
        raw += b"\x00" + bytes([r, g, b] * size)
    
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    compressed = zlib.compress(raw)
    
    return (b"\x89PNG\r\n\x1a\n" +
            chunk(b"IHDR", ihdr) +
            chunk(b"IDAT", compressed) +
            chunk(b"IEND", b""))

for size in [16, 48, 128]:
    with open(f"extension/icons/icon{size}.png", "wb") as f:
        f.write(make_png(size))
    print(f"Created icon{size}.png")
EOF
```

Expected output:
```
Created icon16.png
Created icon48.png
Created icon128.png
```

- [ ] **Step 3: Load extension in Chrome and confirm it loads without errors**

1. Open `chrome://extensions`
2. Enable "Developer mode" (top-right toggle)
3. Click "Load unpacked" → select `/Users/liyachen/Documents/fang/bili-clipper/extension/`
4. Confirm: extension appears in list with no errors

- [ ] **Step 4: Commit**

```bash
git add extension/manifest.json extension/icons/
git commit -m "feat(extension): manifest v3 + placeholder icons"
```

---

## Task 7: content.js — Bilibili API Helpers

**Files:**
- Create: `extension/content.js` (Bilibili API section only)

- [ ] **Step 1: Write content.js with API helpers**

```javascript
// extension/content.js

// ─── Bilibili API helpers ────────────────────────────────────────────────────

/** Extract BV ID from current URL, e.g. /video/BV1xx411c7mD → "BV1xx411c7mD" */
function getBvId() {
  const match = window.location.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

/** Fetch video metadata: { cid, title } */
async function getVideoInfo(bvid) {
  const res = await fetch(
    `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`
  );
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Bilibili API error: ${data.message}`);
  return { cid: data.data.cid, title: data.data.title };
}

/** Returns array of subtitle objects from player v2 API.
 *  Each item has: { subtitle_url, lan, lan_doc }
 *  Returns [] if no subtitles.
 */
async function getSubtitleList(bvid, cid) {
  const res = await fetch(
    `https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`
  );
  const data = await res.json();
  return data.data?.subtitle?.subtitles ?? [];
}

/** Fetch subtitle JSON and return full transcript as plain text.
 *  Bilibili subtitle format: { body: [{from, to, content}, ...] }
 */
async function fetchSubtitleText(subtitleUrl) {
  const url = subtitleUrl.startsWith("//") ? "https:" + subtitleUrl : subtitleUrl;
  const res = await fetch(url);
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
```

- [ ] **Step 2: Verify API helpers work manually**

1. Open Chrome DevTools on a Bilibili video page
2. Open the Sources tab → find `content.js`
3. In Console, run:

```javascript
getBvId()  // should return e.g. "BV1xx411c7mD"
```

Expected: the BV ID of the current video

```javascript
getVideoInfo(getBvId()).then(console.log)
```

Expected: `{cid: 123456, title: "视频标题"}`

```javascript
getVideoInfo(getBvId()).then(({cid}) => getSubtitleList(getBvId(), cid)).then(console.log)
```

Expected: array (may be empty `[]` if video has no subtitles)

- [ ] **Step 3: Commit**

```bash
git add extension/content.js
git commit -m "feat(extension): Bilibili API helpers in content.js"
```

---

## Task 8: content.js — Clip Bar UI + State Machine

**Files:**
- Modify: `extension/content.js` (append UI code)

- [ ] **Step 1: Append Clip Bar UI code to content.js**

Add the following AFTER the API helpers from Task 7:

```javascript
// ─── Clip Bar UI ─────────────────────────────────────────────────────────────

let _clipBar = null;
let _isProcessing = false;
let _videoData = null;  // { bvid, title, cid, subtitles }

/** Inject keyframe animation once. */
function ensureSpinStyle() {
  if (!document.getElementById("bili-clipper-style")) {
    const s = document.createElement("style");
    s.id = "bili-clipper-style";
    s.textContent = "@keyframes bili-spin{to{transform:rotate(360deg)}}";
    document.head.appendChild(s);
  }
}

/** Create and insert the Clip bar below the video title. */
function injectClipBar() {
  if (document.getElementById("bili-clipper-bar")) return;

  // B站 video title selector (works as of 2025; update if B站 redesigns)
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
    const { cid, title } = await getVideoInfo(bvid);
    const subtitles = await getSubtitleList(bvid, cid);
    _videoData = { bvid, title, cid, subtitles };
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
    `<a href="https://github.com/YOUR_HANDLE/bili-clipper#troubleshooting" ` +
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
      // Fast path
      renderProcessing("正在提取字幕…");
      const transcript = await fetchSubtitleText(subtitles[0].subtitle_url);
      await deliverTranscript(bvid, title, transcript, settings, "cc_subtitle");
    } else {
      // Whisper path
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

async function deliverTranscript(bvid, title, transcript, settings, method) {
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
  // Inject once the title element is available (B站 is SPA — wait for DOM)
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

- [ ] **Step 2: Reload extension + verify Clip bar appears on B站**

1. Go to `chrome://extensions`
2. Click the reload icon on Bili Clipper
3. Navigate to any Bilibili video page, e.g. `https://www.bilibili.com/video/BV1xx411c7mD`
4. Confirm: purple Clip bar appears below the video title
5. Videos with CC subtitles → "CC 字幕 ✓" badge (green)
6. Videos without → "Whisper 转录" badge (amber)

- [ ] **Step 3: Commit**

```bash
git add extension/content.js
git commit -m "feat(extension): Clip bar UI + full state machine"
```

---

## Task 9: background.js + Popup

**Files:**
- Create: `extension/background.js`
- Create: `extension/popup.html`
- Create: `extension/popup.js`

- [ ] **Step 1: Write background.js (minimal)**

```javascript
// extension/background.js
// Manifest V3 requires a service worker. Clip logic lives in content.js.
chrome.runtime.onInstalled.addListener(() => {
  console.log("[Bili Clipper] Installed");
});
```

- [ ] **Step 2: Write popup.html**

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
    input, select { width: 100%; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 6px;
                    font-size: 12px; color: #111; }
    input:focus, select:focus { outline: 2px solid #7c3aed; border-color: transparent; }
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
    <label>Obsidian Vault 路径</label>
    <input type="text" id="vault_path" placeholder="~/Documents/Obsidian Vault">
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

- [ ] **Step 3: Write popup.js**

```javascript
// extension/popup.js

// ─── Load + render saved settings ────────────────────────────────────────────
chrome.storage.local.get(
  { vault_path: "~/Documents/Obsidian Vault", folder: "Raw", output: "obsidian", model: "large-v3-turbo" },
  (s) => {
    document.getElementById("vault_path").value = s.vault_path;
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
    vault_path: document.getElementById("vault_path").value.trim(),
    folder: document.getElementById("folder").value.trim(),
    output,
    model: document.getElementById("model").value,
  });
}

["vault_path", "folder", "model"].forEach((id) =>
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
    label.textContent = "本地服务未运行";
  }
})();
```

- [ ] **Step 4: Reload extension + verify popup**

1. Reload extension in `chrome://extensions`
2. Click the Bili Clipper icon in the toolbar
3. Confirm: popup appears with all fields
4. Start the server: `.venv/bin/python server/server.py &`
5. Re-open popup → green dot + "本地服务运行中 · :27182"
6. Kill server → re-open popup → red dot + "本地服务未运行"

```bash
kill %1  # clean up
```

- [ ] **Step 5: Commit**

```bash
git add extension/background.js extension/popup.html extension/popup.js
git commit -m "feat(extension): background service worker + settings popup"
```

---

## Task 10: install.sh + uninstall.sh

**Files:**
- Create: `install.sh`
- Create: `uninstall.sh`

- [ ] **Step 1: Write install.sh**

```bash
#!/usr/bin/env bash
# install.sh — Bili Clipper local server installer
set -euo pipefail

INSTALL_DIR="$HOME/.local/share/bili-clipper"
PLIST_LABEL="com.bili-clipper.server"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Bili Clipper — 安装本地服务 ==="

# ── 1. macOS check ──────────────────────────────────────────────────────────
if [[ "$(uname)" != "Darwin" ]]; then
  echo "❌ 仅支持 macOS" && exit 1
fi

# ── 2. Python check ─────────────────────────────────────────────────────────
PYTHON=$(command -v python3.11 2>/dev/null || command -v python3 2>/dev/null || true)
if [[ -z "$PYTHON" ]]; then
  echo "❌ 未找到 Python 3.11+，请先安装: brew install python@3.11"
  exit 1
fi
PYVER=$("$PYTHON" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
REQ="3.11"
if [[ "$(printf '%s\n' "$REQ" "$PYVER" | sort -V | head -1)" != "$REQ" ]]; then
  echo "❌ Python ${PYVER} < 3.11" && exit 1
fi
echo "✓ Python ${PYVER}"

# ── 3. uv ────────────────────────────────────────────────────────────────────
if ! command -v uv &>/dev/null; then
  echo "→ 安装 uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
fi
echo "✓ uv $(uv --version)"

# ── 4. Install dir + copy server files ──────────────────────────────────────
mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/server/"*.py "$INSTALL_DIR/"
cp "$SCRIPT_DIR/server/requirements.txt" "$INSTALL_DIR/"
echo "✓ 服务文件已复制到 $INSTALL_DIR"

# ── 5. venv + deps ──────────────────────────────────────────────────────────
echo "→ 安装 Python 依赖（首次约 2 分钟）..."
uv venv --python "$PYTHON" "$INSTALL_DIR/.venv" 2>/dev/null || true
uv pip install -r "$INSTALL_DIR/requirements.txt" \
   --python "$INSTALL_DIR/.venv/bin/python" -q
echo "✓ 依赖安装完成"

# ── 6. launchd plist ────────────────────────────────────────────────────────
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key>           <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${INSTALL_DIR}/.venv/bin/python</string>
    <string>${INSTALL_DIR}/server.py</string>
  </array>
  <key>WorkingDirectory</key> <string>${INSTALL_DIR}</string>
  <key>RunAtLoad</key>        <true/>
  <key>KeepAlive</key>        <true/>
  <key>StandardOutPath</key>  <string>${INSTALL_DIR}/server.log</string>
  <key>StandardErrorPath</key><string>${INSTALL_DIR}/server.log</string>
</dict></plist>
PLIST

launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"
echo "✓ 服务已注册为开机自启"

# ── 7. Wait + verify ─────────────────────────────────────────────────────────
echo "→ 等待服务启动..."
sleep 3
if curl -sf http://localhost:27182/health > /dev/null 2>&1; then
  echo "✓ 服务运行中 → http://localhost:27182"
else
  echo "⚠ 服务可能还在下载 Whisper 模型，请稍候片刻再试"
  echo "  查看日志: tail -f ${INSTALL_DIR}/server.log"
fi

echo ""
echo "=== 安装完成 ✓ ==="
echo ""
echo "下一步: 在 Chrome 加载扩展"
echo "  chrome://extensions → 开发者模式 → 加载已解压 → 选择 extension/ 文件夹"
```

- [ ] **Step 2: Write uninstall.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$HOME/.local/share/bili-clipper"
PLIST_LABEL="com.bili-clipper.server"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"

echo "=== Bili Clipper — 卸载 ==="

launchctl unload "$PLIST_PATH" 2>/dev/null && echo "✓ 服务已停止" || true
rm -f "$PLIST_PATH" && echo "✓ launchd plist 已删除"
rm -rf "$INSTALL_DIR" && echo "✓ 安装目录已删除"

echo "卸载完成。Chrome 扩展请在 chrome://extensions 手动移除。"
```

- [ ] **Step 3: Make scripts executable**

```bash
chmod +x install.sh uninstall.sh
```

- [ ] **Step 4: Test install.sh end-to-end**

```bash
cd /Users/liyachen/Documents/fang/bili-clipper
bash install.sh
```

Expected final lines:
```
✓ 服务运行中 → http://localhost:27182
=== 安装完成 ✓ ===
```

Verify:
```bash
curl http://localhost:27182/health
# → {"status":"ok","model":"large-v3-turbo"}
```

- [ ] **Step 5: Commit**

```bash
git add install.sh uninstall.sh
git commit -m "feat: install.sh + uninstall.sh with launchd auto-start"
```

---

## Task 11: End-to-End Test + README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: End-to-end test — video WITH subtitles**

1. Start server: `bash install.sh` (or `launchctl start com.bili-clipper.server`)
2. Open Chrome → navigate to a B站 video with CC subtitles
   - Suggested: `https://www.bilibili.com/video/BV1GJ411x7h7` (a popular video with subtitles)
3. Confirm Clip bar shows "CC 字幕 ✓" badge
4. Click "Clip"
5. Within 3 seconds: green bar shows "✓ 已存入 Raw/[title].md"
6. Verify file exists in Obsidian vault:
   ```bash
   ls ~/Documents/Obsidian\ Vault/Raw/*.md | tail -5
   ```
7. Check frontmatter:
   ```bash
   head -10 ~/Documents/Obsidian\ Vault/Raw/"[title]".md
   ```

- [ ] **Step 2: End-to-end test — video WITHOUT subtitles**

1. Find a B站 video without CC subtitles (many tutorial/vlog videos)
2. Clip bar shows "Whisper 转录" badge
3. Click "Clip"
4. Bar shows "转录中（约 2 分钟）…"
5. After transcription: green success state
6. Check output in vault

- [ ] **Step 3: Write final README.md**

```markdown
# Bili Clipper

Chrome extension that clips Bilibili video transcripts directly to Obsidian.

- **Videos with CC subtitles** — extracts in ~2 seconds
- **Videos without subtitles** — local Whisper transcription (~2 min on M2 8GB), no API needed
- **Open source, free, local** — no data leaves your machine

## Requirements

- macOS (Apple Silicon M1/M2/M3 recommended; Intel works but slower)
- Python 3.11+
- Chrome

## Install

**Step 1 — Local server:**
```bash
curl -sSL https://raw.githubusercontent.com/YOUR_HANDLE/bili-clipper/main/install.sh | bash
```
This installs the Python server as a background service that auto-starts with your Mac.
First run downloads the Whisper `large-v3-turbo` model (~1.6 GB).

**Step 2 — Chrome extension:**
1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `extension/` folder from this repo

**Step 3 — Configure:**
Click the Bili Clipper icon in Chrome toolbar → set your Obsidian vault path.

## Usage

Navigate to any Bilibili video. A **Clip bar** appears below the title. Click **Clip**.
The note is saved to `Raw/[video title].md` in your vault.

## Output format

```markdown
---
title: 如何快速学习陌生领域
source: https://www.bilibili.com/video/BVxxx
platform: bilibili
date: 2026-05-20
tags: [transcript, bilibili]
transcript_method: cc_subtitle
---

[transcript text]
```

## Troubleshooting

**"本地服务未运行"**
```bash
# Check server logs
tail -f ~/.local/share/bili-clipper/server.log

# Restart manually
launchctl stop com.bili-clipper.server
launchctl start com.bili-clipper.server
```

**Whisper too slow / OOM**
Open extension popup → change ASR model to `medium` or `base`.

## Uninstall
```bash
bash uninstall.sh
```

## Credits
- [kangchainx/video-text-chrome-extension](https://github.com/kangchainx/video-text-chrome-extension) — architecture reference (MIT)
- [IndieKKY/bilibili-subtitle](https://github.com/IndieKKY/bilibili-subtitle) — Bilibili API reference
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
```

- [ ] **Step 4: Final commit**

```bash
git add README.md
git commit -m "docs: final README with install + troubleshooting guide"
git tag v0.1.0
```

---

## Self-Review Checklist

- [x] §3 Architecture → Tasks 2–5 cover server; Tasks 6–9 cover extension; Task 10 covers install script
- [x] §4 Path A (subtitle fast path) → Task 7 + 8 (`fetchSubtitleText` + `deliverTranscript`)
- [x] §4 Path B (Whisper path) → Task 4 + 5 (`download_audio` + `transcribe`) + Task 8 (`handleClip` whisper branch)
- [x] §4 Path C (clipboard) → Task 8 (`deliverTranscript` clipboard branch)
- [x] §5 Output format → Task 3 (`write_note` frontmatter)
- [x] §6 Extension UI states × 6 → Task 8 (`renderIdle`, `renderProcessing`, `renderSuccess`, `renderError`, `renderLoading`)
- [x] §7 Error handling → `renderError` + try/catch in `handleClip`; duplicate filename in `write_note`
- [x] No TBDs or placeholders
- [x] Type consistency: `write_note` signature matches calls in `server.py`; `ClipRequest` fields match `content.js` JSON body
