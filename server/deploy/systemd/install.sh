#!/usr/bin/env bash
# install.sh — installs obsidian-vaultgate-mcp as a systemd user service on Linux.
#
# What this script does:
#   1. Detects the absolute path to node (works with nvm, volta, system Node)
#   2. Detects the absolute path to the obsidian-vaultgate-mcp package
#   3. Detects the absolute path to the obsidian CLI binary
#   4. Prompts for your vault name
#   5. Writes the service file to ~/.config/systemd/user/
#   6. Enables and starts the service
#
# After installation: obsidian-vaultgate-mcp starts automatically at every login
# on port 3001 (or your configured port).

set -euo pipefail

SERVICE_NAME="obsidian-vaultgate-mcp"
SERVICE_FILE="$HOME/.config/systemd/user/${SERVICE_NAME}.service"

echo "=== obsidian-vaultgate-mcp systemd installer ==="
echo ""

# --- Detect Node.js path -------------------------------------------------------
# Use process.execPath so nvm/volta users get the correct absolute path even if
# their shell alias differs from the systemd environment.
NODE_PATH=$(node -e "console.log(process.execPath)" 2>/dev/null || true)
if [[ -z "$NODE_PATH" ]]; then
  echo "ERROR: Could not find Node.js. Make sure Node.js is installed and on PATH."
  exit 1
fi
echo "Node.js:         $NODE_PATH"

# --- Detect obsidian-vaultgate-mcp package -------------------------------------
PKG_ROOT=$(npm root -g 2>/dev/null || true)
MCP_SCRIPT=""
if [[ -n "$PKG_ROOT" && -f "$PKG_ROOT/${SERVICE_NAME}/build/index.js" ]]; then
  MCP_SCRIPT="$PKG_ROOT/${SERVICE_NAME}/build/index.js"
fi
if [[ -z "$MCP_SCRIPT" ]]; then
  echo "ERROR: obsidian-vaultgate-mcp package not found."
  echo "  Run: npm install -g obsidian-vaultgate-mcp"
  exit 1
fi
echo "Package script:  $MCP_SCRIPT"

# --- Detect obsidian CLI binary ------------------------------------------------
OBSIDIAN_PATH=""

# Common Linux install locations
for candidate in \
  "$HOME/.local/bin/obsidian" \
  "/usr/bin/obsidian" \
  "/usr/local/bin/obsidian" \
  "$(command -v obsidian 2>/dev/null || true)"
do
  if [[ -x "$candidate" ]]; then
    OBSIDIAN_PATH="$candidate"
    break
  fi
done

if [[ -z "$OBSIDIAN_PATH" ]]; then
  echo "WARNING: Could not auto-detect the obsidian binary."
  echo "  Common locations: ~/.local/bin/obsidian, /usr/bin/obsidian"
  read -rp "  Enter the absolute path to your obsidian binary: " OBSIDIAN_PATH
fi
echo "obsidian binary: $OBSIDIAN_PATH"

# --- Vault name ----------------------------------------------------------------
echo ""
read -rp "Vault name (leave blank to use last focused vault): " VAULT_NAME

# --- Write service file --------------------------------------------------------
mkdir -p "$(dirname "$SERVICE_FILE")"

if [[ -n "$VAULT_NAME" ]]; then
  VAULT_ENV="Environment=OBSIDIAN_VAULT=${VAULT_NAME}"
else
  VAULT_ENV="# OBSIDIAN_VAULT not set — uses last focused vault"
fi

cat > "$SERVICE_FILE" << EOF
[Unit]
Description=VaultGate MCP server
After=graphical-session.target

[Service]
ExecStart=${NODE_PATH} ${MCP_SCRIPT}
Environment=OBSIDIAN_CLI_PATH=${OBSIDIAN_PATH}
${VAULT_ENV}
Environment=OBSIDIAN_MCP_TRANSPORT=http
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

echo ""
echo "Service file written to: $SERVICE_FILE"

# --- Enable and start ----------------------------------------------------------
systemctl --user daemon-reload
systemctl --user enable --now "$SERVICE_NAME"

echo ""
echo "✓ obsidian-vaultgate-mcp systemd service installed and started."
echo ""
echo "  MCP URL:       http://127.0.0.1:3001/mcp"
echo "  Check status:  systemctl --user status ${SERVICE_NAME}"
echo "  View logs:     journalctl --user -u ${SERVICE_NAME} -f"
echo ""
echo "  Obsidian is NOT auto-launched at login — the health check only"
echo "  verifies the binary exists. Tool calls will fail gracefully if"
echo "  Obsidian is not running when they are invoked."
