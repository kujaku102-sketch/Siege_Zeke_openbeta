import { TUTORIAL_ITEMS } from './tutorial-items.js';

// Screens between the title and a match (V092-08). Each has its own [戻る]; Escape does the same.
const esc = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const head = (id, title) => `<header class="r2-flow-head"><button class="r2-flow-back" data-flow-back>戻る</button><h1 id="${id}">${title}</h1></header>`;

// Battle against the CPU (Q6–Q9): deck and user for each side, the same choices as the match
// options. There is one CPU, so no strength is offered. Online play is a placeholder (Q1, Q2):
// marked 準備中, it does nothing when pressed. `deckOptions` / `userOptions` build the <option>s.
export function battleSetupHtml(host, { deckOptions, userOptions }) {
  const side = (id, label) => `<fieldset class="r2-flow-side" data-side="${id}"><legend>${label}</legend>`
    + `<label>デッキ<select data-${id}-deck>${deckOptions(host[`${id}DeckId`])}</select></label>`
    + `<label>ユーザー<select data-${id}-user>${userOptions(host[`${id}UserId`])}</select></label></fieldset>`;
  return `<section class="r2-flow r2-flow-battle" data-flow-screen="battle-setup" aria-labelledby="r2-flow-battle-title"><div class="r2-flow-sheet">${head("r2-flow-battle-title", "対戦")}`
    + `<p class="r2-flow-lead">対戦相手：CPU</p><div class="r2-flow-sides">${side("player", "自分")}${side("ai", "相手（CPU）")}</div>`
    + `<div class="r2-flow-actions"><button data-deck-open>デッキ構築</button><button class="r2-flow-primary" data-start="ai">対戦開始</button>`
    + `<button class="r2-flow-online" data-online-battle aria-disabled="true">オンライン対戦<small>準備中</small></button></div></div></section>`;
}

// Each tutorial with its finished mark (kept in this browser) and its own start button.
export function tutorialSelectHtml({ tutorialDone = [] } = {}) {
  const items = TUTORIAL_ITEMS.map(item => {
    const done = tutorialDone.includes(item.id);
    return `<li class="r2-flow-item" data-tutorial-item="${item.id}" data-done="${done}"><div class="r2-flow-item-text"><h2>${esc(item.title)}<small>${esc(item.color)}</small></h2><p>${esc(item.summary)}</p></div>`
      + `<span class="r2-flow-mark">${done ? "✓ 完了" : "未完了"}</span><button class="r2-flow-primary" data-start="tutorial" data-tutorial-id="${item.id}" aria-label="${esc(item.title)}をはじめる">はじめる</button></li>`;
  }).join("");
  return `<section class="r2-flow r2-flow-tutorials" data-flow-screen="tutorial-select" aria-labelledby="r2-flow-tutorials-title"><div class="r2-flow-sheet">${head("r2-flow-tutorials-title", "チュートリアル")}`
    + `<p class="r2-flow-lead">終えた項目には完了の印がつきます（このブラウザにだけ保存）。</p><ol class="r2-flow-list">${items}</ol></div></section>`;
}
