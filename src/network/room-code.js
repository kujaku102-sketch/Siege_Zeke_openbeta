// Room codes and token hashes (design: サーバー設計-詳細.md §4.1).
// A code is 6 random characters plus 2 check characters made from a server key, so a guessed
// code can be refused before any room is woken. Uses only WebCrypto (browser, Node 20+, Workers).
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_BODY_LENGTH = 6;
export const ROOM_CODE_LENGTH = 8;

const encoder = new TextEncoder();
const failure = code => ({ ok: false, error: { code } });
const keyCache = new Map();

function subtleOf(subtle) {
  const found = subtle ?? globalThis.crypto?.subtle;
  if (!found) throw new Error('WebCrypto is not available');
  return found;
}

// 32 characters and 256 byte values: the low five bits are an even draw.
export function randomRoomBody(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < ROOM_BODY_LENGTH) throw new Error('need 6 random bytes');
  let body = '';
  for (let index = 0; index < ROOM_BODY_LENGTH; index += 1) body += ROOM_ALPHABET[bytes[index] & 31];
  return body;
}

async function hmacKey(secret, subtle) {
  if (typeof secret !== 'string' || secret.length < 16) throw new Error('the room key is missing or too short');
  const cached = keyCache.get(subtle);
  if (cached?.secret === secret) return cached.key;
  const key = await subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  keyCache.set(subtle, { secret, key });
  return key;
}

// Two characters (10 bits) from HMAC-SHA256(secret, body).
export async function roomCheck(body, secret, subtle) {
  const api = subtleOf(subtle);
  const digest = new Uint8Array(await api.sign('HMAC', await hmacKey(secret, api), encoder.encode(`room:${body}`)));
  const value = ((digest[0] << 8) | digest[1]) >> 6;
  return ROOM_ALPHABET[value >> 5] + ROOM_ALPHABET[value & 31];
}

export async function createRoomCode(body, secret, subtle) {
  return `${body}${await roomCheck(body, secret, subtle)}`;
}

// Upper case, without spaces, hyphens or the zero-width marks a paste can carry.
export function normalizeRoomCode(input) {
  if (typeof input !== 'string' || input.length > 64) return null;
  const code = input.normalize('NFKC').replace(/[\s\-​-‍﻿]/g, '').toUpperCase();
  return code.length === ROOM_CODE_LENGTH && [...code].every(char => ROOM_ALPHABET.includes(char)) ? code : null;
}

export function formatRoomCode(code) {
  return code.length === ROOM_CODE_LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

// {ok:true, body, code} when the shape and the check characters are right; nothing is looked up.
export async function parseRoomCode(input, secret, subtle) {
  const code = normalizeRoomCode(input);
  if (!code) return failure('ROOM_CODE_INVALID');
  const body = code.slice(0, ROOM_BODY_LENGTH);
  const expected = await roomCheck(body, secret, subtle);
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ code.charCodeAt(ROOM_BODY_LENGTH + index);
  return difference === 0 ? { ok: true, body, code } : failure('ROOM_CODE_INVALID');
}

// The server keeps this, never the token itself.
export async function sha256Hex(value, subtle) {
  const digest = new Uint8Array(await subtleOf(subtle).digest('SHA-256', encoder.encode(String(value))));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}
