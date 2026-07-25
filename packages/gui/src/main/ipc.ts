import { ipcMain } from "electron";
import { getOrCreateDevice, renameDevice, loadAuthState, saveAuthState } from "@tany-desktop/shared";
import {
  recordWebRoutine,
  parseCodegenScript,
  startLoginSession,
  finishLoginSession,
  cancelLoginSession,
} from "@tany-desktop/engine-web";
import * as routineService from "./routineService";
import type { SaveRoutineInput } from "./routineService";
import { getServiceStatus, startService, stopService } from "./serviceManager";

export function registerIpcHandlers(): void {
  ipcMain.handle("device:get", () => getOrCreateDevice());
  ipcMain.handle("device:rename", (_e, name: string) => renameDevice(name));

  ipcMain.handle("routines:list", () => routineService.listRoutines());
  ipcMain.handle("routines:get", (_e, routineId: string) => routineService.getRoutineDetail(routineId));
  ipcMain.handle("routines:delete", (_e, routineId: string) => routineService.deleteRoutine(routineId));
  ipcMain.handle("routines:save", (_e, input: SaveRoutineInput) => routineService.saveRoutine(input));
  ipcMain.handle("routines:run", (_e, routineId: string) => routineService.runRoutineNow(routineId));
  ipcMain.handle(
    "routines:submitOtp",
    (_e, args: { continuationToken: string; otpCode: string }) =>
      routineService.submitOtp(args.continuationToken, args.otpCode)
  );

  // routineId is a draft id the renderer generates up front for new routines
  // (or the real id when re-recording), so a login done before recording and
  // the recording session itself share the same saved auth state.
  ipcMain.handle("recording:start", async (_e, args: { routineId: string; startUrl: string }) => {
    const priorAuthState = loadAuthState(args.routineId);
    const { code, authState } = await recordWebRoutine(args.startUrl, priorAuthState);
    saveAuthState(args.routineId, authState);
    return parseCodegenScript(code);
  });

  // One-time manual login (spec gap: sites gated behind Google/Microsoft-style
  // sign-in reject automated browsers outright - see engine-web/recorder.ts).
  // Two-step because we can't know when the user is "done logging in" other
  // than them telling us: loginStart opens a plain, unmanaged Chrome window;
  // loginFinish captures the resulting session once they say they're done.
  ipcMain.handle("recording:loginStart", (_e, args: { routineId: string; startUrl: string }) =>
    startLoginSession(args.routineId, args.startUrl)
  );
  ipcMain.handle("recording:loginFinish", async (_e, routineId: string) => {
    const authState = await finishLoginSession(routineId);
    saveAuthState(routineId, authState);
    return { success: true };
  });
  ipcMain.handle("recording:loginCancel", (_e, routineId: string) => cancelLoginSession(routineId));

  ipcMain.handle("service:status", () => getServiceStatus());
  ipcMain.handle("service:start", () => startService());
  ipcMain.handle("service:stop", () => stopService());
}
