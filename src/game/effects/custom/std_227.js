import { addLog, otherPlayer, shuffle } from "../../core/shared.js";
import { emitGameEvent } from "../../core/triggers.js";

export function resolveImperialRandomInstall(state, playerId, sourceName) {
  const opponentId = otherPlayer(playerId);
  const opponent = state.players[opponentId];
  const sources = [
    { name: "hand", cards: opponent.hand },
    { name: "area", cards: [...opponent.front, ...opponent.back] },
    { name: "trash", cards: opponent.trash },
    { name: "deck", cards: opponent.deck }
  ];
  let moved = 0;
  for (const source of sources) {
    if (!source.cards.length) continue;
    const chosen = source.cards[Math.floor(state.rng() * source.cards.length)];
    let zone = source.name;
    if (zone === "area") zone = opponent.front.some((card) => card.uid === chosen.uid) ? "front" : "back";
    const index = opponent[zone].findIndex((card) => card.uid === chosen.uid);
    if (index < 0) continue;
    const [card] = opponent[zone].splice(index, 1);
    opponent.registry.push(card);
    moved += 1;
    emitGameEvent(state, { type: "card_moved", playerId: opponentId, ownerId: card.owner ?? opponentId,
      cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category, from: zone, to: "registry", source: sourceName });
  }
  opponent.deck = shuffle(opponent.deck, state.rng);
  addLog(state, `${sourceName}: 相手の手札・エリア・ゴミ箱・山札から各1枚までをレジストリへインストール（${moved}枚）。`, "effect");
  return moved;
}
