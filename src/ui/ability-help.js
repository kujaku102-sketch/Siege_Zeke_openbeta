import { ABILITY_GLOSSARY } from '../data/ability-glossary.js';
import { abilityBadgeDefinition } from '../data/ability-badges.js';
import { screenUnit } from '../ui-refresh/screen-unit.js';

const esc = value => String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const byAlias = new Map(ABILITY_GLOSSARY.flatMap(a=>a.aliases.map(name=>[name.toUpperCase(),a])));
const pattern = /『[^』\n]+』|\[[^\[\]\n]*\]|［[^［］\n]*］|パラレルオーバーライド|テンポラリレイヤー|レイヤード|オーバーライド|アップデート|サルベージ|デコード|コンポーネント|レイヤー|ドラッグ|アクセス/g;
const tone = label => ({アクセス:'access',レイヤー:'layer',コンポーネント:'component'})[label] ?? '';
const link = (label,ability,styled=false) => `<button type="button" class="ability-help-trigger" data-ability-help="${ability.id}"${styled&&tone(label)?` data-ability-tone="${tone(label)}"`:''} aria-haspopup="dialog" aria-expanded="false">${esc(label)}</button>`;
const icon = (label,ability,asset) => `<button type="button" class="ability-help-trigger effect-ability-icon" data-ability-help="${ability.id}" aria-label="${esc(label)}の説明" title="${esc(label)}" aria-haspopup="dialog" aria-expanded="false"><img src="${esc(asset)}" alt="" loading="lazy" decoding="async"></button>`;
function renderAbilityText(value, illustrated) {
 const text=String(value??'');let result='',cursor=0;
 for(const match of text.matchAll(pattern)) {
  result+=esc(text.slice(cursor,match.index));const token=match[0];
  if(token.startsWith('『')) {
   result+=illustrated?`<span class="effect-card-reference">${esc(token)}</span>`:esc(token);
  }else
  if(token.startsWith('[')||token.startsWith('［')) {
   const inner=token.slice(1,-1), label=inner.split(/[:：]/)[0];
   const ability=byAlias.get(label.trim().toUpperCase());
   const asset=illustrated&&ability?abilityBadgeDefinition(label.trim()).asset:null;
   const value=inner.slice(label.length);
   result+=asset?icon(label,ability,asset)+(value?`<span class="effect-ability-value">${esc(value)}</span>`:''):ability?esc(token[0])+link(label,ability,illustrated)+esc(value)+esc(token.at(-1)):esc(token);
  }else {const ability=byAlias.get(token.toUpperCase());result+=ability?link(token,ability,illustrated):illustrated&&tone(token)?`<span class="effect-term effect-term-${tone(token)}">${esc(token)}</span>`:esc(token);}
  cursor=match.index+token.length;
 }
 return result+esc(text.slice(cursor));
}
export const abilityTextHtml = value => renderAbilityText(value,false);
export const cardEffectHtml = value => renderAbilityText(value,true);

export function installAbilityHelp(root) {
 const panel=document.createElement('aside');panel.id='ability-help-popup';panel.className='ability-help-popup';
 panel.setAttribute('popover','auto');panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby','ability-help-title');
 panel.innerHTML='<header><h3 id="ability-help-title"></h3><button type="button" aria-label="能力解説を閉じる">×</button></header><p></p><small>能力用語集</small>';
 document.body.append(panel);let anchor=null;
 const native=typeof panel.showPopover==='function';if(!native)panel.hidden=true;
 const close=()=>{anchor?.setAttribute('aria-expanded','false');if(native&&panel.matches(':popover-open'))panel.hidePopover();else if(!native)panel.hidden=true;anchor=null;};
 panel.querySelector('button').onclick=()=>{const previous=anchor;close();if(previous?.isConnected)previous.focus({preventScroll:true});};
 panel.addEventListener('toggle',e=>{if(e.newState==='closed'){anchor?.setAttribute('aria-expanded','false');anchor=null;}});
 root.addEventListener('pointerdown',e=>{if(e.target.closest('[data-ability-help]'))e.stopPropagation();},true);
 root.addEventListener('click',e=>{
  const button=e.target.closest('[data-ability-help]');if(!button)return;
  e.preventDefault();e.stopPropagation();if(anchor===button){close();return;}
  const ability=ABILITY_GLOSSARY.find(a=>a.id===button.dataset.abilityHelp);if(!ability)return;
  close();anchor=button;panel.querySelector('h3').textContent=ability.name;panel.querySelector('p').textContent=ability.description;
  button.setAttribute('aria-expanded','true');button.setAttribute('aria-controls',panel.id);
  if(native)panel.showPopover();else panel.hidden=false;
  // Edge margin and gap in the screen unit (--u), not fixed px.
  const r=button.getBoundingClientRect(),box=panel.getBoundingClientRect(),u=screenUnit(document),edge=u*.5,gap=u*.375;
  panel.style.left=`${Math.max(edge,Math.min(r.left,innerWidth-box.width-edge))}px`;
  const above=r.top-box.height-gap;
  panel.style.top=`${above>=edge?above:Math.max(edge,Math.min(r.bottom+gap,innerHeight-box.height-edge))}px`;
 },true);
 document.addEventListener('pointerdown',e=>{if(anchor&&!panel.contains(e.target)&&!e.target.closest('[data-ability-help]'))close();},true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&anchor){e.stopImmediatePropagation();e.preventDefault();const previous=anchor;close();previous?.focus({preventScroll:true});}},true);
 window.addEventListener('resize',close);
 document.addEventListener('scroll',e=>{if(anchor&&!panel.contains(e.target))close();},true);
 new MutationObserver(()=>{if(anchor&&!anchor.isConnected)close();}).observe(root,{childList:true,subtree:true});
}
