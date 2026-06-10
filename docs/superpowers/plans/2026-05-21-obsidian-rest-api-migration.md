# Obsidian Local REST API Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace direct filesystem vault writes with Obsidian Local REST API, eliminating macOS TCC permission conflicts and making the service deployable on any macOS machine regardless of where the repo or vault lives.

**Architecture:** The Python server (port 27182) handles all calls to the Obsidian Local REST API (default HTTPS port 27123) using `httpx` with `verify=False` for the self-signed cert. The Chrome extension only ever talks to port 27182 over plain HTTP — no direct browser-to-Obsidian SSL connections. Server files are deployed to `~/.local/share/bili-clipper/` (a non-TCC path), so the launchd service needs no file system permissions beyond its own install directory.

**Tech Stack:** Python 3.11 / FastAPI / httpx / pytest-asyncio / Chrome Extension MV3

**Obsidian plugin required:** [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) (free, open-source community plugin)

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `server/requirements.txt` | Modify | Add `pytest-asyncio>=0.23.0` |
| `tests/test_writer.py` | Modify | Rewrite: filesystem assertions → mock httpx async calls |
| `server/writer.py` | Modify | Rewrite: filesystem writes → httpx Obsidian REST API |
| `server/server.py` | Modify | Config: remove `vault_path`, add `obsidian_url` + `obsidian_api_key`; add `/open` proxy endpoint; `await write_note` |
| `extension/popup.html` | Modify | Replace `vault_path` input → `obsidian_api_key` password input |
| `extension/popup.js` | Modify | Update storage keys throughout |
| `extension/content.js` | Modify | `getSettings()` defaults; `openInObsidian()` impl; two call sites |
| `install.sh` | Modify | Copy server files to `~/.local/share/bili-clipper/`; fix plist to run from there |

**Not changing:** `transcriber.py`, `background.js`, `manifest.json`, `tests/test_transcriber.py`

---

## Acceptance Criteria

- `curl http://localhost:27182/health` returns 200
- `pytest tests/test_writer.py -v` → 6 passed
- `server.log` shows no TCC "Operation not permitted" errors after reload
- Extension popup shows "Obsidian API Key" field, no vault path field
- CC subtitle clip → note appears in Obsidian vault under configured folder
- All Obsidian API calls are proxied through port 27182 (no direct browser→Obsidian SSL)

---

## Task 1: Add pytest-asyncio + rewrite tests (TDD — write failing tests first)

**Files:**
- Modify: `server/requirements.txt`
- Modify: `tests/test_writer.py`

- [ ] **Step 1: Add pytest-asyncio to requirements.txt**

```
fastapi>=0.110.0
uvicorn>=0.29.0
mlx-whisper>=0.4.0
yt-dlp>=2024.1.0
pytest>=8.0.0
pytest-asyncio>=0.23.0
httpx>=0.27.0
```

- [ ] **Step 2: Install the new dep into the venv**

```bash
uv pip install pytest-asyncio --python ~/.local/share/bili-clipper/.venv/bin/python
```

Expected: `Installed 1 package`

- [ ] **Step 3: Rewrite tests/test_writer.py**

```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from writer import write_note, sanitize_filename


def test_sanitize_filename_strips_invalid_chars():
    assert sanitize_filename('He said "hello/world"') == "He said hello world"


def test_sanitize_filename_truncates_at_100():
    assert len(sanitize_filename("a" * 200)) == 100


CONFIG = {
    "obsidian_url": "https://127.0.0.1:27123",
    "obsidian_api_key": "test-key-abc",
    "folder": "Raw",
    "bvid": "BV1xx411c7mD",
}


def make_mock_client(get_status=404, put_status=201):
    mock_get = MagicMock()
    mock_get.status_code = get_status

    mock_put = MagicMock()
    mock_put.status_code = put_status
    mock_put.raise_for_status = MagicMock()

    client = AsyncMock()
    client.get = AsyncMock(return_value=mock_get)
    client.put = AsyncMock(return_value=mock_put)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    return client


@pytest.mark.asyncio
async def test_write_note_new_file_returns_path():
    client = make_mock_client(get_status=404)
    with patch("writer.httpx.AsyncClient", return_value=client):
        path = await write_note("Test Video", "line1\nline2", CONFIG, "cc_subtitle")
    assert path == "Raw/Test Video.md"


@pytest.mark.asyncio
async def test_write_note_duplicate_adds_date():
    client = make_mock_client(get_status=200)
    with patch("writer.httpx.AsyncClient", return_value=client):
        path = await write_note("Test Video", "line1\nline2", CONFIG, "cc_subtitle")
    from datetime import date
    assert date.today().isoformat() in path
    assert path.startswith("Raw/")


@pytest.mark.asyncio
async def test_write_note_content_has_frontmatter():
    client = make_mock_client(get_status=404)
    with patch("writer.httpx.AsyncClient", return_value=client):
        await write_note("My Video", "transcript here", CONFIG, "whisper_large-v3-turbo")
    body = client.put.call_args[1]["content"].decode("utf-8")
    assert "title: My Video" in body
    assert "platform: bilibili" in body
    assert "transcript_method: whisper_large-v3-turbo" in body
    assert "transcript here" in body


@pytest.mark.asyncio
async def test_write_note_sets_auth_header():
    client = make_mock_client(get_status=404)
    with patch("writer.httpx.AsyncClient", return_value=client):
        await write_note("Vid", "text", CONFIG, "cc_subtitle")
    headers = client.put.call_args[1]["headers"]
    assert headers["Authorization"] == "Bearer test-key-abc"
```

- [ ] **Step 4: Run tests — confirm they FAIL (writer.py unchanged)**

```bash
cd /Users/liyachen/Documents/fang/bili-clipper
~/.local/share/bili-clipper/.venv/bin/pytest tests/test_writer.py -v
```

Expected: errors — current `write_note` is sync and filesystem-based, so the async tests will fail.

- [ ] **Step 5: Commit failing tests**

```bash
git add server/requirements.txt tests/test_writer.py
git commit -m "test(writer): rewrite for Obsidian REST API interface (failing — TDD)"
```

---

## Task 2: Rewrite server/writer.py

**Files:**
- Modify: `server/writer.py`

- [ ] **Step 1: Replace writer.py**

```python
import re
from datetime import date
from urllib.parse import quote
import httpx


def sanitize_filename(title: str) -> str:
    sanitized = re.sub(r'[/\\:*?"<>|]', "", title)
    return sanitized[:100].strip()


async def write_note(title: str, transcript: str, config: dict, method: str) -> str:
    obsidian_url = config.get("obsidian_url", "https://127.0.0.1:27123").rstrip("/")
    api_key = config.get("obsidian_api_key", "")
    folder = config.get("folder", "Raw")
    bvid = config.get("bvid", "")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "text/markdown",
    }

    filename = sanitize_filename(title) + ".md"
    vault_path = f"{folder}/{filename}"

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

    async with httpx.AsyncClient(verify=False) as client:
        check = await client.get(
            f"{obsidian_url}/vault/{quote(vault_path, safe='/')}",
            headers=headers,
        )
        if check.status_code == 200:
            filename = f"{sanitize_filename(title)}-{date.today().isoformat()}.md"
            vault_path = f"{folder}/{filename}"

        resp = await client.put(
            f"{obsidian_url}/vault/{quote(vault_path, safe='/')}",
            headers=headers,
            content=content.encode("utf-8"),
        )
        resp.raise_for_status()

    return vault_path
```

- [ ] **Step 2: Run tests — confirm 6 PASS**

```bash
~/.local/share/bili-clipper/.venv/bin/pytest tests/test_writer.py -v
```

Expected:
```
test_sanitize_filename_strips_invalid_chars PASSED
test_sanitize_filename_truncates_at_100 PASSED
test_write_note_new_file_returns_path PASSED
test_write_note_duplicate_adds_date PASSED
test_write_note_content_has_frontmatter PASSED
test_write_note_sets_auth_header PASSED
6 passed
```

- [ ] **Step 3: Commit**

```bash
git add server/writer.py
git commit -m "feat(writer): migrate to Obsidian Local REST API, drop filesystem writes"
```

---

## Task 3: Update server/server.py

**Files:**
- Modify: `server/server.py`

Changes: remove `vault_path` from Config, add `obsidian_url` + `obsidian_api_key`, add `/open` proxy endpoint so the browser never needs to make direct SSL calls to Obsidian, make `clip` endpoint `await write_note`.

- [ ] **Step 1: Replace server.py**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from urllib.parse import quote
import httpx
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
    obsidian_url: str = "https://127.0.0.1:27123"
    obsidian_api_key: str = ""
    folder: str = "Raw"
    output: str = "obsidian"
    model: str = "large-v3-turbo"
    bvid: Optional[str] = None


class ClipRequest(BaseModel):
    bvid: str
    title: str
    transcript: Optional[str] = None
    config: Config = Config()


class OpenRequest(BaseModel):
    path: str
    obsidian_url: str = "https://127.0.0.1:27123"
    obsidian_api_key: str = ""


@app.get("/health")
def health():
    return {"status": "ok", "model": "mlx-community/whisper-large-v3-turbo"}


@app.post("/open")
async def open_note(req: OpenRequest):
    """Proxy open-in-Obsidian so the browser never makes direct SSL calls."""
    url = req.obsidian_url.rstrip("/")
    headers = {"Authorization": f"Bearer {req.obsidian_api_key}"}
    try:
        async with httpx.AsyncClient(verify=False) as client:
            await client.post(
                f"{url}/open/{quote(req.path, safe='/')}",
                headers=headers,
            )
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/clip")
async def clip(req: ClipRequest):
    try:
        if req.transcript:
            path = await write_note(
                req.title,
                req.transcript,
                req.config.model_dump(),
                method="cc_subtitle",
            )
        else:
            audio_path = await download_audio(req.bvid)
            transcript_text = await transcribe(audio_path, req.config.model)
            path = await write_note(
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

- [ ] **Step 2: Verify syntax**

```bash
~/.local/share/bili-clipper/.venv/bin/python -c \
  "import ast; ast.parse(open('server/server.py').read()); print('syntax OK')"
```

Expected: `syntax OK`

- [ ] **Step 3: Commit**

```bash
git add server/server.py
git commit -m "feat(server): Obsidian REST API config, add /open proxy endpoint"
```

---

## Task 4: Update extension popup

**Files:**
- Modify: `extension/popup.html`
- Modify: `extension/popup.js`

- [ ] **Step 1: In popup.html, replace the vault_path row**

Find:
```html
  <div class="row">
    <label>Obsidian Vault 路径</label>
    <input type="text" id="vault_path" placeholder="~/Documents/Obsidian Vault">
  </div>
```

Replace with:
```html
  <div class="row">
    <label>Obsidian API Key</label>
    <input type="password" id="obsidian_api_key" placeholder="从 Obsidian Local REST API 插件复制">
  </div>
```

- [ ] **Step 2: In popup.js, update storage defaults and DOM reads**

Find:
```js
chrome.storage.local.get(
  { vault_path: "~/Documents/Obsidian Vault", folder: "Raw", output: "obsidian", model: "large-v3-turbo" },
  (s) => {
    document.getElementById("vault_path").value = s.vault_path;
```

Replace with:
```js
chrome.storage.local.get(
  { obsidian_api_key: "", folder: "Raw", output: "obsidian", model: "large-v3-turbo" },
  (s) => {
    document.getElementById("obsidian_api_key").value = s.obsidian_api_key;
```

- [ ] **Step 3: In popup.js, update save()**

Find:
```js
  chrome.storage.local.set({
    vault_path: document.getElementById("vault_path").value.trim(),
```

Replace with:
```js
  chrome.storage.local.set({
    obsidian_api_key: document.getElementById("obsidian_api_key").value.trim(),
```

- [ ] **Step 4: In popup.js, update event listener array**

Find:
```js
["vault_path", "folder", "model"].forEach((id) =>
```

Replace with:
```js
["obsidian_api_key", "folder", "model"].forEach((id) =>
```

- [ ] **Step 5: Commit**

```bash
git add extension/popup.html extension/popup.js
git commit -m "feat(popup): replace vault_path with obsidian_api_key field"
```

---

## Task 5: Update extension/content.js

**Files:**
- Modify: `extension/content.js`

Three separate changes.

- [ ] **Step 1: Update getSettings() defaults**

Find:
```js
    chrome.storage.local.get(
      {
        vault_path: "~/Documents/Obsidian Vault",
        folder: "Raw",
        output: "obsidian",
        model: "large-v3-turbo",
      },
```

Replace with:
```js
    chrome.storage.local.get(
      {
        obsidian_api_key: "",
        folder: "Raw",
        output: "obsidian",
        model: "large-v3-turbo",
      },
```

- [ ] **Step 2: Replace openInObsidian() implementation**

Find:
```js
function openInObsidian(vaultPath, filePath) {
  const vaultName = vaultPath.replace(/\/$/, "").split("/").pop();
  const url = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(filePath)}`;
  window.open(url, "_blank");
}
```

Replace with:
```js
async function openInObsidian(filePath, settings) {
  try {
    await fetch("http://localhost:27182/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: filePath,
        obsidian_url: "https://127.0.0.1:27123",
        obsidian_api_key: settings.obsidian_api_key || "",
      }),
    });
  } catch {
    // Non-critical: note is already saved even if open fails
  }
}
```

- [ ] **Step 3: Update the two call sites for openInObsidian**

In `handleClip()`, find:
```js
        openInObsidian(settings.vault_path, whisperData.path);
```
Replace with:
```js
        await openInObsidian(whisperData.path, settings);
```

In `deliverTranscript()`, find:
```js
    openInObsidian(settings.vault_path, data.path);
```
Replace with:
```js
    await openInObsidian(data.path, settings);
```

- [ ] **Step 4: Commit**

```bash
git add extension/content.js
git commit -m "feat(content): update settings schema, proxy openInObsidian through /open endpoint"
```

---

## Task 6: Fix deployment — install.sh + immediate plist fix

This unblocks the currently broken service and ensures future installs also work.

**Files:**
- Modify: `install.sh`

- [ ] **Step 1: Immediately fix the broken service (manual steps)**

Copy the updated server files to the install dir:
```bash
cp /Users/liyachen/Documents/fang/bili-clipper/server/server.py \
   /Users/liyachen/Documents/fang/bili-clipper/server/writer.py \
   /Users/liyachen/Documents/fang/bili-clipper/server/transcriber.py \
   ~/.local/share/bili-clipper/
```

Rewrite the plist to point to the install dir:
```bash
cat > ~/Library/LaunchAgents/com.bili-clipper.server.plist << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key>           <string>com.bili-clipper.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/liyachen/.local/share/bili-clipper/.venv/bin/python</string>
    <string>/Users/liyachen/.local/share/bili-clipper/server.py</string>
  </array>
  <key>WorkingDirectory</key> <string>/Users/liyachen/.local/share/bili-clipper</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/Users/liyachen/.local/share/bili-clipper/.venv/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>        <true/>
  <key>KeepAlive</key>        <true/>
  <key>StandardOutPath</key>  <string>/Users/liyachen/.local/share/bili-clipper/server.log</string>
  <key>StandardErrorPath</key><string>/Users/liyachen/.local/share/bili-clipper/server.log</string>
</dict></plist>
PLIST
```

Reload and verify:
```bash
launchctl unload ~/Library/LaunchAgents/com.bili-clipper.server.plist
launchctl load ~/Library/LaunchAgents/com.bili-clipper.server.plist
sleep 3
curl http://localhost:27182/health
```

Expected: `{"status":"ok","model":"mlx-community/whisper-large-v3-turbo"}`

- [ ] **Step 2: Update install.sh so future installs work the same way**

In `install.sh`, replace the block starting from `# Service runs directly from repo` (line 56) through the end of the plist heredoc with:

```bash
# Deploy server files to non-TCC path so launchd can read them
echo "→ 部署服务文件..."
cp "$SCRIPT_DIR/server/server.py" "$INSTALL_DIR/server.py"
cp "$SCRIPT_DIR/server/writer.py" "$INSTALL_DIR/writer.py"
cp "$SCRIPT_DIR/server/transcriber.py" "$INSTALL_DIR/transcriber.py"
echo "✓ 服务文件已部署到 $INSTALL_DIR"

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
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${FFMPEG_DIR}:${INSTALL_DIR}/.venv/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>        <true/>
  <key>KeepAlive</key>        <true/>
  <key>StandardOutPath</key>  <string>${INSTALL_DIR}/server.log</string>
  <key>StandardErrorPath</key><string>${INSTALL_DIR}/server.log</string>
</dict></plist>
PLIST
```

Also update the final echo block to replace vault path instructions with Obsidian plugin instructions:

```bash
echo ""
echo "=== 安装完成 ✓ ==="
echo ""
echo "【必须】配置 Obsidian Local REST API 插件："
echo "  1. 打开 Obsidian → 设置 → 社区插件 → 浏览"
echo "  2. 搜索 'Local REST API'，安装并启用"
echo "  3. 在插件设置中复制 API Key"
echo "  4. 打开 Bili Clipper 扩展弹窗，粘贴 API Key"
echo ""
echo "加载 Chrome 扩展："
echo "  chrome://extensions → 开发者模式 → 加载已解压 → 选择 extension/ 文件夹"
```

- [ ] **Step 3: Add note about re-deploy after code changes**

After the `echo "✓ 服务文件已部署到 $INSTALL_DIR"` line, add:

```bash
echo "  （每次更新代码后重新运行 install.sh 以部署最新版本）"
```

- [ ] **Step 4: Commit**

```bash
git add install.sh
git commit -m "feat(install): deploy server files to non-TCC path, fix launchd plist"
```

---

## Task 7: E2E Verification

- [ ] **Step 1: Install Obsidian Local REST API plugin**

In Obsidian:
1. Settings → Community plugins → turn off Safe Mode if needed → Browse
2. Search "Local REST API" → Install → Enable
3. Plugin settings → copy the API Key (long string)

- [ ] **Step 2: Set API key in extension popup**

Open the Bili Clipper extension popup → paste API Key → field auto-saves.

- [ ] **Step 3: Reload the extension in Chrome**

Go to `chrome://extensions` → find Bili Clipper → click the reload (↺) button.

- [ ] **Step 4: Verify /clip endpoint directly**

```bash
curl -s -X POST http://localhost:27182/clip \
  -H "Content-Type: application/json" \
  -d '{
    "bvid": "BV1xx411c7mD",
    "title": "Migration Test Note",
    "transcript": "This is a test transcript.",
    "config": {
      "obsidian_api_key": "PASTE_YOUR_KEY_HERE",
      "folder": "Raw"
    }
  }' | python3 -m json.tool
```

Expected:
```json
{
  "success": true,
  "path": "Raw/Migration Test Note.md"
}
```

Open Obsidian → verify `Raw/Migration Test Note.md` exists with correct content.

- [ ] **Step 5: Full browser E2E test**

1. Go to a Bilibili video with CC subtitles (look for CC badge in Bili Clipper bar)
2. Click **Clip**
3. Verify note appears in Obsidian under `Raw/`
4. Verify Obsidian navigates to the new note automatically

- [ ] **Step 6: Check server.log has no TCC errors**

```bash
tail -20 ~/.local/share/bili-clipper/server.log
```

Expected: no "Operation not permitted" lines.

---

## Developer Workflow (after this migration)

When you edit server-side code (`server.py`, `writer.py`, `transcriber.py`):

```bash
# Re-deploy to install dir, then restart
cp server/server.py server/writer.py server/transcriber.py ~/.local/share/bili-clipper/
launchctl unload ~/Library/LaunchAgents/com.bili-clipper.server.plist
launchctl load ~/Library/LaunchAgents/com.bili-clipper.server.plist
```

Or just re-run `bash install.sh` — it handles everything.
