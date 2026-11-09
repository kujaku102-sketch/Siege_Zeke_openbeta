// Copies a released CPU of SZbattlefield into src/cpu/zig/ without changing a byte, and writes where it came from.
//
//   node scripts/import-cpu.mjs --from <SZbattlefield>/cpus/release/<gen> --line lightZIG
//
// SZbattlefield keeps a released CPU as <gen>/<line>.mjs (the weights and the call that makes the CPU), the folder <gen>/<line>/ (the frozen code it imports) and <gen>/<line>.json
// (what it was learned from, the sha256 of every file read with line endings as LF, the rules it was learned under). The copy goes to src/cpu/zig/<line>.mjs and src/cpu/zig/<line>/,
// and src/cpu/zig/<line>.frozen.json keeps the record. tests/cpu-frozen.test.js reads that record back and fails if a copied file is not what it says.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const option = name => { const at = args.indexOf(`--${name}`); return at < 0 ? null : args[at + 1]; };
const from = option('from'); const line = option('line');
if (!from || !line || !/^[A-Za-z][A-Za-z0-9]*$/.test(line)) { console.error('usage: node scripts/import-cpu.mjs --from <SZbattlefield>/cpus/release/<gen> --line <name>'); process.exit(2); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src/cpu/zig');
const hashLf = file => createHash('sha256').update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
const source = path.resolve(from);
for (const needed of [`${line}.mjs`, `${line}.json`, line]) if (!existsSync(path.join(source, needed))) { console.error(`${path.join(source, needed)}: not found`); process.exit(1); }

const released = JSON.parse(readFileSync(path.join(source, `${line}.json`), 'utf8'));
const files = Object.fromEntries(readdirSync(path.join(source, line)).filter(name => name.endsWith('.mjs')).sort().map(name => [name, hashLf(path.join(source, line, name))]));
// what the release says about itself must be what is on disk
for (const [name, hash] of Object.entries(released.frozenCode?.files ?? {})) if (files[name] !== hash) { console.error(`${line}/${name}: ${files[name]} is not the ${hash} the release says`); process.exit(1); }
const moduleHash = hashLf(path.join(source, `${line}.mjs`));
if (released.module?.sha256 && released.module.sha256 !== moduleHash) { console.error(`${line}.mjs: ${moduleHash} is not the ${released.module.sha256} the release says`); process.exit(1); }

mkdirSync(target, { recursive: true });
rmSync(path.join(target, line), { recursive: true, force: true });
cpSync(path.join(source, `${line}.mjs`), path.join(target, `${line}.mjs`));
cpSync(path.join(source, line), path.join(target, line), { recursive: true });
const record = {
  line, releaseId: released.id, name: released.name, generation: released.generation,
  learnedFor: released.learnedFor, weightsDigest: released.weights?.digest ?? null,
  module: { file: `${line}.mjs`, sha256: moduleHash }, files,
  note: 'sha256 of each file with line endings read as LF. Copied unchanged by scripts/import-cpu.mjs; do not edit these files, import a new release.'
};
writeFileSync(path.join(target, `${line}.frozen.json`), `${JSON.stringify(record, null, 2)}\n`);
console.log(`${line}: ${Object.keys(files).length} files + ${line}.mjs copied from ${source}`);
