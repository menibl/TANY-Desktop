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

export const config = {
  mcpServer: {
    host: process.env.TANY_DESKTOP_MCP_HOST || "127.0.0.1",
    port: Number(process.env.TANY_DESKTOP_MCP_PORT || 8765),
  },
  otpTimeoutMs: Number(process.env.TANY_DESKTOP_OTP_TIMEOUT_MS || 3 * 60 * 1000), // spec 14.2: ~3 minutes
  runTimeoutMs: Number(process.env.TANY_DESKTOP_RUN_TIMEOUT_MS || 60 * 1000),
  // Phase 2 (not yet implemented, see README roadmap): TANY cloud pairing.
  tanyCloud: {
    enabled: false,
    registerUrl: process.env.TANY_CLOUD_REGISTER_URL || "",
  },
};
