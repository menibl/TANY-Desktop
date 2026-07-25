import * as fs from "fs";
import * as path from "path";
import { getRoutinesDir } from "./config";
import type { RoutineDefinition } from "./types";

/**
 * The Routine DB row only stores metadata + a script_ref; the actual step
 * sequence (spec section 15: "script_ref - הפניה לסקריפט/רצף הפעולות המוקלט")
 * lives as a JSON file so it stays easy to inspect/diff during debugging
 * (spec section 7) without needing a DB browser.
 */
export function scriptPathFor(routineId: string): string {
  return path.join(getRoutinesDir(), `${routineId}.json`);
}

export function saveRoutineDefinition(def: RoutineDefinition): string {
  const filePath = scriptPathFor(def.routineId);
  fs.writeFileSync(filePath, JSON.stringify(def, null, 2), "utf8");
  return filePath;
}

export function loadRoutineDefinition(scriptRef: string): RoutineDefinition {
  const raw = fs.readFileSync(scriptRef, "utf8");
  return JSON.parse(raw) as RoutineDefinition;
}

export function deleteRoutineDefinition(scriptRef: string): void {
  if (fs.existsSync(scriptRef)) fs.unlinkSync(scriptRef);
}
