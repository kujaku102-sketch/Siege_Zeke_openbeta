import { createSelectionRequest } from "../../selection-model.js";
import { activateScript } from "../../core/scripts.js";
import { addLog, fail } from "../../core/shared.js";
import { PASS } from "./index.js";
import { forceExecuteCard, setCardSleeping } from "../generic/placement.js";

export function activateStd105Selection(state, continuation, result, playerId, player) {
  state.pending = null;
  return activateScript(state, playerId, continuation.scriptUid, { selectionUid: result.selected[0] });
}

export function std105ActivateScriptCore({ state, playerId, selectionUid, script }) {
  const execution = forceExecuteCard(state, {
    sourceOwnerId: playerId, controllerId: playerId, sourceZone: "hand", targetZone: "area", cardUid: selectionUid, sourceName: script.name,
    onPlaced: (placed) => {
      setCardSleeping(state, playerId, placed);
      placed.summoningSick = false;
      placed.grantedKeywords = [...new Set([...(placed.grantedKeywords ?? []), "SECURITY"])];
    }
  });
  if (execution.status === "placed") {
    state.delayedEffects.push({ event: "turn_ended", dueTurn: state.turnNumber + 1, type: "destroy_card", ownerId: playerId, cardUid: execution.card.uid, sourceName: script.name });
    addLog(state, `${script.name}: ${execution.card.name}を強制実行し、スリープ・[セキュリティ]を付与。`, "effect");
  }
  return PASS;
}

export function std105ActivateScriptCore2({ player, state, selectionUid, script, playerId, uid }) {
  const candidates = player.hand.filter((card) => card.printedCategory === "Lyd-Ob" || card.category === "Lyd-Ob");
  if (!candidates.length) return fail(state, "手札に強制実行できるLyd-Obがない。", false);
  if (!selectionUid) {
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])), label: "強制実行するLyd-Ob", message: script.text,
      continuation: { type: "activate-std105", playerId, scriptUid: uid } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (!candidates.some((card) => card.uid === selectionUid)) return fail(state, "手札のLyd-Obを選んで。", false);
  return PASS;
}
