import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import type { RoutineDefinition, RunRoutineResult, CredentialPayload } from "@tany-desktop/shared";
import { config } from "@tany-desktop/shared";

/**
 * Runs paused on otp_injection, keyed by continuation_token (spec 14.2).
 * Deliberately holds only plain data (definition/credential/step index/
 * outputs-so-far), not a live process handle - see native/Player.ps1's doc
 * comment for why this engine re-spawns per step instead of keeping a
 * process alive the way engine-web keeps a Playwright browser alive.
 */
interface PendingRun {
  definition: RoutineDefinition;
  credential: CredentialPayload | undefined;
  resumeAtStep: number;
  outputs: Record<string, unknown>;
  timeout: NodeJS.Timeout;
}

const pendingRuns = new Map<string, PendingRun>();

function playerScriptPath(): string {
  return path.join(__dirname, "..", "native", "Player.ps1");
}

interface PlayerOutcome {
  status: "success" | "awaiting_otp" | "failed";
  result?: Record<string, unknown>;
  pausedAtStep?: number;
  promptHint?: string;
  outputsSoFar?: Record<string, unknown>;
  failed_step?: number;
  reason?: string;
  message?: string;
}

function runPlayerProcess(
  definition: RoutineDefinition,
  credential: CredentialPayload | undefined,
  fromStep: number,
  outputs: Record<string, unknown>,
  otpCode?: string
): Promise<PlayerOutcome> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inputFile = path.join(os.tmpdir(), `tany-desktop-player-in-${stamp}.json`);
  const outputFile = path.join(os.tmpdir(), `tany-desktop-player-out-${stamp}.json`);
  fs.writeFileSync(
    inputFile,
    JSON.stringify({ definition, credential: credential ?? null, fromStep, outputs, otpCode: otpCode ?? null }),
    "utf8"
  );

  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        playerScriptPath(),
        "-InputFile",
        inputFile,
        "-OutputFile",
        outputFile,
      ],
      { stdio: "inherit" }
    );
    child.on("error", reject);
    child.on("close", () => {
      try {
        if (!fs.existsSync(outputFile)) {
          reject(new Error("Player.ps1 exited without producing a result file"));
          return;
        }
        resolve(JSON.parse(fs.readFileSync(outputFile, "utf8")) as PlayerOutcome);
      } catch (err) {
        reject(err);
      } finally {
        if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile);
        if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
      }
    });
  });
}

async function execute(
  definition: RoutineDefinition,
  credential: CredentialPayload | undefined,
  fromStep: number,
  outputs: Record<string, unknown>,
  otpCode?: string
): Promise<RunRoutineResult> {
  let outcome: PlayerOutcome;
  try {
    outcome = await runPlayerProcess(definition, credential, fromStep, outputs, otpCode);
  } catch (err) {
    return {
      status: "failed",
      failed_step: -1,
      reason: "player_process_error",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (outcome.status === "awaiting_otp") {
    const token = `cont_${uuidv4().replace(/-/g, "")}`;
    const timeout = setTimeout(() => {
      pendingRuns.delete(token);
    }, config.otpTimeoutMs);
    timeout.unref?.();
    pendingRuns.set(token, {
      definition,
      credential,
      resumeAtStep: outcome.pausedAtStep ?? fromStep,
      outputs: outcome.outputsSoFar ?? outputs,
      timeout,
    });
    return {
      status: "awaiting_otp",
      continuation_token: token,
      prompt_hint: outcome.promptHint ?? "קוד אימות",
    };
  }

  if (outcome.status === "success") {
    return { status: "success", result: outcome.result ?? {} };
  }

  return {
    status: "failed",
    failed_step: outcome.failed_step ?? -1,
    reason: outcome.reason ?? "unexpected_error",
    message: outcome.message ?? "הפעולה נכשלה — נסה שוב או בדוק שגרה",
  };
}

export async function runDesktopRoutine(
  definition: RoutineDefinition,
  credential: CredentialPayload | undefined
): Promise<RunRoutineResult> {
  return execute(definition, credential, 0, {});
}

export async function submitOtpForDesktopRoutine(
  continuationToken: string,
  otpCode: string
): Promise<RunRoutineResult> {
  const pending = pendingRuns.get(continuationToken);
  if (!pending) {
    return {
      status: "failed",
      failed_step: -1,
      reason: "otp_expired",
      message: "פג תוקף בקשת ה-OTP או שלא נמצאה - יש להריץ את השגרה מחדש.",
    };
  }
  pendingRuns.delete(continuationToken);
  clearTimeout(pending.timeout);
  return execute(pending.definition, pending.credential, pending.resumeAtStep, pending.outputs, otpCode);
}
