import * as fs from "fs";

/**
 * Windows PowerShell 5.1's `-Encoding UTF8` always writes a BOM (unlike
 * PowerShell 7+), and JSON.parse doesn't tolerate a leading BOM character -
 * it throws "Unexpected token" on it. native/Recorder.ps1 and
 * native/Player.ps1 already write BOM-less UTF-8 explicitly, but stripping
 * a stray leading BOM here too costs nothing and means this doesn't break
 * again if a future edit to either script goes back through Set-Content.
 */
const BOM_CODE_POINT = 0xfeff;

export function readJsonFileFromPowerShell<T>(filePath: string): T {
  let raw = fs.readFileSync(filePath, "utf8");
  if (raw.charCodeAt(0) === BOM_CODE_POINT) raw = raw.slice(1);
  return JSON.parse(raw) as T;
}
