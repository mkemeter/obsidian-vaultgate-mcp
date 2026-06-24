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
  const portError = document.getElementById("port-error");
  const obsidianInput = document.getElementById("obsidian");
  const autostartInput = document.getElementById("autostart");
  const browseBtn = document.getElementById("browse");
  const saveBtn = document.getElementById("save");
  const cancelBtn = document.getElementById("cancel");

  const [config, vaults, autostart, serverState] = await Promise.all([
    api.loadConfig(),
    api.listVaults(),
    api.isAutostartEnabled(),
    api.getServerState(),
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

  // Port — always show the saved port; validatePort() will flag any conflict ----
  portInput.value = String(config.port);
  obsidianInput.value =
    config.obsidianPath || (await api.detectObsidianPath()) || "";
  autostartInput.checked = Boolean(autostart);

  // Wire server state into status indicator ------------------------------------
  const dot = document.getElementById("status-dot");
  if (dot) dot.dataset.state = serverState ?? "loading";

  // Port validation ------------------------------------------------------------
  let portCheckTimer = null;

  function setPortError(msg) {
    portError.textContent = msg;
    portInput.classList.toggle("error", Boolean(msg));
    saveBtn.disabled = Boolean(msg);
  }

  async function validatePort() {
    const port = Number.parseInt(portInput.value, 10);
    if (!Number.isFinite(port) || port < 1024 || port > 65535) {
      setPortError("Port must be between 1024 and 65535.");
      return;
    }
    const status = await api.checkPort(port);
    if (status === "conflict") {
      setPortError(`Port ${port} is already in use by another application.`);
    } else {
      setPortError("");
    }
  }

  portInput.addEventListener("input", () => {
    clearTimeout(portCheckTimer);
    portCheckTimer = setTimeout(validatePort, 400);
  });

  // Run initial validation (the suggested port should always be free, but
  // if the saved port differs it may be in conflict).
  await validatePort();

  // Browse for Obsidian path ---------------------------------------------------
  browseBtn.addEventListener("click", async () => {
    const picked = await api.pickObsidianPath();
    if (picked) obsidianInput.value = picked;
  });

  // Save -----------------------------------------------------------------------
  saveBtn.addEventListener("click", async () => {
    // Re-validate synchronously before saving in case the user typed fast.
    await validatePort();
    if (saveBtn.disabled) return;

    const port = Number.parseInt(portInput.value, 10);
    const patch = {
      vault: vaultSelect.value,
      port: Number.isFinite(port) ? port : config.port,
      obsidianPath: obsidianInput.value,
    };
    await api.setAutostart(autostartInput.checked);
    await api.saveConfig(patch);
    api.close();
  });

  // Cancel ---------------------------------------------------------------------
  cancelBtn.addEventListener("click", () => api.close());
})();
