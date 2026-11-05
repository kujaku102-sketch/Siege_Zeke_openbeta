import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomCode, formatRoomCode, normalizeRoomCode, parseRoomCode, randomRoomBody, ROOM_ALPHABET, roomCheck, sha256Hex } from '../src/network/room-code.js';

const KEY = 'test-room-key-0123456789abcdef';

test('a room code is six random characters plus two check characters, all from the 32-character alphabet', async () => {
  assert.equal(ROOM_ALPHABET.length, 32);
  assert.equal(new Set(ROOM_ALPHABET).size, 32);
  assert.ok(![...'IO01'].some(char => ROOM_ALPHABET.includes(char)), 'look-alike characters are left out');
  assert.equal(randomRoomBody(Uint8Array.from([0, 1, 31, 32, 255, 64])), 'AB9A9A');
  assert.throws(() => randomRoomBody(new Uint8Array(3)));
  const body = randomRoomBody(crypto.getRandomValues(new Uint8Array(6)));
  const code = await createRoomCode(body, KEY);
  assert.equal(code.length, 8);
  assert.ok([...code].every(char => ROOM_ALPHABET.includes(char)));
  assert.equal(code, await createRoomCode(body, KEY), 'the same body and key give the same code');
});

test('a typed or pasted code is read back, and a wrong one is refused without any lookup', async () => {
  const code = await createRoomCode('K7M2QX', KEY);
  assert.equal(formatRoomCode(code), `${code.slice(0, 4)}-${code.slice(4)}`);
  for (const typed of [code, code.toLowerCase(), formatRoomCode(code), ` ${formatRoomCode(code).toLowerCase()} `, `${code.slice(0, 4)}​-${code.slice(4)}`]) {
    const parsed = await parseRoomCode(typed, KEY);
    assert.deepEqual(parsed, { ok: true, body: 'K7M2QX', code }, JSON.stringify(typed));
  }
  const wrongCheck = code.slice(0, 6) + (code[6] === 'A' ? 'B' : 'A') + code[7];
  assert.equal((await parseRoomCode(wrongCheck, KEY)).error.code, 'ROOM_CODE_INVALID');
  assert.equal((await parseRoomCode(code, `${KEY}-other`)).error.code, 'ROOM_CODE_INVALID', 'another key does not verify');
  for (const bad of ['', 'SHORT', code + 'A', 'ABCDEF0O', 'ABCD-EFGH-IJ', null, 12345678]) {
    assert.equal((await parseRoomCode(bad, KEY)).error.code, 'ROOM_CODE_INVALID', String(bad));
  }
  assert.equal(normalizeRoomCode('ＫＭ２７－ＱＸ９Ｄ'), 'KM27QX9D', 'full-width input is folded');
});

test('only about one random string in a thousand passes the check', async () => {
  let passed = 0;
  const tries = 8192;
  for (let index = 0; index < tries; index += 1) {
    const body = randomRoomBody(crypto.getRandomValues(new Uint8Array(6)));
    const guess = body + ROOM_ALPHABET[Math.floor(Math.random() * 32)] + ROOM_ALPHABET[Math.floor(Math.random() * 32)];
    if ((await parseRoomCode(guess, KEY)).ok) passed += 1;
  }
  assert.ok(passed >= 1 && passed < tries / 128, `${passed} of ${tries} passed`);
  assert.equal(await roomCheck('AAAAAA', KEY), await roomCheck('AAAAAA', KEY));
});

test('the room key must be present and long enough', async () => {
  await assert.rejects(() => createRoomCode('AAAAAA', ''));
  await assert.rejects(() => createRoomCode('AAAAAA', 'short'));
  await assert.rejects(() => createRoomCode('AAAAAA', undefined));
});

test('a token hash is SHA-256 in hex', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
