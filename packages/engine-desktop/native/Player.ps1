<#
.SYNOPSIS
  Replays a desktop-app routine recorded by Recorder.ps1 (spec section 4/11
  desktop engine) - the UI Automation equivalent of engine-web's player.ts.

.DESCRIPTION
  Reads a {definition, credential, fromStep, outputs, otpCode} JSON blob
  from -InputFile, executes RoutineDefinition.steps starting at fromStep,
  and writes a single JSON result object to -OutputFile:
    - {status:"success", result:{...}}
    - {status:"awaiting_otp", pausedAtStep, promptHint, outputsSoFar}
    - {status:"failed", failed_step, reason, message}

  Deliberately stateless/one-shot rather than a long-lived process: instead
  of keeping a live object graph across a paused OTP wait (which is how
  engine-web keeps a Playwright browser/page alive in memory), this script
  just exits after every run/pause and gets re-invoked fresh to resume -
  the target app's own window is re-found by process name each time via
  Find-MainWindow. That works here (and doesn't for a browser) because a
  UI Automation window handle can be re-acquired from nothing but the
  process name, with no equivalent of Playwright's in-process browser
  handle to lose. See engine-desktop/src/player.ts for the Node-side
  continuation_token bookkeeping this relies on.

  UNVERIFIED ON A REAL WINDOWS MACHINE - see
  packages/engine-desktop/README.md.

.PARAMETER InputFile
  Path to the input JSON (written by the Node caller).

.PARAMETER OutputFile
  Path to write the result JSON to.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InputFile,
  [Parameter(Mandatory = $true)][string]$OutputFile
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class TanyMouseSim {
    [DllImport("user32.dll")]
    private static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
    private const uint MOUSEEVENTF_LEFTDOWN = 0x02;
    private const uint MOUSEEVENTF_LEFTUP = 0x04;

    public static void Click() {
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
    }
}
"@

function Find-MainWindow($processName) {
  if (-not $processName) { return $null }
  $procs = Get-Process -Name $processName -ErrorAction SilentlyContinue
  foreach ($p in $procs) {
    if ($p.MainWindowHandle -ne [IntPtr]::Zero) {
      try {
        return [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
      } catch {
        continue
      }
    }
  }
  return $null
}

function Find-UiaElement($root, $selectorJson) {
  if ($null -eq $root -or -not $selectorJson) { return $null }
  $sel = $selectorJson | ConvertFrom-Json

  $conditions = New-Object System.Collections.Generic.List[System.Windows.Automation.Condition]
  if ($sel.automationId) {
    $conditions.Add((New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $sel.automationId)))
  } else {
    if ($sel.name) {
      $conditions.Add((New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty, $sel.name)))
    }
    if ($sel.controlType) {
      try {
        $ctValue = [System.Windows.Automation.ControlType]::$($sel.controlType)
        if ($ctValue) {
          $conditions.Add((New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ctValue)))
        }
      } catch {
        # Unknown/unsupported ControlType name - skip that condition rather
        # than fail the whole lookup over it.
      }
    }
  }
  if ($conditions.Count -eq 0) { return $null }
  $condition = if ($conditions.Count -eq 1) { $conditions[0] } else { New-Object System.Windows.Automation.AndCondition($conditions.ToArray()) }

  $searchRoot = $root
  if ($sel.ancestor -and $sel.ancestor.automationId) {
    $ancestorCond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $sel.ancestor.automationId)
    $ancestorEl = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $ancestorCond)
    if ($ancestorEl) { $searchRoot = $ancestorEl }
  }

  return $searchRoot.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

function Wait-UiaElement($root, $selectorJson, $timeoutMs) {
  $deadline = (Get-Date).AddMilliseconds($timeoutMs)
  do {
    $el = Find-UiaElement $root $selectorJson
    if ($el) { return $el }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)
  return $null
}

function Invoke-ElementAction($element) {
  $pattern = $null
  if ($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
    $pattern.Invoke(); return
  }
  if ($element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {
    $pattern.Toggle(); return
  }
  if ($element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
    $pattern.Select(); return
  }
  if ($element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)) {
    $pattern.Expand(); return
  }
  # No suitable pattern (some custom controls expose none) - fall back to a
  # real synthetic click at the element's on-screen center, same as a human.
  $rect = $element.Current.BoundingRectangle
  $cx = [int]($rect.X + $rect.Width / 2)
  $cy = [int]($rect.Y + $rect.Height / 2)
  [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($cx, $cy)
  Start-Sleep -Milliseconds 100
  [TanyMouseSim]::Click()
}

function ConvertTo-EscapedSendKeys($text) {
  ($text -replace '([+^%~(){}])', '{$1}')
}

function Invoke-ElementFill($element, $text) {
  $pattern = $null
  if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
    $pattern.SetValue($text)
  } else {
    $element.SetFocus()
    Start-Sleep -Milliseconds 150
    [System.Windows.Forms.SendKeys]::SendWait((ConvertTo-EscapedSendKeys $text))
  }
}

function Invoke-KeyPress($key) {
  $map = @{ "Enter" = "{ENTER}"; "Tab" = "{TAB}"; "Escape" = "{ESC}" }
  $sendKey = if ($map.ContainsKey($key)) { $map[$key] } else { $key }
  [System.Windows.Forms.SendKeys]::SendWait($sendKey)
}

# ---- Load input ----
$inputData = Get-Content $InputFile -Raw -Encoding UTF8 | ConvertFrom-Json
$definition = $inputData.definition
$credential = $inputData.credential
$fromStep = [int]$inputData.fromStep
$otpCode = $inputData.otpCode

$outputs = @{}
if ($inputData.outputs) {
  $inputData.outputs.PSObject.Properties | ForEach-Object { $outputs[$_.Name] = $_.Value }
}

$processName = if ($definition.startUrl) { [System.IO.Path]::GetFileNameWithoutExtension($definition.startUrl) } else { $null }
$mainWindow = $null
$result = $null

try {
  for ($i = $fromStep; $i -lt $definition.steps.Count; $i++) {
    $step = $definition.steps[$i]

    if ($step.type -eq "launch") {
      Write-Host "[player] launching $($step.url)..."
      Start-Process -FilePath $step.url | Out-Null
      Start-Sleep -Seconds 2
      $mainWindow = Find-MainWindow $processName
      continue
    }

    if ($null -eq $mainWindow) {
      $mainWindow = Find-MainWindow $processName
      if ($null -eq $mainWindow) {
        $result = @{
          status      = "failed"
          failed_step = $i
          reason      = "window_not_found"
          message     = "לא נמצא חלון פתוח עבור '$processName' - ודאו שהתוכנה עדיין פתוחה."
        }
        break
      }
    }

    if ($step.type -eq "otp_injection") {
      if ($otpCode) {
        $target = if ($step.selectorKind -eq "uia" -and $step.selector) { Wait-UiaElement $mainWindow $step.selector 10000 } else { $null }
        if ($target) { Invoke-ElementFill $target $otpCode }
        else { [System.Windows.Forms.SendKeys]::SendWait((ConvertTo-EscapedSendKeys $otpCode)) }
        Start-Sleep -Milliseconds 300
        continue
      } else {
        $result = @{
          status     = "awaiting_otp"
          pausedAtStep = $i
          promptHint = if ($step.promptHint) { $step.promptHint } else { "קוד אימות" }
        }
        break
      }
    }

    $element = $null
    if ($step.selectorKind -eq "uia" -and $step.selector) {
      $element = Wait-UiaElement $mainWindow $step.selector 20000
      if ($null -eq $element) {
        $result = @{
          status      = "failed"
          failed_step = $i
          reason      = "element_not_found"
          message     = "האלמנט לא נמצא (ייתכן שהחלון/הדיאלוג לא במצב הצפוי)."
        }
        break
      }
    }

    switch ($step.type) {
      "click" { Invoke-ElementAction $element }
      "fill" {
        $text = if ($step.credentialField) { $credential.($step.credentialField) } else { $step.value }
        if ($step.credentialField -and $null -eq $text) {
          $result = @{
            status      = "failed"
            failed_step = $i
            reason      = "missing_credential"
            message     = "חסר ערך אחסון עבור שדה '$($step.credentialField)'"
          }
        } else {
          Invoke-ElementFill $element $text
        }
      }
      "press" { Invoke-KeyPress $step.key }
      "waitForSelector" { } # presence already confirmed by Wait-UiaElement above
      "extract" {
        $val = $null
        $p = $null
        if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {
          $val = $p.Current.Value
        } else {
          $val = $element.Current.Name
        }
        $key = if ($step.extractAs) { $step.extractAs } else { "field_$i" }
        $outputs[$key] = $val
      }
    }

    if ($result) { break }
    Start-Sleep -Milliseconds 300
  }

  if ($null -eq $result) {
    $result = @{ status = "success"; result = $outputs }
  } elseif ($result.status -eq "awaiting_otp") {
    $result.outputsSoFar = $outputs
  }
} catch {
  $result = @{ status = "failed"; failed_step = -1; reason = "automation_error"; message = "$_" }
}

# Set-Content -Encoding UTF8 always prepends a BOM on Windows PowerShell
# 5.1 (unlike PowerShell 7+) - Node's JSON.parse doesn't strip a leading
# BOM character and throws "Unexpected token" on it. Write BOM-less UTF-8
# explicitly instead (see Recorder.ps1's matching fix).
$resultJson = $result | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($OutputFile, $resultJson, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "[player] done: $($result.status)"
