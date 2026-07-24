import type { RoutineDefinition, RunRoutineResult, CredentialPayload } from "./types";

/**
 * Common contract both automation engines (web/Playwright, desktop/Power
 * Automate Desktop) implement, so mcp-server and the GUI can drive either
 * one the same way based on Routine.type (spec section 4).
 */
export interface RoutineEngine {
  readonly type: "web" | "desktop";

  /** Start (or resume, if a token belongs to this engine) a routine run. */
  run(
    definition: RoutineDefinition,
    credential: CredentialPayload | undefined,
    requestedBy?: string
  ): Promise<RunRoutineResult>;

  /** Continue a run paused at otp_injection with the code the user supplied. */
  submitOtp(continuationToken: string, otpCode: string): Promise<RunRoutineResult>;
}
