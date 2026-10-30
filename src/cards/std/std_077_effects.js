// STD-077 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { CARD_LIBRARY } from "../../data/cards.js";
import { addLog, fail, findCard, hasClass, provisional } from "../../game/core/shared.js";
import { drawCards } from "../../game/core/turn.js";
import { moveCardToTrash } from "../../game/effects/generic/placement.js";

// handlers (was effects/custom/std_077.js)
export function resolveSamLogin(state, playerId, discardUid) {
  const player = state.players[playerId];
  const sourceUid = state.pending?.request?.continuation?.sourceUid;
  const source = sourceUid ? findCard(state, sourceUid)?.card : null;
  const index = player.hand.findIndex((card) => card.uid === discardUid
    && (source?.id === "STD-077" ? hasClass(card, "レッドパンクス") : card.color === "赤"));
  if (index < 0) return fail(state, "サムの効果で捨てる赤カードを選んで。", false);
  const [discarded] = player.hand.splice(index, 1);
  moveCardToTrash(state, playerId, discarded, "サムの効果コスト");
  drawCards(state, playerId, 2);
  state.pending = null;
  addLog(state, `ジャンカー・サム: ${discarded.name}を捨て、2枚ドロー。`, "effect");
  provisional(state, "レッドパンクス分類データが未整備のため、サムの手札コストは赤カード全般を選択可能。", CARD_LIBRARY["STD-077"]);
  return true;
}
