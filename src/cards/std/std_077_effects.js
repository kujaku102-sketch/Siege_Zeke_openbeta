import { CARD_LIBRARY } from "../../data/cards.js";
import { resumeDeferredAttack } from "../../game/core/battle.js";
import { drawCards } from "../../game/core/draw.js";
import { addLog, fail, findCard, hasClass, provisional } from "../../game/core/shared.js";
import { moveCardToTrash } from "../../game/effects/generic/trash.js";

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
  // 攻撃の途中で開いた窓に答えて、窓がもう残っていなければ、預けた攻撃(deferredAttack)を続ける(b8214a6の直しと同じ形。抜けていると攻撃が残ったまま詰む)。
  if (!state.pending && !state.prompt) resumeDeferredAttack(state);
  provisional(state, "レッドパンクス分類データが未整備のため、サムの手札コストは赤カード全般を選択可能。", CARD_LIBRARY["STD-077"]);
  return true;
}
