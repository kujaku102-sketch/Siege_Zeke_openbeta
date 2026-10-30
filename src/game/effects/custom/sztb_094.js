import { createSelectionRequest } from "../../selection-model.js";
import { isObCard } from "../../card-types.js";
import { findCard, isArmsBandCard } from "../../core/shared.js";
import { executionCost, magazineExecutionCandidates } from "../generic/cost.js";

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
