import { normalizeBoardSlots } from "../board-slots.js";
import { cardRuntimeSpec } from "../card-runtime-specs.js";
import { isObCard } from "../card-types.js";
import { attackPermissionSpecsFor } from "../continuous-effect-specs.js";
import { flattenedLayerCount } from "../layered-specs.js";
import { createSelectionRequest } from "../selection-model.js";
import { resolveTrinityEffect } from "../../cards/std/std_121_effects.js";
import { consumeProtect, dealFortressDamage } from "./deal-damage.js";
import { drawCards } from "./draw.js";
import { runEffectEntry } from "./effects.js";
import { hasKeyword } from "./keywords.js";
import { addLog, cardTraits, fail, findCard, otherPlayer } from "./shared.js";
import { battleStatModifierValue, cardAtk, cardCurrentStr, cardHasKeyword, cardHasRuntimeKeyword } from "./stats.js";
import { emitGameEvent } from "./triggers.js";
import { CUSTOM_ATTACK_CORE, CUSTOM_ATTACK_CORE_2, CUSTOM_ATTACK_CORE_3, CUSTOM_ATTACK_CORE_4, CUSTOM_ATTACK_CORE_5, CUSTOM_ATTACK_CORE_6, CUSTOM_QUEUE_POST_ATTACK_SELECTION, PASS } from "../effects/custom/index.js";
import { executeRuntimeActions } from "../effects/generic/actions.js";
import { applyDamageModifiers, clearDamageModifiers } from "../effects/generic/damage.js";
import { destroyCard } from "../effects/generic/destroy.js";
import { setCardSleeping } from "../effects/generic/placement.js";
import { beginDynamicSelectionModule } from "../effects/generic/selection-modules.js";

// コストの支払いや付随効果を終えた後に、宣言した攻撃を続ける。支払いで開いた確認(STD-003の窓など)が
// 残っている間はattack()がfalseを返し、回答ごと拒否されて詰むので、確認が済んでから宣言し直す。
export function continueAttackAfterCost(state, playerId, attackerUid, targetUid, { standbyAfter = false } = {}) {
  if (state.pending || state.prompt) {
    state.deferredAttack = { stage: null, playerId, attackerUid, targetUid, standbyAfter };
    return true;
  }
  const resolved = attack(state, playerId, attackerUid, targetUid);
  if (standbyAfter && findCard(state, attackerUid)) findCard(state, attackerUid).card.sleep = false;
  return resolved;
}

export function resumeDeferredAttack(state) {
  if (state.prompt || state.pending || !state.deferredAttack) return false;
  const deferred = state.deferredAttack;
  state.deferredAttack = null;
  state.attackResumeStage = deferred.stage;
  const result = attack(state, deferred.playerId, deferred.attackerUid, deferred.targetUid);
  delete state.attackResumeStage;
  if (deferred.standbyAfter && findCard(state, deferred.attackerUid)) findCard(state, deferred.attackerUid).card.sleep = false;
  return result;
}

export function getAttackTargets(state, attackerPlayerId, attacker) {
  const opponentId = otherPlayer(attackerPlayerId);
  const opponent = state.players[opponentId];
  const attackable = opponent.front.filter((card) => !cardHasRuntimeKeyword(state, opponentId, card, "ENCRYPTION"));
  const securities = attackable.filter((card) => card.sleep && cardHasKeyword(card, "SECURITY"));
  if (securities.length && !cardHasRuntimeKeyword(state, attackerPlayerId, attacker, "HACKING")) return securities.map((card) => ({ type: "card", uid: card.uid, label: card.name }));
  const sleeping = attackable.filter((card) => card.sleep);
  if (attacker?.summoningSick && cardHasRuntimeKeyword(state, attackerPlayerId, attacker, "CONTACT")) {
    return sleeping.map((card) => ({ type: "card", uid: card.uid, label: card.name }));
  }
  if (attackPermissionSpecsFor(attacker?.id).some((spec) => spec.type === "restrict_targets" && spec.rule === "ob_if_possible") && sleeping.length) {
    return sleeping.map((card) => ({ type: "card", uid: card.uid, label: card.name }));
  }
  return [
    ...(attackPermissionSpecsFor(attacker?.id).some((spec) => spec.type === "forbid_target"
      && spec.target === "enemy_user" && spec.condition === "source_registry_executed_this_turn")
      && attacker.std220RegistryExecutedTurn === state.turnNumber ? [] : [{ type: "fortress", uid: `${opponentId}-fortress`, label: opponent.user.name }]),
    ...sleeping.map((card) => ({ type: "card", uid: card.uid, label: card.name }))
  ];
}

export function canAttack(state, playerId, card) {
  if (state.active !== playerId) return false;
  if (!isObCard(card) || card.sleep) return false;
  if (attackPermissionSpecsFor(card.id).some((spec) => spec.type === "require_attack_condition"
    && spec.condition === "own_script_activated_this_turn") && state.players[playerId].scriptActivatedTurn !== state.turnNumber) return false;
  if (hasKeyword(card, "ACCESS_RESTRICTION")) return false;
  if (card.summoningSick && !cardHasRuntimeKeyword(state, playerId, card, "CONTACT") && !cardHasRuntimeKeyword(state, playerId, card, "QA")) return false;
  if (card.summoningSick && cardHasRuntimeKeyword(state, playerId, card, "CONTACT") && getAttackTargets(state, playerId, card).length === 0) return false;
  return true;
}

function queuePostAttackSelection(state, playerId, attacker, defenderUid = null) {
  const player = state.players[playerId];
  const customQueuePostAttackSelection = CUSTOM_QUEUE_POST_ATTACK_SELECTION[attacker.id];
  if (customQueuePostAttackSelection) customQueuePostAttackSelection({ player, attacker, playerId, defenderUid, state });
}

export function attack(state, playerId, attackerUid, targetUid) {
  normalizeBoardSlots(state);
  if (state.winner || state.pending || state.prompt) return false;
  const player = state.players[playerId];
  const attacker = player.front.find((card) => card.uid === attackerUid);
  if (!attacker || !canAttack(state, playerId, attacker)) return fail(state, "そのObは攻撃できない。", false);
  return runEffectEntry(state, "attack", playerId, () => attackCore(state, playerId, attackerUid, targetUid));
}

function attackCore(state, playerId, attackerUid, targetUid) {
  const player = state.players[playerId];
  const attacker = player.front.find((card) => card.uid === attackerUid);
  const customAttackCore3 = CUSTOM_ATTACK_CORE_3[attacker.id];
  if (customAttackCore3) {
    const customResult = customAttackCore3({ player, state, attacker, playerId, attackerUid, targetUid });
    if (customResult !== PASS) return customResult;
  }
  delete attacker.skipStd214AttackCost;
  if (!attacker.skipStd230Ambush && state.mode !== "lab") {
    const defenderId = otherPlayer(playerId); const defender = state.players[defenderId];
    const ambush = defender.registry.find((card) => card.id === "STD-230" && !card.faceDown
      && defender.memory >= 3 && defender.registry.length >= Number(card.cost ?? 0));
    if (ambush) {
      const request = createSelectionRequest({ mode: "scope", scopeField: "ambush", scopeOptions: ["起動しない", "[アンブッシュ:3]を起動"],
        label: `${ambush.name}: 攻撃宣言`, message: ambush.text,
        continuation: { type: "std230-ambush-choice", playerId: defenderId, sourceUid: ambush.uid, sourceName: ambush.name, attackerPlayerId: playerId, attackerUid, targetUid } });
      state.pending = { type: "selection", validTargets: [], request };
      return true;
    }
  }
  delete attacker.skipStd230Ambush;
  const customAttackCore5 = CUSTOM_ATTACK_CORE_5[attacker.id];
  if (customAttackCore5) {
    const customResult = customAttackCore5({ state, playerId, attacker, targetUid });
    if (customResult !== PASS) return customResult;
  }
  delete attacker.skipStd085LayerCost;
  for (const owner of Object.values(state.players)) {
    const trinity = owner.back.find((card) => card.id === "STD-121" && card.residentActive && !owner.scriptUsage[`${card.uid}:attack`]);
    if (trinity) {
      owner.scriptUsage[`${trinity.uid}:attack`] = true;
      resolveTrinityEffect(state, playerId, trinity.name);
    }
  }
  const customAttackCore2 = CUSTOM_ATTACK_CORE_2[attacker.id];
  if (customAttackCore2) {
    const customResult = customAttackCore2({ player, attacker, playerId, targetUid, state });
    if (customResult !== PASS) return customResult;
  }
  delete attacker.skipStd182AttackEffect;
  const resumeStage = state.attackResumeStage;
  const targets = getAttackTargets(state, playerId, attacker);
  let target = resumeStage && targetUid === `${otherPlayer(playerId)}-fortress`
    ? { type: "fortress", uid: targetUid, label: state.players[otherPlayer(playerId)].user.name }
    : targets.find((item) => item.uid === targetUid);
  if (!target) {
    target = targets[0];
    addLog(state, `セキュリティまたは攻撃制約により対象を「${target.label}」へ変更。`, "effect");
  }
  if (cardTraits(attacker).includes("インセクト") && !attacker.skipStd185AttackerSubstitution) {
    const general = player.front.find((card) => card.id === "STD-185" && !card.sleep && card.uid !== attacker.uid);
    if (general) {
      const request = createSelectionRequest({ mode: "scope", scopeField: "substitute", scopeOptions: ["交代しない", "クワガタ将軍と戦闘"],
        label: `${general.name}: 戦闘交代`, message: general.text,
        continuation: { type: "std185-attacker-substitute", playerId, attackerUid: attacker.uid, targetUid: target.uid, generalUid: general.uid } });
      state.pending = { type: "selection", validTargets: [], request };
      return true;
    }
  }
  delete attacker.skipStd185AttackerSubstitution;
  if (target?.type === "card" && !attacker.skipStd185Substitution) {
    const defenderId = otherPlayer(playerId);
    const defender = state.players[defenderId].front.find((card) => card.uid === target.uid);
    const general = state.players[defenderId].front.find((card) => card.id === "STD-185" && !card.sleep && card.uid !== defender?.uid);
    if (defender && cardTraits(defender).includes("インセクト") && general) {
      const request = createSelectionRequest({ mode: "scope", scopeField: "substitute", scopeOptions: ["交代しない", "クワガタ将軍と戦闘"],
        label: `${general.name}: 戦闘交代`, message: general.text,
        continuation: { type: "std185-defender-substitute", playerId: defenderId, attackerPlayerId: playerId, attackerUid, originalTargetUid: target.uid, generalUid: general.uid } });
      state.pending = { type: "selection", validTargets: [], request };
      return true;
    }
  }
  delete attacker.skipStd185Substitution;
  const customAttackCore4 = CUSTOM_ATTACK_CORE_4[attacker.id];
  if (customAttackCore4) customAttackCore4({ attacker, player, state, playerId });
  if (!attacker.skipStd223Ambush) {
    const defenderId = otherPlayer(playerId);
    const defender = state.players[defenderId];
    const ambush = defender.registry.find((card) => card.id === "STD-223" && !card.faceDown
      && defender.memory >= 2
      && defender.registry.some((other) => other.uid !== card.uid && Number(other.cost ?? 0) >= Number(card.cost ?? 0)));
    const obTargets = Object.values(state.players).flatMap((current) => [...current.front, ...current.back]).filter(isObCard);
    if (ambush && obTargets.length) {
      const request = createSelectionRequest({ mode: "scope", scopeField: "ambush", scopeOptions: ["起動しない", "[アンブッシュ:2]を起動"],
        label: `${ambush.name}: 相手Obの攻撃宣言`, message: ambush.text,
        continuation: { type: "std223-ambush-choice", playerId: defenderId, sourceUid: ambush.uid, sourceName: ambush.name,
          attackerPlayerId: playerId, attackerUid: attacker.uid, attackTargetUid: target.uid } });
      state.pending = { type: "selection", validTargets: [], request };
      return true;
    }
  }
  delete attacker.skipStd223Ambush;
  const customAttackCore = CUSTOM_ATTACK_CORE[attacker.id];
  if (customAttackCore) {
    const customResult = customAttackCore({ attacker, playerId, state, player, target });
    if (customResult !== PASS) return customResult;
  }
  delete attacker.skipQ3LayerAttackChoice;
  if (target.type !== "fortress") {
    const defender = state.players[otherPlayer(playerId)].front.find((card) => card.uid === target.uid);
    const source = [attacker, defender].find((card) => card?.id === "STD-097" && flattenedLayerCount(card) && !card.skipStd097BattleChoice);
    if (source) {
      const sourceOwnerId = findCard(state, source.uid)?.playerId ?? playerId;
      const request = createSelectionRequest({ mode: "scope", scopeField: "battleLayer", scopeOptions: ["起動しない", "レイヤー1枚を破棄して①を起動"],
        label: `${source.name}の戦闘時効果`, message: source.text,
        continuation: { type: "std097-battle-choice", playerId: sourceOwnerId, sourceUid: source.uid, attackerPlayerId: playerId, attackerUid: attacker.uid, targetUid: target.uid } });
      state.pending = { type: "selection", validTargets: [], request };
      return true;
    }
  }
  if (!attacker.skipDynamicSelectionAttackEffect && attacker.compiled?.selectionModules?.some((module) => module.module === "dynamic_threshold_selection")) {
    if (beginDynamicSelectionModule(state, playerId, attacker, { resumeAttack: true, targetUid: target.uid })) return true;
  }
  delete attacker.skipDynamicSelectionAttackEffect;
  const attackRuntime = cardRuntimeSpec(attacker.id, "attack_declared");
  if (attackRuntime && !attacker.skipRuntimeAttackEffect) {
    const opened = executeRuntimeActions(state, playerId, attacker, attackRuntime.actions, {
      targetUid: target.uid,
      continuationMeta: {
        resumeAttack: true, attackerUid: attacker.uid, targetUid: target.uid,
        settleMissingTargetAsCompleted: Boolean(attackRuntime.settleMissingTargetAsCompleted)
      }
    });
    if (opened && state.pending) return true;
  }
  delete attacker.skipRuntimeAttackEffect;
  if (!resumeStage) {
    emitGameEvent(state, { type: "attack_declared", playerId, ownerId: attacker.owner ?? playerId,
      cardUid: attacker.uid, cardId: attacker.id, cardName: attacker.name, category: attacker.category,
      attackerUid: attacker.uid, targetUid: target.uid,
      attackerKeywords: hasKeyword(attacker, "HACKING") ? ["HACKING"] : [] });
    if (state.prompt) {
      state.deferredAttack = { stage: "after-declare", playerId, attackerUid: attacker.uid, targetUid: target.uid };
      return true;
    }
  }
  setCardSleeping(state, playerId, attacker);
  attacker.attackedThisTurn = true;
  if (target.type !== "fortress") attacker.attackedObThisTurn = true;
  const opponentId = otherPlayer(playerId);
  if (target.type === "fortress") {
    const attackValue = cardAtk(state, playerId, attacker) + (attacker.id === "STD-095" ? flattenedLayerCount(attacker) : 0);
    dealFortressDamage(state, opponentId, attackValue, playerId, attacker.name, { kind: "attack" });
    if (attacker.assaultProgramTurn === state.turnNumber) {
      drawCards(state, playerId, 1);
      dealFortressDamage(state, opponentId, 1, playerId, "/アサルトプログラム/*");
    }
    queuePostAttackSelection(state, playerId, attacker);
    delete attacker.resolvingStd106Attack;
    delete attacker.resolvingStd227Attack;
    return true;
  }

  const defender = state.players[opponentId].front.find((card) => card.uid === target.uid);
  if (!defender) {
    delete attacker.resolvingStd106Attack;
    delete attacker.resolvingStd227Attack;
    addLog(state, `${attacker.name}が${target.label}を攻撃。攻撃時効果で対象が消えたため戦闘を行わない。`, "effect", { actor: playerId, cardId: attacker.id });
    return true;
  }
  if (resumeStage !== "after-battle") {
    const attackedRuntime = cardRuntimeSpec(defender.id, "attacked");
    if (attackedRuntime) executeRuntimeActions(state, opponentId, defender, attackedRuntime.actions, { targetUid: attacker.uid });
    if (!findCard(state, attacker.uid) || !findCard(state, defender.uid)) {
      delete attacker.resolvingStd106Attack;
      delete attacker.resolvingStd227Attack;
      addLog(state, `${attacker.name}が${defender.name}を攻撃。戦闘開始前効果で対象が消えたため戦闘を行わない。`, "effect", { actor: playerId, cardId: attacker.id });
      return true;
    }
    emitGameEvent(state, { type: "battle_started", playerId, ownerId: attacker.owner ?? playerId,
      cardUid: attacker.uid, cardId: attacker.id, cardName: attacker.name, category: attacker.category,
      attackerUid: attacker.uid, defenderUid: defender.uid, defenderOwnerId: opponentId });
    if (state.prompt) {
      attacker.sleep = false;
      attacker.attackedThisTurn = false;
      state.deferredAttack = { stage: "after-battle", playerId, attackerUid: attacker.uid, targetUid: target.uid };
      return true;
    }
  }
  for (const [ownerId, battler] of [[playerId, attacker], [opponentId, defender]]) {
    if (!battler || state.active === ownerId) continue;
    for (const source of state.players[ownerId].back.filter((card) => card.id === "STD-148" && card.residentActive && card.std148ArmedTurn === state.turnNumber)) {
      dealFortressDamage(state, otherPlayer(ownerId), 1, ownerId, source.name);
    }
  }
  const attackerDisconnect = hasKeyword(attacker, "DISCONNECT");
  const defenderDisconnect = hasKeyword(defender, "DISCONNECT");
  const std095AttackBonus = attacker.id === "STD-095" ? flattenedLayerCount(attacker) : 0;
  attacker.battleStrBonus = battleStatModifierValue(state, playerId, attacker, "str");
  defender.battleStrBonus = battleStatModifierValue(state, opponentId, defender, "str");
  const attackerStrBefore = cardCurrentStr(state, playerId, attacker);
  const defenderStrBefore = cardCurrentStr(state, opponentId, defender);
  let attackerDamage = applyDamageModifiers(state, playerId, attacker, opponentId, cardAtk(state, playerId, attacker) + std095AttackBonus, { kind: "battle", destination: "card", victimCard: defender });
  let defenderDamage = applyDamageModifiers(state, opponentId, defender, playerId, cardAtk(state, opponentId, defender), { kind: "battle", destination: "card", victimCard: attacker });
  const attackerProtected = defenderDamage > 0 && consumeProtect(state, attacker, "戦闘ダメージ");
  const defenderProtected = attackerDamage > 0 && consumeProtect(state, defender, "戦闘ダメージ");
  if (!attackerProtected) attacker.damage += defenderDamage;
  if (!defenderProtected) defender.damage += attackerDamage;
  const dealt = defenderProtected ? 0 : attackerDamage;
  const received = attackerProtected ? 0 : defenderDamage;
  const attackerStrAfter = cardCurrentStr(state, playerId, attacker);
  const defenderStrAfter = cardCurrentStr(state, opponentId, defender);
  emitGameEvent(state, { type: "combat_resolved", playerId,
    cardUid: attacker.uid, targetUid: defender.uid, damage: dealt, counterDamage: received,
    sourceStrBefore: attackerStrBefore, sourceStrAfter: attackerStrAfter,
    targetStrBefore: defenderStrBefore, targetStrAfter: defenderStrAfter });
  addLog(state, `${attacker.name}が${defender.name}を攻撃。${defender.name}へ${dealt}ダメージ、STR ${defenderStrBefore}→${defenderStrAfter}。${attacker.name}へ${received}ダメージ、STR ${attackerStrBefore}→${attackerStrAfter}。`, "damage", {
    actor: playerId, cardId: attacker.id,
    combat: { targetName: defender.name, damage: dealt, targetStrBefore: defenderStrBefore, targetStrAfter: defenderStrAfter,
      counterDamage: received, sourceStrBefore: attackerStrBefore, sourceStrAfter: attackerStrAfter }
  });
  clearDamageModifiers(attacker, "battle");
  clearDamageModifiers(defender, "battle");
  delete attacker.skipStd097BattleChoice;
  delete defender.skipStd097BattleChoice;

  const defenderDestroyedByBattle = cardCurrentStr(state, opponentId, defender) <= 0;
  const defenderOriginalStr = Number(defender.str ?? 0);
  if (defenderDestroyedByBattle) destroyCard(state, opponentId, defender.uid, { source: "戦闘" });
  if (cardCurrentStr(state, playerId, attacker) <= 0) destroyCard(state, playerId, attacker.uid, { source: "戦闘" });
  const customAttackCore6 = CUSTOM_ATTACK_CORE_6[attacker.id];
  if (customAttackCore6) customAttackCore6({ state, opponentId, defenderOriginalStr, playerId, attacker, defender, defenderDestroyedByBattle });
  if (attackerDisconnect) destroyCard(state, opponentId, defender.uid, { source: `${attacker.name}の[切断]` });
  if (defenderDisconnect) destroyCard(state, playerId, attacker.uid, { source: `${defender.name}の[切断]` });
  delete attacker.battleStrBonus;
  delete defender.battleStrBonus;
  if (findCard(state, attacker.uid) && findCard(state, attacker.uid).zoneName !== "trash") queuePostAttackSelection(state, playerId, attacker, defender.uid);
  delete attacker.resolvingStd106Attack;
  delete attacker.resolvingStd227Attack;
  return true;
}
