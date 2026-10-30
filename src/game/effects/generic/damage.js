import { isObCard, matchesCardCategory } from "../../card-types.js";
import { damageModifierSpecsFor } from "../../damage-modifier-specs.js";
import { hasClass, hasNoEffectText } from "../../core/shared.js";
import { emitUserAbilityFeedback } from "../../core/triggers.js";

function damageCardMatchesFilter(card, filter) {
  if (filter === "any") return true;
  if (!card || !filter) return false;
  if (filter.color && card.color !== filter.color) return false;
  if (filter.category && !matchesCardCategory(card, filter.category)) return false;
  if (filter.effectText === "none" && !hasNoEffectText(card)) return false;
  if (filter.classesAny && !filter.classesAny.some((className) => hasClass(card, className))) return false;
  return true;
}

function damageModifierApplies(spec, provider, providerPlayerId, event) {
  if (spec.providerScope !== "own_area") return false;
  if (spec.direction === "dealt" && event.sourcePlayerId !== providerPlayerId) return false;
  if (spec.direction === "received" && event.victimPlayerId !== providerPlayerId) return false;
  if (spec.damageKind !== "all" && spec.damageKind !== event.kind) return false;
  if (spec.destination !== "all" && spec.destination !== event.destination) return false;
  if (spec.sourceFilter === "provider") {
    if (event.sourceCard?.uid !== provider.uid) return false;
  } else if (!damageCardMatchesFilter(event.sourceCard, spec.sourceFilter)) return false;
  if (spec.targetFilter === "provider" && event.victimCard?.uid !== provider.uid) return false;
  if (spec.activeTurn !== undefined && spec.activeTurn !== event.turnNumber) return false;
  return true;
}

export function grantDamageModifier(card, modifier) {
  card.damageModifiers ??= [];
  card.damageModifiers.push({
    providerScope: "own_area",
    sourceFilter: "any",
    targetFilter: "provider",
    destination: "card",
    ...modifier
  });
}

export function clearDamageModifiers(card, duration) {
  if (!card.damageModifiers) return;
  card.damageModifiers = card.damageModifiers.filter((modifier) => modifier.duration !== duration);
}

export function applyDamageModifiers(state, sourcePlayerId, sourceCard, victimPlayerId, amount, {
  kind = "effect",
  destination = "card",
  victimCard = null
} = {}) {
  let value = Number(amount);
  const event = { sourcePlayerId, sourceCard, victimPlayerId, victimCard, kind, destination, turnNumber: state.turnNumber };
  const applicable = [];
  for (const [providerPlayerId, player] of Object.entries(state.players)) {
    for (const provider of [...player.front, ...player.back]) {
      for (const spec of [...damageModifierSpecsFor(provider.id), ...(provider.damageModifiers ?? [])]) {
        if (!damageModifierApplies(spec, provider, providerPlayerId, event)) continue;
        applicable.push(spec);
      }
    }
  }
  for (const spec of applicable.filter((item) => item.operation === "add")) value += Number(spec.amount ?? 0);
  const sourcePlayer = state.players[sourcePlayerId];
  const doOrIsntDamageDown = sourcePlayer.user.abilityKey === "do_or_isnt" && isObCard(sourceCard)
    && [...sourcePlayer.front, ...sourcePlayer.back].filter(isObCard).length >= 5;
  const beforeDoOrIsnt = value;
  if (doOrIsntDamageDown) value -= 1;
  for (const spec of applicable.filter((item) => item.operation === "cap_max")) value = Math.min(value, Number(spec.amount ?? 0));
  for (const spec of applicable.filter((item) => item.operation === "set")) value = Number(spec.amount ?? 0);
  const unsupported = applicable.find((item) => !["add", "cap_max", "set"].includes(item.operation));
  if (unsupported) throw new Error(`Unsupported damage modifier operation: ${unsupported.operation ?? "(missing)"}`);
  const finalValue = Math.max(0, value);
  if (doOrIsntDamageDown) {
    let withoutAbility = beforeDoOrIsnt;
    for (const spec of applicable.filter((item) => item.operation === "cap_max")) withoutAbility = Math.min(withoutAbility, Number(spec.amount ?? 0));
    for (const spec of applicable.filter((item) => item.operation === "set")) withoutAbility = Number(spec.amount ?? 0);
    withoutAbility = Math.max(0, withoutAbility);
    if (finalValue < withoutAbility) emitUserAbilityFeedback(state, "do_or_isnt", sourcePlayerId, victimPlayerId, {
      branch: "five-plus-damage-down", before: withoutAbility, after: finalValue, anchorCardUid: sourceCard?.uid, steps: [{ kind: "value_change", target: { kind: "player_stat", playerId: victimPlayerId, metric: "damage" }, before: withoutAbility, after: finalValue }]
    });
  }
  return finalValue;
}
