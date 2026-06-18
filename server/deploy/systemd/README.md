# Linux Auto-start with systemd

This directory contains an install script that sets up `obsidian-vaultgate-mcp` as a systemd user service, starting automatically at every login.

## Quick install

```bash
bash "$(npm root -g)/obsidian-vaultgate-mcp/deploy/install.sh"
```

The install script will:
1. Auto-detect your Node.js binary (works with nvm, volta, and system Node)
2. Auto-detect the `obsidian-vaultgate-mcp` package path
3. Auto-detect the `obsidian` CLI binary path
4. Prompt for your vault name
5. Write and enable the systemd user service

## What "auto-start" means in practice

The service starts obsidian-vaultgate-mcp at login and keeps it running. The server
starts silently in the background — it does **not** open Obsidian. The startup health
check only verifies that the Obsidian CLI binary exists on disk.

Obsidian is contacted the first time a client connects and invokes a tool. If Obsidian
is not running at that point, the CLI will launch it. If you prefer Obsidian not to
open automatically at all, start obsidian-vaultgate-mcp manually instead of using
the systemd service:

```bash
OBSIDIAN_VAULT="My Vault" obsidian-vaultgate-mcp
```

## Managing the service

```bash
# Check if running
systemctl --user status obsidian-vaultgate-mcp

# View logs (live)
journalctl --user -u obsidian-vaultgate-mcp -f

# Stop (survives restart)
systemctl --user stop obsidian-vaultgate-mcp

# Restart
systemctl --user restart obsidian-vaultgate-mcp

# Uninstall completely
systemctl --user disable --now obsidian-vaultgate-mcp
rm ~/.config/systemd/user/obsidian-vaultgate-mcp.service
systemctl --user daemon-reload
```

## Changing configuration

Edit `~/.config/systemd/user/obsidian-vaultgate-mcp.service` directly, then reload:

```bash
systemctl --user daemon-reload
systemctl --user restart obsidian-vaultgate-mcp
```

Or re-run `./deploy/systemd/install.sh` to regenerate the service file from scratch.
