/**
 * Smoke test for the replay engine (packages/engine-web/src/player.ts).
 * Recording itself needs an interactive display (Playwright codegen opens a
 * real browser window), so it can't be exercised headlessly here. This
 * instead builds a RoutineDefinition by hand - equivalent to what the
 * recorder+parser would produce - and drives it against a local fixture
 * page to prove goto/fill/click/waitForSelector/extract, credential
 * injection, the OTP pause/resume flow, and failure reporting all work.
 *
 * Run with: node test/replay.smoketest.js  (after `npm run build`)
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

process.env.TANY_DESKTOP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tany-desktop-test-"));
process.env.TANY_DESKTOP_RUN_TIMEOUT_MS = process.env.TANY_DESKTOP_RUN_TIMEOUT_MS || "4000";

const { WebEngine } = require("../dist/WebEngine");

const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "test-routine.html"));

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(fixture);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function baseDefinition(port, overrides = {}) {
  return {
    routineId: "rtn_test",
    name: "Test routine",
    type: "web",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startUrl: `http://127.0.0.1:${port}/`,
    outputFields: ["balance"],
    steps: [
      { index: 0, type: "goto", url: `http://127.0.0.1:${port}/` },
      { index: 1, type: "fill", selectorKind: "css", selector: "#username", credentialField: "username" },
      { index: 2, type: "fill", selectorKind: "css", selector: "#password", credentialField: "password" },
      { index: 3, type: "click", selectorKind: "css", selector: "#login-btn" },
      { index: 4, type: "waitForSelector", selectorKind: "css", selector: "#otp-input" },
      { index: 5, type: "otp_injection", selectorKind: "css", selector: "#otp-input", promptHint: "קוד אימות" },
      { index: 6, type: "click", selectorKind: "css", selector: "#otp-btn" },
      { index: 7, type: "waitForSelector", selectorKind: "css", selector: "#balance" },
      { index: 8, type: "extract", selectorKind: "css", selector: "#balance", extractAs: "balance" },
    ],
    ...overrides,
  };
}

function assert(cond, message) {
  if (!cond) throw new Error("ASSERTION FAILED: " + message);
  console.log("  ok - " + message);
}

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const engine = new WebEngine();

  try {
    console.log("Test 1: success path with credential injection + OTP pause/resume");
    const def = baseDefinition(port);
    const credential = { username: "demo", password: "secret" };

    const paused = await engine.run(def, credential);
    assert(paused.status === "awaiting_otp", `expected awaiting_otp, got ${paused.status}`);
    assert(!!paused.continuation_token, "continuation_token present");
    assert(paused.prompt_hint === "קוד אימות", "prompt_hint carried through");

    const done = await engine.submitOtp(paused.continuation_token, "123456");
    assert(done.status === "success", `expected success, got ${JSON.stringify(done)}`);
    assert(done.result.balance.includes("4,320"), `expected balance to contain 4,320, got ${done.result.balance}`);

    console.log("Test 2: wrong OTP code does not fail hard, error text stays on page (no crash)");
    const paused2 = await engine.run(baseDefinition(port), credential);
    const stillFailing = await engine.submitOtp(paused2.continuation_token, "000000");
    // otp-btn click succeeds but #balance never appears -> waitForSelector times out -> failed_step 7
    assert(stillFailing.status === "failed", `expected failed, got ${stillFailing.status}`);
    assert(stillFailing.failed_step === 7, `expected failure at step 7, got ${stillFailing.failed_step}`);
    assert(stillFailing.reason === "element_not_found", `expected element_not_found, got ${stillFailing.reason}`);

    console.log("Test 3: expired/unknown continuation_token is reported cleanly");
    const expired = await engine.submitOtp("cont_does_not_exist", "123456");
    assert(expired.status === "failed" && expired.reason === "otp_expired", "unknown token -> otp_expired");

    console.log("Test 4: missing selector on the login page fails at the right step");
    const badDef = baseDefinition(port, {
      steps: [
        { index: 0, type: "goto", url: `http://127.0.0.1:${port}/` },
        { index: 1, type: "click", selectorKind: "css", selector: "#does-not-exist" },
      ],
    });
    const badResult = await engine.run(badDef, credential);
    assert(badResult.status === "failed", `expected failed, got ${badResult.status}`);
    assert(badResult.failed_step === 1, `expected failure at step 1, got ${badResult.failed_step}`);

    console.log("Test 5: optional step with a missing element is skipped, run still succeeds");
    const withOptionalPopupClose = baseDefinition(port, {
      steps: [
        { index: 0, type: "goto", url: `http://127.0.0.1:${port}/` },
        // Simulates a cookie-consent/promo popup close button that isn't
        // actually present on this fixture page at all - should be skipped,
        // not fail the run, because it's marked optional.
        { index: 1, type: "click", selectorKind: "css", selector: "#does-not-exist", optional: true },
        { index: 2, type: "fill", selectorKind: "css", selector: "#username", credentialField: "username" },
        { index: 3, type: "fill", selectorKind: "css", selector: "#password", credentialField: "password" },
        { index: 4, type: "click", selectorKind: "css", selector: "#login-btn" },
        { index: 5, type: "waitForSelector", selectorKind: "css", selector: "#otp-input" },
        { index: 6, type: "otp_injection", selectorKind: "css", selector: "#otp-input", promptHint: "קוד אימות" },
        { index: 7, type: "click", selectorKind: "css", selector: "#otp-btn" },
        { index: 8, type: "waitForSelector", selectorKind: "css", selector: "#balance" },
        { index: 9, type: "extract", selectorKind: "css", selector: "#balance", extractAs: "balance" },
      ],
    });
    const pausedOptional = await engine.run(withOptionalPopupClose, credential);
    assert(pausedOptional.status === "awaiting_otp", `expected awaiting_otp past the skipped optional step, got ${pausedOptional.status}`);
    const doneOptional = await engine.submitOtp(pausedOptional.continuation_token, "123456");
    assert(doneOptional.status === "success", `expected success, got ${JSON.stringify(doneOptional)}`);
    assert(doneOptional.result.balance.includes("4,320"), "run completed normally despite the missing optional element");

    console.log("Test 6: a *non-optional* missing element still fails normally (optional isn't a blanket bypass)");
    const nonOptionalStillFails = baseDefinition(port, {
      steps: [
        { index: 0, type: "goto", url: `http://127.0.0.1:${port}/` },
        { index: 1, type: "click", selectorKind: "css", selector: "#does-not-exist" },
      ],
    });
    const stillFails = await engine.run(nonOptionalStillFails, credential);
    assert(stillFails.status === "failed", `expected failed, got ${stillFails.status}`);
    assert(stillFails.failed_step === 1, `expected failure at step 1, got ${stillFails.failed_step}`);

    console.log("\nAll replay engine smoke tests passed.");
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
