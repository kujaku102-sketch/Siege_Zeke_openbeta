import { keywordValue } from "../../effect-compiler.js";
import { createSelectionRequest } from "../../selection-model.js";
import { hasOptionalActivationSpec } from "../../trigger-specs.js";
import { attack, resumeDeferredAttack } from "../../core/battle.js";
import { activateScript } from "../../core/scripts.js";
import { PASS } from "./index.js";

export function std182AttackScriptSelection(state, continuation, result, playerId, player) {
  state.pending = null;
  const attacker = player.front.find((item) => item.uid === continuation.attackerUid && item.id === "STD-182");
  if (!attacker) return false;
  attacker.skipStd182AttackEffect = true;
  if (!result.selected.length) return attack(state, playerId, attacker.uid, continuation.targetUid);
  const script = player.back.find((item) => item.uid === result.selected[0] && item.category === "Script" && item.faceDown
    && Number(item.activationCost ?? item.cost ?? Infinity) <= 2);
  if (!script) return attack(state, playerId, attacker.uid, continuation.targetUid);
  state.deferredAttack = { stage: "std182-script", playerId, attackerUid: attacker.uid, targetUid: continuation.targetUid };
  const activated = activateScript(state, playerId, script.uid);
  if (!activated) { state.deferredAttack = null; return attack(state, playerId, attacker.uid, continuation.targetUid); }
  resumeDeferredAttack(state);
  return true;
}

export function std182AttackCore2({ player, attacker, playerId, targetUid, state }) {
  if (!attacker.skipStd182AttackEffect) {
    const candidates = player.back.filter((script) => script.category === "Script" && script.faceDown
      && !keywordValue(script, "IF") && !hasOptionalActivationSpec(script.id)
      && Number(script.activationCost ?? script.cost ?? Infinity) <= 2
      && player.memory >= Number(script.activationCost ?? script.cost ?? 0));
    if (candidates.length) {
      const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((script) => script.uid), minimum: 0, maximum: 1,
        candidateLabels: Object.fromEntries(candidates.map((script) => [script.uid, `${script.name} / 起動${script.activationCost ?? script.cost}`])),
        label: `${attacker.name}: 攻撃時にScriptを起動`, message: attacker.text,
        continuation: { type: "std182-attack-script", playerId, attackerUid: attacker.uid, targetUid } });
      state.pending = { type: "selection", validTargets: request.candidates, request };
      return true;
    }
  }
  return PASS;
}
