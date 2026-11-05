import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createSqlStore } from './src/sql-store.js';

// A Durable Object's `sql.exec(query, ...bindings)` on top of node:sqlite: the same SQL runs here.
function durableSql() {
  const db = new DatabaseSync(':memory:');
  return { db, exec(query, ...bindings) {
    const statement = db.prepare(query);
    if (/^\s*SELECT/i.test(query)) return statement.all(...bindings)[Symbol.iterator]();
    statement.run(...bindings);
    return [][Symbol.iterator]();
  } };
}

test('values go in and come out as they were, and a put replaces the earlier one', () => {
  const store = createSqlStore(durableSql());
  assert.equal(store.get('room'), undefined);
  store.put('room', { phase: 'waiting', seats: [{ name: 'ゆうき' }], n: 1 });
  assert.deepEqual(store.get('room'), { phase: 'waiting', seats: [{ name: 'ゆうき' }], n: 1 });
  store.put('room', { phase: 'playing' });
  assert.deepEqual(store.get('room'), { phase: 'playing' });
  const big = JSON.stringify({ text: 'ロ"\\\n'.repeat(60000) });
  store.put('authority', big);
  assert.equal(store.get('authority'), big, 'a long string with quotes and Japanese text survives');
  store.delete('room');
  assert.equal(store.get('room'), undefined);
});

test('list gives the values under a prefix in key order, and only those', () => {
  const store = createSqlStore(durableSql());
  for (const revision of [10, 2, 1, 100]) store.put(`cmd:${String(revision).padStart(8, '0')}`, { revision });
  store.put('cmd', { not: 'a command' });
  store.put('cmdx:00000001', { not: 'a command' });
  store.put('room', { not: 'a command' });
  assert.deepEqual(store.list('cmd:').map(row => row.revision), [1, 2, 10, 100]);
  assert.deepEqual(store.list('nothing:'), []);
});

test('deleteAll empties the room, and a second store on the same database sees the same rows', () => {
  const sql = durableSql();
  const first = createSqlStore(sql);
  first.put('room', { a: 1 });
  first.put('cmd:00000001', { b: 2 });
  const second = createSqlStore(sql);
  assert.deepEqual(second.get('room'), { a: 1 }, 'a Durable Object that woke reads what the earlier one wrote');
  first.deleteAll();
  assert.equal(second.get('room'), undefined);
  assert.deepEqual(second.list('cmd:'), []);
});

test('one table, keyed by text, with no separate index to write', () => {
  const sql = durableSql();
  createSqlStore(sql);
  const tables = sql.db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table'").all();
  assert.deepEqual(tables.map(row => row.name), ['kv']);
  assert.match(tables[0].sql, /WITHOUT ROWID/);
  assert.deepEqual(sql.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all(), []);
});
