// 実行の置換: 「その実行を、別のカードの実行に置き換える」共通の経路。
// 置換できるScriptはカードモジュールの `executionReplacementSpec`
// ({ trigger: "enemy_ob_executing", replaceWith: <カードID>, original: "trash" | "layer" }) で宣言する。
// 実行は「実行する時」(配置とログインの前、メモリを払う前)に止め、置換できるScriptが設置されている時だけ相手に起動の確認を出す。
// 断れば元の実行をそのまま続け、起動すれば元のカードの実行メモリを払って元のカードを `original` に従って片付け、
// 置換先のカードを実行ユーザーが元の実行先で(追加メモリなしで)実行する。
import { TRACE, tracing, waypoint } from "../engine-trace.js";
import { CARD_EXECUTION_REPLACEMENT_SPECS } from "../card-runtime-specs.js";
import { isObCard } from "../card-types.js";
import { createVengeanceCard } from "../effects/generic/generate.js";
import { executionCost } from "../effects/generic/cost.js";
import { moveCardToTrash } from "../effects/generic/trash.js";
import { addLog, otherPlayer, payMemory } from "./shared.js";
import { playCardCore } from "./play.js";
import { openScriptActivationWindow } from "./scripts.js";

// onPlaced is a function, so it cannot sit in the state; it waits here under an id the deferred execution carries.
const PENDING_CALLBACKS = new Map();
let callbackSerial = 0;

export const executionReplacementSpecFor = (script) => CARD_EXECUTION_REPLACEMENT_SPECS[script?.id] ?? null;

// Opens the replacement window for a plain Ob execution if the other user has a set Script that can replace it.
// Returns true when the execution is now waiting for the answer (nothing has been paid or moved yet).
export function openExecutionReplacementWindow(state, executorId, card, resumeOptions, onPlaced) {
  if (!isObCard(card) || state.prompt || state.deferredExecution) return false;
  const owner = state.players[otherPlayer(executorId)];
  const script = owner.back.find((item) => item.category === "Script" && item.faceDown
    && executionReplacementSpecFor(item)?.trigger === "enemy_ob_executing");
  if (!script) return false;
  const callbackId = onPlaced ? `cb-${++callbackSerial}` : null;
  if (callbackId) PENDING_CALLBACKS.set(callbackId, onPlaced);
  state.deferredExecution = { playerId: executorId, uid: card.uid, options: resumeOptions, callbackId, scriptUid: script.uid, replace: false };
  const opened = openScriptActivationWindow(state, otherPlayer(executorId), script, {
    type: "card_executing", playerId: executorId, ownerId: card.owner ?? executorId,
    cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category, color: card.color
  }, { executionReplacement: true });
  if (!opened) {
    state.deferredExecution = null;
    if (callbackId) PENDING_CALLBACKS.delete(callbackId);
    return false;
  }
  if (TRACE && tracing()) waypoint(state, "rule:execution-replacement", true, { event: "held", executorId, cardId: card.id, cardUid: card.uid, replacerId: script.id, replacerUid: script.uid });
  return true;
}

// Called when the replacing Script is activated: the window's answer is "replace".
export function markExecutionReplaced(state, script) {
  const deferred = state.deferredExecution;
  if (deferred && deferred.scriptUid === script.uid) deferred.replace = true;
}

// Called when the window has been answered (activated or declined): the waiting execution carries on once nothing else is open,
// which is when the independent-effect queue drains (core/effects.js).
export function queueDeferredExecutionResume(state) {
  const deferred = state.deferredExecution;
  if (!deferred || deferred.resumeQueued) return false;
  deferred.resumeQueued = true;
  (state.independentEffects ??= []).push({ kind: "EXECUTION-RESUME", playerId: deferred.playerId });
  return true;
}

export function resumeDeferredExecution(state) {
  const deferred = state.deferredExecution;
  if (!deferred || state.prompt || state.pending) return false;
  state.deferredExecution = null;
  const onPlaced = deferred.callbackId ? PENDING_CALLBACKS.get(deferred.callbackId) : undefined;
  if (deferred.callbackId) PENDING_CALLBACKS.delete(deferred.callbackId);
  const options = { ...deferred.options, ...(onPlaced ? { onPlaced } : {}), executionReplacementChecked: true };
  if (!deferred.replace) {
    if (TRACE && tracing()) waypoint(state, "rule:execution-replacement", false, { event: "declined", executorId: deferred.playerId, cardUid: deferred.uid, replacerUid: deferred.scriptUid });
    return playCardCore(state, deferred.playerId, deferred.uid, options);
  }
  return replaceExecution(state, deferred, options);
}

function replaceExecution(state, deferred, options) {
  const player = state.players[deferred.playerId];
  const index = player.hand.findIndex((card) => card.uid === deferred.uid);
  const script = state.players[otherPlayer(deferred.playerId)].trash.find((card) => card.uid === deferred.scriptUid)
    ?? state.players[otherPlayer(deferred.playerId)].back.find((card) => card.uid === deferred.scriptUid);
  const spec = executionReplacementSpecFor(script);
  if (index < 0 || !spec) return playCardCore(state, deferred.playerId, deferred.uid, options);
  const original = player.hand[index];
  player.hand.splice(index, 1);
  if (!options.free) payMemory(state, deferred.playerId, executionCost(original, state, deferred.playerId), "execution");
  const replacement = createVengeanceCard(state, spec.replaceWith, deferred.playerId);
  if (TRACE && tracing()) waypoint(state, "rule:execution-replacement", true, { event: "replaced", executorId: deferred.playerId, cardId: original.id, cardUid: original.uid, replacerId: script.id, replacerUid: script.uid, replacementId: replacement.id, replacementUid: replacement.uid, original: spec.original });
  addLog(state, `${script.name}: ${original.name}の実行を「${replacement.name}」の実行に置換。`, "effect");
  if (spec.original === "layer") {
    original.layerRole = "layered";
    replacement.mounted = [original];
  } else {
    moveCardToTrash(state, original.owner ?? deferred.playerId, original, script.name);
  }
  // The replacing card is executed by the user who was executing, where the original was going; its memory is the original's, already paid.
  player.hand.push(replacement);
  return playCardCore(state, deferred.playerId, replacement.uid, {
    ...options, free: true, ignoreColor: true, baseUid: null, underUid: null, ocDecision: null, magazineDecision: null, magazineLayerUids: [],
    executionReplacementChecked: true
  });
}
