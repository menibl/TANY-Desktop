import { config } from "@tany-desktop/shared";
import { startMcpServer, type McpServerHandle } from "@tany-desktop/mcp-server";

/**
 * Lets the GUI start/stop the MCP server from a button ("הפעל שירות").
 * Runs it *in-process* (same Electron main process, same native module
 * build) rather than spawning a separate node.exe child - that's what the
 * old design did, and it's exactly why the GUI and a standalone server
 * process needed different better-sqlite3 builds (Electron ABI vs Node
 * ABI) and couldn't run at the same time without a rebuild in between.
 * One process now serves both the GUI windows and (once started) the MCP
 * HTTP endpoint, so there's nothing to keep in sync.
 */
let handle: McpServerHandle | undefined;
let starting: Promise<McpServerHandle> | undefined;

export function getServiceStatus(): { running: boolean; port: number } {
  return { running: !!handle, port: config.mcpServer.port };
}

export async function startService(): Promise<{ running: boolean; port: number }> {
  if (!handle) {
    starting ??= startMcpServer().finally(() => {
      starting = undefined;
    });
    handle = await starting;
  }
  return getServiceStatus();
}

export async function stopService(): Promise<{ running: boolean; port: number }> {
  if (handle) {
    await handle.stop();
    handle = undefined;
  }
  return getServiceStatus();
}
