// STD-136 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { isObCard } from "../../game/card-types.js";
import { createSelectionRequest } from "../../game/selection-model.js";
import { addLog, findCard } from "../../game/core/shared.js";
import { destroyCard } from "../../game/effects/generic/placement.js";

// handlers (was effects/custom/std_136.js)
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

export function std136QueuePostAttackSelection({ player, attacker, playerId, defenderUid, state }) {
  const candidates = [...player.front, ...player.back].filter((card) => isObCard(card) && card.uid !== attacker.uid);
  if (candidates.length) {
    const request = createSelectionRequest({
      mode: "up_to", candidates: candidates.map((card) => card.uid), count: 1, maximum: 1,
      label: "破壊する他の自分Obを0～1体選択", message: "選んだ場合、このカードをスタンバイする。",
      continuation: { type: "hahanamori-standby", playerId, sourceUid: attacker.uid, defenderUid }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
  }
}
