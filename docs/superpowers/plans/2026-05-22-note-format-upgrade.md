# Note Format Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Obsidian note output to include B站 embed iframe, video description (简介), and chapter-structured subtitles with within-chapter paragraph merging.

**Architecture:** CC path: all formatting in `content.js` (client-side). Whisper path: `content.js` sends `aid/cid/author/desc` to server; `writer.py` builds same iframe + 简介 structure with `_split_paragraphs` for body (no chapter structure — Whisper returns plain text, no per-segment timestamps). Chapter structure only applies to CC path.

**Tech Stack:** Vanilla JS (Chrome extension), Python/FastAPI (server), pytest

---

## Files

- Modify: `extension/content.js` — API helpers, formatting helpers, formatNote, handleClip
- Modify: `server/server.py` — Config model, add optional fields
- Modify: `server/writer.py` — format_note, add iframe + 简介
- Modify: `tests/test_writer.py` — update existing + add new tests

---

### Task 1: Update `getVideoInfo()` to return desc + author

**Files:** Modify `extension/content.js:10-18`

- [ ] **Step 1: Edit `getVideoInfo()`**

Replace lines 10–18 in `extension/content.js`:

```javascript
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
```

- [ ] **Step 2: Verify in DevTools console on any B站 video page**

```javascript
// Paste in DevTools → Console
getBvId()
// → "BVxxxxxxx"
getVideoInfo(getBvId()).then(console.log)
// Expected: { aid: ..., cid: ..., title: "...", desc: "...", author: "..." }
// Confirm desc and author are non-empty strings
```

---

### Task 2: Rename `getSubtitleList()` → `getPlayerData()`, also return chapters

**Files:** Modify `extension/content.js:20-28`

- [ ] **Step 1: Replace `getSubtitleList()` with `getPlayerData()`**

Replace lines 20–28 in `extension/content.js`:

```javascript
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
```

- [ ] **Step 2: Verify in DevTools on a video that has chapters (e.g. a long tutorial video)**

```javascript
getVideoInfo(getBvId()).then(({ aid, cid }) =>
  getPlayerData(aid, cid).then(console.log)
)
// Expected: { subtitles: [...], chapters: [{ title: "...", from: 0, to: 60 }, ...] }
// On a video without chapters: { subtitles: [...], chapters: [] }
```

---

### Task 3: Add formatting helper functions to content.js

**Files:** Modify `extension/content.js` — add new functions after `fetchSubtitleText` block (before `isServerRunning`)

- [ ] **Step 1: Replace `fetchSubtitleText()` with `fetchSubtitleItems()` and add helpers**

Replace lines 30–51 in `extension/content.js`:

```javascript
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
```

- [ ] **Step 2: Verify `buildSubtitleSection` logic in DevTools**

```javascript
// Paste in DevTools to smoke-test the logic (no network call needed)
const fakeItems = [
  { content: "你好", from: 0, to: 1 },
  { content: "世界", from: 1.2, to: 2 },
  { content: "第二段", from: 5, to: 6 },
];
const fakeChapters = [{ title: "开场", from: 0, to: 10 }];
console.log(buildSubtitleSection(fakeItems, fakeChapters));
// Expected:
// ### 开场 `0:00`
//
// 你好世界
//
// 第二段

console.log(buildSubtitleSection(fakeItems, []));
// Expected: 你好世界\n\n第二段
```

---

### Task 4: Update `formatNote()` in content.js

**Files:** Modify `extension/content.js:89-104`

- [ ] **Step 1: Replace `formatNote()` with new signature**

Replace the `formatNote` function (lines 89–104):

```javascript
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
```

---

### Task 5: Wire `loadVideoDataAndRenderIdle()` and `handleClip()`

**Files:** Modify `extension/content.js:173-312`

- [ ] **Step 1: Update `loadVideoDataAndRenderIdle()`**

Replace lines 173–185:

```javascript
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
```

- [ ] **Step 2: Fix destructuring at top of `handleClip()` to include all new fields**

Lines 250–251 currently read:
```javascript
  const settings = await getSettings();
  const { bvid, title, subtitles } = _videoData;
```

Replace with:
```javascript
  const settings = await getSettings();
  const { bvid, aid, cid, title, desc, author, subtitles, chapters } = _videoData;
```

- [ ] **Step 3: Update CC subtitle path in `handleClip()`**

Replace the CC subtitle block (lines 256–268) inside `handleClip()`:

```javascript
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
```

- [ ] **Step 4: Update Whisper path POST body in `handleClip()`**

Replace the `body: JSON.stringify(...)` block (lines 283–292):

```javascript
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
```

---

### Task 6: Update `server/server.py` — add fields to Config model

**Files:** Modify `server/server.py:22-27`

- [ ] **Step 1: Add optional fields to `Config`**

Replace the `Config` class (lines 22–27):

```python
class Config(BaseModel):
    folder: str = "Raw"
    output: str = "obsidian"
    model: str = "large-v3-turbo"
    bvid: Optional[str] = None
    aid: Optional[str] = None
    cid: Optional[str] = None
    author: Optional[str] = None
    desc: Optional[str] = None
```

---

### Task 7: Update `server/writer.py` + tests

**Files:** Modify `server/writer.py`, `tests/test_writer.py`

- [ ] **Step 1: Write failing tests first**

Replace all content of `tests/test_writer.py`:

```python
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
    assert 'title: "My Video"' in result
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
    assert 'title: "Title"' in result


def test_format_note_contains_iframe():
    config = {"bvid": "BV123", "cid": "456", "aid": "789"}
    result = format_note("Title", "text", config, "cc_subtitle")
    assert "<iframe" in result
    assert "player.bilibili.com" in result
    assert "BV123" in result


def test_format_note_includes_author():
    config = {"bvid": "BV123", "author": "某UP主"}
    result = format_note("Title", "text", config, "cc_subtitle")
    assert 'author: "某UP主"' in result


def test_format_note_with_desc_adds_intro_and_subtitle_headers():
    config = {"bvid": "BV123", "desc": "这是视频简介"}
    result = format_note("Title", "text", config, "cc_subtitle")
    assert "## 简介" in result
    assert "这是视频简介" in result
    assert "## 字幕" in result


def test_format_note_without_desc_has_no_section_headers():
    config = {"bvid": "BV123", "desc": ""}
    result = format_note("Title", "text", config, "cc_subtitle")
    assert "## 简介" not in result
    assert "## 字幕" not in result


def test_format_note_desc_none_has_no_section_headers():
    config = {"bvid": "BV123"}
    result = format_note("Title", "text", config, "cc_subtitle")
    assert "## 简介" not in result
    assert "## 字幕" not in result
```

- [ ] **Step 2: Run tests — confirm they fail on new assertions**

```bash
cd /Users/liyachen/Documents/fang/bili-clipper
.venv/bin/pytest tests/test_writer.py -v
```

Expected: 5 original tests pass, 5 new tests FAIL (`<iframe`, `author:`, `## 简介` not yet in output).

- [ ] **Step 3: Rewrite `server/writer.py`**

Replace entire file:

```python
import re
from datetime import date

_SENTENCE_END = re.compile(r'([。！？…]+["」』]?)')
_SENTENCES_PER_PARA = 4


def _split_paragraphs(text: str) -> str:
    text = re.sub(r'\s+', ' ', text).strip()
    parts = _SENTENCE_END.split(text)
    sentences: list[str] = []
    for i in range(0, len(parts) - 1, 2):
        sentence = (parts[i] + parts[i + 1]).strip()
        if sentence:
            sentences.append(sentence)
    if len(parts) % 2 == 1 and parts[-1].strip():
        sentences.append(parts[-1].strip())
    if not sentences:
        return text
    paragraphs = []
    for i in range(0, len(sentences), _SENTENCES_PER_PARA):
        paragraphs.append(''.join(sentences[i:i + _SENTENCES_PER_PARA]))
    return '\n\n'.join(paragraphs)


def _build_embed_iframe(bvid: str, cid: str, aid: str) -> str:
    return (
        f'<iframe src="https://player.bilibili.com/player.html'
        f'?bvid={bvid}&cid={cid}&aid={aid}&page=1&autoplay=0" '
        f'scrolling="no" border="0" frameborder="no" framespacing="0" '
        f'allowfullscreen="true" style="width:100%;aspect-ratio:16/9;"></iframe>'
    )


def format_note(title: str, transcript: str, config: dict, method: str) -> str:
    bvid = config.get("bvid") or ""
    aid = config.get("aid") or ""
    cid = config.get("cid") or ""
    author = config.get("author") or ""
    desc = config.get("desc") or ""
    source_url = f"https://www.bilibili.com/video/{bvid}" if bvid else ""
    safe_title = title.replace('"', '\\"')
    safe_author = author.replace('"', '\\"')
    body = _split_paragraphs(transcript)

    lines = [
        "---",
        f'title: "{safe_title}"',
        f"source: {source_url}",
        "platform: bilibili",
        f'author: "{safe_author}"',
        f"date: {date.today().isoformat()}",
        "tags: [transcript, bilibili]",
        f"transcript_method: {method}",
        "---",
        "",
        _build_embed_iframe(bvid, cid, aid),
        "",
    ]

    if desc and desc.strip():
        lines += ["## 简介", "", desc.strip(), "", "## 字幕", ""]

    lines.append(body)
    return "\n".join(lines)
```

- [ ] **Step 4: Run tests — all must pass**

```bash
.venv/bin/pytest tests/test_writer.py -v
```

Expected output:
```
test_format_note_returns_string PASSED
test_format_note_contains_frontmatter PASSED
test_format_note_includes_source_url PASSED
test_format_note_starts_with_frontmatter_delimiter PASSED
test_format_note_handles_missing_bvid PASSED
test_format_note_contains_iframe PASSED
test_format_note_includes_author PASSED
test_format_note_with_desc_adds_intro_and_subtitle_headers PASSED
test_format_note_without_desc_has_no_section_headers PASSED
test_format_note_desc_none_has_no_section_headers PASSED

10 passed
```

- [ ] **Step 5: Commit server changes**

```bash
git add server/writer.py server/server.py tests/test_writer.py
git commit -m "feat(server): add iframe, author, desc to note format"
```

---

### Task 8: Deploy server + reload extension + E2E test

**Files:** No code changes — verification only

- [ ] **Step 1: Restart server to pick up server.py + writer.py changes**

```bash
launchctl unload ~/Library/LaunchAgents/com.bili-clipper.server.plist
launchctl load ~/Library/LaunchAgents/com.bili-clipper.server.plist
```

Verify:
```bash
curl -s http://localhost:27182/health
# Expected: {"status":"ok","model":"mlx-community/whisper-large-v3-turbo"}
```

- [ ] **Step 2: Reload extension in Chrome**

Go to `chrome://extensions` → find Bili Clipper → click the reload (↺) button.

- [ ] **Step 3: Test CC path on a video WITH chapters**

Open a B站 video that has chapters (look for timestamp markers in the progress bar).

Click Clip. Open the resulting Obsidian note. Verify:
- YAML frontmatter has `author:` field
- `<iframe ...>` is present after frontmatter
- `## 简介` section with video description (if desc is non-empty)
- `## 字幕` section header (if desc was present)
- `### 章节名 \`时间戳\`` subsections under 字幕
- Within each chapter: subtitle lines merged into paragraphs (not one line per subtitle)

- [ ] **Step 4: Test CC path on a video WITHOUT chapters**

Open any B站 video without chapter markers. Click Clip. Verify:
- No `###` section headers in the note body
- Subtitle text appears as time-gap-merged paragraphs
- iframe and author still present

- [ ] **Step 5: Commit extension changes**

```bash
git add extension/content.js
git commit -m "feat(extension): chapter-structured subtitles, iframe, author, desc in note"
```
