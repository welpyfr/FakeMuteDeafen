# FakeMuteDeafen installer for Equicord (Windows)
#
# Installs the plugin as an ADDITIONAL userplugin: clones Equicord's source,
# adds the plugin folder next to any other userplugins, builds it and patches
# Discord Stable with the result. Re-run the script to update the plugin.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File install.ps1
#   powershell -ExecutionPolicy Bypass -File install.ps1 -EquicordDir "D:\Equicord"
#
# Prefer the ready-made zip from GitHub Releases if you don't want to build.

param(
    [string]$EquicordDir = "$env:USERPROFILE\Equicord"
)

$ErrorActionPreference = "Stop"
$PluginRepo = "https://github.com/welpyfr/FakeMuteDeafen.git"
$PluginDirName = "fakeMuteDeafen"

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Die($m)  { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }
function Invoke-Git {
    git @args
    if ($LASTEXITCODE -ne 0) { Die "git $($args -join ' ') failed" }
}

Step "Checking prerequisites"
foreach ($tool in "git", "node") {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Die "$tool is not installed. Install it and run the script again.`n      git:  https://git-scm.com/downloads`n      node: https://nodejs.org/"
    }
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "pnpm not found, enabling via corepack..."
    corepack enable
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        Die "pnpm could not be enabled. Install it manually: npm install -g pnpm"
    }
}

Step "Getting Equicord source ($EquicordDir)"
if (Test-Path (Join-Path $EquicordDir ".git")) {
    Write-Host "Existing clone found, pulling latest changes..."
    Invoke-Git -C $EquicordDir pull --recurse-submodules
} else {
    Invoke-Git clone --recurse-submodules https://github.com/Equicord/Equicord.git $EquicordDir
}

Step "Adding the plugin as a userplugin"
$target = Join-Path $EquicordDir "src\userplugins\$PluginDirName"
if (Test-Path (Join-Path $target ".git")) {
    Write-Host "Existing plugin found, pulling latest version..."
    Invoke-Git -C $target pull
} else {
    if (Test-Path $target) { Remove-Item -Recurse -Force $target }
    Invoke-Git clone $PluginRepo $target
}

Push-Location $EquicordDir
try {
    Step "Installing dependencies (may take a few minutes)"
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { Die "pnpm install failed" }

    Step "Building Equicord (may take a few minutes)"
    pnpm build
    if ($LASTEXITCODE -ne 0) { Die "build failed" }

    Step "Patching Discord"
    if (Get-Process "Discord" -ErrorAction SilentlyContinue) {
        Write-Host "Discord is running. Close it fully (tray icon -> Quit), then press Enter."
        Read-Host "Press Enter when Discord is closed"
    }
    pnpm inject
    if ($LASTEXITCODE -ne 0) { Die "inject failed" }
} finally {
    Pop-Location
}

Write-Host @"

Done! Start Discord, then:
  1. Settings -> Plugins -> enable FakeMuteDeafen
  2. Fully restart Discord once more (required - the panel buttons appear after it)

To update the plugin later, just run this script again.
"@ -ForegroundColor Green
