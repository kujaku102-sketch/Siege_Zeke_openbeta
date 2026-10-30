import { CARD_LIBRARY } from "../../../data/cards.js";
import { cardRuntimeSpec } from "../../card-runtime-specs.js";
import { RuntimeError } from "../../runtime/factory.js";
import { createSelectionRequest } from "../../selection-model.js";
import { runtimeSpecMatchesCard } from "./action-values.js";
import { runtimePlayerCandidates } from "./selection-target.js";

export function runtimeAccessCandidates(player, action, referenceCard = null) {
  return player.deck.filter((card) => runtimeSpecMatchesCard(card, action.filter, referenceCard));
}

export function runtimeAccessBounds(action, candidateCount) {
  const configuredMaximum = action.maximum === "all" ? candidateCount : Number(action.maximum ?? action.count ?? 1);
  return {
    maximum: Math.min(candidateCount, Math.max(0, configuredMaximum)),
    minimum: Math.max(0, Number(action.minimum ?? action.count ?? 1))
  };
}

export function runtimeReferenceCandidates(player, source, action) {
  if (!action.referenceSelection) return [];
  const zone = action.referenceSelection.source === "own_hand" ? player.hand : [];
  return zone.filter((card) => card.uid !== source.uid && runtimeAccessCandidates(player, action, card).length >= runtimeAccessBounds(action, runtimeAccessCandidates(player, action, card).length).minimum);
}

export function runtimeSourceFromContinuation(state, continuation) {
  const source = {
    ...(CARD_LIBRARY[continuation.sourceId] ?? {}),
    id: continuation.sourceId,
    uid: continuation.sourceUid,
    name: continuation.sourceName,
    ...(continuation.sourceRuntime ?? {})
  };
  if (state.runtimeContext) {
    const alias = state.runtimeContext.uidAliases.find((entry) => entry.uid === continuation.sourceUid);
    if (!alias) throw new RuntimeError("RUNTIME_UNKNOWN_SOURCE_ALIAS");
    source.identity = { ...alias.identity };
    source.ownerSeat = alias.ownerSeat;
  }
  return source;
}

export function openRuntimeAccessSelection(state, playerId, source, action, referenceCard = null, revealedUid = null, continuationMeta = {}) {
  const player = state.players[playerId];
  if (action.referenceSelection && !referenceCard) {
    const references = runtimeReferenceCandidates(player, source, action);
    if (!references.length) return false;
    const request = createSelectionRequest({
      mode: "single",
      candidates: references.map((card) => card.uid),
      count: 1,
      candidateLabels: Object.fromEntries(references.map((card) => [card.uid, card.name])),
      label: `${source.name}: 参照するカードを選択`,
      message: source.text,
      continuation: {
        type: "runtime-access-reference", playerId, sourceId: source.id, sourceUid: source.uid,
        sourceName: source.name, action
      }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  const candidates = runtimeAccessCandidates(player, action, referenceCard);
  const { minimum, maximum } = runtimeAccessBounds(action, candidates.length);
  if (candidates.length < minimum) return false;
  const mode = action.mode ?? (minimum === maximum ? (maximum === 1 ? "single" : "exact") : "up_to");
  const destinationType = action.destination === "drag"
    ? "access-drag"
    : action.destination === "distribute"
      ? "access-distribute"
      : "access-to-hand";
  const request = createSelectionRequest({
    mode,
    candidates: candidates.map((card) => card.uid),
    count: maximum,
    minimum,
    maximum,
    budget: action.totalOriginalMemoryMaximum,
    candidateValues: action.totalOriginalMemoryMaximum === undefined
      ? undefined
      : Object.fromEntries(candidates.map((card) => [card.uid, Number(card.cost ?? 0)])),
    candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])),
    label: `${source.name}: アクセスするカードを選択`,
    message: source.text,
    continuation: {
      type: destinationType,
      playerId,
      sourceId: source.id,
      sourceUid: source.uid,
      sourceName: source.name,
      sourceRuntime: {
        ocPaidAmount: source.ocPaidAmount,
        executedFromRegistry: source.executedFromRegistry
      },
      enterSleep: Boolean(action.enterSleep),
      destinations: action.destinations,
      afterActions: action.afterActions,
      revealSelected: Boolean(action.reveal),
      revealedUid,
      ...continuationMeta
    }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function runtimeSpellAccessFailure(state, playerId, card) {
  const spec = cardRuntimeSpec(card.id, "spell");
  if (!spec) return null;
  const player = state.players[playerId];
  for (const action of spec.actions.filter((item) => item.type === "select_player")) {
    if (!runtimePlayerCandidates(state, action).length) return "条件を満たすユーザーがいない。";
  }
  for (const action of spec.actions.filter((item) => item.type === "access")) {
    if (action.referenceSelection) {
      if (!runtimeReferenceCandidates(player, card, action).length) return "参照条件を満たすアクセス先がない。";
      continue;
    }
    const candidates = runtimeAccessCandidates(player, action);
    if (candidates.length < runtimeAccessBounds(action, candidates.length).minimum) return "条件を満たすアクセス先が足りない。";
  }
  return null;
}
