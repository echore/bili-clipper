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
const NOTION_VERSION = "2026-03-11"; // pinned; spike-verified (docs/superpowers/spikes/)

async function notionFetch(path, options, token) {
  let res;
  try {
    res = await fetch(NOTION_API + path, {
      ...options,
      headers: {
        ...(options.headers || {}),
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

/** List databases the token can access — powers the database picker in popup/welcome. */
async function searchNotionDatabases(token) {
  if (!token) return { ok: false, detail: "请先填写 Token" };
  let data;
  try {
    data = await notionFetch(
      "/search",
      {
        method: "POST",
        body: JSON.stringify({
          filter: { property: "object", value: "data_source" },
          page_size: 50,
        }),
      },
      token
    );
  } catch (err) {
    if (err.status === 401) return { ok: false, detail: "Token 无效，请检查 Notion Token" };
    if (err.network) return { ok: false, detail: "网络错误，稍后重试" };
    return { ok: false, detail: err.message };
  }
  const items = [];
  for (const r of data.results || []) {
    const dataSourceId = r.object === "data_source" ? r.id : "";
    const databaseId = r.parent?.database_id || (r.object === "database" ? r.id : "");
    let title = (r.title || []).map((t) => t.plain_text).join("");
    if (!title && databaseId) {
      // spike finding: data_source search results can have an empty title —
      // the display name lives on the parent database
      const db = await notionFetch(`/databases/${databaseId}`, { method: "GET" }, token)
        .catch(() => null);
      title = db ? (db.title || []).map((t) => t.plain_text).join("") : "";
    }
    items.push({ dataSourceId, databaseId, title: title || "未命名 database" });
  }
  return { ok: true, items };
}

// Standard columns auto-created when absent (spike-verified: PATCH /v1/data_sources adds columns)
const COLUMN_SPECS = [
  { name: "Source", def: { url: {} }, type: "url", aliases: ["source", "url", "链接", "来源"],
    value: (meta) => ({ url: meta.sourceUrl }) },
  { name: "Author", def: { rich_text: {} }, type: "rich_text", aliases: ["author", "作者"],
    value: (meta) => ({ rich_text: [{ text: { content: meta.author } }] }) },
  { name: "Date", def: { date: {} }, type: "date", aliases: ["date", "日期"],
    value: (meta) => ({ date: { start: meta.date } }) },
  { name: "Tags", def: { multi_select: {} }, type: "multi_select", aliases: ["tags", "标签"],
    value: (meta) => ({ multi_select: meta.tags.map((t) => ({ name: t })) }) },
];

/** Add missing standard columns. Never touches an existing column: a PATCH on an
 *  occupied name silently CONVERTS its type (live-verified), so any name collision
 *  — even with the wrong type — blocks creation and the mapper just skips it. */
async function ensureStandardColumns(token, dataSourceId, ds) {
  const props = ds.properties || {};
  const taken = new Set(Object.keys(props).map((n) => n.toLowerCase()));
  const missing = {};
  for (const spec of COLUMN_SPECS) {
    const occupied = spec.aliases.some((a) => taken.has(a));
    if (!occupied) missing[spec.name] = spec.def;
  }
  if (Object.keys(missing).length === 0) return ds;
  try {
    return await notionFetch(
      `/data_sources/${dataSourceId}`,
      { method: "PATCH", body: JSON.stringify({ properties: missing }) },
      token
    );
  } catch (e) {
    return ds; // schema edit may be denied — degrade to mapping whatever exists
  }
}

/** Resolve and cache the data source id (picker writes it directly; this is the fallback). */
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

/** Map note metadata onto matching columns, auto-creating standard ones first. */
async function buildNotionProperties(token, dataSourceId, meta) {
  let ds = await notionFetch(`/data_sources/${dataSourceId}`, { method: "GET" }, token);
  ds = await ensureStandardColumns(token, dataSourceId, ds);
  const out = {};
  for (const [name, def] of Object.entries(ds.properties || {})) {
    if (def.type === "title") {
      out[name] = { title: [{ text: { content: meta.title } }] };
      continue;
    }
    const spec = COLUMN_SPECS.find(
      (s) => s.type === def.type && s.aliases.includes(name.toLowerCase())
    );
    if (spec) out[name] = spec.value(meta);
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
        // shape verified by spike: nested discriminated union, NOT flat command/new_str
        body: JSON.stringify({ type: "replace_content", replace_content: { new_str: body } }),
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
