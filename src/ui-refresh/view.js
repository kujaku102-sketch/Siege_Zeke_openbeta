import { cardHtml, sideHtml, handCardsHtml } from "../ui/render.js";
import { findCard, cardAtk, cardCurrentStr } from "../game/engine.js";
import { CARD_ART } from "../data/card-art.generated.js";
import { placementOptions } from "./placement.js";
import { isObCard } from "../game/card-types.js";
const entryLogo = new URL("../assets/siege-zeke-logo-layers.svg", import.meta.url).href;
const entryStaticLogo = new URL("../assets/siege-zeke-logo-static.png", import.meta.url).href;

export const esc = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const entryIcon = (kind) => {
  const paths = {
    tutorial: '<path d="M4 7.5 11 5l6 2.5L24 5l7 2.5v19L24 24l-7 2.5-6-2.5-7 2.5zM17 7.5v19M8 11.5l4-1.5M22 11.5l5-1.5"/><path d="M3 3h5m-2-2v5M29 28h4m-2-2v4"/>',
    ai: '<path d="m17 3 12 7v14l-12 7L5 24V10zM11 15h12v9H11zM14 19h.01M20 19h.01M17 3v6M2 14h3m24 0h3"/><path d="M14 27h6"/>',
    sandbox: '<path d="M12 3h10M14 3v9l-8 15a3 3 0 0 0 2.6 4h16.8a3 3 0 0 0 2.6-4L20 12V3M11 23h12M15 18h4M4 6h4m-2-2v4M29 8h3m-1-1v3"/>',
    deck: '<path d="m4 10 13-6 13 6-13 6zM4 16l13 6 13-6M4 22l13 6 13-6M9 10h4m8 0h4"/><path d="M3 3h4m-2-2v4M29 28h4m-2-2v4"/>'
  };
  return `<svg class="r2-entry-icon" viewBox="0 0 34 34" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${paths[kind]}</svg>`;
};
export const modes = { tutorial: "チュートリアル", ai: "AI対戦", sandbox: "実験場" };
export function entryHtml(view, effectsEnabled = true) {
  return `<section class="r2-entry" aria-label="モード選択"><div class="r2-entry-inner"><div class="r2-intro"><h1><img src="${effectsEnabled ? entryLogo : entryStaticLogo}" alt="Siege÷Zeke" data-logo-static="${!effectsEnabled}"><canvas class="r2-logo-canvas" aria-hidden="true"></canvas></h1></div>
    <nav class="r2-mode-grid" aria-label="始めるモード"><button data-mode="tutorial">${entryIcon("tutorial")}<strong>チュートリアル</strong></button><button data-mode="ai">${entryIcon("ai")}<strong>AI対戦</strong></button><button data-mode="sandbox">${entryIcon("sandbox")}<strong>実験場</strong></button><button data-deck class="r2-deck-entry">${entryIcon("deck")}<strong>デッキ構築</strong></button></nav>
    </div></section>`;
}

export function boardHtml(state) {
  return `<div class="r2-board" data-layer="board" aria-label="既存盤面UIを収める4対3表示領域"><div class="r2-board-fit"><div class="battle-board">${sideHtml(state, "ai", true)}${sideHtml(state, "player", false)}</div></div></div>`;
}
export function handHtml(state) {
  return `<section class="r2-hand" aria-label="自分の手札 ${state.players.player.hand.length}枚"><div class="r2-hand-scroll" tabindex="0" aria-label="手札を横スクロール">${handCardsHtml(state, "player")}</div></section>`;
}
function consoleHtml(mode) {
  return `<aside class="r2-console" aria-label="操作コンソール"><span class="r2-eyebrow">COMMAND</span><strong>${modes[mode]}</strong><div class="r2-turn">TURN 01 <b>YOU</b></div><button disabled title="対戦処理への接続待ち">ターン終了</button><button data-cancel disabled title="中止する選択はありません">中止</button><button data-log>ログ</button><small>${mode === "sandbox" ? "通常Obの配置のみ接続" : "画面の見本 / 対戦未接続"}</small></aside>`;
}
export function desktopHtml(state, mode) {
  return `<main class="r2-desktop" data-layout="desktop"><div class="r2-stage">${boardHtml(state)}<div class="r2-table-label">BATTLEFIELD / FIXED 4:3</div></div><div class="r2-desktop-tools">${consoleHtml(mode)}</div><div class="r2-desktop-hand" data-layer="hand">${handHtml(state)}</div><button class="r2-hand-toggle" data-hand-toggle aria-expanded="true">手札を畳む</button></main>`;
}
export function mobileHtml(state, mode) {
  return `<main class="r2-mobile" data-layout="mobile"><div class="r2-stage">${boardHtml(state)}</div><div class="r2-mobile-tools">${consoleHtml(mode)}</div><div class="r2-mobile-hand" data-layer="hand">${handHtml(state)}</div><button class="r2-hand-toggle" data-hand-toggle aria-expanded="true">手札を畳む</button></main>`;
}
export function visibleCard(state, uid) {
  const found = uid ? findCard(state, uid) : null;
  if (!found || found.zoneName === "deck" || (found.playerId === "ai" && (found.zoneName === "hand" || found.card.faceDown))) return null;
  return found;
}
export function detailHtml(state, uid) {
  const found = visibleCard(state, uid);
  if (!found) return "";
  const { card, playerId, zoneName } = found;
  const art = CARD_ART[card.id];
  // Card art stays in the existing card renderer; detail text is always escaped.
  return `<aside class="r2-detail" aria-label="カード詳細"><header><span>CARD INSPECTOR</span><button data-close-detail aria-label="詳細を閉じる">×</button></header><div class="r2-detail-identity"><div class="r2-detail-mini">${cardHtml(state, playerId, card, zoneName)}</div><div><small>${esc(card.id)} / ${esc(card.category)}</small><h2>${esc(card.name)}</h2><span>${playerId === "player" ? "自分" : "相手"} / ${esc(zoneName)}</span></div></div><dl><div><dt>MEM</dt><dd>${esc(card.cost ?? "—")}</dd></div><div><dt>ATK</dt><dd>${isObCard(card) ? cardAtk(state, playerId, card) : "—"}</dd></div><div><dt>STR</dt><dd>${isObCard(card) ? cardCurrentStr(state, playerId, card) : "—"}</dd></div></dl><p class="r2-card-text">${esc(card.text || "効果なし")}</p><div class="r2-card-meta">${esc((card.classes ?? []).join(" / "))} · ${card.sleep ? "スリープ" : "スタンバイ"}${art ? " · ART" : ""}</div><details><summary>レイヤー・付与</summary><p>${[card, ...(card.mounted ?? [])].map(c => esc(c.name)).join(" → ")}</p><p>${esc((card.grantedKeywords ?? []).join(" / ") || "追加付与なし")}</p></details></aside>`;
}
export function popupHtml(state, uid, { placementEnabled = false, draft = null } = {}) {
  const found = visibleCard(state, uid);
  if (!found) return "";
  const { card, zoneName, playerId } = found;
  if (placementEnabled && playerId === "player" && zoneName === "hand" && isObCard(card)) {
    const options = placementOptions(state, uid);
    const choosing = draft?.sourceUid === uid;
    return `<aside class="r2-popup" aria-label="カード操作"><strong>${esc(card.name)}</strong><div><button data-begin-placement ${choosing || !options.slots.length ? "disabled" : ""}>${choosing ? "配置先を選択中" : "実行する"}</button><button disabled>インストール</button></div><small>${choosing ? "明るいマスをタップで確定 · 中止で解除" : esc(options.reason)}</small></aside>`;
  }
  const actions = playerId === "ai" ? ["相手カード / 閲覧のみ"] : zoneName === "hand"
    ? card.category === "Sp" ? ["起動する", "インストール"] : [card.category === "Script" ? "設置する" : "実行する", "インストール"]
    : zoneName === "front" ? ["攻撃", "アップデート"] : ["カード操作"];
  return `<aside class="r2-popup" aria-label="カード操作"><strong>${esc(card.name)}</strong><div>${actions.map(label => `<button disabled>${label}</button>`).join("")}</div><small>操作配置の見本 · ルール接続前</small></aside>`;
}
