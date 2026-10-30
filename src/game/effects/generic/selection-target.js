import { createSelectionRequest } from "../../selection-model.js";
import { keywordValue } from "../../core/keywords.js";
import { getEffectTargets } from "../../core/play-effects.js";
import { findCard, otherPlayer } from "../../core/shared.js";
import { runtimeSpecMatchesCard } from "./action-values.js";
import { executeRuntimeActions } from "./actions.js";
import { ownLayerEntries } from "./cost.js";

export function runtimeSelectionCandidates(state, playerId, source, action, runtime = { records: Object.create(null) }) {
  const selector = action.selector ?? {};
  const ownerScope = selector.owner ?? "both";
  const ownerIds = ownerScope === "both"
    ? [playerId, otherPlayer(playerId)]
    : ownerScope === "enemy" ? [otherPlayer(playerId)] : [playerId];
  const candidates = [];
  for (const ownerId of ownerIds) {
    const owner = state.players[ownerId];
    if (selector.effectTargeting) {
      candidates.push(...getEffectTargets(state, ownerId, source));
      continue;
    }
    for (const zone of selector.zones ?? ["area"]) {
      if (zone === "area") candidates.push(...owner.front, ...owner.back);
      else if (zone === "layers") candidates.push(...ownLayerEntries(owner).map((entry) => entry.layer));
      else if (Array.isArray(owner[zone])) candidates.push(...owner[zone]);
    }
  }
  return candidates.filter((card) => {
    if (card.uid === (selector.excludeSource ? source.uid : null) || !runtimeSpecMatchesCard(card, selector)) return false;
    if (selector.correspondsToRecordedHost) {
      const recorded = runtime.records?.[selector.correspondsToRecordedHost];
      const hostUid = Array.isArray(recorded) ? recorded[0] : recorded;
      const host = findCard(state, hostUid)?.card;
      if (!host) return false;
      const requirement = String(keywordValue(host, "LAYERED") ?? "");
      if (!requirement.includes(card.name) && !(card.classes ?? []).some((name) => requirement.includes(name))) return false;
    }
    return true;
  });
}

export function openRuntimeTargetSelection(state, playerId, source, action, runtime, continuationMeta = {}) {
  const candidates = runtimeSelectionCandidates(state, playerId, source, action, runtime);
  if (!candidates.length && action.continueWhenEmpty) {
    return action.skipAfterActionsWhenEmpty
      ? true
      : executeRuntimeActions(state, playerId, source, action.afterActions ?? [], { targetUid: null, runtime });
  }
  const minimum = Math.max(0, Number(action.minimum ?? action.count ?? 1));
  const configuredMaximum = action.maximum === "all" ? candidates.length : Number(action.maximum ?? action.count ?? 1);
  const maximum = Math.min(candidates.length, Math.max(0, configuredMaximum));
  if (candidates.length < minimum) return false;
  const mode = action.mode ?? (minimum === maximum ? (maximum === 1 ? "single" : "exact") : "up_to");
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
    label: action.label ?? `${source.name}: 対象を選択`,
    message: source.text,
    continuation: {
      type: "runtime-action-selection",
      playerId,
      sourceId: source.id,
      sourceUid: source.uid,
      sourceName: source.name,
      selector: action.selector ?? {},
      recordAs: action.recordAs,
      minimum,
      maximum,
      afterActions: action.afterActions ?? [],
      skipAfterActionsWhenEmpty: Boolean(action.skipAfterActionsWhenEmpty),
      runtime,
      ...continuationMeta
    }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function runtimePlayerCandidates(state, action) {
  return Object.entries(state.players)
    .filter(([, player]) => !action.filter?.trashNonEmpty || player.trash.length > 0)
    .map(([id]) => id);
}

export function openRuntimePlayerSelection(state, playerId, source, action, runtime) {
  const candidates = runtimePlayerCandidates(state, action);
  if (!candidates.length) return false;
  const request = createSelectionRequest({
    mode: "single", candidates, count: 1,
    candidateLabels: Object.fromEntries(candidates.map((id) => [id, state.players[id].user.name])),
    label: `${source.name}: ユーザーを選択`, message: source.text,
    continuation: {
      type: "runtime-player-selection", playerId, sourceId: source.id, sourceUid: source.uid, sourceName: source.name,
      candidates, recordAs: action.recordAs, afterActions: action.afterActions ?? [], runtime
    }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}
