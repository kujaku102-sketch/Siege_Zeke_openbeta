import { CARD_ART } from '../data/card-art.generated.js';

const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const names = { install: 'インストール', executeCard: '実行', executeLayered: 'レイヤード実行',
  redeploy: '再実行', activateScript: '起動', attack: '攻撃', endTurn: 'ターン終了',
  recoverRegistry: '回収', activateAbility: '固有能力', openingMulligan: '引き直し',
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

export function runtimeLogHtml(events, viewerSeat) {
  let previousTurn = null;
  const rows = events.map(event => {
    const turn = event.turnNumber !== previousTurn ? `<div class="r2-log-turn">TURN ${event.turnNumber}</div>` : '';
    previousTurn = event.turnNumber;
    const source = event.source ?? event.target;
    const art = source?.faceDown ? null : CARD_ART[source?.definitionId];
    return `${turn}<article class="r2-log-entry ${event.actorSeat === viewerSeat ? 'is-you' : 'is-opponent'}" data-event-id="${esc(event.eventId)}">${art ? `<img class="r2-log-card-icon" src="${esc(art)}" alt="">` : ''}<div><strong>${event.actorSeat === viewerSeat ? 'YOU' : 'OPPONENT'}</strong><p>${esc(runtimeEventText(event))}</p></div></article>`;
  }).join('');
  return `<aside class="r2-log" role="dialog" aria-label="対戦ログ"><header><h2>対戦ログ</h2><button data-runtime-log>×</button></header><div class="r2-log-scroll">${rows || '<p>行動はまだない</p>'}</div></aside>`;
}

export function runtimeResultHtml(match) {
  if (!match.finished) return '';
  const outcome = match.lockedOutcome;
  const result = outcome?.kind === 'draw' ? 'DRAW'
    : outcome?.winnerSeat === match.viewerSeat ? 'VICTORY' : 'DEFEAT';
  return `<aside class="r2-result is-${result.toLowerCase()}" role="dialog" aria-label="対局結果"><canvas class="r2-result-fx" aria-hidden="true"></canvas><h2>${result}</h2><button data-runtime-result-close>閉じる</button><button data-runtime-rematch>再戦</button><button data-runtime-title>タイトルに戻る</button></aside>`;
}
