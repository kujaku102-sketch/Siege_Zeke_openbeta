// Flow check: a match ends on the end screen and each of its buttons leaves for the right place.
// A match is won by playing (sandbox: the one Sp in the data that hurts the opponent's user is added and played until the user's STR is 0 - no card is named,
// it is found from the card text), so the end screen is the real one:
//   CONGRATULATION! with [対戦ログを保存] [対戦メニューに戻る] [ホームに戻る]; the saved log is this match's; seen from the other seat the same screen reads DEFEAT;
//   [対戦メニューに戻る] leaves for the battle setup with no match left; in a second match [ホームに戻る] leaves for the title.
// The tutorial's own end screen (CONGRATULATION! with [チュートリアル選択へ] and [ホームに戻る], and no log button) is checked by flow/tutorial-full and screen/end.
import { readFileSync } from "node:fs";
import { CARD_LIBRARY } from "../../../src/data/cards.js";
import { openBrowser, assertNoErrors } from "../parts/browser.mjs";
import { makeUi } from "../parts/play.mjs";

// The cheapest Sp whose text deals damage to the opponent's user and needs nothing else (found from the data).
const damagingSp = Object.values(CARD_LIBRARY).filter((card) => card.category === "Sp" && /相手ユーザーに\d+ダメージ/.test(card.text ?? "") && !/その後|破壊/.test(card.text ?? ""))
  .sort((a, b) => a.cost - b.cost || (a.text ?? "").length - (b.text ?? "").length || a.id.localeCompare(b.id))[0];
if (!damagingSp) throw new Error("no Sp in the data hurts the opponent's user: this e2e has no way to end a match");

const { browser, errors, newPage } = await openBrowser();
const BUTTONS = "対戦ログを保存,対戦メニューに戻る,ホームに戻る";

async function wonMatch() {
  const page = await newPage();
  await page.waitForFunction(() => document.body.classList.contains("boot-done") && !document.querySelector("#boot-splash"), null, { timeout: 10000 });
  const started = await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.start("sandbox", "basics", 1));
  if (!started.ok) throw new Error(JSON.stringify(started));
  const ui = makeUi(page);
  const viewer = (seat) => page.evaluate((id) => window.__SIMPLE_ZEKE_E2E__.switchViewer(id), seat);
  const opponentStr = async () => (await ui.query()).observation.seats.find((seat) => seat.seatId === "ai").fortressStr;
  // Choices the opponent has to answer (a response window) are answered from its own seat, then the view comes back.
  const settleBoth = async () => {
    for (let guard = 0; guard < 20; guard += 1) {
      const input = (await ui.query()).requiredInput; if (!input) break;
      if (input.actorSeat !== "player") await viewer(input.actorSeat);
      if ((await ui.query()).requiredInput?.optional) await ui.click("[data-runtime-decline]"); else await ui.settle();
      if (input.actorSeat !== "player") await viewer("player");
    }
  };
  const addCard = (id) => page.evaluate((definitionId) => window.__SIMPLE_ZEKE_E2E__.sandbox({ type: "sandboxAddCard", definitionId, targetSeat: "player" }), id);
  await addCard(damagingSp.id); // one card is kept in hand to the end: a finished match must refuse to play it
  for (let shots = 0; await opponentStr() > 0 && shots < 40; shots += 1) {
    const added = await addCard(damagingSp.id);
    if (!added?.ok || added.value.kind !== "accepted") throw new Error(`the sandbox refused to add a card: ${JSON.stringify(added)}`);
    await ui.action("executeSpell", damagingSp.id, {});
    await settleBoth();
  }
  await page.locator(".r2-result").waitFor({ state: "visible", timeout: 5000 }).catch(() => { throw new Error("the match did not end on the end screen"); });
  return { page, ui, viewer };
}
// a finished match takes no new play
async function refusesPlay(page, ui) {
  const q = await ui.query();
  const spare = q.observation.seats.find((seat) => seat.seatId === "player").hand.cards.find((card) => !card.faceDown && card.definition.id === damagingSp.id);
  if (!spare) throw new Error("no card was left in hand to try a play after the end");
  const result = await page.evaluate((input) => window.__SIMPLE_ZEKE_E2E__.submit(input), { commandId: "after-the-end", expectedRevision: q.status.revision, action: { type: "executeSpell", cardRef: spare.cardRef, targets: [], selectionScope: null } });
  if (result?.ok && result.value.kind === "accepted") throw new Error("a finished match accepted a new play");
}
const endScreen = (page) => page.evaluate(() => ({ outcome: document.querySelector(".r2-result")?.dataset.outcome, title: document.querySelector(".r2-result h2")?.textContent,
  buttons: [...document.querySelectorAll(".r2-result-actions button")].map((b) => b.textContent).join() }));

try {
  const first = await wonMatch();
  let end = await endScreen(first.page);
  if (end.outcome !== "win" || end.title !== "CONGRATULATION!" || end.buttons !== BUTTONS) throw new Error(`win end screen wrong ${JSON.stringify(end)}`);
  await refusesPlay(first.page, first.ui);
  // the saved log is this match's
  const finishedId = (await first.page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.scope())).matchId;
  const [download] = await Promise.all([first.page.waitForEvent("download", { timeout: 5000 }), first.ui.click(".r2-result [data-runtime-save-log]")]);
  const savedLog = JSON.parse(readFileSync(await download.path(), "utf8"));
  if (savedLog.items?.length !== 1 || savedLog.items[0].matchId !== finishedId || savedLog.items[0].finished !== true) throw new Error(`the saved log is not this match: ${JSON.stringify({ kind: savedLog.kind, items: savedLog.items?.length })}`);
  // the other seat sees the defeat
  await first.viewer("ai");
  await first.page.waitForFunction(() => document.querySelector(".r2-result")?.dataset.outcome === "defeat", null, { timeout: 3000 }).catch(() => {});
  end = await endScreen(first.page);
  if (end.outcome !== "defeat" || end.title !== "DEFEAT" || end.buttons !== BUTTONS) throw new Error(`defeat end screen wrong ${JSON.stringify(end)}`);
  await first.ui.click(".r2-result [data-runtime-to-menu]");
  await first.page.locator('[data-flow-screen="battle-setup"]').waitFor({ state: "visible", timeout: 5000 }).catch(() => { throw new Error("[対戦メニューに戻る] did not reach the battle setup"); });
  if (await first.page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.scope()) !== null) throw new Error("the match stayed after [対戦メニューに戻る]");
  await first.page.close();

  const second = await wonMatch();
  await second.ui.click(".r2-result [data-runtime-title]");
  await second.page.locator(".r2-entry").waitFor({ state: "visible", timeout: 5000 }).catch(() => { throw new Error("[ホームに戻る] did not reach the title"); });
  if (await second.page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.scope()) !== null) throw new Error("the match stayed after [ホームに戻る]");
  assertNoErrors(errors, "end-buttons");
  console.log(JSON.stringify({ suite: "flow/end-buttons", card: damagingSp.id, win: true, finishedRefusesPlay: true, savedLog: true, defeatFromOtherSeat: true, toMenu: true, toTitle: true, ok: true }));
} finally {
  await browser.close();
}
