import * as crypto from "crypto";
import * as fs from "fs";
import { getMasterKeyPath } from "./config";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

let cachedKey: Buffer | null = null;

/**
 * Application-level field encryption instead of whole-file encryption
 * (e.g. SQLCipher): avoids a native module that must be recompiled per
 * platform/Node ABI, at the cost of only sensitive columns (api_key,
 * credential payloads) being encrypted rather than the whole DB file.
 * The key itself never leaves this machine and is stored with owner-only
 * permissions next to the DB (spec section 8: secrets never leave the
 * local machine; protection boundary is the machine/user account itself).
 */
export function getOrCreateMasterKey(): Buffer {
  if (cachedKey) return cachedKey;

  const keyPath = getMasterKeyPath();
  if (fs.existsSync(keyPath)) {
    cachedKey = fs.readFileSync(keyPath);
    if (cachedKey.length !== 32) {
      throw new Error(`Corrupt master key at ${keyPath}: expected 32 bytes`);
    }
    return cachedKey;
  }

  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  try {
    fs.chmodSync(keyPath, 0o600);
  } catch {
    // best-effort on platforms without POSIX permission bits (e.g. Windows
    // NTFS ACLs are separate); ProgramData is already admin-protected there.
  }
  cachedKey = key;
  return key;
}

export function encryptField(plaintext: string): string {
  const key = getOrCreateMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptField(ciphertext: string): string {
  const key = getOrCreateMasterKey();
  const raw = Buffer.from(ciphertext, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const encrypted = raw.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function generateApiKey(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function generateDeviceId(): string {
  return `dev_${crypto.randomBytes(8).toString("hex")}`;
}

export function generateRoutineId(slug: string): string {
  const clean = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `rtn_${clean || crypto.randomBytes(4).toString("hex")}`;
}
