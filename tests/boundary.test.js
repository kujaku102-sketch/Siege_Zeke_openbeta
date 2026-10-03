import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanner = path.join(root, "scripts", "verify-source-boundary.mjs");
const node = process.execPath;
const lock = "lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    devDependencies:\n      vite:\n        specifier: ^7.1.3\n        version: 7.3.6\n\npackages:\n";
const packageJson = { name: "fixture", private: true, type: "module", devDependencies: { vite: "^7.1.3" } };

async function fixture(files = {}, packageOverride = packageJson) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sz-boundary-"));
  await writeFile(path.join(directory, "package.json"), JSON.stringify(packageOverride));
  await writeFile(path.join(directory, "pnpm-lock.yaml"), lock);
  for (const [name, body] of Object.entries(files)) { const target = path.join(directory, name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, body); }
  return directory;
}
function scan(directory) { return spawnSync(node, [scanner, "--root", directory], { encoding: "utf8" }); }
async function rejects(name, files, expected, packageOverride) {
  const directory = await fixture(files, packageOverride);
  try { const result = scan(directory); assert.notEqual(result.status, 0, name); assert.match(result.stderr, new RegExp(`"type": "${expected}"`)); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("boundary scanner accepts lexical static module forms and ignores comments strings and templates", async () => {
  const directory = await fixture({
    "src/main.js": "import'./one.js';import{x}from'./two.js';export{y}from'./three.js';export*from'./four.js';const ignored=\"import './missing.js'\";const template=`export * from './also-missing.js'`;/* import './comment.js' */",
    "src/one.js": "", "src/two.js": "export const x=1", "src/three.js": "export const y=1", "src/four.js": ""
  });
  try { const result = scan(directory); assert.equal(result.status, 0, result.stderr); } finally { await rm(directory, { recursive: true, force: true }); }
});

test("boundary scanner rejects representative module and filesystem escapes", async () => {
  await rejects("missing static import", { "src/main.js": "import'./missing.js'" }, "missing_target");
  await rejects("expression dynamic import", { "src/main.js": "import(variable)" }, "dynamic_import_expression");
  await rejects("require", { "src/main.js": "require('./missing.js')" }, "missing_target");
  await rejects("filesystem missing literal", { "src/main.js": "readFile('./missing.txt')" }, "missing_target");
  const windowsFixturePath = ["C:", "fixed", "dummy.txt"].join("\\\\");
  assert.match(windowsFixturePath, /^[A-Z]:\\\\/);
  await rejects("filesystem absolute literal", { "src/main.js": `readFile('${windowsFixturePath}')` }, "filesystem_literal");
  await rejects("outside relative literal", { "src/main.js": "readFile('../../outside.txt')" }, "relative_outside_root");
  await rejects("forbidden directory", { "inputs/file.js": "" }, "forbidden_directory");
  await rejects("generated relative import", { "src/main.js": "import'../node_modules/blocked.js'", "node_modules/blocked.js": "" }, "forbidden_target");
});

test("boundary scanner ignores generated roots during traversal", async () => {
  const directory = await fixture({ "src/main.js": "", "node_modules/private.js": "import'../../outside.js'", "dist/bundle.js": "import'../../outside.js'" });
  try { const result = scan(directory); assert.equal(result.status, 0, result.stderr); } finally { await rm(directory, { recursive: true, force: true }); }
});

test("boundary scanner enforces package contract and exact E2E exception", async () => {
  await rejects("extra dependency", { "src/main.js": "" }, "package_dependencies", { ...packageJson, dependencies: { extra: "1.0.0" } });
  await rejects("top level E2E dynamic import", { "scripts/e2e-public-build.mjs": "async function loadPlaywright(){}; import(specifier);" }, "dynamic_import_expression");
  await rejects("other function E2E dynamic import", { "scripts/e2e-public-build.mjs": "async function loadPlaywright(){} async function elsewhere(){import(specifier)}" }, "dynamic_import_expression");
  await rejects("second E2E dynamic import", { "scripts/e2e-public-build.mjs": "async function loadPlaywright(){}; import(specifier); import(specifier);" }, "dynamic_import_expression");
});

test("boundary scanner handles template interpolation, aliases, URLs, and all filesystem API spellings", async () => {
  const allowed = await fixture({ "src/main.js": "const plain=`import('./missing.js')`; export{value}from'./value.js'", "src/value.js": "export const value=1" });
  try { const result = scan(allowed); assert.equal(result.status, 0, result.stderr); } finally { await rm(allowed, { recursive: true, force: true }); }
  await rejects("template interpolation", { "src/main.js": "const blocked=`x${import(variable)}`" }, "dynamic_import_expression");
  await rejects("createRequire alias", { "src/main.js": "const loader=createRequire('node:module');loader('./missing.js')" }, "missing_target");
  await rejects("new URL literal", { "src/main.js": "new URL('./missing.js', /* comment */ import.meta.url)" }, "missing_target");
  for (const api of ["read", "readFile", "readdir", "open", "stat", "lstat", "realpath", "createReadStream"]) await rejects(`filesystem ${api}`, { "src/main.js": `${api}('./missing.txt')` }, "missing_target");
});

test("boundary scanner rejects symlinks when the platform permits fixture creation", async (context) => {
  const directory = await fixture({ "src/main.js": "" });
  try { await symlink(path.join(directory, "src", "main.js"), path.join(directory, "src", "linked.js")); } catch { context.skip("symlink creation is unavailable"); await rm(directory, { recursive: true, force: true }); return; }
  try { const result = scan(directory); assert.notEqual(result.status, 0); assert.match(result.stderr, /"type": "symlink"/); } finally { await rm(directory, { recursive: true, force: true }); }
});
