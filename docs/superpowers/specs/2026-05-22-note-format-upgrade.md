# Note Format Upgrade — Design Spec

**Date:** 2026-05-22  
**Status:** Approved

## Goal

Upgrade the Obsidian note format produced by bili-clipper to include:
- B站视频 embed iframe（直接在笔记里看视频）
- 视频简介（上下文）
- 章节分段字幕（语义结构，借鉴参考项目）
- 章节内段落合并（我们的改进，参考项目没有做）

Out of scope: 标点恢复、LLM后处理、UI改动。

Done when: CC路径和Whisper路径都能输出新格式，手动验证笔记结构正确。

---

## New Note Structure

```
---
title: "视频标题"
source: https://www.bilibili.com/video/BVxxx
platform: bilibili
author: UP主名字
date: 2026-05-22
tags: [transcript, bilibili]
transcript_method: cc_subtitle | whisper
---

<iframe src="https://player.bilibili.com/player.html?bvid=BVxxx&cid=xxx&page=1&autoplay=0" ...></iframe>

## 简介
视频描述文字（有简介才加此 section）

## 字幕（有简介时加此标题；无简介时直接从章节/段落开始）

### 章节名 `0:00`
合并后的段落文字...

### 章节名 `2:30`
合并后的段落文字...
```

无章节时：字幕区用现有时间 gap（>2s）启发式分段，不加 `###`。

---

## Changes

### content.js

**`getVideoInfo(bvid)`**
- 现在返回：`{ aid, cid, title }`
- 改为返回：`{ aid, cid, title, desc, author }`

**`getSubtitleList(aid, cid)` → 合并进新函数或同时返回 chapters**
- `/x/player/wbi/v2` 接口同时包含字幕和章节数据
- 返回：`{ subtitles, chapters }`
- chapters 结构：`[{ title, from, to }, ...]`（秒数）

**`fetchSubtitleText(subtitleUrl)` → `buildSubtitleSection(subtitleUrl, chapters)`**
- 有章节：按章节时间范围分组字幕条目，组内用时间 gap 合并段落，输出 `### 章节名 \`时间戳\`` + 段落
- 无章节：当前时间 gap 逻辑不变

**`formatNote(title, transcript, bvid, method)`**
- 追加参数：`author`, `desc`, `aid`, `cid`
- 加入 embed iframe
- 有 desc → 加 `## 简介` + `## 字幕` 标题；无 desc → 直接输出字幕内容

**`handleClip()` — Whisper路径**
- POST `/clip` body 追加：`desc`, `author`, `chapters`

### server/writer.py

**`format_note(title, transcript, config, method)`**
- config 新增字段：`desc`, `author`, `aid`, `cid`, `chapters`
- 按同样结构输出（iframe + 简介 + 字幕分段）
- `_split_paragraphs()` 保留，用于章节内或无章节时的段落合并

### server/server.py

**`/clip` endpoint**
- ClipRequest 新增字段：`desc`, `author`, `chapters`（可选，有就用）

---

## Timestamp Format

章节时间戳显示格式：`M:SS`（< 1小时）或 `H:MM:SS`（≥ 1小时），与参考项目一致。

---

## Acceptance Criteria

1. CC路径：笔记包含 iframe、简介（如有）、章节分段（如有）、段落合并字幕
2. Whisper路径：同上结构，由 writer.py 生成
3. 无简介视频：不出现空的 `## 简介` section
4. 无章节视频：字幕为时间 gap 分段的平铺段落
5. 两路径 frontmatter 均含 `author` 字段
