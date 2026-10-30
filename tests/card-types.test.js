import test from "node:test";
import assert from "node:assert/strict";
import { excludesCardCategory, isLydCard, isLydCategory, isObCard, isObCategory, matchesCardCategory } from "../src/game/card-types.js";
import { parseLookSelectRemainderModule } from "../packages/effect-compiler/index.js";

const normal = { category: "Ob" };
const layered = { category: "Lyd-Ob", printedCategory: "Lyd-Ob" };
const code = { category: "Code" };

test("Ob is broad while explicit Lyd remains narrow", () => {
  assert.equal(isObCategory("Ob"), true);
  assert.equal(isObCategory("Lyd-Ob"), true);
  assert.equal(isObCard(layered), true);
  assert.equal(matchesCardCategory(layered, "Ob"), true);
  assert.equal(matchesCardCategory(layered, "Lyd-Ob"), true);
  assert.equal(matchesCardCategory(layered, "Lyd"), true);
  assert.equal(matchesCardCategory(normal, "Lyd-Ob"), false);
  assert.equal(matchesCardCategory(code, "Ob"), false);
});

test("negative category wording excludes only the stated category family", () => {
  assert.equal(isLydCategory("Lyd"), true);
  assert.equal(isLydCard(layered), true);
  assert.equal(excludesCardCategory(layered, "Lyd-Ob"), false);
  assert.equal(excludesCardCategory(normal, "Lyd-Ob"), true);
  assert.equal(excludesCardCategory(layered, "Ob"), false);
  assert.equal(excludesCardCategory(code, "Ob"), true);

  const module = parseLookSelectRemainderModule("山札の上から3枚を見る。その中からLydでないカード1枚を選び、それを手札に加える。残りを山札の下に戻す。");
  assert.equal(module.selection.filter.category, undefined);
  assert.equal(module.selection.filter.excludeCategory, "Lyd-Ob");
});
