// Copies the match logs the Worker stored in KV (MATCH_LOGS) into logs/match-logs/<day>/<matchId>.json.
// Needs `npx wrangler@4 login` once. Logs already copied are skipped; logs/ is git-ignored.
// Usage: pnpm logs:pull [--out <dir>]
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerDir = path.join(root, "cloudflare", "match-log");
const outArgument = process.argv.indexOf("--out");
const out = path.resolve(outArgument >= 0 ? process.argv[outArgument + 1] : path.join(root, "logs", "match-logs"));
const KEY = /^log\/(\d{4}-\d{2}-\d{2})\/([\w-]{1,80})$/;

// npx is a .cmd on Windows, which Node only runs through a shell, so it gets one command line.
// Every argument is a fixed word or a key that matched KEY, so none needs quoting.
const wrangler = (...args) => execFileSync(["npx", "--yes", "wrangler@4", ...args].join(" "), {
  cwd: workerDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: true, stdio: ["ignore", "pipe", "inherit"]
});

const listed = wrangler("kv", "key", "list", "--binding", "MATCH_LOGS", "--remote", "--prefix", "log/");
const keys = JSON.parse(listed.slice(listed.indexOf("["))).map((entry) => entry.name).filter((name) => KEY.test(name));
let copied = 0;
for (const key of keys) {
  const [, day, matchId] = KEY.exec(key);
  const file = path.join(out, day, `${matchId}.json`);
  if (existsSync(file)) continue;
  const text = wrangler("kv", "key", "get", "--binding", "MATCH_LOGS", "--remote", key);
  const log = JSON.parse(text.slice(text.indexOf("{")));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(log, null, 2)}\n`);
  copied += 1;
}
console.log(JSON.stringify({ stored: keys.length, copied, skipped: keys.length - copied, out }));
