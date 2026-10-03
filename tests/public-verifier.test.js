import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { hasLocalPathPayload, hasPrivateObjectField, hasRawCredential, hasRawLocalPath, normalizeJavaScriptEscapes } from "../scripts/verify-public-build.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const verifier = path.join(root, "scripts", "verify-public-build.mjs");

test("raw local path policy ignores identifier suffixes and rejects public paths", () => {
  for (const body of ["owner:/相手の/.test(owner)", "customer:/相手の/.test(customer)", "変C:/not-a-drive", "const drive = 'C:/Users/owner'", "const backslash = 'C:\\\\Users\\\\owner'", "const escaped = '\\x43:\\\\Users\\\\owner'", "const unicode = '\\u0043:\\\\Users\\\\owner'", "const unc = '\\\\\\\\server\\\\share'", "file:///Users/owner", "/Users/owner/file", "/home/owner/file", "body{background:url(C:/Users/owner/file.png)}"]) assert.equal(hasRawLocalPath(body), !["owner:/相手の/.test(owner)", "customer:/相手の/.test(customer)", "変C:/not-a-drive"].includes(body), body);
});

test("JavaScript escape normalization rejects valid one-pass path encodings", () => {
  for (const body of [String.raw`\u{43}:/temp/file`, String.raw`C\x3a/temp/file`, String.raw`\x43\x3a\x2ftemp/file`, String.raw`\x43\x3a\\Users\\owner`]) assert.equal(hasLocalPathPayload(body, "assets/bundle.js"), true, body);
  assert.equal(hasLocalPathPayload(String.raw`\u{43}:/temp/file`, "assets/site.css"), false);
  assert.equal(hasRawLocalPath(normalizeJavaScriptEscapes(String.raw`\x43\x3a\x2ftemp/file`)), true);
});

test("JavaScript escape normalization preserves invalid and double-escaped source", () => {
  for (const body of [String.raw`\x4G:/temp/file`, String.raw`\u{110000}:/temp/file`, String.raw`\uD800:/temp/file`]) assert.equal(hasLocalPathPayload(body, "assets/bundle.mjs"), false, body);
  assert.equal(hasLocalPathPayload(String.raw`\\u{43}:/temp/file`, "assets/bundle.mjs"), true);
  assert.equal(hasLocalPathPayload("\\\nC:/not-normalized", "assets/bundle.mjs"), true);
  assert.equal(normalizeJavaScriptEscapes(String.raw`\\u{43}`).includes("C"), false);
});

test("raw credential and private-field checks remain raw", () => {
  assert.equal(hasRawCredential("const comment = 'apiKey: secret-value';"), true);
  assert.equal(hasPrivateObjectField("const comment = 'sourceCategory:';"), true);
});

test("verifier CLI preserves JSON success contract", () => {
  const result = spawnSync(process.execPath, [verifier], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(payload.ok, true);
  assert.equal(typeof payload.files, "number");
  assert.equal(typeof payload.cardCount, "number");
});
