import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validSelectionAnswer } from '../src/game/runtime/selection-contract.js';

const args = process.argv.slice(2);
const playwrightFlag = args.indexOf('--playwright-module');
const evidenceFlag = args.indexOf('--evidence-dir');
const url = args.find((value, index) => !value.startsWith('--')
  && index !== playwrightFlag + 1 && index !== evidenceFlag + 1) ?? 'http://127.0.0.1:4176/';
const playwrightPath = playwrightFlag >= 0 ? path.resolve(args[playwrightFlag + 1] ?? '') : null;
const evidenceRoot = evidenceFlag >= 0 ? path.resolve(args[evidenceFlag + 1] ?? '') : null;
if (!playwrightPath || !existsSync(playwrightPath)) throw new Error('provide an existing --playwright-module PATH');
if (!evidenceRoot) throw new Error('provide --evidence-dir PATH');

const require = createRequire(import.meta.url);
const playwright = require(playwrightPath);
const { chromium } = playwright.default ?? playwright;
const profiles = [
  { id: 'pc', route: 'pc/', seed: 0x5a17, viewport: { width: 1600, height: 1000 } },
  { id: 'mobile', route: 'mobile/', seed: 2, viewport: { width: 844, height: 390 } }
];
const MAX_ACTIONS = 1000;
const MAX_TURNS = 120;
const STALL_MS = 60000;
const trace = [];
let commandSerial = 0;

const now = () => new Date().toISOString();
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const compactError = error => ({ name: error?.name ?? 'Error', message: String(error?.message ?? error).slice(0, 1200),
  stack: String(error?.stack ?? '').split('\n').slice(0, 8) });
const clone = value => JSON.parse(JSON.stringify(value));

async function hook(page, method, ...methodArgs) {
  return page.evaluate(({ name, values }) => {
    const api = window.__SIMPLE_ZEKE_E2E__;
    if (!api || typeof api[name] !== 'function') throw new Error(`safe E2E hook ${name} is unavailable`);
    return api[name](...values);
  }, { name: method, values: methodArgs });
}

async function safeQuery(page, seat = 'player') {
  const result = await hook(page, 'query', seat);
  if (!result?.ok) throw new Error(`safe query failed: ${result?.error?.code ?? 'UNKNOWN'}`);
  return result.value;
}

function safeSummary(query) {
  return {
    revision: query.status.revision,
    activeSeat: query.status.activeSeat,
    progress: query.status.progress,
    finished: query.status.finished,
    lockedOutcome: query.status.lockedOutcome,
    turnNumber: query.observation.turnNumber,
    requiredInput: query.requiredInput ? {
      choiceId: query.requiredInput.choiceId ?? null,
      actorSeat: query.requiredInput.actorSeat,
      canAnswer: query.requiredInput.canAnswer,
      presentationKey: query.requiredInput.presentationKey
    } : null,
    seats: query.observation.seats.map(seat => ({ seatId: seat.seatId, fortressStr: seat.fortressStr,
      memory: seat.memory, deck: seat.deck.count, hand: seat.hand.count, front: seat.front.cards.length,
      back: seat.back.cards.length, registry: seat.registry.count, trash: seat.trash.count, ban: seat.ban.count }))
  };
}

const stateKey = query => JSON.stringify(safeSummary(query));
function chooseAllocation(request) {
  const { constraints: constraint, options } = request;
  const minimum = Math.max(1, constraint.minimumPerOption);
  const maximum = constraint.maximumPerOption ?? constraint.total;
  const rows = [];
  let answer = null;
  const search = (index, remaining) => {
    if (answer || remaining === 0) {
      const candidate = { requestId: request.requestId, optionIds: rows.map(row => row.optionId),
        allocation: rows.map(row => ({ ...row })) };
      if (remaining === 0 && validSelectionAnswer(request, candidate)) answer = candidate;
      return;
    }
    if (index >= options.length) return;
    search(index + 1, remaining);
    for (let amount = minimum; amount <= Math.min(maximum, remaining) && !answer; amount += 1) {
      rows.push({ optionId: options[index].optionId, amount });
      search(index + 1, remaining - amount);
      rows.pop();
    }
  };
  search(0, constraint.total);
  if (!answer && constraint.allowNoOptions && constraint.total === 0) {
    const empty = { requestId: request.requestId, optionIds: [], allocation: [] };
    if (validSelectionAnswer(request, empty)) answer = empty;
  }
  return answer;
}

function chooseSelection(request) {
  const empty = { requestId: request.requestId, optionIds: [], allocation: [] };
  if (request.constraints.kind === 'random') return validSelectionAnswer(request, empty) ? empty : null;
  if (request.constraints.kind === 'allocation') return chooseAllocation(request);
  const options = [...request.options];
  const chosen = [];
  let attempts = 0;
  const search = (start, count) => {
    if (attempts > 50000) return null;
    if (count === 0) {
      attempts += 1;
      const answer = { requestId: request.requestId, optionIds: [...chosen], allocation: [] };
      return validSelectionAnswer(request, answer) ? answer : null;
    }
    for (let index = start; index <= options.length - count; index += 1) {
      chosen.push(options[index].optionId);
      const found = search(index + 1, count - 1);
      chosen.pop();
      if (found) return found;
    }
    return null;
  };
  const minimum = request.constraints.minimum ?? 0;
  const maximum = Math.min(request.constraints.maximum ?? minimum, options.length);
  for (let count = minimum; count <= maximum; count += 1) {
    const answer = search(0, count);
    if (answer) return answer;
  }
  return null;
}

const actionType = entry => entry.actionType ?? entry.action?.type ?? 'unknown';
const actionPriority = type => ({ openingMulligan: 0, install: 1, activateAbility: 2, executeLayered: 3,
  executeCard: 4, executeSpell: 5, mountCard: 6, setScript: 7, executeRegistry: 8,
  activateCardEffect: 9, activateScript: 10, attack: 11, redeploy: 12, recoverRegistry: 13,
  endTurn: 100 }[type] ?? 50);

function orderedLegalActions(query) {
  return [...query.legalActions].sort((left, right) => actionPriority(actionType(left)) - actionPriority(actionType(right)));
}

async function completeAction(page, query, entry) {
  if (entry.kind === 'fixed') return clone(entry.action);
  if (entry.kind === 'template') {
    if (entry.actionType !== 'executeLayered') throw new Error(`unsupported safe template ${entry.actionType}`);
    const materials = entry.parameters?.materials;
    const destinations = entry.parameters?.destination?.options;
    if (!materials || !Array.isArray(materials.options) || !Array.isArray(materials.groups)
      || !Array.isArray(destinations) || destinations.length === 0) {
      throw new Error('incomplete executeLayered template');
    }
    const request = { requestId: `${entry.actionId}:materials`, presentationKey: 'layered-materials',
      options: materials.options, constraints: { kind: 'pick', minimum: materials.minimum,
        maximum: materials.maximum, aggregate: null, groups: materials.groups, assignment: materials.assignment } };
    const answer = chooseSelection(request, query.status.viewerSeat);
    if (!answer) throw new Error('no safe layered material assignment');
    const byId = new Map(materials.options.map(option => [option.optionId, option.cardRef]));
    const destination = destinations[0];
    return { type: 'executeLayered', cardRef: entry.base.cardRef,
      materialRefs: answer.optionIds.map(optionId => byId.get(optionId)),
      destination: { zone: destination.zone, slot: destination.slot } };
  }
  const selections = [];
  for (let stage = 0; stage < 16; stage += 1) {
    const planned = await hook(page, 'queryAction', { expectedRevision: query.status.revision,
      actionId: entry.actionId, selections }, query.status.viewerSeat);
    if (!planned?.ok) throw new Error(`queryAction failed: ${planned?.error?.code ?? 'UNKNOWN'}`);
    if (planned.value.completion) return clone(planned.value.completion.action);
    const request = planned.value.selectionRequests?.[0];
    if (!request) throw new Error(`queryAction ${entry.actionId} has neither completion nor selection`);
    const answer = chooseSelection(request, query.status.viewerSeat);
    if (!answer) throw new Error(`no safe answer for ${request.presentationKey}`);
    selections.push(answer);
  }
  throw new Error(`queryAction ${entry.actionId} exceeded 16 stages`);
}

async function submit(page, query, action, profile, counters) {
  const commandId = `e2e:${profile}:${++commandSerial}`;
  const result = await hook(page, 'submit', { commandId, expectedRevision: query.status.revision, action }, query.status.viewerSeat);
  if (!result?.ok || result.value?.kind !== 'accepted' || result.value.receipt?.status !== 'accepted') {
    throw new Error(`command ${action.type} was not accepted: ${JSON.stringify(result)}`);
  }
  counters.driverActions += 1;
  if (action.type === 'install') counters.install += 1;
  else if (action.type === 'attack') counters.attack += 1;
  else if (!['endTurn', 'activateAbility', 'answerChoice', 'declineChoice', 'openingMulligan'].includes(action.type)) counters.play += 1;
  trace.push({ at: now(), profile, kind: 'submit', actionType: action.type,
    before: safeSummary(query), receipt: clone(result.value.receipt) });
  return result.value;
}

async function answerRequiredInput(page, query, profile, counters) {
  const input = query.requiredInput;
  if (!input?.canAnswer) return false;
  if (input.optional) {
    await submit(page, query, { type: 'declineChoice', choiceId: input.choiceId }, profile, counters);
    return true;
  }
  const request = { requestId: input.choiceId, presentationKey: input.presentationKey,
    options: input.options, constraints: input.constraints };
  const answer = chooseSelection(request, query.status.viewerSeat);
  const action = answer ? { type: 'answerChoice', choiceId: input.choiceId,
    optionIds: answer.optionIds, allocation: answer.allocation }
    : null;
  if (!action) throw new Error(`mandatory choice ${input.presentationKey} has no safe answer`);
  await submit(page, query, action, profile, counters);
  return true;
}

async function waitForOpponent(page, profile, counters, initial) {
  let query = initial;
  let key = stateKey(query);
  let progressedAt = Date.now();
  for (;;) {
    if (query.status.finished || query.status.activeSeat === query.status.viewerSeat
      && (!query.requiredInput || query.requiredInput.canAnswer)) return query;
    await wait(200);
    query = await safeQuery(page);
    const nextKey = stateKey(query);
    if (nextKey !== key) {
      key = nextKey;
      progressedAt = Date.now();
      counters.opponentProgress = true;
      trace.push({ at: now(), profile, kind: 'opponent-progress', state: safeSummary(query) });
    }
    if (Date.now() - progressedAt > STALL_MS) throw new Error('opponent safe state remained unchanged beyond 60 seconds');
  }
}

async function firstVisible(page, selector) {
  const nodes = page.locator(selector);
  for (let index = 0; index < await nodes.count(); index += 1) {
    const node = nodes.nth(index);
    if (await node.isVisible()) return node;
  }
  return null;
}

async function failureEvidence(page, profile, error) {
  let query = null;
  try { query = safeSummary(await safeQuery(page)); } catch {}
  const screenshot = path.join(evidenceRoot, `${profile.id}-failure.png`);
  try { await page.screenshot({ path: screenshot, fullPage: true }); } catch {}
  const failure = { profile: profile.id, at: now(), error: compactError(error), query, screenshot };
  await writeFile(path.join(evidenceRoot, `${profile.id}-failure.json`), `${JSON.stringify(failure, null, 2)}\n`, 'utf8');
  return failure;
}

async function runProfile(browser, profile) {
  const context = await browser.newContext({ viewport: profile.viewport });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => { if (pageErrors.length < 20) pageErrors.push(compactError(error)); });
  const counters = { driverActions: 0, play: 0, install: 0, attack: 0, opponentProgress: false };
  try {
    const target = new URL(profile.route, url);
    target.searchParams.set('e2e', '1');
    await page.goto(target.toString(), { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.setItem('sz-ui-effects', 'on'));
    await page.reload({ waitUntil: 'networkidle' });
    const started = await hook(page, 'start', 'ai', 'basics', profile.seed);
    if (!started?.ok) throw new Error(`safe match start failed: ${started?.error?.code ?? 'UNKNOWN'}`);
    await page.locator('.r2-board').waitFor({ state: 'visible' });
    const initial = await safeQuery(page);
    const initialScope = started.value;
    const own = initial.observation.seats.find(seat => seat.seatId === 'player');
    const opponent = initial.observation.seats.find(seat => seat.seatId === 'ai');
    if (initial.status.revision !== 0 || initial.observation.turnNumber !== 1 || initial.status.activeSeat !== 'player'
      || own.front.cards.length || own.back.cards.length || opponent.front.cards.length || opponent.back.cards.length) {
      throw new Error('AI match did not start from an ordinary safe first-turn projection');
    }
    if (own.user.definitionId !== 'DOORS-ZX' || opponent.user.definitionId !== 'DOORS-ZX'
      || own.hand.count <= 0 || opponent.hand.count <= 0 || own.deck.count <= 0 || opponent.deck.count <= 0) {
      throw new Error(`AI match defaults drifted: ${JSON.stringify(safeSummary(initial))}`);
    }
    const initialRecord = { scope: initialScope, state: safeSummary(initial), users: [own.user.definitionId, opponent.user.definitionId] };
    trace.push({ at: now(), profile: profile.id, kind: 'semantic-match-start', seed: profile.seed, ...initialRecord });
    let query = initial;
    while (!query.status.finished) {
      if (counters.driverActions >= MAX_ACTIONS) throw new Error(`driver action limit reached: ${MAX_ACTIONS}`);
      if (query.observation.turnNumber > MAX_TURNS) throw new Error(`turn limit reached: ${MAX_TURNS}`);
      if (query.status.activeSeat !== query.status.viewerSeat || query.requiredInput && !query.requiredInput.canAnswer) {
        query = await waitForOpponent(page, profile.id, counters, query);
        continue;
      }
      if (await answerRequiredInput(page, query, profile.id, counters)) {
        query = await safeQuery(page);
        continue;
      }
      let action = null;
      for (const entry of orderedLegalActions(query)) {
        try {
          action = await completeAction(page, query, entry);
          if (action) break;
        } catch (error) {
          trace.push({ at: now(), profile: profile.id, kind: 'plan-skip', revision: query.status.revision,
            actionId: entry.actionId, actionType: actionType(entry), reason: String(error?.message ?? error).slice(0, 300) });
        }
      }
      if (!action) throw new Error(`no safely completable legal action at revision ${query.status.revision}`);
      await submit(page, query, action, profile.id, counters);
      query = await safeQuery(page);
    }
    const outcome = query.status.lockedOutcome;
    if (!outcome || !['win', 'draw'].includes(outcome.kind)) throw new Error('natural finish lacks a safe locked outcome');
    if (query.requiredInput !== null) throw new Error('natural finish retained required input');
    if (!counters.play || !counters.install || !counters.attack || !counters.opponentProgress) {
      throw new Error(`required observed actions are incomplete: ${JSON.stringify(counters)}`);
    }
    if (pageErrors.length) throw new Error(`page errors observed: ${JSON.stringify(pageErrors)}`);
    const displayed = outcome.kind === 'draw' ? 'draw' : outcome.winnerSeat === query.status.viewerSeat ? 'victory' : 'defeat';
    const resultDialog = page.locator('.r2-result[aria-label="対局結果"]');
    await resultDialog.waitFor({ state: 'visible' });
    if (await resultDialog.getAttribute('data-outcome') !== displayed) {
      throw new Error(`visible result differs from safe outcome: ${displayed}`);
    }
    const rematch = await firstVisible(page, '[data-runtime-rematch]');
    const title = await firstVisible(page, '.r2-result [data-runtime-title]');
    if (!rematch || !title || !await rematch.isEnabled() || !await title.isEnabled()) {
      throw new Error('result does not expose enabled rematch and title controls');
    }
    const screenshot = path.join(evidenceRoot, `${profile.id}-end.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await title.click();
    await page.locator('.r2-entry').waitFor({ state: 'visible' });
    if (!await firstVisible(page, '[data-mode="ai"]')) throw new Error('title return did not restore the AI entry control');
    trace.push({ at: now(), profile: profile.id, kind: 'title-return', state: safeSummary(query), displayed });
    return { id: profile.id, route: profile.route, seed: profile.seed, viewport: profile.viewport, state: 'passed', initial: initialRecord,
      final: { turnNumber: query.observation.turnNumber, lockedOutcome: outcome, finished: true, displayed },
      actionCounts: counters, pageErrors, screenshot,
      observedCoverage: ['deterministic-semantic-start', 'safe-query-only', 'player-install', 'player-play', 'player-attack',
        'opponent-turn-progress', 'finished-result', 'title-return'],
      unencounteredCoverage: ['all-card-effects', 'all-selection-kinds', 'all-end-effect-boundaries'] };
  } catch (error) {
    const failure = await failureEvidence(page, profile, error);
    throw Object.assign(error, { matchFailure: failure });
  } finally {
    await context.close();
  }
}

await mkdir(evidenceRoot, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
try {
  for (const profile of profiles) results.push(await runProfile(browser, profile));
  const exact = results.map(result => result.id);
  if (JSON.stringify(exact) !== JSON.stringify(['pc', 'mobile']) || results.some(result => result.state !== 'passed')) {
    throw new Error('profile result set is not exact pc/mobile PASS');
  }
  if (!results.some(result => result.final.turnNumber > 10)) throw new Error('neither natural match progressed beyond turn 10');
  const result = { schema_version: 2, driverContract: ['query', 'queryAction', 'submit', 'scope'],
    forbiddenContract: ['getState', 'setState'], url, seeds: Object.fromEntries(profiles.map(profile => [profile.id, profile.seed])),
    results, exactProfiles: ['pc', 'mobile'], ok: true };
  await writeFile(path.join(evidenceRoot, 'match-trace.json'), `${JSON.stringify({ schema_version: 2, trace }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(evidenceRoot, 'match-results.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ evidenceRoot, results: results.map(({ id, state, final, actionCounts }) => ({ id, state, final, actionCounts })), ok: true }));
} catch (error) {
  const result = { schema_version: 2, driverContract: ['query', 'queryAction', 'submit', 'scope'], url,
    seeds: Object.fromEntries(profiles.map(profile => [profile.id, profile.seed])),
    results, failure: error.matchFailure ?? { error: compactError(error) }, ok: false };
  await writeFile(path.join(evidenceRoot, 'match-trace.json'), `${JSON.stringify({ schema_version: 2, trace }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(evidenceRoot, 'match-results.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.error(JSON.stringify({ evidenceRoot, failure: result.failure, ok: false }));
  process.exitCode = 1;
} finally {
  await browser.close();
}
