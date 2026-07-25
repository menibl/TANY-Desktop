import {
  listRoutines as dbListRoutines,
  getRoutine,
  deleteRoutine as dbDeleteRoutine,
  upsertRoutine,
  setTriggers,
  getTriggers,
  getLastRunForRoutine,
  listRunLogsForRoutine,
  getCredentialForRoutine,
  replaceCredential,
  saveRoutineDefinition,
  loadRoutineDefinition,
  deleteRoutineDefinition,
  startRunLog,
  finishRunLog,
  loadAuthState,
  hasAuthState,
  deleteAuthState,
  findRoutineByExactTrigger,
} from "@tany-desktop/shared";
import { generateRoutineId } from "@tany-desktop/shared";
import type { RoutineDefinition, RoutineType, Step, RunRoutineResult } from "@tany-desktop/shared";
import { resolveEngine, webEngine } from "./engines";

export interface RoutineListItem {
  routineId: string;
  name: string;
  type: RoutineType;
  updatedAt: string;
  triggers: string[];
  lastRun?: { status: string; startedAt: string; finishedAt?: string; failedStep?: number };
}

export function listRoutines(): RoutineListItem[] {
  return dbListRoutines().map((r) => ({
    routineId: r.routineId,
    name: r.name,
    type: r.type,
    updatedAt: r.updatedAt,
    triggers: getTriggers(r.routineId),
    lastRun: getLastRunForRoutine(r.routineId),
  }));
}

export function getRoutineDetail(routineId: string) {
  const routine = getRoutine(routineId);
  if (!routine) return undefined;
  const definition = loadRoutineDefinition(routine.scriptRef);
  const credential = getCredentialForRoutine(routineId);
  return {
    routine,
    definition,
    triggers: getTriggers(routineId),
    credentialFields: credential ? Object.keys(credential.payload) : [],
    runLogs: listRunLogsForRoutine(routineId),
    hasAuthState: hasAuthState(routineId),
  };
}

export interface SaveRoutineInput {
  routineId?: string;
  name: string;
  type: RoutineType;
  startUrl?: string;
  steps: Step[];
  outputFields: string[];
  triggers: string[];
  credential?: Record<string, string>;
}

export function saveRoutine(input: SaveRoutineInput): string {
  const existing = input.routineId ? getRoutine(input.routineId) : undefined;
  // input.routineId may be a draft id the GUI generated before the routine
  // was ever saved (e.g. to tie a one-time login's auth state to it before
  // the routine has a name) - honor it even when there's no existing DB row.
  const routineId = existing?.routineId ?? input.routineId ?? generateRoutineId(input.name);

  // Two routines sharing a trigger would make run_routine's free-text
  // matching (findRoutineByQuery) pick between them arbitrarily - block it
  // here instead of letting it happen silently at run time.
  for (const phrase of input.triggers) {
    const conflict = findRoutineByExactTrigger(phrase, routineId);
    if (conflict) {
      throw new Error(`הניסוח "${phrase}" כבר בשימוש בשגרה "${conflict.name}" - יש לבחור ניסוח אחר.`);
    }
  }

  const now = new Date().toISOString();

  const definition: RoutineDefinition = {
    routineId,
    name: input.name,
    type: input.type,
    createdAt: existing
      ? loadRoutineDefinition(existing.scriptRef).createdAt
      : now,
    updatedAt: now,
    startUrl: input.startUrl,
    steps: input.steps,
    outputFields: input.outputFields,
  };

  const scriptRef = saveRoutineDefinition(definition);
  upsertRoutine({
    routineId,
    name: input.name,
    type: input.type,
    createdAt: definition.createdAt,
    updatedAt: now,
    scriptRef,
  });
  setTriggers(routineId, input.triggers);
  if (input.credential && Object.keys(input.credential).length > 0) {
    replaceCredential(routineId, input.credential);
  }
  return routineId;
}

export function deleteRoutine(routineId: string): void {
  const routine = getRoutine(routineId);
  if (routine) deleteRoutineDefinition(routine.scriptRef);
  deleteAuthState(routineId);
  dbDeleteRoutine(routineId);
}

// continuation_token -> the RunLog row started by the manual "Run Now" that paused on it.
const tokenToRunId = new Map<string, string>();

export async function runRoutineNow(routineId: string): Promise<RunRoutineResult> {
  const routine = getRoutine(routineId);
  if (!routine) {
    return { status: "failed", failed_step: -1, reason: "routine_not_found", message: "שגרה לא נמצאה" };
  }
  const definition = loadRoutineDefinition(routine.scriptRef);
  const credential = getCredentialForRoutine(routineId)?.payload;
  const authState = loadAuthState(routineId);
  const runId = startRunLog(routineId, "gui_manual_run");
  const engine = resolveEngine(routine.type);
  const result = await engine.run(definition, credential, "gui_manual_run", authState);
  logOutcome(runId, result);
  return result;
}

export async function submitOtp(continuationToken: string, otpCode: string): Promise<RunRoutineResult> {
  const runId = tokenToRunId.get(continuationToken);
  tokenToRunId.delete(continuationToken);
  const result = await webEngine.submitOtp(continuationToken, otpCode);
  if (runId) logOutcome(runId, result);
  return result;
}

function logOutcome(runId: string, result: RunRoutineResult): void {
  if (result.status === "awaiting_otp") {
    tokenToRunId.set(result.continuation_token, runId);
    finishRunLog(runId, "awaiting_otp");
  } else if (result.status === "success") {
    finishRunLog(runId, "success");
  } else if (result.status === "no_match") {
    finishRunLog(runId, "failed", { reason: "no_match", message: result.message });
  } else {
    finishRunLog(runId, "failed", {
      failedStep: result.failed_step,
      reason: result.reason,
      message: result.message,
    });
  }
}
