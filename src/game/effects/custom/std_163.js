import { createChoiceSpec, selectionRequestFromSpec } from "../../selection-model.js";

export function continueStd163Choices(state, continuation, remaining) {
  if (remaining <= 0) return true;
  const request = selectionRequestFromSpec(createChoiceSpec({ options: ["①カードを2枚引く", "②相手Obに3ダメージ"] }), {
    label: `残り${remaining}回：①または②`, message: continuation.sourceName,
    continuation: { type: "std163-choice", playerId: continuation.playerId, sourceName: continuation.sourceName, remaining }
  });
  state.pending = { type: "selection", validTargets: [], request };
  return true;
}
