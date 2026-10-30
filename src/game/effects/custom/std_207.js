import { addLog } from "../../core/shared.js";

export function std207RevealSelection(state, continuation, result, playerId, player) {
  const target = player.hand.find((item) => item.uid === result.selected[0] && item.color === "紫");
  if (!target) return false;
  target.revealed = true;
  target.turnCostModifier = Number(target.turnCostModifier ?? 0) - 2;
  addLog(state, `クラフト・パッチワーク: ${target.name}を公開。このターン実行メモリ-2。`, "effect");
  state.pending = null;
  return true;
}
