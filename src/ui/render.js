import { canAttack, canExecuteRegistryCard, canOpeningMulligan, cardAtk, cardCurrentStr, cardHasKeyword, currentTutorialPresentation, currentTutorialStep, enabledSymbols, findCard, getActivatableEffects, getAttackTargets, getMaxMemory, spellNeedsTarget } from "../main-exports.js";
import { hasKeyword, keywordValue } from "../game/effect-compiler.js";
import { CARD_LIBRARY, LAB_CARD_IDS, USER_CARDS } from "../data/cards.js";
import { canConfirmSelection } from "../game/selection-model.js";
import { BUILDABLE_CARDS, DECK_COLOR_OPTIONS, DECK_STRATEGIES, MAX_SAVED_DECKS, validateDeck } from "../game/deck-builder.js";
import { CARD_ART } from "../data/card-art.generated.js";
import { cardArtProfile } from "../data/card-art-profiles.js";
import { abilityBadgeDefinition, normalizeAbilityName } from "../data/ability-badges.js";
import { tutorialNavigator } from "../data/navigator-assets.js";
import { projectZoneSlots } from "../game/board-slots.js";
import { runtimeComponents } from "./runtime-components.js";
import { isObCard } from "../game/card-types.js";
import { visibleHandExecutionPayment } from "../game/engine.js";
import { deckPresentation } from "./deck-presentation.js";
import { abilityTextHtml, cardEffectHtml } from "./ability-help.js";

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const colorClass = (color) => ({ 赤: "red", 黄: "yellow", 紫: "purple", 青: "blue", 橙: "orange", 黒: "black", 緑: "green" })[color] ?? "neutral";

function handExecutionCostProjection(state, playerId, card, zone) {
  const printed = Math.max(0, Number(card.cost ?? 0));
  const payment = zone === "hand" ? visibleHandExecutionPayment(state, playerId, card) : null;
  if (!payment) return { value: printed, trend: "base", aria: `実行メモリ ${printed}` };
  const value = payment.value;
  const trend = value < printed ? "reduced" : value > printed ? "increased" : "base";
  const change = trend === "reduced" ? `元の${printed}より減少` : trend === "increased" ? `元の${printed}より増加` : "元の値と同じ";
  return { value, trend, aria: `実行メモリ ${value}、${change}` };
}

// Display-only compatibility with both array data and slash-delimited sheet values.
function detailClasses(value) {
  const entries = Array.isArray(value) ? value : [value];
  return [...new Set(entries.flatMap((entry) => String(entry ?? "").split(/[/／]/)).map((entry) => entry.trim()).filter(Boolean))];
}

export function deckOptionsHtml(state, selectedId) {
  const fixed = [["red","赤・固定"],["yellow","黄・固定"],["vengeance","紫・固定"],["neutron","青・固定"]];
  return [...fixed.map(([id, label]) => `<option value="${id}" ${selectedId === id ? "selected" : ""}>${label}</option>`),
    ...(state.savedDecks ?? []).map((deck) => `<option value="custom:${esc(deck.id)}" ${selectedId === `custom:${deck.id}` ? "selected" : ""} ${validateDeck(deck).valid ? "" : "disabled"}>保存: ${esc(deck.name)}${validateDeck(deck).valid ? "" : "（要修正）"}</option>`)].join("");
}

function deckThumbnailHtml(card, className = "deck-card-thumbnail") {
  const hasArt = Boolean(CARD_ART[card.id]);
  return `<span class="${className} color-${colorClass(card.color)} ${hasArt ? "has-art" : ""}">
    ${cardArtHtml(card, "deck-card-art")}
    ${hasArt ? "" : `<span class="deck-card-art-placeholder">${esc(card.name.slice(0, 1))}</span>`}
    <b class="deck-card-cost" aria-label="メモリ ${esc(card.cost)}">${esc(card.cost)}</b>
    <strong class="deck-card-thumbnail-name">${esc(card.name)}</strong>
  </span>`;
}

export function deckBuilderHtml(state, options = {}) {
  const ui = state.deckBuilder;
  if (!ui?.open) return "";
  const draft = ui.draft;
  const check = validateDeck(draft);
  const query = String(ui.query ?? "").toLowerCase();
  const cards = BUILDABLE_CARDS.filter((card) => (ui.color === "all" || String(card.color ?? "無色") === ui.color)
    && (!query || `${card.id} ${card.name}`.toLowerCase().includes(query)));
  const html = `<div class="effect-modal deck-builder-modal"><section class="deck-builder">
    <header><div><span>DECK BUILDER</span><h2>保存デッキ ${state.savedDecks.length}/${MAX_SAVED_DECKS}</h2></div><button data-deck-close>閉じる</button></header>
    <div class="deck-builder-toolbar">
      <select data-deck-load><option value="">新規デッキ</option>${state.savedDecks.map((deck) => `<option value="${esc(deck.id)}" ${draft.id === deck.id ? "selected" : ""}>${esc(deck.name)}${validateDeck(deck).valid ? "" : "（要修正）"}</option>`).join("")}</select>
      <input data-deck-name value="${esc(draft.name)}" maxlength="40" aria-label="デッキ名">
      <select data-deck-user>${Object.entries(USER_CARDS).map(([id,user]) => `<option value="${id}" ${draft.userId === id ? "selected" : ""}>${esc(user.name)}</option>`).join("")}</select>
      <button data-deck-new>新規</button><button data-deck-save class="primary" ${check.valid ? "" : 'disabled title="構築規定を満たしてから保存できます"'}>保存</button><button data-deck-delete ${state.savedDecks.some((deck) => deck.id === draft.id) ? "" : "disabled"}>削除</button>
      <button data-deck-export>JSON出力</button><label class="deck-import">JSON読込<input type="file" accept="application/json" data-deck-import></label>
    </div>
    <div class="deck-validation ${check.valid ? "valid" : "invalid"}" role="status"><b>${check.valid ? "構築OK" : "構築未完了"}</b><span>構築枚数 ${check.count}/${check.rule.size}枚・同名${check.rule.sameName}枚まで${check.errors.length ? ` / ${esc(check.errors.join(" / "))}` : ""}</span></div>
    <section class="deck-recommender"><b>AUTO BUILD</b><select data-deck-recommend-color>${DECK_COLOR_OPTIONS.filter((color) => color !== "無色").map((color) => `<option value="${color}" ${ui.recommendColor === color ? "selected" : ""}>${color}</option>`).join("")}</select><select data-deck-strategy>${Object.entries(DECK_STRATEGIES).map(([id,label]) => `<option value="${id}" ${ui.strategy === id ? "selected" : ""}>${label}</option>`).join("")}</select><button data-deck-recommend class="primary">推奨構築を生成</button><span>${esc(ui.recommendationNote ?? "色と戦術から完成デッキを生成する。")}</span></section>
    <div class="deck-builder-tools"><input data-deck-query value="${esc(ui.query ?? "")}" placeholder="カード名 / ID"><select data-deck-color>${["all", ...DECK_COLOR_OPTIONS].map((color) => `<option value="${color}" ${ui.color === color ? "selected" : ""}>${color === "all" ? "全色" : color}</option>`).join("")}</select></div>
    <div class="deck-builder-body"><div class="deck-card-list">${cards.map((card) => { const count = Number(draft.cards[card.id] ?? 0); return `<article class="deck-catalog-card" data-deck-card-id="${esc(card.id)}">
        ${deckThumbnailHtml(card)}
        <span class="deck-card-meta"><b>${esc(card.id)}</b><small>${esc(card.color ?? "無色")} / ${esc(card.category)}</small></span>
        <div class="deck-count-stepper" aria-label="${esc(card.name)}の投入枚数"><button data-deck-minus="${esc(card.id)}" ${count ? "" : "disabled"} aria-label="${esc(card.name)}を1枚減らす">−</button><b>${count}</b><button data-deck-plus="${esc(card.id)}" aria-label="${esc(card.name)}を1枚増やす">＋</button></div>
      </article>`; }).join("")}</div>
      <aside class="deck-summary"><h3>デッキ内容</h3><div class="deck-summary-list">${Object.entries(draft.cards).filter(([,count]) => count > 0).sort(([a],[b]) => a.localeCompare(b, undefined, {numeric:true})).map(([id,count]) => { const card = CARD_LIBRARY[id]; return card ? `<article class="deck-summary-card" data-deck-summary-id="${esc(id)}">${deckThumbnailHtml(card, "deck-summary-thumbnail")}<span><b>${count}枚</b><small>${esc(id)}</small></span></article>` : `<article class="deck-summary-card"><span class="deck-summary-missing">${esc(id)}</span><span><b>${count}枚</b><small>${esc(id)}</small></span></article>`; }).join("") || "<p class=\"deck-empty\">カードなし</p>"}</div></aside></div>
  </section></div>`;
  return deckPresentation(html, state, options);
}

function keywords(card) {
  return card.compiled?.keywords?.map((item) => item.value ? `${item.name}:${item.value}` : item.name) ?? [];
}

function activeAbilityEntries(card) {
  const entries = (card.compiled?.keywords ?? []).map(({ name, value }) => ({ name: normalizeAbilityName(name), value }));
  for (const name of card.grantedKeywords ?? []) entries.push({ name: normalizeAbilityName(name), value: null });
  if (Number(card.load ?? 0) > 0) entries.push({ name: "LOAD", value: Number(card.load) });
  if (Number(card.backup ?? 0) > 0) entries.push({ name: "BACKUP", value: Number(card.backup) });
  if (Number(card.protect ?? 0) > 0) entries.push({ name: "PROTECT", value: Number(card.protect) });
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.name}:${entry.value ?? ""}`;
    if (!entry.name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const FIELD_ABILITY_KEYS = ["SECURITY", "CONTACT", "HACKING", "ENCRYPTION", "DECOY", "PROTECT", "QA"];

function abilityBadgesHtml(card, maximum = 3, state = null, playerId = null) {
  const entries = activeAbilityEntries(card);
  if (state && playerId) {
    for (const name of FIELD_ABILITY_KEYS) {
      if (cardHasKeyword(state, playerId, card, name) && !entries.some((entry) => entry.name === name)) {
        entries.push({ name, value: null });
      }
    }
  }
  const visible = entries.slice(0, maximum);
  const badges = visible.map((entry) => {
    const definition = abilityBadgeDefinition(entry.name);
    const label = `${definition.label}${entry.value !== null && entry.value !== undefined && entry.value !== "" ? `:${entry.value}` : ""}`;
    return definition.asset
      ? `<span class="ability-badge ability-badge-image-wrap" title="${esc(label)}"><img class="ability-badge-image" src="${esc(definition.asset)}" alt="${esc(label)}" loading="lazy" decoding="async"></span>`
      : `<span class="ability-badge ability-badge-text" title="${esc(label)}">${esc(label)}</span>`;
  }).join("");
  const overflow = entries.length > maximum ? `<span class="ability-badge ability-badge-more" title="${esc(entries.slice(maximum).map((entry) => abilityBadgeDefinition(entry.name).label).join(" / "))}">+${entries.length - maximum}</span>` : "";
  return `<div class="ability-badges" aria-label="能力 ${esc(entries.map((entry) => abilityBadgeDefinition(entry.name).label).join("、") || "なし")}">${badges}${overflow}</div>`;
}

function cardArtHtml(card, className, { full = false } = {}) {
  const src = CARD_ART[card.id];
  if (!src) return "";
  const profile = cardArtProfile(card);
  const style = full ? "" : ` style="--art-focus-x:${profile.focusX}%;--art-focus-y:${profile.focusY}%;--art-zoom:${profile.zoom}"`;
  return `<img class="${className}" src="${esc(src)}" alt="" loading="lazy" decoding="async"${style}>`;
}

function detailArtworkHtml(card) {
  const profile = cardArtProfile(card);
  const classes = `detail-art color-${colorClass(card.color)} art-${profile.orientation} ${CARD_ART[card.id] ? "has-art" : ""}`;
  const contents = `${cardArtHtml(card, "detail-art-image")}<span>${CARD_ART[card.id] ? "ARTWORK / EXPAND" : "ARTWORK / TEMP"}</span><b>${esc(card.name.slice(0, 1))}</b><small>${esc(card.id)}</small>`;
  return CARD_ART[card.id]
    ? `<button type="button" class="${classes}" data-art-preview-open="${esc(card.uid)}" aria-label="${esc(card.name)}のカード画像を拡大表示">${contents}</button>`
    : `<div class="${classes}">${contents}</div>`;
}

function signed(value) {
  const number = Number(value ?? 0);
  return number > 0 ? `+${number}` : String(number);
}

function runtimeDetailHtml(state, playerId, card) {
  const components = runtimeComponents(card, state.turnNumber);
  const modifiers = [];
  if (isObCard(card)) {
    const currentAtk = cardAtk(state, playerId, card);
    const currentStr = cardCurrentStr(state, playerId, card);
    const printedAtk = Number(card.atk ?? 0);
    const printedStr = Number(card.str ?? 0);
    if (currentAtk !== printedAtk) modifiers.unshift(`ATK ${printedAtk} → ${currentAtk}（${signed(currentAtk - printedAtk)}）`);
    if (currentStr !== printedStr || Number(card.damage ?? 0)) modifiers.unshift(`STR 現在${currentStr} / 基礎${printedStr}${Number(card.damage ?? 0) ? ` / ダメージ${Number(card.damage)}` : ""}`);
  }
  if (!components.length && !modifiers.length) return '<p class="runtime-empty">付与・変動なし</p>';
  return `${components.length ? `<ul class="component-list" aria-label="付与コンポーネントと能力残数">${components.map((item) => `<li class="component-tile ${item.tone ? `component-${item.tone}` : ""}">
    ${item.asset ? `<img class="component-icon" src="${esc(item.asset)}" alt="" loading="lazy" decoding="async">` : ""}
    <span class="component-copy"><span class="component-heading"><span class="component-label">${esc(item.label)}</span>${item.value ? `<b>${esc(item.value)}</b>` : ""}</span>${item.note ? `<small>${esc(item.note)}</small>` : ""}</span>
  </li>`).join("")}</ul>` : ""}${modifiers.length ? `<div class="component-summary" aria-label="現在値の変動">${modifiers.map((item) => `<p>${esc(item)}</p>`).join("")}</div>` : ""}`;
}

export function cardHtml(state, playerId, card, zone, { hidden = false } = {}) {
  if (hidden) return state.viewerId && state.pending?.validTargets?.includes(card.uid)
    ? `<button class="card card-back targetable" data-card-uid="${esc(card.uid)}" aria-label="裏向きカードを対象に選択"></button>`
    : `<div class="card card-back" aria-label="${zone === "hand" ? "非公開の手札" : "裏向きカード"}"></div>`;
  const selected = state.selectedUid === card.uid;
  const validTarget = state.pending?.validTargets?.includes(card.uid);
  const materialSelected = state.pending?.type === "layered-select" && state.pending.selectedTargets?.includes(card.uid);
  const effectSelected = (state.pending?.type === "effect-target-multi" && state.pending.selectedTargets?.includes(card.uid))
    || (state.pending?.type === "selection" && state.pending.request?.selected?.includes(card.uid));
  const current = isObCard(card) ? cardCurrentStr(state, playerId, card) : null;
  const currentAtk = isObCard(card) ? cardAtk(state, playerId, card) : null;
  const atkTrend = isObCard(card) ? Math.sign(currentAtk - Number(card.atk ?? 0)) : 0;
  const strTrend = isObCard(card) ? Math.sign(current - Number(card.str ?? 0)) : 0;
  const trendName = (value) => value > 0 ? "up" : value < 0 ? "down" : "base";
  const statChanged = atkTrend !== 0 || strTrend !== 0;
  const stats = isObCard(card) ? `<div class="stats ${statChanged ? "modified" : ""}" aria-label="現在ATK ${currentAtk}、現在STR ${current}"><span class="stat stat-atk stat-${trendName(atkTrend)}" title="元々のATK ${esc(card.atk ?? 0)}"><small>ATK</small><b>${currentAtk}</b></span><span class="stat stat-str stat-${trendName(strTrend)}" title="元々のSTR ${esc(card.str ?? 0)}"><small>STR</small><b>${current}</b></span></div>` : "";
  const onField = zone === "front" || zone === "back";
  const attackReady = zone === "front" && !state.pending && !state.prompt && !state.effectResolution && !state.securityRestWindow && !state.winner && !state.victory?.lockedOutcome && canAttack(state, playerId, card);
  const contactReady = attackReady && card.summoningSick && cardHasKeyword(state, playerId, card, "CONTACT");
  const securityGuard = zone === "front" && card.sleep && cardHasKeyword(state, playerId, card, "SECURITY");
  const shield = securityGuard ? '<span class="card-security-shield" aria-hidden="true"><svg viewBox="0 0 80 96" focusable="false"><path d="M40 4 72 17v30c0 21-13 35-32 45C21 82 8 68 8 47V17Z"/><path d="M40 12 64 22v25c0 16-9 27-24 36C25 74 16 63 16 47V22Z"/><path d="M40 17v61M22 47h36"/></svg></span>' : "";
  const mounted = card.mounted?.length ? `<div class="mounted">LAYER ${card.mounted.length + 1}</div>` : "";
  const analysis = card.compiled?.status ?? "manual";
  const art = cardArtHtml(card, "card-art-image");
  const cost = handExecutionCostProjection(state, playerId, card, zone);
  return `
    <button class="card color-${colorClass(card.color)} ${card.sleep ? "sleep" : ""} ${card.faceDown ? "face-down-set" : ""} ${card.residentActive ? "resident-active" : ""} ${attackReady ? contactReady ? "attack-ready-contact" : "attack-ready" : ""} ${securityGuard ? "security-guard" : ""} ${selected ? "selected" : ""} ${validTarget ? "targetable" : ""} ${materialSelected || effectSelected ? "material-selected" : ""}"
      data-card-uid="${esc(card.uid)}" data-card-id="${esc(card.id)}" data-category="${esc(card.category)}" data-owner="${playerId}" data-zone="${zone}" title="${esc(card.text)}">
      <div class="card-top"><span class="cost cost-${cost.trend}" data-vfx-anchor="hand-cost" data-owner="${playerId}" data-zone="${zone}" aria-label="${esc(cost.aria)}">${esc(cost.value)}</span><span class="category">${esc(card.category)}</span></div>
      <div class="card-visual ${art ? "has-art" : "no-art"}">${art || `<span class="card-art-placeholder">${esc(card.name.slice(0, 1))}</span>`}</div>
      <strong class="card-name">${esc(card.name)}</strong>
      ${abilityBadgesHtml(card, onField ? 8 : 3, onField ? state : null, onField ? playerId : null)}
      <p class="card-rules-preview">${esc(card.text)}</p>
      ${mounted}${stats}${shield}
      <span class="analysis analysis-${analysis}">${analysis}</span>
    </button>`;
}

export function zoneHtml(state, playerId, zoneName, label) {
  const cards = state.players[playerId][zoneName];
  const configuredLimit = Number(state.players[playerId].user?.[`${zoneName}Limit`]);
  const limit = Number.isFinite(configuredLimit) ? Math.max(0, Math.floor(configuredLimit)) : cards.length;
  const projection = projectZoneSlots(cards, { controllerId: playerId, zoneName, limit });
  const slots = projection.map((card, index) => {
    const viewer = state.viewerId ?? (state.mode === "sandbox" ? state.sandboxUi?.actor ?? "player" : "player");
    const hidden = Boolean(card && playerId !== viewer && card.faceDown);
    const content = card
      ? cardHtml(state, playerId, card, zoneName, { hidden })
      : `<span class="slot-label">${label} ${index + 1}<small>EMPTY</small></span>`;
    const peekLabel = zoneName === "back"
      ? `<span class="back-peek-label">${card ? (hidden ? "裏面" : esc(card.name)) : `${label} ${index + 1}`}</span>`
      : "";
    return `<div class="board-slot ${card ? "occupied" : "vacant"} ${index >= limit ? "over-cap" : ""}" data-slot-index="${index + 1}">${content}${peekLabel}</div>`;
  }).join("");
  return `<section class="zone zone-${zoneName}" data-player="${playerId}" data-zone-capacity="${limit}"><header>${label}<small>${cards.length}/${limit}</small></header><div class="zone-cards" style="--zone-capacity:${Math.max(1, limit)}">
    ${slots || '<span class="empty zone-disabled">NO SLOTS</span>'}
  </div></section>`;
}

export function fortressHtml(state, playerId) {
  const player = state.players[playerId];
  const validTarget = state.pending?.validTargets?.includes(`${playerId}-fortress`);
  const selected = state.selectedUid === `${playerId}-user-card`;
  const maxMemory = getMaxMemory(player);
  const turboBaseMemory = player.turboActive ? Math.max(0, maxMemory - 2) : maxMemory;
  const memoryLimit = player.turboActive
    ? `<span class="memory-limit-turbo" aria-label="メモリ上限 ${turboBaseMemory} プラス 2">${turboBaseMemory}<i>+2</i></span>`
    : String(maxMemory);
  return `<button class="fortress compact-fortress ${validTarget ? "targetable" : ""} ${selected ? "selected" : ""}" data-fortress="${playerId}" data-vfx-anchor="combat-result" data-owner="${playerId}">
    <strong>${esc(player.user.name)}</strong>
    <div class="fortress-stats"><span>STR <b data-vfx-anchor="fortress-str" data-owner="${playerId}">${player.fortressStr}</b>/${player.user.maxStr}</span><span>MEM <b data-vfx-anchor="fortress-memory" data-owner="${playerId}">${player.memory}</b>/<span data-vfx-anchor="memory-limit" data-owner="${playerId}">${memoryLimit}</span></span></div>
  </button>`;
}

function adminButtonHtml(state, playerId, zoneName) {
  const player = state.players[playerId];
  const cards = player[zoneName];
  const label = zoneName === "trash" ? "ゴミ箱" : "レジストリ";
  const isOpen = state.openAdmin?.playerId === playerId && state.openAdmin?.zoneName === zoneName;
  const symbols = zoneName === "registry" ? enabledSymbols(player) : [];
  const spent = zoneName === "registry" && player.registryActionUsed;
  return `<button class="admin-zone-button ${isOpen ? "active" : ""} ${spent ? "spent" : ""}" data-admin-zone="${zoneName}" data-owner="${playerId}">
    <span>${label}</span><b data-vfx-anchor="${zoneName}" data-owner="${playerId}">${cards.length}</b>
    ${symbols.length ? `<i class="signal-badges">${symbols.map((color) => `<i class="signal-dot color-${colorClass(color)}" title="${esc(color)}シンボル"></i>`).join("")}</i>` : ""}
    ${spent ? '<small>操作権使用済</small>' : ""}
  </button>`;
}

export function sideHtml(state, playerId, isOpponent) {
  const player = state.players[playerId];
  const firstZone = isOpponent ? zoneHtml(state, playerId, "back", "BACK") : zoneHtml(state, playerId, "front", "FRONT");
  const nearZone = isOpponent ? zoneHtml(state, playerId, "front", "FRONT") : zoneHtml(state, playerId, "back", "BACK");
  return `<section class="side ${isOpponent ? "opponent" : "human"}">
    <div class="side-head">
      <div><span>${isOpponent ? "AI" : "YOU"} / ${esc(player.user.color)}</span><strong>${esc(player.user.name)}</strong></div>
      <div class="resource-line"><span data-vfx-anchor="hand" data-owner="${playerId}">HAND ${player.hand.length}</span><span data-vfx-anchor="deck" data-owner="${playerId}">DECK ${player.deck.length}</span><span data-vfx-anchor="trash" data-owner="${playerId}">TRASH ${player.trash.length}</span><span data-vfx-anchor="ban" data-owner="${playerId}">BAN ${player.ban.length}</span></div>
    </div>
    ${firstZone}
    <div class="admin-row">
      ${adminButtonHtml(state, playerId, "trash")}
      ${fortressHtml(state, playerId)}
      ${adminButtonHtml(state, playerId, "registry")}
      <div class="deck-stack" data-vfx-anchor="deck" data-owner="${playerId}"><span>DECK</span><b>${player.deck.length}</b></div>
    </div>
    ${nearZone}
  </section>`;
}

export function handCardsHtml(state, playerId) {
  const hand = state.players[playerId].hand;
  const center = (hand.length - 1) / 2;
  return hand.map((card, index) => {
      const offset = index - center;
      const rotate = Math.max(-8, Math.min(8, offset * 2.2));
      const sink = Math.min(12, Math.abs(offset) * 2.2);
      return `<div class="hand-card" style="--hand-rotate:${rotate}deg;--hand-sink:${sink}px">${cardHtml(state, playerId, card, "hand")}</div>`;
    }).join("") || '<span class="empty">手札なし</span>';
}

function handHtml(state, mobileUi = {}) {
  const playerId = state.mode === "sandbox" ? (state.sandboxUi?.actor ?? "player") : "player";
  return `<section class="hand ${mobileUi.handOpen ? "mobile-open" : ""}"><button class="mobile-hand-toggle" data-mobile-hand-toggle aria-expanded="${mobileUi.handOpen ? "true" : "false"}">${mobileUi.handOpen ? "手札を格納" : `手札 ${state.players[playerId].hand.length}枚`}</button><header>${playerId === "player" ? "YOUR" : "OPPONENT"} HAND <small>${state.players[playerId].hand.length}</small></header><div class="hand-scroll">
    ${handCardsHtml(state, playerId)}
  </div></section>`;
}

function expansionOf(cardId) {
  return String(cardId).split("-")[0].toUpperCase();
}

export function sandboxCatalogHtml(state) {
  if (!["lab", "sandbox"].includes(state.mode)) return "";
  const ui = state.sandboxUi ?? { query: "", expansion: "all", catalogOwner: "player" };
  const query = ui.query.trim().toLowerCase();
  const expansions = [...new Set(LAB_CARD_IDS.map(expansionOf))].sort((a, b) => a.localeCompare(b));
  const cards = LAB_CARD_IDS
    .filter((id) => ui.expansion === "all" || expansionOf(id) === ui.expansion)
    .filter((id) => !query || id.toLowerCase().includes(query) || CARD_LIBRARY[id].name.toLowerCase().includes(query))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));
  const rows = cards.map((id) => {
    const card = CARD_LIBRARY[id];
    return `<button class="catalog-card" data-catalog-card="${esc(id)}"><span>${esc(id)}</span><strong>${esc(card.name)}</strong><small>${esc(card.category)} / MEM ${esc(card.cost ?? "—")}</small><em>手札へ追加</em></button>`;
  }).join("");
  const expansionOptions = expansions.map((prefix) => `<option value="${esc(prefix)}" ${ui.expansion === prefix ? "selected" : ""}>${esc(prefix)}-XXX</option>`).join("");
  return `<section class="card-catalog"><header><div><span>SANDBOX SUPPLY</span><h2>ALL CARD LIST <small>${cards.length}</small></h2></div><div class="catalog-tools"><input data-catalog-query value="${esc(ui.query)}" placeholder="カード名またはIDで検索"><select data-catalog-expansion><option value="all">全ID分類</option>${expansionOptions}</select><select data-catalog-owner><option value="player">自分の手札へ</option><option value="ai" ${ui.catalogOwner === "ai" ? "selected" : ""}>相手の手札へ</option></select></div></header><div class="catalog-scroll">${rows || '<span class="empty">一致するカードなし</span>'}</div></section>`;
}

export function contextualActions(state, selected) {
  const playerId = state.mode === "sandbox" ? (state.sandboxUi?.actor ?? "player") : "player";
  if (!selected || selected.playerId !== playerId || state.active !== playerId || state.winner || state.pending) return "";
  if (state.securityRestWindow === playerId) {
    const available = selected.zoneName === "front" && cardHasKeyword(selected.card, "SECURITY") && !selected.card.sleep;
    return `<div class="inspector-actions">${available ? '<button data-action="security-rest">セキュリティ待機</button>' : '<button disabled>ターン終了時：[セキュリティ]を選択</button>'}</div>`;
  }
  const buttons = [];
  const activatableEffects = ["hand", "front", "back"].includes(selected.zoneName) ? getActivatableEffects(state, playerId, selected.card) : [];
  if (selected.zoneName === "hand") {
    buttons.push(state.players[playerId].registryActionUsed
      ? '<button disabled>レジストリ操作済</button>'
      : '<button data-action="install">インストール</button>');
    if (selected.card.category === "Plugin") {
      // Pluginはレジストリでのみ有効。
    } else if (selected.card.category === "Script") {
      buttons.push('<button data-action="set-script" class="primary">裏向きで設置</button>');
    } else if (hasKeyword(selected.card, "LAYERED")) {
      buttons.push('<button data-action="layered-front" class="primary">フロントへレイヤード</button>');
      buttons.push('<button data-action="layered-back">バックへレイヤード</button>');
    } else if (selected.card.category === "Sp") {
      buttons.push(`<button data-action="play-front" class="primary">${spellNeedsTarget(selected.card) ? "実行→相手を選択" : "スペル実行"}</button>`);
    } else {
      buttons.push('<button data-action="play-front" class="primary">フロントへ実行</button>');
      buttons.push('<button data-action="play-back">バックへ実行</button>');
      if (selected.card.id === "STD-184") buttons.push('<button data-action="set-std184-script">3-0 Scriptとして設置（MEM 3）</button>');
      const hasCodeBase = [...state.players[playerId].front, ...state.players[playerId].back].some((card) => card.category === "Code");
      if (isObCard(selected.card) && hasCodeBase) buttons.push('<button data-action="prepare-mount">Codeの上へ実行</button>');
      const hasOb = [...state.players[playerId].front, ...state.players[playerId].back].some(isObCard);
      if (selected.card.category === "Code" && hasOb) buttons.push('<button data-action="prepare-code-under">Obの下へ実行</button>');
    }
    if (activatableEffects.length) buttons.push(`<button data-action="activate-effect" class="primary">効果起動${activatableEffects.length > 1 ? `（${activatableEffects.length}）` : ""}</button>`);
  }
  if (selected.zoneName === "front") {
    if (activatableEffects.length) buttons.push(`<button data-action="activate-effect" class="primary">効果起動${activatableEffects.length > 1 ? `（${activatableEffects.length}）` : ""}</button>`);
    if (canAttack(state, playerId, selected.card)) buttons.push('<button data-action="prepare-attack" class="danger">攻撃→対象選択</button>');
    if (selected.card.category !== "Script") buttons.push(`<button data-action="relog-back">バックへ再実行（MEM ${esc(selected.card.cost ?? 0)}）</button>`);
  }
  if (selected.zoneName === "back" && selected.card.category === "Script") {
    if (selected.card.faceDown && !keywordValue(selected.card, "IF")) buttons.push(`<button data-action="activate-script" class="primary">Script起動（MEM ${esc(selected.card.cost ?? 0)}）</button>`);
    if (keywordValue(selected.card, "IF")) {
      const normalIf = ["STD-001", "STD-002", "STD-003", "STD-036", "STD-037", "STD-139", "STD-140", "STD-148"].includes(selected.card.id)
        && selected.card.faceDown && !selected.card.declaredEffectId && state.phase === "main"
        && !state.prompt && !state.effectResolution && !state.resolvingDeclaredEffect;
      buttons.push(normalIf
        ? `<button data-action="activate-script" class="primary">Script起動（MEM ${esc(selected.card.activationCost ?? selected.card.cost ?? 0)}）</button>`
        : `<button disabled>if待機：${esc(keywordValue(selected.card, "IF"))}</button>`);
    }
    if (selected.card.residentActive) buttons.push('<button disabled>レジデント適用中</button>');
  } else if (selected.zoneName === "back") {
    if (activatableEffects.length) buttons.push(`<button data-action="activate-effect" class="primary">効果起動${activatableEffects.length > 1 ? `（${activatableEffects.length}）` : ""}</button>`);
    buttons.push(`<button data-action="relog-front">フロントへ再実行（MEM ${esc(selected.card.cost ?? 0)}）</button>`);
  }
  if (selected.zoneName === "registry") {
    const registryExecution = canExecuteRegistryCard(state, playerId, selected.card);
    buttons.push(registryExecution.ok
      ? '<button data-action="execute-registry" class="primary">博士効果で実行</button>'
      : `<button disabled>${esc(registryExecution.reason)}</button>`);
    buttons.push(state.players[playerId].registryActionUsed
      ? '<button disabled>レジストリ操作済</button>'
      : '<button data-action="recover-registry">手札へ回収</button>');
  }
  return `<div class="inspector-actions">${buttons.join("")}</div>`;
}

export function cardDetailHtml(state, variantClass = "", includeActions = true) {
  const selectedUserId = Object.keys(state.players).find((playerId) => state.selectedUid === `${playerId}-user-card`);
  if (selectedUserId) {
    const player = state.players[selectedUserId];
    return `<aside class="card-inspector ${variantClass}">
      <div class="detail-art user-art color-${player.user.color === "赤" ? "red" : "yellow"}"><span>USER CARD</span><b>ZX</b><small>${esc(player.user.id)}</small></div>
      <div class="detail-heading"><span>${selectedUserId === "player" ? "YOU" : "OPPONENT"} / ${esc(player.user.color)}</span><h2>${esc(player.user.name)}</h2></div>
      <dl class="detail-grid"><div><dt>STR</dt><dd>${player.fortressStr} / ${player.user.maxStr}</dd></div><div><dt>MEMORY</dt><dd>${player.memory} / ${getMaxMemory(player)}</dd></div></dl>
      <section class="detail-section"><h3>ユーザー能力</h3><p>${abilityTextHtml(player.user.ability)}</p></section>
      <section class="detail-section runtime-detail-section"><h3>付与・残数</h3>${runtimeDetailHtml(state, selectedUserId, player)}</section>
      <section class="detail-section"><h3>インシデント</h3><p>${player.user.incidents.map((n) => `${n}${player.incidentsTriggered.includes(n) ? "（使用済）" : ""}`).join(" / ")}</p></section>
    </aside>`;
  }
  const selected = state.selectedUid ? findCard(state, state.selectedUid) : null;
  if (!selected) return `<aside class="card-inspector empty-inspector ${variantClass}"><div class="inspector-placeholder"><b>SELECT CARD</b><span>カードを選ぶと詳細と操作を表示</span></div></aside>`;
  const { card, playerId, zoneName } = selected;
  const classes = detailClasses(card.classes);
  const zoneLabels = { hand: "手札", front: "フロント", back: "バック", registry: "レジストリ", trash: "ゴミ箱", deck: "山札" };
  const ownerLabel = playerId === "player" ? "自分" : "相手";
  const current = isObCard(card) ? cardCurrentStr(state, playerId, card) : "—";
  const layers = [card, ...(card.mounted ?? [])];
  const displayName = zoneName === "registry" && card.category === "Plugin" ? `P-in（${card.name}）` : card.name;
  return `<aside class="card-inspector ${variantClass}">
    ${detailArtworkHtml(card)}
    <div class="detail-heading"><span>${esc(card.category)} / COST ${esc(card.cost ?? "—")}</span><h2>${esc(displayName)}</h2></div>
    <dl class="detail-grid">
      <div class="detail-location"><dt>場所</dt><dd>${ownerLabel}・${zoneLabels[zoneName] ?? zoneName}</dd></div>
      <div class="detail-state"><dt>状態</dt><dd>${card.sleep ? "スリープ" : "スタンバイ"}</dd></div>
      <div class="detail-atk"><dt>ATK</dt><dd>${isObCard(card) ? cardAtk(state, playerId, card) : "—"}</dd></div>
      <div class="detail-str"><dt>STR</dt><dd>${current}${isObCard(card) ? ` / ${card.str}` : ""}</dd></div>
      <div class="detail-class" ${classes.length ? "" : 'data-empty="true"'}><dt>クラス</dt><dd>${classes.map((name) => `<span class="detail-class-tag">${esc(name)}</span>`).join("")}</dd></div>
    </dl>
    <section class="detail-section effect-text-section" data-card-detail-text><h3>効果テキスト</h3><p class="card-effect-copy">${cardEffectHtml(card.text || "効果なし")}</p></section>
    <section class="detail-section runtime-detail-section"><h3>付与・残数</h3>${runtimeDetailHtml(state, playerId, card)}</section>
    <section class="detail-section layer-detail-section"><h3>レイヤー ${layers.length}</h3><ol>${layers.map((layer, index) => `<li class="layer-${layer.layerRole ?? (index === 0 ? "top" : "layered")}${layer.category === "Code" && layer.layerRole === "mount" ? " mount-code" : ""}"><b>L${index + 1}</b><span>${esc(layer.name)}</span><small>${esc(layer.category)}</small></li>`).join("")}</ol></section>
    ${includeActions ? contextualActions(state, selected) : ""}
  </aside>`;
}

export function controlsHtml(state, tutorialFlow, mobileUi) {
  if (mobileUi.aiPacing?.active) return '<div class="controls ai-controls-locked"><button disabled>CPU処理中</button></div>';
  if (state.mode === "tutorial" && !tutorialFlow?.introComplete) return '<div class="controls tutorial-intro-controls"></div>';
  const playerId = state.mode === "sandbox" ? (state.sandboxUi?.actor ?? "player") : "player";
  const buttons = [];
  const player = state.players[playerId];
  const uniqueName = player.user.abilityKey === "turbo" ? "ターボブースト" : player.user.abilityName;
  const uniqueLabel = `<span class="unique-effect-eyebrow">UNIQUE EFFECT</span><strong class="unique-effect-name">${esc(uniqueName)}</strong>`;
  const turboReady = player.user.abilityKey === "turbo" && !player.turboUsed && !state.securityRestWindow && state.active === playerId && !state.pending && !state.winner;
  const particles = turboReady && mobileUi.effectsEnabled
    ? '<span class="unique-particles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>' : "";
  const uniqueEffect = `<button data-live="unique-effect" class="unique-effect" aria-label="固有能力：${esc(uniqueName)}の説明を開く">${particles}<span class="unique-effect-copy">${uniqueLabel}</span></button>`;
  if (state.mode === "tutorial" && tutorialFlow?.index === 0) buttons.push('<button data-action="tutorial-advance" class="primary">開始</button>');
  if (!state.winner && state.active === playerId && !state.pending) {
    if (canOpeningMulligan(state, playerId)) buttons.push(`<button data-action="opening-mulligan">マリガン ${state.players[playerId].mulligansUsed}/3</button>`);
    buttons.push(`<button data-action="end-turn">${state.securityRestWindow === playerId ? "待機選択を終えてターン交代" : "ターン終了"}</button>`);
  }
  if (["attack", "spell", "layered-select", "effect-target", "effect-target-multi", "effect-move-zone", "effect-choice", "selection"].includes(state.pending?.type)) buttons.unshift('<button data-action="cancel" class="quiet">選択取消</button>');
  if (state.pending?.type === "layered-select") {
    const ready = state.pending.selectedTargets.length >= state.pending.requirement.minimum;
    buttons.unshift(`<button data-action="confirm-layered" class="primary" ${ready ? "" : "disabled"}>レイヤード実行 ${state.pending.selectedTargets.length}/${state.pending.requirement.minimum}</button>`);
  }
  if (state.pending?.type === "effect-target-multi") {
    const ready = state.pending.selectedTargets.length === state.pending.required;
    buttons.unshift(`<button data-action="confirm-effect-targets" class="primary" ${ready ? "" : "disabled"}>対象確定 ${state.pending.selectedTargets.length}/${state.pending.required}</button>`);
  }
  if (state.pending?.type === "selection") {
    const request = state.pending.request;
    const count = request.mode === "scope" ? (request.selectedScope ? 1 : 0) : request.selected.length;
    const ready = canConfirmSelection(request);
    buttons.unshift(`<button data-action="confirm-selection" class="primary" ${ready ? "" : "disabled"}>対象確定 ${count}/${request.mode === "up_to" ? `最大${request.maximum}` : request.count}</button>`);
  }
  buttons.unshift(`<button data-action="toggle-mobile-menu" class="mobile-menu-toggle" aria-expanded="${mobileUi.menuOpen ? "true" : "false"}">${mobileUi.menuOpen ? "メニューを格納" : "メニュー"}</button>`);
  buttons.push('<button data-action="undo" class="quiet">UNDO</button>');
  return `<div class="controls">${uniqueEffect}${buttons.join("")}</div>`;
}

export function uniqueEffectModalHtml(state, playerId) {
  const player = state.players[playerId];
  const name = player.user.abilityKey === "turbo" ? "ターボブースト" : player.user.abilityName;
  const ready = player.user.abilityKey === "turbo" && !player.turboUsed && !state.securityRestWindow
    && state.active === playerId && !state.pending && !state.winner;
  const action = player.user.abilityKey === "turbo"
    ? `<button data-action="turbo" ${ready ? "" : "disabled"}>起動</button>${player.turboUsed ? '<small>ゲーム中の使用回数を消費済み</small>' : ""}`
    : '<small>条件を満たすと自動で処理</small>';
  return `<div class="unique-effect-modal" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="unique-effect-title"><header><span>UNIQUE EFFECT</span><button data-live="close-unique" aria-label="説明を閉じる">×</button></header><h2 id="unique-effect-title">${esc(name)}</h2><p>${esc(player.user.ability)}</p><footer>${action}</footer></section></div>`;
}

export function pendingLabel(pending) {
  return ({ attack: "攻撃対象を選択", spell: "スペル対象を選択", "mount-base": "上に実行するCodeを選択", "code-under": "Codeを配置するObを選択", "layered-select": pending?.requirement?.label, "effect-target": "効果の対象を選択", "effect-target-multi": "効果の対象を複数選択", selection: pending?.request?.label, "trigger-order": "誘発効果の処理順を選択", "effect-move-zone": "効果による移動先を選択", "sam-discard": "サムの効果で捨てる赤カードを選択", "lucky-sacrifice": "追加効果で破壊する自分のカードを選択" })[pending?.type] ?? "効果処理中";
}

function selectionCardOptionsHtml(state, request) {
  if (request.spec?.kind === "allocation" || !request.candidates.length) return null;
  const viewer = state.viewerId ?? (state.mode === "sandbox" ? state.sandboxUi?.actor ?? "player" : "player");
  const candidates = request.candidates.map((uid) => findCard(state, uid));
  if (candidates.some((entry) => !entry || entry.card.faceDown && entry.playerId !== viewer
    || entry.playerId !== viewer && !["front", "back", "registry", "trash"].includes(entry.zoneName))) return null;
  return `<div class="selection-inline-options selection-card-grid" role="group" aria-label="選択できるカード">
    ${candidates.map(({ card }, index) => {
      const uid = request.candidates[index];
      const label = request.candidateLabels?.[uid] ?? card.name;
      const value = request.candidateValues?.[uid];
      const art = CARD_ART[card.id];
      const selected = request.selected.includes(uid);
      return `<button type="button" class="selection-card color-${colorClass(card.color)}${selected ? " selected" : ""}" data-selection-option="${esc(uid)}" aria-pressed="${selected}" aria-label="候補${index + 1}: ${esc(label)}${value !== undefined ? `、値${esc(value)}` : ""}" title="${esc(label)}">
        ${art ? `<img src="${esc(art)}" alt="" loading="lazy" decoding="async">` : `<span class="selection-card-placeholder" aria-hidden="true"><b>${esc(card.name.slice(0, 1))}</b><small>${esc(card.category)}</small></span>`}
        <span class="selection-card-cost">${esc(card.cost ?? "–")}</span>
        <span class="selection-card-name">${esc(card.name)}</span>
        ${label !== card.name || value !== undefined ? `<span class="selection-card-note">${esc(label !== card.name ? label : "")}${value !== undefined ? ` / ${esc(value)}` : ""}</span>` : ""}
        ${selected ? '<span class="selection-card-check" aria-hidden="true">✓</span>' : ""}
      </button>`;
    }).join("")}
  </div>`;
}

export function selectionPanelHtml(state, { collapsed = false, collapsible = false } = {}) {
  const request = state.pending?.type === "selection" ? state.pending.request : null;
  if (!request) return "";
  const toggleIcon = `<svg viewBox="0 0 28 20" width="28" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 10C4.8 5.7 8.8 3.5 14 3.5S23.2 5.7 26 10c-2.8 4.3-6.8 6.5-12 6.5S4.8 14.3 2 10Z"/><circle cx="14" cy="10" r="3.2"/>${collapsed ? "" : '<path class="selection-fold-cross" d="M20 2 26 8m0-6-6 6"/>'}</svg>`;
  const toggle = collapsible ? `<button type="button" class="selection-fold" data-live="selection-fold" aria-expanded="${!collapsed}" aria-label="${collapsed ? "選択候補を開く" : "選択候補を畳む"}" title="${collapsed ? "選択候補を開く" : "選択候補を畳む"}">${toggleIcon}</button>` : "";
  if (collapsed) return `<aside class="selection-panel selection-panel-collapsed"><div class="selection-panel-heading"><span>TARGET SELECT / ${esc(request.mode.toUpperCase())}</span>${toggle}</div><h2>${esc(request.label)}</h2><b>${request.selected.length}枚選択中</b></aside>`;
  if (request.mode === "random") {
    return `<div class="selection-panel random-selection"><div class="selection-panel-heading"><span>RANDOM SELECT</span>${toggle}</div><h2>${esc(request.message || "ランダムに選択します。実行しますか？")}</h2><p>候補 ${request.candidates.length}枚から${request.count}枚を選択する。</p></div>`;
  }
  const scope = request.mode === "scope"
    ? `<label>指定する${request.scopeField === "class" ? "クラス" : request.scopeField === "category" ? "カテゴリ" : "項目"}<select data-selection-scope><option value="">選択して</option>${request.scopeOptions.map((value) => `<option value="${esc(value)}" ${request.selectedScope === value ? "selected" : ""}>${esc(value)}</option>`).join("")}</select></label>`
    : `<b>${request.selected.length} / ${request.mode === "up_to" ? `最大${request.maximum}` : request.count}${request.budget !== null ? ` / COST ${request.selected.reduce((sum, uid) => sum + Number(request.candidateValues?.[uid] ?? 0), 0)}/${request.budget}` : ""}</b>`;
  const allocation = request.spec?.kind === "allocation"
    ? `<div class="selection-inline-options">${request.candidates.map((uid) => `<label>${esc(request.candidateLabels?.[uid] ?? uid)}<input type="number" min="0" ${request.spec.maximumPerTarget === null ? "" : `max="${request.spec.maximumPerTarget}"`} value="${request.allocation?.[uid] ?? 0}" data-selection-allocation="${esc(uid)}"></label>`).join("")}</div><b>ALLOCATE ${Object.values(request.allocation ?? {}).reduce((sum, value) => sum + Number(value), 0)} / ${request.spec.total}</b>`
    : "";
  const cardOptions = Object.keys(request.candidateLabels ?? {}).length ? selectionCardOptionsHtml(state, request) : null;
  const options = cardOptions ?? (Object.keys(request.candidateLabels ?? {}).length
    ? `<div class="selection-inline-options">${request.candidates.map((uid) => `<button data-selection-option="${esc(uid)}" class="${request.selected.includes(uid) ? "selected" : ""}">${esc(request.candidateLabels[uid])}${request.candidateValues?.[uid] !== undefined ? ` / ${request.candidateValues[uid]}` : ""}</button>`).join("")}</div>` : "");
  return `<aside class="selection-panel${cardOptions ? " selection-panel-cards" : ""}"><div class="selection-panel-heading"><span>TARGET SELECT / ${esc(request.mode.toUpperCase())}</span>${toggle}</div><h2>${esc(request.label)}</h2><p>${esc(request.message)}</p>${scope}${options}${allocation}</aside>`;
}

export function triggerThreadHtml(state) {
  const thread = state.triggerThread;
  // Resolved threads are retained in state/log but must not cover the board.
  if (!thread || thread.status === "resolved") return "";
  if (state.pending?.type === "selection" && thread.items.some((item) => item.status === "awaiting-selection")) return "";
  const items = thread.items.map((item) => {
    const selectable = thread.status === "resolving" && item.controllerId === thread.currentControllerId && (state.mode === "sandbox" && state.sandboxUi?.opponentControl === "manual" || item.controllerId === "player") && item.status === "pending";
    return `<button class="trigger-thread-item status-${item.status}" data-trigger-item="${esc(item.id)}" ${selectable ? "" : "disabled"}><span>${item.controllerId === "player" ? "YOU" : "OPPONENT"} / ${esc(item.eventType)}</span><strong>${esc(item.cardName)}</strong><p>${esc(item.text)}</p><small>${esc(item.summary)}</small><em>${item.status === "resolved" ? "処理済み" : item.status === "resolving" ? "処理中" : "待機"}</em></button>`;
  }).join("");
  return `<section class="trigger-thread-panel ${thread.status}"><header><span>TRIGGER THREAD</span><h2>${esc(thread.message)}</h2></header><div class="trigger-thread-list">${items}</div>${thread.status === "resolved" ? '<button data-action="dismiss-thread" class="primary">閉じる</button>' : ""}</section>`;
}

export function modalHtml(state) {
  if (state.pending?.type === "response-window") {
    return `<div class="effect-modal"><div class="effect-dialog"><span>RESPONSE WINDOW</span><h2>レスポンスを実行する？</h2><p>相手から${esc(state.pending.event.amount)}ダメージを受けた後。</p><div>${state.pending.candidates.map((uid) => `<button data-response-card="${esc(uid)}">${esc(state.pending.candidateLabels[uid])}</button>`).join("")}<button data-action="response-decline" class="quiet">使わない</button></div></div></div>`;
  }
  if (state.pending?.type === "effect-choice") {
    return `<div class="effect-popover"><div class="effect-choice-panel"><span>ACTIVATE EFFECT</span><h2>どの効果を起動しますか？</h2><div class="effect-choice-list">${state.pending.effects.map((effect) => `<button data-effect-id="${esc(effect.id)}" ${effect.enabled ? "" : "disabled"}><strong>${esc(effect.label)} / MEM ${effect.cost}</strong><p>${esc(effect.text)}</p></button>`).join("")}</div><button data-action="cancel" class="quiet">キャンセル</button></div></div>`;
  }
  if (state.pending?.type === "effect-move-zone") {
    const target = findCard(state, state.pending.targetUid)?.card;
    return `<div class="effect-popover"><div class="effect-choice-panel"><span>EFFECT / MOVE</span><h2>「${esc(target?.name)}」をどこへ移動しますか？</h2><div class="effect-zone-actions"><button data-action="effect-move-back">バックへ移動</button><button data-action="effect-move-front" class="primary">フロントへ移動</button></div><button data-action="cancel" class="quiet">キャンセル</button></div></div>`;
  }
  if (state.pending?.type === "lucky-confirm") {
    return `<div class="effect-modal"><div class="effect-dialog"><span>OPTIONAL EFFECT</span><h2>自分エリアのカードを選びますか？</h2><p>選んだカードを破壊すると、相手ユーザーへ2ダメージ。</p><div><button data-action="lucky-no" class="quiet">選ばない</button><button data-action="lucky-yes" class="danger">選ぶ</button></div></div></div>`;
  }
  if (state.pending?.type === "junk-place") {
    return `<div class="effect-modal"><div class="effect-dialog"><span>ACCESS / DRAG</span><h2>ジャンクパーツをどこへ配置する？</h2><p>単体配置するか、すでにいるObの下へ直接配置できる。</p><div><button data-action="place-junk-under">Obの下へ</button><button data-action="place-junk-back">バックへ</button><button data-action="place-junk-front" class="primary">フロントへ</button></div></div></div>`;
  }
  if (["access-drag-place", "decode-place", "std048-draw-place"].includes(state.pending?.type)) {
    const card = state.pending.type === "decode-place"
      ? state.pending.cards?.find((item) => item.uid === state.pending.sourceUid)
      : findCard(state, state.pending.sourceUid)?.card;
    const hosts = card?.category === "Code"
      ? [...state.players.player.front.map((host) => ({ host, zone: "front" })), ...state.players.player.back.map((host) => ({ host, zone: "back" }))]
        .filter(({ host }) => isObCard(host))
      : [];
    const hostButtons = hosts.map(({ host, zone }) => `<button data-access-host="${esc(host.uid)}" data-access-zone="${zone}">${esc(host.name)}の下へ</button>`).join("");
    const mode = state.pending.type === "decode-place" ? "DECODE" : "ACCESS / DRAG";
    return `<div class="effect-modal"><div class="effect-dialog"><span>${mode}</span><h2>「${esc(card?.name)}」の配置先</h2><p>残り${state.pending.queue.length}枚。通常の配置先を選択。</p><div>${hostButtons}<button data-action="access-drag-back">バックへ</button><button data-action="access-drag-front" class="primary">フロントへ</button></div></div></div>`;
  }
  return "";
}

export function artPreviewHtml(state, mobileUi) {
  const selected = mobileUi.artPreviewUid ? findCard(state, mobileUi.artPreviewUid) : null;
  if (!selected || !CARD_ART[selected.card.id]) return "";
  const profile = cardArtProfile(selected.card);
  return `<div class="art-preview-backdrop" data-art-preview-close>
    <section class="art-preview-dialog art-${profile.orientation}" role="dialog" aria-modal="true" aria-labelledby="art-preview-title">
      <header><div><span>FULL CARD IMAGE</span><h2 id="art-preview-title">${esc(selected.card.name)}</h2><small>${esc(selected.card.id)}</small></div><button type="button" data-art-preview-close aria-label="拡大画像を閉じる">×</button></header>
      <div class="art-preview-canvas">${cardArtHtml(selected.card, "art-preview-image", { full: true })}</div>
    </section>
  </div>`;
}

export function adminDrawerHtml(state) {
  if (!state.openAdmin) return "";
  const { playerId, zoneName } = state.openAdmin;
  const player = state.players[playerId];
  const cards = player?.[zoneName] ?? [];
  const label = zoneName === "trash" ? "ゴミ箱" : "レジストリ";
  return `<div class="admin-drawer"><header><div><span>${playerId === "player" ? "YOU" : "OPPONENT"}</span><h2>${label}</h2></div><button data-action="close-admin">閉じる</button></header><div class="admin-list">
    ${cards.length ? cards.map((card) => state.viewerId && state.viewerId !== playerId && card.faceDown
      ? `<button class="admin-list-card" data-card-uid="${esc(card.uid)}"><b>裏向きカード</b></button>`
      : `<button class="admin-list-card ${state.selectedUid === card.uid ? "selected" : ""}" data-card-uid="${esc(card.uid)}"><span class="admin-card-cost">${esc(card.cost ?? "—")}</span><b>${esc(zoneName === "registry" && card.category === "Plugin" ? `P-in（${card.name}）` : card.name)}</b><small>${esc(card.category)}${card.color ? ` / ${esc(card.color)}` : ""}</small></button>`).join("") : '<p class="empty">カードなし</p>'}
  </div></div>`;
}

export function promptToastHtml(state) {
  if (!state.prompt) return "";
  if (state.prompt.type === "plugin-number") {
    return `<aside class="prompt-toast plugin-prompt"><div><span>PLUGIN SETUP</span><b>${esc(state.prompt.message)}</b><small>${esc(state.prompt.detail)}</small></div><nav>${Array.from({ length: 8 }, (_, value) => `<button data-plugin-number="${value}">${value}</button>`).join("")}</nav></aside>`;
  }
  const script = findCard(state, state.prompt.scriptUid)?.card;
  return `<aside class="prompt-toast ${script && keywordValue(script, "IF") ? "if-trigger" : ""}"><div><span>TRIGGER</span><b>${esc(state.prompt.message)}</b><small>${esc(state.prompt.detail)} / 起動コスト MEM ${esc(script?.cost ?? 0)}</small></div><button data-action="prompt-decline">見送る</button><button data-action="prompt-activate" class="primary">起動</button></aside>`;
}

function logHtml(state) {
  return state.log.slice(-28).reverse().map((entry) => `<li class="tone-${entry.tone}">${esc(entry.text)}</li>`).join("");
}

export function tutorialTextHtml(presentation) {
  if (!presentation?.parts) return esc(presentation?.text ?? "");
  return presentation.parts.map((part) => typeof part === "string"
    ? esc(part)
    : `<ruby>${esc(part.ruby)}<rt>${esc(part.rt)}</rt></ruby>`).join("");
}

function tutorialOverlayHtml(presentation, navigator, mobileUi) {
  if (!presentation || !navigator || !mobileUi.tutorialOverlayOpen) return "";
  const focusCards = [...new Set((presentation.focus ?? []).map((item) => item.cardId).filter(Boolean))]
    .map((cardId) => CARD_LIBRARY[cardId])
    .filter(Boolean)
    .map((card) => `<span class="tutorial-focus-card color-${colorClass(card.color)}"><em>${esc(card.cost)}</em><small>${esc(card.id)} / ${esc(card.category)}</small><b>${esc(card.name)}</b></span>`)
    .join("");
  const position = mobileUi.tutorialOverlayPosition === "top" ? "top" : "bottom";
  const nextPosition = position === "bottom" ? "top" : "bottom";
  const intro = Boolean(presentation.intro);
  return `<div class="tutorial-adv-overlay">
    <section class="tutorial-adv-scene" role="region" aria-labelledby="tutorial-adv-speaker" aria-describedby="tutorial-adv-text">
      <div class="tutorial-adv-dialogue position-${position}" data-tutorial-step="${esc(mobileUi.tutorialPresentedStep ?? "")}">
        <img class="tutorial-adv-character" src="${esc(navigator.src)}" alt="" style="object-position:${esc(navigator.objectPosition)}">
        <div class="tutorial-adv-meta"><strong id="tutorial-adv-speaker">${esc(presentation.speaker)}</strong></div>
        <div class="tutorial-adv-copy"><p id="tutorial-adv-text">${tutorialTextHtml(presentation)}</p>${focusCards ? `<div class="tutorial-focus-cards">${focusCards}</div>` : ""}</div>
        <nav class="tutorial-adv-actions"><button type="button" data-tutorial-position="${nextPosition}">${nextPosition === "top" ? "上へ移動" : "下へ移動"}</button><button type="button" data-action="dismiss-tutorial-overlay" data-tutorial-overlay-dismiss>${intro ? "次へ" : "格納"}</button></nav>
      </div>
    </section>
  </div>`;
}

export function tutorialFocusSelector(item) {
  const owner = item.owner ? `[data-owner="${CSS.escape(item.owner)}"]` : "";
  if (item.kind === "card") return `[data-card-id="${CSS.escape(item.cardId)}"]${owner}${item.zone ? `[data-zone="${CSS.escape(item.zone)}"]` : ""}`;
  if (item.kind === "zone") return `.zone-${CSS.escape(item.zone)}[data-player="${CSS.escape(item.owner)}"]`;
  if (item.kind === "fortress") return `[data-fortress="${CSS.escape(item.owner)}"]`;
  if (item.kind === "admin") return `[data-admin-zone="${CSS.escape(item.zone)}"][data-owner="${CSS.escape(item.owner)}"]`;
  if (item.kind === "action") return `[data-action="${CSS.escape(item.action)}"]`;
  return null;
}

function addTutorialFocusRings(root, step, mobileUi) {
  if (!mobileUi.tutorialOverlayOpen || !step?.focus?.length) return;
  const scene = root.querySelector(".tutorial-adv-scene");
  if (!scene) return;
  for (const item of step.focus) {
    const selector = tutorialFocusSelector(item);
    if (!selector) continue;
    for (const target of root.querySelectorAll(selector)) {
      if (target.closest(".tutorial-adv-overlay")) continue;
      const rect = target.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) continue;
      const ring = document.createElement("div");
      ring.className = `tutorial-focus-ring focus-${item.kind}`;
      ring.setAttribute("aria-hidden", "true");
      ring.style.cssText = `left:${Math.max(2, rect.left - 4)}px;top:${Math.max(2, rect.top - 4)}px;width:${Math.min(innerWidth - Math.max(2, rect.left - 4) - 2, rect.width + 8)}px;height:${Math.min(innerHeight - Math.max(2, rect.top - 4) - 2, rect.height + 8)}px`;
      ring.innerHTML = item.label ? `<span>${esc(item.label)}</span>` : "";
      if (["card", "action"].includes(item.kind)) {
        const clone = target.cloneNode(true);
        clone.removeAttribute("id");
        clone.removeAttribute("data-action");
        clone.removeAttribute("data-card-uid");
        clone.setAttribute("tabindex", "-1");
        clone.setAttribute("aria-hidden", "true");
        clone.classList.add("tutorial-focus-clone");
        ring.append(clone);
      }
      scene.append(ring);
    }
  }
}

function revealTutorialPrimaryFocus(root, step, mobileUi) {
  if (!mobileUi.tutorialOverlayOpen || !step?.focus?.length) return;
  const primary = step.focus.find((item) => item.kind === "card") ?? step.focus[0];
  const selector = tutorialFocusSelector(primary);
  const target = selector ? [...root.querySelectorAll(selector)].find((node) => !node.closest(".tutorial-adv-overlay")) : null;
  if (!target) return;
  const rect = target.getBoundingClientRect();
  if (rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight) {
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

export function renderApp(root, state, tutorialFlow, mobileUi = {}) {
  const step = state.mode === "tutorial" ? currentTutorialStep(tutorialFlow) : null;
  const presentation = state.mode === "tutorial" ? currentTutorialPresentation(tutorialFlow) : null;
  const tutorialNeedsHand = Boolean(tutorialFlow?.introComplete && step?.focus?.some((item) => item.kind === "card" && item.owner === "player" && item.zone === "hand"));
  const displayedMobileUi = tutorialNeedsHand ? { ...mobileUi, handOpen: true } : mobileUi;
  const aiPacing = mobileUi.aiPacing?.active ? mobileUi.aiPacing : null;
  const navigator = state.mode === "tutorial" && !aiPacing ? tutorialNavigator(tutorialFlow?.tutorialId ?? state.tutorialId) : null;
  const dialogueSpeaker = aiPacing ? "CPU" : (presentation?.speaker ?? (["lab", "sandbox"].includes(state.mode) ? "SANDBOX" : "SYSTEM"));
  const dialogueText = aiPacing ? aiPacing.label : (presentation?.text ?? (["lab", "sandbox"].includes(state.mode) ? "自分ターン固定。全登録カードと相手の公開テスト盤面を使って処理を確認できる。" : "デッキで黄AIのDoors ZXを落とせ。複雑効果は解析状態を表示する。"));
  const dialoguePortrait = navigator
    ? `<div class="portrait navigator-portrait"><img src="${esc(navigator.src)}" alt="${esc(dialogueSpeaker)}のナビゲーター立ち絵" style="object-position:${esc(navigator.objectPosition)}"></div>`
    : `<div class="portrait">${aiPacing ? "CPU" : "NAVI"}</div>`;
  const lockedOutcome = state.victory?.lockedOutcome ?? state.winner;
  const gameFinished = state.victory ? state.victory.finished : Boolean(state.winner);
  const resultLabel = lockedOutcome === "draw" ? "DRAW" : lockedOutcome === "player" ? "YOU WIN" : "AI WIN";
  root.innerHTML = `
    <header class="app-header ${mobileUi.menuOpen ? "" : "mobile-menu-collapsed"}">
      <div class="brand"><span>SIEGE÷ZEKE / PUBLIC STAGING</span><h1>簡易版ジーグ</h1></div>
      <nav aria-label="ゲームモードと対戦設定">
        <button data-mode="tutorial" class="${state.mode === "tutorial" ? "active" : ""}">チュートリアル</button>
        <button data-mode="ai" class="${state.mode === "ai" ? "active" : ""}">AI対戦</button>
        <button data-mode="sandbox" class="${["lab", "sandbox"].includes(state.mode) ? "active" : ""}">サンドボックス</button>
        <button data-deck-open>デッキ構築</button>
        <button data-toggle-effects aria-pressed="${mobileUi.effectsEnabled !== false}" aria-label="画面演出を切り替える">演出 ${mobileUi.effectsEnabled === false ? "OFF" : "ON"}</button>
        ${state.mode === "sandbox" ? `<label class="tutorial-picker">相手操作<select data-opponent-control><option value="manual">手動</option><option value="ai" ${state.sandboxUi?.opponentControl === "ai" ? "selected" : ""}>AI</option></select></label><label class="tutorial-picker">操作側<select data-sandbox-actor ${state.sandboxUi?.opponentControl === "ai" ? "disabled" : ""}><option value="player">YOU</option><option value="ai" ${state.sandboxUi?.actor === "ai" ? "selected" : ""}>OPPONENT</option></select></label>` : ""}
        <label class="tutorial-picker">学ぶ内容<select data-tutorial-select ${state.mode === "tutorial" ? "" : "disabled"}><option value="basics" ${state.tutorialId === "basics" ? "selected" : ""}>基本操作・赤</option><option value="vengeance" ${state.tutorialId === "vengeance" ? "selected" : ""}>ヴェンジェンス・紫</option></select></label>
        <label class="tutorial-picker">自分デッキ<select data-player-deck ${["ai", "sandbox"].includes(state.mode) ? "" : "disabled"}>${deckOptionsHtml(state, state.playerDeckId)}</select></label>
        <label class="tutorial-picker">自分ユーザー<select data-player-user ${["ai", "sandbox"].includes(state.mode) ? "" : "disabled"}>${Object.entries(USER_CARDS).map(([id,user]) => `<option value="${id}" ${state.playerUserId === id ? "selected" : ""}>${esc(user.name)}</option>`).join("")}</select></label>
        <label class="tutorial-picker">相手デッキ<select data-ai-deck ${["ai", "sandbox"].includes(state.mode) ? "" : "disabled"}>${deckOptionsHtml(state, state.aiDeckId)}</select></label>
        <label class="tutorial-picker">相手ユーザー<select data-ai-user ${["ai", "sandbox"].includes(state.mode) ? "" : "disabled"}>${Object.entries(USER_CARDS).map(([id,user]) => `<option value="${id}" ${state.aiUserId === id ? "selected" : ""}>${esc(user.name)}</option>`).join("")}</select></label>
      </nav>
      <div class="turn-chip ${aiPacing ? "ai-thinking" : ""}">TURN ${state.turnNumber}<b>${state.active === "player" ? "YOUR TURN" : "AI TURN"}</b>${aiPacing ? `<small data-ai-pacing>STEP ${aiPacing.index} / ${esc(aiPacing.label)}</small>` : ""}</div>
    </header>
    <main>
      <div class="game-shell">
        ${cardDetailHtml(state)}
        <div class="game-table">
          <div class="battle-board">
            ${sideHtml(state, "ai", true)}
            ${sideHtml(state, "player", false)}
          </div>
          <div class="opponent-hand" aria-label="相手の手札 ${state.players.ai.hand.length}枚"><span aria-hidden="true"></span><small>HAND</small><b>${state.players.ai.hand.length}</b></div>
          ${handHtml(state, displayedMobileUi)}
        </div>
        <aside class="control-rail" aria-label="ゲーム操作">
          <section class="command-center">
            <div class="dialogue ${step || aiPacing ? "visible" : ""} ${aiPacing ? "ai-active" : ""} ${navigator ? "navigator-dialogue" : ""}">${dialoguePortrait}<div><strong>${esc(dialogueSpeaker)}</strong><p>${esc(dialogueText)}</p>${tutorialFlow?.error ? `<em>${esc(tutorialFlow.error)}</em>` : ""}</div></div>
            ${state.pending && state.pending.type !== "lucky-confirm" ? `<div class="pending">${pendingLabel(state.pending)}</div>` : ""}
            ${controlsHtml(state, tutorialFlow, mobileUi)}
            ${lockedOutcome && !gameFinished ? `<div class="winner result-locked"><small>RESULT LOCKED</small><b>${resultLabel}</b><span>宣言済み処理を解決中</span></div>` : ""}
            ${lockedOutcome && gameFinished ? `<div class="winner game-finished"><small>GAME FINISHED</small><b>${resultLabel}</b></div>` : ""}
          </section>
          <section class="lower-panels">
            <details open><summary>ACTION LOG</summary><ol class="log">${logHtml(state)}</ol></details>
            <details><summary>暫定処理 ${state.provisional.length}</summary><ul class="rulings">${state.provisional.map((item) => `<li>${esc(item.text)}</li>`).join("") || "<li>まだなし</li>"}</ul></details>
          </section>
        </aside>
      </div>
      ${sandboxCatalogHtml(state)}
      ${state.selectedUid && !state.pending && !state.prompt ? `<div class="mobile-detail-layer" data-mobile-detail-layer>${cardDetailHtml(state, "mobile-inspector")}</div>` : ""}
      ${artPreviewHtml(state, mobileUi)}
      ${modalHtml(state)}
      ${selectionPanelHtml(state)}
      ${triggerThreadHtml(state)}
      ${adminDrawerHtml(state)}
      ${promptToastHtml(state)}
      ${deckBuilderHtml(state)}
      ${tutorialOverlayHtml(presentation, navigator, mobileUi)}
    </main>
    <footer>原文は表示用に保持。supported / partial / manual は効果文解析の対応状況。</footer>`;
  revealTutorialPrimaryFocus(root, step, displayedMobileUi);
  addTutorialFocusRings(root, tutorialFlow?.introComplete ? step : null, mobileUi);
}
