import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

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
 */
export async function recordWebRoutine(startUrl: string): Promise<string> {
  const outFile = path.join(os.tmpdir(), `tany-desktop-codegen-${Date.now()}.js`);

  await new Promise<void>((resolve, reject) => {
    const cli = resolvePlaywrightCli();
    const child = spawn(
      process.execPath,
      [cli, "codegen", startUrl, "--target", "javascript", "-o", outFile],
      {
        stdio: "inherit",
        // When called from the Electron GUI, process.execPath is electron.exe -
        // ELECTRON_RUN_AS_NODE makes it run cli.js as plain Node instead of
        // trying to launch it as another Electron app. No-op under plain node.
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      }
    );
    child.on("error", reject);
    child.on("close", (code) => {
      // Playwright's own docs note the recorder window's close button exits
      // with 0; treat any exit as "recording session ended" and let the
      // caller check whether a script was actually produced.
      if (code === null) reject(new Error("playwright codegen terminated by signal"));
      else resolve();
    });
  });

  if (!fs.existsSync(outFile)) {
    throw new Error(
      "לא נוצר קובץ הקלטה - כנראה שהחלון נסגר לפני שבוצעה פעולה כלשהי."
    );
  }

  const code = fs.readFileSync(outFile, "utf8");
  fs.unlinkSync(outFile);
  return code;
}
