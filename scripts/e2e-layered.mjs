import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const playwrightFlag = args.indexOf("--playwright-module");
const explicitPlaywrightModule = playwrightFlag >= 0
  ? args[playwrightFlag + 1]
  : process.env.SIMPLE_ZEKE_PLAYWRIGHT_MODULE;
const url = args.find((argument, index) => argument !== "--playwright-module" && index !== playwrightFlag + 1)
  ?? "http://127.0.0.1:4173/";

async function loadPlaywright() {
  if (!explicitPlaywrightModule) {
    throw new Error("provide --playwright-module or SIMPLE_ZEKE_PLAYWRIGHT_MODULE for the external browser runner");
  }
  const specifier = explicitPlaywrightModule.startsWith("file:")
    ? explicitPlaywrightModule
    : pathToFileURL(path.resolve(explicitPlaywrightModule)).href;
  if (!existsSync(new URL(specifier))) throw new Error("explicit Playwright module path is unavailable");
  return import(specifier);
}

const playwright = await loadPlaywright();
const { chromium } = playwright.default ?? playwright;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

async function freshSandbox(cardIds) {
  const target = new URL(url);
  target.searchParams.set("e2e", "1");
  await page.goto(target.toString(), { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  if (!await page.evaluate(() => Boolean(window.__SIMPLE_ZEKE_E2E__))) throw new Error("layered E2E hook is unavailable");
  await page.locator('[data-mode="sandbox"]').click();
  for (const id of cardIds) await page.locator(`[data-catalog-card="${id}"]`).click();
}

async function prepareFixture({ sourceId, placements, nested = null }) {
  return page.evaluate(({ sourceId, placements, nested }) => {
    const fixture = window.__SIMPLE_ZEKE_E2E__;
    const state = fixture.getState();
    const player = state.players.player;
    const opponent = state.players.ai;
    const allCards = [...player.hand, ...player.front, ...player.back, ...player.registry, ...player.trash];
    const take = (id) => {
      const matches = allCards.filter((card) => card.id === id && !card.__e2eTaken);
      const card = matches.at(-1);
      if (!card) throw new Error(`fixture card unavailable: ${id}`);
      card.__e2eTaken = true;
      return card;
    };
    const source = take(sourceId);
    for (const side of [player, opponent]) {
      side.hand = [];
      side.front = [];
      side.back = [];
      side.registry = [];
      side.trash = [];
      side.memory = 99;
    }
    player.hand.push(source);
    if (source.color) {
      player.registry.push({
        ...structuredClone(source),
        uid: `e2e-symbol-${source.uid}`,
        id: `E2E-SYMBOL-${source.color}`,
        name: `${source.color}シンボル fixture`,
        category: "Code",
        printedCategory: "Code",
        mounted: [],
        faceDown: false
      });
    }
    const uids = { source: source.uid, materials: [] };
    for (const placement of placements) {
      const card = take(placement.id);
      if (placement.faceDown) card.faceDown = true;
      const owner = placement.owner === "ai" ? opponent : player;
      owner[placement.zone].push(card);
      uids.materials.push(card.uid);
    }
    if (nested) {
      const host = [...player.front, ...player.back].find((card) => card.id === nested.hostId);
      const child = take(nested.childId);
      host.mounted = [child];
      uids.nested = child.uid;
    }
    for (const card of allCards) delete card.__e2eTaken;
    state.active = "player";
    state.selectedUid = null;
    state.pending = null;
    state.prompt = null;
    state.winner = null;
    fixture.setState(state);
    return uids;
  }, { sourceId, placements, nested });
}

async function executeLayered(uids, selectedUids = uids.materials) {
  await page.locator(`.hand [data-card-uid="${uids.source}"]`).click();
  await page.locator('[data-action="layered-front"]').first().click();
  const pending = await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.getState().pending);
  for (const uid of selectedUids) {
    if (!pending.validTargets.includes(uid)) throw new Error(`expected layered candidate is absent: ${uid}`);
    let target = page.locator(`[data-card-uid="${uid}"]`);
    if (!await target.count()) {
      const location = await page.evaluate((targetUid) => {
        const state = window.__SIMPLE_ZEKE_E2E__.getState();
        for (const [playerId, player] of Object.entries(state.players)) {
          for (const zone of ["registry", "trash"]) if (player[zone].some((card) => card.uid === targetUid)) return { playerId, zone };
        }
        return null;
      }, uid);
      if (!location) throw new Error(`layered candidate has no rendered or administrative location: ${uid}`);
      await page.locator(`[data-admin-zone="${location.zone}"][data-owner="${location.playerId}"]`).click();
      target = page.locator(`[data-card-uid="${uid}"]`);
    }
    await target.first().click();
  }
  const selectedAfterClicks = await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.getState().pending?.selectedTargets ?? []);
  if (selectedAfterClicks.length !== selectedUids.length || selectedUids.some((uid) => !selectedAfterClicks.includes(uid))) {
    throw new Error(`layered DOM selection mismatch: ${JSON.stringify({ selectedAfterClicks, selectedUids })}`);
  }
  const confirm = page.locator('[data-action="confirm-layered"]').first();
  if (await confirm.isDisabled()) throw new Error("layered confirmation stayed disabled for a valid selection");
  await confirm.click();
  return page.evaluate((sourceUid) => {
    const state = window.__SIMPLE_ZEKE_E2E__.getState();
    const source = [...state.players.player.front, ...state.players.player.back].find((card) => card.uid === sourceUid);
    return {
      pending: state.pending?.type ?? null,
      sourceZone: source ? (state.players.player.front.includes(source) ? "front" : "back") : null,
      mounted: source?.mounted?.map((card) => card.id) ?? [],
      handIds: state.players.player.hand.map((card) => card.id),
      registryIds: state.players.player.registry.map((card) => card.id),
      log: state.log.slice(-3).map((entry) => entry.text)
    };
  }, uids.source);
}

try {
  await freshSandbox(["STD-205", "STD-020"]);
  let uids = await prepareFixture({ sourceId: "STD-205", placements: [{ id: "STD-020", owner: "player", zone: "front" }] });
  let result = await executeLayered(uids);
  if (result.sourceZone !== "front" || result.pending || result.mounted.join() !== "STD-020") throw new Error(`area-only layered mismatch: ${JSON.stringify(result)}`);

  await freshSandbox(["STD-238", "STD-020", "STD-001"]);
  uids = await prepareFixture({
    sourceId: "STD-238",
    placements: [
      { id: "STD-020", owner: "player", zone: "front" },
      { id: "STD-001", owner: "player", zone: "registry" }
    ]
  });
  result = await executeLayered(uids);
  if (result.sourceZone !== "front" || result.pending || result.mounted.length !== 2 || result.registryIds.includes("STD-001")) throw new Error(`registry layered mismatch: ${JSON.stringify(result)}`);

  await freshSandbox(["SZTB-093", "SZTB-090", "SZTB-091"]);
  uids = await prepareFixture({
    sourceId: "SZTB-093",
    placements: [
      { id: "SZTB-090", owner: "player", zone: "hand" },
      { id: "SZTB-091", owner: "player", zone: "back" }
    ]
  });
  result = await executeLayered(uids);
  if (result.sourceZone !== "front" || result.pending || result.mounted.length !== 2 || result.handIds.includes("SZTB-090")) throw new Error(`hand-area layered mismatch: ${JSON.stringify(result)}`);

  await freshSandbox(["STD-096", "STD-020", "STD-021", "STD-022"]);
  uids = await prepareFixture({
    sourceId: "STD-096",
    placements: [
      { id: "STD-020", owner: "player", zone: "hand" },
      { id: "STD-021", owner: "player", zone: "hand" },
      { id: "STD-022", owner: "player", zone: "hand" }
    ]
  });
  await page.evaluate(({ sourceUid, layerUids }) => {
    const fixture = window.__SIMPLE_ZEKE_E2E__;
    const state = fixture.getState();
    const player = state.players.player;
    const source = player.hand.find((card) => card.uid === sourceUid);
    const layers = layerUids.map((uid) => player.hand.find((card) => card.uid === uid));
    player.hand = player.hand.filter((card) => card.uid !== sourceUid && !layerUids.includes(card.uid));
    source.mounted = layers;
    source.summoningSick = false;
    source.sleep = false;
    player.front = [source];
    fixture.setState(state);
  }, { sourceUid: uids.source, layerUids: uids.materials });
  await page.locator(`[data-card-uid="${uids.source}"]`).first().click();
  await page.locator('[data-action="prepare-attack"]').first().click();
  await page.locator('[data-fortress="ai"]').click();
  await page.locator('[data-selection-scope]').selectOption("レイヤー1枚を破棄して起動");
  await page.locator('[data-action="confirm-selection"]').first().click();
  const chosenLayerUid = uids.materials[1];
  await page.locator(`[data-selection-option="${chosenLayerUid}"]`).click();
  await page.locator('[data-action="confirm-selection"]').first().click();
  const layerChoice = await page.evaluate(({ sourceUid, chosenLayerUid }) => {
    const state = window.__SIMPLE_ZEKE_E2E__.getState();
    const source = state.players.player.front.find((card) => card.uid === sourceUid);
    return {
      remaining: source?.mounted.map((card) => card.uid) ?? [],
      chosenInTrash: state.players.player.trash.some((card) => card.uid === chosenLayerUid),
      attacked: source?.attackedThisTurn,
      standby: source ? !source.sleep : false
    };
  }, { sourceUid: uids.source, chosenLayerUid });
  if (layerChoice.remaining.join() !== [uids.materials[0], uids.materials[2]].join() || !layerChoice.chosenInTrash || !layerChoice.attacked || !layerChoice.standby) {
    throw new Error(`user-selected layer cost mismatch: ${JSON.stringify(layerChoice)}`);
  }

  await freshSandbox(["STD-205", "STD-020", "STD-001"]);
  uids = await prepareFixture({
    sourceId: "STD-205",
    placements: [{ id: "STD-020", owner: "player", zone: "front" }],
    nested: { hostId: "STD-020", childId: "STD-001" }
  });
  result = await executeLayered(uids);
  if (result.sourceZone !== "front" || result.pending || result.mounted.join() !== "STD-020,STD-001") throw new Error(`nested layered mismatch: ${JSON.stringify(result)}`);

  await freshSandbox(["STD-205", "STD-020", "STD-020", "STD-020", "STD-020"]);
  uids = await prepareFixture({
    sourceId: "STD-205",
    placements: [
      { id: "STD-020", owner: "player", zone: "front" },
      { id: "STD-020", owner: "player", zone: "back", faceDown: true },
      { id: "STD-020", owner: "player", zone: "trash" },
      { id: "STD-020", owner: "ai", zone: "front" }
    ]
  });
  await page.locator(`.hand [data-card-uid="${uids.source}"]`).click();
  await page.locator('[data-action="layered-front"]').first().click();
  const rejected = await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.getState().pending.validTargets);
  if (rejected.length !== 1 || rejected[0] !== uids.materials[0]) throw new Error(`illegal layered candidates leaked: ${JSON.stringify(rejected)}`);

  if (errors.length) throw new Error(`layered E2E page errors: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ suite: "layered", areaOnly: true, registry: true, handAndArea: true, userSelectedLayerCost: true, nestedStack: true, illegalCandidatesRejected: true, ok: true }));
} finally {
  await browser.close();
}
