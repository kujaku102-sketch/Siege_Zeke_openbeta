import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CARD_LIBRARY, USER_CARDS } from "../src/data/cards.js";
import { applyVisualEffects, planVisualEffects, snapshotVisualState } from "../src/ui/visual-effects.js";
import { pngMetadataText, isApprovedDeckFont } from "../scripts/verify-public-build.mjs";
import { cardArtProfile } from "../src/data/card-art-profiles.js";
import { ABILITY_BADGES, abilityBadgeDefinition } from "../src/data/ability-badges.js";
import { NAVIGATOR_ASSETS, tutorialNavigator } from "../src/data/navigator-assets.js";
import { createTutorialFlow, currentTutorialStep } from "../src/data/tutorial.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
test("all entry pages publish the FX-OFF logo as favicon and share image", async () => {
  for (const entry of ["index.html", "pc/index.html", "mobile/index.html"]) {
    const html = await readFile(path.join(root, entry), "utf8");
    assert.match(html, /rel="icon"[^>]+href="\/assets\/site-icon-32\.png\?v=1"/);
    assert.match(html, /property="og:image" content="https:\/\/siegezeke\.online\/assets\/site-share-1200x630\.png\?v=1"/);
    assert.match(html, /name="twitter:card" content="summary_large_image"/);
  }
  for (const [name, width, height] of [["site-icon-32.png", 32, 32], ["app-icon-192.png", 192, 192], ["app-icon-512.png", 512, 512], ["site-share-1200x630.png", 1200, 630]]) {
    const png = await readFile(path.join(root, "public", "assets", name));
    assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
  }
});
test("font binary exception rejects unknown data even with a valid-looking signature", () => {
  assert.equal(isApprovedDeckFont(Buffer.from('wOF2 not an approved font'),'.woff2'),false);
  assert.equal(isApprovedDeckFont(Buffer.from('OTTO not an approved font'),'.otf'),false);
  assert.equal(isApprovedDeckFont(Buffer.from(''),'.ttf'),false);
});
const privateFields = ["sourceName", "sourceCategory", "sourceCost", "sourceAtk", "sourceStr", "sourceColor", "sourceClasses", "sourceText", "sourceSheet", "sourceRow", "sourceSpreadsheetId"];
const hasPrivate = (value) => Array.isArray(value) ? value.some(hasPrivate) : value && typeof value === "object" ? Object.entries(value).some(([key, child]) => privateFields.includes(key) || hasPrivate(child)) : false;

test("public card library is self-contained and has 214 staging STD IDs", () => {
  const ids = Object.keys(CARD_LIBRARY).filter((id) => /^STD-\d{3}$/.test(id));
  assert.equal(ids.length, 214);
  assert.equal(new Set(ids).size, 214);
  assert.equal(hasPrivate(CARD_LIBRARY), false);
  assert.deepEqual(CARD_LIBRARY["STD-173"].traits, ["インセクト"]);
});

test("public project contains no canonical data modules or copied internal directories", async () => {
  const dataFiles = await readdir(path.join(root, "src", "data"));
  for (const forbidden of ["std-source.generated.js", "std-supported.generated.js", "vengeance.js", "neutron.js", "std-selection-modules.js"]) assert.equal(dataFiles.includes(forbidden), false);
  for (const forbidden of ["inputs", "outputs", "artifacts", "audit"]) assert.equal((await readdir(root)).includes(forbidden), false);
});

test("public scripts do not embed a source-workspace path", async () => {
  const scripts = await Promise.all(["build-public.mjs", "verify-public-build.mjs", "e2e-public-build.mjs"].map((name) => readFile(path.join(root, "scripts", name), "utf8")));
  for (const body of scripts) assert.doesNotMatch(body, /D:\\projects\\txt-analyze/i);
});

test("card artwork filenames are exact library IDs and the generated map is current", async () => {
  const directory = path.join(root, "src", "assets", "card-art");
  const files = (await readdir(directory)).filter((name) => name !== ".gitkeep").sort();
  const generated = await readFile(path.join(root, "src", "data", "card-art.generated.js"), "utf8");
  const stems = new Set();
  for (const name of files) {
    const extension = path.extname(name).toLowerCase();
    const cardId = path.basename(name, extension);
    assert.ok([".avif", ".jpeg", ".jpg", ".png", ".webp"].includes(extension), `unsupported card art: ${name}`);
    assert.ok(Object.hasOwn(CARD_LIBRARY, cardId), `unknown card art ID: ${name}`);
    assert.equal(stems.has(cardId), false, `duplicate card art ID: ${cardId}`);
    stems.add(cardId);
    assert.ok(generated.includes(`"${cardId}": new URL("../assets/card-art/${name}", import.meta.url).href,`), `generated map is missing ${name}`);
  }
  assert.equal((generated.match(/new URL\(/g) ?? []).length, files.length);
});

test("card artwork profiles keep portrait cards at 5:8 and Code artwork square by default", () => {
  assert.deepEqual(cardArtProfile({ id: "STD-075", category: "Ob" }), { orientation: "portrait", focusX: 50, focusY: 34, zoom: 1 });
  assert.deepEqual(cardArtProfile({ id: "STD-078", category: "Code" }), { orientation: "square", focusX: 50, focusY: 34, zoom: 1 });
});

test("ability badge registry exposes only approved current-keyword image mappings", async () => {
  const expected = ["CONTACT", "DECOY", "DISCONNECT", "ENCRYPTION", "HACKING", "LAYERED", "LOAD", "LOGIN", "LOGOUT", "PROTECT", "QA", "RESIDENT", "SECURITY"];
  assert.deepEqual(Object.keys(ABILITY_BADGES).sort(), expected);
  for (const entry of Object.values(ABILITY_BADGES)) assert.ok((await readFile(fileURLToPath(entry.asset))).length > 0);
  assert.equal(abilityBadgeDefinition("RESPONSE").asset, null);
  assert.equal(abilityBadgeDefinition("OC").asset, null);
  assert.equal(abilityBadgeDefinition("UPDATE").asset, null);
  assert.equal(abilityBadgeDefinition("Security").label, "セキュリティ");
});

test("tutorial navigator registry uses a local temporary image with replaceable tutorial mappings", async () => {
  const basics = tutorialNavigator("basics");
  assert.equal(basics, NAVIGATOR_ASSETS.vengeance);
  assert.equal(tutorialNavigator("unknown"), NAVIGATOR_ASSETS.default);
  assert.match(basics.src, /monochrome-placeholder\.jpg$/);
  assert.equal((await readFile(fileURLToPath(basics.src))).length, 82868);
});

test("tutorial steps declare structured focus targets instead of deriving them from dialogue text", () => {
  const basics = createTutorialFlow("basics");
  assert.deepEqual(currentTutorialStep(basics).focus.map((item) => item.kind), ["card", "card", "fortress"]);
  basics.index = 5;
  assert.equal(currentTutorialStep(basics).focus.find((item) => item.kind === "card")?.cardId, "STD-087");
  basics.index = 6;
  assert.deepEqual(currentTutorialStep(basics).focus, [{ kind: "ui", target: "info-button", label: "情報ボタン" }]);
  const vengeance = createTutorialFlow("vengeance");
  vengeance.index = 2;
  assert.ok(currentTutorialStep(vengeance).focus.some((item) => item.cardId === "STD-189"));
  assert.ok(currentTutorialStep(vengeance).focus.some((item) => item.kind === "zone" && item.zone === "front"));
});

test("PNG public scanning reads metadata chunks without treating compressed pixels as paths", () => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type, data) => { const header = Buffer.alloc(8); header.writeUInt32BE(data.length); header.write(type, 4, "ascii"); return Buffer.concat([header, data, Buffer.alloc(4)]); };
  const png = Buffer.concat([signature, chunk("tEXt", Buffer.from("Comment\0safe metadata")), chunk("IDAT", Buffer.from("random c:\\false-positive pixels")), chunk("IEND", Buffer.alloc(0))]);
  assert.equal(pngMetadataText(png), "Comment\0safe metadata");
});

test("visual effects are derived from state differences without mutating game state", () => {
  const playerCard = { uid: "player-a", id: "STD-020", name: "A", damage: 0, attackedThisTurn: false };
  const base = { players: {
    player: { fortressStr: 15, front: [playerCard], back: [], hand: [], registry: [], trash: [], deck: [] },
    ai: { fortressStr: 15, front: [], back: [], hand: [], registry: [], trash: [], deck: [] }
  } };
  const previous = snapshotVisualState(base);
  const next = structuredClone(base);
  next.players.player.front[0].damage = 2;
  next.players.player.front[0].attackedThisTurn = true;
  next.players.ai.fortressStr = 12;
  next.players.player.back.push({ uid: "player-b", id: "STD-021", name: "B", damage: 0, attackedThisTurn: false });
  const frozen = structuredClone(next);
  const transition = planVisualEffects({ querySelectorAll: () => [] }, previous, next);
  assert.deepEqual(transition.effects.map((effect) => effect.type).sort(), ["attack", "deploy", "hit", "user-hit"]);
  assert.deepEqual(next, frozen);
});

test("ability presentation matrix preserves every confirmed semantic step and public target", () => {
  const base = { events: [], players: {
    player: { fortressStr: 20, memory: 5, user: USER_CARDS.doors_zx, front: [{ uid: "public-ob", category: "Ob", faceDown: false }], back: [], hand: [], registry: [], trash: [], deck: [], ban: [] },
    ai: { fortressStr: 20, memory: 5, front: [], back: [], hand: [], registry: [], trash: [], deck: [], ban: [] }
  } };
  const previous = snapshotVisualState(base);
  const next = structuredClone(base);
  const rows = [
    ["turbo", "activated", [{ kind: "value_change", target: { kind: "player_stat", playerId: "player", metric: "memory_limit" }, before: 5, after: 7 }]],
    ["registry_liberty", "first-install", [{ kind: "transfer", from: { kind: "zone_count", playerId: "player", zone: "deck" }, to: { kind: "zone_count", playerId: "player", zone: "hand" }, count: 1 }, { kind: "state_change", target: { kind: "status", playerId: "player", status: "extra_install" }, before: false, after: true }]],
    ["recovery_boot", "recovered", [{ kind: "value_change", target: { kind: "player_stat", playerId: "player", metric: "str" }, before: 0, after: 1 }]],
    ["dimension_innovation", "damage-replaced", [{ kind: "transfer", from: { kind: "zone_count", playerId: "player", zone: "deck" }, to: { kind: "zone_count", playerId: "player", zone: "ban" }, count: 2 }]],
    ["do_or_isnt", "exact-three-recovery", [{ kind: "value_change", target: { kind: "player_stat", playerId: "player", metric: "str" }, before: 10, after: 11 }, { kind: "value_change", target: { kind: "player_stat", playerId: "player", metric: "memory" }, before: 2, after: 3 }]],
    ["trash_never_empty", "milled-same-symbol", [{ kind: "transfer", from: { kind: "zone_count", playerId: "player", zone: "deck" }, to: { kind: "zone_count", playerId: "player", zone: "trash" }, count: 2 }]],
    ["kickass", "damage-doubled", [{ kind: "multiply", target: { kind: "player_stat", playerId: "player", metric: "damage" }, before: 1, factor: 2, after: 2 }]],
    ["watching_you", "mulligan", [{ kind: "transfer", from: { kind: "zone_count", playerId: "player", zone: "hand" }, to: { kind: "zone_count", playerId: "player", zone: "deck" }, count: 5 }, { kind: "transfer", from: { kind: "zone_count", playerId: "player", zone: "deck" }, to: { kind: "zone_count", playerId: "player", zone: "hand" }, count: 5 }]]
  ];
  next.events = rows.map(([abilityKey, branch, steps], index) => ({ id: `ANCHOR-${index}`, type: "user_ability_feedback", abilityKey, branch,
    ownerPlayerId: "player", affectedPlayerId: "player", amount: 2, before: 4, after: 2, strBefore: 3, strAfter: 4, memoryBefore: 1, memoryAfter: 2, steps }));
  const transition = planVisualEffects({ querySelectorAll: () => [] }, previous, next);
  assert.deepEqual(transition.effects.map((effect) => effect.steps), rows.map(([, , steps]) => steps));
  assert.equal(transition.effects.every((effect) => !JSON.stringify(effect.steps).includes("STD-") && !effect.label.includes("public-ob")), true);
  const repeat = planVisualEffects({ querySelectorAll: () => [] }, previous, next);
  assert.deepEqual(repeat.effects.map((effect) => effect.steps), transition.effects.map((effect) => effect.steps));
  assert.deepEqual(next.events.map((event) => event.steps), rows.map(([, , steps]) => steps));
});

test("Mono presentation uses board-only Ob baselines and preserves confirmed local result values", () => {
  const ob = { uid: "mono-public-ob", category: "Ob", faceDown: false, atk: 3, damage: 0 };
  const base = { events: [], players: {
    player: { fortressStr: 20, memory: 5, user: USER_CARDS.doors_zx, front: [], back: [], hand: [ob], registry: [], trash: [], deck: [], ban: [] },
    ai: { fortressStr: 20, memory: 5, front: [], back: [], hand: [], registry: [], trash: [], deck: [], ban: [] }
  } };
  const previous = snapshotVisualState(base);
  const entered = structuredClone(base);
  entered.players.player.front.push(entered.players.player.hand.pop());
  entered.events = [{ id: "MONO-ENTRY", type: "user_ability_feedback", abilityKey: "mono_color", ownerPlayerId: "player", affectedPlayerId: "player", branch: "enabled", amount: 1, steps: [{ kind: "state_change", target: { kind: "status", playerId: "player", status: "mono_color" }, before: false, after: true }] }];
  const entry = planVisualEffects({ querySelectorAll: () => [] }, previous, entered).effects.find((effect) => effect.abilityKey === "mono_color");
  assert.equal(previous.cards.has("mono-public-ob"), false);
  assert.deepEqual(entry.steps.at(-1), { kind: "value_change", target: { kind: "card_stat", playerId: "player", metric: "atk", cardUid: "mono-public-ob" }, before: 2, after: 3 });

  const boardPrevious = snapshotVisualState(entered);
  const boardNext = structuredClone(entered);
  boardNext.players.player.front[0].atk = 4;
  boardNext.events = [{ ...entered.events[0], id: "MONO-BOARD" }];
  const board = planVisualEffects({ querySelectorAll: () => [] }, boardPrevious, boardNext).effects.find((effect) => effect.abilityKey === "mono_color");
  assert.deepEqual(board.steps.at(-1), { kind: "value_change", target: { kind: "card_stat", playerId: "player", metric: "atk", cardUid: "mono-public-ob" }, before: 3, after: 4 });
});

test("state-change projection accepts only Boolean values and renders exact ON/OFF", () => {
  const base = { events: [], players: {
    player: { fortressStr: 20, memory: 5, front: [], back: [], hand: [], registry: [], trash: [], deck: [], ban: [] },
    ai: { fortressStr: 20, memory: 5, front: [], back: [], hand: [], registry: [], trash: [], deck: [], ban: [] }
  } };
  const previous = snapshotVisualState(base);
  const next = structuredClone(base);
  next.events = [
    { id: "STATE-ON", type: "user_ability_feedback", abilityKey: "mono_color", ownerPlayerId: "player", affectedPlayerId: "player", branch: "enabled", steps: [{ kind: "state_change", target: { kind: "status", playerId: "player", status: "mono_color" }, before: false, after: true }] },
    { id: "STATE-OFF", type: "user_ability_feedback", abilityKey: "mono_color", ownerPlayerId: "player", affectedPlayerId: "player", branch: "disabled", steps: [{ kind: "state_change", target: { kind: "status", playerId: "player", status: "mono_color" }, before: true, after: false }] },
    { id: "STATE-NUMERIC", type: "user_ability_feedback", abilityKey: "mono_color", ownerPlayerId: "player", affectedPlayerId: "player", branch: "invalid", steps: [{ kind: "state_change", target: { kind: "status", playerId: "player", status: "mono_color" }, before: 0, after: 1 }] }
  ];
  const transition = planVisualEffects({ querySelectorAll: () => [] }, previous, next);
  assert.deepEqual(transition.effects.map((effect) => effect.steps), [
    [{ kind: "state_change", target: { kind: "status", playerId: "player", status: "mono_color" }, before: false, after: true }],
    [{ kind: "state_change", target: { kind: "status", playerId: "player", status: "mono_color" }, before: true, after: false }],
    []
  ]);
  const original = { document: globalThis.document, CSS: globalThis.CSS, setTimeout: globalThis.setTimeout };
  const appended = [];
  const node = () => ({ dataset: {}, style: {}, children: [], setAttribute() {}, addEventListener() {}, append(child) { this.children.push(child); } });
  const anchor = { getBoundingClientRect: () => ({ left: 1, top: 2, width: 3, height: 4 }) };
  globalThis.document = { createElement: node, body: { append(item) { appended.push(item); } } };
  globalThis.CSS = { escape: (value) => value };
  globalThis.setTimeout = () => 0;
  try {
    applyVisualEffects({ querySelector: () => node(), querySelectorAll: () => [anchor] }, transition);
    assert.deepEqual(appended.filter((item) => item.className?.includes("vfx-ability-anchor")).map((item) => item.textContent), ["MONO COLOR ON", "MONO COLOR OFF"]);
  } finally {
    globalThis.document = original.document;
    globalThis.CSS = original.CSS;
    globalThis.setTimeout = original.setTimeout;
  }
});

test("presentation events have stable sequence and cover state-only transitions", () => {
  const card = { uid: "player-a", id: "STD-020", name: "A", damage: 2, attackedThisTurn: false, sleep: true, mounted: [{ uid: "layer-a" }] };
  const base = { winner: null, events: [], players: {
    player: { fortressStr: 10, memory: 2, front: [card], back: [], hand: [], registry: [], trash: [], deck: [], ban: [] },
    ai: { fortressStr: 10, memory: 4, front: [], back: [], hand: [], registry: [], trash: [], deck: [], ban: [] }
  } };
  const previous = snapshotVisualState(base);
  const next = structuredClone(base);
  Object.assign(next.players.player.front[0], { damage: 0, sleep: false, mounted: [] });
  next.players.player.memory = 5;
  next.players.player.fortressStr = 12;
  next.winner = "player";
  next.victory = { lockedOutcome: "player", lockedAtEffectId: "EFFECT-1", finished: false };
  const frozen = structuredClone(next);
  const transition = planVisualEffects({ querySelectorAll: () => [] }, previous, next);
  assert.deepEqual(transition.effects.map((effect) => effect.type), ["heal", "standby", "layer-move", "user-heal", "memory-change", "win-locked"]);
  assert.deepEqual(transition.effects.map((effect) => effect.sequence), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(next, frozen);
  const locked = transition.next;
  next.victory.finished = true;
  const finished = planVisualEffects({ querySelectorAll: () => [] }, locked, next);
  assert.deepEqual(finished.effects.map((effect) => effect.type), ["game-finished"]);
});

test("structured game events map to presentation semantics without duplicate state-diff effects", () => {
  const base = { winner: null, events: [], players: {
    player: { fortressStr: 20, memory: 5, front: [], back: [], hand: [], registry: [], trash: [], deck: [], ban: [] },
    ai: { fortressStr: 20, memory: 5, front: [], back: [], hand: [], registry: [], trash: [], deck: [], ban: [] }
  } };
  const previous = snapshotVisualState(base);
  const next = structuredClone(base);
  const placed = { uid: "player-b", id: "STD-021", name: "B", damage: 0, attackedThisTurn: false, sleep: false, mounted: [] };
  next.players.player.front.push(placed);
  next.events.push(
    { id: "EV-1", type: "card_placed", playerId: "player", cardUid: placed.uid, placementCause: "execution", to: "front" },
    { id: "EV-2", type: "attack_declared", playerId: "player", attackerUid: placed.uid, targetUid: "ai-fortress" },
    { id: "EV-3", type: "layers_consumed", playerId: "player", sourceCardUid: placed.uid, amount: 2 },
    { id: "EV-4", type: "script_activated", playerId: "player", cardUid: "missing-script" }
  );
  placed.attackedThisTurn = true;
  const transition = planVisualEffects({ querySelectorAll: () => [] }, previous, next);
  assert.deepEqual(transition.effects.map((effect) => effect.type), ["login", "attack", "layer-move", "script-activated"]);
  assert.equal(transition.effects.filter((effect) => effect.type === "attack").length, 1);
  assert.equal(transition.effects.every((effect, index) => effect.sequence === index + 1), true);
});

test("user ability feedback maps each approved ability key to a private result-grounded profile", () => {
  const base = { events: [], players: {
    player: { fortressStr: 20, memory: 5, front: [], back: [], hand: [], registry: [], trash: [], deck: [], ban: [] },
    ai: { fortressStr: 20, memory: 5, front: [], back: [], hand: [], registry: [], trash: [], deck: [], ban: [] }
  } };
  const previous = snapshotVisualState(base);
  const next = structuredClone(base);
  const keys = ["turbo", "mono_color", "registry_liberty", "recovery_boot", "dimension_innovation", "do_or_isnt", "trash_never_empty", "kickass", "watching_you"];
  next.events = keys.map((abilityKey, index) => ({ id: `EV-${index + 1}`, type: "user_ability_feedback", abilityKey,
    ownerPlayerId: abilityKey === "trash_never_empty" ? "ai" : "player", affectedPlayerId: "player", branch: abilityKey === "do_or_isnt" ? "five-plus-damage-down" : "resolved", amount: index + 1, before: index + 2, after: index + 3 }));
  const frozen = structuredClone(next);
  const transition = planVisualEffects({ querySelectorAll: () => [] }, previous, next);
  assert.deepEqual(transition.effects.map((effect) => effect.type), keys.map(() => "user-ability"));
  assert.deepEqual(transition.effects.map((effect) => effect.abilityKey), keys);
  assert.deepEqual(transition.effects.map((effect) => effect.profile), keys);
  assert.equal(new Set(transition.effects.map((effect) => effect.label)).size, keys.length);
  assert.equal(transition.effects.every((effect) => effect.label.includes("YOU") && !Object.hasOwn(effect, "cardName") && !Object.hasOwn(effect, "cardUid") && !/uid|STD-/i.test(effect.label)), true);
  assert.equal(transition.effects.find((effect) => effect.abilityKey === "trash_never_empty").ownerPlayerId, "ai");
  assert.deepEqual(next, frozen);
});

test("access drag placement has a distinct presentation event without changing state", () => {
  const base = { winner: null, events: [], players: {
    player: { fortressStr: 20, memory: 5, front: [], back: [], hand: [], registry: [], trash: [], deck: [], ban: [] },
    ai: { fortressStr: 20, memory: 5, front: [], back: [], hand: [], registry: [], trash: [], deck: [], ban: [] }
  } };
  const previous = snapshotVisualState(base);
  const next = structuredClone(base);
  const dragged = { uid: "player-dragged", id: "STD-020", name: "Dragged", damage: 0, attackedThisTurn: false, sleep: false, mounted: [] };
  next.players.player.front.push(dragged);
  next.events.push({ id: "EV-1", type: "card_placed", playerId: "player", cardUid: dragged.uid, placementCause: "access_drag", to: "front" });
  const frozen = structuredClone(next);
  const transition = planVisualEffects({ querySelectorAll: () => [] }, previous, next);
  assert.deepEqual(transition.effects.map((effect) => [effect.type, effect.label]), [["access-drag", "ACCESS / DRAG"]]);
  assert.deepEqual(next, frozen);
});

test("effect placement events keep the game trigger event but play one deploy animation", () => {
  const base = { winner: null, events: [], players: {
    player: { fortressStr: 20, memory: 5, front: [], back: [], hand: [], registry: [], trash: [], deck: [], ban: [] },
    ai: { fortressStr: 20, memory: 5, front: [], back: [], hand: [], registry: [], trash: [], deck: [], ban: [] }
  } };
  const previous = snapshotVisualState(base);
  const next = structuredClone(base);
  const placed = { uid: "player-effect", id: "STD-020", name: "Effect", damage: 0, attackedThisTurn: false, sleep: false, mounted: [] };
  next.players.player.front.push(placed);
  next.events.push(
    { id: "EV-1", type: "card_placed", playerId: "player", cardUid: placed.uid, placementCause: "effect", to: "front", source: "test" },
    { id: "EV-2", type: "card_effect_placed", playerId: "player", cardUid: placed.uid, placementCause: "effect", to: "front", source: "test" }
  );
  const transition = planVisualEffects({ querySelectorAll: () => [] }, previous, next);
  assert.deepEqual(transition.effects.map((effect) => [effect.type, effect.label]), [["deploy", "PLACED"]]);
});

test("non-adjacent effect placement events for one card remain separate presentations", () => {
  const base = { winner: null, events: [], players: {
    player: { fortressStr: 20, memory: 5, front: [], back: [], hand: [], registry: [], trash: [], deck: [], ban: [] },
    ai: { fortressStr: 20, memory: 5, front: [], back: [], hand: [], registry: [], trash: [], deck: [], ban: [] }
  } };
  const previous = snapshotVisualState(base);
  const next = structuredClone(base);
  const placed = { uid: "player-repeat", id: "STD-020", name: "Repeat", damage: 0, attackedThisTurn: false, sleep: false, mounted: [] };
  next.players.player.front.push(placed);
  next.events.push(
    { id: "EV-1", type: "card_placed", playerId: "player", cardUid: placed.uid, placementCause: "effect", to: "front", source: "first" },
    { id: "EV-2", type: "attack_declared", playerId: "player", attackerUid: placed.uid, targetUid: "ai-fortress" },
    { id: "EV-3", type: "card_effect_placed", playerId: "player", cardUid: placed.uid, placementCause: "effect", to: "front", source: "second" }
  );
  const transition = planVisualEffects({ querySelectorAll: () => [] }, previous, next);
  assert.deepEqual(transition.effects.map((effect) => effect.type), ["deploy", "attack", "deploy"]);
});

test("VFX keeps real deploy effects, links ability overlays to their source event, and omits opponent face-down data", () => {
  const base = { mode: "sandbox", sandboxUi: { actor: "player" }, events: [], players: {
    player: { fortressStr: 20, memory: 5, front: [], back: [], registry: [], hand: [], trash: [], deck: [], ban: [] },
    ai: { fortressStr: 20, memory: 5, front: [{ uid: "hidden-front", id: "SECRET-FRONT", name: "Front", faceDown: true, damage: 7, atk: 9 }], back: [{ uid: "hidden-back", id: "SECRET-BACK", name: "Back", faceDown: true, damage: 6, atk: 8 }], registry: [{ uid: "hidden-registry", id: "SECRET-REGISTRY", name: "Registry", faceDown: true, damage: 5, atk: 7 }], hand: [], trash: [], deck: [], ban: [] }
  } };
  const previous = snapshotVisualState(base);
  assert.deepEqual([...previous.cards.keys()], []);
  const next = structuredClone(base);
  next.players.player.front.push({ uid: "visible-deploy", id: "STD-020", name: "Visible", faceDown: false, damage: 0, atk: 2, mounted: [] });
  next.events.push({ id: "ABILITY-42", type: "user_ability_feedback", abilityKey: "turbo", ownerPlayerId: "player", affectedPlayerId: "player", branch: "activated", before: 5, after: 7, steps: [{ kind: "value_change", target: { kind: "player_stat", playerId: "player", metric: "memory_limit" }, before: 5, after: 7 }] });
  const transition = planVisualEffects({ querySelectorAll: () => [] }, previous, next);
  assert.equal(transition.effects.some((effect) => effect.type === "deploy" && effect.uid === "visible-deploy"), true);
  const ability = transition.effects.find((effect) => effect.type === "user-ability");
  assert.deepEqual({ sourceEventId: ability.sourceEventId, abilityKey: ability.abilityKey, branch: ability.branch }, { sourceEventId: "ABILITY-42", abilityKey: "turbo", branch: "activated" });
});

test("ability overlay keeps source owner separate from its affected target", () => {
  const base = { events: [], players: {
    player: { fortressStr: 20, memory: 5, front: [], back: [], hand: [], registry: [], trash: [], deck: [], ban: [] },
    ai: { fortressStr: 20, memory: 5, front: [], back: [], hand: [], registry: [], trash: [], deck: [], ban: [] }
  } };
  const previous = snapshotVisualState(base);
  const next = structuredClone(base);
  next.events.push({ id: "SAVAGE-1", type: "user_ability_feedback", abilityKey: "trash_never_empty", branch: "milled-same-symbol", ownerPlayerId: "ai", affectedPlayerId: "player", steps: [{ kind: "value_change", target: { kind: "player_stat", playerId: "player", metric: "str" }, before: 3, after: 2 }] });
  const transition = planVisualEffects({ querySelectorAll: () => [] }, previous, next);
  assert.deepEqual(transition.effects.map((effect) => effect.affectedPlayerId), ["player"]);
  const original = { document: globalThis.document, CSS: globalThis.CSS, setTimeout: globalThis.setTimeout };
  const appended = [];
  const node = () => ({ dataset: {}, style: {}, children: [], setAttribute() {}, addEventListener() {}, append(child) { this.children.push(child); } });
  const anchor = { getBoundingClientRect: () => ({ left: 1, top: 2, width: 3, height: 4 }) };
  const feed = node();
  globalThis.document = { createElement: node, body: { append(item) { appended.push(item); } } };
  globalThis.CSS = { escape: (value) => value };
  globalThis.setTimeout = () => 0;
  try {
    applyVisualEffects({ querySelector: () => feed, querySelectorAll: () => [anchor] }, transition);
    const overlay = appended.find((item) => item.className?.includes("vfx-ability-anchor"));
    assert.deepEqual(overlay.dataset, { vfxOwner: "ai", vfxAffectedPlayer: "player", vfxTargetPlayer: "player", vfxTarget: "player_stat:str", vfxSourceEventId: "SAVAGE-1", vfxAbilityKey: "trash_never_empty", vfxBranch: "milled-same-symbol", vfxStepIndex: "0", vfxEndpointRole: "single", vfxCardUid: "" });
    assert.equal(overlay.textContent, "3→2");
    const exact = { sourceEventId: "SAVAGE-1", abilityKey: "trash_never_empty", branch: "milled-same-symbol", owner: "ai", affected: "player", target: "player_stat:str", targetPlayer: "player", stepIndex: "0", role: "single", cardUid: "", text: "3→2" };
    const record = { sourceEventId: overlay.dataset.vfxSourceEventId, abilityKey: overlay.dataset.vfxAbilityKey, branch: overlay.dataset.vfxBranch, owner: overlay.dataset.vfxOwner, affected: overlay.dataset.vfxAffectedPlayer, target: overlay.dataset.vfxTarget, targetPlayer: overlay.dataset.vfxTargetPlayer, stepIndex: overlay.dataset.vfxStepIndex, role: overlay.dataset.vfxEndpointRole, cardUid: overlay.dataset.vfxCardUid, text: overlay.textContent };
    assert.deepEqual(record, exact);
    for (const key of ["sourceEventId", "abilityKey", "branch", "owner", "affected", "target", "targetPlayer", "stepIndex", "role", "cardUid", "text"]) {
      const wrong = { ...exact, [key]: key === "text" ? "3→20" : "wrong" };
      assert.equal(JSON.stringify(record) === JSON.stringify(wrong), false, `wrong ${key} must not match`);
    }
  } finally {
    globalThis.document = original.document;
    globalThis.CSS = original.CSS;
    globalThis.setTimeout = original.setTimeout;
  }
});

test("VFX initial opponent placement history stays private while new visible effects remain eligible", () => {
  const base = { mode: "sandbox", sandboxUi: { actor: "player" }, events: [], players: {
    player: { fortressStr: 20, memory: 5, front: [], back: [], registry: [], hand: [], trash: [], deck: [], ban: [] },
    ai: { fortressStr: 20, memory: 5, front: [], back: [], registry: [], hand: [], trash: [], deck: [], ban: [] }
  } };
  const initial = structuredClone(base);
  initial.players.ai.back.push({ uid: "old-revealed-uid", id: "STD-182", name: "Old Revealed", faceDown: false, damage: 0, atk: 2 });
  initial.events.push(
    { id: "OLD-PLACEMENT", type: "card_placed", playerId: "ai", cardUid: "old-revealed-uid", placementCause: "effect", to: "back", source: "old" },
    { id: "OLD-EFFECT", type: "card_effect_placed", playerId: "ai", cardUid: "old-revealed-uid", placementCause: "effect", to: "back", source: "old" }
  );
  for (let index = 0; index < 198; index += 1) initial.events.push({ id: `OLD-FILL-${index}`, type: "user_damaged", playerId: "player", amount: 0 });
  const first = snapshotVisualState(initial);
  assert.equal(first.cards.has("old-revealed-uid"), true, "the later-public card itself remains visible");
  assert.deepEqual(first.privatePlacementEventIds, new Set(["OLD-PLACEMENT", "OLD-EFFECT"]));
  for (const id of ["OLD-PLACEMENT", "OLD-EFFECT"]) {
    const event = first.events.find((item) => item.id === id);
    assert.equal(Object.hasOwn(event, "cardUid"), false);
  }
  const next = structuredClone(initial);
  next.players.ai.front.push({ uid: "new-visible-uid", id: "STD-020", name: "New Visible", faceDown: false, damage: 0, atk: 2 });
  next.events = [...initial.events.slice(1), { id: "NEW-VISIBLE", type: "card_effect_placed", playerId: "ai", cardUid: "new-visible-uid", placementCause: "effect", to: "front", source: "new" }];
  const transition = planVisualEffects({ querySelectorAll: () => [] }, first, next);
  assert.equal(transition.next.privatePlacementEventIds.has("OLD-PLACEMENT"), false, "evicted IDs are trimmed at the rolling-window boundary");
  assert.equal(transition.next.privatePlacementEventIds.has("OLD-EFFECT"), true, "still-windowed old IDs stay sticky");
  assert.equal(transition.next.events.find((event) => event.id === "OLD-EFFECT").cardUid, undefined);
  assert.equal(transition.effects.some((effect) => effect.sourceEventId === "OLD-EFFECT"), false, "old placements do not replay");
  assert.equal(transition.effects.some((effect) => effect.type === "deploy" && effect.sourceEventId === "NEW-VISIBLE" && effect.uid === "new-visible-uid"), true);
});
