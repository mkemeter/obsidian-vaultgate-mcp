# macOS Auto-start with launchd

This directory contains a launchd agent that starts `obsidian-mcp-http` automatically at login.

## Quick install

```bash
cd $(npm root -g)/obsidian-mcp-http
./launchd/install.sh
```

The install script will:
1. Auto-detect your Node.js binary (works with nvm, Homebrew, and system Node)
2. Auto-detect the `obsidian-mcp-http` script path
3. Auto-detect the `obsidian` CLI binary path
4. Prompt for your vault name
5. Install and load the launchd agent

## What "auto-start" means in practice

The agent starts obsidian-mcp-http at login and keeps it running. The startup
health check runs `obsidian help` — if Obsidian isn't already open, this will
**auto-launch Obsidian**. This means:

> **Obsidian will open automatically at every login** when this agent is installed.

This is intentional for daily-use setups where you want your AI assistant
ready the moment you sit down. If you prefer to start obsidian-mcp-http
manually instead, skip the launchd install and run:

```bash
OBSIDIAN_VAULT="My Vault" obsidian-mcp-http
```

## Why absolute paths matter

launchd does not inherit your shell's `PATH`. The install script uses
`node -e "console.log(process.execPath)"` (not `which node`) to find the
correct Node.js binary — this works correctly whether you use nvm, Homebrew,
or the system Node.js.

## Managing the agent

```bash
# Check if running
launchctl list | grep obsidian-mcp-http

# View stdout log
tail -f /tmp/obsidian-mcp-http.log

# View error log
tail -f /tmp/obsidian-mcp-http.err

# Stop (survives restart)
launchctl unload ~/Library/LaunchAgents/com.obsidian-mcp-http.plist

# Restart
launchctl load ~/Library/LaunchAgents/com.obsidian-mcp-http.plist

# Uninstall completely
launchctl unload ~/Library/LaunchAgents/com.obsidian-mcp-http.plist
rm ~/Library/LaunchAgents/com.obsidian-mcp-http.plist
```

## Changing configuration

Edit `~/Library/LaunchAgents/com.obsidian-mcp-http.plist` directly, then
reload:

```bash
launchctl unload ~/Library/LaunchAgents/com.obsidian-mcp-http.plist
launchctl load ~/Library/LaunchAgents/com.obsidian-mcp-http.plist
```

Or re-run `./launchd/install.sh` to regenerate from the template.
