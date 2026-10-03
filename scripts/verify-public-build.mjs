import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const privateFields = ["sourceName", "sourceCategory", "sourceCost", "sourceAtk", "sourceStr", "sourceColor", "sourceClasses", "sourceText", "sourceSheet", "sourceRow", "sourceSpreadsheetId"];
const strongCredentialKey = "(?:api[_-]?key|secret|password|access[_-]?token|refresh[_-]?token|client[_-]?secret|auth[_-]?token|bearer[_-]?token|oauth[_-]?token|api[_-]?token)";
const credentialPatterns = [
  new RegExp(`(?:^|[,{;\\s])(?:${strongCredentialKey}|["']${strongCredentialKey}["'])\\s*[:=]\\s*["'][^"']+`, "i"),
  new RegExp(`(?:^|[,{;\\s"'])(?:${strongCredentialKey}|["']${strongCredentialKey}["'])\\s*:`, "i"),
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/,
  /(?:^|[,{;\s])(?:authorization|["']authorization["'])\s*[:=]\s*["']?Bearer\s+[A-Za-z0-9._~+\/-]{8,}/i,
  /(?:^|[,{;\s])(?:token|["']token["'])\s*[:=]\s*["'](?=[A-Za-z0-9_-]{40,}["'])(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{40,}["']/i
];
const localPathPatterns = [/(?<![\p{ID_Continue}$])[A-Za-z]:[\\/]/u, /(?<![\p{ID_Continue}$\\])\\(?:x(?:4[1-9A-F]|5[0-9A]|6[1-9A-F]|7[0-9A])|u00(?:4[1-9A-F]|5[0-9A]|6[1-9A-F]|7[0-9A])):[\\/]/iu, /\\{2,}[^\\/:]+[\\/]+[^\\/]+/, /file:\/\//i, /\/(?:home|Users)\/[A-Za-z0-9_.-]+/];
const strictRawPathPatterns = [/\\\\u\{43\}:\/temp\/file/];
const nonCollisionPrivateFields = ["sourceCategory", "sourceCost", "sourceAtk", "sourceStr", "sourceColor", "sourceClasses", "sourceRow", "sourceSpreadsheetId"];
const privateObjectPatterns = nonCollisionPrivateFields.map((field) => new RegExp(`(?:["']${field}["']|\\b${field}\\b)\\s*:`, "i"));
const binaryExtensions = new Set([".avif", ".jpeg", ".jpg", ".png", ".webp", ".woff2", ".otf"]);
// Author-distributed originals, reviewed name tables. Never scan compressed font
// bytes as text: random byte sequences can resemble UNC paths. Only these exact
// immutable files are permitted; modified or additional fonts fail closed.
const approvedFonts = new Map([
  ['.woff2', new Set([
    '57a5725019bcd6f91daf8b69675dc363a679fc89b5f60316a82cc39be8a45664', // Kaisotai Next UP B
    '2ece403772f40ed7f2b856376c55574434c38e4e0cb871cc893742154222c790'  // DotGothic16
  ])],
  ['.otf', new Set(['b58c561cb1fadc3566e4fd7cd09fc61de963c828c9f0ce70c03b5320dda43f6b'])],
]);
export const isApprovedDeckFont = (buffer, extension) => approvedFonts.get(extension)?.has(createHash('sha256').update(buffer).digest('hex')) ?? false;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sortIds = (ids) => [...ids].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
const same = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
const jsonConstant = (body, name) => { const match = body.match(new RegExp(`const ${name} = (\\[[^;]*\\]);`)); return match ? JSON.parse(match[1]) : null; };
const containsPrivate = (value) => Array.isArray(value) ? value.some(containsPrivate) : value && typeof value === "object" ? Object.entries(value).some(([key, child]) => privateFields.includes(key) || containsPrivate(child)) : false;
export function normalizeJavaScriptEscapes(body) {
  let normalized = "";
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== "\\") { normalized += body[index]; continue; }
    const next = body[index + 1];
    if (next === "\\") { normalized += "\\\\"; index += 1; continue; }
    if (next === "x" && /^[0-9a-fA-F]{2}$/.test(body.slice(index + 2, index + 4))) { normalized += String.fromCharCode(Number.parseInt(body.slice(index + 2, index + 4), 16)); index += 3; continue; }
    if (next === "u") {
      const braced = /^\{([0-9a-fA-F]{1,6})\}/.exec(body.slice(index + 2));
      const hex = braced ? braced[1] : /^[0-9a-fA-F]{4}$/.test(body.slice(index + 2, index + 6)) ? body.slice(index + 2, index + 6) : null;
      const codePoint = hex ? Number.parseInt(hex, 16) : null;
      if (codePoint !== null && codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff)) { normalized += String.fromCodePoint(codePoint); index += braced ? braced[0].length + 1 : 5; continue; }
    }
    normalized += "\\";
  }
  return normalized;
}
export const hasRawLocalPath = (body) => localPathPatterns.some((pattern) => pattern.test(body)) || strictRawPathPatterns.some((pattern) => pattern.test(body));
export const hasLocalPathPayload = (body, file) => hasRawLocalPath(body) || /\.(?:m?js)$/i.test(file) && hasRawLocalPath(normalizeJavaScriptEscapes(body));
export const hasRawCredential = (body) => credentialPatterns.some((pattern) => pattern.test(body));
export const hasPrivateObjectField = (body) => privateObjectPatterns.some((pattern) => pattern.test(body));
export function pngMetadataText(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < signature.length || !buffer.subarray(0, signature.length).equals(signature)) return null;
  const chunks = [];
  for (let offset = signature.length; offset + 12 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8; const end = start + length;
    if (end + 4 > buffer.length) throw new Error("invalid PNG chunk boundary");
    const data = buffer.subarray(start, end);
    if (type === "tEXt" || type === "eXIf") chunks.push(data.toString("utf8"));
    if (type === "zTXt") {
      const separator = data.indexOf(0);
      if (separator >= 0 && data[separator + 1] === 0) chunks.push(`${data.subarray(0, separator).toString("latin1")}\n${inflateSync(data.subarray(separator + 2)).toString("utf8")}`);
    }
    if (type === "iTXt") {
      const keywordEnd = data.indexOf(0); const compressionFlag = data[keywordEnd + 1];
      let cursor = keywordEnd + 3;
      for (let field = 0; field < 2; field += 1) { const endField = data.indexOf(0, cursor); cursor = endField < 0 ? data.length : endField + 1; }
      const payload = data.subarray(cursor);
      chunks.push(`${data.subarray(0, keywordEnd).toString("latin1")}\n${compressionFlag === 1 ? inflateSync(payload).toString("utf8") : payload.toString("utf8")}`);
    }
    offset = end + 4;
    if (type === "IEND") break;
  }
  return chunks.join("\n");
}
async function files(directory, prefix = "") { const result = []; for (const entry of await readdir(directory, { withFileTypes: true })) { const relative = path.posix.join(prefix, entry.name); if (entry.isDirectory()) result.push(...await files(path.join(directory, entry.name), relative)); else if (entry.isFile()) result.push(relative); else throw new Error(`unsupported output: ${relative}`); } return result.sort(); }

async function verifyPublicBuild() {
const [{ CARD_LIBRARY }, configBody] = await Promise.all([import("../src/data/cards.js"), readFile(path.join(root, "config", "release.staging.json"), "utf8")]);
const config = JSON.parse(configBody);
const configIds = sortIds(config.publicCardPool.canonicalIds);
const libraryIds = sortIds(Object.keys(CARD_LIBRARY).filter((id) => /^STD-\d{3}$/.test(id)));
assert(config.release.environment === "staging" && config.release.productionApproved === false, "manifest release boundary invalid");
assert(configIds.length === 214 && new Set(configIds).size === 214, "config must contain 214 unique STD IDs");
assert(same(configIds, libraryIds), "config and public card library IDs differ");
assert(!containsPrivate(CARD_LIBRARY), "public card library contains private metadata");

const output = await files(dist);
const policy = config.publicFilePolicy;
const rootFiles = new Set(policy.rootFiles);
const entryFiles = new Set(policy.entryFiles ?? []);
const extensions = new Set(policy.allowedExtensions);
for (const file of output) {
  const segments = file.split("/");
  assert(!segments.some((segment) => policy.forbiddenPathSegments.includes(segment)), `forbidden output path: ${file}`);
  assert(segments.length === 1 ? rootFiles.has(file) : entryFiles.has(file) || segments[0] === policy.assetDirectory, `unexpected public file: ${file}`);
  assert(rootFiles.has(file) || extensions.has(path.extname(file)), `unsupported output extension: ${file}`);
}
for (const required of rootFiles) assert(output.includes(required), `missing public file: ${required}`);
for (const required of entryFiles) assert(output.includes(required), `missing public entry: ${required}`);

const manifest = JSON.parse(await readFile(path.join(dist, "release-manifest.json"), "utf8"));
assert(manifest.release.environment === "staging" && manifest.release.productionApproved === false, "built manifest boundary invalid");
assert(manifest.publicCardPool.cardCount === 214 && same(sortIds(manifest.publicCardPool.canonicalIds), configIds), "manifest and config IDs differ");
assert(/^[a-f0-9]{16}$/.test(manifest.release.buildRevision ?? ""), "built manifest revision is invalid");
const swBody = await readFile(path.join(dist, "sw.js"), "utf8");
const shellUrls = jsonConstant(swBody, "SHELL_URLS");
const cardArtUrls = jsonConstant(swBody, "CARD_ART_URLS");
assert(swBody.includes(`const VERSION = "${manifest.release.buildRevision}"`) && !swBody.includes("__SZ_"), "service worker revision injection is invalid");
assert(Array.isArray(shellUrls) && Array.isArray(cardArtUrls), "service worker allowlists are missing");
assert(shellUrls.length === manifest.pwa?.shellAssetCount && cardArtUrls.length === manifest.pwa?.cardArtAssetCount, "service worker allowlist counts differ from manifest");
assert(shellUrls.includes("/") && shellUrls.includes("/release-manifest.json") && !shellUrls.some((url) => /\/(?:_headers|_redirects)(?:$|\?)/.test(url)), "service worker shell allowlist is invalid");
assert(cardArtUrls.every((url) => /^\/assets\/(?:STD|SZTB)-\d{3}-[^/]+\.(?:avif|jpe?g|png|webp)$/i.test(url)), "service worker card artwork allowlist is invalid");
assert(!shellUrls.some((url) => cardArtUrls.includes(url)), "service worker shell and artwork allowlists overlap");
const pwaManifest = JSON.parse(await readFile(path.join(dist, "manifest.webmanifest"), "utf8"));
for (const icon of pwaManifest.icons ?? []) {
  const url = new URL(icon.src, "https://public.invalid/");
  const iconBuffer = await readFile(path.join(dist, url.pathname.replace(/^\//, "")));
  const expected = Number.parseInt(String(icon.sizes).split("x")[0], 10);
  assert(icon.type === "image/png" && iconBuffer.subarray(1, 4).toString("ascii") === "PNG", `manifest icon is not PNG: ${icon.src}`);
  assert(iconBuffer.readUInt32BE(16) === expected && iconBuffer.readUInt32BE(20) === expected, `manifest icon dimensions differ: ${icon.src}`);
  assert(url.searchParams.get("v") === manifest.release.buildRevision, `manifest icon revision differs: ${icon.src}`);
}

const canonicalValueDigest = "2e1bc2a656dd39b2088a038332b39a20a90bcaa4b95ed6c22fa7104d36bd295e";
for (const file of output) {
  const buffer = await readFile(path.join(dist, file));
  if (file.endsWith('.woff2')) assert(buffer.subarray(0,4).toString('ascii') === 'wOF2', `invalid WOFF2 font: ${file}`);
  if (file.endsWith('.otf')) assert(buffer.subarray(0,4).toString('ascii') === 'OTTO', `invalid OpenType font: ${file}`);
  if (approvedFonts.has(path.extname(file))) {
    assert(isApprovedDeckFont(buffer,path.extname(file)), `unapproved or modified font: ${file}`);
    continue;
  }
  const binary = binaryExtensions.has(path.extname(file).toLowerCase());
  const decoded = buffer.toString(binary ? "latin1" : "utf8");
  const pngMetadata = path.extname(file).toLowerCase() === ".png" ? pngMetadataText(buffer) : null;
  const body = binary ? (pngMetadata ?? (decoded.match(/[\x20-\x7e]{8,}/g) ?? []).join("\n")) : decoded;
  assert(!hasPrivateObjectField(body) && !hasLocalPathPayload(body, file) && !hasRawCredential(body), `forbidden public payload in ${file}`);
  if (!binary) for (const candidate of body.match(/[A-Za-z0-9_-]{20,}/g) ?? []) assert(createHash("sha256").update(candidate).digest("hex") !== canonicalValueDigest, `forbidden public payload in ${file}`);
}
console.log(JSON.stringify({ files: output.length, cardCount: libraryIds.length, ok: true }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyPublicBuild();
