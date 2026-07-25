import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { getDbPath } from "./config";
import { encryptField, decryptField } from "./crypto";
import type {
  DeviceRecord,
  RoutineRecord,
  RoutineTriggerRecord,
  CredentialRecord,
  CredentialPayload,
  RunLogRecord,
  RunStatus,
  RoutineType,
} from "./types";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  db = new Database(getDbPath());
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS Device (
      device_id TEXT PRIMARY KEY,
      device_name TEXT NOT NULL,
      api_key_encrypted TEXT NOT NULL,
      paired_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS Routine (
      routine_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('web','desktop')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      script_ref TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS RoutineTrigger (
      routine_id TEXT NOT NULL REFERENCES Routine(routine_id) ON DELETE CASCADE,
      phrase TEXT NOT NULL,
      PRIMARY KEY (routine_id, phrase)
    );

    CREATE TABLE IF NOT EXISTS Credential (
      credential_id TEXT PRIMARY KEY,
      routine_id TEXT NOT NULL REFERENCES Routine(routine_id) ON DELETE CASCADE,
      encrypted_payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS RunLog (
      run_id TEXT PRIMARY KEY,
      routine_id TEXT NOT NULL REFERENCES Routine(routine_id) ON DELETE CASCADE,
      request_id TEXT,
      status TEXT NOT NULL,
      failed_step INTEGER,
      reason TEXT,
      message TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_runlog_routine ON RunLog(routine_id, started_at DESC);
  `);
}

// ---- Device ----

export function getDevice(): DeviceRecord | undefined {
  const row = getDb().prepare(`SELECT * FROM Device LIMIT 1`).get() as
    | { device_id: string; device_name: string; api_key_encrypted: string; paired_at: string }
    | undefined;
  if (!row) return undefined;
  return {
    deviceId: row.device_id,
    deviceName: row.device_name,
    apiKey: decryptField(row.api_key_encrypted),
    pairedAt: row.paired_at,
  };
}

export function saveDevice(device: DeviceRecord): void {
  getDb()
    .prepare(
      `INSERT INTO Device (device_id, device_name, api_key_encrypted, paired_at)
       VALUES (@deviceId, @deviceName, @apiKeyEncrypted, @pairedAt)
       ON CONFLICT(device_id) DO UPDATE SET device_name=excluded.device_name`
    )
    .run({
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      apiKeyEncrypted: encryptField(device.apiKey),
      pairedAt: device.pairedAt,
    });
}

// ---- Routine ----

export function upsertRoutine(routine: RoutineRecord): void {
  getDb()
    .prepare(
      `INSERT INTO Routine (routine_id, name, type, created_at, updated_at, script_ref)
       VALUES (@routineId, @name, @type, @createdAt, @updatedAt, @scriptRef)
       ON CONFLICT(routine_id) DO UPDATE SET
         name=excluded.name, updated_at=excluded.updated_at, script_ref=excluded.script_ref`
    )
    .run(routine);
}

export function getRoutine(routineId: string): RoutineRecord | undefined {
  const row = getDb().prepare(`SELECT * FROM Routine WHERE routine_id = ?`).get(routineId) as
    | any
    | undefined;
  if (!row) return undefined;
  return rowToRoutine(row);
}

export function listRoutines(): RoutineRecord[] {
  const rows = getDb().prepare(`SELECT * FROM Routine ORDER BY updated_at DESC`).all() as any[];
  return rows.map(rowToRoutine);
}

export function deleteRoutine(routineId: string): void {
  getDb().prepare(`DELETE FROM Routine WHERE routine_id = ?`).run(routineId);
}

function rowToRoutine(row: any): RoutineRecord {
  return {
    routineId: row.routine_id,
    name: row.name,
    type: row.type as RoutineType,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    scriptRef: row.script_ref,
  };
}

// ---- RoutineTrigger ----

export function setTriggers(routineId: string, phrases: string[]): void {
  const database = getDb();
  const del = database.prepare(`DELETE FROM RoutineTrigger WHERE routine_id = ?`);
  const ins = database.prepare(`INSERT INTO RoutineTrigger (routine_id, phrase) VALUES (?, ?)`);
  const tx = database.transaction((rid: string, list: string[]) => {
    del.run(rid);
    for (const phrase of list) {
      if (phrase.trim()) ins.run(rid, phrase.trim());
    }
  });
  tx(routineId, phrases);
}

export function getTriggers(routineId: string): string[] {
  const rows = getDb()
    .prepare(`SELECT phrase FROM RoutineTrigger WHERE routine_id = ?`)
    .all(routineId) as { phrase: string }[];
  return rows.map((r) => r.phrase);
}

export function listAllTriggers(): RoutineTriggerRecord[] {
  const rows = getDb().prepare(`SELECT routine_id, phrase FROM RoutineTrigger`).all() as any[];
  return rows.map((r) => ({ routineId: r.routine_id, phrase: r.phrase }));
}

function normalizePhrase(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Free-text matching for run_routine's `query` argument. Deliberately
 * simple (normalized bidirectional substring match, longest matching
 * trigger wins if several routines qualify) rather than semantic/NLP
 * matching - TANY DESKTOP has no LLM in the run-time path by design (spec
 * section 1: replay is deterministic). Ambiguous ties resolve to whichever
 * matching trigger is found first; not worth more sophistication until
 * real usage shows it's needed.
 */
export function findRoutineByQuery(query: string): RoutineRecord | undefined {
  const normalizedQuery = normalizePhrase(query);
  if (!normalizedQuery) return undefined;

  let best: { routineId: string; len: number } | undefined;
  for (const t of listAllTriggers()) {
    const normalizedPhrase = normalizePhrase(t.phrase);
    if (!normalizedPhrase) continue;
    if (normalizedQuery.includes(normalizedPhrase) || normalizedPhrase.includes(normalizedQuery)) {
      if (!best || normalizedPhrase.length > best.len) {
        best = { routineId: t.routineId, len: normalizedPhrase.length };
      }
    }
  }
  return best ? getRoutine(best.routineId) : undefined;
}

/**
 * Duplicate-trigger guard (exact match, not the fuzzy matching above) - two
 * routines sharing a trigger phrase would make findRoutineByQuery's result
 * arbitrary, so this is enforced at save time instead.
 */
export function findRoutineByExactTrigger(
  phrase: string,
  excludingRoutineId?: string
): RoutineRecord | undefined {
  const normalizedPhrase = normalizePhrase(phrase);
  for (const t of listAllTriggers()) {
    if (t.routineId === excludingRoutineId) continue;
    if (normalizePhrase(t.phrase) === normalizedPhrase) {
      return getRoutine(t.routineId);
    }
  }
  return undefined;
}

// ---- Credential ----

export function saveCredential(routineId: string, payload: CredentialPayload): string {
  const credentialId = `cred_${uuidv4()}`;
  getDb()
    .prepare(
      `INSERT INTO Credential (credential_id, routine_id, encrypted_payload) VALUES (?, ?, ?)`
    )
    .run(credentialId, routineId, encryptField(JSON.stringify(payload)));
  return credentialId;
}

export function replaceCredential(routineId: string, payload: CredentialPayload): void {
  const database = getDb();
  database.prepare(`DELETE FROM Credential WHERE routine_id = ?`).run(routineId);
  saveCredential(routineId, payload);
}

export function getCredentialForRoutine(routineId: string): CredentialRecord | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM Credential WHERE routine_id = ? LIMIT 1`)
    .get(routineId) as { credential_id: string; routine_id: string; encrypted_payload: string } | undefined;
  if (!row) return undefined;
  return {
    credentialId: row.credential_id,
    routineId: row.routine_id,
    payload: JSON.parse(decryptField(row.encrypted_payload)),
  };
}

// ---- RunLog ----

export function startRunLog(routineId: string, requestId?: string): string {
  const runId = `run_${uuidv4()}`;
  getDb()
    .prepare(
      `INSERT INTO RunLog (run_id, routine_id, request_id, status, started_at)
       VALUES (?, ?, ?, 'running', ?)`
    )
    .run(runId, routineId, requestId ?? null, new Date().toISOString());
  return runId;
}

export function finishRunLog(
  runId: string,
  status: RunStatus,
  extra: { failedStep?: number; reason?: string; message?: string } = {}
): void {
  getDb()
    .prepare(
      `UPDATE RunLog SET status = ?, failed_step = ?, reason = ?, message = ?, finished_at = ?
       WHERE run_id = ?`
    )
    .run(
      status,
      extra.failedStep ?? null,
      extra.reason ?? null,
      extra.message ?? null,
      new Date().toISOString(),
      runId
    );
}

export function getLastRunForRoutine(routineId: string): RunLogRecord | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM RunLog WHERE routine_id = ? ORDER BY started_at DESC LIMIT 1`)
    .get(routineId) as any | undefined;
  if (!row) return undefined;
  return rowToRunLog(row);
}

export function listRunLogsForRoutine(routineId: string, limit = 20): RunLogRecord[] {
  const rows = getDb()
    .prepare(`SELECT * FROM RunLog WHERE routine_id = ? ORDER BY started_at DESC LIMIT ?`)
    .all(routineId, limit) as any[];
  return rows.map(rowToRunLog);
}

function rowToRunLog(row: any): RunLogRecord {
  return {
    runId: row.run_id,
    routineId: row.routine_id,
    requestId: row.request_id ?? undefined,
    status: row.status,
    failedStep: row.failed_step ?? undefined,
    reason: row.reason ?? undefined,
    message: row.message ?? undefined,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
  };
}
