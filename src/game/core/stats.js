import { hasKeyword } from "../../../packages/effect-compiler/index.js";
import { battleStatModifierSpecsFor } from "../card-runtime-specs.js";
import { isObCard } from "../card-types.js";
import { auraKeywordSpecsFor, conditionalKeywordSpecsFor, continuousStatModifierSpecsFor, mountedKeywordSpecsFor, mountedStatModifierSpecsFor } from "../continuous-effect-specs.js";
import { enabledSymbols } from "./play.js";
import { activeCards, hasClass } from "./shared.js";
import { runtimeSpecValue } from "../effects/generic/action-values.js";

export function battleStatModifierValue(state, playerId, source, stat) {
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

export function continuousStatModifierValue(state, playerId, source, stat) {
  return continuousStatModifierSpecsFor(source.id)
    .filter((item) => continuousEffectConditionMatches(state, playerId, source, item.condition))
    .reduce((sum, item) => sum + Number(item[stat] ?? 0), 0);
}

export function mountedStatModifierValue(source, stat) {
  return (source.mounted ?? []).reduce((sum, provider) => sum
    + mountedStatModifierSpecsFor(provider.id).reduce((providerSum, spec) => providerSum + Number(spec[stat] ?? 0), 0), 0);
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

export function cardHasPrintedOrGrantedKeyword(card, name) {
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

export function cardHasRuntimeKeyword(state, playerId, card, name) {
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
