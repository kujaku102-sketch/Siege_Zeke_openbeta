import { addLog, findCard } from "../../core/shared.js";
import { destroyCard } from "../generic/placement.js";

export function hahanamoriStandbySelection(state, continuation, result, playerId, player) {
  const source = findCard(state, continuation.sourceUid)?.card;
  if (!source) return false;
  if (result.selected.length) {
    const target = findCard(state, result.selected[0]);
    if (target) destroyCard(state, target.playerId, target.card.uid, { source: source.name, suppressReplacement: true });
    source.sleep = false;
    const defender = findCard(state, continuation.defenderUid)?.card;
    if (defender) defender.skipStandby = true;
    addLog(state, `${source.name}: 他のObを破壊してスタンバイ。戦闘相手は次の開始時にスタンバイしない。`, "effect");
  }
  state.pending = null;
  return true;
}
