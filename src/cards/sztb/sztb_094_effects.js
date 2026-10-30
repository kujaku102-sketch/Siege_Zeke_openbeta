// SZTB-094 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { isObCard } from "../../game/card-types.js";
import { hasKeyword } from "../../game/effect-compiler.js";
import { createSelectionRequest } from "../../game/selection-model.js";
import { runEffectEntry } from "../../game/core/effects.js";
import { getEffectTargets, playCard, spellNeedsTarget } from "../../game/core/play.js";
import { findCard, isArmsBandCard, otherPlayer } from "../../game/core/shared.js";
import { executionCost, magazineExecutionCandidates } from "../../game/effects/generic/cost.js";

// handlers (was effects/custom/sztb_094.js)
export function beginSztb094Counter(state, playerId, sourceUid) {
  const source = findCard(state, sourceUid)?.card;
  if (!source || source.id !== "SZTB-094" || source.sleep) return false;
  const candidates = magazineExecutionCandidates(state, playerId);
  if (!candidates.length) return false;
  const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((item) => item.uid), count: 1, minimum: 0, maximum: 1,
    candidateLabels: Object.fromEntries(candidates.map((item) => [item.uid, `${item.name} / メモリ${executionCost(item, state, playerId)}`])),
    label: `${source.name}: [弾倉]Spを実行`, message: "選んだ場合、これをスリープして選択したSpを実行する。選ばず確定も可能。",
    continuation: { type: "sztb094-counter-select", playerId, sourceUid } });
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
  if (!spell) { state.pending = null; return true; }
  if (!source || source.sleep) return false;
  source.sleep = true;
  if (spellNeedsTarget(spell)) {
    const targets = getEffectTargets(state, otherPlayer(playerId), spell);
    if (!targets.length) { source.sleep = false; state.pending = null; return false; }
    const request = createSelectionRequest({ mode: "single", candidates: targets.map((item) => item.uid), count: 1,
      candidateLabels: Object.fromEntries(targets.map((item) => [item.uid, item.name])), label: `${spell.name}: 対象を選択`, message: spell.text,
      continuation: { type: "sztb094-counter-target", playerId, spellUid: spell.uid, sourceUid: source.uid } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  state.pending = null;
  return playCard(state, playerId, spell.uid, { allowOffTurn: true });
}

export function sztb094CounterTargetSelection(state, continuation, result, playerId, player) {
  state.pending = null;
  return playCard(state, playerId, continuation.spellUid, { targetUid: result.selected[0], allowOffTurn: true });
}

export function sztb094ResolveLogin2({ state, playerId, card }) {
  beginSztb094Access(state, playerId, card.name);
}

export function sztb094CounterDrainIndependentEffects({ state, next }) {
  runEffectEntry(state, next.kind, next.playerId, () => beginSztb094Counter(state, next.playerId, next.sourceUid));
}
