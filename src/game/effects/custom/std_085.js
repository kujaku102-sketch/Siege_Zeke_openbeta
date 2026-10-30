import { continueAttackAfterCost } from "../../core/battle.js";
import { findCard } from "../../core/shared.js";
import { consumeSelectedSourceLayers } from "../generic/cost.js";
import { destroyCard } from "../generic/placement.js";

export function std085LayerPaySelection(state, continuation, result, playerId, player) {
    const sourceLocation = findCard(state, continuation.sourceUid);
    state.pending = null;
    if (!sourceLocation) return false;
    const source = sourceLocation.card;
    const layers = consumeSelectedSourceLayers(state, sourceLocation.playerId, source, result.selected, `${source.name}の攻撃時コスト`);
    if (!layers || layers.length !== 1) return false;
    source.permanentAtk = Number(source.permanentAtk ?? 0) + 2;
    if (source.mounted.length + 1 <= 1) {
      destroyCard(state, sourceLocation.playerId, source.uid, { source: `${source.name}のレイヤー閾値判定` });
      return true;
    }
    source.skipStd085LayerCost = true;
    return continueAttackAfterCost(state, continuation.attackerPlayerId, continuation.attackerUid, continuation.targetUid);
}
