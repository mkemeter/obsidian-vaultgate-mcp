#!/usr/bin/env bash
set -euo pipefail

echo "Uninstalling VaultGate..."
echo ""

PLIST="$HOME/Library/LaunchAgents/com.obsidian-vaultgate-mcp.plist"
SERVICE="$HOME/.config/systemd/user/obsidian-vaultgate-mcp.service"
CACHE_DIR="$HOME/.cache/obsidian-vaultgate-mcp"

# --- Stop and remove auto-start -------------------------------------------
if [ -f "$PLIST" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm "$PLIST"
  echo "  ✓ launchd agent removed."
fi

if [ -f "$SERVICE" ]; then
  systemctl --user disable --now obsidian-vaultgate-mcp 2>/dev/null || true
  rm "$SERVICE"
  systemctl --user daemon-reload
  echo "  ✓ systemd service removed."
fi

# --- Remove npm package (deletes this script's directory) -----------------
npm uninstall -g obsidian-vaultgate-mcp
echo "  ✓ Package removed."

# --- Remove embedding cache -----------------------------------------------
if [ -d "$CACHE_DIR" ]; then
  rm -rf "$CACHE_DIR"
  echo "  ✓ Embedding cache removed."
fi

echo ""
echo "VaultGate has been uninstalled."
