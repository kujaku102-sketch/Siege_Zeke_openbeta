import { hasKeyword, keywordValue } from "../../../../packages/effect-compiler/index.js";
import { isObCard } from "../../card-types.js";
import { executionCostModifierSpecsFor, playerValueModifierSpecsFor } from "../../continuous-effect-specs.js";
import { normalizeMountedStack } from "../../layered-specs.js";
import { createSelectionRequest } from "../../selection-model.js";
import { getEffectTargets } from "../../core/play-effects.js";
import { spellNeedsTarget } from "../../core/play-spell.js";
import { canPlayCard, playCard, playCardCore } from "../../core/play.js";
import { addLog, fail, findCard, otherPlayer } from "../../core/shared.js";
import { runtimeSpecMatchesCard } from "./action-values.js";
import { destroyCard } from "./destroy.js";
import { moveCardToTrash } from "./trash.js";

export const STD121_PLACEMENT_PERMIT = Symbol("STD-121 placement cost paid");

export function getMaxMemory(player) {
  const appliedOnce = new Set();
  let modifier = 0;
  for (const provider of player.registry ?? []) {
    for (const spec of playerValueModifierSpecsFor(provider.id)) {
      if (spec.value !== "max_memory" || spec.providerZone !== "registry" || (spec.faceUp && provider.faceDown)) continue;
      if (spec.aggregation === "once" && appliedOnce.has(spec)) continue;
      modifier += Number(spec.amount ?? 0);
      if (spec.aggregation === "once") appliedOnce.add(spec);
    }
  }
  return player.baseMemory + player.permanentMemory + modifier + (player.turboActive ? 2 : 0);
}

function executionCostModifierValue(card, state, playerId) {
  const appliedOnce = new Set();
  let modifier = 0;
  for (const spec of executionCostModifierSpecsFor(card.id).filter((item) => item.target === "source")) {
    if (spec.multiplier?.expression === "own_area_distinct_name_count") {
      const player = state.players[playerId];
      const count = new Set([...player.front, ...player.back]
        .filter((item) => runtimeSpecMatchesCard(item, spec.multiplier.filter))
        .map((item) => item.name)).size;
      modifier += Number(spec.amount ?? 0) * count;
    }
  }
  for (const [providerPlayerId, providerPlayer] of Object.entries(state.players)) {
    const zones = { registry: providerPlayer.registry ?? [], area: [...providerPlayer.front, ...providerPlayer.back] };
    for (const [zone, providers] of Object.entries(zones)) {
      for (const provider of providers) {
        for (const spec of executionCostModifierSpecsFor(provider.id)) {
          if (spec.providerZone !== zone || (spec.faceUp && provider.faceDown)) continue;
          if (spec.providerOwner === "self" && providerPlayerId !== playerId) continue;
          if (spec.providerOwner === "enemy" && providerPlayerId === playerId) continue;
          if (spec.condition?.expression === "target_name_in_controller_trash"
            && !state.players[playerId].trash.some((item) => item.name === card.name)) continue;
          if (spec.aggregation === "once" && appliedOnce.has(spec)) continue;
          modifier += Number(spec.amount ?? 0);
          if (spec.aggregation === "once") appliedOnce.add(spec);
        }
      }
    }
  }
  return modifier;
}

export function executionCost(card, state = null, playerId = null) {
  if (card.revealedExecutionCost === 1) return 1;
  let modifier = Number(card.turnCostModifier ?? 0) - Number(card.costReductionThisTurn ?? 0);
  if (state && playerId) {
    modifier += executionCostModifierValue(card, state, playerId);
    const player = state.players[playerId];
    if (player.user.abilityKey === "watching_you") modifier += ["Sp", "Script"].includes(card.category) ? -1 : isObCard(card) || card.category === "Code" ? 1 : 0;
    if (player.user.abilityKey === "do_or_isnt" && isObCard(card)
      && player.firstObExecutionTurn !== state.turnNumber
      && [...player.front, ...player.back].filter(isObCard).length <= 2) modifier -= 1;
  }
  return Math.max(0, Number(card.cost ?? 0) + modifier);
}

export function visibleHandExecutionPayment(state, playerId, card, viewerId = null) {
  const viewer = viewerId ?? state.viewerId ?? (state.mode === "sandbox" ? state.sandboxUi?.actor ?? "player" : "player");
  const printed = Math.max(0, Number(card.cost ?? 0));
  if (playerId !== viewer) return null;
  const value = card.category === "Script" ? 0 : executionCost(card, state, playerId);
  return { printed, value, delta: value - printed };
}

export function ownLayerEntries(player) {
  return ["front", "back"].flatMap((zoneName) => player[zoneName].flatMap((host) =>
    (host.mounted ?? []).map((layer) => ({ zoneName, host, layer }))));
}

export function beginSourceLayerSelection(state, playerId, source, count, continuation, candidateUids = null) {
  normalizeMountedStack(source);
  const allowed = candidateUids ? new Set(candidateUids) : null;
  const layers = source.mounted.filter((layer) => !allowed || allowed.has(layer.uid));
  if (layers.length < count) return false;
  const labels = Object.fromEntries(layers.map((layer) => {
    const index = source.mounted.findIndex((candidate) => candidate.uid === layer.uid);
    return [layer.uid, `レイヤー${index + 1}: ${layer.name}`];
  }));
  const request = createSelectionRequest({
    mode: count === 1 ? "single" : "exact",
    candidates: layers.map((layer) => layer.uid),
    count,
    minimum: count,
    maximum: count,
    candidateLabels: labels,
    label: `${source.name}: 消費するレイヤーを${count}枚選択`,
    message: source.text,
    continuation
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function consumeSelectedSourceLayers(state, playerId, source, selectedUids, reason) {
  normalizeMountedStack(source);
  const unique = [...new Set(selectedUids ?? [])];
  const layers = unique.map((uid) => source.mounted.find((layer) => layer.uid === uid));
  if (layers.some((layer) => !layer) || layers.length !== unique.length) return null;
  for (const layer of layers) {
    const index = source.mounted.findIndex((candidate) => candidate.uid === layer.uid);
    source.mounted.splice(index, 1);
    moveCardToTrash(state, layer.owner ?? playerId, layer, reason);
  }
  addLog(state, `${source.name}: ${layers.map((layer) => `「${layer.name}」`).join("、")}をレイヤーから消費。`, "effect");
  return layers;
}

export function placementCostCandidates(state, spec) {
  if (!spec?.selection) return [];
  const { zones = [], faceUp = false, namePrefix = "" } = spec.selection;
  return Object.entries(state.players).flatMap(([ownerId, owner]) => zones.flatMap((zoneName) =>
    (owner[zoneName] ?? [])
      .filter((card) => (!faceUp || card.faceDown !== true) && card.name.startsWith(namePrefix))
      .map((card) => ({ ownerId, zoneName, card }))
  ));
}

function finishPlacementCostBatch(state, paid) {
  const batch = state.placementCostBatch;
  if (!batch) return false;
  state.placementCostBatch = null;
  if (!paid) {
    addLog(state, `${batch.sourceName}: 必要な破壊コストをすべて支払えなかったため設置しない。`, "effect");
    return true;
  }
  const source = state.players[batch.playerId].hand.find((card) => card.uid === batch.sourceUid);
  if (!source) return fail(state, `${batch.sourceName}: 発動元が手札を離れたため設置できない。`, false);
  const resume = batch.options?.requestedSlot != null ? playCardCore : playCard;
  return resume(state, batch.playerId, batch.sourceUid, { ...batch.options, placementCostPermit: STD121_PLACEMENT_PERMIT });
}

export function continuePlacementCostBatch(state) {
  const batch = state.placementCostBatch;
  if (!batch || batch.currentUid || state.pending || state.prompt || state.deferredTrashMoves?.length || state.deferredDestruction) return false;
  if (batch.failed) return finishPlacementCostBatch(state, false);
  if (!batch.queue.length) return finishPlacementCostBatch(state, batch.paidCount === batch.requiredCount);
  const uid = batch.queue.shift();
  const location = findCard(state, uid);
  if (!location || !["front", "back"].includes(location.zoneName) || location.card.faceDown === true || !location.card.name.startsWith(batch.namePrefix)) {
    batch.failed = true;
    return finishPlacementCostBatch(state, false);
  }
  batch.currentUid = uid;
  const started = destroyCard(state, location.playerId, uid, { source: `${batch.sourceName}の設置コスト` });
  if (!started && batch.currentUid === uid) {
    batch.currentUid = null;
    batch.failed = true;
    return finishPlacementCostBatch(state, false);
  }
  return true;
}

export function settlePlacementCostDestruction(state, uid, destroyed) {
  const batch = state.placementCostBatch;
  if (!batch || batch.currentUid !== uid) return false;
  batch.currentUid = null;
  if (destroyed) batch.paidCount += 1;
  else batch.failed = true;
  return true;
}

export function magazineExecutionCandidates(state, playerId) {
  const player = state.players[playerId];
  return player.hand.filter((card) => {
    if (card.category !== "Sp" || !hasKeyword(card, "MAGAZINE")) return false;
    if (spellNeedsTarget(card) && getEffectTargets(state, otherPlayer(playerId), card).length === 0) return false;
    const amount = Number(keywordValue(card, "MAGAZINE") ?? 0);
    const reduction = ownLayerEntries(player).length >= amount ? amount : 0;
    return canPlayCard(state, playerId, card, { allowOffTurn: true, executionCostReduction: reduction }).ok;
  });
}
