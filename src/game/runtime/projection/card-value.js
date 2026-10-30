import { CARD_LIBRARY } from '../../../data/cards.js';
import { MISSING, STATE, dense, finite, own, reject, text } from './guards.js';
import { resolvePhysical } from './physical-frame.js';

function definition(id) {
  if (typeof id !== 'string' || !Object.hasOwn(CARD_LIBRARY, id)) reject(STATE);
  const source = CARD_LIBRARY[id];
  const result = { id };
  for (const key of ['name', 'category', 'text']) result[key] = text(own(source, key));
  const printed = own(source, 'printedCategory', true);
  if (printed !== MISSING && printed !== null) result.printedCategory = text(printed);
  else result.printedCategory = result.category;
  const color = own(source, 'color', true);
  result.color = color === MISSING || color === null ? null : text(color);
  for (const key of ['cost', 'atk', 'str']) {
    const value = own(source, key, true);
    result[key] = value === MISSING || value === null ? null : finite(value);
  }
  const classes = own(source, 'classes', true);
  result.classes = classes === MISSING ? [] : dense(classes).map(text);
  return result;
}

export function publicDynamics(dynamicsById, entry) {
  const value = dynamicsById.get(entry.identity.instanceId);
  if (!value) reject(STATE);
  const status = {
    sleep: value.state.sleep, summoningSick: value.state.summoningSick,
    damage: value.state.damage, protect: value.state.protect,
    backup: value.state.backup, load: value.state.load,
    counters: structuredClone(value.state.counters), residentActive: value.state.residentActive
  };
  const badges = value.computed.keywords.filter(item => item.enabled)
    .map(item => ({ name: item.name, value: item.name === 'PROTECT' && status.protect > 0 ? status.protect : null }));
  if (status.backup > 0) badges.push({ name: 'BACKUP', value: status.backup });
  if (status.load > 0) badges.push({ name: 'LOAD', value: status.load });
  return {
    status,
    computed: {
      currentCost: value.computed.executionCost,
      printedCost: value.definition.cost,
      costTrend: Math.sign(value.computed.executionCost - Number(value.definition.cost ?? 0)),
      currentAtk: value.computed.atk,
      maxStr: value.computed.maxStr,
      currentStr: value.computed.currentStr,
      badges, components: structuredClone(value.computed.components)
    }
  };
}

function copyPublicLocation(entry, refForIdentity) {
  const location = entry.location;
  if (location.kind === 'board') return { kind: 'board', seatId: location.seatId, zone: location.zone, position: location.position };
  if (location.kind === 'zone') return { kind: 'zone', seatId: location.seatId, zone: location.zone };
  if (location.kind === 'mounted') {
    const hostRef = refForIdentity(location.host.instanceId);
    return { kind: 'mounted', hostRef, role: location.role };
  }
  reject(STATE);
}

export function cardValue(engineState, referenceState, context, frame, entry, card, refForIdentity, dynamicsById) {
  const cardRef = refForIdentity(entry.identity.instanceId);
  const mounted = [];
  const children = frame.cards.filter(child => child.location.kind === 'mounted'
    && child.location.host.instanceId === entry.identity.instanceId)
    .sort((a, b) => a.location.order - b.location.order);
  const entryMap = new Map(frame.cards.map(item => [item.identity.instanceId, item]));
  for (const child of children) {
    if (child.faceDown) continue;
    const physical = resolvePhysical(engineState, entryMap,
      { identity: child.identity, location: child.location }, frame.seatIds);
    const value = cardValue(engineState, referenceState, context, frame, child, physical, refForIdentity, dynamicsById);
    mounted.push(value);
  }
  const dynamics = publicDynamics(dynamicsById, entry);
  return {
    cardRef, ownerSeat: entry.ownerSeat, controllerSeat: entry.controllerSeat,
    location: copyPublicLocation(entry, refForIdentity), definition: definition(own(card, 'id')),
    faceDown: false, status: dynamics.status, computed: dynamics.computed,
    publicCounters: structuredClone(dynamics.status.counters), mounted
  };
}
