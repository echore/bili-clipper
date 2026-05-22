# Bili Clipper — Product Backlog

> 个人开发 backlog。记录已知问题、待改进项、未来功能想法。
> 每次 session 开始前扫一眼，完成后更新状态。

---

## P0 — 发布前必修（上架准备）

### [P0] Chrome Web Store 商店截图
**模块：** 上架资产
**问题：** 商店详情页需要截图（1280×800），是用户决定是否安装的主要参考。
**需要：** 3-5 张，建议内容：① Clip bar 在 B 站视频页的效果 ② 成功保存后的状态 ③ popup 设置界面 ④ Obsidian 里生成的笔记效果
**状态：** `open`

---

### [P0] Chrome Web Store 描述文案
**模块：** 上架资产
**问题：** 需要简短描述（132 字符以内）和详细描述，建议中英文各一份。
**状态：** `open`

---

## P1 — 发布后第一批迭代

### [P1] 视频教程链接待填入
**模块：** UX / welcome.html
**问题：** `welcome.js` 顶部 `TUTORIAL_URL` 常量目前为空字符串，页面显示"视频教程即将上线"。
**改法草案：** 录完视频发布后，将链接填入 `extension/welcome.js` 第 4 行的 `TUTORIAL_URL` 常量，重新发布扩展。
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
| [P0] 扩展图标重新设计 | ChatGPT DALL-E 3 生成紫底白回形针，sips 批量缩放至 16/48/128px |
| [P0] 隐私政策页面 | docs/privacy-policy.html，GitHub Pages 托管：https://echore.github.io/bili-clipper/privacy-policy.html |
| [P0] 缺少 Onboarding | welcome.html + background.js onInstalled 监听 |
| [P0] SPA 跳视频时 clip bar 不更新 | 拦截 pushState/replaceState + popstate |
| [P1] 默认文件夹 "Raw" 对新用户无意义 | 改默认值为空字符串 |
| [P1] 成功提示显示技术路径 | 改为"已保存到 Obsidian" |
| [P1] 打开设置按钮被 Chrome 拦截 | 改用 button + sendMessage 绕过内容脚本限制 |
| [P1] renderError GitHub 链接需验证 | README 第 61 行已有 `## Troubleshooting`，锚点有效 |
| [P2] Vault 自动检测替代方案 | 手动填写 + welcome 页截图引导已够用，无需自动检测 |
| [P1] Popup 设置保存无反馈 | 标题旁加"✓ 已保存"1.5s 淡出提示 |
| [P2] Clip 历史记录 | popup 加可滚动列表，最多 20 条，按 URL 去重 |
| [P1] Obsidian 是否真正打开无反馈 | 成功栏右侧加灰色小字"如未自动打开，请先启动 Obsidian 再重试" |

---

*最后更新：2026-05-22 · P0 完成：图标重设计、隐私政策页面（GitHub Pages）；剩余 P0：商店截图、描述文案*
