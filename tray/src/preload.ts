/**
 * Preload script for the Preferences window.
 *
 * Exposes a narrow IPC surface to the renderer through `contextBridge` —
 * the renderer never gets direct Node access. All operations are ipc.invoke
 * round-trips handled by `prefs-window.ts` in the main process.
 */

import { contextBridge, ipcRenderer } from "electron";

export interface PrefsBridge {
  loadConfig: () => Promise<unknown>;
  saveConfig: (patch: Record<string, unknown>) => Promise<void>;
  listVaults: () => Promise<Array<{ name: string; path: string }>>;
  detectObsidianPath: () => Promise<string>;
  pickObsidianPath: () => Promise<string | undefined>;
  isAutostartEnabled: () => Promise<boolean>;
  setAutostart: (enabled: boolean) => Promise<void>;
  close: () => void;
}

const bridge: PrefsBridge = {
  loadConfig: () => ipcRenderer.invoke("prefs:loadConfig"),
  saveConfig: (patch) => ipcRenderer.invoke("prefs:saveConfig", patch),
  listVaults: () => ipcRenderer.invoke("prefs:listVaults"),
  detectObsidianPath: () => ipcRenderer.invoke("prefs:detectObsidianPath"),
  pickObsidianPath: () => ipcRenderer.invoke("prefs:pickObsidianPath"),
  isAutostartEnabled: () => ipcRenderer.invoke("prefs:isAutostartEnabled"),
  setAutostart: (enabled) => ipcRenderer.invoke("prefs:setAutostart", enabled),
  close: () => ipcRenderer.send("prefs:close"),
};

contextBridge.exposeInMainWorld("vaultgate", bridge);
