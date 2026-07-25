import type { RoutineEngine, RoutineDefinition, RunRoutineResult, CredentialPayload, AuthState } from "@tany-desktop/shared";
import { runWebRoutine, submitOtpForWebRoutine } from "./player";

export class WebEngine implements RoutineEngine {
  readonly type = "web" as const;

  run(
    definition: RoutineDefinition,
    credential: CredentialPayload | undefined,
    requestedBy?: string,
    authState?: AuthState
  ): Promise<RunRoutineResult> {
    return runWebRoutine(definition, credential, requestedBy, authState);
  }

  submitOtp(continuationToken: string, otpCode: string): Promise<RunRoutineResult> {
    return submitOtpForWebRoutine(continuationToken, otpCode);
  }
}
