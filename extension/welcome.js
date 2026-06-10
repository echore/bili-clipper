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


// ── 默认 Vault 名称快填 ────────────────────────────────────────────────────────
document.getElementById("fill-default-vault").addEventListener("click", () => {
  const input = document.getElementById("vault_name");
  input.value = "Obsidian Vault";
  input.focus();
});

// ── 保存设置 ───────────────────────────────────────────────────────────────────
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
