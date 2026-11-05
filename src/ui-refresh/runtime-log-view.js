import { CARD_ART } from '../data/card-art.generated.js';
import { CARD_LIBRARY } from '../data/cards.js';
import { abilityBadgeDefinition } from '../data/ability-badges.js';
// The log's words live in a module with no imports, so a server can build the match log from them.
import { logEntry, seatOf } from './runtime-log-rows.js';
export { runtimeLogRows } from './runtime-log-rows.js';

const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const badgeHtml = badge => badge.tone === 'str'
  ? `<b class="is-str">${esc(badge.label)} <s>${esc(badge.before)}</s>→${esc(badge.after)}</b>`
  : `<b>${esc(badge.text)}</b>`;

const turnDivider = (turnNumber, side) => `<div class="r2-log-turn ${side}"><b>TURN ${esc(String(turnNumber).padStart(2, '0'))}</b>${side === 'is-you' ? 'YOU' : 'OPPONENT'}</div>`;

// Before the first turn the users keep or redraw in turn; those rows sit under their own divider, not under the first TURN.
const OPENING_ACTIONS = new Set(['openingMulligan', 'keepOpeningHand', 'openingDecision']);
const openingDivider = '<div class="r2-log-turn is-system"><b>OPENING</b>開始前</div>';

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
  const openingCommands = new Set(events.filter(event => event.type === 'action_committed' && OPENING_ACTIONS.has(event.actionType)).map(event => event.commandId));
  const started = new Set();
  for (const event of events) {
    // Inside a thread the effect line already says what runs; the wait/resolve pairs are noise.
    if (thread && (event.type === 'choice_required' || event.type === 'choice_resolved')) continue;
    // What was picked shows in the rows that follow, so the answer itself is not logged.
    if (event.type === 'action_committed' && event.actionType === 'answerChoice') continue;
    if (event.type === 'turn_started') started.add(event.commandId);
    // The last decision's command also starts turn 1: its rows from turn_started on belong to the turn.
    const opening = openingCommands.has(event.commandId) && !started.has(event.commandId);
    if (opening) {
      if (previousTurn !== 'opening') { html += openingDivider; previousTurn = 'opening'; }
    } else if (event.turnNumber !== previousTurn) {
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

// The match's end screen (文豪, 2026-11-01), for a match and a tutorial alike: CONGRATULATION! with the dots, DEFEAT
// with the dots and noise running through them, and the ways on. A draw reads NO CONTEST, with no effect (文豪, 2026-11-01).
// A tutorial has no log to save and goes back to its own list. Read from the state, not from the event feed: a win
// board started as a new match has no events.
export const RESULT_TITLES = Object.freeze({ win: 'CONGRATULATION!', defeat: 'DEFEAT', draw: 'NO CONTEST' });

export function runtimeResultHtml(match, { tutorial = false } = {}) {
  if (!match.finished) return '';
  const outcome = match.lockedOutcome;
  const kind = outcome?.kind === 'draw' ? 'draw' : outcome?.winnerSeat === match.viewerSeat ? 'win' : 'defeat';
  const title = RESULT_TITLES[kind];
  return `<aside class="r2-result is-${kind}" role="dialog" aria-label="対局結果" data-outcome="${kind}"><canvas class="r2-result-fx" aria-hidden="true"></canvas><h2 data-text="${title}">${title}</h2><nav class="r2-result-actions">${tutorial ? '' : '<button data-runtime-save-log>対戦ログを保存</button>'}<button data-runtime-to-menu>${tutorial ? 'チュートリアル選択へ' : '対戦メニューに戻る'}</button><button data-runtime-title>ホームに戻る</button></nav></aside>`;
}
