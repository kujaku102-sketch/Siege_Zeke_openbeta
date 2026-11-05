// Messages between a browser and an online room (design: サーバー設計-詳細.md §5).
// Pure: no DOM, no Node, no Worker API. The same file is used on both ends of the socket.
export const PROTOCOL_VERSION = 1;

export const LIMITS = Object.freeze({
  maxMessageBytes: 8192,
  maxNameLength: 16,
  ratePerSecond: 20,
  rateBurst: 40,
  helloMs: 5000,
  waitingMs: 15 * 60 * 1000,
  lobbyIdleMs: 10 * 60 * 1000,
  graceMs: 60 * 1000,
  finishedKeepMs: 5 * 60 * 1000,
  maxRoomAgeMs: 6 * 60 * 60 * 1000
});

// WebSocket close codes: 1xxx are the standard ones, 4xxx are ours.
export const CLOSE = Object.freeze({
  rateLimited: 1008, tooLarge: 1009,
  helloTimeout: 4001, helloRequired: 4002, roomFull: 4003, roomClosed: 4004, replaced: 4009
});

export const ERROR_CODES = Object.freeze([
  'BAD_MESSAGE', 'MESSAGE_TOO_LARGE', 'RATE_LIMITED', 'HELLO_REQUIRED', 'ALREADY_HELLO', 'ROOM_FULL',
  'ROOM_NOT_FOUND', 'ROOM_CLOSED', 'WRONG_PHASE', 'NOT_PLAYING', 'DECK_INVALID', 'STORAGE_UNAVAILABLE', 'ENGINE_ERROR'
]);

const COMMAND_ID = /^[\w:.-]{1,64}$/;
const TOKEN = /^[0-9a-f]{32}$/;
const CARD_REF = /^r:[0-9a-f]{32}$/;
const REVISION = value => Number.isSafeInteger(value) && value >= 0;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (max, min = 1) => value => typeof value === 'string' && value.length >= min && value.length <= max;
const optional = check => ({ check, optional: true });
const required = check => ({ check, optional: false });

const deckShape = value => {
  if (!isObject(value)) return false;
  if (value.kind === 'start') return Object.keys(value).length === 2 && text(40)(value.deckId);
  if (value.kind !== 'custom' || Object.keys(value).length !== 2) return false;
  return Array.isArray(value.recipe) && value.recipe.length >= 1 && value.recipe.length <= 100
    && value.recipe.every(row => Array.isArray(row) && row.length === 2 && text(40)(row[0])
      && Number.isSafeInteger(row[1]) && row[1] >= 1 && row[1] <= 99);
};

const selectionsShape = value => Array.isArray(value) && value.length <= 16
  && value.every(answer => isObject(answer) && text(120)(answer.requestId) && Array.isArray(answer.optionIds)
    && answer.optionIds.length <= 64 && answer.optionIds.every(text(80)));

// Every key a client may send, per message type. Anything else is refused.
const CLIENT_SPEC = Object.freeze({
  hello: { token: required(value => TOKEN.test(value)), name: required(text(64, 0)), haveRevision: optional(REVISION) },
  ready: { userId: required(text(40)), deck: required(deckShape) },
  unready: {},
  cmd: { commandId: required(value => COMMAND_ID.test(value)), expectedRevision: required(REVISION),
    action: required(value => isObject(value) && typeof value.type === 'string') },
  plan: { rid: required(value => COMMAND_ID.test(value)), expectedRevision: required(REVISION),
    actionId: required(text(80)), selections: required(selectionsShape) },
  inspect: { rid: required(value => COMMAND_ID.test(value)), ref: required(value => CARD_REF.test(value)) },
  concede: { commandId: required(value => COMMAND_ID.test(value)) },
  resync: { haveRevision: optional(REVISION) },
  bye: {}
});

export const CLIENT_TYPES = Object.freeze(Object.keys(CLIENT_SPEC));

export const SERVER_TYPES = Object.freeze(['welcome', 'lobby', 'start', 'state', 'ack', 'planResult', 'inspectResult',
  'peer', 'end', 'error']);

const failure = (code, detail) => ({ ok: false, error: { code, ...(detail ? { detail } : {}) } });
const utf8Length = value => new TextEncoder().encode(value).length;

// Reads one text frame from a client. The size is checked before the text is parsed.
export function parseClientMessage(raw) {
  if (typeof raw !== 'string') return failure('BAD_MESSAGE', 'text frames only');
  if (raw.length > LIMITS.maxMessageBytes || utf8Length(raw) > LIMITS.maxMessageBytes) return failure('MESSAGE_TOO_LARGE');
  let message;
  try { message = JSON.parse(raw); } catch { return failure('BAD_MESSAGE', 'not JSON'); }
  if (!isObject(message) || message.v !== PROTOCOL_VERSION || typeof message.t !== 'string'
    || !Object.hasOwn(CLIENT_SPEC, message.t)) return failure('BAD_MESSAGE', 'unknown type or version');
  const spec = CLIENT_SPEC[message.t];
  const keys = Object.keys(message).filter(key => key !== 'v' && key !== 't');
  if (keys.some(key => !Object.hasOwn(spec, key))) return failure('BAD_MESSAGE', 'unknown field');
  const value = { t: message.t };
  for (const [key, rule] of Object.entries(spec)) {
    if (!Object.hasOwn(message, key)) {
      if (!rule.optional) return failure('BAD_MESSAGE', `missing ${key}`);
      continue;
    }
    if (!rule.check(message[key])) return failure('BAD_MESSAGE', `bad ${key}`);
    value[key] = message[key];
  }
  return { ok: true, value };
}

export function encodeClientMessage(message) {
  return JSON.stringify({ v: PROTOCOL_VERSION, ...message });
}

export function encodeServerMessage(message) {
  return JSON.stringify({ v: PROTOCOL_VERSION, ...message });
}

// The client's read of a server frame: version and type only; the body is read by the field.
export function parseServerMessage(raw) {
  if (typeof raw !== 'string') return failure('BAD_MESSAGE');
  let message;
  try { message = JSON.parse(raw); } catch { return failure('BAD_MESSAGE'); }
  if (!isObject(message) || message.v !== PROTOCOL_VERSION || !SERVER_TYPES.includes(message.t)) return failure('BAD_MESSAGE');
  return { ok: true, value: message };
}

// A guest name: no control characters, spaces collapsed, at most 16 characters (not UTF-16 units).
export function sanitizeGuestName(input, fallback = 'ゲスト') {
  const cleaned = String(input ?? '').replace(/[\p{C}\p{Z}]+/gu, ' ').trim();
  const name = [...cleaned].slice(0, LIMITS.maxNameLength).join('').trim();
  return name || fallback;
}
