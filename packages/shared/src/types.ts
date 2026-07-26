// Data model per spec section 15, and MCP protocol shapes per section 14.

export type RoutineType = "web" | "desktop";

/**
 * A Playwright browser context's saved cookies + localStorage (its
 * `storageState()` output). Sites that gate login behind an identity
 * provider (e.g. "Sign in with Google") reject automated/WebDriver-flagged
 * browsers outright, so the login itself can't be recorded/replayed like a
 * normal step - instead the user logs in once, we persist the resulting
 * session here (encrypted, same as Credential), and future recordings/runs
 * start already-authenticated instead of hitting that block.
 */
export interface AuthState {
  cookies: Array<Record<string, unknown>>;
  origins: Array<Record<string, unknown>>;
}

export type StepType =
  | "goto"
  | "click"
  | "fill"
  | "press"
  | "select"
  | "waitForSelector"
  | "extract"
  | "otp_injection"
  | "launch";

export type SelectorKind =
  | "role"
  | "css"
  | "text"
  | "label"
  | "testId"
  | "placeholder"
  | "altText"
  | "title"
  | "uia";

/**
 * A desktop-app element selector (spec section 4's desktop engine), captured
 * via Windows UI Automation instead of a browser DOM selector. Mirrors the
 * "identify elements, not pixels" principle from engine-web: `automationId`
 * is preferred when the app sets one (most reliable, survives window
 * resize/theme/DPI changes); `name`+`controlType`(+`className`) are the
 * fallback for apps that don't. `ancestor` disambiguates when multiple
 * elements share the same name/controlType (e.g. several toolbar buttons),
 * by additionally requiring a matching parent - kept shallow (one level)
 * since deep chains get brittle fast, same trade-off `role`+`name` makes
 * for web instead of a full CSS path. Serialized as the JSON string stored
 * in `Step.selector` when `selectorKind === "uia"`.
 */
export interface UiaSelector {
  automationId?: string;
  name?: string;
  controlType?: string;
  className?: string;
  ancestor?: {
    automationId?: string;
    name?: string;
    controlType?: string;
  };
}

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
  /** For selectorKind "uia": a JSON-serialized UiaSelector, not a raw string selector. */
  selector?: string;
  role?: string;
  name?: string;
  value?: string;
  credentialField?: string;
  key?: string;
  /** For "goto": the URL to open. For "launch" (desktop): the .exe path to start. */
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
  /** For type "web": the start URL. For type "desktop": the target app's .exe path. */
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

/**
 * Returned when `run_routine` was called with a free-text `query` (not a
 * known `routine_id`) and no local trigger matched it - distinct from
 * "failed" because this isn't an error, it's a normal "I didn't recognize
 * that" outcome TANY can reflect to the user or ask a follow-up about.
 */
export interface RunNoMatchResult {
  status: "no_match";
  message: string;
}

export type RunRoutineResult =
  | RunSuccessResult
  | RunAwaitingOtpResult
  | RunFailedResult
  | RunNoMatchResult;

export interface RunRoutineArgs {
  /** Exact known routine id. Provide this OR `query`, not neither. */
  routine_id?: string;
  /**
   * Free-text phrase from the user (spec section 20 alternative: instead of
   * TANY matching against a synced trigger cache, TANY DESKTOP matches
   * against its own local RoutineTrigger table and returns `no_match` if
   * nothing fits).
   */
  query?: string;
  requested_by?: string;
}

export interface SubmitOtpArgs {
  continuation_token: string;
  otp_code: string;
}
