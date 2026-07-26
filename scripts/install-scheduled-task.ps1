<#
.SYNOPSIS
  Installs the TANY DESKTOP background service (MCP server + automation
  engines) as a Windows Scheduled Task that starts automatically with the
  computer and keeps running whether a user is logged on or not - per spec
  section 9 ("שירות רקע (Auto-start)"). Optionally wires up the frpc tunnel
  to TANY cloud (spec section 13) in the same run.

.DESCRIPTION
  Uses a Scheduled Task rather than a classic Windows Service because the
  "Run whether user is logged on or not" logon type only exists on Scheduled
  Tasks, and is exactly the behaviour the spec asks for. This still runs
  the process with Admin rights (RunLevel Highest).

  Beyond just registering the task, this also performs everything that was
  found (the hard way, via manual troubleshooting on a real machine) to be
  required for the task to actually stay running, none of which
  Register-ScheduledTask/npm handle on their own:

  - Rebuilds the better-sqlite3 native module for plain Node's ABI. The GUI
    runs it through Electron (ELECTRON_RUN_AS_NODE), which needs a
    different native build - if that ran more recently than this script,
    the module is left compiled for Electron's ABI and a plain `node.exe`
    (what the Scheduled Task uses) fails to load it at all
    (ERR_DLOPEN_FAILED / NODE_MODULE_VERSION mismatch).
  - Grants the "Log on as a batch job" user right (SeBatchLogonRight) to
    the task's account. Register-ScheduledTask does NOT reliably grant this
    itself for freshly-created local accounts - without it, Task Scheduler
    accepts the registration but every launch fails silently at logon
    (LogonUserExEx, Win32 error 1385/ERROR_LOGON_TYPE_NOT_GRANTED) and the
    task never actually starts.
  - Grants the task's account Full Control over the data directory
    (%ProgramData%\TanyDesktop by default). This only matters if the task
    runs as a different Windows account than whoever first ran the GUI/an
    earlier manual test - that account owns the files there (DB, master
    key, frpc config) and a different account is denied access to them.
  - Points Playwright at a shared browser install under the data directory
    (PLAYWRIGHT_BROWSERS_PATH), rather than the default per-user cache
    under %LOCALAPPDATA%. Playwright's browser download is tied to
    whichever Windows account ran `npx playwright install chromium` - if
    that was done as the interactive user (e.g. via the GUI) and the task
    runs as a different account, web routines fail with "Playwright not
    installed" even though it clearly was, just for a different account.
    A shared location under the data directory (which the task's account
    already has Full Control over, from the point above) fixes that for
    any account without needing a duplicate download per account.

  NOTE (see spec section 9's "תרחיש נתמך"): UI automation - both Playwright
  (headed mode) and, once implemented, Power Automate Desktop - needs an
  actual interactive desktop session to drive visible windows. A task
  running with nobody logged in has no interactive desktop, so in practice
  this deployment target is "a dedicated computer that stays powered on and
  logged in", exactly as the spec calls out. Playwright routines that don't
  need a visible browser still work headless regardless.

.PARAMETER RepoPath
  Path to the TANY-Desktop checkout (defaults to this script's parent dir).

.PARAMETER NodePath
  Path to node.exe (defaults to whatever `node` resolves to on PATH).

.PARAMETER FrpsAddr
  Public address of the frps server (spec section 13.1). If given, this
  script sets the four TANY_DESKTOP_FRPS_*/FRP_REMOTE_PORT environment
  variables (machine-wide) and downloads frpc.exe (via get-frpc.ps1) if it
  isn't already present, so the tunnel comes up automatically once the
  task starts. Omit entirely to keep running local-only, exactly as before.

.PARAMETER FrpsPort
  frps control port. Defaults to 7000 (frp's own default).

.PARAMETER FrpsToken
  Shared auth token configured on frps. Required if -FrpsAddr is given.

.PARAMETER FrpRemotePort
  The port frps exposes this device's MCP server on. Required if -FrpsAddr
  is given.

.EXAMPLE
  Run from an elevated PowerShell prompt, local-only (no tunnel):
    .\install-scheduled-task.ps1
  You'll be prompted for the credentials of the Windows account the task
  should run as (needed for "run whether user is logged on or not").

.EXAMPLE
  With the frpc tunnel to a GCP frps wired up in the same run:
    .\install-scheduled-task.ps1 -FrpsAddr 34.165.176.172 -FrpsToken "<token>" -FrpRemotePort 6000
#>
[CmdletBinding()]
param(
  [string]$RepoPath = (Split-Path -Parent $PSScriptRoot),
  [string]$NodePath = (Get-Command node -ErrorAction SilentlyContinue).Source,
  [string]$TaskName = "TANYDesktopService",
  [string]$FrpsAddr,
  [int]$FrpsPort = 7000,
  [string]$FrpsToken,
  [int]$FrpRemotePort
)

$ErrorActionPreference = "Stop"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this script from an elevated (Administrator) PowerShell prompt."
}

if (-not $NodePath) {
  throw "node.exe not found on PATH. Install Node.js or pass -NodePath explicitly."
}

$entryScript = Join-Path $RepoPath "packages\mcp-server\dist\index.js"
if (-not (Test-Path $entryScript)) {
  throw "Build output not found at $entryScript. Run 'npm install && npm run build' in $RepoPath first."
}

if ($FrpsAddr -and (-not $FrpsToken -or -not $FrpRemotePort)) {
  throw "-FrpsToken and -FrpRemotePort are required when -FrpsAddr is given."
}

Write-Host "Registering scheduled task '$TaskName'..."
Write-Host "  node:  $NodePath"
Write-Host "  entry: $entryScript"

$credential = Get-Credential -Message "Windows account TANY DESKTOP should run as (needs to stay valid - required for 'run whether user is logged on or not')"
$accountName = $credential.UserName

# ---- Native module ABI: the Scheduled Task always runs plain node.exe,
# never Electron, regardless of what the GUI last built the module for. ----
Write-Host "Rebuilding better-sqlite3 for plain Node's ABI..."
Push-Location $RepoPath
try {
  & npm rebuild better-sqlite3
  if ($LASTEXITCODE -ne 0) {
    throw "npm rebuild better-sqlite3 failed (exit $LASTEXITCODE). Close the GUI and any other node/electron processes for this repo (they lock the native module file) and re-run this script."
  }
} finally {
  Pop-Location
}

# ---- Data directory ACL: only matters if $accountName differs from
# whoever's account already owns these files, but harmless either way. ----
$dataDir = if ($env:TANY_DESKTOP_DATA_DIR) { $env:TANY_DESKTOP_DATA_DIR } else { Join-Path $env:ProgramData "TanyDesktop" }
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
Write-Host "Granting '$accountName' full control over $dataDir..."
& icacls $dataDir /grant "${accountName}:(OI)(CI)F" /T | Out-Null

# ---- "Log on as a batch job" right: without this, Register-ScheduledTask
# succeeds but every launch fails logon silently (Win32 1385). Append to
# the existing SeBatchLogonRight list rather than overwrite it, so other
# accounts/groups already granted it (e.g. built-in Administrators) keep it.
# Must round-trip through secedit as Unicode - plain Get-Content/Set-Content
# defaults corrupt the file's declared [Unicode] encoding and secedit then
# fails the whole import with "No mapping between account names and
# security IDs was done." ----
Write-Host "Granting '$accountName' the 'Log on as a batch job' right..."
$sid = (New-Object System.Security.Principal.NTAccount($accountName)).Translate([System.Security.Principal.SecurityIdentifier]).Value
$secpolPath = Join-Path $env:TEMP "tany-desktop-secpol.cfg"
$secdbPath = Join-Path $env:TEMP "tany-desktop-secedit.sdb"
& secedit /export /cfg $secpolPath /areas USER_RIGHTS | Out-Null
$secpolContent = Get-Content $secpolPath -Encoding Unicode
if ($secpolContent -match "^\s*SeBatchLogonRight\s*=") {
  $secpolContent = $secpolContent -replace '(SeBatchLogonRight\s*=\s*)(.*)', "`$1`$2,*$sid"
} else {
  $secpolContent += "SeBatchLogonRight = *$sid"
}
$secpolContent | Set-Content $secpolPath -Encoding Unicode
& secedit /configure /db $secdbPath /cfg $secpolPath /areas USER_RIGHTS | Out-Null
Remove-Item $secpolPath, $secdbPath -ErrorAction SilentlyContinue

# ---- Shared Playwright browser location (see doc comment above for why:
# a per-user cache under %LOCALAPPDATA% means "Playwright not installed"
# errors for the task's account even when it works fine interactively). ----
$playwrightBrowsersPath = Join-Path $dataDir "ms-playwright"
Write-Host "Setting PLAYWRIGHT_BROWSERS_PATH to $playwrightBrowsersPath (machine-wide)..."
[Environment]::SetEnvironmentVariable("PLAYWRIGHT_BROWSERS_PATH", $playwrightBrowsersPath, "Machine")
$env:PLAYWRIGHT_BROWSERS_PATH = $playwrightBrowsersPath
if (-not (Test-Path (Join-Path $playwrightBrowsersPath "chromium-*"))) {
  Write-Host "Installing the Playwright Chromium browser into the shared location..."
  Push-Location $RepoPath
  try {
    & npx playwright install chromium
  } finally {
    Pop-Location
  }
}
# New folder under $dataDir - relies on the icacls grant above having been
# applied with (OI)(CI) (object/container inherit), which NTFS applies
# automatically to anything created under $dataDir afterward, including
# this one, without needing to re-run icacls here.

# ---- Optional frpc tunnel wiring ----
if ($FrpsAddr) {
  $frpcPath = Join-Path $dataDir "bin\frpc.exe"
  if (-not (Test-Path $frpcPath)) {
    Write-Host "frpc.exe not found - downloading via get-frpc.ps1..."
    & (Join-Path $PSScriptRoot "get-frpc.ps1") -Destination $frpcPath
  }
  Write-Host "Setting frpc tunnel environment variables (machine-wide)..."
  [Environment]::SetEnvironmentVariable("TANY_DESKTOP_FRPS_ADDR", $FrpsAddr, "Machine")
  [Environment]::SetEnvironmentVariable("TANY_DESKTOP_FRPS_PORT", $FrpsPort, "Machine")
  [Environment]::SetEnvironmentVariable("TANY_DESKTOP_FRPS_TOKEN", $FrpsToken, "Machine")
  [Environment]::SetEnvironmentVariable("TANY_DESKTOP_FRP_REMOTE_PORT", $FrpRemotePort, "Machine")
}

$action = New-ScheduledTaskAction -Execute $NodePath -Argument "`"$entryScript`"" -WorkingDirectory $RepoPath
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

# Note: -Principal (LogonType/RunLevel) and -User/-Password belong to two
# different Register-ScheduledTask parameter sets and cannot be combined -
# doing so throws "Parameter set cannot be resolved using the specified
# named parameters." Pass the user/password/run level directly instead.
Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -User $accountName `
  -Password $credential.GetNetworkCredential().Password `
  -RunLevel Highest `
  -Force | Out-Null

Write-Host "Installed. Starting it now..."
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 5
Get-ScheduledTaskInfo -TaskName $TaskName | Format-List

Write-Host "Checking health endpoint..."
try {
  Invoke-RestMethod http://127.0.0.1:8765/health | Format-List
} catch {
  Write-Warning "Health check failed - the task may need a few more seconds, or check Task Scheduler's history for '$TaskName'."
}

if ($FrpsAddr) {
  Write-Host "Checking frpc tunnel process..."
  Get-Process frpc -ErrorAction SilentlyContinue | Format-Table Id, ProcessName, CPU
}
