import test from "node:test";
import assert from "node:assert/strict";
import { CARD_LIBRARY, USER_CARDS, createCardInstance } from "../src/data/cards.js";
import { createGame } from "../src/game/engine.js";
import { compileEffectText } from "../src/game/effect-compiler.js";
import { cardHtml, cardDetailHtml, controlsHtml, fortressHtml, renderApp, selectionPanelHtml, sideHtml, uniqueEffectModalHtml, zoneHtml } from "../src/ui/render.js";
import { createSelectionRequest } from "../src/game/selection-model.js";
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

test("board cards show attack readiness, active security and original-relative stat colors", () => {
  const card = createCardInstance("STD-075", "player", 97001);
  const state = auditState(card);
  card.summoningSick = false;
  assert.match(cardHtml(state, "player", card, "front"), /attack-ready/);
  assert.doesNotMatch(cardHtml(state, "player", card, "hand"), /attack-ready|card-security-shield/);
  card.summoningSick = true;
  card.grantedKeywords = ["CONTACT", "SECURITY", "HACKING", "DECOY"];
  const target = createCardInstance("STD-075", "ai", 97002);
  target.sleep = true;
  state.players.ai.front = [target];
  assert.match(cardHtml(state, "player", card, "front"), /attack-ready-contact/);
  card.sleep = true;
  card.tempAtk = 2;
  card.tempStr = -1;
  const html = cardHtml(state, "player", card, "front");
  assert.doesNotMatch(html, /attack-ready/);
  assert.match(html, /security-guard/);
  assert.match(html, /card-security-shield/);
  assert.match(html, /stat-atk stat-up/);
  assert.match(html, /stat-str stat-down/);
  assert.match(html, /能力 [^\"]*セキュリティ[^\"]*コンタクト|能力 [^\"]*コンタクト[^\"]*セキュリティ/);
  assert.equal((html.match(/ability-badge /g) ?? []).length >= 4, true);
  card.sleep = false;
  assert.doesNotMatch(cardHtml(state, "player", card, "front"), /card-security-shield/);
});

test("own hand projects current payment only and Turbo keeps its base plus two limit", () => {
  const state = createGame({ mode: "sandbox", playerUserId: "bigboss", rng: () => 0.5 });
  const hydrateHandCard = (card) => ({ ...card, compiled: compileEffectText(card.text, { id: card.id, category: card.category }) });
  const sp = hydrateHandCard(createCardInstance("STD-010", "player", 97101));
  const ob = hydrateHandCard(createCardInstance("STD-075", "player", 97102));
  const specialSetup = hydrateHandCard(createCardInstance("STD-184", "player", 97103));
  state.players.player.hand = [sp, ob, specialSetup];
  assert.match(cardHtml(state, "player", sp, "hand"), /cost cost-reduced[^>]*aria-label="実行メモリ 1、元の2より減少"[^>]*>1</);
  assert.match(cardHtml(state, "player", ob, "hand"), /cost cost-increased[^>]*aria-label="実行メモリ 2、元の1より増加"[^>]*>2</);
  assert.match(cardHtml(state, "player", specialSetup, "hand"), /cost cost-increased[^>]*aria-label="実行メモリ 4、元の3より増加"[^>]*>4</);
  state.selectedUid = specialSetup.uid;
  assert.match(cardDetailHtml(state), /3-0 Scriptとして設置（MEM 3）/);
  const turbo = createGame({ mode: "sandbox", playerUserId: "doors_zx", rng: () => 0.5 });
  turbo.players.player.turboActive = true;
  assert.match(fortressHtml(turbo, "player"), /memory-limit-turbo[^>]*aria-label="メモリ上限 99 プラス 2"[^>]*>99<i>\+2<\/i>/);
  assert.match(fortressHtml(turbo, "player"), /data-vfx-anchor="fortress-str" data-owner="player"/);
  assert.match(fortressHtml(turbo, "player"), /data-vfx-anchor="combat-result" data-owner="player"/);
  assert.match(fortressHtml(turbo, "player"), /data-vfx-anchor="memory-limit" data-owner="player"/);
  const side = sideHtml(turbo, "player", false);
  assert.match(side, /data-vfx-anchor="deck" data-owner="player"/);
  assert.match(side, /data-vfx-anchor="trash" data-owner="player"/);
  assert.match(side, /data-vfx-anchor="ban" data-owner="player"/);
});

test("unique effect slot labels the user ability without exposing passive activation", () => {
  const turbo = createGame({ mode: "sandbox", playerUserId: "doors_zx", rng: () => 0.5 });
  const ready = controlsHtml(turbo, null, { menuOpen: false, effectsEnabled: true });
  assert.match(ready, /UNIQUE EFFECT/);
  assert.match(ready, /ターボブースト/);
  assert.match(ready, /data-live="unique-effect"/);
  assert.match(ready, /unique-particles/);
  assert.doesNotMatch(ready, /data-action="turbo"/);
  assert.doesNotMatch(controlsHtml(turbo, null, { menuOpen: false, effectsEnabled: false }), /unique-particles/);
  const modal = uniqueEffectModalHtml(turbo, "player");
  assert.match(modal, /次の自ターン開始時までメモリ上限を2増やす/);
  assert.match(modal, /data-action="turbo"[^>]*>起動/);
  turbo.players.player.turboUsed = true;
  assert.match(uniqueEffectModalHtml(turbo, "player"), /data-action="turbo"[^>]*disabled/);
  const passive = createGame({ mode: "sandbox", playerUserId: "suckintosh", rng: () => 0.5 });
  const automatic = controlsHtml(passive, null, { menuOpen: false });
  assert.match(automatic, /モノカラー・ユナイト/);
  assert.match(uniqueEffectModalHtml(passive, "player"), /条件を満たすと自動で処理/);
  assert.doesNotMatch(uniqueEffectModalHtml(passive, "player"), /data-action="turbo"/);
});

test("access candidates render as scrollable card models without changing selection ids", () => {
  const state = auditState();
  const first = createCardInstance("STD-075", "player", 94001);
  const second = createCardInstance("STD-040", "player", 94002);
  state.players.player.deck = [first, second];
  const request = createSelectionRequest({ mode: "single", candidates: [first.uid, second.uid], count: 1,
    label: "アクセスするカードを選択", candidateLabels: { [first.uid]: first.name, [second.uid]: second.name } });
  request.selected = [second.uid];
  state.pending = { type: "selection", request };
  const before = JSON.stringify(state);
  const html = selectionPanelHtml(state);
  assert.match(html, /selection-panel-cards/);
  assert.match(html, /selection-card-grid/);
  assert.equal((html.match(/class="selection-card /g) ?? []).length, 2);
  assert.ok(html.includes(`data-selection-option="${first.uid}"`));
  assert.ok(html.includes(`data-selection-option="${second.uid}" aria-pressed="true"`));
  assert.equal(JSON.stringify(state), before);
});

test("selection never reveals a hidden opponent card model", () => {
  const state = auditState();
  const hidden = createCardInstance("STD-075", "ai", 94003);
  state.players.ai.hand = [hidden];
  state.pending = { type: "selection", request: createSelectionRequest({ mode: "single", candidates: [hidden.uid],
    candidateLabels: { [hidden.uid]: "相手の手札" } }) };
  const html = selectionPanelHtml(state);
  assert.ok(html.includes("相手の手札"));
  assert.ok(!html.includes("selection-card-grid"));
  assert.ok(!html.includes(hidden.name));
});

test("component inspector projects icons, counts and expiry without mutating state", () => {
  const card = createCardInstance("STD-075", "player", 93001);
  Object.assign(card, {
    grantedKeywords: ["Security", "SECURITY", "<unknown>"], load: 2,
    counters: { madness: 3, poison: 2, empty: 0 }, protect: 2, backup: 1,
    tempAtk: 2, permanentStr: 1,
    timedModifiers: [{ keyword: "HACKING", atk: 1, expiresAfterTurn: 4 }, { keyword: "EXPIRED", expiresAfterTurn: 2 }],
    damageModifiers: [{ direction: "received", damageKind: "battle", operation: "set", amount: 0, duration: "turn", activeTurn: 4 }]
  });
  const state = auditState(card);
  state.turnNumber = 4; state.selectedUid = card.uid;
  const before = JSON.stringify(state);
  const rows = runtimeComponents(card, 4);
  assert.equal(rows.filter((row) => row.label === "セキュリティ").length, 1);
  assert.ok(rows.find((row) => row.label === "セキュリティ").asset.endsWith("security.png"));
  assert.ok(rows.some((row) => row.label === "負荷" && row.value === "×2" && row.asset.endsWith("load_purple.png")));
  assert.ok(rows.some((row) => row.label === "狂気" && row.value === "×3" && row.asset === null));
  assert.ok(rows.some((row) => row.label === "プロテクト" && row.value === "残り2回"));
  assert.ok(rows.some((row) => row.label === "ハッキング" && row.note === "付与・T4終了まで"));
  assert.ok(rows.some((row) => row.label === "受ける戦闘ダメージ" && row.value === "0に固定"));
  const html = cardDetailHtml(state, "", false);
  assert.ok(html.indexOf("effect-text-section") < html.indexOf("component-list"));
  assert.match(html, /&lt;UNKNOWN&gt;/);
  assert.doesNotMatch(html, /EXPIRED|<unknown>|<UNKNOWN>/);
  assert.equal(JSON.stringify(state), before);
  const next = runtimeComponents(card, 5);
  assert.ok(!next.some((row) => row.label === "ハッキング" || row.label === "受ける戦闘ダメージ"));
});

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

test("user inspector exposes user counters below its ability text", () => {
  const state = auditState();
  state.selectedUid = "player-user-card";
  state.players.player.counters = { madness: 2 };
  const html = cardDetailHtml(state);
  assert.match(html, /狂気/);
  assert.match(html, /×2/);
  assert.ok(html.indexOf("ユーザー能力") < html.indexOf("component-list"));
});

test("detail class tags split slash-delimited values without changing card data", () => {
  const card = createCardInstance("STD-020", "player", 93002);
  const state = auditState(card);
  state.selectedUid = card.uid;
  for (const value of [["連合軍", "ノイド"], [" 連合軍 / ノイド ", "連合軍"], "連合軍／ノイド"]) {
    card.classes = value;
    const before = JSON.stringify(card);
    const html = cardDetailHtml(state, "", false);
    assert.match(html, /<span class="detail-class-tag">連合軍<\/span><span class="detail-class-tag">ノイド<\/span>/);
    assert.equal(JSON.stringify(card), before);
  }
  card.classes = " / ／ ";
  assert.match(cardDetailHtml(state, "", false), /class="detail-class" data-empty="true"/);
  card.classes = ["<img onerror=bad>/ノイド"];
  assert.match(cardDetailHtml(state, "", false), /detail-class-tag">&lt;img onerror=bad&gt;/);
});

test("all 214 STD cards render through the common card shell", () => {
  const ids = Object.keys(CARD_LIBRARY).filter((id) => /^STD-\d{3}$/.test(id));
  assert.equal(ids.length, 214);
  for (const [index, id] of ids.entries()) {
    const card = createCardInstance(id, "player", index + 1);
    const html = cardHtml(auditState(card), "player", card, "front");
    assert.match(html, new RegExp(`data-card-id="${id}"`));
    assert.ok(html.includes(card.name), `${id} name was not rendered`);
    assert.ok(html.length > 100, `${id} produced an empty shell`);
  }
});

test("all public user cards render without a fixed zone-limit assumption", () => {
  const entries = Object.entries(USER_CARDS);
  assert.ok(entries.length > 0);
  for (const [id, user] of entries) {
    const state = auditState();
    state.players.player.user = user;
    state.players.player.fortressStr = user.maxStr;
    const html = fortressHtml(state, "player");
    assert.ok(html.includes(user.name), `${id} name was not rendered`);
    assert.match(html, /data-fortress="player"/);
    const front = zoneHtml(state, "player", "front", "FRONT");
    const back = zoneHtml(state, "player", "back", "BACK");
    assert.match(front, new RegExp(`data-zone-capacity="${user.frontLimit}"`));
    assert.match(back, new RegExp(`data-zone-capacity="${user.backLimit}"`));
    assert.equal((front.match(/data-slot-index=/g) ?? []).length, user.frontLimit, `${id} front slots`);
    assert.equal((back.match(/data-slot-index=/g) ?? []).length, user.backLimit, `${id} back slots`);
  }
});

test("zone rendering keeps UID, zone, layered depth, and hidden-state separation", () => {
  const card = createCardInstance("STD-075", "player", 1);
  card.mounted = [1, 2, 3, 4].map((serial) => createCardInstance("STD-078", "player", serial));
  const state = auditState(card);
  const html = zoneHtml(state, "player", "front", "FRONT");
  assert.match(html, new RegExp(`data-card-uid="${card.uid}"`));
  assert.match(html, /data-zone="front"/);
  assert.match(html, /LAYER 5/);

  const hidden = createCardInstance("STD-075", "ai", 1);
  hidden.category = "Script";
  hidden.faceDown = true;
  state.players.ai.back = [hidden];
  state.mode = "ai";
  const hiddenHtml = zoneHtml(state, "ai", "back", "BACK");
  assert.match(hiddenHtml, /aria-label="裏向きカード"/);
  assert.match(hiddenHtml, /back-peek-label">裏面</);
  assert.doesNotMatch(hiddenHtml, new RegExp(hidden.name));
});

test("zone rendering projects stable board slots and does not mutate legacy fixtures", () => {
  const legacy = createCardInstance("STD-020", "player", 9101);
  const fixed = createCardInstance("STD-021", "player", 9102);
  Object.assign(fixed, { boardSlot: 3, boardSlotController: "player", boardSlotZone: "front" });
  const state = auditState();
  state.players.player.front = [legacy, fixed];
  const before = structuredClone(state.players.player.front);
  const html = zoneHtml(state, "player", "front", "FRONT");
  assert.match(html, new RegExp(`data-slot-index="1"[^]*?data-card-uid="${legacy.uid}"`));
  assert.match(html, /data-slot-index="2"><span class="slot-label">FRONT 2<small>EMPTY<\/small><\/span>/);
  assert.match(html, new RegExp(`data-slot-index="3"[^]*?data-card-uid="${fixed.uid}"`));
  assert.deepEqual(state.players.player.front, before);
});

test("card shell escapes text and does not leak hidden card data", () => {
  const card = createCardInstance("STD-075", "player", 1);
  Object.assign(card, { id: "AUDIT-XSS", name: '<img src=x onerror="alert(1)">', text: "<script>alert(1)</script> & text" });
  const state = auditState(card);
  const visible = cardHtml(state, "player", card, "hand");
  assert.doesNotMatch(visible, /<script>|<img src=x/);
  assert.match(visible, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; text/);
  assert.match(visible, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  const hidden = cardHtml(state, "ai", card, "hand", { hidden: true });
  assert.equal(hidden, '<div class="card card-back" aria-label="非公開の手札"></div>');
  assert.doesNotMatch(hidden, /AUDIT-XSS|alert|STD-075/);
});

test("card shell keeps long content, all colors, and unknown keyword fallback", () => {
  const expected = new Map([["赤", "red"], ["黄", "yellow"], ["紫", "purple"], ["青", "blue"], ["橙", "orange"], ["黒", "black"], ["緑", "green"]]);
  for (const [color, className] of expected) {
    const source = Object.keys(CARD_LIBRARY).find((id) => CARD_LIBRARY[id].color === color);
    assert.ok(source, `${color} card fixture is unavailable`);
    const card = createCardInstance(source, "player", 1);
    assert.match(cardHtml(auditState(card), "player", card, "front"), new RegExp(`color-${className}`));
  }
  const card = createCardInstance("STD-075", "player", 2);
  card.name = "長".repeat(120);
  card.text = "本文".repeat(600);
  card.compiled = { ...card.compiled, keywords: [{ name: "UNKNOWN_ABILITY", value: 7 }] };
  const html = cardHtml(auditState(card), "player", card, "front");
  assert.ok(html.includes(card.name));
  assert.ok(html.includes(card.text));
  assert.match(html, /ability-badge-text[^>]*>UNKNOWN_ABILITY:7</);
});

test("normal-capable if Scripts expose activation while event-dependent copies remain waiting", () => {
  const root = { innerHTML: "" };
  const state = auditState();
  const normal = createCardInstance("STD-036", "player", 91001);
  normal.compiled = compileEffectText(normal.text, { id: normal.id, category: normal.category });
  normal.faceDown = true;
  state.players.player.back = [normal];
  state.selectedUid = normal.uid;
  renderApp(root, state, null, {});
  assert.match(root.innerHTML, /data-action="activate-script"/);

  const eventOnly = createCardInstance("STD-018", "player", 91002);
  eventOnly.compiled = compileEffectText(eventOnly.text, { id: eventOnly.id, category: eventOnly.category });
  eventOnly.faceDown = true;
  state.players.player.back = [eventOnly];
  state.selectedUid = eventOnly.uid;
  renderApp(root, state, null, {});
  assert.doesNotMatch(root.innerHTML, /data-action="activate-script"/);
  assert.match(root.innerHTML, /if待機/);
});

test("STD-148 exposes normal activation only while face-down", () => {
  const root = { innerHTML: "" };
  const state = auditState();
  const source = createCardInstance("STD-148", "player", 91003);
  source.compiled = compileEffectText(source.text, { id: source.id, category: source.category });
  source.faceDown = true; state.players.player.back = [source]; state.selectedUid = source.uid;
  renderApp(root, state, null, {});
  assert.match(root.innerHTML, /data-action="activate-script"/);
  state.effectResolution = { id: "EFFECT-UI-BLOCK", kind: "test", status: "resolving" };
  renderApp(root, state, null, {});
  assert.doesNotMatch(root.innerHTML, /data-action="activate-script"/);
  state.effectResolution = null;
  source.faceDown = false; source.residentActive = true;
  renderApp(root, state, null, {});
  assert.doesNotMatch(root.innerHTML, /data-action="activate-script"/);
});
