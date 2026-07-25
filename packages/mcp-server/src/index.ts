import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config, getOrCreateDevice } from "@tany-desktop/shared";
import { buildMcpServer } from "./mcp";
import { requireApiKey } from "./auth";

const device = getOrCreateDevice();
console.log(`[tany-desktop] device_id=${device.deviceId} name="${device.deviceName}"`);
console.log(
  `[tany-desktop] Phase 2 TODO: pair this device with TANY cloud (spec section 13) - ` +
    `not implemented yet, running local-only.`
);

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

app.listen(config.mcpServer.port, config.mcpServer.host, () => {
  console.log(
    `[tany-desktop] MCP server listening on http://${config.mcpServer.host}:${config.mcpServer.port}/mcp`
  );
  console.log(`[tany-desktop] Health check: http://${config.mcpServer.host}:${config.mcpServer.port}/health`);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
