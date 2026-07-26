import { startMcpServer, type McpServerHandle } from "./server";

/**
 * Standalone CLI entry point (`node dist/index.js`) - used by
 * scripts/install-scheduled-task.ps1 for the dev/test "always-on Windows
 * box" deployment. The packaged desktop app instead calls startMcpServer()
 * directly from the GUI's main process (see gui/src/main/serviceManager.ts)
 * so the MCP server and the GUI windows share one process/one native
 * module build, instead of this spawning a separate node.exe child.
 */
let handle: McpServerHandle | undefined;
void startMcpServer().then((h) => {
  handle = h;
});

function shutdown(): void {
  void (handle ? handle.stop() : Promise.resolve()).finally(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
