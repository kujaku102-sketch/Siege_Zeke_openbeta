import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { clickEntryControl } from "./e2e-entry-crt.mjs";

const args = process.argv.slice(2);
const playwrightFlag = args.indexOf("--playwright-module");
const explicitPlaywrightModule = playwrightFlag >= 0 ? args[playwrightFlag + 1] : process.env.SIMPLE_ZEKE_PLAYWRIGHT_MODULE;
const url = args.find((argument, index) => argument !== "--playwright-module" && index !== playwrightFlag + 1) ?? "http://127.0.0.1:4173/";
const evidenceRoot = path.resolve("docs", "ui-upgrade", "evidence", "USERFX-IMPL03");

async function loadPlaywright() {
  if (!explicitPlaywrightModule) throw new Error("provide --playwright-module or SIMPLE_ZEKE_PLAYWRIGHT_MODULE for the external browser runner");
  const specifier = explicitPlaywrightModule.startsWith("file:") ? explicitPlaywrightModule : pathToFileURL(path.resolve(explicitPlaywrightModule)).href;
  if (!specifier.startsWith("file:") || !existsSync(new URL(specifier))) throw new Error("explicit Playwright module path is unavailable");
  return import(specifier);
}

async function captureTurbo(page, base, label) {
  await page.goto(base.toString(), { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.removeItem("sz-ui-effects"));
  await page.reload({ waitUntil: "networkidle" });
  if (await page.locator('.r2-content[data-effects="off"]').count() !== 1) throw new Error(`${label}: absent preference must default effects to OFF`);
  await page.evaluate(() => localStorage.setItem("sz-ui-effects", "on"));
  await page.reload({ waitUntil: "networkidle" });
  if (await page.locator('.r2-content[data-effects="on"]').count() !== 1) throw new Error(`${label}: explicit ON preference is unavailable`);
  await clickEntryControl(page, '[data-mode="sandbox"]');
  await page.locator(".r2-board").waitFor({ state: "visible" });
  const handCost = page.locator(".r2-hand .cost").first();
  if (!await handCost.count()) throw new Error(`${label}: own hand cost is unavailable`);
  const publicLimit = page.locator('[data-vfx-anchor="memory-limit"][data-owner="player"]').first();
  if (!await publicLimit.count()) throw new Error(`${label}: pre-activation public maximum memory is unavailable`);
  const publicLimitNumbers = (await publicLimit.textContent() ?? "").match(/\d+/g);
  const originalMax = Number(publicLimitNumbers?.at(-1));
  if (!Number.isFinite(originalMax)) throw new Error(`${label}: pre-activation public maximum memory is not numeric`);
  await page.locator('[data-live="unique-effect"]').click();
  await page.locator('[data-action="turbo"]').click();
  await page.locator(".vfx-event-user-ability.vfx-ability-turbo").waitFor({ state: "visible" });
  const effect = page.locator(".vfx-event-user-ability.vfx-ability-turbo").last();
  const effectLabel = await effect.textContent();
  if (!(effectLabel ?? "").includes(`TURBO BOOST / YOU / MEM ${originalMax}→${originalMax + 2}`)) throw new Error(`${label}: Turbo result or target is not rendered from the public pre-activation maximum`);
  if (/STD-|uid|card/i.test(effectLabel ?? "")) throw new Error(`${label}: ability feedback leaks card-private data`);
  const limit = page.locator('[data-fortress="player"] .memory-limit-turbo');
  if (!await limit.count()) throw new Error(`${label}: Turbo maximum memory projection is unavailable`);
  if (await page.locator(".r2-target-dock [data-action]").count()) throw new Error(`${label}: confirmed Turbo must not leave a target selection pending`);
  await page.screenshot({ path: path.join(evidenceRoot, `${label}-turbo.png`), fullPage: true });
  await page.locator('[data-action="end-turn"]').click();
  await page.waitForFunction(() => /OPPONENT/.test(document.querySelector(".r2-console")?.textContent ?? ""));
  return {
    handCost: await handCost.getAttribute("aria-label"),
    turboLimit: await limit.getAttribute("aria-label"),
    feedback: effectLabel,
    turnAdvanced: true
  };
}

async function assertReducedMotion(base) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(base.toString(), { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.setItem("sz-ui-effects", "on"));
  await page.reload({ waitUntil: "networkidle" });
  await clickEntryControl(page, '[data-mode="sandbox"]');
  await page.locator(".r2-board").waitFor({ state: "visible" });
  await page.locator('[data-live="unique-effect"]').click();
  await page.locator('[data-action="turbo"]').click();
  const limit = page.locator('[data-fortress="player"] .memory-limit-turbo');
  if (!await limit.count()) throw new Error("reduced-motion: confirmed result state is unavailable");
  const duration = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.className = "vfx-ability-feedback vfx-ability-turbo";
    document.body.append(probe);
    const value = getComputedStyle(probe).animationDuration;
    probe.remove();
    return value;
  });
  const durationMatch = /^((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(ms|s)$/.exec(duration);
  const durationMs = durationMatch && Number(durationMatch[1]) * (durationMatch[2] === "s" ? 1000 : 1);
  if (!Number.isFinite(durationMs) || Math.abs(durationMs - 0.01) > 1e-9) {
    throw new Error(`reduced-motion: expected minimal animation duration of 0.01ms, got ${duration}`);
  }
  await page.close();
}

const normalizeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const recordKey = (record) => JSON.stringify([
  record.sourceEventId, record.abilityKey, record.branch, record.ownerPlayerId,
  record.affectedPlayerId, record.targetPlayerId, record.target, record.cardUid,
  String(record.stepIndex), record.role, normalizeText(record.text)
]);

function assertExactRecordMultiset(actual, expected) {
  const actualCounts = new Map();
  const expectedCounts = new Map();
  for (const record of actual) actualCounts.set(recordKey(record), (actualCounts.get(recordKey(record)) ?? 0) + 1);
  for (const record of expected) expectedCounts.set(recordKey(record), (expectedCounts.get(recordKey(record)) ?? 0) + 1);
  const missing = [...expectedCounts].flatMap(([key, count]) => Array.from({ length: count - (actualCounts.get(key) ?? 0) }, () => key));
  const extra = [...actualCounts].flatMap(([key, count]) => Array.from({ length: count - (expectedCounts.get(key) ?? 0) }, () => key));
  if (missing.length || extra.length) throw new Error(`presentation matrix overlay multiset mismatch: missing=${JSON.stringify(missing)}, extra=${JSON.stringify(extra)}`);
}

const matrixCases = [
  { abilityKey: "turbo", ownerPlayerId: "player", affectedPlayerId: "player", branch: "activated", before: 5, after: 7, amount: 2, steps: [{ kind: "value_change", target: { kind: "player_stat", playerId: "player", metric: "memory_limit" }, before: 5, after: 7 }] },
  { abilityKey: "mono_color", ownerPlayerId: "player", affectedPlayerId: "player", branch: "enabled", amount: 1, steps: [{ kind: "state_change", target: { kind: "status", playerId: "player", status: "mono_color" }, before: false, after: true }] },
  { abilityKey: "registry_liberty", ownerPlayerId: "player", affectedPlayerId: "player", branch: "first-install", amount: 1, steps: [{ kind: "transfer", from: { kind: "zone_count", playerId: "player", zone: "deck" }, to: { kind: "zone_count", playerId: "player", zone: "hand" }, count: 1 }, { kind: "state_change", target: { kind: "status", playerId: "player", status: "extra_install" }, before: false, after: true }] },
  { abilityKey: "recovery_boot", ownerPlayerId: "player", affectedPlayerId: "player", branch: "recovered", before: 0, after: 1, steps: [{ kind: "value_change", target: { kind: "player_stat", playerId: "player", metric: "str" }, before: 0, after: 1 }] },
  { abilityKey: "dimension_innovation", ownerPlayerId: "player", affectedPlayerId: "player", branch: "damage-replaced", before: 2, after: 2, strBefore: 1, strAfter: 1, steps: [{ kind: "transfer", from: { kind: "zone_count", playerId: "player", zone: "deck" }, to: { kind: "zone_count", playerId: "player", zone: "ban" }, count: 2 }] },
  { abilityKey: "do_or_isnt", ownerPlayerId: "player", affectedPlayerId: "player", branch: "first-ob-discount", amount: 0, anchorCardUid: "userfx-public-ob", steps: [{ kind: "measurement", target: { kind: "card_stat", playerId: "player", metric: "effective_cost", cardUid: "userfx-public-ob" }, before: 0, after: 0 }] },
  { abilityKey: "do_or_isnt", ownerPlayerId: "player", affectedPlayerId: "player", branch: "exact-three-recovery", strBefore: 10, strAfter: 11, memoryBefore: 2, memoryAfter: 3, steps: [{ kind: "value_change", target: { kind: "player_stat", playerId: "player", metric: "str" }, before: 10, after: 11 }, { kind: "value_change", target: { kind: "player_stat", playerId: "player", metric: "memory" }, before: 2, after: 3 }] },
  { abilityKey: "do_or_isnt", ownerPlayerId: "player", affectedPlayerId: "ai", branch: "five-plus-damage-down", before: 3, after: 2, anchorCardUid: "userfx-public-ob", steps: [{ kind: "value_change", target: { kind: "player_stat", playerId: "ai", metric: "damage" }, before: 3, after: 2 }] },
  { abilityKey: "trash_never_empty", ownerPlayerId: "ai", affectedPlayerId: "player", branch: "milled-same-symbol", amount: 2, steps: [{ kind: "transfer", from: { kind: "zone_count", playerId: "player", zone: "deck" }, to: { kind: "zone_count", playerId: "player", zone: "trash" }, count: 2 }] },
  { abilityKey: "trash_never_empty", ownerPlayerId: "ai", affectedPlayerId: "player", branch: "salvaged", amount: 1, steps: [{ kind: "transfer", from: { kind: "zone_count", playerId: "player", zone: "trash" }, to: { kind: "zone_count", playerId: "player", zone: "hand" }, count: 1 }] },
  { abilityKey: "trash_never_empty", ownerPlayerId: "ai", affectedPlayerId: "player", branch: "milled-different-symbol", amount: 1, steps: [{ kind: "transfer", from: { kind: "zone_count", playerId: "player", zone: "deck" }, to: { kind: "zone_count", playerId: "player", zone: "hand" }, count: 1 }] },
  { abilityKey: "kickass", ownerPlayerId: "player", affectedPlayerId: "player", branch: "damage-doubled", before: 1, after: 2, steps: [{ kind: "multiply", target: { kind: "player_stat", playerId: "player", metric: "damage" }, before: 1, factor: 2, after: 2 }] },
  { abilityKey: "watching_you", ownerPlayerId: "player", affectedPlayerId: "player", branch: "mulligan", amount: 1, steps: [{ kind: "transfer", from: { kind: "zone_count", playerId: "player", zone: "hand" }, to: { kind: "zone_count", playerId: "player", zone: "deck" }, count: 5 }, { kind: "transfer", from: { kind: "zone_count", playerId: "player", zone: "deck" }, to: { kind: "zone_count", playerId: "player", zone: "hand" }, count: 5 }] }
];

function expectedMatrixRecords(events) {
  const record = (event, eventIndex, stepIndex, target, role, text) => ({
    sourceEventId: `USERFX-MATRIX-${eventIndex}`, abilityKey: event.abilityKey, branch: event.branch,
    ownerPlayerId: event.ownerPlayerId, affectedPlayerId: event.affectedPlayerId, targetPlayerId: target.playerId,
    target: `${target.kind}:${target.metric ?? target.zone ?? target.status ?? ""}`,
    cardUid: target.kind === "card_stat" ? target.cardUid : "", stepIndex: String(stepIndex), role, text
  });
  return events.flatMap((event, eventIndex) => [
    ...event.steps.flatMap((step, stepIndex) => {
      if (step.kind === "transfer") return [
        record(event, eventIndex, stepIndex, step.from, "from", `${step.from.zone.toUpperCase()} −${step.count}`),
        record(event, eventIndex, stepIndex, step.to, "to", `${step.to.zone.toUpperCase()} +${step.count}`)
      ];
      const text = step.kind === "multiply" ? `${step.before}×${step.factor}=${step.after}`
        : step.kind === "state_change" ? `${step.target.status.replaceAll("_", " ").toUpperCase()} ${step.after ? "ON" : "OFF"}`
          : `${step.before}→${step.after}`;
      return [record(event, eventIndex, stepIndex, step.target, "single", text)];
    }),
    ...(event.abilityKey === "mono_color" ? [record(event, eventIndex, 1,
      { kind: "card_stat", playerId: "player", metric: "atk", cardUid: "userfx-public-ob" }, "single", "2→3")] : [])
  ]);
}

async function runPresentationMatrixPage(base, effectsEnabled) {
  const matrixUrl = new URL(base);
  matrixUrl.searchParams.set("userfx-matrix", "1");
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    Math.random = () => 0.5;
    Date.now = () => 1700000000000;
  });
  await page.goto(matrixUrl.toString(), { waitUntil: "networkidle" });
  await page.evaluate((enabled) => localStorage.setItem("sz-ui-effects", enabled ? "on" : "off"), effectsEnabled);
  await page.reload({ waitUntil: "networkidle" });
  await clickEntryControl(page, '[data-mode="sandbox"]');
  await page.locator(".r2-board").waitFor({ state: "visible" });
  const before = normalizeText(await page.locator(".r2-board").textContent());
  const matrix = await page.evaluate(({ events, enabled }) => window.__SZ_USERFX_MATRIX__(events, { effectsEnabled: enabled }), { events: matrixCases, enabled: effectsEnabled });
  const after = normalizeText(await page.locator(".r2-board").textContent());
  if (!matrix.stateUnchanged || matrix.stateBefore !== matrix.stateAfter || before !== after) throw new Error(`presentation matrix ${effectsEnabled ? "ON" : "OFF"} mutated game state`);
  if (effectsEnabled) await page.screenshot({ path: path.join(evidenceRoot, "pc-presentation-matrix.png"), fullPage: true });
  await page.close();
  return matrix;
}

async function assertPresentationMatrix(base) {
  const expected = expectedMatrixRecords(matrixCases);
  const on = await runPresentationMatrixPage(base, true);
  if (on.effects.length !== matrixCases.length || on.effects.some((effect) => /STD-|uid|userfx-public-ob/i.test(effect.label))) throw new Error("presentation matrix ON effects drifted or leaked private identifiers");
  assertExactRecordMultiset(on.records, expected);
  const off = await runPresentationMatrixPage(base, false);
  if (off.records.length !== 0) throw new Error(`presentation matrix OFF created ability overlays: ${JSON.stringify(off.records)}`);
  if (!off.stateUnchanged) throw new Error("presentation matrix OFF mutated game state");
  const onStateBefore = JSON.parse(on.stateBefore);
  const offStateBefore = JSON.parse(off.stateBefore);
  const onStateAfter = JSON.parse(on.stateAfter);
  const offStateAfter = JSON.parse(off.stateAfter);
  if (onStateBefore.deckBuilder.effectsEnabled !== true || onStateAfter.deckBuilder.effectsEnabled !== true
    || offStateBefore.deckBuilder.effectsEnabled !== false || offStateAfter.deckBuilder.effectsEnabled !== false) {
    throw new Error("presentation matrix ON/OFF effects preference values drifted");
  }
  delete onStateBefore.deckBuilder.effectsEnabled;
  delete offStateBefore.deckBuilder.effectsEnabled;
  delete onStateAfter.deckBuilder.effectsEnabled;
  delete offStateAfter.deckBuilder.effectsEnabled;
  if (JSON.stringify(onStateBefore) !== JSON.stringify(offStateBefore) || JSON.stringify(onStateAfter) !== JSON.stringify(offStateAfter)) {
    throw new Error("presentation matrix ON/OFF state parity drifted");
  }
}

const playwright = await loadPlaywright();
const { chromium } = playwright.default ?? playwright;
const browser = await chromium.launch({ channel: "msedge", headless: true });
await mkdir(evidenceRoot, { recursive: true });

try {
  const desktop = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const desktopResult = await captureTurbo(desktop, new URL(url), "pc");
  await desktop.close();
  const mobile = await browser.newPage({ viewport: { width: 844, height: 390 } });
  const mobileBase = new URL("mobile/", new URL(url));
  const mobileResult = await captureTurbo(mobile, mobileBase, "mobile");
  await mobile.close();
  await assertReducedMotion(new URL(url));
  await assertPresentationMatrix(new URL(url));
  console.log(JSON.stringify({ evidenceRoot, desktop: desktopResult, mobile: mobileResult, reducedMotion: true, presentationMatrix: "synthetic", ok: true }));
} finally {
  await browser.close();
}
