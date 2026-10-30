// STD-097 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { attack, continueAttackAfterCost } from "../../game/core/battle.js";
import { findCard } from "../../game/core/shared.js";
import { beginSourceLayerSelection, consumeSelectedSourceLayers } from "../../game/effects/generic/cost.js";
import { grantDamageModifier } from "../../game/effects/generic/damage.js";

// handlers (was effects/custom/std_097.js)
export function std097BattleChoiceSelection(state, continuation, result, playerId, player) {
  const sourceLocation = findCard(state, continuation.sourceUid);
  state.pending = null;
  if (!sourceLocation) return false;
  const source = sourceLocation.card;
  if (result.scope === "レイヤー1枚を破棄して①を起動") {
    return beginSourceLayerSelection(state, sourceLocation.playerId, source, 1, {
      type: "std097-battle-pay", playerId: sourceLocation.playerId, sourceUid: source.uid,
      attackerPlayerId: continuation.attackerPlayerId, attackerUid: continuation.attackerUid, targetUid: continuation.targetUid
    });
  }
  source.skipStd097BattleChoice = true;
  return attack(state, continuation.attackerPlayerId, continuation.attackerUid, continuation.targetUid);
}

export function std097BattlePaySelection(state, continuation, result, playerId, player) {
  const sourceLocation = findCard(state, continuation.sourceUid);
  state.pending = null;
  if (!sourceLocation) return false;
  const source = sourceLocation.card;
  const layers = consumeSelectedSourceLayers(state, sourceLocation.playerId, source, result.selected, `${source.name}のレイヤーコスト`);
  if (!layers || layers.length !== 1) return false;
  source.skipStd097BattleChoice = true;
  grantDamageModifier(source, {
    direction: "received", damageKind: "battle", operation: "cap_max", amount: 1, duration: "battle"
  });
  return continueAttackAfterCost(state, continuation.attackerPlayerId, continuation.attackerUid, continuation.targetUid);
}
