import { getDevice, saveDevice } from "./db";
import { generateApiKey, generateDeviceId } from "./crypto";
import type { DeviceRecord } from "./types";

/**
 * TANY DESKTOP generates its own identity on first run (spec section 13.2):
 * a Device ID and an API key, stored locally. Phase 2 will send these to
 * TANY cloud during pairing over the frp tunnel; for now they are generated
 * and persisted so the rest of the system (MCP server auth, GUI display)
 * already has a stable identity to work against.
 */
export function getOrCreateDevice(defaultName = "המחשב שלי"): DeviceRecord {
  const existing = getDevice();
  if (existing) return existing;

  const device: DeviceRecord = {
    deviceId: generateDeviceId(),
    deviceName: defaultName,
    apiKey: generateApiKey(),
    pairedAt: new Date().toISOString(),
  };
  saveDevice(device);
  return device;
}

export function renameDevice(name: string): DeviceRecord {
  const device = getOrCreateDevice();
  device.deviceName = name;
  saveDevice(device);
  return device;
}
