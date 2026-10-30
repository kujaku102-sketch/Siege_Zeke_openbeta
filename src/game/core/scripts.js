import { createEventContext, createScriptActivationWindow } from "../activation-windows.js";
import { hasKeyword, keywordValue } from "../effect-compiler.js";
import { hasOptionalActivationSpec, optionalSpecsForCard } from "../trigger-specs.js";
import { cardRuntimeSpec } from "../card-runtime-specs.js";
import { createSelectionRequest } from "../selection-model.js";
import { boardSlotOf, cardAtBoardSlot } from "../board-slots.js";
import { resolveTrinityEffect, resumeDeferredAttack } from "./battle.js";
import { continueDeferredDeclaredScriptCleanup, declareEffect, runEffectEntry } from "./effects.js";
import { continueDeferredSpellCleanup, enabledSymbols, supportsNormalScriptActivation } from "./play.js";
import { enqueueSelection, selectionProjectionMeta } from "./projection.js";
import { continueDeferredDeclaredResponseCleanup } from "./response.js";
import { addLog, fail, findCard, otherPlayer } from "./shared.js";
import { emitGameEvent } from "./triggers.js";
import { resumeMandatoryDrawContinuation } from "./turn.js";
import { continuePlacementCostBatch, createVengeanceCard, emitEffectPlacement, executeRuntimeActions, executeTriggerAction, forceExecuteCard, moveCardToTrash, placeByMode, resumeDeferredDestruction, resumeDeferredTrashMove, runtimeActionFeasible, setCardSleeping, triggerActionFeasible } from "../engine.js";

export const DECLARED_IF_SCRIPT_IDS = new Set(["STD-001", "STD-002", "STD-003", "STD-018", "STD-019", "STD-036", "STD-037", "STD-038", "STD-139", "STD-140", "STD-148"]);

export const NORMAL_IF_SCRIPT_IDS = new Set(["STD-001", "STD-002", "STD-003", "STD-036", "STD-037", "STD-139", "STD-140", "STD-148"]);

export const EVENT_CONTEXT_REQUIRED_IF_IDS = new Set(["STD-018", "STD-019", "STD-038", "STD-204"]);

function queueScriptActivationEntry(state, entry) {
  if (state.prompt) {
    state.scriptActivationQueue.push(entry);
    return true;
  }
  state.prompt = entry.prompt;
  addLog(state, entry.prompt.message, "effect");
  return true;
}

export function queueDeclaredScriptActivationWindow(state, window) {
  const script = window.source.card;
  return queueScriptActivationEntry(state, {
    window,
    prompt: {
      type: "script-activation", playerId: window.controllerId, scriptUid: script.uid,
      activationWindowId: window.id, eventContext: window.context,
      message: `条件成立：「${script.name}」を起動する？`, detail: script.text
    }
  });
}

export function openScriptActivationWindow(state, playerId, script, event, promptData = {}) {
  const normalizedEvent = event?.raw ? event.raw : { id: event?.id ?? `EV-${++state.triggerSerial}`, ...event };
  const eventContext = event?.raw ? event : createEventContext(state, normalizedEvent);
  const window = createScriptActivationWindow(state, eventContext, playerId, { playerId, zoneName: "back", card: script }, keywordValue(script, "IF"));
  const alreadyQueued = state.activationWindows.some((item) => item.id === window.id)
    || state.scriptActivationQueue.some((item) => item.window?.id === window.id)
    || state.prompt?.activationWindowId === window.id;
  if (alreadyQueued) return false;
  state.activationWindows.push(window);
  const entry = {
    window,
    prompt: {
    type: "script-activation", playerId, scriptUid: script.uid,
    activationWindowId: window.id, eventContext,
    message: `条件成立：「${script.name}」を起動する？`, detail: keywordValue(script, "IF"),
    ...promptData
    }
  };
  return queueScriptActivationEntry(state, entry);
}

function openNextScriptActivationWindow(state) {
  if (state.prompt || !state.scriptActivationQueue.length) return false;
  const entry = state.scriptActivationQueue.shift();
  if (entry.window.status !== "pending") return openNextScriptActivationWindow(state);
  const source = findCard(state, entry.window.source.card.uid);
  const residentWindow = source?.card.residentActive === true && ["STD-139", "STD-140"].includes(source.card.id);
  if (!source || source.playerId !== entry.window.controllerId || source.zoneName !== "back" || (source.card.faceDown !== true && !residentWindow)) {
    entry.window.status = "declined";
    return openNextScriptActivationWindow(state);
  }
  state.prompt = entry.prompt;
  addLog(state, `${entry.prompt.message}`, "effect");
  return true;
}

export function queueScriptPrompt(state, playerId, triggerText, context = state.lastEventContext) {
  const scripts = state.players[playerId].back.filter((card) =>
    card.category === "Script" && card.faceDown && keywordValue(card, "IF")?.includes(triggerText)
  );
  let queued = false;
  for (const script of scripts) queued = openScriptActivationWindow(state, playerId, script, context ?? {
    type: "legacy_condition", playerId, source: triggerText
  }) || queued;
  return queued;
}

export function queueMemoryLimitIncreasePrompt(state, increasedPlayerId, source) {
  const scriptOwnerId = otherPlayer(increasedPlayerId);
  const scripts = state.players[scriptOwnerId].back.filter((card) => card.id === "STD-037" && card.faceDown);
  let queued = false;
  for (const script of scripts) queued = openScriptActivationWindow(state, scriptOwnerId, script, {
    type: "memory_limit_increased", playerId: increasedPlayerId, ownerId: increasedPlayerId, source
  }, { eventTargetOwnerId: increasedPlayerId }) || queued;
  return queued;
}

function activateScriptCore(state, playerId, uid, { costUid = null, selectionUid = null } = {}) {
  const player = state.players[playerId];
  const index = player.back.findIndex((card) => card.uid === uid && card.category === "Script");
  if (index < 0) return fail(state, "そのScriptはバックにない。", false);
  const script = player.back[index];
  if (script.cannotActivateTurn === state.turnNumber) return fail(state, "この効果で配置されたため、このターンは起動できない。", false);
  const condition = keywordValue(script, "IF");
  const requiresWindow = Boolean(condition) || hasOptionalActivationSpec(script.id);
  const prompted = state.prompt?.type === "script-activation" && state.prompt.scriptUid === uid;
  const activationWindow = prompted ? state.activationWindows.find((window) => window.id === state.prompt.activationWindowId) : null;
  const normalIfActivation = Boolean(condition) && !prompted && supportsNormalScriptActivation(script);
  if (requiresWindow && prompted && (!activationWindow || activationWindow.status !== "pending")) return fail(state, "この誘発窓は既に処理済み。", false);
  if (EVENT_CONTEXT_REQUIRED_IF_IDS.has(script.id) && !prompted) return fail(state, "このScriptは参照するイベントがないため通常起動できない。", false);
  if (requiresWindow && !prompted && !normalIfActivation) return fail(state, condition ? `[if:${condition}]が成立していない。` : "発動条件が成立していない。", false);
  if ((!requiresWindow || normalIfActivation) && state.active !== playerId) return fail(state, "Scriptの通常起動は自分ターン中だけ。", false);
  if (normalIfActivation && (state.pending || state.prompt || state.winner)) return fail(state, "処理待ちがないメインアクション時だけ通常起動できる。", false);
  const activationCost = Number(script.activationCost ?? script.cost ?? 0);
  if (player.memory < activationCost) return fail(state, `${script.name}の起動に必要なメモリが足りない。`, false);
  if (state.mode !== "lab" && script.color && !enabledSymbols(player).includes(script.color)) {
    return fail(state, `${script.color}シンボルがない。先にレジストリへインストールして。`, false);
  }
  const activationRuntime = cardRuntimeSpec(script.id, "script_activation");
  const eventContext = activationWindow?.context ?? state.prompt?.eventContext ?? null;
  const eventTargetUid = state.prompt?.eventTargetUid ?? eventContext?.cardUid ?? null;
  const declaredActions = activationWindow?.spec?.actions?.length ? activationWindow.spec.actions : optionalSpecsForCard(script.id)[0]?.actions ?? [];
  const feasibilityRuntime = { records: { activation_target_uid: eventTargetUid } };
  if (activationRuntime && !activationRuntime.actions.every((action) => runtimeActionFeasible(state, playerId, script, action, feasibilityRuntime))) {
    return fail(state, "効果を実行できる対象がない。", false);
  }
  if ((prompted || normalIfActivation) && DECLARED_IF_SCRIPT_IDS.has(script.id) && !declaredActions.every((action) => triggerActionFeasible(state, playerId, action))) {
    return fail(state, "効果を実行できる対象がない。", false);
  }
  const additionalCost = activationRuntime?.additionalCost;
  if (additionalCost) {
    const eventValue = eventContext?.[additionalCost.matchEventField]
      ?? state.prompt?.[`eventCard${additionalCost.matchEventField[0].toUpperCase()}${additionalCost.matchEventField.slice(1)}`];
    const candidates = player[additionalCost.source]?.filter((card) => eventValue && card[additionalCost.matchEventField] === eventValue) ?? [];
    if (candidates.length < Number(additionalCost.count ?? 1)) return fail(state, "追加コストを支払えるカードがない。", false);
    if (!costUid && candidates.length > 1) {
      const request = createSelectionRequest({
        mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
        label: additionalCost.label, message: script.text,
        continuation: { type: "activate-runtime-additional-cost", playerId, scriptUid: uid }
      });
      state.pending = { type: "selection", validTargets: request.candidates, request };
      return true;
    }
    costUid ??= candidates[0].uid;
    if (!candidates.some((card) => card.uid === costUid)) return fail(state, "追加コストの条件を満たすカードを選んで。", false);
  }
  if (DECLARED_IF_SCRIPT_IDS.has(script.id) && (prompted || normalIfActivation)) {
    player.memory -= activationCost;
    script.faceDown = false;
    if (additionalCost?.type === "discard") {
      const discardIndex = player[additionalCost.source].findIndex((card) => card.uid === costUid);
      if (discardIndex >= 0) moveCardToTrash(state, playerId, player[additionalCost.source].splice(discardIndex, 1)[0], `${script.name}の追加コスト`);
    }
    const sourceSnapshot = Object.freeze({
      ...script,
      ...(state.runtimeContext ? { identity: Object.freeze({ ...script.identity }) } : {}),
      classes: Object.freeze([...(script.classes ?? [])]),
      traits: Object.freeze([...(script.traits ?? [])]),
      mounted: Object.freeze([...(script.mounted ?? [])])
    });
    const declared = declareEffect(state, {
      kind: "script", cardId: script.id, playerId, sourceUid: script.uid, sourceSnapshot,
      activationCause: prompted ? "event" : "normal",
      eventContext,
      eventTargetUid,
      eventCardUids: Object.freeze([...(eventContext?.raw?.cardUids ?? [eventTargetUid].filter(Boolean))]),
      runtime: activationRuntime,
      actions: Object.freeze([...declaredActions])
    });
    script.declaredEffectId = declared.id;
    if (activationWindow) activationWindow.status = "declared";
    state.prompt = null;
    addLog(state, `${script.name}を宣言。現在の効果完了後に解決する。`, "action");
    openNextScriptActivationWindow(state);
    resumeDeferredTrashMove(state);
    resumeDeferredDestruction(state);
    resumeDeferredAttack(state);
    resumeMandatoryDrawContinuation(state);
    continueDeferredDeclaredResponseCleanup(state);
    continueDeferredSpellCleanup(state);
    continuePlacementCostBatch(state);
    return true;
  }
  if (script.id === "STD-142") {
    if (player.scriptUsage[`${script.uid}:effect1`]) return fail(state, "このターンは①を起動済み。", false);
    const candidates = [...player.hand, ...player.trash].filter((card) => card.category === "Script" && card.name.includes("聖樹"));
    if (!candidates.length) return fail(state, "手札またはゴミ箱に配置できる「聖樹」Scriptがない。", false);
    if (!selectionUid) {
      const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
        candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])), label: "配置する「聖樹」Scriptを選択", message: script.text,
        continuation: { type: "activate-std142-effect1", playerId, scriptUid: uid } });
      state.pending = { type: "selection", validTargets: request.candidates, request };
      return true;
    }
    if (!candidates.some((card) => card.uid === selectionUid)) return fail(state, "配置する「聖樹」Scriptを選んで。", false);
  }
  if (script.id === "STD-105") {
    const candidates = player.hand.filter((card) => card.printedCategory === "Lyd-Ob" || card.category === "Lyd-Ob");
    if (!candidates.length) return fail(state, "手札に強制実行できるLyd-Obがない。", false);
    if (!selectionUid) {
      const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
        candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])), label: "強制実行するLyd-Ob", message: script.text,
        continuation: { type: "activate-std105", playerId, scriptUid: uid } });
      state.pending = { type: "selection", validTargets: request.candidates, request };
      return true;
    }
    if (!candidates.some((card) => card.uid === selectionUid)) return fail(state, "手札のLyd-Obを選んで。", false);
  }
  const replacementTargetUid = state.prompt?.replacementTargetUid;
  player.memory -= activationCost;
  script.faceDown = false;
  if (additionalCost?.type === "discard") {
    const discardIndex = player[additionalCost.source].findIndex((card) => card.uid === costUid);
    if (discardIndex >= 0) moveCardToTrash(state, playerId, player[additionalCost.source].splice(discardIndex, 1)[0], `${script.name}の追加コスト`);
  }
  if (activationRuntime) executeRuntimeActions(state, playerId, script, activationRuntime.actions, {
    targetUid: eventTargetUid,
    runtime: {
      records: {
        eventCardUids: state.prompt?.eventContext?.raw?.cardUids ?? [eventTargetUid].filter(Boolean)
      }
    }
  });
  if (script.id === "STD-142") {
    player.scriptUsage[`${script.uid}:effect1`] = true;
    const handIndex = player.hand.findIndex((card) => card.uid === selectionUid);
    const trashIndex = player.trash.findIndex((card) => card.uid === selectionUid);
    const [placed] = handIndex >= 0 ? player.hand.splice(handIndex, 1) : player.trash.splice(trashIndex, 1);
    const origin = handIndex >= 0 ? "hand" : "trash";
    if (placeByMode(state, playerId, placed, { zone: "back", from: origin, source: script.name, suppressScriptWindow: origin === "trash" }) === "placed") {
      placed.faceDown = true;
      placed.cannotActivateTurn = state.turnNumber;
      addLog(state, `${script.name}: 「${placed.name}」を配置。このターン起動不可。`, "effect");
    }
  }
  if (script.id === "STD-105") {
    const execution = forceExecuteCard(state, {
      sourceOwnerId: playerId, controllerId: playerId, sourceZone: "hand", targetZone: "area", cardUid: selectionUid, sourceName: script.name,
      onPlaced: (placed) => {
        setCardSleeping(state, playerId, placed);
        placed.summoningSick = false;
        placed.grantedKeywords = [...new Set([...(placed.grantedKeywords ?? []), "SECURITY"])];
      }
    });
    if (execution.status === "placed") {
      state.delayedEffects.push({ event: "turn_ended", dueTurn: state.turnNumber + 1, type: "destroy_card", ownerId: playerId, cardUid: execution.card.uid, sourceName: script.name });
      addLog(state, `${script.name}: ${execution.card.name}を強制実行し、スリープ・[セキュリティ]を付与。`, "effect");
    }
  }
  if (script.id === "STD-204" && replacementTargetUid) {
    const target = findCard(state, replacementTargetUid);
    if (target && ["front", "back"].includes(target.zoneName)) {
      const targetZone = state.players[target.playerId][target.zoneName];
      const targetIndex = targetZone.findIndex((card) => card.uid === replacementTargetUid);
      const [executedOb] = targetZone.splice(targetIndex, 1);
      executedOb.layerRole = "layered";
      const gigantes = createVengeanceCard(state, "STD-205", playerId);
      gigantes.mounted = [executedOb];
      gigantes.summoningSick = true;
      const zone = target.zoneName;
      if (placeByMode(state, playerId, gigantes, { zone, from: target.zoneName, source: script.name }) !== "placed") return true;
      addLog(state, `${script.name}: ${executedOb.name}の配置を置換し、「ドールズ・ギガンテス」のレイヤーとして配置。`, "effect");
    }
  }
  if (script.id === "STD-121") resolveTrinityEffect(state, state.active, script.name);
  if (script.id === "STD-231") {
    const target = findCard(state, state.prompt?.eventContext?.cardUid);
    if (target && ["front", "back"].includes(target.zoneName)) {
      const owner = state.players[target.playerId];
      const context = { controllerId: target.playerId, zoneName: target.zoneName, limit: owner.user?.[`${target.zoneName}Limit`] };
      const targetSlot = boardSlotOf(owner[target.zoneName], target.card, context);
      let count = 0;
      for (const slot of [targetSlot - 1, targetSlot + 1]) {
        if (slot < 1 || slot > context.limit || cardAtBoardSlot(owner[target.zoneName], slot, context)) continue;
        const proof = createVengeanceCard(state, "STD-228", playerId);
        if (placeByMode(state, target.playerId, proof, { zone: target.zoneName, from: "generated", source: script.name, requestedSlot: slot }) === "placed") { emitEffectPlacement(state, target.playerId, proof, target.zoneName, script.name); count += 1; }
      }
      addLog(state, `${script.name}: ${target.card.name}の両隣りへ征服の証${count}枚を配置。`, "effect");
    }
  }
  if (activationWindow?.spec?.actions?.length) {
    if (activationWindow.spec.limit === "once_per_turn") player.triggerUsage[activationWindow.spec.id] = true;
    for (const action of activationWindow.spec.actions) executeTriggerAction(state, activationWindow, action);
  }
  const resident = hasKeyword(script, "RESIDENT") || script.id === "STD-142";
  if (resident) {
    script.residentActive = true;
    addLog(state, script.id === "STD-142" ? `${script.name}の①を起動し、場に残る。` : `${script.name}を起動。[レジデント]として場に残る。`, "action");
  } else {
    player.back.splice(index, 1);
    moveCardToTrash(state, playerId, script, script.name);
    addLog(state, `${script.name}を起動し、解決後にゴミ箱へ。`, "action");
  }
  emitGameEvent(state, {
    type: "script_activated", playerId, ownerId: script.owner ?? playerId,
    cardUid: script.uid, cardId: script.id, cardName: script.name, category: script.category
  });
  player.scriptActivatedTurn = state.turnNumber;
  for (const candidate of player.hand.filter((card) => card.id === "STD-179")) {
    const request = createSelectionRequest({ mode: "scope", scopeField: "place", scopeOptions: ["配置しない", "配置する"],
      label: `${candidate.name}: 手札から配置`, message: candidate.text,
      continuation: { type: "std179-place", playerId, sourceUid: candidate.uid, sourceName: candidate.name } });
    enqueueSelection(state, { type: "selection", validTargets: [], request }, selectionProjectionMeta("engine:std179-place", playerId));
  }
  state.prompt = null;
  if (activationWindow) activationWindow.status = "resolved";
  openNextScriptActivationWindow(state);
  resumeDeferredTrashMove(state);
  resumeDeferredDestruction(state);
  resumeDeferredAttack(state);
  resumeMandatoryDrawContinuation(state);
  continueDeferredDeclaredResponseCleanup(state);
  continueDeferredSpellCleanup(state);
  continuePlacementCostBatch(state);
  return true;
}

export function activateScript(state, playerId, uid, options = {}) {
  const location = findCard(state, uid);
  const prompted = state.prompt?.type === "script-activation" && state.prompt.scriptUid === uid;
  if (!prompted && location?.playerId === playerId && location.zoneName === "back" && keywordValue(location.card, "IF")) {
    const invalidNormalEntry = state.effectResolution || state.resolvingDeclaredEffect || state.phase !== "main"
      || state.pending || state.prompt || state.winner || location.card.faceDown !== true || location.card.declaredEffectId;
    if (invalidNormalEntry) return fail(state, "Scriptの通常起動は処理待ちのない自分メイン中、裏向きの未宣言カードだけ。", false);
  }
  return runEffectEntry(state, "script", playerId, () => activateScriptCore(state, playerId, uid, options));
}

function declinePromptCore(state) {
  if (!state.prompt) return false;
  const window = state.activationWindows.find((item) => item.id === state.prompt.activationWindowId);
  if (window) window.status = "declined";
  addLog(state, `${state.prompt.message} → 起動しない。`, "system");
  state.prompt = null;
  openNextScriptActivationWindow(state);
  resumeDeferredTrashMove(state);
  resumeDeferredDestruction(state);
  resumeDeferredAttack(state);
  resumeMandatoryDrawContinuation(state);
  continueDeferredDeclaredResponseCleanup(state);
  continueDeferredSpellCleanup(state);
  continuePlacementCostBatch(state);
  return true;
}

export function declinePrompt(state) {
  return runEffectEntry(state, "prompt-decline", state.prompt?.playerId ?? null, () => {
    const declined = declinePromptCore(state);
    // 起動確認を断った後も、保留中の宣言済みScriptの後片付けを進める(選択の解決後と同じ)
    if (declined && !state.pending && !state.prompt) continueDeferredDeclaredScriptCleanup(state);
    return declined;
  });
}
