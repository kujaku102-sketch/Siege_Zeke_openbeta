// STD-105 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { createSelectionRequest } from "../../game/selection-model.js";
import { activateScript } from "../../game/core/scripts.js";
import { addLog, fail } from "../../game/core/shared.js";
import { PASS } from "../../game/effects/custom/index.js";
import { forceExecute } from "../../game/core/play.js";
import { setCardSleeping } from "../../game/effects/generic/placement.js";

// handlers (was effects/custom/std_105.js)
export function activateStd105Selection(state, continuation, result, playerId, player) {
  state.pending = null;
  return activateScript(state, playerId, continuation.scriptUid, { selectionUid: result.selected[0] });
}

export function std105ActivateScriptCore({ state, playerId, selectionUid, script }) {
  forceExecute(state, playerId, selectionUid, {
    placementSource: script.name,
    onPlaced: (placed) => {
      setCardSleeping(state, playerId, placed);
      placed.summoningSick = false;
      placed.grantedKeywords = [...new Set([...(placed.grantedKeywords ?? []), "SECURITY"])];
    }
  });
  const placed = state.players[playerId].front.concat(state.players[playerId].back).find((card) => card.uid === selectionUid);
  if (placed) {
    state.delayedEffects.push({ event: "turn_ended", dueTurn: state.turnNumber + 1, type: "destroy_card", ownerId: playerId, cardUid: placed.uid, sourceName: script.name });
    addLog(state, `${script.name}: ${placed.name}を強制実行し、スリープ・[セキュリティ]を付与。`, "effect");
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
