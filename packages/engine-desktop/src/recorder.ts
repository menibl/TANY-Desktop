import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Step } from "@tany-desktop/shared";
import { readJsonFileFromPowerShell } from "./psJson";

function recorderScriptPath(): string {
  return path.join(__dirname, "..", "native", "Recorder.ps1");
}

/**
 * Runs native/Recorder.ps1 and waits for the user to click "stop recording"
 * in its always-on-top window - the desktop equivalent of closing the
 * Playwright Inspector window in engine-web's recordWebRoutine. Returns the
 * recorded Step[] once the script writes it out and exits.
 *
 * UNVERIFIED ON A REAL WINDOWS MACHINE - see
 * packages/engine-desktop/README.md before relying on this.
 */
export async function recordDesktopRoutine(exePath: string): Promise<Step[]> {
  const outFile = path.join(os.tmpdir(), `tany-desktop-recording-${Date.now()}.json`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        recorderScriptPath(),
        "-ExePath",
        exePath,
        "-OutFile",
        outFile,
      ],
      { stdio: "inherit" }
    );
    child.on("error", reject);
    child.on("close", (code) => {
      // Closing the "stop recording" button exits 0; treat any exit as
      // "session ended" and let the caller check whether the output file
      // was actually produced (mirrors engine-web's recordWebRoutine).
      if (code === null) reject(new Error("recorder terminated by signal"));
      else resolve();
    });
  });

  if (!fs.existsSync(outFile)) {
    throw new Error("לא נוצר קובץ הקלטה - כנראה שההקלטה נסגרה לפני שבוצעה פעולה כלשהי.");
  }
  const steps = readJsonFileFromPowerShell<Step[]>(outFile);
  fs.unlinkSync(outFile);
  return steps;
}
