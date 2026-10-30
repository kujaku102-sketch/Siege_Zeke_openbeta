import { activateScript } from "../../core/scripts.js";

export function activateStd105Selection(state, continuation, result, playerId, player) {
  state.pending = null;
  return activateScript(state, playerId, continuation.scriptUid, { selectionUid: result.selected[0] });
}
