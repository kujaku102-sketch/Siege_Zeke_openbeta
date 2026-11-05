// Sets a Worker secret to a new random value without the value ever being shown, typed, saved or kept in a shell history:
//   node put-random-secret.mjs ROOM_CODE_KEY
//   node put-random-secret.mjs AUTH_KEY
// The value (64 hex characters, no trailing newline) goes straight into `wrangler secret put` on its standard input.
// Run it in this folder, after `wrangler login`. WRANGLER names another way to start wrangler, e.g. "node path/to/wrangler.js".
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAMES = ['ROOM_CODE_KEY', 'AUTH_KEY'];
const name = process.argv[2];
if (!NAMES.includes(name)) {
  console.error(`usage: node put-random-secret.mjs ${NAMES.join(' | ')}`);
  console.error('DISCORD_CLIENT_SECRET is not random: put it with `npx wrangler@4 secret put DISCORD_CLIENT_SECRET` and paste it when asked.');
  process.exit(2);
}
const wrangler = process.env.WRANGLER || 'npx wrangler@4';
const result = spawnSync(`${wrangler} secret put ${name}`, {
  cwd: dirname(fileURLToPath(import.meta.url)), shell: true, input: randomBytes(32).toString('hex'), stdio: ['pipe', 'inherit', 'inherit']
});
if (result.status === 0) console.log(`${name} was set to a new random value (not shown).`);
process.exit(result.status ?? 1);
