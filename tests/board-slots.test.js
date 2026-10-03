import test from "node:test";
import assert from "node:assert/strict";
import {
  boardSlotOf,
  cardAtBoardSlot,
  normalizeZoneSlots,
  placeCardInBoardSlot,
  projectZoneSlots,
  swapBoardSlots
} from "../src/game/board-slots.js";

const context = { controllerId: "player", zoneName: "front", limit: 5 };

test("board slots preserve valid positions before assigning legacy cards to holes", () => {
  const legacy = { uid: "legacy" };
  const fixed = { uid: "fixed", boardSlot: 1, boardSlotController: "player", boardSlotZone: "front" };
  const cards = [legacy, fixed];
  normalizeZoneSlots(cards, context);
  assert.equal(fixed.boardSlot, 1);
  assert.equal(legacy.boardSlot, 2);
  cards.splice(cards.indexOf(fixed), 1);
  assert.equal(boardSlotOf(cards, legacy, context), 2);
  const newcomer = { uid: "new" };
  assert.equal(placeCardInBoardSlot(cards, newcomer, context), true);
  assert.equal(newcomer.boardSlot, 1);
  assert.equal(legacy.boardSlot, 2);
});

test("cross-zone placement ignores a stale binding and requested occupied slots are rejected", () => {
  const resident = { uid: "resident", boardSlot: 1, boardSlotController: "player", boardSlotZone: "back" };
  const moved = { uid: "moved", boardSlot: 1, boardSlotController: "player", boardSlotZone: "front" };
  const back = [resident];
  assert.equal(placeCardInBoardSlot(back, moved, { controllerId: "player", zoneName: "back", limit: 3 }), true);
  assert.equal(moved.boardSlot, 2);
  const rejected = { uid: "rejected" };
  assert.equal(placeCardInBoardSlot(back, rejected, { controllerId: "player", zoneName: "back", limit: 3, requestedSlot: 2 }), false);
  assert.equal(back.includes(rejected), false);
});

test("duplicate legacy bindings retain the first card and repair only the conflicting copy", () => {
  const first = { uid: "first", boardSlot: 2, boardSlotController: "player", boardSlotZone: "front" };
  const duplicate = { uid: "duplicate", boardSlot: 2, boardSlotController: "player", boardSlotZone: "front" };
  const cards = [first, duplicate];
  normalizeZoneSlots(cards, context);
  assert.equal(first.boardSlot, 2);
  assert.equal(duplicate.boardSlot, 1);
});

test("board-slot projection is pure and exposes stable holes", () => {
  const legacy = { uid: "legacy" };
  const fixed = { uid: "fixed", boardSlot: 3, boardSlotController: "player", boardSlotZone: "front" };
  const cards = [legacy, fixed];
  const before = structuredClone(cards);
  assert.deepEqual(projectZoneSlots(cards, context).map((card) => card?.uid ?? null), ["legacy", null, "fixed", null, null]);
  assert.deepEqual(cards, before);
});

test("slot lookup and swap operate independently of compact-array order", () => {
  const first = { uid: "first", boardSlot: 1, boardSlotController: "player", boardSlotZone: "front" };
  const second = { uid: "second", boardSlot: 4, boardSlotController: "player", boardSlotZone: "front" };
  const cards = [second, first];
  assert.equal(cardAtBoardSlot(cards, 4, context), second);
  swapBoardSlots(first, second);
  assert.equal(boardSlotOf(cards, first, context), 4);
  assert.equal(boardSlotOf(cards, second, context), 1);
});
