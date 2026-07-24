import type { RoutineEngine, RoutineDefinition, RunRoutineResult, CredentialPayload } from "@tany-desktop/shared";
import { runWebRoutine, submitOtpForWebRoutine } from "./player";

export class WebEngine implements RoutineEngine {
  readonly type = "web" as const;

  run(
    definition: RoutineDefinition,
    credential: CredentialPayload | undefined,
    requestedBy?: string
  ): Promise<RunRoutineResult> {
    return runWebRoutine(definition, credential, requestedBy);
  }

  submitOtp(continuationToken: string, otpCode: string): Promise<RunRoutineResult> {
    return submitOtpForWebRoutine(continuationToken, otpCode);
  }
}
