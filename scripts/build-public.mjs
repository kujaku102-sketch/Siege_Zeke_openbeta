import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CARD_LIBRARY } from "../src/data/cards.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const viteCli = path.join(root, "node_modules", "vite", "bin", "vite.js");
const config = JSON.parse(await readFile(path.join(root, "config", "release.staging.json"), "utf8"));
const ids = Object.keys(CARD_LIBRARY).filter((id) => /^STD-\d{3}$/.test(id)).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
if (ids.length !== 214 || new Set(ids).size !== 214) throw new Error("public card library must contain 214 unique STD IDs");
if (config.release.environment !== "staging" || config.release.productionApproved !== false) throw new Error("invalid staging release boundary");
await rm(dist, { recursive: true, force: true });
execFileSync(process.execPath, [viteCli, "build"], { cwd: root, stdio: "inherit" });
await mkdir(dist, { recursive: true });

async function outputFiles(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await outputFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result.sort();
}

const initialFiles = await outputFiles(dist);
const revisionHash = createHash("sha256");
for (const file of initialFiles.filter((file) => file !== "release-manifest.json")) {
  revisionHash.update(`${file}\0`);
  revisionHash.update(await readFile(path.join(dist, file)));
}
const buildRevision = revisionHash.digest("hex").slice(0, 16);
const cardArtFiles = initialFiles.filter((file) => /^assets\/(?:STD|SZTB)-\d{3}-[^/]+\.(?:avif|jpe?g|png|webp)$/i.test(file));
const deploymentControlFiles = new Set(["_headers", "_redirects"]);
const shellFiles = initialFiles.filter((file) => file !== "sw.js" && !deploymentControlFiles.has(file) && !cardArtFiles.includes(file));
const versionedUrl = (file) => `/${file}${/^assets\/(?:app-icon|site-icon|site-share)(?:-|\.)/.test(file) ? `?v=${buildRevision}` : ""}`;
const shellUrls = ["/", "/pc/", "/mobile/", "/release-manifest.json", ...shellFiles.filter((file) => file !== "index.html").map(versionedUrl)];
const cardArtUrls = cardArtFiles.map((file) => `/${file}`);
for (const file of ["index.html", "pc/index.html", "mobile/index.html", "manifest.webmanifest"]) {
  const target = path.join(dist, file);
  await writeFile(target, (await readFile(target, "utf8")).replaceAll("?v=1", `?v=${buildRevision}`), "utf8");
}
const swPath = path.join(dist, "sw.js");
const sw = (await readFile(swPath, "utf8"))
  .replace("__SZ_BUILD_REVISION__", buildRevision)
  .replace("__SZ_SHELL_URLS__", JSON.stringify(shellUrls))
  .replace("__SZ_CARD_ART_URLS__", JSON.stringify(cardArtUrls));
if (/__SZ_[A-Z_]+__/.test(sw)) throw new Error("service worker build placeholders remain");
await writeFile(swPath, sw, "utf8");
await writeFile(path.join(dist, "release-manifest.json"), `${JSON.stringify({ schemaVersion: config.schemaVersion, release: { ...config.release, buildRevision }, publicCardPool: { poolId: config.publicCardPool.poolId, cardCount: ids.length, canonicalIds: ids }, pwa: { shellAssetCount: shellUrls.length, cardArtAssetCount: cardArtUrls.length } }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ environment: "staging", buildRevision, cardCount: ids.length, shellAssets: shellUrls.length, cardArtAssets: cardArtUrls.length, output: "dist", ok: true }));
