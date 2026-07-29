import { chromium } from "playwright";
import { config, type AuthState } from "@tany-desktop/shared";

/**
 * Loads a saved session (authState) and makes one real request against
 * startUrl, headlessly - purely to generate genuine HTTP activity against
 * the site. Session timeouts on most sites (banks especially) are
 * server-side, based on time since the last request, not client-side
 * mouse/keyboard idleness - moving the mouse locally does nothing for
 * that; an actual authenticated page load does. Returns the (possibly
 * updated, if the site issued fresh rolling cookies) session state to
 * re-save, exactly like a routine run does after using a saved session.
 */
export async function keepSessionAlive(startUrl: string, authState: AuthState): Promise<AuthState> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: authState as any });
    const page = await context.newPage();
    await page.goto(startUrl, { waitUntil: "load", timeout: config.runTimeoutMs });
    return (await context.storageState()) as AuthState;
  } finally {
    await browser.close();
  }
}
