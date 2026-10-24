import { CARD_LIBRARY, USER_CARDS } from '../data/cards.js';
import { CARD_ART } from '../data/card-art.generated.js';
import { BUILDABLE_CARDS, DECK_COLOR_OPTIONS, DECK_STRATEGIES, MAX_SAVED_DECKS, validateDeck } from '../game/deck-builder.js';
import { isObCard } from '../game/card-types.js';
import { cardEffectHtml } from './ability-help.js';

// One deck builder for every view. PC and mobile share these parts; the
// data-deck-view attribute only lets CSS change spacing, type size and columns.
const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const icon = () => `<svg class="deck-control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18"/></svg>`;
const categories = ['すべて','Ob','Code','Script','Sp'];
const categoryNav = ui => `<nav class="deck-category-filter" aria-label="カード種別">${categories.map(c=>`<button data-deck-category="${c}" aria-pressed="${(ui.category??'すべて')===c}">${c}</button>`).join('')}</nav>`;
const filters = ui => `<div class="deck-builder-tools"><input data-deck-query value="${esc(ui.query??'')}" placeholder="カード名 / ID"><select data-deck-color aria-label="色指定">${['all',...DECK_COLOR_OPTIONS].map(color=>`<option value="${color}" ${ui.color===color?'selected':''}>${color==='all'?'全色':color}</option>`).join('')}</select>${categoryNav(ui)}</div>`;
const management = (state,draft) => `<section class="deck-management"><h2>保存デッキ ${state.savedDecks.length}/${MAX_SAVED_DECKS}</h2><div class="deck-builder-toolbar">
 <select data-deck-load><option value="">新規デッキ</option>${state.savedDecks.map(deck=>`<option value="${esc(deck.id)}" ${draft.id===deck.id?'selected':''}>${esc(deck.name)}${validateDeck(deck).valid?'':'（要修正）'}</option>`).join('')}</select>
 <button data-deck-new>新規</button><button data-deck-delete ${state.savedDecks.some(deck=>deck.id===draft.id)?'':'disabled'}>削除</button>
 <button data-deck-export>JSON出力</button><label class="deck-import">JSON読込<input type="file" accept="application/json" data-deck-import></label>
 </div></section>`;
const recommender = ui => `<section class="deck-recommender"><b>AUTO BUILD</b><select data-deck-recommend-color>${DECK_COLOR_OPTIONS.filter(color=>color!=='無色').map(color=>`<option value="${color}" ${ui.recommendColor===color?'selected':''}>${color}</option>`).join('')}</select><select data-deck-strategy>${Object.entries(DECK_STRATEGIES).map(([id,label])=>`<option value="${id}" ${ui.strategy===id?'selected':''}>${label}</option>`).join('')}</select><button data-deck-recommend class="primary">推奨構築を生成</button><span>${esc(ui.recommendationNote??'色と戦術から完成デッキを生成する。')}</span></section>`;
function cardsHtml(ui, check) {
 const draft=ui.draft;
 const query=String(ui.query??'').toLowerCase();
 const cards=BUILDABLE_CARDS.filter(c=>(ui.color==='all'||(c.color??'無色')===ui.color)&&(!query||`${c.id} ${c.name}`.toLowerCase().includes(query))&&(!ui.category||ui.category==='すべて'||(ui.category==='Ob'?isObCard(c):c.category===ui.category)));
 const copiesByName=new Map();
 for(const [id,count] of Object.entries(draft.cards)) {
  const card=CARD_LIBRARY[id];
  if(card) copiesByName.set(card.name,(copiesByName.get(card.name)??0)+Number(count));
 }
 const art=c=>CARD_ART[c.id]?`<img src="${esc(CARD_ART[c.id])}" alt="" loading="lazy" decoding="async">`:`<span class="deck-art-missing">${esc(c.name[0])}</span>`;
 const tile=(c,count,summary)=>`<article class="deck-tile" ${summary?'data-deck-summary-id':'data-deck-card-id'}="${esc(c.id)}">${art(c)}<b class="deck-tile-cost">${esc(c.cost??'–')}</b><strong>${esc(c.name)}</strong><span class="deck-tile-copies">${summary?`×${count}`:`${copiesByName.get(c.name)??0}/${check.rule.sameName}`}</span><button class="deck-tile-hit" ${summary?'data-deck-minus':'data-deck-plus'}="${esc(c.id)}" aria-label="${esc(c.name)}を1枚${summary?'減らす':'増やす'}。長押しで詳細" ${!summary&&(check.count>=check.rule.size||(copiesByName.get(c.name)??0)>=check.rule.sameName)?'disabled':''}></button></article>`;
 const remaining=Math.max(0,check.rule.size-check.count);
 const blanks=remaining?Array.from({length:Math.min(10,remaining)},(_,index)=>`<article class="deck-tile deck-tile-placeholder" aria-hidden="true"><b>＋</b>${index===0?`<small>残り${remaining}枚</small>`:''}</article>`).join(''):'';
 const selected=Object.entries(draft.cards).filter(([id,n])=>n>0&&CARD_LIBRARY[id]).map(([id,n])=>tile(CARD_LIBRARY[id],n,true)).join('');
 return `<div class="deck-builder-body deck-body"><aside class="deck-summary" aria-label="構築カード"><div class="deck-selected">${selected}${blanks}</div></aside>${filters(ui)}<div class="deck-catalog" aria-label="候補カード"><div class="deck-card-list">${cards.map(c=>tile(c,Number(draft.cards[c.id]??0),false)).join('')||'<p>一致するカードなし</p>'}</div></div></div>`;
}
function detail(ui) {
 const c=CARD_LIBRARY[ui.detailId];if(!c)return '';
 const text=cardEffectHtml(c.text);
 return `<div class="deck-detail-overlay" role="dialog" aria-modal="true" aria-label="カード詳細"><section><button data-deck-detail-close>閉じる</button>${CARD_ART[c.id]?`<img src="${esc(CARD_ART[c.id])}" alt="">`:''}<div><h2>${esc(c.name)}</h2><p>${esc(c.id)} · ${esc(c.category)} · メモリ ${esc(c.cost??'–')}</p><p>${esc((c.classes??[]).join(' / '))}</p><p class="card-effect-copy">${text}</p><button data-deck-minus="${c.id}" ${(ui.draft.cards[c.id]??0)?'':'disabled'}>−</button> ${ui.draft.cards[c.id]??0}枚 <button data-deck-plus="${c.id}">＋</button></div></section></div>`;
}
export function deckPresentation(state,{view=state.deckBuilder.view??'pc',effectsEnabled=state.deckBuilder.effectsEnabled??false}={}) {
 const ui=state.deckBuilder,draft=ui.draft,check=validateDeck(draft);
 const errors=check.errors.filter(error=>!error.startsWith('カード枚数 '));
 return `<div class="effect-modal deck-builder-modal deck-design" data-deck-view="${view==='mobile'?'mobile':'pc'}" data-deck-fx="${effectsEnabled?'on':'off'}" data-deck-panel="${ui.managementOpen?'open':'closed'}" data-deck-auto="${ui.autoBuildOpen?'open':'closed'}"><section class="deck-builder" aria-label="デッキ構築">
 <header class="deck-toolbar">
 <input data-deck-name value="${esc(draft.name)}" maxlength="40" aria-label="デッキ名">
 <select data-deck-user aria-label="ユーザーカード">${Object.entries(USER_CARDS).map(([id,c])=>`<option value="${esc(id)}" ${id===draft.userId?'selected':''}>${esc(c.name)}</option>`).join('')}</select>
 <button data-deck-save class="primary" ${check.valid?'':'disabled title="構築規定を満たしてから保存できます"'}>保存</button>
 <button data-deck-auto-build aria-expanded="${Boolean(ui.autoBuildOpen)}">自動構築</button><button data-deck-management aria-label="デッキ管理" aria-expanded="${Boolean(ui.managementOpen)}">管理</button><button data-deck-close aria-label="閉じる">${icon()}</button>
 </header>
 <div class="deck-validation ${check.valid?'valid':'invalid'}" role="status"><b>${check.valid?'構築OK':'構築未完了'}</b><span>${check.count}/${check.rule.size} · 同名${check.rule.sameName}枚まで${errors.length?` / ${esc(errors.join(' / '))}`:''}</span></div>
 ${ui.managementOpen?management(state,draft):''}
 ${ui.autoBuildOpen?`<div class="deck-auto"><header><b>自動構築</b><button data-deck-auto-build aria-label="自動構築を閉じる">${icon()}</button></header>${recommender(ui)}</div>`:''}
 ${cardsHtml(ui,check)}</section></div>${detail(ui)}`;
}
