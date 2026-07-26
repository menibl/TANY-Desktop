import type { RoutineEngine, RoutineDefinition, RunRoutineResult, CredentialPayload } from "@tany-desktop/shared";
import { runDesktopRoutine, submitOtpForDesktopRoutine } from "./player";

export { recordDesktopRoutine } from "./recorder";

/**
 * Windows UI Automation-based implementation of the RoutineEngine contract
 * for desktop-app routines (spec section 4). Power Automate Desktop, the
 * technology the original spec proposed, turned out to be a dead end for
 * this (see git history / packages/engine-desktop/README.md): it's
 * closed-source with no headless/scriptable recording or run API, so
 * there's nothing for `run()`/`recordDesktopRoutine()` to shell out to the
 * way engine-web shells out to `playwright codegen`. UI Automation is the
 * supported, scriptable alternative that still lets selectors identify
 * elements (AutomationId/Name/ControlType) instead of screen pixels,
 * keeping the same principle spec section 2 asks for on the web side.
 *
 * The actual automation logic lives in native/Recorder.ps1 and
 * native/Player.ps1 (PowerShell, using System.Windows.Automation) - this
 * class is just the RoutineEngine adapter around them, mirroring WebEngine.
 *
 * UNVERIFIED ON A REAL WINDOWS MACHINE - written and reviewed but with no
 * automated test coverage, since UI Automation isn't available in the dev
 * sandbox this was built in. Expect a debugging pass against a real target
 * app, the same way the frpc tunnel and Scheduled Task setup needed one.
 */
export class DesktopEngine implements RoutineEngine {
  readonly type = "desktop" as const;

  run(
    definition: RoutineDefinition,
    credential: CredentialPayload | undefined
  ): Promise<RunRoutineResult> {
    return runDesktopRoutine(definition, credential);
  }

  submitOtp(continuationToken: string, otpCode: string): Promise<RunRoutineResult> {
    return submitOtpForDesktopRoutine(continuationToken, otpCode);
  }
}

export const desktopEngine = new DesktopEngine();
