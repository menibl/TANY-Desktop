# @tany-desktop/engine-desktop

Windows UI Automation-based implementation of the `RoutineEngine` contract
for desktop-app routines (spec section 4: "מנוע הקלטה/הרצה — דסקטופ").

## Why UI Automation instead of Power Automate Desktop

The spec originally proposed Power Automate Desktop. That turned out to be a
dead end: PAD is closed-source, Windows-only, and has no supported
headless/scriptable recording or run API for Node.js to drive the way
`playwright codegen` drives a browser - there's nothing to shell out to.

Windows UI Automation (the same accessibility layer screen readers use) is
the supported, scriptable alternative, and keeps the same "identify
elements, not pixels" principle spec section 2 asks for on the web side:
selectors are AutomationId/Name/ControlType(/ClassName), not screen
coordinates, so a recording survives window resizes, DPI changes, and theme
changes the way a coordinate-based recorder wouldn't.

## What's here

- `native/Recorder.ps1` - launches the target `.exe`, installs a low-level
  mouse hook, resolves each click's screen coordinates to the UI Automation
  element under the cursor, and records `click`/`fill` steps. Stops when the
  user clicks a "stop recording" button in a small always-on-top window (the
  desktop equivalent of closing the Playwright Inspector window).
- `native/Player.ps1` - replays a recorded `Step[]`: re-locates each element
  by its recorded selector (via `AutomationElement.FindFirst` with a
  `PropertyCondition`), and drives it via the appropriate UIA pattern
  (`InvokePattern`/`TogglePattern`/`SelectionItemPattern`/`ValuePattern`),
  falling back to a synthetic click/`SendKeys` for elements that expose none
  of those. Stateless/one-shot rather than a long-lived process - see the
  comment at the top of `Player.ps1` for why that's fine for a UIA window
  (unlike a Playwright browser handle, which can't be re-acquired from
  nothing but a process name).
- `src/recorder.ts` / `src/player.ts` - thin Node wrappers that spawn the
  above via `child_process.spawn("powershell.exe", ...)`, exchanging state
  through temp JSON files, mirroring `engine-web`'s recorder/player shape.
- `src/index.ts` - `DesktopEngine`, the `RoutineEngine` implementation
  wiring the above into `run()`/`submitOtp()`.

## Status: implemented, but unverified on a real machine

This was written and reviewed, and everything on the Node/TypeScript side
builds and typechecks cleanly - but the actual automation logic
(`native/*.ps1`) uses `System.Windows.Automation`, `SetWindowsHookEx`, and
`SendKeys`, none of which exist in this development sandbox (Linux, no
Windows, no UI Automation). **None of it has been run against a real
target app yet.** Treat the first attempt on a real machine as a debugging
session, not a working feature - the same way the frpc tunnel and
Scheduled Task setup in this repo needed several real-machine fix rounds
before they actually worked end-to-end.

Known rough edges to expect:
- Some apps (older MFC/Win32 controls especially) may not expose an
  `AutomationId` at all, making the `name`+`controlType`+`ancestor`
  fallback selector doing more of the work than it does for modern
  WPF/UWP/Electron apps - and more prone to breaking if the app's UI text
  changes (e.g. localization).
- The synthetic-click fallback (for elements with no `InvokePattern`/etc.)
  needs the element to actually be visible/on-screen at its recorded
  bounding rectangle - covered or off-screen elements will fail.
- OTP injection targets whatever element the `otp_injection` step's own
  selector points at (if any) or the currently-focused control otherwise;
  unlike `engine-web`, there's no browser-session persistence concept to
  fall back on if the app's own window state gets lost between the pause
  and `submit_otp`.

## Desktop routine step shapes (for reference)

- `type: "launch"`, `url: "<path to .exe>"` - the desktop equivalent of
  `goto`, always step 0. `RoutineDefinition.startUrl` holds the same path.
- `selectorKind: "uia"`, `selector: "<JSON-serialized UiaSelector>"` - see
  `packages/shared/src/types.ts`'s `UiaSelector` for the shape
  (`automationId`/`name`/`controlType`/`className`/`ancestor`).
- `fill`/`press`/`extract`/`otp_injection` steps otherwise carry the same
  fields as their web counterparts (`credentialField`, `key`, `extractAs`,
  `promptHint`).
