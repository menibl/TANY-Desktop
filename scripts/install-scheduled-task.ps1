<#
.SYNOPSIS
  Installs the TANY DESKTOP background service (MCP server + automation
  engines) as a Windows Scheduled Task that starts automatically with the
  computer and keeps running whether a user is logged on or not - per spec
  section 9 ("שירות רקע (Auto-start)").

.DESCRIPTION
  Uses a Scheduled Task rather than a classic Windows Service because the
  "Run whether user is logged on or not" logon type only exists on Scheduled
  Tasks, and is exactly the behaviour the spec asks for. This still runs
  the process with Admin rights (RunLevel Highest).

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

.EXAMPLE
  Run from an elevated PowerShell prompt:
    .\install-scheduled-task.ps1
  You'll be prompted for the credentials of the Windows account the task
  should run as (needed for "run whether user is logged on or not").
#>
[CmdletBinding()]
param(
  [string]$RepoPath = (Split-Path -Parent $PSScriptRoot),
  [string]$NodePath = (Get-Command node -ErrorAction SilentlyContinue).Source,
  [string]$TaskName = "TANYDesktopService"
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

Write-Host "Registering scheduled task '$TaskName'..."
Write-Host "  node:  $NodePath"
Write-Host "  entry: $entryScript"

$credential = Get-Credential -Message "Windows account TANY DESKTOP should run as (needs to stay valid - required for 'run whether user is logged on or not')"

$action = New-ScheduledTaskAction -Execute $NodePath -Argument "`"$entryScript`"" -WorkingDirectory $RepoPath
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

$principal = New-ScheduledTaskPrincipal `
  -UserId $credential.UserName `
  -LogonType Password `
  -RunLevel Highest

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -User $credential.UserName `
  -Password $credential.GetNetworkCredential().Password `
  -Force | Out-Null

Write-Host "Installed. Starting it now..."
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2
Get-ScheduledTaskInfo -TaskName $TaskName | Format-List

Write-Host "Done. Check http://127.0.0.1:8765/health once the task is running."
