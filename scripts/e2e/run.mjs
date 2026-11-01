// Runs e2e checks one after another:  node scripts/e2e/run.mjs <screen | flow | ship | screen/end | flow/tutorial-full ...> [url] [--playwright-module <path>] [--keyboard]
// The page is the one at <url> (default http://127.0.0.1:4173/, `pnpm preview` of the built site); the browser is headless, 1920x1080 by default.
//   screen/  one screen, loaded as a decided board (end, notice, aspect: aspect only when a screen's size or layout changes)
//   flow/    a short path through the product (entry, battle-start, tutorial-start, tutorial-full, end-buttons, deck-keyboard)
//   ship/    the build as shipped (boundary, layout, pwa); release:gate runs these with the flows
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [what, ...rest] = process.argv.slice(2);
if (!what || what.startsWith("--")) { console.error("usage: node scripts/e2e/run.mjs <screen|flow|ship|group/name> [url] [--playwright-module <path>] [--keyboard]"); process.exit(2); }
const [group, name] = what.split("/");
const files = name ? [`${group}/${name}.mjs`] : readdirSync(path.join(here, group)).filter((file) => file.endsWith(".mjs")).map((file) => `${group}/${file}`);
let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, [path.join(here, file), ...rest], { stdio: "inherit" });
  if (result.status !== 0) { failed += 1; console.error(`FAILED ${file}`); }
}
process.exit(failed ? 1 : 0);
