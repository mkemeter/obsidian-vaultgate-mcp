/**
 * Preferences window renderer logic.
 *
 * Talks to the main process exclusively through the `window.vaultgate`
 * bridge installed by `preload.ts`. No Node APIs are available here.
 */

(async () => {
  // Tab switching
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn, .tab-panel").forEach((el) => el.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
  });

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
  const homeScopeSelect = document.getElementById("home-scope");
  const homeScopeHint = document.getElementById("home-scope-hint");
  const homeScopeError = document.getElementById("home-scope-error");
  const scopeSwitchingInput = document.getElementById("scope-switching");
  const noUriInput = document.getElementById("no-uri");
  const autostartInput = document.getElementById("autostart");
  const browseBtn = document.getElementById("browse");
  const saveBtn = document.getElementById("save");
  const cancelBtn = document.getElementById("cancel");

  const [config, vaults, autostart, serverState, scopeState] = await Promise.all([
    api.loadConfig(),
    api.listVaults(),
    api.isAutostartEnabled(),
    api.getServerState(),
    api.listScopes(),
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

  // When the user picks a different vault, restore that vault's last-used scope.
  vaultSelect.addEventListener("change", () => {
    if (homeScopeSelect.disabled) return;
    const stored = config.homeScopeByVault?.[vaultSelect.value] ?? "";
    const normalized = stored === "unscoped" ? "" : stored;
    const exists = Array.from(homeScopeSelect.options).some((o) => o.value === normalized);
    homeScopeSelect.value = exists ? normalized : "";
  });

  // Port — always show the saved port; validatePort() will flag any conflict ----
  portInput.value = String(config.port);
  obsidianInput.value =
    config.obsidianPath || (await api.detectObsidianPath()) || "";
  contextFileInput.value = config.contextFileName || "VAULTGATE.md";
  injectConventionsInput.checked = config.injectConventions ?? true;
  injectIntervalInput.value = String(config.injectIntervalSecs ?? 30);
  injectIntervalRow.style.display = injectConventionsInput.checked ? "" : "none";
  homeScopeSelect.innerHTML = "";
  if (scopeState.enabled && scopeState.scopes.length > 0) {
    homeScopeSelect.disabled = false;
    if (homeScopeHint) homeScopeHint.hidden = true;
    for (const scope of scopeState.scopes) {
      const opt = document.createElement("option");
      opt.value = scope === "unscoped" ? "" : scope;
      opt.textContent = scope;
      homeScopeSelect.appendChild(opt);
    }
    const savedScope = config.homeScopeByVault?.[vaultSelect.value] ?? config.homeScope;
    homeScopeSelect.value = savedScope === "unscoped" ? "" : (savedScope || "");
  } else {
    homeScopeSelect.disabled = true;
    if (homeScopeHint) homeScopeHint.hidden = false;
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "unscoped";
    homeScopeSelect.appendChild(opt);
    homeScopeSelect.value = "";
  }
  scopeSwitchingInput.checked = Boolean(config.scopeSwitchingEnabled);
  noUriInput.checked = Boolean(config.noUri);
  autostartInput.checked = Boolean(autostart);

  // Wire server state into status indicator ------------------------------------
  const dot = document.getElementById("status-dot");
  if (dot) dot.dataset.state = serverState ?? "loading";

  // External (unmanaged) server — warn that controls won't reach it (bug 5).
  const externalWarning = document.getElementById("external-warning");
  if (externalWarning) externalWarning.hidden = serverState !== "running-external";

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
    const homeScopeValue = homeScopeSelect.value.trim();
    const homeScopeNormalized = homeScopeValue || "unscoped";
    const selectedVault = vaultSelect.value;
    const homeScopeByVault = { ...(config.homeScopeByVault ?? {}), [selectedVault]: homeScopeNormalized };
    const patch = {
      vault: selectedVault,
      port: Number.isFinite(port) ? port : config.port,
      obsidianPath: obsidianInput.value,
      contextFileName: contextFileInput.value.trim() || "VAULTGATE.md",
      injectConventions: injectConventionsInput.checked,
      injectIntervalSecs: Number.isFinite(injectIntervalSecs) ? injectIntervalSecs : 30,
      homeScope: homeScopeNormalized,
      homeScopeByVault,
      scopeSwitchingEnabled: scopeSwitchingInput.checked,
      noUri: noUriInput.checked,
    };
    await api.setAutostart(autostartInput.checked);
    await api.saveConfig(patch);
    api.close();
  });

  // Cancel ---------------------------------------------------------------------
  cancelBtn.addEventListener("click", () => api.close());
})();
