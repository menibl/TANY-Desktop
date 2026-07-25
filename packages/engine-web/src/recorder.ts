import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { AuthState } from "@tany-desktop/shared";

/**
 * Resolves Playwright's CLI script path directly instead of shelling out to
 * `npx`/`npx.cmd`: spawning a `.cmd` file on Windows without `shell: true`
 * throws `EINVAL`, and `shell: true` would require shell-escaping `startUrl`
 * to avoid injection. Invoking `node <cli.js> ...` directly sidesteps both.
 */
function resolvePlaywrightCli(): string {
  const pkgJsonPath = require.resolve("playwright/package.json");
  return path.join(path.dirname(pkgJsonPath), "cli.js");
}

/**
 * Runs `playwright codegen` and waits for the user to close the Inspector
 * window. Always saves the resulting storage state (cookies/localStorage) -
 * even a plain non-login session produces one, it's just an anonymous/empty
 * one - and optionally preloads a previous one so the session starts already
 * authenticated (see module doc below for why that matters).
 */
async function runCodegenSession(
  startUrl: string,
  scriptOutFile: string,
  loadStateFile: string | undefined,
  channel?: "chrome"
): Promise<string> {
  const saveStateFile = path.join(os.tmpdir(), `tany-desktop-storage-${Date.now()}.json`);

  await new Promise<void>((resolve, reject) => {
    const cli = resolvePlaywrightCli();
    const args = [
      cli,
      "codegen",
      startUrl,
      "--target",
      "javascript",
      "-o",
      scriptOutFile,
      "--save-storage",
      saveStateFile,
    ];
    if (loadStateFile && fs.existsSync(loadStateFile)) {
      args.push("--load-storage", loadStateFile);
    }
    if (channel) {
      args.push("--channel", channel);
    }
    const child = spawn(process.execPath, args, {
      stdio: "inherit",
      // When called from the Electron GUI, process.execPath is electron.exe -
      // ELECTRON_RUN_AS_NODE makes it run cli.js as plain Node instead of
      // trying to launch it as another Electron app. No-op under plain node.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    child.on("error", reject);
    child.on("close", (code) => {
      // Playwright's own docs note the recorder window's close button exits
      // with 0; treat any exit as "session ended" and let the caller check
      // whether the expected output files were actually produced.
      if (code === null) reject(new Error("playwright codegen terminated by signal"));
      else if (code !== 0 && channel && !fs.existsSync(saveStateFile)) {
        reject(
          new Error(
            `לא נמצא Google Chrome מותקן במחשב (נדרש עבור התחברות דרך Google/Microsoft). ` +
              `יש להתקין Chrome מ-google.com/chrome ולנסות שוב.`
          )
        );
      } else resolve();
    });
  });

  return saveStateFile;
}

/**
 * Recording (spec section 5) is done by shelling out to Playwright's own
 * `codegen` tool rather than reimplementing click/selector capture: it opens
 * a real browser window plus the Playwright Inspector, and as the user
 * performs the process (login, navigation, clicking...) it writes out a
 * selector-based script - exactly the "identify elements, not pixels" (סעיף
 * 2) requirement, for free. Closing the Inspector window ends the recording.
 *
 * This requires an interactive display; on the real Windows deployment that
 * means running it from the GUI app while the user is logged in, which
 * matches how it's meant to be used (spec section 5, step 1: "המשתמש פותח
 * את ה-GUI המקומי ובוחר 'שגרה חדשה'").
 *
 * If `priorAuthState` is given, the session starts already-authenticated
 * with it - see the module-level note on `loginAndCaptureAuthState` for why
 * this matters for sites gated behind Google/Microsoft-style sign-in.
 */
export async function recordWebRoutine(
  startUrl: string,
  priorAuthState?: AuthState
): Promise<{ code: string; authState: AuthState }> {
  const scriptOutFile = path.join(os.tmpdir(), `tany-desktop-codegen-${Date.now()}.js`);
  const loadStateFile = priorAuthState ? writeTempState(priorAuthState) : undefined;

  try {
    const saveStateFile = await runCodegenSession(startUrl, scriptOutFile, loadStateFile);

    if (!fs.existsSync(scriptOutFile)) {
      throw new Error("לא נוצר קובץ הקלטה - כנראה שהחלון נסגר לפני שבוצעה פעולה כלשהי.");
    }

    const code = fs.readFileSync(scriptOutFile, "utf8");
    const authState = readAndDeleteTempState(saveStateFile);
    fs.unlinkSync(scriptOutFile);
    return { code, authState };
  } finally {
    if (loadStateFile && fs.existsSync(loadStateFile)) fs.unlinkSync(loadStateFile);
  }
}

/**
 * Google (and similar identity providers) actively reject sign-in attempts
 * from automated/WebDriver-controlled browsers as a security measure. This
 * isn't specific to *recording* - any CDP-controlled browser gets flagged,
 * whether Playwright is capturing actions or the user is just manually
 * clicking around in a Playwright-launched window. So plain "don't record,
 * just let them click" isn't enough on its own; the browser itself still
 * needs to look less like automation. Launching the user's real installed
 * Google Chrome (`--channel chrome`) instead of Playwright's bundled
 * Chromium is the main lever available here and meaningfully reduces (does
 * not guarantee removing) that detection - bundled Chromium is what gets
 * flagged most aggressively.
 *
 * The practical fix: let the user complete that login manually, once, in
 * this real-Chrome window (no recording/replay happening - just a plain
 * visible window), capture the resulting session (cookies/localStorage)
 * here, and reuse it for every future recording and run of that routine
 * (see recordWebRoutine's `priorAuthState` and player.ts's `authState`) -
 * so the automated parts never touch the identity provider's sign-in
 * screen at all.
 */
export async function loginAndCaptureAuthState(
  startUrl: string,
  priorAuthState?: AuthState
): Promise<AuthState> {
  const throwawayScript = path.join(os.tmpdir(), `tany-desktop-login-${Date.now()}.js`);
  const loadStateFile = priorAuthState ? writeTempState(priorAuthState) : undefined;

  try {
    const saveStateFile = await runCodegenSession(startUrl, throwawayScript, loadStateFile, "chrome");
    const authState = readAndDeleteTempState(saveStateFile);
    if (fs.existsSync(throwawayScript)) fs.unlinkSync(throwawayScript);
    return authState;
  } finally {
    if (loadStateFile && fs.existsSync(loadStateFile)) fs.unlinkSync(loadStateFile);
  }
}

function writeTempState(state: AuthState): string {
  const filePath = path.join(os.tmpdir(), `tany-desktop-load-${Date.now()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state), "utf8");
  return filePath;
}

function readAndDeleteTempState(filePath: string): AuthState {
  const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : '{"cookies":[],"origins":[]}';
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  return JSON.parse(raw) as AuthState;
}
