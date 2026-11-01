// Flow check: title -> battle setup -> a match against the CPU starts (real clicks, the public build, no test hook).
// On a PC the board, console and hand are mounted as separate layers and the turn control ends the turn; the CPU plays; the control is the player's again
// as the 2nd turn. On a phone-sized touch screen a tap on a hand card opens its detail (with the effect copy) and its operation popup, both inside the screen.
import { openBrowser, assertNoErrors } from "../parts/browser.mjs";
import { clickEntryControl } from "../parts/entry.mjs";

const { browser, errors, newPage } = await openBrowser();
try {
  const page = await newPage({ hook: false });
  await clickEntryControl(page, '[data-mode="ai"]');
  await page.locator('[data-start="ai"]').click();
  if (!await page.locator(".r2-board").count() || !await page.locator(".r2-console").count() || !await page.locator(".r2-hand").count()) throw new Error("the match did not mount the separated board, console and hand layers");
  await page.locator("[data-runtime-end-turn]").click();
  // The turn control counts each side's own turns: once the CPU is done it is enabled again as the player's 2nd turn.
  await page.waitForFunction(() => { const turn = document.querySelector("[data-runtime-end-turn]"); return turn?.dataset.turnSide === "mine" && turn.dataset.turn === "2" && !turn.disabled; }, null, { timeout: 15000 });
  await page.close();

  const phone = await newPage({ viewport: { width: 844, height: 390 }, touch: true, hook: false, path: "mobile/" });
  await clickEntryControl(phone, '[data-mode="ai"]');
  await phone.locator('[data-start="ai"]').click();
  await phone.locator(".r2-hand [data-card-ref]").first().click();
  const detail = await phone.locator(".r2-detail").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { effect: (node.querySelector(".card-effect-copy")?.textContent?.trim().length ?? 0) > 0, inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight };
  });
  if (!detail.effect || !detail.inViewport || !await phone.locator(".r2-popup").count()) throw new Error(`phone card detail or operation popup is invalid: ${JSON.stringify(detail)}`);
  assertNoErrors(errors, "battle-start");
  console.log(JSON.stringify({ suite: "flow/battle-start", pc: true, phoneDetail: true, ok: true }));
} finally {
  await browser.close();
}
