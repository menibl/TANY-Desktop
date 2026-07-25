// Data model per spec section 15, and MCP protocol shapes per section 14.

export type RoutineType = "web" | "desktop";

export type StepType =
  | "goto"
  | "click"
  | "fill"
  | "press"
  | "select"
  | "waitForSelector"
  | "extract"
  | "otp_injection";

export type SelectorKind =
  | "role"
  | "css"
  | "text"
  | "label"
  | "testId"
  | "placeholder"
  | "altText"
  | "title";

/**
 * A single recorded action. `value` is a literal for plain fill/press steps.
 * When a fill step was marked as a credential field during recording, `value`
 * is omitted and `credentialField` names the field to pull from the routine's
 * decrypted Credential payload at run time - so secrets never sit in the
 * routine script itself. `otp_injection` steps never carry a value at all;
 * the code is streamed in live via submit_otp (spec section 5 / 8).
 */
export interface Step {
  index: number;
  type: StepType;
  selectorKind?: SelectorKind;
  selector?: string;
  role?: string;
  name?: string;
  value?: string;
  credentialField?: string;
  key?: string;
  url?: string;
  /** For "extract" steps: the output field name this step's text populates. */
  extractAs?: string;
  /** For "otp_injection" steps: hint shown to the user when OTP is requested. */
  promptHint?: string;
}

export interface RoutineDefinition {
  routineId: string;
  name: string;
  type: RoutineType;
  createdAt: string;
  updatedAt: string;
  startUrl?: string;
  steps: Step[];
  /** Names of output fields the routine promises to return on success. */
  outputFields: string[];
}

export interface RoutineRecord {
  routineId: string;
  name: string;
  type: RoutineType;
  createdAt: string;
  updatedAt: string;
  scriptRef: string; // path to the routine's JSON definition on disk
}

export interface RoutineTriggerRecord {
  routineId: string;
  phrase: string;
}

export interface CredentialPayload {
  [field: string]: string;
}

export interface CredentialRecord {
  credentialId: string;
  routineId: string;
  /** Decrypted only in memory; persisted encrypted (see crypto.ts). */
  payload: CredentialPayload;
}

export type RunStatus = "success" | "failed" | "awaiting_otp" | "running";

export interface RunLogRecord {
  runId: string;
  routineId: string;
  requestId?: string;
  status: RunStatus;
  failedStep?: number;
  reason?: string;
  message?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface DeviceRecord {
  deviceId: string;
  deviceName: string;
  apiKey: string;
  pairedAt: string;
}

// ---- MCP protocol result shapes (spec section 14) ----

export interface RunSuccessResult {
  status: "success";
  result: Record<string, unknown>;
}

export interface RunAwaitingOtpResult {
  status: "awaiting_otp";
  continuation_token: string;
  prompt_hint: string;
}

export interface RunFailedResult {
  status: "failed";
  failed_step: number;
  reason: string;
  message: string;
}

export type RunRoutineResult =
  | RunSuccessResult
  | RunAwaitingOtpResult
  | RunFailedResult;

export interface RunRoutineArgs {
  routine_id: string;
  requested_by?: string;
}

export interface SubmitOtpArgs {
  continuation_token: string;
  otp_code: string;
}
