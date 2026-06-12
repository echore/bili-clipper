// extension/popup.js

// ─── Load + render saved settings ────────────────────────────────────────────
const LEGACY_OUTPUT_MAP = {
  obsidian: ["obsidian"],
  clipboard: ["clipboard"],
  both: ["obsidian", "clipboard"],
};

let _savedDatabaseId = "";

chrome.storage.local.get(
  { vault_name: "", folder: "", output: "", destinations: null,
    notion_token: "", notion_database_id: "", notion_database_title: "" },
  (s) => {
    _savedDatabaseId = s.notion_database_id || "";
    document.getElementById("vault_name").value = s.vault_name;
    document.getElementById("folder").value = s.folder;
    const dests = Array.isArray(s.destinations)
      ? s.destinations
      : LEGACY_OUTPUT_MAP[s.output] || ["obsidian"];
    document.querySelectorAll("#dest-checks input").forEach((cb) => {
      cb.checked = dests.includes(cb.value);
    });
    document.getElementById("notion_token").value = s.notion_token;
    if (s.notion_database_title) {
      const st = document.getElementById("notion-status");
      st.textContent = "当前：" + s.notion_database_title;
    }
    updateSectionVisibility();
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
    notion_token: document.getElementById("notion_token").value.trim(),
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
  cb.addEventListener("change", () => { save(); updateSectionVisibility(); })
);

document.getElementById("notion_token").addEventListener("input", save);

document.getElementById("open-welcome").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
});

// ─── Section visibility ───────────────────────────────────────────────────────

function updateSectionVisibility() {
  const checked = (v) =>
    document.querySelector(`#dest-checks input[value="${v}"]`).checked;
  document.getElementById("obsidian-settings").style.display =
    checked("obsidian") ? "" : "none";
  document.getElementById("notion-settings").style.display =
    checked("notion") ? "" : "none";
}

// ─── Notion connect + database picker ────────────────────────────────────────

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

let _dbItems = [];

document.getElementById("notion-connect").addEventListener("click", async () => {
  const token = document.getElementById("notion_token").value.trim();
  const status = document.getElementById("notion-status");
  status.textContent = "连接中…";
  status.style.color = "#9ca3af";
  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ type: "SEARCH_NOTION_DATABASES", token });
  } catch (err) {
    status.textContent = "连接失败";
    status.style.color = "#ef4444";
    return;
  }
  if (!resp?.ok) {
    status.textContent = resp?.detail || "连接失败";
    status.style.color = "#ef4444";
    return;
  }
  if (resp.items.length === 0) {
    status.textContent = "未找到 database — 请先在 Notion 里把 database 连接给 connection（见设置指南）";
    status.style.color = "#ef4444";
    return;
  }
  _dbItems = resp.items;
  status.textContent = `✓ 已连接，找到 ${resp.items.length} 个 database`;
  status.style.color = "#16a34a";
  const select = document.getElementById("notion_database_select");
  select.innerHTML = _dbItems
    .map((d, i) => `<option value="${i}">${escapeHtml(d.title)}</option>`)
    .join("");
  document.getElementById("notion-db-row").style.display = "";
  const idx = _dbItems.findIndex((d) => d.databaseId === _savedDatabaseId);
  if (idx !== -1) {
    select.value = String(idx);
  } else {
    saveSelectedDatabase();
  }
});

function saveSelectedDatabase() {
  const i = Number(document.getElementById("notion_database_select").value || 0);
  const d = _dbItems[i];
  if (!d || !d.databaseId) return;
  _savedDatabaseId = d.databaseId;
  chrome.storage.local.set({
    notion_database_id: d.databaseId,
    notion_data_source_id: d.dataSourceId, // picker delivers it directly — discovery becomes a no-op
    notion_database_title: d.title,        // redisplay on next popup open
  });
  const status = document.getElementById("notion-status");
  status.textContent = "当前：" + d.title;
  status.style.color = "#9ca3af";
}

document.getElementById("notion_database_select").addEventListener("change", saveSelectedDatabase);

// ─── Clip history ─────────────────────────────────────────────────────────────

chrome.storage.local.get({ clip_history: [] }, ({ clip_history }) => {
  const container = document.getElementById("history-list");
  if (clip_history.length === 0) {
    container.innerHTML = `<span class="history-empty">还没有 Clip 记录</span>`;
    return;
  }
  container.innerHTML = clip_history.map(({ title, url, time }) => {
    const date = new Date(time).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
    return `<a class="history-item" href="${url}" target="_blank">
      ${title}<span class="date">${date}</span>
    </a>`;
  }).join("");
});
