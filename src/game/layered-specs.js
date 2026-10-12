import { isObCard, matchesCardCategory } from "./card-types.js";

const area = ["front", "back"];
const own = (zones, filter = {}, minimum = 1, maximum = Infinity) => ({ owner: "self", zones, filter, minimum, maximum });
const exact = (zones, filter = {}, count = 1) => own(zones, filter, count, count);

const SPECS = Object.freeze({
  "STD-085": { groups: [own(area, { className: "レッドパンクス", category: "Code" }), exact(area, { className: "ノイド", isOb: true })] },
  "STD-094": { groups: [exact(area, { className: "ノイド", isOb: true }), own(area, { className: "レッドパンクス" })] },
  "STD-095": { groups: [exact(area, { nameIncludes: "変形合体レッパオー", isOb: true }), own(area, { className: "レッドパンクス" })] },
  "STD-096": { groups: [exact(area, { nameIncludes: "変形合体レッパオー", isOb: true }), own(area, { className: "レッドパンクス" })] },
  "STD-097": { groups: [exact(area, { nameIncludes: "変形合体レッパオー", isOb: true }), own(area, { className: "レッドパンクス" })] },
  "STD-098": { groups: [exact(area, { nameIncludes: "変形合体レッパオー", isOb: true }), own(area, { printedCategory: "Lyd-Ob" }, 2)] },
  "STD-099": { groups: [exact(area, { nameIncludes: "変形合体レッパオー", isOb: true }), own(area, { className: "レッドパンクス" })] },
  "STD-102": { groups: [own(area, { className: "レッドパンクス", isOb: true }), own(area, { nameIncludes: "ジャンク" })] },
  "STD-106": { groups: [exact(area, { className: "レッドパンクス", isOb: true }), exact(area, { className: "オートメイル" })] },
  "STD-195": { groups: [own(area, { name: "ドールズ", isOb: true }, 2)] },
  "STD-205": { groups: [own(area, { isOb: true })] },
  "STD-232": { groups: [own([...area, "registry"], {}, 2)] },
  "STD-238": { groups: [exact(area, { isOb: true }), own(["registry"], {})] },
  "SZTB-092": { groups: [exact(["hand"], { armsBand: true })] },
  "SZTB-093": { groups: [exact(["hand"], { armsBand: true }), exact(area, { armsBand: true })] },
  "SZTB-094": { groups: [own(["hand", ...area], { armsBand: true }, 3)] },
  "SZTB-095": { groups: [own(["hand", ...area], { armsBand: true }, 3)] }
});

const hasClass = (card, name) => (card?.classes ?? []).includes(name);

const isArmsBand = (card) => {
  const number = Number(String(card?.id ?? "").match(/^SZTB-(\d{3})$/)?.[1]);
  return card?.name?.includes("アームズバンド") || (number >= 90 && number <= 102);
};

function matchesFilter(card, filter) {
  if (filter.category && !matchesCardCategory(card, filter.category)) return false;
  if (filter.excludeCategory && matchesCardCategory(card, filter.excludeCategory)) return false;
  if (filter.printedCategory && card.printedCategory !== filter.printedCategory && card.category !== filter.printedCategory) return false;
  if (filter.isOb && !isObCard(card)) return false;
  if (filter.className && !hasClass(card, filter.className)) return false;
  if (filter.name && card.name !== filter.name) return false;
  if (filter.nameIncludes && !card.name.includes(filter.nameIncludes)) return false;
  if (filter.armsBand && !isArmsBand(card)) return false;
  return true;
}

function entryMatchesGroup(entry, group, playerId) {
  if (group.owner === "self" && entry.playerId !== playerId) return false;
  if (group.owner === "enemy" && entry.playerId === playerId) return false;
  if (!group.zones.includes(entry.zoneName)) return false;
  if (["front", "back"].includes(entry.zoneName) && entry.card.faceDown) return false;
  return matchesFilter(entry.card, group.filter);
}

function canAssignEveryEntry(entries, groups, playerId, index = 0, counts = groups.map(() => 0)) {
  if (index === entries.length) return groups.every((group, groupIndex) => counts[groupIndex] >= group.minimum && counts[groupIndex] <= group.maximum);
  return groups.some((group, groupIndex) => {
    if (counts[groupIndex] >= group.maximum || !entryMatchesGroup(entries[index], group, playerId)) return false;
    const next = counts.slice();
    next[groupIndex] += 1;
    return canAssignEveryEntry(entries, groups, playerId, index + 1, next);
  });
}

export function layeredSpecFor(card) {
  const spec = SPECS[card?.id];
  if (!spec) return null;
  return {
    ...spec,
    minimum: spec.groups.reduce((sum, group) => sum + group.minimum, 0),
    label: card?.compiled?.keywords?.find((keyword) => keyword.name === "LAYERED")?.value
      ?? card?.text?.match(/\[レイヤード[:：]([^\]]+)\]/)?.[1]
      ?? "レイヤード条件"
  };
}

export function layeredCandidates(state, playerId, sourceCard) {
  const spec = layeredSpecFor(sourceCard);
  if (!spec) return [];
  const entries = [];
  for (const [ownerId, player] of Object.entries(state.players)) {
    for (const zoneName of ["hand", "front", "back", "registry"]) {
      for (const card of player[zoneName] ?? []) {
        if (card.uid === sourceCard.uid) continue;
        const entry = { playerId: ownerId, zoneName, card };
        if (spec.groups.some((group) => entryMatchesGroup(entry, group, playerId))) entries.push(entry);
      }
    }
  }
  return entries;
}

export function layeredSelectionPlan(state, playerId, sourceCard) {
  const spec = layeredSpecFor(sourceCard);
  if (!spec) return null;
  const entries = layeredCandidates(state, playerId, sourceCard);
  const groups = spec.groups.map((group, index) => ({
    groupId: `group:${index + 1}`,
    minimum: group.minimum,
    maximum: Number.isFinite(group.maximum) ? group.maximum : entries.length,
    entries: entries.filter((entry) => entryMatchesGroup(entry, group, playerId))
  }));
  return {
    minimum: spec.minimum,
    maximum: Math.min(entries.length, groups.reduce((sum, group) => sum + group.maximum, 0)),
    label: spec.label,
    entries,
    groups
  };
}

export function validatesLayeredSelection(card, playerId, entries) {
  const spec = layeredSpecFor(card);
  if (!spec || entries.length < spec.minimum) return false;
  return canAssignEveryEntry(entries, spec.groups, playerId);
}

export function flattenMaterialStack(card, role = "layered") {
  const nested = [...(card.mounted ?? [])];
  card.mounted = [];
  card.layerRole = role;
  return [card, ...nested.flatMap((layer) => flattenMaterialStack(layer, layer.layerRole ?? "layered"))];
}

export function flattenedLayers(card) {
  return (card?.mounted ?? []).flatMap((layer) => [layer, ...flattenedLayers(layer)]);
}

export function flattenedLayerCount(card) {
  return flattenedLayers(card).length;
}

export function normalizeMountedStack(card) {
  if (!card || !Array.isArray(card.mounted)) return [];
  card.mounted = card.mounted.flatMap((layer) => flattenMaterialStack(layer, layer.layerRole ?? "layered"));
  return card.mounted;
}

export const LAYERED_CARD_IDS = Object.freeze(Object.keys(SPECS));
