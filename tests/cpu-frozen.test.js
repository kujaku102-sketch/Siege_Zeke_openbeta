import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { RULE_VERSION } from '../src/game/runtime/versions.js';
import { catalogEntry, cpuAvailable, listCpus } from '../src/cpu/catalog.js';

// The learned CPUs are frozen copies of SZbattlefield's releases (scripts/import-cpu.mjs): not a byte may differ, and the rules they were learned under are named.
const zig = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/cpu/zig');
const hashLf = file => createHash('sha256').update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
const lines = readdirSync(zig).filter(name => name.endsWith('.frozen.json')).map(name => name.replace(/\.frozen\.json$/, ''));

test('every learned CPU of the catalog has a frozen record, and every record has a catalog entry', () => {
  const learned = listCpus().filter(entry => entry.learned).map(entry => entry.id).sort();
  assert.deepEqual(lines.slice().sort(), learned);
});

for (const line of lines) {
  const record = JSON.parse(readFileSync(path.join(zig, `${line}.frozen.json`), 'utf8'));

  test(`${line}: the copied files are what the release said (sha256, line endings as LF)`, () => {
    assert.equal(hashLf(path.join(zig, record.module.file)), record.module.sha256);
    const onDisk = readdirSync(path.join(zig, line)).filter(name => name.endsWith('.mjs')).sort();
    assert.deepEqual(onDisk, Object.keys(record.files).sort(), 'no file added to or missing from the frozen folder');
    for (const [name, hash] of Object.entries(record.files)) assert.equal(hashLf(path.join(zig, line, name)), hash, `${line}/${name}`);
  });

  test(`${line}: the catalog names the rules the record says it was learned under`, () => {
    const entry = catalogEntry(line);
    assert.equal(entry.learnedFor.ruleVersion, record.learnedFor.ruleVersion);
    assert.equal(entry.learnedFor.cardVersion, record.learnedFor.cardVersion);
    assert.equal(entry.generation, record.generation);
  });

  test(`${line}: offered only when it was learned under the game's rule version`, () => {
    const entry = catalogEntry(line);
    assert.equal(cpuAvailable(entry), entry.learnedFor.ruleVersion === RULE_VERSION);
    assert.equal(listCpus().find(item => item.id === line).available, cpuAvailable(entry));
    assert.equal(cpuAvailable(entry, { allowStale: true }), true);
  });
}

test('the simple CPU is always offered, and is the default', async () => {
  const { DEFAULT_CPU_ID } = await import('../src/cpu/index.js');
  assert.equal(DEFAULT_CPU_ID, 'simple');
  assert.equal(listCpus().find(entry => entry.id === 'simple').available, true);
  assert.equal(Object.isFrozen(listCpus()), true);
});
