const slotNumber = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const normalizedLimit = (limit, fallback = 0) => Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : fallback;
const boundToZone = (card, controllerId, zoneName) => card.boardSlotController === controllerId && card.boardSlotZone === zoneName;

function firstVacant(used, limit = Infinity) {
  for (let slot = 1; slot <= limit; slot += 1) if (!used.has(slot)) return slot;
  return null;
}

export function normalizeZoneSlots(cards, { controllerId, zoneName, limit } = {}) {
  const capacity = normalizedLimit(limit, cards.length);
  const reserved = new Set();
  const retained = new Set();
  for (const card of cards) {
    const slot = slotNumber(card.boardSlot);
    if (!slot || !boundToZone(card, controllerId, zoneName) || reserved.has(slot)) continue;
    reserved.add(slot);
    retained.add(card);
  }
  for (const card of cards) {
    if (retained.has(card)) continue;
    const slot = firstVacant(reserved, Math.max(capacity, cards.length)) ?? firstVacant(reserved);
    card.boardSlot = slot;
    card.boardSlotController = controllerId;
    card.boardSlotZone = zoneName;
    reserved.add(slot);
  }
  return cards;
}

export function normalizeBoardSlots(state) {
  for (const [controllerId, player] of Object.entries(state?.players ?? {})) {
    for (const zoneName of ["front", "back"]) {
      normalizeZoneSlots(player[zoneName] ?? [], { controllerId, zoneName, limit: player.user?.[`${zoneName}Limit`] });
    }
  }
  return state;
}

export function boardSlotOf(cards, cardOrUid, context = {}) {
  normalizeZoneSlots(cards, context);
  const card = typeof cardOrUid === "string" ? cards.find((item) => item.uid === cardOrUid) : cardOrUid;
  return card && cards.includes(card) && boundToZone(card, context.controllerId, context.zoneName) ? slotNumber(card.boardSlot) : null;
}

export function cardAtBoardSlot(cards, slot, context = {}) {
  normalizeZoneSlots(cards, context);
  const wanted = slotNumber(slot);
  return wanted ? cards.find((card) => boundToZone(card, context.controllerId, context.zoneName) && card.boardSlot === wanted) ?? null : null;
}

export function placeCardInBoardSlot(cards, card, { controllerId, zoneName, limit, requestedSlot = null } = {}) {
  normalizeZoneSlots(cards, { controllerId, zoneName, limit });
  const capacity = normalizedLimit(limit, cards.length + 1);
  const used = new Set(cards.map((item) => slotNumber(item.boardSlot)).filter(Boolean));
  const requested = requestedSlot === null ? null : slotNumber(requestedSlot);
  const slot = requested ?? firstVacant(used, capacity);
  if (!slot || slot > capacity || used.has(slot)) return false;
  card.boardSlot = slot;
  card.boardSlotController = controllerId;
  card.boardSlotZone = zoneName;
  cards.push(card);
  return true;
}

export function inheritBoardSlot(card, replacedCard, { controllerId, zoneName } = {}) {
  const slot = slotNumber(replacedCard?.boardSlot);
  if (!slot) return false;
  card.boardSlot = slot;
  card.boardSlotController = controllerId;
  card.boardSlotZone = zoneName;
  return true;
}

export function swapBoardSlots(first, second) {
  const firstPosition = { slot: first.boardSlot, controllerId: first.boardSlotController, zoneName: first.boardSlotZone };
  first.boardSlot = second.boardSlot;
  first.boardSlotController = second.boardSlotController;
  first.boardSlotZone = second.boardSlotZone;
  second.boardSlot = firstPosition.slot;
  second.boardSlotController = firstPosition.controllerId;
  second.boardSlotZone = firstPosition.zoneName;
}

export function projectZoneSlots(cards, { controllerId, zoneName, limit } = {}) {
  const capacity = normalizedLimit(limit, cards.length);
  const assigned = new Map();
  const deferred = [];
  for (const card of cards) {
    const slot = slotNumber(card.boardSlot);
    if (!slot || !boundToZone(card, controllerId, zoneName) || assigned.has(slot)) deferred.push(card);
    else assigned.set(slot, card);
  }
  for (const card of deferred) {
    const slot = firstVacant(new Set(assigned.keys()), Math.max(capacity, cards.length)) ?? firstVacant(new Set(assigned.keys()));
    assigned.set(slot, card);
  }
  const maximum = Math.max(capacity, 0, ...assigned.keys());
  return Array.from({ length: maximum }, (_, index) => assigned.get(index + 1) ?? null);
}
