import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { config, ensureDataDir } from "@tany-desktop/shared";

/**
 * Embeds frpc (spec section 13.1) as a managed child process rather than a
 * separate install: TANY DESKTOP writes its own frpc.toml next to the data
 * dir and spawns the frpc binary the operator placed at
 * config.tunnel.frpcBinaryPath (see scripts/get-frpc.ps1 - the binary itself
 * isn't vendored in this repo, it's fetched from frp's official GitHub
 * release the same way `npx playwright install chromium` fetches a browser).
 *
 * frpc handles its own reconnection on network drops internally (spec
 * section 12.1), so this module's job is just: generate config, launch it
 * once, and figure out from its own log output when the tunnel is actually
 * up so we know the public address to register with TANY.
 */

let frpcProcess: ChildProcess | undefined;

function writeFrpcConfig(): string {
  const configPath = path.join(ensureDataDir(), "frpc.toml");
  const toml = [
    `serverAddr = "${config.tunnel.serverAddr}"`,
    `serverPort = ${config.tunnel.serverPort}`,
    config.tunnel.authToken ? `auth.method = "token"` : "",
    config.tunnel.authToken ? `auth.token = "${config.tunnel.authToken}"` : "",
    "",
    "[[proxies]]",
    `name = "tany-desktop-mcp"`,
    `type = "tcp"`,
    `localIP = "${config.mcpServer.host === "0.0.0.0" ? "127.0.0.1" : config.mcpServer.host}"`,
    `localPort = ${config.mcpServer.port}`,
    `remotePort = ${config.tunnel.remotePort}`,
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
  fs.writeFileSync(configPath, toml, "utf8");
  return configPath;
}

/**
 * Starts frpc and resolves with the public `host:port` once frpc's own log
 * confirms the proxy is live. Rejects (without throwing past the caller -
 * see index.ts) if the binary is missing/misconfigured, or if frpc doesn't
 * report success within the timeout.
 */
export function startTunnel(timeoutMs = 20000): Promise<string> {
  if (!config.tunnel.enabled) {
    return Promise.reject(new Error("tunnel not configured (TANY_DESKTOP_FRPS_ADDR not set)"));
  }
  if (!config.tunnel.remotePort) {
    return Promise.reject(new Error("TANY_DESKTOP_FRP_REMOTE_PORT is required when a tunnel is configured"));
  }
  if (!fs.existsSync(config.tunnel.frpcBinaryPath)) {
    return Promise.reject(
      new Error(
        `frpc binary not found at ${config.tunnel.frpcBinaryPath}. ` +
          `Run scripts/get-frpc.ps1 first, or set TANY_DESKTOP_FRPC_PATH.`
      )
    );
  }

  const configPath = writeFrpcConfig();

  return new Promise((resolve, reject) => {
    const proc = spawn(config.tunnel.frpcBinaryPath, ["-c", configPath], { stdio: ["ignore", "pipe", "pipe"] });
    frpcProcess = proc;

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("timed out waiting for frpc to report a successful connection"));
    }, timeoutMs);

    const onOutput = (data: Buffer) => {
      const text = data.toString("utf8");
      process.stdout.write(`[frpc] ${text}`);
      // frpc logs "start proxy success" once the tunnel is actually usable
      // (verified against these exact log lines with a real frps/frpc pair).
      if (!settled && /start proxy success/i.test(text)) {
        settled = true;
        clearTimeout(timer);
        resolve(`${config.tunnel.serverAddr}:${config.tunnel.remotePort}`);
      }
      if (!settled && /login to server failed|error/i.test(text)) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`frpc reported an error: ${text.trim()}`));
      }
    };
    proc.stdout?.on("data", onOutput);
    proc.stderr?.on("data", onOutput);

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    proc.on("exit", (code) => {
      frpcProcess = undefined;
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`frpc exited early (code ${code}) before confirming a connection`));
      }
    });
  });
}

export function stopTunnel(): void {
  if (frpcProcess && !frpcProcess.killed) {
    frpcProcess.kill();
  }
  frpcProcess = undefined;
}
