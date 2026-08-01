import { chromium, type Browser, type BrowserContext, type Page, type Locator } from "playwright";
import { v4 as uuidv4 } from "uuid";
import type {
  RoutineDefinition,
  Step,
  RunRoutineResult,
  CredentialPayload,
  AuthState,
} from "@tany-desktop/shared";
import { config } from "@tany-desktop/shared";

class StepError extends Error {
  constructor(public stepIndex: number, public reason: string, message: string) {
    super(message);
  }
}

interface PendingRun {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  definition: RoutineDefinition;
  credential: CredentialPayload | undefined;
  resumeAtStep: number;
  outputs: Record<string, unknown>;
  timeout: NodeJS.Timeout;
}

// Runs paused on otp_injection, keyed by continuation_token (spec 14.2).
// In-memory only, matching "מצב זמני בזיכרון/דיסק מקומי" + the ~3 minute
// expiry window described in the spec.
const pendingRuns = new Map<string, PendingRun>();

function resolveLocator(page: Page, step: Step): Locator {
  switch (step.selectorKind) {
    case "role":
      return page.getByRole(step.role as any, step.name ? { name: step.name } : undefined);
    case "text":
      return page.getByText(step.selector ?? "");
    case "label":
      return page.getByLabel(step.selector ?? "");
    case "testId":
      return page.getByTestId(step.selector ?? "");
    case "placeholder":
      return page.getByPlaceholder(step.selector ?? "");
    case "altText":
      return page.getByAltText(step.selector ?? "");
    case "title":
      return page.getByTitle(step.selector ?? "");
    case "css":
      return page.locator(step.selector ?? "");
    default:
      throw new Error(`step has no usable selector (kind=${step.selectorKind})`);
  }
}

async function runStep(
  page: Page,
  step: Step,
  credential: CredentialPayload | undefined,
  outputs: Record<string, unknown>
): Promise<void> {
  switch (step.type) {
    case "goto":
      await page.goto(step.url ?? "", { waitUntil: "load", timeout: config.runTimeoutMs });
      return;
    case "click":
      await resolveLocator(page, step).click({ timeout: config.runTimeoutMs });
      return;
    case "fill": {
      const value = step.credentialField
        ? credential?.[step.credentialField]
        : step.value ?? "";
      if (step.credentialField && value === undefined) {
        throw new StepError(step.index, "missing_credential", `חסר ערך אחסון עבור שדה '${step.credentialField}'`);
      }
      await resolveLocator(page, step).fill(String(value ?? ""), { timeout: config.runTimeoutMs });
      return;
    }
    case "press":
      if (step.selectorKind) {
        await resolveLocator(page, step).press(step.key ?? "Enter", { timeout: config.runTimeoutMs });
      } else {
        await page.keyboard.press(step.key ?? "Enter");
      }
      return;
    case "select":
      await resolveLocator(page, step).selectOption(step.value ?? "", { timeout: config.runTimeoutMs });
      return;
    case "waitForSelector":
      await resolveLocator(page, step).waitFor({ state: "visible", timeout: config.runTimeoutMs });
      return;
    case "extract": {
      const text = await resolveLocator(page, step).textContent({ timeout: config.runTimeoutMs });
      outputs[step.extractAs ?? `field_${step.index}`] = text?.trim() ?? null;
      return;
    }
    case "otp_injection":
      // Handled by the caller (run/submitOtp) - execution pauses before this step.
      return;
  }
}

/** Executes steps[from..] in order; throws StepError with the failing index. */
async function executeFrom(
  page: Page,
  definition: RoutineDefinition,
  from: number,
  credential: CredentialPayload | undefined,
  outputs: Record<string, unknown>
): Promise<{ pausedAtOtp: number } | { completed: true }> {
  for (let i = from; i < definition.steps.length; i++) {
    const step = definition.steps[i];
    if (step.type === "otp_injection") {
      return { pausedAtOtp: i };
    }
    try {
      await runStep(page, step, credential, outputs);
    } catch (err) {
      if (err instanceof StepError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      const reason = /timeout/i.test(message) ? "element_not_found" : "automation_error";
      // Optional steps (e.g. a cookie-consent/promo popup's close button
      // that doesn't reliably appear every visit) skip past a missing
      // element instead of failing the whole run over it - but a real
      // automation error, not just "wasn't there", still isn't safe to
      // silently continue past.
      if (step.optional && reason === "element_not_found") continue;
      throw new StepError(i, reason, message);
    }
  }
  return { completed: true };
}

async function closeQuietly(browser: Browser): Promise<void> {
  try {
    await browser.close();
  } catch {
    // already closed / crashed - nothing more to do
  }
}

export async function runWebRoutine(
  definition: RoutineDefinition,
  credential: CredentialPayload | undefined,
  _requestedBy?: string,
  authState?: AuthState
): Promise<RunRoutineResult> {
  const browser = await chromium.launch({
    headless: process.env.TANY_DESKTOP_HEADFUL !== "1",
    executablePath: process.env.TANY_DESKTOP_CHROMIUM_PATH || undefined,
  });
  // Starting from a saved, already-authenticated session (see recorder.ts's
  // loginAndCaptureAuthState) means replays never touch an identity
  // provider's own sign-in screen, which would otherwise reject them as
  // automated traffic.
  const context = await browser.newContext(
    authState ? { storageState: authState as any } : undefined
  );
  const page = await context.newPage();
  const outputs: Record<string, unknown> = {};

  try {
    const result = await executeFrom(page, definition, 0, credential, outputs);
    if ("pausedAtOtp" in result) {
      return pauseForOtp(browser, context, page, definition, credential, result.pausedAtOtp, outputs);
    }
    await closeQuietly(browser);
    return { status: "success", result: outputs };
  } catch (err) {
    await closeQuietly(browser);
    return toFailedResult(err);
  }
}

function pauseForOtp(
  browser: Browser,
  context: BrowserContext,
  page: Page,
  definition: RoutineDefinition,
  credential: CredentialPayload | undefined,
  otpStepIndex: number,
  outputs: Record<string, unknown>
): RunRoutineResult {
  const token = `cont_${uuidv4().replace(/-/g, "")}`;
  const timeout = setTimeout(() => {
    const pending = pendingRuns.get(token);
    if (pending) {
      void closeQuietly(pending.browser);
      pendingRuns.delete(token);
    }
  }, config.otpTimeoutMs);
  // Don't let this timer keep the process alive by itself.
  timeout.unref?.();

  pendingRuns.set(token, {
    browser,
    context,
    page,
    definition,
    credential,
    resumeAtStep: otpStepIndex,
    outputs,
    timeout,
  });

  const step = definition.steps[otpStepIndex];
  return {
    status: "awaiting_otp",
    continuation_token: token,
    prompt_hint: step.promptHint ?? "קוד אימות",
  };
}

export async function submitOtpForWebRoutine(
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

  const { browser, page, definition, credential, resumeAtStep, outputs } = pending;
  const otpStep = definition.steps[resumeAtStep];

  try {
    if (otpStep.selectorKind) {
      await resolveLocator(page, otpStep).fill(otpCode, { timeout: config.runTimeoutMs });
    } else {
      await page.keyboard.type(otpCode);
    }

    const result = await executeFrom(page, definition, resumeAtStep + 1, credential, outputs);
    if ("pausedAtOtp" in result) {
      return pauseForOtp(browser, pending.context, page, definition, credential, result.pausedAtOtp, outputs);
    }
    await closeQuietly(browser);
    return { status: "success", result: outputs };
  } catch (err) {
    await closeQuietly(browser);
    return toFailedResult(err);
  }
}

function toFailedResult(err: unknown): RunRoutineResult {
  if (err instanceof StepError) {
    return {
      status: "failed",
      failed_step: err.stepIndex,
      reason: err.reason,
      message: "הפעולה נכשלה — נסה שוב או בדוק שגרה",
    };
  }
  return {
    status: "failed",
    failed_step: -1,
    reason: "unexpected_error",
    message: err instanceof Error ? err.message : String(err),
  };
}
