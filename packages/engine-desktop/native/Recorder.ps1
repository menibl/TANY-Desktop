<#
.SYNOPSIS
  Records a desktop-app routine via Windows UI Automation, mirroring
  engine-web's Playwright-codegen recorder but for native Win32/WPF/WinForms
  apps instead of a browser (spec section 4/11's desktop engine).

.DESCRIPTION
  Launches -ExePath (recorded as step 0, a "launch" step - the desktop
  equivalent of engine-web's implicit goto-to-startUrl), then installs a
  low-level mouse hook (WH_MOUSE_LL) so every left-click's screen
  coordinates can be resolved to the UI Automation element under the
  cursor via AutomationElement.FromPoint. Clicks on non-editable elements
  (buttons, menu items, checkboxes...) are recorded immediately as "click"
  steps. Clicks that land on an editable element (anything supporting
  ValuePattern) are held pending instead - the field's final value is only
  read and recorded as a single "fill" step once focus moves elsewhere
  (another click, or recording stops), so typing a whole value doesn't
  turn into dozens of per-keystroke steps.

  A small always-on-top window with a "stop recording" button ends the
  session (the desktop equivalent of closing the Playwright Inspector
  window) - closing it unhooks the mouse hook, flushes any pending fill,
  and writes the final Step[] as JSON to -OutFile.

  UNVERIFIED ON A REAL WINDOWS MACHINE - see
  packages/engine-desktop/README.md. This was written and reviewed but
  has no automated test coverage (no Windows/UIA available in the dev
  sandbox); expect to need to debug it against a real target app.

.PARAMETER ExePath
  Path to the application to launch and record.

.PARAMETER OutFile
  Where to write the resulting Step[] JSON once recording stops.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ExePath,
  [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing

# ---- Low-level mouse hook. Needs a real Win32 message loop pumping on the
# same thread that installed the hook (provided below by $form.ShowDialog()),
# or the hook callback never fires - this is a hard OS requirement for
# WH_MOUSE_LL, not a bug if it seems to do nothing without it. ----
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class TanyMouseHook {
    public delegate void ClickHandler(int x, int y);
    public static event ClickHandler OnLeftClick;

    private delegate IntPtr LowLevelProc(int nCode, IntPtr wParam, IntPtr lParam);
    private static LowLevelProc _proc = HookCallback;
    private static IntPtr _hookId = IntPtr.Zero;

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int x; public int y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSLLHOOKSTRUCT {
        public POINT pt;
        public uint mouseData;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    private const int WH_MOUSE_LL = 14;
    private const int WM_LBUTTONDOWN = 0x0201;

    public static void Start() {
        if (_hookId != IntPtr.Zero) return;
        using (var curProcess = System.Diagnostics.Process.GetCurrentProcess())
        using (var curModule = curProcess.MainModule) {
            _hookId = SetWindowsHookEx(WH_MOUSE_LL, _proc, GetModuleHandle(curModule.ModuleName), 0);
        }
    }

    public static void Stop() {
        if (_hookId != IntPtr.Zero) {
            UnhookWindowsHookEx(_hookId);
            _hookId = IntPtr.Zero;
        }
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0 && wParam == (IntPtr)WM_LBUTTONDOWN) {
            var hookStruct = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
            var handler = OnLeftClick;
            if (handler != null) handler(hookStruct.pt.x, hookStruct.pt.y);
        }
        return CallNextHookEx(_hookId, nCode, wParam, lParam);
    }

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);
}
"@

function Get-UiaSelectorObject($element) {
  if ($null -eq $element) { return $null }
  $sel = [ordered]@{}
  if ($element.Current.AutomationId) { $sel.automationId = $element.Current.AutomationId }
  if ($element.Current.Name) { $sel.name = $element.Current.Name }
  $sel.controlType = ($element.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '')
  if ($element.Current.ClassName) { $sel.className = $element.Current.ClassName }

  # No AutomationId (common in older Win32/MFC apps) - fall back to also
  # pinning down the immediate parent, so a generic name like "OK" doesn't
  # match the wrong dialog's OK button elsewhere in the app.
  if (-not $sel.automationId) {
    try {
      $parent = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($element)
      if ($parent -and $parent.Current.NativeWindowHandle -ne 0) {
        $anc = [ordered]@{}
        if ($parent.Current.AutomationId) { $anc.automationId = $parent.Current.AutomationId }
        if ($parent.Current.Name) { $anc.name = $parent.Current.Name }
        $anc.controlType = ($parent.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '')
        $sel.ancestor = $anc
      }
    } catch {
      # Best-effort only - a missing ancestor just means a slightly less
      # specific selector, not a fatal recording error.
    }
  }
  return $sel
}

function Test-IsEditableElement($element) {
  $pattern = $null
  try {
    return [bool]$element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)
  } catch {
    return $false
  }
}

$script:steps = New-Object System.Collections.Generic.List[object]
$script:pendingEditable = $null

function Flush-PendingFill {
  if ($null -ne $script:pendingEditable) {
    $text = ""
    $pattern = $null
    try {
      if ($script:pendingEditable.element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
        $text = $pattern.Current.Value
      }
    } catch {
      # Element may have gone away (dialog closed) between the click and now -
      # nothing useful to record in that case.
    }
    $script:steps.Add([ordered]@{
      index        = $script:steps.Count
      type         = "fill"
      selectorKind = "uia"
      selector     = ($script:pendingEditable.selector | ConvertTo-Json -Compress -Depth 5)
      value        = $text
    })
    Write-Host "[recorder] fill captured: $text"
    $script:pendingEditable = $null
  }
}

Write-Host "[recorder] launching $ExePath ..."
Start-Process -FilePath $ExePath | Out-Null
Start-Sleep -Seconds 2
$script:steps.Add([ordered]@{ index = 0; type = "launch"; url = $ExePath })

$clickHandler = {
  param($x, $y)
  try {
    $point = New-Object System.Windows.Point($x, $y)
    $element = [System.Windows.Automation.AutomationElement]::FromPoint($point)
    if ($null -eq $element) { return }

    if (Test-IsEditableElement $element) {
      if ($script:pendingEditable -and -not $script:pendingEditable.element.Equals($element)) {
        Flush-PendingFill
      }
      if (-not $script:pendingEditable -or -not $script:pendingEditable.element.Equals($element)) {
        $script:pendingEditable = @{ element = $element; selector = (Get-UiaSelectorObject $element) }
      }
      return
    }

    Flush-PendingFill
    $selector = Get-UiaSelectorObject $element
    $script:steps.Add([ordered]@{
      index        = $script:steps.Count
      type         = "click"
      selectorKind = "uia"
      selector     = ($selector | ConvertTo-Json -Compress -Depth 5)
    })
    Write-Host "[recorder] click captured: $($selector | ConvertTo-Json -Compress)"
  } catch {
    Write-Host "[recorder] click handling error (ignored, recording continues): $_"
  }
}
[TanyMouseHook]::add_OnLeftClick($clickHandler)
[TanyMouseHook]::Start()

$form = New-Object System.Windows.Forms.Form
$form.Text = "TANY DESKTOP - מקליט..."
$form.TopMost = $true
$form.Width = 340
$form.Height = 110
$form.FormBorderStyle = "FixedToolWindow"
$form.StartPosition = "Manual"
$form.Location = New-Object System.Drawing.Point(20, 20)
$button = New-Object System.Windows.Forms.Button
$button.Text = "סיימתי - עצור הקלטה"
$button.Dock = "Fill"
$button.Font = New-Object System.Drawing.Font("Segoe UI", 12)
$button.Add_Click({ $form.Close() })
$form.Controls.Add($button)
Write-Host "[recorder] recording - perform the task in the app, then click 'סיימתי' to stop."
[void]$form.ShowDialog()

[TanyMouseHook]::Stop()
Flush-PendingFill

# -InputObject (not the pipeline) is required here: piping a single-element
# collection into ConvertTo-Json unwraps it to a bare object instead of a
# one-element array, which would silently break JSON.parse(...) as Step[]
# on the Node side for any recording with just one step.
$json = ConvertTo-Json -InputObject $script:steps -Depth 10
# Set-Content -Encoding UTF8 always prepends a BOM on Windows PowerShell
# 5.1 (unlike PowerShell 7+) - Node's JSON.parse doesn't strip a leading
# BOM character and throws "Unexpected token" on it. Write BOM-less UTF-8
# explicitly instead.
[System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "[recorder] recorded $($script:steps.Count) step(s), written to $OutFile"
