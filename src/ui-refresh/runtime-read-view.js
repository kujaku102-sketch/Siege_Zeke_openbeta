import { CARD_ART } from '../data/card-art.generated.js';
import { wireframeBoardHtml, wireframeStatusHtml } from './wireframe/board-view.js';
import { wireframeControlsHtml } from './wireframe/controls-view.js';
import { abilityBadgeDefinition } from '../data/ability-badges.js';
import { selectionRequestHtml, selectionEyeHtml, isBoardPick, isBoardSlotRequest, isSinglePick, requestTitle } from './choice-read-view.js';
import { requiredSelectionRequest } from '../game/runtime/selection-contract.js';
import { validSelectionAnswer } from '../game/runtime/selection-contract.js';
import { runtimeLogHtml, runtimeResultHtml } from './runtime-log-view.js';
import { cardEffectHtml } from '../ui/ability-help.js';
import { abilityTextHtml } from '../ui/ability-help.js';
import { cardArtProfile } from '../data/card-art-profiles.js';
import { runtimeComponentRowsHtml } from '../ui/runtime-components.js';
import { tutorialNavigator } from '../data/navigator-assets.js';
import { effectFocus, effectTextHtml } from './effect-flow.js';
import { panelHeadHtml } from './cyber-panel.js';
import { userDetailHtml } from './user-detail-view.js';

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

function runtimeCardHtml(card, zone) {
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
  const shield = card.interaction.securityShield ? `<span class="card-security-shield is-${card.interaction.securityShield}" aria-hidden="true"><svg viewBox="0 0 80 96"><path d="M40 4 72 17v30c0 21-13 35-32 45C21 82 8 68 8 47V17Z"/><path d="M40 12 64 22v25c0 16-9 27-24 36C25 74 16 63 16 47V22Z"/><path d="M40 17v61M22 47h36"/></svg></span>` : '';
  return `<button class="card color-${colorClass(card.definition.color)}${card.status.sleep ? ' sleep' : ''}${card.status.residentActive ? ' resident-active' : ''}${attack}${card.interaction.securityGuard ? ' security-guard' : ''}${card.interaction.selected ? ' selected' : ''}${card.interaction.targetActionIds.length ? ' targetable' : ''}" data-card-ref="${esc(card.cardRef)}" data-card-id="${esc(card.definition.id)}" data-seat="${esc(card.controllerSeat)}" data-category="${esc(card.definition.category)}" data-zone="${esc(zone)}" title="${esc(card.definition.text)}"><div class="card-top"><span class="cost cost-${costTrend}" data-vfx-anchor="hand-cost" data-owner="${esc(card.controllerSeat)}">${currentCost}</span><span class="category">${esc(card.definition.category)}</span></div><div class="card-visual ${CARD_ART[card.definition.id] ? 'has-art' : 'no-art'}">${cardArt(card)}</div><strong class="card-name">${esc(card.definition.name)}</strong>${badges(card)}<p class="card-rules-preview">${esc(card.definition.text)}</p>${card.mounted.length ? `<div class="mounted">LAYER ${card.mounted.length + 1}</div>` : ''}${stats}${shield}</button>`;
}

function zoneHtml(seat, zone) {
  const limit = seat.user[`${zone}Limit`];
  const cards = new Map(seat[zone].cards.map(card => [card.faceDown ? card.slot : card.location.position, card]));
  return `<section class="zone zone-${zone}" data-seat="${esc(seat.seatId)}" data-zone="${zone}" data-zone-capacity="${limit}"><header>${zone.toUpperCase()}<small>${seat[zone].cards.length}/${limit}</small></header><div class="zone-cards" style="--zone-capacity:${Math.max(1, limit)}">${Array.from({ length: limit }, (_, index) => {
    const card = cards.get(index + 1);
    return `<div class="board-slot ${card ? 'occupied' : 'vacant'}" data-seat="${esc(seat.seatId)}" data-zone="${zone}" data-slot="${index + 1}">${card ? runtimeCardHtml(card, zone) : `<span class="slot-label">${zone.toUpperCase()} ${index + 1}<small>EMPTY</small></span>`}</div>`;
  }).join('')}</div></section>`;
}

function sideHtml(seat, viewerSeat) {
  const opponent = seat.seatId !== viewerSeat;
  const count = (zone, label) => `<span class="zone-count-tag" data-count-zone="${zone}" data-count-seat="${esc(seat.seatId)}" aria-hidden="true"><small>${label}</small><b>${seat[zone].count ?? seat[zone].cards.length}</b></span>`;
  const admin = zone => `<button class="admin-zone-button" data-runtime-zone="${zone}" data-seat="${esc(seat.seatId)}"><span>${zone === 'trash' ? 'ゴミ箱' : 'レジストリ'}</span><b>${seat[zone].cards.length}</b>${zone === 'trash' ? count('trash', 'TRASH') + count('ban', 'BAN') : count('registry', 'REGISTRY')}</button>`;
  return `<section class="side ${opponent ? 'opponent' : 'human'}" data-seat="${esc(seat.seatId)}"><div class="side-head" data-fx-zone="hand" data-fx-seat="${esc(seat.seatId)}"><div><span>${opponent ? 'OPPONENT' : 'YOU'}</span><strong>${esc(seat.user.name)}</strong></div><div class="resource-line"><span>HAND ${seat.hand.count}</span><span>DECK ${seat.deck.count}</span><span>TRASH ${seat.trash.cards.length}</span></div></div>${zoneHtml(seat, opponent ? 'back' : 'front')}<div class="admin-row">${admin('trash')}<button class="fortress compact-fortress" data-runtime-profile="${esc(seat.seatId)}" data-fortress="${esc(seat.seatId)}"><strong>${esc(seat.user.name)}</strong><div class="fortress-stats"><span>STR <b>${seat.fortressStr}</b>/${seat.user.maxFortressStr}</span><span>MEM <b>${seat.memory.current}</b>/${seat.memory.max}</span></div></button>${admin('registry')}<div class="deck-stack" data-fx-zone="deck" data-fx-seat="${esc(seat.seatId)}"><span>DECK</span><b>${seat.deck.count}</b>${count('deck', 'DECK')}</div></div>${zoneHtml(seat, opponent ? 'front' : 'back')}</section>`;
}

// Choice cards show art and name only, the same on PC and mobile. The full text
// rides along hidden and opens as a peek on hover, focus or long press.
export function selectionCardHtml(card) {
  if (card.faceDown) return '<span class="runtime-selection-card face-down"><span class="choice-card-art"></span><strong class="choice-card-name">裏向きカード</strong></span>';
  const d = card.definition, cost = card.computed?.currentCost ?? d.cost;
  const atk = card.computed?.currentAtk ?? d.atk, str = card.computed?.currentStr ?? d.str;
  const peek = `<span class="peek-meta">${esc(d.category ?? '')}${cost === undefined || cost === null ? '' : ` / COST ${esc(cost)}`}</span><strong class="peek-name">${esc(d.name)}</strong>${atk === undefined || atk === null ? '' : `<span class="peek-stats">ATK ${esc(atk)} / STR ${esc(str)}</span>`}${d.text ? `<span class="peek-text">${esc(d.text)}</span>` : ''}`;
  return `<span class="runtime-selection-card"><span class="choice-card-art">${cardArt(card)}</span><strong class="choice-card-name">${esc(d.name)}</strong><span class="selection-peek-source" hidden>${peek}</span></span>`;
}

// Off-board picks list one card per row: memory in the card's hexagon, art band, stat circles stacked on the right.
export function selectionRowHtml(card) {
  const d = card.definition, cost = card.computed?.currentCost ?? d.cost;
  const atk = card.computed?.currentAtk ?? d.atk, str = card.computed?.currentStr ?? d.str;
  const hasStats = atk !== undefined && atk !== null;
  const peek = `<span class="peek-meta">${esc(d.category ?? '')}${cost === undefined || cost === null ? '' : ` / COST ${esc(cost)}`}</span><strong class="peek-name">${esc(d.name)}</strong>${hasStats ? `<span class="peek-stats">ATK ${esc(atk)} / STR ${esc(str)}</span>` : ''}${d.text ? `<span class="peek-text">${esc(d.text)}</span>` : ''}`;
  return `<span class="choice-row color-${colorClass(d.color)}"><span class="choice-row-cost">${cost === undefined || cost === null ? '-' : esc(cost)}</span><span class="choice-row-art">${CARD_ART[d.id] ? cardArt(card, 'choice-row-image') : ''}<small class="choice-row-category">${esc(d.category ?? '')}</small><strong class="choice-row-name">${esc(d.name)}</strong></span>${hasStats ? `<span class="choice-row-stats"><span class="stat stat-atk"><small>ATK</small><b>${esc(atk)}</b></span><span class="stat stat-str"><small>STR</small><b>${esc(str)}</b></span></span>` : '<span class="choice-row-stats is-empty">—</span>'}<span class="selection-peek-source" hidden>${peek}</span></span>`;
}

// While an effect asks for a pick, its card stays on screen with the clause being resolved lit.
const FLOW_DRAFT_KEYS = ['execution-targets', 'card-effect', 'execution-scope', 'effect-destination'];
function effectFlowHtml(model, presentation, request) {
  if (!request) return '';
  const source = presentation.plan
    ? FLOW_DRAFT_KEYS.includes(request.presentationKey) && visibleCards(model).find(card => !card.faceDown && card.cardRef === presentation.preview?.sourceRef)
    : model.requiredInput?.source && { faceDown: false, definition: { id: model.requiredInput.source.definitionId,
      name: model.requiredInput.source.name, text: model.requiredInput.source.text } };
  if (!source) return '';
  const d = source.definition, focus = effectFocus(d.id, d.text ?? '', request, presentation.stage);
  const step = presentation.stage && presentation.stage.index < presentation.stage.total ? `<em>${presentation.stage.index + 1} / ${presentation.stage.total}</em>` : '';
  return `<aside class="effect-flow" aria-label="処理中の効果" data-flow-card="${esc(d.id)}"><span class="effect-flow-art">${cardArt(source)}</span><div class="effect-flow-body"><header><small>処理中の効果</small>${step}</header><strong>${esc(d.name)}</strong><p>${effectTextHtml(d.text ?? '', focus)}</p></div></aside>`;
}

// A staged pick shows only the group whose turn it is, as a plain single pick.
function stagedRequest(request, stage, cards, viewerSeat) {
  if (!request || !stage || stage.index >= stage.total) return request;
  const options = request.options.filter(option => stage.optionIds.includes(option.optionId));
  const picked = options.map(option => cards.find(card => card.cardRef === option.cardRef)).filter(Boolean);
  const side = picked.length && picked.every(card => card.controllerSeat === viewerSeat) ? '自分の'
    : picked.length && picked.every(card => card.controllerSeat !== viewerSeat) ? '相手の' : '';
  const ob = picked.length && picked.every(card => /Ob/.test(card.definition.category ?? ''));
  return { ...request, options, title: `${side}${ob ? 'Obを1体' : 'カードを1枚'}選択（${stage.index + 1}/${stage.total}）`,
    constraints: { ...request.constraints, minimum: 1, maximum: 1, groups: [] } };
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
  // The frame takes the card's color; everything else wears the shared panel look.
  return `<aside class="r2-detail cp-panel cp-card" data-card-color="${colorClass(card.definition.color)}" aria-label="カード詳細">${panelHeadHtml({ eyebrow: 'CARD INSPECTOR', sub: esc(card.definition.id), title: 'カード詳細', close: 'data-close-detail', closeLabel: 'カード詳細を閉じる' })}${art}<section class="card-inspector"><div class="detail-heading"><span>${esc(card.definition.category)} / COST ${card.computed.currentCost}</span><h2>${esc(card.definition.name)}</h2></div><dl class="detail-grid"><div class="detail-location"><dt>場所</dt><dd>${esc(card.location?.zone ?? '一時確認')}</dd></div><div class="detail-state"><dt>状態</dt><dd>${card.status.sleep ? 'スリープ' : 'スタンバイ'}${card.status.residentActive ? ' / レジデント' : ''}</dd></div><div class="detail-atk"><dt>ATK</dt><dd>${card.computed.currentAtk}</dd></div><div class="detail-str"><dt>STR</dt><dd>${card.computed.currentStr} / ${card.computed.maxStr}${card.status.damage ? ` / ダメージ${card.status.damage}` : ''}</dd></div><div class="detail-class"><dt>クラス</dt><dd>${(card.definition.classes ?? []).map(name => `<span class="detail-class-tag">${esc(name)}</span>`).join('')}</dd></div></dl><section class="detail-section effect-text-section"><h3>効果テキスト</h3><p class="card-effect-copy">${cardEffectHtml(card.definition.text || '効果なし')}</p></section><section class="detail-section runtime-detail-section"><h3>付与・残数</h3>${runtimeComponentRowsHtml(card.computed.components,esc)}</section><section class="detail-section layer-detail-section"><h3>レイヤー ${card.mounted.length+1}</h3><ol>${[card,...card.mounted].map((layer,index) => `<li class="layer-${index === 0 ? 'top' : layer.location?.role ?? 'layered'}"><b>L${index+1}</b><span>${esc(layer.definition.name)}</span><small>${esc(layer.definition.category)}</small></li>`).join('')}</ol></section></section></aside>`;
}

const ACTION_LABELS = { attack: '攻撃', executeCard: '実行', executeSpell:'スペル実行',mountCard:'実行',setScript:'Scriptとして設置',executeRegistry:'レジストリから実行',activateCardEffect:'効果起動',executeLayered: 'レイヤード実行', install: 'インストール', activateScript: '起動', redeploy: '再実行', recoverRegistry: '回収', restSecurity: 'スリープ' };
export const actionTypeOf = action => action?.kind === 'fixed' ? action.action.type : action?.actionType;
// Hand cards always show the same routes for their category; the runtime decides which are live.
const handRoutes = category => category === 'Sp' ? ['executeSpell', 'install']
  : ['P-in', 'Plugin'].includes(category) ? ['install'] : ['executeCard', 'install'];
export const handCard = (model, cardRef) => model.seats.find(seat => seat.seatId === model.match.viewerSeat)
  ?.hand.cards.find(card => card.cardRef === cardRef) ?? null;

// Player-facing copy for the runtime's block codes. The codes come from the engine's checks.
export const BLOCK_MESSAGES = {
  NOT_YOUR_TURN: '自分のターンではありません', INPUT_PENDING: '選択の処理中です', RESOLVING: '処理中です',
  MATCH_FINISHED: '対戦は終了しています', TUTORIAL_LOCKED: 'チュートリアルの進行中です',
  SYMBOL_MISSING: 'シンボル不足で実行できません', MEMORY_SHORT: 'メモリ不足で実行できません',
  ZONE_FULL: '置ける枠がありません', ZONE_RESTRICTED: 'この枠には置けません',
  PLUGIN_INSTALL_ONLY: 'P-inはインストール専用です', EXECUTION_FORBIDDEN: 'このカードは実行できません',
  LAYERED_ONLY: 'レイヤード実行が必要です', SPELL_ACCESS_DENIED: '今はこのスペルを使えません',
  PLACEMENT_COST_UNMET: '配置コストが足りません', REGISTRY_ACTION_USED: 'このターンのレジストリ操作は使用済みです',
  NO_VALID_TARGET: '対象または置き場所がありません'
};
export function actionBlock(model, cardRef, type) {
  const general = model.actionBlocks?.general;
  return general ? { code: general } : model.actionBlocks?.cards.find(block => block.cardRef === cardRef && block.actionType === type) ?? null;
}
export const blockMessage = block => BLOCK_MESSAGES[block?.code] ?? '今は使えません';

function operationsHtml(model, presentation) {
  // While a draft or required choice is open, its dialog is the only place to confirm.
  if (presentation.plan || presentation.request || model.requiredInput) return '';
  const card = visibleCards(model).find(item => item.cardRef === model.ui.selectedCardRef);
  const inHand = card && handCard(model, card.cardRef);
  if (!card || !inHand && !card.interaction.sourceActionIds.length) return '';
  const actions = card.interaction.sourceActionIds.map(id => model.legalActions.find(action => action.actionId === id)).filter(Boolean);
  const live = action => `<button data-action-id="${esc(action.actionId)}">${esc(ACTION_LABELS[actionTypeOf(action)] ?? actionTypeOf(action))}</button>`;
  const routes = inHand ? handRoutes(card.definition.category) : [];
  const fixed = routes.map(type => {
    const action = actions.find(item => actionTypeOf(item) === type);
    const block = action ? null : actionBlock(model, card.cardRef, type);
    return action ? live(action) : `<button disabled aria-disabled="true" data-block-code="${esc(block?.code ?? '')}" title="${esc(blockMessage(block))}">${esc(ACTION_LABELS[type])}</button>`;
  }).join('');
  const extra = actions.filter(action => !routes.includes(actionTypeOf(action))).map(live).join('');
  return `<aside class="r2-popup" aria-label="カード操作"><strong>${esc(card.faceDown ? '裏向きカード' : card.definition.name)}</strong><div>${fixed}${extra}</div></aside>`;
}

function uniqueHtml(model,presentation) {
  const seat = model.seats.find(seat => seat.seatId === presentation.uniqueSeat);
  if (!seat) return '';
  const activate = seat.seatId === model.match.viewerSeat && model.legalActions.find(item => item.kind === 'fixed' && item.action.type === 'activateAbility');
  return `<aside class="r2-modal unique-effect-modal" role="dialog" aria-label="ユーザー能力"><section class="cp-panel cp-user">${panelHeadHtml({ eyebrow: 'USER EFFECT', sub: 'ABILITY.SYS', title: esc(seat.user.abilityName), close: 'data-runtime-unique-close', closeLabel: 'ユーザー能力を閉じる' })}<p>${abilityTextHtml(seat.user.abilityText)}</p><dl class="detail-grid"><div><dt>STR</dt><dd>${seat.fortressStr}/${seat.user.maxFortressStr}</dd></div><div><dt>MEM</dt><dd>${seat.memory.current}/${seat.memory.max}</dd></div></dl><section class="detail-section runtime-detail-section"><h3>付与・残数</h3>${runtimeComponentRowsHtml([...(seat.abilityStatus?.protect ? [{label:"プロテクト",value:`残り${seat.abilityStatus.protect}回`,note:"残数",abilityName:"PROTECT",tone:""}] : []),...(seat.abilityStatus?.backup ? [{label:"バックアップ",value:`残り${seat.abilityStatus.backup}回`,note:"付与分",abilityName:"BACKUP",tone:""}] : []),...(seat.user.abilityKey === "turbo" ? [{label:seat.user.abilityName,value:seat.abilityStatus?.turboUsed ? "使用済" : "残り1回",note:seat.turboActive ? "このターン起動中" : "対戦中",abilityName:null,tone:""}] : [])],esc)}</section><section class="detail-section"><h3>インシデント</h3><p>${(seat.user.incidents ?? []).map(value => `${value}${seat.incidents?.includes(value) ? '（使用済）' : ''}`).join(' / ')}</p></section>${activate ? `<button class="unique-effect-button is-available" data-action-id="${esc(activate.actionId)}">起動</button>` : ''}</section></aside>`;
}
// A finished tutorial keeps its closing line on screen with one way on: back to the tutorial list.
// A move refused by the tutorial shows its reason (flow.error) under the line.
function guideHtml(tutorial) {
  if (!tutorial?.presentation) return '';
  const complete = tutorial.flow.complete === true;
  const {presentation,flow} = tutorial, navigator = tutorialNavigator(flow.tutorialId);
  const text = (presentation.parts ?? [presentation.text]).map(part => typeof part === 'string' ? esc(part) : `<ruby>${esc(part.ruby)}<rt>${esc(part.rt)}</rt></ruby>`).join('');
  return `<aside class="r2-guide live-guide" aria-label="チュートリアル" data-tutorial-step="${flow.introComplete ? `${flow.tutorialId}:${flow.index}` : `intro:${flow.introIndex}`}"><div class="live-guide-cast"><img src="${esc(navigator.src)}" alt="${esc(presentation.speaker)}の立ち絵" style="object-position:${esc(navigator.objectPosition)}"><strong>${esc(presentation.speaker)}</strong></div><div class="live-guide-speech"><div class="live-guide-text" tabindex="0" role="region" aria-label="チュートリアルのセリフ"><p>${text}</p>${flow.error && !complete ? `<p class="live-guide-error" role="alert">${esc(flow.error)}</p>` : ''}</div><nav>${complete ? '<button class="live-guide-next" data-runtime-tutorial-finish>一覧へ戻る ▸</button>' : `<button class="live-guide-skip" data-runtime-tutorial-skip>スキップ</button>${presentation.intro || presentation.expect?.type === 'advance' ? '<button class="live-guide-next" data-runtime-tutorial-next>次へ ▸</button>' : ''}`}</nav></div></aside>`;
}
function artHtml(model,presentation) {
  const card = visibleCards(model).find(card => !card.faceDown && card.cardRef === presentation.artRef)
    ?? (presentation.inspection?.cardRef === presentation.artRef ? presentation.inspection : null);
  return card ? `<aside class="art-preview-overlay" role="dialog" aria-label="カード画像"><button data-runtime-art-close>閉じる</button>${cardArt(card,'art-preview-image',true)}</aside>` : '';
}
function requiredInputHtml(input, cards = []) {
  if (!input) return '';
  if (input.canAnswer === false) return `<aside class="effect-modal"><section class="effect-dialog"><p>相手の選択待ち</p><button data-runtime-menu>メニュー</button></section></aside>`;
  return `<aside class="effect-modal" data-selection-purpose="required">${selectionRequestHtml(requiredSelectionRequest(input), { cards, cardHtml: selectionCardHtml, rowHtml: selectionRowHtml })}${input.optional ? `<button data-choice-id="${esc(input.choiceId)}" data-decline>選ばない</button>` : ''}</aside>`;
}

export function runtimeGameRegions(model, presentation = {}, { includeRuntime = true, includeLocal = null } = {}) {
  const viewer = model.seats.find(seat => seat.seatId === model.match.viewerSeat);
  const opponent = model.seats.find(seat => seat.seatId !== model.match.viewerSeat);
  if (!viewer || !opponent) return null;
  const wants = name => includeLocal === null || includeLocal.includes(name);
  const layout = presentation.view === 'mobile' ? 'mobile' : 'desktop';
  const wireframe = presentation.boardStyle === 'wireframe';
  const viewedZone = wants('drawer') && presentation.zoneView
    ? model.seats.find(seat => seat.seatId === presentation.zoneView.seatId) : null;
  const zoneNames = {trash:'ゴミ箱',registry:'レジストリ',ban:'BAN'};
  const zoneTabs = viewedZone ? `<nav class="wf-zone-tabs">${Object.entries(zoneNames).map(([zone,label])=>`<button data-runtime-zone="${zone}" data-seat="${esc(viewedZone.seatId)}" aria-pressed="${zone===presentation.zoneView.zone}">${label}</button>`).join('')}</nav>` : '';
  const ownerTabs = viewedZone ? `<nav class="wf-owner-tabs">${[viewer,opponent].map(seat=>`<button data-runtime-zone="${presentation.zoneView.zone}" data-seat="${esc(seat.seatId)}" aria-pressed="${seat===viewedZone}">${seat===viewer?'自分':'相手'}</button>`).join('')}</nav>` : '';
  // Both boards browse zones the same way: zone tabs, then own/opponent tabs.
  const drawer = viewedZone ? `<aside class="wf-drawer cp-panel" aria-label="${esc(presentation.zoneView.zone)}">${panelHeadHtml({ eyebrow: 'ZONE ACCESS', sub: 'REF.SYS', title: '領域参照', close: 'data-runtime-zone-close', closeLabel: '領域参照を閉じる' })}<div class="wf-reference-body">${zoneTabs}<section>${ownerTabs}<div class="admin-card-list">${viewedZone[presentation.zoneView.zone].cards.map(card => runtimeCardHtml(card, presentation.zoneView.zone)).join('') || '<p>カードなし</p>'}</div></section></div></aside>` : '';
  const activation = includeRuntime ? model.legalActions.find(item => item.kind === 'fixed' && item.action.type === 'activateAbility') : null;
  const uniqueButton = includeRuntime ? `<button class="unique-effect${activation ? ' is-available' : ''}" data-runtime-unique="${esc(viewer.seatId)}">${activation && presentation.effectsEnabled ? `<span class="unique-particles">${'<i></i>'.repeat(13)}</span>` : ''}<span class="unique-effect-copy"><span class="unique-effect-eyebrow">UNIQUE EFFECT</span><strong class="unique-effect-name">${esc(viewer.user.abilityName)}</strong></span></button>` : '';
  const request = wants('selection') ? stagedRequest(presentation.request, presentation.stage, visibleCards(model), model.match.viewerSeat) : null;
  const flow = presentation.collapsed || !wants('selection') ? '' : effectFlowHtml(model, presentation, request);
  const selected = wants('selection') ? presentation.selection : null;
  // A single pick is decided by the pick itself, so it has no confirm button.
  const instant = request && isSinglePick(request) && !presentation.plan?.completion;
  const canConfirm = presentation.plan?.completion || request && validSelectionAnswer(request, selected ?? {requestId:request.requestId,optionIds:[],allocation:[]});
  // A board pick acts on the click itself, so it only needs a short prompt over the board.
  // Required choices use it too; an optional one offers 選ばない instead of 戻る.
  const boardPick = request && isBoardPick(request, presentation.interactionRequest);
  const decline = !presentation.plan && model.requiredInput?.optional;
  // On the board the flow floats clear of the targets; in a dialog it heads the options.
  const selection = !wants('selection') ? null : (boardPick ? flow : '') + (boardPick
    ? `<aside class="board-pick-guide" role="status" data-request-id="${esc(request.requestId)}"><strong>${esc(requestTitle(request))}</strong><span>${isBoardSlotRequest(request) ? '盤面の明るいマスを選択' : '盤面で光っている対象を選択'}</span>${presentation.plan ? '<button data-runtime-back>戻る</button>' : ''}${decline ? '<button data-runtime-decline>選ばない</button>' : ''}</aside>`
    : wants('selection') && (request || presentation.plan?.completion)
    ? presentation.collapsed ? `<button class="runtime-selection-reopen" data-selection-collapse aria-label="選択画面を開く">${selectionEyeHtml()}</button>`
      : `<aside class="effect-modal" data-selection-purpose="${presentation.plan ? 'draft' : 'required'}">${request ? selectionRequestHtml(request, { cards: visibleCards(model), answer: selected,
        cardHtml: selectionCardHtml, rowHtml: selectionRowHtml, lead: flow }) : '<section class="effect-dialog"><h2>操作を確定</h2></section>'}<nav>${instant ? '' : `<button data-runtime-confirm ${canConfirm ? '' : 'disabled'}>${presentation.plan?.completion ? '実行' : presentation.plan ? '次へ' : '確定'}</button>`}${model.requiredInput?.optional && !presentation.plan ? '<button data-runtime-decline>選ばない</button>' : ''}<button data-runtime-back>戻る</button></nav></aside>`
    : requiredInputHtml(model.requiredInput, visibleCards(model)));
  const hand = includeRuntime ? viewer.hand.cards.map((card, index) => {
    const offset = index - (viewer.hand.count - 1) / 2;
    return `<div class="hand-card" style="--hand-rotate:${offset * 5}deg;--hand-sink:${Math.abs(offset) * 5}px">${runtimeCardHtml(card, 'hand')}</div>`;
  }).join('') : '';
  return {
    layout,
    // Only the board differs between the two styles; the HUD around it is shared.
    board: includeRuntime ? wireframe ? wireframeBoardHtml(model, uniqueButton) : `<div class="r2-board"><div class="r2-board-fit"><div class="battle-board">${sideHtml(opponent, model.match.viewerSeat)}${sideHtml(viewer, model.match.viewerSeat)}</div></div></div>` : null,
    // The user windows sit in screen space, so the classic board carries them with the HUD.
    console: includeRuntime ? wireframeControlsHtml(model) + (wireframe ? '' : wireframeStatusHtml(viewer, true, uniqueButton) + wireframeStatusHtml(opponent, false)) : null,
    hand: includeRuntime ? `<section class="r2-hand" aria-label="自分の手札 ${viewer.hand.count}枚"><div class="r2-hand-scroll hand-scroll">${hand}</div></section>` : null,
    handToggle: includeRuntime ? '' : null,
    drawer: wants('drawer') ? drawer : null,
    detail: wants('detail') ? detailHtml(model,presentation) : null,
    unique: wants('unique') ? uniqueHtml(model,presentation) : null,
    profile: wants('profile') ? presentation.profileSeat ? userDetailHtml(model,presentation.profileSeat) : '' : null,
    art: wants('art') ? artHtml(model,presentation) : null,
    guide: wants('guide') ? guideHtml(presentation.tutorial) : null,
    popup: wants('popup') ? operationsHtml(model,presentation) : null,
    selection,
    log: wants('log') ? model.ui.logOpen ? runtimeLogHtml(presentation.log ?? [], model.match.viewerSeat) : '' : null,
    menu: wants('menu') ? model.ui.menuOpen ? '<aside class="r2-modal" role="dialog" aria-label="メニュー"><section><button data-runtime-menu>閉じる</button><button data-runtime-rematch>再戦</button><button data-runtime-title>タイトルに戻る</button></section></aside>' : '' : null,
    // A tutorial ends in its own closing line (guideHtml), not in the match result window.
    result: wants('result') ? presentation.resultDismissed || presentation.tutorial ? '' : runtimeResultHtml(model.match) : null
  };
}

const regionHost = (name, html, className = '') => `<div data-live-region="${name}"${className ? ` class="${className}"` : ''}>${html}</div>`;

export function runtimeGameHtml(model, presentation = {}) {
  const regions = runtimeGameRegions(model, presentation);
  if (!regions) return '';
  return `<main class="r2-runtime-view r2-wireframe-view${presentation.boardStyle==='wireframe'?'':' r2-classic-board'}" data-layout="${regions.layout}" data-revision="${model.match.revision}">${regionHost('board', regions.board, 'r2-stage')}${regionHost('console', regions.console, 'r2-tools-host')}${regionHost('hand', regions.hand, 'r2-hand-host')}${regionHost('hand-toggle', regions.handToggle, 'r2-region-host')}${['drawer','detail','unique','profile','art','guide','popup','selection','log','menu','result'].map(name => regionHost(name, regions[name], `r2-region-host r2-region-${name}`)).join('')}</main>`;
}
