import { dialog, ipcMain } from "electron";
import { getOrCreateDevice, renameDevice, loadAuthState, saveAuthState, config } from "@tany-desktop/shared";
import {
  recordWebRoutine,
  parseCodegenScript,
  startLoginSession,
  finishLoginSession,
  cancelLoginSession,
} from "@tany-desktop/engine-web";
import { recordDesktopRoutine } from "@tany-desktop/engine-desktop";
import * as routineService from "./routineService";
import type { SaveRoutineInput } from "./routineService";
import { getServiceStatus, startService, stopService } from "./serviceManager";

/**
 * Same address a real /v1/devices/register call would send (see
 * pairing.ts's registerDevice), computed directly from config instead of
 * actually starting a tunnel - the GUI just needs to *display* it (e.g. so
 * the user can paste it straight into a WhatsApp message to TANY), not
 * manage the tunnel itself; that's the running mcp-server's job.
 */
function computeMcpAddress(): string {
  if (config.tanyCloud.publicMcpAddressOverride) {
    return `http://${config.tanyCloud.publicMcpAddressOverride}`;
  }
  if (config.tunnel.enabled && config.tunnel.serverAddr && config.tunnel.remotePort) {
    return `http://${config.tunnel.serverAddr}:${config.tunnel.remotePort}`;
  }
  // No tunnel configured - this address only works on the local network,
  // not from TANY in the cloud. Still useful to show for LAN-only testing.
  return `http://127.0.0.1:${config.mcpServer.port}`;
}

export function registerIpcHandlers(): void {
  ipcMain.handle("device:get", () => ({ ...getOrCreateDevice(), mcpAddress: computeMcpAddress() }));
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

  // Desktop routines (spec section 4/11): no prior-login/auth-state concept
  // like web's Google/Microsoft flow - UI Automation drives the app's own
  // window directly, so this is just launch-and-record.
  ipcMain.handle("recording:startDesktop", (_e, args: { exePath: string }) =>
    recordDesktopRoutine(args.exePath)
  );

  ipcMain.handle("dialog:pickExe", async () => {
    const result = await dialog.showOpenDialog({
      title: "בחר קובץ הפעלה (.exe)",
      filters: [{ name: "Executable", extensions: ["exe"] }],
      properties: ["openFile"],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("service:status", () => getServiceStatus());
  ipcMain.handle("service:start", () => startService());
  ipcMain.handle("service:stop", () => stopService());
}
