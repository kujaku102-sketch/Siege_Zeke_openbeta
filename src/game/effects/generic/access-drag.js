import { isObCard } from "../../card-types.js";
import { settleStd048MandatoryPlacement } from "../../../cards/std/std_048_effects.js";
import { runEffectEntry } from "../../core/effects.js";
import { addLog, findCard } from "../../core/shared.js";
import { resumeTriggerThreadAfterSelection } from "../../core/triggers.js";
import { emitEffectPlacement, placeByMode, placeCardByEffect, setCardSleeping } from "./placement.js";

export function resolveAccessDragPlacementCore(state, playerId, zone, underUid = null) {
  const pending = state.pending;
  if (!["access-drag-place", "decode-place", "std048-draw-place"].includes(pending?.type) || pending.playerId !== playerId) return false;
  const player = state.players[playerId];
  const uid = pending.queue[0];
  const card = pending.type === "decode-place"
    ? pending.cards.find((item) => item.uid === uid)
    : state.players[playerId].hand.find((item) => item.uid === uid);
  if (!card) return false;
  state.pending = null;
  if (pending.type === "decode-place") {
    const target = state.players[playerId][zone];
    const host = underUid ? target?.find((item) => item.uid === underUid && isObCard(item)) : null;
    if (!target || !(isObCard(card) || card.category === "Code") || (underUid && (!host || card.category !== "Code"))) { state.pending = pending; return false; }
    card.sleep = false;
    card.summoningSick = false;
    card.damage = 0;
    if (host) {
      card.layerRole = "code";
      host.mounted.push(card);
      addLog(state, `${pending.sourceName}: ${card.name}を${host.name}の下へ配置。`, "effect");
    } else {
      const outcome = placeByMode(state, playerId, card, { zone, from: "trash", source: pending.sourceName, suppressScriptWindow: true });
      if (outcome !== "placed") {
        const queue = pending.queue.slice(1); const cards = pending.cards?.filter((item) => item.uid !== uid);
        state.pending = queue.length ? { ...pending, queue, cards, sourceUid: queue[0] } : null;
        return true;
      }
      addLog(state, `${pending.sourceName}: ${card.name}を${zone === "front" ? "フロント" : "バック"}へ配置。`, "effect");
      emitEffectPlacement(state, playerId, card, zone, pending.sourceName);
    }
  } else {
    const placement = placeCardByEffect(state, {
      sourceOwnerId: playerId, controllerId: playerId, sourceZone: "hand", targetZone: zone, cardUid: uid, underUid, sourceName: pending.sourceName,
      placementCause: pending.type === "access-drag-place" ? "access_drag" : "effect",
      onPlaced: (placedCard) => { placedCard.summoningSick = zone === "front"; }
    });
    if (["invalid", "missing", "rejected"].includes(placement.status)) {
      state.pending = pending;
      return false;
    }
  }
  const placed = findCard(state, card.uid)?.zoneName;
  if (pending.type === "std048-draw-place") {
    settleStd048MandatoryPlacement(state, pending, ["front", "back"].includes(placed));
    return true;
  }
  if (!["front", "back"].includes(placed)) {
    const queue = pending.queue.slice(1); const cards = pending.cards?.filter((item) => item.uid !== uid);
    state.pending = queue.length ? { ...pending, queue, cards, sourceUid: queue[0] } : null;
    if (pending.triggerItemId && !state.pending) resumeTriggerThreadAfterSelection(state, pending.triggerItemId);
    return true;
  }
  const placedCard = findCard(state, card.uid)?.card;
  if (pending.enterSleep && placedCard) setCardSleeping(state, playerId, placedCard);
  if (pending.destroyAtTurnEnd) state.delayedEffects.push({ event: "turn_ended", turnPlayerId: pending.destroyTurnPlayerId,
    type: "destroy_card", ownerId: playerId, cardUid: card.uid, sourceName: pending.sourceName });
  const placementEffect = state.pending;
  const queue = pending.queue.slice(1);
  const cards = pending.cards?.filter((item) => item.uid !== uid);
  state.pending = placementEffect ?? (queue.length ? { ...pending, queue, cards, sourceUid: queue[0] } : null);
  if (pending.triggerItemId && !state.pending) resumeTriggerThreadAfterSelection(state, pending.triggerItemId);
  return true;
}

export function resolveAccessDragPlacement(state, playerId, zone, underUid = null) {
  return runEffectEntry(state, "placement", playerId, () => resolveAccessDragPlacementCore(state, playerId, zone, underUid));
}
