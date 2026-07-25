<#
.SYNOPSIS
  Downloads the official frpc.exe (frp tunnel client) build and places it
  where TANY DESKTOP expects it, so the embedded tunnel (spec section 13.1)
  can be started. Not vendored in this repo on purpose - same reasoning as
  Playwright fetching its own browser at install time: a binary that will
  run with the service's privileges should come from the upstream project's
  own signed release, fetched fresh, not committed into source control.

.PARAMETER Version
  frp release to fetch. Pinned by default to a version this project has
  been tested against (see docs/TANY_INTEGRATION.md).

.PARAMETER Destination
  Where to place frpc.exe. Defaults to the same path
  packages/shared/src/config.ts computes (getFrpcBinaryPath):
  %ProgramData%\TanyDesktop\bin\frpc.exe - override both here and via
  TANY_DESKTOP_FRPC_PATH if you use a custom data dir.
#>
[CmdletBinding()]
param(
  [string]$Version = "0.70.1",
  [string]$Destination = (Join-Path $env:PROGRAMDATA "TanyDesktop\bin\frpc.exe")
)

$ErrorActionPreference = "Stop"

$arch = if ([Environment]::Is64BitOperatingSystem) { "amd64" } else { "386" }
$archiveName = "frp_${Version}_windows_$arch.zip"
$url = "https://github.com/fatedier/frp/releases/download/v$Version/$archiveName"

$destDir = Split-Path -Parent $Destination
New-Item -ItemType Directory -Force -Path $destDir | Out-Null

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "tany-desktop-frp-$(Get-Random)"
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
$zipPath = Join-Path $tempDir $archiveName

Write-Host "Downloading $url ..."
Invoke-WebRequest -Uri $url -OutFile $zipPath

Write-Host "Extracting..."
Expand-Archive -Path $zipPath -DestinationPath $tempDir -Force

$extracted = Get-ChildItem -Path $tempDir -Recurse -Filter "frpc.exe" | Select-Object -First 1
if (-not $extracted) {
  throw "frpc.exe not found inside $archiveName - archive layout may have changed upstream."
}

Copy-Item -Path $extracted.FullName -Destination $Destination -Force
Remove-Item -Recurse -Force $tempDir

Write-Host "frpc.exe installed at $Destination"
Write-Host "Set these environment variables (e.g. in the Scheduled Task, see install-scheduled-task.ps1) to enable the tunnel:"
Write-Host "  TANY_DESKTOP_FRPS_ADDR, TANY_DESKTOP_FRPS_PORT, TANY_DESKTOP_FRPS_TOKEN, TANY_DESKTOP_FRP_REMOTE_PORT"
Write-Host "  TANY_CLOUD_REGISTER_URL (once TANY cloud's registration endpoint exists - see docs/TANY_INTEGRATION.md)"
