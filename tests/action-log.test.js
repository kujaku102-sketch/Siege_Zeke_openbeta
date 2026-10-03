import test from "node:test";
import assert from "node:assert/strict";
import { addLog, attack, createGame } from "../src/game/engine.js";
import { createCardInstance } from "../src/data/cards.js";
import { actionLogHtml } from "../src/ui-refresh/action-log.js";

test("battle log keeps turn and source side and renders visible numbers", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  state.players.player.front = [createCardInstance("STD-075", "player", 99101)];
  state.players.ai.front = [];
  addLog(state, "ジャンキー: 相手ユーザーへ3ダメージ。STR 20→17。", "damage");
  assert.equal(state.log.at(-1).actor, "player");
  assert.equal(state.log.at(-1).cardId, "STD-075");
  assert.equal(state.log.at(-1).turn, 1);

  state.players.player.front = [];
  state.players.ai.front = [createCardInstance("STD-075", "ai", 99102)];
  state.turnNumber = 2;
  addLog(state, "ジャンキーが自分ユーザーへ攻撃。", "action");
  addLog(state, "Doors ZXが「ジャンキー」を前衛へ実行。", "action");
  assert.equal(state.log.at(-1).cardId, "STD-075");
  assert.equal(state.log.at(-1).actor, "ai");
  addLog(state, "ターン終了。", "system");

  const html = actionLogHtml(state);
  assert.match(html, /TURN 1/);
  assert.match(html, /TURN 2/);
  assert.match(html, /TURN 1 · YOU/);
  assert.match(html, /is-mine/);
  assert.match(html, /is-theirs/);
  assert.match(html, /is-system/);
  assert.match(html, /3 DAMAGE/);
  assert.match(html, /STR 20→17/);
  assert.match(html, /<img src=/);
  assert.match(html, /data-live="close-log"/);
});

test("resolved card battle records target, actual damage and both STR changes", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const attacker = createCardInstance("STD-075", "player", 99201);
  const defender = createCardInstance("STD-075", "ai", 99202);
  Object.assign(attacker, { atk: 3, str: 5, summoningSick: false });
  Object.assign(defender, { atk: 2, str: 4, sleep: true });
  state.players.player.front = [attacker];
  state.players.ai.front = [defender];
  assert.equal(attack(state, "player", attacker.uid, defender.uid), true);
  const result = state.log.findLast((entry) => entry.combat);
  assert.equal(result.actor, "player");
  assert.equal(result.cardId, attacker.id);
  assert.deepEqual(result.combat, { targetName: defender.name, damage: 3, targetStrBefore: 4, targetStrAfter: 1,
    counterDamage: 2, sourceStrBefore: 5, sourceStrAfter: 3 });
  const html = actionLogHtml(state);
  assert.match(html, /ジャンキー → ジャンキー/);
  assert.match(html, /3 DAMAGE/);
  assert.match(html, /対象 STR 4→1/);
  assert.match(html, /反撃 2 DAMAGE/);
  assert.match(html, /攻撃元 STR 5→3/);
});

test("battle log uses zero damage when protection prevents a hit", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const attacker = createCardInstance("STD-075", "player", 99203);
  const defender = createCardInstance("STD-075", "ai", 99204);
  Object.assign(attacker, { atk: 3, str: 5, summoningSick: false });
  Object.assign(defender, { atk: 2, str: 4, sleep: true, protect: 1 });
  state.players.player.front = [attacker];
  state.players.ai.front = [defender];
  assert.equal(attack(state, "player", attacker.uid, defender.uid), true);
  const result = state.log.findLast((entry) => entry.combat);
  assert.equal(result.combat.damage, 0);
  assert.equal(result.combat.targetStrAfter, 4);
});

test("direct user attack records damage and user STR after modifiers", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const attacker = createCardInstance("STD-075", "player", 99205);
  Object.assign(attacker, { atk: 3, summoningSick: false });
  state.players.player.front = [attacker];
  state.players.ai.front = [];
  assert.equal(attack(state, "player", attacker.uid, "ai-fortress"), true);
  const result = state.log.findLast((entry) => entry.combat);
  assert.equal(result.actor, "player");
  assert.equal(result.cardId, attacker.id);
  assert.equal(result.combat.damage, 3);
  assert.equal(result.combat.targetStrBefore - result.combat.targetStrAfter, 3);
  assert.match(actionLogHtml(state), /対象 STR 20→17/);
});

test("replaced direct damage records zero STR loss", () => {
  const state = createGame({ mode: "sandbox", aiUserId: "by_os", rng: () => 0.5 });
  const attacker = createCardInstance("STD-075", "player", 99206);
  Object.assign(attacker, { atk: 3, summoningSick: false });
  state.players.player.front = [attacker];
  state.players.ai.front = [];
  assert.equal(attack(state, "player", attacker.uid, "ai-fortress"), true);
  const result = state.log.findLast((entry) => entry.combat);
  assert.equal(result.combat.damage, 0);
  assert.equal(result.combat.targetStrBefore, result.combat.targetStrAfter);
});
