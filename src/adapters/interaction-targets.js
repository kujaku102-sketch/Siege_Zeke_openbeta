const ref = value => typeof value === 'string' && /^r:[0-9a-f]{32}$/.test(value);
const seat = value => typeof value === 'string' && value.length > 0;
const valid = hit => hit && (hit.kind === 'card' ? ref(hit.cardRef)
  : hit.kind === 'user' ? seat(hit.seatId)
  : hit.kind === 'slot' && seat(hit.seatId) && ['front', 'back'].includes(hit.zone)
    && Number.isSafeInteger(hit.slot) && hit.slot > 0);
const same = (a, b) => valid(a) && valid(b) && a.kind === b.kind
  && (a.kind === 'card' ? a.cardRef === b.cardRef : a.kind === 'user' ? a.seatId === b.seatId
    : a.seatId === b.seatId && a.zone === b.zone && a.slot === b.slot);

function visibleBoardCards(model) {
  const result = new Map();
  for (const outerSeat of model?.seats ?? []) for (const zone of ['front', 'back']) {
    const limit = outerSeat?.user?.[`${zone}Limit`];
    if (!Number.isSafeInteger(limit) || limit < 1) continue;
    for (const card of outerSeat?.[zone]?.cards ?? []) {
      const slot = card?.faceDown
        ? card.area === zone ? card.slot : null
        : card?.location?.kind === 'board' && card.location.seatId === outerSeat.seatId
          && card.location.zone === zone ? card.location.position : null;
      if (!ref(card?.cardRef) || !Number.isSafeInteger(slot) || slot < 1 || slot > limit) continue;
      result.set(card.cardRef, { kind: 'slot', seatId: outerSeat.seatId, zone, slot });
    }
  }
  return result;
}

// Build UI-only exact hit targets from the current public request. This never
// decides legality and never falls back to labels, names or DOM order.
export function buildInteractionRequest(request, model) {
  if (!request || typeof request.requestId !== 'string' || !Array.isArray(request.options)) return null;
  const board = visibleBoardCards(model);
  const viewerSeat = model?.match?.viewerSeat;
  const options = request.options.map(option => {
    const targets = [];
    const add = target => { if (valid(target) && !targets.some(item => same(item, target))) targets.push(target); };
    if (ref(option?.cardRef)) add({ kind: 'card', cardRef: option.cardRef });
    if (ref(option?.hostRef)) add({ kind: 'card', cardRef: option.hostRef });
    const referenced = option?.cardRef ?? option?.hostRef;
    if (ref(referenced) && board.has(referenced)) add(board.get(referenced));
    if (seat(option?.seatId) && (option.kind === 'user' || option.targetKind === 'user')) {
      add({ kind: 'user', seatId: option.seatId });
    }
    if (['front', 'back'].includes(option?.zone) && Number.isSafeInteger(option?.slot)
      && option.slot > 0 && seat(option?.seatId ?? viewerSeat)) {
      add({ kind: 'slot', seatId: option.seatId ?? viewerSeat, zone: option.zone, slot: option.slot });
    }
    return { optionId: option?.optionId, targets };
  });
  return { requestId: request.requestId, options, constraints: structuredClone(request.constraints) };
}

export function resolveInteractionTarget(interactionRequest, hit) {
  if (!valid(hit) || !Array.isArray(interactionRequest?.options)) return { kind: 'none' };
  const optionIds = [...new Set(interactionRequest.options.filter(option => typeof option?.optionId === 'string'
    && Array.isArray(option.targets) && option.targets.some(target => same(target, hit))).map(option => option.optionId))];
  return optionIds.length === 0 ? { kind: 'none' } : optionIds.length === 1
    ? { kind: 'one', optionId: optionIds[0] } : { kind: 'ambiguous', optionIds };
}
