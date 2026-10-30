// STD-185 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { attack } from "../../game/core/battle.js";

// handlers (was effects/custom/std_185.js)
export function std185DefenderSubstituteSelection(state, continuation, result, playerId, player) {
  state.pending = null;
  const attacker = state.players[continuation.attackerPlayerId].front.find((item) => item.uid === continuation.attackerUid);
  if (!attacker) return false;
  attacker.skipStd185Substitution = true;
  const targetUid = result.scope === "クワガタ将軍と戦闘" ? continuation.generalUid : continuation.originalTargetUid;
  return attack(state, continuation.attackerPlayerId, attacker.uid, targetUid);
}

export function std185AttackerSubstituteSelection(state, continuation, result, playerId, player) {
  state.pending = null;
  const original = player.front.find((item) => item.uid === continuation.attackerUid);
  const general = player.front.find((item) => item.uid === continuation.generalUid && item.id === "STD-185" && !item.sleep);
  if (!original || !general) return false;
  if (result.scope !== "クワガタ将軍と戦闘") {
    original.skipStd185AttackerSubstitution = true;
    return attack(state, playerId, original.uid, continuation.targetUid);
  }
  general.skipStd230Ambush = true;
  general.skipStd185AttackerSubstitution = true;
  return attack(state, playerId, general.uid, continuation.targetUid);
}
