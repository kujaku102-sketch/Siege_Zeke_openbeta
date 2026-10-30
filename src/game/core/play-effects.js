import { normalizeBoardSlots } from "../board-slots.js";
import { cardRuntimeSpec } from "../card-runtime-specs.js";
import { isObCard } from "../card-types.js";
import { resolveEffect } from "./effects.js";
import { hasKeyword } from "./keywords.js";
import { enabledSymbols } from "./play.js";
import { fail, findCard, newActionBlock, payMemory } from "./shared.js";
import { CUSTOM_ACTIVATE_CARD_EFFECT_CORE, CUSTOM_GET_EFFECT_ACTIVATION_TARGETS, CUSTOM_GET_EFFECT_ACTIVATION_TARGETS_2, CUSTOM_GET_EFFECT_TARGETS, PASS } from "../effects/custom/index.js";
import { runtimeActionFeasible } from "../effects/generic/action-values.js";
import { executeRuntimeActions } from "../effects/generic/actions.js";

export function getEffectTargets(state, targetPlayerId, sourceCard) {
  const player = state.players[targetPlayerId];
  const zones = sourceCard.text?.includes("フロント") ? ["front"] : ["front", "back"];
  let cards = zones.flatMap((zoneName) => player[zoneName]);
  const targetsOpponent = Boolean(sourceCard.owner && sourceCard.owner !== targetPlayerId);
  if (targetsOpponent) {
    cards = cards.filter((card) => !hasKeyword(card, "FIREWALL"));
    const decoys = cards.filter((card) => hasKeyword(card, "DECOY"));
    if (decoys.length && !hasKeyword(sourceCard, "HACKING")) cards = decoys;
  }
  const customGetEffectTargets = CUSTOM_GET_EFFECT_TARGETS[sourceCard.id];
  if (customGetEffectTargets) {
    const customResult = customGetEffectTargets({ cards, targetPlayerId, player });
    if (customResult !== PASS) return customResult;
  }
  return ["STD-033", "STD-209"].includes(sourceCard.id) ? cards : cards.filter(isObCard);
}

export function getActivatableEffects(state, playerId, card) {
  const location = findCard(state, card.uid);
  if (!location || location.playerId !== playerId || !["hand", "front", "back"].includes(location.zoneName)) return [];
  return card.compiled.keywords
    .filter((keyword) => ["UPDATE", "PROXY"].includes(keyword.name))
    .filter((keyword) => keyword.name !== "PROXY" || ["STD-048", "STD-049", "STD-106", "STD-124", "STD-160", "STD-169"].includes(card.id))
    .filter((keyword) => keyword.name === "PROXY" ? location.zoneName === "hand" : ["front", "back"].includes(location.zoneName))
    .map((keyword, index) => ({
      id: `${card.id}:${keyword.name.toLowerCase()}:${index}`,
      kind: keyword.name.toLowerCase(),
      label: keyword.name === "UPDATE" ? `[アップデート:${keyword.value}]` : `プロキシ:${keyword.value}(コスト)`,
      cost: Number(keyword.value ?? 0),
      text: card.text,
      enabled: state.active === playerId
        && state.players[playerId].memory >= Number(keyword.value ?? 0)
        && (!cardRuntimeSpec(card.id, "update")?.requiresResidentActive || card.residentActive === true)
        && (keyword.name !== "UPDATE" || updateDecodeFeasible(state, playerId, card))
    }));
}

// デコード先(ゴミ箱の候補)が無いアップデートは起動可能として出さない
export function updateDecodeFeasible(state, playerId, card) {
  const updateRuntime = cardRuntimeSpec(card.id, "update");
  if (!updateRuntime) return true;
  const runtime = { records: Object.create(null) };
  return updateRuntime.actions.filter((action) => action.type === "decode")
    .every((action) => runtimeActionFeasible(state, playerId, card, action, runtime));
}

export function getEffectActivationTargets(state, playerId, card, effectId) {
  const customGetEffectActivationTargets = CUSTOM_GET_EFFECT_ACTIVATION_TARGETS[card.id];
  if (customGetEffectActivationTargets) {
    const customResult = customGetEffectActivationTargets({ state, playerId, effectId, card });
    if (customResult !== PASS) return customResult;
  }
  if (!effectId?.startsWith(`${card.id}:update:`)) return [];
  const player = state.players[playerId];
  const customGetEffectActivationTargets2 = CUSTOM_GET_EFFECT_ACTIVATION_TARGETS_2[card.id];
  if (customGetEffectActivationTargets2) {
    const customResult = customGetEffectActivationTargets2({ player, card });
    if (customResult !== PASS) return customResult;
  }
  return [];
}

export function activateCardEffectCore(state, playerId, cardUid, effectId, { targetUid = null, targetZone = null, targetUids = [] } = {}) {
  const location = findCard(state, cardUid);
  if (!location || location.playerId !== playerId || !["hand", "front", "back"].includes(location.zoneName)) return fail(state, "効果を起動するカードが使用可能な領域にない。", false);
  const card = location.card;
  const effect = getActivatableEffects(state, playerId, card).find((item) => item.id === effectId);
  if (!effect || !effect.enabled) return fail(state, "その効果は現在起動できない。", false);
  const player = state.players[playerId];

  if (effect.kind === "proxy") {
    if (location.zoneName !== "hand") return fail(state, "[プロキシ]は手札から起動する。", false);
    if (player.memory < effect.cost) return fail(state, "メモリ不足。", false);
    if (state.mode !== "lab" && card.color && !enabledSymbols(player).includes(card.color)) return fail(state, `${card.color}シンボルがない。`, false);
  }

  const updateRuntime = effect.kind === "update" ? cardRuntimeSpec(card.id, "update") : null;
  if (updateRuntime) {
    const runtime = { records: Object.assign(Object.create(null), {
      activation_target_uid: targetUid,
      activation_target_uids: targetUids,
      activation_target_zone: targetZone
    }) };
    if (!updateRuntime.actions.every((action) => runtimeActionFeasible(state, playerId, card, action, runtime))) {
      return fail(state, "効果を実行できる対象がない。", false);
    }
    payMemory(state, playerId, effect.cost, "update");
    return executeRuntimeActions(state, playerId, card, updateRuntime.actions, { runtime });
  }

  const customActivateCardEffectCore = CUSTOM_ACTIVATE_CARD_EFFECT_CORE[card.id];
  if (customActivateCardEffectCore) {
    const customResult = customActivateCardEffectCore({ player, effect, card, playerId, state, targetUid, location, effectId });
    if (customResult !== PASS) return customResult;
  }

  return fail(state, `${effect.label}は解析済みだが専用処理が未登録。`, false);
}

export function activateCardEffect(state, playerId, cardUid, effectId, options = {}) {
  { const blocked = newActionBlock(state); if (blocked) return fail(state, blocked, false); }
  normalizeBoardSlots(state);
  return resolveEffect(state, () => activateCardEffectCore(state, playerId, cardUid, effectId, options));
}
