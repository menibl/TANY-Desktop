import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Server } from "http";
import { config, getOrCreateDevice } from "@tany-desktop/shared";
import { buildMcpServer } from "./mcp";
import { requireApiKey } from "./auth";
import { startTunnel, stopTunnel } from "./tunnel";
import { registerDevice, syncRoutinesIfChanged } from "./pairing";

export interface McpServerHandle {
  stop: () => Promise<void>;
}

/**
 * Builds and starts the MCP HTTP server (+ tunnel/pairing if configured).
 * Extracted out of index.ts's old module-load-time side effects so the
 * exact same server can be started in-process by the GUI too - the packaged
 * app runs a single Electron process (GUI + MCP server together, toggled by
 * a start/stop button) instead of the GUI spawning a separate `node.exe`
 * child, which is what forced the whole better-sqlite3 dual-ABI dance
 * during development. `dist/index.js` (the standalone CLI entry point,
 * still used by scripts/install-scheduled-task.ps1 in dev/test setups)
 * just calls this immediately; the GUI calls it only when the user clicks
 * "הפעל שירות".
 */
export function startMcpServer(): Promise<McpServerHandle> {
  const device = getOrCreateDevice();
  console.log(`[tany-desktop] device_id=${device.deviceId} name="${device.deviceName}"`);

  const app = createMcpExpressApp({ host: config.mcpServer.host });

  // Health check (spec section 22) - deliberately unauthenticated so TANY can
  // poll liveness without needing the API key on every heartbeat.
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", device_id: device.deviceId, device_name: device.deviceName });
  });

  app.post("/mcp", requireApiKey, async (req, res) => {
    const server = buildMcpServer();
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch (err) {
      console.error("Error handling MCP request:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", requireApiKey, (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed (stateless server)." },
      id: null,
    });
  });

  return new Promise((resolve) => {
    const httpServer: Server = app.listen(config.mcpServer.port, config.mcpServer.host, () => {
      console.log(
        `[tany-desktop] MCP server listening on http://${config.mcpServer.host}:${config.mcpServer.port}/mcp`
      );
      console.log(`[tany-desktop] Health check: http://${config.mcpServer.host}:${config.mcpServer.port}/health`);
      void connectToTanyCloud();
      resolve({
        stop: () =>
          new Promise((res) => {
            stopTunnel();
            httpServer.close(() => res());
          }),
      });
    });
  });
}

/**
 * Best-effort: the local server above is already fully usable (GUI, manual
 * runs) regardless of whether this succeeds. Tunnel/pairing failures are
 * logged, never fatal - matches the "runs local-only" fallback that was the
 * only behavior before this existed.
 */
async function connectToTanyCloud(): Promise<void> {
  let mcpAddress = config.tanyCloud.publicMcpAddressOverride;

  if (!mcpAddress && config.tunnel.enabled) {
    try {
      mcpAddress = await startTunnel();
      console.log(`[tany-desktop] tunnel up: ${mcpAddress}`);
    } catch (err) {
      console.error("[tany-desktop] failed to start tunnel:", err instanceof Error ? err.message : err);
    }
  }

  if (!mcpAddress) {
    console.log(
      "[tany-desktop] Phase 2: no tunnel/public address configured - pairing with TANY cloud (spec section 13) skipped, running local-only."
    );
    return;
  }

  try {
    await registerDevice(mcpAddress);
  } catch (err) {
    console.error("[tany-desktop] device registration failed:", err instanceof Error ? err.message : err);
  }

  const syncOnce = () => {
    syncRoutinesIfChanged().catch((err) =>
      console.error("[tany-desktop] routine sync failed:", err instanceof Error ? err.message : err)
    );
  };
  syncOnce();
  const syncIntervalMs = Number(process.env.TANY_DESKTOP_SYNC_INTERVAL_MS || 60_000);
  const syncInterval = setInterval(syncOnce, syncIntervalMs);
  syncInterval.unref();
}
