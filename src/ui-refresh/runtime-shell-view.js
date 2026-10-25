import { CARD_LIBRARY, LAB_CARD_IDS, USER_CARDS } from '../data/cards.js';
import { validateDeck } from '../game/deck-builder.js';
import { START_DECKS } from '../data/start-decks.js';
import { deckPresentation } from '../ui/deck-presentation.js';
import { panelHeadHtml, controlsHelpHtml } from './cyber-panel.js';
import { titleLinks } from '../config/external-links.js';
import { tutorialSelectHtml } from './flow-screens-view.js';
const entryLogo = new URL("../assets/siege-zeke-logo-layers.svg", import.meta.url).href;
const entryStaticLogo = new URL("../assets/siege-zeke-logo-static.png", import.meta.url).href;

const esc = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const entryIcon = (kind) => {
  const paths = {
    tutorial: '<path d="M4 7.5 11 5l6 2.5L24 5l7 2.5v19L24 24l-7 2.5-6-2.5-7 2.5zM17 7.5v19M8 11.5l4-1.5M22 11.5l5-1.5"/><path d="M3 3h5m-2-2v5M29 28h4m-2-2v4"/>',
    ai: '<path d="m17 3 12 7v14l-12 7L5 24V10zM11 15h12v9H11zM14 19h.01M20 19h.01M17 3v6M2 14h3m24 0h3"/><path d="M14 27h6"/>',
    sandbox: '<path d="M12 3h10M14 3v9l-8 15a3 3 0 0 0 2.6 4h16.8a3 3 0 0 0 2.6-4L20 12V3M11 23h12M15 18h4M4 6h4m-2-2v4M29 8h3m-1-1v3"/>',
    deck: '<path d="m4 10 13-6 13 6-13 6zM4 16l13 6 13-6M4 22l13 6 13-6M9 10h4m8 0h4"/><path d="M3 3h4m-2-2v4M29 28h4m-2-2v4"/>'
  };
  return `<svg class="r2-entry-icon" viewBox="0 0 34 34" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${paths[kind]}</svg>`;
};
function entryHtml(view, effectsEnabled = true) {
  return `<section class="r2-entry" aria-label="モード選択"><div class="r2-entry-inner"><div class="r2-intro"><h1><img src="${effectsEnabled ? entryLogo : entryStaticLogo}" alt="Siege÷Zeke" data-logo-static="${!effectsEnabled}"><canvas class="r2-logo-canvas" aria-hidden="true"></canvas></h1></div>
    <nav class="r2-mode-grid" aria-label="始めるモード"><button data-mode="tutorial">${entryIcon("tutorial")}<strong>チュートリアル</strong></button><button data-mode="ai">${entryIcon("ai")}<strong>AI対戦</strong></button><button data-mode="sandbox">${entryIcon("sandbox")}<strong>実験場</strong></button><button data-deck class="r2-deck-entry">${entryIcon("deck")}<strong>デッキ構築</strong></button></nav>
    </div></section>`;
}

export function deckOptionsHtml(state, selectedId) {
  const fixed = START_DECKS.map((deck) => [deck.id, deck.name]);
  return [...fixed.map(([id, label]) => `<option value="${id}" ${selectedId === id ? "selected" : ""}>${label}</option>`),
    ...(state.savedDecks ?? []).map((deck) => `<option value="custom:${esc(deck.id)}" ${selectedId === `custom:${deck.id}` ? "selected" : ""} ${validateDeck(deck).valid ? "" : "disabled"}>保存: ${esc(deck.name)}${validateDeck(deck).valid ? "" : "（要修正）"}</option>`)].join("");
}

export function deckBuilderHtml(state, options = {}) {
  if (!state.deckBuilder?.open) return "";
  return deckPresentation(state, options);
}

function expansionOf(cardId) {
  return String(cardId).split("-")[0].toUpperCase();
}

function sandboxCatalogHtml(state) {
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

// Replays and logs stay in this browser; each button hands them over as one JSON file.
// Sending a finished match's log is the player's choice and starts switched off.
function matchArchiveHtml(ui, toggle) {
  const counts = ui.storedCounts ?? { replays: 0, logs: 0 };
  const row = (label, kind, count) => `<div class="r2-title-records"><span>${label}</span><output>${count}件</output><button data-stored-export="${kind}" ${count ? "" : "disabled"}>書き出す</button></div>`;
  return `${row("対戦ログ", "logs", counts.logs)}${row("対戦リプレイ", "replays", counts.replays)}<p>対戦ログとリプレイはこのブラウザに新しい順で最大20件ずつ保存されます。</p>${toggle("対戦後に対戦ログを送信", "data-toggle-send-logs", Boolean(ui.sendMatchLogs))}<p>オンにすると、決着した対戦のログ(盤面の記録と両者のデッキ・ユーザー)を開発用サーバーへ送ります。</p>`;
}

// Download / Discord (V092-08): HTML outside the title stage and the CRT canvas. A link without
// an address is shown as 準備中 and has no href, so it cannot be followed.
export function titleLinksHtml(links = titleLinks()) {
  const item = ({ key, label, href }) => href
    ? `<a class="r2-title-link" data-title-link="${key}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`
    : `<a class="r2-title-link is-pending" data-title-link="${key}" role="link" aria-disabled="true">${esc(label)}<small>準備中</small></a>`;
  return `<nav class="r2-title-links" aria-label="外部リンク">${links.map(item).join("")}</nav>`;
}

// Render mode (V092-09): auto follows the device, compat draws no WebGL, full draws everything.
const RENDER_CHOICES = [["auto", "自動"], ["compat", "軽量(WebGLなし)"], ["full", "通常"]];
const renderReasons = { detected: "iPhone/iPadのため自動で軽量表示", "context-lost": "描画が止まったため軽量表示に切り替え中", url: "URLの指定が優先中", saved: "選んだ表示", default: "自動" };
function renderModeHtml(ui) {
  const mode = ui.render?.mode === "compat" ? "軽量(WebGLなし)" : "通常";
  return `<div class="r2-title-render" role="radiogroup" aria-label="描画"><span>描画</span><div>${RENDER_CHOICES.map(([value, label]) => `<button data-render-mode="${value}" role="radio" aria-checked="${(ui.renderPreference ?? "auto") === value}">${label}</button>`).join("")}</div></div><p>現在：${mode}（${renderReasons[ui.render?.reason] ?? "自動"}）。設定はこのブラウザにだけ保存されます。</p>`;
}
// Outside the title stage (never on the CRT canvas), in the overlays the shell re-renders on every
// change: says the light form is on and offers the way back.
function renderNoteHtml(host) {
  if (host.screen !== "entry" || host.render?.mode !== "compat") return "";
  const back = host.renderUrl ? "<small>URLの指定が優先中</small>" : '<button data-render-mode="full">通常表示に戻す</button>';
  return `<aside class="r2-render-note" role="status"><span>軽量表示（WebGLなし）</span>${back}</aside>`;
}

function settingsHtml(state, ui) {
  // The title and the flow screens share the title options; the match has its own.
  if (ui.screen !== "game") {
    const volume = Math.max(0, Math.min(10, Number(ui.masterVolume ?? 7)));
    const toggle = (label, selector, checked) => `<button class="r2-title-setting" ${selector} role="checkbox" aria-checked="${checked}">${label}<span aria-hidden="true">${checked ? "☑" : "□"}</span></button>`;
    const contents = `<header><h2>オプション</h2><button data-live="close-options">閉じる</button></header><div class="r2-title-settings-list">${toggle("全画面", 'data-live="fullscreen"', Boolean(ui.fullscreen))}${toggle("PC版", 'data-view="pc"', ui.view === "pc")}${toggle("モバイル版", 'data-view="mobile"', ui.view === "mobile")}${toggle("通常タップで詳細", 'data-title-tap-details', Boolean(ui.tapDetails))}${toggle("演出", 'data-toggle-effects', Boolean(ui.effectsEnabled))}${ui.entryCrtMenu ? "" : renderModeHtml(ui)}<div class="r2-title-volume"><span>音量</span><div role="group" aria-label="音量 0～10">${Array.from({ length: 10 }, (_, index) => `<button data-volume="${index + 1}" aria-label="音量 ${index + 1}" aria-pressed="${index < volume}"></button>`).join("")}</div><output>${volume}/10</output></div><p>音量設定は今後のサウンド向けに保存されます。</p>${matchArchiveHtml(ui, toggle)}</div>`;
    return `<div class="r2-modal r2-title-options${ui.entryCrtMenu ? " r2-title-options-crt" : ""}" role="dialog" aria-modal="true" aria-label="オプション"><section>${contents}</section></div>`;
  }
  const users = selected => Object.entries(USER_CARDS).map(([id, user]) => `<option value="${id}" ${selected === id ? "selected" : ""}>${esc(user.name)}</option>`).join("");
  const busy = ui.busy === true;
  const setupOnly = ui.screen === "entry";
  const viewer = state.mode === "sandbox" ? `<label>操作表示側<select data-sandbox-actor ${state.sandboxUi?.opponentControl === "ai" ? "disabled" : ""}><option value="player" ${(ui.actor ?? "player") === "player" ? "selected" : ""}>YOU</option><option value="ai" ${ui.actor === "ai" ? "selected" : ""}>OPPONENT</option></select></label>` : "";
  const navigation = `<nav class="live-menu-nav"><button data-live="home" ${busy ? "disabled" : ""}>入口へ戻る</button><button data-deck-open>デッキ構築</button>${state.mode === "sandbox" ? '<button data-catalog-open>カード追加</button>' : ""}<button data-live="fullscreen">${ui.fullscreen ? "全画面を解除" : "全画面"}</button></nav><p>全画面はタップで開始します。通知バー・カメラ穴周辺の表示可否は端末とブラウザによります。</p>`;
  return `<div class="r2-modal runtime-host-options${ui.entryCrtMenu ? " r2-entry-crt-menu" : ""}" role="dialog" aria-modal="true" aria-label="オプション">${ui.entryCrtMenu ? '<svg class="r2-entry-crt-filter" aria-hidden="true" width="0" height="0"><filter id="r2-entry-menu-warp" x="-3%" y="-3%" width="106%" height="106%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.002 0.005" numOctaves="1" seed="7" result="grain"/><feDisplacementMap in="SourceGraphic" in2="grain" scale="2" xChannelSelector="R" yChannelSelector="G"/></filter></svg>' : ""}${setupOnly ? '<section><header><h2>オプション</h2><button data-live="close-options">閉じる</button></header>' : `<section class="cp-panel">${panelHeadHtml({ eyebrow: 'SYSTEM CONFIG', sub: 'OPTION.SYS', title: 'オプション', close: 'data-live="close-options"', closeLabel: 'オプションを閉じる' })}`}${navigation}${setupOnly ? '' : controlsHelpHtml()}<div class="r2-view-options"><button data-view="pc" aria-pressed="${ui.view === "pc"}">PC版</button><button data-view="mobile" aria-pressed="${ui.view === "mobile"}">モバイル版</button></div><p>${setupOnly ? "デッキ・ユーザーを選んでからモードを選択できます。" : "表示版の切替では対戦を保持します。デッキ・ユーザーの変更は新しい対戦を開始します。"}</p><label><input data-tap-details type="checkbox" ${ui.tapDetails ? "checked" : ""}>通常タップで詳細を表示（長押しは常に使用可）</label><button data-toggle-effects aria-pressed="${Boolean(ui.effectsEnabled)}">演出 ${ui.effectsEnabled ? "ON" : "OFF"}</button><div class="r2-match-archive">${matchArchiveHtml(ui, (label, selector, checked) => `<button ${selector} aria-pressed="${checked}">${label} ${checked ? "ON" : "OFF"}</button>`)}</div><label>ロゴのノイズ<select data-logo-profile>${[["random","ランダム切替"],["distress","劣化のみ"],["mosaic","モザイクのみ"]].map(([value,label])=>`<option value="${value}" ${(ui.logoNoiseProfile??"random")===value?"selected":""}>${label}</option>`).join("")}</select></label><label>ロゴのノイズ動画（任意）<input data-logo-video type="file" accept="video/*"></label><p>${ui.logoVideoName ? esc(ui.logoVideoName)+"（このタブのみ）" : "動画未選択：生成ノイズを使用"}</p>${ui.logoVideoName ? '<button data-logo-video-clear>生成ノイズに戻す</button>' : ""}<fieldset ${busy ? "disabled" : ""}><legend>対戦設定</legend>
    <label>学ぶ内容<select data-tutorial-select ${state.mode !== "tutorial" ? "disabled" : ""}><option value="basics" ${state.tutorialId === "basics" ? "selected" : ""}>基本操作・赤</option><option value="vengeance" ${state.tutorialId === "vengeance" ? "selected" : ""}>ヴェンジェンス・紫</option></select></label>
    ${["player", "ai"].map(id => `<label>${id === "player" ? "自分" : "相手"}デッキ<select data-${id}-deck ${!setupOnly && state.mode === "tutorial" ? "disabled" : ""}>${deckOptionsHtml(state, ui[`${id}DeckId`] ?? state[`${id}DeckId`])}</select></label><label>${id === "player" ? "自分" : "相手"}ユーザー<select data-${id}-user ${!setupOnly && state.mode === "tutorial" ? "disabled" : ""}>${users(ui[`${id}UserId`] ?? state[`${id}UserId`])}</select></label>`).join("")}
    ${state.mode === "sandbox" ? `<label>相手操作<select data-opponent-control><option value="manual">手動</option><option value="ai" ${state.sandboxUi?.opponentControl === "ai" ? "selected" : ""}>AI</option></select></label><label>アクティブ側<select data-sandbox-active ${state.sandboxUi?.opponentControl === "ai" ? "disabled" : ""}><option value="player" ${ui.activeSeat === "player" ? "selected" : ""}>YOU</option><option value="ai" ${ui.activeSeat === "ai" ? "selected" : ""}>OPPONENT</option></select></label>` : ""}</fieldset>${viewer}</section></div>`;
}


export function runtimeShellHtml(host) {
  const state = {mode:host.mode,tutorialId:host.tutorialId,savedDecks:host.savedDecks,deckBuilder:host.deckBuilder,
    sandboxUi:{...host.catalog,opponentControl:host.opponentControl},playerDeckId:host.playerDeckId,aiDeckId:host.aiDeckId};
  const ui = {...host,screen:host.screen,options:host.options,entryCrtMenu:host.effectsEnabled && host.screen === 'entry'};
  const entry = host.screen === 'entry' ? entryHtml(host.view,host.effectsEnabled).replace('data-deck ', 'data-deck-open ') + titleLinksHtml() : '';
  const flow = host.screen === 'tutorial-select' ? tutorialSelectHtml(host) : '';
  return `<div class="r2-content" data-effects="${host.effectsEnabled ? 'on' : 'off'}"><nav class="r2-utilities" aria-label="メニュー"><button data-live="options" aria-label="メニュー・オプション">メニュー</button></nav>${entry}${flow}<div data-match-root></div><div data-shell-overlays>${renderNoteHtml(host)}${host.options ? settingsHtml(state,ui) : ''}${deckBuilderHtml(state,{view:host.view})}${host.catalogOpen ? `<div class="live-catalog"><button data-live="close-catalog">閉じる</button>${sandboxCatalogHtml(state)}</div>` : ''}${host.notice ? `<aside class="r2-notice" role="status">${esc(host.notice)}</aside>` : ''}</div></div><section class="r2-rotate" hidden role="status"><h1>端末を横向きにしてください</h1><p>横に戻すと、そのまま続きから操作できます。</p></section>`;
}
