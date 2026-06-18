# macOS Auto-start with launchd

This directory contains a launchd agent that starts `obsidian-vaultgate-mcp` automatically at login.

## Quick install

```bash
bash "$(npm root -g)/obsidian-vaultgate-mcp/deploy/install.sh"
```

The install script will:
1. Auto-detect your Node.js binary (works with nvm, Homebrew, and system Node)
2. Auto-detect the `obsidian-vaultgate-mcp` script path
3. Auto-detect the `obsidian` CLI binary path
4. Prompt for your vault name
5. Install and load the launchd agent

## What "auto-start" means in practice

The agent starts obsidian-vaultgate-mcp at login and keeps it running. The server
starts silently in the background — it does **not** open Obsidian. The startup health
check only verifies that the Obsidian CLI binary exists on disk.

Obsidian is contacted the first time a client connects and invokes a tool. If Obsidian
is not running at that point, the CLI will launch it. If you prefer Obsidian not to
open automatically at all, start obsidian-vaultgate-mcp manually instead of using
the launchd agent:

```bash
OBSIDIAN_VAULT="My Vault" obsidian-vaultgate-mcp
```

## Why absolute paths matter

launchd does not inherit your shell's `PATH`. The install script uses
`node -e "console.log(process.execPath)"` (not `which node`) to find the
correct Node.js binary — this works correctly whether you use nvm, Homebrew,
or the system Node.js.

## Managing the agent

```bash
# Check if running
launchctl list | grep obsidian-vaultgate-mcp

# View stdout log
tail -f /tmp/obsidian-vaultgate-mcp.log

# View error log
tail -f /tmp/obsidian-vaultgate-mcp.err

# Stop (survives restart)
launchctl unload ~/Library/LaunchAgents/com.obsidian-vaultgate-mcp.plist

# Restart
launchctl load ~/Library/LaunchAgents/com.obsidian-vaultgate-mcp.plist

# Uninstall completely
launchctl unload ~/Library/LaunchAgents/com.obsidian-vaultgate-mcp.plist
rm ~/Library/LaunchAgents/com.obsidian-vaultgate-mcp.plist
```

## Changing configuration

Edit `~/Library/LaunchAgents/com.obsidian-vaultgate-mcp.plist` directly, then
reload:

```bash
launchctl unload ~/Library/LaunchAgents/com.obsidian-vaultgate-mcp.plist
launchctl load ~/Library/LaunchAgents/com.obsidian-vaultgate-mcp.plist
```

Or re-run `./deploy/launchd/install.sh` to regenerate from the template.
