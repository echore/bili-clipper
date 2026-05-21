// extension/popup.js

chrome.storage.local.get(
  { vault_path: "~/Documents/Obsidian Vault", folder: "Raw", output: "obsidian", model: "large-v3-turbo" },
  (s) => {
    document.getElementById("vault_path").value = s.vault_path;
    document.getElementById("folder").value = s.folder;
    document.getElementById("model").value = s.model;
    document.querySelectorAll("#output-seg button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.value === s.output);
    });
  }
);

function save() {
  const output =
    document.querySelector("#output-seg button.active")?.dataset.value ?? "obsidian";
  chrome.storage.local.set({
    vault_path: document.getElementById("vault_path").value.trim(),
    folder: document.getElementById("folder").value.trim(),
    output,
    model: document.getElementById("model").value,
  });
}

["vault_path", "folder", "model"].forEach((id) =>
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

(async () => {
  const dot = document.getElementById("dot");
  const label = document.getElementById("srv-label");
  try {
    const res = await fetch("http://localhost:27182/health", {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      dot.classList.add("ok");
      label.textContent = "本地服务运行中 · :27182";
    } else throw new Error();
  } catch {
    dot.classList.add("err");
    label.textContent = "本地服务未运行";
  }
})();
