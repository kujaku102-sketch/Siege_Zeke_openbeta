import { createSelectionRequest } from "../../selection-model.js";
import { runtimeActionCandidates } from "./action-values.js";

export function openRuntimeDecodeSelection(state, playerId, source, action, runtime) {
  const candidates = runtimeActionCandidates(state, playerId, source, action, runtime);
  const minimum = Math.max(0, Number(action.minimum ?? action.count ?? 1));
  const maximum = Math.min(candidates.length, Math.max(0, Number(action.maximum ?? action.count ?? 1)));
  if (candidates.length < minimum) return false;
  const request = createSelectionRequest({
    mode: minimum === maximum ? (maximum === 1 ? "single" : "exact") : "up_to",
    candidates: candidates.map((card) => card.uid),
    count: maximum,
    minimum,
    maximum,
    budget: action.totalOriginalMemoryMaximum,
    candidateValues: action.totalOriginalMemoryMaximum === undefined
      ? undefined
      : Object.fromEntries(candidates.map((card) => [card.uid, Number(card.cost ?? 0)])),
    candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])),
    label: `${source.name}: デコードするカードを選択`,
    message: source.text,
    continuation: {
      type: "runtime-decode",
      playerId,
      sourceId: source.id,
      sourceUid: source.uid,
      sourceName: source.name,
      runtime,
      enterSleep: Boolean(action.enterSleep),
      destroyAtTurnEnd: Boolean(action.destroyAtTurnEnd),
      destroyTurnPlayerId: action.destroyAtTurnEnd ? state.active : null
    }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}
