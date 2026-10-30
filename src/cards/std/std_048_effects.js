import { createRuntimeCard } from "../../game/runtime/factory.js";
import { resumeMandatoryDrawContinuation } from "../../game/core/draw.js";
import { getEffectActivationTargets } from "../../game/core/play.js";
import { hydrateCard } from "../../game/core/setup.js";
import { addLog, fail, otherPlayer } from "../../game/core/shared.js";
import { PASS } from "../../game/effects/custom/index.js";
import { destroyCard, moveCardToTrash, placeByMode } from "../../game/effects/generic/placement.js";

// handlers (was effects/custom/std_048.js)
export function settleStd048MandatoryPlacement(state, pending, placed) {
  const continuation = state.mandatoryDrawContinuation;
  if (pending?.type !== "std048-draw-place" || !continuation
    || continuation.type !== "std048-mandatory-draw"
    || continuation.sourceUid !== pending.sourceUid
    || continuation.placementOutcome !== "pending") return false;
  continuation.placementOutcome = placed ? "placed" : "failed";
  return resumeMandatoryDrawContinuation(state);
}

export function beginStd048MandatoryDraw(state, playerId, card, remainingRuleDraws) {
  card.dragFree = true;
  state.effectResolution = {
    id: `EFFECT-${++state.effectSerial}`, kind: "STD-048-mandatory-draw", source: card.uid,
    playerId, status: "awaiting-choice"
  };
  state.mandatoryDrawContinuation = {
    type: "std048-mandatory-draw", playerId, sourceUid: card.uid, sourceName: card.name,
    remainingRuleDraws, placementOutcome: "pending", ruleDrawDone: remainingRuleDraws === 0, successEffectDone: false
  };
  state.pending = {
    type: "std048-draw-place", playerId, sourceName: card.name,
    queue: [card.uid], sourceUid: card.uid
  };
  addLog(state, `${card.name}: ルールによる最初のドローで引いた。配置先を選択。`, "effect");
  return true;
}

export function std048ActivateCardEffectCore({ location, state, effect, player, playerId, card, effectId, targetUid }) {
  if (effect.kind === "proxy") {
    if (location.zoneName !== "hand") return fail(state, "[プロキシ]は手札から起動する。", false);
    const cost = Number(effect.cost ?? 0);
    if (player.memory < cost) return fail(state, "メモリ不足。", false);
    const opponentId = otherPlayer(playerId);
    if (card.id === "STD-049" && !getEffectActivationTargets(state, playerId, card, effectId).some((target) => target.uid === targetUid)) {
      return fail(state, "破壊する相手エリアのカードを選んで。", false);
    }
    let zoneName = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
    player.memory -= cost;
    player.hand.splice(player.hand.findIndex((item) => item.uid === card.uid), 1);
    if (card.id === "STD-048") player.deck.push(card);
    else {
      card.std049ProxyArmed = true;
      moveCardToTrash(state, playerId, card, card.name);
    }
    const calamity = hydrateCard(createRuntimeCard(state.runtimeContext ?? null, "STD-050", playerId, ++state.tokenSerial + 5000));
    calamity.summoningSick = false;
    if (placeByMode(state, playerId, calamity, { zone: zoneName, from: "generated", source: card.name }) !== "placed") {
      if (card.id === "STD-049") delete card.std049ProxyArmed;
      return true;
    }
    if (card.id === "STD-049") destroyCard(state, opponentId, targetUid, { source: card.name });
    addLog(state, `${card.name}: [プロキシ:6]で災いの明星を配置。`, "effect");
    return true;
  }
  return PASS;
}
