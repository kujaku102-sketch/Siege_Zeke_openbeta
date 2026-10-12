import { CARD_ART } from '../data/card-art.generated.js';
import { abilityBadgeDefinition } from '../data/ability-badges.js';
import { selectionRequestHtml, selectionEyeHtml } from './choice-read-view.js';
import { requiredSelectionRequest } from '../game/runtime/selection-contract.js';
import { validSelectionAnswer } from '../game/runtime/selection-contract.js';
import { runtimeLogHtml, runtimeResultHtml } from './runtime-log-view.js';
import { cardEffectHtml } from '../ui/ability-help.js';
import { abilityTextHtml } from '../ui/ability-help.js';
import { cardArtProfile } from '../data/card-art-profiles.js';
import { runtimeComponentRowsHtml } from '../ui/runtime-components.js';
import { tutorialNavigator } from '../data/navigator-assets.js';

const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const colorClass = color => ({ 赤: 'red', 黄: 'yellow', 紫: 'purple', 青: 'blue', 橙: 'orange', 黒: 'black', 緑: 'green' })[color] ?? 'neutral';

function cardArt(card, className = 'card-art-image', full = false) {
  const source = CARD_ART[card.definition.id];
  const profile = cardArtProfile(card.definition);
  return source ? `<img class="${className}" src="${esc(source)}" alt="" loading="lazy" decoding="async"${full ? '' : ` style="--art-focus-x:${profile.focusX}%;--art-focus-y:${profile.focusY}%;--art-zoom:${profile.zoom}"`}>`
    : `<span class="card-art-placeholder">${esc(card.definition.name.slice(0, 1))}</span>`;
}

function badges(card) {
  return `<div class="ability-badges" aria-label="公開能力">${card.computed.badges.map(item => {
    const badge = abilityBadgeDefinition(item.name);
    const label = `${badge.label}${item.value === null ? '' : `:${item.value}`}`;
    return badge.asset ? `<span class="ability-badge ability-badge-image-wrap" title="${esc(label)}"><img class="ability-badge-image" src="${esc(badge.asset)}" alt="${esc(label)}"></span>`
      : `<span class="ability-badge ability-badge-text">${esc(label)}</span>`;
  }).join('')}</div>`;
}

export function runtimeCardHtml(card, zone) {
  if (card.faceDown) return `<button class="card card-back${card.interaction.targetActionIds.length ? ' targetable' : ''}" data-card-ref="${esc(card.cardRef)}" aria-label="裏向きカード"></button>`;
  const attack = card.interaction.attackReady ? ` attack-ready${card.interaction.attackStyle === 'contact' ? '-contact' : ''}` : '';
  const trends = {
    atk: Math.sign(card.computed.currentAtk - Number(card.definition.atk ?? 0)),
    str: Math.sign(card.computed.currentStr - Number(card.definition.str ?? 0))
  };
  const trend = value => value > 0 ? 'up' : value < 0 ? 'down' : 'base';
  const stats = card.definition.atk === null ? '' : `<div class="stats"><span class="stat stat-atk stat-${trend(trends.atk)}"><small>ATK</small><b>${card.computed.currentAtk}</b></span><span class="stat stat-str stat-${trend(trends.str)}"><small>STR</small><b>${card.computed.currentStr}</b></span></div>`;
  const currentCost = zone === 'hand' && card.definition.category === 'Script' ? 0 : card.computed.currentCost;
  const costTrend = currentCost < Number(card.definition.cost ?? 0) ? 'down' : currentCost > Number(card.definition.cost ?? 0) ? 'up' : 'base';
  const shield = card.interaction.securityGuard ? '<span class="card-security-shield" aria-hidden="true"><svg viewBox="0 0 80 96"><path d="M40 4 72 17v30c0 21-13 35-32 45C21 82 8 68 8 47V17Z"/><path d="M40 12 64 22v25c0 16-9 27-24 36C25 74 16 63 16 47V22Z"/><path d="M40 17v61M22 47h36"/></svg></span>' : '';
  return `<button class="card color-${colorClass(card.definition.color)}${card.status.sleep ? ' sleep' : ''}${card.status.residentActive ? ' resident-active' : ''}${attack}${card.interaction.securityGuard ? ' security-guard' : ''}${card.interaction.selected ? ' selected' : ''}${card.interaction.targetActionIds.length ? ' targetable' : ''}" data-card-ref="${esc(card.cardRef)}" data-card-id="${esc(card.definition.id)}" data-seat="${esc(card.controllerSeat)}" data-category="${esc(card.definition.category)}" data-zone="${esc(zone)}" title="${esc(card.definition.text)}"><div class="card-top"><span class="cost cost-${costTrend}" data-vfx-anchor="hand-cost" data-owner="${esc(card.controllerSeat)}">${currentCost}</span><span class="category">${esc(card.definition.category)}</span></div><div class="card-visual ${CARD_ART[card.definition.id] ? 'has-art' : 'no-art'}">${cardArt(card)}</div><strong class="card-name">${esc(card.definition.name)}</strong>${badges(card)}<p class="card-rules-preview">${esc(card.definition.text)}</p>${card.mounted.length ? `<div class="mounted">LAYER ${card.mounted.length + 1}</div>` : ''}${stats}${shield}</button>`;
}

function zoneHtml(seat, zone) {
  const limit = seat.user[`${zone}Limit`];
  const cards = new Map(seat[zone].cards.map(card => [card.faceDown ? card.slot : card.location.position, card]));
  return `<section class="zone zone-${zone}" data-seat="${esc(seat.seatId)}" data-zone="${zone}" data-zone-capacity="${limit}"><header>${zone.toUpperCase()}<small>${seat[zone].cards.length}/${limit}</small></header><div class="zone-cards" style="--zone-capacity:${Math.max(1, limit)}">${Array.from({ length: limit }, (_, index) => {
    const card = cards.get(index + 1);
    return `<div class="board-slot ${card ? 'occupied' : 'vacant'}" data-slot="${index + 1}">${card ? runtimeCardHtml(card, zone) : `<span class="slot-label">${zone.toUpperCase()} ${index + 1}<small>EMPTY</small></span>`}</div>`;
  }).join('')}</div></section>`;
}

function sideHtml(seat, viewerSeat) {
  const opponent = seat.seatId !== viewerSeat;
  const admin = zone => `<button class="admin-zone-button" data-runtime-zone="${zone}" data-seat="${esc(seat.seatId)}"><span>${zone === 'trash' ? 'ゴミ箱' : 'レジストリ'}</span><b>${seat[zone].cards.length}</b></button>`;
  return `<section class="side ${opponent ? 'opponent' : 'human'}" data-seat="${esc(seat.seatId)}"><div class="side-head"><div><span>${opponent ? 'OPPONENT' : 'YOU'}</span><strong>${esc(seat.user.name)}</strong></div><div class="resource-line"><span>HAND ${seat.hand.count}</span><span>DECK ${seat.deck.count}</span><span>TRASH ${seat.trash.cards.length}</span></div></div>${zoneHtml(seat, opponent ? 'back' : 'front')}<div class="admin-row">${admin('trash')}<button class="fortress compact-fortress" data-runtime-unique="${esc(seat.seatId)}" data-fortress="${esc(seat.seatId)}"><strong>${esc(seat.user.name)}</strong><div class="fortress-stats"><span>STR <b>${seat.fortressStr}</b>/${seat.user.maxFortressStr}</span><span>MEM <b>${seat.memory.current}</b>/${seat.memory.max}</span></div></button>${admin('registry')}<div class="deck-stack"><span>DECK</span><b>${seat.deck.count}</b></div></div>${zoneHtml(seat, opponent ? 'front' : 'back')}</section>`;
}

function visibleCards(model) {
  const result = [];
  const visit = card => { result.push(card); if (!card.faceDown) card.mounted.forEach(visit); };
  for (const seat of model.seats) {
    for (const zone of ['front', 'back', 'registry', 'trash', 'ban']) seat[zone].cards.forEach(visit);
    seat.hand.cards?.forEach(visit);
  }
  return result;
}

function detailHtml(model,presentation) {
  const inspection = presentation.inspection;
  const current = visibleCards(model).find(item => item.cardRef === model.ui.detailCardRef);
  const card = current && !current.faceDown ? current : current?.faceDown && current.controllerSeat === model.match.viewerSeat
    && inspection && inspection.cardRef === model.ui.detailCardRef && inspection.matchId === model.match.matchId
    && inspection.viewerSeat === model.match.viewerSeat && inspection.revision === model.match.revision
    ? {...inspection,mounted:[]} : null;
  if (!card) return '';
  const profile = cardArtProfile(card.definition);
  const art = `<${CARD_ART[card.definition.id] ? 'button data-runtime-art="'+esc(card.cardRef)+'"' : 'div'} class="detail-art color-${colorClass(card.definition.color)} art-${profile.orientation} ${CARD_ART[card.definition.id] ? 'has-art' : ''}">${cardArt(card,'detail-art-image')}<span>ARTWORK / EXPAND</span><small>${esc(card.definition.id)}</small></${CARD_ART[card.definition.id] ? 'button' : 'div'}>`;
  return `<aside class="r2-detail" aria-label="カード詳細"><header><span>CARD INSPECTOR</span><button data-close-detail>×</button></header>${art}<section class="card-inspector"><div class="detail-heading"><span>${esc(card.definition.category)} / COST ${card.computed.currentCost}</span><h2>${esc(card.definition.name)}</h2></div><dl class="detail-grid"><div class="detail-location"><dt>場所</dt><dd>${esc(card.location?.zone ?? '一時確認')}</dd></div><div class="detail-state"><dt>状態</dt><dd>${card.status.sleep ? 'スリープ' : 'スタンバイ'}${card.status.residentActive ? ' / レジデント' : ''}</dd></div><div class="detail-atk"><dt>ATK</dt><dd>${card.computed.currentAtk}</dd></div><div class="detail-str"><dt>STR</dt><dd>${card.computed.currentStr} / ${card.computed.maxStr}${card.status.damage ? ` / ダメージ${card.status.damage}` : ''}</dd></div><div class="detail-class"><dt>クラス</dt><dd>${(card.definition.classes ?? []).map(name => `<span class="detail-class-tag">${esc(name)}</span>`).join('')}</dd></div></dl><section class="detail-section effect-text-section"><h3>効果テキスト</h3><p class="card-effect-copy">${cardEffectHtml(card.definition.text || '効果なし')}</p></section><section class="detail-section runtime-detail-section"><h3>付与・残数</h3>${runtimeComponentRowsHtml(card.computed.components,esc)}</section><section class="detail-section layer-detail-section"><h3>レイヤー ${card.mounted.length+1}</h3><ol>${[card,...card.mounted].map((layer,index) => `<li class="layer-${index === 0 ? 'top' : layer.location?.role ?? 'layered'}"><b>L${index+1}</b><span>${esc(layer.definition.name)}</span><small>${esc(layer.definition.category)}</small></li>`).join('')}</ol></section></section></aside>`;
}

function operationsHtml(model) {
  const card = visibleCards(model).find(item => item.cardRef === model.ui.selectedCardRef);
  if (!card || !card.interaction.sourceActionIds.length) return '';
  const byId = new Map(model.legalActions.map(action => [action.actionId, action]));
  return `<aside class="r2-popup" aria-label="カード操作"><strong>${esc(card.faceDown ? '裏向きカード' : card.definition.name)}</strong><div>${card.interaction.sourceActionIds.map(actionId => {
    const action = byId.get(actionId);
    const type = action?.kind === 'fixed' ? action.action.type : action?.actionType;
    return `<button data-action-id="${esc(actionId)}">${esc(({ attack: '攻撃', executeCard: '実行', executeSpell:'スペル実行',mountCard:'マウント',setScript:'Scriptとして設置',executeRegistry:'レジストリから実行',activateCardEffect:'効果起動',executeLayered: 'レイヤード実行', install: 'インストール', activateScript: '起動', redeploy: '再実行', recoverRegistry: '回収', restSecurity: 'スリープ' })[type] ?? type)}</button>`;
  }).join('')}</div></aside>`;
}

function uniqueHtml(model,presentation) {
  const seat = model.seats.find(seat => seat.seatId === presentation.uniqueSeat);
  if (!seat) return '';
  const activate = seat.seatId === model.match.viewerSeat && model.legalActions.find(item => item.kind === 'fixed' && item.action.type === 'activateAbility');
  return `<aside class="r2-modal unique-effect-modal" role="dialog" aria-label="ユーザー能力"><section><header><h2>${esc(seat.user.abilityName)}</h2><button data-runtime-unique-close>閉じる</button></header><p>${abilityTextHtml(seat.user.abilityText)}</p><dl class="detail-grid"><div><dt>STR</dt><dd>${seat.fortressStr}/${seat.user.maxFortressStr}</dd></div><div><dt>MEM</dt><dd>${seat.memory.current}/${seat.memory.max}</dd></div></dl><section class="detail-section runtime-detail-section"><h3>付与・残数</h3>${runtimeComponentRowsHtml([...(seat.abilityStatus?.protect ? [{label:"プロテクト",value:`残り${seat.abilityStatus.protect}回`,note:"残数",abilityName:"PROTECT",tone:""}] : []),...(seat.abilityStatus?.backup ? [{label:"バックアップ",value:`残り${seat.abilityStatus.backup}回`,note:"付与分",abilityName:"BACKUP",tone:""}] : []),...(seat.user.abilityKey === "turbo" ? [{label:seat.user.abilityName,value:seat.abilityStatus?.turboUsed ? "使用済" : "残り1回",note:seat.turboActive ? "このターン起動中" : "対戦中",abilityName:null,tone:""}] : [])],esc)}</section><section class="detail-section"><h3>インシデント</h3><p>${(seat.user.incidents ?? []).map(value => `${value}${seat.incidents?.includes(value) ? '（使用済）' : ''}`).join(' / ')}</p></section>${activate ? `<button class="unique-effect-button is-available" data-action-id="${esc(activate.actionId)}">起動</button>` : ''}</section></aside>`;
}
function guideHtml(tutorial) {
  if (!tutorial?.presentation || tutorial.flow.complete) return '';
  const {presentation,flow} = tutorial, navigator = tutorialNavigator(flow.tutorialId);
  const text = (presentation.parts ?? [presentation.text]).map(part => typeof part === 'string' ? esc(part) : `<ruby>${esc(part.ruby)}<rt>${esc(part.rt)}</rt></ruby>`).join('');
  return `<aside class="r2-guide live-guide" aria-label="チュートリアル" data-tutorial-step="${flow.introComplete ? `${flow.tutorialId}:${flow.index}` : `intro:${flow.introIndex}`}"><div class="live-guide-cast"><img src="${esc(navigator.src)}" alt="${esc(presentation.speaker)}の立ち絵" style="object-position:${esc(navigator.objectPosition)}"><strong>${esc(presentation.speaker)}</strong></div><div class="live-guide-speech"><div class="live-guide-text" tabindex="0" role="region" aria-label="チュートリアルのセリフ"><p>${text}</p></div><nav><button class="live-guide-skip" data-runtime-tutorial-skip>スキップ</button>${presentation.intro || presentation.expect?.type === 'advance' ? '<button class="live-guide-next" data-runtime-tutorial-next>次へ ▸</button>' : ''}</nav></div></aside>`;
}
function artHtml(model,presentation) {
  const card = visibleCards(model).find(card => !card.faceDown && card.cardRef === presentation.artRef)
    ?? (presentation.inspection?.cardRef === presentation.artRef ? presentation.inspection : null);
  return card ? `<aside class="art-preview-overlay" role="dialog" aria-label="カード画像"><button data-runtime-art-close>閉じる</button>${cardArt(card,'art-preview-image',true)}</aside>` : '';
}
function requiredInputHtml(input) {
  if (!input) return '';
  if (input.canAnswer === false) return `<aside class="effect-modal"><section class="effect-dialog"><p>相手の選択待ち</p><button data-runtime-menu>メニュー</button></section></aside>`;
  return `<aside class="effect-modal" data-selection-purpose="required">${selectionRequestHtml(requiredSelectionRequest(input))}${input.optional ? `<button data-choice-id="${esc(input.choiceId)}" data-decline>選ばない</button>` : ''}</aside>`;
}

export function runtimeGameHtml(model, presentation = {}) {
  const viewer = model.seats.find(seat => seat.seatId === model.match.viewerSeat);
  const opponent = model.seats.find(seat => seat.seatId !== model.match.viewerSeat);
  if (!viewer || !opponent) return '';
  const layout = presentation.view === 'mobile' ? 'mobile' : 'desktop';
  const viewedZone = presentation.zoneView && model.seats.find(seat => seat.seatId === presentation.zoneView.seatId);
  const drawer = viewedZone ? `<aside class="admin-drawer" aria-label="${esc(presentation.zoneView.zone)}"><header><h2>${esc(presentation.zoneView.zone)}</h2><button data-runtime-zone-close>閉じる</button></header><div class="admin-card-list">${viewedZone[presentation.zoneView.zone].cards.map(card => runtimeCardHtml(card, presentation.zoneView.zone)).join('') || '<p>カードなし</p>'}</div></aside>` : '';
  const activation = model.legalActions.find(item => item.kind === 'fixed' && item.action.type === 'activateAbility');
  const unique = `<button class="unique-effect${activation ? ' is-available' : ''}" data-runtime-unique="${esc(viewer.seatId)}">${activation && presentation.effectsEnabled ? `<span class="unique-particles">${'<i></i>'.repeat(13)}</span>` : ''}<span class="unique-effect-copy"><span class="unique-effect-eyebrow">UNIQUE EFFECT</span><strong class="unique-effect-name">${esc(viewer.user.abilityName)}</strong></span></button>`;
  const controls = unique + model.globalActionIds.filter(id => id !== activation?.actionId).map(id => {
    const entry = model.legalActions.find(item => item.actionId === id);
    const type = entry?.action?.type;
    return `<button data-action-id="${esc(id)}"${type === 'endTurn' ? ' data-runtime-end-turn' : ''}>${type === 'endTurn' ? 'ターン終了' : type === 'openingMulligan' ? '引き直し' : esc(type)}</button>`;
  }).join('');
  const request = presentation.request;
  const selected = presentation.selection;
  const canConfirm = presentation.plan?.completion || request && validSelectionAnswer(request, selected);
  const selection = request || presentation.plan?.completion
    ? presentation.collapsed ? `<button class="runtime-selection-reopen" data-selection-collapse aria-label="選択画面を開く">${selectionEyeHtml()}</button>`
      : `<aside class="effect-modal" data-selection-purpose="${presentation.plan ? 'draft' : 'required'}">${request ? selectionRequestHtml(request, { cards: visibleCards(model), answer: selected,
        cardHtml: card => `<span class="runtime-selection-card">${card.faceDown ? '裏向きカード' : `${cardArt(card)}<strong>${esc(card.definition.name)}</strong><span class="card-effect-copy">${cardEffectHtml(card.definition.text ?? '')}</span>`}</span>` }) : '<section class="effect-dialog"><h2>操作を確定</h2></section>'}<nav><button data-runtime-confirm ${canConfirm ? '' : 'disabled'}>確定</button>${model.requiredInput?.optional && !presentation.plan ? '<button data-runtime-decline>選ばない</button>' : ''}<button data-runtime-back>戻る</button></nav></aside>`
    : requiredInputHtml(model.requiredInput);
  const hand = viewer.hand.cards.map((card, index) => {
    const offset = index - (viewer.hand.count - 1) / 2;
    return `<div class="hand-card" style="--hand-rotate:${offset * 5}deg;--hand-sink:${Math.abs(offset) * 5}px">${runtimeCardHtml(card, 'hand')}</div>`;
  }).join('');
  return `<main class="r2-runtime-view r2-${layout}" data-layout="${layout}" data-revision="${model.match.revision}"><div class="r2-stage"><div class="r2-board"><div class="r2-board-fit"><div class="battle-board">${sideHtml(opponent, model.match.viewerSeat)}${sideHtml(viewer, model.match.viewerSeat)}</div></div></div></div><div class="r2-${layout}-tools"><aside class="r2-console" aria-label="ターン操作"><span>TURN ${model.match.turnNumber} / ${model.match.activeSeat === model.match.viewerSeat ? 'YOU' : 'OPPONENT'}</span>${controls}<button data-runtime-back>戻る</button><button data-runtime-log>ログ</button><button data-runtime-menu>メニュー</button>${model.match.progress === 'resultLocked' ? '<p>RESULT LOCKED / 宣言済み処理を解決中</p>' : ''}</aside></div><div class="r2-${layout}-hand" data-layer="hand" ${model.ui.handOpen ? '' : 'hidden'}><section class="r2-hand" aria-label="自分の手札 ${viewer.hand.count}枚"><div class="r2-hand-scroll hand-scroll">${hand}</div></section></div><button class="r2-hand-toggle" data-runtime-hand>${model.ui.handOpen ? '手札を畳む' : '手札を開く'}</button>${drawer}${detailHtml(model,presentation)}${uniqueHtml(model,presentation)}${artHtml(model,presentation)}${guideHtml(presentation.tutorial)}${operationsHtml(model)}${selection}${model.ui.logOpen ? runtimeLogHtml(presentation.log ?? [], model.match.viewerSeat) : ''}${model.ui.menuOpen ? '<aside class="r2-modal" role="dialog" aria-label="メニュー"><section><button data-runtime-menu>閉じる</button><button data-runtime-rematch>再戦</button><button data-runtime-title>タイトルに戻る</button></section></aside>' : ''}${presentation.resultDismissed ? '' : runtimeResultHtml(model.match)}</main>`;
}
