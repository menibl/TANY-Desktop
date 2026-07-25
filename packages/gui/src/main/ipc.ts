import { ipcMain } from "electron";
import { getOrCreateDevice, renameDevice } from "@tany-desktop/shared";
import { recordWebRoutine, parseCodegenScript } from "@tany-desktop/engine-web";
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

  ipcMain.handle("recording:start", async (_e, startUrl: string) => {
    const code = await recordWebRoutine(startUrl);
    return parseCodegenScript(code);
  });

  ipcMain.handle("service:status", () => getServiceStatus());
  ipcMain.handle("service:start", () => startService());
  ipcMain.handle("service:stop", () => stopService());
}
