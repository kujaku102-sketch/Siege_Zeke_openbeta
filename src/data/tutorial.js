import { attack, canAttack, endTurn, getAttackTargets, installCard, playCard, restSecurity } from "../game/engine.js";
import { tutorialSteps, matches, currentTutorialStep } from "./tutorial-script.js";
export { TUTORIAL_SPEAKER, createTutorialFlow, currentTutorialPresentation, advanceTutorialIntroduction,
  completeTutorialIntroduction, currentTutorialStep, isTutorialActionExpected } from "./tutorial-script.js";

export function acceptTutorialAction(state, flow, action) {
  if (!flow?.introComplete) {
    flow.error = "先にじぐさぽの案内を確認して。";
    return false;
  }
  const steps = tutorialSteps(flow?.tutorialId);
  const step = currentTutorialStep(flow);
  if (!matches(step.expect, action)) {
    flow.error = "今はその操作じゃない。セリフのカードと行動を確認して。";
    return false;
  }
  flow.error = "";
  flow.index += 1;
  if (step.after === "yellow-demo") runYellowTutorialTurn(state);
  if (step.after === "guardman-demo") runSecurityTutorialTurn(state, "STD-022");
  if (step.after === "sandbag-1") runSecurityTutorialTurn(state, "STD-043");
  if (step.after === "sandbag-2") runSandbagAttackTurn(state);
  if (step.after === "yellow-pass" && state.active === "ai") {
    endTurn(state);
    const security = state.players.ai.front.find((card) => card.id === "STD-131" && !card.sleep);
    if (security) restSecurity(state, "ai", security.uid);
    if (state.securityRestWindow === "ai") endTurn(state);
  }
  if (flow.index >= steps.length - 1) flow.complete = true;
  return true;
}

// 赤(ガードマン)・青(装甲兵 メルク)チュートリアルの相手: セキュリティのObを実行し、スリープさせてターンを終える。
function runSecurityTutorialTurn(state, cardId) {
  const ai = state.players.ai;
  const security = ai.hand.find((card) => card.id === cardId);
  if (security) {
    playCard(state, "ai", security.uid, { force: true });
    endTurn(state);
    const fieldSecurity = ai.front.find((card) => card.id === cardId);
    if (fieldSecurity) restSecurity(state, "ai", fieldSecurity.uid);
  } else endTurn(state);
  if (state.securityRestWindow === "ai") endTurn(state);
}

// 青チュートリアルの相手: 装甲兵 メルクで相手ユーザー(自分)を攻撃してターンを終える。自分のObは[暗号化]で対象にならない。
function runSandbagAttackTurn(state) {
  const merc = state.players.ai.front.find((card) => card.id === "STD-043");
  if (merc && canAttack(state, "ai", merc)) {
    const target = getAttackTargets(state, "ai", merc).find((item) => item.type === "fortress");
    if (target) attack(state, "ai", merc.uid, target.uid);
  }
  endTurn(state);
  if (state.securityRestWindow === "ai") endTurn(state);
}

function runYellowTutorialTurn(state) {
  const ai = state.players.ai;
  const install = ai.hand.find((card) => card.id === "STD-125");
  if (install) installCard(state, "ai", install.uid, { force: true });
  const hanamori = ai.hand.find((card) => card.id === "STD-131");
  if (hanamori) {
    playCard(state, "ai", hanamori.uid, { force: true });
    endTurn(state);
    const fieldHanamori = ai.front.find((card) => card.id === "STD-131");
    if (fieldHanamori) restSecurity(state, "ai", fieldHanamori.uid);
  } else endTurn(state);
  if (state.securityRestWindow === "ai") endTurn(state);
}

export function tutorialAdvanceAction() {
  return { type: "advance" };
}
