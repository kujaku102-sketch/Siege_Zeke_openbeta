import { createSelectionRequest } from "../../selection-model.js";
import { fail, findCard } from "../../core/shared.js";
import { PASS } from "./index.js";
import { resumeDestroyLkiFollowUp } from "../generic/actions.js";
import { destroyCard, placeCardByEffect } from "../generic/placement.js";

export function std157PlaceSelection(state, continuation, result, playerId, player) {
  state.pending = null;
  const zone = player.front.length < player.user.frontLimit ? "front" : "back";
  // エリアが埋まっていて置けなかった時はルール破壊で処理済み。効果全体は巻き戻さない
  return ["placed", "failed-placement"].includes(placeCardByEffect(state, {
    sourceOwnerId: playerId, controllerId: playerId, sourceZone: "hand", targetZone: zone, cardUid: result.selected[0], sourceName: continuation.sourceName,
    onPlaced: (card) => { card.summoningSick = zone === "front"; }
  }).status);
}

export function std157ResolveLogin({ player, card, playerId, state }) {
  const candidates = [...player.front, ...player.back].filter((item) => item.uid !== card.uid);
  if (candidates.length) {
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((item) => item.uid), count: 1,
      label: "破壊する他の自分エリアカード", message: card.text,
      continuation: { type: "std157-destroy", playerId, sourceName: card.name } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
  }
}

export function std157GetEffectActivationTargets2({ player, card }) {
  return [...player.front, ...player.back].filter((item) => item.uid !== card.uid);
}

export function std157ActivateCardEffectCore({ state, targetUid, playerId, card, player, effect }) {
  if (effect.kind === "update") {
    const target = findCard(state, targetUid);
    if (!target || target.playerId !== playerId || !["front", "back"].includes(target.zoneName) || target.card.uid === card.uid) return fail(state, "破壊する他の自分エリアカードを選んで。", false);
    player.memory -= effect.cost;
    const x = Number(target.card.cost ?? 0);
    (state.destroyLkiFollowUps ??= {})[target.card.uid] = { type: "std157", playerId, sourceName: card.name, x };
    const resolved = destroyCard(state, playerId, target.card.uid, { source: card.name });
    if (!state.pending) resumeDestroyLkiFollowUp(state, target.card.uid);
    return resolved;
  }
  return PASS;
}
