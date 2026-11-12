import { isObCard } from "../../game/card-types.js";
import { createSelectionRequest } from "../../game/selection-model.js";
import { addLog, otherPlayer, payMemory } from "../../game/core/shared.js";
import { addCounterToTargets } from "../../game/core/counters.js";
import { PASS } from "../../game/effects/custom/index.js";
import { destroyCard } from "../../game/effects/generic/destroy.js";
import { emitCardPlacement, placeByMode } from "../../game/effects/generic/placement.js";

// handlers (was effects/custom/std_160.js)
export function std160ResolveLogin({ opponent, state, playerId, card }) {
  // 全員に置いてから、対象ごとに1回ずつ、そこに乗った数で判定する
  const targets = [...[...opponent.front, ...opponent.back].filter(isObCard).map((target) => ({ card: target })), { userId: otherPlayer(playerId) }];
  addCounterToTargets(state, targets, "madness", 3, playerId, card.name);
  addLog(state, `${card.name}: 相手Obすべてとユーザーへ狂気カウンター3個。`, "effect");
}

export function std160ActivateCardEffectCore({ player, effect, card, state, playerId }) {
  if (effect.kind === "proxy") {
    const zoneName = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
    payMemory(state, playerId, effect.cost, "proxy");
    const sourceIndex = player.hand.findIndex((item) => item.uid === card.uid);
    const [source] = player.hand.splice(sourceIndex, 1);
    if (placeByMode(state, playerId, source, { zone: zoneName, from: "hand", source: card.name }) !== "placed") return true;
    emitCardPlacement(state, playerId, source, zoneName, "proxy", source.name);
    destroyCard(state, playerId, source.uid, { source: `${source.name}の[プロキシ]`, suppressReplacement: true });
    const candidates = player.deck.filter((item) => item.category === "Script" && item.name.includes("旧支配者"));
    if (candidates.length) {
      const request = createSelectionRequest({ mode: "single", candidates: candidates.map((item) => item.uid), count: 1,
        candidateLabels: Object.fromEntries(candidates.map((item) => [item.uid, item.name])), label: "旧支配者Scriptへアクセス", message: card.text,
        continuation: { type: "access-to-deck-top", playerId, sourceName: card.name } });
      state.pending = { type: "selection", validTargets: request.candidates, request };
    }
    return true;
  }
  return PASS;
}
