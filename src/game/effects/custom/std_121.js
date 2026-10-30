import { dealFortressDamage } from "../../core/battle.js";
import { addLog, otherPlayer } from "../../core/shared.js";
import { drawCards } from "../../core/turn.js";
import { PASS } from "./index.js";
import { moveCardToTrash } from "../generic/placement.js";

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
