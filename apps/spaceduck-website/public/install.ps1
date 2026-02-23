# Spaceduck installer for Windows — installs the gateway server + CLI
# https://spaceduck.ai
#
# Usage:
#   irm https://spaceduck.ai/install.ps1 | iex
#   .\install.ps1 -Yes
#
# Env overrides (for CI):
#   SPACEDUCK_RELEASE_BASE_URL  — override download base URL
#   SPACEDUCK_VERSION           — pin version (e.g. v0.14.1)
#   SPACEDUCK_SKIP_BUN_INSTALL  — set to 1 to fail if Bun is not found

[CmdletBinding()]
param(
    [switch]$Yes,
    [string]$Version = "",
    [string]$InstallDir = "",
    [string]$BaseUrl = "",
    [switch]$NoBunInstall,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

# ── Release contract (must match scripts/release-contract.json) ───────────────
$Script:REPO = "maziarzamani/spaceduck"
$Script:ARTIFACT_GATEWAY = "spaceduck-gateway.js"
$Script:ARTIFACT_CLI = "spaceduck-cli.js"
$Script:ARTIFACT_CHECKSUMS = "checksums.txt"
$Script:ARTIFACT_MANIFEST = "manifest.json"
$Script:ARTIFACT_VERSION = "VERSION"
$Script:INSTALL_DEFAULT_DIR = ".spaceduck"
$Script:INSTALL_BIN_DIR = "bin"
$Script:INSTALL_RELEASES_DIR = "releases"
$Script:INSTALL_CURRENT_LINK = "current"
$Script:INSTALL_DATA_DIR = "data"
$Script:BUN_MIN_VERSION = "1.2.0"

# ── Helpers ───────────────────────────────────────────────────────────────────
function Write-Info  { param([string]$Msg) Write-Host "  info  " -ForegroundColor Cyan -NoNewline; Write-Host $Msg }
function Write-Ok    { param([string]$Msg) Write-Host "    ok  " -ForegroundColor Green -NoNewline; Write-Host $Msg }
function Write-Warn  { param([string]$Msg) Write-Host "  warn  " -ForegroundColor Yellow -NoNewline; Write-Host $Msg }
function Write-Err   { param([string]$Msg) Write-Host "  error " -ForegroundColor Red -NoNewline; Write-Host $Msg }
function Exit-Fatal  { param([string]$Msg) Write-Err $Msg; exit 1 }

function Show-Usage {
    Write-Host @"

  Spaceduck Installer (Windows)

  Install the Spaceduck gateway server + CLI.

  USAGE
      irm https://spaceduck.ai/install.ps1 | iex
      .\install.ps1 [OPTIONS]

  OPTIONS
      -Yes              Non-interactive mode (auto-install Bun, skip prompts)
      -Version <tag>    Install a specific version (e.g. v0.14.1)
      -InstallDir <dir> Override install directory
      -BaseUrl <url>    Override release download base URL
      -NoBunInstall     Fail if Bun is not found instead of installing it
      -Help             Show this help

  ENVIRONMENT
      SPACEDUCK_RELEASE_BASE_URL   Same as -BaseUrl
      SPACEDUCK_VERSION            Same as -Version
      SPACEDUCK_SKIP_BUN_INSTALL   Set to 1 for -NoBunInstall
"@
    exit 0
}

if ($Help) { Show-Usage }

# Apply env overrides (flags take precedence)
if (-not $BaseUrl -and $env:SPACEDUCK_RELEASE_BASE_URL) { $BaseUrl = $env:SPACEDUCK_RELEASE_BASE_URL }
if (-not $Version -and $env:SPACEDUCK_VERSION) { $Version = $env:SPACEDUCK_VERSION }
if (-not $NoBunInstall -and $env:SPACEDUCK_SKIP_BUN_INSTALL -eq "1") { $NoBunInstall = $true }

# ── Fetch helper ──────────────────────────────────────────────────────────────
function Fetch-File {
    param([string]$Url, [string]$Dest)
    $ProgressPreference = "SilentlyContinue"
    try {
        Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing -MaximumRetryCount 3
    } catch {
        Exit-Fatal "Failed to download: $Url — $_"
    }
}

function Fetch-Text {
    param([string]$Url)
    $ProgressPreference = "SilentlyContinue"
    try {
        (Invoke-WebRequest -Uri $Url -UseBasicParsing -MaximumRetryCount 3).Content
    } catch {
        $null
    }
}

# ── SHA256 verification ──────────────────────────────────────────────────────
function Verify-Checksums {
    param([string]$ChecksumsFile, [string]$Dir)
    Write-Info "Verifying checksums..."
    $lines = Get-Content $ChecksumsFile
    foreach ($line in $lines) {
        if ($line -match "^([a-f0-9]{64})\s+(.+)$") {
            $expectedHash = $Matches[1]
            $fileName = $Matches[2].Trim()
            $filePath = Join-Path $Dir $fileName
            if (-not (Test-Path $filePath)) {
                Exit-Fatal "Checksum listed file not found: $fileName"
            }
            $actualHash = (Get-FileHash -Path $filePath -Algorithm SHA256).Hash.ToLower()
            if ($actualHash -ne $expectedHash) {
                Exit-Fatal "Checksum mismatch for $fileName (expected: $expectedHash, got: $actualHash)"
            }
        }
    }
    Write-Ok "All checksums verified"
}

# ── Bun detection / install ───────────────────────────────────────────────────
$Script:BunBin = ""

function Find-Bun {
    $bun = Get-Command bun -ErrorAction SilentlyContinue
    if ($bun) {
        $Script:BunBin = $bun.Source
        return
    }
    $localBun = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
    if (Test-Path $localBun) {
        $Script:BunBin = $localBun
    }
}

function Ensure-Bun {
    Find-Bun
    if ($Script:BunBin) {
        $bunVer = & $Script:BunBin --version 2>$null
        Write-Ok "Bun found: $Script:BunBin (v$bunVer)"
        return
    }

    if ($NoBunInstall) {
        Exit-Fatal "Bun runtime not found and -NoBunInstall is set. Install Bun first: https://bun.sh"
    }

    if (-not $Yes) {
        Write-Host ""
        Write-Warn "Bun runtime is required but not found."
        $answer = Read-Host "Install Bun now? [Y/n]"
        if ($answer -match "^[nN]") {
            Exit-Fatal "Bun is required. Install it from https://bun.sh and try again."
        }
    }

    Write-Info "Installing Bun..."
    try {
        $ProgressPreference = "SilentlyContinue"
        irm bun.sh/install.ps1 | iex
    } catch {
        Exit-Fatal "Failed to install Bun: $_"
    }

    # Refresh PATH
    $bunPath = Join-Path $env:USERPROFILE ".bun\bin"
    $env:PATH = "$bunPath;$env:PATH"

    Find-Bun
    if (-not $Script:BunBin) {
        Exit-Fatal "Bun was installed but could not be found. Add ~/.bun/bin to your PATH and try again."
    }
    $bunVer = & $Script:BunBin --version 2>$null
    Write-Ok "Bun installed: $Script:BunBin (v$bunVer)"
}

# ── Version resolution ────────────────────────────────────────────────────────
function Resolve-Version {
    if ($Script:Version) {
        Write-Info "Using pinned version: $Version"
        return
    }

    Write-Info "Resolving latest version..."
    $apiUrl = "https://api.github.com/repos/$REPO/releases/latest"
    $response = Fetch-Text $apiUrl
    if (-not $response) {
        Write-Err "Failed to query GitHub API for latest release."
        Write-Err "This can happen due to rate limits or network issues."
        Exit-Fatal "Try again later or pin a version with -Version vX.Y.Z"
    }

    try {
        $json = $response | ConvertFrom-Json
        $Script:Version = $json.tag_name
    } catch {
        Exit-Fatal "Could not parse latest version from GitHub API response. Try -Version vX.Y.Z"
    }

    if (-not $Script:Version) {
        Exit-Fatal "Could not determine latest version."
    }
    Write-Ok "Latest version: $Version"
}

# ── Download release assets ───────────────────────────────────────────────────
$Script:DownloadDir = ""

function Download-Release {
    $releaseBase = if ($BaseUrl) { $BaseUrl.TrimEnd("/") } else { "https://github.com/$REPO/releases/download/$Version" }

    $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "spaceduck-install-$([System.Guid]::NewGuid().ToString('N').Substring(0,8))"
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

    Write-Info "Downloading Spaceduck $Version..."

    $assets = @($ARTIFACT_CHECKSUMS, $ARTIFACT_GATEWAY, $ARTIFACT_CLI, $ARTIFACT_MANIFEST, $ARTIFACT_VERSION)
    foreach ($asset in $assets) {
        Fetch-File "$releaseBase/$asset" (Join-Path $tmpDir $asset)
    }
    Write-Ok "Downloaded all release assets"

    Verify-Checksums (Join-Path $tmpDir $ARTIFACT_CHECKSUMS) $tmpDir
    Validate-Manifest $tmpDir

    $Script:DownloadDir = $tmpDir
}

# ── Manifest validation ──────────────────────────────────────────────────────
function Validate-Manifest {
    param([string]$Dir)
    $manifestPath = Join-Path $Dir $ARTIFACT_MANIFEST
    if (-not (Test-Path $manifestPath)) {
        Write-Warn "No manifest.json found; skipping manifest validation"
        return
    }

    Write-Info "Validating manifest..."
    try {
        $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    } catch {
        Exit-Fatal "Failed to parse manifest.json: $_"
    }

    $versionFileContent = (Get-Content (Join-Path $Dir $ARTIFACT_VERSION) -Raw).Trim()
    if ($manifest.version -ne $versionFileContent) {
        Exit-Fatal "Version mismatch: manifest.json says '$($manifest.version)' but VERSION says '$versionFileContent'"
    }

    if ($manifest.artifacts.gateway -ne $ARTIFACT_GATEWAY) {
        Exit-Fatal "Artifact name mismatch: manifest.json gateway='$($manifest.artifacts.gateway)', expected '$ARTIFACT_GATEWAY'"
    }

    if ($manifest.bun.minVersion -and $Script:BunBin) {
        $bunVer = & $Script:BunBin --version 2>$null
        if ($bunVer -and ([version]$bunVer -lt [version]$manifest.bun.minVersion)) {
            Write-Warn "Bun $bunVer may be too old (minimum: $($manifest.bun.minVersion)). Consider upgrading: bun upgrade"
        }
    }

    Write-Ok "Manifest validated"
}

# ── Install files ─────────────────────────────────────────────────────────────
function Install-Release {
    $sdHome = $Script:InstallDir
    $releasesDir = Join-Path $sdHome $INSTALL_RELEASES_DIR
    $versionDir = Join-Path $releasesDir $Version
    $currentLink = Join-Path $sdHome $INSTALL_CURRENT_LINK
    $binDir = Join-Path $sdHome $INSTALL_BIN_DIR
    $dataDir = Join-Path $sdHome $INSTALL_DATA_DIR

    New-Item -ItemType Directory -Path $versionDir -Force | Out-Null
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null

    Copy-Item (Join-Path $DownloadDir $ARTIFACT_GATEWAY) $versionDir -Force
    Copy-Item (Join-Path $DownloadDir $ARTIFACT_CLI) $versionDir -Force
    Copy-Item (Join-Path $DownloadDir $ARTIFACT_VERSION) $versionDir -Force
    Copy-Item (Join-Path $DownloadDir $ARTIFACT_MANIFEST) $versionDir -Force -ErrorAction SilentlyContinue
    Copy-Item (Join-Path $DownloadDir $ARTIFACT_CHECKSUMS) $versionDir -Force -ErrorAction SilentlyContinue

    Write-Ok "Installed to $versionDir"

    # Directory junction swap (atomic on Windows)
    if (Test-Path $currentLink) {
        $item = Get-Item $currentLink -Force
        if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            cmd /c rmdir "$currentLink" 2>$null
        } else {
            Remove-Item $currentLink -Recurse -Force
        }
    }
    cmd /c mklink /J "$currentLink" "$versionDir" | Out-Null
    Write-Ok "Activated version: $Version"

    Remove-Item $DownloadDir -Recurse -Force -ErrorAction SilentlyContinue

    Install-Wrappers $binDir $sdHome
}

# ── Wrapper scripts ───────────────────────────────────────────────────────────
function Install-Wrappers {
    param([string]$BinDir, [string]$SdHome)

    # spaceduck.cmd — works in Command Prompt and most terminals
    $cmdShim = Join-Path $BinDir "spaceduck.cmd"
    @"
@echo off
setlocal

set "SD_HOME=%USERPROFILE%\.spaceduck"
if defined SPACEDUCK_HOME set "SD_HOME=%SPACEDUCK_HOME%"

set "CLI_JS=%SD_HOME%\current\$ARTIFACT_CLI"
set "GATEWAY_JS=%SD_HOME%\current\$ARTIFACT_GATEWAY"

set "BUN_BIN=bun"
where bun >nul 2>&1 || set "BUN_BIN=%USERPROFILE%\.bun\bin\bun.exe"

if "%~1"=="gateway" goto :gateway
if "%~1"=="serve" goto :gateway
if "%~1"=="version" goto :version
if "%~1"=="--version" goto :version
if "%~1"=="-V" goto :version
goto :cli

:gateway
shift
"%BUN_BIN%" "%GATEWAY_JS%" %*
goto :eof

:version
if exist "%SD_HOME%\current\VERSION" (
    set /p VER=<"%SD_HOME%\current\VERSION"
    echo spaceduck %VER%
) else (
    echo spaceduck (version unknown^)
)
goto :eof

:cli
"%BUN_BIN%" "%CLI_JS%" %*
goto :eof
"@ | Set-Content $cmdShim -Encoding ASCII
    Write-Ok "Wrapper installed: $cmdShim"

    # spaceduck.ps1 — PowerShell wrapper
    $ps1Shim = Join-Path $BinDir "spaceduck.ps1"
    @"
`$ErrorActionPreference = "Stop"
`$SdHome = if (`$env:SPACEDUCK_HOME) { `$env:SPACEDUCK_HOME } else { Join-Path `$env:USERPROFILE ".spaceduck" }
`$CliJs = Join-Path `$SdHome "current\$ARTIFACT_CLI"
`$GatewayJs = Join-Path `$SdHome "current\$ARTIFACT_GATEWAY"
`$BunBin = if (Get-Command bun -ErrorAction SilentlyContinue) { "bun" } else { Join-Path `$env:USERPROFILE ".bun\bin\bun.exe" }

if (-not (Test-Path `$BunBin) -and -not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Error "Bun runtime not found. Re-run the installer or add ~/.bun/bin to your PATH."
    exit 1
}

`$cmd = if (`$args.Count -gt 0) { `$args[0] } else { "" }

switch (`$cmd) {
    { `$_ -in "gateway","serve" } {
        `$rest = `$args[1..(`$args.Count)]
        Push-Location `$SdHome
        & `$BunBin `$GatewayJs @rest
        Pop-Location
    }
    { `$_ -in "version","--version","-V" } {
        `$vf = Join-Path `$SdHome "current\VERSION"
        if (Test-Path `$vf) { "spaceduck `$(Get-Content `$vf -Raw)".Trim() } else { "spaceduck (version unknown)" }
    }
    default {
        & `$BunBin `$CliJs @args
    }
}
"@ | Set-Content $ps1Shim -Encoding UTF8
    Write-Ok "Wrapper installed: $ps1Shim"
}

# ── PATH configuration ────────────────────────────────────────────────────────
$Script:PathUpdated = $false

function Configure-Path {
    $binDir = Join-Path $InstallDir $INSTALL_BIN_DIR

    $currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($currentPath -split ";" | Where-Object { $_ -eq $binDir }) {
        Write-Ok "Already on PATH"
        return
    }

    $newPath = "$binDir;$currentPath"
    [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
    $env:PATH = "$binDir;$env:PATH"
    $Script:PathUpdated = $true
    Write-Ok "Added to user PATH: $binDir"
}

# ── Post-install verification ─────────────────────────────────────────────────
function Show-PostInstall {
    $binDir = Join-Path $InstallDir $INSTALL_BIN_DIR
    $env:PATH = "$binDir;$env:PATH"
    $wrapper = Join-Path $binDir "spaceduck.cmd"

    Write-Host ""
    Write-Host "  -- Spaceduck installed --" -ForegroundColor White
    Write-Host ""

    $ver = & cmd /c "$wrapper" version 2>$null
    if ($ver) { Write-Host "  $([char]0x2713) $ver" -ForegroundColor Green }
    Write-Host "  $([char]0x2713) Bun: $Script:BunBin" -ForegroundColor Green
    Write-Host "  $([char]0x2713) Install dir: $InstallDir" -ForegroundColor Green
    Write-Host "  $([char]0x2713) Data dir: $(Join-Path $InstallDir $INSTALL_DATA_DIR)" -ForegroundColor Green

    if ($PathUpdated) {
        Write-Host "  $([char]0x2713) Added to user PATH" -ForegroundColor Green
    }

    $releaseCount = (Get-ChildItem (Join-Path $InstallDir $INSTALL_RELEASES_DIR) -Directory -ErrorAction SilentlyContinue).Count
    if ($releaseCount -gt 1) {
        Write-Host ""
        Write-Host "  Existing data will be migrated automatically on next gateway start." -ForegroundColor DarkGray
    }

    Write-Host ""
    Write-Host "  Next steps:" -ForegroundColor White
    Write-Host ""
    Write-Host "    spaceduck serve    " -ForegroundColor Cyan -NoNewline; Write-Host "Start the gateway (foreground)"
    Write-Host "    spaceduck setup    " -ForegroundColor Cyan -NoNewline; Write-Host "Interactive configuration wizard"
    Write-Host "    spaceduck status   " -ForegroundColor Cyan -NoNewline; Write-Host "Check gateway health"
    Write-Host ""
    Write-Host "    Background service setup coming soon via: spaceduck service install" -ForegroundColor DarkGray

    if ($PathUpdated) {
        Write-Host ""
        Write-Host "    Restart your terminal for PATH changes to take effect." -ForegroundColor Yellow
    }
    Write-Host ""
}

# ── Main ──────────────────────────────────────────────────────────────────────
function Main {
    Write-Host ""
    Write-Host "  " -NoNewline; Write-Host "Spaceduck Installer" -ForegroundColor Cyan
    Write-Host ""

    Write-Info "Detected platform: Windows/$([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)"

    # Set install dir
    if (-not $InstallDir) {
        $Script:InstallDir = Join-Path $env:LOCALAPPDATA $INSTALL_DEFAULT_DIR
    } else {
        $Script:InstallDir = $InstallDir
    }

    Ensure-Bun
    Resolve-Version
    Download-Release
    Install-Release
    Configure-Path
    Show-PostInstall
}

Main
