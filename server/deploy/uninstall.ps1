Write-Host "Uninstalling VaultGate..." -ForegroundColor Cyan

# --- Remove scheduled task ------------------------------------------------
$task = Get-ScheduledTask -TaskName "VaultGate" -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName "VaultGate" -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Unregister-ScheduledTask -TaskName "VaultGate" -Confirm:$false
    Write-Host "  ✓ Scheduled task stopped and removed." -ForegroundColor Green
}

# --- Remove wrapper .cmd --------------------------------------------------
$wrapperDir = "$env:APPDATA\VaultGate"
if (Test-Path $wrapperDir) {
    Remove-Item -Recurse -Force $wrapperDir
    Write-Host "  ✓ Startup wrapper removed." -ForegroundColor Green
}

# --- Remove npm package ---------------------------------------------------
npm uninstall -g obsidian-vaultgate-mcp
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Package removed." -ForegroundColor Green
} else {
    Write-Host "  ⚠ npm uninstall exited with code $LASTEXITCODE — check manually." -ForegroundColor Yellow
}

# --- Remove embedding cache -----------------------------------------------
$cacheDir = "$env:USERPROFILE\.cache\obsidian-vaultgate-mcp"
if (Test-Path $cacheDir) {
    Remove-Item -Recurse -Force $cacheDir
    Write-Host "  ✓ Embedding cache removed." -ForegroundColor Green
}

Write-Host "`nVaultGate has been uninstalled." -ForegroundColor Cyan
