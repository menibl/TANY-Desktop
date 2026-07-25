import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

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
    const bin = process.platform === "win32" ? "npx.cmd" : "npx";
    const child = spawn(
      bin,
      ["--no-install", "playwright", "codegen", startUrl, "--target", "javascript", "-o", outFile],
      { stdio: "inherit" }
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
