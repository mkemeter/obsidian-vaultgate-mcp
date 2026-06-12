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

The service starts obsidian-vaultgate-mcp at login and keeps it running. The startup
health check runs `obsidian help` — if Obsidian isn't already open, this will
**auto-launch Obsidian**. This means:

> **Obsidian will open automatically at every login** when this service is installed.

This is intentional for daily-use setups where you want your AI assistant
ready the moment you sit down. If you prefer to start obsidian-vaultgate-mcp
manually instead, skip the systemd install and run:

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
