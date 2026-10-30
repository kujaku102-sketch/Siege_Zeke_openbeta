import { enabledSymbols, supportsNormalScriptActivation } from '../../engine.js';
import { currentReferencedCard } from './card-target.js';
import { MISSING, nonempty, ordinary, own, prepared, reject, safeRevision, selectedArray, selectedField, selectedObject } from './common.js';

export function scriptEligibilityView(card) {
  const code = 'INVALID_AUTHORITY';
  const ancestors = new Set();
  selectedObject(card, code, ancestors);
  try {
    const id = selectedField(card, 'id', code);
    const category = selectedField(card, 'category', code);
    const faceDown = selectedField(card, 'faceDown', code);
    const text = selectedField(card, 'text', code, '');
    if (!nonempty(id) || typeof category !== 'string' || typeof faceDown !== 'boolean'
      || (text !== null && text !== undefined && typeof text !== 'string')) reject(code);

    const rawCompiled = selectedField(card, 'compiled', code, MISSING);
    let compiled;
    if (rawCompiled !== MISSING && rawCompiled !== null && rawCompiled !== undefined) {
      selectedObject(rawCompiled, code, ancestors);
      try {
        compiled = { keywords: selectedArray(selectedField(rawCompiled, 'keywords', code), code, ancestors, item => {
          selectedObject(item, code, ancestors);
          try {
            const name = selectedField(item, 'name', code);
            const rawIntrinsic = selectedField(item, 'intrinsic', code, true);
            const rawValue = selectedField(item, 'value', code, null);
            const intrinsic = rawIntrinsic === null || rawIntrinsic === undefined ? true : rawIntrinsic;
            const value = rawValue === undefined ? null : rawValue;
            if (typeof name !== 'string' || typeof intrinsic !== 'boolean'
              || (value !== null && typeof value !== 'string'
                && (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)))) reject(code);
            return { name, intrinsic, value };
          } finally { ancestors.delete(item); }
        }) };
      } finally { ancestors.delete(rawCompiled); }
    }

    const rawCannotActivateTurn = selectedField(card, 'cannotActivateTurn', code, MISSING);
    const cannotActivateTurn = rawCannotActivateTurn === MISSING || rawCannotActivateTurn === null || rawCannotActivateTurn === undefined
      ? null : rawCannotActivateTurn;
    if (cannotActivateTurn !== null && !safeRevision(cannotActivateTurn)) reject(code);

    const rawDeclaredEffectId = selectedField(card, 'declaredEffectId', code, MISSING);
    let declaredEffectId = null;
    if (rawDeclaredEffectId !== MISSING && rawDeclaredEffectId !== null) {
      if (!nonempty(rawDeclaredEffectId)) reject(code);
      declaredEffectId = rawDeclaredEffectId;
    }

    const numeric = (key) => {
      const value = selectedField(card, key, code, MISSING);
      if (value === MISSING || value === null || value === undefined) return null;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || Object.is(value, -0)) reject(code);
      return value;
    };
    const activationCost = numeric('activationCost');
    const cost = numeric('cost');
    const rawColor = selectedField(card, 'color', code, null);
    if (rawColor !== null && rawColor !== undefined && typeof rawColor !== 'string') reject(code);
    return {
      id, category, faceDown, text: text ?? '', ...(compiled ? { compiled } : {}),
      cannotActivateTurn, declaredEffectId, activationCost, cost, color: rawColor ?? null
    };
  } finally { ancestors.delete(card); }
}

export function activationPlayerView(engineState, playerId, needsSymbols) {
  const code = 'INVALID_AUTHORITY';
  const players = own(engineState, 'players', code);
  ordinary(players, code);
  const player = own(players, playerId, code);
  ordinary(player, code);
  const memory = own(player, 'memory', code);
  if (typeof memory !== 'number' || !Number.isFinite(memory) || memory < 0 || Object.is(memory, -0)) reject(code);
  if (!needsSymbols) return { memory, registry: [] };
  const ancestors = new Set();
  const registry = selectedArray(own(player, 'registry', code), code, ancestors, card => {
    selectedObject(card, code, ancestors);
    try {
      const category = selectedField(card, 'category', code);
      const faceDown = selectedField(card, 'faceDown', code);
      const rawColor = selectedField(card, 'color', code, null);
      if (typeof category !== 'string' || typeof faceDown !== 'boolean'
        || (rawColor !== null && rawColor !== undefined && typeof rawColor !== 'string')) reject(code);
      return { category, faceDown, color: rawColor ?? null };
    } finally { ancestors.delete(card); }
  });
  return { memory, registry };
}

function activateScriptTarget(engineState, referenceInput, cardRef, metadata, actorSeat, playerId, mode) {
  const target = currentReferencedCard(engineState, referenceInput, cardRef, metadata, actorSeat);
  const { entry, card } = target;
  if (entry.location.kind !== 'board' || entry.location.zone !== 'back'
    || entry.location.seatId !== actorSeat || entry.controllerSeat !== actorSeat) reject('ACTION_NOT_ALLOWED');
  const view = scriptEligibilityView(card);
  if (view.category !== 'Script' || !view.faceDown || view.declaredEffectId !== null
    || !supportsNormalScriptActivation(view)) reject('ACTION_NOT_ALLOWED');
  const turnNumber = own(engineState, 'turnNumber', 'INVALID_AUTHORITY');
  if (!safeRevision(turnNumber)) reject('INVALID_AUTHORITY');
  if (view.cannotActivateTurn === turnNumber) reject('ACTION_NOT_ALLOWED');
  const player = activationPlayerView(engineState, playerId, mode !== 'lab' && Boolean(view.color));
  const activationCost = view.activationCost ?? view.cost ?? 0;
  if (player.memory < activationCost) reject('ACTION_NOT_ALLOWED');
  if (mode !== 'lab' && view.color && !enabledSymbols(player).includes(view.color)) reject('ACTION_NOT_ALLOWED');
  return { uid: target.uid };
}

export function prepareActivateScriptAction({ source, engine, metadata, trusted, canonical, playerId, readReferenceState }) {
  const target = activateScriptTarget(source.engineState, readReferenceState(), canonical.value.command.action.cardRef,
    metadata, trusted.actorSeat, playerId, engine.mode);
  return prepared(canonical, { engineFunction: 'activateScript', playerId, uid: target.uid });
}
