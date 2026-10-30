import { resultCountGate } from "./effect-operation-library.js";
import { createChoiceSpec, createSelectionRequest, selectionRequestFromSpec } from "./selection-model.js";
import { isObCard } from "./card-types.js";
import { CARD_LIBRARY } from "../data/cards.js";
import { cardRuntimeSpec } from "./card-runtime-specs.js";
import { attack, dealFortressDamage } from "./core/battle.js";
import { drainIndependentEffects, runEffectEntry } from "./core/effects.js";
import { continueDeferredSpellCleanup } from "./core/play.js";
import { openNextQueuedSelection } from "./core/projection.js";
import { declareResponse } from "./core/response.js";
import { addLog, classKey, fail, findCard, hasClass, isArmsBandCard, otherPlayer, provisional, shuffle } from "./core/shared.js";
import { emitGameEvent } from "./core/triggers.js";
import { drawCards, resumeMandatoryDrawContinuation } from "./core/turn.js";
import { executeRuntimeActions } from "./effects/generic/actions.js";
import { executionCost, magazineExecutionCandidates } from "./effects/generic/cost.js";
import { destroyCard, moveCardToTrash, placeByMode } from "./effects/generic/placement.js";
import { resolveCardSelection } from "./effects/generic/selection.js";

export { supportsNormalScriptActivation, supportsDirectHandObExecution, relogPreparationKind, canDirectRelogAtSlot, installCheck, installCard, configurePlugin, recoverRegistryCard, canExecuteRegistryCard, executeRegistryCard, enabledSymbols, supportsAlternateScriptSetup, canExecuteAtSlot, canPlayCard, spellNeedsTarget, normalSpellSelection, normalExecutionCheck, normalCardEffectSelection, playCard, getEffectTargets, getActivatableEffects, activateCardEffect, getLayeredCandidates, getLayeredRequirement, getLayeredSelectionPlan, canPlayLayeredCard, playLayeredCard, relogCard } from "./core/play.js";
export { coordinatorProjectionBlocked, buildProjectionSpec, commitProjection, clearProjection, replaceProjection, restoreProjection, cloneForHistory, remember, undo, enqueueLegacyProjection, promoteLegacyQueueHead } from "./core/projection.js";
export { canAddSandboxCardToHand, addSandboxCardToHand, canOpeningMulligan, canKeepOpeningHand, openingMulligan, keepOpeningHand, DECK_OPTIONS, createGame } from "./core/setup.js";
export { resolveVariableExpression } from "./effects/generic/actions.js";
export { resolveTriggerChoice, emitGameEvent } from "./core/triggers.js";
export { finishGameIfSettled } from "./core/effects.js";
export { getMaxMemory, executionCost, visibleHandExecutionPayment } from "./effects/generic/cost.js";
export { drawCards, startTurn, restSecurity, canActivateTurbo, activateTurbo, endTurn } from "./core/turn.js";
export { activateScript, declinePrompt } from "./core/scripts.js";
export { resolveCardSelection } from "./effects/generic/selection.js";
export { cardAtk, cardMaxStr, cardCurrentStr, cardHasKeyword, getAttackTargets, canAttack, attack, dealCardDamage, dealFortressDamage } from "./core/battle.js";
export { declineResponse, activateResponse } from "./core/response.js";
export { destroyCard, discardMountedCard, resolveAccessDragPlacement } from "./effects/generic/placement.js";
export { findCard } from "./core/shared.js";

export function continueStd211DestructionBatch(state) {
  const batch = state.std211DestructionBatch;
  if (!batch || state.pending || state.prompt || state.deferredDestruction) return false;
  const player = state.players[batch.playerId];
  while (batch.queue.length) {
    const targetUid = batch.queue.shift();
    const target = findCard(state, targetUid);
    if (!target || target.playerId !== batch.playerId || !["front", "back"].includes(target.zoneName)
      || !(target.card.classes ?? []).some((value) => classKey(value) === classKey(batch.className))) continue;
    (state.std211DestructionContinuations ??= {})[targetUid] = true;
    destroyCard(state, batch.playerId, targetUid, { source: batch.sourceName, suppressReplacement: true });
    return true;
  }
  const resultGate = resultCountGate(batch.destroyedCount);
  if (resultGate.shouldResolveDependentBlock) {
    drawCards(state, batch.playerId, resultGate.count);
    addLog(state, `${batch.sourceName}: クラス「${batch.className}」を${resultGate.count}枚破壊し、${resultGate.count}枚ドロー。`, "effect");
  } else {
    addLog(state, `${batch.sourceName}: 破壊実績が0枚のため、後続のドロー処理を行わず終了。`, "effect");
  }
  delete state.std211DestructionBatch;
  return continueDeferredSpellCleanup(state);
}

export function settleStd211DestructionContinuation(state, targetUid, destroyed) {
  if (!state.std211DestructionContinuations?.[targetUid]) return false;
  delete state.std211DestructionContinuations[targetUid];
  if (!Object.keys(state.std211DestructionContinuations).length) delete state.std211DestructionContinuations;
  if (destroyed) state.std211DestructionBatch.destroyedCount += 1;
  return continueStd211DestructionBatch(state);
}

export function resumeStd230AmbushCleanup(state) {
  const cleanup = state.std230AmbushCleanup;
  if (!cleanup || state.pending || state.prompt || state.deferredTrashMoves?.length) return false;
  const player = state.players[cleanup.playerId];
  if (!cleanup.sourceRemovalStarted) {
    cleanup.sourceRemovalStarted = true;
    const sourceIndex = player.registry.findIndex((card) => card.uid === cleanup.sourceUid && card.id === "STD-230");
    if (sourceIndex >= 0) {
      const [source] = player.registry.splice(sourceIndex, 1);
      emitGameEvent(state, { type: "registry_left", playerId: cleanup.playerId, ownerId: source.owner ?? cleanup.playerId,
        cardUid: source.uid, cardId: source.id, cardName: source.name, category: source.category, reason: "ambush" });
      const destination = moveCardToTrash(state, cleanup.playerId, source, "アンブッシュ");
      if (destination === "deferred") return true;
    }
    cleanup.sourceRemovalDone = true;
  }
  if (!cleanup.sourceRemovalDone) {
    const removed = [...player.trash, ...player.ban].some((card) => card.uid === cleanup.sourceUid);
    if (!removed) return false;
    cleanup.sourceRemovalDone = true;
  }
  if (state.selectionQueue?.length) {
    openNextQueuedSelection(state);
    return true;
  }
  state.std230AmbushCleanup = null;
  const attacker = state.players[cleanup.attackerPlayerId].front.find((card) => card.uid === cleanup.attackerUid);
  if (!attacker) return true;
  attacker.skipStd230Ambush = true;
  return attack(state, cleanup.attackerPlayerId, attacker.uid, cleanup.targetUid);
}

export function settleStd048MandatoryPlacement(state, pending, placed) {
  const continuation = state.mandatoryDrawContinuation;
  if (pending?.type !== "std048-draw-place" || !continuation
    || continuation.type !== "std048-mandatory-draw"
    || continuation.sourceUid !== pending.sourceUid
    || continuation.placementOutcome !== "pending") return false;
  continuation.placementOutcome = placed ? "placed" : "failed";
  return resumeMandatoryDrawContinuation(state);
}

export function beginStd048MandatoryDraw(state, playerId, card, remainingRuleDraws) {
  card.dragFree = true;
  state.effectResolution = {
    id: `EFFECT-${++state.effectSerial}`, kind: "STD-048-mandatory-draw", source: card.uid,
    playerId, status: "awaiting-choice"
  };
  state.mandatoryDrawContinuation = {
    type: "std048-mandatory-draw", playerId, sourceUid: card.uid, sourceName: card.name,
    remainingRuleDraws, placementOutcome: "pending", ruleDrawDone: remainingRuleDraws === 0, successEffectDone: false
  };
  state.pending = {
    type: "std048-draw-place", playerId, sourceName: card.name,
    queue: [card.uid], sourceUid: card.uid
  };
  addLog(state, `${card.name}: ルールによる最初のドローで引いた。配置先を選択。`, "effect");
  return true;
}

export function beginSztb094Counter(state, playerId, sourceUid) {
  const source = findCard(state, sourceUid)?.card;
  if (!source || source.id !== "SZTB-094" || source.sleep) return false;
  const candidates = magazineExecutionCandidates(state, playerId);
  if (!candidates.length) return false;
  const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((item) => item.uid), count: 1, minimum: 0, maximum: 1,
    candidateLabels: Object.fromEntries(candidates.map((item) => [item.uid, `${item.name} / メモリ${executionCost(item, state, playerId)}`])),
    label: `${source.name}: [弾倉]Spを実行`, message: "選んだ場合、これをスリープして選択したSpを実行する。選ばず確定も可能。",
    continuation: { type: "sztb094-counter-select", playerId, sourceUid } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function resolveImperialRandomInstall(state, playerId, sourceName) {
  const opponentId = otherPlayer(playerId);
  const opponent = state.players[opponentId];
  const sources = [
    { name: "hand", cards: opponent.hand },
    { name: "area", cards: [...opponent.front, ...opponent.back] },
    { name: "trash", cards: opponent.trash },
    { name: "deck", cards: opponent.deck }
  ];
  let moved = 0;
  for (const source of sources) {
    if (!source.cards.length) continue;
    const chosen = source.cards[Math.floor(state.rng() * source.cards.length)];
    let zone = source.name;
    if (zone === "area") zone = opponent.front.some((card) => card.uid === chosen.uid) ? "front" : "back";
    const index = opponent[zone].findIndex((card) => card.uid === chosen.uid);
    if (index < 0) continue;
    const [card] = opponent[zone].splice(index, 1);
    opponent.registry.push(card);
    moved += 1;
    emitGameEvent(state, { type: "card_moved", playerId: opponentId, ownerId: card.owner ?? opponentId,
      cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category, from: zone, to: "registry", source: sourceName });
  }
  opponent.deck = shuffle(opponent.deck, state.rng);
  addLog(state, `${sourceName}: 相手の手札・エリア・ゴミ箱・山札から各1枚までをレジストリへインストール（${moved}枚）。`, "effect");
  return moved;
}

export function beginSztb094Access(state, playerId, sourceName, { resumeTurnEndActiveId = null } = {}) {
  const player = state.players[playerId];
  const candidates = player.deck.filter((candidate) => isArmsBandCard(candidate) && !isObCard(candidate));
  if (!candidates.length) return false;
  const request = createSelectionRequest({ mode: "single", candidates: candidates.map((candidate) => candidate.uid), count: 1,
    candidateLabels: Object.fromEntries(candidates.map((candidate) => [candidate.uid, candidate.name])),
    label: `${sourceName}: Ob以外のアームズバンド・カードへアクセス`, message: "選んだカードを手札へ加え、山札をシャッフルする。",
    continuation: { type: "access-to-hand", playerId, sourceName, ...(resumeTurnEndActiveId ? { resumeTurnEndActiveId } : {}) } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function continueStd163Choices(state, continuation, remaining) {
  if (remaining <= 0) return true;
  const request = selectionRequestFromSpec(createChoiceSpec({ options: ["①カードを2枚引く", "②相手Obに3ダメージ"] }), {
    label: `残り${remaining}回：①または②`, message: continuation.sourceName,
    continuation: { type: "std163-choice", playerId: continuation.playerId, sourceName: continuation.sourceName, remaining }
  });
  state.pending = { type: "selection", validTargets: [], request };
  return true;
}

export function scheduleStd142TurnEndResume(state, activeId) {
  state.resumeTurnEndAfterSelection = activeId;
  return true;
}

export function scheduleStd141TurnEndResume(state, activeId) {
  state.resumeTurnEndAfterSelection = activeId;
  return true;
}

function isStd141TurnEndSource(state, ownerId, uid) {
  const source = findCard(state, uid);
  return Boolean(source && source.playerId === ownerId && source.zoneName === "back"
    && source.card.id === "STD-141" && source.card.residentActive);
}

export function takeStd141TurnEndSource(state, ownerId, uid) {
  const queue = state.std141TurnEndQueue;
  if (!queue) return false;
  queue.entries[ownerId] = (queue.entries[ownerId] ?? []).filter((entryUid) => entryUid !== uid);
  queue.nextOwnerId = otherPlayer(ownerId);
  return isStd141TurnEndSource(state, ownerId, uid);
}

export function openStd141EffectChoice(state, ownerId, activeId, sourceUid) {
  const source = findCard(state, sourceUid);
  if (!source || source.playerId !== ownerId || source.card.id !== "STD-141" || !source.card.residentActive) {
    return scheduleStd141TurnEndResume(state, activeId);
  }
  const count = Number(state.turnStats.destroyedSacredTreeScripts ?? 0);
  if (count < 2) return scheduleStd141TurnEndResume(state, activeId);
  const options = count === 2 ? ["①2枚"] : ["②3枚以上"];
  if (count >= 5) options.push("③5枚以上");
  const request = createSelectionRequest({ mode: "scope", scopeField: "effect", scopeOptions: options,
    label: `${source.card.name}: 適用する効果`, message: `${count}枚の「聖樹」Scriptが破壊された。`,
    continuation: { type: "std141-choice", playerId: ownerId, sourceUid, sourceName: source.card.name, activeId } });
  state.pending = { type: "selection", validTargets: [], request };
  return true;
}

export function continueStd141TurnEndQueue(state, activeId) {
  const queue = state.std141TurnEndQueue;
  if (!queue || queue.activeId !== activeId) return false;
  for (let attempts = 0; attempts < 2; attempts += 1) {
    const ownerId = queue.nextOwnerId;
    const candidates = (queue.entries[ownerId] ?? []).filter((uid) => isStd141TurnEndSource(state, ownerId, uid));
    queue.entries[ownerId] = candidates;
    if (!candidates.length) {
      queue.nextOwnerId = otherPlayer(ownerId);
      continue;
    }
    if (candidates.length === 1) {
      const sourceUid = candidates[0];
      takeStd141TurnEndSource(state, ownerId, sourceUid);
      return openStd141EffectChoice(state, ownerId, activeId, sourceUid);
    }
    const request = createSelectionRequest({ mode: "single", candidates, count: 1,
      candidateLabels: Object.fromEntries(candidates.map((uid) => [uid, findCard(state, uid)?.card.name ?? "聖樹枝束"])),
      label: "ターン終了時に処理する聖樹枝束を選択", message: "未処理の自分の効果から1つを選択。",
      continuation: { type: "std141-turn-end-source", playerId: ownerId, activeId } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  return false;
}

function std142PublicSacredTreeTargets(state) {
  return Object.entries(state.players).flatMap(([ownerId, owner]) =>
    ["front", "back"].flatMap((zoneName) => owner[zoneName]
      .filter((card) => card.faceDown !== true && card.name.includes("聖樹"))
      .map((card) => ({ ownerId, zoneName, card })))
  );
}

function openStd142DestroySelection(state, continuation) {
  const candidates = std142PublicSacredTreeTargets(state);
  const request = createSelectionRequest({
    mode: "up_to",
    candidates: candidates.map(({ card }) => card.uid),
    count: candidates.length,
    minimum: 0,
    maximum: candidates.length,
    candidateLabels: Object.fromEntries(candidates.map(({ ownerId, card }) => [card.uid, `${state.players[ownerId].name ?? ownerId}: ${card.name}`])),
    label: "破壊処理を行う表向きの「聖樹」カードを任意選択",
    message: continuation.sourceName,
    continuation: {
      type: "std142-destroy",
      playerId: continuation.playerId,
      activeId: continuation.activeId,
      sourceName: continuation.sourceName
    }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function continueStd142DestroyResolution(state) {
  const batch = state.std142DestroyBatch;
  if (!batch) return false;
  const next = batch.queue.shift();
  if (next) {
    const location = findCard(state, next);
    if (!location || location.card.faceDown === true || !location.card.name.includes("聖樹")) {
      return continueStd142DestroyResolution(state);
    }
    (state.std142DestructionContinuations ??= {})[next] = { type: "target" };
    destroyCard(state, location.playerId, next, { source: batch.sourceName });
    return true;
  }
  const player = state.players[batch.playerId];
  const candidates = player.trash.filter((card) => card.category === "Script");
  const maximum = Math.min(batch.destroyedCount, candidates.length);
  const { activeId, playerId, sourceName } = batch;
  delete state.std142DestroyBatch;
  if (maximum <= 0) return scheduleStd142TurnEndResume(state, activeId);
  const request = createSelectionRequest({
    mode: "up_to",
    candidates: candidates.map((card) => card.uid),
    count: maximum,
    minimum: 0,
    maximum,
    candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])),
    label: `Scriptを${maximum}枚までサルベージ`,
    message: sourceName,
    continuation: { type: "std142-salvage", playerId, activeId, sourceName }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function settleStd142DestructionContinuation(state, uid, destroyed) {
  const continuation = state.std142DestructionContinuations?.[uid];
  if (!continuation) return false;
  delete state.std142DestructionContinuations[uid];
  if (!Object.keys(state.std142DestructionContinuations).length) delete state.std142DestructionContinuations;
  if (continuation.type === "source") {
    if (destroyed) return openStd142DestroySelection(state, continuation);
    return scheduleStd142TurnEndResume(state, continuation.activeId);
  }
  if (continuation.type === "target" && state.std142DestroyBatch) {
    if (destroyed) state.std142DestroyBatch.destroyedCount += 1;
    return continueStd142DestroyResolution(state);
  }
  return false;
}

export function resolveSamLogin(state, playerId, discardUid) {
  const player = state.players[playerId];
  const sourceUid = state.pending?.request?.continuation?.sourceUid;
  const source = sourceUid ? findCard(state, sourceUid)?.card : null;
  const index = player.hand.findIndex((card) => card.uid === discardUid
    && (source?.id === "STD-077" ? hasClass(card, "レッドパンクス") : card.color === "赤"));
  if (index < 0) return fail(state, "サムの効果で捨てる赤カードを選んで。", false);
  const [discarded] = player.hand.splice(index, 1);
  moveCardToTrash(state, playerId, discarded, "サムの効果コスト");
  drawCards(state, playerId, 2);
  state.pending = null;
  addLog(state, `ジャンカー・サム: ${discarded.name}を捨て、2枚ドロー。`, "effect");
  provisional(state, "レッドパンクス分類データが未整備のため、サムの手札コストは赤カード全般を選択可能。", CARD_LIBRARY["STD-077"]);
  return true;
}

export function resolveLuckyShotAdditional(state, playerId, targetUid) {
  const continuation = state.pending?.request?.continuation;
  if (continuation?.type === "runtime-action-selection" && continuation.sourceId === "STD-086") {
    return resolveCardSelection(state, continuation, { selected: [targetUid] });
  }
  const source = state.deferredSpellCleanup?.card?.id === "STD-086"
    ? state.deferredSpellCleanup.card
    : { ...CARD_LIBRARY["STD-086"], uid: "STD-086-legacy-compat" };
  const selection = cardRuntimeSpec("STD-086", "spell")?.actions?.find((action) => action.type === "select");
  if (!selection) return false;
  state.pending = null;
  return runEffectEntry(state, "lucky-shot-additional", playerId, () => executeRuntimeActions(
    state,
    playerId,
    source,
    selection.afterActions,
    { targetUid, targetUids: [targetUid], runtime: { records: Object.create(null) } }
  ));
}

export function activateStd203Response(state, playerId, cardUid, selectedUids, responseEvent) {
  const own = selectedUids.map((uid) => findCard(state, uid)).find((entry) => entry?.playerId === playerId && isObCard(entry.card) && ["front", "back"].includes(entry.zoneName));
  const enemyId = otherPlayer(playerId);
  const enemy = selectedUids.map((uid) => findCard(state, uid)).find((entry) => entry?.playerId === enemyId && isObCard(entry.card) && ["front", "back"].includes(entry.zoneName));
  if (!own || !enemy) return false;
  return declareResponse(state, playerId, cardUid, {
    targetUid: enemy.card.uid, targetUids: [own.card.uid, enemy.card.uid], responseEvent
  });
}

export function beginStd165ThresholdEffect(state, playerId, sourceUid) {
  const source = findCard(state, sourceUid);
  if (!source || source.playerId !== playerId || source.zoneName !== "back" || source.card.id !== "STD-165" || !source.card.residentActive) return false;
  const player = state.players[playerId];
  const candidates = [...player.hand, ...player.trash].filter((card) => isObCard(card) && hasClass(card, "旧支配者"));
  const sourceName = source.card.name;
  const sourceText = source.card.text;
  state.resolvingStd165 = true;
  const destroyed = destroyCard(state, playerId, sourceUid, { source: sourceName, suppressReplacement: true, suppressTrashScriptWindow: true });
  state.resolvingStd165 = false;
  if (!destroyed) return false;
  if (!candidates.length) return true;
  const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
    candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])), label: `${sourceName}: 旧支配者をログイン`, message: sourceText,
    continuation: { type: "std165-login", playerId, sourceName } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function triggerStd165Threshold(state) {
  if (state.resolvingStd165 || Number(state.turnStats.destroyedCards ?? 0) < 4) return;
  const ownerOrder = [state.active, otherPlayer(state.active)];
  const entriesByOwner = new Map();
  for (const playerId of ownerOrder) {
    const player = state.players[playerId];
    const entries = [];
    for (const source of player.back.filter((card) => card.id === "STD-165" && card.residentActive)) {
      entries.push({ kind: "STD-165", playerId, sourceUid: source.uid, sourceName: source.name });
    }
    entriesByOwner.set(playerId, entries);
  }
  let hasNext = true;
  while (hasNext) {
    hasNext = false;
    for (const playerId of ownerOrder) {
      const next = entriesByOwner.get(playerId)?.shift();
      if (!next) continue;
      (state.independentEffects ??= []).push(next);
      hasNext = true;
    }
  }
  if (!state.effectResolution && !state.pending && !state.prompt) drainIndependentEffects(state);
}

export function resolveStd049TurnEnd(state, activeId) {
  const controllerId = otherPlayer(activeId);
  const player = state.players[controllerId];
  const armed = player.trash.filter((card) => card.id === "STD-049" && card.std049ProxyArmed);
  if (!armed.length) return;
  const calamities = [...player.front, ...player.back].filter((card) => card.id === "STD-050");
  if (!calamities.length) return;
  let destroyed = 0;
  for (const target of calamities) {
    if (destroyCard(state, controllerId, target.uid, { source: "宵の明星の起動コスト" })) destroyed += 1;
  }
  if (!destroyed) return;
  for (const source of armed) {
    dealFortressDamage(state, activeId, 5, controllerId, source.name);
    const trashIndex = player.trash.findIndex((card) => card.uid === source.uid);
    const zoneName = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
    if (trashIndex >= 0) {
      const [decoded] = player.trash.splice(trashIndex, 1);
      delete decoded.std049ProxyArmed;
      decoded.sleep = false;
      decoded.summoningSick = false;
      decoded.damage = 0;
      const placed = placeByMode(state, controllerId, decoded, { zone: zoneName, from: "trash", source: source.name }) === "placed";
      if (!placed) continue;
      addLog(state, `${source.name}: 災いの明星${destroyed}体を破壊し、5ダメージとデコードを解決。`, "effect");
    }
  }
}

export { CARD_LIBRARY };
