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
  const injectConventionsInput = document.getElementById("inject-conventions");
  const injectIntervalRow = document.getElementById("inject-interval-row");
  const injectIntervalInput = document.getElementById("inject-interval");
  const injectIntervalError = document.getElementById("inject-interval-error");
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
  injectConventionsInput.checked = config.injectConventions ?? true;
  injectIntervalInput.value = String(config.injectIntervalSecs ?? 30);
  injectIntervalRow.style.display = injectConventionsInput.checked ? "" : "none";
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

  // Injection settings ---------------------------------------------------------
  function setIntervalError(msg) {
    injectIntervalError.textContent = msg;
    injectIntervalInput.classList.toggle("error", Boolean(msg));
    saveBtn.disabled = Boolean(msg);
  }

  function validateInterval() {
    if (!injectConventionsInput.checked) {
      setIntervalError("");
      return;
    }
    const value = Number.parseInt(injectIntervalInput.value, 10);
    if (!Number.isFinite(value) || value < 1 || value > 3600) {
      setIntervalError("Must be between 1 and 3600 seconds.");
    } else {
      setIntervalError("");
    }
  }

  injectConventionsInput.addEventListener("change", () => {
    injectIntervalRow.style.display = injectConventionsInput.checked ? "" : "none";
    validateInterval();
  });

  injectIntervalInput.addEventListener("input", validateInterval);

  // Run initial validation
  await validatePort();
  validateInterval();

  // Browse for Obsidian path ---------------------------------------------------
  browseBtn.addEventListener("click", async () => {
    const picked = await api.pickObsidianPath();
    if (picked) obsidianInput.value = picked;
  });

  // Save -----------------------------------------------------------------------
  saveBtn.addEventListener("click", async () => {
    validateContextFile();
    validateInterval();
    const contextFileInvalid = Boolean(contextFileError.textContent);
    const intervalInvalid = Boolean(injectIntervalError.textContent);
    await validatePort();
    if (saveBtn.disabled || contextFileInvalid || intervalInvalid) {
      saveBtn.disabled = true;
      return;
    }

    const port = Number.parseInt(portInput.value, 10);
    const injectIntervalSecs = Number.parseInt(injectIntervalInput.value, 10);
    const patch = {
      vault: vaultSelect.value,
      port: Number.isFinite(port) ? port : config.port,
      obsidianPath: obsidianInput.value,
      contextFileName: contextFileInput.value.trim() || "VAULTGATE.md",
      injectConventions: injectConventionsInput.checked,
      injectIntervalSecs: Number.isFinite(injectIntervalSecs) ? injectIntervalSecs : 30,
    };
    await api.setAutostart(autostartInput.checked);
    await api.saveConfig(patch);
    api.close();
  });

  // Cancel ---------------------------------------------------------------------
  cancelBtn.addEventListener("click", () => api.close());
})();
