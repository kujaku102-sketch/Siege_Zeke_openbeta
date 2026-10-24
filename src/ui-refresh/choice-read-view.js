const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

// Runtime presentation keys are identifiers, not player-facing copy.
const PRESENTATION_LABELS = {
  'execution-destination': '配置先を選択', 'execution-placement': '配置先を選択',
  'attack-target': '攻撃対象を選択', 'execution-targets': '効果の対象を選択',
  'card-effect': '起動する効果を選択', 'effect-destination': '移動先を選択',
  'layered-materials': 'レイヤードの素材を選択', 'trigger-order': '解決順を選択'
};
export const presentationLabel = key => PRESENTATION_LABELS[key] ?? '選択';
// Slot-only requests are answered on the board itself, as before the runtime split.
export const isBoardSlotRequest = request => Array.isArray(request?.options) && request.options.length > 0
  && request.options.every(option => ['front', 'back'].includes(option.zone) && Number.isSafeInteger(option.slot)
    && !option.cardRef && !option.hostRef && !option.preview);

// At most one option to pick (optional or not): the pick itself is the answer.
export const isSinglePick = request => !['allocation', 'random'].includes(request?.constraints?.kind)
  && request?.constraints?.minimum <= 1 && request.constraints.maximum === 1;
// The engine's own prompt line when it has one, otherwise the generic label.
export const requestTitle = request => request?.title ?? presentationLabel(request?.presentationKey);
// Single picks whose every option can be hit on the board need no option list.
export const isBoardPick = (request, interaction) => isSinglePick(request)
  && interaction?.requestId === request.requestId && interaction.options.length > 0
  && interaction.options.every(option => option.targets.some(target => ['slot', 'user'].includes(target.kind)));

// Both draft and required selections render the same public payload.
// Input routing stays with the adapter that owns the surrounding request.
// Cards picked from off the board (deck, trash, generated...) read better as a scrolling list.
const BOARD_ZONES = ['hand', 'front', 'back'];
const optionCard = (option, cards) => option.preview?.definition ? { faceDown: false, definition: option.preview.definition }
  : option.cardRef ? cards.find(item => item.cardRef === option.cardRef) : null;
export const isOffBoardPick = (request, cards = []) => request.constraints?.kind !== 'allocation'
  && request.options.length > 0 && request.options.every(option => {
    const card = optionCard(option, cards);
    return card && !card.faceDown && (!option.cardRef || !BOARD_ZONES.includes(card.location?.zone));
  });

export function selectionRequestHtml(request, { cards = [], answer = null, cardHtml = null, rowHtml = null, lead = '' } = {}) {
  const selected = new Set(answer?.optionIds ?? []);
  const c = request.constraints;
  if (isBoardSlotRequest(request)) {
    const chosen = request.options.filter(option => selected.has(option.optionId))
      .map(option => `${option.zone.toUpperCase()} ${option.slot}`).join('、');
    return `<section class="effect-dialog board-slot-request" data-request-id="${esc(request.requestId)}"><header><h2>${esc(requestTitle(request))}</h2></header><p role="status">${chosen ? `選択中：${esc(chosen)}` : '盤面の明るいマスを選択'}</p></section>`;
  }
  const instructions = c.kind === 'random' ? 'ランダム選択：続行で確定'
    : isSinglePick(request) ? (c.minimum === 0 ? '1枚選ぶとすぐ決定（選ばないことも可）' : '1枚選ぶとすぐ決定')
    : c.kind === 'allocation' ? `合計 ${c.total} ／ 現在 ${(answer?.allocation ?? []).reduce((sum, row) => sum + row.amount, 0)}`
    : `${selected.size} ／ ${c.minimum}〜${c.maximum}枚${c.aggregate ? ` ・ 合計${c.aggregate.comparator}${c.aggregate.value}` : ''}`;
  const groups = (c.groups ?? []).map((group, index) => `<p>条件${index + 1}：${answer?.optionIds?.filter(id => group.optionIds.includes(id)).length ?? 0} ／ ${group.minimum}〜${group.maximum}</p>`).join('');
  const list = Boolean(rowHtml) && isOffBoardPick(request, cards);
  // The list wears the same panel skin as the log and the other match panels.
  const head = list ? `<header class="cp-head"><div><small>CARD ACCESS <i>/ LIST</i></small><h2>${esc(requestTitle(request))}</h2></div>` : `<header><h2>${esc(requestTitle(request))}</h2>`;
  return `<section class="effect-dialog${list ? ' is-list cp-panel' : ''}" data-request-id="${esc(request.requestId)}">${head}<button data-selection-collapse aria-label="選択画面を畳む">${selectionEyeHtml(true)}</button></header>${lead}<div class="runtime-selection-options${list ? ' is-list' : ''}">${request.options.map(option => {
    const card = optionCard(option, cards);
    if (list) return `<div class="runtime-selection-option${selected.has(option.optionId) ? ' selected' : ''}"><button data-option-id="${esc(option.optionId)}" aria-pressed="${selected.has(option.optionId)}"${option.cardRef ? ` data-card-ref="${esc(option.cardRef)}"` : ''}>${rowHtml(card)}</button></div>`;
    const label = option.label ?? (card && !card.faceDown ? card.definition.name
      : option.zone ? `${option.zone}${option.slot ? ` ${option.slot}` : ''}` : option.kind ?? option.optionId);
    const amount = answer?.allocation?.find(row => row.optionId === option.optionId)?.amount ?? 0;
    return `<div class="runtime-selection-option${selected.has(option.optionId) ? ' selected' : ''}"><button data-option-id="${esc(option.optionId)}" aria-pressed="${selected.has(option.optionId)}"${option.cardRef ? ` data-card-ref="${esc(option.cardRef)}"` : ''}>${card && cardHtml ? cardHtml(card) : option.preview && cardHtml ? cardHtml({ faceDown: false, definition: { id: option.preview.definitionId, name: option.preview.name } }) : esc(label)}</button>${request.constraints.kind === 'allocation' ? `<input type="number" min="0" step="1" value="${amount}" data-allocation-option="${esc(option.optionId)}" aria-label="${esc(label)}の割り当て">` : ''}</div>`;
  }).join('')}</div><footer><p>${esc(instructions)}</p>${groups}</footer></section>`;
}

export function selectionEyeHtml(closing = false) {
  return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>${closing ? '<path d="m4 3 16 18M20 3 4 21"/>' : ''}</svg>`;
}

export function actionPlanHtml(plan) {
  return `<aside class="effect-modal" data-selection-purpose="draft">${plan.selectionRequests.map(selectionRequestHtml).join('')}</aside>`;
}
