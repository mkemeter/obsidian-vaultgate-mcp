#
# Pester 5 unit tests for install.ps1 helper functions.
# Run via windows-e2e CI job on windows-latest (Pester 5 pre-installed).
# Tests define helpers inline to avoid executing the bootstrapper's main body.
#

BeforeAll {
    # Mirror Get-NodeMajor from install.ps1 so the function is testable in isolation.
    function Get-NodeMajor {
        $cmd = Get-Command node -ErrorAction SilentlyContinue
        if (-not $cmd) { return 0 }
        try {
            $v = & ($cmd.Source) --version 2>&1
            if ("$v" -match '^v(\d+)') { return [int]$Matches[1] }
        } catch {}
        return 0
    }

    # Mirror Invoke-PathRefresh from install.ps1.
    function Invoke-PathRefresh {
        $machine  = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine')
        $user     = [System.Environment]::GetEnvironmentVariable('PATH', 'User')
        $env:PATH = "$machine;$user"
    }
}

Describe 'Get-NodeMajor' {
    It 'returns 0 when node is not on PATH' {
        Mock -CommandName Get-Command -MockWith { return $null } `
            -ParameterFilter { $Name -eq 'node' }
        Get-NodeMajor | Should -Be 0
    }

    It 'returns correct major version by parsing node --version output' {
        # Create a fake node.cmd that echoes a fixed version string.
        $fakeDir = Join-Path $TestDrive 'fakenode'
        New-Item -ItemType Directory -Path $fakeDir -Force | Out-Null
        Set-Content -Path (Join-Path $fakeDir 'node.cmd') -Value '@echo v20.5.1' -Encoding ASCII

        $saved    = $env:PATH
        $env:PATH = "$fakeDir;$saved"
        try {
            Get-NodeMajor | Should -Be 20
        } finally {
            $env:PATH = $saved
        }
    }

    It 'returns 0 when node --version output is malformed' {
        $fakeDir = Join-Path $TestDrive 'badnode'
        New-Item -ItemType Directory -Path $fakeDir -Force | Out-Null
        Set-Content -Path (Join-Path $fakeDir 'node.cmd') -Value '@echo not-a-version' -Encoding ASCII

        $saved    = $env:PATH
        $env:PATH = "$fakeDir;$saved"
        try {
            Get-NodeMajor | Should -Be 0
        } finally {
            $env:PATH = $saved
        }
    }
}

Describe 'Invoke-PathRefresh' {
    It 'reflects a registry PATH addition in the current session' {
        $marker    = 'C:\VaultGateTestMarker'
        $savedUser = [System.Environment]::GetEnvironmentVariable('PATH', 'User')
        try {
            [System.Environment]::SetEnvironmentVariable(
                'PATH', "$savedUser;$marker", 'User')
            Invoke-PathRefresh
            $env:PATH | Should -Match ([regex]::Escape($marker))
        } finally {
            [System.Environment]::SetEnvironmentVariable('PATH', $savedUser, 'User')
        }
    }
}
