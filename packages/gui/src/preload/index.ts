import { contextBridge, ipcRenderer } from "electron";

const api = {
  device: {
    get: () => ipcRenderer.invoke("device:get"),
    rename: (name: string) => ipcRenderer.invoke("device:rename", name),
  },
  routines: {
    list: () => ipcRenderer.invoke("routines:list"),
    get: (routineId: string) => ipcRenderer.invoke("routines:get", routineId),
    delete: (routineId: string) => ipcRenderer.invoke("routines:delete", routineId),
    save: (input: unknown) => ipcRenderer.invoke("routines:save", input),
    run: (routineId: string) => ipcRenderer.invoke("routines:run", routineId),
    submitOtp: (continuationToken: string, otpCode: string) =>
      ipcRenderer.invoke("routines:submitOtp", { continuationToken, otpCode }),
  },
  recording: {
    start: (routineId: string, startUrl: string) =>
      ipcRenderer.invoke("recording:start", { routineId, startUrl }),
    loginStart: (routineId: string, startUrl: string) =>
      ipcRenderer.invoke("recording:loginStart", { routineId, startUrl }),
    loginFinish: (routineId: string) => ipcRenderer.invoke("recording:loginFinish", routineId),
    loginCancel: (routineId: string) => ipcRenderer.invoke("recording:loginCancel", routineId),
  },
  service: {
    status: () => ipcRenderer.invoke("service:status"),
    start: () => ipcRenderer.invoke("service:start"),
    stop: () => ipcRenderer.invoke("service:stop"),
  },
};

contextBridge.exposeInMainWorld("tany", api);

export type TanyApi = typeof api;
