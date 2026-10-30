import { isObCard } from "../../card-types.js";
import { createSelectionRequest } from "../../selection-model.js";
import { findCard } from "../../core/shared.js";
import { addTimedModifier } from "../generic/actions.js";
import { grantDamageModifier } from "../generic/damage.js";

export function std140UpdateChoiceSelection(state, continuation, result, playerId, player) {
  if (result.scope === "①戦闘保護") {
    const candidates = [...player.front, ...player.back].filter(isObCard);
    if (!candidates.length) { state.pending = null; return true; }
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      label: "-2/0し戦闘ダメージを無効にするOb", message: continuation.sourceName,
      continuation: { type: "std140-protect", playerId, sourceName: continuation.sourceName } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  const candidates = player.trash.filter((card) => card.name.includes("聖樹") && card.name !== "聖樹枝(セフィラリンク)");
  if (!candidates.length) { state.pending = null; return true; }
  const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
    label: "サルベージする『聖樹枝』以外の聖樹カード", message: continuation.sourceName,
    continuation: { type: "salvage-selected", playerId, sourceName: continuation.sourceName } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function std140ProtectSelection(state, continuation, result, playerId, player) {
  const target = findCard(state, result.selected[0])?.card;
  if (target) {
    addTimedModifier(state, target, { atk: -2, str: 0, duration: "turn" }, continuation.sourceName);
    grantDamageModifier(target, {
      direction: "received", damageKind: "battle", operation: "set", amount: 0,
      duration: "turn", activeTurn: state.turnNumber
    });
  }
  state.pending = null;
  return true;
}
