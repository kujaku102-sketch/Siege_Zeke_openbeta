import { continueAttackAfterCost } from "../../game/core/battle.js";
import { findCard } from "../../game/core/shared.js";
import { PASS } from "../../game/effects/custom/index.js";
import { beginSourceLayerSelection, consumeSelectedSourceLayers } from "../../game/effects/generic/cost.js";
import { destroyCard } from "../../game/effects/generic/destroy.js";

// handlers (was effects/custom/std_085.js)
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

export function std085AttackCore5({ state, playerId, attacker, targetUid }) {
  if (attacker.mounted.length && !attacker.skipStd085LayerCost) {
    return beginSourceLayerSelection(state, playerId, attacker, 1, {
      type: "std085-layer-pay", playerId, sourceUid: attacker.uid,
      attackerPlayerId: playerId, attackerUid: attacker.uid, targetUid
    });
  }
  return PASS;
}
