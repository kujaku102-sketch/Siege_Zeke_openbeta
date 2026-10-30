import { normalizeBoardSlots } from "../board-slots.js";
import { isObCard } from "../card-types.js";
import { mandatoryStateCheckSpecsFor } from "../continuous-effect-specs.js";
import { EFFECT_OPERATION_TYPES } from "../effect-operation-library.js";
import { TRACE_TAGS, trace, traceActive } from "../engine-trace.js";
import { createSelectionRequest } from "../selection-model.js";
import { hasKeyword } from "./keywords.js";
import { continueDeferredSpellCleanup } from "./play-spell.js";
import { enqueueSelection, selectionProjectionMeta } from "./projection.js";
import { resolveDeclaredResponse, startNextQueuedResponse } from "./response.js";
import { DECLARED_IF_SCRIPT_IDS } from "./scripts.js";
import { addLog, findCard, otherPlayer } from "./shared.js";
import { cardCurrentStr, continuousEffectConditionMatches } from "./stats.js";
import { drainTriggerQueue, emitGameEvent, resumeStalledTriggerThread } from "./triggers.js";
import { CUSTOM_DRAIN_INDEPENDENT_EFFECTS, CUSTOM_RESOLVE_DECLARED_SCRIPT } from "../effects/custom/index.js";
import { executeRuntimeActions } from "../effects/generic/actions.js";
import { destroyCard } from "../effects/generic/destroy.js";
import { moveCardToTrash } from "../effects/generic/trash.js";
import { executeTriggerAction } from "../effects/generic/trigger-actions.js";

export function resolveEffect(state, resolver) {
  const ownsResolution = !state.effectResolution;
  if (ownsResolution) state.effectResolution = {
    id: `EFFECT-${++state.effectSerial}`, kind: "runtime", source: null,
    playerId: null, status: "resolving"
  };
  const pendingBefore = state.pending, promptBefore = state.prompt;
  state.effectDepth += 1;
  try {
    return resolver();
  } finally {
    state.effectDepth -= 1;
    if (state.effectDepth === 0) {
      continueDeferredSpellCleanup(state);
      resolveMandatoryStateChecks(state);
      if (traceActive()) traceChoiceDiff(state, pendingBefore, promptBefore);
      // A pending/prompt is an internal choice only when it was opened by this
      // resolution. Queued triggers are intentionally *not* a completion gate.
      if (state.pending || state.prompt) {
        if (state.effectResolution) state.effectResolution.status = "awaiting-choice";
      } else if (state.effectResolution) {
        finalizeEffectResolution(state);
      }
      if (!state.winner) drainIndependentEffects(state);
      if (!state.winner && !state.effectResolution) resumeStalledTriggerThread(state);
      if (!state.winner && !parentEffectAwaitsOwnChoice(state)) drainTriggerQueue(state);
    }
  }
}

// 4.7.1: 親効果が自分の本文の選択待ちで止まっている間は、破壊・移動・ログアウトなどの自動誘発を流さない。
// 親効果が最後まで終わった時(awaiting-choice でなくなった時)に、resolveEffect の最後から流れる。
// 誘発・確認窓が積んだ選択(resolutionMeta を持つ engine:* の選択)は親効果の本文ではないので、待機の理由にしない。
function parentEffectAwaitsOwnChoice(state) {
  if (state.effectResolution?.status !== "awaiting-choice") return false;
  const open = state.pending ?? state.prompt;
  return Boolean(open) && !open.resolutionMeta;
}

// 選択: what the resolution left open (or closed) compared with what was open when it began.
function traceChoiceDiff(state, pendingBefore, promptBefore) {
  for (const [kind, before, after] of [["pending", pendingBefore, state.pending], ["prompt", promptBefore, state.prompt]]) {
    if (before === after) continue;
    const request = after?.request;
    trace(state, {
      tag: TRACE_TAGS.SELECT, op: EFFECT_OPERATION_TYPES.SELECT, event: !after ? "closed" : before ? "replaced" : "opened", slot: kind,
      type: after?.type ?? before?.type ?? null, mode: request?.mode ?? null, label: request?.label ?? null,
      candidates: request?.candidates?.length ?? after?.validTargets?.length ?? null,
      chooserId: request?.continuation?.playerId ?? after?.playerId ?? null, continuation: request?.continuation?.type ?? null
    });
  }
}

export function recordVictoryFact(state, fact) {
  (state.victoryFacts ??= []).push({ ...fact, effectId: state.effectResolution?.id ?? null });
}

export function runEffectEntry(state, kind, playerId, resolver) {
  if (state.opening) return false;
  const continuingDeclaredEffect = Boolean(
    state.winner
    && state.effectResolution?.declaredEffectId
    && ["selection", "prompt-decline"].includes(kind)
  );
  if (state.winner && kind !== "declared-effect" && !continuingDeclaredEffect) return false;
  if (!state.effectResolution) {
    state.effectResolution = { id: `EFFECT-${++state.effectSerial}`, kind, source: null, playerId, status: "resolving" };
  } else {
    state.effectResolution.status = "resolving";
  }
  trace(state, { tag: TRACE_TAGS.LAUNCH, via: "entry", kind, playerId });
  normalizeBoardSlots(state);
  try {
    return resolveEffect(state, resolver);
  } finally {
    normalizeBoardSlots(state);
  }
}

export function drainIndependentEffects(state) {
  if (state.effectResolution || state.pending || state.prompt || state.drainingIndependentEffects) return;
  const next = state.independentEffects?.shift();
  if (!next) return;
  state.drainingIndependentEffects = true;
  try {
    const customDrainIndependentEffects = CUSTOM_DRAIN_INDEPENDENT_EFFECTS[next.kind];
    if (customDrainIndependentEffects) customDrainIndependentEffects({ state, next });
  } finally {
    state.drainingIndependentEffects = false;
  }
  if (!state.winner) drainIndependentEffects(state);
}

// 効果1つの処理が完了した境界で、勝敗が決まっていれば結果を固定する(最初に成立した境界で固定)。
// 同時に誘発した効果は別々の効果なので、それぞれの完了ごとにここを通す。
export function lockVictoryIfDecided(state) {
  if (state.victory?.lockedOutcome) return false;
  const candidates = new Set();
  for (const [playerId, player] of Object.entries(state.players)) {
    if (Number(player.fortressStr) <= 0 || player.userBanned || player.mandatoryDrawFailed) candidates.add(otherPlayer(playerId));
  }
  for (const fact of state.victoryFacts ?? []) if (fact.type === "special" && fact.playerId) candidates.add(fact.playerId);
  if (candidates.size > 1) state.winner = "draw";
  else if (candidates.size === 1) state.winner = [...candidates][0];
  if (!state.winner) return false;
  state.victory = {
    lockedOutcome: state.winner,
    lockedAtEffectId: state.effectResolution?.id ?? null,
    finished: false
  };
  if (traceActive() && (state.triggerQueue.length || state.activationWindows.length)) {
    trace(state, { tag: TRACE_TAGS.TRIGGER, event: "discarded-on-lock", queued: state.triggerQueue.map((trigger) => trigger.id), windows: state.activationWindows.length });
  }
  state.pending = null; state.prompt = null; state.triggerQueue = [];
  state.scriptActivationQueue = []; state.activationWindows = [];
  state.selectionQueue = []; state.deferredAttack = null;
  state.responseEventQueue = []; state.mandatoryDrawContinuation = null;
  addLog(state, state.winner === "draw" ? "両ユーザーが勝利条件を満たしたため引き分け。" : `${state.players[state.winner].user.name}の勝利。`, "win");
  return true;
}

export function finalizeEffectResolution(state) {
  const completedResolution = state.effectResolution;
  trace(state, { tag: TRACE_TAGS.JUDGE, phase: "in", kind: completedResolution?.kind ?? null });
  const lockedBefore = Boolean(state.victory?.lockedOutcome);
  lockVictoryIfDecided(state);
  trace(state, { tag: TRACE_TAGS.JUDGE, phase: "out", kind: completedResolution?.kind ?? null,
    locked: Boolean(state.victory?.lockedOutcome), lockedNow: Boolean(state.victory?.lockedOutcome) && !lockedBefore, winner: state.winner ?? null });
  if (completedResolution?.declaredEffectId && state.resolvingDeclaredEffect?.id === completedResolution.declaredEffectId) {
    state.resolvingDeclaredEffect.status = "resolved";
    state.resolvingDeclaredEffect = null;
  }
  state.victoryFacts = [];
  state.effectResolution = null;
  if (!drainDeclaredEffects(state)) finishGameIfSettled(state);
}

export function finishGameIfSettled(state) {
  if (!state?.winner) return false;
  const victory = state.victory ??= { lockedOutcome: state.winner, lockedAtEffectId: null, finished: false };
  if (!victory.lockedOutcome) victory.lockedOutcome = state.winner;
  const declaredWork = Boolean(
    state.effectResolution
    || state.resolvingDeclaredEffect
    || state.declaredEffects?.length
    || state.placementCostBatch
    || state.pending?.resolutionMeta
    || state.prompt?.resolutionMeta
    || state.triggerThread?.items?.some((item) => ["resolving", "awaiting-selection"].includes(item.status))
  );
  if (declaredWork || victory.finished) return false;
  victory.finished = true;
  return true;
}

export function declareEffect(state, effect) {
  state.declarationSerial = Number.isSafeInteger(state.declarationSerial) && state.declarationSerial >= 0
    ? state.declarationSerial + 1
    : 1;
  const declared = {
    id: `DECLARED-${state.declarationSerial}`,
    declaredAtEffectId: state.effectResolution?.id ?? null,
    status: "declared",
    ...effect
  };
  (state.declaredEffects ??= []).push(declared);
  return declared;
}

function finishDeclaredScriptCleanup(state) {
  const deferred = state.deferredDeclaredScriptCleanup;
  if (!deferred) return false;
  const { declared, source } = deferred;
  const player = state.players[declared.playerId];
  const live = findCard(state, declared.sourceUid);
  const resident = hasKeyword(source, "RESIDENT");
  if (live) delete live.card.declaredEffectId;
  if (resident && live && live.playerId === declared.playerId && live.zoneName === "back") {
    live.card.residentActive = true;
    addLog(state, `${source.name}を起動。[レジデント]として場に残る。`, "action");
  } else if (!resident && live && live.playerId === declared.playerId && ["front", "back"].includes(live.zoneName)) {
    state.players[live.playerId][live.zoneName].splice(state.players[live.playerId][live.zoneName].findIndex((card) => card.uid === live.card.uid), 1);
    moveCardToTrash(state, declared.playerId, live.card, source.name);
    addLog(state, `${source.name}の宣言済み効果を解決し、ゴミ箱へ。`, "action");
  }
  emitGameEvent(state, {
    type: "script_activated", playerId: declared.playerId, ownerId: source.owner ?? declared.playerId,
    cardUid: source.uid, cardId: source.id, cardName: source.name, category: source.category,
    declaredEffectId: declared.id
  });
  player.scriptActivatedTurn = state.turnNumber;
  for (const candidate of player.hand.filter((card) => card.id === "STD-179")) {
    const request = createSelectionRequest({ mode: "scope", scopeField: "place", scopeOptions: ["配置しない", "配置する"],
      label: `${candidate.name}: 手札から配置`, message: candidate.text,
      continuation: { type: "std179-place", playerId: declared.playerId, sourceUid: candidate.uid, sourceName: candidate.name } });
    enqueueSelection(state, { type: "selection", validTargets: [], request }, selectionProjectionMeta("engine:std179-place", declared.playerId));
  }
  state.deferredDeclaredScriptCleanup = null;
  return true;
}

export function continueDeferredDeclaredScriptCleanup(state) {
  if (!state.deferredDeclaredScriptCleanup || state.pending || state.prompt || state.deferredTrashMoves?.length || state.deferredDestruction || state.deferredAttack) return false;
  return finishDeclaredScriptCleanup(state);
}

function resolveDeclaredScript(state, declared) {
  const source = declared.sourceSnapshot;
  state.deferredDeclaredScriptCleanup = { declared, source };
  const customResolveDeclaredScript = CUSTOM_RESOLVE_DECLARED_SCRIPT[declared.cardId];
  if (customResolveDeclaredScript) customResolveDeclaredScript({ state, declared, source });
  else if (declared.runtime) {
    executeRuntimeActions(state, declared.playerId, source, declared.runtime.actions, {
      targetUid: declared.eventTargetUid,
      runtime: { records: { eventCardUids: [...declared.eventCardUids] } }
    });
  } else {
    const trigger = {
      id: declared.id,
      source: { playerId: declared.playerId, zoneName: "back", card: source },
      event: declared.eventContext?.raw ?? declared.eventContext ?? {},
      spec: { actions: declared.actions }
    };
    for (const action of declared.actions) executeTriggerAction(state, trigger, action);
  }
  if (!state.pending && !state.prompt) continueDeferredDeclaredScriptCleanup(state);
  return true;
}

function drainDeclaredEffects(state) {
  if (state.effectResolution || state.pending || state.prompt || state.resolvingDeclaredEffect) return false;
  const declared = state.declaredEffects?.at(-1);
  if (!declared) return !state.winner && startNextQueuedResponse(state);
  const supported = declared.kind === "response" || (declared.kind === "script" && DECLARED_IF_SCRIPT_IDS.has(declared.cardId));
  if (!supported) {
    addLog(state, `未対応の宣言済み効果 ${declared.kind}:${declared.cardId ?? "unknown"} は保持した。`, "system");
    return false;
  }
  state.declaredEffects.pop();
  declared.status = "resolving";
  state.resolvingDeclaredEffect = declared;
  runEffectEntry(state, "declared-effect", declared.playerId, () => {
    state.effectResolution.declaredEffectId = declared.id;
    if (declared.kind === "script") resolveDeclaredScript(state, declared);
    else if (declared.kind === "response") resolveDeclaredResponse(state, declared);
  });
  return true;
}

const MANDATORY_STATE_CHECK_PASSES = 8;

export function resolveMandatoryStateChecks(state) {
  // 確認(STD-003の窓など)の回答待ち・保留中の破壊がある間は判定しない。破壊が窓の後ろで保留されているカードを
  // もう一度破壊しようとすると、回答のたびに新しい窓が開いて確認が終わらなくなる。回答後の次の解決で判定する。
  if (state.prompt || state.deferredDestruction || state.scriptActivationQueue?.length) return;
  // 状態判定は安定するまで繰り返す(破壊した常在効果の源が消えて、別のObがSTR0以下になる場合がある)。
  // STR0以下の破壊は常時の状態判定なので[プロテクト]も[バックアップ]も貫通する(裁定済み)。
  // 破壊不可で破壊が成立しない場合や選択待ち・STD-003の窓が開いた場合は進展なしとして止める。
  for (let pass = 0; pass < MANDATORY_STATE_CHECK_PASSES; pass += 1) {
    let progressed = false;
    // 戦闘以外(負荷やSTR-補正)でSTRが0以下になったObも、効果解決の終わりにルールで破壊する
    for (const [playerId, player] of Object.entries(state.players)) {
      for (const card of [...player.front, ...player.back]) {
        if (isObCard(card) && !card.faceDown && cardCurrentStr(state, playerId, card) <= 0) {
          if (destroyCard(state, playerId, card.uid, { source: "STR0以下の状態判定", piercing: true })) progressed = true;
        }
      }
    }
    for (const [playerId, player] of Object.entries(state.players)) {
      for (const card of [...player.front, ...player.back]) {
        for (const spec of mandatoryStateCheckSpecsFor(card.id)) {
          if (!continuousEffectConditionMatches(state, playerId, card, spec.condition)) continue;
          if (spec.type === "destroy" && spec.target === "source") {
            if (destroyCard(state, playerId, card.uid, {
              source: `${card.name}の強制状態判定`,
              suppressReplacement: Boolean(spec.suppressReplacement)
            })) progressed = true;
            break;
          }
          throw new Error(`Unsupported mandatory state check: ${spec.type ?? "(missing)"}`);
        }
      }
    }
    if (!progressed || state.pending || state.prompt || state.deferredDestruction) return;
  }
}
