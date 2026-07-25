/**
 * Smoke test for TANY-DESKTOP-side trigger matching (findRoutineByQuery)
 * and the duplicate-trigger guard (findRoutineByExactTrigger), added so
 * TANY DESKTOP itself resolves free-text queries to a routine_id instead
 * of relying on TANY keeping a synced local cache.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

process.env.TANY_DESKTOP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tany-desktop-match-test-"));

const {
  upsertRoutine,
  setTriggers,
  saveRoutineDefinition,
  findRoutineByQuery,
  findRoutineByExactTrigger,
} = require("../dist/index.js");

function assert(cond, message) {
  if (!cond) throw new Error("ASSERTION FAILED: " + message);
  console.log("  ok - " + message);
}

function makeRoutine(routineId, name) {
  const def = {
    routineId,
    name,
    type: "web",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    outputFields: [],
    steps: [],
  };
  const scriptRef = saveRoutineDefinition(def);
  upsertRoutine({ routineId, name, type: "web", createdAt: def.createdAt, updatedAt: def.updatedAt, scriptRef });
}

console.log("Test 1: exact and substring matching");
makeRoutine("rtn_balance", "בדיקת יתרה");
setTriggers("rtn_balance", ['מה מצב העו"ש', "כמה כסף יש לי"]);

let match = findRoutineByQuery('מה מצב העו"ש');
assert(match && match.routineId === "rtn_balance", "exact phrase matches");

match = findRoutineByQuery('תבדוק בבקשה מה מצב העו"ש שלי');
assert(match && match.routineId === "rtn_balance", "trigger contained within a longer natural sentence matches");

match = findRoutineByQuery("מה השעה");
assert(match === undefined, "unrelated text does not match");

console.log("Test 2: most specific (longest) trigger wins across routines");
makeRoutine("rtn_super", "הוצאות סופר");
setTriggers("rtn_super", ["כמה כסף"]);
// "כמה כסף" (rtn_super) is a substring of "כמה כסף יש לי" (rtn_balance) -
// the longer, more specific trigger should win for this query.
match = findRoutineByQuery("כמה כסף יש לי החודש");
assert(match && match.routineId === "rtn_balance", `longest matching trigger wins, got ${match && match.routineId}`);

console.log("Test 3: duplicate-trigger guard");
let conflict = findRoutineByExactTrigger("כמה כסף", undefined);
assert(conflict && conflict.routineId === "rtn_super", "detects an existing exact-duplicate trigger");

conflict = findRoutineByExactTrigger("  כמה כסף  ", undefined);
assert(conflict && conflict.routineId === "rtn_super", "duplicate check normalizes whitespace");

conflict = findRoutineByExactTrigger("כמה כסף", "rtn_super");
assert(conflict === undefined, "excluding the routine's own id does not flag its own trigger as a conflict");

conflict = findRoutineByExactTrigger("ניסוח חדש לגמרי", undefined);
assert(conflict === undefined, "a genuinely new phrase has no conflict");

console.log("\nAll matching smoke tests passed.");
