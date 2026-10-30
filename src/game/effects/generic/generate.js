import { createRuntimeCard } from "../../runtime/factory.js";
import { openScriptActivationWindow } from "../../core/scripts.js";
import { hydrateCard } from "../../core/setup.js";
import { addLog } from "../../core/shared.js";
import { emitGameEvent } from "../../core/triggers.js";
import { distributeLayeredFollowers, revealMountedCode } from "./trash.js";

export function emitCardsGenerated(state, playerId, cards, source) {
  if (!cards.length) return null;
  const event = emitGameEvent(state, {
    type: "card_generated", playerId, ownerId: playerId,
    cardUid: cards[0].uid, cardUids: cards.map((card) => card.uid), amount: cards.length, source
  });
  for (const controllerId of ["player", "ai"]) {
    const scripts = state.players[controllerId].back.filter((card) => card.id === "STD-038" && card.faceDown === true
      && state.players[controllerId].memory >= Number(card.cost ?? 0));
    for (const script of scripts) openScriptActivationWindow(state, controllerId, script, event);
  }
  return event;
}

export function banGeneratedCards(state, uids, source) {
  let moved = 0;
  for (const playerId of ["player", "ai"]) {
    const player = state.players[playerId];
    for (const uid of uids) {
      for (const zoneName of ["hand", "front", "back", "registry", "trash", "deck"]) {
        const index = player[zoneName].findIndex((card) => card.uid === uid);
        if (index < 0) continue;
        const [card] = player[zoneName].splice(index, 1);
        if (["front", "back"].includes(zoneName)) revealMountedCode(player[zoneName], index, card, playerId, zoneName);
        player.ban.push(card);
        if (["front", "back"].includes(zoneName)) distributeLayeredFollowers(state, card, "ban", source);
        moved += 1;
        break;
      }
    }
  }
  addLog(state, `${source}: 生成されたカード${moved}枚をBAN。`, "effect");
  return moved;
}

export function createVengeanceCard(state, cardId, ownerId) {
  return hydrateCard(createRuntimeCard(state.runtimeContext ?? null, cardId, ownerId, ++state.tokenSerial + 800));
}
