// extension/welcome.js

// ── 视频教程 URL ──────────────────────────────────────────────────────────────
// 填入视频链接后自动显示按钮，留空则显示"即将上线"提示
const TUTORIAL_URL = "";

// ── 初始化教程区域 ─────────────────────────────────────────────────────────────
const tutorialArea = document.getElementById("tutorial-area");
if (TUTORIAL_URL) {
  tutorialArea.innerHTML =
    `<a class="tutorial-link" href="${TUTORIAL_URL}" target="_blank">` +
    `<span>▶</span><span>观看视频教程</span></a>`;
} else {
  tutorialArea.innerHTML =
    `<span class="tutorial-coming">视频教程即将上线</span>`;
}

// ── 加载已保存的设置 ───────────────────────────────────────────────────────────
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
    updateSetupCards();
  }
);

// ── Setup card visibility ──────────────────────────────────────────────────────
function updateSetupCards() {
  const checked = (v) =>
    document.querySelector(`#dest-checks input[value="${v}"]`).checked;
  document.getElementById("obsidian-setup").style.display =
    checked("obsidian") ? "" : "none";
  document.getElementById("notion-setup").style.display =
    checked("notion") ? "" : "none";
}

document.querySelectorAll("#dest-checks input").forEach((cb) =>
  cb.addEventListener("change", updateSetupCards)
);

// ── 默认 Vault 名称快填 ────────────────────────────────────────────────────────
document.getElementById("fill-default-vault").addEventListener("click", () => {
  const input = document.getElementById("vault_name");
  input.value = "Obsidian Vault";
  input.focus();
});

// ── Notion connect + database picker ─────────────────────────────────────────

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
    status.textContent = "未找到 database — 请先完成第 2 步（把 database 连接给 connection）";
    status.style.color = "#ef4444";
    return;
  }
  chrome.storage.local.set({ notion_token: token }); // token proven valid — persist eagerly like the db keys
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
    notion_data_source_id: d.dataSourceId,
    notion_database_title: d.title,
  });
  const status = document.getElementById("notion-status");
  status.textContent = "当前：" + d.title;
  status.style.color = "#9ca3af";
}

document.getElementById("notion_database_select").addEventListener("change", saveSelectedDatabase);

// ── 保存设置 ───────────────────────────────────────────────────────────────────
document.getElementById("save-btn").addEventListener("click", () => {
  const vault_name = document.getElementById("vault_name").value.trim();
  const folder = document.getElementById("folder").value.trim();
  const destinations = [...document.querySelectorAll("#dest-checks input:checked")]
    .map((cb) => cb.value);
  const notion_token = document.getElementById("notion_token").value.trim();

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

  // Notion token + database 仅在勾选 Notion 时必填
  if (destinations.includes("notion") && (!notion_token || !_savedDatabaseId)) {
    const tokenInput = document.getElementById("notion_token");
    tokenInput.focus();
    tokenInput.style.borderColor = "#ef4444";
    tokenInput.style.boxShadow = "0 0 0 3px rgba(239,68,68,0.15)";
    setTimeout(() => {
      tokenInput.style.borderColor = "";
      tokenInput.style.boxShadow = "";
    }, 2000);
    const status = document.getElementById("notion-status");
    status.textContent = "请先填写 Token 并连接选择 database";
    status.style.color = "#ef4444";
    return;
  }

  chrome.storage.local.set({ vault_name, folder, destinations, notion_token }, () => {
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
