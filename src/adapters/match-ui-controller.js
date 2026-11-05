import { createHtmlReadModelProjection } from './html-read-model.js';
import { requiredSelectionRequest, validSelectionAnswer } from '../game/runtime/selection-contract.js';
import { buildInteractionRequest, resolveInteractionTarget } from './interaction-targets.js';
import { modeInteraction, modeOptionIds, PLACEMENT_MODES, placementModes, selectionStage, stageGroupIds, stagedInteraction } from './selection-stage.js';

const failure = code => ({ ok: false, error: { code } });
const copy = value => structuredClone(value);

// A port's write or question may answer now (the local session) or later, as a Promise (a remote one).
export const isThenable = value => typeof value?.then === 'function';
// fn runs on the result: at once when it is already here, so a local match stays synchronous.
export const when = (value, fn) => isThenable(value) ? Promise.resolve(value).then(fn) : fn(value);
// Runs a generator whose yields may be Promises, step by step without waiting while each value is already here.
export function flow(generator) {
  const step = input => { const next = generator.next(input); return next.done ? next.value : when(next.value, step); };
  return step(undefined);
}
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
  let projection = null;
  let syncKey = null;
  let ui = emptyUi();
  let draft = null;
  let collapsed = false;
  let zoneView = null;
  // The way chosen on the bar for a placement that has two (selection-stage.js); a new request starts as the card itself.
  let placement = { requestId: null, mode: PLACEMENT_MODES[0] };
  let inspection = null, uniqueSeat = null, profileSeat = null, artRef = null, resultDismissed = false;
  const logs = new Map();
  const pendingEvents = new Map();
  let eventCursor = null;
  let eventReadError = null;
  // While a write or question is out (a remote port), the next input waits its turn: a second tap is refused.
  let waiting = false;
  const sameSync = (a, b) => a && b && ['matchId', 'sessionGeneration', 'viewerSeat', 'currentRevision',
    'modeEpoch', 'adoptedRevision', 'adoptedModeEpoch', 'available'].every(key => a[key] === b[key]);
  const invalidateProjection = () => { projection = null; syncKey = null; query = null; revision = -1; };
  const collectEvents = () => {
    const events = port.events({ afterEventId: eventCursor });
    if (!events.ok) { eventReadError = events.error.code; return; }
    eventReadError = null;
    const log = logs.get(viewerSeat) ?? [];
    const known = new Set(log.map(event => event.eventId));
    for (const event of events.value.events) {
      if (!pendingEvents.has(event.eventId)) pendingEvents.set(event.eventId, copy(event));
      if (!known.has(event.eventId)) { log.push(copy(event)); known.add(event.eventId); }
    }
    logs.set(viewerSeat, log);
  };
  const synchronize = () => {
    if (!active) return failure('MATCH_UI_DISPOSED');
    const stamped = session.readStamp(viewerSeat);
    if (!stamped.ok) return stamped;
    if (!sameSync(syncKey, stamped.value)) {
      const read = stamped.value.available ? port.latest() : port.query();
      if (!read.ok) return read;
      const built = createHtmlReadModelProjection(read.value);
      if (!built.ok) return built;
      if (revision !== read.value.status.revision) {
        inspection = null; artRef = null; ui.detailCardRef = null;
        draft = null; collapsed = false; ui.draft = null;
      }
      revision = read.value.status.revision;
      query = read.value;
      projection = built.value;
      const adopted = session.readStamp(viewerSeat);
      if (!adopted.ok) return adopted;
      syncKey = adopted.value;
    }
    const model = projection.project(ui);
    if (!model.ok) return model;
    ui = copy(model.value.ui);
    collectEvents();
    const log = ui.logOpen ? logs.get(viewerSeat) ?? [] : [];
    const request = currentRequest();
    const stage = selectionStage(request, draft?.answer);
    const placementMode = placementModes(request) ? placementModeFor(request) : null;
    return { ok: true, value: {
      model: model.value, plan: copy(draft?.plan ?? null), request: copy(request), sync: copy(syncKey), stage: copy(stage),
      interactionRequest: copy(stagedInteraction(modeInteraction(buildInteractionRequest(request, model.value), request, placementMode), stage)),
      placementMode,
      selection: copy(draft?.answer ?? null), preview: copy(buildPreview(request, model.value)),
      collapsed, events: copy([...pendingEvents.values()]), log: copy(log), zoneView: copy(zoneView),
      inspection: copy(inspection), uniqueSeat, profileSeat, artRef, resultDismissed, eventReadError
    } };
  };
  const refresh = () => synchronize();
  const placementModeFor = request => {
    if (placement.requestId !== request.requestId) placement = { requestId: request.requestId, mode: PLACEMENT_MODES[0] };
    return placement.mode;
  };
  // A draft whose first plan is still out has nothing to pick yet.
  const currentRequest = () => draft?.kind === 'action' ? draft.plan?.selectionRequests[0] ?? null
    : query?.requiredInput?.canAnswer ? requiredSelectionRequest(query.requiredInput) : null;
  const selectedOptions = request => request?.options?.filter(option => draft?.answer?.optionIds.includes(option.optionId)) ?? [];
  const buildPreview = (request, model) => {
    const history = copy(draft?.history ?? []);
    const chosen = selectedOptions(request);
    const role = request?.presentationKey ?? null;
    const interaction = buildInteractionRequest(request, model);
    const currentTargets = interaction?.options
      .filter(option => draft?.answer?.optionIds.includes(option.optionId)).flatMap(option => option.targets) ?? [];
    const latestRole = roles => role && roles.includes(role)
      ? { selectedOptions: chosen, targets: currentTargets }
      : [...history].reverse().find(entry => roles.includes(entry.presentationKey)) ?? null;
    const destinationRole = latestRole(['execution-destination', 'execution-placement']);
    const targetRole = latestRole(['attack-target', 'execution-targets']);
    const roleOptions = presentationKey => copy(latestRole([presentationKey])?.selectedOptions ?? []);
    const target = copy((targetRole?.targets ?? []).filter(item => ['card', 'user'].includes(item?.kind)));
    const destination = copy(destinationRole?.selectedOptions?.[0] ?? null);
    return draft?.kind === 'action' ? {
      scope: { matchId: query.status.matchId, revision, viewerSeat }, actionId: draft.actionId,
      sourceRef: draft.sourceRef, request: copy(request), selection: copy(draft.answer), destination,
      target, history, roles: {
        materials: roleOptions('layered-materials'),
        placement: roleOptions('execution-placement'),
        effect: roleOptions('card-effect'),
        selectionScope: roleOptions('execution-scope'),
        targetZone: roleOptions('effect-destination')
      }, completion: copy(draft.plan?.completion ?? null), hoverTarget: null
    } : null;
  };
  const acceptedReceipt = result => result?.receipt?.status === 'accepted'
    && result.receipt.reasonCode === 'ACCEPTED';
  const submit = action => flow(function* () {
    const commandId = `gui:${++serial}`;
    let result = yield port.submit({ commandId, expectedRevision: revision, action });
    if (!result.ok) {
      const receipt = yield port.receipt(commandId);
      if (!receipt.ok) return result;
      result = { ok: true, value: { kind: 'recovered', receipt: receipt.value } };
    }
    if (!acceptedReceipt(result.value)) return failure(result.value?.receipt?.reasonCode ?? 'ACTION_NOT_ALLOWED');
    draft = null;
    ui.draft = null;
    invalidateProjection();
    const read = synchronize();
    return read.ok ? { ok: true, value: { submitted: copy(result.value), ...read.value } }
      : { ok: false, error: { code: 'MATCH_UI_READ_AFTER_ACCEPT_FAILED', cause: read.error.code,
        commandId, receipt: copy(result.value.receipt) } };
  }());
  const ensureAnswer = () => {
    const request = currentRequest();
    if (!request) return null;
    if (!draft || draft.answer.requestId !== request.requestId) {
      draft = { kind: 'choice', answer: { requestId: request.requestId, optionIds: [], allocation: [] }, history: [] };
    }
    return request;
  };
  // A plan that comes back after the draft it was asked for was dropped (a new revision came in meanwhile) is stale.
  const planFor = selections => {
    const asked = draft;
    return when(port.queryAction({ expectedRevision: revision, actionId: draft.actionId, selections }),
      plan => !plan.ok || draft === asked ? plan : failure('MATCH_UI_PLAN_STALE'));
  };
  const adoptPlan = (plan, selections = draft.selections, history = draft.history) => {
    draft.plan = plan;
    draft.selections = selections;
    draft.history = history;
    const request = plan.selectionRequests[0] ?? null;
    draft.answer = { requestId: request?.requestId ?? '', optionIds: [], allocation: [] };
  };
  // Opens one card's detail. Returns a failure result, or null once it is open (or a Promise of either).
  const openDetail = (read, cardRef) => flow(function* () {
    inspection = null;
    const find = cards => {for (const card of cards ?? []) {if (card.cardRef === cardRef) return card;
      if (!card.faceDown) {const child = find(card.mounted);if (child) return child;}}return null;};
    const card = read.model.seats.flatMap(seat => ['hand','front','back','registry','trash','ban']
      .map(zone => find(seat[zone].cards))).find(Boolean);
    if (!card) return failure('ACTION_NOT_ALLOWED');
    if (card.faceDown) {
      if (card.controllerSeat !== viewerSeat) return failure('ACTION_NOT_ALLOWED');
      const detail = yield port.query({inspectRef:cardRef});
      if (!detail.ok) return detail;
      inspection = detail.value.inspection;
    }
    ui.detailCardRef = cardRef;
    return null;
  }());
  const readPlan = () => when(planFor(draft.selections), plan => {
    if (!plan.ok) return plan;
    adoptPlan(plan.value);
    return plan;
  });
  // Every input but reading, handing events over and leaving goes through here: refused while one is out,
  // and the next waits for a Promise to settle (a remote port that throws reads as a failure, not a crash).
  const guarded = method => function (...args) {
    if (waiting) return failure('MATCH_UI_BUSY');
    const result = method.apply(this, args);
    if (!isThenable(result)) return result;
    waiting = true;
    return Promise.resolve(result).catch(error => {
      // A play whose first plan never came is not a draft.
      if (draft?.kind === 'action' && !draft.plan) draft = null;
      return failure(error?.code ?? 'MATCH_UI_REMOTE_FAILED');
    }).finally(() => { waiting = false; });
  };
  const inputs = methods => Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, guarded(method)]));
  return { ok: true, value: Object.freeze({
    read: refresh,
    ...inputs({
    selectCard(cardRef, inspect = false) {
      const read = refresh();
      if (!read.ok) return read;
      if (inspect) {
        ui.selectedCardRef = cardRef;
        return when(openDetail(read.value, cardRef), opened => opened ?? refresh());
      }
      ui.selectedCardRef = cardRef; draft = null;
      return refresh();
    },
    // Detail only (long press): the selection, the draft and its answer stay as they are.
    showDetail(cardRef) {
      const read = refresh();
      if (!read.ok) return read;
      return when(openDetail(read.value, cardRef), opened => opened ?? refresh());
    },
    closeDetail() { ui.detailCardRef = null; inspection = null; artRef = null; return refresh(); },
    chooseAction(actionId) {
      const read = refresh();
      if (!read.ok) return read;
      const entry = query.legalActions.find(action => action.actionId === actionId);
      if (!entry) return failure('ACTION_NOT_ALLOWED');
      if (entry.kind === 'fixed') return submit(entry.action);
      const asked = { kind: 'action', actionId, sourceRef: entry.base?.cardRef ?? entry.base?.attackerRef ?? null,
        selections: [], history: [], plan: null, answer: null };
      draft = asked;
      return when(readPlan(), planned => {
        if (!planned.ok) { if (draft === asked) draft = null; return planned; }
        // A ready plan is still a draft. One explicit confirm submits once.
        return refresh();
      });
    },
    hitTarget(hit) {
      const read = refresh();
      if (!read.ok) return read;
      const resolved = resolveInteractionTarget(read.value.interactionRequest, hit);
      if (resolved.kind !== 'one') return failure(resolved.kind === 'ambiguous'
        ? 'AMBIGUOUS_INTERACTION_TARGET' : 'INTERACTION_TARGET_NOT_AVAILABLE');
      return this.toggleOption(resolved.optionId);
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
        const group = stageGroupIds(request, optionId);
        if (group) answer.optionIds = answer.optionIds.filter(id => !group.includes(id));
        answer.optionIds.push(optionId);
      }
      return refresh();
    },
    // The bar's toggle for a placement with two ways: a pick of the other way is let go.
    setPlacementMode(mode) {
      const read = refresh();
      if (!read.ok) return read;
      const request = currentRequest();
      if (!request || !placementModes(request) || !PLACEMENT_MODES.includes(mode)) return failure('INVALID_SELECTION');
      placement = { requestId: request.requestId, mode };
      if (draft?.answer?.requestId === request.requestId) {
        const kept = modeOptionIds(request, mode);
        draft.answer.optionIds = draft.answer.optionIds.filter(id => kept.has(id));
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
      const nextSelections = [...draft.selections, copy(draft.answer)];
      const selected = selectedOptions(request).map(option => copy(option));
      const nextHistory = [...draft.history, { requestId: request.requestId,
        presentationKey: request.presentationKey, answer: copy(draft.answer), selectedOptions: selected,
        targets: copy(buildInteractionRequest(request, read.value.model)?.options
          .filter(option => draft.answer.optionIds.includes(option.optionId)).flatMap(option => option.targets) ?? []) }];
      return when(planFor(nextSelections), planned => {
        if (!planned.ok) return planned;
        adoptPlan(planned.value, nextSelections, nextHistory);
        return refresh();
      });
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
      // Inside a staged pick, back steps to the previous group before leaving the request.
      const request = currentRequest();
      if (request && draft?.answer?.requestId === request.requestId && draft.answer.optionIds.length && selectionStage(request, draft.answer)) {
        draft.answer.optionIds = draft.answer.optionIds.slice(0, -1);
        return refresh();
      }
      if (query.requiredInput !== null && draft?.kind !== 'action') { collapsed = true; return refresh(); }
      if (draft?.kind === 'action' && draft.selections.length) {
        const nextSelections = draft.selections.slice(0, -1);
        const nextHistory = draft.history.slice(0, -1);
        return when(planFor(nextSelections), planned => {
          if (!planned.ok) return planned;
          adoptPlan(planned.value, nextSelections, nextHistory);
          return refresh();
        });
      }
      draft = null;
      ui.selectedCardRef = null;
      return refresh();
    },
    switchViewer(seatId) {
      if (!active) return failure('MATCH_UI_DISPOSED');
      const next = session.port(seatId);
      if (!next.ok) return next;
      viewerSeat = seatId;
      port = next.value;
      invalidateProjection(); ui = emptyUi(); draft = null; zoneView = null; inspection = null; uniqueSeat = null; profileSeat = null; artRef = null; resultDismissed = false; logs.clear(); pendingEvents.clear(); eventCursor = null; eventReadError = null;
      return refresh();
    }
    }),
    // Looking around (panels, the log, the hand) asks the port nothing, so it is never held up by a wait.
    openArt(cardRef) { artRef = cardRef; return refresh(); },
    closeArt() { artRef = null; return refresh(); },
    openUnique(seatId) { uniqueSeat = seatId; return refresh(); },
    closeUnique() { uniqueSeat = null; return refresh(); },
    openProfile(seatId) { profileSeat = seatId; return refresh(); },
    closeProfile() { profileSeat = null; return refresh(); },
    dismissResult() { resultDismissed = true; return refresh(); },
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
    ackEvents(eventIds) {
      if (!active || !Array.isArray(eventIds)) return failure('INVALID_EVENT_ACK');
      const pending = [...pendingEvents.values()];
      if (eventIds.length > pending.length || eventIds.some((id, index) => id !== pending[index]?.eventId)) {
        return failure('INVALID_EVENT_ACK');
      }
      for (const id of eventIds) { eventCursor = id; pendingEvents.delete(id); }
      return { ok: true, value: null };
    },
    dispose() { active = false; draft = null; query = null; projection = null; inspection = null; uniqueSeat = null; profileSeat = null; artRef = null; logs.clear(); pendingEvents.clear(); return { ok: true, value: null }; }
  }) };
}
