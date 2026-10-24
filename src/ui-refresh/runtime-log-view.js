import { CARD_ART } from '../data/card-art.generated.js';
import { CARD_LIBRARY } from '../data/cards.js';
import { abilityBadgeDefinition } from '../data/ability-badges.js';

const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const names = { install: 'インストール', executeCard: '実行', executeLayered: 'レイヤード実行',
  redeploy: '再実行', activateScript: '起動', attack: '攻撃', endTurn: 'ターン終了',
  recoverRegistry: '回収', activateAbility: '固有能力', openingMulligan: '引き直し',
  executeSpell:'スペル実行',mountCard:'実行',setScript:'Script設置',executeRegistry:'レジストリ実行',activateCardEffect:'効果起動',
  sandboxAddCard: 'カード追加', answerChoice: '対象確定', declineChoice: '見送る' };

function runtimeEventText(event) {
  const name = value => value?.name ?? (value?.kind === 'user' ? 'ユーザー' : 'カード');
  const delta = (before, after) => Number.isFinite(before) && Number.isFinite(after) ? ` STR ${before}→${after}` : '';
  switch (event.type) {
    case 'action_committed': return `${event.source ? `${name(event.source)}：` : ''}${names[event.actionType] ?? event.actionType}`;
    case 'turn_started': return 'ターン開始';
    case 'attack_declared': return `${name(event.source)} → ${name(event.target)} 攻撃宣言`;
    case 'combat_resolved': return `${name(event.source)} → ${name(event.target)} ${event.damage}ダメージ${delta(event.targetStrBefore, event.targetStrAfter)} ／ ${name(event.source)}に${event.counterDamage}ダメージ${delta(event.sourceStrBefore, event.sourceStrAfter)}`;
    case 'card_damaged': case 'user_damaged': return `${name(event.source)} → ${name(event.target)} ${event.amount}ダメージ${delta(event.before, event.after)}`;
    case 'card_destroyed': return `${name(event.target)} 破壊`;
    case 'card_moved': {
      const zone = location => location.kind === 'unobserved' ? '非表示領域'
        : location.kind === 'mounted' ? 'レイヤー' : location.zone;
      return `${name(event.target ?? event.source)} ${zone(event.from)}→${zone(event.to)}`;
    }
    case 'stat_changed': return `${name(event.target)} ${event.metric.replace('current', '')} ${event.before}→${event.after}`;
    case 'choice_required': return '対象選択待ち';
    case 'choice_resolved': return '対象選択を解決';
    case 'user_ability_feedback': return `固有能力 ${event.abilityKey}`;
    case 'result_locked': return '勝敗固定・宣言済み処理を解決中';
    case 'result_finished': return event.outcome.kind === 'draw' ? '引き分け' : '対局終了';
    default: return '';
  }
}

const tags = { install: 'INSTALL', executeCard: 'EXEC', executeLayered: 'EXEC', executeSpell: 'SPELL',
  executeRegistry: 'EXEC', redeploy: 'EXEC', activateScript: 'ACTIVATE', activateCardEffect: 'ACTIVATE',
  activateAbility: 'ABILITY', mountCard: 'EXEC', setScript: 'SET', attack: 'ATTACK', endTurn: 'END',
  recoverRegistry: 'RECOVER', openingMulligan: 'REDRAW', answerChoice: 'CHOICE', declineChoice: 'CHOICE' };

// Zone words follow the rulebook (3. フィールド構造).
const zoneNames = { hand: '手札', deck: '山札', front: 'フロント', back: 'バック', registry: 'レジストリ',
  trash: 'ゴミ箱', ban: 'BAN', script: 'Script' };

const quoted = name => /^「.*」$/.test(name) ? name : `「${name}」`;

// A move as one sentence in rulebook words: 手札から「華守り」をフロントへ配置。
function moveText(event, cardName) {
  const zone = location => location?.kind === 'mounted' ? 'レイヤー'
    : location?.kind === 'unobserved' ? null : zoneNames[location?.zone] ?? location?.zone ?? null;
  const from = zone(event.from), to = zone(event.to), raw = cardName(event.target ?? event.source);
  const card = raw === '裏向きカード' ? raw : quoted(raw);
  const origin = from ? `${from}から` : '';
  if (to === 'フロント' || to === 'バック') return from === 'フロント' || from === 'バック'
    ? `${card}を${to}へ移動。` : `${origin}${card}を${to}へ配置。`;
  if (to === '手札') return from === 'レジストリ' ? `レジストリから${card}を回収。` : `${origin}${card}を手札に加える。`;
  if (to === 'レジストリ') return `${origin}${card}をインストール。`;
  if (to === 'ゴミ箱') return `${origin}${card}をゴミ箱へ送る。`;
  if (to === 'BAN') return `${origin}${card}をBAN。`;
  if (to === 'レイヤー') return `${origin}${card}をレイヤーに重ねる。`;
  return to ? `${origin}${card}を${to}へ。` : `${origin}${card}を非公開領域へ。`;
}

// A moved card sits with its owner (a draw on the opponent's turn end is still yours).
const seatOf = event => event.type === 'card_moved'
  ? event.to?.seatId ?? event.from?.seatId ?? event.actorSeat : event.actorSeat;

// One log row: a type tag, who did it, a short line and the numbers as badges.
function logEntry(event, viewerSeat) {
  const name = value => value?.kind === 'user' ? (value.seatId === viewerSeat ? '自分のユーザー' : '相手ユーザー')
    : value?.faceDown ? '裏向きカード' : value?.name ?? 'カード';
  const str = (label, before, after) => Number.isFinite(before) && Number.isFinite(after)
    ? [{ tone: 'str', label, before, after }] : [];
  const dmg = (label, amount) => Number.isFinite(amount) ? [{ tone: 'dmg', text: `${label}${amount} DMG` }] : [];
  switch (event.type) {
    case 'action_committed': return { tag: tags[event.actionType] ?? 'ACTION', text: names[event.actionType] ?? event.actionType,
      system: event.actionType === 'endTurn' };
    case 'turn_started': return { tag: 'TURN', text: 'ターン開始', system: true };
    case 'attack_declared': return { tag: 'ATTACK', text: `→ ${name(event.target)} 攻撃宣言` };
    case 'combat_resolved': return { tag: 'COMBAT', tone: 'dmg', text: `→ ${name(event.target)}`, nums: [
      ...dmg('', event.damage), ...str('対象 STR', event.targetStrBefore, event.targetStrAfter),
      ...dmg('反撃 ', event.counterDamage), ...str('自 STR', event.sourceStrBefore, event.sourceStrAfter)] };
    case 'card_damaged': case 'user_damaged': return { tag: 'DAMAGE', tone: 'dmg', text: `→ ${name(event.target)}`,
      nums: [...dmg('', event.amount), ...str('STR', event.before, event.after)] };
    case 'card_destroyed': return { tag: 'BREAK', tone: 'brk', text: `${name(event.target)} 破壊` };
    case 'card_moved': return { tag: 'MOVE', text: moveText(event, name) };
    case 'stat_changed': return { tag: 'STAT', text: name(event.target),
      nums: str(event.metric.replace('current', '').toUpperCase(), event.before, event.after) };
    case 'choice_required': case 'choice_resolved': return { tag: 'CHOICE', text: runtimeEventText(event), system: true };
    case 'user_ability_feedback': return { tag: 'ABILITY', text: runtimeEventText(event) };
    case 'result_locked': case 'result_finished': return { tag: 'RESULT', text: runtimeEventText(event), system: true };
    default: return { tag: 'EVENT', text: runtimeEventText(event) };
  }
}

const badgeHtml = badge => badge.tone === 'str'
  ? `<b class="is-str">${esc(badge.label)} <s>${esc(badge.before)}</s>→${esc(badge.after)}</b>`
  : `<b>${esc(badge.text)}</b>`;

const turnDivider = (turnNumber, side) => `<div class="r2-log-turn ${side}"><b>TURN ${esc(String(turnNumber).padStart(2, '0'))}</b>${side === 'is-you' ? 'YOU' : 'OPPONENT'}</div>`;

const triggerKeywords = { logout: 'ログアウト', login: 'ログイン' };
// Regex literals, not `new RegExp` strings: the doubled backslashes a string needs read as a UNC path to the public build check.
const triggerOpeners = { logout: /[\[［]ログアウト[\]］]/, login: /[\[［]ログイン[\]］]/ };

// The part of the card text a trigger runs: what follows its keyword, up to the next keyword block.
function triggerClause(definitionId, timing) {
  const text = String(CARD_LIBRARY[definitionId]?.text ?? '');
  const keyword = triggerKeywords[timing] ?? null;
  const at = keyword ? text.search(triggerOpeners[timing]) : -1;
  const rest = at < 0 ? text.replace(/^(?:[\[［][^\]］]*[\]］])+/, '')
    : text.slice(at).replace(/^[\[［][^\]］]*[\]］]/, '');
  const end = rest.search(/。\s*[\[［]/);
  return { keyword: at < 0 ? null : keyword, clause: (end < 0 ? rest : rest.slice(0, end + 1)).trim() };
}

function triggerEffectHtml(card, timing, side) {
  if (!card || card.faceDown) return '';
  const { keyword, clause } = triggerClause(card.definitionId, timing);
  const badge = keyword ? abilityBadgeDefinition(keyword) : null;
  const icon = badge?.asset ? `<img class="r2-log-kw" src="${esc(badge.asset)}" alt="${esc(badge.label)}">`
    : keyword ? `「${esc(keyword)}」` : '';
  return `<p class="r2-log-thread-effect ${side}">${icon}${icon && clause ? '：' : ''}${esc(clause)}<em>起動！</em></p>`;
}

// The whole log body. A command's follow-ups (where it was placed, what it attacked) nest
// under the row that started it. A trigger thread, simultaneous triggers resolved one by
// one, is boxed from thread_started to thread_resolved, each trigger's rows under its own
// numbered card. freshIds marks rows that arrived since the last render.
export function runtimeLogBodyHtml(events, viewerSeat, freshIds = new Set()) {
  let html = '';
  let previousTurn = null;
  let head = null;
  let thread = null;
  for (const event of events) {
    // Inside a thread the effect line already says what runs; the wait/resolve pairs are noise.
    if (thread && (event.type === 'choice_required' || event.type === 'choice_resolved')) continue;
    // What was picked shows in the rows that follow, so the answer itself is not logged.
    if (event.type === 'action_committed' && event.actionType === 'answerChoice') continue;
    if (event.turnNumber !== previousTurn) {
      // The divider names whose turn it is; the ending player's last row can lead the new turn.
      const turnSeat = events.find(item => item.turnNumber === event.turnNumber && item.type === 'turn_started')?.actorSeat ?? event.actorSeat;
      html += turnDivider(event.turnNumber, turnSeat === viewerSeat ? 'is-you' : 'is-opponent');
      previousTurn = event.turnNumber;
    }
    // The box itself marks the thread, so its start and end draw no rows.
    if (event.type === 'thread_started') {
      if (thread) html += '</section>';
      thread = { id: event.threadId, current: null, count: 0, items: new Map((event.items ?? []).map(row =>
        [row.threadItemId, { seat: row.controllerSeat, card: row.card, timing: row.timing }])) };
      html += `<section class="r2-log-thread" aria-label="スレッド">`;
      continue;
    }
    if (event.type === 'thread_resolved') {
      if (thread?.id === event.threadId) { html += '</section>'; thread = null; }
      continue;
    }
    const entry = logEntry(event, viewerSeat);
    const item = thread?.items.get(event.threadItemId);
    // Turn changes and rule-driven steps belong to neither player, so they sit in the middle.
    const side = entry.system ? 'is-system' : (item ? item.seat : seatOf(event)) === viewerSeat ? 'is-you' : 'is-opponent';
    if (item && thread.current !== event.threadItemId) {
      // Triggers are numbered in the order they resolve, not the order they were queued.
      thread.current = event.threadItemId;
      const itemSide = item.seat === viewerSeat ? 'is-you' : 'is-opponent';
      const name = item.card?.faceDown ? '裏向きカード' : item.card?.name ?? '誘発';
      html += `<div class="r2-log-thread-item ${itemSide}"><span class="r2-log-thread-no">THREAD${++thread.count}</span><strong>${esc(name)}</strong></div>${triggerEffectHtml(item.card, item.timing, itemSide)}`;
      head = { commandId: null, side, source: item.card };
    }
    const child = !entry.system && (item ? true : head?.commandId === event.commandId && head.side === side);
    if (!child && !item) head = entry.system ? null : { commandId: event.commandId, side, source: event.source ?? event.target };
    const source = event.source ?? event.target;
    const art = source?.faceDown ? null : CARD_ART[source?.definitionId];
    // A move sentence already names its card.
    const sameSource = child && (event.type === 'card_moved' || source?.cardRef && source.cardRef === head?.source?.cardRef);
    const name = source?.kind === 'card' && !sameSource ? `${child ? '' : ' · '}${source.faceDown ? '裏向きカード' : esc(source.name)}` : '';
    const who = child ? name : `${seatOf(event) === viewerSeat ? 'YOU' : 'OPP'}${name}`;
    const icon = entry.system || child ? '' : art ? `<span class="r2-log-card-icon"><img src="${esc(art)}" alt=""></span>`
      : `<span class="r2-log-card-icon is-blank" aria-hidden="true">${entry.tone === 'brk' ? '✕' : '//'}</span>`;
    const text = child && event.type === 'card_moved' ? `→${entry.text}` : entry.text;
    const nums = entry.nums?.length ? `<div class="r2-log-numbers">${entry.nums.map(badgeHtml).join('')}</div>` : '';
    const classes = ['r2-log-entry', side, ...(child ? ['is-child'] : []), ...(entry.tone ? [`is-${entry.tone}`] : []), ...(freshIds.has(event.eventId) ? ['is-new'] : [])];
    html += `<article class="${classes.join(' ')}" data-event-id="${esc(event.eventId)}" data-event-type="${esc(event.type)}">${icon}<div class="r2-log-body"><div class="r2-log-head"><span class="r2-log-tag">${entry.tag}</span>${who ? `<strong>${who}</strong>` : ''}</div><p>${esc(text)}</p>${nums}</div></article>`;
  }
  return thread ? `${html}</section>` : html;
}

// The same log as plain rows, for keeping or sending outside the game. It skips what the
// window skips; a trigger thread becomes one THREAD row naming the card, its rows follow.
export function runtimeLogRows(events, viewerSeat) {
  const cardName = card => card?.kind === 'user' ? (card.seatId === viewerSeat ? '自分のユーザー' : '相手ユーザー')
    : card?.faceDown ? '裏向きカード' : card?.name ?? null;
  const badgeText = badge => badge.tone === 'str' ? `${badge.label} ${badge.before}→${badge.after}` : badge.text;
  const rows = [];
  let thread = null;
  for (const event of events) {
    if (thread && (event.type === 'choice_required' || event.type === 'choice_resolved')) continue;
    if (event.type === 'action_committed' && event.actionType === 'answerChoice') continue;
    if (event.type === 'thread_started') {
      thread = { id: event.threadId, current: null, items: new Map((event.items ?? []).map(row => [row.threadItemId, row])) };
      continue;
    }
    if (event.type === 'thread_resolved') { if (thread?.id === event.threadId) thread = null; continue; }
    const side = seat => seat === viewerSeat ? 'you' : 'opponent';
    const item = thread?.items.get(event.threadItemId);
    if (item && thread.current !== event.threadItemId) {
      thread.current = event.threadItemId;
      rows.push({ turn: event.turnNumber, side: side(item.controllerSeat), tag: 'THREAD', card: cardName(item.card) ?? '誘発', text: item.timing ?? '' });
    }
    const entry = logEntry(event, viewerSeat);
    const card = cardName(event.source ?? event.target);
    rows.push({ turn: event.turnNumber, side: entry.system ? 'system' : side(item ? item.controllerSeat : seatOf(event)),
      tag: entry.tag, ...(card ? { card } : {}), text: entry.text,
      ...(entry.nums?.length ? { numbers: entry.nums.map(badgeText) } : {}) });
  }
  return rows;
}

// Card actions a player sets off; attacks, turn ends and answers are not activations.
const ACTIVATIONS = new Set(['install', 'executeCard', 'executeLayered', 'executeSpell', 'executeRegistry',
  'redeploy', 'mountCard', 'activateScript', 'activateCardEffect', 'setScript']);

// Which side's callout a card activation belongs to: 'you', 'opponent' or '' for none.
export function activationSide(event, viewerSeat) {
  if (event?.type !== 'action_committed' || !ACTIVATIONS.has(event.actionType) || event.source?.kind !== 'card') return '';
  return event.actorSeat === viewerSeat ? 'you' : 'opponent';
}

// The log's row for a card activation, shown on its own over the board.
export function runtimeActivationHtml(event, viewerSeat) {
  const side = activationSide(event, viewerSeat);
  if (!side) return '';
  const entry = logEntry(event, viewerSeat);
  const source = event.source;
  const art = source.faceDown ? null : CARD_ART[source.definitionId];
  const icon = art ? `<span class="r2-log-card-icon"><img src="${esc(art)}" alt=""></span>`
    : '<span class="r2-log-card-icon is-blank" aria-hidden="true">//</span>';
  const name = source.faceDown ? '裏向きカード' : esc(source.name);
  return `<article class="r2-log-entry is-${side}" data-event-id="${esc(event.eventId)}">${icon}<div class="r2-log-body"><div class="r2-log-head"><span class="r2-log-tag">${entry.tag}</span><strong>${side === 'you' ? 'YOU' : 'OPP'} · ${name}</strong></div><p>${esc(entry.text)}</p></div></article>`;
}

// One trigger of an open thread for the callout stack: its number (Tr1, Tr2…) to the left, then
// the log-style row with the card and the effect it runs. Numbered by queue position.
export function runtimeThreadItemHtml(item, number, viewerSeat) {
  const side = item?.controllerSeat === viewerSeat ? 'you' : 'opponent', card = item?.card;
  const art = card && !card.faceDown ? CARD_ART[card.definitionId] : null;
  const icon = art ? `<span class="r2-log-card-icon"><img src="${esc(art)}" alt=""></span>`
    : '<span class="r2-log-card-icon is-blank" aria-hidden="true">//</span>';
  const name = !card ? '誘発' : card.faceDown ? '裏向きカード' : esc(card.name);
  return `<b class="r2-log-thread-no">Tr${number}</b><article class="r2-log-entry is-${side}" data-thread-item="${esc(item?.threadItemId ?? '')}">${icon}<div class="r2-log-body"><div class="r2-log-head"><span class="r2-log-tag">${esc(triggerKeywords[item?.timing] ?? '誘発')}</span><strong>${side === 'you' ? 'YOU' : 'OPP'} · ${name}</strong></div>${triggerEffectHtml(card, item?.timing, `is-${side}`)}</div></article>`;
}

export function runtimeLogHtml(events, viewerSeat) {
  const rows = runtimeLogBodyHtml(events, viewerSeat);
  return `<aside class="r2-log" role="dialog" aria-label="対戦ログ"><header><div><small>BATTLE RECORD <i>//</i> LOG.SYS</small><h2>対戦ログ</h2></div><button data-runtime-log aria-label="対戦ログを閉じる">×</button></header><div class="r2-log-scroll">${rows || '<p>行動はまだない</p>'}</div></aside>`;
}

export function runtimeResultHtml(match) {
  if (!match.finished) return '';
  const outcome = match.lockedOutcome;
  const kind = outcome?.kind === 'draw' ? 'draw' : outcome?.winnerSeat === match.viewerSeat ? 'win' : 'defeat';
  const result = { win:'YOU WIN', defeat:'DEFEAT', draw:'DRAW' }[kind];
  return `<aside class="r2-result is-${kind}" role="dialog" aria-label="対局結果" data-outcome="${kind}"><canvas class="r2-result-fx" aria-hidden="true"></canvas><h2 data-text="${result}">${result}</h2><button data-runtime-result-close>閉じる</button><button data-runtime-rematch>再戦</button><button data-runtime-title>タイトルに戻る</button></aside>`;
}
