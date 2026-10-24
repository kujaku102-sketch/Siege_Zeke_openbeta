import { abilityTextHtml } from '../ui/ability-help.js';
import { panelHeadHtml } from './cyber-panel.js';

const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

// The STR strip runs from full STR down to 0, ten numbers wide, and scrolls sideways.
// Lost STR is dimmed and every incident value carries a warning mark.
function incidentStripHtml(seat) {
  const { maxFortressStr: max, incidents } = seat.user;
  const used = seat.incidents ?? [];
  const cells = [];
  for (let n = max; n >= 0; n -= 1) {
    const state = n === seat.fortressStr ? ' is-now' : n > seat.fortressStr ? ' is-lost' : '';
    const mark = incidents.includes(n) ? `<i class="${used.includes(n) ? 'is-used' : ''}" aria-label="インシデント${used.includes(n) ? '(使用済)' : ''}">⚠</i>` : '';
    cells.push(`<li class="ud-str${state}">${mark}<b>${n}</b></li>`);
  }
  return `<ol class="ud-strip" data-ud-strip aria-label="STR ${seat.fortressStr} / ${max}、インシデント ${incidents.join('・')}">${cells.join('')}</ol>`;
}

// Read-only profile of one seat's user. Launching the ability stays with the
// UNIQUE EFFECT button; name and icon are the card's until profiles exist.
export function userDetailHtml(model, seatId) {
  const seat = model.seats.find(item => item.seatId === seatId);
  if (!seat) return '';
  const user = seat.user;
  const mine = seat.seatId === model.match.viewerSeat;
  const stats = [
    ['初期STR', user.maxFortressStr], ['メモリ', user.memory], ['初期手札', user.initialHand],
    ['フロント上限', user.frontLimit], ['バック上限', user.backLimit], ['デッキ構築ルール', user.deckRule]
  ];
  return `<aside class="r2-modal user-detail-modal" role="dialog" aria-label="ユーザー詳細"><section class="cp-panel ud-panel">${panelHeadHtml({ eyebrow: 'USER PROFILE', sub: 'USER.SYS', title: 'ユーザー詳細', close: 'data-runtime-profile-close', closeLabel: 'ユーザー詳細を閉じる' })}
<div class="ud-grid"><div class="ud-col">
<div class="ud-box ud-player"><h3>PLAYER <em>${mine ? '自分' : '相手'}</em></h3><div class="ud-id"><div class="ud-icon" data-icon-id="placeholder" aria-label="アイコン(仮)">${esc(user.name.slice(0, 1))}</div><div class="ud-name"><small>USER NAME</small><strong>${esc(user.name)}</strong><span>USER CARD: ${esc(user.name)}</span></div></div></div>
<div class="ud-box ud-avatar"><h3>AVATAR <em>準備中</em></h3><div class="ud-avatar-slot" data-avatar-id="placeholder">AVATAR</div></div>
</div><div class="ud-col">
<div class="ud-box ud-effect"><h3>USER EFFECT <em>ABILITY.SYS</em></h3><div class="ud-banner"><small>UNIQUE EFFECT</small><strong>${esc(user.abilityName)}</strong></div><p>${abilityTextHtml(user.abilityText)}</p></div>
<div class="ud-box ud-status"><h3>STATUS <em>${esc(user.definitionId)}</em></h3><dl>${stats.map(([label, value]) => `<div><dt>${label}</dt><dd${value === null ? ' class="is-none"' : ''}>${value === null ? 'なし' : esc(value)}</dd></div>`).join('')}</dl></div>
<div class="ud-box ud-incident"><h3>INCIDENT <em>現在STR ${seat.fortressStr}</em></h3>${incidentStripHtml(seat)}</div>
</div></div></section></aside>`;
}

// Opens the strip with the current STR in view.
export function centerIncidentStrip(root) {
  const strip = root.querySelector?.('[data-ud-strip]');
  const now = strip?.querySelector('.is-now');
  if (now) strip.scrollLeft = now.offsetLeft - (strip.clientWidth - now.offsetWidth) / 2;
}
