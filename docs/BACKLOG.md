# Bili Clipper — Product Backlog

> 个人开发 backlog。记录已知问题、待改进项、未来功能想法。
> 每次 session 开始前扫一眼，完成后更新状态。

---

## P1 — 发布后第一批迭代

### [P1] 视频教程链接待填入
**模块：** UX / welcome.html
**问题：** `welcome.js` 顶部 `TUTORIAL_URL` 常量目前为空字符串，页面显示"视频教程即将上线"。
**改法草案：** 录完视频发布后，将链接填入 `extension/welcome.js` 第 4 行的 `TUTORIAL_URL` 常量，重新发布扩展。
**状态：** `open`

---

### [P1] renderError 的 GitHub 帮助链接需要验证
**模块：** 代码质量 / content.js
**问题：** 错误状态显示的链接 `https://github.com/liyachen/bili-clipper#troubleshooting` 需要确认 README 里有对应锚点，发布后链接必须有效。
**影响：** 发布后如果链接 404，出错时用户找不到帮助。
**改法草案：** 确认 README troubleshooting 章节存在且锚点正确；或先改链接为 repo 根路径。
**状态：** `open`

---

### [P1] Obsidian 是否真正打开无反馈
**模块：** UX / Clip Bar
**问题：** 扩展调用 `obsidian://new` URI 后无法感知 Obsidian 是否响应。如果 Obsidian 未安装、未运行，或 URI 被系统忽略，扩展仍然显示"已保存到 Obsidian ✓"——成功提示是乐观的，实际可能什么都没发生。
**影响：** 新用户第一次使用时，如果 Obsidian 没有正确配置，会误以为成功，找不到笔记。
**改法草案：** 在成功提示下方加一行小字："如 Obsidian 未自动打开，请手动启动后重试"；或改提示文案为"已发送到 Obsidian（请确认 Obsidian 已打开）"。Chrome 扩展无法直接检测 URI 是否被处理，文案兜底是最轻量方案。
**状态：** `open`

---

### [P1] Popup 设置保存无反馈
**模块：** UX / Popup
**问题：** `popup.js` 监听 `change` 事件静默保存，用户输入后关闭 popup 无任何视觉确认。用户不知道设置是否已生效，尤其是第一次配置 vault 名称时。
**影响：** 用户可能重复填写、或不确定设置是否已保存。
**改法草案：** 保存成功后短暂显示"已保存 ✓"文字（1.5 秒后淡出），无需额外按钮。
**状态：** `open`

---

## P2 — 长期 / 有空再看

### [P2] 无字幕视频降级：复制标题 + 链接到剪贴板
**模块：** UX / Clip Bar
**问题：** 无 CC 字幕的视频目前显示灰色"暂不支持 Clip"提示，用户只能关掉。没有任何降级动作。
**影响：** 用户想记录这个视频但扩展帮不上忙，体验终止在灰色提示。
**改法草案：** 在无字幕提示旁加一个"复制链接"按钮，点击后将 `[视频标题](bilibili URL)` Markdown 格式复制到剪贴板，用户可以手动粘贴到 Obsidian。轻量，不需要服务端。
**状态：** `open`

---

### [P2] Clip 历史记录
**模块：** 功能 / Popup
**问题：** 用户不知道自己 Clip 过哪些视频，重复 Clip 同一个视频也不会提示。
**影响：** 重度用户会想翻记录；轻度用户无感。
**改法草案：** 用 `chrome.storage.local` 保存最近 20 条 Clip 记录（标题 + URL + 时间），在 popup 里展示列表。点击可跳转 B 站原视频。
**状态：** `open`

---

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

## 已完成

| 项目 | 完成方式 |
|------|----------|
| [P0] 缺少 Onboarding | welcome.html + background.js onInstalled 监听 |
| [P0] SPA 跳视频时 clip bar 不更新 | 拦截 pushState/replaceState + popstate |
| [P1] 默认文件夹 "Raw" 对新用户无意义 | 改默认值为空字符串 |
| [P1] 成功提示显示技术路径 | 改为"已保存到 Obsidian" |
| [P1] 打开设置按钮被 Chrome 拦截 | 改用 button + sendMessage 绕过内容脚本限制 |

---

*最后更新：2026-05-22*
