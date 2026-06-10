// extension/popup.js

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

document.getElementById("open-welcome").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
});

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

