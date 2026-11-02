// Flow check: every tutorial played from its own script to the end, then out by the end screen.
// The tutorial list is the one in the data (a new color joins it); each step is played from what the script expects (parts/tutorial.mjs).
// "--keyboard": the first tutorial is played by Tab and Enter only. Passes when each tutorial ends on its closing line with the opponent's
// STR at 0 and a win locked, the end screen reads CONGRATULATION! with the two ways out, and [チュートリアル選択へ] marks it done and leaves the match.
import { TUTORIAL_ITEMS } from "../../../src/ui-refresh/tutorial-items.js";
import { openBrowser, assertNoErrors } from "../parts/browser.mjs";
import { playTutorial, finishTutorial, startTutorial } from "../parts/tutorial.mjs";
import { makeUi } from "../parts/play.mjs";

const { browser, flags, errors, newPage } = await openBrowser();
const keyboardMode = flags.has("--keyboard");
const only = [...flags].find((flag) => flag.startsWith("--only="))?.slice(7); // --only=<tutorial id>: that tutorial alone (after a change to it)
const ids = only ? [only] : keyboardMode ? TUTORIAL_ITEMS.slice(0, 1).map((item) => item.id) : TUTORIAL_ITEMS.map((item) => item.id);
const report = [];
try {
  for (const id of ids) {
    const page = await newPage();
    await page.waitForFunction(() => document.body.classList.contains("boot-done") && !document.querySelector("#boot-splash"), null, { timeout: 10000 });
    const t0 = Date.now();
    await startTutorial(page, id);
    const played = await playTutorial(page, id, { keyboard: keyboardMode });
    if (!played.complete) throw new Error(`${id}: the script ended before the win (${JSON.stringify(played)})`);
    const closing = await page.evaluate(() => { const q = window.__SIMPLE_ZEKE_E2E__.query().value; return { won: q.status.lockedOutcome?.winnerSeat, opponentStr: q.observation.seats.find((s) => s.seatId !== "player")?.fortressStr }; });
    if (closing.won !== "player" || closing.opponentStr !== 0) throw new Error(`${id}: the closing line without the win: ${JSON.stringify(closing)}`);
    await finishTutorial(page, id, { keyboard: keyboardMode });
    const screen = await page.evaluate(() => ({ title: document.querySelector(".r2-result h2")?.textContent, guide: Boolean(document.querySelector(".live-guide")),
      buttons: [...document.querySelectorAll(".r2-result-actions button")].map((b) => b.textContent) }));
    if (screen.title !== "CONGRATULATION!" || screen.guide || screen.buttons.join() !== "チュートリアル選択へ,ホームに戻る") throw new Error(`${id}: end screen wrong: ${JSON.stringify(screen)}`);
    await makeUi(page, { keyboard: keyboardMode }).click(".r2-result [data-runtime-to-menu]");
    await page.locator('[data-flow-screen="tutorial-select"]').waitFor({ state: "visible", timeout: 10000 });
    const left = await page.evaluate((tutorialId) => ({ scope: window.__SIMPLE_ZEKE_E2E__.scope(), done: document.querySelector(`[data-tutorial-item="${tutorialId}"]`)?.dataset.done,
      saved: JSON.parse(localStorage.getItem("sz-tutorial-done") ?? "[]"), board: Boolean(document.querySelector('[data-live-region="board"]')) }), id);
    if (left.scope !== null || left.board || left.done !== "true" || !left.saved.includes(id)) throw new Error(`${id}: leaving the finished tutorial: ${JSON.stringify(left)}`);
    report.push({ id, steps: played.steps, moves: played.moves, seconds: Math.round((Date.now() - t0) / 1000) });
    await page.close();
  }
  assertNoErrors(errors, "tutorial");
  console.log(JSON.stringify({ suite: "flow/tutorial-full", keyboard: keyboardMode, tutorials: report, ok: true }));
} finally {
  await browser.close();
}
