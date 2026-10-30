import { matchesCardCategory } from "../../card-types.js";
import { createSelectionSpec, selectionRequestFromSpec } from "../../selection-model.js";
import { hasClass, otherPlayer } from "../../core/shared.js";

export function matchesModuleFilter(card, filter = {}) {
  if (filter.color && card.color !== filter.color) return false;
  if (filter.category && !matchesCardCategory(card, filter.category)) return false;
  if (filter.excludeCategory && matchesCardCategory(card, filter.excludeCategory)) return false;
  if (filter.className && !hasClass(card, filter.className)) return false;
  if (filter.originalMemoryMaximum !== undefined && Number(card.cost ?? Infinity) > filter.originalMemoryMaximum) return false;
  return true;
}

export function takeViewedFromDeck(player, uids) {
  const viewed = uids.map((uid) => player.deck.find((card) => card.uid === uid)).filter(Boolean);
  for (let index = player.deck.length - 1; index >= 0; index -= 1) {
    if (uids.includes(player.deck[index].uid)) player.deck.splice(index, 1);
  }
  return viewed;
}

export function moveRemainderToDeck(player, cards, position) {
  if (position === "bottom") player.deck.unshift(...cards);
  else player.deck.push(...cards);
}

export function beginDynamicSelectionModule(state, playerId, card, continuation = {}) {
  const module = card.compiled.selectionModules?.find((entry) => entry.module === "dynamic_threshold_selection");
  if (!module) return false;
  const player = state.players[playerId];
  const valueFrom = module.selection.filter.originalMemoryMaximumFrom;
  const maximum = valueFrom === "self_registry_count" ? player.registry.length : 0;
  const zone = player[module.selection.source] ?? [];
  const candidates = zone.filter((candidate) => Number(candidate.cost ?? Infinity) <= maximum && matchesModuleFilter(candidate, module.selection.filter));
  if (!candidates.length) return false;
  const request = selectionRequestFromSpec(createSelectionSpec({ candidates: candidates.map((candidate) => candidate.uid), minimum: 1, maximum: 1 }), {
    candidateLabels: Object.fromEntries(candidates.map((candidate) => [candidate.uid, `${candidate.name} / ${candidate.cost}`])), label: `X=${maximum}以下から選択`, message: card.text,
    continuation: { type: "selection-module-dynamic", playerId, sourceUid: card.uid, sourceName: card.name, module, ...continuation }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function beginAllocationSelectionModule(state, playerId, card) {
  const module = card.compiled.selectionModules?.find((entry) => entry.module === "select_allocate_follow_up");
  if (!module) return false;
  const targetPlayerId = module.selection.owner === "opponent" ? otherPlayer(playerId) : playerId;
  const targetPlayer = state.players[targetPlayerId];
  const zones = module.selection.source === "area" ? ["front", "back"] : [module.selection.source];
  const candidates = zones.flatMap((zone) => targetPlayer[zone] ?? []).filter((candidate) => matchesModuleFilter(candidate, module.selection));
  const request = selectionRequestFromSpec(createSelectionSpec({ candidates: candidates.map((candidate) => candidate.uid), minimum: 0, maximum: candidates.length }), {
    candidateLabels: Object.fromEntries(candidates.map((candidate) => [candidate.uid, candidate.name])), label: "割り振る対象を任意選択", message: card.text,
    continuation: { type: "selection-module-allocation-targets", playerId, sourceUid: card.uid, sourceName: card.name, module }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}
