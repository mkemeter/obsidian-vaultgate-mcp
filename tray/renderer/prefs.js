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
  const contextFileInput = document.getElementById("context-file");
  const contextFileError = document.getElementById("context-file-error");
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
  contextFileInput.value = config.contextFileName || "VAULTGATE.md";
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

  // Conventions filename validation --------------------------------------------
  // Mirrors the authoritative rule in src/context-file.ts for instant feedback:
  // a bare .md filename in the vault root (no path separators, no "..").
  // Empty is allowed — the server falls back to VAULTGATE.md.
  function setContextFileError(msg) {
    contextFileError.textContent = msg;
    contextFileInput.classList.toggle("error", Boolean(msg));
    saveBtn.disabled = Boolean(msg);
  }

  function validateContextFile() {
    const value = contextFileInput.value.trim();
    if (!value) {
      setContextFileError("");
      return;
    }
    if (value.includes("/") || value.includes("\\") || value.includes("..")) {
      setContextFileError('Must be a bare filename in the vault root (no "/", "\\", or "..").');
      return;
    }
    if (!value.toLowerCase().endsWith(".md")) {
      setContextFileError("Must be a Markdown file ending in .md.");
      return;
    }
    setContextFileError("");
  }

  contextFileInput.addEventListener("input", validateContextFile);

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
    // validateContextFile first, then validatePort — validatePort runs last and
    // sets the final saveBtn.disabled state, so guard on both errors explicitly.
    validateContextFile();
    const contextFileInvalid = Boolean(contextFileError.textContent);
    await validatePort();
    if (saveBtn.disabled || contextFileInvalid) {
      // Re-assert disabled in case validatePort cleared it while the filename
      // is still invalid.
      saveBtn.disabled = true;
      return;
    }

    const port = Number.parseInt(portInput.value, 10);
    const patch = {
      vault: vaultSelect.value,
      port: Number.isFinite(port) ? port : config.port,
      obsidianPath: obsidianInput.value,
      contextFileName: contextFileInput.value.trim() || "VAULTGATE.md",
    };
    await api.setAutostart(autostartInput.checked);
    await api.saveConfig(patch);
    api.close();
  });

  // Cancel ---------------------------------------------------------------------
  cancelBtn.addEventListener("click", () => api.close());
})();
