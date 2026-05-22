# Bili Clipper — Product Backlog

> 个人开发 backlog。记录已知问题、待改进项、未来功能想法。
> 每次 session 开始前扫一眼，完成后更新状态。

---

## P0 — 发布前必修

### [P0] 缺少 Onboarding：新用户不知道如何开始
**模块：** UX / Onboarding
**问题：** 用户装好扩展后没有任何引导。第一次打开 popup 看到三个空白输入框，不知道"Vault 名称"填什么、"目标文件夹"是什么意思、Obsidian 需要做什么准备。核心痛点：Vault 名称填错或留空，扩展仍显示"成功"，笔记存到错误位置，用户完全不知道发生了什么。
**影响：** 新用户第一次使用极大概率失败。
**改法草案：**
- `background.js` 监听 `chrome.runtime.onInstalled`（reason === 'install'），自动打开 `welcome.html`（新 tab）
- `welcome.html` 只做三件事：
  1. 一句话说明扩展用途
  2. 带截图说明"Vault 名称在 Obsidian 左下角"，内嵌输入框让用户直接填写并保存到 `chrome.storage`
  3. "配置完成 → 去 B 站试试" 按钮
- `content.js` 的 `handleClip` 保留空 vault 拦截作为安全兜底（显示"请先完成初始设置"并附链接打开 welcome.html）
**状态：** `done`

---

### [P0] SPA 跳视频时 clip bar 数据不更新
**模块：** UX / content.js
**问题：** Bilibili 是单页应用，点击推荐视频时 URL 变化但页面不完全刷新。`_videoData` 和 `_clipBar` 停留在旧视频状态。用户在新视频上点 Clip，存进去的是旧视频的字幕和标题。
**影响：** 用户连续看多个视频时必然触发，存错笔记且不自知。
**改法草案：**
- 拦截 `history.pushState` / `history.replaceState` + 监听 `popstate`
- URL 变化时重置 `_videoData`、移除旧 clip bar、重新调用 `init()`
**状态：** `done`

---

## P1 — 发布后第一批迭代

### [P1] 视频教程链接待填入
**模块：** UX / welcome.html
**问题：** `welcome.js` 顶部 `TUTORIAL_URL` 常量目前为空字符串，页面显示"视频教程即将上线"。
**改法草案：** 录完视频发布后，将链接填入 `extension/welcome.js` 第 4 行的 `TUTORIAL_URL` 常量，重新发布扩展。
**状态：** `open`

---

### [P1] 默认文件夹 "Raw" 对新用户没有意义
**模块：** UX / Popup
**问题：** 目标文件夹默认值 "Raw" 是开发者自己的 vault 结构。普通用户 vault 里不一定有这个文件夹，Obsidian 会静默创建，用户不知道笔记跑到哪里。
**影响：** 轻微困惑，但笔记不会丢失（Obsidian 会自动建文件夹）。
**改法草案：** 改默认值为空字符串，placeholder 改为 "例如：Raw 或 Notes/Bilibili"；为空时笔记存到 vault 根目录。
**状态：** `open`

---

### [P1] 成功提示显示技术路径，对用户没有意义
**模块：** UX / Clip Bar
**问题：** 成功后显示 `"已存入 Raw/视频标题.md"`，用户看到的是内部文件路径，不直观。
**影响：** 小，不影响功能，但显得粗糙。
**改法草案：** 改为 `"已保存到 Obsidian ✓"` 或 `"已保存到 Obsidian · Raw 文件夹"`。
**状态：** `open`

---

### [P1] renderError 的 GitHub 帮助链接需要验证
**模块：** 代码质量 / content.js
**问题：** 错误状态显示的链接 `https://github.com/liyachen/bili-clipper#troubleshooting` 需要确认 README 里有对应锚点，发布后链接必须有效。
**影响：** 发布后如果链接 404，出错时用户找不到帮助。
**改法草案：** 确认 README troubleshooting 章节存在且锚点正确；或先改链接为 repo 根路径。
**状态：** `open`

---

## P2 — 长期 / 有空再看

### [P2] Qwen3-ASR 转录接回
**模块：** 功能 / transcriber.py（已保留 shell）
**背景：** 当前 `mlx-qwen3-asr`（v0.1.1，moona3k 社区移植）推理阶段 hang 住，已暂时禁用转录路径。模型本身（Qwen/Qwen3-ASR）是真实有效的，问题在 MLX 移植库。代码保留在 `git tag v0.1-with-asr`。
**触发条件：** 以下任一出现时重新评估：
- `mlx-qwen3-asr` 发布修复版本
- `mlx-audio`（Blaizzy）的 Qwen3-ASR 支持稳定
- 官方 Qwen 团队发布 MLX 版本
**改法草案：** 替换 `transcriber.py` 第 5 行的 import，其余接口不变。
**状态：** `open`

---

### [P2] Vault 自动检测替代方案
**模块：** UX / Popup
**背景：** 原"自动检测"功能调用本地服务 `/vaults` 读取 `~/Library/Application Support/obsidian/obsidian.json`。服务端删除后功能消失。
**约束：** Chrome 扩展无法直接读取本地文件系统。
**可能的方向：**
- 用户首次使用时引导手动填写（当前方向，配合 P0 的文字说明）
- 研究是否可以通过 Native Messaging 读取本地配置（复杂，可能过度设计）
- Obsidian 插件配合（超出扩展范围）
**状态：** `open`

---

### [P2] 多字幕语言支持
**模块：** 功能 / content.js
**问题：** 当前代码 `subtitles[0]` 直接取第一条字幕，不考虑用户偏好语言。部分视频同时有中文和英文 CC。
**改法草案：** popup 加语言偏好选项（中文优先 / 英文优先 / 第一条）；`fetchSubtitleItems` 按偏好筛选。
**状态：** `open`

---

## 已知限制（设计决策，非 bug）

| 限制 | 说明 |
|------|------|
| 仅支持有 CC 字幕的视频 | 转录路径已移除。无字幕视频显示灰色提示栏，不报错。 |
| 依赖 Obsidian 已安装 | 使用 `obsidian://` URI scheme，Obsidian 未安装时点击无反应。 |
| 仅支持 macOS | `obsidian://` URI 在 Windows/Linux 行为未测试。 |
| 笔记写入成功与否无法确认 | 扩展无法感知 Obsidian 是否真正创建了文件，成功提示是乐观的。 |

---

*最后更新：2026-05-22 · P0 全部完成（onboarding welcome 页 + SPA 导航修复）*
