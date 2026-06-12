# 多P/合集视频字幕修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复多P（分P/选集）与合集（ugc_season）视频上字幕永远抓取第 1 集的两个根因，并贯通分P信息到标题、链接与嵌入播放器。

**Architecture:** 两个独立修复：(1) `getVideoInfo` 改为按 URL `?p=` 参数从 `pages` 数组解析当前分P的 cid（实测确认顶层 cid 恒等于 P1 的 cid）；(2) 新增 MAIN world 的 `page-hook.js`，在页面主世界给 `history.pushState/replaceState` 打补丁并派发 DOM 事件，替换掉 content script isolated world 里从未生效的拦截。合集（每集独立 bvid，已实测确认）由修复 (2) 自动覆盖——跳转被感知后按新 bvid 重新加载即可。

**Tech Stack:** Chrome Manifest V3（`world: "MAIN"` 需 Chrome 111+）、vanilla JS。无测试框架，按项目 DoD 人工验证（chrome://extensions 重载 → B 站视频页目视验证）。

**诊断依据（2026-06-12 实测）:**
- `view?bvid=` 接口顶层 `cid` === `pages[0].cid`（BV1W4EE6GECF，31P 实测），每个分P在 `pages` 数组有独立 cid。
- 合集 `ugc_season.sections[].episodes[]` 每集独立 bvid（实测确认）。
- content script isolated world 改写 `history.pushState` 对页面主世界无效（Chrome 文档明确行为），现有 SPA 感知仅 popstate（前进/后退）生效。

---

### Task 0: 安全快照

**Files:** 无改动

- [ ] **Step 1: 确认工作区干净**

Run: `git -C /Users/liyachen/Documents/fang/bili-clipper status --short`
Expected: 无输出（clean）。若有未提交改动，先提交快照再继续。

---

### Task 1: 按 `?p=` 解析当前分P的 cid

**Files:**
- Modify: `extension/content.js:5-24`（`getBvId` 之后新增 `getPageParam`，重写 `getVideoInfo`）
- Modify: `extension/content.js:323-339`（`loadVideoDataAndRenderIdle` 传入并保存 page）

- [ ] **Step 1: 新增 `getPageParam`，重写 `getVideoInfo`**

将 `content.js:10-24` 的 `getVideoInfo` 整体替换，并在其前面新增 `getPageParam`：

```js
function getPageParam() {
  const p = parseInt(new URLSearchParams(window.location.search).get("p"), 10);
  return Number.isInteger(p) && p > 0 ? p : 1;
}

async function getVideoInfo(bvid, page = 1) {
  const res = await fetch(
    `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
    { credentials: "include" }
  );
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Bilibili API error: ${data.message}`);
  const d = data.data;
  const pages = d.pages || [];
  // 顶层 d.cid 恒等于 P1 的 cid（2026-06-12 实测），多P视频必须从 pages 取当前分P的 cid
  const pageInfo = pages[page - 1] || pages[0] || null;
  const isMultiPage = pages.length > 1;
  return {
    aid: d.aid,
    cid: pageInfo ? pageInfo.cid : d.cid,
    page: pageInfo ? pageInfo.page : 1,
    title:
      isMultiPage && pageInfo && pageInfo.part
        ? `${d.title} - P${pageInfo.page} ${pageInfo.part}`
        : d.title,
    desc: d.desc || "",
    author: d.owner?.name || "",
  };
}
```

说明：多P视频标题追加 `P{n} {分P标题}`，否则不同分P的笔记会因同名互相覆盖。`?p=` 越界时回退 P1。

- [ ] **Step 2: `loadVideoDataAndRenderIdle` 传入 page 并存入 `_videoData`**

替换 `content.js:323-339`：

```js
async function loadVideoDataAndRenderIdle() {
  const bvid = getBvId();
  if (!bvid) return;
  const page = getPageParam();
  try {
    const { aid, cid, page: resolvedPage, title, desc, author } = await getVideoInfo(bvid, page);
    const { subtitles, chapters } = await getPlayerData(aid, cid);
    if (subtitles.length === 0) {
      renderNoSubtitles();
      return;
    }
    _videoData = { bvid, aid, cid, page: resolvedPage, title, desc, author, subtitles, chapters };
    renderIdle();
  } catch (err) {
    renderError("无法加载视频信息");
    console.error("[Bili Clipper]", err);
  }
}
```

- [ ] **Step 3: 人工验证 cid 解析**

chrome://extensions 重载扩展 → 打开一个多P且有 CC 字幕的视频的 `?p=2` 页面（用报 bug 的那个视频）→ 强制刷新。
Expected: Clip bar 显示「CC 字幕 ✓」，且后续 Clip 出的字幕属于 P2（对照播放器开头几句台词）。
DevTools Network 面板确认 `player/wbi/v2` 请求的 `cid` 参数 ≠ P1 的 cid。

- [ ] **Step 4: Commit**

```bash
git add extension/content.js
git commit -m "fix: resolve per-page cid from ?p= param instead of always using page-1 cid"
```

---

### Task 2: 分P信息贯通到链接、历史记录与嵌入播放器

**Files:**
- Modify: `extension/content.js:126-133`（`buildEmbedIframe` 增加 page 参数）
- Modify: `extension/content.js:174-183`（`buildNoteMeta` 用带 `?p=` 的 URL）
- Modify: `extension/content.js:440-491`（`handleClip` 串起 page）

- [ ] **Step 1: 新增 `buildVideoUrl`，修改 `buildNoteMeta`**

在 `buildNoteMeta`（content.js:174）前新增：

```js
function buildVideoUrl(bvid, page) {
  const base = `https://www.bilibili.com/video/${bvid}`;
  return page > 1 ? `${base}?p=${page}` : base;
}
```

`buildNoteMeta` 替换为：

```js
function buildNoteMeta(title, bvid, page, author, method) {
  return {
    title,
    sourceUrl: bvid ? buildVideoUrl(bvid, page) : "",
    author: author || "",
    date: new Date().toISOString().split("T")[0],
    tags: ["transcript", "bilibili"],
    method,
  };
}
```

- [ ] **Step 2: `buildEmbedIframe` 改用真实 page**

替换 `content.js:126-133`（原来硬编码 `page=1`）：

```js
function buildEmbedIframe(bvid, cid, aid, page) {
  return (
    `<iframe src="https://player.bilibili.com/player.html` +
    `?bvid=${bvid}&cid=${cid}&aid=${aid}&page=${page}&autoplay=0" ` +
    `scrolling="no" border="0" frameborder="no" framespacing="0" ` +
    `allowfullscreen="true" style="width:100%;aspect-ratio:16/9;"></iframe>`
  );
}
```

- [ ] **Step 3: `handleClip` 串起 page**

`content.js:457` 的解构改为：

```js
const { bvid, aid, cid, page, title, desc, author, subtitles, chapters } = _videoData;
```

`content.js:463` 改为：

```js
const meta = buildNoteMeta(title, bvid, page, author, "cc_subtitle");
```

`content.js:469` 的 iframe 调用改为：

```js
formatNoteBody(subtitleSection, desc, buildEmbedIframe(bvid, cid, aid, page)),
```

`content.js:484` 的历史记录改为：

```js
saveClipHistory({ title, url: buildVideoUrl(bvid, page) });
```

- [ ] **Step 4: 人工验证**

重载扩展 → 在 `?p=2` 页面 Clip 到 Obsidian。
Expected: 笔记 frontmatter `source:` 带 `?p=2`；iframe `page=2`；popup 历史记录的链接点开落在 P2；标题含 `P2` 与分P名。单P视频回归：source 不带 `?p=`，标题不变。

- [ ] **Step 5: Commit**

```bash
git add extension/content.js
git commit -m "fix: propagate page number to source url, clip history, and embed iframe"
```

---

### Task 3: MAIN world 导航钩子，替换失效的 isolated world 拦截

**Files:**
- Create: `extension/page-hook.js`
- Modify: `extension/manifest.json:20-26`（新增 MAIN world content script + `minimum_chrome_version`）
- Modify: `extension/content.js:499-533`（⚠️ 含删除：移除 `_origPushState`/`_origReplaceState` 两段失效补丁）

- [ ] **Step 1: 创建 `extension/page-hook.js`**

```js
// extension/page-hook.js — 以 world:"MAIN" 注入页面主世界。
// content script 的 isolated world 改不到页面的 history 对象，
// 必须在主世界打补丁，再用 DOM 事件通知 isolated world（content.js）。
(function () {
  const notify = () => window.dispatchEvent(new Event("bili-clipper:navigation"));
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method].bind(history);
    history[method] = function (...args) {
      const result = original(...args);
      notify();
      return result;
    };
  }
})();
```

- [ ] **Step 2: manifest.json 注册 MAIN world 脚本**

`content_scripts` 块替换为（并在顶层加 `minimum_chrome_version`，`world` 键需 Chrome 111+）：

```json
"minimum_chrome_version": "111",
"content_scripts": [
  {
    "matches": ["https://www.bilibili.com/video/*"],
    "js": ["page-hook.js"],
    "run_at": "document_start",
    "world": "MAIN"
  },
  {
    "matches": ["https://www.bilibili.com/video/*"],
    "js": ["content.js"],
    "run_at": "document_idle"
  }
]
```

`run_at: document_start` 保证补丁先于 B 站页面脚本安装。

- [ ] **Step 3: content.js 改为监听事件（删除旧补丁）**

将 `content.js:499-533`（SPA navigation 整段，从注释到 popstate 监听）替换为：

```js
// ─── SPA navigation ───────────────────────────────────────────────────────────
// B 站是 SPA，站内切换视频/分P走 History API。pushState/replaceState 由
// page-hook.js 在主世界拦截后派发 bili-clipper:navigation 事件（isolated
// world 直接改写 history 对页面无效）；popstate（前进/后退）两个世界都能收到。

let _currentUrl = location.href;

function handleNavigation() {
  const newUrl = location.href;
  if (newUrl === _currentUrl) return;
  _currentUrl = newUrl;

  if (!newUrl.includes("/video/")) return;

  if (_clipBar) { _clipBar.remove(); _clipBar = null; }
  _videoData = null;
  _isProcessing = false;
  _collapsed = false;

  init();
}

window.addEventListener("bili-clipper:navigation", handleNavigation);
window.addEventListener("popstate", handleNavigation);
```

**删除内容**（已在方案评审时明示）：原 `content.js:521-531` 的 `_origPushState`/`_origReplaceState` 改写块——它运行在 isolated world，从未拦截到页面的真实跳转，属死代码且具误导性。

- [ ] **Step 4: 人工验证 SPA 感知**

重载扩展 → 打开多P视频 P1 → 在页面选集列表点击 P2（不刷新）。
Expected: Clip bar 消失重建，加载后 Clip 出 P2 字幕、标题含 P2。
再到一个合集视频，点合集列表切换下一集（bvid 变化）。
Expected: 同样重建并对应新一集。
浏览器后退键：bar 跟随回退。
主世界 console 跑 `history.pushState.toString()` 应显示包装函数而非 `[native code]`。

- [ ] **Step 5: Commit**

```bash
git add extension/page-hook.js extension/manifest.json extension/content.js
git commit -m "fix: detect SPA navigation via MAIN-world history hook (isolated-world patch never fired)"
```

---

### Task 4: 版本号与文档

**Files:**
- Modify: `extension/manifest.json:4`（`"version": "0.2.0"` → `"0.2.1"`）
- Modify: `CLAUDE.md`（文件结构补 `page-hook.js`；「已完成」列表的"SPA 导航感知（pushState/replaceState 拦截）"改为"SPA 导航感知（MAIN world history 钩子 + popstate）"；补一条"多P/合集视频按 `?p=` 解析分P cid"）

- [ ] **Step 1: 改 manifest 版本号为 0.2.1**

- [ ] **Step 2: 更新 CLAUDE.md 上述两处**

- [ ] **Step 3: Commit**

```bash
git add extension/manifest.json CLAUDE.md
git commit -m "chore: bump version to 0.2.1, document multi-part fix in CLAUDE.md"
```

---

### Task 5: 全量回归验证（项目 DoD）

**Files:** 无改动

- [ ] **Step 1: 按 DoD 跑完整场景矩阵**

chrome://extensions 重载扩展后逐项确认：

| # | 场景 | 预期 |
|---|------|------|
| 1 | 单P视频打开 + Clip | 与 0.2.0 行为一致，无回归 |
| 2 | 多P视频直接打开 `?p=2` 并刷新 | 字幕/标题/链接均为 P2 |
| 3 | 多P视频站内点选集 P1→P3 | bar 重建，Clip 出 P3 |
| 4 | 合集视频站内切下一集（bvid 变化） | bar 重建，Clip 出新一集 |
| 5 | 浏览器后退/前进 | bar 跟随当前视频 |
| 6 | Obsidian 实际写入 | 笔记落盘，iframe page 正确 |
| 7 | Notion 实际写入 | database 出现条目，source URL 带 `?p=` |
| 8 | 无字幕视频 | 显示「此视频无 CC 字幕」 |

- [ ] **Step 2: 全部通过后向用户报告结果**

任何一项失败：停下，回到 systematic-debugging 流程，不堆叠修补。
