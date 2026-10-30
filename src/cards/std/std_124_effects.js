// STD-124 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { isObCard } from "../../game/card-types.js";
import { createRuntimeCard } from "../../game/runtime/factory.js";
import { recordVictoryFact } from "../../game/core/effects.js";
import { hydrateCard } from "../../game/core/setup.js";
import { addLog, otherPlayer } from "../../game/core/shared.js";
import { drawCards } from "../../game/core/turn.js";
import { PASS } from "../../game/effects/custom/index.js";
import { emitCardsGenerated, moveCardToTrash, setCardSleeping } from "../../game/effects/generic/placement.js";

// handlers (was effects/custom/std_124.js)
export function std124ResolveLogin({ player, card, state, playerId }) {
  const count = player.trash.filter((item) => item.id === "STD-124").length;
  card.permanentAtk = Number(card.permanentAtk ?? 0) + count;
  card.permanentStr = Number(card.permanentStr ?? 0) + count;
  if (count >= 3) drawCards(state, playerId, 2);
  if (count >= 5) for (const target of [...state.players[otherPlayer(playerId)].front, ...state.players[otherPlayer(playerId)].back].filter(isObCard)) setCardSleeping(state, otherPlayer(playerId), target);
  if (count >= 7) card.grantedKeywords = [...new Set([...(card.grantedKeywords ?? []), "QA", "DISCONNECT"])];
  if (count >= 20) recordVictoryFact(state, { type: "special", playerId, sourceUid: card.uid, kind: "STD-124" });
  addLog(state, `${card.name}: ゴミ箱の同名${count}枚を参照し+${count}/+${count}。`, "effect");
}

export function std124ActivateCardEffectCore({ player, effect, card, state, playerId }) {
  if (effect.kind === "proxy") {
    player.memory -= effect.cost;
    const sourceIndex = player.hand.findIndex((item) => item.uid === card.uid);
    const [source] = player.hand.splice(sourceIndex, 1);
    moveCardToTrash(state, playerId, source, source.name);
    const generatedCards = [];
    for (let index = 0; index < 2; index += 1) generatedCards.push(hydrateCard(createRuntimeCard(state.runtimeContext ?? null, "STD-124", playerId, ++state.tokenSerial + 1400)));
    player.hand.push(...generatedCards);
    emitCardsGenerated(state, playerId, generatedCards, card.name);
    addLog(state, `${card.name}: 手札からSp扱いで[プロキシ]を起動し、同名カード2枚を生成。元カードはゴミ箱へ。`, "effect");
    return true;
  }
  return PASS;
}
