import { createRuntimeCard } from "../../runtime/factory.js";
import { cardAtk, cardMaxStr } from "../../core/battle.js";
import { hydrateCard } from "../../core/setup.js";
import { addLog, findCard } from "../../core/shared.js";
import { destroyCard, emitEffectPlacement, placeByMode } from "../generic/placement.js";

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
