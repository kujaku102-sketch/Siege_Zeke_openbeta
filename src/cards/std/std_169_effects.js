import { isObCard } from "../../game/card-types.js";
import { addLog, fail, findCard, otherPlayer, payMemory } from "../../game/core/shared.js";
import { PASS } from "../../game/effects/custom/index.js";
import { moveCardToTrash } from "../../game/effects/generic/trash.js";

// handlers (was effects/custom/std_169.js)
export function std169GetEffectActivationTargets({ state, playerId, effectId, card }) {
  if (effectId?.startsWith(`${card.id}:proxy:`)) {
    const opponent = state.players[otherPlayer(playerId)];
    return [...opponent.front, ...opponent.back].filter(isObCard);
  }
  return PASS;
}

export function std169ActivateCardEffectCore({ state, targetUid, playerId, player, effect, card }) {
  if (effect.kind === "proxy") {
    const target = findCard(state, targetUid);
    if (!target || target.playerId === playerId || !["front", "back"].includes(target.zoneName) || !isObCard(target.card)) return fail(state, "相手Obを選んで。", false);
    payMemory(state, playerId, effect.cost, "proxy");
    const sourceIndex = player.hand.findIndex((item) => item.uid === card.uid);
    moveCardToTrash(state, playerId, player.hand.splice(sourceIndex, 1)[0], card.name);
    target.card.load = Number(target.card.load ?? 0) + 3;
    addLog(state, `${card.name}: [プロキシ:${effect.cost}]で${target.card.name}へ[負荷]3。`, "effect");
    return true;
  }
  return PASS;
}
