const nonempty = value => typeof value === 'string' && value.length > 0;
const positive = value => Number.isSafeInteger(value) && value > 0;
const success = value => ({ ok: true, value });
const failure = code => ({ ok: false, error: { code } });

function fields(value, names) {
  if (value === null || typeof value !== 'object') return null;
  const keys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getPrototypeOf(value) !== Object.prototype || keys.length !== names.length) return null;
  const result = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !names.includes(key)) return null;
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
  }
  return result;
}

function dense(value) {
  if (value === null || typeof value !== 'object') return null;
  const keys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getPrototypeOf(value) !== Array.prototype) return null;
  const length = descriptors.length;
  if (!length || !Object.hasOwn(length, 'value') || length.enumerable || length.configurable || !Number.isInteger(length.value) || length.value < 0 || keys.length !== length.value + 1) return null;
  const result = [];
  for (let i = 0; i < length.value; i += 1) {
    const descriptor = descriptors[String(i)];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    result.push(descriptor.value);
  }
  return result;
}

function serial(value) {
  if (typeof value !== 'string' || !value.startsWith('i:')) return null;
  const number = Number(value.slice(2));
  return positive(number) && value === `i:${number}` ? number : null;
}

function reference(value) {
  const ref = fields(value, ['matchId', 'instanceId']);
  return ref && nonempty(ref.matchId) && serial(ref.instanceId) !== null ? ref : null;
}

function seats(value) {
  const values = dense(value);
  return values && values.length === 2 && values.every(nonempty) && values[0] !== values[1] ? values : null;
}

function ledger(value) {
  const state = fields(value, ['matchId', 'seatIds', 'nextSerial', 'retiredIds']);
  if (!state || !nonempty(state.matchId) || !positive(state.nextSerial)) return null;
  const seatIds = seats(state.seatIds);
  const retiredIds = dense(state.retiredIds);
  if (!seatIds || !retiredIds) return null;
  let previous = 0;
  for (const id of retiredIds) {
    const number = serial(id);
    if (number === null || number <= previous || number >= state.nextSerial) return null;
    previous = number;
  }
  return { matchId: state.matchId, seatIds, nextSerial: state.nextSerial, retiredIds };
}

function copyReference(ref) {
  return { matchId: ref.matchId, instanceId: ref.instanceId };
}

function copyRecord(record) {
  const location = record.location.kind === 'mounted'
    ? { kind: 'mounted', host: copyReference(record.location.host), order: record.location.order, role: record.location.role }
    : { ...record.location };
  return { identity: copyReference(record.identity), ownerSeat: record.ownerSeat, controllerSeat: record.controllerSeat, location };
}

function recordsShape(value) {
  const rows = dense(value);
  if (!rows) return failure('INVALID_LOCATION');
  const records = [];
  for (const raw of rows) {
    const record = fields(raw, ['identity', 'ownerSeat', 'controllerSeat', 'location']);
    if (!record || !nonempty(record.ownerSeat) || !nonempty(record.controllerSeat)) return failure('INVALID_LOCATION');
    const loc = rawLocation(record.location);
    if (!loc) return failure('INVALID_LOCATION');
    const identity = reference(record.identity);
    if (!identity) return failure('INVALID_IDENTITY_REF');
    let location = loc;
    if (loc.kind === 'mounted') {
      const host = reference(loc.host);
      if (!host) return failure('INVALID_IDENTITY_REF');
      location = { ...loc, host };
    }
    records.push({ ...record, identity, location });
  }
  return success(records);
}

function rawLocation(value) {
  if (value === null || typeof value !== 'object') return null;
  const keys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getPrototypeOf(value) !== Object.prototype || keys.some(key => typeof key !== 'string')) return null;
  const kind = descriptors.kind;
  if (!kind || !kind.enumerable || !Object.hasOwn(kind, 'value')) return null;
  const layouts = {
    zone: ['kind', 'seatId', 'zone'], board: ['kind', 'seatId', 'zone', 'position'],
    mounted: ['kind', 'host', 'order', 'role'], inflight: ['kind', 'storageKey'],
  };
  if (typeof kind.value !== 'string' || !Object.hasOwn(layouts, kind.value)) return null;
  const loc = fields(value, layouts[kind.value]);
  if (!loc) return null;
  if (loc.kind === 'zone') return nonempty(loc.seatId) && ['deck', 'hand', 'registry', 'trash', 'ban'].includes(loc.zone) ? loc : null;
  if (loc.kind === 'board') return nonempty(loc.seatId) && ['front', 'back'].includes(loc.zone) && positive(loc.position) ? loc : null;
  if (loc.kind === 'mounted') return positive(loc.order) && ['mount', 'layered'].includes(loc.role) ? loc : null;
  return nonempty(loc.storageKey) ? loc : null;
}

function occupy(root, tuple) {
  let map = root;
  for (let i = 0; i < tuple.length - 1; i += 1) {
    if (!map.has(tuple[i])) map.set(tuple[i], new Map());
    map = map.get(tuple[i]);
  }
  const key = tuple[tuple.length - 1];
  if (map.has(key)) return false;
  map.set(key, true);
  return true;
}

function structure(matchId, records, state, ordered) {
  const byId = new Map();
  const retired = state ? new Set(state.retiredIds) : null;
  let previous = 0;
  for (const record of records) {
    const { identity, location, ownerSeat, controllerSeat } = record;
    if (identity.matchId !== matchId || (location.kind === 'mounted' && location.host.matchId !== matchId)) return 'MATCH_MISMATCH';
    if (state && (!state.seatIds.includes(ownerSeat) || !state.seatIds.includes(controllerSeat) || (['zone', 'board'].includes(location.kind) && !state.seatIds.includes(location.seatId)))) return 'SEAT_MISMATCH';
    const number = serial(identity.instanceId);
    if (state && number >= state.nextSerial) return 'UNKNOWN_INSTANCE';
    if (retired && retired.has(identity.instanceId)) return 'RETIRED_INSTANCE';
    if (byId.has(identity.instanceId)) return 'DUPLICATE_INSTANCE';
    if (ordered && number <= previous) return 'INVALID_LOCATION';
    previous = number;
    byId.set(identity.instanceId, record);
    if (location.kind === 'board' && location.seatId !== controllerSeat) return 'INVALID_LOCATION';
  }
  const board = new Map();
  const mounted = new Map();
  const inflight = new Map();
  for (const { location } of records) {
    if (location.kind === 'board' && !occupy(board, [location.seatId, location.zone, location.position])) return 'DUPLICATE_LOCATION';
    if (location.kind === 'mounted' && !occupy(mounted, [location.host.instanceId, location.order])) return 'DUPLICATE_LOCATION';
    if (location.kind === 'inflight' && !occupy(inflight, [location.storageKey])) return 'DUPLICATE_LOCATION';
  }
  for (const { location } of records) {
    if (location.kind === 'mounted' && !byId.has(location.host.instanceId)) return 'MISSING_HOST';
  }
  const done = new Set();
  for (const record of records) {
    let current = record;
    const path = new Set();
    while (!done.has(current.identity.instanceId)) {
      const id = current.identity.instanceId;
      if (path.has(id)) return 'MOUNT_CYCLE';
      path.add(id);
      if (current.location.kind !== 'mounted') break;
      const host = byId.get(current.location.host.instanceId);
      if (host.controllerSeat !== current.controllerSeat) return 'INVALID_LOCATION';
      current = host;
    }
    for (const id of path) done.add(id);
  }
  if (state && records.length !== state.nextSerial - 1 - state.retiredIds.length) return 'INVALID_LOCATION';
  return null;
}

export function createIdentityState(args) {
  const data = fields(args, ['matchId', 'seatIds']);
  const seatIds = data && seats(data.seatIds);
  if (!data || !nonempty(data.matchId) || !seatIds) return failure('INVALID_IDENTITY_STATE');
  return success({ matchId: data.matchId, seatIds, nextSerial: 1, retiredIds: [] });
}

export function allocateInstanceId(input) {
  const state = ledger(input);
  if (!state) return failure('INVALID_IDENTITY_STATE');
  if (state.nextSerial === Number.MAX_SAFE_INTEGER) return failure('IDENTITY_EXHAUSTED');
  const identity = { matchId: state.matchId, instanceId: `i:${state.nextSerial}` };
  return success({ state: { ...state, nextSerial: state.nextSerial + 1 }, identity });
}

export function retireInstanceId(input, identity) {
  const state = ledger(input);
  if (!state) return failure('INVALID_IDENTITY_STATE');
  const ref = reference(identity);
  if (!ref) return failure('INVALID_IDENTITY_REF');
  if (ref.matchId !== state.matchId) return failure('MATCH_MISMATCH');
  const number = serial(ref.instanceId);
  if (number >= state.nextSerial) return failure('UNKNOWN_INSTANCE');
  if (!state.retiredIds.includes(ref.instanceId)) {
    const position = state.retiredIds.findIndex(id => serial(id) > number);
    state.retiredIds.splice(position < 0 ? state.retiredIds.length : position, 0, ref.instanceId);
  }
  return success(state);
}

export function buildIdentityIndex(input, values) {
  const state = ledger(input);
  if (!state) return failure('INVALID_IDENTITY_STATE');
  const shaped = recordsShape(values);
  if (!shaped.ok) return shaped;
  const error = structure(state.matchId, shaped.value, state, false);
  if (error) return failure(error);
  const entries = shaped.value.map(copyRecord).sort((a, b) => serial(a.identity.instanceId) - serial(b.identity.instanceId));
  return success({ matchId: state.matchId, entries });
}

export function findIdentityEntry(input, identity) {
  const index = fields(input, ['matchId', 'entries']);
  if (!index || !nonempty(index.matchId)) return failure('INVALID_LOCATION');
  const shaped = recordsShape(index.entries);
  if (!shaped.ok) return shaped;
  const error = structure(index.matchId, shaped.value, null, true);
  if (error) return failure(error);
  const ref = reference(identity);
  if (!ref) return failure('INVALID_IDENTITY_REF');
  if (ref.matchId !== index.matchId) return failure('MATCH_MISMATCH');
  const record = shaped.value.find(entry => entry.identity.instanceId === ref.instanceId);
  return success(record ? copyRecord(record) : null);
}
