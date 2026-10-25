import { TUTORIAL_ITEMS } from './tutorial-items.js';

// Screens between the title and a match (V092-08). Each has its own [戻る]; Escape does the same.
const esc = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const head = (id, title) => `<header class="r2-flow-head"><button class="r2-flow-back" data-flow-back>戻る</button><h1 id="${id}">${title}</h1></header>`;

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
