/* eslint-env browser */
/* global window */

/**
 * Preferences window renderer logic.
 *
 * Talks to the main process exclusively through the `window.vaultgate`
 * bridge installed by `preload.ts`. No Node APIs are available here.
 */

(async () => {
  const api = window.vaultgate;
  if (!api) return;

  const vaultSelect = document.getElementById("vault");
  const portInput = document.getElementById("port");
  const obsidianInput = document.getElementById("obsidian");
  const autostartInput = document.getElementById("autostart");
  const browseBtn = document.getElementById("browse");
  const saveBtn = document.getElementById("save");
  const cancelBtn = document.getElementById("cancel");

  const [config, vaults, autostart] = await Promise.all([
    api.loadConfig(),
    api.listVaults(),
    api.isAutostartEnabled(),
  ]);

  // Populate vault dropdown ----------------------------------------------------
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Active vault (default)";
  vaultSelect.appendChild(defaultOption);
  for (const vault of vaults) {
    const option = document.createElement("option");
    option.value = vault.name;
    option.textContent = vault.name;
    vaultSelect.appendChild(option);
  }
  vaultSelect.value = config.vault ?? "";

  // Other fields ---------------------------------------------------------------
  portInput.value = String(config.port ?? 3001);
  obsidianInput.value =
    config.obsidianPath || (await api.detectObsidianPath()) || "";
  autostartInput.checked = Boolean(autostart);

  // Browse for Obsidian path ---------------------------------------------------
  browseBtn.addEventListener("click", async () => {
    const picked = await api.pickObsidianPath();
    if (picked) obsidianInput.value = picked;
  });

  // Save -----------------------------------------------------------------------
  saveBtn.addEventListener("click", async () => {
    const port = Number.parseInt(portInput.value, 10);
    const patch = {
      vault: vaultSelect.value,
      port: Number.isFinite(port) ? port : 3001,
      obsidianPath: obsidianInput.value,
    };
    await api.setAutostart(autostartInput.checked);
    await api.saveConfig(patch);
    api.close();
  });

  // Cancel ---------------------------------------------------------------------
  cancelBtn.addEventListener("click", () => api.close());
})();
