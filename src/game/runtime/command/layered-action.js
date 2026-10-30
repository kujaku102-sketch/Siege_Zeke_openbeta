import { canPlayLayeredCard } from '../../engine.js';
import { currentReferencedCard } from './card-target.js';
import { finiteNumberField, nonempty, ordinary, own, prepared, reject, safeRevision, selectedArray, selectedField, selectedObject } from './common.js';
import { executionCardView } from './execution-views.js';
import { securityEligibilityView } from './security-view.js';

function layeredCardView(card, controllerId, zone) {
  const code = 'INVALID_AUTHORITY';
  const keywordView = securityEligibilityView(card);
  const executionView = executionCardView(card);
  const ancestors = new Set();
  selectedObject(card, code, ancestors);
  try {
    const uid = selectedField(card, 'uid', code);
    const faceDown = selectedField(card, 'faceDown', code);
    const rawClasses = selectedField(card, 'classes', code, []);
    const classes = selectedArray(rawClasses, code, ancestors, item => {
      if (!nonempty(item)) reject(code);
      return item;
    });
    if (!nonempty(uid) || typeof faceDown !== 'boolean') reject(code);
    const view = { ...keywordView, ...executionView, uid, faceDown, classes };
    if (zone === 'front' || zone === 'back') {
      const slot = selectedField(card, 'boardSlot', code);
      const slotController = selectedField(card, 'boardSlotController', code);
      const slotZone = selectedField(card, 'boardSlotZone', code);
      if (!Number.isSafeInteger(slot) || slot < 1 || Object.is(slot, -0)
        || slotController !== controllerId || slotZone !== zone) reject(code);
      Object.assign(view, { boardSlot: slot, boardSlotController: slotController, boardSlotZone: slotZone });
    }
    return view;
  } finally { ancestors.delete(card); }
}

function layeredPlayerView(engineState, playerId) {
  const code = 'INVALID_AUTHORITY';
  const players = own(engineState, 'players', code);
  ordinary(players, code);
  const player = own(players, playerId, code);
  ordinary(player, code);
  const user = selectedField(player, 'user', code);
  const ancestors = new Set();
  selectedObject(user, code, ancestors);
  let userView;
  try {
    const frontLimit = selectedField(user, 'frontLimit', code);
    const backLimit = selectedField(user, 'backLimit', code);
    const abilityRaw = selectedField(user, 'abilityKey', code, null);
    if (!Number.isSafeInteger(frontLimit) || frontLimit < 0 || Object.is(frontLimit, -0)
      || !Number.isSafeInteger(backLimit) || backLimit < 0 || Object.is(backLimit, -0)
      || (abilityRaw !== null && abilityRaw !== undefined && typeof abilityRaw !== 'string')) reject(code);
    userView = { frontLimit, backLimit, abilityKey: abilityRaw ?? null };
  } finally { ancestors.delete(user); }
  const zoneView = name => selectedArray(selectedField(player, name, code), code, new Set(), card =>
    layeredCardView(card, playerId, name));
  const firstRaw = selectedField(player, 'firstObExecutionTurn', code, null);
  if (firstRaw !== null && firstRaw !== undefined && !safeRevision(firstRaw)) reject(code);
  return {
    memory: finiteNumberField(player, 'memory', code, { minimum: 0 }),
    firstObExecutionTurn: firstRaw ?? null,
    hand: zoneView('hand'), front: zoneView('front'), back: zoneView('back'),
    registry: zoneView('registry'), trash: zoneView('trash'), user: userView
  };
}

export function layeredPlanningView(engineState) {
  const active = own(engineState, 'active', 'INVALID_AUTHORITY');
  const mode = own(engineState, 'mode', 'INVALID_AUTHORITY');
  const turnNumber = own(engineState, 'turnNumber', 'INVALID_AUTHORITY');
  if (!['player', 'ai'].includes(active) || !['ai', 'tutorial', 'lab', 'sandbox'].includes(mode)
    || !safeRevision(turnNumber)) reject('INVALID_AUTHORITY');
  return {
    active, mode, turnNumber,
    players: { player: layeredPlayerView(engineState, 'player'), ai: layeredPlayerView(engineState, 'ai') }
  };
}

function executeLayeredTarget(engineState, referenceInput, action, metadata, actorSeat, playerId) {
  const source = currentReferencedCard(engineState, referenceInput, action.cardRef, metadata, actorSeat);
  if (source.entry.location.kind !== 'zone' || source.entry.location.zone !== 'hand'
    || source.entry.location.seatId !== actorSeat || source.entry.controllerSeat !== actorSeat) reject('ACTION_NOT_ALLOWED');
  const materials = action.materialRefs.map(cardRef =>
    currentReferencedCard(engineState, referenceInput, cardRef, metadata, actorSeat));
  const materialUids = materials.map(material => material.uid);
  if (materialUids.includes(source.uid) || new Set(materialUids).size !== materialUids.length) reject('ACTION_NOT_ALLOWED');
  for (const material of materials) {
    const location = material.entry.location;
    const allowed = location.kind === 'board' && ['front', 'back'].includes(location.zone)
      || location.kind === 'zone' && ['hand', 'registry'].includes(location.zone);
    if (!allowed) reject('ACTION_NOT_ALLOWED');
  }
  const stateView = layeredPlanningView(engineState);
  if (!canPlayLayeredCard(stateView, playerId, source.uid, materialUids,
    action.destination.zone, action.destination.slot).ok) reject('ACTION_NOT_ALLOWED');
  return {
    uid: source.uid, materialUids, zone: action.destination.zone,
    options: { requestedSlot: action.destination.slot }
  };
}

export function prepareExecuteLayeredAction({ source, metadata, trusted, canonical, playerId, readReferenceState }) {
  const target = executeLayeredTarget(source.engineState, readReferenceState(), canonical.value.command.action,
    metadata, trusted.actorSeat, playerId);
  return prepared(canonical, {
    engineFunction: 'playLayeredCard', playerId, uid: target.uid,
    materialUids: target.materialUids, zone: target.zone, options: target.options
  });
}
