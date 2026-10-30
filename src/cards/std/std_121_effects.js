import { dealFortressDamage } from "../../game/core/deal-damage.js";
import { drawCards } from "../../game/core/draw.js";
import { addLog, otherPlayer } from "../../game/core/shared.js";
import { PASS } from "../../game/effects/custom/index.js";
import { moveCardToTrash } from "../../game/effects/generic/trash.js";

// handlers (was effects/custom/std_121.js)
export function resolveTrinityEffect(state, activePlayerId, sourceName) {
  const active = state.players[activePlayerId];
  if (active.hand.length >= 3) for (const card of active.hand.splice(0, 3)) moveCardToTrash(state, activePlayerId, card, sourceName);
  else dealFortressDamage(state, activePlayerId, 3, otherPlayer(activePlayerId), sourceName);
  drawCards(state, activePlayerId, 2);
  addLog(state, `${sourceName}: アクティブユーザーが手札3枚を捨てるか3ダメージ、その後2枚ドロー。`, "effect");
}

export function std121ActivateScriptCore({ state, script }) {
  resolveTrinityEffect(state, state.active, script.name);
  return PASS;
}
