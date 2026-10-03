import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { addSandboxCardToHand, createGame, playCard } from "../src/game/engine.js";
import { clickEntryControl } from "./e2e-entry-crt.mjs";

const args = process.argv.slice(2);
const playwrightFlag = args.indexOf("--playwright-module");
const evidenceFlag = args.indexOf("--evidence-dir");
const diagnoseMono = args.includes("--diagnose-mono");
const playwrightPath = playwrightFlag >= 0 ? args[playwrightFlag + 1] : null;
const evidenceRoot = evidenceFlag >= 0 ? path.resolve(args[evidenceFlag + 1]) : null;
const url = args.find((value, index) => index !== playwrightFlag + 1 && index !== evidenceFlag + 1 && value !== "--playwright-module" && value !== "--evidence-dir" && value !== "--diagnose-mono");

if (!url || !playwrightPath || !evidenceRoot) throw new Error("usage: node scripts/e2e-user-ability-real.mjs URL --playwright-module PATH --evidence-dir PATH [--diagnose-mono]");
if (!existsSync(playwrightPath)) throw new Error("explicit Playwright module path is unavailable");

const playwright = createRequire(import.meta.url)(path.resolve(playwrightPath));
const { chromium } = playwright.default ?? playwright;
const ZONES = ["hand", "front", "back", "registry", "trash", "deck", "ban", "virtual"];
const SETUP_RESTORE_FIELDS = ["baseMemory", "permanentMemory", "memory", "firstObExecutionTurn", "installedThisTurn", "registryActionUsed"];

function sanitizePageError(error) {
  const name = String(error?.name ?? "Error");
  const safeName = new Set(["Error", "TypeError", "ReferenceError", "SyntaxError", "RangeError", "URIError", "EvalError"]);
  const match = String(error?.stack ?? "").match(/(?:^|[\\/])([A-Za-z0-9_.-]+\.(?:js|mjs)):(\d+):(\d+)(?:\)|\s|$)/);
  return { name: safeName.has(name) ? name : "Error", source: match ? `${match[1]}:${match[2]}:${match[3]}` : null };
}

function fixture({ playerUser, aiUser = "doors_zx", active = "player", player = {}, ai = {} }) {
  const state = createGame({ mode: "sandbox", playerUserId: playerUser, aiUserId: aiUser, rng: () => 0.5 });
  const setupPreconditions = Object.fromEntries(Object.entries(state.players).map(([id, target]) => [id,
    Object.fromEntries(SETUP_RESTORE_FIELDS.map((field) => [field, target[field]]))]));
  for (const target of Object.values(state.players)) for (const zone of ZONES) target[zone] = [];
  for (const [id, config] of Object.entries({ player, ai })) {
    const target = state.players[id];
    for (const zone of ZONES) {
      for (const [index, cardId] of (config[zone] ?? []).entries()) {
        if (typeof cardId !== "string" || !addSandboxCardToHand(state, id, cardId)) throw new Error(`fixture: failed to add ${id}/${zone}/${cardId}`);
        const instance = target.hand.at(-1);
        if (!instance || instance.id !== cardId || !instance.compiled || !Array.isArray(instance.compiled.keywords)
          || !Array.isArray(instance.classes) || !Array.isArray(instance.mounted)) throw new Error(`fixture: ${id}/${zone}/${cardId} was not hydrated`);
        if (["front", "back"].includes(zone)) {
          state.active = id;
          state.sandboxUi.actor = id;
          if (!playCard(state, id, instance.uid, { zone, requestedSlot: index + 1 })) throw new Error(`fixture: normal play failed for ${id}/${zone}/${cardId}: ${state.message}`);
          const placed = target[zone].find((item) => item.uid === instance.uid);
          if (placed !== instance || placed.boardSlot !== index + 1 || placed.boardSlotController !== id || placed.boardSlotZone !== zone) {
            throw new Error(`fixture: board placement drifted for ${id}/${zone}/${cardId}`);
          }
        } else if (zone !== "hand") {
          const handIndex = target.hand.findIndex((item) => item.uid === instance.uid);
          if (handIndex < 0) throw new Error(`fixture: generated ${id}/${zone}/${cardId} left hand unexpectedly`);
          target.hand.splice(handIndex, 1);
          target[zone].push(instance);
          instance.boardSlot = null;
          instance.boardSlotController = null;
          instance.boardSlotZone = null;
        }
        instance.summoningSick = false;
        instance.sleep = false;
        instance.attackedThisTurn = false;
        if (!target[zone].some((item) => item.uid === instance.uid)) throw new Error(`fixture: ${id}/${zone}/${cardId} location mismatch`);
      }
    }
  }
  for (const [id, config] of Object.entries({ player, ai })) {
    Object.assign(state.players[id], setupPreconditions[id]);
    Object.assign(state.players[id], config.values ?? {});
  }
  state.active = active; state.turnNumber = 2; state.firstPlayer = "ai"; state.phase = "main";
  state.sandboxUi.actor = active;
  state.sandboxUi.alternateTurns = true;
  state.interactive = true;
  if (state.pending || state.prompt || state.effectResolution) throw new Error("fixture: setup left an unresolved interaction");
  return state;
}

function oneSymbolInstallState(userId = "suckintosh") {
  return fixture({ playerUser: userId, player: { front: ["STD-020"], hand: ["STD-076"], deck: ["STD-020"] } });
}

function bigbossMulliganState() {
  const seed = createGame({ mode: "sandbox", playerUserId: "bigboss", aiUserId: "doors_zx", sandboxDeckSetup: true, rng: () => 0.5 });
  const state = fixture({ playerUser: "bigboss", player: {
    hand: seed.players.player.hand.map((item) => item.id), deck: seed.players.player.deck.map((item) => item.id)
  } });
  state.firstPlayer = "player"; state.turnNumber = 1;
  return state;
}

const CASES = [
  {
    id: "mono-enabled", ability: "mono_color", branch: "enabled", owner: "player", affected: "player",
    state: () => oneSymbolInstallState(),
    act: async (page, state) => install(page, state.players.player.hand[0].uid),
    check: (before, state, event) => { const uid = before.players.player.zones.hand[0]; return state.players.player.registry.length === 1 && state.players.player.registry[0].uid === uid && !state.players.player.hand.some((item) => item.uid === uid) && event.steps?.[0]?.target?.status === "mono_color"; }
  },
  {
    id: "phoenix-first-install", ability: "registry_liberty", branch: "first-install", owner: "player", affected: "player",
    state: () => oneSymbolInstallState("phoenix"),
    act: async (page, state) => install(page, state.players.player.hand[0].uid),
    check: (before, state, event) => { const [installed, drawn] = [before.players.player.zones.hand[0], before.players.player.zones.deck[0]]; return state.players.player.firstRegistryInstallResolved === true && state.players.player.registry[0]?.uid === installed && state.players.player.hand[0]?.uid === drawn && event.amount === 1; }
  },
  {
    id: "humanoid-recovered", ability: "recovery_boot", branch: "recovered", owner: "ai", affected: "ai",
    state: () => fixture({ playerUser: "doors_zx", aiUser: "humanoid", player: { front: ["STD-031"] }, ai: { values: { fortressStr: 1 }, deck: ["STD-020"] } }),
    act: async (page, state) => attackFortress(page, state.players.player.front[0].uid, "ai"),
    check: (before, state, event) => before.players.ai.fortressStr === 1 && state.players.ai.fortressStr === 1 && event.before === 0 && event.after === 1
  },
  {
    id: "by-os-damage-replaced", ability: "dimension_innovation", branch: "damage-replaced", owner: "ai", affected: "ai",
    state: () => fixture({ playerUser: "doors_zx", aiUser: "by_os", player: { front: ["STD-031"] }, ai: { values: { fortressStr: 1 }, deck: ["STD-020", "STD-021"] } }),
    act: async (page, state) => attackFortress(page, state.players.player.front[0].uid, "ai"),
    check: (before, state, event) => before.players.ai.fortressStr === 1 && state.players.ai.fortressStr === 1 && state.players.ai.ban.length === 2 && before.players.ai.zones.deck.every((uid) => state.players.ai.ban.some((item) => item.uid === uid)) && event.before === 5 && event.after === 2
  },
  {
    id: "doors-first-ob-discount", ability: "do_or_isnt", branch: "first-ob-discount", owner: "player", affected: "player",
    state: () => fixture({ playerUser: "doors_nt", player: { hand: ["STD-020"], deck: ["STD-021"] } }),
    act: async (page, state) => executeToFront(page, state.players.player.hand[0].uid),
    check: (before, state, event) => {
      const uid = before.players.player.zones.hand[0];
      const step = event.steps?.[0];
      return state.players.player.front[0]?.uid === uid && !state.players.player.hand.some((item) => item.uid === uid)
        && state.players.player.firstObExecutionTurn === state.turnNumber && before.players.player.memory === state.players.player.memory
        && event.amount === 0 && step?.kind === "measurement" && step.before === 0 && step.after === 0
        && step.target?.kind === "card_stat" && step.target.playerId === "player" && step.target.metric === "effective_cost" && step.target.cardUid === uid;
    }
  },
  {
    id: "doors-exact-three-recovery", ability: "do_or_isnt", branch: "exact-three-recovery", owner: "player", affected: "player",
    state: () => fixture({ playerUser: "doors_nt", player: { front: ["STD-020", "STD-021", "STD-023"], values: { fortressStr: 10, memory: 2 } } }),
    act: async (page) => endTurn(page),
    check: (before, state, event) => before.players.player.fortressStr === 10 && before.players.player.memory === 2 && state.players.player.fortressStr === 11 && state.players.player.memory === 3 && event.strBefore === 10 && event.strAfter === 11 && event.memoryBefore === 2 && event.memoryAfter === 3
  },
  {
    id: "doors-five-plus-damage-down", ability: "do_or_isnt", branch: "five-plus-damage-down", owner: "player", affected: "ai",
    state: () => fixture({ playerUser: "doors_nt", player: { front: ["STD-020", "STD-021", "STD-023", "STD-024"], back: ["STD-025"] }, ai: { front: ["STD-020"] } }),
    act: async (page, state) => attackFortress(page, state.players.player.front[0].uid, "ai"),
    check: (before, state, event) => before.players.player.zones.front.length === 4 && before.players.player.zones.back.length === 1 && state.players.ai.fortressStr === before.players.ai.fortressStr - 1 && event.before === 2 && event.after === 1
  },
  {
    id: "savage-milled-same-symbol", ability: "trash_never_empty", branch: "milled-same-symbol", owner: "player", affected: "player",
    state: () => fixture({ playerUser: "savage_salvage", player: { deck: ["STD-020", "STD-075", "STD-076"] } }),
    act: async (page, _state, profile) => { await endTurn(page); const proof = await assertSavageMilledVfx(page, profile); await chooseFirstAndConfirm(page); return proof; },
    check: (before, state, event) => state.players.player.trash.length === 1 && state.players.player.hand.length === 1 && before.players.player.zones.deck.includes(state.players.player.trash[0].uid) && before.players.player.zones.deck.includes(state.players.player.hand[0].uid) && event.amount === 2
  },
  {
    id: "savage-salvaged", ability: "trash_never_empty", branch: "salvaged", owner: "player", affected: "player",
    state: () => fixture({ playerUser: "savage_salvage", player: { deck: ["STD-020", "STD-075", "STD-076"] } }),
    act: async (page) => { await endTurn(page); await chooseFirstAndConfirm(page); },
    check: (before, state, event) => state.players.player.trash.length === 1 && state.players.player.hand.length === 1 && before.players.player.zones.deck.includes(state.players.player.hand[0].uid) && event.amount === 1
  },
  {
    id: "savage-milled-different-symbol", ability: "trash_never_empty", branch: "milled-different-symbol", owner: "player", affected: "player",
    state: () => fixture({ playerUser: "savage_salvage", player: { deck: ["STD-020", "STD-075", "STD-125"] } }),
    act: async (page) => endTurn(page),
    check: (before, state, event) => state.players.player.trash.length === 2 && state.players.player.hand.length === 1 && before.players.player.zones.deck.includes(state.players.player.hand[0].uid) && state.players.player.trash.every((item) => before.players.player.zones.deck.includes(item.uid)) && event.amount === 1
  },
  {
    id: "extreme-damage-doubled", ability: "kickass", branch: "damage-doubled", owner: "ai", affected: "ai",
    state: () => fixture({ playerUser: "doors_zx", aiUser: "extreme", player: { front: ["STD-020"] }, ai: { values: { fortressStr: 10 } } }),
    act: async (page, state) => attackFortress(page, state.players.player.front[0].uid, "ai"),
    check: (before, state, event) => before.players.ai.fortressStr === 10 && state.players.ai.fortressStr === 6 && event.before === 2 && event.after === 4
  },
  {
    id: "bigboss-mulligan", ability: "watching_you", branch: "mulligan", owner: "player", affected: "player",
    state: () => bigbossMulliganState(),
    act: async (page) => click(page, '[data-action="opening-mulligan"]'),
    check: (before, state, event) => {
      const afterUids = [...state.players.player.hand, ...state.players.player.deck].map((item) => item.uid).sort();
      const beforeUids = [...before.players.player.zones.hand, ...before.players.player.zones.deck].sort();
      const changed = before.players.player.zones.hand.join("|") !== state.players.player.hand.map((item) => item.uid).join("|");
      return state.players.player.mulligansUsed === 1 && before.players.player.zones.hand.length === 5 && state.players.player.hand.length === 5 && changed && JSON.stringify(beforeUids) === JSON.stringify(afterUids) && event.amount === 1;
    }
  }
];

async function click(page, selector) { const target = page.locator(selector).first(); await target.waitFor({ state: "visible" }); await target.click(); }
async function install(page, uid) { await click(page, `[data-card-uid="${uid}"]`); await click(page, '[data-action="install"]'); }
async function executeToFront(page, uid) {
  await click(page, `[data-card-uid="${uid}"]`); await click(page, '[data-live="execute"]');
  await click(page, '[data-live-slot^="front:"]');
}
async function attackFortress(page, uid, target) { await click(page, `[data-card-uid="${uid}"]`); await click(page, '[data-action="prepare-attack"]'); await click(page, `[data-fortress="${target}"]`); }
async function endTurn(page) { await click(page, '[data-action="end-turn"]'); }
async function chooseFirstAndConfirm(page) { const option = page.locator('[data-selection-option]').first(); await option.waitFor({ state: "visible" }); await option.click(); await click(page, '[data-action="confirm-selection"]'); }

async function assertSavageMilledVfx(page, profile) {
  const state = await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.getState());
  const event = eventFor(state, "trash_never_empty", "milled-same-symbol");
  if (!event) throw new Error("savage-milled-same-symbol: end-turn did not emit feedback before selection");
  const selector = `.vfx-ability-anchor[data-vfx-ability-key="trash_never_empty"][data-vfx-branch="milled-same-symbol"][data-vfx-source-event-id="${event.id}"][data-vfx-owner="player"][data-vfx-affected-player="player"]`;
  const anchor = page.locator(selector).first();
  await anchor.waitFor({ state: "visible" });
  await page.screenshot({ path: path.join(evidenceRoot, `${profile.id}-savage-milled-same-symbol.png`), fullPage: true });
  return { eventId: event.id, selector };
}

function eventFor(state, ability, branch) {
  return [...state.events].reverse().find((event) => event.type === "user_ability_feedback" && event.abilityKey === ability && event.branch === branch);
}

function snapshot(state) {
  const player = (entry) => ({ fortressStr: entry.fortressStr, memory: entry.memory, memoryLimit: entry.baseMemory + entry.permanentMemory,
    zones: Object.fromEntries(["hand", "front", "back", "registry", "trash", "deck", "ban", "virtual"].map((zone) => [zone, entry[zone].map((item) => item.uid)])) });
  return { players: Object.fromEntries(Object.entries(state.players).map(([id, entry]) => [id, player(entry)])), eventIds: state.events.map((event) => event.id) };
}

function assertIncludes(values, value, message) { if (!values.includes(value)) throw new Error(message); }
function assertEvent(event, testCase, before) {
  if (before.eventIds.includes(event.id)) throw new Error(`${testCase.id}: feedback event predates the UI action`);
  if (event.ownerPlayerId !== testCase.owner || event.affectedPlayerId !== testCase.affected) throw new Error(`${testCase.id}: feedback owner or affected player drifted`);
}

async function inject(page, state) {
  const serializable = JSON.parse(JSON.stringify(state));
  await page.evaluate((next) => {
    next.rng = () => 0.5;
    window.__SIMPLE_ZEKE_E2E__.setState(next);
  }, serializable);
}

async function diagnoseMonoInstall(browser) {
  const profile = { id: "pc", path: "./", viewport: { width: 1600, height: 1000 } };
  const page = await browser.newPage({ viewport: profile.viewport });
  const pageErrors = [];
  let pageErrorTotalCount = 0;
  page.on("pageerror", (error) => {
    pageErrorTotalCount += 1;
    if (pageErrors.length < 5) pageErrors.push(sanitizePageError(error));
  });
  try {
    const base = new URL(profile.path, url); base.searchParams.set("e2e", "1");
    await page.goto(base.toString(), { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.setItem("sz-ui-effects", "on"));
    await page.reload({ waitUntil: "networkidle" });
    await clickEntryControl(page, '[data-mode="sandbox"]');
    await page.locator('.r2-board').waitFor({ state: "visible" });
    const initial = CASES.find((testCase) => testCase.id === "mono-enabled").state();
    const selectedUid = initial.players.player.hand[0].uid;
    await inject(page, initial);
    await click(page, `[data-card-uid="${selectedUid}"]`);
    const diagnostic = await page.evaluate((expectedUid) => {
      const state = window.__SIMPLE_ZEKE_E2E__.getState();
      const actor = state.mode === "sandbox" ? (state.sandboxUi?.actor ?? "player") : "player";
      const selected = state.selectedUid ? Object.entries(state.players).flatMap(([owner, player]) =>
        ["hand", "front", "back", "registry", "trash", "deck", "ban", "virtual"].flatMap((zone) =>
          (player[zone] ?? []).filter((card) => card.uid === state.selectedUid).map(() => ({ zone, owner }))))[0] ?? null : null;
      const dom = (selector) => Array.from(document.querySelectorAll(selector)).map((node) => ({
        action: node.getAttribute("data-action"), live: node.getAttribute("data-live"),
        visible: !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length), disabled: !!node.disabled,
        ariaExpanded: node.getAttribute("aria-expanded"), role: node.getAttribute("role")
      }));
      const popups = Array.from(document.querySelectorAll(".r2-popup"));
      const popupHost = document.querySelector('[data-live-region="popup"]');
      return {
        schema_version: 1, mode: "diagnostic", fixture: "mono-enabled",
        expectedPlayerUid: expectedUid, selectedMatchesExpected: state.selectedUid === expectedUid,
        active: state.active ?? null, actor,
        selected: selected && state.selectedUid === expectedUid ? selected : null,
        pending: state.pending?.type ?? null, winner: state.winner ?? null,
        registryActionUsed: !!state.players.player?.registryActionUsed,
        dom: {
          install: dom('[data-action="install"]'),
          popup: {
            host: { exists: !!popupHost, htmlLength: popupHost?.innerHTML.length ?? 0, r2PopupExists: popups.length > 0 },
            count: popups.length,
            visible: popups.some((node) => !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length)),
            actions: popups.flatMap((popup) => Array.from(popup.querySelectorAll('[data-action], [data-live]')).map((node) => ({
              action: node.getAttribute("data-action"), live: node.getAttribute("data-live"),
              visible: !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length), disabled: !!node.disabled
            })))
          }
        }
      };
    }, selectedUid);
    const screenshot = path.join(evidenceRoot, "diagnose-mono.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    const visibleEnabledInstall = diagnostic.dom.install.some((entry) => entry.visible && !entry.disabled);
    const visiblePopup = diagnostic.dom.popup.visible && diagnostic.dom.popup.host.exists && diagnostic.dom.popup.host.r2PopupExists;
    const result = { ...diagnostic, pageErrors, pageErrorTotalCount, evidenceRoot, screenshot,
      ok: diagnostic.selectedMatchesExpected && visibleEnabledInstall && visiblePopup && pageErrorTotalCount === 0 };
    await writeFile(path.join(evidenceRoot, "user-ability-real-diagnostic.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(result));
  } finally { await page.close(); }
}

async function runCase(browser, profile, testCase) {
  const page = await browser.newPage({ viewport: profile.viewport });
  try {
    const base = new URL(profile.path, url); base.searchParams.set("e2e", "1");
    await page.goto(base.toString(), { waitUntil: "networkidle" });
    await page.evaluate((enabled) => localStorage.setItem("sz-ui-effects", enabled ? "on" : "off"), !testCase.effectsOff);
    await page.reload({ waitUntil: "networkidle" });
    await clickEntryControl(page, '[data-mode="sandbox"]');
    await page.locator('.r2-board').waitFor({ state: "visible" });
    const initial = testCase.state();
    const before = snapshot(initial);
    await inject(page, initial);
    const transientProof = await testCase.act(page, initial, profile);
    const after = await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.getState());
    const event = eventFor(after, testCase.ability, testCase.branch);
    if (!event) throw new Error(`${testCase.id}/${profile.id}: real UI action did not emit the expected feedback event`);
    assertEvent(event, testCase, before);
    if (!testCase.check(before, after, event)) throw new Error(`${testCase.id}/${profile.id}: expected resource, UID, or zone delta is absent`);
    const selector = `.vfx-ability-anchor[data-vfx-ability-key="${testCase.ability}"][data-vfx-branch="${testCase.branch}"][data-vfx-source-event-id="${event.id}"][data-vfx-owner="${testCase.owner}"][data-vfx-affected-player="${testCase.affected}"]`;
    const overlays = page.locator(selector);
    if (testCase.effectsOff) {
      if (await overlays.count()) throw new Error(`${testCase.id}/${profile.id}: effects OFF rendered a user-ability overlay`);
    } else if (transientProof) {
      if (transientProof.eventId !== event.id) throw new Error(`${testCase.id}/${profile.id}: pre-selection VFX proof and final feedback event differ`);
    } else {
      await overlays.first().waitFor({ state: "visible" });
      if (!await overlays.first().getAttribute('data-vfx-target')) throw new Error(`${testCase.id}/${profile.id}: VFX anchor is not attributed to an effect target`);
      await page.screenshot({ path: path.join(evidenceRoot, `${profile.id}-${testCase.id}.png`), fullPage: true });
    }
    return { id: testCase.id, viewport: profile.id, ability: testCase.ability, branch: testCase.branch, owner: event.ownerPlayerId, affected: event.affectedPlayerId, eventId: event.id, effects: testCase.effectsOff ? "off" : "on", state: "passed" };
  } finally { await page.close(); }
}

await mkdir(evidenceRoot, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  if (diagnoseMono) {
    await diagnoseMonoInstall(browser);
  } else {
  const profiles = [{ id: "pc", path: "./", viewport: { width: 1600, height: 1000 } }, { id: "mobile", path: "mobile/", viewport: { width: 844, height: 390 } }];
  const results = [];
  for (const profile of profiles) for (const testCase of CASES) {
    console.log(JSON.stringify({ schema_version: 1, type: "case_progress", phase: "start", viewport: profile.id, id: testCase.id }));
    const result = await runCase(browser, profile, testCase);
    results.push(result);
    console.log(JSON.stringify({ schema_version: 1, type: "case_progress", phase: "pass", viewport: profile.id, id: testCase.id }));
  }
  const expected = CASES.flatMap((testCase) => profiles.map((profile) => `${profile.id}:${testCase.id}`));
  if (results.length !== expected.length || new Set(results.map((result) => `${result.viewport}:${result.id}`)).size !== expected.length) throw new Error("branch result set is incomplete");
  const effectsOffCase = { ...CASES[0], id: "mono-enabled-effects-off", effectsOff: true };
  console.log(JSON.stringify({ schema_version: 1, type: "case_progress", phase: "start", viewport: profiles[0].id, id: effectsOffCase.id }));
  const effectsOff = await runCase(browser, profiles[0], effectsOffCase);
  console.log(JSON.stringify({ schema_version: 1, type: "case_progress", phase: "pass", viewport: profiles[0].id, id: effectsOffCase.id }));
  await writeFile(path.join(evidenceRoot, "user-ability-real-results.json"), `${JSON.stringify({ url, results, expected, effectsOff, ok: true }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ evidenceRoot, expected, results, effectsOff, ok: true }));
  }
} finally { await browser.close(); }
