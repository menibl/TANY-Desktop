# @tany-desktop/engine-desktop

Stub implementation of the `RoutineEngine` contract for desktop-app routines
(spec section 4: "מנוע הקלטה/הרצה — דסקטופ", proposed technology: Power
Automate Desktop on Windows).

## Why this is a stub

Power Automate Desktop is closed-source, Windows-only, and has no supported
headless/CLI automation surface for Node.js to drive programmatically the
way `playwright codegen` drives a browser. Building and testing a real
integration requires an actual Windows machine with Power Automate Desktop
installed, which this development environment does not have.

## What's real vs. TODO

- **Real now:** the `RoutineEngine` interface, DB schema, MCP tool routing
  (`run_routine`/`submit_otp` for `Routine.type === "desktop"`), and GUI
  wiring already treat desktop routines as first-class - they just get a
  clear `not_implemented` failure back today.
- **Phase 2 TODO (on a real Windows box):**
  1. Record: shell out to Power Automate Desktop's flow designer to author
     a desktop flow, or investigate `PAD.Console.Host.exe` / the Power
     Automate Machine Runtime's silent run entry points for a scriptable
     path.
  2. Store: keep using `RoutineDefinition.scriptRef`, but point it at the
     exported `.msapp`/flow package instead of a step-JSON file.
  3. Replay: invoke the flow headlessly, capture its output variables into
     `RunSuccessResult.result`, and map any failure back to `failed_step`/
     `reason` the same way `engine-web`'s player does.
  4. OTP: Power Automate Desktop flows can pause on a "wait" action; the
     `continuation_token` mechanics from `engine-web` can likely be reused
     as-is once there's a way to signal the paused flow.
