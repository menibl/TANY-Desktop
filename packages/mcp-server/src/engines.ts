import type { RoutineEngine, RoutineType } from "@tany-desktop/shared";
import { WebEngine } from "@tany-desktop/engine-web";
import { DesktopEngine } from "@tany-desktop/engine-desktop";

export const webEngine = new WebEngine();
export const desktopEngine = new DesktopEngine();

export function resolveEngine(type: RoutineType): RoutineEngine {
  return type === "web" ? webEngine : desktopEngine;
}
