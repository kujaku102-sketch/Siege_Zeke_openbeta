import { battleStatModifierSpecsFor, cardRuntimeSpec } from "../card-runtime-specs.js";
import { attackPermissionSpecsFor, auraKeywordSpecsFor, conditionalKeywordSpecsFor, continuousStatModifierSpecsFor, mountedKeywordSpecsFor, mountedStatModifierSpecsFor } from "../continuous-effect-specs.js";
import { isObCard } from "../card-types.js";
import { hasKeyword, keywordValue } from "../effect-compiler.js";
import { createSelectionRequest, isSelectionRequestFeasible } from "../selection-model.js";
import { normalizeBoardSlots } from "../board-slots.js";
import { hasOptionalActivationSpec } from "../trigger-specs.js";
import { createRuntimeCard } from "../runtime/factory.js";
import { flattenedLayerCount, normalizeMountedStack } from "../layered-specs.js";
import { recordVictoryFact, runEffectEntry } from "./effects.js";
import { enabledSymbols } from "./play.js";
import { openResponseWindow, startNextQueuedResponse } from "./response.js";
import { hydrateCard } from "./setup.js";
import { activeCards, addLog, cardTraits, fail, findCard, hasClass, otherPlayer, sourceCardByName } from "./shared.js";
import { emitGameEvent, emitUserAbilityFeedback } from "./triggers.js";
import { drawCards } from "./turn.js";
import { executeRuntimeActions, runtimeSpecValue } from "../effects/generic/actions.js";
import { beginSourceLayerSelection } from "../effects/generic/cost.js";
import { applyDamageModifiers, clearDamageModifiers } from "../effects/generic/damage.js";
import { createVengeanceCard, destroyCard, emitEffectPlacement, moveCardToTrash, placeByMode, setCardSleeping } from "../effects/generic/placement.js";
import { beginDynamicSelectionModule } from "../effects/generic/selection.js";

function battleStatModifierValue(state, playerId, source, stat) {
  let value = 0;
  for (const spec of battleStatModifierSpecsFor(source.id).filter((item) => item.stat === stat)) {
    const amount = Number(runtimeSpecValue(state, playerId, source, spec.value));
    if (spec.operation === "add") value += amount;
    else if (spec.operation === "set") value = amount;
    else throw new Error(`Unsupported battle stat modifier operation: ${spec.operation ?? "(missing)"}`);
  }
  return value;
}

export function continuousEffectConditionMatches(state, playerId, source, condition) {
  if (!condition) return true;
  if (condition.expression === "source_has_any_keyword") {
    return condition.keywords.some((keyword) => cardHasRuntimeKeyword(state, playerId, source, keyword));
  }
  if (condition.expression === "source_atk_at_least") return cardAtk(state, playerId, source) >= Number(condition.amount ?? 0);
  if (condition.expression === "source_max_str_at_most") return cardMaxStr(state, playerId, source) <= Number(condition.amount ?? 0);
  if (condition.expression === "source_is_not_mounted") return (source.mounted?.length ?? 0) === 0;
  throw new Error(`Unsupported continuous effect condition: ${condition.expression ?? "(missing)"}`);
}

function continuousStatModifierValue(state, playerId, source, stat) {
  return continuousStatModifierSpecsFor(source.id)
    .filter((item) => continuousEffectConditionMatches(state, playerId, source, item.condition))
    .reduce((sum, item) => sum + Number(item[stat] ?? 0), 0);
}

function mountedStatModifierValue(source, stat) {
  return (source.mounted ?? []).reduce((sum, provider) => sum
    + mountedStatModifierSpecsFor(provider.id).reduce((providerSum, spec) => providerSum + Number(spec[stat] ?? 0), 0), 0);
}

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

export function cardAtk(state, playerId, card) {
  let value = Number(card.atk ?? 0) + Number(card.tempAtk ?? 0) + Number(card.permanentAtk ?? 0) - Number(card.load ?? 0);
  value += (card.timedModifiers ?? []).filter((item) => state.turnNumber <= item.expiresAfterTurn).reduce((sum, item) => sum + Number(item.atk ?? 0), 0);
  value += mountedStatModifierValue(card, "atk");
  if (card.id === "STD-227") {
    const colors = new Set(Object.values(state.players).flatMap((player) => player.registry.map((item) => item.color).filter(Boolean)));
    value += colors.size;
  }
  value += continuousStatModifierValue(state, playerId, card, "atk");
  const player = state.players[playerId];
  if (player.user.abilityKey === "mono_color" && isObCard(card) && enabledSymbols(player).length === 1) value += 1;
  // スタッツに0未満は存在しない
  return Math.max(0, value);
}

export function cardMaxStr(_state, _playerId, card) {
  let value = Number(card.str ?? 0) + Number(card.tempStr ?? 0) + Number(card.permanentStr ?? 0) + Number(card.battleStrBonus ?? 0) - Number(card.load ?? 0);
  value += (card.timedModifiers ?? []).filter((item) => _state.turnNumber <= item.expiresAfterTurn).reduce((sum, item) => sum + Number(item.str ?? 0), 0);
  value += mountedStatModifierValue(card, "str");
  value += continuousStatModifierValue(_state, _playerId, card, "str");
  return value;
}

export function cardCurrentStr(state, playerId, card) {
  return Math.max(0, cardMaxStr(state, playerId, card) - card.damage);
}

function cardHasPrintedOrGrantedKeyword(card, name) {
  if (hasKeyword(card, name)) return true;
  if ((card.timedModifiers ?? []).some((item) => item.keyword === name)) return true;
  return card.mounted?.some((provider) => mountedKeywordSpecsFor(provider.id).some((spec) =>
    spec.keyword === name && (!spec.consumedFlag || !provider[spec.consumedFlag])
  )) ?? false;
}

export function cardHasKeyword(cardOrState, nameOrPlayerId, maybeCard = null, maybeName = null) {
  if (maybeCard && maybeName) return cardHasRuntimeKeyword(cardOrState, nameOrPlayerId, maybeCard, maybeName);
  return cardHasPrintedOrGrantedKeyword(cardOrState, nameOrPlayerId);
}

function cardHasRuntimeKeyword(state, playerId, card, name) {
  if (cardHasPrintedOrGrantedKeyword(card, name)) return true;
  if ((card.timedModifiers ?? []).some((item) => item.keyword === name && state.turnNumber <= item.expiresAfterTurn)) return true;
  if (conditionalKeywordSpecsFor(card.id).some((spec) =>
    spec.keywords.includes(name) && continuousEffectConditionMatches(state, playerId, card, spec.condition)
  )) return true;
  const player = state.players[playerId];
  for (const [zone, providers] of Object.entries({ front: player.front, back: player.back })) {
    for (const provider of providers.filter((item) => !item.faceDown)) {
      for (const spec of auraKeywordSpecsFor(provider.id)) {
        if (spec.keyword !== name || (spec.providerZone !== "area" && spec.providerZone !== zone)) continue;
        if (spec.target === "source" && provider.uid === card.uid) return true;
        if (spec.target === "own_class_ob_all" && isObCard(card) && hasClass(card, spec.className)) return true;
        if (spec.target === "own_color_ob_all" && isObCard(card) && card.color === spec.color) return true;
      }
    }
  }
  return name === "CONTACT" && card.name === "ドールズ" && activeCards(state, playerId, "STD-198").length > 0;
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
  if (attacker.id === "STD-136") {
    const candidates = [...player.front, ...player.back].filter((card) => isObCard(card) && card.uid !== attacker.uid);
    if (candidates.length) {
      const request = createSelectionRequest({
        mode: "up_to", candidates: candidates.map((card) => card.uid), count: 1, maximum: 1,
        label: "破壊する他の自分Obを0～1体選択", message: "選んだ場合、このカードをスタンバイする。",
        continuation: { type: "hahanamori-standby", playerId, sourceUid: attacker.uid, defenderUid }
      });
      state.pending = { type: "selection", validTargets: request.candidates, request };
    }
  }
}

export function resolveTrinityEffect(state, activePlayerId, sourceName) {
  const active = state.players[activePlayerId];
  if (active.hand.length >= 3) for (const card of active.hand.splice(0, 3)) moveCardToTrash(state, activePlayerId, card, sourceName);
  else dealFortressDamage(state, activePlayerId, 3, otherPlayer(activePlayerId), sourceName);
  drawCards(state, activePlayerId, 2);
  addLog(state, `${sourceName}: アクティブユーザーが手札3枚を捨てるか3ダメージ、その後2枚ドロー。`, "effect");
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
  if (attacker.id === "STD-214" && !attacker.skipStd214AttackCost) {
    const candidates = player.registry.filter((card) => !card.faceDown);
    if (!candidates.length) { addLog(state, `${attacker.name}: レジストリから回収できず攻撃失敗。`, "effect"); return true; }
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])), label: `${attacker.name}: 攻撃宣言時の回収`, message: attacker.text,
      continuation: { type: "std214-attack-cost", playerId, attackerUid, targetUid } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
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
  if (attacker.id === "STD-085" && attacker.mounted.length && !attacker.skipStd085LayerCost) {
    return beginSourceLayerSelection(state, playerId, attacker, 1, {
      type: "std085-layer-pay", playerId, sourceUid: attacker.uid,
      attackerPlayerId: playerId, attackerUid: attacker.uid, targetUid
    });
  }
  delete attacker.skipStd085LayerCost;
  for (const owner of Object.values(state.players)) {
    const trinity = owner.back.find((card) => card.id === "STD-121" && card.residentActive && !owner.scriptUsage[`${card.uid}:attack`]);
    if (trinity) {
      owner.scriptUsage[`${trinity.uid}:attack`] = true;
      resolveTrinityEffect(state, playerId, trinity.name);
    }
  }
  if (attacker.id === "STD-182" && !attacker.skipStd182AttackEffect) {
    const candidates = player.back.filter((script) => script.category === "Script" && script.faceDown
      && !keywordValue(script, "IF") && !hasOptionalActivationSpec(script.id)
      && Number(script.activationCost ?? script.cost ?? Infinity) <= 2
      && player.memory >= Number(script.activationCost ?? script.cost ?? 0));
    if (candidates.length) {
      const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((script) => script.uid), minimum: 0, maximum: 1,
        candidateLabels: Object.fromEntries(candidates.map((script) => [script.uid, `${script.name} / 起動${script.activationCost ?? script.cost}`])),
        label: `${attacker.name}: 攻撃時にScriptを起動`, message: attacker.text,
        continuation: { type: "std182-attack-script", playerId, attackerUid: attacker.uid, targetUid } });
      state.pending = { type: "selection", validTargets: request.candidates, request };
      return true;
    }
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
  if (attacker.id === "STD-106" && !attacker.resolvingStd106Attack) {
    attacker.resolvingStd106Attack = true;
    for (let index = 0; index < 2; index += 1) {
      const zoneName = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
      const junk = hydrateCard(createRuntimeCard(state.runtimeContext ?? null, "STD-078", playerId, ++state.tokenSerial + 1600));
      if (placeByMode(state, playerId, junk, { zone: zoneName, from: "generated", source: attacker.name }) === "placed") emitEffectPlacement(state, playerId, junk, zoneName, attacker.name);
    }
  }
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
  if (attacker.id === "STD-227" && !attacker.resolvingStd227Attack && cardAtk(state, playerId, attacker) >= 7) {
    attacker.resolvingStd227Attack = true;
    const opponentId = otherPlayer(playerId);
    const victims = [...state.players[opponentId].front];
    let generated = 0;
    for (const victim of victims) {
      if (!destroyCard(state, opponentId, victim.uid, { source: attacker.name })) continue;
      const proof = createVengeanceCard(state, "STD-228", opponentId);
      proof.summoningSick = true;
      if (placeByMode(state, opponentId, proof, { zone: "front", from: "generated", source: attacker.name }) === "placed") { emitEffectPlacement(state, playerId, proof, "front", attacker.name); generated += 1; }
    }
    addLog(state, `${attacker.name}: 相手フロント${victims.length}枚を破壊し、「征服の証」を${generated}枚配置。`, "effect");
  }
  if (["STD-096", "STD-102", "STD-238"].includes(attacker.id) && flattenedLayerCount(attacker) >= (attacker.id === "STD-238" ? 2 : 1) && !attacker.skipQ3LayerAttackChoice) {
    normalizeMountedStack(attacker);
    if (attacker.id === "STD-102") {
      normalizeMountedStack(attacker);
      const hasFeasibleLayer = attacker.mounted.some((layer) => {
        const candidates = [...player.trash, ...(isObCard(layer) || layer.category === "Code" ? [layer] : [])]
          .filter((card, index, cards) => (isObCard(card) || card.category === "Code") && cards.findIndex((item) => item.uid === card.uid) === index);
        const feasibility = createSelectionRequest({ mode: "up_to", candidates: candidates.map((card) => card.uid), minimum: 1, maximum: candidates.length,
          exactBudget: 2, candidateValues: Object.fromEntries(candidates.map((card) => [card.uid, Number(card.cost ?? 0)])) });
        return isSelectionRequestFeasible(feasibility);
      });
      if (!hasFeasibleLayer) attacker.skipQ3LayerAttackChoice = true;
    }
    if (!attacker.skipQ3LayerAttackChoice) {
      const layerCost = attacker.id === "STD-238" ? 2 : 1;
      const request = createSelectionRequest({ mode: "scope", scopeField: "layerAttack", scopeOptions: ["起動しない", `レイヤー${layerCost}枚を破棄して起動`],
        label: `${attacker.name}の攻撃時効果`, message: attacker.text,
        continuation: { type: "q3-layer-attack-choice", playerId, sourceUid: attacker.uid, targetUid: target.uid } });
      state.pending = { type: "selection", validTargets: [], request };
      return true;
    }
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
  if (attacker.id === "STD-095" && defenderDestroyedByBattle) {
    dealFortressDamage(state, opponentId, defenderOriginalStr, playerId, attacker.name);
    addLog(state, `${attacker.name}: 戦闘で破壊した${defender.name}の元のSTR${defenderOriginalStr}ダメージ。`, "effect");
  }
  if (attackerDisconnect) destroyCard(state, opponentId, defender.uid, { source: `${attacker.name}の[切断]` });
  if (defenderDisconnect) destroyCard(state, playerId, attacker.uid, { source: `${defender.name}の[切断]` });
  delete attacker.battleStrBonus;
  delete defender.battleStrBonus;
  if (findCard(state, attacker.uid) && findCard(state, attacker.uid).zoneName !== "trash") queuePostAttackSelection(state, playerId, attacker, defender.uid);
  delete attacker.resolvingStd106Attack;
  delete attacker.resolvingStd227Attack;
  return true;
}

export function consumeProtect(state, card, source) {
  if (card.protect === undefined) card.protect = Number(keywordValue(card, "PROTECT") ?? 0);
  if (Number(card.protect ?? 0) > 0) {
    card.protect -= 1;
    addLog(state, `${card.name}の[プロテクト]が${source}を無効。残り${card.protect}。`, "effect");
    return true;
  }
  const mountedProtection = card.mounted?.map((provider) => ({
    provider,
    spec: mountedKeywordSpecsFor(provider.id).find((spec) => spec.keyword === "PROTECT" && (!spec.consumedFlag || !provider[spec.consumedFlag]))
  })).find((entry) => entry.spec);
  if (!mountedProtection) return false;
  if (mountedProtection.spec.consumedFlag) mountedProtection.provider[mountedProtection.spec.consumedFlag] = true;
  addLog(state, `${mountedProtection.provider.name}が与えた[プロテクト]が${source}を無効。`, "effect");
  return true;
}

export function dealCardDamage(state, ownerId, uid, amount, source = "効果", { sourcePlayerId = otherPlayer(ownerId), kind = "effect" } = {}) {
  const player = state.players[ownerId];
  const card = [...player.front, ...player.back].find((item) => item.uid === uid);
  if (!card) return false;
  const sourceCard = sourceCardByName(state, sourcePlayerId, source);
  amount = applyDamageModifiers(state, sourcePlayerId, sourceCard, ownerId, amount, { kind, destination: "card", victimCard: card });
  if (amount > 0 && consumeProtect(state, card, `${source}によるダメージ`)) {
    state.lastDamageOutcome = { targetUid: uid, amount: 0, destructionDetermined: false, prevented: true };
    return true;
  }
  const strBefore = cardCurrentStr(state, ownerId, card);
  card.damage += amount;
  addLog(state, `${source}: ${card.name}に${amount}ダメージ。残りSTR ${cardCurrentStr(state, ownerId, card)}。`, "effect");
  emitGameEvent(state, {
    type: "card_damaged",
    playerId: ownerId,
    ownerId,
    cardUid: card.uid,
    cardId: card.id,
    cardName: card.name,
    category: card.category,
    amount,
    sourcePlayerId, sourceUid: sourceCard?.uid ?? null,
    strBefore, strAfter: cardCurrentStr(state, ownerId, card),
    source
  });
  const destructionDetermined = cardCurrentStr(state, ownerId, card) <= 0;
  state.lastDamageOutcome = { targetUid: uid, amount, destructionDetermined, prevented: false };
  if (destructionDetermined) destroyCard(state, ownerId, uid, { source });
  return true;
}

export function dealFortressDamage(state, victimId, amount, sourcePlayerId, source = "攻撃", { kind = "effect" } = {}) {
  const victim = state.players[victimId];
  const sourcePlayer = state.players[sourcePlayerId];
  amount = applyDamageModifiers(state, sourcePlayerId, sourceCardByName(state, sourcePlayerId, source), victimId, amount, { kind, destination: "user" });
  if (state.damagePenaltyPlayerId === sourcePlayerId && state.damagePenaltyTurn === state.turnNumber && victimId !== sourcePlayerId) {
    amount = Math.max(0, amount - Number(state.extraTurnDamagePenalty ?? 2));
  }
  if (victim.user.abilityKey === "kickass") amount *= 2;
  if (victim.user.abilityKey === "kickass" && amount > 0) emitUserAbilityFeedback(state, "kickass", victimId, victimId, {
    branch: "damage-doubled", before: amount / 2, after: amount, steps: [{ kind: "multiply", target: { kind: "player_stat", playerId: victimId, metric: "damage" }, before: amount / 2, factor: 2, after: amount }]
  });
  if (victim.user.abilityKey === "dimension_innovation") {
    const banCount = Math.min(amount, victim.deck.length);
    for (let index = 0; index < banCount; index += 1) victim.ban.push(victim.deck.pop());
    addLog(state, `${victim.user.abilityName}: ${amount}ダメージを置換し、山札${banCount}枚をBAN。`, "effect");
    if (amount > 0 && banCount > 0) emitUserAbilityFeedback(state, "dimension_innovation", victimId, victimId, {
      branch: "damage-replaced", before: amount, after: banCount, strBefore: victim.fortressStr, strAfter: victim.fortressStr, outcome: "ban", steps: [{ kind: "transfer", from: { kind: "zone_count", playerId: victimId, zone: "deck" }, to: { kind: "zone_count", playerId: victimId, zone: "ban" }, count: banCount }]
    });
    if (kind === "attack") addLog(state, `${source}が${victim.user.name}を攻撃。ダメージは置換され、STRは変動なし。`, "damage", {
      actor: sourcePlayerId, cardId: sourceCardByName(state, sourcePlayerId, source)?.id ?? null,
      combat: { targetName: victim.user.name, damage: 0, targetStrBefore: victim.fortressStr, targetStrAfter: victim.fortressStr }
    });
    return banCount;
  }
  const before = victim.fortressStr;
  victim.fortressStr = Math.max(0, victim.fortressStr - amount);
  if (victim.user.abilityKey === "recovery_boot" && victim.fortressStr <= 0) {
    victim.fortressStr = 1;
    addLog(state, `${victim.user.abilityName}: STRを1へ回復。`, "effect");
    emitUserAbilityFeedback(state, "recovery_boot", victimId, victimId, { branch: "recovered", before: 0, after: 1, steps: [{ kind: "value_change", target: { kind: "player_stat", playerId: victimId, metric: "str" }, before: 0, after: 1 }] });
  }
  victim.damageReceivedThisTurn = Number(victim.damageReceivedThisTurn ?? 0) + amount;
  const sourceCard = kind === "attack" ? sourceCardByName(state, sourcePlayerId, source) : null;
  if (kind === "attack") addLog(state, `${source}が${victim.user.name}を攻撃。${amount}ダメージ、STR ${before}→${victim.fortressStr}。`, "damage", {
    actor: sourcePlayerId, cardId: sourceCard?.id ?? null,
    combat: { targetName: victim.user.name, damage: amount, targetStrBefore: before, targetStrAfter: victim.fortressStr }
  });
  else addLog(state, `${source}: ${victim.user.name}へ${amount}ダメージ。STR ${before}→${victim.fortressStr}。`, "damage");
  if (amount > 0) emitGameEvent(state, { type: "user_damaged", playerId: victimId, ownerId: victimId,
    amount, kind, sourcePlayerId, source,
    sourceUid: sourceCardByName(state, sourcePlayerId, source)?.uid ?? null,
    strBefore: before, strAfter: victim.fortressStr });
  const triggered = victim.user.incidents.filter((threshold) =>
    before > threshold && victim.fortressStr <= threshold && !victim.incidentsTriggered.includes(threshold)
  );
  for (const threshold of triggered) {
    victim.incidentsTriggered.push(threshold);
    victim.permanentMemory += 1;
    victim.memory += 1;
    drawCards(state, sourcePlayerId, 1);
    addLog(state, `INCIDENT ${threshold}: ${victim.user.name}のメモリ上限+1・アクティブメモリ1回復、${sourcePlayer.user.name}が1ドロー。`, "incident");
  }
  if (victim.fortressStr <= 0) recordVictoryFact(state, { type: "str-zero", playerId: victimId, sourcePlayerId });
  if ((state.interactive || state.runtimeContext) && amount > 0 && sourcePlayerId !== victimId) {
    const queued = { playerId: victimId, event: { sourcePlayerId, source, amount, kind } };
    if (state.resolvingResponse) (state.responseEventQueue ??= []).push(queued);
    else openResponseWindow(state, queued.playerId, queued.event) || startNextQueuedResponse(state);
  }
}
