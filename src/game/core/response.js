import { keywordValue } from "../../../packages/effect-compiler/index.js";
import { isObCard } from "../card-types.js";
import { createSelectionRequest } from "../selection-model.js";
import { declareEffect, runEffectEntry } from "./effects.js";
import { enabledSymbols, resolveSpell } from "./play.js";
import { addLog, otherPlayer } from "./shared.js";
import { cardCurrentStr } from "./stats.js";
import { CUSTOM_RESOLVE_DECLARED_RESPONSE, CUSTOM_RESPONSE_CARD_APPLICABLE, PASS } from "../effects/custom/index.js";
import { moveCardToTrash } from "../effects/generic/trash.js";

const RESPONSE_RUNTIME_IDS = new Set(["STD-015", "STD-034", "STD-047", "STD-132", "STD-143", "STD-167", "STD-203", "STD-207"]);

function responseCardApplicable(state, playerId, card) {
  const opponent = state.players[otherPlayer(playerId)];
  const customResponseCardApplicable = CUSTOM_RESPONSE_CARD_APPLICABLE[card.id];
  if (customResponseCardApplicable) {
    const customResult = customResponseCardApplicable({ opponent, state, playerId });
    if (customResult !== PASS) return customResult;
  }
  return true;
}

export function declareResponse(state, playerId, cardUid, { targetUid = null, targetUids = [], responseEvent } = {}) {
  const player = state.players[playerId];
  const index = player.hand.findIndex((candidate) => candidate.uid === cardUid);
  if (index < 0) return false;
  const card = player.hand[index];
  const cost = Number(keywordValue(card, "RESPONSE") ?? -1);
  if (cost < 0 || player.memory < cost) return false;
  player.hand.splice(index, 1);
  player.memory -= cost;
  const declared = declareEffect(state, {
    kind: "response", cardId: card.id, playerId, sourceUid: card.uid,
    card, targetUid, targetUids, responseEvent
  });
  card.declaredEffectId = declared.id;
  state.pending = null;
  addLog(state, `${card.name}: レスポンス:${cost}を宣言。現在の効果完了後に解決する。`, "action");
  openResponseWindow(state, playerId, responseEvent);
  return true;
}

function finishDeclaredResponseCleanup(state) {
  const deferred = state.deferredDeclaredResponseCleanup;
  if (!deferred) return false;
  const { card, cost } = deferred;
  state.resolvingResponse = false;
  state.deferredDeclaredResponseCleanup = null;
  addLog(state, `${card.name}: レスポンス:${cost}の効果と発動元処理を完了。`, "effect");
  return true;
}

export function continueDeferredDeclaredResponseCleanup(state) {
  const deferred = state.deferredDeclaredResponseCleanup;
  if (!deferred || state.pending || state.prompt || state.deferredTrashMoves?.length || state.deferredDestruction || state.deferredAttack) return false;
  if (!deferred.cleanupStarted) {
    deferred.cleanupStarted = true;
    const destination = moveCardToTrash(state, deferred.playerId, deferred.card, deferred.card.name);
    if (destination === "deferred") return true;
    deferred.cleanupDone = true;
  } else if (!deferred.cleanupDone) {
    const owner = state.players[deferred.playerId];
    deferred.cleanupDone = [...owner.trash, ...owner.ban].some((card) => card.uid === deferred.card.uid);
    if (!deferred.cleanupDone) return false;
  }
  return finishDeclaredResponseCleanup(state);
}

export function resolveDeclaredResponse(state, declared) {
  const { playerId, card, targetUid = null, targetUids = [] } = declared;
  const cost = Number(keywordValue(card, "RESPONSE") ?? 0);
  state.resolvingResponse = true;
  state.deferredDeclaredResponseCleanup = {
    declaredEffectId: declared.id, playerId, card, cost, cleanupStarted: false, cleanupDone: false
  };
  const customResolveDeclaredResponse = CUSTOM_RESOLVE_DECLARED_RESPONSE[card.id];
  if (customResolveDeclaredResponse) customResolveDeclaredResponse({ state, playerId, targetUid, card });
  else resolveSpell(state, playerId, card, targetUid, { targetUids });
  if (!state.pending && !state.prompt) continueDeferredDeclaredResponseCleanup(state);
  return true;
}

function getResponseCandidates(state, playerId) {
  const player = state.players[playerId];
  return player.hand.filter((card) => {
    const cost = Number(keywordValue(card, "RESPONSE") ?? -1);
    return RESPONSE_RUNTIME_IDS.has(card.id) && cost >= 0 && player.memory >= cost
      && (state.mode === "lab" || !card.color || enabledSymbols(player).includes(card.color))
      && responseCardApplicable(state, playerId, card);
  });
}

export function openResponseWindow(state, playerId, event) {
  if (state.winner) return false;
  const candidates = getResponseCandidates(state, playerId);
  if (!candidates.length) return false;
  state.pending = {
    type: "response-window", playerId, event,
    candidates: candidates.map((card) => card.uid),
    candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, `${card.name} / レスポンス:${keywordValue(card, "RESPONSE")}`]))
  };
  addLog(state, `${state.players[playerId].user.name}: レスポンス受付。`, "effect");
  return true;
}

export function startNextQueuedResponse(state) {
  while (state.responseEventQueue?.length) {
    const next = state.responseEventQueue.shift();
    if (openResponseWindow(state, next.playerId, next.event)) return true;
  }
  return false;
}

export function declineResponse(state, playerId) {
  return runEffectEntry(state, "response-decline", playerId, () => {
    if (state.pending?.type !== "response-window" || state.pending.playerId !== playerId) return false;
    state.pending = null;
    return true;
  });
}

export function activateResponse(state, playerId, cardUid, targetUid = null) {
  return runEffectEntry(state, "response-declaration", playerId, () => activateResponseCore(state, playerId, cardUid, targetUid));
}

function activateResponseCore(state, playerId, cardUid, targetUid = null) {
  const pending = state.pending;
  const fromWindow = pending?.type === "response-window" && pending.playerId === playerId && pending.candidates.includes(cardUid);
  const fromTarget = pending?.type === "response-target" && pending.playerId === playerId && pending.cardUid === cardUid;
  if (!fromWindow && !fromTarget) return false;
  const player = state.players[playerId];
  const index = player.hand.findIndex((card) => card.uid === cardUid);
  if (index < 0) return false;
  const card = player.hand[index];
  const responseEvent = pending.event ?? pending.responseEvent;
  const cost = Number(keywordValue(card, "RESPONSE") ?? -1);
  if (cost < 0 || player.memory < cost || !responseCardApplicable(state, playerId, card)) return false;
  const targets = [...state.players[otherPlayer(playerId)].front, ...state.players[otherPlayer(playerId)].back].filter(isObCard);
  const responseTargets = card.id === "STD-167" ? targets.filter((target) => cardCurrentStr(state, otherPlayer(playerId), target) < Number(player.damageReceivedThisTurn ?? 0)) : targets;
  if (fromWindow && card.id === "STD-203") {
    const own = [...player.front, ...player.back].filter(isObCard).map((target) => target.uid);
    const enemy = targets.map((target) => target.uid);
    const request = createSelectionRequest({ mode: "exact", candidates: [...own, ...enemy], count: 2,
      label: "破壊する自分Obと2ダメージを与える相手Ob", message: card.text,
      groups: [
        { id: "own", label: "自分Ob", candidates: own, minimum: 1, maximum: 1 },
        { id: "enemy", label: "相手Ob", candidates: enemy, minimum: 1, maximum: 1 }
      ], continuation: { type: "activate-std203-response", playerId, cardUid, responseEvent } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (fromWindow && ["STD-015", "STD-034", "STD-167"].includes(card.id) && responseTargets.length && !targetUid) {
    state.pending = { type: "response-target", playerId, cardUid, validTargets: responseTargets.map((target) => target.uid), responseEvent: pending.event };
    return true;
  }
  if (card.id === "STD-034" && !targets.some((target) => target.uid === targetUid)) return false;
  if (card.id === "STD-015" && targetUid && !targets.some((target) => target.uid === targetUid)) return false;
  if (card.id === "STD-167" && !responseTargets.some((target) => target.uid === targetUid)) return false;
  return declareResponse(state, playerId, cardUid, { targetUid, responseEvent });
}
