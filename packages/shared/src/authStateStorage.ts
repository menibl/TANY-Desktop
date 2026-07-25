import * as fs from "fs";
import * as path from "path";
import { getRoutinesDir } from "./config";
import { encryptField, decryptField } from "./crypto";
import type { AuthState } from "./types";

function authStatePath(routineId: string): string {
  return path.join(getRoutinesDir(), `${routineId}.auth.enc`);
}

export function hasAuthState(routineId: string): boolean {
  return fs.existsSync(authStatePath(routineId));
}

export function saveAuthState(routineId: string, state: AuthState): void {
  fs.writeFileSync(authStatePath(routineId), encryptField(JSON.stringify(state)), "utf8");
}

export function loadAuthState(routineId: string): AuthState | undefined {
  const filePath = authStatePath(routineId);
  if (!fs.existsSync(filePath)) return undefined;
  const encrypted = fs.readFileSync(filePath, "utf8");
  return JSON.parse(decryptField(encrypted)) as AuthState;
}

export function deleteAuthState(routineId: string): void {
  const filePath = authStatePath(routineId);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
