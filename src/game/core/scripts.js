import { collectFlagged } from "../../cards/index.js";
import { DECLARED_IF_SCRIPT_ORDER } from "../../cards/spec-order.js";
import { createEventContext, createScriptActivationWindow } from "../activation-windows.js";
import { cardRuntimeSpec } from "../card-runtime-specs.js";
import { TRACE_TAGS, trace, TRACE, tracing, waypoint } from "../engine-trace.js";
import { createSelectionRequest } from "../selection-model.js";
import { hasOptionalActivationSpec, optionalSpecsForCard } from "../trigger-specs.js";
import { resumeDeferredAttack } from "./battle.js";
import { resumeMandatoryDrawContinuation } from "./draw.js";
import { continueDeferredDeclaredScriptCleanup, declareEffect, runEffectEntry } from "./effects.js";
import { hasKeyword, keywordValue } from "./keywords.js";
import { continueDeferredSpellCleanup } from "./play-spell.js";
import { markExecutionReplaced, queueDeferredExecutionResume } from "./execution-replacement.js";
import { enabledSymbols, supportsNormalScriptActivation } from "./play.js";
import { enqueueSelection, selectionProjectionMeta } from "./projection.js";
import { continueDeferredDeclaredResponseCleanup } from "./response.js";
import { addLog, fail, findCard, otherPlayer, payMemory } from "./shared.js";
import { resumeTurnEndWhenSettled } from "./turn.js";
import { emitGameEvent } from "./triggers.js";
import { CUSTOM_ACTIVATE_SCRIPT_CORE, CUSTOM_ACTIVATE_SCRIPT_CORE_2, PASS } from "../effects/custom/index.js";
import { runtimeActionFeasible, triggerActionFeasible } from "../effects/generic/action-values.js";
import { executeRuntimeActions } from "../effects/generic/actions.js";
import { effectPlacementRoom } from "../effects/generic/placement.js";
import { continuePlacementCostBatch } from "../effects/generic/cost.js";
import { resumeDeferredDestruction } from "../effects/generic/destroy.js";
import { moveCardToTrash, resumeDeferredTrashMove } from "../effects/generic/trash.js";
import { executeTriggerAction } from "../effects/generic/trigger-actions.js";

// Scripts whose [if:] effect is declared and resolved after the current effect. The older ones are listed here; a card sets the flag
// `declaredIfScript` in its module (and is listed in DECLARED_IF_SCRIPT_ORDER).
export const DECLARED_IF_SCRIPT_IDS = new Set([
  "STD-001", "STD-002", "STD-003", "STD-018", "STD-019", "STD-036", "STD-037", "STD-038", "STD-139", "STD-140", "STD-148",
  ...collectFlagged("declaredIfScript", DECLARED_IF_SCRIPT_ORDER)
]);

export const NORMAL_IF_SCRIPT_IDS = new Set(["STD-001", "STD-002", "STD-003", "STD-036", "STD-037", "STD-139", "STD-140", "STD-148"]);

export const EVENT_CONTEXT_REQUIRED_IF_IDS = new Set(["STD-018", "STD-019", "STD-038", "STD-204"]);

// なぜ今このScriptを起動できないか(起動できるなら null)。起動の確認を出すかどうかも、起動の本体も、これで決める: 払えない・対象がない起動を確認に出すと、答えが拒否されるだけになる
// (2026-11-09: 先読みCPUとゲームのCPUの答えが ACTION_NOT_ALLOWED で拒否された3件は、どれもメモリ不足の確認に「起動」を答えたものだった)。
// declared: 宣言して解決する [if:] の効果(DECLARED_IF_SCRIPT_IDS)も対象があるかを見る。
function scriptActivationBlocker(state, playerId, script, { eventTargetUid = null, windowActions = null, declared = true } = {}) {
  const player = state.players[playerId];
  const activationCost = Number(script.activationCost ?? script.cost ?? 0);
  if (player.memory < activationCost) return "memory";
  if (state.mode !== "lab" && script.color && !enabledSymbols(player).includes(script.color)) return "symbol";
  const activationRuntime = cardRuntimeSpec(script.id, "script_activation");
  const feasibilityRuntime = { records: { activation_target_uid: eventTargetUid } };
  if (activationRuntime && !activationRuntime.actions.every((action) => runtimeActionFeasible(state, playerId, script, action, feasibilityRuntime))) return "target";
  const declaredActions = windowActions?.length ? windowActions : optionalSpecsForCard(script.id)[0]?.actions ?? [];
  if (declared && DECLARED_IF_SCRIPT_IDS.has(script.id) && !declaredActions.every((action) => triggerActionFeasible(state, playerId, action))) return "target";
  return null;
}

const BLOCKER_MESSAGES = Object.freeze({
  memory: (script) => `${script.name}の起動に必要なメモリが足りない。`,
  symbol: (script) => `${script.color}シンボルがない。先にレジストリへインストールして。`,
  target: () => "効果を実行できる対象がない。"
});

// 確認の窓を出す前の確かめ: 起動できないScriptの確認は出さない(出しても「起動」は拒否されるだけで、断るしかない)。窓は処理済み(declined)として、ログに理由を残す。
function windowBlocked(state, window, prompt) {
  const script = window.source?.card;
  const playerId = prompt.playerId ?? window.controllerId;
  if (!script || !state.players[playerId]) return false;
  const eventContext = prompt.eventContext ?? window.context ?? null;
  const blocker = scriptActivationBlocker(state, playerId, script, {
    eventTargetUid: prompt.eventTargetUid ?? eventContext?.cardUid ?? null, windowActions: window.spec?.actions, declared: true
  });
  if (!blocker) return false;
  window.status = "declined";
  addLog(state, `「${script.name}」は起動できないため、確認を出さない(${BLOCKER_MESSAGES[blocker](script)})`, "effect");
  return true;
}

function queueScriptActivationEntry(state, entry) {
  if (state.prompt) {
    state.scriptActivationQueue.push(entry);
    return true;
  }
  if (windowBlocked(state, entry.window, entry.prompt)) return false;
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
  if (windowBlocked(state, entry.window, entry.prompt)) return openNextScriptActivationWindow(state);
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
  const activationRuntime = cardRuntimeSpec(script.id, "script_activation");
  const eventContext = activationWindow?.context ?? state.prompt?.eventContext ?? null;
  const eventTargetUid = state.prompt?.eventTargetUid ?? eventContext?.cardUid ?? null;
  const declaredActions = activationWindow?.spec?.actions?.length ? activationWindow.spec.actions : optionalSpecsForCard(script.id)[0]?.actions ?? [];
  const blocker = scriptActivationBlocker(state, playerId, script, { eventTargetUid, windowActions: activationWindow?.spec?.actions, declared: prompted || normalIfActivation });
  if (blocker) return fail(state, BLOCKER_MESSAGES[blocker](script), false);
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
    payMemory(state, playerId, activationCost, "script-activation");
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
    queueDeferredExecutionResume(state);
    resumeDeferredTrashMove(state);
    resumeDeferredDestruction(state);
    resumeDeferredAttack(state);
    resumeMandatoryDrawContinuation(state);
    continueDeferredDeclaredResponseCleanup(state);
    continueDeferredSpellCleanup(state);
    continuePlacementCostBatch(state);
    return true;
  }
  const customActivateScriptCore2 = CUSTOM_ACTIVATE_SCRIPT_CORE_2[script.id];
  if (customActivateScriptCore2) {
    const customResult = customActivateScriptCore2({ player, script, state, selectionUid, playerId, uid });
    if (customResult !== PASS) return customResult;
  }
  if (state.prompt?.executionReplacement) markExecutionReplaced(state, script);
  payMemory(state, playerId, activationCost, "script-activation");
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
  const customActivateScriptCore = CUSTOM_ACTIVATE_SCRIPT_CORE[script.id];
  if (customActivateScriptCore) {
    const customResult = customActivateScriptCore({ player, script, selectionUid, state, playerId });
    if (customResult !== PASS) return customResult;
  }
  if (activationWindow?.spec?.actions?.length) {
    if (activationWindow.spec.limit === "once_per_turn") player.triggerUsage[activationWindow.spec.id] = true;
    for (const action of activationWindow.spec.actions) executeTriggerAction(state, activationWindow, action);
  }
  const resident = hasKeyword(script, "RESIDENT") || script.id === "STD-142";
  if (resident) {
    script.residentActive = true;
    if (TRACE && tracing()) trace(state, { tag: TRACE_TAGS.CLEANUP, event: "script-resident", cardId: script.id, cardUid: script.uid, playerId });
    if (TRACE && tracing()) waypoint(state, "rule:source-cleanup", true, { cardId: script.id, cardUid: script.uid, how: "script-resident" });
    addLog(state, script.id === "STD-142" ? `${script.name}の①を起動し、場に残る。` : `${script.name}を起動。[レジデント]として場に残る。`, "action");
  } else {
    player.back.splice(index, 1);
    if (TRACE && tracing()) trace(state, { tag: TRACE_TAGS.CLEANUP, event: "script-to-trash", cardId: script.id, cardUid: script.uid, playerId });
    if (TRACE && tracing()) waypoint(state, "rule:source-cleanup", true, { cardId: script.id, cardUid: script.uid, how: "script-to-trash" });
    moveCardToTrash(state, playerId, script, script.name);
    addLog(state, `${script.name}を起動し、解決後にゴミ箱へ。`, "action");
  }
  emitGameEvent(state, {
    type: "script_activated", playerId, ownerId: script.owner ?? playerId,
    cardUid: script.uid, cardId: script.id, cardName: script.name, category: script.category
  });
  player.scriptActivatedTurn = state.turnNumber;
  for (const candidate of player.hand.filter((card) => card.id === "STD-179" && effectPlacementRoom(state, playerId))) {
    const request = createSelectionRequest({ mode: "scope", scopeField: "place", scopeOptions: ["ドラッグしない", "スリープしてドラッグする"],
      label: `${candidate.name}: 手札からスリープしてドラッグ`, message: candidate.text,
      continuation: { type: "std179-place", playerId, sourceUid: candidate.uid, sourceName: candidate.name } });
    enqueueSelection(state, { type: "selection", validTargets: [], request }, selectionProjectionMeta("engine:std179-place", playerId));
  }
  state.prompt = null;
  if (activationWindow) activationWindow.status = "resolved";
  openNextScriptActivationWindow(state);
  queueDeferredExecutionResume(state);
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
  const activated = runEffectEntry(state, "script", playerId, () => activateScriptCore(state, playerId, uid, options));
  // A prompt that held a turn end back (a Script window a delayed destruction opened) is answered here.
  if (activated && prompted) resumeTurnEndWhenSettled(state);
  return activated;
}

function declinePromptCore(state) {
  if (!state.prompt) return false;
  const window = state.activationWindows.find((item) => item.id === state.prompt.activationWindowId);
  if (window) window.status = "declined";
  addLog(state, `${state.prompt.message} → 起動しない。`, "system");
  state.prompt = null;
  openNextScriptActivationWindow(state);
  queueDeferredExecutionResume(state);
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
  const result = runEffectEntry(state, "prompt-decline", state.prompt?.playerId ?? null, () => {
    const declined = declinePromptCore(state);
    // 起動確認を断った後も、保留中の宣言済みScriptの後片付けを進める(選択の解決後と同じ)
    if (declined && !state.pending && !state.prompt) continueDeferredDeclaredScriptCleanup(state);
    return declined;
  });
  if (result) resumeTurnEndWhenSettled(state);
  return result;
}
