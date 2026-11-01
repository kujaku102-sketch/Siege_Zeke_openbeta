// Flow check: title -> tutorial list -> a tutorial starts and its first move is accepted (real clicks to start, the test hook to read the script's step).
// Every tutorial in the data is started from the list; the guide opens inside the screen on a PC and on a phone-sized touch screen; the first move of
// the script is made from what its `expect` says (parts/tutorial.mjs), and the match accepted it.
import { TUTORIAL_ITEMS } from "../../../src/ui-refresh/tutorial-items.js";
import { openBrowser, assertNoErrors } from "../parts/browser.mjs";
import { clickEntryControl } from "../parts/entry.mjs";
import { playTutorial } from "../parts/tutorial.mjs";

const { browser, errors, newPage } = await openBrowser();
const inside = (page) => page.locator(".live-guide").evaluate((node) => { const r = node.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; });
try {
  const seen = [];
  for (const item of TUTORIAL_ITEMS) {
    const page = await newPage();
    await clickEntryControl(page, '[data-mode="tutorial"]');
    await page.locator(`[data-start="tutorial"][data-tutorial-id="${item.id}"]`).click();
    await page.locator(".live-guide").waitFor({ state: "visible", timeout: 5000 });
    if (!await inside(page)) throw new Error(`${item.id}: the guide is not inside the screen`);
    const played = await playTutorial(page, item.id, { stopAfterMoves: 1 });
    if (played.moves < 1) throw new Error(`${item.id}: no first move was made (${JSON.stringify(played)})`);
    seen.push({ id: item.id, stepsToFirstMove: played.steps });
    await page.close();
  }
  const phone = await newPage({ viewport: { width: 844, height: 390 }, touch: true, path: "mobile/" });
  await clickEntryControl(phone, '[data-mode="tutorial"]');
  await phone.locator(`[data-start="tutorial"][data-tutorial-id="${TUTORIAL_ITEMS[0].id}"]`).click();
  await phone.locator(".live-guide").waitFor({ state: "visible", timeout: 5000 });
  if (!await inside(phone)) throw new Error("the phone guide is not inside the screen");
  assertNoErrors(errors, "tutorial-start");
  console.log(JSON.stringify({ suite: "flow/tutorial-start", tutorials: seen, phoneGuide: true, ok: true }));
} finally {
  await browser.close();
}
