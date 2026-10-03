import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const playwrightFlag = args.indexOf("--playwright-module");
const playwrightModule = playwrightFlag >= 0 ? args[playwrightFlag + 1] : process.env.SIMPLE_ZEKE_PLAYWRIGHT_MODULE;
if (!playwrightModule || !existsSync(playwrightModule)) throw new Error("provide an existing --playwright-module path or SIMPLE_ZEKE_PLAYWRIGHT_MODULE");

const port = Number(process.env.SIMPLE_ZEKE_GATE_PORT ?? 4199);
const baseUrl = `http://127.0.0.1:${port}/`;
const evidenceRoot = path.join(root, "docs", "ui-upgrade", "evidence", "UI-008");
const releaseRoot = path.join(root, "release");
const viteCli = path.join(root, "node_modules", "vite", "bin", "vite.js");
mkdirSync(evidenceRoot, { recursive: true });
mkdirSync(releaseRoot, { recursive: true });

const report = { generatedAt: new Date().toISOString(), status: "running", buildVerified: false, publicApproved: false, deployed: false, steps: [], changeInventory: [] };
let preview = null;

function runStep(name, command, commandArgs) {
  const started = Date.now();
  const result = spawnSync(command, commandArgs, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  writeFileSync(path.join(evidenceRoot, `${name}.log`), output, "utf8");
  const step = { name, exitCode: result.status, durationMs: Date.now() - started, ok: result.status === 0 };
  report.steps.push(step);
  console.log(JSON.stringify(step));
  if (!step.ok) throw new Error(`${name} failed; see docs/ui-upgrade/evidence/UI-008/${name}.log`);
}

async function waitForPreview() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl, { cache: "no-store" });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("release-gate preview did not become ready");
}

function files(directory, prefix = "") {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...files(path.join(directory, entry.name), relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result.sort();
}

function packageDist(revision) {
  const archivePath = path.join(releaseRoot, `siege-zeke-simple-public-${revision}.zip`);
  rmSync(archivePath, { force: true });
  const packed = spawnSync("tar.exe", ["-a", "-cf", archivePath, "-C", path.join(root, "dist"), "."], { cwd: root, encoding: "utf8", windowsHide: true });
  if (packed.status !== 0) throw new Error(`ZIP creation failed: ${packed.stderr ?? packed.stdout}`);
  const listing = spawnSync("tar.exe", ["-tf", archivePath], { cwd: root, encoding: "utf8", windowsHide: true });
  if (listing.status !== 0) throw new Error(`ZIP listing failed: ${listing.stderr ?? listing.stdout}`);
  const archiveFiles = listing.stdout.split(/\r?\n/).map((item) => item.replace(/^\.\//, "")).filter((item) => item && !item.endsWith("/")).sort();
  const distFiles = files(path.join(root, "dist"));
  if (archiveFiles.some((item) => item.startsWith("dist/") || item.includes("..")) || JSON.stringify(archiveFiles) !== JSON.stringify(distFiles)) {
    throw new Error("ZIP contents differ from dist or are not stored at ZIP root");
  }
  return {
    path: path.relative(root, archivePath).replaceAll("\\", "/"),
    sha256: createHash("sha256").update(readFileSync(archivePath)).digest("hex"),
    files: archiveFiles.length
  };
}

try {
  runStep("01-source-boundary", process.execPath, ["scripts/verify-source-boundary.mjs"]);
  runStep("02-node-tests", process.execPath, ["--test", "tests/engine.test.js", "tests/deployment.test.js", "tests/boundary.test.js", "tests/ui-render.test.js"]);
  runStep("03-build-staging", process.execPath, ["scripts/build-public.mjs"]);
  runStep("04-public-verifier", process.execPath, ["scripts/verify-public-build.mjs"]);

  preview = spawn(process.execPath, [viteCli, "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: "ignore", windowsHide: true });
  await waitForPreview();
  const browserArgs = [baseUrl, "--playwright-module", playwrightModule];
  runStep("05-public-e2e", process.execPath, ["scripts/e2e-public-build.mjs", ...browserArgs]);
  runStep("06-victory-e2e", process.execPath, ["scripts/e2e-public-build.mjs", "--victory", ...browserArgs]);
  runStep("07-tutorial-e2e", process.execPath, ["scripts/e2e-tutorial.mjs", ...browserArgs]);
  runStep("08-keyboard-tutorial-e2e", process.execPath, ["scripts/e2e-tutorial.mjs", "--keyboard", ...browserArgs]);
  runStep("09-pwa-e2e", process.execPath, ["scripts/e2e-pwa-cache.mjs", ...browserArgs]);
  runStep("10-release-audit-e2e", process.execPath, ["scripts/e2e-release-audit.mjs", ...browserArgs]);
  runStep("11-diff-check", "git", ["diff", "--check"]);

  const manifest = JSON.parse(readFileSync(path.join(root, "dist", "release-manifest.json"), "utf8"));
  const changes = spawnSync("git", ["status", "--porcelain=v1"], { cwd: root, encoding: "utf8", windowsHide: true });
  if (changes.status !== 0) throw new Error("git change inventory failed");
  report.changeInventory = changes.stdout.split(/\r?\n/).filter(Boolean);
  report.revision = manifest.release.buildRevision;
  report.cardCount = manifest.publicCardPool.cardCount;
  report.archive = packageDist(report.revision);
  report.status = "build-verified";
  report.buildVerified = true;
  report.publicApprovalNote = "Manual human approval remains required immediately before Cloudflare Production upload.";
} catch (error) {
  report.status = "failed";
  report.error = String(error?.message ?? error);
  process.exitCode = 1;
} finally {
  if (preview && !preview.killed) preview.kill();
  writeFileSync(path.join(evidenceRoot, "release-gate-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: report.status, revision: report.revision, archive: report.archive, steps: report.steps.length, error: report.error }));
}
