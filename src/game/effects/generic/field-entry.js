import { hasKeyword } from "../../core/keywords.js";

// Field entry table: the turn each card on the field arrived there. Moving
// between front and back keeps the entry; leaving the field drops it.
export function markFieldEntry(state, card) {
  if (!card?.uid) return;
  if (!state.fieldEntryTurns) state.fieldEntryTurns = {};
  state.fieldEntryTurns[card.uid] = state.turnNumber;
}

export function syncFieldEntryTurns(state) {
  const onField = new Set();
  const visit = (card) => {
    if (!card?.uid || onField.has(card.uid)) return;
    onField.add(card.uid);
    for (const layer of card.mounted ?? []) visit(layer);
  };
  for (const player of Object.values(state.players)) for (const card of [...player.front, ...player.back]) visit(card);
  const table = state.fieldEntryTurns ?? {};
  const next = {};
  for (const uid of onField) next[uid] = Object.hasOwn(table, uid) ? table[uid] : state.turnNumber;
  state.fieldEntryTurns = next;
}

export function enteredFieldThisTurn(state, card) {
  syncFieldEntryTurns(state);
  return state.fieldEntryTurns[card.uid] === state.turnNumber;
}

// Summoning sickness after a front/back move: only a card that entered the
// field this turn (or is already sick) cannot attack from the front.
export function movedSummoningSick(state, card, targetZone) {
  return targetZone === "front" && !hasKeyword(card, "QA") && (Boolean(card.summoningSick) || enteredFieldThisTurn(state, card));
}
