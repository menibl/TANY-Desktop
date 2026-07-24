import type { Request, Response, NextFunction } from "express";
import { getOrCreateDevice } from "@tany-desktop/shared";

/**
 * Every run_routine/submit_otp call must be authenticated with this device's
 * API key (spec section 8/13/19 - "מאומתת ב-API Key ייחודי לכל מכשיר").
 * In Phase 1 the key is only checked locally; Phase 2 wires the same key
 * into TANY cloud's Device Registry during pairing (spec section 13.2).
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const device = getOrCreateDevice();
  const provided = req.header("x-api-key");
  if (provided !== device.apiKey) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "unauthorized: missing or invalid x-api-key" },
      id: null,
    });
    return;
  }
  next();
}
