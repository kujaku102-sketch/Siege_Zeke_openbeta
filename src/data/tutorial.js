import { endTurn, installCard, playCard, restSecurity } from "../game/engine.js";
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
  if (step.after === "guardman-demo") runGuardmanTutorialTurn(state);
  if (step.after === "yellow-pass" && state.active === "ai") {
    endTurn(state);
    const security = state.players.ai.front.find((card) => card.id === "STD-131" && !card.sleep);
    if (security) restSecurity(state, "ai", security.uid);
    if (state.securityRestWindow === "ai") endTurn(state);
  }
  if (flow.index >= steps.length - 1) flow.complete = true;
  return true;
}

// 赤チュートリアルの相手: ガードマン(セキュリティ)を実行し、スリープさせてターンを終える。
function runGuardmanTutorialTurn(state) {
  const ai = state.players.ai;
  const guardman = ai.hand.find((card) => card.id === "STD-022");
  if (guardman) {
    playCard(state, "ai", guardman.uid, { force: true });
    endTurn(state);
    const fieldGuardman = ai.front.find((card) => card.id === "STD-022");
    if (fieldGuardman) restSecurity(state, "ai", fieldGuardman.uid);
  } else endTurn(state);
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
