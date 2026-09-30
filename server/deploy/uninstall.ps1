Write-Host "Uninstalling VaultGate..." -ForegroundColor Cyan

# --- Remove scheduled task ------------------------------------------------
# Namespaced name (current); the legacy pre-namespacing name is cleaned up
# too so upgraders from earlier versions don't keep a stale autostart task.
foreach ($taskName in @('VaultGate MCP Server', 'VaultGate')) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Host "  [OK] Scheduled task '$taskName' stopped and removed." -ForegroundColor Green
    }
}

# --- Remove wrapper .cmd --------------------------------------------------
$wrapperDir = "$env:APPDATA\VaultGate"
if (Test-Path $wrapperDir) {
    Remove-Item -Recurse -Force $wrapperDir
    Write-Host "  [OK] Startup wrapper removed." -ForegroundColor Green
}

# --- Remove npm package ---------------------------------------------------
npm uninstall -g obsidian-vaultgate-mcp
if ($LASTEXITCODE -eq 0) {
    Write-Host "  [OK] Package removed." -ForegroundColor Green
} else {
    Write-Host "  [WARN] npm uninstall exited with code $LASTEXITCODE -- check manually." -ForegroundColor Yellow
}

# --- Remove embedding cache -----------------------------------------------
$cacheDir = "$env:USERPROFILE\.cache\obsidian-vaultgate-mcp"
if (Test-Path $cacheDir) {
    Remove-Item -Recurse -Force $cacheDir
    Write-Host "  [OK] Embedding cache removed." -ForegroundColor Green
}

Write-Host "`nVaultGate has been uninstalled." -ForegroundColor Cyan
