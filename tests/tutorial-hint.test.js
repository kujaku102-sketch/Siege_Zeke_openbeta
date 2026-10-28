import test from "node:test";
import assert from "node:assert/strict";
import { TUTORIAL_STEP_GUARDS } from "../src/adapters/tutorial-mode-controller.js";
import { currentTutorialHint, tutorialActionHint, tutorialCardName } from "../src/data/tutorial-hint.js";
import { advanceTutorialIntroduction, completeTutorialIntroduction, createTutorialFlow, currentTutorialPresentation, tutorialSteps } from "../src/data/tutorial-script.js";

const TUTORIAL_IDS = ["basics", "blue", "vengeance"];
const hintAt = (tutorialId, index) => tutorialActionHint(tutorialSteps(tutorialId)[index], TUTORIAL_STEP_GUARDS[tutorialId]?.[index] ?? null);

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

test("hint text is built from each step's expect, with the guard's target where it narrows one", () => {
  // blue
  assert.equal(hintAt("blue", 1), "『漣』をインストールしよう");
  assert.equal(hintAt("blue", 2), "『ルチル』をフロントに実行しよう");
  assert.equal(hintAt("blue", 6), "『オフェンスプロトコル』を選ぼう");
  assert.equal(hintAt("blue", 9), "ターンを終了しよう");
  assert.equal(hintAt("blue", 12), "『オフェンスプロトコル』を『フラウ』に使おう");
  assert.equal(hintAt("blue", 16), "『フラウ』で相手ユーザーを攻撃しよう");
  assert.equal(hintAt("blue", 18), "『ルチル』で『メルク』を攻撃しよう");
  assert.equal(hintAt("blue", 21), "『セキュリティウォール』を使おう");
  // red
  assert.equal(hintAt("basics", 11), "『剣士』をフロントに実行しよう");
  assert.equal(hintAt("basics", 19), "情報ボタンを押そう");
  assert.equal(hintAt("basics", 26), "『アツト』のQAバッジを押そう");
  assert.equal(hintAt("basics", 36), "『ジャンクパーツ』の詳細を開こう");
  assert.equal(hintAt("basics", 37), "『ジャンクパーツ』を『アツト』にマウントしよう");
  assert.equal(hintAt("basics", 39), "『アツト』で『ガードマン』を攻撃しよう");
  // purple
  assert.equal(hintAt("vengeance", 2), "『トライプビア』をフロントにレイヤードしよう");
  assert.equal(hintAt("vengeance", 3), "『トライプビア』をバックへリログしよう");
  assert.equal(hintAt("vengeance", 6), "『タナフォリア』の効果を『アクロィア』を対象に発動しよう");
  assert.equal(hintAt("vengeance", 8), "『トライプビア』をフロントへリログしよう");
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
  flow.index = 37;
  assert.equal(currentTutorialHint(flow, TUTORIAL_STEP_GUARDS), "『ジャンクパーツ』を『アツト』にマウントしよう");
  flow.complete = true;
  assert.equal(currentTutorialHint(flow, TUTORIAL_STEP_GUARDS), "");
});
