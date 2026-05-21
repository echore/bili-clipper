# Bili Clipper — 项目进度日志

> 内部进度看板。记录每个 Task 的执行状态、结果、问题。
> 对外文档见 README.md。

---

## 进度总览

| Task | 内容 | 状态 |
|------|------|------|
| Task 1 | Project Setup | ✅ 完成 |
| Task 2 | Python Server — /health | ✅ 完成 |
| Task 3 | writer.py — 笔记格式化 + 写入 | ✅ 完成 |
| Task 4 | transcriber.py — yt-dlp + Whisper | ✅ 完成 |
| Task 5 | server.py — /clip 端点串联 | ✅ 完成 |
| Task 6 | Chrome 扩展 — Manifest + Icons | ✅ 完成 |
| Task 7 | content.js — Bilibili API Helpers | ✅ 完成 |
| Task 8 | content.js — Clip Bar UI + 状态机 | ✅ 完成 |
| Task 9 | background.js + Popup | ✅ 完成 |
| Task 10 | install.sh + uninstall.sh | ✅ 完成 |
| Task 11 | E2E 测试 + README | ✅ 完成（E2E 待用户验证） |

---

## Task 1 — Project Setup ✅

**目标：** git 初始化 + .gitignore + README stub

| 步骤 | 描述 | 状态 |
|------|------|------|
| Step 1 | git init + .gitignore | ✅ |
| Step 2 | stub README.md | ✅ |
| Step 3 | initial commit | ✅ |

**结果：**
- Commit: `chore: project scaffold`
- .gitignore 覆盖：`__pycache__/`, `.venv/`, `.DS_Store`, `*.log` 等

**问题：** 无

---

## Task 2 — Python Server /health ✅

**目标：** FastAPI 骨架，`/health` 端点可响应

| 步骤 | 描述 | 状态 |
|------|------|------|
| Step 1 | 写 server/requirements.txt | ✅ |
| Step 2 | 写 server/server.py（/health only） | ✅ |
| Step 3 | uv venv + 安装依赖 | ✅ |
| Step 4 | 验证 /health 响应 | ✅ |
| Step 5 | commit | ✅ |

**结果：**
```
curl http://localhost:27182/health
→ {"status":"ok","model":"large-v3-turbo"}
```
Commit: `f58b49d` — feat(server): FastAPI skeleton with /health endpoint

**Review 结论：** Spec ✅ 全通过 | 代码质量 ✅ 通过
**注：** CORS `allow_origins=["*"]` 对 Chrome 扩展调用 localhost 是正确做法，无需修改

---

## Task 3 — writer.py ✅

**目标：** 格式化 markdown 笔记并写入 Obsidian vault

| 步骤 | 描述 | 状态 |
|------|------|------|
| Step 1 | 写 tests/test_writer.py（先写失败测试） | ✅ |
| Step 2 | 运行测试 — 预期 ModuleNotFoundError | ✅ |
| Step 3 | 写 server/writer.py | ✅ |
| Step 4 | 运行测试 — 6 passed | ✅ |
| Step 5 | commit | ✅ |

**结果：** 6 passed（spec 说 5，实际有 6 个测试函数，全通过）
Commit: `4811b9d` — feat(server): writer module — format + write vault notes

**Review 结论：** Spec ✅ | 代码质量 ✅

---

## Task 4 — transcriber.py ✅

**目标：** yt-dlp 下载音频 + faster-whisper 转录，模型缓存

| 步骤 | 描述 | 状态 |
|------|------|------|
| Step 1 | 写 tests/test_transcriber.py（mock，不真实下载） | ✅ |
| Step 2 | 运行测试 — 预期 ModuleNotFoundError | ✅ |
| Step 3 | 写 server/transcriber.py | ✅ |
| Step 4 | 运行测试 — 3 passed | ✅ |
| Step 5 | commit | ✅ |

**结果：** 3 passed
- Commit 1: `1363bfd` — feat(server): transcriber — yt-dlp download + faster-whisper
- Commit 2: `70eab54` — fix(server): make transcribe() async to avoid blocking event loop

**Review 发现的问题及修复：**
- `transcribe()` 原为同步函数，会阻塞 FastAPI event loop → 改为 async，内部调用 `asyncio.to_thread(_transcribe_sync, ...)`
- 加了 `_model_lock = asyncio.Lock()` 防止并发初始化冲突

**注：** yt-dlp 加了 `--extractor-args bilibili:player_client=app` 作为 B站访问限制 fallback

---

## Task 5 — server.py /clip 端点 ✅

**目标：** /clip 端点串联 transcriber + writer

| 步骤 | 描述 | 状态 |
|------|------|------|
| Step 1 | 替换 server.py 为完整版本（含 /clip） | ✅ |
| Step 2 | curl 测试 /clip 快速路径（已有字幕） | ✅ |
| Step 3 | commit | ✅ |

**结果：**
```
/health → {"status":"ok","model":"large-v3-turbo"}
/clip   → {"success":true,"path":"Raw/Test Video.md"}
/tmp/test-vault/Raw/Test Video.md 含正确 frontmatter
```
Commit: `54fd32f` — feat(server): /clip endpoint wires transcriber + writer

**Review 结论：** Spec ✅ | 代码质量 ✅

---

## Task 6 — Chrome 扩展 Manifest + Icons ✅

**目标：** extension/ 骨架能在 Chrome 加载无报错

| 步骤 | 描述 | 状态 |
|------|------|------|
| Step 1 | 写 extension/manifest.json | ✅ |
| Step 2 | Python 脚本生成占位 icon（16/48/128px） | ✅ |
| Step 3 | Chrome 加载扩展（需用户手动验证） | ⏳ 待用户确认 |
| Step 4 | commit | ✅ |

**结果：**
- icon16.png (79B), icon48.png (123B), icon128.png (306B) — 紫色占位图
- content.js / background.js / popup.html stub 已创建
Commit: `d689aaf` — feat(extension): manifest v3 + placeholder icons + stub files

**⚠️ 需要用户操作：** 请在 Chrome 中加载 `extension/` 文件夹确认无报错

---

## Task 7 — content.js Bilibili API Helpers ✅

**目标：** getBvId / getVideoInfo / getSubtitleList / fetchSubtitleText / isServerRunning / getSettings

| 步骤 | 描述 | 状态 |
|------|------|------|
| Step 1 | 写 extension/content.js（API helpers 部分） | ✅ |
| Step 2 | B站视频页 DevTools Console 手动验证 | ⏳ 待用户确认 |
| Step 3 | commit | ✅ |

**关键修正（vs 原计划）：**
- `getSubtitleList` 改用 `wbi/v2?aid=&cid=`（原计划用的 `v2?bvid=` 是错误的）
- `getVideoInfo` 返回值加了 `aid`（之后传给 getSubtitleList 用）
- 所有 B站 API 调用加 `credentials: "include"`
- subtitle URL `http://` → `https://` 自动转换

Commit: `4b2b5ec` — feat(extension): Bilibili API helpers in content.js

---

## Task 8 — content.js Clip Bar UI + 状态机 ✅

**目标：** 注入 Clip bar；完整状态机（loading / idle / processing / success / error）

| 步骤 | 描述 | 状态 |
|------|------|------|
| Step 1 | 追加 Clip Bar UI 代码到 content.js | ✅ |
| Step 2 | Chrome 重载扩展 + B站视频页目视验证 | ⏳ 待用户确认 |
| Step 3 | commit | ✅ |

**结果：** content.js 共 267 行，Task 7 API helpers 保留，UI 代码追加
Commit: `3c0d41e` — feat(extension): Clip bar UI + full state machine

**Review 结论：** Spec ✅ 全部 13 项通过 | 代码质量 ✅

**问题：** —

---

## Task 9 — background.js + Popup ✅

**目标：** MV3 service worker + 设置面板 + 服务健康检测

| 步骤 | 描述 | 状态 |
|------|------|------|
| Step 1 | 写 extension/background.js | ✅ |
| Step 2 | 写 extension/popup.html | ✅ |
| Step 3 | 写 extension/popup.js | ✅ |
| Step 4 | 重载扩展 + 验证 popup（需用户操作） | ⏳ 待用户确认 |
| Step 5 | commit | ✅ |

**结果：** Commit: `220c96b` — feat(extension): background service worker + settings popup

**Review 结论：** Spec ✅ 全部 8 项通过

---

## Task 10 — install.sh + uninstall.sh ✅

**目标：** 一键安装 Python 环境 + 注册 launchd 开机自启

| 步骤 | 描述 | 状态 |
|------|------|------|
| Step 1 | 写 install.sh | ✅ |
| Step 2 | 写 uninstall.sh | ✅ |
| Step 3 | chmod +x | ✅ |
| Step 4 | 端到端测试 bash install.sh | ⏳ 待用户手动运行 |
| Step 5 | commit | ✅ |

**结果：**
- install.sh：macOS 检查 → Python 3.11+ → uv → 复制服务文件 → venv + 依赖 → launchd plist → 健康检查
- uninstall.sh：launchctl unload → 删除 plist → 删除安装目录
- Commit: `a83e71f` — feat: install.sh + uninstall.sh with launchd auto-start

**Review 结论：** Spec ✅ 全通过 | 代码质量 ✅ 通过（质量审查报告的"问题"均为误报或 MVP 范围外）

**⚠️ 需要用户操作：** 请在终端运行 `bash install.sh` 完成端到端验证

**问题：** —

---

## Task 11 — E2E 测试 + README ✅

**目标：** 完整端到端验证 + 最终 README.md

| 步骤 | 描述 | 状态 |
|------|------|------|
| Step 1 | E2E：有字幕视频 clip → vault 写入成功 | ⏳ 待用户手动验证 |
| Step 2 | E2E：无字幕视频 clip → Whisper 转录写入成功 | ⏳ 待用户手动验证 |
| Step 3 | 写最终 README.md | ✅ |
| Step 4 | 最终 commit + tag v0.1.0 | ✅ |

**结果：**
- README.md：含完整安装指南、使用说明、troubleshooting、Credits
- Commit: `bc7103b` — docs: final README with install + troubleshooting guide
- Tag: `v0.1.0` ✓

**⚠️ 需要用户操作（E2E 验证）：**
1. 运行 `bash install.sh`，确认 `=== 安装完成 ✓ ===` 及服务健康
2. Chrome 中打开一个有 CC 字幕的 B站视频 → 点击 Clip → 确认 3 秒内绿色成功
3. Chrome 中打开一个无字幕的 B站视频 → 点击 Clip → 确认 Whisper 转录路径

**问题：** —

---

## 参考 Repo 分析（2026-05-21）

读取了两个参考 repo 的完整源码，发现以下关键信息：

### kangchainx/video-text-chrome-extension
- 架构：native messaging（不是 HTTP server），比我们的方案复杂，不采用
- yt-dlp 有多层 fallback 策略：cookies → android/ios 客户端 → 报错，**我们的 transcriber.py 需要加 fallback**
- faster-whisper 配置：`device="auto"`, `compute_type="int8"`，长音频自动分 chunk（>45 min）
- 用 SQLite 持久化 task 状态 + 进度，超出 MVP 范围，暂不采用

### IndieKKY/bilibili-subtitle
- **⚠️ 计划里 Bilibili API 端点写错了**：
  - 计划用：`/x/player/v2?bvid=${bvid}&cid=${cid}`
  - 实际应用：`/x/player/wbi/v2?aid=${aid}&cid=${cid}`（`aid` 是数字，不是 bvid）
  - 所有 API 调用需加 `credentials: 'include'`（利用用户已登录的 session cookie）
  - 字幕 URL 需过滤空值：`.filter(item => item.subtitle_url)`
  - 字幕 URL 如为 `http://` 需转为 `https://`
- 字幕 content 在 `data.body[].content` 字段，与计划一致

### 对计划的修正
- Task 7 `content.js` 中 `getSubtitleList` 函数需要修正：
  1. 先从 view API 拿到 `aid`（已有）
  2. 用 `wbi/v2?aid=${aid}&cid=${cid}` 获取字幕列表（**不是 `v2?bvid=...`**）
  3. 过滤空 subtitle_url
- Task 4 `transcriber.py` 需加 yt-dlp fallback（android/ios 客户端）

---

## Bugfix — extension 网络分层重构（2026-05-21）

**触发：** E2E 测试时点击 Clip 出现 `⚠ 错误: Failed to fetch`

**根因分析：**
- `fetchSubtitleText()` 对字幕 CDN（`aisubtitle.hdslb.com` 等）使用了 `credentials: "include"`
- 字幕文件是公开静态资源，CDN 返回 `Access-Control-Allow-Origin: *`
- 带 credentials 的请求要求服务端返回具体 origin（不能是 `*`） → 浏览器 CORS 拒绝 → `TypeError: Failed to fetch`
- 根源错误：Task 7 分析参考 repo 时，把"所有 B站 API 调用需加 credentials"的规则错误套用到了字幕 CDN 上

**架构决策：**

| 层 | 负责内容 |
|----|---------|
| `content.js` | B站页面交互（DOM）、bilibili API（`api.bilibili.com`，需要 cookie）、字幕 CDN fetch（公开资源，无需 cookie） |
| `background.js` | 所有 `localhost:27182` 通信（HEALTH_CHECK、CLIP）|

content → background 通过 `chrome.runtime.sendMessage` 传递类型化消息（`HEALTH_CHECK` / `CLIP`）。server I/O 集中在 background，方便后续维护、重试、日志。

**修改文件：**
- `extension/content.js`：`fetchViaBackground` → `sendToBackground`；`fetchSubtitleText` 去掉 `credentials`；所有 `/clip` 请求改走 `sendToBackground({type:"CLIP",...})`
- `extension/background.js`：handler 从通用 `FETCH_SERVER` 改为明确的 `HEALTH_CHECK` + `CLIP`

---

## 问题汇总

> 遇到的问题在这里统一归档。

| # | Task | 问题描述 | 状态 | 解决方案 |
|---|------|---------|------|---------|
| 1 | Task 7 | 计划中 Bilibili subtitle API 端点错误（`v2` vs `wbi/v2`，bvid vs aid） | ✅ 已解决 | 执行时使用 `wbi/v2?aid=&cid=`，加 `credentials:'include'` |
| 2 | Task 4 | yt-dlp 无 fallback，遇 B站限制会挂 | ✅ 已识别 | 加 android/ios 客户端 fallback 策略 |
| 3 | Bugfix | `fetchSubtitleText` credentials 导致字幕 CDN CORS 失败 | ✅ 已解决 | 去掉 `credentials`；server 通信改走 background service worker |
| 4 | Bugfix | vault_path 为相对路径时文件静默写到错误位置 | ✅ 已解决 | `writer.py` 加路径校验：非绝对路径或路径不存在时抛出明确错误 |

---

*最后更新：2026-05-21 · 网络分层重构 + vault_path 校验完成，E2E 验证待重新测试。*
