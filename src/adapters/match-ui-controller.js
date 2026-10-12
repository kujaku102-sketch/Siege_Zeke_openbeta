import { buildHtmlReadModel } from './html-read-model.js';
import { requiredSelectionRequest, validSelectionAnswer } from '../game/runtime/selection-contract.js';

const failure = code => ({ ok: false, error: { code } });
const copy = value => structuredClone(value);
const emptyUi = () => ({ selectedCardRef: null, detailCardRef: null,
  menuOpen: false, logOpen: false, handOpen: true, draft: null });

// GUI input is a consumer of the same bound port as CUI/AI. Drafts and menu
// visibility never enter Authority or spend a command/revision.
export function createMatchUiController({ session, viewerSeat }) {
  let bound = session.port(viewerSeat);
  if (!bound.ok) return bound;
  let port = bound.value;
  let active = true;
  let serial = 0;
  let revision = -1;
  let query = null;
  let ui = emptyUi();
  let draft = null;
  let collapsed = false;
  let zoneView = null;
  let inspection = null, uniqueSeat = null, artRef = null, resultDismissed = false;
  const logs = new Map();
  const refresh = () => {
    if (!active) return failure('MATCH_UI_DISPOSED');
    const read = port.query();
    if (!read.ok) return read;
    if (revision !== read.value.status.revision) {
      inspection = null; artRef = null; ui.detailCardRef = null;
      draft = null;
      collapsed = false;
      ui.draft = null;
    }
    revision = read.value.status.revision;
    query = read.value;
    const model = buildHtmlReadModel(query, ui);
    if (!model.ok) return model;
    ui = model.value.ui;
    const events = session.takeEvents(viewerSeat);
    const log = logs.get(viewerSeat) ?? [];
    if (events.ok) log.push(...events.value);
    logs.set(viewerSeat, log);
    return { ok: true, value: {
      model: model.value, plan: copy(draft?.plan ?? null),
      request: copy(currentRequest()), selection: copy(draft?.answer ?? null),
      collapsed, events: copy(events.ok ? events.value : []), log: copy(log),
      zoneView: copy(zoneView),
      inspection:copy(inspection),uniqueSeat,artRef,resultDismissed,
      eventReadError: events.ok ? null : events.error.code
    } };
  };
  const currentRequest = () => draft?.kind === 'action' ? draft.plan.selectionRequests[0] ?? null
    : query?.requiredInput?.canAnswer ? requiredSelectionRequest(query.requiredInput) : null;
  const submit = action => {
    const result = port.submit({ commandId: `gui:${++serial}`, expectedRevision: revision, action });
    if (!result.ok) return result;
    draft = null;
    ui.draft = null;
    const read = refresh();
    return read.ok ? { ok: true, value: { submitted: result.value, ...read.value } } : read;
  };
  const ensureAnswer = () => {
    const request = currentRequest();
    if (!request) return null;
    if (!draft || draft.answer.requestId !== request.requestId) {
      draft = { kind: 'choice', answer: { requestId: request.requestId, optionIds: [], allocation: [] } };
    }
    return request;
  };
  const readPlan = () => {
    const plan = port.queryAction({ expectedRevision: revision,
      actionId: draft.actionId, selections: draft.selections });
    if (!plan.ok) return plan;
    draft.plan = plan.value;
    const request = currentRequest();
    draft.answer = { requestId: request?.requestId ?? '', optionIds: [], allocation: [] };
    return plan;
  };
  return { ok: true, value: Object.freeze({
    read: refresh,
    selectCard(cardRef, inspect = false) {
      const read = refresh();
      if (!read.ok) return read;
      if (inspect) {
        ui.selectedCardRef = cardRef;
        inspection = null;
        const find = cards => {for (const card of cards ?? []) {if (card.cardRef === cardRef) return card;
          if (!card.faceDown) {const child = find(card.mounted);if (child) return child;}}return null;};
        const card = read.value.model.seats.flatMap(seat => ['hand','front','back','registry','trash','ban']
          .map(zone => find(seat[zone].cards))).find(Boolean);
        if (!card) return failure('ACTION_NOT_ALLOWED');
        if (card.faceDown) {
          if (card.controllerSeat !== viewerSeat) return failure('ACTION_NOT_ALLOWED');
          const detail = port.query({inspectRef:cardRef});
          if (!detail.ok) return detail;
          inspection = detail.value.inspection;
        }
        ui.detailCardRef = cardRef;
      }
      else { ui.selectedCardRef = cardRef; draft = null; }
      return refresh();
    },
    closeDetail() { ui.detailCardRef = null; inspection = null; artRef = null; return refresh(); },
    openArt(cardRef) { artRef = cardRef; return refresh(); },
    closeArt() { artRef = null; return refresh(); },
    openUnique(seatId) { uniqueSeat = seatId; return refresh(); },
    closeUnique() { uniqueSeat = null; return refresh(); },
    dismissResult() { resultDismissed = true; return refresh(); },
    chooseAction(actionId) {
      const read = refresh();
      if (!read.ok) return read;
      const entry = query.legalActions.find(action => action.actionId === actionId);
      if (!entry) return failure('ACTION_NOT_ALLOWED');
      if (entry.kind === 'fixed') return submit(entry.action);
      draft = { kind: 'action', actionId, selections: [], plan: null, answer: null };
      const planned = readPlan();
      if (!planned.ok) { draft = null; return planned; }
      // A ready plan is still a draft. One explicit confirm submits once.
      return refresh();
    },
    toggleOption(optionId) {
      const read = refresh();
      if (!read.ok) return read;
      const request = ensureAnswer();
      if (!request || !request.options.some(option => option.optionId === optionId)) return failure('INVALID_SELECTION');
      const answer = draft.answer;
      const selected = answer.optionIds.includes(optionId);
      if (selected) {
        answer.optionIds = answer.optionIds.filter(id => id !== optionId);
        answer.allocation = answer.allocation.filter(row => row.optionId !== optionId);
      } else {
        if (request.constraints.maximum === 1) answer.optionIds = [];
        answer.optionIds.push(optionId);
      }
      return refresh();
    },
    setAmount(optionId, amount) {
      const read = refresh();
      if (!read.ok) return read;
      const request = ensureAnswer();
      if (!request || request.constraints.kind !== 'allocation'
        || !request.options.some(option => option.optionId === optionId)
        || !Number.isSafeInteger(amount) || amount < 0) return failure('INVALID_SELECTION');
      draft.answer.optionIds = draft.answer.optionIds.filter(id => id !== optionId);
      draft.answer.allocation = draft.answer.allocation.filter(row => row.optionId !== optionId);
      if (amount) {
        draft.answer.optionIds.push(optionId);
        draft.answer.allocation.push({ optionId, amount });
      }
      return refresh();
    },
    confirm() {
      const read = refresh();
      if (!read.ok) return read;
      if (draft?.kind === 'action' && draft.plan.completion) return submit(draft.plan.completion.action);
      const request = ensureAnswer();
      if (!request || !validSelectionAnswer(request, draft.answer)) return failure('INVALID_SELECTION');
      if (draft.kind === 'choice') return submit({ type: 'answerChoice', choiceId: request.requestId,
        optionIds: draft.answer.optionIds, allocation: draft.answer.allocation });
      draft.selections.push(copy(draft.answer));
      const planned = readPlan();
      if (!planned.ok) return planned;
      return refresh();
    },
    decline() {
      const read = refresh();
      if (!read.ok) return read;
      const input = query.requiredInput;
      if (!input?.canAnswer || !input.optional) return failure('ACTION_NOT_ALLOWED');
      return submit({ type: 'declineChoice', choiceId: input.choiceId });
    },
    back() {
      const read = refresh();
      if (!read.ok) return read;
      if (query.requiredInput !== null && draft?.kind !== 'action') { collapsed = true; return refresh(); }
      if (draft?.kind === 'action' && draft.selections.length) {
        draft.selections.pop();
        const planned = readPlan();
        if (!planned.ok) return planned;
      } else {
        draft = null;
        ui.selectedCardRef = null;
      }
      return refresh();
    },
    toggleCollapsed() { collapsed = !collapsed; return refresh(); },
    toggleMenu() { ui.menuOpen = !ui.menuOpen; return refresh(); },
    toggleLog() { ui.logOpen = !ui.logOpen; return refresh(); },
    toggleHand() { ui.handOpen = !ui.handOpen; return refresh(); },
    openZone(seatId, zone) {
      const read = refresh();
      if (!read.ok) return read;
      if (!['registry', 'trash', 'ban'].includes(zone)
        || !read.value.model.seats.some(seat => seat.seatId === seatId)) return failure('ZONE_NOT_VISIBLE');
      zoneView = { seatId, zone };
      return refresh();
    },
    closeZone() { zoneView = null; return refresh(); },
    switchViewer(seatId) {
      if (!active) return failure('MATCH_UI_DISPOSED');
      const next = session.port(seatId);
      if (!next.ok) return next;
      viewerSeat = seatId;
      port = next.value;
      revision = -1; ui = emptyUi(); draft = null; zoneView = null; inspection = null; uniqueSeat = null; artRef = null; resultDismissed = false; logs.clear();
      return refresh();
    },
    dispose() { active = false; draft = null; query = null; inspection = null; uniqueSeat = null; artRef = null; logs.clear(); return { ok: true, value: null }; }
  }) };
}
