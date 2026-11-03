// Flow check: a tutorial step that asks to try a card's play (its play button in the step's focus: kind "button", button "play") moves on at once when that card is
// dropped on the board, and the guide says why the play cannot work ("シンボル不足で実行できません"), with no dialog over the board.
// The steps are found from the script (src/data/tutorial-script.js) and from the step the match is on; no step number and no card is written here.
// Every tutorial that has such a step is played up to it, the guide is put away, the card of the step is dragged from the hand and dropped on the board.
import { tutorialSteps } from "../../../src/data/tutorial-script.js";
import { TUTORIAL_ITEMS } from "../../../src/ui-refresh/tutorial-items.js";
import { openBrowser, assertNoErrors } from "../parts/browser.mjs";
import { makeUi } from "../parts/play.mjs";
import { playTutorial, putAway, readPages, startTutorial, tutorialState } from "../parts/tutorial.mjs";

const asksToTry = (focus) => (focus ?? []).some((item) => item.kind === "button" && item.button === "play");
const { browser, errors, newPage } = await openBrowser();
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
try {
  const ids = TUTORIAL_ITEMS.map((item) => item.id).filter((id) => (!only || id === only) && tutorialSteps(id).some((step) => asksToTry(step.focus)));
  if (!ids.length && !only) throw new Error("no tutorial in the data has a step that asks to try a play");
  const seen = [];
  for (const id of ids) {
    const page = await newPage();
    await page.waitForFunction(() => document.body.classList.contains("boot-done") && !document.querySelector("#boot-splash"), null, { timeout: 10000 });
    await startTutorial(page, id);
    const ui = makeUi(page);
    const reached = await playTutorial(page, id, { ui, stopWhen: (state) => asksToTry(state.focus) });
    if (!reached.stopped) throw new Error(`${id}: the step that asks to try a play was never reached (${JSON.stringify(reached)})`);
    const state = reached.stopped; const cardId = state.focus.find((item) => item.kind === "button" && item.button === "play").cardId;
    await readPages(ui); await putAway(ui, state);
    const q = await ui.query();
    const card = q.observation.seats.flatMap((seat) => seat.hand.cards ?? []).find((c) => !c.faceDown && c.definition.id === cardId);
    if (!card) throw new Error(`${id}: the card of the step is not in the hand`);
    const selector = `[data-card-ref="${card.cardRef}"]`;
    await ui.cardShown(selector);
    const from = await page.locator(selector).first().boundingBox(); const board = await page.locator(".r2-board").first().boundingBox();
    if (!from || !board) throw new Error(`${id}: the card or the board is not on screen`);
    // pressed on the part of the card that shows above the screen's edge, then pulled up (a hand card is picked up by an upward pull)
    const grabX = from.x + from.width / 2, grabY = from.y + 40;
    await page.mouse.move(grabX, grabY); await page.mouse.down();
    await page.mouse.move(grabX, grabY - 90, { steps: 6 });
    await page.mouse.move(board.x + board.width / 2, board.y + board.height / 2, { steps: 12 });
    await page.mouse.up();
    // the reason is said once, in the guide: the board shows no dialog
    await page.waitForFunction((was) => window.__SIMPLE_ZEKE_E2E__.tutorial().value.flow.index !== was, state.flow.index, { timeout: 3000 }).catch(() => { throw new Error(`${id}: the drop did not move the step on`); });
    const reason = page.locator(".live-guide .live-guide-error");
    await reason.first().waitFor({ state: "visible", timeout: 3000 }).catch(() => { throw new Error(`${id}: the guide does not say why`); });
    const text = (await reason.first().textContent()) ?? "";
    if (!text.includes("シンボル不足で実行できません")) throw new Error(`${id}: the guide says "${text}"`);
    if (await page.locator(".drop-reject-dialog").count()) throw new Error(`${id}: the board shows a dialog as well`);
    const after = await tutorialState(page);
    if (after.flow.index !== state.flow.index + 1) throw new Error(`${id}: the step did not move on once (${state.flow.index} -> ${after.flow.index})`);
    seen.push({ id, reason: text });
    await page.close();
  }
  assertNoErrors(errors, "tutorial-try-drop");
  console.log(JSON.stringify({ suite: "flow/tutorial-try-drop", tutorials: seen, ok: true }));
} finally {
  await browser.close();
}
