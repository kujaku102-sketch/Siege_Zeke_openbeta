import { CARD_LIBRARY, USER_CARDS } from '../data/cards.js';
import { CARD_ART } from '../data/card-art.generated.js';
import { BUILDABLE_CARDS, DECK_COLOR_OPTIONS, validateDeck } from '../game/deck-builder.js';
import { isObCard } from '../game/card-types.js';
import { cardEffectHtml } from './ability-help.js';

const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const paths = { new:'M12 4V20M4 12H20',save:'M4 3H17L21 7V21H3V3ZM7 3V10H16V3M7 21V14H17V21',delete:'M4 6H20M9 6V3H15V6M6 6L7 21H17L18 6',export:'M12 3V16M7 11L12 16L17 11M4 16V21H20V16',recommend:'M13 2L4 14H11L10 22L20 9H13Z',close:'M6 6L18 18M18 6L6 18' };
const icon = key => `<svg class="deck-control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[key]}"/></svg>`;
const categories = ['すべて','Ob','Code','Script','Sp'];
const categoryNav = ui => `<nav class="deck-category-filter" aria-label="カード種別">${categories.map(c=>`<button data-deck-category="${c}" aria-pressed="${(ui.category??'すべて')===c}">${c}</button>`).join('')}</nav>`;
const mobileFilters = ui => `<div class="deck-builder-tools"><input data-deck-query value="${esc(ui.query??'')}" placeholder="カード名 / ID"><select data-deck-color aria-label="色指定">${['all',...DECK_COLOR_OPTIONS].map(color=>`<option value="${color}" ${ui.color===color?'selected':''}>${color==='all'?'全色':color}</option>`).join('')}</select>${categoryNav(ui)}</div>`;
function mobileCards(state) {
 const ui=state.deckBuilder, draft=ui.draft, check=validateDeck(draft);
 const query=String(ui.query??'').toLowerCase();
 const cards=BUILDABLE_CARDS.filter(c=>(ui.color==='all'||(c.color??'無色')===ui.color)&&(!query||`${c.id} ${c.name}`.toLowerCase().includes(query))&&(!ui.category||ui.category==='すべて'||(ui.category==='Ob'?isObCard(c):c.category===ui.category)));
 const copiesByName=new Map();
 for(const [id,count] of Object.entries(draft.cards)) {
  const card=CARD_LIBRARY[id];
  if(card) copiesByName.set(card.name,(copiesByName.get(card.name)??0)+Number(count));
 }
 const art=c=>CARD_ART[c.id]?`<img src="${esc(CARD_ART[c.id])}" alt="" loading="lazy" decoding="async">`:`<span class="deck-art-missing">${esc(c.name[0])}</span>`;
 const tile=(c,count,summary)=>`<article class="deck-mobile-card" ${summary?'data-deck-summary-id':'data-deck-card-id'}="${esc(c.id)}">${art(c)}<b class="deck-mobile-cost">${esc(c.cost??'–')}</b><strong>${esc(c.name)}</strong><span class="deck-mobile-copies">${summary?`×${count}`:`${copiesByName.get(c.name)??0}/${check.rule.sameName}`}</span><button class="deck-mobile-hit" ${summary?'data-deck-minus':'data-deck-plus'}="${esc(c.id)}" aria-label="${esc(c.name)}を1枚${summary?'減らす':'増やす'}。長押しで詳細" ${!summary&&(check.count>=check.rule.size||(copiesByName.get(c.name)??0)>=check.rule.sameName)?'disabled':''}></button></article>`;
 const remaining=Math.max(0,check.rule.size-check.count);
 const blanks=remaining?Array.from({length:Math.min(10,remaining)},(_,index)=>`<article class="deck-mobile-card deck-mobile-placeholder" aria-hidden="true"><b>＋</b>${index===0?`<small>残り${remaining}枚</small>`:''}</article>`).join(''):'';
 const selected=Object.entries(draft.cards).filter(([id,n])=>n>0&&CARD_LIBRARY[id]).map(([id,n])=>tile(CARD_LIBRARY[id],n,true)).join('');
 return `<div class="deck-builder-body deck-mobile-body"><aside class="deck-summary"><h3>${esc(draft.name)} <small>${check.count}/${check.rule.size} · ${esc(USER_CARDS[draft.userId]?.name)}</small></h3><div class="deck-mobile-selected">${selected}${blanks}</div></aside>${mobileFilters(ui)}<div class="deck-mobile-catalog"><div class="deck-card-list">${cards.map(c=>tile(c,Number(draft.cards[c.id]??0),false)).join('')||'<p>一致するカードなし</p>'}</div></div></div>`;
}
function detail(ui) {
 const c=CARD_LIBRARY[ui.detailId];if(!c)return '';
 const text=cardEffectHtml(c.text);
 return `<div class="deck-detail-overlay" role="dialog" aria-modal="true" aria-label="カード詳細"><section><button data-deck-detail-close>閉じる</button>${CARD_ART[c.id]?`<img src="${esc(CARD_ART[c.id])}" alt="">`:''}<div><h2>${esc(c.name)}</h2><p>${esc(c.id)} · ${esc(c.category)} · メモリ ${esc(c.cost??'–')}</p><p>${esc((c.classes??[]).join(' / '))}</p><p class="card-effect-copy">${text}</p><button data-deck-minus="${c.id}" ${(ui.draft.cards[c.id]??0)?'':'disabled'}>−</button> ${ui.draft.cards[c.id]??0}枚 <button data-deck-plus="${c.id}">＋</button></div></section></div>`;
}
export function deckPresentation(html,state,{view=state.deckBuilder.view??'pc',effectsEnabled=state.deckBuilder.effectsEnabled??false}={}) {
 const ui=state.deckBuilder;
 html=html.replace('class="effect-modal deck-builder-modal"',`class="effect-modal deck-builder-modal deck-design" data-deck-view="${view==='mobile'?'mobile':'pc'}" data-deck-fx="${effectsEnabled?'on':'off'}" data-deck-panel="${ui.managementOpen?'open':'closed'}" data-deck-auto="${ui.autoBuildOpen?'open':'closed'}"`);
 if(view==='mobile') {
  html=html.replace(/<div class="deck-builder-tools">[\s\S]*?<\/div>/,'');
  const start=html.indexOf('<div class="deck-builder-body">');
  html=html.slice(0,start)+mobileCards(state)+'</section></div>';
 }
 html=html.replace('</header>',`<nav class="deck-header-actions">${view==='mobile'?`<button data-deck-auto-build aria-expanded="${Boolean(ui.autoBuildOpen)}">自動構築</button><button data-deck-management aria-expanded="${Boolean(ui.managementOpen)}">デッキ管理</button>`:''}</nav></header>`);
 for(const key of Object.keys(paths))html=html.replace(new RegExp(`(<button data-deck-${key}[^>]*>)`),`$1${icon(key)}`);
 return html+detail(ui);
}
