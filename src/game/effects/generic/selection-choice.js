import { createChoiceSpec, createSelectionRequest, selectionRequestFromSpec } from "../../selection-model.js";
import { findCard } from "../../core/shared.js";
import { runtimeActionFeasible, runtimeSpecValue } from "./action-values.js";
import { placementResult } from "./placement.js";
import { runtimeSelectionCandidates } from "./selection-target.js";

export function openRuntimeChoiceSelection(state, playerId, source, action, runtime) {
  if (action.recordAs) runtime.records[action.recordAs] = runtimeSpecValue(state, playerId, source, action.value, runtime);
  const choices = action.choices.filter((choice) => choice.actions.every((nested) => runtimeActionFeasible(state, playerId, source, nested, runtime)));
  if (!choices.length) return false;
  const request = selectionRequestFromSpec(createChoiceSpec({ options: choices.map((choice) => choice.label) }), {
    label: `${source.name}: 効果を選択`,
    message: action.recordAs ? `X=${runtime.records[action.recordAs]}` : source.text,
    continuation: {
      type: "runtime-effect-choice",
      playerId,
      sourceId: source.id,
      sourceUid: source.uid,
      sourceName: source.name,
      choices,
      runtime
    }
  });
  state.pending = { type: "selection", validTargets: [], request };
  return true;
}

export function runtimeZoneChoiceOptions(state, playerId, source, action) {
  const location = findCard(state, source.uid);
  if (location?.playerId !== playerId || !["front", "back"].includes(location.zoneName)) return [];
  const requested = action.destinations === "other_area"
    ? [location.zoneName === "front" ? "back" : "front"]
    : action.destinations ?? [];
  return requested.filter((zone) => ["front", "back"].includes(zone) && placementResult(state.players[playerId], zone).ok);
}

export function openRuntimeZoneChoice(state, playerId, source, action, runtime) {
  const location = findCard(state, source.uid);
  const options = runtimeZoneChoiceOptions(state, playerId, source, action);
  if (!location || !options.length) return false;
  const request = createSelectionRequest({
    mode: "scope", scopeField: "destination", scopeOptions: options,
    label: `${source.name}: 移動先を選択`, message: source.text,
    continuation: {
      type: "runtime-zone-choice", playerId, sourceId: source.id, sourceUid: source.uid, sourceName: source.name,
      options, sourceZone: location.zoneName, sourceZoneRecord: action.sourceZoneRecord,
      destinationRecord: action.destinationRecord, afterActions: action.afterActions ?? [], runtime
    }
  });
  state.pending = { type: "selection", validTargets: [], request };
  return true;
}

export function openRuntimeRepeatSelectMove(state, playerId, source, action, runtime, remaining) {
  const candidates = runtimeSelectionCandidates(state, playerId, source, { selector: action.selector }, runtime);
  if (!candidates.length || remaining <= 0) return true;
  const request = createSelectionRequest({
    mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
    candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])),
    label: `${action.label ?? "カードを選択"}（残り${remaining}回）`, message: source.text,
    continuation: {
      type: "runtime-repeat-select-move", playerId, sourceId: source.id, sourceUid: source.uid,
      sourceName: source.name, selector: action.selector, sourceZone: action.source,
      destination: action.destination, remaining, runtime, label: action.label
    }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}
