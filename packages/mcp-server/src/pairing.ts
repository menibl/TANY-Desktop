import { config, getOrCreateDevice, listRoutines, getTriggers } from "@tany-desktop/shared";

/**
 * Client for the two endpoints TANY cloud needs to expose (spec sections
 * 13.2, 19.1, 20.1 - see docs/TANY_INTEGRATION.md for the exact contract).
 * Both are no-ops (logged, not thrown) when config.tanyCloud.enabled is
 * false, since neither endpoint exists on the TANY side yet - this is safe
 * to leave wired in permanently and it starts working the moment
 * TANY_CLOUD_REGISTER_URL is set to a real API base URL.
 */

async function postJson(url: string, apiKey: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${url} -> HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }
}

export async function registerDevice(mcpAddress: string): Promise<void> {
  if (!config.tanyCloud.enabled) {
    console.log("[tany-desktop] pairing disabled (TANY_CLOUD_REGISTER_URL not set) - skipping device registration");
    return;
  }
  const device = getOrCreateDevice();
  // NOT https: the frp "tcp" proxy type forwards raw bytes and does not
  // terminate TLS, and our own MCP server currently speaks plain HTTP -
  // advertising https here would be false and would break real clients
  // attempting a TLS handshake. Spec section 12.1 requires end-to-end TLS;
  // that still needs either the MCP server terminating TLS itself (so the
  // encrypted bytes just pass through the tcp tunnel unchanged) or frp's
  // TLS-terminating proxy type - neither is wired up yet, tracked in
  // docs/TANY_INTEGRATION.md.
  const url = `http://${mcpAddress}`;
  await postJson(`${config.tanyCloud.apiBaseUrl}/v1/devices/register`, device.apiKey, {
    device_id: device.deviceId,
    device_name: device.deviceName,
    mcp_address: url,
    api_key: device.apiKey,
  });
  console.log(`[tany-desktop] registered with TANY cloud: mcp_address=${url}`);
}

function currentRoutinesSnapshot(): { routine_id: string; name: string; triggers: string[] }[] {
  return listRoutines().map((r) => ({
    routine_id: r.routineId,
    name: r.name,
    triggers: getTriggers(r.routineId),
  }));
}

let lastSyncedFingerprint = "";

/** Re-syncs only if the routine set actually changed since the last call. */
export async function syncRoutinesIfChanged(): Promise<void> {
  if (!config.tanyCloud.enabled) return;

  const snapshot = currentRoutinesSnapshot();
  const fingerprint = JSON.stringify(snapshot);
  if (fingerprint === lastSyncedFingerprint) return;

  const device = getOrCreateDevice();
  await postJson(`${config.tanyCloud.apiBaseUrl}/v1/devices/${device.deviceId}/routines/sync`, device.apiKey, {
    routines: snapshot,
  });
  lastSyncedFingerprint = fingerprint;
  console.log(`[tany-desktop] synced ${snapshot.length} routine(s) with TANY cloud`);
}
