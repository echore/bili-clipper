# Notion API Spike 结果（Phase 0）

- 日期：2026-06-09
- 验证方式：真实 token + 用户 workspace 里的测试 database，逐端点实际调用
- 渲染效果：用户已在 Notion 中目视确认正常（标题层级、粗体时间戳、inline code）

## 核心结论：方案可行，三处与调研假设不同

### 1. Notion-Version

`2026-03-11` 在全部用到的端点上工作正常。**pin 此版本。**

### 2. ⚠ Markdown 端点请求体形状（与文档调研不同）

文档调研推测的扁平形状 `{"command": "replace_content", "new_str": ...}` 实际返回
`validation_error: body.type should be defined`。**实测可用的形状：**

```json
{ "type": "replace_content", "replace_content": { "new_str": "<markdown 字符串>" } }
```

成功响应为 `{"object": "page_markdown", "id": ..., "markdown": <服务端规范化后的 markdown>}`，
可用于写入后校验。

### 3. ⚠ Search API 一次给齐两个 id（discovery 步骤可跳过）

`POST /v1/search`（无 filter 或 `filter: {property:"object", value:"data_source"}` 均可）返回：

```
object=data_source
id=<data_source_id>                      ← 建页直接用
parent={"type":"database_id","database_id":<database_id>}
```

**下拉选择器一次调用拿齐 `data_source_id` + `database_id`，不再需要 GET /v1/databases discovery。**

注意：本次测试中 data_source 对象的 `title` 字段为空数组（database 名为 "New database"，
名字存在于 `GET /v1/databases` 响应的 `data_sources[].name` 里）。
**下拉显示名需要兜底**：`r.title` 为空时用 `GET /v1/databases/{parent.database_id}` 的 title。

### 4. 🎁 意外发现：API 可以直接建列

`PATCH /v1/data_sources/{id}` 带 `properties` 能直接给 database 加列（本次实测把
Source(url)/Author(rich_text)/Date(date)/Tags(multi_select) 四列全部建出）。

**产品含义**：扩展可以在用户选中 database 后自动补齐缺失的列（"检测后映射"升级为
"检测后补全"），公共模板从必需品降级为锦上添花。是否采用待用户决策，暂不改计划。

## 各端点验证记录

| 端点 | 结果 |
|---|---|
| `GET /v1/databases/{id}` | ✓ 返回 `data_sources` 数组（id + name） |
| `GET /v1/data_sources/{id}` | ✓ `properties` 含各列 type；对象含 title/description/parent/url 等 |
| `PATCH /v1/data_sources/{id}` | ✓ 可新增列（见发现 4） |
| `POST /v1/search` | ✓ 见结论 3；data_source filter 值有效 |
| `POST /v1/pages`（parent=data_source_id） | ✓ title/url/rich_text/date/multi_select 全部属性写入成功 |
| `PATCH /v1/pages/{id}/markdown` | ✓ 形状见结论 2 |
| 未授权访问 | 404 `object_not_found`，错误信息明确提示"shared with your integration" → 计划中的 404 文案正确 |

## Markdown 渲染行为（用户目视确认）

- `## 标题` / `### 标题 \`0:15\`` → heading 2/3 + inline code 正常
- `**0:15** · 文本` → 粗体时间戳正常
- 裸 URL → 自动转为可点击链接（服务端规范化为 `[url](url)`）
- `<iframe …>` → **被转义为字面文本显示**（`\<iframe…\>`），Notion 正文绝不能包含 HTML；
  视频嵌入用裸 URL 链接代替 ✓（与设计一致）

## Notion 界面术语更新（onboarding 文案依据）

2026-06 的 Notion 界面已把 "integration" 改为 **connection**：
创建入口是 Connections 页面 → **New connection** 弹窗 → Authentication method 选
**Access token**（即原 internal integration token / PAT）→ Installable in 选 workspace。
welcome.html 的引导文案和截图必须用这套新术语（Task 9 执行时注意）。

## 遗留事项

- [ ] onboarding 三张截图未采集（用户操作时未截图），Task 9 前补
- [ ] 公共模板未发布（Task 1 Step 5b），若采纳"自动建列"可降级为可选
- [ ] 测试 database 里的两条 Spike 测试页可由用户自行删除
- [ ] spike 用的 connection 建议用后在 Notion 里撤销重建（token 出现过的会话即视为暴露）
