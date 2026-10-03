import { CARD_LIBRARY } from "../data/cards.js";
import { CARD_ART } from "../data/card-art.generated.js";
import { esc } from "./view.js";

function actionText(entry, card) {
  const text = String(entry.text ?? "");
  if (!card) return text;
  for (const prefix of [`${card.name}:`, `${card.name}：`, `誘発: ${card.name}`]) {
    if (text.startsWith(prefix)) return text.slice(prefix.length).trim();
  }
  return text;
}

function numberBadges(text) {
  const badges = [];
  const str = text.match(/STR\s*(\d+)\s*→\s*(\d+)/i);
  if (str) badges.push(`STR ${str[1]}→${str[2]}`);
  const stats = text.match(/([+-]\d+)\s*\/\s*([+-]\d+)/);
  if (stats) badges.push(`ATK ${stats[1]} / STR ${stats[2]}`);
  const damage = text.match(/(\d+)\s*ダメージ/);
  if (damage) badges.push(`${damage[1]} DAMAGE`);
  return badges.slice(0, 2);
}

function entryHtml(entry) {
  const card = CARD_LIBRARY[entry.cardId];
  const side = entry.actor === "player" ? "mine" : entry.actor === "ai" ? "theirs" : "system";
  const art = card && CARD_ART[card.id];
  const portrait = card ? `<span class="action-log-icon">${art
    ? `<img src="${esc(art)}" alt="" loading="lazy" decoding="async">`
    : `<span aria-hidden="true">${esc(card.name.slice(0, 1))}</span>`}</span>` : "";
  const combat = entry.combat;
  const badges = combat ? [
    `${combat.damage} DAMAGE`, `対象 STR ${combat.targetStrBefore}→${combat.targetStrAfter}`,
    ...(combat.counterDamage === undefined ? [] : [`反撃 ${combat.counterDamage} DAMAGE`, `攻撃元 STR ${combat.sourceStrBefore}→${combat.sourceStrAfter}`])
  ] : numberBadges(String(entry.text ?? ""));
  return `<article class="action-log-entry is-${side}" data-tone="${esc(entry.tone)}"${combat ? ' data-combat="true"' : ""}>
    ${portrait}<div class="action-log-entry-body"><small>${side === "mine" ? "YOU" : side === "theirs" ? "OPPONENT" : "SYSTEM"}${card ? ` · ${esc(card.name)}` : ""}</small>
    <p>${esc(combat ? `${card?.name ?? "攻撃元"} → ${combat.targetName}` : actionText(entry, card))}</p>${badges.length ? `<div class="action-log-numbers">${badges.map((badge) => `<b>${esc(badge)}</b>`).join("")}</div>` : ""}</div>
  </article>`;
}

export function actionLogHtml(state) {
  const entries = state.log.slice(-80);
  let previousTurn = null;
  const timeline = entries.map((entry) => {
    const turn = Number.isInteger(entry.turn) ? entry.turn : state.turnNumber;
    const turnActor = entries.find((item) => item.turn === turn && item.tone === "turn")?.actor;
    const separator = turn !== previousTurn ? `<div class="action-log-turn"><span>TURN ${esc(turn)}${turnActor === "player" ? " · YOU" : turnActor === "ai" ? " · OPPONENT" : ""}</span></div>` : "";
    previousTurn = turn;
    return separator + entryHtml(entry);
  }).join("");
  return `<aside class="r2-action-log" role="dialog" aria-label="対戦ログ" aria-modal="false">
    <header><div><span>BATTLE RECORD</span><h2>対戦ログ</h2></div><button data-live="close-log" aria-label="対戦ログを閉じる">×</button></header>
    <div class="action-log-timeline" tabindex="0" aria-label="ターン順の行動記録">${timeline || '<p class="action-log-empty">まだ行動はありません。</p>'}</div>
  </aside>`;
}
