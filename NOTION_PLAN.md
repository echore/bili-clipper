# Notion 集成计划

## 核心思路

Notion 现在有原生 Markdown 端点（`PATCH /v1/pages/{id}/markdown`），可以直接发 Markdown 字符串写入页面，不需要转 blocks。现有的 `formatNote()` 输出基本可以直接复用。

## 认证方案

Personal Access Token（PAT）。用户去 `notion.so/developers` 创建 integration，拿到 `ntn_xxxxx` 格式的 token，粘贴到 popup 设置里。存 `chrome.storage.local`，和现有 vault_name 一样的模式。

## 写入流程

1. `POST /v1/pages` — 在用户指定的 database 里创建新页面，带 properties（title、source URL、author、date、tags）
2. `PATCH /v1/pages/{id}/markdown` with `replace_content` — 写入字幕 Markdown 正文

YAML frontmatter 改写成 Notion page properties。其余 Markdown 内容（`### 章节`、`**时间戳**`）直接发出去，Notion 原生渲染。

## 设置项（popup 新增）

- Notion Token（`ntn_xxxxx`）
- Notion Database ID（从页面 URL 复制）

## 输出选项扩展

现有 `output` 字段：`obsidian | clipboard | both`  
新增：`notion`，或者 `notion + clipboard` 组合

## Onboarding 引导（重点）

Notion 设置比 Obsidian 复杂，welcome.html 需要图文步骤：
1. 如何在 `notion.so/developers` 创建 integration 并拿到 token
2. 如何在 Notion 里建 database 并把它 share 给 integration
3. 如何从 URL 里找到 database ID

## manifest.json 变更

`host_permissions` 新增 `https://api.notion.com/*`

## UX 特点

- Clip 体验比 Obsidian 更流畅：纯后台 API，不跳转 app，点一下即完成
- 初始设置比 Obsidian 复杂：引导写好是关键

## 参考

- 端点文档：https://developers.notion.com/reference/update-page-markdown
- PAT 管理：https://notion.so/developers
- Changelog 确认时间：2026-06-08
