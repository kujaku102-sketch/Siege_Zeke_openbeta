import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootArgument = process.argv.indexOf("--root");
const root = path.resolve(rootArgument >= 0 ? process.argv[rootArgument + 1] : path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const rootRealpath = await realpath(root);
const forbiddenDirectories = new Set(["inputs", "outputs", "artifacts", "audit", "tusk"]);
const ignoredGeneratedDirectories = new Set(["node_modules", "dist"]);
// The tool workspace at the repository root (.claude/worktrees holds other checkouts of this
// repository). Only that one root-level directory is skipped; a .claude anywhere else is scanned.
const isToolWorkspace = (directory, name) => directory === root && name === ".claude";
const reachesRestricted = (relative) => relative.split("/").some((segment) => restrictedDirectories.has(segment.toLowerCase())) || relative.split("/")[0].toLowerCase() === ".claude";
const restrictedDirectories = new Set([...forbiddenDirectories, ...ignoredGeneratedDirectories]);
const exactAllowedPackages = new Set(["vite", "three"]);
const filesystemApis = new Set(["read", "readFile", "readFileSync", "readdir", "readdirSync", "open", "openSync", "stat", "statSync", "lstat", "lstatSync", "realpath", "realpathSync", "createReadStream"]);
const dynamicExpressionCounts = new Map();
const issues = [];
const relativeName = (target) => path.relative(root, target).replace(/\\/g, "/");
const isInside = (base, target) => target === base || target.startsWith(`${base}${path.sep}`);
const addIssue = (type, source, detail) => issues.push({ type, source, detail });

async function checkedRealpath(target, source, detail) {
  try {
    const resolved = await realpath(target);
    if (!isInside(rootRealpath, resolved)) addIssue("realpath_outside_root", source, detail);
    return resolved;
  } catch {
    addIssue("missing_target", source, detail);
    return null;
  }
}

async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    const source = relativeName(target);
    const status = await lstat(target);
    if (status.isSymbolicLink()) { addIssue("symlink", source, source); continue; }
    if (status.isDirectory()) {
      if (forbiddenDirectories.has(entry.name.toLowerCase())) addIssue("forbidden_directory", source, source);
      else if (ignoredGeneratedDirectories.has(entry.name.toLowerCase()) || isToolWorkspace(directory, entry.name)) continue;
      else files.push(...await collect(target));
    } else if (status.isFile() && /\.(?:js|mjs)$/i.test(entry.name)) files.push(target);
  }
  return files.sort();
}

async function resolveRelative(sourcePath, specifier) {
  const candidate = path.resolve(path.dirname(sourcePath), specifier);
  if (!isInside(root, candidate)) { addIssue("relative_outside_root", relativeName(sourcePath), specifier); return null; }
  const candidates = path.extname(candidate) ? [candidate] : [candidate, `${candidate}.js`, `${candidate}.mjs`, `${candidate}.json`, path.join(candidate, "index.js"), path.join(candidate, "index.mjs")];
  for (const target of candidates) {
    try { if ((await lstat(target)).isSymbolicLink()) { addIssue("symlink", relativeName(sourcePath), specifier); return null; } } catch { continue; }
    return checkedRealpath(target, relativeName(sourcePath), specifier);
  }
  addIssue("missing_target", relativeName(sourcePath), specifier);
  return null;
}

function inspectSpecifier(sourcePath, specifier) {
  const source = relativeName(sourcePath);
  if (specifier.startsWith("node:")) return;
  if (/^(?:[A-Za-z]:[\\/]|[\\/]|file:)/.test(specifier)) { addIssue("absolute_specifier", source, specifier); return; }
  if (specifier.startsWith(".")) return resolveRelative(sourcePath, specifier).then((target) => {
    if (!target) return;
    const normalized = target.replace(/\\/g, "/");
    if (/(?:^|\/)(?:std-source\.generated|std-supported\.generated)\.js$/i.test(normalized)) addIssue("canonical_private_module", source, specifier);
    if (reachesRestricted(relativeName(target))) addIssue("forbidden_target", source, specifier);
  });
  const packageName = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
  if (!exactAllowedPackages.has(packageName) || packageName !== specifier) addIssue("unallowlisted_package", source, specifier);
}

function lex(body) {
  const tokens = [];
  for (let index = 0; index < body.length;) {
    const char = body[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === "/" && body[index + 1] === "/") { const end = body.indexOf("\n", index + 2); index = end < 0 ? body.length : end + 1; continue; }
    if (char === "/" && body[index + 1] === "*") { const end = body.indexOf("*/", index + 2); index = end < 0 ? body.length : end + 2; continue; }
    if (char === "'" || char === '"') { const quote = char; let value = ""; index += 1; while (index < body.length && body[index] !== quote) { if (body[index] === "\\" && index + 1 < body.length) index += 1; value += body[index]; index += 1; } if (body[index] === quote) index += 1; tokens.push({ type: "string", value }); continue; }
    if (char === "`") {
      index += 1; let plain = true;
      while (index < body.length && body[index] !== "`") {
        if (body[index] === "\\") { index += 2; continue; }
        if (body[index] === "$" && body[index + 1] === "{") {
          plain = false; index += 2; const start = index; let depth = 1;
          while (index < body.length && depth > 0) { if (body[index] === "\\") { index += 2; continue; } if (body[index] === "{") depth += 1; else if (body[index] === "}") depth -= 1; index += 1; }
          tokens.push(...lex(body.slice(start, index - 1))); continue;
        }
        index += 1;
      }
      if (body[index] === "`") index += 1;
      if (plain) tokens.push({ type: "template", value: "" });
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) { let end = index + 1; while (/[A-Za-z0-9_$]/.test(body[end] ?? "")) end += 1; tokens.push({ type: "word", value: body.slice(index, end) }); index = end; continue; }
    tokens.push({ type: "punct", value: char }); index += 1;
  }
  return tokens;
}

function balanced(tokens, open) {
  let depth = 0; const values = [];
  for (let index = open; index < tokens.length; index += 1) { const token = tokens[index]; if (token.value === "(") { depth += 1; if (depth === 1) continue; } if (token.value === ")") { depth -= 1; if (depth === 0) return { values, end: index }; } if (depth >= 1) values.push(token); }
  return { values, end: tokens.length - 1 };
}

async function inspectModuleSyntax(body, sourcePath) {
  const tokens = lex(body); const source = relativeName(sourcePath);
  const aliases = new Set();
  const loaderRanges = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (["const", "let", "var"].includes(tokens[index].value) && tokens[index + 2]?.value === "=" && tokens[index + 3]?.value === "createRequire") aliases.add(tokens[index + 1].value);
    if (tokens[index].value === "function" && tokens[index + 1]?.value === "loadPlaywright") {
      let open = index + 2; while (open < tokens.length && tokens[open].value !== "{") open += 1;
      let depth = 0; let close = open;
      for (; close < tokens.length; close += 1) { if (tokens[close].value === "{") depth += 1; if (tokens[close].value === "}" && --depth === 0) break; }
      loaderRanges.push([open, close]);
    }
  }
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]; const next = tokens[index + 1];
    if (token.value === "import" && next?.type === "string") { await inspectSpecifier(sourcePath, next.value); index += 1; continue; }
    if (token.value === "import" && next?.value === "(") { const result = balanced(tokens, index + 1); if (result.values.length === 1 && result.values[0].type === "string") await inspectSpecifier(sourcePath, result.values[0].value); else { const expression = result.values.map((value) => value.value).join(""); const count = (dynamicExpressionCounts.get(source) ?? 0) + 1; dynamicExpressionCounts.set(source, count); const inLoader = loaderRanges.some(([open, close]) => index > open && index < close); const externalE2eLoaders = new Set(["scripts/e2e-public-build.mjs", "scripts/e2e-tutorial.mjs", "scripts/e2e-layered.mjs", "scripts/e2e-partial-batch-a.mjs", "scripts/e2e-pwa-cache.mjs", "scripts/e2e-release-audit.mjs", "scripts/e2e-user-ability-feedback.mjs"]); if (!(externalE2eLoaders.has(source) && expression === "specifier" && count === 1 && inLoader)) addIssue("dynamic_import_expression", source, expression || "nonliteral"); } index = result.end; continue; }
    if (token.value === "import" || token.value === "export") { for (let cursor = index + 1; cursor < tokens.length && ![";", "import", "export"].includes(tokens[cursor].value); cursor += 1) if (tokens[cursor].value === "from" && tokens[cursor + 1]?.type === "string") { await inspectSpecifier(sourcePath, tokens[cursor + 1].value); index = cursor + 1; break; } }
    if ((token.value === "require" || token.value === "createRequire" || aliases.has(token.value)) && next?.value === "(" && tokens[index + 2]?.type === "string") await inspectSpecifier(sourcePath, tokens[index + 2].value);
    if (filesystemApis.has(token.value) && next?.value === "(" && tokens[index + 2]?.type === "string") { const literal = tokens[index + 2].value; if (/^(?:[A-Za-z]:[\\/]|[\\/]|file:)/.test(literal)) addIssue("filesystem_literal", source, literal); else { const target = await resolveRelative(sourcePath, literal); if (target && reachesRestricted(relativeName(target))) addIssue("forbidden_target", source, literal); } }
    if (token.value === "new" && next?.value === "URL" && tokens[index + 2]?.value === "(" && tokens[index + 3]?.type === "string" && tokens[index + 4]?.value === "," && tokens[index + 5]?.value === "import" && tokens[index + 6]?.value === "." && tokens[index + 7]?.value === "meta" && tokens[index + 8]?.value === "." && tokens[index + 9]?.value === "url") await inspectSpecifier(sourcePath, tokens[index + 3].value);
  }
}

function inspectImportMetaUrls(body, sourcePath) {
  for (const match of body.matchAll(/new URL\(\s*(["'])([^"']+)\1\s*,\s*import\.meta\.url\s*\)/g)) inspectSpecifier(sourcePath, match[2]);
}

function inspectFsLiterals(body, source) {
  for (const match of body.matchAll(/\b(?:readFile|readFileSync|readdir|readdirSync|open|openSync)\(\s*(["'])([^"']+)\1/g)) {
    const literal = match[2];
    if (/^(?:[A-Za-z]:[\\/]|[\\/]|file:)/.test(literal) || literal.split(/[\\/]/).some((part) => restrictedDirectories.has(part.toLowerCase()))) addIssue("filesystem_literal", source, literal);
  }
}

function verifyPackage() {
  const packagePath = path.join(root, "package.json");
  const lockPath = path.join(root, "pnpm-lock.yaml");
  return Promise.all([readFile(packagePath, "utf8"), readFile(lockPath, "utf8")]).then(([packageText, lockText]) => {
    const pkg = JSON.parse(packageText);
    const dependencies = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}), ...(pkg.optionalDependencies ?? {}) };
    const hasThree = Object.hasOwn(dependencies,"three");
    if (Object.keys(dependencies).length !== (hasThree ? 2 : 1) || dependencies.vite !== "^7.1.3" || (hasThree && dependencies.three !== "0.180.0")) addIssue("package_dependencies", "package.json", "exact Vite and optional Three.js dependency contract");
    for (const [name, value] of Object.entries(dependencies)) if (/^(?:file:|link:|workspace:|[A-Za-z]:|[\\/])/.test(String(value))) addIssue("package_local_dependency", "package.json", name);
    for (const name of Object.keys(pkg.scripts ?? {})) if (/^(?:pre|post)?(?:install|prepare|publish|pack)$/i.test(name)) addIssue("lifecycle_script", "package.json", name);
    const importer = lockText.match(/^\s{2}\.:(.*?)(?=^\S|\Z)/ms)?.[1] ?? "";
    const expected = (hasThree ? "dependencies: three: specifier: 0.180.0 version: 0.180.0 " : "") + "devDependencies: vite: specifier: ^7.1.3 version: 7.3.6";
    if (importer.trim().replace(/\s+/g," ") !== expected) addIssue("lockfile_importer_mismatch", "pnpm-lock.yaml", "exact Vite/Three.js importer");
  }).catch(() => addIssue("package_or_lock_missing", "package.json", "package/lock"));
}

const files = await collect(root);
await verifyPackage();
for (const sourcePath of files) {
  const body = await readFile(sourcePath, "utf8");
  const source = relativeName(sourcePath);
  await inspectModuleSyntax(body, sourcePath);
}

if (issues.length) {
  process.stderr.write(`${JSON.stringify({ ok: false, issues }, null, 2)}\n`);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, files: files.length, root: rootRealpath }));
