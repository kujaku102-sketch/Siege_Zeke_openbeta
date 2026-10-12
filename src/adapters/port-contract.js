import { canonicalizeCommand } from '../game/runtime/command-record.js';

const BINDING_KEYS = ['contractVersion', 'matchId', 'seatId', 'seatIds', 'sessionGeneration'];
const INTENT_KEYS = ['commandId', 'expectedRevision', 'action'];
const STATUS_KEYS = [
  'contractVersion', 'matchId', 'revision', 'viewerSeat', 'activeSeat', 'progress',
  'lockedOutcome', 'finished', 'requiredInput', 'seats'
];
const PROGRESS = new Set(['ready', 'awaitingInput', 'resultLocked', 'finished']);

class PortContractError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const reject = code => { throw new PortContractError(code); };
const nonempty = value => typeof value === 'string' && value.length > 0;
const counter = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);

function ordinary(value, code) {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) reject(code);
}

function own(value, key, code) {
  ordinary(value, code);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
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
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
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
        value: copyData(own(value, key, code), code, ancestors), enumerable: true, writable: true, configurable: true
      });
    }
    return result;
  } finally { ancestors.delete(value); }
}

function seatList(value, code) {
  const seats = dense(value, code);
  if (seats.length !== 2 || !seats.every(nonempty) || seats[0] === seats[1]) reject(code);
  return [...seats];
}

function bindingData(input) {
  const value = exact(input, BINDING_KEYS, 'INVALID_PORT_BINDING');
  if (value.contractVersion !== 1 || !nonempty(value.matchId) || !nonempty(value.seatId)
    || !Number.isSafeInteger(value.sessionGeneration) || value.sessionGeneration < 1
    || Object.is(value.sessionGeneration, -0)) reject('INVALID_PORT_BINDING');
  value.seatIds = seatList(value.seatIds, 'INVALID_PORT_BINDING');
  if (!value.seatIds.includes(value.seatId)) reject('INVALID_PORT_BINDING');
  return value;
}

function statusOutcome(input, seats) {
  if (input === null) return null;
  ordinary(input, 'INVALID_STATUS_VIEW');
  const kind = own(input, 'kind', 'INVALID_STATUS_VIEW');
  if (kind === 'draw') return exact(input, ['kind'], 'INVALID_STATUS_VIEW');
  if (kind === 'win') {
    const value = exact(input, ['kind', 'winnerSeat'], 'INVALID_STATUS_VIEW');
    if (!seats.includes(value.winnerSeat)) reject('INVALID_STATUS_VIEW');
    return value;
  }
  reject('INVALID_STATUS_VIEW');
}

function waitingInput(input, seats) {
  if (input === null) return null;
  const value = exact(input, ['kind', 'seatId'], 'INVALID_STATUS_VIEW');
  if (value.kind !== 'waiting' || !seats.includes(value.seatId)) reject('INVALID_STATUS_VIEW');
  return value;
}

function seatStatus(input, expectedSeat) {
  const value = exact(input, ['seatId', 'deckCount', 'handCount'], 'INVALID_STATUS_VIEW');
  if (value.seatId !== expectedSeat || !counter(value.deckCount) || !counter(value.handCount)) reject('INVALID_STATUS_VIEW');
  return value;
}

function envelope(action) {
  try { return { ok: true, value: action() }; }
  catch (error) {
    if (error instanceof PortContractError) return { ok: false, error: { code: error.code } };
    throw error;
  }
}

export function validatePortBinding(input) {
  return envelope(() => ({ ...bindingData(input), seatIds: [...input.seatIds] }));
}

export function makeBoundCommand(bindingInput, intentInput) {
  return envelope(() => {
    const binding = bindingData(bindingInput);
    const intent = exact(intentInput, INTENT_KEYS, 'INVALID_ADAPTER_INTENT');
    if (!nonempty(intent.commandId) || !counter(intent.expectedRevision)) reject('INVALID_ADAPTER_INTENT');
    const action = copyData(intent.action, 'INVALID_ADAPTER_INTENT');
    const command = {
      contractVersion: 1, matchId: binding.matchId, commandId: intent.commandId,
      actorSeat: binding.seatId, expectedRevision: intent.expectedRevision, action
    };
    const canonical = canonicalizeCommand(command);
    if (!canonical.ok) {
      if (canonical.error.code === 'ACTION_SCHEMA_UNAVAILABLE') reject('ACTION_SCHEMA_UNAVAILABLE');
      reject('INVALID_ADAPTER_INTENT');
    }
    return canonical.value.command;
  });
}

export function validateStatusView(bindingInput, statusInput) {
  return envelope(() => {
    const binding = bindingData(bindingInput);
    const value = exact(statusInput, STATUS_KEYS, 'INVALID_STATUS_VIEW');
    if (value.contractVersion !== 1 || !nonempty(value.matchId) || !counter(value.revision)
      || !nonempty(value.viewerSeat) || !nonempty(value.activeSeat) || !PROGRESS.has(value.progress)
      || typeof value.finished !== 'boolean') reject('INVALID_STATUS_VIEW');
    if (value.matchId !== binding.matchId || value.viewerSeat !== binding.seatId) reject('PORT_SCOPE_MISMATCH');
    if (!binding.seatIds.includes(value.activeSeat)) reject('INVALID_STATUS_VIEW');
    const outcome = statusOutcome(value.lockedOutcome, binding.seatIds);
    const requiredInput = waitingInput(value.requiredInput, binding.seatIds);
    const rows = dense(value.seats, 'INVALID_STATUS_VIEW');
    if (rows.length !== binding.seatIds.length) reject('INVALID_STATUS_VIEW');
    const seats = rows.map((row, index) => seatStatus(row, binding.seatIds[index]));
    const valid = value.progress === 'ready' ? outcome === null && !value.finished && requiredInput === null
      : value.progress === 'awaitingInput' ? outcome === null && !value.finished && requiredInput !== null
        : value.progress === 'resultLocked' ? outcome !== null && !value.finished
          : outcome !== null && value.finished && requiredInput === null;
    if (!valid) reject('INVALID_STATUS_VIEW');
    return {
      contractVersion: 1, matchId: value.matchId, revision: value.revision, viewerSeat: value.viewerSeat,
      activeSeat: value.activeSeat, progress: value.progress, lockedOutcome: outcome, finished: value.finished,
      requiredInput, seats
    };
  });
}
