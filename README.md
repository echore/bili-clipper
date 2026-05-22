# Bili Clipper

Chrome extension that clips Bilibili video transcripts directly to Obsidian.

**Only supports videos with CC subtitles.** Extraction completes in ~2 seconds — no server, no Python, no local model required.

## Requirements

- Chrome
- [Obsidian](https://obsidian.md)

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `extension/` folder from this repo

## Configure

Click the Bili Clipper icon in the Chrome toolbar and enter:

- **Vault 名称** — the folder name shown in the Obsidian title bar (e.g. `Obsidian Vault`)
- **目标文件夹** — subfolder inside the vault where notes are saved (default: `Raw`)
- **输出目标** — `Obsidian` (open Obsidian with the note), `剪贴板` (copy to clipboard only), or `两者` (both)

## Usage

Navigate to any Bilibili video that has CC subtitles. A **Clip bar** appears below the video title — click **Clip**. The note is written to `<folder>/<video title>.md` in your vault and Obsidian opens automatically.

Videos without CC subtitles show no Clip bar.

## Output format

```markdown
---
title: "如何快速学习陌生领域"
source: https://www.bilibili.com/video/BVxxx
platform: bilibili
author: "UP主名字"
date: 2026-05-22
tags: [transcript, bilibili]
transcript_method: cc_subtitle
---

<iframe src="https://player.bilibili.com/player.html?bvid=BVxxx&..." ...></iframe>

## 简介
视频描述文字（仅在有简介时出现）

## 字幕

### 章节名 `0:00`
合并后的段落文字…

### 章节名 `5:30`
合并后的段落文字…
```

Videos without chapters show the transcript as time-gap-merged paragraphs directly under `## 字幕`.

## Troubleshooting

**Obsidian doesn't open automatically**
Make sure Obsidian is running and the vault name in the extension popup matches exactly.

**No Clip bar on a video**
The video does not have CC subtitles. Bili Clipper only supports CC subtitle videos.

## Credits
- [haixiong1997/Bilibili-Obsidian-Clipper](https://github.com/haixiong1997/Bilibili-Obsidian-Clipper) — note format reference
- [kangchainx/video-text-chrome-extension](https://github.com/kangchainx/video-text-chrome-extension) — architecture reference (MIT)
- [IndieKKY/bilibili-subtitle](https://github.com/IndieKKY/bilibili-subtitle) — Bilibili API reference
