import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  getRoutine,
  findRoutineByQuery,
  getCredentialForRoutine,
  loadRoutineDefinition,
  loadAuthState,
  startRunLog,
  finishRunLog,
  type RunRoutineResult,
} from "@tany-desktop/shared";
import { resolveEngine, webEngine } from "./engines";

// continuation_token -> the RunLog row it belongs to, so submit_otp can
// close out the same log entry run_routine opened (spec section 15: RunLog).
const tokenToRunId = new Map<string, string>();

function toCallToolResult(result: RunRoutineResult): CallToolResult {
  return {
    structuredContent: result as unknown as Record<string, unknown>,
    content: [{ type: "text", text: JSON.stringify(result) }],
  };
}

function recordOutcome(runId: string, result: RunRoutineResult): void {
  if (result.status === "awaiting_otp") {
    tokenToRunId.set(result.continuation_token, runId);
    finishRunLog(runId, "awaiting_otp");
  } else if (result.status === "success") {
    finishRunLog(runId, "success");
  } else if (result.status === "no_match") {
    finishRunLog(runId, "failed", { reason: "no_match", message: result.message });
  } else {
    finishRunLog(runId, "failed", {
      failedStep: result.failed_step,
      reason: result.reason,
      message: result.message,
    });
  }
}

/**
 * Builds the MCP server exposing exactly the two tools defined in spec
 * section 14: run_routine and submit_otp. One instance is created per HTTP
 * request (stateless Streamable HTTP - see index.ts), but the actual paused
 * browser sessions live in engine-web's module-level map, so state survives
 * across requests even though the McpServer object itself doesn't.
 */
export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "tany-desktop", version: "0.1.0" });

  server.tool(
    "run_routine",
    "מריץ שגרה שמורה במחשב הלקוח לפי routine_id ידוע, או לפי query בשפה חופשית שמותאם מול ניסוחי ההפעלה השמורים מקומית. מחזיר תוצאה, בקשת OTP, no_match, או כשל. " +
      "אין tool נפרד לרשימת שגרות זמינות - אין דרך לדעת מראש אילו routine_id קיימים. אלא אם routine_id מדויק כבר ידוע ממקור אמין (למשל הוחזר בתוצאה של קריאה קודמת ל-run_routine או ל-submit_otp), יש להעביר תמיד query עם הניסוח המקורי של המשתמש כלשונו. לעולם אין לנחש, להמציא, לתרגם או לקצר routine_id - ניחוש יגרום לכשל routine_not_found.",
    {
      routine_id: z
        .string()
        .optional()
        .describe(
          "מזהה שגרה מדויק - יש להעביר רק אם הוא כבר ידוע בוודאות ממקור אמין (למשל הוחזר בעבר מ-run_routine או מרשימה מוסמכת אחרת). אסור בהחלט לנחש, להמציא או לשחזר ממורח את השם (למשל 'rtn_expenses_super') - ניחוש שגוי תמיד ייכשל. אם אין ודאות כזו, יש להשאיר שדה זה ריק ולהעביר query במקום."
        ),
      query: z
        .string()
        .optional()
        .describe(
          "ברירת המחדל כש-routine_id אינו ידוע ממקור אמין: הניסוח המקורי והמלא של המשתמש כפי שנכתב, בלי לתרגם, לקצר, לנרמל או לנחש מזהה טכני מתוכו. לדוגמה 'מה מצב העו\"ש' - מותאם מול ה-triggers המקומיים בצד הלקוח."
        ),
      requested_by: z.string().optional().describe("whatsapp_user_id של המשתמש שביקש"),
    },
    async ({ routine_id, query, requested_by }) => {
      if (!routine_id && !query) {
        return toCallToolResult({
          status: "failed",
          failed_step: -1,
          reason: "invalid_arguments",
          message: "יש לספק routine_id או query",
        });
      }

      const routine = routine_id ? getRoutine(routine_id) : findRoutineByQuery(query!);
      if (!routine) {
        if (routine_id) {
          return toCallToolResult({
            status: "failed",
            failed_step: -1,
            reason: "routine_not_found",
            message: `שגרה '${routine_id}' לא נמצאה במאגר המקומי`,
          });
        }
        return toCallToolResult({
          status: "no_match",
          message: `לא נמצאה שגרה שמתאימה ל-"${query}"`,
        });
      }

      const definition = loadRoutineDefinition(routine.scriptRef);
      const credential = getCredentialForRoutine(routine.routineId)?.payload;
      const authState = loadAuthState(routine.routineId);
      const runId = startRunLog(routine.routineId, requested_by);

      const engine = resolveEngine(routine.type);
      const result = await engine.run(definition, credential, requested_by, authState);
      recordOutcome(runId, result);
      return toCallToolResult(result);
    }
  );

  server.tool(
    "submit_otp",
    "ממשיך שגרה שהמתינה ל-OTP, לאחר שהמשתמש מסר את הקוד ב-TANY.",
    {
      continuation_token: z.string(),
      otp_code: z.string(),
    },
    async ({ continuation_token, otp_code }) => {
      const runId = tokenToRunId.get(continuation_token);
      tokenToRunId.delete(continuation_token);

      const result = await webEngine.submitOtp(continuation_token, otp_code);
      if (runId) recordOutcome(runId, result);
      return toCallToolResult(result);
    }
  );

  return server;
}
