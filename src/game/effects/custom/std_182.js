import { attack, resumeDeferredAttack } from "../../core/battle.js";
import { activateScript } from "../../core/scripts.js";

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
