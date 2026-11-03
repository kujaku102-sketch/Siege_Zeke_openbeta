import test from "node:test";
import assert from "node:assert/strict";
import { TUTORIAL_STEP_GUARDS } from "../src/adapters/tutorial-mode-controller.js";
import { currentTutorialHint, tutorialActionHint, tutorialCardName } from "../src/data/tutorial-hint.js";
import { advanceTutorialIntroduction, completeTutorialIntroduction, createTutorialFlow, currentTutorialPresentation, tutorialSteps } from "../src/data/tutorial-script.js";

const TUTORIAL_IDS = ["basics", "blue", "vengeance"];
const hintAt = (tutorialId, index) => tutorialActionHint(tutorialSteps(tutorialId)[index], TUTORIAL_STEP_GUARDS[tutorialId]?.[index] ?? null);
// The first step of a tutorial whose expect matches (the script's indices move when a line is added).
const hintOf = (tutorialId, expect) => hintAt(tutorialId, tutorialSteps(tutorialId).findIndex((step) => Object.entries(expect).every(([key, value]) => step.expect?.[key] === value)));

test("the greeting plays only before red; blue and purple start at their own step 1", () => {
  const red = createTutorialFlow("basics");
  assert.equal(red.introComplete, false);
  assert.equal(currentTutorialPresentation(red).intro, true);
  assert.match(currentTutorialPresentation(red).text, /ようこそ/);
  for (let n = 0; n < 7; n += 1) assert.equal(advanceTutorialIntroduction(red), true);
  assert.equal(red.introComplete, true);
  assert.equal(currentTutorialPresentation(red).intro, undefined);

  for (const id of ["blue", "vengeance"]) {
    const flow = createTutorialFlow(id);
    assert.equal(flow.introComplete, true, id);
    assert.equal(currentTutorialPresentation(flow), tutorialSteps(id)[0], id);
    assert.notEqual(currentTutorialPresentation(flow).intro, true);
    assert.equal(advanceTutorialIntroduction(flow), false, "there is no introduction to advance");
    assert.equal(completeTutorialIntroduction(flow), true);
    assert.equal(flow.introComplete, true);
    assert.equal(flow.index, 0);
  }
  assert.match(currentTutorialPresentation(createTutorialFlow("blue")).text, /^青のデッキを使います/);
});

test("card names in the hints are the short names the script uses", () => {
  assert.equal(tutorialCardName("STD-109"), "フラウ");
  assert.equal(tutorialCardName("STD-111"), "オフェンスプロトコル");
  assert.equal(tutorialCardName("STD-195"), "トライプビア");
  assert.equal(tutorialCardName("STD-091"), "アツト");
  assert.equal(tutorialCardName("STD-191"), "淫魔像");
});

test("hint text is built from each step's expect, with the guard's target where it narrows one (every tutorial, read from the script and its guards)", () => {
  const named = (id) => `『${tutorialCardName(id)}』`;
  for (const id of TUTORIAL_IDS) {
    tutorialSteps(id).forEach((step, index) => {
      const expect = step.expect, guard = TUTORIAL_STEP_GUARDS[id]?.[index] ?? null, hint = hintAt(id, index);
      if (!expect || expect.type === "advance") return;
      const at = `${id}:${index} ${JSON.stringify(expect)}`;
      const subjects = [expect.cardId, expect.targetCardId, guard?.action?.targetCardId, guard?.action?.hostCardId].filter(Boolean);
      for (const cardId of subjects) assert.ok(hint.includes(named(cardId)), `${at}: the hint names ${cardId}: ${hint}`);
      if (expect.targetType === "fortress" || guard?.action?.targetType === "fortress") assert.ok(hint.includes("相手ユーザー"), `${at}: the hint says the user is the target: ${hint}`);
    });
  }
});

test("every action step of red, blue and purple has a hint; steps that only advance have none", () => {
  for (const id of TUTORIAL_IDS) {
    tutorialSteps(id).forEach((step, index) => {
      const hint = hintAt(id, index);
      const acts = Boolean(step.expect) && (step.expect.type !== "advance" || Boolean(step.expect.press));
      if (acts) assert.ok(hint.length > 0 && hint.endsWith("う"), `${id}:${index} ${JSON.stringify(step.expect)}`);
      else assert.equal(hint, "", `${id}:${index} only advances`);
    });
    assert.ok(tutorialSteps(id).some((step) => hintAt(id, tutorialSteps(id).indexOf(step))), `${id} has action steps`);
  }
});

test("currentTutorialHint follows the flow and stays empty during the introduction and after the end", () => {
  const flow = createTutorialFlow("basics");
  assert.equal(currentTutorialHint(flow, TUTORIAL_STEP_GUARDS), "");
  completeTutorialIntroduction(flow);
  assert.equal(currentTutorialHint(flow, TUTORIAL_STEP_GUARDS), "");
  flow.index = 38;
  assert.equal(currentTutorialHint(flow, TUTORIAL_STEP_GUARDS), "『ジャンクパーツ』を『アツト』にマウントしよう");
  flow.complete = true;
  assert.equal(currentTutorialHint(flow, TUTORIAL_STEP_GUARDS), "");
});

test("hints use the buttons' names: Sp is cast, a redeploy is a 再実行, a Code goes where the step puts it", () => {
  assert.equal(hintOf("blue", { type: "play", cardId: "STD-110" }), "『セキュリティウォール』をスペル実行しよう");
  assert.equal(hintOf("blue", { type: "play", cardId: "STD-111" }), "『オフェンスプロトコル』を『フラウ』にスペル実行しよう");
  assert.equal(hintOf("vengeance", { type: "relog" }), "『アクロィア』をフロントへ再実行しよう");
  assert.equal(hintOf("black", { type: "play", cardId: "STD-158" }), "『断章・レメゲトン』をバックに実行しよう");
  assert.equal(hintOf("yellow", { type: "play", cardId: "STD-137" }), "『騎士団の凱歌』をスペル実行しよう");
  for (const id of ["basics", "blue", "yellow", "vengeance", "black"]) {
    tutorialSteps(id).forEach((step, index) => assert.doesNotMatch(hintAt(id, index), /使おう|リログ/, `${id}:${index}`));
  }
});

test("the red 『攻撃』 step asks for the press of the attack on Atto; the second line of a doubled step is hint-only", () => {
  const press = tutorialSteps("basics").find((step) => step.expect?.press === "attack-choice");
  assert.equal(tutorialActionHint(press), "『アツト』を押して『攻撃』を選ぼう");
  assert.equal(press.expect.type, "advance");
  const hintOnly = (id) => tutorialSteps(id).filter((step) => step.hintOnly);
  assert.deepEqual(["yellow", "vengeance", "black"].map((id) => hintOnly(id).length), [3, 2, 1]);
  for (const id of ["yellow", "vengeance", "black"]) for (const step of hintOnly(id)) assert.notEqual(step.expect?.type, "advance", id);
});
