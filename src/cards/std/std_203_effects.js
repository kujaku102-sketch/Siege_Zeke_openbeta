// STD-203 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { boardSlotOf, cardAtBoardSlot } from "../../game/board-slots.js";
import { isObCard } from "../../game/card-types.js";
import { createSelectionRequest } from "../../game/selection-model.js";
import { dealCardDamage } from "../../game/core/battle.js";
import { declareResponse } from "../../game/core/response.js";
import { findCard, otherPlayer } from "../../game/core/shared.js";
import { PASS } from "../../game/effects/custom/index.js";
import { destroyCard } from "../../game/effects/generic/placement.js";

// handlers (was effects/custom/std_203.js)
export function activateStd203Response(state, playerId, cardUid, selectedUids, responseEvent) {
  const own = selectedUids.map((uid) => findCard(state, uid)).find((entry) => entry?.playerId === playerId && isObCard(entry.card) && ["front", "back"].includes(entry.zoneName));
  const enemyId = otherPlayer(playerId);
  const enemy = selectedUids.map((uid) => findCard(state, uid)).find((entry) => entry?.playerId === enemyId && isObCard(entry.card) && ["front", "back"].includes(entry.zoneName));
  if (!own || !enemy) return false;
  return declareResponse(state, playerId, cardUid, {
    targetUid: enemy.card.uid, targetUids: [own.card.uid, enemy.card.uid], responseEvent
  });
}

export function activateStd203ResponseSelection(state, continuation, result, playerId, player) {
  state.pending = null;
  return activateStd203Response(state, playerId, continuation.cardUid, result.selected, continuation.responseEvent);
}

export function std203NormalSpellSelection({ state, playerId }) {
  const own = [...state.players[playerId].front, ...state.players[playerId].back].filter(isObCard);
  const enemy = [...state.players[otherPlayer(playerId)].front, ...state.players[otherPlayer(playerId)].back].filter(isObCard);
  return { candidates: [...own, ...enemy], minimum: 2, maximum: 2, scopes: [], groups: [own, enemy] };
}

export function std203ResolveSpell({ targetUids, state, playerId, opponentId, card }) {
  const ownEntry = targetUids.map((uid) => findCard(state, uid)).find((entry) => entry?.playerId === playerId && isObCard(entry.card));
  const enemyEntry = targetUids.map((uid) => findCard(state, uid)).find((entry) => entry?.playerId === opponentId && isObCard(entry.card));
  if (ownEntry && enemyEntry) {
    const column = boardSlotOf(state.players[opponentId][enemyEntry.zoneName], enemyEntry.card, {
      controllerId: opponentId, zoneName: enemyEntry.zoneName, limit: state.players[opponentId].user?.[`${enemyEntry.zoneName}Limit`]
    });
    destroyCard(state, playerId, ownEntry.card.uid, { source: card.name, suppressReplacement: true });
    const enemyUid = enemyEntry.card.uid;
    state.lastDamageOutcome = null;
    dealCardDamage(state, opponentId, enemyUid, 2, card.name);
    if (state.lastDamageOutcome?.targetUid === enemyUid && state.lastDamageOutcome.destructionDetermined) {
      const sameColumn = ["front", "back"]
        .map((zoneName) => cardAtBoardSlot(state.players[opponentId][zoneName], column, {
          controllerId: opponentId, zoneName, limit: state.players[opponentId].user?.[`${zoneName}Limit`]
        }))
        .filter((target) => target && target.uid !== enemyUid && isObCard(target));
      if (sameColumn.length) {
        const request = createSelectionRequest({
          mode: "single", candidates: sameColumn.map((item) => item.uid), count: 1,
          label: "同じ縦列のObを1体選択", message: "傀儡特攻の追加2ダメージ。",
          continuation: { type: "deal-selected-damage", playerId, sourceName: card.name, amount: 2 }
        });
        state.pending = { type: "selection", validTargets: request.candidates, request };
      }
    }
  }
  return PASS;
}

export function std203ResponseCardApplicable({ state, playerId, opponent }) {
  return [...state.players[playerId].front, ...state.players[playerId].back].some(isObCard)
    && [...opponent.front, ...opponent.back].some(isObCard);
}
