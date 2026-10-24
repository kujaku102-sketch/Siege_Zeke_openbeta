import test from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../src/game/engine.js";
import { runtimeComponents } from "../src/ui/runtime-components.js";

function auditState(card = null) {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  state.players.player.front = card ? [card] : [];
  state.players.player.back = [];
  state.players.player.registry = [];
  state.players.ai.front = [];
  state.players.ai.back = [];
  state.players.ai.registry = [];
  state.pending = null;
  state.selectedUid = null;
  return state;
}

test("component inspector separates granted backup from printed per-turn uses and keeps zero protect", () => {
  const card = { text: "[バックアップ:2]", backup: 3, backupUsedTurn: 4, backupUsesThisTurn: 2,
    protect: 0, compiled: { keywords: [{ name: "PROTECT", value: 2 }] } };
  const rows = runtimeComponents(card, 4);
  assert.ok(rows.some((row) => row.label === "プロテクト" && row.value === "残り0回"));
  assert.ok(rows.some((row) => row.note === "付与分" && row.value === "残り3回"));
  assert.ok(rows.some((row) => row.note === "基本能力・このターン" && row.value === "残り0/2回"));
  assert.ok(runtimeComponents(card, 5).some((row) => row.value === "残り2/2回"));
  assert.deepEqual(runtimeComponents({}, 1), []);
});
