import { createRuntimeCard } from "../../game/runtime/factory.js";
import { createSelectionRequest } from "../../game/selection-model.js";
import { hydrateCard } from "../../game/core/setup.js";
import { addLog, findCard, isElectronFairy } from "../../game/core/shared.js";
import { cardAtk, cardMaxStr } from "../../game/core/stats.js";
import { PASS } from "../../game/effects/custom/index.js";
import { destroyCard, emitEffectPlacement, placeByMode } from "../../game/effects/generic/placement.js";

// handlers (was effects/custom/std_122.js)
export function technologyHorizonSelection(state, continuation, result, playerId, player) {
    if (!result.selected.length) {
      state.pending = null;
      addLog(state, `${continuation.sourceName}: 0体選択のため①以降を処理しない。`, "effect");
      return true;
    }
    const names = [];
    for (const uid of result.selected) {
      const location = findCard(state, uid);
      if (location && destroyCard(state, location.playerId, uid, { source: continuation.sourceName })) names.push(location.card.name);
    }
    if (!names.length) { state.pending = null; return true; }
    const x = names.reduce((sum, name) => sum + player.trash.filter((card) => card.name === name).length * 2, 0);
    for (let index = 0; index < 2; index += 1) {
      const zone = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
      const ghost = hydrateCard(createRuntimeCard(state.runtimeContext ?? null, "STD-123", playerId, ++state.tokenSerial + 1200));
      ghost.permanentAtk = x;
      ghost.permanentStr = x;
      ghost.summoningSick = cardAtk(state, playerId, ghost) < 5;
      if (placeByMode(state, playerId, ghost, { zone, from: "generated", source: continuation.sourceName }) !== "placed") continue;
      emitEffectPlacement(state, playerId, ghost, zone, continuation.sourceName);
      if (cardMaxStr(state, playerId, ghost) <= 0) destroyCard(state, playerId, ghost.uid, { source: "STR0以下の状態判定", suppressReplacement: true });
    }
    addLog(state, `${continuation.sourceName}: ゴースト2体を生成し+${x}/+${x}。`, "effect");
    state.pending = null;
    return true;
}

export function std122ResolveSpell({ player, card, playerId, state }) {
  const candidates = [...player.front, ...player.back].filter(isElectronFairy);
  const request = createSelectionRequest({
    mode: "up_to", candidates: candidates.map((item) => item.uid), count: candidates.length, maximum: candidates.length,
    label: "破壊するエレクトロンフェアリーを任意選択", message: card.text,
    continuation: { type: "technology-horizon", playerId, sourceName: card.name }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return PASS;
}
