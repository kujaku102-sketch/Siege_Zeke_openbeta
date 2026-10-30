// STD-207 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { createSelectionRequest } from "../../game/selection-model.js";
import { addLog } from "../../game/core/shared.js";
import { PASS } from "../../game/effects/custom/index.js";
import { createVengeanceCard, emitCardsGenerated } from "../../game/effects/generic/placement.js";

// handlers (was effects/custom/std_207.js)
export function std207RevealSelection(state, continuation, result, playerId, player) {
  const target = player.hand.find((item) => item.uid === result.selected[0] && item.color === "紫");
  if (!target) return false;
  target.revealed = true;
  target.turnCostModifier = Number(target.turnCostModifier ?? 0) - 2;
  addLog(state, `クラフト・パッチワーク: ${target.name}を公開。このターン実行メモリ-2。`, "effect");
  state.pending = null;
  return true;
}

export function std207ResolveSpell({ state, playerId, player, card }) {
  const generatedCard = createVengeanceCard(state, "STD-189", playerId);
  player.hand.push(generatedCard);
  emitCardsGenerated(state, playerId, [generatedCard], card.name);
  const candidates = player.hand.filter((target) => target.color === "紫");
  if (candidates.length) {
    const request = createSelectionRequest({
      mode: "single", candidates: candidates.map((item) => item.uid), count: 1,
      label: "公開する紫のカードを1枚選択", message: card.text,
      continuation: { type: "std207-reveal", playerId, sourceUid: card.uid }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
  }
  return PASS;
}
