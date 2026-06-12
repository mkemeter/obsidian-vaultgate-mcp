$ErrorActionPreference = "Stop"
Write-Host "=== obsidian-vaultgate-mcp Windows installer ===" -ForegroundColor Cyan
Write-Host ""

# --- Detect Node.js path (resolves nvm-windows, portable Node, etc.) ------
try {
    $nodePath = (node -e "process.stdout.write(process.execPath)" 2>$null)
} catch {
    Write-Error "Node.js not found. Install Node.js and re-run."; exit 1
}
Write-Host "Node.js:         $nodePath"

# --- Detect obsidian-vaultgate-mcp package --------------------------------
$pkgRoot = (npm root -g 2>$null)
$mcpScript = "$pkgRoot\obsidian-vaultgate-mcp\build\index.js"
if (-not (Test-Path $mcpScript)) {
    Write-Error "Package not found at $mcpScript`nRun: npm install -g obsidian-vaultgate-mcp"
    exit 1
}
Write-Host "Package script:  $mcpScript"

# --- Detect Obsidian binary -----------------------------------------------
$obsidianDefault = "$env:LOCALAPPDATA\Obsidian\Obsidian.exe"
if (Test-Path $obsidianDefault) {
    $obsidianPath = $obsidianDefault
} else {
    $obsidianPath = Read-Host "Enter the absolute path to Obsidian.exe"
}
Write-Host "Obsidian:        $obsidianPath"

# --- Vault name -----------------------------------------------------------
Write-Host ""
$vaultName = Read-Host "Vault name (leave blank to use last focused vault)"

# --- Write wrapper .cmd (env vars + quoted paths, safe for spaces) --------
$wrapperDir  = "$env:APPDATA\VaultGate"
$wrapperPath = "$wrapperDir\start.cmd"
New-Item -ItemType Directory -Force -Path $wrapperDir | Out-Null

$cmd  = "@echo off`r`n"
$cmd += "set OBSIDIAN_MCP_TRANSPORT=http`r`n"
$cmd += "set OBSIDIAN_CLI_PATH=$obsidianPath`r`n"
if ($vaultName) { $cmd += "set OBSIDIAN_VAULT=$vaultName`r`n" }
$cmd += "`"$nodePath`" `"$mcpScript`"`r`n"
Set-Content -Path $wrapperPath -Value $cmd -Encoding ASCII

Write-Host "Wrapper written: $wrapperPath"

# --- Register scheduled task (at login, current user, no elevation) -------
$action   = New-ScheduledTaskAction -Execute $wrapperPath
$trigger  = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 `
              -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName "VaultGate" -Action $action `
  -Trigger $trigger -Settings $settings -RunLevel Limited -Force | Out-Null

Write-Host ""
Write-Host "✓ VaultGate will start automatically at login." -ForegroundColor Green
Write-Host "  MCP URL:      http://127.0.0.1:3001/mcp"
Write-Host "  Start now:    Start-ScheduledTask -TaskName VaultGate"
Write-Host "  Check status: Get-ScheduledTask -TaskName VaultGate"
