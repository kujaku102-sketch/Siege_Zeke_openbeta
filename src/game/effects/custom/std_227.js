import { cardAtk } from "../../core/battle.js";
import { addLog, otherPlayer, shuffle } from "../../core/shared.js";
import { emitGameEvent } from "../../core/triggers.js";
import { PASS } from "./index.js";
import { createVengeanceCard, destroyCard, emitEffectPlacement, placeByMode } from "../generic/placement.js";

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

export function std227AttackCore({ attacker, playerId, state }) {
  if (!attacker.resolvingStd227Attack && cardAtk(state, playerId, attacker) >= 7) {
    attacker.resolvingStd227Attack = true;
    const opponentId = otherPlayer(playerId);
    const victims = [...state.players[opponentId].front];
    let generated = 0;
    for (const victim of victims) {
      if (!destroyCard(state, opponentId, victim.uid, { source: attacker.name })) continue;
      const proof = createVengeanceCard(state, "STD-228", opponentId);
      proof.summoningSick = true;
      if (placeByMode(state, opponentId, proof, { zone: "front", from: "generated", source: attacker.name }) === "placed") { emitEffectPlacement(state, playerId, proof, "front", attacker.name); generated += 1; }
    }
    addLog(state, `${attacker.name}: 相手フロント${victims.length}枚を破壊し、「征服の証」を${generated}枚配置。`, "effect");
  }
  return PASS;
}

export function std227ResolveLogin({ state, playerId, card }) {
  resolveImperialRandomInstall(state, playerId, card.name);
}

export function std227ActivateCardEffectCore({ player, effect, state, playerId, card }) {
  if (effect.kind === "update") {
    player.memory -= effect.cost;
    resolveImperialRandomInstall(state, playerId, card.name);
    return true;
  }
  return PASS;
}
