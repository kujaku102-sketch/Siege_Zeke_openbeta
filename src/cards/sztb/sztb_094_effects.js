import { isObCard } from "../../game/card-types.js";
import { createSelectionRequest } from "../../game/selection-model.js";
import { hasKeyword } from "../../game/core/keywords.js";
import { getEffectTargets } from "../../game/core/play-effects.js";
import { spellNeedsTarget } from "../../game/core/play-spell.js";
import { playCard } from "../../game/core/play.js";
import { findCard, isArmsBandCard, otherPlayer } from "../../game/core/shared.js";
import { registerTriggerCondition } from "../../game/activation-windows.js";
import { resumeTriggerThreadAfterSelection } from "../../game/core/triggers.js";
import { executionCost, magazineExecutionCandidates } from "../../game/effects/generic/cost.js";
import { registerTriggerAction } from "../../game/effects/generic/trigger-actions.js";

registerTriggerCondition("source_controller_has_executable_magazine_sp", (state, window) => magazineExecutionCandidates(state, window.source.playerId).length > 0);
registerTriggerAction("sztb094_counter", (state, trigger) => {
  beginSztb094Counter(state, trigger.source.playerId, trigger.source.card.uid, { triggerItemId: trigger.id });
});

// handlers (was effects/custom/sztb_094.js)
export function beginSztb094Counter(state, playerId, sourceUid, { triggerItemId = null } = {}) {
  const source = findCard(state, sourceUid)?.card;
  if (!source || source.id !== "SZTB-094" || source.sleep) return false;
  const candidates = magazineExecutionCandidates(state, playerId);
  if (!candidates.length) return false;
  const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((item) => item.uid), count: 1, minimum: 0, maximum: 1,
    candidateLabels: Object.fromEntries(candidates.map((item) => [item.uid, `${item.name} / メモリ${executionCost(item, state, playerId)}`])),
    label: `${source.name}: [弾倉]Spを実行`, message: "選んだ場合、これをスリープして選択したSpを実行する。選ばず確定も可能。",
    continuation: { type: "sztb094-counter-select", playerId, sourceUid, ...(triggerItemId ? { triggerItemId } : {}) } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function beginSztb094Access(state, playerId, sourceName, { resumeTurnEndActiveId = null } = {}) {
  const player = state.players[playerId];
  const candidates = player.deck.filter((candidate) => isArmsBandCard(candidate) && !isObCard(candidate));
  if (!candidates.length) return false;
  const request = createSelectionRequest({ mode: "single", candidates: candidates.map((candidate) => candidate.uid), count: 1,
    candidateLabels: Object.fromEntries(candidates.map((candidate) => [candidate.uid, candidate.name])),
    label: `${sourceName}: Ob以外のアームズバンド・カードへアクセス`, message: "選んだカードを手札へ加え、山札をシャッフルする。",
    continuation: { type: "access-to-hand", playerId, sourceName, ...(resumeTurnEndActiveId ? { resumeTurnEndActiveId } : {}) } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function sztb094CounterSelectSelection(state, continuation, result, playerId, player) {
  const source = findCard(state, continuation.sourceUid)?.card;
  const spell = player.hand.find((item) => item.uid === result.selected[0] && item.category === "Sp" && hasKeyword(item, "MAGAZINE"));
  if (!spell) { state.pending = null; resumeTriggerThreadAfterSelection(state, continuation.triggerItemId); return true; }
  if (!source || source.sleep) return false;
  source.sleep = true;
  if (spellNeedsTarget(spell)) {
    const targets = getEffectTargets(state, otherPlayer(playerId), spell);
    if (!targets.length) { source.sleep = false; state.pending = null; return false; }
    const request = createSelectionRequest({ mode: "single", candidates: targets.map((item) => item.uid), count: 1,
      candidateLabels: Object.fromEntries(targets.map((item) => [item.uid, item.name])), label: `${spell.name}: 対象を選択`, message: spell.text,
      continuation: { type: "sztb094-counter-target", playerId, spellUid: spell.uid, sourceUid: source.uid, ...(continuation.triggerItemId ? { triggerItemId: continuation.triggerItemId } : {}) } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  state.pending = null;
  const played = playCard(state, playerId, spell.uid, { allowOffTurn: true });
  resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
  return played;
}

export function sztb094CounterTargetSelection(state, continuation, result, playerId, player) {
  state.pending = null;
  const played = playCard(state, playerId, continuation.spellUid, { targetUid: result.selected[0], allowOffTurn: true });
  resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
  return played;
}

export function sztb094ResolveLogin2({ state, playerId, card }) {
  beginSztb094Access(state, playerId, card.name);
}

