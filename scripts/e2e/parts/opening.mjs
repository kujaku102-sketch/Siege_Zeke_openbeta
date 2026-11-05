// A CPU match opens by the rulebook's 2.4 (2026-11-05): each user keeps or redraws before the first turn, and dice decide
// who goes first. keepOpening presses キープ on the opening screen and waits until the opening and its dice banner are gone
// and the turn control is the player's (the CPU may play its first turn before that). Returns the player's turn number then.
export async function keepOpening(page, timeout = 30000) {
  await page.locator("[data-opening-decide]").click();
  await page.waitForFunction(() => !document.querySelector(".r2-opening, [data-opening-first]"), null, { timeout });
  await page.waitForFunction(() => { const turn = document.querySelector("[data-runtime-end-turn]"); return turn?.dataset.turnSide === "mine" && !turn.disabled; }, null, { timeout });
  return Number(await page.locator("[data-runtime-end-turn]").getAttribute("data-turn"));
}
