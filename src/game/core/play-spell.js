import { cardRuntimeSpec } from "../card-runtime-specs.js";
import { layeredSpecFor } from "../layered-specs.js";
import { createSelectionRequest, createSelectionSpec, selectionRequestFromSpec } from "../selection-model.js";
import { continueStd211DestructionBatch } from "../../cards/std/std_211_effects.js";
import { hasKeyword } from "./keywords.js";
import { getActivatableEffects, getEffectActivationTargets, getEffectTargets } from "./play-effects.js";
import { notifyCardExecuted } from "./play-notify.js";
import { canExecuteRegistryCard } from "./play-registry.js";
import { canExecuteAtSlot, canPlayCard, enabledSymbols } from "./play.js";
import { addLog, findCard, isArmsBandOb, otherPlayer, provisional } from "./shared.js";
import { drainTriggerQueue } from "./triggers.js";
import { CUSTOM_NORMAL_SPELL_SELECTION, CUSTOM_RESOLVE_LOGIN, CUSTOM_RESOLVE_LOGIN_2, CUSTOM_RESOLVE_SPELL, PASS } from "../effects/custom/index.js";
import { executeCardRuntimeSpec } from "../effects/generic/actions.js";
import { ownLayerEntries } from "../effects/generic/cost.js";
import { emitCardPlacement, placementResult } from "../effects/generic/placement.js";
import { matchesModuleFilter, moveRemainderToDeck, takeViewedFromDeck } from "../effects/generic/selection-modules.js";
import { moveCardToTrash } from "../effects/generic/trash.js";

export function spellNeedsTarget(card) {
  return ["STD-011", "STD-014", "STD-015", "STD-032", "STD-033", "STD-086", "STD-104", "STD-111", "STD-138", "STD-202", "STD-203", "STD-209", "SZTB-096"].includes(card.id);
}

// These are the existing normal input rules, shared by draft and submit.
// The class catalog is public and never depends on either hidden deck.
export function normalSpellSelection(state, playerId, card) {
  if (card.category !== "Sp") return null;
  const customNormalSpellSelection = CUSTOM_NORMAL_SPELL_SELECTION[card.id];
  if (customNormalSpellSelection) {
    const customResult = customNormalSpellSelection({ state, playerId });
    if (customResult !== PASS) return customResult;
  }
  const candidates = spellNeedsTarget(card) ? getEffectTargets(state, card.id === "STD-111" ? playerId : otherPlayer(playerId), card) : [];
  const count = spellNeedsTarget(card) && !(card.id === "STD-015" && candidates.length === 0) ? 1 : 0;
  return { candidates, minimum: count, maximum: count, scopes: [], groups: [] };
}

export function normalExecutionCheck(state, playerId, card, options = {}, registry = false) {
  if (card.dragFree || card.category === "Plugin") return { ok: false, code: card.category === "Plugin" ? "PLUGIN_INSTALL_ONLY" : "EXECUTION_FORBIDDEN" };
  if (registry) return canExecuteRegistryCard(state, playerId, card, options);
  if (layeredSpecFor(card)) return {ok:false,code:"LAYERED_ONLY"};
  const amount = Number(String(card.text ?? "").match(/\[弾倉[:：]\s*(\d+)\]/)?.[1] ?? 0);
  const normal = { ...options, executionCostReduction: amount > 0 && ownLayerEntries(state.players[playerId]).length >= amount ? amount : 0 };
  return card.category === "Script" || options.asScript ? canExecuteAtSlot(state, playerId, card, normal) : canPlayCard(state, playerId, card, normal);
}

export function normalCardEffectSelection(state, playerId, card, effectId, targetUids = []) {
  const effect = getActivatableEffects(state, playerId, card).find(item => item.id === effectId && item.enabled);
  if (!effect || card.faceDown || effect.kind === "proxy" && state.mode !== "lab" && card.color && !enabledSymbols(state.players[playerId]).includes(card.color)) return null;
  const candidates = getEffectActivationTargets(state, playerId, card, effectId);
  const count = card.id === "STD-196" ? 2 : candidates.length || ["STD-192", "STD-157", "STD-049", "STD-169"].includes(card.id) ? 1 : 0;
  const moveUid = card.id === "STD-200" ? card.uid : card.id === "STD-192" ? targetUids[0] : null;
  const moving = moveUid ? findCard(state, moveUid) : null;
  const zones = moving ? [moving.zoneName === "front" ? "back" : "front"].filter(zone => placementResult(state.players[playerId], zone).ok) : [];
  return { effect, candidates, minimum: count, maximum: count, needsZone: ["STD-192", "STD-200"].includes(card.id), zones };
}

export function finalizeDeferredSpellCleanup(state, { replacementHostUid = null } = {}) {
  const deferred = state.deferredSpellCleanup;
  if (!deferred) return false;
  const { playerId, card, zone, placementCause, placementSource } = deferred;
  const player = state.players[playerId];
  const host = replacementHostUid
    ? [...player.front, ...player.back].find((item) => item.uid === replacementHostUid && item.id === "SZTB-095" && !item.faceDown)
    : null;
  if (host) {
    card.layerRole = "layered";
    host.mounted.push(card);
    player.triggerUsage[`${host.uid}:sztb095-sp-replacement`] = true;
    addLog(state, `${host.name}: ${card.name}をゴミ箱へ送るかわりにレイヤーへ加えた。`, "effect");
  } else {
    moveCardToTrash(state, playerId, card, card.name);
  }
  state.deferredSpellCleanup = null;
  notifyCardExecuted(state, playerId, card);
  emitCardPlacement(state, playerId, card, zone, placementCause, placementSource);
  return true;
}

export function continueDeferredSpellCleanup(state) {
  const deferred = state.deferredSpellCleanup;
  if (!deferred || state.pending || state.prompt) return false;
  if (state.std211DestructionBatch) return continueStd211DestructionBatch(state);
  const { playerId, card } = deferred;
  const player = state.players[playerId];
  if (deferred.postEffect === "arms-band-jacket" && !deferred.postEffectDone) {
    deferred.postEffectDone = true;
    if ([...player.front, ...player.back].some(isArmsBandOb)) {
      const request = createSelectionRequest({
        mode: "scope", scopeField: "zone", scopeOptions: ["フロント", "バック"],
        label: `${card.name}: アームズバンド・ジャケットの配置先`,
        message: "自分エリアに名称:アームズバンドObが存在するため、ジャケットを生成し配置する。",
        continuation: { type: "sztb-jacket-place", playerId, sourceName: card.name }
      });
      state.pending = { type: "selection", validTargets: [], request };
      return true;
    }
  }
  const hosts = [...player.front, ...player.back].filter((item) => item.id === "SZTB-095" && !item.faceDown
    && !player.triggerUsage[`${item.uid}:sztb095-sp-replacement`]);
  if (hasKeyword(card, "MAGAZINE") && hosts.length) {
    const request = createSelectionRequest({
      mode: "up_to", candidates: hosts.map((item) => item.uid), count: 1, minimum: 0, maximum: 1,
      candidateLabels: Object.fromEntries(hosts.map((item) => [item.uid, item.name])),
      label: "実行したSpをレイヤーへ加える", message: "選ばず確定すると通常通りゴミ箱へ送る。各ターン1度。",
      continuation: { type: "sztb095-sp-replacement", playerId }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  return finalizeDeferredSpellCleanup(state);
}

export function resolveLogin(state, playerId, card) {
  const player = state.players[playerId];
  const opponent = state.players[otherPlayer(playerId)];
  if (cardRuntimeSpec(card.id, "login")) {
    executeCardRuntimeSpec(state, "login", playerId, card);
    return;
  }
  const customResolveLogin2 = CUSTOM_RESOLVE_LOGIN_2[card.id];
  if (customResolveLogin2) customResolveLogin2({ state, playerId, card });
  const selectionModule = card.compiled?.selectionModules?.find((module) => module.module === "look_select_remainder");
  if (selectionModule) {
    // 見ている間も山札に置いたまま(山札外に出すとランタイムのID台帳と枚数が合わなくなる)
    const viewed = player.deck.slice(Math.max(0, player.deck.length - selectionModule.lookCount));
    const eligible = viewed.filter((candidate) => matchesModuleFilter(candidate, selectionModule.selection.filter));
    if (!eligible.length) {
      moveRemainderToDeck(player, takeViewedFromDeck(player, viewed.map((viewedCard) => viewedCard.uid)), selectionModule.remainder.position);
      addLog(state, `${card.name}: 見たカードに条件適合なし。残りを山札${selectionModule.remainder.position === "bottom" ? "下" : "上"}へ。`, "effect");
      return;
    }
    const request = selectionRequestFromSpec(createSelectionSpec({ candidates: eligible.map((candidate) => candidate.uid), minimum: 1, maximum: Math.min(selectionModule.selection.maximum, eligible.length) }), {
      candidateLabels: Object.fromEntries(eligible.map((candidate) => [candidate.uid, candidate.name])), label: `見た${viewed.length}枚から選択`, message: card.text,
      continuation: { type: "selection-module-look", playerId, sourceName: card.name, module: selectionModule, viewedUids: viewed.map((viewedCard) => viewedCard.uid) }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return;
  }
  const loginAccess = card.compiled?.operations?.find((operation) => operation.type === "access") && /レジストリにインストール/.test(card.text);
  if (loginAccess && player.deck.length) {
    const request = selectionRequestFromSpec(createSelectionSpec({ candidates: player.deck.map((candidate) => candidate.uid), minimum: 1, maximum: 1 }), {
      candidateLabels: Object.fromEntries(player.deck.map((candidate) => [candidate.uid, candidate.name])), label: "アクセスしてレジストリへインストール", message: card.text,
      continuation: { type: "selection-module-access-move", playerId, sourceName: card.name, source: "deck", destination: "registry", shuffleRemaining: true }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return;
  }
  const customResolveLogin = CUSTOM_RESOLVE_LOGIN[card.id];
  if (customResolveLogin) customResolveLogin({ player, card, playerId, state, opponent });
  if (hasKeyword(card, "LAYERED")) provisional(state, `${card.name}のレイヤード条件・軽減は簡易処理。`, card);
  if (card.compiled?.status && card.compiled.status !== "supported") provisional(state, `${card.name}: 効果解析 ${card.compiled.status}`, card);
}

export function resolveSpell(state, playerId, card, targetUid, { targetUids = [], selectionScope = null } = {}) {
  const opponentId = otherPlayer(playerId);
  const opponent = state.players[opponentId];
  const player = state.players[playerId];
  if (executeCardRuntimeSpec(state, "spell", playerId, card, { targetUid })) return;
  const customResolveSpell = CUSTOM_RESOLVE_SPELL[card.id];
  if (customResolveSpell) {
    const customResult = customResolveSpell({ player, state, playerId, card, targetUids, targetUid, opponentId, selectionScope });
    if (customResult !== PASS) return customResult;
  }
}

export function resolveLogout(state, playerId, card) {
  if (executeCardRuntimeSpec(state, "logout", playerId, card)) return;
}

export function resolveLogoutAfterAreaExit(state, playerId, card) {
  const hasLogout = hasKeyword(card, "LOGOUT") || /(?:\[|［)ログアウト(?:\]|］)/.test(String(card.text ?? ""));
  if (!hasLogout) return false;
  state.triggerQueue.push({
    id: `AUTO-${++state.triggerSerial}`,
    source: { playerId, zoneName: "trash", card },
    event: { type: "logout", playerId, ownerId: card.owner ?? playerId, cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category },
    spec: { id: `${card.id}:logout`, actions: [] },
    runtimePhase: "logout"
  });
  if (state.effectDepth === 0) drainTriggerQueue(state);
  return true;
}
