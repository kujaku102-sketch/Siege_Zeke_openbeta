// Flow check: on a tutorial line that is only to be read (its [次へ] showing), a tap on an empty place of the screen turns the line, and a press of the gear does not.
// Every tutorial is started and the line it opens on is used; where the line runs over pages, the tap turns a page (the same as a tap on the line).
import { TUTORIAL_ITEMS } from "../../../src/ui-refresh/tutorial-items.js";
import { openBrowser, assertNoErrors } from "../parts/browser.mjs";
import { makeUi } from "../parts/play.mjs";
import { startTutorial } from "../parts/tutorial.mjs";

const { browser, errors, newPage } = await openBrowser();
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
const where = (page) => page.evaluate(() => { const t = window.__SIMPLE_ZEKE_E2E__.tutorial().value; const g = document.querySelector(".live-guide");
  return JSON.stringify([t.flow.introIndex, t.flow.index, g?.dataset.guidePage ?? null]); });
// the screen is still settling when a line opens: the press is tried again until its target can be hit
async function clickWhenReady(ui, selector) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await ui.click(selector); }
    catch (error) { if (attempt >= 10 || !String(error.message).startsWith("visible target unavailable")) throw error; await ui.page.waitForTimeout(200); }
  }
}
try {
  const seen = [];
  for (const item of TUTORIAL_ITEMS.filter((entry) => !only || entry.id === only)) {
    const page = await newPage();
    await page.waitForFunction(() => document.body.classList.contains("boot-done") && !document.querySelector("#boot-splash"), null, { timeout: 10000 });
    await startTutorial(page, item.id);
    await page.locator(".live-guide").waitFor({ state: "visible", timeout: 5000 });
    await page.waitForFunction(() => !document.querySelector('.live-guide[data-paging="pending"]'), null, { timeout: 5000 }).catch(() => {});
    if (!await page.locator(".live-guide :is([data-runtime-guide-next],[data-runtime-tutorial-next])").first().isVisible()) throw new Error(`${item.id}: the opening line is not one to read`);
    const ui = makeUi(page);
    const start = await where(page);
    // the gear: opens the menu, the line stays; the menu is closed again
    await clickWhenReady(ui, "[data-runtime-menu]");
    await page.locator(".runtime-host-options, .r2-modal").first().waitFor({ state: "visible", timeout: 3000 });
    if (await where(page) !== start) throw new Error(`${item.id}: the gear turned the line`);
    await clickWhenReady(ui, '.runtime-host-options [data-live="close-options"]');
    await page.waitForFunction(() => !document.querySelector(".r2-modal"), null, { timeout: 3000 });
    // an empty place: a point of the screen that is not in a button, a card, the guide's speech or an open panel
    const point = await page.evaluate(() => { for (let y = 0.12; y < 0.95; y += 0.04) for (let x = 0.05; x < 0.97; x += 0.04) {
      const px = innerWidth * x, py = innerHeight * y, node = document.elementFromPoint(px, py);
      if (node && !node.closest("button,[data-card-ref],.live-guide,.r2-modal,a,input,select,textarea") && !document.querySelector(".r2-modal")) return { x: px, y: py }; }
      return null; });
    if (!point) throw new Error(`${item.id}: no empty place found on the screen`);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction((was) => { const t = window.__SIMPLE_ZEKE_E2E__.tutorial().value; const g = document.querySelector(".live-guide");
      return JSON.stringify([t.flow.introIndex, t.flow.index, g?.dataset.guidePage ?? null]) !== was; }, start, { timeout: 3000 })
      .catch(() => { throw new Error(`${item.id}: a tap on an empty place did not turn the line (${start})`); });
    seen.push({ id: item.id, from: start, to: await where(page) });
    await page.close();
  }
  assertNoErrors(errors, "tutorial-tap-turn");
  console.log(JSON.stringify({ suite: "flow/tutorial-tap-turn", tutorials: seen, ok: true }));
} finally {
  await browser.close();
}
