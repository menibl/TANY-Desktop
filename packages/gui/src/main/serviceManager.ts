import { spawn, type ChildProcess } from "child_process";
import * as path from "path";
import { config } from "@tany-desktop/shared";

/**
 * Lets the GUI start/stop the local MCP server (packages/mcp-server) as a
 * child process for testing, without needing it installed as a Windows
 * Scheduled Task yet (see scripts/install-scheduled-task.ps1 for the real
 * always-on deployment - spec section 9).
 */
let child: ChildProcess | undefined;

export function getServiceStatus(): { running: boolean; port: number } {
  return { running: !!child && !child.killed, port: config.mcpServer.port };
}

export function startService(): { running: boolean; port: number } {
  if (child && !child.killed) return getServiceStatus();

  const entry = path.join(__dirname, "..", "..", "..", "mcp-server", "dist", "index.js");
  child = spawn(process.execPath, [entry], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", () => {
    child = undefined;
  });
  return getServiceStatus();
}

export function stopService(): { running: boolean; port: number } {
  if (child && !child.killed) {
    child.kill();
    child = undefined;
  }
  return getServiceStatus();
}
