# Notion 集成设计 Spec（v0.2.0）

- 日期：2026-06-09
- 状态：已与用户对齐设计，待实施
- 取代：`NOTION_PLAN.md`（早期草案）

## 1. 目标与范围

**目标**：给 Bili Clipper 增加 Notion 作为字幕写入目标。用户在 B 站视频页点 Clip，字幕笔记直接写入指定的 Notion database，体验为纯后台 API 调用（不跳转 app）。

**不在范围内**：

- 字幕提取与分段逻辑的改动
- Obsidian 现有写入行为的改动
- Chrome Web Store 上架素材

**完成标准（DoD）**：

- B 站视频页点 Clip，Notion database 中出现渲染正常的页面（properties + Markdown 正文）
- 旧设置（`output: "both"` 等）升级后行为不变
- CLAUDE.md / README 与代码一致

## 2. 已确认的产品决策

| 决策点 | 结论 |
|---|---|
| 产品定位 | Obsidian 与 Notion **平级双目标**，welcome 首步让用户选择笔记工具 |
| 设置结构 | `output` 枚举 → `destinations` 多选数组（checkbox UI） |
| 属性策略 | **检测后映射**：先读 database schema，按列名匹配，存在就写、不存在跳过 |
| 认证方式 | Personal Access Token（internal integration token，`ntn_` 前缀） |

### 认证方式的行业对照（调研于 2026-06-09）

- 官方 Notion Web Clipper 用浏览器会话登录，第三方拿不到这条路径
- OAuth public integration 需要后端保管 client secret，独立扩展无后端，不适用
- PAT（internal integration）是无后端第三方工具的标准做法（n8n、Zapier 自托管场景同模式）

**结论：PAT 是当前约束下的长期正确选择**（置信度：确定）。

## 3. API 事实（实时调研结论，2026-06-09）

以下事实经 web 搜索官方文档确认，**非训练知识**：

1. **Markdown 端点存在且活跃迭代**：`PATCH /v1/pages/{id}/markdown`，请求体为 discriminated union：`replace_content`（全量替换，内容放 `new_str`）、`insert_content`（带 `position`，2026 年 5 月新增）、`update_content`（搜索替换）。本项目用 `replace_content`。
2. **⚠ 2025-09-03 版本破坏性变更**：引入 data source 概念。一个 database 可含多个 data source；新版 API 下创建页面的 parent 必须用 `data_source_id`（不是 `database_id`），schema 查询走 `/v1/data_sources/{id}`。**必须加 discovery 步骤**：`GET /v1/databases/{id}` → 取 `data_sources[0].id`。
3. `Notion-Version` header 必须显式 pin。pin 哪个版本字符串、以及 Markdown 端点对我们具体 Markdown 方言（`### 标题`、`**粗体**`、iframe HTML）的渲染行为，由 Phase 0 spike 用真实调用确认（置信度：不确定，待验证）。

参考：
- https://developers.notion.com/reference/update-page-markdown
- https://developers.notion.com/docs/upgrade-guide-2025-09-03
- https://developers.notion.com/guides/data-apis/working-with-markdown-content

## 4. 架构

### 4.1 阶段划分

| Phase | 内容 | 验证方式 |
|---|---|---|
| 0 | API spike：curl 真实调用，验证渲染/properties/版本；顺手截 onboarding 素材 | 肉眼检查 Notion 页面渲染 |
| 1 | 输出目标重构：`destinations` 数组 + writer 接口，**不含 Notion 代码** | 重载扩展，现有功能无回归 |
| 2 | Notion writer：background API + popup 设置 + clip bar 反馈 | 真实视频 clip 到测试 database |
| 3 | Onboarding 双目标分叉 + 文档更新 | welcome 流程走查 |

每个 Phase 结束 git commit；Phase 2 结束 bump 版本号 0.2.0。

### 4.2 设置与数据模型

```
chrome.storage.local:
  destinations: ["obsidian"]        // 新：数组多选，合法值 obsidian|notion|clipboard
  vault_name, folder                // 不变（Obsidian 专属）
  notion_token                      // 新：ntn_ 开头的 PAT
  notion_database_id                // 新：32 位 hex
  notion_data_source_id             // 新：discovery 后缓存（见 4.4）
  output                            // 旧字段：懒迁移后保留不删
```

**迁移**：`getSettings()` 懒迁移——读到旧 `output` 且无 `destinations` 时转换（`obsidian`→`["obsidian"]`、`clipboard`→`["clipboard"]`、`both`→`["obsidian","clipboard"]`）并写回。旧字段保留，回滚安全。

**Database ID 输入**：接受完整页面 URL 或裸 ID，自动提取 32 位 hex。

### 4.3 Writer 接口（长期扩展点）

每个目标实现统一签名：

```js
// write(note, title, settings) → Promise<{ok: boolean, detail?: string}>
```

- `obsidian` / `clipboard` writer：现有 content.js 逻辑的封装（需要 DOM / 页面剪贴板）
- `notion` writer：content.js → `chrome.runtime.sendMessage({type:"CLIP_TO_NOTION", ...})` → background.js 调 API → 回传结果。**API 调用必须在 background**（content script 受页面 CORS 限制；background + `host_permissions` 可直接 fetch）

Clip 时遍历勾选的 destinations 逐个执行，汇总各自结果。未来新目标（Flomo、Readwise…）只需新增一个 writer。

已知怪点（保持现状）：Obsidian URI 用剪贴板做传输，勾 Obsidian 时即使没勾"剪贴板"，剪贴板也会被占用。

### 4.4 Notion 写入流程（background.js）

1. **Discovery（带缓存）**：若无缓存的 `notion_data_source_id`，`GET /v1/databases/{database_id}` 取 `data_sources[0].id` 并缓存；后续调用失效（404）时清缓存重试一次
2. **Schema 映射**：`GET /v1/data_sources/{id}` 拿属性列表，按列名不区分大小写匹配：title（必有）、`Source`/`URL` → url、`Author` → rich_text、`Date` → date、`Tags` → multi_select；匹配不上就跳过
3. **建页**：`POST /v1/pages`，parent 为 data_source_id，properties 为匹配结果
4. **写正文**：`PATCH /v1/pages/{id}/markdown`，command `replace_content`，内容放 `new_str`

**正文与 Obsidian 版的差异**：去掉 YAML frontmatter（已进 properties）；`<iframe>` 嵌入替换为视频 URL 纯链接（Notion Markdown 不支持原生 HTML；具体渲染行为 Phase 0 验证）。为此 `formatNote()` 拆成"元数据对象 + 正文组装"两层，两种 writer 各自组装。

### 4.5 UI 变更

- **popup**：三段按钮 → 三个 checkbox；新增 Notion Token、Database ID/URL 输入框（勾选 Notion 时才显示）
- **clip bar**：成功态按目标汇总（`✓ Obsidian ✓ Notion`）；部分失败显示哪个失败及原因；勾 Notion 但未配置 token/ID → 复用现有"请先完成初始设置"黄色态，跳 welcome

### 4.6 Onboarding（welcome.html）

首步新增"你用哪个笔记工具？"（Obsidian / Notion / 都要），按选择展开对应设置区。Notion 区三步图文：

1. notion.so/developers（或 Settings → Connections → Develop or manage integrations）创建 integration，拿 token
2. 把目标 database 连接（share）给该 integration
3. 粘贴 database 页面 URL（扩展自动提取 ID）

截图素材在 Phase 0 spike 时顺手采集。

### 4.7 错误处理

| 错误 | clip bar 文案 |
|---|---|
| 401 | Token 无效，请检查 Notion Token |
| 404（database/data source 找不到） | 请确认 database 已连接（share）给 integration |
| 网络失败 | 网络错误，稍后重试 |
| 部分目标失败 | 逐目标显示 ✓/✗ 及原因 |

Obsidian 侧行为不变。

## 5. 文件改动清单

| 文件 | 改动 |
|---|---|
| `extension/content.js` | writer 接口抽取、destinations 遍历、formatNote 拆层、消息发送 |
| `extension/background.js` | `CLIP_TO_NOTION` 消息处理 + Notion API 客户端 |
| `extension/popup.html/js` | checkbox 组、Notion 设置项、条件显示 |
| `extension/welcome.html/js` | 双目标分叉引导、Notion 三步图文 |
| `extension/manifest.json` | `host_permissions` + `https://api.notion.com/*`；版本 0.2.0 |
| `CLAUDE.md` | 技术栈、文件结构、当前状态、DoD 更新 |
| `README.md` | Notion 功能说明（Phase 3） |

## 6. 测试与验收

- 每 Phase：chrome://extensions 重载 → B 站视频页目视验证
- Phase 1 回归：旧三种 `output` 值迁移后行为与迁移前一致
- 最终验收：双目标同时勾选 clip 真实视频，Obsidian 与 Notion 均出现内容正确的笔记；错误路径（错 token、未 share 的 database）逐一触发并确认文案
