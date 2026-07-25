/**
 * Smoke test for parseCodegenScript (packages/engine-web/src/parser.ts)
 * against a script shaped like Playwright codegen's real JS output.
 */
const { parseCodegenScript } = require("../dist/parser");

const sample = `
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://bank.example.com/login');
  await page.getByRole('textbox', { name: 'Username' }).click();
  await page.getByRole('textbox', { name: 'Username' }).fill('demo');
  await page.getByRole('textbox', { name: 'Password' }).fill('secret');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByPlaceholder('Enter code').fill('999999');
  await page.keyboard.press('Enter');
  await context.close();
  await browser.close();
})();
`;

function assert(cond, message) {
  if (!cond) throw new Error("ASSERTION FAILED: " + message);
  console.log("  ok - " + message);
}

const steps = parseCodegenScript(sample);
console.log(JSON.stringify(steps, null, 2));

assert(steps.length === 7, `expected 7 steps, got ${steps.length}`);
assert(steps[0].type === "goto" && steps[0].url.includes("login"), "step 0 is goto");
assert(steps[1].type === "click" && steps[1].selectorKind === "role" && steps[1].role === "textbox" && steps[1].name === "Username", "step 1 is click on Username textbox");
assert(steps[2].type === "fill" && steps[2].value === "demo" && steps[2].name === "Username", "step 2 fills Username with demo");
assert(steps[3].type === "fill" && steps[3].value === "secret" && steps[3].name === "Password", "step 3 fills Password with secret");
assert(steps[4].type === "click" && steps[4].name === "Log in", "step 4 clicks Log in button");
assert(steps[5].type === "fill" && steps[5].selectorKind === "placeholder" && steps[5].value === "999999", "step 5 fills placeholder-based OTP field");
assert(steps[6].type === "press" && steps[6].key === "Enter" && !steps[6].selectorKind, "step 6 is a bare page.keyboard.press");

console.log("\nAll parser smoke tests passed.");
