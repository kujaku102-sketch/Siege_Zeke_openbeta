// Flow check: a CPU match opens by the rulebook's 2.4 (2026-11-05; real clicks and a real drag, the public build, no hook).
// The opening hand lies on its own screen with キープ; a tap marks a card (it rises with 「戻す」) and a second tap lets it go;
// a drag up marks another; the button reads 「N枚引き直す」 and redraws them (as many new cards come in); the CPU decides
// (「相手が手札を決めています」 may flash by); the dice's answer shows and nothing is played until it is gone; the turn
// control works. ?opening=legacy starts the
// old way with no opening screen.
import { openBrowser, assertNoErrors, until } from "../parts/browser.mjs";
import { clickEntryControl } from "../parts/entry.mjs";

const { browser, errors, newPage } = await openBrowser();
try {
  const page = await newPage({ hook: false });
  await clickEntryControl(page, '[data-flow="open-battle"]');
  await page.locator('[data-start="ai"]').click();
  await page.locator(".r2-opening [data-opening-decide]").waitFor({ timeout: 15000 });
  const decide = page.locator("[data-opening-decide]");
  if (await decide.innerText() !== "キープ") throw new Error("nothing marked reads キープ");
  const cards = page.locator("[data-opening-card]");
  const dealt = await cards.evaluateAll(list => list.map(node => node.dataset.openingCard));
  if (await page.locator(".wf-extra-action").count()) throw new Error("the board's own keep/redraw buttons are not shown under the screen");

  // A tap marks the first card, a second tap lets it go; taps mark the first and second.
  await cards.nth(0).click();
  await until(page, () => document.querySelectorAll(".r2-opening-card.is-marked").length === 1, null, "a tap marks a card");
  await cards.nth(0).click();
  await until(page, () => !document.querySelector(".r2-opening-card.is-marked"), null, "a second tap lets it go");
  await cards.nth(0).click();
  // A drag up marks another.
  const box = await cards.nth(1).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * .1, { steps: 6 });
  await page.mouse.up();
  await until(page, () => document.querySelectorAll(".r2-opening-card.is-marked").length === 2, null, "a drag up marks a card");
  const marked = await page.locator(".r2-opening-card.is-marked").evaluateAll(list => list.map(node => node.dataset.openingCard));
  if (await page.locator(".r2-opening-card.is-marked .r2-opening-badge").count() !== 2) throw new Error("a marked card wears the board tag 「戻す」");
  if (await decide.innerText() !== "2枚引き直す") throw new Error(`the button reads ${await decide.innerText()}`);

  await decide.click();
  // The opening ends: the dice's answer shows, then goes; the turn control is somebody's turn 1.
  await page.locator("[data-opening-first]").waitFor({ timeout: 20000 });
  const first = (await page.locator("[data-opening-first] b").innerText()).trim();
  if (!["先攻", "後攻"].includes(first)) throw new Error(`the dice say ${first}`);
  // Nothing is played while the dice's answer shows: the CPU's hand count stays as it is until the line is gone.
  const moved = await page.evaluate(() => new Promise(resolve => {
    const count = () => document.querySelector(".wf-opp-hand output")?.textContent;
    const start = count(), seen = new Set([start]);
    const watch = new MutationObserver(() => {
      if (!document.querySelector("[data-opening-first]")) { watch.disconnect(); resolve([...seen]); return; }
      seen.add(count());
    });
    watch.observe(document.body, { subtree: true, childList: true, characterData: true });
  }));
  if (moved.length > 1) throw new Error(`the CPU played while the dice's answer showed: ${moved}`);
  await page.locator("[data-opening-first]").waitFor({ state: "detached", timeout: 10000 });
  const hand = await page.locator(".r2-hand [data-card-ref]").evaluateAll(list => list.map(node => node.dataset.cardRef));
  if (marked.some(ref => hand.includes(ref)) || hand.length !== dealt.length + (first === "先攻" ? 1 : 0)) throw new Error("the two returned are gone and as many drawn (the first player draws one more on its first turn)");
  await until(page, () => { const turn = document.querySelector("[data-runtime-end-turn]"); return turn?.dataset.turnSide === "mine" && !turn.disabled; }, null, "the player's turn", 30000);
  await page.close();

  const legacy = await newPage({ hook: false, path: "?opening=legacy" });
  await clickEntryControl(legacy, '[data-flow="open-battle"]');
  await legacy.locator('[data-start="ai"]').click();
  await legacy.locator(".r2-board").first().waitFor({ state: "attached", timeout: 15000 });
  await until(legacy, () => { const turn = document.querySelector("[data-runtime-end-turn]"); return turn?.dataset.turnSide === "mine" && turn.dataset.turn === "1"; }, null, "the old start: the player first");
  if (await legacy.locator(".r2-opening").count()) throw new Error("?opening=legacy has no opening screen");
  assertNoErrors(errors, "opening");
  console.log(JSON.stringify({ suite: "flow/opening", dealt: dealt.length, returned: marked.length, first, ok: true }));
} finally {
  await browser.close();
}
