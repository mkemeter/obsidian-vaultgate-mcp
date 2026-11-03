param(
    [string]$ObsidianPath,
    [string]$VaultName,
    [string]$PackagePath,
    [switch]$SkipNodeInstall,
    [switch]$SkipGitInstall,
    [switch]$NonInteractive
)
$ErrorActionPreference   = 'Stop'
$ProgressPreference      = 'SilentlyContinue'
$env:npm_config_loglevel = 'error'

Write-Host '=== obsidian-vaultgate-mcp Windows installer ===' -ForegroundColor Cyan
Write-Host ''

# Returns the Node.js major version number (int), or 0 if node is absent.
function Get-NodeMajor {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $cmd) { return 0 }
    try {
        $v = & ($cmd.Source) --version 2>&1
        if ("$v" -match '^v(\d+)') { return [int]$Matches[1] }
    } catch {
        return 0
    }
    return 0
}

# Re-reads Machine + User PATH from the registry into the current session so
# binaries installed by winget or an MSI are visible without a new terminal.
function Invoke-PathRefresh {
    $machine  = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine')
    $user     = [System.Environment]::GetEnvironmentVariable('PATH', 'User')
    $env:PATH = "$machine;$user"
}

# --- Phase 1: Node.js (LTS, >= 18) -----------------------------------------
if (-not $SkipNodeInstall) {
    $major = Get-NodeMajor
    if ($major -ge 18) {
        Write-Host "  [OK] Node.js v$major already installed." -ForegroundColor Green
    } else {
        Write-Host '  Node.js >= 18 not found. Installing via winget...' -ForegroundColor Cyan
        $wingetOk = $false
        try {
            & winget install OpenJS.NodeJS.LTS --silent `
                --accept-package-agreements --accept-source-agreements
            $wingetOk = ($LASTEXITCODE -eq 0)
        } catch {
            $wingetOk = $false
        }

        if (-not $wingetOk) {
            Write-Host '  winget unavailable; downloading Node.js v20 MSI...' -ForegroundColor Yellow
            $msiUrl  = 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi'
            $msiPath = Join-Path $env:TEMP 'node-vaultgate-installer.msi'
            Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing
            $msiProc = Start-Process msiexec.exe `
                -ArgumentList @('/quiet', '/i', $msiPath) -Wait -PassThru
            Remove-Item $msiPath -Force -ErrorAction SilentlyContinue
            if ($msiProc.ExitCode -notin @(0, 3010)) {
                Write-Error "Node.js MSI install failed (exit code $($msiProc.ExitCode))."
                exit 1
            }
        }

        Invoke-PathRefresh
        $major = Get-NodeMajor
        if ($major -lt 18) {
            Write-Error 'Node.js installation failed. Install manually: https://nodejs.org/en/download'
            exit 1
        }
        Write-Host "  [OK] Node.js v$major installed." -ForegroundColor Green
    }
}

# --- Phase 2: Git -----------------------------------------------------------
if (-not $SkipGitInstall) {
    if (Get-Command git -ErrorAction SilentlyContinue) {
        Write-Host '  [OK] Git already installed.' -ForegroundColor Green
    } else {
        Write-Host '  Git not found. Installing via winget...' -ForegroundColor Cyan
        $wingetOk = $false
        try {
            & winget install Git.Git --silent `
                --accept-package-agreements --accept-source-agreements
            $wingetOk = ($LASTEXITCODE -eq 0)
        } catch {
            $wingetOk = $false
        }

        if (-not $wingetOk) {
            Write-Error 'Git installation failed. Install manually: https://git-scm.com/download/win'
            exit 1
        }

        Invoke-PathRefresh
        if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
            Write-Error 'Git not found after install. Open a new terminal and re-run.'
            exit 1
        }
        Write-Host '  [OK] Git installed.' -ForegroundColor Green
    }
}

# --- Phase 3: npm package ---------------------------------------------------
$pkgRoot   = (npm root -g 2>$null)
$mcpScript = "$pkgRoot\obsidian-vaultgate-mcp\build\index.js"
if (Test-Path $mcpScript) {
    Write-Host '  [OK] Package already installed.' -ForegroundColor Green
} else {
    $installTarget = if ($PackagePath) { $PackagePath } else { 'obsidian-vaultgate-mcp' }
    Write-Host "  Installing $installTarget..." -ForegroundColor Cyan
    & npm install -g $installTarget
    if ($LASTEXITCODE -ne 0) {
        Write-Error "npm install failed (exit code $LASTEXITCODE)."
        exit 1
    }
    Invoke-PathRefresh
    $pkgRoot   = (npm root -g 2>$null)
    $mcpScript = "$pkgRoot\obsidian-vaultgate-mcp\build\index.js"
    if (-not (Test-Path $mcpScript)) {
        Write-Error "Package not found at $mcpScript after install."
        exit 1
    }
    Write-Host '  [OK] Package installed.' -ForegroundColor Green
}
Write-Host ''

# --- Detect Node.js path (resolves nvm-windows, portable Node, etc.) --------
try {
    $nodePath = (node -e "process.stdout.write(process.execPath)" 2>$null)
} catch {
    Write-Error 'Node.js not found. Install Node.js and re-run.'; exit 1
}
Write-Host "Node.js:         $nodePath"
Write-Host "Package script:  $mcpScript"

# --- Detect Obsidian binary -------------------------------------------------
# Precedence: (1) -ObsidianPath param, (2) known install locations, (3) prompt.
if ($ObsidianPath) {
    if (-not (Test-Path $ObsidianPath -PathType Leaf)) {
        Write-Error "Obsidian.exe not found at '$ObsidianPath'. Pass a valid file path."
        exit 1
    }
    $obsidianPath = $ObsidianPath
} else {
    # Probe the known per-user and system-wide install locations. Each candidate
    # is tested with -PathType Leaf so a directory never passes as the binary.
    # The standard NSIS per-user install lives under \Programs\ -- check it first.
    $obsidianCandidates = @(
        "$env:LOCALAPPDATA\Programs\Obsidian\Obsidian.exe",
        "$env:LOCALAPPDATA\Obsidian\Obsidian.exe",
        "$env:PROGRAMFILES\Obsidian\Obsidian.exe"
    )
    $obsidianPath = $obsidianCandidates | Where-Object { Test-Path $_ -PathType Leaf } | Select-Object -First 1

    if (-not $obsidianPath) {
        if ($NonInteractive) {
            Write-Error 'Obsidian.exe not found in standard locations. Pass -ObsidianPath <path> to specify it.'
            exit 1
        }
        # Fall back to an interactive prompt, re-validating until a real file is given.
        $attempts = 0
        while ($true) {
            $entered = (Read-Host 'Enter the absolute path to Obsidian.exe (the file, not the folder)').Trim()
            if (Test-Path $entered -PathType Leaf) {
                $obsidianPath = $entered
                break
            }
            $attempts++
            Write-Host "  Not a file: '$entered'" -ForegroundColor Yellow
            if ($attempts -ge 3) {
                Write-Error 'Could not locate Obsidian.exe after 3 attempts. Re-run the installer with a valid path.'
                exit 1
            }
        }
    }
}
Write-Host "Obsidian:        $obsidianPath"

# --- Vault name -------------------------------------------------------------
# Precedence: (1) -VaultName param (even if blank -- blank omits OBSIDIAN_VAULT),
# (2) -NonInteractive -> blank (omit vault), (3) interactive prompt.
Write-Host ''
if ($PSBoundParameters.ContainsKey('VaultName')) {
    $vaultName = $VaultName
} elseif ($NonInteractive) {
    $vaultName = ''
} else {
    $vaultName = (Read-Host 'Vault name (leave blank to use last focused vault)').Trim()
}

# --- Write wrapper .cmd (env vars + quoted values, safe for spaces and &^%) -
# The autostart instance is pinned to port 3002 (mirrors the launchd installer)
# so a manual instance on the default 3001 never clashes with the login task.
$wrapperDir  = "$env:APPDATA\VaultGate"
$wrapperPath = "$wrapperDir\start.cmd"
New-Item -ItemType Directory -Force -Path $wrapperDir | Out-Null

$cmd  = "@echo off`r`n"
$cmd += "set OBSIDIAN_MCP_TRANSPORT=http`r`n"
$cmd += "set OBSIDIAN_MCP_PORT=3002`r`n"
$cmd += "set ""OBSIDIAN_CLI_PATH=$obsidianPath""`r`n"
if ($vaultName) { $cmd += "set ""OBSIDIAN_VAULT=$vaultName""`r`n" }
$cmd += '"' + $nodePath + '" "' + $mcpScript + '"' + "`r`n"
Set-Content -Path $wrapperPath -Value $cmd -Encoding ASCII

Write-Host "Wrapper written: $wrapperPath"

# --- Register scheduled task (at login, current user, no elevation) ---------
$action = New-ScheduledTaskAction -Execute $wrapperPath
$trigger = New-ScheduledTaskTrigger -AtLogOn
# StopIfGoingOnBatteries is absent on Windows Server editions (no batteries).
# Use splatting so the setting is applied on Desktop but skipped on Server.
$settingsArgs = @{
    ExecutionTimeLimit  = 0
    RestartCount        = 3
    RestartInterval     = (New-TimeSpan -Minutes 1)
    DisallowDemandStart = $false
}
if ((Get-Command New-ScheduledTaskSettingsSet).Parameters.ContainsKey('StopIfGoingOnBatteries')) {
    $settingsArgs['StopIfGoingOnBatteries'] = $false
}
$settings = New-ScheduledTaskSettingsSet @settingsArgs

Register-ScheduledTask -TaskName 'VaultGate MCP Server' -Action $action `
  -Trigger $trigger -Settings $settings -RunLevel Limited -Force | Out-Null

Write-Host ''
Write-Host '[OK] VaultGate will start automatically at login.' -ForegroundColor Green
Write-Host '  MCP URL:      http://127.0.0.1:3002/mcp'
Write-Host "  Start now:    Start-ScheduledTask -TaskName 'VaultGate MCP Server'"
Write-Host "  Check status: Get-ScheduledTask -TaskName 'VaultGate MCP Server'"
