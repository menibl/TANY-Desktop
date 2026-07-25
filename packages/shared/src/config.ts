import * as path from "path";
import * as os from "os";
import * as fs from "fs";

/**
 * All local state (DB, master key, recorded routine scripts, logs) lives
 * under one data directory. On Windows this defaults to ProgramData so the
 * background service (running as SYSTEM, no logged-on user) and the GUI
 * (running as the interactive user) both see the same files - matching
 * spec section 9's "run whether user is logged on or not" requirement.
 */
export function getDataDir(): string {
  const override = process.env.TANY_DESKTOP_DATA_DIR;
  if (override) return override;

  if (process.platform === "win32") {
    const programData = process.env.PROGRAMDATA || "C:\\ProgramData";
    return path.join(programData, "TanyDesktop");
  }
  return path.join(os.homedir(), ".tany-desktop");
}

export function ensureDataDir(): string {
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "routines"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
  return dir;
}

export function getDbPath(): string {
  return path.join(ensureDataDir(), "tany-desktop.sqlite");
}

export function getMasterKeyPath(): string {
  return path.join(ensureDataDir(), "master.key");
}

export function getRoutinesDir(): string {
  return path.join(ensureDataDir(), "routines");
}

export function getFrpcBinaryPath(): string {
  const override = process.env.TANY_DESKTOP_FRPC_PATH;
  if (override) return override;
  return path.join(ensureDataDir(), "bin", process.platform === "win32" ? "frpc.exe" : "frpc");
}

export const config = {
  mcpServer: {
    host: process.env.TANY_DESKTOP_MCP_HOST || "127.0.0.1",
    port: Number(process.env.TANY_DESKTOP_MCP_PORT || 8765),
  },
  otpTimeoutMs: Number(process.env.TANY_DESKTOP_OTP_TIMEOUT_MS || 3 * 60 * 1000), // spec 14.2: ~3 minutes
  runTimeoutMs: Number(process.env.TANY_DESKTOP_RUN_TIMEOUT_MS || 60 * 1000),
  /**
   * Embedded frpc tunnel (spec section 13.1). Simplest correct shape for now:
   * one fixed TCP remotePort per device on frps, assigned out of band (env
   * var) since TANY cloud has no dynamic-assignment endpoint yet. A
   * subdomain/vhost-based scheme (one shared port for all customers) is a
   * later enhancement once frps is actually deployed and that's needed.
   */
  tunnel: {
    enabled: !!process.env.TANY_DESKTOP_FRPS_ADDR,
    frpcBinaryPath: getFrpcBinaryPath(),
    serverAddr: process.env.TANY_DESKTOP_FRPS_ADDR || "",
    serverPort: Number(process.env.TANY_DESKTOP_FRPS_PORT || 7000),
    authToken: process.env.TANY_DESKTOP_FRPS_TOKEN || "",
    remotePort: Number(process.env.TANY_DESKTOP_FRP_REMOTE_PORT || 0),
  },
  // Phase 2 (see docs/TANY_INTEGRATION.md): TANY cloud pairing. registerUrl
  // is the base API URL, e.g. https://api.tany.example - register/sync
  // paths (spec section 19.1/20.1) are appended by pairing.ts.
  tanyCloud: {
    enabled: !!process.env.TANY_CLOUD_REGISTER_URL,
    apiBaseUrl: (process.env.TANY_CLOUD_REGISTER_URL || "").replace(/\/$/, ""),
    // If there's no tunnel but the machine already has a reachable public
    // address (spec section 9's "dedicated always-on machine" scenario),
    // this lets registration use it directly instead of frp.
    publicMcpAddressOverride: process.env.TANY_DESKTOP_PUBLIC_MCP_ADDRESS || "",
  },
};
