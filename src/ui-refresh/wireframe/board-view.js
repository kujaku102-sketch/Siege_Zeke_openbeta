import { CARD, project, rectangle, points, boardSlots, slotKey, cardSolid, pileHeight } from './geometry.js';
import { resolveInteractionTarget } from '../../adapters/interaction-targets.js';
import { CARD_ART } from '../../data/card-art.generated.js';

const esc = text => String(text ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const poly = (x,y,w,h,attrs='') => `<polygon points="${points(rectangle(x,y,w,h))}" ${attrs}/>`;
const label = (x,y,text,css='board-label',z=0) => {const p=project(x,y,z);return `<text x="${p.x}" y="${p.y}" class="${css}" text-anchor="middle">${esc(text)}</text>`;};
const name = card => card.faceDown ? '裏向きカード' : card.definition.name;
const horizontal = card => !card.faceDown && (card.status.sleep || ['Code','Plugin'].includes(card.definition.category));
// SVG has no perspective transform, so the art is laid in thin strips, each an
// affine map of its own slice of the projected top face.
const ART_STRIPS = 8;
function cardArtFace(card, cx, cy, horizontalCard, css) {
  const source = !card.faceDown && CARD_ART[card.definition.id];
  if (!source) return '';
  const w = horizontalCard ? CARD.height : CARD.width, h = horizontalCard ? CARD.width : CARD.height;
  const z = pileHeight(1), left = cx - w / 2, top = cy - h / 2, step = h / ART_STRIPS;
  // A sleeping unit lies on its side; Code and Plugin art is already landscape.
  const turned = horizontalCard && !['Code','Plugin'].includes(card.definition.category);
  const image = turned
    ? `<image href="${esc(source)}" x="${(w-h)/2}" y="${(h-w)/2}" width="${h}" height="${w}" transform="rotate(90 ${w/2} ${h/2})" preserveAspectRatio="xMidYMid slice"/>`
    : `<image href="${esc(source)}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`;
  const strips = Array.from({length: ART_STRIPS}, (_, i) => {
    const y0 = i * step, overlap = i < ART_STRIPS - 1 ? .6 : 0;
    const p0 = project(left, top + y0, z), p1 = project(left + w, top + y0, z), p2 = project(left, top + y0 + step, z);
    const a = (p1.x - p0.x) / w, b = (p1.y - p0.y) / w, c = (p2.x - p0.x) / step, d = (p2.y - p0.y) / step;
    return `<g transform="matrix(${a} ${b} ${c} ${d} ${p0.x - c * y0} ${p0.y - d * y0})"><svg x="0" y="${y0}" width="${w}" height="${step + overlap}" viewBox="0 ${y0} ${w} ${step + overlap}" overflow="hidden">${image}</svg></g>`;
  }).join('');
  return `<g class="card-art-face" pointer-events="none">${strips}</g><polygon class="${css} art-frame" points="${points(rectangle(cx, cy, CARD.width, CARD.height, horizontalCard, z))}"/>`;
}
// Security hologram: a shield floating upright above a front Security Ob,
// faint on standby and a solid metal plate while asleep (the forced target).
const SHIELD_PATH = 'M40 4 72 17v30c0 21-13 35-32 45C21 82 8 68 8 47V17Z';
const SHIELD_DEFS = `<linearGradient id="wf-shield-metal" x1="0" y1="0" x2=".8" y2="1"><stop offset="0" stop-color="#f4fbff"/><stop offset=".22" stop-color="#9fb4c0"/><stop offset=".4" stop-color="#e3eef4"/><stop offset=".6" stop-color="#61798a"/><stop offset=".78" stop-color="#c9d8e1"/><stop offset="1" stop-color="#53697a"/></linearGradient><linearGradient id="wf-holo-beam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#63eaff" stop-opacity=".55"/><stop offset="1" stop-color="#63eaff" stop-opacity="0"/></linearGradient><clipPath id="wf-shield-clip"><path d="${SHIELD_PATH}"/></clipPath>`;
function securityShield(card, cx, cy) {
  const state = card.interaction?.securityShield;
  if (!state) return '';
  const base = project(cx, cy, pileHeight(1)), lift = project(cx, cy, 78);
  const width = (project(cx + CARD.width / 2, cy, 78).x - project(cx - CARD.width / 2, cy, 78).x) * .58, scale = width / 80;
  const top = { x: lift.x - 40 * scale, y: lift.y - 96 * scale };
  const beam = `<polygon class="wf-shield-beam" points="${base.x - width * .12},${base.y} ${base.x + width * .12},${base.y} ${lift.x + width * .42},${lift.y - 14 * scale} ${lift.x - width * .42},${lift.y - 14 * scale}"/>`;
  const plate = state === 'guard' ? `<path class="wf-shield-plate" d="${SHIELD_PATH}"/><g clip-path="url(#wf-shield-clip)"><rect class="wf-shield-sheen" x="-60" y="-10" width="26" height="120" transform="skewX(-18)"/></g>` : '';
  return `<g class="wf-shield is-${state}" pointer-events="none">${beam}<ellipse class="wf-shield-emitter" cx="${base.x}" cy="${base.y}" rx="${width * .2}" ry="${width * .06}"/><g class="wf-shield-body" transform="translate(${top.x} ${top.y}) scale(${scale})">${plate}<path class="wf-shield-edge" d="${SHIELD_PATH}"/><path class="wf-shield-inner" d="M40 12 64 22v25c0 16-9 27-24 36C25 74 16 63 16 47V22Z"/><path class="wf-shield-cross" d="M40 17v61M22 47h36"/></g></g>`;
}
// Board lines (slots, zones, piles) drawn as chunky low-res pixels; cards and text stay sharp.
// Thicken first so a thin line cannot slip between samples, keep one sample per block,
// grow each sample back to a full block. Blocks are board units (2px on a 1600x900 PC
// board) and shrink with the board; fitPixelLines only keeps a sample from falling
// below one device pixel, where lines would vanish, and faint antialiased
// edges count as line. The patch keeps what it set.
const LINE_PIXEL = 2;
const LINE_PIXEL_DEFS = `<filter id="wf-pixel-line" filterUnits="userSpaceOnUse" x="-400" y="-400" width="2400" height="1700" color-interpolation-filters="sRGB"><feMorphology in="SourceGraphic" operator="dilate" radius="${Math.max(.5, LINE_PIXEL / 2 - .5)}" data-line-px="pre" data-patch-keep="radius" result="fat"/><feFlood width="1" height="1" data-line-px="flood" data-patch-keep="width height" flood-color="#fff"/><feComposite width="${LINE_PIXEL}" height="${LINE_PIXEL}" data-line-px="tile" data-patch-keep="width height"/><feTile result="grid"/><feComposite in="fat" in2="grid" operator="in"/><feMorphology operator="dilate" radius="${LINE_PIXEL / 2}" data-line-px="grow" data-patch-keep="radius"/><feComponentTransfer><feFuncA type="discrete" tableValues="0 1 1 1"/></feComponentTransfer></filter>`;
export function fitPixelLines(svg) {
  const scale = svg?.getScreenCTM?.()?.a;
  if (!(scale > 0)) return;
  const device = 1 / (scale * (svg.ownerDocument.defaultView?.devicePixelRatio || 1));
  // Under two device pixels a block cannot show and the filter only loses the lines.
  svg.classList.toggle('wf-pixel-off', LINE_PIXEL < device * 2);
  const flood = Math.max(1, device), tile = Math.max(LINE_PIXEL, flood);
  const sizes = { pre: Math.max(.5, device, tile / 2 - .5), flood, tile, grow: tile / 2 };
  for (const node of svg.querySelectorAll('#wf-pixel-line [data-line-px]')) {
    const value = String(+sizes[node.dataset.linePx].toFixed(3));
    for (const name of node.dataset.patchKeep.split(' ')) if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }
}
// Registry symbols: one lamp per color, lit while a card of that color sits in the registry.
// Unlit lamps are only drawn, as empty rings, while the count button is held (board.css).
const SYMBOLS = [['赤','red'],['黄','yellow'],['緑','green'],['青','blue'],['紫','purple'],['黒','black'],['橙','orange']];
function symbolLamps(seat, x, y) {
  const lit = new Set(seat.enabledSymbols);
  return `<g class="symbol-lamps" aria-label="有効シンボル ${esc(seat.enabledSymbols.join('・') || 'なし')}" data-symbol-seat="${esc(seat.seatId)}">${SYMBOLS.map(([color, key], i) => {
    const p = project(x + (i - 3) * 28, y), r = Math.max(5, 12 * (project(x + 28, y).x - project(x, y).x) / 28);
    return `<g class="symbol-lamp symbol-${key}${lit.has(color) ? ' lit' : ''}" data-symbol="${color}"><circle cx="${p.x}" cy="${p.y}" r="${r}"/></g>`;
  }).join('')}</g>`;
}
function geometry(model) {
  const self = model.seats.find(s=>s.seatId===model.match.viewerSeat), enemy = model.seats.find(s=>s!==self);
  const seats = {self,enemy};
  const slots = boardSlots({self:self.user,enemy:enemy.user}).map(s=>({...s,seatId:seats[s.seatId].seatId}));
  const cards = new Map();
  for (const seat of model.seats) for (const zone of ['front','back']) for (const card of seat[zone].cards)
    cards.set(`${seat.seatId}:${zone}:${card.faceDown?card.slot:card.location.position}`,card);
  return { self,enemy,slots,cards };
}
// What the 3D board draws under the SVG: one thin slab per card or pile, in board
// coordinates. `node` finds the SVG group the slab copies its motion from.
export function boardPieces(model) {
  const {self,slots,cards} = geometry(model), pieces = [];
  const ref = value => `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  for (const slot of slots) {
    const card = cards.get(slotKey(slot));
    if (!card) continue;
    const lying = horizontal(card);
    pieces.push({ key:`card:${card.cardRef}`, kind:'card', x:slot.x, y:slot.y, count:1, faceDown:card.faceDown,
      art:card.faceDown ? null : CARD_ART[card.definition.id] ?? null, horizontal:lying,
      // A sleeping unit lies on its side; Code and Plugin art is already landscape.
      turned:lying && !['Code','Plugin'].includes(card.definition.category),
      node:`.board-slot[data-card-ref=${ref(card.cardRef)}]` });
  }
  for (const seat of model.seats) {
    const mine = seat === self, x = mine ? -20 : 1070, y = mine ? 700 : 200, side = mine ? 1070 : -20;
    // Registry cards lie sideways like the SVG draws them; portrait art turns with the card.
    seat.registry.cards.slice(0,3).forEach((c,i) => pieces.push({ key:`registry:${seat.seatId}:${i}`, kind:'registry',
      x, y:y-130+i*130, count:1, faceDown:c.faceDown, art:c.faceDown ? null : CARD_ART[c.definition?.id] ?? null, horizontal:true,
      turned:!c.faceDown && !['Code','Plugin'].includes(c.definition?.category),
      node:`[data-runtime-zone="registry"][data-seat=${ref(seat.seatId)}]` }));
    if (seat.deck.count) pieces.push({ key:`deck:${seat.seatId}`, kind:'deck', x:side, y:mine?850:50, count:seat.deck.count,
      faceDown:true, art:null, horizontal:false, turned:false, node:`[data-fx-zone="deck"][data-fx-seat=${ref(seat.seatId)}]` });
    if (seat.trash.count) pieces.push({ key:`trash:${seat.seatId}`, kind:'trash', x:side, y:mine?630:270, count:seat.trash.count,
      faceDown:false, art:null, horizontal:false, turned:false, node:`[data-runtime-zone="trash"][data-seat=${ref(seat.seatId)}]` });
  }
  return pieces;
}
// Pile counts float over their zones only while the count button is held. BAN has no
// place on the board, so its count rides just under the trash count.
const COUNT_ZONES = [['deck','DECK'],['trash','TRASH'],['registry','REGISTRY'],['ban','BAN']];
function countTagsHtml(seat, mine, at) {
  return `<g class="wf-count-tags ${mine?'is-self':'is-enemy'}" pointer-events="none" aria-hidden="true">${COUNT_ZONES.map(([zone,label])=>{
    const p = at[zone];
    return `<g class="wf-count-tag" data-count-zone="${zone}" data-count-seat="${esc(seat.seatId)}" transform="translate(${p.x} ${p.y})"><rect x="-58" y="-24" width="116" height="48"/><text class="wf-count-label" y="-8" text-anchor="middle">${label}</text><text class="wf-count-value" y="17" text-anchor="middle">${seat[zone].count ?? seat[zone].cards.length}</text></g>`;
  }).join('')}</g>`;
}
export function wireframeStatusHtml(seat, mine, uniqueButton = '') {
  return `<aside class="wf-status ${mine?'wf-self':'wf-enemy'}" data-user-seat="${esc(seat.seatId)}" data-fx-zone="hand" data-fx-seat="${esc(seat.seatId)}">${uniqueButton ? `<div class="r2-console wf-unique">${uniqueButton}</div>` : ''}<div class="wf-user-window"><button class="wf-user-title" data-runtime-profile="${esc(seat.seatId)}" aria-label="${esc(seat.user.name)} のユーザー詳細">${mine?'':'<b aria-hidden="true">●●●</b>'}<span>${esc(seat.user.name)}</span>${mine?'<b aria-hidden="true">×</b>':''}</button><canvas class="wf-life" data-life-seat="${esc(seat.seatId)}" aria-label="${esc(seat.user.name)} STR ${seat.fortressStr} / ${seat.user.maxFortressStr}、インシデント ${seat.user.incidents.join('・')}" data-str="${seat.fortressStr}"></canvas></div><button class="wf-avatar" data-runtime-profile="${esc(seat.seatId)}" aria-label="${mine?'自分':'相手'} ${esc(seat.user.name)} ユーザー詳細"></button></aside>`;
}
export function wireframeBoardHtml(model, uniqueButton = '') {
  const {self,enemy,slots,cards} = geometry(model);
  const board = `<defs>${LINE_PIXEL_DEFS}<pattern id="back-pattern" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#11202c"/><path d="M0 0L10 10M10 0L0 10" stroke="#496071" stroke-width=".6"/></pattern>${SHIELD_DEFS}<marker id="wf-arrow-tip" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#c2ed95"/></marker></defs>
    <polygon class="board-plane" points="${points([project(-100,-90),project(1150,-90),project(1150,990),project(-100,990)])}"/>
    ${[enemy,self].map(seat=>`<g data-wire-hit data-fortress="${esc(seat.seatId)}" data-runtime-profile="${esc(seat.seatId)}" role="button" tabindex="0" aria-label="${seat===self?'自分':'相手'}ユーザー領域">${poly(525,seat===enemy?-55:955,820,35,'class="user-target"')}</g>`).join('')}
    ${slots.map(slot=>{
      const card=cards.get(slotKey(slot));
      const css=card?`card-line${card.faceDown?' face-down':''}${card.interaction.attackReady?' attack-ready':''}`:'';
      const face=card?cardArtFace(card,slot.x,slot.y,horizontal(card),css):'';
      // With art, captions move to the bottom edge so the picture stays visible.
      const captionY=face?(horizontal(card)?CARD.width:CARD.height)/2-42:-12;
      const art=card?cardSolid(slot.x,slot.y,css,horizontal(card))+face
        +label(slot.x,slot.y+captionY,name(card).slice(0,10),`card-caption${face?' on-art':''}`)
        +(!card.faceDown?label(slot.x,slot.y+(face?captionY+24:12),card.definition.atk===null?card.definition.category:`${card.computed.currentAtk} / ${card.computed.currentStr}`,`card-caption${face?' on-art':''}`):''):'';
      const shield=card&&!card.faceDown?securityShield(card,slot.x,slot.y):'';
      return `<g class="board-slot wf-slot" data-wire-hit data-seat="${esc(slot.seatId)}" data-zone="${slot.zone}" data-slot="${slot.slot}" role="button" tabindex="0" aria-label="${slot.seatId===self.seatId?'自分':'相手'} ${slot.zone} ${slot.slot} ${card?esc(name(card)):'空き枠'}"${card?` data-card-ref="${esc(card.cardRef)}"${card.faceDown?'':` data-card-id="${esc(card.definition.id)}"`}`:''}>${poly(slot.x,slot.y,CARD.width,CARD.height,'class="slot"')}${art}${shield}</g>`;
    }).join('')}
    ${model.seats.map(seat=>{
      const mine=seat===self,x=mine?-20:1070,y=mine?700:200,side=mine?1070:-20;
      const zoneMarkup=(zone,content)=>`<g data-wire-hit data-runtime-zone="${zone}" data-seat="${esc(seat.seatId)}" role="button" tabindex="0" aria-label="${mine?'自分':'相手'}${zone==='trash'?'ゴミ箱':'レジストリ'}">${content}</g>`;
      return symbolLamps(seat,x,y-236)+zoneMarkup('registry',poly(x,y,200,420,'class="registry"')+seat.registry.cards.slice(0,3).map((c,i)=>{const css=c.faceDown?'card-line face-down':'registry';return cardSolid(x,y-130+i*130,css,true)+(c.definition?cardArtFace(c,x,y-130+i*130,true,css):'');}).join('')+label(x,y+220,`REGISTRY ${seat.registry.count}`))
        +`<g data-fx-zone="deck" data-fx-seat="${esc(seat.seatId)}" aria-label="${mine?'自分':'相手'}デッキ ${seat.deck.count}枚">${cardSolid(side,mine?850:50,'pile',false,seat.deck.count)}${label(side,mine?855:55,`DECK ${seat.deck.count}`,'board-label',pileHeight(seat.deck.count))}</g>`
        +zoneMarkup('trash',cardSolid(side,mine?630:270,'trash-pile',false,seat.trash.count)+label(side,mine?635:275,`TRASH ${seat.trash.count}`,'board-label',pileHeight(seat.trash.count)));
    }).join('')}
    ${model.seats.map(seat=>{
      const mine=seat===self,x=mine?-20:1070,y=mine?700:200,side=mine?1070:-20,lift=pileHeight(12);
      const trash=project(side,mine?630:270,lift);
      return countTagsHtml(seat,mine,{deck:project(side,mine?850:50,lift),trash,registry:project(x,y,lift),ban:{x:trash.x,y:trash.y+54}});
    }).join('')}<g class="wf-preview" pointer-events="none"></g>`;
  return `<div class="r2-board wire-board-host" data-patch-keep="class:wf-has-model"><canvas class="wf-board-model" aria-hidden="true" data-patch-keep="width height data-engine"></canvas><svg class="wire-board" viewBox="0 0 1600 900" aria-label="対局盤面" data-patch-keep="class:wf-pixel-off">${board}</svg>${wireframeStatusHtml(self,true,uniqueButton)}${wireframeStatusHtml(enemy,false)}</div>`;
}
export function wireframePreviewHtml(value, hover = null) {
  const {model,preview,interactionRequest,selection} = value;
  const {self,slots,cards} = geometry(model);
  const all=model.seats.flatMap(s=>['front','back','hand','registry'].flatMap(z=>s[z].cards??[]));
  const source=all.find(c=>c.cardRef===preview?.sourceRef);
  if(!source)return '';
  const targets = hover&&resolveInteractionTarget(interactionRequest,hover).kind==='one'?[hover]:[
    ...(preview?.target??[]),
    ...(preview?.history??[]).filter(row=>['execution-destination','execution-placement'].includes(row.presentationKey)).flatMap(row=>row.targets),
    ...(interactionRequest?.options??[]).filter(o=>selection?.optionIds.includes(o.optionId)).flatMap(o=>o.targets)];
  const target=targets.find(t=>t.kind==='slot')??targets[0];
  const slotForRef=ref=>slots.find(s=>cards.get(slotKey(s))?.cardRef===ref);
  const targetSlot=target?.kind==='slot'?slots.find(s=>s.seatId===target.seatId&&s.zone===target.zone&&s.slot===target.slot):target?.kind==='card'?slotForRef(target.cardRef):null;
  const destination=targetSlot?project(targetSlot.x,targetSlot.y):target?.kind==='user'?project(525,target.seatId===self.seatId?955:-55):null;
  if(!destination)return '';
  const sourceSlot=slotForRef(source.cardRef),from=sourceSlot?project(sourceSlot.x,sourceSlot.y):project(525,900);
  const action=model.legalActions.find(a=>a.actionId===preview.actionId);
  const placing=!sourceSlot||action?.actionType==='redeploy';
  return `<path class="arrow" marker-end="url(#wf-arrow-tip)" d="M${from.x} ${from.y}Q${from.x-60} ${(from.y+destination.y)/2} ${destination.x} ${destination.y}"/>${placing&&targetSlot?`<g class="solid-ghost">${cardSolid(targetSlot.x,targetSlot.y,'ghost',horizontal(source))}</g>`:''}`;
}
