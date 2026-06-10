# Notion 集成实施计划（v0.2.0）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Bili Clipper 增加 Notion 作为字幕写入目标：点 Clip 后通过 background API 在指定 database 创建页面并写入 Markdown 正文。

**Architecture:** 先把 `output` 枚举重构为 `destinations` 多选数组 + 统一 writer 接口（行为不变的纯重构），再以"第三个 writer"的形式接入 Notion——content.js 发消息给 background.js，由 background 调 Notion API（data source discovery → schema 映射 → 建页 → PATCH Markdown）。最后做 welcome 双目标分叉引导和文档同步。

**Tech Stack:** Chrome Manifest V3、vanilla JS、Notion REST API（`Notion-Version: 2026-03-11`，Markdown 端点）、`chrome.storage.local`。

**Spec:** `docs/superpowers/specs/2026-06-09-notion-integration-design.md`

**测试约定（项目 DoD，覆盖 TDD 默认）：** 本项目无测试框架。每个 task 的验证方式 = chrome://extensions 重载扩展 → B 站视频页 / popup / welcome 目视验证，按 task 中列出的具体检查项逐条确认。每个 task 结束 git commit。

**关于代码删除：** 本计划中明确列出的"删除/替换"（旧 `formatNote`、`clipToObsidian`、popup/welcome 的 seg 按钮代码）属于重构的一部分，用户批准本计划即视为批准这些删除；计划之外的任何删除仍需单独询问。

---

## Phase 0 — API Spike（阻塞项：需要用户提供测试 token）

### Task 1: 真实调用验证 Notion API 假设

**Files:**
- Create: `docs/superpowers/spikes/2026-06-09-notion-api-spike.md`（结果记录，git 跟踪需 `add -f`）
- Create: `extension/assets/notion-step1.png`、`notion-step2.png`、`notion-step3.png`（onboarding 截图素材）

**前置（用户操作）：**

1. 访问 notion.so → Settings → Connections → Develop or manage integrations → 新建 internal integration，拿到 `ntn_` 开头 token —— **过程中截图 1：integration 创建页**
2. 在 Notion 建一个测试 database，列至少包含：title（默认）、`Source`(url)、`Author`(text)、`Date`(date)、`Tags`(multi-select)
3. database 页面 → `···` → Connections → 连接到刚建的 integration —— **截图 2：连接界面**
4. 复制 database 页面 URL —— **截图 3：URL 位置**
5. 把 token 和 URL 交给执行者（环境变量，不写入任何文件）

- [ ] **Step 1: 验证 database discovery（data source 模型）**

```bash
export NOTION_TOKEN="ntn_xxx"   # 用户提供，勿写入文件
export DB_ID="<从 URL 提取的 32 位 hex>"
curl -s "https://api.notion.com/v1/databases/$DB_ID" \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2026-03-11" | head -c 2000
```

预期：响应含 `data_sources` 数组，记录 `data_sources[0].id` 为 `$DS_ID`。
若返回版本相关错误，按错误提示中的可用版本调整并**记录最终可用的 Notion-Version**。

- [ ] **Step 2: 验证 data source schema 读取**

```bash
export DS_ID="<上一步拿到的 id>"
curl -s "https://api.notion.com/v1/data_sources/$DS_ID" \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2026-03-11" | head -c 2000
```

预期：响应含 `properties` 对象，确认各列的 `type` 字段值（title/url/rich_text/date/multi_select）。

- [ ] **Step 2b: 验证 search API 列出已连接 database（下拉选择器的数据来源）**

```bash
curl -s -X POST "https://api.notion.com/v1/search" \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2026-03-11" \
  -H "Content-Type: application/json" \
  -d '{"filter": {"property": "object", "value": "data_source"}, "page_size": 50}' | head -c 2000
```

预期：results 里出现测试 database。记录到 spike 文档：返回对象类型是 `data_source` 还是 `database`、`id` 与 `parent.database_id` 各是什么、title 取哪个字段——这决定下拉选择器能否直接拿到 data_source_id 跳过 discovery。若 filter value 报错，按错误提示调整（旧版为 `"database"`）并记录。

- [ ] **Step 3: 验证建页 + properties 写入**

```bash
curl -s -X POST "https://api.notion.com/v1/pages" \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2026-03-11" \
  -H "Content-Type: application/json" \
  -d '{
    "parent": {"type": "data_source_id", "data_source_id": "'$DS_ID'"},
    "properties": {
      "Name": {"title": [{"text": {"content": "Spike 测试页"}}]},
      "Source": {"url": "https://www.bilibili.com/video/BV1xx411c7mD"},
      "Date": {"date": {"start": "2026-06-09"}},
      "Tags": {"multi_select": [{"name": "transcript"}, {"name": "bilibili"}]}
    }
  }' | head -c 1500
```

预期：返回 page 对象，记录 `id` 为 `$PAGE_ID`。注意 title 列的实际名称以 Step 2 的 schema 为准（默认 `Name`）。

- [ ] **Step 4: 验证 Markdown 端点与渲染**

```bash
curl -s -X PATCH "https://api.notion.com/v1/pages/$PAGE_ID/markdown" \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2026-03-11" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "replace_content",
    "new_str": "https://www.bilibili.com/video/BV1xx411c7mD\n\n## 简介\n\n这是简介文本。\n\n## 字幕\n\n### 第一章 `0:15`\n\n**0:15** · 第一段字幕文本，句子结尾。\n\n**1:02** · 第二段字幕文本。"
  }' | head -c 1500
```

预期：HTTP 200。**若请求体结构报错**（discriminated union 的实际嵌套可能不同），按错误信息调整并把**最终可用的请求体形状**记入 spike 文档——后续 Task 8 必须使用这里验证过的形状。

- [ ] **Step 5: 肉眼验证 Notion 页面渲染**

在 Notion 打开测试页，逐项检查并记录：
- `## 简介` / `## 字幕` 渲染为 heading 2
- `### 章节标题 \`0:15\`` 渲染为 heading 3 + inline code
- `**0:15** · 文本` 粗体时间戳正常
- 裸视频 URL 渲染成什么（纯链接 / bookmark / embed）
- 额外测试一次含 `<iframe ...>` 的内容，确认 HTML 是被剥离还是显示为文本（决定 Notion 正文是否绝不能含 iframe）

- [ ] **Step 5b: 发布公共模板（welcome 一键复制用）**

把测试 database 整理为标准模板：列为 title（名称随意）、`Source`(url)、`Author`(text)、`Date`(date)、`Tags`(multi-select)，删掉 spike 测试页。Notion 页面右上 Share → Publish，勾选 **Allow duplicate as template**，把公开链接记入 spike 文档（Task 9 welcome 引导用）。

- [ ] **Step 6: 写 spike 结果文档并 commit**

`docs/superpowers/spikes/2026-06-09-notion-api-spike.md` 记录：最终可用 `Notion-Version`、PATCH markdown 的可用请求体形状、各 Markdown 元素渲染结果、iframe 行为、三张截图已存入 `extension/assets/`。

```bash
git add -f docs/superpowers/spikes/2026-06-09-notion-api-spike.md
git add extension/assets/notion-step*.png
git commit -m "docs: record Notion API spike results and onboarding screenshots"
```

**Task 1 验收：** spike 文档无空项；若任何假设被推翻（如 Markdown 渲染不可接受），停止执行并回到设计讨论。

---

## Phase 1 — 输出目标重构（不含 Notion 代码，行为不变）

### Task 2: getSettings 迁移 + payload/writer 抽取（content.js）

**Files:**
- Modify: `extension/content.js`

- [ ] **Step 1: 替换 `getSettings()`（现 content.js:135-146）**

```js
async function getSettings() {
  const s = await new Promise((resolve) =>
    chrome.storage.local.get(
      {
        vault_name: "",
        folder: "",
        output: "",            // legacy enum, kept for migration only
        destinations: null,    // array of "obsidian" | "notion" | "clipboard"
        notion_token: "",
        notion_database_id: "",
      },
      resolve
    )
  );
  if (!Array.isArray(s.destinations)) {
    const legacyMap = {
      obsidian: ["obsidian"],
      clipboard: ["clipboard"],
      both: ["obsidian", "clipboard"],
    };
    s.destinations = legacyMap[s.output] || ["obsidian"];
    chrome.storage.local.set({ destinations: s.destinations });
  }
  return s;
}
```

- [ ] **Step 2: 拆分 `formatNote()`（现 content.js:160-182），替换为三个函数**

```js
/** Metadata shared by all destinations. */
function buildNoteMeta(title, bvid, author, method) {
  return {
    title,
    sourceUrl: bvid ? `https://www.bilibili.com/video/${bvid}` : "",
    author: author || "",
    date: new Date().toISOString().split("T")[0],
    tags: ["transcript", "bilibili"],
    method,
  };
}

function formatFrontmatter(meta) {
  return [
    `---`,
    `title: "${meta.title.replace(/"/g, '\\"')}"`,
    `source: ${meta.sourceUrl}`,
    `platform: bilibili`,
    `author: "${meta.author.replace(/"/g, '\\"')}"`,
    `date: ${meta.date}`,
    `tags: [${meta.tags.join(", ")}]`,
    `transcript_method: ${meta.method}`,
    `---`,
  ].join("\n");
}

/** Body shared by all destinations; `embed` is iframe HTML (Obsidian) or a plain URL (Notion). */
function formatNoteBody(subtitleSection, desc, embed) {
  const lines = [embed, ``];
  if (desc && desc.trim()) lines.push(`## 简介`, ``, desc.trim(), ``);
  lines.push(`## 字幕`, ``, subtitleSection);
  return lines.join("\n");
}
```

- [ ] **Step 3: 把 `clipToObsidian()`（现 content.js:193-214）替换为两个 writer**

```js
// ─── Destination writers ─────────────────────────────────────────────────────
// Each writer: (payload, settings) → Promise<{ok: boolean, detail?: string}>
// payload: { title, meta, obsidianNote }  (notionBody added in Phase 2)

async function writeToClipboard(payload) {
  await navigator.clipboard.writeText(payload.obsidianNote);
  return { ok: true };
}

async function writeToObsidian(payload, settings) {
  // Obsidian URI reads content from clipboard (&clipboard) — clipboard is the transport
  await navigator.clipboard.writeText(payload.obsidianNote);
  const folder = (settings.folder || "").trim().replace(/^\/+|\/+$/g, "");
  const filename = sanitizeFilename(payload.title) + ".md";
  const notePath = folder ? folder + "/" + filename : filename;
  const params = new URLSearchParams();
  if (settings.vault_name) params.set("vault", settings.vault_name);
  params.set("file", notePath);
  const link = document.createElement("a");
  // Obsidian URI handler requires %20 for spaces, not + (URLSearchParams default)
  link.href = "obsidian://new?" + params.toString().replace(/\+/g, "%20") + "&clipboard";
  link.click();
  return { ok: true };
}

const WRITERS = { obsidian: writeToObsidian, clipboard: writeToClipboard };
const DEST_LABELS = { obsidian: "Obsidian", notion: "Notion", clipboard: "剪贴板" };
```

- [ ] **Step 4: 替换 `handleClip()`（现 content.js:397-433）**

```js
async function handleClip() {
  if (_isProcessing || !_videoData) return;

  const settings = await getSettings();
  const dests = settings.destinations.filter((d) => WRITERS[d]);

  const needsObsidianSetup = dests.includes("obsidian") && !settings.vault_name;
  if (dests.length === 0 || needsObsidianSetup) {
    renderSetupRequired();
    return;
  }

  _isProcessing = true;
  const { bvid, aid, cid, title, desc, author, subtitles, chapters } = _videoData;

  try {
    renderProcessing("正在提取字幕…");
    const items = await fetchSubtitleItems(subtitles[0].subtitle_url);
    const subtitleSection = buildSubtitleSection(items, chapters);
    const meta = buildNoteMeta(title, bvid, author, "cc_subtitle");
    const payload = {
      title,
      meta,
      obsidianNote:
        formatFrontmatter(meta) + "\n\n" +
        formatNoteBody(subtitleSection, desc, buildEmbedIframe(bvid, cid, aid)),
    };

    const results = [];
    for (const dest of dests) {
      renderProcessing(`正在写入 ${DEST_LABELS[dest]}…`);
      try {
        results.push({ dest, ...(await WRITERS[dest](payload, settings)) });
      } catch (err) {
        results.push({ dest, ok: false, detail: err.message });
      }
    }
    renderResults(results);
    if (results.some((r) => r.ok)) {
      saveClipHistory({ title, url: `https://www.bilibili.com/video/${bvid}` });
    }
  } catch (err) {
    renderError("错误: " + err.message);
  } finally {
    _isProcessing = false;
  }
}
```

- [ ] **Step 5: 在 render 函数区（`renderError` 之后，现 content.js:379 附近）新增 `renderResults`**

```js
function renderResults(results) {
  const summary = results
    .map((r) => `${r.ok ? "✓" : "✗"} ${DEST_LABELS[r.dest]}`)
    .join("　");
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    const hint = results.some((r) => r.dest === "obsidian")
      ? "如未自动打开，请启动 Obsidian 或检查 Vault 名称是否正确"
      : "";
    renderSuccess(summary, hint);
  } else {
    renderError(`${summary} — ${failed[0].detail || "写入失败"}`);
  }
}
```

- [ ] **Step 6: 手动验证（重载扩展）**

chrome://extensions 重载 → 打开有 CC 字幕的 B 站视频：
1. 旧设置为 `output: "both"` 的情况：DevTools → `chrome.storage.local.get(console.log)` 确认自动出现 `destinations: ["obsidian","clipboard"]`
2. 点 Clip：Obsidian 正常建笔记，clip bar 显示 `✓ Obsidian　✓ 剪贴板`
3. DevTools console 无报错

- [ ] **Step 7: Commit**

```bash
git add extension/content.js
git commit -m "refactor: extract destination writers and migrate output enum to destinations array"
```

### Task 3: popup 改多选 checkbox

**Files:**
- Modify: `extension/popup.html`
- Modify: `extension/popup.js`

- [ ] **Step 1: popup.html — 替换输出目标区块（现 popup.html:44-51）**

```html
  <div class="row">
    <label>写入目标（可多选）</label>
    <div class="checks" id="dest-checks">
      <label class="check"><input type="checkbox" value="obsidian"> Obsidian</label>
      <label class="check"><input type="checkbox" value="notion"> Notion</label>
      <label class="check"><input type="checkbox" value="clipboard"> 剪贴板</label>
    </div>
  </div>
```

并在 `<style>` 中删除 `.seg` 两条规则（popup.html:15-18），新增：

```css
    .checks { display: flex; flex-direction: column; gap: 6px; }
    .check { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #374151;
             text-transform: none; letter-spacing: 0; font-weight: 400; margin-bottom: 0; cursor: pointer; }
    .check input { width: auto; accent-color: #7c3aed; }
```

- [ ] **Step 2: popup.js — 替换加载与保存逻辑（现 popup.js:4-13 加载、18-30 save、36-44 seg 点击）**

```js
// ─── Load + render saved settings ────────────────────────────────────────────
const LEGACY_OUTPUT_MAP = {
  obsidian: ["obsidian"],
  clipboard: ["clipboard"],
  both: ["obsidian", "clipboard"],
};

chrome.storage.local.get(
  { vault_name: "", folder: "", output: "", destinations: null },
  (s) => {
    document.getElementById("vault_name").value = s.vault_name;
    document.getElementById("folder").value = s.folder;
    const dests = Array.isArray(s.destinations)
      ? s.destinations
      : LEGACY_OUTPUT_MAP[s.output] || ["obsidian"];
    document.querySelectorAll("#dest-checks input").forEach((cb) => {
      cb.checked = dests.includes(cb.value);
    });
  }
);

// ─── Save on any change ───────────────────────────────────────────────────────
let _saveHintTimer = null;

function save() {
  const destinations = [...document.querySelectorAll("#dest-checks input:checked")]
    .map((cb) => cb.value);
  chrome.storage.local.set({
    vault_name: document.getElementById("vault_name").value.trim(),
    folder: document.getElementById("folder").value.trim(),
    destinations,
  });
  const hint = document.getElementById("save-hint");
  hint.style.opacity = "1";
  clearTimeout(_saveHintTimer);
  _saveHintTimer = setTimeout(() => { hint.style.opacity = "0"; }, 1500);
}

["vault_name", "folder"].forEach((id) =>
  document.getElementById(id).addEventListener("input", save)
);

document.querySelectorAll("#dest-checks input").forEach((cb) =>
  cb.addEventListener("change", save)
);
```

（`open-welcome` 与 clip history 部分不变。）

- [ ] **Step 3: 手动验证**

重载扩展 → 打开 popup：
1. 旧设置正确映射为勾选状态
2. 勾/取消任意项出现"✓ 已保存"，重开 popup 状态保持
3. 全不勾时去视频页点 Clip → 出现"请先完成初始设置"黄色态

- [ ] **Step 4: Commit**

```bash
git add extension/popup.html extension/popup.js
git commit -m "feat: replace output segment buttons with multi-select destination checkboxes in popup"
```

### Task 4: welcome 改多选（与新字段对齐，防止新旧字段分歧）

**Files:**
- Modify: `extension/welcome.html`
- Modify: `extension/welcome.js`

- [ ] **Step 1: welcome.html — 替换输出 seg（现 welcome.html:259-264）**

```html
      <label>输出到（可多选）</label>
      <div class="checks" id="dest-checks">
        <label class="check"><input type="checkbox" value="obsidian" checked> Obsidian</label>
        <label class="check"><input type="checkbox" value="notion"> Notion</label>
        <label class="check"><input type="checkbox" value="clipboard"> 剪贴板</label>
      </div>
```

`<style>` 中删除 `.seg` 规则（welcome.html:82-93），新增（注意 welcome 的全局 `label` 样式更重，需覆盖）：

```css
    .checks { display: flex; gap: 16px; margin-top: 6px; }
    .check { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #374151;
             text-transform: none; letter-spacing: 0; font-weight: 400; margin: 0; cursor: pointer; }
    .check input { width: auto; accent-color: #7c3aed; }
```

- [ ] **Step 2: welcome.js — 加载（现 19-28）与保存（现 49-82）改用 destinations；删除 seg 点击逻辑（现 39-46）**

```js
// ── 加载已保存的设置 ───────────────────────────────────────────────────────────
const LEGACY_OUTPUT_MAP = {
  obsidian: ["obsidian"],
  clipboard: ["clipboard"],
  both: ["obsidian", "clipboard"],
};

chrome.storage.local.get(
  { vault_name: "", folder: "", output: "", destinations: null },
  (s) => {
    document.getElementById("vault_name").value = s.vault_name;
    document.getElementById("folder").value = s.folder;
    const dests = Array.isArray(s.destinations)
      ? s.destinations
      : LEGACY_OUTPUT_MAP[s.output] || ["obsidian"];
    document.querySelectorAll("#dest-checks input").forEach((cb) => {
      cb.checked = dests.includes(cb.value);
    });
  }
);
```

保存按钮逻辑（替换现 49-82 行中的取值与校验部分，toast/按钮反馈不变）：

```js
document.getElementById("save-btn").addEventListener("click", () => {
  const vault_name = document.getElementById("vault_name").value.trim();
  const folder = document.getElementById("folder").value.trim();
  const destinations = [...document.querySelectorAll("#dest-checks input:checked")]
    .map((cb) => cb.value);

  // Vault 名称仅在勾选 Obsidian 时必填
  if (destinations.includes("obsidian") && !vault_name) {
    const vaultInput = document.getElementById("vault_name");
    vaultInput.focus();
    vaultInput.style.borderColor = "#ef4444";
    vaultInput.style.boxShadow = "0 0 0 3px rgba(239,68,68,0.15)";
    setTimeout(() => {
      vaultInput.style.borderColor = "";
      vaultInput.style.boxShadow = "";
    }, 2000);
    return;
  }

  chrome.storage.local.set({ vault_name, folder, destinations }, () => {
    const toast = document.getElementById("toast");
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);

    const btn = document.getElementById("save-btn");
    btn.textContent = "✓ 已保存";
    btn.classList.add("saved");
    setTimeout(() => {
      btn.textContent = "保存设置";
      btn.classList.remove("saved");
    }, 2500);
  });
});
```

- [ ] **Step 3: 手动验证**

重载扩展 → popup 里点"查看设置指南"打开 welcome：
1. 已存设置正确回显为勾选
2. 只勾"剪贴板"时不填 vault 也能保存；勾 Obsidian 不填 vault 被红框拦截
3. 保存后 popup 中勾选状态一致

- [ ] **Step 4: Phase 1 回归验证 + Commit**

三种旧 `output` 值各验证一遍迁移（DevTools 手动 `chrome.storage.local.set({output:"both", destinations:null})` 后重载页面点 Clip），行为与迁移前一致。

```bash
git add extension/welcome.html extension/welcome.js
git commit -m "feat: migrate welcome page output setting to destinations checkboxes"
```

---

## Phase 2 — Notion writer

### Task 5: manifest 加 Notion host 权限

**Files:**
- Modify: `extension/manifest.json:12-15`

- [ ] **Step 1: host_permissions 数组追加**

```json
  "host_permissions": [
    "https://www.bilibili.com/*",
    "https://api.bilibili.com/*",
    "https://api.notion.com/*"
  ],
```

- [ ] **Step 2: 重载扩展确认无 manifest 报错，Commit**

```bash
git add extension/manifest.json
git commit -m "feat: add Notion API host permission"
```

### Task 6: background.js Notion API 客户端

**Files:**
- Modify: `extension/background.js`（整文件重写，现仅 13 行）

- [ ] **Step 1: 重写 background.js**

⚠ `NOTION_VERSION` 和 PATCH markdown 请求体形状以 **Task 1 spike 文档记录的为准**；下面代码采用调研到的官方文档形状，若 spike 结论不同按 spike 调整。

```js
// extension/background.js

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "OPEN_WELCOME") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
    return;
  }
  if (msg.type === "CLIP_TO_NOTION") {
    clipToNotion(msg.meta, msg.body)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, detail: err.message }));
    return true; // keep the message channel open for the async response
  }
  if (msg.type === "SEARCH_NOTION_DATABASES") {
    searchNotionDatabases(msg.token)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, detail: err.message }));
    return true;
  }
});

// ─── Notion API client ───────────────────────────────────────────────────────

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11"; // pinned; verified by spike (docs/superpowers/spikes/)

async function notionFetch(path, options, token) {
  let res;
  try {
    res = await fetch(NOTION_API + path, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
    });
  } catch (e) {
    const err = new Error("网络错误，稍后重试");
    err.network = true;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** List databases the token can access — powers the database picker in popup/welcome.
 *  Object type and id fields per spike findings (Task 1 Step 2b). */
async function searchNotionDatabases(token) {
  if (!token) return { ok: false, detail: "请先填写 Token" };
  const data = await notionFetch(
    "/search",
    {
      method: "POST",
      body: JSON.stringify({
        filter: { property: "object", value: "data_source" },
        page_size: 50,
      }),
    },
    token
  ).catch((err) => {
    if (err.status === 401) throw new Error("Token 无效，请检查 Notion Token");
    throw err;
  });
  const items = (data.results || []).map((r) => ({
    dataSourceId: r.object === "data_source" ? r.id : "",
    databaseId: r.parent?.database_id || (r.object === "database" ? r.id : ""),
    title: (r.title || []).map((t) => t.plain_text).join("") || "未命名 database",
  }));
  return { ok: true, items };
}

/** Resolve and cache the data source id (API 2025-09-03 data source model). */
async function getDataSourceId(token, databaseId) {
  const { notion_data_source_id } = await chrome.storage.local.get({
    notion_data_source_id: "",
  });
  if (notion_data_source_id) return notion_data_source_id;
  const db = await notionFetch(`/databases/${databaseId}`, { method: "GET" }, token);
  const id = db.data_sources?.[0]?.id;
  if (!id) throw new Error("database 没有可用的 data source");
  await chrome.storage.local.set({ notion_data_source_id: id });
  return id;
}

/** Map note metadata onto whatever matching columns the data source has. */
async function buildNotionProperties(token, dataSourceId, meta) {
  const ds = await notionFetch(`/data_sources/${dataSourceId}`, { method: "GET" }, token);
  const out = {};
  for (const [name, def] of Object.entries(ds.properties || {})) {
    const key = name.toLowerCase();
    if (def.type === "title") {
      out[name] = { title: [{ text: { content: meta.title } }] };
    } else if (def.type === "url" && ["source", "url", "链接", "来源"].includes(key)) {
      out[name] = { url: meta.sourceUrl };
    } else if (def.type === "rich_text" && ["author", "作者"].includes(key)) {
      out[name] = { rich_text: [{ text: { content: meta.author } }] };
    } else if (def.type === "date" && ["date", "日期"].includes(key)) {
      out[name] = { date: { start: meta.date } };
    } else if (def.type === "multi_select" && ["tags", "标签"].includes(key)) {
      out[name] = { multi_select: meta.tags.map((t) => ({ name: t })) };
    }
  }
  return out;
}

async function clipToNotion(meta, body, isRetry = false) {
  const { notion_token, notion_database_id } = await chrome.storage.local.get({
    notion_token: "",
    notion_database_id: "",
  });
  try {
    const dataSourceId = await getDataSourceId(notion_token, notion_database_id);
    const properties = await buildNotionProperties(notion_token, dataSourceId, meta);
    const page = await notionFetch(
      "/pages",
      {
        method: "POST",
        body: JSON.stringify({
          parent: { type: "data_source_id", data_source_id: dataSourceId },
          properties,
        }),
      },
      notion_token
    );
    await notionFetch(
      `/pages/${page.id}/markdown`,
      {
        method: "PATCH",
        body: JSON.stringify({ command: "replace_content", new_str: body }),
      },
      notion_token
    );
    return { ok: true, detail: page.url || "" };
  } catch (err) {
    if (err.status === 404 && !isRetry) {
      // data source cache may be stale (user switched databases) — clear and retry once
      await chrome.storage.local.set({ notion_data_source_id: "" });
      return clipToNotion(meta, body, true);
    }
    if (err.status === 401) return { ok: false, detail: "Token 无效，请检查 Notion Token" };
    if (err.status === 404)
      return { ok: false, detail: "请确认 database 已连接（share）给 integration" };
    if (err.network) return { ok: false, detail: "网络错误，稍后重试" };
    return { ok: false, detail: err.message };
  }
}
```

- [ ] **Step 2: 临时验证 background 通路**

重载扩展 → B 站视频页 DevTools console：

```js
chrome.storage.local.set({notion_token: "<spike 用的 token>", notion_database_id: "<spike 的 db id>"})
chrome.runtime.sendMessage({type:"CLIP_TO_NOTION", meta:{title:"通路测试", sourceUrl:"https://example.com", author:"", date:"2026-06-09", tags:["transcript"]}, body:"## 测试\n\n通路验证"}, console.log)
```

预期：返回 `{ok: true, detail: "<page url>"}`，Notion 出现新页面。再用错 token 测一次，预期 `{ok:false, detail:"Token 无效…"}`。

再验证 database 搜索通路：

```js
chrome.runtime.sendMessage({type:"SEARCH_NOTION_DATABASES", token:"<spike token>"}, console.log)
```

预期：`{ok:true, items:[{dataSourceId, databaseId, title:"<测试 database 名>"}]}`。

- [ ] **Step 3: Commit**

```bash
git add extension/background.js
git commit -m "feat: add Notion API client in background service worker"
```

### Task 7: content.js 接入 notion writer

**Files:**
- Modify: `extension/content.js`

- [ ] **Step 1: 在 writer 区新增 `writeToNotion` 并注册**

```js
async function writeToNotion(payload) {
  const resp = await chrome.runtime.sendMessage({
    type: "CLIP_TO_NOTION",
    meta: payload.meta,
    body: payload.notionBody,
  });
  return resp || { ok: false, detail: "后台无响应" };
}
```

`WRITERS` 改为：

```js
const WRITERS = { obsidian: writeToObsidian, clipboard: writeToClipboard, notion: writeToNotion };
```

- [ ] **Step 2: handleClip 中 payload 增加 notionBody，并补 Notion 设置 guard**

payload 定义改为（Task 2 Step 4 基础上）：

```js
    const payload = {
      title,
      meta,
      obsidianNote:
        formatFrontmatter(meta) + "\n\n" +
        formatNoteBody(subtitleSection, desc, buildEmbedIframe(bvid, cid, aid)),
      notionBody: formatNoteBody(subtitleSection, desc, meta.sourceUrl),
    };
```

guard 部分改为：

```js
  const needsObsidianSetup = dests.includes("obsidian") && !settings.vault_name;
  const needsNotionSetup =
    dests.includes("notion") && (!settings.notion_token || !settings.notion_database_id);
  if (dests.length === 0 || needsObsidianSetup || needsNotionSetup) {
    renderSetupRequired();
    return;
  }
```

若 spike（Task 1 Step 5）确认裸 URL 渲染不佳，`notionBody` 的 embed 参数按 spike 记录的最佳形式调整（如 Markdown 链接 `[标题](url)`）。

- [ ] **Step 3: 手动验证**

重载扩展（保留 Step 2 of Task 6 设的 token/db id，并在 popup 勾选 Notion）→ 真实 CC 字幕视频点 Clip：
1. clip bar 依次显示"正在写入 Notion…"等状态
2. Notion database 出现新页面：title/Source/Date/Tags properties 正确、正文渲染正常
3. 同时勾 Obsidian 时两边都成功，clip bar 显示 `✓ Obsidian　✓ Notion`
4. 把 token 改错 → clip bar 显示 `✓ Obsidian　✗ Notion — Token 无效，请检查 Notion Token`

- [ ] **Step 4: Commit**

```bash
git add extension/content.js
git commit -m "feat: add Notion destination writer wired through background service worker"
```

### Task 8: popup 增加 Notion 设置项

**Files:**
- Modify: `extension/popup.html`
- Modify: `extension/popup.js`

- [ ] **Step 1: popup.html — 在 dest-checks 的 row 之后插入**

```html
  <div id="notion-settings" style="display:none;">
    <div class="row">
      <label>Notion Token</label>
      <div style="display:flex;gap:6px;">
        <input type="password" id="notion_token" placeholder="ntn_ 开头" style="flex:1;">
        <button id="notion-connect" style="padding:6px 10px;background:#7c3aed;color:white;
          border:none;border-radius:6px;font-size:11px;cursor:pointer;flex-shrink:0;">连接</button>
      </div>
      <p id="notion-status" style="font-size:10px;color:#9ca3af;margin-top:4px;"></p>
    </div>
    <div class="row" id="notion-db-row" style="display:none;">
      <label>保存到哪个 database</label>
      <select id="notion_database_select"></select>
    </div>
    <details style="margin-bottom:14px;">
      <summary style="font-size:10px;color:#9ca3af;cursor:pointer;">高级：手动粘贴 database 链接</summary>
      <input type="text" id="notion_database" placeholder="https://notion.so/xxxx…" style="margin-top:6px;">
      <p id="notion-db-hint" style="font-size:10px;color:#9ca3af;margin-top:4px;"></p>
    </details>
  </div>
```

同时把 Vault 名称、目标文件夹两个 `.row`（popup.html:34-42）包进 `<div id="obsidian-settings">`。

- [ ] **Step 2: popup.js — 加载、保存、条件显示**

加载回调中追加（注意 `chrome.storage.local.get` 的 defaults 对象同步加 `notion_token: ""`、`notion_database_id: ""`）：

```js
    document.getElementById("notion_token").value = s.notion_token;
    document.getElementById("notion_database").value = s.notion_database_id;
    updateSectionVisibility();
```

新增工具函数与保存逻辑：

```js
/** Accepts a full Notion URL or bare id; returns 32-hex id or "". */
function extractDatabaseId(input) {
  const m = (input || "").replace(/-/g, "").match(/[0-9a-f]{32}/i);
  return m ? m[0].toLowerCase() : "";
}

function updateSectionVisibility() {
  const checked = (v) =>
    document.querySelector(`#dest-checks input[value="${v}"]`).checked;
  document.getElementById("obsidian-settings").style.display =
    checked("obsidian") ? "" : "none";
  document.getElementById("notion-settings").style.display =
    checked("notion") ? "" : "none";
}
```

`save()` 中追加（在 `chrome.storage.local.set` 的对象里）：

```js
    notion_token: document.getElementById("notion_token").value.trim(),
```

「连接」按钮 → 填充下拉选择器（同时承担 token 即时校验）：

```js
let _dbItems = [];

document.getElementById("notion-connect").addEventListener("click", async () => {
  const token = document.getElementById("notion_token").value.trim();
  const status = document.getElementById("notion-status");
  status.textContent = "连接中…";
  status.style.color = "#9ca3af";
  const resp = await chrome.runtime.sendMessage({ type: "SEARCH_NOTION_DATABASES", token });
  if (!resp?.ok) {
    status.textContent = resp?.detail || "连接失败";
    status.style.color = "#ef4444";
    return;
  }
  if (resp.items.length === 0) {
    status.textContent = "未找到 database — 请先在 Notion 里把 database 连接给 integration（见设置指南）";
    status.style.color = "#ef4444";
    return;
  }
  _dbItems = resp.items;
  status.textContent = `✓ 已连接，找到 ${resp.items.length} 个 database`;
  status.style.color = "#16a34a";
  const select = document.getElementById("notion_database_select");
  select.innerHTML = _dbItems
    .map((d, i) => `<option value="${i}">${d.title}</option>`)
    .join("");
  document.getElementById("notion-db-row").style.display = "";
  saveSelectedDatabase();
});

function saveSelectedDatabase() {
  const i = Number(document.getElementById("notion_database_select").value || 0);
  const d = _dbItems[i];
  if (!d) return;
  chrome.storage.local.set({
    notion_database_id: d.databaseId,
    notion_data_source_id: d.dataSourceId, // picker delivers it directly — discovery becomes a no-op
    notion_database_title: d.title,        // redisplay on next popup open
  });
}

document.getElementById("notion_database_select").addEventListener("change", saveSelectedDatabase);
```

高级兜底输入框（ID 变更时必须清掉 data source 缓存）：

```js
document.getElementById("notion_database").addEventListener("input", () => {
  const raw = document.getElementById("notion_database").value.trim();
  const id = extractDatabaseId(raw);
  const hint = document.getElementById("notion-db-hint");
  if (raw && !id) {
    hint.textContent = "未识别到有效 ID，请粘贴 database 页面链接";
    hint.style.color = "#ef4444";
    return;
  }
  hint.textContent = id ? `已识别 ID：${id.slice(0, 8)}…` : "";
  hint.style.color = "#9ca3af";
  chrome.storage.local.set({ notion_database_id: id, notion_data_source_id: "", notion_database_title: "" });
});

document.getElementById("notion_token").addEventListener("input", save);
document.querySelectorAll("#dest-checks input").forEach((cb) =>
  cb.addEventListener("change", updateSectionVisibility)
);
```

加载回调中追加已选 database 的回显（defaults 加 `notion_database_title: ""`）：已有选择时在 `notion-status` 显示 `当前：<title>`。

- [ ] **Step 3: 手动验证**

1. 勾选 Notion → 设置区出现；取消 → 隐藏；Obsidian 同理
2. 贴正确 token 点「连接」→ 绿色"✓ 已连接，找到 N 个 database"，下拉出现并可选；贴错 token → 红色"Token 无效"；用没连接任何 database 的 integration → 红色"未找到 database"提示
3. 下拉切换选择后 `chrome.storage.local.get(console.log)` 确认 `notion_database_id` / `notion_data_source_id` / `notion_database_title` 同步更新
4. 高级兜底：粘贴完整 database URL → hint 显示"已识别 ID"；粘贴乱文本 → 红色提示；输入后确认 `notion_data_source_id` 被清空
5. 用 popup 配置（而非 console 手设）走一遍完整 clip 流程成功

- [ ] **Step 4: bump 版本号 + Commit**

`extension/manifest.json` 的 `"version"` 改为 `"0.2.0"`。

```bash
git add extension/popup.html extension/popup.js extension/manifest.json
git commit -m "feat: add Notion settings to popup, bump version to 0.2.0"
```

---

## Phase 3 — Onboarding 与文档

### Task 9: welcome 双目标分叉引导

**Files:**
- Modify: `extension/welcome.html`
- Modify: `extension/welcome.js`

- [ ] **Step 1: welcome.html — Header 下方、原 Step 1 卡片之前插入工具选择卡**

```html
    <!-- Step 0: Choose tool -->
    <div class="card">
      <div class="card-title"><span class="step-badge">1</span> 选择你的笔记工具</div>
      <p style="font-size:13px;color:#374151;margin-bottom:10px;">Clip 的字幕笔记要保存到哪里？（可多选）</p>
      <div class="checks" id="dest-checks">
        <label class="check"><input type="checkbox" value="obsidian" checked> Obsidian</label>
        <label class="check"><input type="checkbox" value="notion"> Notion</label>
        <label class="check"><input type="checkbox" value="clipboard"> 仅剪贴板</label>
      </div>
    </div>
```

（Task 4 已建的 `#dest-checks` 从原卡片移到这里；原 Obsidian 卡片去掉"输出到"区块，badge 改为 2，并给整个卡片加 `id="obsidian-setup"`。）

- [ ] **Step 2: welcome.html — Obsidian 卡片之后插入 Notion 设置卡**

```html
    <!-- Notion setup -->
    <div class="card" id="notion-setup" style="display:none;">
      <div class="card-title"><span class="step-badge">2</span> 配置你的 Notion</div>

      <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:16px;">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <div style="background:#7c3aed;color:white;width:20px;height:20px;border-radius:50%;
            display:flex;align-items:center;justify-content:center;font-size:11px;
            font-weight:700;flex-shrink:0;margin-top:2px;">1</div>
          <div>
            <p style="font-size:12px;color:#374151;margin-bottom:6px;">
              打开 <a href="https://www.notion.so/profile/integrations" target="_blank"
              style="color:#7c3aed;">Notion Integrations</a> 页面，创建一个 integration，
              复制 <strong>ntn_</strong> 开头的 token
            </p>
            <img src="assets/notion-step1.png" alt="创建 Notion integration"
              style="width:100%;border-radius:6px;border:1px solid #e5e7eb;display:block;">
          </div>
        </div>
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <div style="background:#7c3aed;color:white;width:20px;height:20px;border-radius:50%;
            display:flex;align-items:center;justify-content:center;font-size:11px;
            font-weight:700;flex-shrink:0;margin-top:2px;">2</div>
          <div>
            <p style="font-size:12px;color:#374151;margin-bottom:6px;">
              准备一个存字幕笔记的 database：推荐直接
              <a href="<!-- spike 记录的模板公开链接 -->" target="_blank" style="color:#7c3aed;">复制官方模板</a>（已带好所有字段），
              也可以用你自己的 database。然后在它的页面右上
              <strong>···</strong> → <strong>Connections</strong> → 连接到你刚创建的 integration
            </p>
            <img src="assets/notion-step2.png" alt="database 连接 integration"
              style="width:100%;border-radius:6px;border:1px solid #e5e7eb;display:block;">
          </div>
        </div>
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <div style="background:#7c3aed;color:white;width:20px;height:20px;border-radius:50%;
            display:flex;align-items:center;justify-content:center;font-size:11px;
            font-weight:700;flex-shrink:0;margin-top:2px;">3</div>
          <div>
            <p style="font-size:12px;color:#374151;margin-bottom:6px;">
              在下面贴入 token，点「连接」，从列表里选中你的 database
            </p>
            <img src="assets/notion-step3.png" alt="连接并选择 database"
              style="width:100%;border-radius:6px;border:1px solid #e5e7eb;display:block;">
          </div>
        </div>
      </div>

      <label for="notion_token">Notion Token <span style="color:#ef4444;">*</span></label>
      <div style="display:flex;gap:8px;">
        <input type="password" id="notion_token" placeholder="ntn_ 开头的 integration token" style="flex:1;">
        <button id="notion-connect" style="padding:8px 16px;background:#7c3aed;color:white;
          border:none;border-radius:7px;font-size:13px;font-weight:600;cursor:pointer;flex-shrink:0;">连接</button>
      </div>
      <p id="notion-status" style="margin-top:6px;font-size:12px;color:#9ca3af;"></p>

      <div id="notion-db-row" style="display:none;">
        <label for="notion_database_select">保存到哪个 database <span style="color:#ef4444;">*</span></label>
        <select id="notion_database_select" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;
          border-radius:7px;font-size:13px;color:#111;"></select>
      </div>

      <details style="margin-top:12px;">
        <summary style="font-size:12px;color:#9ca3af;cursor:pointer;">高级：手动粘贴 database 链接</summary>
        <input type="text" id="notion_database" placeholder="https://notion.so/xxxx…" style="margin-top:8px;">
        <p id="notion-db-hint" style="margin-top:6px;font-size:12px;color:#9ca3af;"></p>
      </details>
    </div>
```

（`notion-step3.png` 截图改为扩展里"连接 + 下拉选择"的界面截图，在 Task 8 完成后补拍。）

保存按钮从 Obsidian 卡片移出，放在 Notion 卡片之后独立成卡或保留在最后一个设置卡内（实现时取布局更自然者，保存逻辑不受影响）。"开始使用"卡 badge 改为 3。

- [ ] **Step 3: welcome.js — 分叉显示 + 连接/下拉 + 兜底输入**

加载回调追加 token 回显与已选 database 回显（defaults 加 `notion_token: ""`、`notion_database_id: ""`、`notion_database_title: ""`，有 title 时 `notion-status` 显示 `当前：<title>`）；新增：

```js
// ── 按勾选显示对应设置卡 ────────────────────────────────────────────────────────
function updateSetupCards() {
  const checked = (v) =>
    document.querySelector(`#dest-checks input[value="${v}"]`).checked;
  document.getElementById("obsidian-setup").style.display = checked("obsidian") ? "" : "none";
  document.getElementById("notion-setup").style.display = checked("notion") ? "" : "none";
}
document.querySelectorAll("#dest-checks input").forEach((cb) =>
  cb.addEventListener("change", updateSetupCards)
);

// ── 「连接」按钮：列出可选 database（兼作 token 即时校验） ───────────────────────
let _dbItems = [];

document.getElementById("notion-connect").addEventListener("click", async () => {
  const token = document.getElementById("notion_token").value.trim();
  const status = document.getElementById("notion-status");
  status.textContent = "连接中…";
  status.style.color = "#9ca3af";
  const resp = await chrome.runtime.sendMessage({ type: "SEARCH_NOTION_DATABASES", token });
  if (!resp?.ok) {
    status.textContent = resp?.detail || "连接失败";
    status.style.color = "#ef4444";
    return;
  }
  if (resp.items.length === 0) {
    status.textContent = "未找到 database — 请先完成第 2 步（把 database 连接给 integration）";
    status.style.color = "#ef4444";
    return;
  }
  _dbItems = resp.items;
  status.textContent = `✓ 已连接，找到 ${resp.items.length} 个 database`;
  status.style.color = "#16a34a";
  const select = document.getElementById("notion_database_select");
  select.innerHTML = _dbItems
    .map((d, i) => `<option value="${i}">${d.title}</option>`)
    .join("");
  document.getElementById("notion-db-row").style.display = "";
  saveSelectedDatabase();
});

function saveSelectedDatabase() {
  const i = Number(document.getElementById("notion_database_select").value || 0);
  const d = _dbItems[i];
  if (!d) return;
  chrome.storage.local.set({
    notion_database_id: d.databaseId,
    notion_data_source_id: d.dataSourceId,
    notion_database_title: d.title,
  });
}

document.getElementById("notion_database_select").addEventListener("change", saveSelectedDatabase);

// ── 高级兜底：手动粘贴链接 ──────────────────────────────────────────────────────
/** Accepts a full Notion URL or bare id; returns 32-hex id or "". */
function extractDatabaseId(input) {
  const m = (input || "").replace(/-/g, "").match(/[0-9a-f]{32}/i);
  return m ? m[0].toLowerCase() : "";
}

document.getElementById("notion_database").addEventListener("input", () => {
  const raw = document.getElementById("notion_database").value.trim();
  const id = extractDatabaseId(raw);
  const hint = document.getElementById("notion-db-hint");
  if (raw && !id) {
    hint.textContent = "未识别到有效 ID，请粘贴 database 页面链接";
    hint.style.color = "#ef4444";
    return;
  }
  hint.textContent = id ? `已识别 ID：${id.slice(0, 8)}…` : "";
  hint.style.color = "#9ca3af";
  if (id) chrome.storage.local.set({ notion_database_id: id, notion_data_source_id: "", notion_database_title: "" });
});
```

保存按钮校验扩展为"勾 Obsidian 必填 vault；勾 Notion 必须已有 `notion_token` 输入且 `notion_database_id` 已存在（下拉选过或兜底输入过），否则红框/红字提示"，保存对象追加：

```js
    notion_token: document.getElementById("notion_token").value.trim(),
```

（database 三元组由「连接/下拉/兜底输入」即时写入 storage，保存按钮不重复写。）加载完成后调用一次 `updateSetupCards()`。

- [ ] **Step 4: 手动验证**

1. 重装扩展（remove + load unpacked）触发首装 welcome：默认勾 Obsidian，只见 Obsidian 卡
2. 勾 Notion → Notion 卡展开，三步截图正常显示
3. 只勾 Notion：不填 token 保存被拦；贴 token 点「连接」→ 下拉选 database → 保存成功，popup 中设置一致；"复制官方模板"链接可正常打开并复制
4. 按 welcome 配置完整 clip 一次成功

- [ ] **Step 5: Commit**

```bash
git add extension/welcome.html extension/welcome.js
git commit -m "feat: dual-destination onboarding with Notion setup guide"
```

### Task 10: 文档同步（CLAUDE.md、README）

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: CLAUDE.md 更新**

- 一句话目标：「Chrome 扩展：在 B 站视频页注入 Clip bar，提取 CC 字幕，写入 Obsidian vault **或 Notion database**。」
- 技术栈集成行：「Obsidian URI scheme（`obsidian://new`）+ Notion REST API（background fetch，PAT 认证）+ 系统剪贴板」
- 文件结构中 background.js 注释：「onInstalled → welcome.html；OPEN_WELCOME / CLIP_TO_NOTION 消息处理 + Notion API 客户端」
- 当前状态"已完成"追加：「Notion 集成（destinations 多选、data source discovery、Markdown 端点写入）」
- DoD 验收方式追加：「+ Notion database 实际写入确认」

- [ ] **Step 2: README.md 功能区追加 Notion 说明**

在功能列表加一条：支持写入 Notion（创建 integration → 连接 database → 粘贴链接，详见扩展内设置指南）。安装/截图区不动。

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document Notion integration in CLAUDE.md and README"
```

### Task 11: 最终验收 + 发布

- [ ] **Step 1: 完整验收清单**

1. 旧设置迁移：`chrome.storage.local.set({output:"both", destinations:null})` → 重载 → clip 行为同迁移前
2. 双目标：同时勾 Obsidian + Notion clip 真实视频，两边笔记内容正确
3. 错误路径逐一触发：错 token（401 文案）、未连接的 database（404 文案）、断网（网络文案）
4. 无 CC 字幕视频、SPA 切换视频两个旧场景无回归
5. CLAUDE.md / README 与实际行为一致

- [ ] **Step 2: 打 tag 发布（沿用现有 GitHub Actions 流程）**

```bash
git push origin master
git tag v0.2.0
git push origin v0.2.0
```

预期：Actions 自动打包 zip 并发布 GitHub Release。

---

## 修订记录

- 2026-06-09（同日修订）：基于同类方案调研（arxiv2notion、web-clipper、Search API），经用户确认加入两项改进：① database 下拉选择器（Task 1 Step 2b、Task 6 `SEARCH_NOTION_DATABASES`、Task 8/9 连接+下拉交互，贴 URL 降级为高级兜底）；② 官方公共模板（Task 1 Step 5b 发布，Task 9 welcome 引导一键复制）。新增 storage 键 `notion_database_title`。

## Self-Review 记录

- Spec 覆盖：§4.2 设置迁移→Task 2/3/4；§4.3 writer 接口→Task 2/7;§4.4 写入流程→Task 1/6；§4.5 UI→Task 3/8 + Task 2 renderResults；§4.6 onboarding→Task 1（截图）/9；§4.7 错误处理→Task 6/7；§5 manifest→Task 5/8；文档→Task 10；验收→Task 11 ✓
- 占位符：仅两处刻意留给 spike 决定（NOTION_VERSION 实际值、PATCH 请求体形状），均指向 Task 1 的记录义务，非未决设计 ✓
- 命名一致性：`destinations` / `notion_token` / `notion_database_id` / `notion_data_source_id` / `WRITERS` / `DEST_LABELS` / `extractDatabaseId` / `updateSectionVisibility`(popup) / `updateSetupCards`(welcome) 各 task 间已核对 ✓
