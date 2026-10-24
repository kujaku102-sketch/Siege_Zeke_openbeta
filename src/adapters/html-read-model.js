const failure = code => ({ ok: false, error: { code } });
const REF = /^r:[0-9a-f]{32}$/;
const nonempty = value => typeof value === 'string' && value.length > 0;

class ReadModelError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const reject = code => { throw new ReadModelError(code); };

function ordinary(value, code) {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) reject(code);
}
function own(value, key, code) {
  ordinary(value, code);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
  return descriptor.value;
}
function exact(value, keys, code) {
  ordinary(value, code);
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) reject(code);
  return Object.fromEntries(keys.map(key => [key, own(value, key, code)]));
}
function dense(value, code) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) reject(code);
  const keys = Reflect.ownKeys(value);
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (!length || !Object.hasOwn(length, 'value') || length.enumerable || length.configurable
    || !Number.isSafeInteger(length.value) || length.value < 0 || keys.length !== length.value + 1) reject(code);
  return Array.from({ length: length.value }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
    return descriptor.value;
  });
}
function copyData(value, code, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) reject(code);
    return value;
  }
  if (typeof value !== 'object' || ancestors.has(value)) reject(code);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return dense(value, code).map(item => copyData(item, code, ancestors));
    ordinary(value, code);
    const result = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') reject(code);
      Object.defineProperty(result, key, {
        value: copyData(own(value, key, code), code, ancestors),
        enumerable: true, writable: true, configurable: true
      });
    }
    return result;
  } finally { ancestors.delete(value); }
}

function localState(input) {
  const source = exact(input, [
    'selectedCardRef', 'detailCardRef', 'menuOpen', 'logOpen', 'handOpen', 'draft'
  ], 'HTML_READ_MODEL_INVALID_UI');
  for (const key of ['selectedCardRef', 'detailCardRef']) {
    if (source[key] !== null && !REF.test(source[key])) reject('HTML_READ_MODEL_INVALID_UI');
  }
  for (const key of ['menuOpen', 'logOpen', 'handOpen']) {
    if (typeof source[key] !== 'boolean') reject('HTML_READ_MODEL_INVALID_UI');
  }
  if (source.draft !== null) {
    const draft = exact(source.draft, ['kind', 'actionId', 'choiceId', 'optionIds', 'allocation'], 'HTML_READ_MODEL_INVALID_UI');
    if (!['action', 'choice'].includes(draft.kind)
      || draft.actionId !== null && !nonempty(draft.actionId)
      || draft.choiceId !== null && !nonempty(draft.choiceId)) reject('HTML_READ_MODEL_INVALID_UI');
    draft.optionIds = dense(draft.optionIds, 'HTML_READ_MODEL_INVALID_UI');
    if (!draft.optionIds.every(nonempty) || new Set(draft.optionIds).size !== draft.optionIds.length) reject('HTML_READ_MODEL_INVALID_UI');
    draft.allocation = dense(draft.allocation, 'HTML_READ_MODEL_INVALID_UI').map(row => {
      const value = exact(row, ['optionId', 'amount'], 'HTML_READ_MODEL_INVALID_UI');
      if (!nonempty(value.optionId) || !Number.isSafeInteger(value.amount) || value.amount <= 0
        || Object.is(value.amount, -0)) reject('HTML_READ_MODEL_INVALID_UI');
      return value;
    });
    source.draft = draft;
  }
  return source;
}

function actionRefs(actions) {
  const byRef = new Map();
  const typeById = new Map();
  const globals = [];
  const add = (cardRef, role, actionId) => {
    if (!REF.test(cardRef)) reject('HTML_READ_MODEL_INVALID_QUERY');
    const record = byRef.get(cardRef) ?? { source: [], target: [], material: [] };
    if (!record[role].includes(actionId)) record[role].push(actionId);
    byRef.set(cardRef, record);
  };
  for (const entry of actions) {
    if (!nonempty(entry?.actionId) || !['fixed', 'template', 'intent'].includes(entry?.kind)) reject('HTML_READ_MODEL_INVALID_QUERY');
    const type = entry.kind === 'fixed' ? entry.action?.type : entry.actionType;
    if (!nonempty(type)) reject('HTML_READ_MODEL_INVALID_QUERY');
    typeById.set(entry.actionId, type);
    let bound = false;
    if (entry.kind === 'fixed') {
      const source = entry.action?.cardRef ?? entry.action?.attackerRef;
      if (source !== undefined) { add(source, 'source', entry.actionId); bound = true; }
      if (entry.action?.target?.kind === 'card') add(entry.action.target.cardRef, 'target', entry.actionId);
    } else {
      const source = entry.base?.cardRef ?? entry.base?.attackerRef;
      if (source !== undefined) { add(source, 'source', entry.actionId); bound = true; }
      for (const option of entry.parameters?.materials?.options ?? []) add(option.cardRef, 'material', entry.actionId);
    }
    if (!bound) globals.push(entry.actionId);
  }
  return { byRef, typeById, globals };
}

function currentDraft(draft, actions, requiredInput) {
  if (draft === null) return null;
  if (draft.kind === 'action') {
    if (draft.choiceId !== null) return null;
    const action = actions.find(entry => entry.actionId === draft.actionId);
    if (!action) return null;
    const allowed = action.kind === 'template' ? [
      ...(action.parameters?.materials?.options ?? []).map(option => option.optionId),
      ...(action.parameters?.destination?.options ?? []).map(option => option.optionId)
    ] : [];
    if (draft.optionIds.some(optionId => !allowed.includes(optionId)) || draft.allocation.length) return null;
    return draft;
  }
  if (draft.actionId !== null || !requiredInput || draft.choiceId !== requiredInput.choiceId) return null;
  const allowed = (requiredInput.options ?? []).map(option => option.optionId);
  if (draft.optionIds.some(optionId => !allowed.includes(optionId))
    || draft.allocation.some(entry => !allowed.includes(entry.optionId))) return null;
  return draft;
}

function decorateCard(card, interactions, ui, visibleRefs) {
  if (!REF.test(card?.cardRef) || typeof card.faceDown !== 'boolean') reject('HTML_READ_MODEL_INVALID_QUERY');
  visibleRefs.add(card.cardRef);
  const relation = interactions.byRef.get(card.cardRef) ?? { source: [], target: [], material: [] };
  const sourceTypes = relation.source.map(actionId => interactions.typeById.get(actionId));
  const badges = card.faceDown ? [] : card.computed?.badges ?? [];
  const contact = badges.some(item => item?.name === 'CONTACT');
  const attackReady = sourceTypes.includes('attack');
  return {
    ...card,
    ...(card.faceDown ? {} : { mounted: card.mounted.map(child => decorateCard(child, interactions, ui, visibleRefs)) }),
    interaction: {
      selected: ui.selectedCardRef === card.cardRef,
      detailed: ui.detailCardRef === card.cardRef,
      sourceActionIds: [...relation.source], targetActionIds: [...relation.target],
      materialActionIds: [...relation.material], attackReady,
      attackStyle: attackReady ? card.status?.summoningSick && contact ? 'contact' : 'normal' : null,
      securityGuard: !card.faceDown && card.status?.sleep === true
        && badges.some(item => item?.name === 'SECURITY'),
      // Front Security Obs carry a hologram shield: faint on standby, solid while asleep (the forced target).
      securityShield: card.faceDown || card.location?.kind !== 'board' || card.location?.zone !== 'front'
        || !badges.some(item => item?.name === 'SECURITY') ? null : card.status?.sleep === true ? 'guard' : 'standby'
    }
  };
}

function buildModel(queryInput, localUiInput) {
  try {
    const query = exact(copyData(queryInput, 'HTML_READ_MODEL_INVALID_QUERY'), [
      'status', 'observation', 'legalActions', 'actionBlocks', 'requiredInput'
    ], 'HTML_READ_MODEL_INVALID_QUERY');
    const ui = localState(copyData(localUiInput, 'HTML_READ_MODEL_INVALID_UI'));
    const status = query.status;
    const observation = query.observation;
    for (const value of [status?.matchId, status?.viewerSeat, observation?.matchId, observation?.viewerSeat]) {
      if (!nonempty(value)) reject('HTML_READ_MODEL_INVALID_QUERY');
    }
    if (status.matchId !== observation.matchId || status.viewerSeat !== observation.viewerSeat
      || status.revision !== observation.revision || status.activeSeat !== observation.activeSeat
      || !Number.isSafeInteger(status.revision) || status.revision < 0 || Object.is(status.revision, -0)
      || !Number.isSafeInteger(observation.turnNumber) || observation.turnNumber < 1) {
      reject('HTML_READ_MODEL_SCOPE_MISMATCH');
    }
    const actions = dense(query.legalActions, 'HTML_READ_MODEL_INVALID_QUERY');
    const interactions = actionRefs(actions);
    ui.draft = currentDraft(ui.draft, actions, query.requiredInput);
    const visibleRefs = new Set();
    const seats = dense(observation.seats, 'HTML_READ_MODEL_INVALID_QUERY').map(seat => {
      const result = { ...seat };
      for (const zone of ['front', 'back', 'registry', 'trash', 'ban']) {
        result[zone] = { ...seat[zone], cards: dense(seat[zone].cards, 'HTML_READ_MODEL_INVALID_QUERY')
          .map(card => decorateCard(card, interactions, ui, visibleRefs)) };
      }
      if (Array.isArray(seat.hand.cards)) result.hand = {
        ...seat.hand, cards: dense(seat.hand.cards, 'HTML_READ_MODEL_INVALID_QUERY')
          .map(card => decorateCard(card, interactions, ui, visibleRefs))
      };
      return result;
    });
    return { ok: true, value: {
      match: {
        matchId: status.matchId, revision: status.revision, viewerSeat: status.viewerSeat,
        activeSeat: status.activeSeat, turnNumber: observation.turnNumber,
        progress: status.progress, finished: status.finished,
        lockedOutcome: copyData(status.lockedOutcome, 'HTML_READ_MODEL_INVALID_QUERY'),
        waitingSeat: status.requiredInput?.seatId ?? null
      },
      seats,
      legalActions: actions,
      actionBlocks: copyData(query.actionBlocks, 'HTML_READ_MODEL_INVALID_QUERY'),
      requiredInput: copyData(query.requiredInput, 'HTML_READ_MODEL_INVALID_QUERY'),
      globalActionIds: [...interactions.globals],
      ui: {
        ...ui,
        selectedCardRef: visibleRefs.has(ui.selectedCardRef) ? ui.selectedCardRef : null,
        detailCardRef: visibleRefs.has(ui.detailCardRef) ? ui.detailCardRef : null
      }
    } };
  } catch (error) {
    if (error instanceof ReadModelError) return failure(error.code);
    throw error;
  }
}

function readOnly(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) readOnly(item);
    Object.freeze(value);
  }
  return value;
}

export function createHtmlReadModelProjection(queryInput) {
  const built = buildModel(queryInput, { selectedCardRef: null, detailCardRef: null,
    menuOpen: false, logOpen: false, handOpen: true, draft: null });
  if (!built.ok) return built;
  const base = readOnly(built.value);
  const paths = new Map();
  const index = (cards, path) => cards.forEach((card, i) => {
    const here = [...path, i];
    paths.set(card.cardRef, here);
    if (!card.faceDown) index(card.mounted, [...here, 'mounted']);
  });
  base.seats.forEach((seat, i) => {
    for (const zone of ['hand', 'front', 'back', 'registry', 'trash', 'ban']) {
      if (Array.isArray(seat[zone].cards)) index(seat[zone].cards, ['seats', i, zone, 'cards']);
    }
  });
  const replace = (value, path, decorate) => {
    if (!path.length) return decorate(value);
    const [key, ...rest] = path;
    const result = Array.isArray(value) ? [...value] : { ...value };
    result[key] = replace(value[key], rest, decorate);
    return result;
  };
  return { ok: true, value: Object.freeze({
    project(localUiInput) {
      try {
        const ui = localState(copyData(localUiInput, 'HTML_READ_MODEL_INVALID_UI'));
        ui.selectedCardRef = paths.has(ui.selectedCardRef) ? ui.selectedCardRef : null;
        ui.detailCardRef = paths.has(ui.detailCardRef) ? ui.detailCardRef : null;
        ui.draft = currentDraft(ui.draft, base.legalActions, base.requiredInput);
        let model = base;
        for (const cardRef of new Set([ui.selectedCardRef, ui.detailCardRef].filter(Boolean))) {
          model = replace(model, paths.get(cardRef), card => ({ ...card, interaction: {
            ...card.interaction, selected: cardRef === ui.selectedCardRef, detailed: cardRef === ui.detailCardRef
          } }));
        }
        return { ok: true, value: readOnly({ ...model, ui }) };
      } catch (error) {
        if (error instanceof ReadModelError) return failure(error.code);
        throw error;
      }
    }
  }) };
}

export function buildHtmlReadModel(queryInput, localUiInput) {
  return buildModel(queryInput, localUiInput);
}
