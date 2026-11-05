// The battle log's words, with no screen behind them: no DOM, no import.meta.url, no imports at all, so a server
// (a Worker writing the match log at the end) can load it as it is. runtime-log-view.js draws the window from these.
export const names = { install: 'インストール', executeCard: '実行', executeLayered: 'レイヤード実行',
  redeploy: '再実行', activateScript: '起動', attack: '攻撃', endTurn: 'ターン終了',
  recoverRegistry: '回収', activateAbility: '固有能力', openingMulligan: '引き直し',
  // v2.4 opening: the opponent's decision is reported as one hidden kind (keep or redraw is not shown).
  keepOpeningHand: 'キープ', openingDecision: '開始手札の決定',
  executeSpell:'スペル実行',mountCard:'マウント',setScript:'Script設置',executeRegistry:'レジストリ実行',activateCardEffect:'効果起動',
  sandboxAddCard: 'カード追加', answerChoice: '対象確定', declineChoice: '見送る' };

export function runtimeEventText(event) {
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

export const tags = { install: 'INSTALL', executeCard: 'EXEC', executeLayered: 'EXEC', executeSpell: 'SPELL',
  executeRegistry: 'EXEC', redeploy: 'EXEC', activateScript: 'ACTIVATE', activateCardEffect: 'ACTIVATE',
  activateAbility: 'ABILITY', mountCard: 'EXEC', setScript: 'SET', attack: 'ATTACK', endTurn: 'END',
  recoverRegistry: 'RECOVER', openingMulligan: 'REDRAW', keepOpeningHand: 'KEEP', openingDecision: 'OPENING', answerChoice: 'CHOICE', declineChoice: 'CHOICE' };

// Zone words follow the rulebook (3. フィールド構造).
export const zoneNames = { hand: '手札', deck: '山札', front: 'フロント', back: 'バック', registry: 'レジストリ',
  trash: 'ゴミ箱', ban: 'BAN', script: 'Script' };

const quoted = name => /^「.*」$/.test(name) ? name : `「${name}」`;

// A move as one sentence in rulebook words: 手札から「華守り」をフロントへ配置。
export function moveText(event, cardName) {
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
export const seatOf = event => event.type === 'card_moved'
  ? event.to?.seatId ?? event.from?.seatId ?? event.actorSeat : event.actorSeat;

// One log row: a type tag, who did it, a short line and the numbers as badges.
export function logEntry(event, viewerSeat) {
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
