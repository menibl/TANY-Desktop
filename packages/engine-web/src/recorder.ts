import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as net from "net";
import * as http from "http";
import { chromium, type Browser, type BrowserContext } from "playwright";
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
 * authenticated (see recordWebRoutine's doc for why that matters).
 */
async function runCodegenSession(
  startUrl: string,
  scriptOutFile: string,
  loadStateFile: string | undefined
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
      else resolve();
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
 * If `priorAuthState` is given (from a one-time login, see below), the
 * session starts already-authenticated with it. This matters for sites
 * gated behind Google/Microsoft-style sign-in: Google only actively
 * challenges the *interactive* sign-in handshake for automation markers -
 * a session that's already valid via a loaded cookie never reaches that
 * checkpoint, so the recording browser (still Playwright's bundled
 * Chromium here - that's fine) never gets flagged.
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

// ---- One-time manual login for identity-provider-gated sites ----
//
// Google (and similar identity providers) actively reject sign-in attempts
// from automated/WebDriver-controlled browsers as a security measure. This
// isn't specific to *recording*, and switching which browser binary gets
// launched (e.g. real Chrome via `--channel chrome`) doesn't help either -
// Playwright's own launch() always adds automation flags (--enable-automation
// and friends) and CDP wiring that set `navigator.webdriver = true`,
// regardless of which browser binary it points at.
//
// The only reliable fix: launch Chrome ourselves as a completely plain
// process (no Playwright launch flags at all - just --remote-debugging-port
// so we can attach afterward), let the user log in there like they would in
// any normal browser, then have Playwright *attach* to that already-running
// browser via connectOverCDP() to read back the resulting session. Playwright
// never controls the browser during the actual login, so there's nothing for
// Google to flag.

interface PendingLogin {
  chromeProcess: ChildProcess;
  browser: Browser;
  context: BrowserContext;
  userDataDir: string;
}

const pendingLogins = new Map<string, PendingLogin>();

function findRealChromeExecutable(): string {
  const override = process.env.TANY_DESKTOP_REAL_CHROME_PATH;
  if (override && fs.existsSync(override)) return override;

  const candidates: string[] =
    process.platform === "win32"
      ? [
          path.join(process.env["PROGRAMFILES"] || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
          path.join(
            process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
            "Google\\Chrome\\Application\\chrome.exe"
          ),
          path.join(process.env["LOCALAPPDATA"] || "", "Google\\Chrome\\Application\\chrome.exe"),
        ]
      : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/usr/bin/chromium"];

  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) {
    throw new Error(
      "לא נמצא Google Chrome מותקן במחשב. יש להתקין מ-google.com/chrome, " +
        "או להצביע עליו ידנית עם משתנה סביבה TANY_DESKTOP_REAL_CHROME_PATH."
    );
  }
  return found;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function waitForCdpReady(port: number, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/json/version", timeout: 1000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("Chrome לא עלה בזמן - נסו שוב."));
        else setTimeout(tryOnce, 300);
      });
      req.on("timeout", () => {
        req.destroy();
        if (Date.now() > deadline) reject(new Error("Chrome לא עלה בזמן - נסו שוב."));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

/**
 * Killing a process is asynchronous - it only requests termination, it
 * doesn't wait for the OS to actually reclaim the process's open file
 * handles. Deleting the profile directory immediately after kill() races
 * that and intermittently fails (ENOTEMPTY/EBUSY, especially on Windows).
 */
function waitForProcessExit(proc: ChildProcess, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, timeoutMs);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    proc.kill();
  });
}

async function cleanupPending(pending: PendingLogin): Promise<void> {
  try {
    await pending.browser.close();
  } catch {
    // ignore - process may already be gone
  }
  await waitForProcessExit(pending.chromeProcess);
  try {
    // maxRetries/retryDelay absorb the remaining, shorter-lived file locks
    // (e.g. antivirus scanning the profile) that waiting for exit doesn't.
    fs.rmSync(pending.userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Not worth failing the login flow over a leftover temp profile dir.
  }
}

/**
 * Opens a plain, unmanaged real-Chrome window at `startUrl` for the user to
 * log in manually. Returns once the window is up and Playwright has
 * attached (not once login is complete - the caller decides that by calling
 * `finishLoginSession` when the user says they're done).
 */
export async function startLoginSession(routineId: string, startUrl: string): Promise<void> {
  if (pendingLogins.has(routineId)) {
    throw new Error("כבר יש הליך התחברות פעיל לשגרה הזו - סיימו או בטלו אותו קודם.");
  }

  const chromePath = findRealChromeExecutable();
  const port = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tany-desktop-chrome-"));

  const chromeProcess = spawn(
    chromePath,
    [`--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, "--no-first-run", "--no-default-browser-check", startUrl],
    { stdio: "ignore" }
  );

  try {
    await waitForCdpReady(port);
  } catch (err) {
    chromeProcess.kill();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw err;
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0] ?? (await browser.newContext());

  pendingLogins.set(routineId, { chromeProcess, browser, context, userDataDir });
}

/** Captures the session from an in-progress login and closes the Chrome window. */
export async function finishLoginSession(routineId: string): Promise<AuthState> {
  const pending = pendingLogins.get(routineId);
  if (!pending) {
    throw new Error("אין הליך התחברות פעיל לשגרה הזו - לחצו קודם על 'התחברות חד-פעמית'.");
  }
  pendingLogins.delete(routineId);

  const state = await pending.context.storageState();
  await cleanupPending(pending);
  return state as AuthState;
}

/** Aborts an in-progress login without saving anything (e.g. user changed their mind). */
export async function cancelLoginSession(routineId: string): Promise<void> {
  const pending = pendingLogins.get(routineId);
  if (!pending) return;
  pendingLogins.delete(routineId);
  await cleanupPending(pending);
}

/** Safety net for app shutdown so no orphaned Chrome processes/profiles are left behind. */
export async function cancelAllLoginSessions(): Promise<void> {
  const all = Array.from(pendingLogins.values());
  pendingLogins.clear();
  await Promise.all(all.map(cleanupPending));
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
