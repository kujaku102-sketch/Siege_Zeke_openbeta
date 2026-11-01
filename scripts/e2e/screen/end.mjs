// Screen check: the end screen for a win, a defeat and a draw, each loaded as a decided board (no match is played).
// The boards are the shipped win boards of the tutorials (src/tutorial-boards/<id>.json). The win board is loaded as it is; the defeat and the draw are made from it in this
// script by changing only the result (who won, the users' STR), and loaded through the test hook. The closing line's [次へ] brings the end screen up.
// Passes when the title, the outcome mark and the buttons are what 文豪 asked for (CONGRATULATION! / DEFEAT / NO CONTEST; the tutorial's ways out), every button is on
// the screen and none covers another.
// How the end screen of a played match reads (including [対戦ログを保存]) is flow/end-buttons; how it looks (confetti, noise) is for GamersEYE.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TUTORIAL_ITEMS } from "../../../src/ui-refresh/tutorial-items.js";
import { openBrowser, assertNoErrors } from "../parts/browser.mjs";

const EXPECT = {
  win: { outcome: "win", title: "CONGRATULATION!" },
  defeat: { outcome: "defeat", title: "DEFEAT" },
  draw: { outcome: "draw", title: "NO CONTEST" }
};
const BUTTONS = "チュートリアル選択へ,ホームに戻る";
const boardFile = (id) => fileURLToPath(new URL(`../../../src/tutorial-boards/${id}.json`, import.meta.url));

function decided(win, result) {
  if (result === "win") return win;
  const file = structuredClone(win); const engine = Object.values(file.snapshots)[0].engineState;
  const winner = result === "defeat" ? "ai" : "draw";
  engine.winner = winner; engine.victory = { ...engine.victory, lockedOutcome: winner, finished: true };
  // the users' STR: the winner keeps the STR it had, the loser is at 0 (a draw: both)
  const kept = Math.max(engine.players.player.fortressStr, engine.players.ai.fortressStr, 1);
  engine.players.player.fortressStr = result === "defeat" || result === "draw" ? 0 : kept;
  engine.players.ai.fortressStr = result === "defeat" ? kept : 0;
  return file;
}

const { browser, errors, newPage } = await openBrowser();
const seen = [];
try {
  for (const result of Object.keys(EXPECT)) {
    const page = await newPage();
    await page.waitForFunction(() => document.body.classList.contains("boot-done") && !document.querySelector("#boot-splash"), null, { timeout: 10000 });
    const win = JSON.parse(readFileSync(boardFile(TUTORIAL_ITEMS[0].id), "utf8"));
    const started = await page.evaluate(({ file }) => window.__SIMPLE_ZEKE_E2E__.startFromCheckpoint(file, "win"), { file: decided(win, result) });
    if (!started.ok) throw new Error(`${result}: the board did not load: ${JSON.stringify(started)}`);
    await page.locator(".live-guide [data-runtime-tutorial-finish]").waitFor({ state: "visible", timeout: 5000 });
    await page.locator(".live-guide [data-runtime-tutorial-finish]").click();
    await page.locator(".r2-result").waitFor({ state: "visible", timeout: 5000 });
    const screen = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll(".r2-result-actions button")].map((b) => b.getBoundingClientRect());
      const meets = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
      return { outcome: document.querySelector(".r2-result")?.dataset.outcome, title: document.querySelector(".r2-result h2")?.textContent,
        buttons: [...document.querySelectorAll(".r2-result-actions button")].map((b) => b.textContent).join(), guide: Boolean(document.querySelector(".live-guide")),
        onScreen: boxes.every((b) => b.width > 0 && b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight),
        overlap: boxes.some((a, i) => boxes.some((b, j) => i < j && meets(a, b))) };
    });
    const want = EXPECT[result];
    if (screen.outcome !== want.outcome || screen.title !== want.title || screen.buttons !== BUTTONS || screen.guide || !screen.onScreen || screen.overlap) {
      throw new Error(`${result}: end screen wrong ${JSON.stringify({ screen, want })}`);
    }
    seen.push({ result, title: screen.title });
    await page.close();
  }
  assertNoErrors(errors, "end screen");
  console.log(JSON.stringify({ suite: "screen/end", screens: seen, ok: true }));
} finally {
  await browser.close();
}
