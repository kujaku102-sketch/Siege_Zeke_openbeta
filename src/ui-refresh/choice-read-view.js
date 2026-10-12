const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

// Both draft and required selections render the same public payload.
// Input routing stays with the adapter that owns the surrounding request.
export function selectionRequestHtml(request, { cards = [], answer = null, cardHtml = null } = {}) {
  const selected = new Set(answer?.optionIds ?? []);
  const c = request.constraints;
  const instructions = c.kind === 'random' ? 'ランダム選択：続行で確定'
    : c.kind === 'allocation' ? `合計 ${c.total} ／ 現在 ${(answer?.allocation ?? []).reduce((sum, row) => sum + row.amount, 0)}`
    : `${selected.size} ／ ${c.minimum}〜${c.maximum}枚${c.aggregate ? ` ・ 合計${c.aggregate.comparator}${c.aggregate.value}` : ''}`;
  const groups = (c.groups ?? []).map((group, index) => `<p>条件${index + 1}：${answer?.optionIds?.filter(id => group.optionIds.includes(id)).length ?? 0} ／ ${group.minimum}〜${group.maximum}</p>`).join('');
  return `<section class="effect-dialog" data-request-id="${esc(request.requestId)}"><header><h2>${esc(request.presentationKey)}</h2><button data-selection-collapse aria-label="選択画面を畳む">${selectionEyeHtml(true)}</button></header><div class="runtime-selection-options">${request.options.map(option => {
    const card = option.preview?.definition ? {faceDown:false,definition:option.preview.definition}
      : option.cardRef ? cards.find(item => item.cardRef === option.cardRef) : null;
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
