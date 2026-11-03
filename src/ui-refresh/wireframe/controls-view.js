import { memoryMeterHtml } from './memory-meter.js';
const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export const HUD_ICONS = {
  log: '<path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>',
  zones: '<path d="m3 7 9-4 9 4-9 4zM3 12l9 4 9-4M3 17l9 4 9-4"/>',
  // Eight even teeth around a hole (文豪, 2026-11-02, 「歯車ボタンは A 六角」).
  gear: '<path fill-rule="evenodd" d="M9.97 3.85L10.36 1.12L13.64 1.12L14.03 3.85L16.33 4.8L18.54 3.15L20.85 5.46L19.2 7.67L20.15 9.97L22.88 10.36L22.88 13.64L20.15 14.03L19.2 16.33L20.85 18.54L18.54 20.85L16.33 19.2L14.03 20.15L13.64 22.88L10.36 22.88L9.97 20.15L7.67 19.2L5.46 20.85L3.15 18.54L4.8 16.33L3.85 14.03L1.12 13.64L1.12 10.36L3.85 9.97L4.8 7.67L3.15 5.46L5.46 3.15L7.67 4.8Z M15.4 12a3.4 3.4 0 1 0 -6.8 0a3.4 3.4 0 1 0 6.8 0Z"/>'
};
// Actions without a card: a fixed one carries its command, an intent only names its type.
const actionTypeOf = action => action?.kind === 'fixed' ? action.action?.type : action?.actionType ?? action?.action?.type;
const EXTRA_ACTION_LABELS = { openingMulligan: '引き直し', keepOpeningHand: 'キープ' };
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${HUD_ICONS[name]}</svg>`;
// The compat sprite layer of a HUD button (hud-sprites.css); hidden unless the sheets are in use.
const SPRITE = '<i class="wf-sprite" aria-hidden="true"></i>';

// The opponent's hand as a fan of backs: only how many, never what.
function opponentHandHtml(count) {
  const shown = Math.min(count, 10);
  const spread = shown > 1 ? Math.min(8, 48 / (shown - 1)) : 0;
  const backs = Array.from({ length: shown }, (_, i) => `<i style="--a:${((i - (shown - 1) / 2) * spread).toFixed(1)}deg"></i>`).join('');
  return `<section class="wf-opp-hand" aria-label="相手の手札 ${count}枚"><div class="wf-opp-hand-fan" aria-hidden="true">${backs}</div><output>${count}</output></section>`;
}

// The number on the TURN button counts the active side's own turns: "my 3rd turn",
// or on the opponent's turn "their 3rd turn". The match-wide count stays in the log.
export function activeTurnCount(model) {
  const taken = model.seats.find(s=>s.seatId===model.match.activeSeat)?.turnsTaken;
  return Number.isSafeInteger(taken) ? Math.max(1, taken) : model.match.turnNumber;
}

// Presentation only. Enabled actions and IDs always come from the read model.
export function wireframeControlsHtml(model) {
  const mine = model.match.activeSeat === model.match.viewerSeat;
  const globals = model.globalActionIds.map(id => model.legalActions.find(a=>a.actionId===id)).filter(Boolean);
  const end = globals.find(a=>a.action?.type==='endTurn');
  const status = model.match.progress === 'resultLocked' ? '解決中' : model.requiredInput ? '選択待ち' : mine ? 'ターン終了' : '相手ターン';
  const memory = model.seats.find(s=>s.seatId===model.match.viewerSeat).memory;
  const turn = activeTurnCount(model), label = end ? 'Finish' : status;
  const opponentHand = model.seats.find(s=>s.seatId!==model.match.viewerSeat)?.hand.count ?? 0;
  return `<nav class="wf-hud" aria-label="対局操作"><button class="wf-gear" data-runtime-menu aria-label="メニュー・オプション">${icon('gear')}</button>${opponentHandHtml(opponentHand)}<section class="wf-turn-controls" data-patch-keep="class:wf-hud-rendered class:wf-hud-sprites">${memoryMeterHtml(memory)}<canvas class="wf-hud-model" aria-hidden="true" data-patch-keep="width height data-engine"></canvas><button class="wf-turn" data-runtime-end-turn ${end ? `data-action-id="${esc(end.actionId)}"` : 'disabled'} data-turn="${turn}" data-turn-side="${mine?'mine':'theirs'}" data-turn-label="${esc(label)}" aria-label="${status} ${mine?'自分':'相手'}の${turn}ターン目"><span class="wf-turn-facet" aria-hidden="true"></span>${SPRITE}<small>TURN</small><strong>${turn}</strong><span class="wf-turn-label">${label}</span></button><div class="wf-memory"><span>Memory</span><output aria-label="メモリ ${memory.current} / ${memory.max}">${memory.current}/${memory.max}</output></div><div class="wf-extra-actions">${globals.filter(a=>!['endTurn','activateAbility'].includes(actionTypeOf(a))).map(a=>`<button class="wf-extra-action" data-action-id="${esc(a.actionId)}">${esc(EXTRA_ACTION_LABELS[actionTypeOf(a)] ?? actionTypeOf(a))}</button>`).join('')}</div><section class="wf-hex-tools"><button class="wf-hex wf-log" data-runtime-log aria-label="対戦ログ">${SPRITE}${icon('log')}</button><button class="wf-hex wf-information" data-runtime-counts aria-label="押している間、山札・ゴミ箱・レジストリ・BANの枚数を表示">${SPRITE}<i aria-hidden="true">i</i></button><button class="wf-hex wf-zones" data-runtime-zone="trash" data-seat="${esc(model.match.viewerSeat)}" aria-label="領域参照">${SPRITE}${icon('zones')}</button></section></section></nav>`;
}
