// Flow check: when a tutorial counts as cleared in this browser (localStorage "sz-tutorial-done").
// A cleared tutorial is one whose win was reached: played to the end, or begun from its win board ([スキップ] starts that board as a new match).
// The win board is loaded as a decided board (src/tutorial-boards/<id>.json); nothing is played from the start except where the check is about leaving early.
//   not-cleared    leaving by the menu's [入口へ戻る] before the win leaves the tutorial unmarked, and the match is gone
//   skip           [スキップ] starts the win board as a new match; leaving it marks the tutorial; the match left is kept with its mark (startedFrom the win board, not replayable)
//   leave-home     after the win, the menu's [入口へ戻る] marks the tutorial
//   switch         after the win, the menu's 学ぶ内容 switched to another tutorial marks the tutorial that was cleared
//   reload         after the win, reloading the page marks the tutorial
// Each is run for every tutorial in the data (switch: each one switching to the next) and reported on its own; the run fails if any one failed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TUTORIAL_ITEMS } from "../../../src/ui-refresh/tutorial-items.js";
import { openBrowser, assertNoErrors } from "../parts/browser.mjs";
import { makeUi } from "../parts/play.mjs";

const IDS = TUTORIAL_ITEMS.map((item) => item.id);
const boardOf = (id) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../src/tutorial-boards/${id}.json`, import.meta.url)), "utf8"));
const { browser, errors, newPage, flags } = await openBrowser();
const only = [...flags].find((flag) => flag.startsWith("--only="))?.slice(7); // --only=<tutorial id>: the checks for that tutorial alone (after a change to it)
const results = []; const failures = [];

const done = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("sz-tutorial-done") ?? "[]"));
const scope = (page) => page.evaluate(() => window.__SIMPLE_ZEKE_E2E__?.scope() ?? null);
async function fresh() {
  const page = await newPage();
  await page.waitForFunction(() => document.body.classList.contains("boot-done") && !document.querySelector("#boot-splash"), null, { timeout: 10000 });
  await page.evaluate(() => localStorage.removeItem("sz-tutorial-done"));
  return page;
}
async function startWinBoard(page, id) {
  const started = await page.evaluate(({ file }) => window.__SIMPLE_ZEKE_E2E__.startFromCheckpoint(file, "win"), { file: boardOf(id) });
  if (!started.ok) throw new Error(`the win board did not load: ${JSON.stringify(started)}`);
  await page.waitForFunction(() => window.__SIMPLE_ZEKE_E2E__.tutorial().value?.flow.complete, null, { timeout: 10000 });
}
const openMenu = async (ui) => { await ui.click("[data-runtime-menu]"); await ui.page.locator(".runtime-host-options").waitFor({ state: "visible", timeout: 3000 }); };
const leaveHome = async (ui) => { await openMenu(ui); await ui.click('.runtime-host-options [data-live="home"]'); await ui.page.locator(".r2-entry").waitFor({ state: "visible", timeout: 5000 }); };
// one check for one tutorial: a failure is kept and the run goes on, so one run says which checks hold and which do not
async function attempt(name, id, body) {
  let page = null;
  try { page = await fresh(); await body(page, makeUi(page)); results.push({ check: name, tutorial: id }); }
  catch (error) { failures.push({ check: name, tutorial: id, why: String(error.message).slice(0, 240) }); }
  finally { await page?.close().catch(() => {}); }
}
const startFresh = async (page, id) => { await page.evaluate((tutorialId) => window.__SIMPLE_ZEKE_E2E__.start("tutorial", tutorialId, 1), id); await page.locator(".live-guide").waitFor({ state: "visible", timeout: 5000 }); };

try {
  for (const id of only ? [only] : IDS) {
    await attempt("not-cleared", id, async (page, ui) => {
      await startFresh(page, id);
      await openMenu(ui); await ui.click('.runtime-host-options [data-live="home"]');
      await page.locator(".r2-entry").waitFor({ state: "visible", timeout: 5000 });
      const state = { scope: await scope(page), board: await page.locator('[data-live-region="board"]').count(), guide: await page.locator(".live-guide").count(), saved: await done(page) };
      if (state.scope !== null || state.board || state.guide || state.saved.includes(id)) throw new Error(`leaving before the win: ${JSON.stringify(state)}`);
    });

    await attempt("skip", id, async (page, ui) => {
      await startFresh(page, id);
      const before = await scope(page);
      if (await page.locator(".live-guide [data-runtime-tutorial-skip]").count()) throw new Error("the guide still carries a skip");
      await openMenu(ui);
      page.once("dialog", (dialog) => dialog.accept());
      await ui.click(".runtime-host-options [data-runtime-tutorial-skip]");
      await page.waitForFunction((matchId) => { const now = window.__SIMPLE_ZEKE_E2E__.scope(); return now && now.matchId !== matchId; }, before.matchId, { timeout: 10000 }).catch(() => { throw new Error("skip did not start the win board as a new match"); });
      const won = (await scope(page)).matchId;
      await page.waitForFunction(() => window.__SIMPLE_ZEKE_E2E__.tutorial().value?.flow.complete, null, { timeout: 10000 });
      await leaveHome(ui);
      const saved = await done(page);
      if (!saved.includes(id)) throw new Error(`a skipped tutorial is not counted as cleared (${JSON.stringify(saved)})`);
      const kept = await page.evaluate((matchId) => { const shelf = (key) => JSON.parse(localStorage.getItem(key) ?? "[]");
        return { log: shelf("sz-match-logs").find((item) => item.matchId === matchId) ?? null, replay: shelf("sz-replays").find((item) => item.game?.matchId === matchId) ?? null }; }, won);
      const mark = (from) => from?.kind === "tutorial-checkpoint" && from.tutorialId === id && from.checkpointId === "win" && from.revision > 0;
      if (!mark(kept.log?.startedFrom) || kept.log.finished !== true || !mark(kept.replay?.startedFrom) || kept.replay.replayable !== false || kept.replay.commands?.length !== 0) {
        throw new Error(`the skipped match is not kept with its mark: ${JSON.stringify({ log: kept.log && { startedFrom: kept.log.startedFrom, finished: kept.log.finished }, replay: kept.replay && { startedFrom: kept.replay.startedFrom, replayable: kept.replay.replayable, commands: kept.replay.commands?.length } })}`);
      }
    });

    await attempt("leave-home", id, async (page, ui) => {
      await startWinBoard(page, id);
      await leaveHome(ui);
      const saved = await done(page);
      if (!saved.includes(id)) throw new Error(`after the win, leaving by the menu's [入口へ戻る] did not mark it (${JSON.stringify(saved)})`);
    });

    const other = IDS[(IDS.indexOf(id) + 1) % IDS.length];
    if (other !== id) await attempt("switch", id, async (page, ui) => {
      await startWinBoard(page, id);
      await openMenu(ui); await page.locator("select[data-tutorial-select]").selectOption(other);
      await page.waitForFunction((tutorialId) => window.__SIMPLE_ZEKE_E2E__.tutorial().value?.flow.tutorialId === tutorialId, other, { timeout: 10000 }).catch(() => { throw new Error(`switching to ${other} did not start it`); });
      const saved = await done(page);
      if (!saved.includes(id)) throw new Error(`after the win, switching to ${other} did not mark ${id} (${JSON.stringify(saved)})`);
    });

    await attempt("reload", id, async (page) => {
      await startWinBoard(page, id);
      await page.reload({ waitUntil: "networkidle" });
      const saved = await done(page);
      if (!saved.includes(id)) throw new Error(`after the win, reloading did not mark it (${JSON.stringify(saved)})`);
    });
  }
  const names = ["not-cleared", "skip", "leave-home", "switch", "reload"];
  const summary = { suite: "flow/tutorial-done", passed: Object.fromEntries(names.map((name) => [name, results.filter((r) => r.check === name).length])), failed: failures };
  assertNoErrors(errors, "tutorial-done");
  if (failures.length) { console.log(JSON.stringify({ ...summary, ok: false })); process.exitCode = 1; }
  else console.log(JSON.stringify({ ...summary, ok: true }));
} finally {
  await browser.close();
}
