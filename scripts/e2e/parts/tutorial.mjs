// Playing a tutorial from its own script. Each step of src/data/tutorial-script.js says what it expects (`expect`):
//   advance (press the guide's [次へ]; with `press`: press the thing it names; for attack-choice, the card and then its attack)   play / install / attack / layered / relog / activate-effect / end-turn (make that move)
//   answerChoice (answer the open choice with the named card)                  null (the closing line)
// This reads the step the match is on (the hook's tutorial().presentation.expect) and does that, so a script can be added to or changed without touching
// the e2e: no step number and no card is written here, the card to use is the one in the step's `expect`.
// The play is the same as a person's: the guide is read to its last page, put away by a tap on its line where a move is asked, and the controls are pressed.
import { makeUi, cardsOf } from "./play.mjs";

const MOVE_TYPES = {
  play: ["executeCard", "executeSpell"], install: ["install"], attack: ["attack"], layered: ["executeLayered"],
  relog: ["redeploy"], "activate-effect": ["activateCardEffect"], "end-turn": ["endTurn"]
};

export const tutorialState = (page) => page.evaluate(() => {
  const e2e = window.__SIMPLE_ZEKE_E2E__; const t = e2e.tutorial()?.value; const guide = document.querySelector(".live-guide");
  return t ? { flow: t.flow, expect: t.presentation?.expect ?? null, text: t.presentation?.text ?? "", focus: t.presentation?.focus ?? [], opponentScript: t.opponentScript,
    guideStep: guide?.dataset.tutorialStep ?? null, revision: e2e.query().value?.status.revision ?? null } : null;
});

export async function startTutorial(page, id) {
  const started = await page.evaluate((tutorialId) => window.__SIMPLE_ZEKE_E2E__.start("tutorial", tutorialId, 1), id);
  if (!started.ok) throw new Error(`${id}: could not start: ${JSON.stringify(started)}`);
}

// A step marked hintOnly says nothing: the guide stays away and only the hint shows (the wait in playTutorial accepts that).
// A guide line may run over several pages (how many depends on the screen): press [次へ] up to its last page.
export async function readPages(ui) {
  const { page } = ui;
  await page.waitForFunction(() => !document.querySelector('.live-guide[data-paging="pending"]'), null, { timeout: 5000 }).catch(() => {});
  for (let turn = 0; turn < 12; turn += 1) {
    const before = await page.locator(".live-guide").getAttribute("data-guide-page").catch(() => null);
    if (!await page.locator(".live-guide [data-runtime-guide-next]").first().isVisible().catch(() => false)) return;
    await ui.click(".live-guide [data-runtime-guide-next]");
    await page.waitForFunction((was) => document.querySelector(".live-guide")?.dataset.guidePage !== was, before, { timeout: 3000 });
  }
  throw new Error("guide pages never reached the last one");
}

// While the guide speaks the match takes no input; on a step that asks for a move a tap on its line puts it away.
export async function putAway(ui, state) {
  const { page } = ui;
  const press = state.focus.some((f) => f.kind === "button");
  if (!await page.locator(".live-guide").count()) return;
  if (await page.locator(press ? ".live-guide [data-runtime-guide-next]" : ".live-guide :is([data-runtime-guide-next],[data-runtime-tutorial-next],[data-runtime-tutorial-finish])").count()) return;
  await ui.click(".live-guide-text");
  await page.waitForFunction(() => !document.querySelector(".live-guide"), null, { timeout: 3000 });
  if (await page.evaluate(() => document.querySelector('[data-live-region="board"]')?.inert)) throw new Error("the match still waits with the guide put away");
}

function preferenceOf(expect, text = "") {
  const preference = { scope: "レイヤー", mention: text };
  if (expect.zone) preference.zone = expect.zone;
  if (expect.targetType === "fortress") preference.user = true;
  if (expect.targetCardId) { preference.targetId = expect.targetCardId; preference.cardOnly = true; }
  if (expect.hostCardId) { preference.targetId = expect.hostCardId; preference.cardOnly = true; }
  return preference;
}

async function makeMove(ui, state) {
  const { expect } = state; const q = await ui.query();
  const types = MOVE_TYPES[expect.type];
  if (!types) throw new Error(`a step expects a move this e2e does not know: ${JSON.stringify(expect)}`);
  // The legal action of the expected kind about the expected card (a Sp is `executeSpell`, an Ob `executeCard`).
  const want = types.find((type) => q.legalActions.some((entry) => (entry.actionType ?? entry.action?.type) === type
    && (!expect.cardId || cardsOf(q).some((c) => !c.faceDown && c.definition.id === expect.cardId && (entry.base?.cardRef ?? entry.base?.attackerRef ?? entry.action?.cardRef) === c.cardRef))));
  if (!want) throw new Error(`the step expects ${JSON.stringify(expect)} but no such action is legal now`);
  await ui.action(want, expect.type === "end-turn" ? null : expect.cardId, preferenceOf(expect, state.text));
  // The step is done when the move is made. If the guide has moved on to its next line, a choice still open (a Login's access) is for that line to
  // talk over and for a later step to answer; otherwise the choice is this move's own and is answered now.
  const here = state.guideStep;
  const moved = await ui.page.waitForFunction((was) => { const g = document.querySelector(".live-guide[data-tutorial-step]"); return g && g.dataset.tutorialStep !== was; }, here, { timeout: 1200 }).then(() => true, () => false);
  if (!moved) await ui.settle({ preference: { scope: "レイヤー", mention: state.text } });
}

async function pressAsked(ui, state) {
  const { page } = ui; const { expect } = state;
  if (expect.press === "info-button") { await ui.click("[data-runtime-counts]"); return; }
  const q = await ui.query();
  const card = cardsOf(q).find((c) => !c.faceDown && c.definition.id === expect.cardId && ["hand", "front", "back"].includes(c.location?.zone));
  if (!card) throw new Error(`the step asks to open a card that is not in sight: ${expect.cardId}`);
  const selector = `[data-card-ref="${card.cardRef}"]`;
  if (card.location.zone === "hand") await ui.cardShown(selector);
  await ui.click(selector);
  if (expect.press === "attack-choice") {
    // the card is pressed, then its popup's attack is chosen: the target choice is what the step waits for
    await page.locator('.r2-popup [data-route="attack"]').first().waitFor({ state: "visible", timeout: 3000 });
    await ui.click('.r2-popup [data-route="attack"]');
    return;
  }
  if (expect.press === "ability-badge") {
    // The badge is scrolled to the middle of the detail once it is marked: pressed after that settles.
    await page.waitForFunction(() => { const badge = document.querySelector(".r2-detail [data-ability-help].live-focus"), top = badge?.getBoundingClientRect().top; const still = top !== undefined && top === window.__badgeTop; window.__badgeTop = top; return still; }, null, { polling: 150, timeout: 3000 });
    await ui.click(".r2-detail [data-ability-help].live-focus");
  }
}

// Plays the tutorial `id` (already started) to its closing line. `stopAfterMoves`: return after that many moves of the player (for a "first move" check).
// Returns { steps, moves }.
// `stopWhen(state)`: return as soon as the step the match is on satisfies it (before that step is read), with { stopped: state }.
export async function playTutorial(page, id, { keyboard = false, stopAfterMoves = Infinity, stopWhen = null, ui = makeUi(page, { keyboard }) } = {}) {
  let moves = 0, steps = 0, stuck = 0, last = "";
  for (let turn = 0; turn < 600; turn += 1) {
    await page.waitForFunction(() => { const t = window.__SIMPLE_ZEKE_E2E__.tutorial()?.value; return t && (t.flow.complete || ((document.querySelector(".live-guide[data-tutorial-step]") || t.presentation?.hintOnly && document.querySelector(".live-guide-away")) && t.opponentScript === null)); }, null, { timeout: 20000 })
      .catch(() => { throw new Error(`${id}: the guide never came back (after ${steps} steps)`); });
    const state = await tutorialState(page);
    if (state.flow.complete) return { steps, moves, complete: true };
    if (stopWhen?.(state)) return { steps, moves, stopped: state };
    if (!state.text.trim()) throw new Error(`${id}: a guide step with no line (${state.guideStep})`);
    const mark = `${state.guideStep ?? state.flow.index}|${state.revision}`;
    stuck = mark === last ? stuck + 1 : 0; last = mark;
    if (stuck >= 3) throw new Error(`${id}: stuck on ${state.guideStep}: ${JSON.stringify(state.expect)}`);
    await readPages(ui);
    const { expect } = state;
    if (!expect || (expect.type === "advance" && !expect.press)) {
      // A line without an expectation is the greeting before the first step, or the closing line (it has [次へ] to the end screen instead).
      if (!expect && await page.locator("[data-runtime-tutorial-finish]").count()) return { steps, moves, closing: true };
      await ui.click("[data-runtime-tutorial-next]");
    } else if (expect.type === "advance") {
      await putAway(ui, state); await pressAsked(ui, state);
      await page.waitForFunction((index) => window.__SIMPLE_ZEKE_E2E__.tutorial().value?.flow.index !== index, state.flow.index, { timeout: 3000 }).catch(() => { throw new Error(`${id}: pressing what the step asks did not move it on (${state.guideStep})`); });
      if (await page.locator(".r2-detail").count()) { await page.keyboard.press("Escape"); const close = page.locator("[data-close-detail]"); if (await close.count() && await close.first().isVisible()) await ui.click("[data-close-detail]"); }
    } else if (expect.type === "answerChoice") {
      await putAway(ui, state); await ui.settle({ preference: { cardId: expect.cardId, scope: "レイヤー", mention: state.text }, until: async () => (await tutorialState(page)).flow.index !== state.flow.index });
    } else {
      try { await putAway(ui, state); await makeMove(ui, state); } catch (error) { throw new Error(`${id} at ${state.guideStep} expecting ${JSON.stringify(expect)}: ${error.message}`); }
      moves += 1;
      if (moves >= stopAfterMoves) return { steps: steps + 1, moves };
    }
    steps += 1;
  }
  throw new Error(`${id}: the tutorial did not end in 600 turns`);
}

// The closing line's [次へ] brings the end screen up; it is read whole first (it may run over pages).
export async function finishTutorial(page, id, { keyboard = false } = {}) {
  const ui = makeUi(page, { keyboard });
  await page.waitForFunction(() => window.__SIMPLE_ZEKE_E2E__.tutorial().value?.flow.complete, null, { timeout: 10000 });
  await readPages(ui);
  await page.locator(".live-guide [data-runtime-tutorial-finish]").waitFor({ state: "visible", timeout: 10000 });
  await ui.click("[data-runtime-tutorial-finish]");
  await page.locator('.r2-result[data-outcome="win"]').waitFor({ state: "visible", timeout: 5000 }).catch(() => { throw new Error(`${id}: no end screen after the closing line`); });
}
