import { collectActivationWindows, createEventContext } from "../activation-windows.js";
import { specsForEvent } from "../trigger-specs.js";
import { cardRuntimeSpec } from "../card-runtime-specs.js";
import { describeOperation } from "../effect-operation-library.js";
import { isObCard } from "../card-types.js";
import { drainIndependentEffects, finalizeEffectResolution, finishGameIfSettled, lockVictoryIfDecided, runEffectEntry } from "./effects.js";
import { enabledSymbols } from "./play.js";
import { queueDeclaredScriptActivationWindow } from "./scripts.js";
import { addLog, cardsInPlay, findCard, otherPlayer } from "./shared.js";
import { executeCardRuntimeSpec, executeTriggerAction } from "../effects/generic/actions.js";

function collectTriggers(state, event) {
  const context = createEventContext(state, event);
  state.lastEventContext = context;
  const windows = collectActivationWindows(state, context, specsForEvent(event.type), cardsInPlay(state));
  state.activationWindows.push(...windows);
  if (state.activationWindows.length > 200) state.activationWindows.splice(0, state.activationWindows.length - 200);
  return windows;
}

function executeQueuedTrigger(state, trigger) {
  trigger.status = "resolving";
  if (trigger.spec.limit === "once_per_turn") state.players[trigger.source.playerId].triggerUsage[trigger.spec.id] = true;
  addLog(state, `誘発: ${trigger.source.card.name}（${trigger.event.type}）`, "effect");
  if (trigger.runtimePhase) executeCardRuntimeSpec(state, trigger.runtimePhase, trigger.source.playerId, trigger.source.card, {
    continuationMeta: { triggerItemId: trigger.id }
  });
  else for (const action of trigger.spec.actions) executeTriggerAction(state, trigger, action);
  if (!state.pending) trigger.status = "resolved";
  // 同時に誘発した効果は別々の効果。1つ完了した時点で勝敗が決まったら、残りは未宣言のまま実行しない。
  if (!state.pending && !state.prompt) lockVictoryIfDecided(state);
}

function finishTriggerThread(state) {
  state.triggerThread.status = "resolved";
  state.triggerThread.message = "スレッドが解決しました";
  state.threadNotice = "スレッドが解決しました";
  if (state.pending?.type === "trigger-order") state.pending = null;
  addLog(state, "スレッドが解決しました。", "system");
  state.processingTriggers = false;
  if (state.winner) finishGameIfSettled(state);
  else drainTriggerQueue(state);
}

function advanceTriggerThread(state) {
  const thread = state.triggerThread;
  if (!thread || thread.status !== "resolving") return;
  if (state.winner) {
    for (const item of thread.items.filter((entry) => entry.status === "pending")) item.status = "cancelled-after-victory-lock";
    return finishTriggerThread(state);
  }
  const unresolved = thread.items.filter((item) => item.status === "pending");
  if (!unresolved.length) return finishTriggerThread(state);

  let choices = unresolved.filter((item) => item.controllerId === thread.currentControllerId);
  if (!choices.length) {
    thread.currentControllerId = otherPlayer(thread.currentControllerId);
    choices = unresolved.filter((item) => item.controllerId === thread.currentControllerId);
  }
  if (thread.currentControllerId === "player") {
    state.pending = { type: "trigger-order", validTargets: [], threadId: thread.id };
    state.processingTriggers = false;
    return;
  }
  const item = choices[0];
  item.status = "resolving";
  executeQueuedTrigger(state, item.trigger);
  if (state.pending?.type === "selection") {
    item.status = "awaiting-selection";
    state.processingTriggers = false;
    return;
  }
  item.status = "resolved";
  thread.currentControllerId = otherPlayer(item.controllerId);
  advanceTriggerThread(state);
}

// 処理順の回答も1つの効果解決として扱う(直前の選択で開いたままの効果解決を閉じるため)
export function resolveTriggerChoice(state, itemId) {
  const thread = state.triggerThread;
  if (!thread || thread.status !== "resolving" || thread.currentControllerId !== "player") return false;
  if (!thread.items.some((entry) => entry.id === itemId && entry.status === "pending" && entry.controllerId === "player")) return false;
  return runEffectEntry(state, "trigger-order", "player", () => resolveTriggerChoiceCore(state, itemId));
}

function resolveTriggerChoiceCore(state, itemId) {
  const thread = state.triggerThread;
  if (!thread || thread.status !== "resolving" || thread.currentControllerId !== "player") return false;
  const item = thread.items.find((entry) => entry.id === itemId && entry.status === "pending" && entry.controllerId === "player");
  if (!item) return false;
  // 処理順の質問を閉じてから実行する。開いたままだと、この誘発が出す選択がpendingではなく待ち行列に積まれ、
  // スレッド終了時に誰も開かないまま取り残されて盤面が止まる。
  if (state.pending?.type === "trigger-order") state.pending = null;
  state.processingTriggers = true;
  item.status = "resolving";
  executeQueuedTrigger(state, item.trigger);
  if (state.pending?.type === "selection") {
    item.status = "awaiting-selection";
    state.processingTriggers = false;
    return true;
  }
  item.status = "resolved";
  thread.currentControllerId = "ai";
  advanceTriggerThread(state);
  return true;
}

// 選択が連鎖して誘発元の再開が飛ばされた場合の保険: 選択待ちのまま残った項目を再開する
export function resumeStalledTriggerThread(state) {
  const thread = state.triggerThread;
  if (thread?.status !== "resolving") return;
  // 選択を終えた誘発の後で別の確認(Script起動確認など)が開き、その回答・解決で閉じた場合も、
  // 他に待ち処理が残っていなければ再開する。残っている間は再開しない。
  if (state.pending || state.prompt || state.processingTriggers || state.declaredEffects?.length || state.resolvingDeclaredEffect
    || state.deferredAttack || state.deferredDestruction || state.deferredTrashMoves?.length || state.deferredDeclaredScriptCleanup) return;
  const item = thread.items.find((entry) => entry.status === "awaiting-selection");
  if (item) resumeTriggerThreadAfterSelection(state, item.id);
}

export function resumeTriggerThreadAfterSelection(state, itemId) {
  const thread = state.triggerThread;
  const item = thread?.items.find((entry) => entry.id === itemId && entry.status === "awaiting-selection");
  if (!item) return;
  item.status = "resolved";
  thread.currentControllerId = otherPlayer(item.controllerId);
  state.processingTriggers = true;
  advanceTriggerThread(state);
}

const TRIGGER_CHOICE_ACTIONS = new Set(["select", "select_entity", "select_execute_from_trash", "choose_effect"]);

function triggerRequiresChoice(trigger) {
  if (trigger.runtimePhase) {
    const runtime = cardRuntimeSpec(trigger.source.card.id, trigger.runtimePhase);
    return runtime?.actions.some((action) => TRIGGER_CHOICE_ACTIONS.has(action.type)
      || (action.type === "access" && (action.filter || action.destination === "hand"))) ?? false;
  }
  return trigger.spec.actions.some((action) => TRIGGER_CHOICE_ACTIONS.has(action.type)
    || (action.type === "access" && (action.filter || action.destination === "hand")));
}

export function drainTriggerQueue(state) {
  drainTriggerQueueCore(state);
  settleVictoryFactsOutsideResolution(state);
  // 誘発の処理中に結果が固定された場合、宣言済みの処理が残っていなければここでゲーム終了にする。
  if (state.winner && !state.processingTriggers) finishGameIfSettled(state);
}

// 効果解決の外(誘発の処理など)で勝利条件が成立した時、誰も確定させずに止まるのを防ぐ
function settleVictoryFactsOutsideResolution(state) {
  if (state.effectDepth > 0 || state.processingTriggers || state.effectResolution || state.pending || state.prompt) return;
  if (state.winner || state.victory?.lockedOutcome || !state.victoryFacts?.length) return;
  state.effectResolution = { id: `EFFECT-${++state.effectSerial}`, kind: "trigger", source: null, playerId: null, status: "resolving" };
  finalizeEffectResolution(state);
}

function drainTriggerQueueCore(state) {
  if (state.processingTriggers || state.effectDepth > 0) return;
  if ((state.interactive || state.runtimeContext) && state.triggerQueue.length > 1 && !state.triggerThread?.status?.includes("resolving")) {
    const triggers = state.triggerQueue.splice(0);
    state.triggerThread = {
      id: `THREAD-${state.triggerSerial}`,
      status: "resolving",
      currentControllerId: state.active,
      message: "同時に誘発した効果の処理順を選択",
      items: triggers.map((trigger) => ({
        id: trigger.id,
        controllerId: trigger.source.playerId,
        cardName: trigger.source.card.name,
        eventType: trigger.event.type,
        text: trigger.source.card.text,
        summary: trigger.spec.actions.map(describeOperation).join(" → "),
        status: "pending",
        trigger
      }))
    };
    state.processingTriggers = true;
    advanceTriggerThread(state);
    return;
  }
  state.processingTriggers = true;
  while (state.triggerQueue.length) {
    const choiceOccupied = Boolean(state.pending || state.prompt);
    const triggerIndex = choiceOccupied ? state.triggerQueue.findIndex((trigger) => !triggerRequiresChoice(trigger)) : 0;
    if (triggerIndex < 0) break;
    const [trigger] = state.triggerQueue.splice(triggerIndex, 1);
    executeQueuedTrigger(state, trigger);
  }
  state.processingTriggers = false;
}

export function emitGameEvent(state, event) {
  // Inside a trigger thread, mark which queued trigger produced the event so readers can group it.
  const threadItem = state.triggerThread?.items?.find((item) => ["resolving", "awaiting-selection"].includes(item.status));
  const normalized = { id: `EV-${++state.triggerSerial}`, turnNumber: state.turnNumber,
    ...(threadItem ? { threadId: state.triggerThread.id, threadItemId: threadItem.id } : {}), ...event };
  state.events.push(normalized);
  if (state.winner) {
    if (state.events.length > 200) state.events.shift();
    return normalized;
  }
  if (normalized.type === "registry_left") {
    const controller = state.players[normalized.playerId];
    for (const source of [...controller.front, ...controller.back].filter((card) => card.id === "STD-217" && !card.faceDown)) {
      (state.independentEffects ??= []).push({ kind: "STD-217", playerId: normalized.playerId, sourceUid: source.uid, sourceName: source.name });
    }
  }
  if (normalized.type !== "user_ability_feedback") syncMonoColorFeedback(state);
  if (state.events.length > 200) state.events.shift();
  const windows = collectTriggers(state, normalized);
  state.triggerQueue.push(...windows.filter((window) => !window.optional));
  for (const window of windows.filter((item) => item.optional)) queueDeclaredScriptActivationWindow(state, window);
  if (state.effectDepth === 0) drainTriggerQueue(state);
  // 効果解決の外で積まれた独立効果(STD-217等)はここで流さないと残り続けて盤面が止まる
  if (state.effectDepth === 0 && state.independentEffects?.length && !state.winner) drainIndependentEffects(state);
  return normalized;
}

const USER_ABILITY_FEEDBACK_KEYS = new Set([
  "turbo", "mono_color", "registry_liberty", "recovery_boot", "dimension_innovation",
  "do_or_isnt", "trash_never_empty", "kickass", "watching_you"
]);

const PRESENTATION_STEP_KINDS = new Set(["value_change", "measurement", "transfer", "multiply", "state_change"]);

const PRESENTATION_ZONES = new Set(["hand", "deck", "trash", "ban", "registry"]);

const PRESENTATION_METRICS = new Set(["str", "memory", "memory_limit", "atk", "effective_cost", "damage"]);

function validPresentationTarget(state, target) {
  if (!target || !state.players[target.playerId]) return false;
  if (target.kind === "zone_count") return PRESENTATION_ZONES.has(target.zone);
  if (target.kind === "player_stat") return PRESENTATION_METRICS.has(target.metric);
  if (target.kind === "card_stat") {
    if (!["atk", "effective_cost"].includes(target.metric) || typeof target.cardUid !== "string") return false;
    const found = findCard(state, target.cardUid);
    const viewer = state.viewerId ?? "player";
    return Boolean(found && found.playerId === target.playerId && (!found.card.faceDown || found.playerId === viewer)
      && (["front", "back", "registry", "trash"].includes(found.zoneName) || found.zoneName === "hand" && found.playerId === viewer));
  }
  return target.kind === "status" && typeof target.status === "string";
}

function validPresentationStep(state, step) {
  if (!step || !PRESENTATION_STEP_KINDS.has(step.kind)) return false;
  if (step.kind === "transfer") return validPresentationTarget(state, step.from) && validPresentationTarget(state, step.to) && Number.isFinite(step.count) && step.count >= 0;
  if (step.kind === "multiply") return validPresentationTarget(state, step.target) && Number.isFinite(step.before) && Number.isFinite(step.factor) && Number.isFinite(step.after);
  if (step.kind === "state_change") return validPresentationTarget(state, step.target) && typeof step.before === "boolean" && typeof step.after === "boolean";
  return validPresentationTarget(state, step.target) && Number.isFinite(step.before) && Number.isFinite(step.after);
}

export function emitUserAbilityFeedback(state, abilityKey, ownerPlayerId, affectedPlayerId, fields = {}) {
  if (!USER_ABILITY_FEEDBACK_KEYS.has(abilityKey) || !state.players[ownerPlayerId] || !state.players[affectedPlayerId]) return null;
  const steps = fields.steps ?? [];
  if (!steps.length || steps.some((step) => !validPresentationStep(state, step))) return null;
  return emitGameEvent(state, {
    type: "user_ability_feedback",
    abilityKey,
    ownerPlayerId,
    affectedPlayerId,
    branch: fields.branch ?? "resolved",
    ...(Number.isFinite(fields.before) ? { before: fields.before } : {}),
    ...(Number.isFinite(fields.after) ? { after: fields.after } : {}),
    ...(Number.isFinite(fields.amount) ? { amount: fields.amount } : {}),
    ...(Number.isFinite(fields.strBefore) ? { strBefore: fields.strBefore } : {}),
    ...(Number.isFinite(fields.strAfter) ? { strAfter: fields.strAfter } : {}),
    ...(Number.isFinite(fields.memoryBefore) ? { memoryBefore: fields.memoryBefore } : {}),
    ...(Number.isFinite(fields.memoryAfter) ? { memoryAfter: fields.memoryAfter } : {}),
    ...(typeof fields.anchorCardUid === "string" ? { anchorCardUid: fields.anchorCardUid } : {}),
    steps: steps.map((step) => structuredClone(step)),
    outcome: fields.outcome ?? null
  });
}

function syncMonoColorFeedback(state) {
  const feedbackState = (state.userAbilityFeedbackState ??= {});
  for (const [playerId, player] of Object.entries(state.players)) {
    if (player.user.abilityKey !== "mono_color") continue;
    const active = enabledSymbols(player).length === 1
      && [...player.front, ...player.back].some(isObCard);
    const key = `${playerId}:mono_color`;
    const previous = Boolean(feedbackState[key]);
    feedbackState[key] = active;
    if (active && !previous) emitUserAbilityFeedback(state, "mono_color", playerId, playerId, { branch: "enabled", amount: 1, steps: [{ kind: "state_change", target: { kind: "status", playerId, status: "mono_color" }, before: false, after: true }] });
  }
}
