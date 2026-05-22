// extension/popup.js

// ─── Load + render saved settings ────────────────────────────────────────────
chrome.storage.local.get(
  { vault_name: "", folder: "Raw", output: "obsidian" },
  (s) => {
    document.getElementById("vault_name").value = s.vault_name;
    document.getElementById("folder").value = s.folder;
    document.querySelectorAll("#output-seg button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.value === s.output);
    });
  }
);

// ─── Save on any change ───────────────────────────────────────────────────────
function save() {
  const output =
    document.querySelector("#output-seg button.active")?.dataset.value ?? "obsidian";
  chrome.storage.local.set({
    vault_name: document.getElementById("vault_name").value.trim(),
    folder: document.getElementById("folder").value.trim(),
    output,
  });
}

["vault_name", "folder"].forEach((id) =>
  document.getElementById(id).addEventListener("change", save)
);

document.querySelectorAll("#output-seg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#output-seg button").forEach((b) =>
      b.classList.remove("active")
    );
    btn.classList.add("active");
    save();
  });
});

