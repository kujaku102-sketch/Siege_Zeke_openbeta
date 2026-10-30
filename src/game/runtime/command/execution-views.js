import { MISSING, finiteNumberField, nonempty, ordinary, own, reject, safeRevision, selectedArray, selectedField, selectedObject } from './common.js';

export function executionCardView(card) {
  const code = 'INVALID_AUTHORITY';
  const ancestors = new Set();
  selectedObject(card, code, ancestors);
  try {
    const id = selectedField(card, 'id', code);
    const name = selectedField(card, 'name', code);
    const category = selectedField(card, 'category', code);
    const printedCategoryRaw = selectedField(card, 'printedCategory', code, null);
    const textRaw = selectedField(card, 'text', code, '');
    const colorRaw = selectedField(card, 'color', code, null);
    const dragFreeRaw = selectedField(card, 'dragFree', code, false);
    if (!nonempty(id) || typeof name !== 'string' || typeof category !== 'string'
      || (printedCategoryRaw !== null && printedCategoryRaw !== undefined && typeof printedCategoryRaw !== 'string')
      || (textRaw !== null && textRaw !== undefined && typeof textRaw !== 'string')
      || (colorRaw !== null && colorRaw !== undefined && typeof colorRaw !== 'string')
      || (dragFreeRaw !== null && dragFreeRaw !== undefined && typeof dragFreeRaw !== 'boolean')) reject(code);
    const view = {
      id, name, category, printedCategory: printedCategoryRaw ?? null, text: textRaw ?? '', color: colorRaw ?? null,
      cost: finiteNumberField(card, 'cost', code, { minimum: 0 }),
      turnCostModifier: finiteNumberField(card, 'turnCostModifier', code),
      costReductionThisTurn: finiteNumberField(card, 'costReductionThisTurn', code, { minimum: 0 }),
      dragFree: dragFreeRaw ?? false
    };
    const revealed = selectedField(card, 'revealedExecutionCost', code, MISSING);
    if (revealed !== MISSING && revealed !== null && revealed !== undefined) {
      if (revealed !== 1) reject(code);
      view.revealedExecutionCost = 1;
    }
    const setupCost = selectedField(card, 'setupCost', code, MISSING);
    if (setupCost !== MISSING && setupCost !== null && setupCost !== undefined) {
      if (typeof setupCost !== 'number' || !Number.isFinite(setupCost) || setupCost < 0 || Object.is(setupCost, -0)) reject(code);
      view.setupCost = setupCost;
    }
    return view;
  } finally { ancestors.delete(card); }
}

function executionProviderView(card, controllerId, zone) {
  const code = 'INVALID_AUTHORITY';
  const ancestors = new Set();
  selectedObject(card, code, ancestors);
  try {
    const id = selectedField(card, 'id', code);
    const name = selectedField(card, 'name', code);
    const category = selectedField(card, 'category', code);
    const printedCategoryRaw = selectedField(card, 'printedCategory', code, null);
    const faceDown = selectedField(card, 'faceDown', code);
    const colorRaw = selectedField(card, 'color', code, null);
    const rawClasses = selectedField(card, 'classes', code, []);
    const classes = selectedArray(rawClasses, code, ancestors, item => {
      if (typeof item !== 'string' || item.length === 0) reject(code);
      return item;
    });
    if (!nonempty(id) || typeof name !== 'string' || typeof category !== 'string' || typeof faceDown !== 'boolean'
      || (printedCategoryRaw !== null && printedCategoryRaw !== undefined && typeof printedCategoryRaw !== 'string')
      || (colorRaw !== null && colorRaw !== undefined && typeof colorRaw !== 'string')) reject(code);
    const view = { id, name, category, printedCategory: printedCategoryRaw ?? null, faceDown, color: colorRaw ?? null, classes };
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

function executionPlayerView(engineState, playerId) {
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

  const zone = (name) => selectedArray(selectedField(player, name, code), code, new Set(), card =>
    executionProviderView(card, playerId, name));
  const firstRaw = selectedField(player, 'firstObExecutionTurn', code, null);
  if (firstRaw !== null && firstRaw !== undefined && !safeRevision(firstRaw)) reject(code);
  return {
    memory: finiteNumberField(player, 'memory', code, { minimum: 0 }),
    firstObExecutionTurn: firstRaw ?? null,
    front: zone('front'), back: zone('back'), registry: zone('registry'), trash: zone('trash'), user: userView
  };
}

export function executionPlanningView(engineState) {
  const active = own(engineState, 'active', 'INVALID_AUTHORITY');
  const mode = own(engineState, 'mode', 'INVALID_AUTHORITY');
  const turnNumber = own(engineState, 'turnNumber', 'INVALID_AUTHORITY');
  if (!['player', 'ai'].includes(active) || !['ai', 'tutorial', 'lab', 'sandbox'].includes(mode)
    || !safeRevision(turnNumber)) reject('INVALID_AUTHORITY');
  return {
    active, mode, turnNumber,
    players: {
      player: executionPlayerView(engineState, 'player'),
      ai: executionPlayerView(engineState, 'ai')
    }
  };
}
