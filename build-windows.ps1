[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$SkipSidecars,
    [switch]$OpenOutput
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ProjectRoot = $PSScriptRoot
$TargetTriple = "x86_64-pc-windows-msvc"
$ReleaseDirectory = Join-Path $ProjectRoot "src-tauri\target\$TargetTriple\release"
$BundleDirectory = Join-Path $ReleaseDirectory "bundle\nsis"
$script:UseCorepack = $false

function Write-Step {
    param(
        [int]$Number,
        [int]$Total,
        [string]$Message
    )

    Write-Host ""
    Write-Host "[$Number/$Total] $Message" -ForegroundColor Cyan
}

function Stop-Build {
    param([string]$Message)

    Write-Host ""
    Write-Host "BUILD FAILED: $Message" -ForegroundColor Red
    exit 1
}

function Assert-Command {
    param(
        [string]$Name,
        [string]$InstallHint
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Stop-Build "Command '$Name' was not found. $InstallHint"
    }
}

function Invoke-External {
    param(
        [string]$Command,
        [string[]]$Arguments,
        [string]$FailureMessage
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        Stop-Build "$FailureMessage (exit code: $LASTEXITCODE)"
    }
}

function Invoke-Pnpm {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

    if ($script:UseCorepack) {
        Invoke-External "corepack" (@("pnpm") + $Arguments) "pnpm command failed"
    }
    else {
        Invoke-External "pnpm" $Arguments "pnpm command failed"
    }
}

try {
    if ($env:OS -ne "Windows_NT") {
        Stop-Build "This script only builds the Windows package."
    }

    Set-Location -LiteralPath $ProjectRoot
    Write-Host "Streamnest Windows Packager" -ForegroundColor Green
    Write-Host "Project: $ProjectRoot"

    Write-Step 1 5 "Checking build tools"
    Assert-Command "node" "Install Node.js 22 LTS from https://nodejs.org/."
    Assert-Command "cargo" "Install Rust from https://rustup.rs/."
    Assert-Command "rustup" "Install Rust from https://rustup.rs/."

    $nodeVersionText = (& node --version).TrimStart("v")
    $nodeMajor = [int]($nodeVersionText.Split(".")[0])
    if ($nodeMajor -lt 20) {
        Stop-Build "Node.js 20 or newer is required. Current version: $nodeVersionText"
    }

    $rustHost = (& rustc -vV | Select-String "^host:").ToString()
    if ($rustHost -notmatch "msvc") {
        Stop-Build "The Rust MSVC toolchain is required. Run: rustup default stable-x86_64-pc-windows-msvc"
    }

    if (-not (Get-Command "pnpm" -ErrorAction SilentlyContinue)) {
        Assert-Command "corepack" "Install Node.js 22 LTS, then run: corepack enable"
        $script:UseCorepack = $true
        Write-Host "pnpm is not on PATH; using 'corepack pnpm'." -ForegroundColor Yellow
    }

    Write-Host "Node.js: $nodeVersionText"
    Write-Host "Rust: $((& rustc --version).Trim())"

    Write-Step 2 5 "Installing project dependencies"
    if ($SkipInstall) {
        Write-Host "Skipped because -SkipInstall was supplied." -ForegroundColor Yellow
    }
    else {
        Invoke-Pnpm "install" "--frozen-lockfile"
    }

    Write-Step 3 5 "Preparing yt-dlp and FFmpeg sidecars"
    if ($SkipSidecars) {
        Write-Host "Skipped because -SkipSidecars was supplied." -ForegroundColor Yellow
    }
    else {
        Invoke-Pnpm "sidecars"
    }

    Write-Step 4 5 "Installing the Windows Rust target"
    Invoke-External "rustup" @("target", "add", $TargetTriple) "Unable to install Rust target $TargetTriple"

    Write-Step 5 5 "Building the Windows application and NSIS installer"
    Invoke-Pnpm "tauri" "build" "--target" $TargetTriple

    $installer = Get-ChildItem -LiteralPath $BundleDirectory -Filter "*-setup.exe" -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    $application = Join-Path $ReleaseDirectory "streamnest.exe"

    Write-Host ""
    Write-Host "BUILD SUCCEEDED" -ForegroundColor Green
    if ($installer) {
        Write-Host "Installer: $($installer.FullName)" -ForegroundColor White
    }
    else {
        Write-Host "Installer directory: $BundleDirectory" -ForegroundColor Yellow
    }
    if (Test-Path -LiteralPath $application) {
        Write-Host "Application: $application" -ForegroundColor White
    }
    Write-Host "Note: the package is unsigned and Windows SmartScreen may show a warning." -ForegroundColor Yellow

    if ($OpenOutput -and (Test-Path -LiteralPath $BundleDirectory)) {
        Start-Process -FilePath "explorer.exe" -ArgumentList $BundleDirectory
    }
}
catch {
    Stop-Build $_.Exception.Message
}
finally {
    Set-Location -LiteralPath $ProjectRoot
}

