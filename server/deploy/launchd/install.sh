#!/usr/bin/env bash
# install.sh — installs obsidian-vaultgate-mcp as a macOS launchd agent.
#
# What this script does:
#   1. Detects the absolute path to node (works with nvm, Homebrew, system Node)
#   2. Detects the absolute path to the obsidian-vaultgate-mcp binary
#   3. Detects the absolute path to the obsidian CLI binary
#   4. Prompts for your vault name
#   5. Fills in the plist template and copies it to ~/Library/LaunchAgents/
#   6. Loads the agent via launchctl
#
# After installation: obsidian-vaultgate-mcp starts automatically at every login
# on port 3002 (or your configured port).

set -euo pipefail

PLIST_NAME="com.obsidian-vaultgate-mcp.plist"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/$PLIST_NAME.template"
DEST="$LAUNCH_AGENTS_DIR/$PLIST_NAME"

echo "=== obsidian-vaultgate-mcp launchd installer ==="
echo ""

# --- Detect Node.js path -------------------------------------------------------
# Use process.execPath (not `which node`) so nvm and Homebrew users get the
# correct absolute path even if their shell alias differs from the launchd env.
NODE_PATH=$(node -e "console.log(process.execPath)" 2>/dev/null)
if [[ -z "$NODE_PATH" ]]; then
  echo "ERROR: Could not find Node.js. Make sure Node.js is installed and on PATH."
  exit 1
fi
echo "Node.js:         $NODE_PATH"

# --- Detect obsidian-vaultgate-mcp binary -------------------------------------------
MCP_PATH=$(which obsidian-vaultgate-mcp 2>/dev/null || true)
if [[ -z "$MCP_PATH" ]]; then
  # Try npm global bin
  NPM_BIN=$(npm bin -g 2>/dev/null || true)
  if [[ -n "$NPM_BIN" && -x "$NPM_BIN/obsidian-vaultgate-mcp" ]]; then
    MCP_PATH="$NPM_BIN/obsidian-vaultgate-mcp"
  fi
fi
if [[ -z "$MCP_PATH" ]]; then
  echo "ERROR: obsidian-vaultgate-mcp binary not found."
  echo "  Run: npm install -g obsidian-vaultgate-mcp"
  exit 1
fi
# Resolve the actual script path (the bin entry is a JS file, not a shell wrapper)
MCP_SCRIPT=$(node -e "const fs=require('fs'); const p='$MCP_PATH'; try { const t=fs.readlinkSync(p); console.log(require('path').resolve(require('path').dirname(p),t)); } catch { console.log(p); }")
echo "obsidian-vaultgate-mcp: $MCP_SCRIPT"

# --- Detect obsidian CLI binary ------------------------------------------------
OBSIDIAN_DEFAULT="/Applications/Obsidian.app/Contents/MacOS/obsidian"
OBSIDIAN_PATH=""

if [[ -x "$OBSIDIAN_DEFAULT" ]]; then
  OBSIDIAN_PATH="$OBSIDIAN_DEFAULT"
else
  OBSIDIAN_PATH=$(which obsidian 2>/dev/null || true)
fi

if [[ -z "$OBSIDIAN_PATH" ]]; then
  echo "WARNING: Could not auto-detect the obsidian binary."
  echo "  Common location: /Applications/Obsidian.app/Contents/MacOS/obsidian"
  read -rp "  Enter the absolute path to your obsidian binary: " OBSIDIAN_PATH
fi
echo "obsidian binary: $OBSIDIAN_PATH"

# --- Vault name ----------------------------------------------------------------
echo ""
read -rp "Vault name (leave blank to use last focused vault): " VAULT_NAME

# --- Fill template -------------------------------------------------------------
mkdir -p "$LAUNCH_AGENTS_DIR"

SED_ARGS=(
  -e "s|__NODE_PATH__|$NODE_PATH|g"
  -e "s|__OBSIDIAN_CLI_MCP_PATH__|$MCP_SCRIPT|g"
  -e "s|__OBSIDIAN_CLI_PATH__|$OBSIDIAN_PATH|g"
  -e "s|__YOUR_VAULT_NAME__|$VAULT_NAME|g"
)

sed "${SED_ARGS[@]}" "$TEMPLATE" > "$DEST"

echo "Plist written to: $DEST"

# --- Load agent ----------------------------------------------------------------
# Unload first in case it was previously installed (ignore errors)
launchctl unload "$DEST" 2>/dev/null || true
launchctl load "$DEST"

echo ""
echo "✓ obsidian-vaultgate-mcp launchd agent installed and started."
echo ""
echo "  MCP URL:       http://127.0.0.1:3002/mcp"
echo "  Check status:  launchctl list | grep obsidian-vaultgate-mcp"
echo "  View logs:     tail -f /tmp/obsidian-vaultgate-mcp.log"
echo "  View errors:   tail -f /tmp/obsidian-vaultgate-mcp.err"
echo ""
echo "  Obsidian is NOT auto-launched at login — the health check only"
echo "  verifies the binary exists. Tool calls will fail gracefully if"
echo "  Obsidian is not running when they are invoked."
