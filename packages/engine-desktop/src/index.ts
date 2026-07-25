import type { RoutineEngine, RoutineDefinition, RunRoutineResult, CredentialPayload } from "@tany-desktop/shared";

/**
 * Power Automate Desktop is a Windows-only, closed-source automation runtime
 * (spec section 4/9). There is no public headless CLI to drive it from
 * Node.js the way Playwright drives a browser, so real integration has to
 * happen on an actual Windows machine (invoking the PAD console host /
 * exported desktop flow, per spec section 11's proposed Desktop PoC) and
 * cannot be built or tested from this sandbox.
 *
 * This stub keeps the RoutineEngine contract implemented end-to-end so the
 * MCP server, GUI, and DB layer all already handle `type: "desktop"`
 * routines correctly and just need the run()/submitOtp() bodies swapped
 * for a real PAD invocation in Phase 2.
 */
export class StubDesktopEngine implements RoutineEngine {
  readonly type = "desktop" as const;

  async run(definition: RoutineDefinition): Promise<RunRoutineResult> {
    return {
      status: "failed",
      failed_step: 0,
      reason: "not_implemented",
      message:
        `שגרת דסקטופ "${definition.name}" לא ניתנת להרצה עדיין: אינטגרציה עם Power Automate Desktop ` +
        `טרם מומשה (דורשת הרצה על Windows אמיתי). ראו packages/engine-desktop/README.md.`,
    };
  }

  async submitOtp(): Promise<RunRoutineResult> {
    return {
      status: "failed",
      failed_step: 0,
      reason: "not_implemented",
      message: "אינטגרציית Power Automate Desktop טרם מומשה.",
    };
  }
}
