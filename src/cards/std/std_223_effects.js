import { isObCard } from "../../game/card-types.js";
import { createSelectionRequest } from "../../game/selection-model.js";
import { attack, continueAttackAfterCost } from "../../game/core/battle.js";
import { dealCardDamage } from "../../game/core/deal-damage.js";
import { drawCards } from "../../game/core/draw.js";
import { findCard } from "../../game/core/shared.js";
import { moveCardToTrash } from "../../game/effects/generic/trash.js";

// handlers (was effects/custom/std_223.js)
export function std223AmbushChoiceSelection(state, continuation, result, playerId, player) {
  const attacker = findCard(state, continuation.attackerUid)?.card;
  if (!attacker) return false;
  attacker.skipStd223Ambush = true;
  if (result.scope === "起動しない") { state.pending = null; return attack(state, continuation.attackerPlayerId, attacker.uid, continuation.attackTargetUid); }
  const candidates = Object.values(state.players).flatMap((current) => [...current.front, ...current.back]).filter(isObCard);
  const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
    label: "異次元ショットで3ダメージを与えるOb", message: continuation.sourceName,
    continuation: { type: "std223-ambush-target", playerId, sourceUid: continuation.sourceUid, sourceName: continuation.sourceName,
      attackerPlayerId: continuation.attackerPlayerId, attackerUid: attacker.uid, attackTargetUid: continuation.attackTargetUid } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function std223AmbushTargetSelection(state, continuation, result, playerId, player) {
  const sourceIndex = player.registry.findIndex((card) => card.uid === continuation.sourceUid && card.id === "STD-223");
  const target = findCard(state, result.selected[0]);
  if (sourceIndex < 0 || !target || !isObCard(target.card) || player.memory < 2) return false;
  const [source] = player.registry.splice(sourceIndex, 1);
  player.memory -= 2;
  moveCardToTrash(state, playerId, source, source.name);
  state.lastDamageOutcome = null;
  dealCardDamage(state, target.playerId, target.card.uid, 3, source.name, { sourcePlayerId: playerId });
  if (state.lastDamageOutcome?.destructionDetermined) drawCards(state, playerId, 1);
  state.pending = null;
  const attacker = findCard(state, continuation.attackerUid)?.card;
  if (!attacker) return true;
  // 3ダメージで破壊されたObの「自分Obが破壊された時」Script確認などが開いている間は、確認が済んでから宣言し直す。
  // 3ダメージを受けた攻撃者自身が[バックアップ]や破壊で攻撃できなくなった場合は、宣言した攻撃がそこで終わる(回答は拒否しない)。
  continueAttackAfterCost(state, continuation.attackerPlayerId, attacker.uid, continuation.attackTargetUid);
  return true;
}
