import test from "node:test";
import assert from "node:assert/strict";
import { compileEffectText, normalizeCardCategory } from "../src/game/effect-compiler.js";
import { CARD_LIBRARY, LAB_CARD_IDS, createCardInstance, createToken, normalizeCardClasses } from "../src/data/cards.js";
import { CARD_ART } from "../src/data/card-art.generated.js";
import { isObCard } from "../src/game/card-types.js";
const STD_SUPPORTED_CARDS = CARD_LIBRARY;
const VENGEANCE_CARDS = Object.fromEntries(Object.entries(CARD_LIBRARY).filter(([id]) => /^STD-(18[7-9]|19\d|20\d|21[0-2])$/.test(id)));
const NEUTRON_CARDS = Object.fromEntries(Object.entries(CARD_LIBRARY).filter(([id]) => /^STD-(10[7-9]|11\d|12[0-4])$/.test(id)));
import { BUILDABLE_CARDS, DECK_COLOR_OPTIONS, DECK_STRATEGIES, MAX_SAVED_DECKS, deckToRecipe, loadSavedDecks, recommendDeck, saveDeckCollection, validateDeck } from "../src/game/deck-builder.js";
import {
  activateScript,
  activateCardEffect,
  activateResponse,
  activateTurbo,
  canActivateTurbo,
  addSandboxCardToHand,
  canAddSandboxCardToHand,
  attack,
  canAttack,
  canExecuteRegistryCard,
  canPlayCard,
  cardAtk,
  cardCurrentStr,
  cardHasKeyword,
  cardMaxStr,
  cloneForHistory,
  configurePlugin,
  buildProjectionSpec,
  clearProjection,
  commitProjection,
  coordinatorProjectionBlocked,
  createGame,
  dealCardDamage,
  dealFortressDamage,
  declinePrompt,
  declineResponse,
  discardMountedCard,
  destroyCard,
  endTurn,
  executeRegistryCard,
  executionCost,
  findCard,
  finishGameIfSettled,
  getEffectTargets,
  getActivatableEffects,
  getAttackTargets,
  getLayeredCandidates,
  getLayeredRequirement,
  getMaxMemory,
  installCard,
  openingMulligan,
  keepOpeningHand,
  canOpeningMulligan,
  drawCards,
  emitGameEvent,
  playCard,
  playLayeredCard,
  recoverRegistryCard,
  restSecurity,
  relogCard,
  resolveLuckyShotAdditional,
  resolveVariableExpression,
  resolveCardSelection,
  resolveAccessDragPlacement,
  resolveTriggerChoice,
  resolveSamLogin,
  replaceProjection,
  restoreProjection,
  enqueueLegacyProjection,
  promoteLegacyQueueHead,
  startTurn,
  supportsDirectHandObExecution
} from "../src/game/engine.js";
import { canConfirmSelection, collectDeckScopeOptions, confirmSelection, createAllocationSpec, createChoiceSpec, createGroupedSelectionSpec, createRandomSelectionSpec, createSelectionRequest, createSelectionSpec, hasExactAggregateCombination, isSelectionRequestFeasible, selectionRequestFromSpec, setAllocation, setSelectionScope, toggleSelection } from "../src/game/selection-model.js";
import { resolveAutomatedAiChoices, runSimpleAiTurn, runSimpleAiTurnSteps } from "../src/game/ai.js";
import { chooseSimpleAiIntent } from "../src/adapters/simple-ai-policy.js";
import { accessPolicy, deckMovePolicy, destructionOutcome, resultCountGate } from "../src/game/effect-operation-library.js";
import { parseDynamicThresholdSelectionModule, parseLookSelectRemainderModule, parseSelectAllocateFollowUpModule } from "../src/game/effect-selection-modules.js";
import { collectActivationWindows, createEventContext, createTriggerSpec, scriptConditionMatches } from "../src/game/activation-windows.js";
import { acceptTutorialAction, completeTutorialIntroduction, createTutorialFlow, currentTutorialPresentation } from "../src/data/tutorial.js";
import { evaluatePlacement } from "../src/game/placement-policy.js";
import { normalizeLayerState } from "../src/game/layer-state.js";

test("effect compiler extracts keyword and numeric operation", () => {
  const parsed = compileEffectText("[ログイン] 相手Ob1体に3ダメージ。カードを2枚引く。");
  assert.equal(parsed.status, "supported");
  assert.equal(parsed.keywords[0].name, "LOGIN");
  assert.deepEqual(parsed.operations.map((item) => item.type), ["deal_damage", "draw"]);
  assert.equal(parsed.operations[0].value, 3);
});

test("direct hand Ob execution capability excludes pre-placement input routes", () => {
  assert.equal(supportsDirectHandObExecution(CARD_LIBRARY["STD-027"]), true);
  assert.equal(supportsDirectHandObExecution(CARD_LIBRARY["STD-030"]), true);
  assert.equal(supportsDirectHandObExecution(CARD_LIBRARY["STD-085"]), false);
  assert.equal(supportsDirectHandObExecution(CARD_LIBRARY["STD-125"]), false);
  assert.equal(supportsDirectHandObExecution(CARD_LIBRARY["STD-121"]), false);
  assert.equal(supportsDirectHandObExecution({ ...CARD_LIBRARY["STD-027"], text: "[OC+0]" }), false);
  assert.equal(supportsDirectHandObExecution(CARD_LIBRARY["STD-184"]), false);
  assert.equal(supportsDirectHandObExecution(CARD_LIBRARY["STD-001"]), false);
});

test("effect compiler recognizes Magazine as a numeric execution keyword", () => {
  const parsed = compileEffectText("[弾倉:2]カードを2枚引く。", { category: "Sp" });
  assert.deepEqual(parsed.keywords.find((keyword) => keyword.name === "MAGAZINE"), { name: "MAGAZINE", value: 2, intrinsic: true });
  assert.equal(parsed.operations.find((operation) => operation.type === "draw")?.value, 2);
});

test("class normalization merges class, affiliation and tribe aliases", () => {
  assert.deepEqual(normalizeCardClasses({ classes: [" 所属A/所属B "], 所属: "所属B/所属A", 種族: "種族C", tribe: ["種族D，種族C"] }),
    ["所属A", "所属B", "種族D", "種族C"]);
});

test("TriggerSpec, EventContext and ActivationWindow share one declarative trigger boundary", () => {
  const state = createGame({ mode: "lab" });
  const sourceCard = state.players.player.hand.find((card) => card.id === "STD-191");
  state.players.player.hand.splice(state.players.player.hand.indexOf(sourceCard), 1);
  state.players.player.back.push(sourceCard);
  const context = createEventContext(state, { id: "EV-TEST", type: "card_moved", playerId: "player", ownerId: "player", cardUid: "moved", category: "Ob", from: "front", to: "back" });
  const spec = createTriggerSpec({ id: "test:move", cardId: "STD-191", event: "card_moved", conditions: [{ type: "event_card_owner_is_source_controller" }], actions: [] });
  const windows = collectActivationWindows(state, context, [spec], [{ playerId: "player", zoneName: "back", card: sourceCard }]);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].context, context);
  assert.equal(windows[0].controllerId, "player");
  assert.equal(windows[0].status, "pending");
  assert.equal(scriptConditionMatches(context, "player", "自分Obが破壊された時"), false);
  const destroyed = createEventContext(state, { id: "EV-DESTROY", type: "card_destroyed", playerId: "player", ownerId: "player", category: "Ob" });
  assert.equal(scriptConditionMatches(destroyed, "player", "自分Obが破壊された時"), true);
  assert.equal(scriptConditionMatches(destroyed, "ai", "相手Obが破壊された時"), true);
});

test("STD-159, STD-171 and STD-174 connect through common event activation windows", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const immortal = player.hand.find((card) => card.id === "STD-159");
  const statue = player.hand.find((card) => card.id === "STD-171");
  const beetle = player.hand.find((card) => card.id === "STD-174");
  player.hand.splice(player.hand.indexOf(immortal), 1);
  player.hand.splice(player.hand.indexOf(statue), 1);
  player.hand.splice(player.hand.indexOf(beetle), 1);
  player.front.push(immortal, statue, beetle);
  assert.equal(destroyCard(state, "player", immortal.uid, { source: "test", suppressReplacement: true }), false);
  assert.equal(player.front.includes(immortal), true);

  const victim = player.front.find((card) => card.id === "STD-020");
  player.deck = [createCardInstance("STD-020", "player", 9801), createCardInstance("STD-021", "player", 9802)];
  const handBefore = player.hand.length;
  assert.equal(destroyCard(state, "player", victim.uid, { source: "test", suppressReplacement: true }), true);
  assert.equal(immortal.tempAtk, 1);
  assert.equal(player.hand.length, handBefore + 1);

  const firstScript = player.hand.find((card) => card.id === "SZTB-090");
  const secondScript = player.hand.find((card) => card.id === "STD-118");
  assert.equal(playCard(state, "player", firstScript.uid, { zone: "back" }), true);
  assert.equal(playCard(state, "player", secondScript.uid, { zone: "back" }), true);
  beetle.sleep = true;
  assert.equal(activateScript(state, "player", firstScript.uid), true);
  assert.equal(beetle.permanentAtk, 1);
  assert.equal(beetle.sleep, false);
  assert.equal(activateScript(state, "player", secondScript.uid), true);
  assert.equal(beetle.permanentAtk, 1);
  assert.equal(state.activationWindows.filter((window) => window.spec.id === "STD-174:script-activated").length, 1);
});

test("STD-183 triggers on own Script activation and Insect effect placement only", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const morpho = player.hand.find((card) => card.id === "STD-183");
  player.hand.splice(player.hand.indexOf(morpho), 1);
  player.front.push(morpho);
  const script = player.hand.find((card) => card.id === "SZTB-090");
  assert.equal(playCard(state, "player", script.uid, { zone: "back" }), true);
  const fortressBeforeScript = state.players.ai.fortressStr;
  assert.equal(activateScript(state, "player", script.uid), true);
  assert.equal(state.players.ai.fortressStr, fortressBeforeScript - 2);

  addSandboxCardToHand(state, "player", "STD-173");
  let insect = player.hand.find((card) => card.id === "STD-173");
  const beforeNormal = state.players.ai.fortressStr;
  assert.equal(playCard(state, "player", insect.uid, { zone: "front", force: true, free: true }), true);
  assert.equal(state.players.ai.fortressStr, beforeNormal);

  addSandboxCardToHand(state, "player", "STD-173");
  insect = player.hand.find((card) => card.id === "STD-173");
  const beforeEffect = state.players.ai.fortressStr;
  assert.equal(playCard(state, "player", insect.uid, { zone: "back", force: true, free: true, placementCause: "effect", placementSource: "test effect" }), true);
  assert.equal(state.players.ai.fortressStr, beforeEffect - 2);
  assert.ok(state.events.some((event) => event.type === "card_effect_placed" && event.cardUid === insect.uid && event.traits.includes("インセクト")));

  addSandboxCardToHand(state, "player", "STD-020");
  const nonInsect = player.hand.find((card) => card.id === "STD-020");
  const beforeNonInsect = state.players.ai.fortressStr;
  assert.equal(playCard(state, "player", nonInsect.uid, { zone: "back", force: true, free: true, placementCause: "effect", placementSource: "test effect" }), true);
  assert.equal(state.players.ai.fortressStr, beforeNonInsect);
});

test("STD-186 opens one optional window per enemy draw and draws only when activated", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  addSandboxCardToHand(state, "player", "STD-186");
  const harvest = player.hand.find((card) => card.id === "STD-186");
  player.hand.splice(player.hand.indexOf(harvest), 1);
  harvest.faceDown = true;
  player.back.push(harvest);
  player.deck.push(...player.hand.splice(0, 2));
  addSandboxCardToHand(state, "ai", "STD-001");
  addSandboxCardToHand(state, "ai", "STD-002");
  state.players.ai.deck.push(...state.players.ai.hand.splice(0, 2));

  const ownDeckBefore = player.deck.length;
  drawCards(state, "player", 1);
  assert.equal(state.prompt, null);
  assert.equal(player.deck.length, ownDeckBefore - 1);

  drawCards(state, "ai", 1);
  const declinedWindow = state.activationWindows.at(-1);
  assert.equal(state.prompt?.scriptUid, harvest.uid);
  assert.equal(declinedWindow.spec.id, "STD-186:enemy-card-drawn");
  assert.equal(declinedWindow.status, "pending");
  assert.equal(declinePrompt(state), true);
  assert.equal(declinedWindow.status, "declined");
  assert.equal(player.back.includes(harvest), true);

  const handBefore = player.hand.length;
  drawCards(state, "ai", 1);
  const resolvedWindow = state.activationWindows.at(-1);
  assert.equal(activateScript(state, "player", harvest.uid), true);
  assert.equal(player.hand.length, handBefore + 1);
  assert.equal(player.back.includes(harvest), false);
  assert.equal(player.trash.includes(harvest), true);
  assert.equal(resolvedWindow.status, "resolved");
  assert.equal(state.prompt, null);
});

test("STD-186 expires queued draw windows after its first activation", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  addSandboxCardToHand(state, "player", "STD-186");
  const harvest = player.hand.find((card) => card.id === "STD-186");
  player.hand.splice(player.hand.indexOf(harvest), 1);
  harvest.faceDown = true;
  player.back.push(harvest);
  player.deck.push(...player.hand.splice(0, 1));
  addSandboxCardToHand(state, "ai", "STD-001");
  addSandboxCardToHand(state, "ai", "STD-002");
  state.players.ai.deck.push(...state.players.ai.hand.splice(0, 2));

  drawCards(state, "ai", 2);
  assert.equal(state.prompt?.scriptUid, harvest.uid);
  assert.equal(state.scriptActivationQueue.length, 1);
  assert.equal(activateScript(state, "player", harvest.uid), true);
  assert.equal(state.prompt, null);
  assert.equal(state.scriptActivationQueue.length, 0);
  const windows = state.activationWindows.filter((window) => window.spec.id === "STD-186:enemy-card-drawn");
  assert.deepEqual(windows.map((window) => window.status), ["resolved", "declined"]);
});

test("STD-197 triggers once per turn on enemy execution, accesses the same category and places Dolls", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const trickick = player.hand.find((card) => card.id === "STD-197");
  player.hand.splice(player.hand.indexOf(trickick), 1);
  player.front.push(trickick);

  const accessed = player.hand.find((card) => card.category === "Ob" && card.uid !== trickick.uid);
  player.hand.splice(player.hand.indexOf(accessed), 1);
  player.deck.push(accessed);
  addSandboxCardToHand(state, "ai", "STD-189");
  const firstEnemy = state.players.ai.hand.find((card) => card.id === "STD-189");
  assert.equal(playCard(state, "ai", firstEnemy.uid, { zone: "front", free: true, force: true }), true);
  assert.equal(player.hand.some((card) => card.uid === accessed.uid), true);
  assert.equal([...player.front, ...player.back].filter((card) => card.id === "STD-189").length, 1);
  assert.equal(player.triggerUsage["STD-197:enemy-executed"], true);

  const secondAccess = player.hand.find((card) => card.category === "Ob" && card.uid !== accessed.uid);
  player.hand.splice(player.hand.indexOf(secondAccess), 1);
  player.deck.push(secondAccess);
  addSandboxCardToHand(state, "ai", "STD-189");
  const secondEnemy = state.players.ai.hand.find((card) => card.id === "STD-189");
  playCard(state, "ai", secondEnemy.uid, { zone: "back", free: true, force: true });
  assert.equal(player.hand.some((card) => card.uid === secondAccess.uid), false);
  assert.equal([...player.front, ...player.back].filter((card) => card.id === "STD-189").length, 1);
});

test("STD-208 reduces every enemy Ob by -1/0 whenever a Dolls Ob is destroyed while resident", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const enemy = state.players.ai;
  const thread = player.hand.find((card) => card.id === "STD-208");
  player.hand.splice(player.hand.indexOf(thread), 1);
  thread.faceDown = true;
  player.back.push(thread);
  player.memory = 10;
  assert.equal(activateScript(state, "player", thread.uid), true);
  assert.equal(thread.residentActive, true);

  const dolls = player.hand.find((card) => card.id === "STD-189");
  player.hand.splice(player.hand.indexOf(dolls), 1);
  player.front.push(dolls);
  addSandboxCardToHand(state, "ai", "STD-189");
  addSandboxCardToHand(state, "ai", "STD-189");
  const targets = state.players.ai.hand.splice(0, 2);
  enemy.front.push(targets[0]);
  enemy.back.push(targets[1]);
  assert.equal(destroyCard(state, "player", dolls.uid, { source: "test", suppressReplacement: true }), true);
  assert.deepEqual(targets.map((card) => card.tempAtk), [-1, -1]);
  assert.deepEqual(targets.map((card) => card.tempStr), [0, 0]);
  endTurn(state);
  assert.deepEqual(targets.map((card) => card.tempAtk), [0, 0]);
});

test("actual destruction count references short-circuit their dependent block at zero", () => {
  assert.deepEqual(resultCountGate(0), { count: 0, shouldResolveDependentBlock: false, zeroBehavior: "skip_dependent_block" });
  assert.deepEqual(resultCountGate(2), { count: 2, shouldResolveDependentBlock: true, zeroBehavior: "skip_dependent_block" });

  const cluster = compileEffectText("②任意の数だけ「聖樹」カードを破壊する。その後、破壊した枚数以下だけScriptをサルベージする。", { category: "Script" });
  const clusterDestroy = cluster.operations.find((operation) => operation.type === "destroy");
  assert.equal(clusterDestroy.minimum, 0);
  assert.equal(clusterDestroy.optionalSelection, true);
  assert.equal(clusterDestroy.recordOperationCountAs, "destroy_attempts");
  assert.deepEqual(cluster.clauses[1].resultReference?.gate, { minimum: 1, zeroBehavior: "skip_dependent_block" });

  const bargain = compileEffectText("自分のObを好きな数破壊する。こうして破壊したOb一体につき①または②を1回起動する。", { category: "Sp" });
  assert.equal(bargain.operations.find((operation) => operation.type === "destroy")?.minimum, 0);
  assert.deepEqual(bargain.clauses[1].resultReference, {
    type: "recorded_operation_count", operation: "destroy", countField: "attemptedCount", record: "destroyed_ob_attempts", filter: { category: "Ob" },
    gate: { minimum: 1, zeroBehavior: "skip_dependent_block" }
  });
});

test("common selection specs cover grouped, random, choice, aggregate and allocation flows", () => {
  const aggregate = selectionRequestFromSpec(createSelectionSpec({
    candidates: ["a", "b", "c"], minimum: 0, maximum: 3,
    aggregateConstraint: { comparator: "=", value: 2, candidateValues: { a: 1, b: 1, c: 3 } }
  }));
  toggleSelection(aggregate, "a");
  assert.equal(canConfirmSelection(aggregate), false);
  toggleSelection(aggregate, "b");
  assert.equal(canConfirmSelection(aggregate), true);

  const grouped = selectionRequestFromSpec(createGroupedSelectionSpec({ groups: [
    { id: "own", candidates: ["o1", "o2"], minimum: 1, maximum: 1 },
    { id: "enemy", candidates: ["e1"], minimum: 1, maximum: 1 }
  ] }));
  toggleSelection(grouped, "o1");
  toggleSelection(grouped, "e1");
  assert.deepEqual(confirmSelection(grouped), { selected: ["o1", "e1"] });

  const random = selectionRequestFromSpec(createRandomSelectionSpec({ perPool: true, pools: [
    { id: "hand", candidates: ["h1", "h2"], count: 1 }, { id: "trash", candidates: ["t1"], count: 1 }
  ] }));
  assert.deepEqual(confirmSelection(random, () => 0), { selected: ["h1", "t1"], random: true, byPool: true });

  const choice = selectionRequestFromSpec(createChoiceSpec({ options: ["①", "②"] }));
  setSelectionScope(choice, "②");
  assert.deepEqual(confirmSelection(choice), { choice: "②", selected: [] });

  const allocation = selectionRequestFromSpec(createAllocationSpec({ targets: ["x", "y"], total: 4 }));
  setAllocation(allocation, "x", 1);
  setAllocation(allocation, "y", 3);
  assert.equal(canConfirmSelection(allocation), true);
  assert.deepEqual(confirmSelection(allocation), { selected: ["x", "y"], allocation: { x: 1, y: 3 }, total: 4 });
  const emptyAllocation = selectionRequestFromSpec(createAllocationSpec({ targets: [], total: 4, allowNoTargets: true }));
  assert.equal(canConfirmSelection(emptyAllocation), true);
});

test("exact aggregate selection requires a feasible combination and exact confirmation", () => {
  const values = { a: 1, b: 1, c: 2, d: 3 };
  assert.equal(hasExactAggregateCombination({ candidates: Object.keys(values), candidateValues: values, exactTotal: 2, minimum: 1, maximum: 4 }), true);
  assert.equal(hasExactAggregateCombination({ candidates: ["a", "d"], candidateValues: values, exactTotal: 2, minimum: 1, maximum: 2 }), false);
  const request = createSelectionRequest({ mode: "up_to", candidates: ["a", "b", "d"], minimum: 1, maximum: 3, exactBudget: 2, candidateValues: values });
  assert.equal(isSelectionRequestFeasible(request), true);
  toggleSelection(request, "a");
  assert.equal(canConfirmSelection(request), false);
  toggleSelection(request, "b");
  assert.equal(canConfirmSelection(request), true);
  assert.deepEqual(confirmSelection(request), { selected: ["a", "b"] });
  const impossible = createSelectionRequest({ mode: "up_to", candidates: ["a", "d"], minimum: 1, maximum: 2, exactBudget: 2, candidateValues: values });
  assert.equal(isSelectionRequestFeasible(impossible), false);
  assert.equal(canConfirmSelection(impossible), false);
  const forgedDuplicate = createSelectionRequest({ mode: "up_to", candidates: ["a", "b"], minimum: 1, maximum: 2, exactBudget: 2, candidateValues: values });
  forgedDuplicate.selected = ["a", "a"];
  assert.equal(canConfirmSelection(forgedDuplicate), false);
  forgedDuplicate.selected = ["a", "outside"];
  assert.equal(canConfirmSelection(forgedDuplicate), false);
});

test("STD-102 compiles exact original-memory placement as an activation feasibility gate", () => {
  const card = CARD_LIBRARY["STD-102"];
  const compiled = compileEffectText(card.text, { category: card.category });
  const operation = compiled.operations.find((item) => item.type === "select_and_place");
  assert.equal(operation.aggregateConstraint.comparator, "=");
  assert.equal(operation.aggregateConstraint.value, 2);
  assert.equal(operation.requireFeasibleAtDeclaration, true);
  assert.equal(operation.onInfeasible, "cannot_activate");
});

test("Q3 layered attack cards 096 097 098 102 compile completely", () => {
  for (const id of ["STD-096", "STD-097", "STD-098", "STD-102"]) {
    const card = CARD_LIBRARY[id];
    const compiled = compileEffectText(card.text, { category: card.category });
    assert.equal(compiled.status, "supported", id);
    assert.equal(compiled.warnings.some((warning) => warning.code === "unparsed_effect_clause"), false, id);
  }
});

test("all printed Layered cards compile without residual effect clauses", () => {
  const layered = Object.values(CARD_LIBRARY).filter((card) => /\[レイヤード[:：]/.test(card.text));
  assert.equal(layered.length, 17);
  for (const card of layered) {
    const compiled = compileEffectText(card.text, { category: card.category, id: card.id });
    assert.equal(compiled.status, "supported", card.id);
    assert.deepEqual(compiled.warnings, [], card.id);
  }
});

test("STD-096 pays one layer optionally and stands after its attack", () => {
  const state = createGame({ mode: "lab" });
  const source = state.players.player.hand.find((card) => card.id === "STD-096");
  state.players.player.hand.splice(state.players.player.hand.indexOf(source), 1);
  source.mounted.push(createCardInstance("STD-092", "player", 99601));
  source.summoningSick = false;
  state.players.player.front.push(source);
  const target = getAttackTargets(state, "player", source)[0];
  assert.equal(attack(state, "player", source.uid, target.uid), true);
  setSelectionScope(state.pending.request, "レイヤー1枚を破棄して起動");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  toggleSelection(state.pending.request, source.mounted[0].uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.equal(source.mounted.length, 0);
  assert.equal(source.attackedThisTurn, true);
  assert.equal(source.sleep, false);
});

test("generic Layered costs consume exactly the layer selected by the user", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const source = player.hand.find((card) => card.id === "STD-096");
  player.hand.splice(player.hand.indexOf(source), 1);
  const layers = [
    createCardInstance("STD-020", "player", 99611),
    createCardInstance("STD-021", "player", 99612),
    createCardInstance("STD-022", "player", 99613)
  ];
  source.mounted.push(...layers);
  source.summoningSick = false;
  player.front.push(source);
  const target = getAttackTargets(state, "player", source)[0];
  assert.equal(attack(state, "player", source.uid, target.uid), true);
  setSelectionScope(state.pending.request, "レイヤー1枚を破棄して起動");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.deepEqual(state.pending.request.candidates, layers.map((layer) => layer.uid));
  state.pending = null;
  assert.equal(attack(state, "player", source.uid, target.uid), true);
  assert.equal(state.pending.request.mode, "scope");
  setSelectionScope(state.pending.request, "レイヤー1枚を破棄して起動");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  toggleSelection(state.pending.request, layers[1].uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.deepEqual(source.mounted.map((layer) => layer.uid), [layers[0].uid, layers[2].uid]);
  assert.ok(player.trash.some((card) => card.uid === layers[1].uid));
});

test("STD-097 battle choice caps incoming damage at one for attacker and defender", () => {
  const attacking = createGame({ mode: "lab" });
  const source = attacking.players.player.hand.find((card) => card.id === "STD-097");
  attacking.players.player.hand.splice(attacking.players.player.hand.indexOf(source), 1);
  source.mounted.push(createCardInstance("STD-092", "player", 99701));
  source.summoningSick = false;
  attacking.players.player.front.push(source);
  const target = attacking.players.ai.front.find((card) => card.category === "Ob" && card.id !== "STD-127" && Number(card.atk) > 0);
  target.sleep = true;
  assert.equal(attack(attacking, "player", source.uid, target.uid), true);
  setSelectionScope(attacking.pending.request, "レイヤー1枚を破棄して①を起動");
  assert.equal(resolveCardSelection(attacking, attacking.pending.request.continuation, confirmSelection(attacking.pending.request)), true);
  toggleSelection(attacking.pending.request, source.mounted[0].uid);
  assert.equal(resolveCardSelection(attacking, attacking.pending.request.continuation, confirmSelection(attacking.pending.request)), true);
  assert.equal(source.damage, 1);

  const defending = createGame({ mode: "lab" });
  const defender = defending.players.player.hand.find((card) => card.id === "STD-097");
  defending.players.player.hand.splice(defending.players.player.hand.indexOf(defender), 1);
  defender.owner = "ai";
  defender.mounted.push(createCardInstance("STD-092", "ai", 99702));
  defender.summoningSick = false;
  defender.sleep = true;
  defending.players.ai.front.unshift(defender);
  const attacker = defending.players.player.front[0];
  attacker.summoningSick = false;
  attacker.atk = 5;
  assert.equal(attack(defending, "player", attacker.uid, defender.uid), true);
  setSelectionScope(defending.pending.request, "レイヤー1枚を破棄して①を起動");
  assert.equal(resolveCardSelection(defending, defending.pending.request.continuation, confirmSelection(defending.pending.request)), true);
  toggleSelection(defending.pending.request, defender.mounted[0].uid);
  assert.equal(resolveCardSelection(defending, defending.pending.request.continuation, confirmSelection(defending.pending.request)), true);
  assert.equal(defender.damage, 1);
});

test("STD-098 counts only Lyd-Ob layers for login attack and QA", () => {
  const state = createGame({ mode: "lab" });
  const source = state.players.player.hand.find((card) => card.id === "STD-098");
  source.mounted.push(createCardInstance("STD-195", "player", 99881), createCardInstance("STD-205", "player", 99882));
  assert.equal(playCard(state, "player", source.uid, { zone: "front" }), true);
  assert.equal(cardAtk(state, "player", source), 9);
  assert.equal(cardHasKeyword(source, "QA"), true);
});

test("STD-102 requires exact two before cost, places the selected cards, then checks layers", () => {
  const state = createGame({ mode: "lab" });
  const source = state.players.player.hand.find((card) => card.id === "STD-102");
  state.players.player.hand.splice(state.players.player.hand.indexOf(source), 1);
  source.mounted.push(createCardInstance("STD-092", "player", 99801), createCardInstance("STD-092", "player", 99802));
  source.summoningSick = false;
  state.players.player.front.push(source);
  const oneA = createCardInstance("STD-020", "player", 99803);
  const oneB = createCardInstance("STD-009", "player", 99804);
  state.players.player.trash.push(oneA, oneB);
  const target = getAttackTargets(state, "player", source)[0];
  assert.equal(attack(state, "player", source.uid, target.uid), true);
  setSelectionScope(state.pending.request, "レイヤー1枚を破棄して起動");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  toggleSelection(state.pending.request, source.mounted[0].uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  toggleSelection(state.pending.request, oneA.uid);
  toggleSelection(state.pending.request, oneB.uid);
  assert.equal(canConfirmSelection(state.pending.request), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.ok(findCard(state, oneA.uid) && ["front", "back"].includes(findCard(state, oneA.uid).zoneName));
  assert.equal(source.mounted.length, 1);
  assert.equal(state.pending, null);
});

test("STD-102 may satisfy exact two with the layer paid into trash and does not open a second attack prompt", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const source = player.hand.find((card) => card.id === "STD-102");
  player.hand.splice(player.hand.indexOf(source), 1);
  const paidLayer = createCardInstance("STD-020", "player", 99811); paidLayer.cost = 2;
  source.mounted = [paidLayer]; source.summoningSick = false; player.front = [source]; player.trash = [];
  const target = getAttackTargets(state, "player", source)[0];
  assert.equal(attack(state, "player", source.uid, target.uid), true);
  setSelectionScope(state.pending.request, "レイヤー1枚を破棄して起動");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  toggleSelection(state.pending.request, paidLayer.uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  toggleSelection(state.pending.request, paidLayer.uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.ok(findCard(state, paidLayer.uid));
  assert.equal(state.pending, null);
});

test("Q3 corresponding-layer cards 103 104 106 compile completely", () => {
  for (const id of ["STD-103", "STD-104", "STD-106"]) {
    const card = CARD_LIBRARY[id];
    const compiled = compileEffectText(card.text, { category: card.category });
    assert.equal(compiled.status, "supported", id);
    assert.equal(compiled.warnings.length, 0, id);
  }
});

test("STD-103 adds one corresponding trash card to the bottom layer", () => {
  const state = createGame({ mode: "lab" });
  const host = state.players.player.hand.find((card) => card.id === "STD-195");
  state.players.player.hand.splice(state.players.player.hand.indexOf(host), 1);
  state.players.player.front.push(host);
  const dolls = createCardInstance("STD-189", "player", 91031);
  state.players.player.trash.push(dolls);
  const source = state.players.player.hand.find((card) => card.id === "STD-103");
  assert.equal(playCard(state, "player", source.uid, { zone: "back" }), true);
  toggleSelection(state.pending.request, host.uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  toggleSelection(state.pending.request, dolls.uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.equal(host.mounted[0].uid, dolls.uid);
});

test("STD-104 reveals a Lyd-Ob, accesses a corresponding card, and makes its execution cost one", () => {
  const state = createGame({ mode: "lab" });
  const target = state.players.player.hand.find((card) => card.id === "STD-195");
  const dolls = createCardInstance("STD-189", "player", 91041);
  state.players.player.deck.push(dolls);
  const spell = state.players.player.hand.find((card) => card.id === "STD-104");
  const before = state.players.player.memory;
  assert.equal(playCard(state, "player", spell.uid, { targetUid: target.uid }), true);
  toggleSelection(state.pending.request, dolls.uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.equal(state.players.player.hand.some((card) => card.uid === dolls.uid), true);
  assert.equal(executionCost(target, state, "player"), 1);
  assert.equal(playCard(state, "player", target.uid, { zone: "front" }), true);
  assert.equal(state.players.player.memory, before - 6);
  assert.equal(target.revealedExecutionCost, undefined);
});

test("STD-106 places two Junk Parts on attack and one through Proxy two", () => {
  const state = createGame({ mode: "lab" });
  const source = state.players.player.hand.find((card) => card.id === "STD-106");
  state.players.player.hand.splice(state.players.player.hand.indexOf(source), 1);
  source.summoningSick = false;
  state.players.player.front.push(source);
  const before = [...state.players.player.front, ...state.players.player.back].filter((card) => card.id === "STD-078").length;
  const target = getAttackTargets(state, "player", source)[0];
  assert.equal(attack(state, "player", source.uid, target.uid), true);
  assert.equal([...state.players.player.front, ...state.players.player.back].filter((card) => card.id === "STD-078").length, before + 2);

  const proxyState = createGame({ mode: "lab" });
  const proxy = proxyState.players.player.hand.find((card) => card.id === "STD-106");
  const effect = getActivatableEffects(proxyState, "player", proxy).find((item) => item.kind === "proxy");
  const proxyBefore = [...proxyState.players.player.front, ...proxyState.players.player.back].filter((card) => card.id === "STD-078").length;
  assert.equal(activateCardEffect(proxyState, "player", proxy.uid, effect.id), true);
  assert.equal([...proxyState.players.player.front, ...proxyState.players.player.back].filter((card) => card.id === "STD-078").length, proxyBefore + 1);
  assert.equal(proxyState.players.player.trash.some((card) => card.uid === proxy.uid), true);
});

test("STD-187, STD-219 and STD-232 compile their confirmed common selection rulings", () => {
  const std187 = compileEffectText("[ログイン]山札の上から3枚を見る。その中からメモリ3以下・紫のカードを選びそれを手札に加える。残りを山札の下に戻す。", { category: "Ob" });
  assert.equal(std187.selectionModules[0].module, "look_select_remainder");
  assert.equal(std187.selectionModules[0].lookCount, 3);
  assert.deepEqual(std187.selectionSpecs[0], { kind: "selection", source: "looked_cards", minimum: 1, maximum: 1, asMuchAsPossible: true, filter: { originalMemoryMaximum: 3, color: "紫" }, destination: "hand" });
  assert.equal(std187.selectionModules[0].remainder.position, "bottom");
  const std219 = compileEffectText("[ログイン]カード1枚にアクセスし、それをレジストリにインストールする。①これの攻撃時、レジストリからX以下のカードを選びそれをメモリを支払わず実行できる。(Xは自分のレジストリの枚数である。)", { category: "Ob" });
  assert.equal(std219.selectionSpecs[0].filter.originalMemoryMaximumFrom, "self_registry_count");
  assert.equal(std219.selectionModules[0].followUp.executionCost, 0);
  const std232 = compileEffectText("[ログアウト]相手エリアのObを好きな数選び、Xを割り振ってダメージを与える。その後、これのレイヤーを全て所有ユーザーのレジストリにインストールする。Xはこれのレイヤーが持つメモリの合計である。", { category: "Lyd-Ob" });
  assert.equal(std232.selectionSpecs[0].minimum, 0);
  assert.equal(std232.selectionSpecs[1].kind, "allocation");
  assert.equal(std232.selectionSpecs[1].totalFrom, "source_layer_original_memory_total");
});

test("selection effect modules vary counts, filters, owners and destinations without card IDs", () => {
  const look = parseLookSelectRemainderModule("山札の上から5枚を見る。その中からメモリ2以下・青のカード2枚を選びそれを手札に加える。残りを山札の上に戻す。");
  assert.equal(look.lookCount, 5);
  assert.equal(look.selection.maximum, 2);
  assert.deepEqual(look.selection.filter, { originalMemoryMaximum: 2, color: "青" });
  assert.equal(look.remainder.position, "top");

  const dynamic = parseDynamicThresholdSelectionModule("ゴミ箱からメモリX以下の黒のOb1体を選び配置する。Xは対象カードの元々のメモリである。");
  assert.equal(dynamic.selection.source, "trash");
  assert.equal(dynamic.selection.filter.originalMemoryMaximumFrom, "previous_selected_card_original_memory");

  const allocate = parseSelectAllocateFollowUpModule("自分エリアのCodeを任意の数選び、Xを割り振ってダメージを与える。Xはこれの元々のATKである。");
  assert.equal(allocate.selection.owner, "self");
  assert.equal(allocate.selection.category, "Code");
  assert.equal(allocate.allocation.totalFrom, "source_original_atk");
  assert.equal(allocate.followUp, null);
});

test("STD-187 login executes look-select-remainder through the common runtime", () => {
  const state = createGame({ mode: "lab", rng: () => 0 });
  const source = state.players.player.hand.find((card) => card.id === "STD-187");
  const eligible = createCardInstance("STD-192", "player", 9101);
  const ineligible = createCardInstance("STD-020", "player", 9102);
  state.players.player.deck = [ineligible, eligible];
  assert.equal(playCard(state, "player", source.uid, { zone: "front" }), true);
  assert.equal(state.pending.request.continuation.type, "selection-module-look");
  toggleSelection(state.pending.request, eligible.uid);
  const continuation = state.pending.request.continuation;
  assert.equal(resolveCardSelection(state, continuation, confirmSelection(state.pending.request)), true);
  assert.ok(state.players.player.hand.some((card) => card.uid === eligible.uid));
  assert.equal(state.players.player.deck[0].uid, ineligible.uid);
});

test("STD-219 login and attack use common access and dynamic-threshold runtime", () => {
  const state = createGame({ mode: "lab", rng: () => 0 });
  addSandboxCardToHand(state, "player", "STD-219");
  const source = state.players.player.hand.find((card) => card.id === "STD-219");
  const executable = createCardInstance("STD-020", "player", 9201);
  state.players.player.deck = [executable];
  assert.equal(playCard(state, "player", source.uid, { zone: "front" }), true);
  let continuation = state.pending.request.continuation;
  toggleSelection(state.pending.request, executable.uid);
  assert.equal(resolveCardSelection(state, continuation, confirmSelection(state.pending.request)), true);
  assert.ok(state.players.player.registry.some((card) => card.uid === executable.uid));
  source.summoningSick = false;
  const target = getAttackTargets(state, "player", source)[0];
  assert.equal(attack(state, "player", source.uid, target.uid), true);
  assert.equal(state.pending.request.continuation.type, "selection-module-dynamic");
  toggleSelection(state.pending.request, executable.uid);
  continuation = state.pending.request.continuation;
  assert.equal(resolveCardSelection(state, continuation, confirmSelection(state.pending.request)), true);
  assert.equal(state.players.player.registry.some((card) => card.uid === executable.uid), false);
});

test("STD-232 logout selects, allocates and moves layers through the common runtime", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  addSandboxCardToHand(state, "player", "STD-232");
  player.memory = 20;
  const sourceIndex = player.hand.findIndex((card) => card.id === "STD-232");
  const [source] = player.hand.splice(sourceIndex, 1);
  source.summoningSick = false;
  source.mounted = [createCardInstance("STD-020", "player", 9301), createCardInstance("STD-021", "player", 9302)];
  player.front.push(source);
  assert.equal(relogCard(state, "player", source.uid, "back"), true);
  const target = state.pending.request.candidates[0];
  toggleSelection(state.pending.request, target);
  let continuation = state.pending.request.continuation;
  assert.equal(resolveCardSelection(state, continuation, confirmSelection(state.pending.request)), true);
  setAllocation(state.pending.request, target, state.pending.request.spec.total);
  continuation = state.pending.request.continuation;
  assert.equal(resolveCardSelection(state, continuation, confirmSelection(state.pending.request)), true);
  assert.equal(source.mounted.length, 0);
  assert.equal(player.registry.length >= 2, true);
});

test("STD-232 moves both deck tops under itself after the mandatory turn-start draw", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const ai = state.players.ai;
  const source = player.hand.find((card) => card.id === "STD-232");
  player.hand.splice(player.hand.indexOf(source), 1);
  player.front = [source];
  const playerTop = createCardInstance("STD-020", "player", 9320);
  const aiLayerTop = createCardInstance("STD-021", "ai", 9321);
  const aiMandatoryDraw = createCardInstance("STD-022", "ai", 9322);
  const aiMandatoryDraw2 = createCardInstance("STD-023", "ai", 9323);
  player.deck = [playerTop];
  ai.deck = [aiLayerTop, aiMandatoryDraw, aiMandatoryDraw2];

  startTurn(state, "ai");

  assert.equal(ai.hand.some((card) => card.uid === aiMandatoryDraw.uid), true);
  assert.equal(ai.hand.some((card) => card.uid === aiMandatoryDraw2.uid), true);
  assert.deepEqual(source.mounted.map((card) => card.uid), [playerTop.uid, aiLayerTop.uid]);
  assert.deepEqual(source.mounted.map((card) => card.owner), ["player", "ai"]);
  assert.equal(player.deck.length, 0);
  assert.equal(ai.deck.length, 0);
});

test("STD-142 effect 1 places a Sacred Tree Script and its optional zero turn-end path resolves", () => {
  const state = createGame({ mode: "lab" });
  addSandboxCardToHand(state, "player", "STD-142");
  addSandboxCardToHand(state, "player", "STD-139");
  const source = state.players.player.hand.find((card) => card.id === "STD-142");
  const placed = state.players.player.hand.find((card) => card.id === "STD-139");
  assert.equal(playCard(state, "player", source.uid), true);
  assert.equal(activateScript(state, "player", source.uid), true);
  toggleSelection(state.pending.request, placed.uid);
  let continuation = state.pending.request.continuation;
  assert.equal(resolveCardSelection(state, continuation, confirmSelection(state.pending.request)), true);
  assert.equal(state.players.player.back.some((card) => card.uid === source.uid && !card.faceDown), true);
  assert.equal(state.players.player.back.some((card) => card.uid === placed.uid && card.faceDown), true);
  assert.equal(activateScript(state, "player", placed.uid), false);
  assert.equal(endTurn(state), false);
  continuation = state.pending.request.continuation;
  assert.equal(resolveCardSelection(state, continuation, confirmSelection(state.pending.request)), true);
  assert.equal(state.pending, null);
});

test("STD-163 destroys any chosen count and repeats a common choice once per attempted Ob", () => {
  const state = createGame({ mode: "lab" });
  addSandboxCardToHand(state, "player", "STD-163");
  addSandboxCardToHand(state, "player", "STD-020");
  const spell = state.players.player.hand.find((card) => card.id === "STD-163");
  const ob = state.players.player.hand.find((card) => card.id === "STD-020");
  assert.equal(playCard(state, "player", ob.uid, { zone: "front" }), true);
  state.players.player.deck = [
    createCardInstance("STD-020", "player", 9401),
    createCardInstance("STD-021", "player", 9402),
    createCardInstance("STD-022", "player", 9403)
  ];
  const deckBefore = state.players.player.deck.length;
  assert.equal(playCard(state, "player", spell.uid), true);
  toggleSelection(state.pending.request, ob.uid);
  let continuation = state.pending.request.continuation;
  assert.equal(resolveCardSelection(state, continuation, confirmSelection(state.pending.request)), true);
  assert.equal(state.pending.request.spec.kind, "choice");
  setSelectionScope(state.pending.request, "①カードを2枚引く");
  continuation = state.pending.request.continuation;
  assert.equal(resolveCardSelection(state, continuation, confirmSelection(state.pending.request)), true);
  assert.equal(state.players.player.deck.length, deckBefore - 2);
  assert.equal(state.pending, null);
});

test("STD-163 zero selection skips every dependent numbered effect", () => {
  const state = createGame({ mode: "lab" });
  addSandboxCardToHand(state, "player", "STD-163");
  const spell = state.players.player.hand.find((card) => card.id === "STD-163");
  const deckBefore = state.players.player.deck.length;
  assert.equal(playCard(state, "player", spell.uid), true);
  const continuation = state.pending.request.continuation;
  assert.equal(resolveCardSelection(state, continuation, confirmSelection(state.pending.request)), true);
  assert.equal(state.pending, null);
  assert.equal(state.players.player.deck.length, deckBefore);
  assert.equal(state.players.player.trash.some((card) => card.uid === spell.uid), true);
});

test("STD-163 choice 2 selects an enemy Ob and deals three damage", () => {
  const state = createGame({ mode: "lab" });
  addSandboxCardToHand(state, "player", "STD-163");
  addSandboxCardToHand(state, "player", "STD-020");
  const spell = state.players.player.hand.find((card) => card.id === "STD-163");
  const ownOb = state.players.player.hand.find((card) => card.id === "STD-020");
  assert.equal(playCard(state, "player", ownOb.uid, { zone: "front" }), true);
  assert.equal(playCard(state, "player", spell.uid), true);
  toggleSelection(state.pending.request, ownOb.uid);
  let continuation = state.pending.request.continuation;
  assert.equal(resolveCardSelection(state, continuation, confirmSelection(state.pending.request)), true);
  setSelectionScope(state.pending.request, "②相手Obに3ダメージ");
  continuation = state.pending.request.continuation;
  assert.equal(resolveCardSelection(state, continuation, confirmSelection(state.pending.request)), true);
  assert.equal(state.pending.request.continuation.type, "std163-damage");
  const enemyUid = state.pending.request.candidates[0];
  toggleSelection(state.pending.request, enemyUid);
  continuation = state.pending.request.continuation;
  assert.equal(resolveCardSelection(state, continuation, confirmSelection(state.pending.request)), true);
  assert.equal(findCard(state, enemyUid).card.damage, 3);
  assert.equal(state.pending, null);
});

test("STD-142 turn-end effect uses public face-up Sacred Trees and determined destruction count", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player; const ai = state.players.ai;
  const source = createCardInstance("STD-142", "player", 9501);
  const ownSacredTree = createCardInstance("STD-139", "player", 9502);
  const enemySacredTree = createCardInstance("STD-140", "ai", 9503); enemySacredTree.protect = 1;
  const hiddenSacredTree = createCardInstance("STD-139", "ai", 9504); hiddenSacredTree.faceDown = true;
  source.faceDown = false; source.residentActive = true;
  player.front = []; player.back = [source, ownSacredTree]; ai.front = []; ai.back = [enemySacredTree, hiddenSacredTree];

  assert.equal(endTurn(state), false);
  toggleSelection(state.pending.request, source.uid);
  let continuation = state.pending.request.continuation;
  assert.equal(resolveCardSelection(state, continuation, confirmSelection(state.pending.request)), true);
  assert.equal(player.trash.some((card) => card.uid === source.uid), true);
  assert.deepEqual(new Set(state.pending.validTargets), new Set([ownSacredTree.uid, enemySacredTree.uid]));
  toggleSelection(state.pending.request, ownSacredTree.uid);
  toggleSelection(state.pending.request, enemySacredTree.uid);
  continuation = state.pending.request.continuation;
  assert.equal(resolveCardSelection(state, continuation, confirmSelection(state.pending.request)), true);
  assert.equal(state.pending.request.maximum, 1);
  toggleSelection(state.pending.request, source.uid);
  continuation = state.pending.request.continuation;
  assert.equal(resolveCardSelection(state, continuation, confirmSelection(state.pending.request)), true);
  assert.equal(player.hand.some((card) => card.uid === source.uid), true);
  assert.equal(player.trash.some((card) => card.uid === ownSacredTree.uid), true);
  assert.equal(ai.back.some((card) => card.uid === enemySacredTree.uid), true);
  assert.equal(ai.back.some((card) => card.uid === hiddenSacredTree.uid), true);
  assert.equal(state.pending, null);
});

test("STD-211 skips its draw block when destruction records zero cards", () => {
  const state = createGame({ mode: "lab" });
  const scrap = state.players.player.hand.find((card) => card.id === "STD-211");
  const handBefore = state.players.player.hand.length;
  const deckBefore = state.players.player.deck.length;

  assert.ok(scrap);
  assert.equal(playCard(state, "player", scrap.uid, { selectionScope: "該当なし" }), true);
  assert.equal(state.players.player.deck.length, deckBefore);
  assert.equal(state.players.player.hand.length, handBefore - 1);
  assert.equal(state.log.some((entry) => entry.text.includes("破壊実績が0枚") && entry.text.includes("ドロー処理を行わず終了")), true);
});

test("STD-211 draws only for destruction that is actually determined", () => {
  const state = createGame({ mode: "sandbox" });
  const player = state.players.player;
  const scrap = createCardInstance("STD-211", "player", 211001);
  const indestructible = createCardInstance("STD-159", "player", 211002);
  const destroyed = createCardInstance("STD-020", "player", 211003);
  const drawn = createCardInstance("STD-021", "player", 211004);
  const armsBand = createCardInstance("SZTB-092", "player", 211005);
  indestructible.classes = ["検証クラス"]; destroyed.classes = ["検証クラス"];
  player.hand = [scrap]; player.front = [indestructible, destroyed, armsBand]; player.back = []; player.deck = [drawn]; player.memory = 10;

  assert.equal(playCard(state, "player", scrap.uid, { selectionScope: "検証クラス", force: true, ignoreColor: true }), true);
  assert.equal(player.front.some((card) => card.uid === indestructible.uid), true);
  assert.equal(player.trash.some((card) => card.uid === destroyed.uid), true);
  assert.deepEqual(player.hand.map((card) => card.uid), [drawn.uid]);
  assert.equal(state.pending, null);
  assert.equal([...player.front, ...player.back].some((card) => card.id === "SZTB-091"), false);
});

test("STD-211 waits for STD-003 before determining its destruction-count draw", () => {
  const state = createGame({ mode: "sandbox" });
  const player = state.players.player;
  const ai = state.players.ai;
  const scrap = createCardInstance("STD-211", "player", 211011);
  const target = createCardInstance("STD-020", "player", 211012);
  const drawn = createCardInstance("STD-021", "player", 211013);
  const ban = createCardInstance("STD-003", "ai", 211014);
  target.classes = ["検証クラス"]; ban.faceDown = true;
  player.hand = [scrap]; player.front = [target]; player.back = []; player.deck = [drawn]; player.memory = 10;
  ai.back = [ban]; ai.memory = 3;

  assert.equal(playCard(state, "player", scrap.uid, { selectionScope: "検証クラス", force: true, ignoreColor: true }), true);
  assert.equal(state.prompt?.scriptUid, ban.uid);
  assert.equal(player.hand.length, 0);
  assert.equal(declinePrompt(state), true);
  assert.equal(player.trash.some((card) => card.uid === target.uid), true);
  assert.deepEqual(player.hand.map((card) => card.uid), [drawn.uid]);
});

test("compiler recognizes conditional follow-up damage but rejects a dangling target reference", () => {
  const incomplete = compileEffectText("相手Ob1体に3ダメージ。それがスリープしているならさらに3ダメージ。", { category: "Sp" });
  assert.equal(incomplete.status, "supported");
  const complete = compileEffectText("相手Ob1体に3ダメージ。", { category: "Sp" });
  assert.equal(complete.status, "supported");
  const loginIncomplete = compileEffectText("[ログイン]それがスリープしているならさらに3ダメージ。相手Ob1体に3ダメージ。", { category: "Ob" });
  assert.equal(loginIncomplete.status, "partial");
  const qaReminder = compileEffectText("[QA]これを持ったObは配置されたターンに攻撃できます。", { category: "Ob" });
  assert.equal(qaReminder.status, "supported");
  assert.equal(qaReminder.warnings.some((warning) => warning.code === "unparsed_effect_clause"), false);
});

test("legacy condition syntax is normalized as an if trigger", () => {
  const parsed = compileEffectText("[条件:相手がカードを配置した時]Ob以外のカード1枚を破壊する。");
  assert.equal(parsed.keywords[0].name, "IF");
  assert.equal(parsed.keywords[0].value, "相手がカードを配置した時");
});

test("memory terminology compiles with P-in lifetime and zero cost floor", () => {
  const pin = compileEffectText("自分のメモリ上限を+2する。", { category: "P-in" });
  assert.deepEqual(pin.operations[0], { type: "modify_memory_limit", target: "self", value: 2, lifetime: "source_bound" });
  const discount = compileEffectText("ゴミ箱に同じ名称のあるカードを実行する時、その消費メモリを-1する。", { category: "P-in" });
  assert.equal(discount.operations[0].type, "modify_execution_cost");
  assert.equal(discount.operations[0].minimum, 0);
  assert.equal(discount.operations[0].stacking, "fixed");
  const jamming = compileEffectText("相手の実行メモリを+1する。", { category: "Code" });
  assert.equal(jamming.operations[0].target, "opponent_cards");
});

test("group stat changes are snapshot effects", () => {
  const parsed = compileEffectText("[アップデート:2]このターン中、自分のOb全てを+1/0する。");
  const operation = parsed.operations.find((item) => item.type === "modify_stats");
  assert.equal(operation.duration, "turn");
  assert.equal(operation.application, "snapshot");
});

test("Reboot records discarded count and draws from that result", () => {
  const parsed = compileEffectText("手札を全て捨てる。その後、捨てた枚数と同じだけカードを引く。");
  assert.deepEqual(parsed.operations.map((item) => item.type), ["discard", "draw"]);
  assert.equal(parsed.operations[0].allowZero, true);
  assert.equal(parsed.operations[1].valueFrom, "discarded_count");
});

test("Defrag only selects a player with cards in trash", () => {
  const parsed = compileEffectText("プレイヤーを1人選ぶ。そのプレイヤーはゴミ箱を全てデッキにもどす。");
  const selection = parsed.operations.find((item) => item.type === "select_player");
  assert.deepEqual(selection.eligibility, { zone: "trash", minimumCards: 1 });
  assert.equal(parsed.operations.some((item) => item.type === "move_all"), true);
  assert.equal(parsed.operations.some((item) => item.type === "shuffle"), true);
});

test("deck insertion shuffles unless a position or exception is specified", () => {
  assert.equal(deckMovePolicy({ direction: "into_deck" }).shuffleAfter, true);
  assert.equal(deckMovePolicy({ direction: "into_deck", position: "top" }).shuffleAfter, false);
  assert.equal(deckMovePolicy({ direction: "into_deck", position: "bottom" }).shuffleAfter, false);
  assert.equal(deckMovePolicy({ direction: "from_deck" }).shuffleAfter, false);
  assert.equal(deckMovePolicy({ direction: "into_deck", shuffle: false }).shuffleAfter, false);
});

test("Access shuffles the remaining deck before moving the accessed card", () => {
  assert.deepEqual(accessPolicy({ destination: "deck", position: "top" }).sequence, ["search", "shuffle_remaining_deck", "move_accessed_card"]);
  const parsed = compileEffectText("手札を1枚選び公開する。それと同じクラスを持つカード1枚にアクセスし、それを手札に加える。");
  const access = parsed.operations.find((item) => item.type === "access");
  assert.deepEqual(access.match, { kind: "shared_class", minimumShared: 1 });
  assert.equal(access.shuffleRemainingDeck, true);
  assert.equal(access.destination, "hand");
  assert.equal(access.requireResultAtDeclaration, true);
});

test("did-destroy references destruction determination including replacement", () => {
  const replaced = destructionOutcome({ determined: true, replacement: "backup", completed: false });
  assert.equal(replaced.succeededForDidClause, true);
  const negated = destructionOutcome({ determined: true, negated: true });
  assert.equal(negated.succeededForDidClause, false);
  const parsed = compileEffectText("相手Ob1体に3ダメージ。この効果でObを破壊したならカードを1枚引く。");
  const reference = parsed.clauses.find((clause) => clause.resultReference)?.resultReference;
  assert.deepEqual(reference, { type: "operation_succeeded", operation: "destroy", successField: "determined", includeReplacement: true });
});

test("plain adjacent effects share a simultaneous group but 'then' stays sequential", () => {
  const simultaneous = compileEffectText("[レスポンス:1]相手Ob1体に2ダメージ。相手ユーザーに1ダメージ。");
  assert.equal(simultaneous.clauses[0].resolutionGroup, simultaneous.clauses[1].resolutionGroup);
  assert.equal(simultaneous.clauses[0].resolutionMode, "simultaneous");
  const sequential = compileEffectText("対象を破壊する。その後、カードを1枚引く。");
  assert.notEqual(sequential.clauses[0].resolutionGroup, sequential.clauses[1].resolutionGroup);
});

test("STD-016 mount trigger invokes a numbered effect and grants one Backup component", () => {
  const parsed = compileEffectText("これにObがマウントした時①を適用しこれを破壊する。①マウントしたObは[バックアップ]を1得る。カードを1枚引く。");
  assert.equal(parsed.status, "supported");
  assert.equal(parsed.clauses[0].triggers[0].type, "ob_mounted_on_source");
  assert.deepEqual(parsed.operations.map((item) => item.type), ["apply_numbered_effect", "destroy", "grant_keyword", "draw"]);
  assert.deepEqual(parsed.operations.find((item) => item.type === "destroy"), { type: "destroy", target: "source" });
  assert.deepEqual(parsed.operations.find((item) => item.type === "grant_keyword"), {
    type: "grant_keyword",
    target: "mounted_ob",
    keyword: "バックアップ",
    amount: 1,
    lifetime: "persistent_component"
  });
});

test("STD-017 defaults bare Protect to one and keeps 0/+3 as a persistent modifier", () => {
  const parsed = compileEffectText("これにObがマウントした時①を適用しこれを破壊する。①マウントしたObは[プロテクト]を得て、0/+3する。");
  assert.equal(parsed.status, "supported");
  assert.equal(parsed.clauses[0].triggers[0].type, "ob_mounted_on_source");
  assert.deepEqual(parsed.operations.map((item) => item.type), ["apply_numbered_effect", "destroy", "grant_keyword", "modify_stats"]);
  assert.equal(parsed.operations.find((item) => item.type === "grant_keyword").amount, 1);
  assert.deepEqual(parsed.operations.find((item) => item.type === "modify_stats"), {
    type: "modify_stats",
    atk: 0,
    str: 3,
    duration: "persistent",
    application: "selected",
    target: "mounted_ob"
  });
});

test("STD-016 canonical runtime grants one persistent Backup use, draws, and destroys its Code", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  state.players.player.memory = 20;
  const source = createCardInstance("STD-016", "player", 1601);
  const host = createCardInstance("STD-022", "player", 1602);
  state.players.player.hand.push(source, host);
  state.players.player.deck.push(createCardInstance("STD-023", "player", 1603));
  const handBeforeDraw = state.players.player.hand.length;

  assert.equal(playCard(state, "player", source.uid, { zone: "front" }), true);
  assert.equal(playCard(state, "player", host.uid, { zone: "front", baseUid: source.uid }), true);
  assert.equal(host.backup, 1);
  assert.equal(host.mounted.some((card) => card.uid === source.uid), false);
  assert.equal(state.players.player.trash.some((card) => card.uid === source.uid), true);
  assert.equal(state.players.player.hand.length, handBeforeDraw - 1);

  host.summoningSick = false;
  assert.equal(destroyCard(state, "player", host.uid, { source: "test" }), true);
  assert.equal(host.backup, 0);
  assert.equal(state.players.player.back.some((card) => card.uid === host.uid), true);
  assert.equal(destroyCard(state, "player", host.uid, { source: "test" }), true);
  assert.equal(state.players.player.trash.some((card) => card.uid === host.uid), true);
});

test("STD-017 canonical runtime grants one Protect and persistent 0/+3 before destroying its Code", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  state.players.player.memory = 20;
  const source = createCardInstance("STD-017", "player", 1701);
  const host = createCardInstance("STD-022", "player", 1702);
  state.players.player.hand.push(source, host);

  assert.equal(playCard(state, "player", source.uid, { zone: "front" }), true);
  assert.equal(playCard(state, "player", host.uid, { zone: "front", baseUid: source.uid }), true);
  assert.equal(host.protect, 1);
  assert.equal(host.permanentAtk ?? 0, 0);
  assert.equal(host.permanentStr, 3);
  assert.equal(cardMaxStr(state, "player", host), 7);
  assert.equal(state.players.player.trash.some((card) => card.uid === source.uid), true);

  assert.equal(dealCardDamage(state, "player", host.uid, 2, "test"), true);
  assert.equal(host.protect, 0);
  assert.equal(host.damage, 0);
  assert.equal(cardMaxStr(state, "player", host), 7);
});

test("STD-016 and STD-017 do not trigger when inserted under an existing Ob", () => {
  for (const [index, id] of ["STD-016", "STD-017"].entries()) {
    const state = createGame({ mode: "sandbox", rng: () => 0.5 });
    state.players.player.memory = 20;
    const host = createCardInstance("STD-022", "player", 1800 + index * 2);
    const source = createCardInstance(id, "player", 1801 + index * 2);
    state.players.player.hand.push(host, source);
    assert.equal(playCard(state, "player", host.uid, { zone: "front" }), true);
    assert.equal(playCard(state, "player", source.uid, { zone: "front", underUid: host.uid }), true);
    assert.equal(host.mounted.some((card) => card.uid === source.uid), true);
    assert.equal(state.players.player.trash.some((card) => card.uid === source.uid), false);
    assert.equal(Number(host.backup ?? 0), 0);
    assert.equal(Number(host.protect ?? 0), 0);
    assert.equal(Number(host.permanentStr ?? 0), 0);
  }
});

test("STD-018 normalizes Sc and requires both its if trigger and an applicable effect at declaration", () => {
  assert.equal(normalizeCardCategory("Sc"), "Script");
  const parsed = compileEffectText("[if:相手がObを配置した時]そのObを破壊する。その後、相手は3回復する。", { category: "Sc" });
  assert.equal(parsed.status, "supported");
  assert.deepEqual(parsed.activationPolicy, {
    triggerConditionRequired: true,
    effectApplicabilityRequired: true,
    applicabilityScope: "primary_resolution_group",
    primaryResolutionGroup: 1,
    costsPayableRequired: false,
    triggerSubjectRequirements: null,
    recheckTriggerAtResolution: false,
    triggerCardinality: "once_per_event",
    triggerEventPolicy: null
  });
  assert.deepEqual(parsed.operations.map((item) => item.type), ["destroy", "recover_damage"]);
  assert.deepEqual(parsed.operations[0], { type: "destroy", target: "trigger_event_ob" });
  assert.deepEqual(parsed.operations[1], { type: "recover_damage", target: "opponent_user", value: 3, minimumDamage: 0 });
  assert.notEqual(parsed.clauses[0].resolutionGroup, parsed.clauses[1].resolutionGroup);
});

test("STD-019 requires a face-up colored trigger card and a same-color hand discard cost", () => {
  const parsed = compileEffectText("[if:カードを配置した時]そのカードと同じ色の自分の手札1枚を捨てて起動する。そのカードを破壊する。", { category: "Sc" });
  assert.equal(parsed.status, "supported");
  assert.deepEqual(parsed.costs, [{
    type: "discard",
    selector: { owner: "self", zones: ["hand"], count: 1, colorMatch: "trigger_event_card", requireColor: true, allowColorless: false }
  }]);
  assert.deepEqual(parsed.operations, [{ type: "destroy", target: "trigger_event_card" }]);
  assert.equal(parsed.activationPolicy.costsPayableRequired, true);
  assert.deepEqual(parsed.activationPolicy.triggerSubjectRequirements, { faceUp: true, hasColor: true, allowColorless: false });
});

test("STD-022 treats Security explanation as reminder text without duplicating operations", () => {
  const parsed = compileEffectText("[セキュリティ] Obが攻撃する時、「セキュリティ」を持つオブジェクトにしか攻撃対象を選択できません。ターン終了時にこれをスリープすることができます。", { category: "Ob" });
  assert.equal(parsed.status, "supported");
  assert.equal(parsed.reminderTextDetected, true);
  assert.equal(parsed.keywords.some((item) => item.name === "SECURITY"), true);
  assert.deepEqual(parsed.operations, []);
});

test("STD-023 through STD-025 keyword tutorials compile as reminder text", () => {
  const texts = [
    "[ハッキング] これを持つObは相手の[セキュリティ]を持つObを無視して攻撃できます。",
    "[暗号化]これを持つObは攻撃されません。",
    "[QA]これを持つObは配置されたターンに攻撃できます。"
  ];
  for (const text of texts) {
    const parsed = compileEffectText(text, { category: "Ob" });
    assert.equal(parsed.status, "supported");
    assert.equal(parsed.reminderTextDetected, true);
    assert.deepEqual(parsed.operations, []);
  }
});

test("STD-031 attack trigger resolves before combat without making the attack declaration illegal", () => {
  const parsed = compileEffectText("[QA]これを持ったObは配置されたターンに攻撃できます。このObの攻撃時に相手エリアのObを1体破壊する。", { category: "Ob" });
  assert.deepEqual(parsed.parentActionPolicy, {
    timing: "after_attack_declaration_before_combat",
    effectFailureCancelsParentAction: false,
    missingAttackTargetCancelsCombat: true
  });
});

test("STD-036 triggers once per destruction event including replacement but excluding prevention", () => {
  const parsed = compileEffectText("[if:自分Obが破壊された時]カードを2枚引く。", { category: "Script" });
  assert.equal(parsed.activationPolicy.triggerCardinality, "once_per_event");
  assert.deepEqual(parsed.activationPolicy.triggerEventPolicy, {
    event: "destruction",
    requiresDetermination: true,
    includeReplacement: true,
    excludePreventedOrNegated: true
  });
});

test("STD-037 consumes opponent memory as much as possible once per limit-increase event", () => {
  const parsed = compileEffectText("[if:相手のメモリ上限が効果で増加した時]相手のメモリを5消費する。", { category: "Script" });
  assert.equal(parsed.activationPolicy.triggerCardinality, "once_per_event");
  assert.deepEqual(parsed.operations, [{ type: "consume_memory", target: "opponent", value: 5, minimum: 0, asMuchAsPossible: true }]);
  assert.deepEqual(parsed.resolutionPolicy, { partialApplication: "as_much_as_possible", costsMustBePaidInFull: true });
});

test("STD-018 canonical Script destroys the placed enemy Ob then heals that opponent by three", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const script = createCardInstance("STD-018", "ai", 18001);
  script.faceDown = true;
  state.players.ai.back.push(script);
  const target = createCardInstance("STD-022", "player", 18002);
  state.players.player.hand.push(target);
  state.players.player.fortressStr = 14;
  state.players.player.memory = 20;

  assert.equal(playCard(state, "player", target.uid, { zone: "back", force: true, ignoreColor: true }), true);
  assert.equal(state.prompt?.scriptUid, script.uid);
  assert.equal(activateScript(state, "ai", script.uid), true);
  assert.equal(state.players.player.trash.some((card) => card.uid === target.uid), true);
  assert.equal(state.players.player.fortressStr, 17);
});

test("STD-019 canonical Script pays a same-color hand cost and destroys the triggering card", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const script = createCardInstance("STD-019", "ai", 19001);
  script.faceDown = true;
  const cost = createCardInstance("STD-076", "ai", 19002);
  state.players.ai.back.push(script);
  state.players.ai.hand.push(cost);
  const target = createCardInstance("STD-075", "player", 19003);
  state.players.player.hand.push(target);
  state.players.player.memory = 20;

  assert.equal(playCard(state, "player", target.uid, { zone: "back", force: true, ignoreColor: true }), true);
  assert.equal(state.prompt?.eventCardColor, "赤");
  assert.equal(activateScript(state, "ai", script.uid, { costUid: cost.uid }), true);
  assert.equal(state.players.ai.trash.some((card) => card.uid === cost.uid), true);
  assert.equal(state.players.player.trash.some((card) => card.uid === target.uid), true);
});

test("STD-031 resolves its chosen destruction after attack declaration and before combat", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const attacker = createCardInstance("STD-031", "player", 31001);
  attacker.summoningSick = false;
  const defender = createCardInstance("STD-022", "ai", 31002);
  defender.sleep = true;
  state.players.player.front.push(attacker);
  state.players.ai.front.push(defender);

  assert.equal(attack(state, "player", attacker.uid, defender.uid), true);
  assert.equal(state.pending?.request?.continuation?.type, "runtime-action-selection");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [defender.uid] }), true);
  assert.equal(state.players.ai.trash.some((card) => card.uid === defender.uid), true);
  assert.equal(attacker.sleep, true);
  assert.equal(attacker.damage, 0);
});

test("STD-036 triggers on a determined destruction even when Backup replaces the move", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const script = createCardInstance("STD-036", "player", 36001);
  script.faceDown = true;
  const victim = createCardInstance("STD-076", "player", 36002);
  state.players.player.back.push(script);
  state.players.player.front.push(victim);
  state.players.player.deck.push(createCardInstance("STD-022", "player", 36003), createCardInstance("STD-023", "player", 36004));
  const handBefore = state.players.player.hand.length;

  assert.equal(destroyCard(state, "player", victim.uid, { source: "test" }), true);
  assert.equal(state.players.player.back.some((card) => card.uid === victim.uid), true);
  assert.equal(state.prompt?.scriptUid, script.uid);
  assert.equal(activateScript(state, "player", script.uid), true);
  assert.equal(state.players.player.hand.length, handBefore + 2);
});

test("STD-037 triggers on an effect memory-limit increase and consumes as much as possible", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const script = createCardInstance("STD-037", "ai", 37001);
  script.faceDown = true;
  state.players.ai.back.push(script);
  state.players.player.memory = 3;

  assert.equal(activateTurbo(state, "player"), true);
  assert.equal(state.prompt?.scriptUid, script.uid);
  assert.equal(activateScript(state, "ai", script.uid), true);
  assert.equal(state.players.player.memory, 0);
});

test("all eligible STD-037 copies retain deterministic windows for one increase", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const first = createCardInstance("STD-037", "ai", 37101);
  const second = createCardInstance("STD-037", "ai", 37102);
  first.faceDown = true; second.faceDown = true;
  state.players.ai.back = [first, second]; state.players.ai.memory = 20;
  assert.equal(activateTurbo(state, "player"), true);
  assert.equal(state.prompt?.scriptUid, first.uid);
  assert.deepEqual(state.scriptActivationQueue.map((entry) => entry.prompt.scriptUid), [second.uid]);
});

test("STD-039 separates Firewall from source-bound additive damage modifiers", () => {
  const parsed = compileEffectText("[ファイアウォール] **効果**自分が与えるダメージすべてを+1し、自分が受けるダメージすべてを-1する。", { category: "Ob" });
  assert.equal(parsed.keywords.some((item) => item.name === "FIREWALL"), true);
  assert.deepEqual(parsed.operations.map((item) => item.type), ["modify_damage", "modify_damage"]);
  assert.ok(parsed.operations.every((item) => item.lifetime === "source_bound" && item.stacking === "additive"));
});

test("STD-041 decodes zero to two Ob from trash with a total original memory cap", () => {
  const parsed = compileEffectText("自分の効果テキストを持たないObの与えるダメージを+1する。[ログアウト]合計メモリが2以下になるようObを2体までデコードする。", { category: "Ob" });
  assert.deepEqual(parsed.operations.find((item) => item.type === "decode"), {
    type: "decode", owner: "self", source: "trash", destination: "choose_area", category: "Ob", maximum: 2, totalOriginalMemoryMaximum: 2, minimum: 0, optional: true
  });
});

test("STD-046 counts only Ob cards that actually arrive in trash and grants itself persistent stats", () => {
  const parsed = compileEffectText("[コンタクト][ログイン]山札の上から3枚をゴミ箱に送る。こうしてゴミ箱に送られたOb1枚につき+1/+1する。", { category: "Ob" });
  assert.deepEqual(parsed.operations.find((item) => item.type === "mill"), {
    type: "mill", owner: "self", source: "deck_top", destination: "trash", value: 3, asMuchAsPossible: true, recordActualArrivalsAs: "milled_to_trash"
  });
  assert.deepEqual(parsed.clauses.find((clause) => clause.resultReference)?.resultReference, { type: "recorded_actual_arrivals", record: "milled_to_trash", destination: "trash", excludeReplacedDestinations: true });
  const modifier = parsed.operations.find((item) => item.type === "modify_stats");
  assert.equal(modifier.duration, "persistent");
  assert.equal(modifier.target, "source");
  assert.deepEqual(modifier.multiplierFrom, { record: "milled_to_trash", filter: { category: "Ob" } });
});

test("STD-048 distinguishes the mandatory rule draw and requires a successful drag before effect 1", () => {
  const parsed = compileEffectText(CARD_LIBRARY["STD-048"].text, { id: "STD-048", category: CARD_LIBRARY["STD-048"].category });
  assert.equal(parsed.clauses.some((clause) => clause.triggers.some((trigger) => trigger.type === "mandatory_rule_draw")), true);
  assert.deepEqual(parsed.operations.find((item) => item.type === "drag"), { type: "drag", target: "source", destination: "self_choose_area", requireOpenSlot: true });
  assert.equal(parsed.operations.find((item) => item.replacesDefaultProxyTrash)?.position, "top");
});

test("STD-049 uses destruction determination before effect 1 and decodes itself", () => {
  const parsed = compileEffectText("[切断][ファイアウォール][プロキシ:6]『災いの明星』を配置し、相手エリアのカード1枚を破壊する。相手ターン終了時、エリアの『災いの明星』をすべて破壊する。こうして破壊したなら、①を起動する。①相手ユーザーに5ダメージ。これをデコードする。", { category: "Ob" });
  assert.equal(parsed.operations.some((item) => item.type === "place_named_virtual" && item.cardName === "災いの明星"), true);
  assert.equal(parsed.operations.some((item) => item.type === "decode" && item.target === "source"), true);
  assert.equal(parsed.clauses.some((clause) => clause.resultReference?.operation === "destroy"), true);
});

test("STD-050 Access Restriction prevents attack declaration", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const card = { id: "STD-050", uid: "player-std050", owner: "player", name: "災いの明星", category: "Ob", atk: 1, str: 1, text: "[アクセス制限]", sleep: false, summoningSick: false, mounted: [] };
  state.players.player.front.push(card);
  assert.equal(canAttack(state, "player", card), false);
  const compiled = compileEffectText(CARD_LIBRARY["STD-050"].text, { id: "STD-050", category: CARD_LIBRARY["STD-050"].category });
  assert.deepEqual(compiled.operations, []);
  assert.deepEqual(compiled.warnings, []);
});

test("STD catalog uses natural ID order and includes every currently implementable STD card", () => {
  for (const id of ["STD-048", "STD-049", "STD-086"]) assert.equal(CARD_LIBRARY[id].id, id);
  const stdIds = LAB_CARD_IDS.filter((id) => id.startsWith("STD-"));
  assert.deepEqual(stdIds, [...stdIds].sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })));
  assert.ok(stdIds.indexOf("STD-049") < stdIds.indexOf("STD-050"));
  assert.ok(stdIds.indexOf("STD-087") < stdIds.indexOf("STD-107"));
});

test("STD-048 mandatory first rule draw drags before healing and drawing effect 1", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  player.turnsTaken = 1;
  player.fortressStr = 10;
  player.hand = [];
  const extra = createCardInstance("STD-022", "player", 4801);
  const dawn = createCardInstance("STD-048", "player", 4802);
  player.deck = [extra, dawn];
  startTurn(state, "player");
  assert.equal(state.pending.type, "std048-draw-place");
  assert.equal(resolveAccessDragPlacement(state, "player", "front"), true);
  assert.ok(player.front.some((card) => card.id === "STD-048"));
  assert.equal(state.events.findLast((event) => event.type === "card_placed" && event.cardUid === dawn.uid)?.placementCause, "effect");
  assert.equal(player.fortressStr, 13);
  assert.ok(player.hand.some((card) => card.uid === extra.uid));
});

test("STD-048 Proxy returns to deck top and places Calamity Star", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  player.memory = 6;
  const dawn = createCardInstance("STD-048", "player", 4810);
  dawn.compiled = compileEffectText(dawn.text, { category: dawn.category });
  player.hand = [dawn];
  const proxy = getActivatableEffects(state, "player", dawn).find((effect) => effect.kind === "proxy");
  assert.equal(activateCardEffect(state, "player", dawn.uid, proxy.id), true);
  assert.equal(player.deck.at(-1).uid, dawn.uid);
  assert.ok([...player.front, ...player.back].some((card) => card.id === "STD-050"));
  assert.equal(player.memory, 0);
});

test("STD-049 Proxy destroys a target then pays Calamity Star cost at opponent turn end", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const ai = state.players.ai;
  player.memory = 6;
  const dusk = createCardInstance("STD-049", "player", 4901);
  dusk.compiled = compileEffectText(dusk.text, { category: dusk.category });
  const victim = createCardInstance("STD-022", "ai", 4902);
  victim.compiled = compileEffectText(victim.text, { category: victim.category });
  ai.front = [victim];
  player.hand = [dusk];
  const proxy = getActivatableEffects(state, "player", dusk).find((effect) => effect.kind === "proxy");
  assert.equal(activateCardEffect(state, "player", dusk.uid, proxy.id, { targetUid: victim.uid }), true);
  assert.ok(ai.trash.some((card) => card.uid === victim.uid));
  const calamity = [...player.front, ...player.back].find((card) => card.id === "STD-050");
  calamity.sleep = true;
  const before = ai.fortressStr;
  state.active = "ai";
  assert.equal(endTurn(state), true);
  assert.equal(ai.fortressStr, before - 5);
  assert.ok(player.trash.some((card) => card.id === "STD-050"));
  assert.ok([...player.front, ...player.back].some((card) => card.uid === dusk.uid));
});

test("STD-086 is the canonical Lucky Shot runtime", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const ai = state.players.ai;
  player.memory = 2;
  const shot = createCardInstance("STD-086", "player", 8601);
  shot.compiled = compileEffectText(shot.text, { category: shot.category });
  const victim = createCardInstance("STD-022", "ai", 8602);
  victim.compiled = compileEffectText(victim.text, { category: victim.category });
  player.hand = [shot];
  ai.front = [victim];
  assert.equal(playCard(state, "player", shot.uid, { targetUid: victim.uid, ignoreColor: true }), true);
  assert.equal(victim.damage, 3);
  assert.equal(state.pending.request.continuation.type, "runtime-action-selection");
});

test("STD-010 discards the remaining hand and redraws exactly that many", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const reboot = createCardInstance("STD-010", "player", 1001);
  const first = createCardInstance("STD-022", "player", 1002);
  const second = createCardInstance("STD-023", "player", 1003);
  player.hand = [reboot, first, second];
  player.deck = [createCardInstance("STD-024", "player", 1004), createCardInstance("STD-025", "player", 1005)];
  player.memory = 2;
  assert.equal(playCard(state, "player", reboot.uid), true);
  assert.equal(player.hand.length, 2);
  assert.ok(player.trash.some((card) => card.uid === first.uid));
  assert.ok(player.trash.some((card) => card.uid === second.uid));
});

test("STD-014 draws only when its damage determines destruction", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const ai = state.players.ai;
  const spell = createCardInstance("STD-014", "player", 1401);
  const victim = createCardInstance("STD-023", "ai", 1402);
  const reward = createCardInstance("STD-022", "player", 1403);
  player.hand = [spell]; player.deck = [reward]; player.memory = 2; ai.front = [victim];
  assert.equal(playCard(state, "player", spell.uid, { targetUid: victim.uid }), true);
  assert.ok(ai.trash.some((card) => card.uid === victim.uid));
  assert.ok(player.hand.some((card) => card.uid === reward.uid));
});

test("STD-015 deals card and user damage as one resolution", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const ai = state.players.ai;
  const spell = createCardInstance("STD-015", "player", 1501);
  const victim = createCardInstance("STD-022", "ai", 1502);
  player.hand = [spell]; player.memory = 2; ai.front = [victim];
  const before = ai.fortressStr;
  assert.equal(playCard(state, "player", spell.uid, { targetUid: victim.uid }), true);
  assert.equal(victim.damage, 2);
  assert.equal(ai.fortressStr, before - 1);
});

test("STD-015 remains playable without an enemy Ob and still damages the user", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const ai = state.players.ai;
  const spell = createCardInstance("STD-015", "player", 1511);
  player.hand = [spell]; player.memory = 2; ai.front = []; ai.back = [];
  const before = ai.fortressStr;
  assert.equal(playCard(state, "player", spell.uid), true);
  assert.equal(ai.fortressStr, before - 1);
});

test("STD-149 heals up to maximum and draws one", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const prayer = createCardInstance("STD-149", "player", 14901);
  const draw = createCardInstance("STD-022", "player", 14902);
  player.hand = [prayer]; player.deck = [draw]; player.memory = 2; player.fortressStr = 19;
  assert.equal(playCard(state, "player", prayer.uid, { ignoreColor: true }), true);
  assert.equal(player.fortressStr, 20);
  assert.ok(player.hand.some((card) => card.uid === draw.uid));
  const parsed = compileEffectText(CARD_LIBRARY["STD-149"].text, { category: "Sp" });
  assert.ok(parsed.operations.some((operation) => operation.type === "recover_damage" && operation.target === "self_user" && operation.value === 2));
});

test("STD-004, STD-007 and STD-008 apply source-bound memory and execution-cost modifiers", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const ai = state.players.ai;
  const baseMax = getMaxMemory(player);
  player.registry.push(createCardInstance("STD-004", "player", 4001));
  assert.equal(getMaxMemory(player), baseMax + 1);
  player.registry.splice(player.registry.findIndex((card) => card.id === "STD-004"), 1);
  assert.equal(getMaxMemory(player), baseMax);

  const repeat = createCardInstance("STD-022", "player", 7001);
  player.trash.push(createCardInstance("STD-022", "player", 7002));
  player.registry.push(createCardInstance("STD-007", "player", 7003), createCardInstance("STD-007", "player", 7004));
  assert.equal(executionCost(repeat, state, "player"), Math.max(0, repeat.cost - 1));

  ai.back.push(createCardInstance("STD-008", "ai", 8001), createCardInstance("STD-008", "ai", 8002));
  assert.equal(executionCost(repeat, state, "player"), repeat.cost);
  ai.back.splice(ai.back.findIndex((card) => card.id === "STD-008"), 2);
  assert.equal(executionCost(repeat, state, "player"), Math.max(0, repeat.cost - 1));
});

test("STD-005 and STD-006 apply their source-bound P-in turn effects", () => {
  const illegalIr = compileEffectText(CARD_LIBRARY["STD-005"].text, { category: "P-in" });
  assert.ok(illegalIr.operations.some((operation) => operation.type === "deal_damage" && operation.target === "self_user" && operation.value === 2));
  const driveIr = compileEffectText(CARD_LIBRARY["STD-006"].text, { category: "P-in" });
  assert.ok(driveIr.operations.some((operation) => operation.type === "deal_damage" && operation.target === "self_user" && operation.value === 2 && operation.condition?.usableMemory === 0));
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  player.registry.push(createCardInstance("STD-005", "player", 5001));
  const baseMax = player.baseMemory + player.permanentMemory;
  assert.equal(getMaxMemory(player), baseMax + 2);
  const strBeforeIllegal = player.fortressStr;
  player.memory = 1;
  assert.equal(endTurn(state), true);
  assert.equal(player.fortressStr, strBeforeIllegal - 2);

  player.registry = [createCardInstance("STD-006", "player", 6001)];
  player.deck = [createCardInstance("STD-022", "player", 6002), createCardInstance("STD-023", "player", 6003)];
  player.turnsTaken = 1;
  const handBefore = player.hand.length;
  startTurn(state, "player");
  assert.equal(player.hand.length, handBefore + 2);
  const strBeforeDanger = player.fortressStr;
  player.memory = 0;
  assert.equal(endTurn(state), true);
  assert.equal(player.fortressStr, strBeforeDanger - 2);

  player.registry = [];
  const handBeforeExpiry = player.hand.length;
  player.deck = [createCardInstance("STD-024", "player", 6004)];
  player.turnsTaken = 1;
  startTurn(state, "player");
  assert.equal(player.hand.length, handBeforeExpiry + 1);
});

test("each STD-005 copy independently adds 2 max memory and deals 2 turn-end damage", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  player.registry.push(
    createCardInstance("STD-005", "player", 5051),
    createCardInstance("STD-005", "player", 5052)
  );
  const baseMax = player.baseMemory + player.permanentMemory;
  assert.equal(getMaxMemory(player), baseMax + 4);
  const fortressBefore = player.fortressStr;
  assert.equal(endTurn(state), true);
  assert.equal(player.fortressStr, fortressBefore - 4);
});

test("STD-012 selects only a nonempty trash, returns it to deck, and shuffles", () => {
  const state = createGame({ mode: "lab", rng: () => 0 });
  const player = state.players.player;
  const defrag = player.hand.find((card) => card.id === "STD-012");
  const ownTrash = createCardInstance("STD-022", "player", 1201);
  const enemyTrash = createCardInstance("STD-023", "ai", 1202);
  player.trash = [ownTrash];
  state.players.ai.trash = [enemyTrash];
  assert.equal(playCard(state, "player", defrag.uid, { ignoreColor: true }), true);
  assert.deepEqual(state.pending.validTargets.sort(), ["ai", "player"]);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: ["player"] }), true);
  assert.ok(player.deck.some((card) => card.uid === ownTrash.uid));
  assert.ok(player.trash.some((card) => card.uid === defrag.uid));
  assert.equal(player.trash.some((card) => card.uid === ownTrash.uid), false);

  const empty = createGame({ mode: "lab" });
  const emptyDefrag = empty.players.player.hand.find((card) => card.id === "STD-012");
  assert.equal(canPlayCard(empty, "player", emptyDefrag).ok, false);
});

test("STD-020, STD-021 and STD-027 use canonical vanilla and Decoy runtime", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  for (const id of ["STD-020", "STD-021"]) {
    const card = player.hand.find((item) => item.id === id);
    assert.equal(card.compiled.status, "supported");
    assert.equal(card.compiled.operations.length, 0);
    assert.equal(playCard(state, "player", card.uid, { zone: "front", force: true, free: true }), true);
  }
  const decoy = createCardInstance("STD-027", "ai", 2701);
  const decoyIr = compileEffectText(CARD_LIBRARY["STD-027"].text, { category: "Ob" });
  assert.equal(decoyIr.status, "supported");
  assert.equal(decoyIr.operations.length, 0);
  const other = createCardInstance("STD-021", "ai", 2702);
  Object.assign(decoy, { mounted: [], sleep: false, damage: 0 });
  Object.assign(other, { mounted: [], sleep: false, damage: 0 });
  state.players.ai.front = [decoy, other];
  const source = createCardInstance("STD-014", "player", 2703);
  assert.deepEqual(getEffectTargets(state, "ai", source).map((card) => card.uid), [decoy.uid]);
});

test("STD-030 Login deals three to an enemy Ob and user as one resolution", () => {
  const gunnerIr = compileEffectText(CARD_LIBRARY["STD-030"].text, { category: "Ob" });
  assert.ok(gunnerIr.operations.some((operation) => operation.type === "deal_damage" && operation.target === "enemy_ob_one" && operation.value === 3));
  assert.ok(gunnerIr.operations.some((operation) => operation.type === "deal_damage" && operation.target === "enemy_user" && operation.value === 3));
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const gunner = player.hand.find((card) => card.id === "STD-030");
  const target = createCardInstance("STD-021", "ai", 3001);
  Object.assign(target, { mounted: [], sleep: false, damage: 0, protect: 0 });
  state.players.ai.front = [target];
  const fortressBefore = state.players.ai.fortressStr;
  assert.equal(playCard(state, "player", gunner.uid, { zone: "front", force: true, free: true }), true);
  assert.deepEqual(state.pending.validTargets, [target.uid]);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [target.uid] }), true);
  assert.equal(target.damage, 3);
  assert.equal(state.players.ai.fortressStr, fortressBefore - 3);

  const noTarget = createGame({ mode: "lab" });
  const second = noTarget.players.player.hand.find((card) => card.id === "STD-030");
  noTarget.players.ai.front = [];
  noTarget.players.ai.back = [];
  const before = noTarget.players.ai.fortressStr;
  assert.equal(playCard(noTarget, "player", second.uid, { zone: "front", force: true, free: true }), true);
  assert.equal(noTarget.players.ai.fortressStr, before - 3);
});

test("shared filtered Access uses card name, class and Script setup memory", () => {
  const named = createGame({ mode: "lab", rng: () => 0.5 });
  const rider = named.players.player.hand.find((card) => card.id === "STD-101");
  const engine = createCardInstance("STD-079", "player", 10101);
  const junk = createCardInstance("STD-078", "player", 10102);
  named.players.player.deck = [junk, engine];
  assert.equal(playCard(named, "player", rider.uid, { zone: "front", force: true, free: true }), true);
  assert.deepEqual(named.pending.validTargets, [engine.uid]);
  assert.equal(resolveCardSelection(named, named.pending.request.continuation, { selected: [engine.uid] }), true);
  assert.equal(named.pending?.type, "access-drag-place");

  const classified = createGame({ mode: "lab", rng: () => 0.5 });
  const engineer = classified.players.player.hand.find((card) => card.id === "STD-108");
  const fairy = createCardInstance("STD-124", "player", 10801);
  const holyGel = createCardInstance("STD-217", "player", 10803);
  const ordinary = createCardInstance("STD-020", "player", 10802);
  assert.ok(fairy.classes.includes("エレクトロン・フェアリー"));
  assert.ok(holyGel.classes.includes("エレクトロン・フェアリー"));
  classified.players.player.deck = [ordinary, fairy, holyGel];
  assert.equal(playCard(classified, "player", engineer.uid, { zone: "front", force: true, free: true }), true);
  assert.deepEqual(classified.pending.validTargets, [fairy.uid, holyGel.uid]);

  const setup = createGame({ mode: "lab", rng: () => 0.5 });
  const herald = setup.players.player.hand.find((card) => card.id === "STD-173");
  const cheapScript = createCardInstance("STD-139", "player", 17301);
  const expensiveScript = createCardInstance("STD-140", "player", 17302);
  setup.players.player.deck = [expensiveScript, cheapScript];
  assert.equal(playCard(setup, "player", herald.uid, { zone: "front", force: true, free: true }), true);
  assert.deepEqual(setup.pending.validTargets, [cheapScript.uid]);
});

test("shared Login selection preserves effect targeting and declarative Login conditions", () => {
  const targeting = createGame({ mode: "lab" });
  const gunner = targeting.players.player.hand.find((card) => card.id === "STD-030");
  const decoy = createCardInstance("STD-027", "ai", 3002);
  const other = createCardInstance("STD-021", "ai", 3003);
  Object.assign(decoy, { mounted: [], sleep: false, damage: 0 });
  Object.assign(other, { mounted: [], sleep: false, damage: 0 });
  targeting.players.ai.front = [decoy, other];
  assert.equal(playCard(targeting, "player", gunner.uid, { zone: "front", force: true, free: true }), true);
  assert.deepEqual(targeting.pending.validTargets, [decoy.uid]);

  const layered = createGame({ mode: "lab" });
  const drill = layered.players.player.hand.find((card) => card.id === "STD-089");
  const host = createCardInstance("STD-021", "player", 8901);
  Object.assign(host, {
    mounted: [createCardInstance("STD-078", "player", 8902), createCardInstance("STD-079", "player", 8903)],
    sleep: false,
    damage: 0,
    tempAtk: 0
  });
  layered.players.player.front = [host];
  assert.equal(playCard(layered, "player", drill.uid, { zone: "front", force: true, free: true }), true);
  assert.equal(host.tempAtk, 2);

  const memory = createGame({ mode: "lab" });
  const kindness = memory.players.player.hand.find((card) => card.id === "STD-144");
  memory.players.player.fortressStr = memory.players.ai.fortressStr - 1;
  const memoryBefore = memory.players.player.memory;
  const limitBefore = memory.players.player.permanentMemory;
  assert.equal(playCard(memory, "player", kindness.uid, { zone: "front", force: true, free: true }), true);
  assert.equal(memory.players.player.memory, memoryBefore + 1);
  assert.equal(memory.players.player.permanentMemory, limitBefore + 1);
});

test("STD-040 and STD-045 access a textless Ob and drag it with the correct sleep state", () => {
  const sleepDrag = compileEffectText(CARD_LIBRARY["STD-040"].text, { category: "Ob" }).operations.find((operation) => operation.type === "access");
  assert.equal(sleepDrag.destination, "drag");
  assert.equal(sleepDrag.followUp?.type, "drag");
  assert.equal(sleepDrag.followUp?.enterSleep, true);

  for (const [sourceId, expectedSleep] of [["STD-040", true], ["STD-045", false]]) {
    const state = createGame({ mode: "lab", rng: () => 0 });
    const player = state.players.player;
    const source = player.hand.find((card) => card.id === sourceId);
    const vanilla = createCardInstance("STD-020", "player", Number(sourceId.slice(4)) * 100 + 1);
    const effectful = createCardInstance("STD-030", "player", Number(sourceId.slice(4)) * 100 + 2);
    player.deck = [vanilla, effectful];
    assert.equal(playCard(state, "player", source.uid, { zone: "front", force: true, free: true }), true);
    assert.deepEqual(state.pending.validTargets, [vanilla.uid]);
    assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [vanilla.uid] }), true);
    assert.equal(resolveAccessDragPlacement(state, "player", "back"), true);
    const placed = player.back.find((card) => card.uid === vanilla.uid);
    assert.equal(placed.sleep, expectedSleep);
    assert.equal(state.events.findLast((event) => event.type === "card_placed" && event.cardUid === vanilla.uid)?.placementCause, "access_drag");
    assert.equal(state.events.some((event) => event.type === "card_executed" && event.cardUid === vanilla.uid), false);
    assert.equal(player.deck.some((card) => card.uid === effectful.uid), true);
  }
});

test("access drag and decode place without resolving Login or execution", () => {
  for (const type of ["access-drag-place", "decode-place"]) {
    const state = createGame({ mode: "sandbox" }); const player = state.players.player; const ai = state.players.ai;
    const artillery = createCardInstance("STD-030", "player", type === "access-drag-place" ? 400301 : 400302);
    player.front = []; player.back = []; player.hand = type === "access-drag-place" ? [artillery] : []; ai.front = []; ai.back = [];
    state.pending = type === "access-drag-place"
      ? { type, playerId: "player", sourceName: "test", queue: [artillery.uid], sourceUid: artillery.uid }
      : { type, playerId: "player", sourceName: "test", queue: [artillery.uid], cards: [artillery], sourceUid: artillery.uid };
    assert.equal(resolveAccessDragPlacement(state, "player", "front"), true);
    assert.equal(ai.fortressStr, 20);
    assert.equal(state.events.some((event) => event.type === "card_executed" && event.cardUid === artillery.uid), false);
    assert.equal(state.pending, null);
  }
});

test("STD-042 accesses exactly two textless Ob into hand", () => {
  const state = createGame({ mode: "lab", rng: () => 0 });
  const player = state.players.player;
  const scout = player.hand.find((card) => card.id === "STD-042");
  const one = createCardInstance("STD-020", "player", 4201);
  const two = createCardInstance("STD-021", "player", 4202);
  const effectful = createCardInstance("STD-030", "player", 4203);
  player.deck = [one, two, effectful];
  assert.equal(playCard(state, "player", scout.uid, { zone: "front", force: true, free: true }), true);
  assert.deepEqual(state.pending.validTargets.sort(), [one.uid, two.uid].sort());
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [one.uid, two.uid] }), true);
  assert.ok(player.hand.some((card) => card.uid === one.uid));
  assert.ok(player.hand.some((card) => card.uid === two.uid));
  assert.ok(player.deck.some((card) => card.uid === effectful.uid));
});

test("STD-047 accesses one Fixer Ob to hand and rejects an empty search", () => {
  const state = createGame({ mode: "lab", rng: () => 0 });
  const player = state.players.player;
  const incident = player.hand.find((card) => card.id === "STD-047");
  const fixer = { ...createCardInstance("STD-020", "player", 4701), classes: ["フィクサー"] };
  const other = { ...createCardInstance("STD-021", "player", 4702), classes: ["連合軍"] };
  player.deck = [fixer, other];
  assert.equal(playCard(state, "player", incident.uid, { ignoreColor: true }), true);
  assert.deepEqual(state.pending.validTargets, [fixer.uid]);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [fixer.uid] }), true);
  assert.ok(player.hand.some((card) => card.uid === fixer.uid));

  const empty = createGame({ mode: "lab" });
  const emptyIncident = empty.players.player.hand.find((card) => card.id === "STD-047");
  empty.players.player.deck = [other];
  assert.equal(canPlayCard(empty, "player", emptyIncident).ok, false);
});

test("STD-035 accesses exactly two Alliance Ob then boosts current Alliance Ob", () => {
  const state = createGame({ mode: "lab", rng: () => 0 });
  const player = state.players.player;
  const source = player.hand.find((card) => card.id === "STD-035");
  const first = createCardInstance("STD-020", "player", 3501);
  const second = createCardInstance("STD-021", "player", 3502);
  const outsider = createCardInstance("STD-079", "player", 3503);
  const fieldAlliance = createCardInstance("STD-027", "player", 3504);
  const fieldOutsider = createCardInstance("STD-079", "player", 3505);
  player.deck = [first, outsider, second];
  player.front = [fieldAlliance, fieldOutsider];
  assert.equal(playCard(state, "player", source.uid, { force: true, free: true }), true);
  assert.deepEqual(new Set(state.pending.validTargets), new Set([first.uid, second.uid]));
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [first.uid, second.uid] }), true);
  assert.equal(player.hand.some((card) => card.uid === first.uid), true);
  assert.equal(player.hand.some((card) => card.uid === second.uid), true);
  assert.equal(fieldAlliance.tempAtk, 1);
  assert.equal(fieldOutsider.tempAtk ?? 0, 0);

  const shortage = createGame({ mode: "lab" });
  const shortageSource = shortage.players.player.hand.find((card) => card.id === "STD-035");
  shortage.players.player.deck = [createCardInstance("STD-020", "player", 3510)];
  assert.equal(canPlayCard(shortage, "player", shortageSource, { force: true, free: true }).ok, false);
});

test("STD-035 treats a Lyd-Ob as both Lyd and Ob without requiring an exact sole class", () => {
  const state = createGame({ mode: "lab", rng: () => 0 });
  const player = state.players.player;
  const source = player.hand.find((card) => card.id === "STD-035");
  const normalAlliance = createCardInstance("STD-020", "player", 3520);
  const layeredAlliance = createCardInstance("SZTB-092", "player", 3521);
  const layeredFieldAlliance = createCardInstance("SZTB-093", "player", 3522);
  const outsider = createCardInstance("STD-079", "player", 3523);
  player.deck = [normalAlliance, outsider, layeredAlliance];
  player.front = [layeredFieldAlliance, outsider];

  assert.deepEqual(layeredAlliance.classes, ["連合軍", "ノイド"]);
  assert.equal(playCard(state, "player", source.uid, { force: true, free: true }), true);
  assert.deepEqual(new Set(state.pending.validTargets), new Set([normalAlliance.uid, layeredAlliance.uid]));
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [normalAlliance.uid, layeredAlliance.uid] }), true);
  assert.ok(player.hand.some((card) => card.uid === layeredAlliance.uid));
  assert.equal(layeredFieldAlliance.tempAtk, 1);
  assert.equal(outsider.tempAtk ?? 0, 0);
});

test("existing damage primitives recognize STD-032, STD-033, STD-034 and STD-041 wording", () => {
  const parsed = Object.fromEntries(["STD-032", "STD-033", "STD-034", "STD-041"].map((id) => [
    id, compileEffectText(CARD_LIBRARY[id].text, { category: CARD_LIBRARY[id].category })
  ]));
  for (const ir of Object.values(parsed)) assert.equal(ir.status, "supported");
  assert.deepEqual(parsed["STD-032"].operations.at(-1), {
    type: "deal_damage", target: "previous_selected_target", value: 3,
    condition: { targetState: "sleep" }, reference: "previous_target"
  });
  assert.deepEqual(parsed["STD-033"].operations.at(-1), { type: "deal_damage", target: "enemy_user", value: 2 });
  assert.equal(parsed["STD-034"].operations.some((operation) => operation.type === "deal_damage" && operation.value === 6), true);
  assert.deepEqual(parsed["STD-041"].operations.find((operation) => operation.type === "modify_damage")?.sourceFilter, { category: "Ob", effectText: "none" });
});

test("STD-032 damages one enemy Ob for three and repeats on the same surviving sleeping target", () => {
  const awakeState = createGame({ mode: "sandbox", rng: () => 0.5 });
  addSandboxCardToHand(awakeState, "player", "STD-032");
  const awakeSpell = awakeState.players.player.hand.find((card) => card.id === "STD-032");
  const awakeTarget = awakeState.players.ai.front.find((card) => card.category === "Ob");
  awakeTarget.str = 10;
  awakeTarget.sleep = false;
  assert.equal(playCard(awakeState, "player", awakeSpell.uid, { targetUid: awakeTarget.uid }), true);
  assert.equal(awakeTarget.damage, 3);
  assert.equal(awakeState.players.player.trash.includes(awakeSpell), true);

  const sleepState = createGame({ mode: "sandbox", rng: () => 0.5 });
  addSandboxCardToHand(sleepState, "player", "STD-032");
  const sleepSpell = sleepState.players.player.hand.find((card) => card.id === "STD-032");
  const sleepTarget = sleepState.players.ai.front.find((card) => card.category === "Ob");
  sleepTarget.str = 10;
  sleepTarget.sleep = true;
  assert.equal(playCard(sleepState, "player", sleepSpell.uid, { targetUid: sleepTarget.uid }), true);
  assert.equal(sleepTarget.damage, 6);
});

test("STD-033 destroys any enemy area card and deals two user damage", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const enemy = state.players.ai;
  addSandboxCardToHand(state, "player", "STD-033");
  addSandboxCardToHand(state, "ai", "STD-016");
  const spell = player.hand.find((card) => card.id === "STD-033");
  const code = enemy.hand.find((card) => card.id === "STD-016");
  enemy.hand.splice(enemy.hand.indexOf(code), 1);
  enemy.back.push(code);
  const before = enemy.fortressStr;
  assert.equal(getEffectTargets(state, "ai", spell).some((card) => card.uid === code.uid), true);
  assert.equal(playCard(state, "player", spell.uid, { targetUid: code.uid }), true);
  assert.equal(enemy.trash.includes(code), true);
  assert.equal(enemy.fortressStr, before - 2);
  assert.equal(player.trash.includes(spell), true);
});

test("STD-032 and STD-033 cannot be fired without an eligible target", () => {
  for (const id of ["STD-032", "STD-033"]) {
    const state = createGame({ mode: "sandbox", rng: () => 0.5 });
    addSandboxCardToHand(state, "player", id);
    const spell = state.players.player.hand.find((card) => card.id === id);
    state.players.ai.front = [];
    state.players.ai.back = [];
    const memory = state.players.player.memory;
    assert.equal(playCard(state, "player", spell.uid), false);
    assert.equal(state.players.player.hand.includes(spell), true);
    assert.equal(state.players.player.memory, memory);
  }
});

test("STD-090 accesses only Junk Parts and drags it", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0 });
  const player = state.players.player;
  addSandboxCardToHand(state, "player", "STD-090");
  const source = player.hand.find((card) => card.id === "STD-090");
  const junk = createCardInstance("STD-078", "player", 9001);
  const other = createCardInstance("STD-016", "player", 9002);
  player.deck = [other, junk];
  assert.equal(playCard(state, "player", source.uid, { zone: "front", force: true, free: true, ignoreColor: true }), true);
  assert.deepEqual(state.pending.validTargets, [junk.uid]);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [junk.uid] }), true);
  assert.equal(resolveAccessDragPlacement(state, "player", "back"), true);
  assert.equal(player.back.some((card) => card.uid === junk.uid), true);
  assert.equal(player.deck.some((card) => card.uid === other.uid), true);
});

test("STD-013 reveals only a hand card with a common-class deck target and accesses one", () => {
  const state = createGame({ mode: "lab", rng: () => 0 });
  const player = state.players.player;
  const explorer = player.hand.find((card) => card.id === "STD-013");
  const reveal = { ...createCardInstance("STD-022", "player", 1301), classes: ["試験クラス"], mounted: [] };
  const invalid = { ...createCardInstance("STD-023", "player", 1302), classes: [], mounted: [] };
  const target = { ...createCardInstance("STD-024", "player", 1303), classes: ["試験クラス"], mounted: [] };
  player.hand = [explorer, reveal, invalid];
  player.deck = [target];
  assert.equal(playCard(state, "player", explorer.uid, { ignoreColor: true }), true);
  assert.deepEqual(state.pending.validTargets, [reveal.uid]);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [reveal.uid] }), true);
  assert.equal(reveal.revealed, true);
  assert.deepEqual(state.pending.validTargets, [target.uid]);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [target.uid] }), true);
  assert.equal(reveal.revealed, false);
  assert.ok(player.hand.some((card) => card.uid === target.uid));
  assert.equal(player.deck.length, 0);
});

test("STD-009 snapshots current own Ob for its turn-only attack update", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const formation = player.hand.find((card) => card.id === "STD-009");
  player.hand.splice(player.hand.indexOf(formation), 1);
  player.back.push(formation);
  const before = player.front.map((card) => [card, cardAtk(state, "player", card)]);
  const update = getActivatableEffects(state, "player", formation).find((effect) => effect.kind === "update");
  const memoryBefore = player.memory;
  assert.equal(activateCardEffect(state, "player", formation.uid, update.id), true);
  assert.equal(player.memory, memoryBefore - 2);
  for (const [card, atk] of before) assert.equal(cardAtk(state, "player", card), atk + 1);
  const later = createCardInstance("STD-022", "player", 9001);
  later.damage = 0; later.mounted = []; later.tempAtk = 0; later.permanentAtk = 0; later.load = 0;
  player.front.push(later);
  assert.equal(cardAtk(state, "player", later), Number(later.atk));
  startTurn(state, "player");
  for (const [card, atk] of before) assert.equal(cardAtk(state, "player", card), atk);
});

test("STD-079 and STD-080 grant source-bound mounted stats and keywords", () => {
  const engineIr = compileEffectText(CARD_LIBRARY["STD-079"].text, { category: "Code" });
  assert.ok(engineIr.operations.some((operation) => operation.type === "grant_keyword" && operation.keyword === "コンタクト" && operation.lifetime === "source_bound"));
  const armorIr = compileEffectText(CARD_LIBRARY["STD-080"].text, { category: "Code" });
  assert.ok(armorIr.operations.some((operation) => operation.type === "grant_keyword" && operation.keyword === "セキュリティ" && operation.lifetime === "source_bound"));
  assert.ok(armorIr.operations.some((operation) => operation.type === "grant_keyword" && operation.keyword === "プロテクト" && operation.amount === 1 && operation.lifetime === "source_bound"));
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const host = createCardInstance("STD-023", "player", 7901);
  Object.assign(host, { damage: 0, sleep: false, summoningSick: true, tempAtk: 0, tempStr: 0, permanentAtk: 0, permanentStr: 0, load: 0, mounted: [] });
  const engine = createCardInstance("STD-079", "player", 7902);
  const armor = createCardInstance("STD-080", "player", 8003);
  host.mounted.push(engine, armor);
  player.front.push(host);
  state.players.ai.front[0].sleep = true;
  assert.equal(cardAtk(state, "player", host), Number(host.atk) + 2);
  assert.equal(cardMaxStr(state, "player", host), Number(host.str) + 2);
  assert.equal(cardHasKeyword(host, "CONTACT"), true);
  assert.equal(cardHasKeyword(host, "SECURITY"), true);
  assert.equal(cardHasKeyword(host, "PROTECT"), true);
  assert.equal(canAttack(state, "player", host), true);
  assert.equal(dealCardDamage(state, "player", host.uid, 1, "test"), true);
  assert.equal(host.damage, 0);
  assert.equal(cardHasKeyword(host, "PROTECT"), false);
  assert.equal(cardHasKeyword(host, "SECURITY"), true);
  assert.equal(discardMountedCard(state, "player", host.uid, engine.uid), true);
  assert.equal(cardAtk(state, "player", host), Number(host.atk));
  assert.equal(cardHasKeyword(host, "CONTACT"), false);
  assert.equal(discardMountedCard(state, "player", host.uid, armor.uid), true);
  assert.equal(cardMaxStr(state, "player", host), Number(host.str));
  assert.equal(cardHasKeyword(host, "SECURITY"), false);
});

test("STD-022 through STD-025 and STD-050 are canonical runtime cards", () => {
  const expected = {
    "STD-022": ["SECURITY"],
    "STD-023": ["HACKING"],
    "STD-024": ["ENCRYPTION"],
    "STD-025": ["QA"],
    "STD-050": ["DISCONNECT", "DECOY", "ACCESS_RESTRICTION", "SECURITY"]
  };
  for (const [id, keywords] of Object.entries(expected)) {
    assert.equal(CARD_LIBRARY[id].id, id);
    const parsed = compileEffectText(CARD_LIBRARY[id].text, { category: CARD_LIBRARY[id].category });
    const parsedKeywords = parsed.keywords.map((item) => item.name);
    assert.equal(keywords.every((keyword) => parsedKeywords.includes(keyword)), true);
  }
});

test("Disconnect destroys the opposing Ob after combat even when combat damage is not lethal", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const attacker = createCardInstance("STD-022", "player", 900);
  attacker.grantedKeywords = ["DISCONNECT"];
  attacker.summoningSick = false;
  const defender = createCardInstance("STD-022", "ai", 901);
  defender.sleep = true;
  state.players.player.front.push(attacker);
  state.players.ai.front.push(defender);

  assert.equal(attack(state, "player", attacker.uid, defender.uid), true);
  assert.equal(state.players.ai.trash.some((card) => card.uid === defender.uid), true);
  assert.equal(state.players.player.front.some((card) => card.uid === attacker.uid), true);
});

test("defending Disconnect destroys its attacker after combat", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const attacker = createCardInstance("STD-022", "player", 902);
  attacker.summoningSick = false;
  const defender = createCardInstance("STD-050", "ai", 903);
  defender.sleep = true;
  state.players.player.front.push(attacker);
  state.players.ai.front.push(defender);

  assert.equal(attack(state, "player", attacker.uid, defender.uid), true);
  assert.equal(state.players.player.trash.some((card) => card.uid === attacker.uid), true);
});

test("STD-077 draws only after discarding a Red Punks card", () => {
  const parsed = compileEffectText("[ログイン]このObがマウントしているなら手札の「レッドパンクス」1枚を捨てる。そうしたら、カードを2枚引く。", { category: "Ob" });
  assert.equal(parsed.operations.some((item) => item.type === "discard" && item.className === "レッドパンクス" && item.minimum === 1), true);
  assert.equal(parsed.clauses.some((clause) => clause.resultReference?.type === "previous_resolution_group_succeeded" && clause.operations.some((item) => item.type === "draw" && item.value === 2)), true);
});

test("STD-081 accesses optional Code up to total original memory 2 and drags it", () => {
  const parsed = compileEffectText("[ログイン]メモリ2以下になるよう任意の枚数のCodeにアクセスし、それをドラッグする。", { category: "Ob" });
  const access = parsed.operations.find((item) => item.type === "access");
  assert.equal(access.selector.totalOriginalMemoryMaximum, 2);
  assert.equal(access.selector.minimum, 0);
  assert.equal(access.followUp.type, "drag");
});

test("STD-083 accesses one or two matching Lyd-Ob as far as possible", () => {
  const parsed = compileEffectText("[ログイン]マウントしているなら「レッドパンクス」Lyd-Ob2枚にアクセスし公開する。1枚を手札に加えもう1枚をゴミ箱に捨てる。", { category: "Ob" });
  const access = parsed.operations.find((item) => item.type === "access");
  assert.deepEqual({ className: access.selector.className, category: access.selector.category, minimum: access.selector.minimum, maximum: access.selector.maximum }, { className: "レッドパンクス", category: "Lyd-Ob", minimum: 1, maximum: 2 });
  assert.equal(access.asMuchAsPossible, true);
  assert.equal(access.destination, "split_hand_trash");
});

test("STD-084 is destroyed by a mandatory state check whenever it is not mounted", () => {
  const parsed = compileEffectText("[セキュリティ]このカードがマウントしていない時、破壊される。", { category: "Ob" });
  assert.equal(parsed.status, "supported");
  assert.deepEqual(parsed.clauses[0].triggers, [{
    type: "state_condition",
    condition: { sourceMounted: false, mountType: "Code" },
    checkTiming: ["after_area_entry", "after_state_change"],
    mandatory: true
  }]);
  assert.deepEqual(parsed.operations, [{ type: "destroy", target: "source", mandatory: true, reason: "unmounted_state" }]);
});

test("STD-085 pays one layer, resolves effect 1, then checks its layer threshold", () => {
  const parsed = compileEffectText("[レイヤード:レッドパンクスCode1枚以上とノイド1体][QA]攻撃時、レイヤーを1枚ゴミ箱に送ることで①を起動する。①+2/+0する。このObのレイヤーが1枚以下になった時、破壊される。", { category: "Ob" });
  assert.equal(parsed.status, "supported");
  assert.deepEqual(parsed.costs, [{
    type: "move_layer",
    source: "source_layers",
    destination: "trash",
    count: 1,
    minimum: 1,
    timing: "trigger_activation",
    activatesEffectNumber: 1
  }]);
  assert.equal(parsed.operations.some((item) => item.type === "apply_numbered_effect" && item.effectNumber === 1), true);
  assert.deepEqual(parsed.operations.find((item) => item.type === "modify_stats"), {
    type: "modify_stats",
    atk: 2,
    str: 0,
    duration: "persistent",
    application: "selected",
    target: "source",
    stacking: "additive"
  });
  const thresholdClause = parsed.clauses.find((clause) => clause.triggers.some((trigger) => trigger.type === "layer_count_threshold"));
  assert.deepEqual(thresholdClause.triggers[0], {
    type: "layer_count_threshold",
    comparator: "<=",
    value: 1,
    countMode: "stack_including_source",
    timing: "after_current_effect_resolution"
  });
  assert.deepEqual(thresholdClause.operations, [{ type: "destroy", target: "source", mandatory: true, reason: "layer_count_threshold" }]);
});

test("STD-087 restricts access to memory-one Ob or Code and drags the result", () => {
  const parsed = compileEffectText("[ログイン]メモリ1以下のObまたはCode1枚にアクセスし、それをドラッグする。自分の赤のカードによるダメージを+1する。", { category: "Ob" });
  assert.equal(parsed.status, "supported");
  const access = parsed.operations.find((item) => item.type === "access");
  assert.deepEqual(access.selector.categories, ["Ob", "Code"]);
  assert.equal(access.selector.category, null);
  assert.equal(access.selector.originalMemoryMaximum, 1);
  assert.equal(access.destination, "drag");
  assert.deepEqual(access.followUp, { type: "drag", destination: "self_choose_area", useAccessedCards: true });
  assert.deepEqual(parsed.operations.find((item) => item.type === "modify_damage"), {
    type: "modify_damage",
    controller: "self",
    sourceFilter: { color: "赤" },
    direction: "dealt",
    value: 1,
    appliesTo: "all_damage_events",
    lifetime: "source_bound",
    stacking: "additive"
  });
});

test("STD-077 runtime discards only a Red Punks card before drawing two", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const sam = player.hand.find((card) => card.id === "STD-077");
  sam.mounted.push({ id: "LAYER", uid: "layer-077", owner: "player", name: "layer", category: "Code", classes: [] });
  player.hand.push({ id: "RED-PUNKS", uid: "red-punks", owner: "player", name: "Punks", category: "Ob", color: "青", cost: 1, classes: ["レッドパンクス"], mounted: [] });
  player.hand.push({ id: "RED-ONLY", uid: "red-only", owner: "player", name: "Red only", category: "Ob", color: "赤", cost: 1, classes: [], mounted: [] });
  player.deck.push(
    { id: "DRAW-1", uid: "draw-1", owner: "player", name: "Draw 1", category: "Ob", cost: 1, classes: [], mounted: [] },
    { id: "DRAW-2", uid: "draw-2", owner: "player", name: "Draw 2", category: "Ob", cost: 1, classes: [], mounted: [] }
  );
  const before = player.hand.length;
  assert.equal(playCard(state, "player", sam.uid, { zone: "front", force: true }), true);
  assert.ok(state.pending.validTargets.includes("red-punks"));
  assert.equal(state.pending.validTargets.includes("red-only"), false);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: ["red-punks"] }), true);
  assert.ok(player.trash.some((card) => card.uid === "red-punks"));
  assert.ok(player.hand.some((card) => card.uid === "red-only"));
  assert.equal(player.hand.length, before);
});

test("STD-081 runtime selects Code within original-memory budget and drags it", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const jun = player.hand.find((card) => card.id === "STD-081");
  player.deck = [
    { id: "C1", uid: "c1", owner: "player", name: "Code 1", category: "Code", cost: 1, classes: [], mounted: [] },
    { id: "C2", uid: "c2", owner: "player", name: "Code 2", category: "Code", cost: 1, classes: [], mounted: [] },
    { id: "C3", uid: "c3", owner: "player", name: "Code 3", category: "Code", cost: 3, classes: [], mounted: [] }
  ];
  assert.equal(playCard(state, "player", jun.uid, { zone: "front", force: true }), true);
  assert.deepEqual(state.pending.validTargets.sort(), ["c1", "c2"]);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: ["c1", "c2"] }), true);
  assert.equal(state.pending.type, "access-drag-place");
  assert.equal(resolveAccessDragPlacement(state, "player", "back"), true);
  assert.equal(resolveAccessDragPlacement(state, "player", "front"), true);
  assert.equal([...player.front, ...player.back].filter((card) => ["c1", "c2"].includes(card.uid)).length, 2);
  assert.ok(player.deck.some((card) => card.uid === "c3"));
});

test("STD-083 runtime accesses one or two matching Lyd-Ob as far as possible", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const bolts = player.hand.find((card) => card.id === "STD-083");
  bolts.mounted.push({ id: "LAYER", uid: "layer-083", owner: "player", name: "layer", category: "Code", classes: [] });
  player.deck = [{ id: "L1", uid: "l1", owner: "player", name: "Lyd", category: "Lyd-Ob", cost: 1, classes: ["レッドパンクス"], mounted: [] }];
  assert.equal(playCard(state, "player", bolts.uid, { zone: "front", force: true }), true);
  assert.deepEqual(state.pending.validTargets, ["l1"]);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: ["l1"] }), true);
  assert.ok(player.hand.some((card) => card.uid === "l1"));
});

test("STD-083 shared access distributes the second selected card to trash", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const bolts = player.hand.find((card) => card.id === "STD-083");
  bolts.mounted.push({ id: "LAYER", uid: "layer-083-two", owner: "player", name: "layer", category: "Code", classes: [] });
  player.deck = [
    { id: "L1", uid: "l1-two", owner: "player", name: "Lyd 1", category: "Lyd-Ob", cost: 1, classes: ["レッドパンクス"], mounted: [] },
    { id: "L2", uid: "l2-two", owner: "player", name: "Lyd 2", category: "Lyd-Ob", cost: 2, classes: ["レッドパンクス"], mounted: [] }
  ];
  assert.equal(playCard(state, "player", bolts.uid, { zone: "front", force: true }), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: ["l1-two", "l2-two"] }), true);
  assert.ok(player.hand.some((card) => card.uid === "l1-two"));
  assert.ok(player.trash.some((card) => card.uid === "l2-two"));
  assert.equal(state.pending, null);
});

test("STD-084 runtime destroys itself immediately when its mounted Code is removed", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const mikazuki = player.hand.find((card) => card.id === "STD-084");
  player.hand.splice(player.hand.indexOf(mikazuki), 1);
  mikazuki.mounted.push({ id: "CODE", uid: "code-084", owner: "player", name: "Code", category: "Code", classes: [] });
  player.front.push(mikazuki);
  assert.equal(discardMountedCard(state, "player", mikazuki.uid, "code-084"), true);
  assert.ok(player.trash.some((card) => card.uid === mikazuki.uid));
});

test("STD-085 runtime pays a layer, gains persistent attack, then applies threshold destruction", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const zero = player.hand.find((card) => card.id === "STD-085");
  player.hand.splice(player.hand.indexOf(zero), 1);
  zero.mounted.push({ id: "LAYER", uid: "layer-085", owner: "player", name: "Layer", category: "Code", classes: [] });
  zero.summoningSick = false;
  zero.sleep = false;
  player.front.push(zero);
  const fortress = getAttackTargets(state, "player", zero).find((target) => target.type === "fortress");
  assert.equal(attack(state, "player", zero.uid, fortress.uid), true);
  toggleSelection(state.pending.request, "layer-085");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.equal(zero.permanentAtk, 2);
  assert.ok(player.trash.some((card) => card.uid === zero.uid));
});

test("STD-087 runtime exposes only memory-one Ob or Code and drags the selected card", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const glen = player.hand.find((card) => card.id === "STD-087");
  player.deck = [
    { id: "O1", uid: "o1", owner: "player", name: "Ob 1", category: "Ob", cost: 1, atk: 1, str: 1, classes: [], mounted: [] },
    { id: "C1", uid: "g-c1", owner: "player", name: "Code 1", category: "Code", cost: 1, classes: [], mounted: [] },
    { id: "S1", uid: "s1", owner: "player", name: "Script 1", category: "Script", cost: 1, classes: [], mounted: [] }
  ];
  assert.equal(playCard(state, "player", glen.uid, { zone: "front", force: true }), true);
  assert.deepEqual(state.pending.validTargets.sort(), ["g-c1", "o1"]);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: ["o1"] }), true);
  assert.equal(state.pending.type, "access-drag-place");
  assert.equal(resolveAccessDragPlacement(state, "player", "back"), true);
  assert.ok([...player.front, ...player.back].some((card) => card.uid === "o1"));
});

test("STD-087 runtime adds one to damage from the controller's red cards", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const ai = state.players.ai;
  const glen = player.hand.find((card) => card.id === "STD-087");
  player.hand.splice(player.hand.indexOf(glen), 1);
  player.back.push(glen);
  const red = player.hand.find((card) => card.id === "STD-086");
  const victim = ai.front[0];
  const beforeCardDamage = victim.damage;
  dealCardDamage(state, "ai", victim.uid, 2, red.name, { sourcePlayerId: "player" });
  assert.equal(victim.damage, beforeCardDamage + 3);
  const beforeFortress = ai.fortressStr;
  dealFortressDamage(state, "ai", 2, "player", red.name);
  assert.equal(ai.fortressStr, beforeFortress - 3);
});

test("Security can rest only in its optional turn-end window", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const guard = { id: "TEST-SECURITY", uid: "player-test-security", owner: "player", name: "Guard", category: "Ob", cost: 1, atk: 1, str: 3, text: "[セキュリティ]", sleep: false, damage: 0, mounted: [] };
  state.players.player.front.push(guard);
  assert.equal(restSecurity(state, "player", guard.uid), false);
  assert.equal(guard.sleep, false);
  assert.equal(endTurn(state), false);
  assert.equal(state.securityRestWindow, "player");
  assert.equal(restSecurity(state, "player", guard.uid), true);
  assert.equal(guard.sleep, true);
  assert.equal(endTurn(state), true);
  assert.equal(state.securityRestWindow, undefined);
});

test("activation legality uses only the primary group before then/if-success follow-ups", () => {
  const thenEffect = compileEffectText("[ログイン]相手のOb1体を破壊する。その後、自分の他のOb1体を+1/+1する。", { category: "Ob" });
  assert.equal(thenEffect.activationPolicy.primaryResolutionGroup, thenEffect.clauses[0].resolutionGroup);
  assert.notEqual(thenEffect.clauses[0].resolutionGroup, thenEffect.clauses[1].resolutionGroup);
  const ifSucceeded = compileEffectText("相手Ob1体を破壊する。そうしたら、カードを1枚引く。", { category: "Sp" });
  assert.notEqual(ifSucceeded.clauses[0].resolutionGroup, ifSucceeded.clauses[1].resolutionGroup);
  assert.deepEqual(ifSucceeded.clauses[1].resultReference, { type: "previous_resolution_group_succeeded" });
});

test("effect compiler v2 structurally parses every Vengeance card", () => {
  const results = Object.values(VENGEANCE_CARDS).map((card) => compileEffectText(card.text));
  assert.equal(results.length, 26);
  assert.equal(results.some((result) => result.status === "manual"), false);
  assert.ok(results.every((result) => result.version === 2));
});

test("STD-107 through STD-124 Neutron Security texts are registered and parseable", () => {
  assert.equal(Object.keys(NEUTRON_CARDS).length, 18);
  assert.deepEqual(Object.keys(NEUTRON_CARDS), Array.from({ length: 18 }, (_, index) => `STD-${107 + index}`));
  assert.ok(Object.values(NEUTRON_CARDS).every((card) => compileEffectText(card.text).version === 2));
});

test("AI battle independently selects Vengeance and Neutron decks for both users", () => {
  const first = createGame({ mode: "ai", playerDeckId: "neutron", aiDeckId: "vengeance", rng: () => 0.5 });
  assert.equal(first.players.player.user.color, "青");
  assert.equal(first.players.ai.user.color, "紫");
  assert.ok([...first.players.player.hand, ...first.players.player.deck].every((card) => card.id >= "STD-107" && card.id <= "STD-124"));
  assert.ok([...first.players.ai.hand, ...first.players.ai.deck].some((card) => card.id === "STD-190"));

  const second = createGame({ mode: "ai", playerDeckId: "vengeance", aiDeckId: "neutron", rng: () => 0.5 });
  startTurn(second, "ai");
  runSimpleAiTurn(second, "ai");
  assert.equal(second.active, "player");
  assert.equal(second.pending, null);
});

test("Neutron access, keyword grant, resident and Proxy effects change game state", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const wallIndex = player.hand.findIndex((card) => card.id === "STD-110");
  const [wall] = player.hand.splice(wallIndex, 1);
  player.deck.push(wall);
  const rutile = player.hand.find((card) => card.id === "STD-107");
  assert.equal(playCard(state, "player", rutile.uid, { zone: "front" }), true);
  assert.equal(state.pending?.request?.continuation?.type, "access-to-hand");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [wall.uid] }), true);
  assert.ok(player.hand.some((card) => card.id === "STD-110"));

  const frau = player.hand.find((card) => card.id === "STD-109");
  playCard(state, "player", frau.uid, { zone: "front" });
  const protocol = player.hand.find((card) => card.id === "STD-111");
  assert.equal(playCard(state, "player", protocol.uid, { targetUid: frau.uid }), true);
  assert.equal(cardAtk(state, "player", frau), 4);

  const babel = player.hand.find((card) => card.id === "STD-118");
  playCard(state, "player", babel.uid, { zone: "back" });
  activateScript(state, "player", babel.uid);
  const returnedWall = player.hand.find((card) => card.id === "STD-110");
  assert.equal(playCard(state, "player", returnedWall.uid), true);
  assert.ok(player.hand.some((card) => card.uid === returnedWall.uid));

  const signora = player.hand.find((card) => card.id === "STD-124");
  const proxy = getActivatableEffects(state, "player", signora).find((effect) => effect.kind === "proxy");
  const memoryBeforeProxy = player.memory;
  assert.equal(proxy.label, "プロキシ:2(コスト)");
  assert.equal(proxy.cost, 2);
  assert.equal(activateCardEffect(state, "player", signora.uid, proxy.id), true);
  assert.equal(player.memory, memoryBeforeProxy - 2);
  assert.equal(player.hand.filter((card) => card.id === "STD-124").length, 2);
  assert.ok(player.trash.some((card) => card.uid === signora.uid));
});

test("OC prompts before execution and gates every ability after the paid marker", () => {
  const decline = createGame({ mode: "lab" });
  const shield = decline.players.player.hand.find((card) => card.id === "STD-125");
  const beforeHand = decline.players.player.hand.length;
  assert.equal(playCard(decline, "player", shield.uid, { zone: "front" }), true);
  assert.equal(decline.pending.request.label, "[OC]メモリを追加で+4払いますか？");
  setSelectionScope(decline.pending.request, "支払わない");
  assert.equal(resolveCardSelection(decline, decline.pending.request.continuation, confirmSelection(decline.pending.request)), true);
  assert.equal(decline.players.player.hand.length, beforeHand - 1);
  assert.equal(cardAtk(decline, "player", shield), shield.atk);

  const paid = createGame({ mode: "lab" });
  const paidShield = paid.players.player.hand.find((card) => card.id === "STD-125");
  const beforeMemory = paid.players.player.memory;
  assert.equal(playCard(paid, "player", paidShield.uid, { zone: "front" }), true);
  setSelectionScope(paid.pending.request, "+4払う");
  assert.equal(resolveCardSelection(paid, paid.pending.request.continuation, confirmSelection(paid.pending.request)), true);
  assert.equal(paid.players.player.memory, beforeMemory - executionCost(paidShield, paid, "player") - 4);
  assert.equal(cardAtk(paid, "player", paidShield), Number(paidShield.atk) + 2);
});

test("STD-236 executes one registry card per turn through normal legality and OC", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const doctor = player.hand.find((card) => card.id === "STD-236");
  player.hand.splice(player.hand.indexOf(doctor), 1);
  player.back.push(doctor);
  const shield = player.hand.find((card) => card.id === "STD-125");
  player.hand.splice(player.hand.indexOf(shield), 1);
  player.registry.push(shield);
  const before = player.memory;
  assert.equal(canExecuteRegistryCard(state, "player", shield).ok, true);
  assert.equal(executeRegistryCard(state, "player", shield.uid, { zone: "front" }), true);
  assert.equal(state.pending.request.continuation.type, "play-card-oc");
  setSelectionScope(state.pending.request, "支払わない");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.equal(player.memory, before - executionCost(shield, state, "player"));
  assert.equal(player.triggerUsage["STD-236:registry-execute"], true);
  const second = player.registry[0];
  if (second) assert.equal(canExecuteRegistryCard(state, "player", second).ok, false);
});

test("Response opens only after actual opponent damage and pays the printed response cost", () => {
  const state = createGame({ mode: "lab" });
  state.interactive = true;
  const player = state.players.player;
  const ai = state.players.ai;
  const response = player.hand.find((card) => card.id === "STD-034");
  const target = createCardInstance("STD-022", "ai", 34001);
  ai.front = [target];
  player.memory = 3;
  dealFortressDamage(state, "player", 1, "ai", "監査用攻撃", { kind: "attack" });
  assert.equal(state.pending.type, "response-window");
  assert.equal(state.pending.candidates.includes(response.uid), true);
  assert.equal(activateResponse(state, "player", response.uid), true);
  assert.equal(state.pending.type, "response-target");
  assert.equal(activateResponse(state, "player", response.uid, target.uid), true);
  assert.equal(player.memory, 0);
  assert.equal(ai.trash.some((card) => card.uid === target.uid), true);
  if (state.prompt?.type === "script-activation") assert.equal(declinePrompt(state), true);
  assert.equal(player.trash.some((card) => card.uid === response.uid), true);

  const selfDamage = createGame({ mode: "lab" });
  selfDamage.interactive = true;
  dealFortressDamage(selfDamage, "player", 1, "player", "自傷");
  assert.equal(selfDamage.pending, null);
});

test("same-damage Responses are declared before resolution and derived damage waits for that stack", () => {
  const state = createGame({ mode: "lab" });
  state.interactive = true;
  const player = state.players.player;
  const ai = state.players.ai;
  const playerResponse = player.hand.find((card) => card.id === "STD-015");
  const secondPlayerResponse = createCardInstance("STD-015", "player", 15000);
  secondPlayerResponse.compiled = compileEffectText(secondPlayerResponse.text, { category: secondPlayerResponse.category });
  player.hand.push(secondPlayerResponse);
  const aiResponse = createCardInstance("STD-015", "ai", 15001);
  aiResponse.compiled = compileEffectText(aiResponse.text, { category: aiResponse.category });
  ai.hand = [aiResponse];
  ai.front = [];
  ai.back = [];
  player.memory = 2;
  ai.memory = 1;
  dealFortressDamage(state, "player", 1, "ai", "最初のダメージ", { kind: "attack" });
  assert.equal(activateResponse(state, "player", playerResponse.uid), true);
  assert.equal(state.pending.type, "response-window");
  assert.equal(state.pending.playerId, "player");
  assert.equal(state.responseEventQueue.length, 0);
  assert.equal(player.trash.some((card) => card.uid === playerResponse.uid), false);
  assert.equal(activateResponse(state, "player", secondPlayerResponse.uid), true);
  assert.equal(player.trash.some((card) => card.uid === playerResponse.uid), true);
  assert.equal(player.trash.some((card) => card.uid === secondPlayerResponse.uid), true);
  assert.equal(state.pending.type, "response-window");
  assert.equal(state.pending.playerId, "ai");
  assert.equal(state.pending.candidates.includes(aiResponse.uid), true);
  assert.equal(state.responseEventQueue.length, 1);
});

test("Neutron shared keywords enforce Load, Encryption, Hacking, Decoy and Firewall", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const ai = state.players.ai;
  const attacker = player.hand.find((card) => card.id === "STD-108");
  player.hand.splice(player.hand.indexOf(attacker), 1);
  player.front.push(attacker);
  attacker.sleep = false;

  const security = player.hand.find((card) => card.id === "STD-109");
  player.hand.splice(player.hand.indexOf(security), 1);
  security.owner = "ai";
  ai.front.push(security);
  security.sleep = true;
  security.grantedKeywords = ["SECURITY"];
  assert.deepEqual(getAttackTargets(state, "player", attacker).map((target) => target.uid), [security.uid]);

  attacker.grantedKeywords = ["HACKING"];
  assert.ok(getAttackTargets(state, "player", attacker).some((target) => target.type === "fortress"));
  security.grantedKeywords.push("ENCRYPTION");
  assert.equal(getAttackTargets(state, "player", attacker).some((target) => target.uid === security.uid), false);

  attacker.load = 1;
  assert.equal(cardAtk(state, "player", attacker), 0);
  assert.equal(cardMaxStr(state, "player", attacker), 1);

  const decoy = player.hand.find((card) => card.id === "STD-107");
  const ordinary = player.hand.find((card) => card.id === "STD-112");
  player.hand.splice(player.hand.indexOf(decoy), 1);
  player.hand.splice(player.hand.indexOf(ordinary), 1);
  decoy.owner = "ai";
  ordinary.owner = "ai";
  ai.front.push(decoy, ordinary);
  decoy.grantedKeywords = ["DECOY"];
  const source = player.hand.find((card) => card.id === "STD-110");
  source.owner = "player";
  source.text = "相手のOb1体を選ぶ。";
  assert.deepEqual(getEffectTargets(state, "ai", source).map((card) => card.uid), [decoy.uid]);
  source.grantedKeywords = ["HACKING"];
  assert.ok(getEffectTargets(state, "ai", source).some((card) => card.uid === ordinary.uid));
  ordinary.grantedKeywords = ["FIREWALL"];
  assert.equal(getEffectTargets(state, "ai", source).some((card) => card.uid === ordinary.uid), false);
});

test("Armor is normalized to consumable Protect and card classes are canonical arrays", () => {
  const compiled = compileEffectText("[装甲:2]");
  assert.equal(compiled.keywords[0].name, "PROTECT");
  assert.equal(compiled.keywords[0].value, 2);

  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const signora = player.hand.find((card) => card.id === "STD-124");
  assert.deepEqual(signora.classes, ["ニュートロン・セキュリティ", "エレクトロン・フェアリー"]);

  const protectedCard = player.hand.find((card) => card.id === "STD-108");
  player.hand.splice(player.hand.indexOf(protectedCard), 1);
  player.front.push(protectedCard);
  protectedCard.compiled = compiled;
  protectedCard.protect = 2;
  assert.equal(dealCardDamage(state, "player", protectedCard.uid, 99, "テスト"), true);
  assert.equal(protectedCard.damage, 0);
  assert.equal(protectedCard.protect, 1);
  assert.equal(destroyCard(state, "player", protectedCard.uid, { source: "テスト破壊" }), false);
  assert.ok(player.front.includes(protectedCard));
  assert.equal(protectedCard.protect, 0);
  assert.equal(destroyCard(state, "player", protectedCard.uid, { source: "テスト破壊" }), true);
  assert.ok(player.trash.includes(protectedCard));
});

test("Vengeance tutorial layers two Dolls and discounts Tripvia relog", () => {
  const state = createGame({ mode: "tutorial", tutorialId: "vengeance" });
  const idol = state.players.player.hand.find((card) => card.id === "STD-191");
  assert.equal(state.players.player.user.color, "紫");
  assert.equal(installCard(state, "player", idol.uid), true);
  const tripvia = state.players.player.hand.find((card) => card.id === "STD-195");
  const dolls = getLayeredCandidates(state, "player", tripvia);
  assert.equal(dolls.length, 2);
  assert.equal(playLayeredCard(state, "player", tripvia.uid, dolls.map(({ card }) => card.uid), "front"), true);
  assert.equal(tripvia.mounted.length, 2);
  const before = state.players.player.memory;
  assert.equal(relogCard(state, "player", tripvia.uid, "back"), true);
  setSelectionScope(state.pending.request, "レイヤー1枚を破棄して1メモリ");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  toggleSelection(state.pending.request, tripvia.mounted[0].uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.equal(state.players.player.memory, before - 1);
  assert.equal(tripvia.mounted.length, 1);
  assert.equal(state.players.player.trash.some((card) => card.id === "STD-189"), true);
  assert.equal(state.players.player.front.some((card) => card.id === "STD-189"), false);
});

test("Acryia relog gains permanent stats and leaves a Dolls behind", () => {
  const state = createGame({ mode: "tutorial", tutorialId: "vengeance" });
  const idol = state.players.player.hand.find((card) => card.id === "STD-191");
  installCard(state, "player", idol.uid);
  const acryia = state.players.player.hand.find((card) => card.id === "STD-194");
  assert.equal(playCard(state, "player", acryia.uid, { zone: "front" }), true);
  assert.equal(relogCard(state, "player", acryia.uid, "back"), true);
  assert.equal(cardAtk(state, "player", acryia), 3);
  assert.equal(state.players.player.front.some((card) => card.id === "STD-189"), true);
});

test("Update activation moves an Ob as an effect without using relog", () => {
  const state = createGame({ mode: "tutorial", tutorialId: "vengeance" });
  const idol = state.players.player.hand.find((card) => card.id === "STD-191");
  installCard(state, "player", idol.uid);
  const acryia = state.players.player.hand.find((card) => card.id === "STD-194");
  const tana = state.players.player.hand.find((card) => card.id === "STD-192");
  playCard(state, "player", acryia.uid, { zone: "front" });
  playCard(state, "player", tana.uid, { zone: "front" });
  const [effect] = getActivatableEffects(state, "player", tana);
  const beforeHand = state.players.player.hand.length;
  assert.equal(effect.label, "[アップデート:2]");
  assert.equal(activateCardEffect(state, "player", tana.uid, effect.id, { targetUid: acryia.uid, targetZone: "back" }), true);
  assert.equal(state.players.player.back.some((card) => card.uid === acryia.uid), true);
  assert.equal(state.players.player.front.some((card) => card.id === "STD-189"), true);
  assert.equal(state.players.player.hand.length, beforeHand + 1);
});

test("conditional trigger runtime resolves movement text through shared events", () => {
  const state = createGame({ mode: "lab" });
  const idol = state.players.player.hand.find((card) => card.id === "STD-191");
  const tana = state.players.player.hand.find((card) => card.id === "STD-192");
  playCard(state, "player", idol.uid, { zone: "back" });
  playCard(state, "player", tana.uid, { zone: "front" });
  const enemy = state.players.ai.front.find((card) => card.category === "Ob");
  const beforeDamage = enemy.damage;
  state.players.player.memory = 5;
  const beforeMemory = state.players.player.memory;
  const effect = getActivatableEffects(state, "player", tana)[0];

  assert.equal(activateCardEffect(state, "player", tana.uid, effect.id, { targetUid: tana.uid, targetZone: "back" }), true);
  assert.equal(enemy.damage, beforeDamage + 1);
  assert.equal(state.players.player.memory, beforeMemory - effect.cost + 1);
  assert.ok(state.events.some((event) => event.type === "card_moved" && event.cardUid === tana.uid));
});

test("turn-end conditional trigger is reusable regardless of whose turn ends", () => {
  const state = createGame({ mode: "lab" });
  const hacker = state.players.player.hand.find((card) => card.id === "STD-190");
  playCard(state, "player", hacker.uid, { zone: "back" });
  const before = state.players.ai.fortressStr;
  endTurn(state);
  assert.equal(state.players.ai.fortressStr, before - 2);
  assert.ok(state.events.some((event) => event.type === "turn_ended"));
});

test("generic selection model supports single, exact, up-to, scope and random modes", () => {
  const single = createSelectionRequest({ mode: "single", candidates: ["a", "b"] });
  toggleSelection(single, "a");
  toggleSelection(single, "b");
  assert.deepEqual(confirmSelection(single).selected, ["b"]);

  const exact = createSelectionRequest({ mode: "exact", candidates: ["a", "b", "c"], count: 2 });
  toggleSelection(exact, "a");
  assert.equal(canConfirmSelection(exact), false);
  toggleSelection(exact, "b");
  assert.deepEqual(confirmSelection(exact).selected, ["a", "b"]);

  const upTo = createSelectionRequest({ mode: "up_to", candidates: ["a", "b", "c"], count: 2, maximum: 2 });
  assert.equal(canConfirmSelection(upTo), true);
  toggleSelection(upTo, "a");
  assert.deepEqual(confirmSelection(upTo).selected, ["a"]);

  const scope = createSelectionRequest({ mode: "scope", scopeField: "category", scopeOptions: ["Ob", "Sp"] });
  setSelectionScope(scope, "Sp");
  assert.deepEqual(confirmSelection(scope), { scope: "Sp", selected: [] });

  const random = createSelectionRequest({ mode: "random", candidates: ["a", "b", "c"], count: 2 });
  assert.deepEqual(confirmSelection(random, () => 0).selected, ["a", "b"]);
  const state = createGame({ mode: "lab" });
  assert.ok(collectDeckScopeOptions(state, "category").includes("Ob"));
});

test("interactive simultaneous triggers form a selectable thread and dim resolved items", () => {
  const state = createGame({ mode: "lab" });
  state.interactive = true;
  const idol = state.players.player.hand.find((card) => card.id === "STD-191");
  const tana = state.players.player.hand.find((card) => card.id === "STD-192");
  playCard(state, "player", idol.uid, { zone: "back" });
  playCard(state, "player", tana.uid, { zone: "front" });
  state.players.player.memory = 5;
  const effect = getActivatableEffects(state, "player", tana)[0];
  assert.equal(activateCardEffect(state, "player", tana.uid, effect.id, { targetUid: tana.uid, targetZone: "back" }), true);
  assert.equal(state.pending.type, "trigger-order");
  assert.equal(state.triggerThread.items.length, 2);
  assert.equal(resolveTriggerChoice(state, state.triggerThread.items[0].id), true);
  assert.equal(state.triggerThread.items.filter((item) => item.status === "resolved").length, 1);
  const remaining = state.triggerThread.items.find((item) => item.status === "pending");
  assert.equal(resolveTriggerChoice(state, remaining.id), true);
  assert.equal(state.triggerThread.status, "resolved");
  assert.equal(state.threadNotice, "スレッドが解決しました");
});

test("a selection opened by a trigger thread item becomes the pending choice instead of a stranded queue entry", () => {
  const state = createGame({ mode: "lab" });
  state.interactive = true;
  const player = state.players.player;
  const idol = createCardInstance("STD-191", "player", 193001);
  const necria = createCardInstance("STD-193", "player", 193002);
  const own = createCardInstance("STD-020", "player", 193003);
  const enemy = createCardInstance("STD-020", "ai", 193004);
  idol.summoningSick = false; necria.summoningSick = false; own.summoningSick = false;
  player.front = [idol, own]; player.back = [necria]; player.memory = 10;
  state.players.ai.front = [enemy];

  assert.equal(relogCard(state, "player", necria.uid, "front"), true);
  assert.equal(state.pending?.type, "trigger-order");
  const necriaItem = state.triggerThread.items.find((item) => item.cardName === necria.name);
  assert.ok(necriaItem && state.triggerThread.items.length === 2);
  assert.equal(resolveTriggerChoice(state, necriaItem.id), true);
  assert.equal(state.pending?.type, "selection");
  assert.equal(state.pending.request.label, "自分と相手のObを1体ずつ選択");
  assert.equal(state.selectionQueue.length, 0);

  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [] }), true);
  const rest = state.triggerThread.items.find((item) => item.status === "pending");
  if (rest) assert.equal(resolveTriggerChoice(state, rest.id), true);
  assert.equal(state.triggerThread.status, "resolved");
  assert.equal(state.pending, null);
  assert.equal(state.selectionQueue.length, 0);
});

test("a trigger thread resumes after a Script confirmation opened by its selected item is declined", () => {
  const state = createGame({ mode: "lab" });
  state.interactive = true;
  const fakeTrigger = (id) => ({ id, status: "pending", source: { playerId: "ai", card: { name: `T-${id}` } }, event: { type: "test" }, spec: { actions: [] } });
  const first = fakeTrigger("TRG-1"); const second = fakeTrigger("TRG-2");
  state.triggerThread = { id: "THREAD-T", status: "resolving", currentControllerId: "ai", items: [
    { id: "TRG-1", controllerId: "ai", cardName: "T-1", eventType: "test", status: "awaiting-selection", trigger: first },
    { id: "TRG-2", controllerId: "ai", cardName: "T-2", eventType: "test", status: "pending", trigger: second }
  ] };
  state.processingTriggers = false;
  state.prompt = { type: "script-activation", playerId: "player", message: "条件成立：確認", activationWindowId: "none" };
  assert.equal(declinePrompt(state), true);
  assert.equal(state.triggerThread.status, "resolved");
  assert.deepEqual(state.triggerThread.items.map((item) => item.status), ["resolved", "resolved"]);
  assert.equal(second.status, "resolved");
  assert.equal(state.prompt, null);
});

test("lab Vengeance cards connect login and scope effects to the common selector", () => {
  const state = createGame({ mode: "lab" });
  const dolls = state.players.player.hand.find((card) => card.id === "STD-189");
  const copier = state.players.player.hand.find((card) => card.id === "STD-188");
  playCard(state, "player", dolls.uid, { zone: "front" });
  playCard(state, "player", copier.uid, { zone: "front" });
  assert.equal(state.pending.request.mode, "single");
  toggleSelection(state.pending.request, dolls.uid);
  const copierContinuation = state.pending.request.continuation;
  assert.equal(resolveCardSelection(state, copierContinuation, confirmSelection(state.pending.request)), true);
  assert.ok(state.players.player.back.some((card) => card.uid === dolls.uid));
  assert.ok(state.players.player.front.some((card) => card.id === "STD-189"));

  const craft = state.players.player.hand.find((card) => card.id === "STD-207");
  assert.equal(playCard(state, "player", craft.uid), true);
  assert.equal(state.pending.request.mode, "single");
  const reveal = state.pending.request.candidates[0];
  toggleSelection(state.pending.request, reveal);
  const craftContinuation = state.pending.request.continuation;
  assert.equal(resolveCardSelection(state, craftContinuation, confirmSelection(state.pending.request)), true);
  assert.equal(state.players.player.hand.find((card) => card.uid === reveal).turnCostModifier, -2);

  const scrap = state.players.player.hand.find((card) => card.id === "STD-211");
  const artifactTargets = [...state.players.player.front, ...state.players.player.back].filter((card) => String(card.cardClass).includes("アーティファクト"));
  assert.ok(artifactTargets.length > 0);
  assert.equal(playCard(state, "player", scrap.uid, { selectionScope: "アーティファクト" }), true);
  assert.ok(artifactTargets.every((card) => state.players.player.trash.includes(card)));
});

test("Vengeance alternate login effects and Dolls contact use the canonical runtime", () => {
  const swapState = createGame({ mode: "lab" });
  const first = swapState.players.player.hand.find((card) => card.id === "STD-189");
  addSandboxCardToHand(swapState, "player", "STD-189");
  const second = swapState.players.player.hand.filter((card) => card.id === "STD-189" && card.uid !== first.uid)[0];
  playCard(swapState, "player", first.uid, { zone: "front" });
  playCard(swapState, "player", second.uid, { zone: "back" });
  const swapper = swapState.players.player.hand.find((card) => card.id === "STD-196");
  assert.equal(playCard(swapState, "player", swapper.uid, { zone: "back" }), true);
  toggleSelection(swapState.pending.request, first.uid);
  toggleSelection(swapState.pending.request, second.uid);
  assert.equal(resolveCardSelection(swapState, swapState.pending.request.continuation, confirmSelection(swapState.pending.request)), true);
  assert.equal(findCard(swapState, first.uid).zoneName, "back");
  assert.equal(findCard(swapState, second.uid).zoneName, "front");

  const moveState = createGame({ mode: "lab" });
  const decadence = moveState.players.player.hand.find((card) => card.id === "STD-200");
  assert.equal(playCard(moveState, "player", decadence.uid, { zone: "front" }), true);
  setSelectionScope(moveState.pending.request, "back");
  assert.equal(resolveCardSelection(moveState, moveState.pending.request.continuation, confirmSelection(moveState.pending.request)), true);
  assert.equal(findCard(moveState, decadence.uid).zoneName, "back");
  assert.equal(moveState.players.player.front.some((card) => card.id === "STD-201"), true);

  const contactState = createGame({ mode: "lab" });
  const source = contactState.players.player.hand.find((card) => card.id === "STD-198");
  assert.equal(playCard(contactState, "player", source.uid, { zone: "back" }), true);
  const generated = contactState.players.player.front.find((card) => card.id === "STD-189" && card.summoningSick);
  const enemy = contactState.players.ai.front.find((card) => card.category === "Ob");
  enemy.sleep = true;
  assert.equal(canAttack(contactState, "player", generated), true);
  assert.deepEqual(getAttackTargets(contactState, "player", generated).map((target) => target.uid), [enemy.uid]);
});

test("Vengeance Patchwork access, token generation and delayed respawn resolve exactly", () => {
  const accessState = createGame({ mode: "lab" });
  const seam = accessState.players.player.hand.find((card) => card.id === "STD-210");
  const patchwork = createCardInstance("STD-206", "player", 9910);
  accessState.players.player.deck = [patchwork];
  assert.equal(playCard(accessState, "player", seam.uid, { zone: "front" }), true);
  assert.equal(accessState.pending.request.continuation.type, "access-to-hand");
  assert.equal(resolveCardSelection(accessState, accessState.pending.request.continuation, { selected: [patchwork.uid] }), true);
  assert.equal(accessState.players.player.hand.some((card) => card.uid === patchwork.uid), true);
  assert.equal(patchwork.revealed, true);
  assert.equal(executionCost(patchwork, accessState, "player"), 0);
  assert.equal(endTurn(accessState), true);
  assert.equal(executionCost(patchwork, accessState, "player"), patchwork.cost);

  const generationState = createGame({ mode: "lab" });
  const generator = generationState.players.player.hand.find((card) => card.id === "STD-206");
  const beforeDolls = generationState.players.player.hand.filter((card) => card.id === "STD-189").length;
  const beforeGiants = generationState.players.player.hand.filter((card) => card.id === "STD-205").length;
  assert.equal(playCard(generationState, "player", generator.uid), true);
  assert.equal(generationState.players.player.hand.filter((card) => card.id === "STD-189").length, beforeDolls + 1);
  assert.equal(generationState.players.player.hand.filter((card) => card.id === "STD-205").length, beforeGiants + 1);

  const respawnState = createGame({ mode: "lab" });
  const respawn = respawnState.players.player.hand.find((card) => card.id === "STD-212");
  const victim = respawnState.players.player.hand.find((card) => card.id === "STD-189");
  respawnState.players.player.hand.splice(respawnState.players.player.hand.indexOf(victim), 1);
  respawnState.players.player.front.push(victim);
  assert.equal(playCard(respawnState, "player", respawn.uid), true);
  assert.equal(destroyCard(respawnState, "player", victim.uid, { source: "test", suppressReplacement: true }), true);
  const beforeArea = [...respawnState.players.player.front, ...respawnState.players.player.back].filter((card) => card.id === "STD-189").length;
  assert.equal(endTurn(respawnState), false);
  assert.equal(respawnState.pending.request.scopeOptions.includes("0"), true);
  setSelectionScope(respawnState.pending.request, "1");
  assert.equal(resolveCardSelection(respawnState, respawnState.pending.request.continuation, confirmSelection(respawnState.pending.request)), true);
  assert.equal([...respawnState.players.player.front, ...respawnState.players.player.back].filter((card) => card.id === "STD-189").length, beforeArea + 1);
});

test("Necria movement uses grouped exact selection for one own and one enemy Ob", () => {
  const state = createGame({ mode: "lab" });
  const necria = state.players.player.hand.find((card) => card.id === "STD-193");
  assert.equal(playCard(state, "player", necria.uid, { zone: "back" }), true);
  assert.equal(relogCard(state, "player", necria.uid, "front"), true);
  assert.equal(state.pending.type, "selection");
  assert.equal(state.pending.request.groups.length, 2);
  const own = state.pending.request.groups.find((group) => group.id === "own").candidates[0];
  const enemy = state.pending.request.groups.find((group) => group.id === "enemy").candidates[0];
  toggleSelection(state.pending.request, own);
  toggleSelection(state.pending.request, enemy);
  assert.equal(canConfirmSelection(state.pending.request), true);
  const continuation = state.pending.request.continuation;
  assert.equal(resolveCardSelection(state, continuation, confirmSelection(state.pending.request)), true);
  assert.equal(findCard(state, own).zoneName, "trash");
  assert.equal(findCard(state, enemy).zoneName, "trash");
});

test("Q3 existing cards compile their shared restrictions and replacement", () => {
  const cases = [
    ["STD-193", "placement_restriction"],
    ["STD-195", "replace_move_cost"],
    ["STD-201", "mount_restriction"],
    ["STD-205", "modify_damage"]
  ];
  for (const [id, operationType] of cases) {
    const card = CARD_LIBRARY[id];
    const compiled = compileEffectText(card.text, { category: card.category });
    assert.equal(compiled.operations.some((operation) => operation.type === operationType), true, `${id}: ${operationType}`);
    assert.equal(compiled.warnings.some((warning) => warning.code === "unparsed_effect_clause"), false, id);
  }
});

test("Q3 placement and mount restrictions are enforced", () => {
  const state = createGame({ mode: "lab" });
  const necria = state.players.player.hand.find((card) => card.id === "STD-193");
  assert.equal(playCard(state, "player", necria.uid, { zone: "front" }), false);
  assert.equal(playCard(state, "player", necria.uid, { zone: "back" }), true);

  const footprint = state.players.player.hand.find((card) => card.id === "STD-201");
  assert.equal(playCard(state, "player", footprint.uid, { zone: "front" }), true);
  const code = state.players.player.hand.find((card) => card.category === "Code");
  assert.equal(playCard(state, "player", code.uid, { zone: "front", underUid: footprint.uid, free: true }), false);
});

test("STD-195 move discount is optional and resolved by a scope choice", () => {
  const state = createGame({ mode: "tutorial", tutorialId: "vengeance" });
  const idol = state.players.player.hand.find((card) => card.id === "STD-191");
  assert.equal(installCard(state, "player", idol.uid), true);
  const tripvia = state.players.player.hand.find((card) => card.id === "STD-195");
  const dolls = getLayeredCandidates(state, "player", tripvia);
  assert.equal(playLayeredCard(state, "player", tripvia.uid, dolls.map(({ card }) => card.uid), "front"), true);
  const initialLayerCount = tripvia.mounted.length;
  const before = state.players.player.memory;
  assert.equal(relogCard(state, "player", tripvia.uid, "back"), true);
  assert.equal(state.pending?.request?.continuation?.type, "relog-layer-discount");
  setSelectionScope(state.pending.request, "レイヤー1枚を破棄して1メモリ");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  toggleSelection(state.pending.request, tripvia.mounted[0].uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.equal(state.players.player.memory, before - 1);
  assert.equal(tripvia.mounted.length, initialLayerCount - 1);
});

test("STD-205 reduces only Artifact or Masterpiece card damage", () => {
  const state = createGame({ mode: "lab" });
  const gigantes = state.players.player.hand.find((card) => card.id === "STD-205");
  const material = getLayeredCandidates(state, "player", gigantes)[0].card;
  assert.equal(playLayeredCard(state, "player", gigantes.uid, [material.uid], "front"), true);
  const artifact = createCardInstance("STD-201", "ai", 99001);
  state.players.ai.back.push(artifact);
  const ordinary = state.players.ai.front.find((card) => !card.classes?.includes("アーティファクト") && !card.classes?.includes("マスターピース"));
  assert.ok(artifact && ordinary);
  const before = gigantes.damage;
  assert.equal(dealCardDamage(state, "player", gigantes.uid, 2, artifact.name, { sourcePlayerId: "ai" }), true);
  assert.equal(gigantes.damage, before + 1);
  assert.equal(dealCardDamage(state, "player", gigantes.uid, 1, ordinary.name, { sourcePlayerId: "ai" }), true);
  assert.equal(gigantes.damage, before + 2);
});

test("STD-205 snapshots its Login layer bonus instead of tracking later layer changes", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  const player = state.players.player;
  addSandboxCardToHand(state, "player", "STD-205");
  const source = player.hand.find((card) => card.id === "STD-205");
  const material = createCardInstance("STD-020", "player", 205102);
  player.front = [material]; player.memory = 20;
  assert.equal(playLayeredCard(state, "player", source.uid, [material.uid], "front"), true);
  const host = player.front.find((card) => card.uid === source.uid);
  const loginAtk = cardAtk(state, "player", host);
  const loginStr = cardMaxStr(state, "player", host);
  host.mounted.push(createCardInstance("STD-021", "player", 205103));
  assert.equal(cardAtk(state, "player", host), loginAtk);
  assert.equal(cardMaxStr(state, "player", host), loginStr);
});

test("Layered execution excludes enemy, trash, and face-down material candidates", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  const player = state.players.player;
  addSandboxCardToHand(state, "player", "STD-205");
  const source = player.hand.find((card) => card.id === "STD-205");
  const ownFaceDown = createCardInstance("STD-020", "player", 205112); ownFaceDown.faceDown = true;
  const ownValid = createCardInstance("STD-021", "player", 205113);
  const ownTrash = createCardInstance("STD-022", "player", 205114);
  const enemy = createCardInstance("STD-023", "ai", 205115);
  player.front = [ownFaceDown]; player.back = [ownValid]; player.trash = [ownTrash];
  state.players.ai.front = [enemy];
  assert.deepEqual(getLayeredCandidates(state, "player", source).map((entry) => entry.card.uid), [ownValid.uid]);
});

test("Layered execution flattens an inherited stack without losing cards or ownership", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  const player = state.players.player;
  addSandboxCardToHand(state, "player", "STD-205");
  const source = player.hand.find((card) => card.id === "STD-205");
  const material = createCardInstance("STD-020", "player", 205122);
  const code = createCardInstance("STD-078", "player", 205123);
  const deeper = createCardInstance("STD-021", "ai", 205124);
  code.layerRole = "mount"; deeper.layerRole = "layered"; code.mounted = [deeper]; material.mounted = [code];
  player.front = [material]; player.memory = 20;
  assert.equal(playLayeredCard(state, "player", source.uid, [material.uid], "front"), true);
  const host = player.front.find((card) => card.uid === source.uid);
  assert.deepEqual(host.mounted.map((card) => card.uid), [material.uid, code.uid, deeper.uid]);
  assert.deepEqual(host.mounted.map((card) => card.owner), ["player", "player", "ai"]);
  assert.ok(host.mounted.every((card) => card.mounted.length === 0));
});

test("Q3 shared event cards 155 164 218 221 compile without residual effect clauses", () => {
  for (const id of ["STD-155", "STD-164", "STD-218", "STD-221"]) {
    const card = CARD_LIBRARY[id];
    const compiled = compileEffectText(card.text, { category: card.category });
    assert.equal(compiled.warnings.some((warning) => warning.code === "unparsed_effect_clause"), false, id);
  }
});

test("STD-155 optionally destroys one own Ob and draws only after choosing it", () => {
  const state = createGame({ mode: "lab" });
  const source = state.players.player.hand.find((card) => card.id === "STD-155");
  state.players.player.deck.push(createCardInstance("STD-092", "player", 99101), createCardInstance("STD-092", "player", 99102));
  const handBefore = state.players.player.hand.length;
  assert.equal(playCard(state, "player", source.uid, { zone: "front" }), true);
  assert.equal(state.pending?.request?.continuation?.type, "runtime-action-selection");
  const victim = state.players.player.front.find((card) => card.uid !== source.uid && card.category === "Ob");
  toggleSelection(state.pending.request, victim.uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.equal(state.players.player.trash.some((card) => card.uid === victim.uid), true);
  assert.equal(state.players.player.hand.length, handBefore + 1);

  const zero = createGame({ mode: "lab" });
  const zeroSource = zero.players.player.hand.find((card) => card.id === "STD-155");
  assert.equal(playCard(zero, "player", zeroSource.uid, { zone: "front" }), true);
  const zeroHand = zero.players.player.hand.length;
  assert.equal(resolveCardSelection(zero, zero.pending.request.continuation, confirmSelection(zero.pending.request)), true);
  assert.equal(zero.players.player.hand.length, zeroHand);
});

test("STD-164 triggers only for own destruction during its controller turn", () => {
  const state = createGame({ mode: "lab" });
  const script = state.players.player.hand.find((card) => card.id === "STD-164");
  assert.equal(playCard(state, "player", script.uid, { zone: "back" }), true);
  script.faceDown = false;
  script.residentActive = true;
  const victim = state.players.player.front.find((card) => card.category === "Ob");
  assert.equal(destroyCard(state, "player", victim.uid, { source: "test", suppressReplacement: true }), true);
  const item = state.triggerThread?.items?.find((entry) => entry.trigger.source.card.id === "STD-164");
  if (item?.status === "pending") assert.equal(resolveTriggerChoice(state, item.id), true);
  assert.equal(state.pending?.request?.continuation?.type, "std164-choice");
  setSelectionScope(state.pending.request, "①相手の手札を1枚捨てる");
  const before = state.players.ai.hand.length;
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.equal(state.players.ai.hand.length, Math.max(0, before - 1));
});

test("STD-218 recovers for either registry leaving and STD-221 uses registry execution damage", () => {
  const state = createGame({ mode: "lab" });
  const merchant = state.players.player.hand.find((card) => card.id === "STD-218");
  assert.equal(playCard(state, "player", merchant.uid, { zone: "back" }), true);
  state.players.player.memory = 0;
  const recoverable = createCardInstance("STD-092", "ai", 99201);
  state.players.ai.registry.push(recoverable);
  state.active = "ai";
  assert.equal(recoverRegistryCard(state, "ai", recoverable.uid), true);
  assert.equal(state.players.player.memory, 1);

  const normal = createGame({ mode: "lab" });
  const attacker = normal.players.player.hand.find((card) => card.id === "STD-221");
  const beforeNormal = normal.players.ai.fortressStr;
  assert.equal(playCard(normal, "player", attacker.uid, { zone: "front" }), true);
  assert.equal(normal.players.ai.fortressStr, beforeNormal - 1);

  const registry = createGame({ mode: "lab" });
  const doctor = registry.players.player.hand.find((card) => card.id === "STD-236");
  assert.equal(playCard(registry, "player", doctor.uid, { zone: "back" }), true);
  registry.pending = null;
  const registryAttacker = registry.players.player.hand.find((card) => card.id === "STD-221");
  registry.players.player.hand.splice(registry.players.player.hand.indexOf(registryAttacker), 1);
  registry.players.player.registry.push(registryAttacker);
  const beforeRegistry = registry.players.ai.fortressStr;
  assert.equal(executeRegistryCard(registry, "player", registryAttacker.uid, { zone: "front" }), true);
  assert.equal(registry.players.ai.fortressStr, beforeRegistry - 3);
});

test("Doll Assault and Takeover execute their previously missing runtime branches", () => {
  const assaultState = createGame({ mode: "lab" });
  const own = assaultState.players.player.hand.find((card) => card.id === "STD-189");
  playCard(assaultState, "player", own.uid, { zone: "front" });
  const enemy = assaultState.players.ai.front.find((card) => card.category === "Ob");
  const assault = assaultState.players.player.hand.find((card) => card.id === "STD-203");
  assert.equal(playCard(assaultState, "player", assault.uid, { targetUids: [own.uid, enemy.uid] }), true);
  assert.equal(findCard(assaultState, own.uid).zoneName, "trash");
  assert.ok(findCard(assaultState, enemy.uid).zoneName === "trash" || enemy.damage === 2);

  const takeoverState = createGame({ mode: "lab" });
  const takeover = takeoverState.players.player.hand.find((card) => card.id === "STD-204");
  assert.equal(playCard(takeoverState, "player", takeover.uid, { zone: "back" }), true);
  const occupied = createCardInstance("STD-020", "player", 204090);
  Object.assign(occupied, { boardSlot: 1, boardSlotController: "player", boardSlotZone: "front" });
  takeoverState.players.player.front = [occupied];
  takeoverState.active = "ai";
  takeoverState.players.ai.memory = 99;
  let executed = takeoverState.players.ai.hand.find((card) => card.category === "Ob");
  if (!executed) {
    const index = takeoverState.players.ai.deck.findIndex((card) => card.category === "Ob");
    if (index >= 0) [executed] = takeoverState.players.ai.deck.splice(index, 1);
    else [executed] = takeoverState.players.ai.front.splice(0, 1);
    takeoverState.players.ai.hand.push(executed);
  }
  assert.ok(executed);
  assert.equal(playCard(takeoverState, "ai", executed.uid, { zone: "front", force: true }), true);
  const executedSlot = executed.boardSlot;
  assert.equal(takeoverState.prompt.scriptUid, takeover.uid);
  assert.equal(activateScript(takeoverState, "player", takeover.uid), true);
  const gigantes = [...takeoverState.players.player.front, ...takeoverState.players.player.back].find((card) => card.id === "STD-205");
  assert.equal(gigantes.mounted[0].uid, executed.uid);
  assert.equal(executedSlot, 1);
  assert.equal(occupied.boardSlot, 1);
  assert.equal(takeoverState.players.player.front.includes(occupied), true);
  assert.equal(gigantes.boardSlot, 2);
  assert.equal(findCard(takeoverState, executed.uid), null);
});

test("previously missing attack-declaration cards use optional common selection", () => {
  const repaState = createGame({ mode: "lab" });
  const repaIndex = repaState.players.player.hand.findIndex((card) => card.id === "STD-102");
  const [repa] = repaState.players.player.hand.splice(repaIndex, 1);
  const layerIndex = repaState.players.player.hand.findIndex((card) => card.id === "STD-078");
  const [layer] = repaState.players.player.hand.splice(layerIndex, 1);
  repa.mounted = [layer];
  repa.summoningSick = false;
  repaState.players.player.front.push(repa);
  const trashTarget = createCardInstance("STD-020", "player", 102901);
  trashTarget.cost = 2;
  repaState.players.player.trash.push(trashTarget);
  assert.equal(attack(repaState, "player", repa.uid, "ai-fortress"), true);
  assert.equal(repaState.pending.request.mode, "scope");
  setSelectionScope(repaState.pending.request, "レイヤー1枚を破棄して起動");
  assert.equal(resolveCardSelection(repaState, repaState.pending.request.continuation, confirmSelection(repaState.pending.request)), true);
  assert.equal(repaState.pending.request.mode, "single");
  toggleSelection(repaState.pending.request, layer.uid);
  assert.equal(resolveCardSelection(repaState, repaState.pending.request.continuation, confirmSelection(repaState.pending.request)), true);
  assert.equal(repaState.pending.request.mode, "up_to");
  toggleSelection(repaState.pending.request, trashTarget.uid);
  const repaContinuation = repaState.pending.request.continuation;
  assert.equal(resolveCardSelection(repaState, repaContinuation, confirmSelection(repaState.pending.request)), true);
  assert.equal(repa.mounted.length, 0);
  assert.notEqual(findCard(repaState, trashTarget.uid).zoneName, "trash");

  const guardState = createGame({ mode: "lab" });
  const guardIndex = guardState.players.player.hand.findIndex((card) => card.id === "STD-136");
  const [guard] = guardState.players.player.hand.splice(guardIndex, 1);
  const sacrificeIndex = guardState.players.player.hand.findIndex((card) => card.category === "Ob");
  const [sacrifice] = guardState.players.player.hand.splice(sacrificeIndex, 1);
  guard.summoningSick = false;
  guardState.players.player.front.push(guard, sacrifice);
  assert.equal(attack(guardState, "player", guard.uid, "ai-fortress"), true);
  toggleSelection(guardState.pending.request, sacrifice.uid);
  const guardContinuation = guardState.pending.request.continuation;
  assert.equal(resolveCardSelection(guardState, guardContinuation, confirmSelection(guardState.pending.request)), true);
  assert.equal(guard.sleep, false);
  assert.equal(findCard(guardState, sacrifice.uid).zoneName, "trash");
});

test("both users are Doors ZX; human is red and AI is yellow", () => {
  const state = createGame({ mode: "tutorial" });
  assert.equal(state.players.player.user.name, "Doors ZX");
  assert.equal(state.players.ai.user.name, "Doors ZX");
  assert.equal(state.players.player.hand.some((card) => card.color === "赤"), true);
  assert.equal(state.players.ai.hand.some((card) => card.color === "黄"), true);
  const junky = state.players.player.hand.find((card) => card.id === "STD-075");
  assert.equal(cardAtk(state, "player", junky), 1);
});

test("sandbox and lab obey the user card front and back limits", () => {
  for (const mode of ["sandbox", "lab"]) {
    const state = createGame({ mode });
    const player = state.players.player;
    assert.equal(player.user.frontLimit, 5);
    assert.equal(player.user.backLimit, 5);
    while (player.front.length < player.user.frontLimit) {
      player.front.push(createCardInstance("STD-020", "player", 800000 + player.front.length));
    }
    const extra = createCardInstance("STD-020", "player", 800099);
    player.hand.push(extra);
    assert.equal(playCard(state, "player", extra.uid, { zone: "front", free: true, force: true, ignoreColor: true }), false);
    assert.ok(player.hand.some((card) => card.uid === extra.uid));
  }
});

test("all non-Alternative user cards apply their printed base values", () => {
  const expected = {
    suckintosh: [20, 5, 5, 5, 4], phoenix: [20, 5, 5, 5, 4], humanoid: [18, 5, 5, 5, 4],
    by_os: [1, 3, 3, 3, 8], doors_nt: [16, 4, 4, 4, 3], savage_salvage: [15, 6, 3, 4, 4],
    extreme: [60, 10, 2, 2, 4], bigboss: [25, 5, 1, 5, 5]
  };
  for (const [userId, values] of Object.entries(expected)) {
    const state = createGame({ mode: "ai", playerUserId: userId });
    const player = state.players.player;
    assert.deepEqual([player.user.maxStr, player.user.memory, player.user.frontLimit, player.user.backLimit, player.user.initialHand], values);
    assert.equal(player.hand.length, values[4]);
  }
});

test("Suckintosh, EXTREME, Humanoid and By OS user abilities resolve", () => {
  const mono = createGame({ mode: "sandbox", playerUserId: "suckintosh" });
  mono.players.player.registry = [createCardInstance("STD-075", "player", 910001)];
  const ob = createCardInstance("STD-020", "player", 910002);
  assert.equal(cardAtk(mono, "player", ob), Number(ob.atk) + 1);
  const extreme = createGame({ mode: "sandbox", playerUserId: "extreme" });
  const extremeBefore = extreme.players.player.fortressStr;
  dealFortressDamage(extreme, "player", 3, "ai", "test");
  assert.equal(extreme.players.player.fortressStr, extremeBefore - 6);
  const humanoid = createGame({ mode: "sandbox", playerUserId: "humanoid" });
  dealFortressDamage(humanoid, "player", 99, "ai", "test");
  assert.equal(humanoid.players.player.fortressStr, 1);
  const byos = createGame({ mode: "sandbox", playerUserId: "by_os" });
  const deckBefore = byos.players.player.deck.length;
  dealFortressDamage(byos, "player", 2, "ai", "test");
  assert.equal(byos.players.player.fortressStr, 1);
  assert.equal(byos.players.player.deck.length, deckBefore - 2);
  assert.equal(byos.players.player.ban.length, 2);
});

test("PHOENIX and BIGBOSS user abilities use common install and cost runtime", () => {
  const phoenix = createGame({ mode: "sandbox", playerUserId: "phoenix" });
  const p = phoenix.players.player; p.hand = [createCardInstance("STD-020", "player", 920001)];
  p.deck = [createCardInstance("STD-021", "player", 920002)]; p.registryActionUsed = false;
  assert.equal(installCard(phoenix, "player", p.hand[0].uid), true);
  assert.equal(p.hand.length, 1); assert.equal(p.registryActionUsed, false); assert.equal(p.firstRegistryInstallResolved, true);
  const boss = createGame({ mode: "sandbox", playerUserId: "bigboss" });
  assert.equal(executionCost(createCardInstance("STD-010", "player", 920010), boss, "player"), 1);
  assert.equal(executionCost(createCardInstance("STD-020", "player", 920011), boss, "player"), 2);
  assert.equal(activateTurbo(boss, "player"), false);
});

test("Doors NT first-Ob discount belongs only to its own user", () => {
  const state = createGame({ mode: "ai", playerUserId: "doors_zx", aiUserId: "doors_nt" });
  const ownOb = createCardInstance("STD-020", "player", 920101);
  const ntOb = createCardInstance("STD-020", "ai", 920102);
  assert.equal(executionCost(ownOb, state, "player"), ownOb.cost);
  assert.equal(executionCost(ntOb, state, "ai"), Math.max(0, ntOb.cost - 1));
});

test("Doors NT three-Ob turn-end recovery belongs only to its own user", () => {
  const regular = createGame({ mode: "ai", playerUserId: "doors_zx", aiUserId: "doors_nt" });
  regular.players.player.front = [1, 2, 3].map((serial) => createCardInstance("STD-020", "player", 920200 + serial));
  regular.players.player.fortressStr = 10;
  regular.players.player.memory = 2;
  endTurn(regular);
  assert.equal(regular.players.player.fortressStr, 10);
  assert.equal(regular.players.player.memory, 2);

  const nt = createGame({ mode: "ai", playerUserId: "doors_nt", aiUserId: "doors_zx" });
  nt.players.player.front = [1, 2, 3].map((serial) => createCardInstance("STD-020", "player", 920300 + serial));
  nt.players.player.fortressStr = 10;
  nt.players.player.memory = 2;
  endTurn(nt);
  assert.equal(nt.players.player.fortressStr, 11);
  assert.equal(nt.players.player.memory, 3);
  const recovery = nt.events.find((event) => event.type === "user_ability_feedback" && event.abilityKey === "do_or_isnt" && event.branch === "exact-three-recovery");
  assert.deepEqual([recovery.strBefore, recovery.strAfter, recovery.memoryBefore, recovery.memoryAfter], [10, 11, 2, 3]);
});

test("Doors NT five-Ob damage reduction belongs only to its own user", () => {
  const regular = createGame({ mode: "ai", playerUserId: "doors_zx", aiUserId: "doors_nt" });
  regular.players.player.front = [1, 2, 3, 4, 5].map((serial) => createCardInstance("STD-020", "player", 920400 + serial));
  const regularBefore = regular.players.ai.fortressStr;
  dealFortressDamage(regular, "ai", 2, "player", regular.players.player.front[0].name);
  assert.equal(regular.players.ai.fortressStr, regularBefore - 2);

  const nt = createGame({ mode: "ai", playerUserId: "doors_nt", aiUserId: "doors_zx" });
  nt.players.player.front = [1, 2, 3].map((serial) => createCardInstance("STD-020", "player", 920500 + serial));
  nt.players.player.back = [4, 5].map((serial) => createCardInstance("STD-020", "player", 920500 + serial));
  const ntBefore = nt.players.ai.fortressStr;
  dealFortressDamage(nt, "ai", 2, "player", nt.players.player.front[0].name);
  assert.equal(nt.players.ai.fortressStr, ntBefore - 1);
});

test("tutorial applies mount choice, attack delay and optional Lucky Shot", () => {
  const state = createGame({ mode: "tutorial" });
  const flow = createTutorialFlow();
  assert.equal(currentTutorialPresentation(flow).speaker, "じぐさぽ");
  assert.equal(completeTutorialIntroduction(flow), true);
  assert.equal(acceptTutorialAction(state, flow, { type: "advance" }), true);

  const thief = state.players.player.hand.find((card) => card.id === "STD-076");
  assert.equal(installCard(state, "player", thief.uid), true);
  assert.equal(acceptTutorialAction(state, flow, { type: "install", cardId: "STD-076" }), true);

  const junky = state.players.player.hand.find((card) => card.id === "STD-075");
  assert.equal(playCard(state, "player", junky.uid), true);
  assert.equal(acceptTutorialAction(state, flow, { type: "play", cardId: "STD-075" }), true);
  assert.equal(attack(state, "player", junky.uid, "ai-fortress"), true);
  assert.equal(acceptTutorialAction(state, flow, { type: "attack", cardId: "STD-075", targetType: "fortress" }), true);
  assert.equal(state.players.ai.fortressStr, 19);

  endTurn(state);
  assert.equal(acceptTutorialAction(state, flow, { type: "end-turn" }), true);
  assert.equal(state.active, "player");
  const wall = state.players.ai.front.find((card) => card.id === "STD-131");
  assert.equal(wall.sleep, true);
  assert.equal(state.players.player.trash.some((card) => card.id === "STD-075"), true);

  const kaneko = state.players.player.hand.find((card) => card.id === "STD-090");
  assert.equal(playCard(state, "player", kaneko.uid, { zone: "front" }), true);
  assert.equal(acceptTutorialAction(state, flow, { type: "play", cardId: "STD-090", zone: "front" }), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [state.pending.request.candidates[0]] }), true);
  assert.equal(resolveAccessDragPlacement(state, "player", "front"), true);
  const accessedParts = state.players.player.front.find((card) => card.id === "STD-078");
  assert.equal(state.players.player.front.includes(accessedParts), true);
  assert.equal(canAttack(state, "player", kaneko), false);
  assert.equal(attack(state, "player", kaneko.uid, "ai-fortress"), false);

  endTurn(state);
  assert.equal(acceptTutorialAction(state, flow, { type: "end-turn" }), true);
  assert.equal(state.active, "player");
  assert.equal(canAttack(state, "player", kaneko), true);
  assert.equal(attack(state, "player", kaneko.uid, "ai-fortress"), true);
  assert.equal(acceptTutorialAction(state, flow, { type: "attack", cardId: "STD-090" }), true);
  assert.equal(wall.damage, 1);

  const shot = state.players.player.hand.find((card) => card.id === "STD-086");
  assert.equal(playCard(state, "player", shot.uid, { targetUid: wall.uid }), true);
  assert.equal(state.pending.type, "selection");
  assert.equal(state.pending.request.mode, "up_to");
  assert.equal(state.players.ai.fortressStr, 19);
  assert.equal(acceptTutorialAction(state, flow, { type: "play", cardId: "STD-086", targetCardId: "STD-131" }), true);
  assert.equal(resolveLuckyShotAdditional(state, "player", accessedParts.uid), true);
  assert.equal(state.players.player.trash.includes(accessedParts), true);
  assert.equal(flow.complete, true);
  assert.equal(state.players.ai.fortressStr, 17);
  assert.deepEqual(state.players.ai.incidentsTriggered, []);
  assert.equal(state.players.ai.trash.some((card) => card.id === "STD-131"), true);
  assert.equal(state.players.ai.hand.some((card) => card.id === "STD-131"), false);
  assert.equal(state.pending, null);
});

test("Code remains in its square when the upper Ob relogs", () => {
  const state = createGame({ mode: "tutorial" });
  const thief = state.players.player.hand.find((card) => card.id === "STD-076");
  assert.equal(installCard(state, "player", thief.uid), true);
  const kaneko = state.players.player.hand.find((card) => card.id === "STD-090");
  assert.equal(playCard(state, "player", kaneko.uid, { zone: "front" }), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [state.pending.request.candidates[0]] }), true);
  assert.equal(resolveAccessDragPlacement(state, "player", "back"), true);
  const parts = state.players.player.back.find((card) => card.id === "STD-078");
  const junky = state.players.player.hand.find((card) => card.id === "STD-075");
  assert.equal(playCard(state, "player", junky.uid, { zone: "back", baseUid: parts.uid }), true);
  assert.equal(junky.mounted[0], parts);
  junky.damage = 1;
  state.players.player.memory = 10;
  assert.equal(relogCard(state, "player", junky.uid, "front"), true);
  assert.equal(state.players.player.front.includes(junky), true);
  assert.equal(state.players.player.back.includes(parts), true);
  assert.equal(junky.damage, 1);
  assert.equal(junky.mounted.length, 0);
  assert.equal(state.players.player.memory, 9);
});

test("layered material follows layer 1 while ordinary mounted Code remains in the square", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const top = createCardInstance("STD-195", "player", 998001);
  const material = createCardInstance("STD-189", "player", 998002);
  const temporary = createCardInstance("STD-189", "player", 998003);
  const code = createCardInstance("STD-008", "player", 998004);
  material.layerRole = "layered";
  temporary.layerRole = "layered"; temporary.temporaryLayer = true;
  code.layerRole = "mount";
  top.mounted = [material, temporary, code];
  player.front = [top];
  assert.equal(destroyCard(state, "player", top.uid, { source: "layer exit test", suppressReplacement: true, suppressTrashScriptWindow: true }), true);
  assert.ok(player.trash.includes(top));
  assert.ok(player.trash.includes(material));
  assert.ok(player.ban.includes(temporary));
  assert.ok(player.front.includes(code));
  assert.equal(top.mounted.length, 0);
});

test("Code may execute directly under an existing Ob and remains after it leaves", () => {
  const state = createGame({ mode: "tutorial" });
  const thief = state.players.player.hand.find((card) => card.id === "STD-076");
  installCard(state, "player", thief.uid);
  const kaneko = state.players.player.hand.find((card) => card.id === "STD-090");
  assert.equal(playCard(state, "player", kaneko.uid, { zone: "front" }), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [state.pending.request.candidates[0]] }), true);
  const partsUid = state.pending.sourceUid;
  assert.equal(resolveAccessDragPlacement(state, "player", "front", kaneko.uid), true);
  const parts = kaneko.mounted.find((card) => card.uid === partsUid);
  assert.equal(kaneko.mounted.includes(parts), true);
  assert.equal(destroyCard(state, "player", kaneko.uid, { source: "test", suppressReplacement: true }), true);
  assert.equal(state.players.player.front.includes(parts), true);
});

test("an Ob may execute over standalone Code and trigger Sam login", () => {
  const state = createGame({ mode: "tutorial" });
  const thief = state.players.player.hand.find((card) => card.id === "STD-076");
  installCard(state, "player", thief.uid);
  state.players.player.memory = 20;
  const partsIndex = state.players.player.deck.findIndex((card) => card.id === "STD-078");
  const [parts] = state.players.player.deck.splice(partsIndex, 1);
  state.players.player.hand.push(parts);
  assert.equal(playCard(state, "player", parts.uid, { zone: "back" }), true);
  const samIndex = state.players.player.deck.findIndex((card) => card.id === "STD-077");
  const [sam] = state.players.player.deck.splice(samIndex, 1);
  state.players.player.hand.push(sam);
  state.players.player.hand.push(createCardInstance("STD-078", "player", 77001));
  const handBefore = state.players.player.hand.length;
  assert.equal(playCard(state, "player", sam.uid, { zone: "back", baseUid: parts.uid }), true);
  assert.equal(sam.mounted[0], parts);
  assert.equal(state.pending.type, "selection");
  assert.equal(state.pending.request.mode, "single");
  const discard = state.players.player.hand.find((card) => card.id === "STD-078");
  assert.equal(resolveSamLogin(state, "player", discard.uid), true);
  assert.equal(state.players.player.hand.length, handBefore);
});

test("effect text without front restriction can target a back Ob", () => {
  const state = createGame({ mode: "tutorial" });
  const thief = state.players.player.hand.find((card) => card.id === "STD-076");
  installCard(state, "player", thief.uid);
  const target = state.players.ai.deck.find((card) => card.id === "STD-127");
  state.players.ai.deck.splice(state.players.ai.deck.indexOf(target), 1);
  state.players.ai.back.push(target);
  const shot = state.players.player.hand.find((card) => card.id === "STD-086");
  assert.equal(getEffectTargets(state, "ai", shot).includes(target), true);
  assert.equal(playCard(state, "player", shot.uid, { targetUid: target.uid }), true);
  assert.equal(target.damage, 3);
});

test("damage remains on surviving cards at turn start", () => {
  const state = createGame({ mode: "tutorial" });
  const target = state.players.ai.deck.find((card) => card.id === "STD-127");
  state.players.ai.deck.splice(state.players.ai.deck.indexOf(target), 1);
  state.players.ai.front.push(target);
  target.summoningSick = false;
  assert.equal(dealCardDamage(state, "ai", target.uid, 2, "test"), true);
  startTurn(state, "ai");
  assert.equal(target.damage, 2);
});

test("QA attacks normally while same-turn Contact can only attack sleeping Ob", () => {
  const state = createGame({ mode: "tutorial" });
  const thief = state.players.player.hand.find((card) => card.id === "STD-076");
  installCard(state, "player", thief.uid);
  const junky = state.players.player.hand.find((card) => card.id === "STD-075");
  playCard(state, "player", junky.uid);
  assert.equal(canAttack(state, "player", junky), true);

  const contact = state.players.ai.deck.find((card) => card.id === "STD-136");
  state.players.ai.deck.splice(state.players.ai.deck.indexOf(contact), 1);
  state.players.ai.hand.push(contact);
  assert.equal(playCard(state, "ai", contact.uid, { force: true, free: true, ignoreColor: true }), true);
  state.active = "ai";
  assert.equal(canAttack(state, "ai", contact), false);
  const target = state.players.player.front[0];
  target.sleep = true;
  assert.equal(canAttack(state, "ai", contact), true);
  const targets = getAttackTargets(state, "ai", contact);
  assert.deepEqual(targets.map((item) => item.uid), [target.uid]);
  assert.equal(targets.some((item) => item.type === "fortress"), false);
});

test("Backup without a number replaces destruction only once per turn", () => {
  const state = createGame({ mode: "tutorial" });
  const thief = state.players.player.hand.find((card) => card.id === "STD-076");
  assert.equal(playCard(state, "player", thief.uid, { free: true, ignoreColor: true }), true);
  assert.equal(destroyCard(state, "player", thief.uid, { source: "test" }), true);
  assert.equal(state.players.player.back.includes(thief), true);
  state.players.player.back.splice(state.players.player.back.indexOf(thief), 1);
  state.players.player.front.push(thief);
  assert.equal(destroyCard(state, "player", thief.uid, { source: "test" }), true);
  assert.equal(state.players.player.trash.includes(thief), true);
});

test("incident triggers once when crossing threshold", () => {
  const state = createGame({ mode: "ai", rng: () => 0.25 });
  const aiHandBefore = state.players.ai.hand.length;
  dealFortressDamage(state, "player", 6, "ai", "test");
  assert.equal(state.players.player.fortressStr, 14);
  assert.deepEqual(state.players.player.incidentsTriggered, [15]);
  assert.equal(state.players.player.memory, 6);
  assert.equal(state.players.player.permanentMemory, 1);
  assert.equal(state.players.ai.hand.length, aiHandBefore + 1);
  dealFortressDamage(state, "player", 1, "ai", "test");
  assert.deepEqual(state.players.player.incidentsTriggered, [15]);
});

test("simple AI takes a complete yellow turn and returns control", () => {
  const state = createGame({ mode: "ai", rng: () => 0.42 });
  endTurn(state);
  assert.equal(state.active, "ai");
  runSimpleAiTurn(state, "ai");
  assert.equal(state.active, "player");
  assert.equal(state.players.ai.registry.length, 1);
  assert.ok(state.players.ai.front.length + state.players.ai.trash.length > 0);
});

test("paced AI steps preserve the synchronous AI result", () => {
  const synchronous = createGame({ mode: "ai", rng: () => 0.42 });
  const stepped = createGame({ mode: "ai", rng: () => 0.42 });
  endTurn(synchronous);
  endTurn(stepped);
  const synchronousSteps = runSimpleAiTurn(synchronous, "ai");
  const steps = [...runSimpleAiTurnSteps(stepped, "ai")];
  assert.equal(steps.length, synchronousSteps);
  assert.ok(steps.length >= 2);
  assert.equal(steps.at(-1).type, "turn-end");
  const stableSnapshot = (state) => {
    const copy = JSON.parse(JSON.stringify(state));
    copy.log = copy.log.map(({ id: _id, ...entry }) => entry);
    return copy;
  };
  assert.deepEqual(stableSnapshot(stepped), stableSnapshot(synchronous));
});

test("test lab exposes all registered cards and prepared public zones", () => {
  const state = createGame({ mode: "lab" });
  const handIds = state.players.player.hand.map((card) => card.id);
  assert.equal(state.active, "player");
  assert.equal(state.players.player.memory, 99);
  assert.ok(handIds.includes("STD-036"));
  assert.ok(handIds.every((id) => /^(STD|SZTB)-/.test(id)));
  assert.ok(handIds.includes("STD-224"));
  assert.ok(state.players.ai.front.some((card) => card.category === "Ob"));
  assert.ok(state.players.ai.back.some((card) => card.category === "Script" && card.faceDown));
  assert.ok(state.players.ai.back.some((card) => card.category === "Code"));
  assert.ok(state.players.ai.front.some((card) => card.mounted.some((layer) => layer.category === "Code")));
});

test("if Script prompts after its condition and resolves from the bottom prompt", () => {
  const state = createGame({ mode: "lab" });
  const script = state.players.player.hand.find((card) => card.id === "STD-036");
  assert.equal(playCard(state, "player", script.uid, { zone: "back" }), true);
  assert.equal(script.faceDown, true);

  const victim = state.players.player.front.find((card) => card.id === "STD-020");
  assert.equal(destroyCard(state, "player", victim.uid, { source: "test" }), true);
  assert.equal(state.prompt?.type, "script-activation");
  assert.equal(state.prompt?.scriptUid, script.uid);

  const before = state.players.player.hand.length;
  const deckCards = state.players.player.hand.splice(0, 2);
  state.players.player.deck.push(...deckCards);
  assert.equal(activateScript(state, "player", script.uid), true);
  assert.equal(state.prompt, null);
  assert.equal(state.players.player.memory, 98);
  assert.equal(state.players.player.trash.includes(script), true);
  assert.equal(state.players.player.hand.length, before);
});

test("resident Script remains active only while it remains in the area", () => {
  const state = createGame({ mode: "lab" });
  const script = state.players.player.hand.find((card) => card.id === "SZTB-090");
  assert.equal(playCard(state, "player", script.uid, { zone: "back" }), true);
  assert.equal(activateScript(state, "player", script.uid), true);
  assert.equal(script.residentActive, true);
  assert.equal(state.players.player.back.includes(script), true);
  assert.equal(destroyCard(state, "player", script.uid, { source: "test" }), true);
  assert.equal(state.players.player.back.includes(script), false);
  assert.equal(state.players.player.trash.includes(script), true);
});

test("registry permits exactly one install or recovery action per own turn", () => {
  const state = createGame({ mode: "lab" });
  const plugin = state.players.player.hand.find((card) => card.id === "STD-224");
  assert.equal(installCard(state, "player", plugin.uid), true);
  assert.equal(state.players.player.registryActionUsed, true);
  assert.equal(state.prompt?.type, "plugin-number");
  assert.equal(configurePlugin(state, "player", plugin.uid, 4), true);
  assert.equal(plugin.pluginValue, 4);
  const otherCard = state.players.player.hand.find((card) => card.uid !== plugin.uid);
  assert.equal(installCard(state, "player", otherCard.uid), false);
  assert.equal(recoverRegistryCard(state, "player", plugin.uid), false);

  state.players.player.deck.push(createCardInstance("STD-020", "player", 899901));
  endTurn(state);
  assert.equal(state.active, "player");
  assert.equal(state.players.player.registryActionUsed, false);
  assert.equal(recoverRegistryCard(state, "player", plugin.uid), true);
  assert.equal(state.players.player.registry.includes(plugin), false);
  assert.equal(state.players.player.hand.includes(plugin), true);
});

test("sleeping Ob still deals its ATK as simultaneous combat damage", () => {
  const state = createGame({ mode: "tutorial" });
  const attacker = state.players.player.hand.find((card) => card.id === "STD-075");
  const defender = state.players.ai.hand.find((card) => card.id === "STD-131");
  state.players.player.front.push(attacker);
  state.players.player.hand.splice(state.players.player.hand.indexOf(attacker), 1);
  state.players.ai.front.push(defender);
  state.players.ai.hand.splice(state.players.ai.hand.indexOf(defender), 1);
  attacker.summoningSick = false;
  defender.sleep = true;

  assert.equal(attack(state, "player", attacker.uid, defender.uid), true);
  assert.equal(attacker.damage, cardAtk(state, "ai", defender));
  assert.equal(defender.damage, cardAtk(state, "player", attacker));
});

test("destroyed virtual cards move to trash like normal cards", () => {
  const state = createGame({ mode: "lab" });
  const token = createToken("player", 100001);
  state.players.player.front.push(token);
  assert.equal(destroyCard(state, "player", token.uid, { source: "test" }), true);
  assert.equal(state.players.player.trash.includes(token), true);
  assert.equal(state.players.player.virtual.includes(token), false);
});

test("deck-out loses only on the mandatory turn-start draw", () => {
  const state = createGame({ mode: "tutorial" });
  state.players.player.deck = [];
  state.players.player.turnsTaken = 1;
  assert.equal(drawCards(state, "player", 1), 0);
  assert.equal(state.winner, null);

  startTurn(state, "player");
  assert.equal(state.winner, "ai");
  assert.deepEqual(state.victory, { lockedOutcome: "ai", lockedAtEffectId: null, finished: true });
});

test("victory lock and game finish remain separate while declared internal work exists", () => {
  const state = createGame({ mode: "sandbox" });
  state.winner = "player";
  state.victory = { lockedOutcome: "player", lockedAtEffectId: "EFFECT-LOCK", finished: false };
  state.effectResolution = { id: "EFFECT-DECLARED", status: "awaiting-choice" };
  assert.equal(finishGameIfSettled(state), false);
  assert.equal(state.victory.finished, false);
  state.effectResolution = null;
  state.pending = { type: "selection", resolutionMeta: { owner: "declared-effect" } };
  assert.equal(finishGameIfSettled(state), false);
  state.pending = null;
  assert.equal(finishGameIfSettled(state), true);
  assert.equal(state.victory.finished, true);
  assert.equal(finishGameIfSettled(state), false);
});

test("victory lock rejects new card plays before the finish presentation", () => {
  const state = createGame({ mode: "sandbox" });
  const card = createCardInstance("STD-020", "player", 97001);
  state.players.player.hand.push(card);
  const before = cloneForHistory(state);
  state.winner = "player";
  state.victory = { lockedOutcome: "player", lockedAtEffectId: "EFFECT-LOCK", finished: false };
  assert.equal(playCard(state, "player", card.uid), false);
  assert.deepEqual(state.players.player.hand.map((item) => item.uid), before.players.player.hand.map((item) => item.uid));
  assert.equal(state.victory.finished, false);
});

test("ordinary player attack locks and finishes lethal fortress damage at the attack boundary", () => {
  const state = createGame({ mode: "lab" });
  const attacker = createCardInstance("STD-020", "player", 97031);
  attacker.summoningSick = false;
  state.players.player.front = [attacker];
  state.players.ai.front = [];
  state.players.ai.fortressStr = 1;

  assert.equal(attack(state, "player", attacker.uid, "ai-fortress"), true);
  assert.equal(state.players.ai.fortressStr, 0);
  assert.equal(state.winner, "player");
  assert.equal(state.victory.lockedOutcome, "player");
  assert.match(state.victory.lockedAtEffectId, /^EFFECT-/);
  assert.equal(state.victory.finished, true);
  assert.equal(state.effectResolution, null);
  assert.equal(attack(state, "player", attacker.uid, "ai-fortress"), false);
  assert.equal(endTurn(state), false);
});

test("ordinary AI attack locks and finishes lethal fortress damage at the attack boundary", () => {
  const state = createGame({ mode: "lab" });
  const attacker = createCardInstance("STD-020", "ai", 97032);
  attacker.summoningSick = false;
  state.active = "ai";
  state.players.ai.front = [attacker];
  state.players.player.front = [];
  state.players.player.fortressStr = 1;

  assert.equal(attack(state, "ai", attacker.uid, "player-fortress"), true);
  assert.equal(state.players.player.fortressStr, 0);
  assert.equal(state.winner, "ai");
  assert.equal(state.victory.lockedOutcome, "ai");
  assert.equal(state.victory.finished, true);
});

test("ordinary nonlethal attack completes its boundary without locking a result", () => {
  const state = createGame({ mode: "lab" });
  const attacker = createCardInstance("STD-020", "player", 97033);
  attacker.summoningSick = false;
  state.players.player.front = [attacker];
  state.players.ai.front = [];
  state.players.ai.fortressStr = 10;

  assert.equal(attack(state, "player", attacker.uid, "ai-fortress"), true);
  assert.equal(state.players.ai.fortressStr, 8);
  assert.equal(state.winner, null);
  assert.equal(state.victory.lockedOutcome, null);
  assert.equal(state.victory.finished, false);
  assert.equal(state.effectResolution, null);
});

test("ordinary lethal attack waits for its post-attack selection before locking", () => {
  const state = createGame({ mode: "sandbox" });
  const attacker = createCardInstance("STD-136", "player", 97034);
  const ally = createCardInstance("STD-020", "player", 97035);
  attacker.summoningSick = false;
  state.players.player.front = [attacker, ally];
  state.players.ai.front = [];
  state.players.ai.fortressStr = 1;

  assert.equal(attack(state, "player", attacker.uid, "ai-fortress"), true);
  const effectId = state.effectResolution?.id;
  assert.equal(state.pending?.request?.continuation?.type, "hahanamori-standby");
  assert.equal(state.winner, null);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [] }), true);
  assert.equal(state.victory.lockedAtEffectId, effectId);
  assert.equal(state.victory.lockedOutcome, "player");
  assert.equal(state.victory.finished, true);
});

test("deferred ordinary attack resumes inside one logical resolution before lethal lock", () => {
  const state = createGame({ mode: "sandbox" });
  const attacker = createCardInstance("STD-020", "ai", 97036);
  const interrupt = createCardInstance("STD-105", "player", 97037);
  attacker.summoningSick = false;
  interrupt.faceDown = true;
  state.active = "ai";
  state.players.ai.front = [attacker];
  state.players.player.front = [];
  state.players.player.back = [interrupt];
  state.players.player.hand = [createCardInstance("STD-195", "player", 97043)];
  state.players.player.registry = [createCardInstance("STD-091", "player", 97044)];
  state.players.player.memory = 10;
  state.players.player.fortressStr = 1;

  assert.equal(attack(state, "ai", attacker.uid, "player-fortress"), true);
  const effectId = state.effectResolution?.id;
  assert.equal(state.prompt?.scriptUid, interrupt.uid);
  assert.equal(state.deferredAttack?.stage, "after-declare");
  assert.equal(state.winner, null);
  assert.equal(declinePrompt(state), true);
  assert.equal(state.victory.lockedAtEffectId, effectId);
  assert.equal(state.victory.lockedOutcome, "ai");
  assert.equal(state.victory.finished, true);
});

test("attack rejection and pending no-op preserve an unrelated resolution boundary", () => {
  const state = createGame({ mode: "sandbox" });
  const attacker = createCardInstance("STD-020", "player", 97038);
  attacker.summoningSick = false;
  state.players.player.front = [attacker];
  state.players.ai.fortressStr = 0;
  const outer = { id: "EFFECT-OUTER", kind: "script", playerId: "ai", status: "awaiting-choice" };
  state.effectResolution = outer;
  state.effectDepth = 0;
  state.pending = { type: "selection", request: { continuation: { type: "unrelated" } } };

  assert.equal(attack(state, "player", attacker.uid, "ai-fortress"), false);
  assert.equal(state.effectResolution, outer);
  assert.equal(state.effectResolution.status, "awaiting-choice");
  assert.equal(state.effectDepth, 0);
  assert.equal(state.winner, null);
  assert.equal(state.victory.lockedOutcome, null);

  state.pending = null;
  assert.equal(attack(state, "player", "missing-attacker", "ai-fortress"), false);
  assert.equal(state.effectResolution, outer);
  assert.equal(state.effectResolution.status, "awaiting-choice");
  assert.equal(state.effectDepth, 0);
  assert.equal(state.winner, null);
});

test("ordinary lethal attack locks before its predeclared Response resolves and finishes afterward", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  state.interactive = true;
  const attacker = createCardInstance("STD-020", "ai", 97039);
  const response = createCardInstance("STD-143", "player", 97040);
  attacker.summoningSick = false;
  response.compiled = compileEffectText(response.text, { category: response.category, id: response.id });
  state.active = "ai";
  state.players.ai.front = [attacker];
  state.players.player.front = [];
  state.players.player.back = [];
  state.players.player.hand = [response];
  state.players.player.memory = 10;
  state.players.player.fortressStr = 1;

  assert.equal(attack(state, "ai", attacker.uid, "player-fortress"), true);
  assert.equal(state.players.player.fortressStr, 0);
  assert.equal(state.winner, null);
  assert.equal(state.pending?.type, "response-window");
  assert.equal(activateResponse(state, "player", response.uid), true);
  assert.equal(state.victory.lockedOutcome, "ai");
  assert.equal(state.victory.finished, true);
  assert.equal(state.declaredEffects.length, 0);
  assert.equal(state.resolvingDeclaredEffect, null);
  const lockIndex = state.log.findIndex((entry) => entry.tone === "win");
  const responseIndex = state.log.findIndex((entry) => entry.text.includes("レスポンス:6の効果と発動元処理を完了"));
  assert.ok(lockIndex >= 0 && responseIndex > lockIndex);
});

test("ordinary attack evaluates simultaneous lethal fortress conditions as a draw", () => {
  const state = createGame({ mode: "lab" });
  const attacker = createCardInstance("STD-020", "player", 97041);
  const trinity = createCardInstance("STD-121", "ai", 97042);
  attacker.summoningSick = false;
  trinity.residentActive = true;
  state.players.player.front = [attacker];
  state.players.player.hand = [];
  state.players.player.fortressStr = 2;
  state.players.ai.front = [];
  state.players.ai.back = [trinity];
  state.players.ai.fortressStr = 1;

  assert.equal(attack(state, "player", attacker.uid, "ai-fortress"), true);
  assert.ok(state.players.player.fortressStr <= 0);
  assert.equal(state.players.ai.fortressStr, 0);
  assert.equal(state.winner, "draw");
  assert.equal(state.victory.lockedOutcome, "draw");
  assert.equal(state.victory.finished, true);
});

test("a pre-lock STD-003 declaration resolves after lethal Shock Gun cleanup and before game finish", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const opponent = state.players.ai;
  const shockGun = createCardInstance("STD-015", "player", 97011);
  const script = createCardInstance("STD-003", "ai", 97012);
  script.faceDown = true;
  player.hand = [shockGun];
  player.memory = 10;
  opponent.front = [];
  opponent.back = [script];
  opponent.memory = 10;
  opponent.fortressStr = 1;

  assert.equal(playCard(state, "player", shockGun.uid), true);
  assert.equal(opponent.fortressStr, 0);
  assert.equal(state.winner, null);
  assert.equal(state.prompt?.scriptUid, script.uid);
  assert.equal(player.trash.some((card) => card.uid === shockGun.uid), false);

  assert.equal(activateScript(state, "ai", script.uid), true);
  assert.equal(player.trash.some((card) => card.uid === shockGun.uid), true);
  assert.equal(player.ban.some((card) => card.uid === shockGun.uid), false);
  assert.equal(opponent.trash.some((card) => card.uid === script.uid), true);
  assert.equal(state.winner, "player");
  assert.equal(state.victory.lockedOutcome, "player");
  assert.equal(state.victory.finished, true);
  assert.equal(state.declaredEffects.length, 0);
  assert.equal(state.resolvingDeclaredEffect, null);
  const winLogIndex = state.log.findIndex((entry) => entry.tone === "win");
  const declaredResolutionIndex = state.log.findIndex((entry) => entry.text.includes("以降の相手カードのゴミ箱移動"));
  assert.ok(winLogIndex >= 0 && declaredResolutionIndex > winLogIndex);
});

test("a Response declared before lethal damage locks resolves after the source Sp cleanup and before game finish", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  state.interactive = true;
  const player = state.players.player;
  const opponent = state.players.ai;
  const shockGun = createCardInstance("STD-015", "ai", 97021);
  const response = createCardInstance("STD-143", "player", 97022);
  shockGun.compiled = compileEffectText(shockGun.text, { category: shockGun.category, id: shockGun.id });
  response.compiled = compileEffectText(response.text, { category: response.category, id: response.id });
  opponent.hand = [shockGun];
  opponent.memory = 10;
  opponent.front = [];
  opponent.back = [];
  player.hand = [response];
  player.memory = 10;
  player.front = [];
  player.back = [];
  player.fortressStr = 1;

  assert.equal(playCard(state, "ai", shockGun.uid, { allowOffTurn: true }), true);
  assert.equal(player.fortressStr, 0);
  assert.equal(state.winner, null);
  assert.equal(state.pending?.type, "response-window");
  assert.equal(activateResponse(state, "player", response.uid), true);

  assert.equal(opponent.trash.some((card) => card.uid === shockGun.uid), true);
  assert.equal(player.trash.some((card) => card.uid === response.uid), true);
  assert.equal(state.victory.lockedOutcome, "ai");
  assert.equal(state.victory.finished, true);
  const lockIndex = state.log.findIndex((entry) => entry.tone === "win");
  const responseIndex = state.log.findIndex((entry) => entry.text.includes("レスポンス:6の効果と発動元処理を完了"));
  assert.ok(lockIndex >= 0 && responseIndex > lockIndex);
});

test("Plugin destroys itself and a matching-cost executed card", () => {
  const state = createGame({ mode: "lab" });
  const plugin = state.players.player.hand.find((card) => card.id === "STD-224");
  assert.equal(installCard(state, "player", plugin.uid), true);
  assert.equal(configurePlugin(state, "player", plugin.uid, 1), true);

  const sourceIndex = state.players.player.hand.findIndex((card) => card.category !== "Plugin" && card.cost === 1);
  const [executed] = state.players.player.hand.splice(sourceIndex, 1);
  executed.owner = "ai";
  state.players.ai.hand.push(executed);
  assert.equal(playCard(state, "ai", executed.uid, { force: true, free: true, ignoreColor: true, zone: "front" }), true);
  assert.equal(state.players.player.registry.includes(plugin), false);
  assert.equal(state.players.player.trash.includes(plugin), true);
  assert.equal(state.players.ai.trash.includes(executed), true);
});

test("STD-039 applies additive dealt and received damage modifiers with zero floor", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const meikou = { ...createCardInstance("STD-039", "player", 9301), damage: 0, mounted: [], sleep: false };
  const source = { uid: "plain-source", owner: "player", name: "効果持ちOb", category: "Ob", text: "1ダメージ。", atk: 1, str: 2, damage: 0, mounted: [], sleep: false };
  state.players.player.front.push(meikou, source);
  state.players.ai.fortressStr = 10;
  dealFortressDamage(state, "ai", 2, "player", source.name);
  assert.equal(state.players.ai.fortressStr, 7);

  const enemySource = { uid: "enemy-source", owner: "ai", name: "相手効果", category: "Ob", text: "2ダメージ。", atk: 2, str: 2, damage: 0, mounted: [], sleep: false };
  state.players.ai.front.push(enemySource);
  dealFortressDamage(state, "player", 1, "ai", enemySource.name);
  assert.equal(state.players.player.fortressStr, state.players.player.user.maxStr);
});

test("shared damage modifiers stack, expire with their providers, and retain source filters", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const ai = state.players.ai;
  player.front = [];
  player.back = [];
  ai.front = [];
  ai.back = [];
  ai.fortressStr = 20;
  const glenOne = createCardInstance("STD-087", "player", 98701);
  const glenTwo = createCardInstance("STD-087", "player", 98702);
  const redSource = { uid: "red-source", owner: "player", name: "赤の発生源", category: "Sp", color: "赤", text: "", mounted: [] };
  const blueSource = { uid: "blue-source", owner: "player", name: "青の発生源", category: "Sp", color: "青", text: "", mounted: [] };
  player.back.push(glenOne, glenTwo);
  player.hand.push(redSource, blueSource);

  dealFortressDamage(state, "ai", 1, "player", redSource.name);
  assert.equal(ai.fortressStr, 17);
  dealFortressDamage(state, "ai", 1, "player", blueSource.name);
  assert.equal(ai.fortressStr, 16);

  player.back.splice(player.back.indexOf(glenTwo), 1);
  player.trash.push(glenTwo);
  dealFortressDamage(state, "ai", 1, "player", redSource.name);
  assert.equal(ai.fortressStr, 14);
});

test("STD-039 modifies controller damage even without a card source", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  player.front = [createCardInstance("STD-039", "player", 98703)];
  player.back = [];
  state.players.ai.front = [];
  state.players.ai.back = [];
  state.players.ai.fortressStr = 10;
  dealFortressDamage(state, "ai", 1, "player", "カードを発生源としない処理");
  assert.equal(state.players.ai.fortressStr, 8);
});

test("STD-041 boosts only textless Ob and decodes zero to two Ob within memory budget", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  const player = state.players.player;
  const gagou = player.hand.find((card) => card.id === "STD-041");
  assert.equal(playCard(state, "player", gagou.uid, { zone: "front", force: true, free: true }), true);
  const vanilla = { uid: "vanilla-ob", owner: "player", name: "無能力Ob", category: "Ob", text: "", cost: 1, atk: 1, str: 2, damage: 0, mounted: [], sleep: false };
  player.front.push(vanilla);
  const before = state.players.ai.fortressStr;
  dealFortressDamage(state, "ai", 1, "player", vanilla.name);
  assert.equal(state.players.ai.fortressStr, before - 2);

  const one = { uid: "decode-one", owner: "player", name: "復帰1", category: "Ob", text: "", cost: 1, atk: 1, str: 1, damage: 0, mounted: [] };
  const two = { uid: "decode-two", owner: "player", name: "復帰2", category: "Ob", text: "", cost: 1, atk: 1, str: 1, damage: 0, mounted: [] };
  const three = { uid: "decode-three", owner: "player", name: "重いOb", category: "Ob", text: "", cost: 3, atk: 1, str: 1, damage: 0, mounted: [] };
  player.trash.push(one, two, three);
  assert.equal(destroyCard(state, "player", gagou.uid, { source: "テスト", suppressReplacement: true }), true);
  assert.deepEqual(state.pending.validTargets.sort(), ["decode-one", "decode-two"].sort());
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: ["decode-one", "decode-two"] }), true);
  assert.equal(state.pending.type, "decode-place");
  assert.equal(player.hand.some((card) => ["decode-one", "decode-two"].includes(card.uid)), false);
  assert.equal(resolveAccessDragPlacement(state, "player", "front"), true);
  assert.equal(resolveAccessDragPlacement(state, "player", "back"), true);
  assert.ok(player.front.some((card) => card.uid === "decode-one"));
  assert.ok(player.back.some((card) => card.uid === "decode-two"));
});

test("STD-046 mills as much as possible and counts only Ob arriving in trash", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  const player = state.players.player;
  const ash = player.hand.find((card) => card.id === "STD-046");
  player.deck = [
    { uid: "bottom-spell", owner: "player", name: "山札下", category: "Sp", cost: 1, text: "" },
    { uid: "mill-ban-ob", owner: "player", name: "BAN置換Ob", category: "Ob", cost: 1, text: "", trashReplacement: "ban" },
    { uid: "mill-code", owner: "player", name: "Code", category: "Code", cost: 1, text: "" },
    { uid: "mill-ob", owner: "player", name: "到達Ob", category: "Ob", cost: 1, text: "" }
  ];
  assert.equal(playCard(state, "player", ash.uid, { zone: "front", force: true, free: true }), true);
  assert.deepEqual(player.deck.map((card) => card.uid), ["bottom-spell"]);
  assert.deepEqual(player.trash.map((card) => card.uid).filter((uid) => uid.startsWith("mill-")), ["mill-ob", "mill-code"]);
  assert.ok(player.ban.some((card) => card.uid === "mill-ban-ob"));
  assert.equal(ash.permanentAtk, 1);
  assert.equal(ash.permanentStr, 1);
  assert.equal(cardAtk(state, "player", ash), 2);
  assert.equal(cardMaxStr(state, "player", ash), 3);
});

test("sandbox separates the card catalog from both ten-card test decks and hands", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  assert.equal(state.players.player.deck.length, 10);
  assert.equal(state.players.ai.deck.length, 10);
  assert.equal(state.players.player.hand.length, 0);
  assert.equal(state.players.ai.hand.length, 0);
  assert.equal(addSandboxCardToHand(state, "player", "STD-039"), true);
  assert.equal(addSandboxCardToHand(state, "ai", "STD-041"), true);
  assert.equal(state.players.player.hand.at(-1).id, "STD-039");
  assert.equal(state.players.ai.hand.at(-1).id, "STD-041");
  assert.notEqual(state.players.player.hand.at(-1).uid, state.players.ai.hand.at(-1).uid);
  assert.deepEqual(state.sandboxUi, { query: "", expansion: "all", catalogOwner: "player", opponentControl: "manual", actor: "player" });
});

test("sandbox card supply eligibility is pure and rejects hidden prototype definitions", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const before = {
    tokenSerial: state.tokenSerial,
    playerHand: [...state.players.player.hand], aiHand: [...state.players.ai.hand],
    log: [...state.log]
  };
  assert.equal(canAddSandboxCardToHand(state, "player", "STD-020"), true);
  assert.equal(canAddSandboxCardToHand(state, "ai", "STD-020"), true);
  assert.equal(canAddSandboxCardToHand(state, "missing", "STD-020"), false);
  assert.equal(canAddSandboxCardToHand(state, "player", "missing"), false);
  assert.equal(canAddSandboxCardToHand(state, "player", "toString"), false);
  assert.equal(canAddSandboxCardToHand(state, "player", "constructor"), false);
  assert.equal(state.tokenSerial, before.tokenSerial);
  assert.deepEqual(state.players.player.hand, before.playerHand);
  assert.deepEqual(state.players.ai.hand, before.aiHand);
  assert.deepEqual(state.log, before.log);

  const battle = createGame({ mode: "ai", rng: () => 0.5 });
  assert.equal(canAddSandboxCardToHand(battle, "player", "STD-020"), false);
  assert.equal(addSandboxCardToHand(battle, "player", "STD-020"), false);
});

test("STD-001 and STD-002 use common placement and attack-damage windows", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const placementScript = createCardInstance("STD-001", "player", 900001);
  placementScript.faceDown = true;
  placementScript.cost = 0;
  const damageScript = createCardInstance("STD-002", "player", 900002);
  damageScript.faceDown = true;
  damageScript.cost = 0;
  state.players.player.back.push(placementScript, damageScript);
  const enemyCode = createCardInstance("STD-079", "ai", 900003);
  const enemyLyd = createCardInstance("SZTB-092", "ai", 900005);
  state.players.ai.front.push(enemyLyd);
  state.players.ai.hand.push(enemyCode);
  assert.equal(playCard(state, "ai", enemyCode.uid, { zone: "back", force: true, ignoreColor: true }), true);
  assert.equal(state.prompt?.scriptUid, placementScript.uid);
  assert.equal(activateScript(state, "player", placementScript.uid), true);
  assert.equal(state.pending.request.candidates.includes(enemyLyd.uid), false);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [enemyCode.uid] }), true);
  assert.equal(state.players.ai.trash.some((card) => card.uid === enemyCode.uid), true);

  dealFortressDamage(state, "player", 1, "ai", "attack test", { kind: "attack" });
  assert.equal(state.prompt?.scriptUid, damageScript.uid);
  const secondCode = createCardInstance("STD-080", "ai", 900004);
  state.players.ai.back.push(secondCode);
  assert.equal(activateScript(state, "player", damageScript.uid), true);
  assert.equal(state.players.ai.trash.some((card) => card.uid === secondCode.uid), true);
  assert.equal(state.players.ai.front.some((card) => card.uid === enemyLyd.uid), true);
});

test("STD-139 and STD-147 resident windows resolve through shared actions", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const turnScript = createCardInstance("STD-139", "player", 900010);
  turnScript.faceDown = false; turnScript.residentActive = true; turnScript.cost = 0; turnScript.color = null;
  const damageScript = createCardInstance("STD-147", "player", 900011);
  damageScript.faceDown = false; damageScript.residentActive = true; damageScript.cost = 0; damageScript.color = null;
  const ob = createCardInstance("STD-022", "player", 900012);
  state.players.player.back.push(turnScript, damageScript);
  state.players.player.front.push(ob);
  startTurn(state, "ai");
  assert.equal(state.prompt?.scriptUid, turnScript.uid);
  assert.equal(activateScript(state, "player", turnScript.uid), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [ob.uid] }), true);
  assert.equal(cardAtk(state, "player", ob), Number(ob.atk) - 2);
  assert.equal(cardHasKeyword(ob, "SECURITY"), true);
  state.players.player.memory = 0;
  dealFortressDamage(state, "player", 1, "ai", "effect test");
  assert.equal(state.prompt?.scriptUid, damageScript.uid);
  assert.equal(activateScript(state, "player", damageScript.uid), true);
  assert.equal(state.players.player.memory, 1);
});

test("STD-177 and STD-178 suspend combat and apply next-turn timed modifiers", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const allScript = createCardInstance("STD-178", "player", 900020);
  allScript.faceDown = true; allScript.cost = 0; allScript.color = null;
  const battleScript = createCardInstance("STD-177", "player", 900021);
  battleScript.faceDown = true; battleScript.cost = 0; battleScript.color = null;
  const attacker = createCardInstance("STD-022", "player", 900022);
  attacker.summoningSick = false;
  const defender = createCardInstance("STD-022", "ai", 900023);
  defender.sleep = true;
  state.players.player.back.push(allScript, battleScript);
  state.players.player.front.push(attacker);
  state.players.ai.front.push(defender);
  assert.equal(attack(state, "player", attacker.uid, defender.uid), true);
  assert.equal(state.prompt?.scriptUid, allScript.uid);
  assert.equal(attacker.sleep, false);
  assert.equal(activateScript(state, "player", allScript.uid), true);
  assert.equal(state.prompt?.scriptUid, battleScript.uid);
  assert.equal(activateScript(state, "player", battleScript.uid), true);
  assert.equal(attacker.sleep, true);
  assert.equal(cardAtk(state, "player", attacker), Number(attacker.atk) + 4);
  assert.equal(cardHasKeyword(attacker, "SECURITY"), true);
});

test("STD-180 resolves insect Access before its insect Login damage trigger", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  const cocoon = createCardInstance("STD-180", "player", 900030);
  const insect = createCardInstance("STD-173", "player", 900031);
  const enemy = createCardInstance("STD-022", "ai", 900032);
  state.players.player.hand.push(cocoon);
  state.players.player.deck = [insect];
  state.players.ai.front.push(enemy);
  assert.equal(playCard(state, "player", cocoon.uid, { force: true }), true);
  assert.equal(state.pending?.request?.continuation?.type, "access-to-hand");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [insect.uid] }), true);
  assert.equal(state.players.player.hand.some((card) => card.uid === insect.uid), true);
  assert.equal(state.pending?.request?.continuation?.type, "deal-selected-damage");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [enemy.uid] }), true);
  assert.equal(enemy.damage, 2);
});

test("STD-134 forces every attackable enemy Ob next turn and punishes Security attacks", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  const arcturus = createCardInstance("STD-134", "player", 900040);
  const security = createCardInstance("STD-126", "player", 900041);
  security.sleep = true;
  const enemy = createCardInstance("STD-020", "ai", 900042);
  enemy.summoningSick = false;
  state.players.player.hand.push(arcturus);
  state.players.player.front.push(security);
  state.players.ai.front.push(enemy);
  assert.equal(playCard(state, "player", arcturus.uid, { force: true }), true);
  assert.equal(state.players.ai.forceAttack, true);
  state.active = "ai";
  assert.equal(endTurn(state), false);
  const before = state.players.ai.fortressStr;
  assert.equal(attack(state, "ai", enemy.uid, security.uid), true);
  assert.equal(state.players.ai.fortressStr, before - 2);
  enemy.sleep = false;
  assert.equal(canAttack(state, "ai", enemy), true);
  if (!endTurn(state)) assert.equal(endTurn(state), true);
});

test("STD-158 shares black Ob Access across Login and turn start and returns from trash", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  const source = createCardInstance("STD-158", "player", 900050);
  const first = createCardInstance("STD-159", "player", 900051);
  const second = createCardInstance("STD-160", "player", 900052);
  const filler = createCardInstance("STD-022", "player", 900053);
  state.players.player.hand.push(source);
  state.players.player.deck = [first, second];
  assert.equal(playCard(state, "player", source.uid, { force: true, zone: "back" }), true);
  assert.equal(state.pending?.request?.continuation?.type, "access-to-hand");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [first.uid] }), true);
  assert.equal(state.players.player.hand.some((card) => card.uid === first.uid), true);
  state.players.player.deck.push(filler);
  startTurn(state, "player");
  assert.equal(state.pending?.request?.continuation?.type, "access-to-hand");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [second.uid] }), true);
  state.players.player.memory = 99;
  assert.equal(relogCard(state, "player", source.uid, "front"), true);
  const moved = findCard(state, source.uid).card;
  assert.deepEqual(state.delayedEffects.find((effect) => effect.cardUid === moved.uid), {
    event: "turn_started", dueOwnerTurnsTaken: state.players.player.turnsTaken + 1,
    type: "move_source_from_trash", ownerId: "player", cardUid: moved.uid,
    sourceName: moved.name, destination: "hand", resetDamage: false, standby: false, sleep: false
  });
  state.players.player.front = state.players.player.front.filter((card) => card.uid !== source.uid);
  state.players.player.trash.push(moved);
  startTurn(state, "player");
  assert.equal(state.players.player.hand.some((card) => card.uid === source.uid), true);
});

test("STD-128 chains its OC filtered Access through the shared runtime", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  const source = createCardInstance("STD-128", "player", 900055);
  const knight = createCardInstance("STD-129", "player", 900056);
  const expensiveYellow = createCardInstance("STD-134", "player", 900057);
  state.players.player.hand.push(source);
  state.players.player.deck = [expensiveYellow, knight];
  state.players.player.memory = 20;

  assert.equal(playCard(state, "player", source.uid, { zone: "back" }), true);
  setSelectionScope(state.pending.request, "+2払う");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.equal(state.pending?.request?.continuation?.type, "access-to-hand");
  assert.deepEqual(new Set(state.pending.request.candidates), new Set([knight.uid, expensiveYellow.uid]));
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [knight.uid] }), true);
  assert.equal(state.players.player.hand.some((card) => card.uid === knight.uid), true);
  assert.equal(state.pending?.request?.continuation?.type, "access-to-hand");
  assert.deepEqual(state.pending.request.candidates, [expensiveYellow.uid]);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [expensiveYellow.uid] }), true);
  assert.equal(state.players.player.hand.some((card) => card.uid === expensiveYellow.uid), true);
  assert.equal(state.pending, null);
});

test("STD-125 through 130 and STD-133 through 135 share the canonical NOM Noid classes", () => {
  const ids = ["STD-125", "STD-126", "STD-127", "STD-128", "STD-129", "STD-130", "STD-133", "STD-134", "STD-135"];
  for (const id of ids) {
    assert.deepEqual(CARD_LIBRARY[id].classes, ["ナイツ・オブ・マキナ", "ノイド"], `${id} class mismatch`);
  }
});

test("STD-160 uses common madness counters and Proxy access-to-deck-top", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  addSandboxCardToHand(state, "player", "STD-160");
  const source = state.players.player.hand.find((card) => card.id === "STD-160");
  const oldRuler = createCardInstance("STD-173", "player", 900061);
  oldRuler.id = "STD-165"; oldRuler.name = "旧支配者の呼び声"; oldRuler.category = "Script";
  const enemy = createCardInstance("STD-020", "ai", 900062);
  state.players.player.deck = [oldRuler];
  state.players.ai.front.push(enemy);
  const proxy = getActivatableEffects(state, "player", source).find((item) => item.kind === "proxy");
  assert.equal(activateCardEffect(state, "player", source.uid, proxy.id), true);
  assert.equal(state.players.player.trash.some((card) => card.uid === source.uid), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [oldRuler.uid] }), true);
  assert.equal(state.players.player.deck.at(-1).uid, oldRuler.uid);

  addSandboxCardToHand(state, "player", "STD-160");
  const login = state.players.player.hand.find((card) => card.id === "STD-160");
  assert.equal(playCard(state, "player", login.uid, { force: true }), true);
  assert.equal(enemy.counters.madness, 3);
  assert.equal(state.players.ai.counters.madness, 3);
  startTurn(state, "player");
  assert.equal(state.players.ai.counters.madness, 4);
});

test("STD-167 Response destroys only Ob below this turn's received user damage", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  state.interactive = true;
  addSandboxCardToHand(state, "player", "STD-167");
  const response = state.players.player.hand.find((card) => card.id === "STD-167");
  state.players.player.hand = [response];
  const low = createCardInstance("STD-020", "ai", 900071);
  low.str = 2;
  const equal = createCardInstance("STD-021", "ai", 900072);
  equal.str = 3;
  state.players.ai.front.push(low, equal);
  state.players.ai.back = [];
  dealFortressDamage(state, "player", 3, "ai", "test damage");
  assert.equal(state.pending.type, "response-window");
  assert.equal(activateResponse(state, "player", response.uid), true);
  assert.equal(state.pending.validTargets.includes(low.uid), true);
  assert.equal(state.pending.validTargets.includes(equal.uid), false);
  assert.equal(activateResponse(state, "player", response.uid, low.uid), true);
  if (state.prompt?.type === "script-activation") assert.equal(declinePrompt(state), true);
  assert.equal(state.players.ai.trash.some((card) => card.uid === low.uid), true);
});

test("STD-169 Proxy and battle trigger add shared Load counters", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  addSandboxCardToHand(state, "player", "STD-169");
  const proxySource = state.players.player.hand.find((card) => card.id === "STD-169");
  const target = createCardInstance("STD-020", "ai", 900081);
  target.sleep = true;
  target.str = 10;
  state.players.ai.front.push(target);
  const proxy = getActivatableEffects(state, "player", proxySource).find((item) => item.kind === "proxy");
  assert.equal(activateCardEffect(state, "player", proxySource.uid, proxy.id, { targetUid: target.uid }), true);
  assert.equal(target.load, 3);

  const fighter = createCardInstance("STD-169", "player", 900082);
  fighter.summoningSick = false;
  state.players.player.front.push(fighter);
  assert.equal(attack(state, "player", fighter.uid, target.uid), true);
  assert.equal(target.load, 5);
});
test("Load that drops STR to 0 or less destroys the Ob by rule", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  addSandboxCardToHand(state, "player", "STD-169");
  const proxySource = state.players.player.hand.find((card) => card.id === "STD-169");
  const target = createCardInstance("STD-020", "ai", 900083);
  state.players.ai.front.push(target);
  const proxy = getActivatableEffects(state, "player", proxySource).find((item) => item.kind === "proxy");
  assert.equal(activateCardEffect(state, "player", proxySource.uid, proxy.id, { targetUid: target.uid }), true);
  assert.equal(state.players.ai.front.some((card) => card.uid === target.uid), false);
  assert.equal(state.players.ai.trash.some((card) => card.uid === target.uid), true);
  assert.equal(cardAtk(state, "ai", target) >= 0 && cardCurrentStr(state, "ai", target) >= 0, true);
});
test("STR 0 destruction is a standing state check that pierces Backup", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const thief = createCardInstance("STD-076", "player", 900084);
  const filler = createCardInstance("STD-020", "player", 900085);
  thief.load = 2;
  player.front = [thief];
  player.back = [];
  player.hand = [filler];
  player.memory = 10;
  assert.equal(cardCurrentStr(state, "player", thief), 0);
  assert.equal(playCard(state, "player", filler.uid, {}), true);
  const logText = state.log.map((entry) => entry.text ?? entry).join("\n");
  assert.doesNotMatch(logText, /こそ泥は\[バックアップ\]でスリープしてバックへ移動/);
  assert.match(logText, /STR0以下の状態判定: こそ泥を破壊/);
  assert.equal([...player.front, ...player.back].some((card) => card.uid === thief.uid), false);
  assert.equal(player.trash.some((card) => card.uid === thief.uid), true);
});
test("a card that comes back from outside the area has no Load, damage or modifiers left", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  const player = state.players.player;
  const mandrake = createCardInstance("STD-154", "player", 900090);
  const filler = createCardInstance("STD-020", "player", 900091);
  mandrake.load = 1; mandrake.tempAtk = 3; mandrake.permanentStr = 2; mandrake.damage = 1; mandrake.counters = { madness: 2 };
  mandrake.permanentStr = 0;
  player.front = [mandrake]; player.back = [];
  player.hand = [filler]; player.memory = 10;
  player.deck = Array.from({ length: 5 }, (_, index) => createCardInstance("STD-020", "player", 900100 + index));
  assert.equal(playCard(state, "player", filler.uid, {}), true);
  assert.equal(player.trash.some((card) => card.uid === mandrake.uid), true, "STR 0 from Load destroys it");
  assert.equal(endTurn(state), true);
  const back = [...player.front, ...player.back].find((card) => card.uid === mandrake.uid);
  assert.ok(back, "STD-154 returns at the next turn start");
  assert.deepEqual([back.load, back.damage, back.tempAtk, back.permanentStr, back.counters], [0, 0, 0, 0, {}]);
  assert.equal(cardCurrentStr(state, "player", back), 1);
});

test("declining a trash-window confirmation ends it instead of re-opening one per answer through the STR 0 check", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  const { player, ai } = state.players;
  const script = createCardInstance("STD-003", "player", 900094); script.faceDown = true;
  const attacker = createCardInstance("STD-022", "player", 900095); attacker.summoningSick = false;
  const guard = createCardInstance("STD-022", "ai", 900096); guard.sleep = true; guard.damage = guard.str - 1;
  player.front = [attacker]; player.back = [script]; player.hand = []; player.memory = 10;
  ai.front = [guard]; ai.back = []; ai.hand = [];
  assert.equal(attack(state, "player", attacker.uid, guard.uid), true);
  assert.equal(state.prompt?.scriptUid, script.uid);
  assert.equal(declinePrompt(state), true);
  assert.equal(state.prompt, null, "one answer closes the one confirmation");
  assert.equal(ai.trash.some((card) => card.uid === guard.uid), true);
  assert.equal(state.activationWindows.filter((window) => window.status === "pending").length, 0);
});

test("STR 0 destruction pierces Protect; only an indestructible Ob survives the state check", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const heavy = createCardInstance("STD-026", "player", 900086);
  const filler = createCardInstance("STD-020", "player", 900087);
  heavy.load = 4;
  player.front = [heavy];
  player.back = [];
  player.hand = [filler];
  player.memory = 10;
  assert.equal(playCard(state, "player", filler.uid, {}), true);
  assert.equal(heavy.protect ?? 1, 1, "Protect is not spent by the state check");
  assert.equal(player.front.some((card) => card.uid === heavy.uid), false);
  assert.equal(player.trash.some((card) => card.uid === heavy.uid), true);
  assert.equal(state.pending, null);
  assert.equal(state.effectDepth, 0);

  const unkillable = createCardInstance("STD-159", "player", 900092);
  unkillable.faceDown = false; unkillable.load = 99;
  const second = createCardInstance("STD-020", "player", 900093);
  player.front = [unkillable]; player.hand = [second];
  assert.equal(playCard(state, "player", second.uid, {}), true);
  assert.equal(player.front.some((card) => card.uid === unkillable.uid), true, "forbid-destruction still holds");
  assert.equal(state.effectDepth, 0);
});
test("result lock refuses new install, re-execution, ability, effect and layered actions at the engine boundary", () => {
  const state = createGame({ mode: "ai", rng: () => 0.5 });
  const player = state.players.player;
  const attacker = createCardInstance("STD-020", "player", 900088);
  const installable = createCardInstance("STD-091", "player", 900089);
  attacker.summoningSick = false;
  player.hand = [installable];
  player.front = [attacker];
  player.memory = 10;
  player.registryActionUsed = false;
  state.players.ai.front = [];
  state.players.ai.fortressStr = 1;
  assert.equal(attack(state, "player", attacker.uid, "ai-fortress"), true);
  assert.equal(state.victory.lockedOutcome, "player");
  const memoryBefore = player.memory;

  assert.equal(installCard(state, "player", installable.uid), false);
  assert.equal(relogCard(state, "player", attacker.uid, "back"), false);
  assert.equal(activateTurbo(state, "player"), false);
  assert.equal(activateCardEffect(state, "player", attacker.uid, "missing"), false);
  assert.equal(playLayeredCard(state, "player", installable.uid, []), false);
  assert.equal(player.registry.length, 0);
  assert.equal(player.hand.some((card) => card.uid === installable.uid), true);
  assert.equal(player.front.some((card) => card.uid === attacker.uid), true);
  assert.equal(player.memory, memoryBefore);
  assert.equal(player.turboUsed, false);
  // Forced installs made by effects and tutorial setup are not player actions.
  assert.equal(installCard(state, "player", installable.uid, { force: true }), true);
});
test("Q3 STD-121/140/141/143 compile through explicit shared runtime operations", () => {
  for (const id of ["STD-121", "STD-140", "STD-141", "STD-143"]) {
    const card = STD_SUPPORTED_CARDS[id];
    const compiled = compileEffectText(card.text, { category: card.category, id });
    assert.equal(compiled.status, "supported", id);
    assert.equal(compiled.warnings.length, 0, id);
  }
});

test("STD-121 pays its setting cost by destroying three differently named face-up terminals across both areas", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const source = createCardInstance("STD-121", "player", 121001);
  const terminals = [
    [createCardInstance("STD-118", "player", 121101), "情報管理端末A", player.front],
    [createCardInstance("STD-119", "ai", 121102), "情報管理端末B", state.players.ai.front],
    [createCardInstance("STD-120", "ai", 121103), "情報管理端末C", state.players.ai.back]
  ];
  for (const [card, name, zone] of terminals) { card.name = name; card.faceDown = false; zone.push(card); }
  player.hand = [source];
  assert.equal(playCard(state, "player", source.uid), true);
  assert.equal(state.pending.request.continuation.type, "placement-cost-destroy");
  assert.equal(player.hand.some((card) => card.uid === source.uid), true);
  const selected = terminals.map(([card]) => card.uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected }), true);
  assert.equal(player.back.some((card) => card.uid === source.uid && card.faceDown), true);
  assert.equal([...player.trash, ...state.players.ai.trash].filter((card) => selected.includes(card.uid)).length, 3);
  assert.equal([...player.ban, ...state.players.ai.ban].filter((card) => selected.includes(card.uid)).length, 0);

  player.memory = 20;
  assert.equal(activateScript(state, "player", source.uid), true);
  assert.equal(state.pending?.request?.continuation?.type === "activate-std121", false);
  assert.equal([...player.trash, ...state.players.ai.trash].filter((card) => selected.includes(card.uid)).length, 3);
  assert.equal([...player.ban, ...state.players.ai.ban].filter((card) => selected.includes(card.uid)).length, 0);
});

test("STD-121 rejects hidden, duplicate-name, and moved-source setting-cost selections before consuming cards", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const source = createCardInstance("STD-121", "player", 121201);
  const makeTerminal = (serial, name, faceDown = false) => {
    const card = createCardInstance("STD-118", "player", serial);
    card.name = name; card.faceDown = faceDown;
    return card;
  };
  const first = makeTerminal(121202, "情報管理端末A");
  const duplicate = makeTerminal(121203, "情報管理端末A");
  const second = makeTerminal(121204, "情報管理端末B");
  const third = makeTerminal(121205, "情報管理端末C");
  const hidden = makeTerminal(121206, "情報管理端末D", true);
  player.hand = [source]; player.front = [first, duplicate, second, third, hidden];
  assert.equal(playCard(state, "player", source.uid), true);
  const continuation = state.pending.request.continuation;
  assert.equal(playCard(state, "player", source.uid), false);
  assert.equal(state.pending.request.continuation, continuation);
  assert.equal(state.pending.validTargets.includes(hidden.uid), false);
  assert.equal(resolveCardSelection(state, continuation, { selected: [first.uid, duplicate.uid, second.uid] }), false);
  assert.equal(player.front.length, 5);
  player.hand = [];
  assert.equal(resolveCardSelection(state, continuation, { selected: [first.uid, second.uid, third.uid] }), false);
  assert.equal(player.front.length, 5);
  assert.equal(player.trash.length, 0);
});

test("STD-121 stops an all-required setting cost after protection without rolling back prior destruction", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const source = createCardInstance("STD-121", "player", 121301);
  const terminals = ["A", "B", "C"].map((suffix, index) => {
    const card = createCardInstance("STD-118", "player", 121302 + index);
    card.name = `情報管理端末${suffix}`; card.faceDown = false;
    return card;
  });
  terminals[1].protect = 1;
  player.hand = [source]; player.front = [...terminals];
  assert.equal(playCard(state, "player", source.uid), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: terminals.map((card) => card.uid) }), true);
  assert.equal(player.trash.some((card) => card.uid === terminals[0].uid), true);
  assert.equal(player.front.some((card) => card.uid === terminals[1].uid), true);
  assert.equal(player.front.some((card) => card.uid === terminals[2].uid), true);
  assert.equal(player.hand.some((card) => card.uid === source.uid), true);
  assert.equal(player.back.some((card) => card.uid === source.uid), false);
});

test("STD-121 awaits each trash-response window with its source in hand before setting", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const source = createCardInstance("STD-121", "player", 121351);
  const terminals = ["A", "B", "C"].map((suffix, index) => {
    const card = createCardInstance("STD-118", "player", 121352 + index);
    card.name = `情報管理端末${suffix}`; card.faceDown = false;
    return card;
  });
  const interrupt = createCardInstance("STD-003", "ai", 121355);
  interrupt.faceDown = true; interrupt.cost = 0;
  state.players.ai.back = [interrupt]; state.players.ai.memory = 10;
  player.hand = [source]; player.front = [...terminals];
  assert.equal(playCard(state, "player", source.uid), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: terminals.map((card) => card.uid) }), true);
  assert.equal(state.prompt?.type, "script-activation");
  assert.equal(player.hand.some((card) => card.uid === source.uid), true);
  assert.equal(player.front.length, 3);
  for (let index = 0; index < 3; index += 1) {
    assert.equal(state.prompt?.type, "script-activation");
    assert.equal(declinePrompt(state), true);
  }
  assert.equal(state.prompt, null);
  assert.equal(player.back.some((card) => card.uid === source.uid && card.faceDown), true);
  assert.equal(player.trash.filter((card) => terminals.some((terminal) => terminal.uid === card.uid)).length, 3);
});

test("STD-121 counts an ordinary backup destruction replacement as a paid setting-cost card", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const source = createCardInstance("STD-121", "player", 121371);
  const terminals = ["A", "B", "C"].map((suffix, index) => {
    const card = createCardInstance("STD-118", "player", 121372 + index);
    card.name = `情報管理端末${suffix}`; card.faceDown = false;
    return card;
  });
  terminals[0].backup = 1;
  player.hand = [source]; player.front = [...terminals];
  assert.equal(playCard(state, "player", source.uid), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: terminals.map((card) => card.uid) }), true);
  assert.equal(player.back.some((card) => card.uid === terminals[0].uid && card.sleep), true);
  assert.equal(player.back.some((card) => card.uid === source.uid && card.faceDown), true);
  assert.equal(player.trash.filter((card) => [terminals[1].uid, terminals[2].uid].includes(card.uid)).length, 2);
});

test("STD-121 may free a full back with its cost, but cannot select a batch that leaves it full", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const source = createCardInstance("STD-121", "player", 121401);
  const ownBack = createCardInstance("STD-118", "player", 121402);
  ownBack.name = "情報管理端末A"; ownBack.faceDown = false;
  player.back = [ownBack, ...Array.from({ length: player.user.backLimit - 1 }, (_, index) => createCardInstance("STD-022", "player", 121403 + index))];
  assert.equal(player.back.length, player.user.backLimit);
  const enemyTerminals = ["B", "C", "D"].map((suffix, index) => {
    const card = createCardInstance("STD-118", "ai", 121405 + index);
    card.name = `情報管理端末${suffix}`; card.faceDown = false;
    return card;
  });
  state.players.ai.front = [...enemyTerminals]; player.hand = [source];
  player.memory = 0;
  assert.equal(canPlayCard(state, "player", source, { zone: "back" }).ok, true);
  assert.equal(playCard(state, "player", source.uid), true);
  const continuation = state.pending.request.continuation;
  assert.equal(resolveCardSelection(state, continuation, { selected: enemyTerminals.map((card) => card.uid) }), false);
  assert.equal(state.players.ai.front.length, 3);
  assert.equal(resolveCardSelection(state, continuation, { selected: [ownBack.uid, enemyTerminals[0].uid, enemyTerminals[1].uid] }), true);
  assert.equal(player.back.length, player.user.backLimit);
  assert.equal(player.back.some((card) => card.uid === source.uid), true);
});

test("STD-121 keeps paid destruction replacements but leaves its source in hand when the final back is still full", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const source = createCardInstance("STD-121", "player", 121451);
  const replacement = createCardInstance("STD-099", "player", 121452);
  const target = createCardInstance("STD-094", "player", 121453);
  target.name = "情報管理端末A 変形合体レッパオー"; target.faceDown = false;
  const material = createCardInstance("STD-075", "player", 121454);
  material.classes = ["レッドパンクス"];
  player.back = [target, ...Array.from({ length: player.user.backLimit - 1 }, (_, index) => createCardInstance("STD-022", "player", 121455 + index))];
  assert.equal(player.back.length, player.user.backLimit);
  player.front = [material]; player.hand = [source, replacement];
  const enemies = ["B", "C"].map((suffix, index) => {
    const card = createCardInstance("STD-118", "ai", 121457 + index);
    card.name = `情報管理端末${suffix}`; card.faceDown = false;
    return card;
  });
  state.players.ai.front = [...enemies];
  assert.equal(playCard(state, "player", source.uid), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [target.uid, ...enemies.map((card) => card.uid)] }), true);
  assert.equal(state.pending.request.continuation.type, "destruction-replacement-choice");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { scope: "STD-099で置換ログイン" }), true);
  assert.equal(state.pending.request.continuation.type, "std099-replacement-materials");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [material.uid] }), true);
  assert.equal(player.hand.some((card) => card.uid === source.uid), true);
  assert.equal(player.back.some((card) => card.uid === source.uid), false);
  assert.equal(player.back.some((card) => card.uid === replacement.uid), true);
  assert.equal(replacement.boardSlot, target.boardSlot);
  assert.equal(state.players.ai.trash.filter((card) => enemies.some((enemy) => enemy.uid === card.uid)).length, 2);
});

test("STD-143 sleeps every enemy Ob and draws two only on the opponent turn", () => {
  const state = createGame({ mode: "sandbox" });
  state.active = "ai";
  const player = state.players.player; const ai = state.players.ai;
  player.memory = 6;
  const source = createCardInstance("STD-143", "player", 143001);
  source.compiled = compileEffectText(source.text, { category: source.category, id: source.id });
  const enemyA = createCardInstance("STD-022", "ai", 143002); const enemyB = createCardInstance("STD-025", "ai", 143003);
  player.hand = [source]; ai.front = [enemyA]; ai.back = [enemyB];
  player.deck.push(createCardInstance("STD-016", "player", 143004), createCardInstance("STD-017", "player", 143005));
  state.pending = { type: "response-window", playerId: "player", candidates: [source.uid], event: { sourcePlayerId: "ai", amount: 1 } };
  assert.equal(activateResponse(state, "player", source.uid), true);
  assert.equal(enemyA.sleep && enemyB.sleep, true);
  assert.equal(player.hand.length, 2);
});

test("STD-140 update offers the shared protection or nonself Sacred Tree salvage branches", () => {
  const state = createGame({ mode: "lab" }); const player = state.players.player;
  const source = createCardInstance("STD-140", "player", 140001); source.compiled = compileEffectText(source.text, { category: source.category, id: source.id });
  source.faceDown = false; source.residentActive = true; player.back.push(source); player.memory = 2;
  const effect = getActivatableEffects(state, "player", source).find((item) => item.kind === "update");
  assert.equal(activateCardEffect(state, "player", source.uid, effect.id), true);
  assert.deepEqual(state.pending.request.scopeOptions, ["①戦闘保護", "②聖樹をサルベージ"]);
  const target = createCardInstance("STD-022", "player", 140002); player.front.push(target);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { scope: "①戦闘保護", selected: [] }), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [target.uid] }), true);
  assert.ok(target.damageModifiers.some((modifier) => modifier.operation === "set" && modifier.amount === 0 && modifier.activeTurn === state.turnNumber));
});

test("STD-141 counts destroyed Sacred Tree Scripts and exposes only the matching threshold branches", () => {
  const state = createGame({ mode: "lab" }); const player = state.players.player;
  const source = createCardInstance("STD-141", "player", 141001); source.faceDown = false; source.residentActive = true; player.back.push(source);
  for (const id of ["STD-139", "STD-140", "STD-142"]) {
    const card = createCardInstance(id, "player", 141100 + player.front.length); player.front.push(card);
    destroyCard(state, "player", card.uid, { source: "test", suppressReplacement: true });
  }
  assert.equal(state.turnStats.destroyedSacredTreeScripts, 3);
  assert.equal(endTurn(state), false);
  assert.deepEqual(state.pending.request.scopeOptions, ["②3枚以上"]);
});

function reachStd141AccessDestination({ installOne, fullBack = false }) {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  const player = state.players.player;
  const source = createCardInstance("STD-141", "player", installOne ? 141301 : 141201);
  source.faceDown = false;
  source.residentActive = true;
  player.back = [source];
  if (fullBack) {
    player.back.push(...Array.from({ length: player.user.backLimit - 1 }, (_, index) => createCardInstance("STD-020", "player", 141310 + index)));
  }
  const accessCount = installOne ? 3 : 2;
  const accessed = ["STD-139", "STD-140", "STD-142"].slice(0, accessCount)
    .map((id, index) => createCardInstance(id, "player", 141220 + index));
  player.deck = accessed;
  state.turnStats.destroyedSacredTreeScripts = accessCount;
  assert.equal(endTurn(state), false);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, {
    scope: installOne ? "②3枚以上" : "①2枚以上",
    selected: []
  }), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: accessed.map((card) => card.uid) }), true);
  assert.equal(state.pending.request.continuation.type, "std141-access-destination");
  return { state, player, accessed };
}

test("STD-141 full-back forced install leaves the chosen card only in trash", () => {
  const { state, player, accessed } = reachStd141AccessDestination({ installOne: true, fullBack: true });
  const chosen = accessed[0];
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [chosen.uid] }), true);
  assert.equal(player.hand.some((card) => card.uid === chosen.uid), false);
  assert.equal(player.back.some((card) => card.uid === chosen.uid), false);
  assert.equal(player.trash.filter((card) => card.uid === chosen.uid).length, 1);
});

test("STD-141 available-back install leaves the chosen card face-down only in back", () => {
  const { state, player, accessed } = reachStd141AccessDestination({ installOne: true });
  const chosen = accessed[0];
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [chosen.uid] }), true);
  assert.equal(player.back.some((card) => card.uid === chosen.uid && card.faceDown), true);
  assert.equal(player.hand.some((card) => card.uid === chosen.uid), false);
  assert.equal(player.trash.some((card) => card.uid === chosen.uid), false);
});

test("STD-141 two-card access still sends the chosen card to hand and the remainder to trash", () => {
  const { state, player, accessed } = reachStd141AccessDestination({ installOne: false });
  const chosen = accessed[0];
  const remainder = accessed[1];
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [chosen.uid] }), true);
  assert.equal(player.hand.filter((card) => card.uid === chosen.uid).length, 1);
  assert.equal(player.back.some((card) => card.uid === chosen.uid), false);
  assert.equal(player.trash.some((card) => card.uid === remainder.uid), true);
});

function createStd141Resident(ownerId, uid) {
  const source = createCardInstance("STD-141", ownerId, uid);
  source.faceDown = false;
  source.residentActive = true;
  return source;
}

function resolveStd141ThirdBranch(state, sourceUid) {
  assert.equal(state.pending.request.continuation.type, "std141-choice");
  assert.equal(state.pending.request.continuation.sourceUid, sourceUid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { scope: "③5枚以上", selected: [] }), true);
  assert.equal(state.pending.request.continuation.type, "std141-place-yellow-ob");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [state.pending.request.candidates[0]] }), true);
}

test("STD-141 alternates owners and lets each select an unprocessed resident copy", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player; const ai = state.players.ai;
  const playerFirst = createStd141Resident("player", 141501); const playerSecond = createStd141Resident("player", 141502);
  const aiFirst = createStd141Resident("ai", 141503); const aiSecond = createStd141Resident("ai", 141504);
  const delayed = createCardInstance("STD-020", "player", 141510);
  player.front = [delayed]; player.back = [playerFirst, playerSecond]; ai.front = []; ai.back = [aiFirst, aiSecond];
  player.hand = [createCardInstance("STD-125", "player", 141511), createCardInstance("STD-126", "player", 141512)];
  ai.hand = [createCardInstance("STD-125", "ai", 141513), createCardInstance("STD-126", "ai", 141514)];
  state.turnStats.destroyedSacredTreeScripts = 5;
  state.delayedEffects.push({ event: "turn_ended", turnPlayerId: "player", type: "destroy_card", ownerId: "player", cardUid: delayed.uid, sourceName: "test" });

  assert.equal(endTurn(state), false);
  assert.equal(state.events.filter((event) => event.type === "turn_ended").length, 1);
  assert.equal(state.pending.request.continuation.type, "std141-turn-end-source");
  assert.equal(state.pending.request.continuation.playerId, "player");
  assert.deepEqual(state.pending.request.candidates, [playerFirst.uid, playerSecond.uid]);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [playerSecond.uid] }), true);
  resolveStd141ThirdBranch(state, playerSecond.uid);

  assert.equal(state.events.filter((event) => event.type === "turn_ended").length, 1);
  assert.ok(player.front.some((card) => card.uid === delayed.uid));
  assert.equal(state.pending.request.continuation.type, "std141-turn-end-source");
  assert.equal(state.pending.request.continuation.playerId, "ai");
  assert.deepEqual(state.pending.request.candidates, [aiFirst.uid, aiSecond.uid]);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [aiSecond.uid] }), true);
  resolveStd141ThirdBranch(state, aiSecond.uid);

  assert.equal(state.events.filter((event) => event.type === "turn_ended").length, 1);
  assert.ok(player.front.some((card) => card.uid === delayed.uid));
  resolveStd141ThirdBranch(state, playerFirst.uid);
  assert.ok(player.front.some((card) => card.uid === delayed.uid));
  resolveStd141ThirdBranch(state, aiFirst.uid);
  assert.equal(state.pending, null);
  assert.equal(state.std141TurnEndQueue, undefined);
  assert.equal(state.events.filter((event) => event.type === "turn_ended").length, 1);
  assert.equal(player.trash.some((card) => card.uid === delayed.uid), true);
  assert.equal(state.active, "player");
  assert.equal(state.turnNumber, 2);
});

test("STD-141 safely skips a queued resident that leaves the back before its turn", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const first = createStd141Resident("player", 141521); const removed = createStd141Resident("player", 141522);
  player.front = []; player.back = [first, removed]; player.hand = [createCardInstance("STD-125", "player", 141523)];
  state.players.ai.front = []; state.players.ai.back = [];
  state.turnStats.destroyedSacredTreeScripts = 5;

  assert.equal(endTurn(state), false);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [first.uid] }), true);
  player.back = player.back.filter((card) => card.uid !== removed.uid);
  player.trash.push(removed);
  resolveStd141ThirdBranch(state, first.uid);
  assert.equal(state.pending, null);
  assert.equal(state.std141TurnEndQueue, undefined);
  assert.equal(state.active, "player");
  assert.equal(state.turnNumber, 2);
});

test("Q3 final STD-223/224/227/238 compile through explicit runtime operations", () => {
  for (const id of ["STD-223", "STD-224", "STD-227", "STD-238"]) {
    const card = STD_SUPPORTED_CARDS[id];
    const compiled = compileEffectText(card.text, { category: card.category, id });
    assert.equal(compiled.status, "supported", id);
    assert.equal(compiled.warnings.length, 0, id);
  }
});

test("STD-223 Ambush interrupts an enemy Ob attack, pays two, damages and resumes", () => {
  const state = createGame({ mode: "lab" }); const player = state.players.player; const ai = state.players.ai;
  state.active = "ai"; player.memory = 2;
  const ambush = createCardInstance("STD-223", "player", 223001); const threshold = createCardInstance("STD-227", "player", 223002);
  player.registry = [ambush, threshold];
  const attacker = createCardInstance("STD-022", "ai", 223003); attacker.summoningSick = false; ai.front = [attacker];
  const victim = createCardInstance("STD-020", "player", 223004); victim.str = 3; player.front = [victim];
  assert.equal(attack(state, "ai", attacker.uid, "player-fortress"), true);
  assert.equal(state.pending.request.continuation.type, "std223-ambush-choice");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { scope: "[アンブッシュ:2]を起動", selected: [] }), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [victim.uid] }), true);
  assert.equal(player.memory, 0);
  assert.ok(player.trash.some((card) => card.uid === ambush.uid));
  assert.ok(player.trash.some((card) => card.uid === victim.uid));
});

test("STD-223 Ambush resumes the attack after a Script window opened by the destroyed Ob", () => {
  const state = createGame({ mode: "lab" }); const player = state.players.player; const ai = state.players.ai;
  state.active = "ai"; player.memory = 2; ai.memory = 5;
  const ambush = createCardInstance("STD-223", "player", 223011); const threshold = createCardInstance("STD-227", "player", 223012);
  player.registry = [ambush, threshold]; player.front = [];
  const attacker = createCardInstance("STD-022", "ai", 223013); attacker.summoningSick = false;
  const bug = createCardInstance("STD-173", "ai", 223014); bug.sleep = true;
  const cashBack = createCardInstance("STD-036", "ai", 223015); cashBack.faceDown = true;
  ai.front = [attacker, bug]; ai.back = [cashBack];
  const fortressBefore = player.fortressStr;
  assert.equal(attack(state, "ai", attacker.uid, "player-fortress"), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { scope: "[アンブッシュ:2]を起動", selected: [] }), true);
  assert.equal(state.pending.request.continuation.type, "std223-ambush-target");
  // The answer must be accepted even though destroying the Ob opens the Script confirmation first.
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [bug.uid] }), true);
  assert.ok(ai.trash.some((card) => card.uid === bug.uid));
  assert.equal(state.prompt?.scriptUid, cashBack.uid);
  assert.equal(state.deferredAttack?.attackerUid, attacker.uid);
  assert.equal(player.fortressStr, fortressBefore, "the attack waits for the Script confirmation");
  assert.equal(declinePrompt(state), true);
  assert.equal(state.deferredAttack, null);
  assert.ok(player.fortressStr < fortressBefore, "the declared attack resumes and lands after the confirmation");
  assert.equal(attacker.sleep, true);
});

test("STD-223 Ambush aimed at the attacker ends the declared attack when Backup moves it out of the front", () => {
  const state = createGame({ mode: "lab" }); const player = state.players.player; const ai = state.players.ai;
  state.active = "ai"; player.memory = 2;
  const ambush = createCardInstance("STD-223", "player", 223021); const threshold = createCardInstance("STD-227", "player", 223022);
  player.registry = [ambush, threshold]; player.front = [];
  const attacker = createCardInstance("STD-129", "ai", 223023); attacker.summoningSick = false;
  ai.front = [attacker]; ai.back = [];
  const fortressBefore = player.fortressStr;
  assert.equal(attack(state, "ai", attacker.uid, "player-fortress"), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { scope: "[アンブッシュ:2]を起動", selected: [] }), true);
  // The answer is accepted; the attacker (STR 1) is replaced by Backup and can no longer attack.
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [attacker.uid] }), true);
  assert.equal(state.pending, null);
  assert.equal(ai.back.some((card) => card.uid === attacker.uid), true);
  assert.equal(attacker.sleep, true);
  assert.equal(player.fortressStr, fortressBefore);
});

test("STD-224 records its chosen number and destroys itself with a matching enemy placement", () => {
  const state = createGame({ mode: "lab" }); const player = state.players.player; const ai = state.players.ai;
  const tackle = createCardInstance("STD-224", "player", 224001); player.hand = [tackle];
  assert.equal(installCard(state, "player", tackle.uid), true);
  assert.equal(configurePlugin(state, "player", tackle.uid, 2), true);
  state.active = "ai"; ai.memory = 10;
  const target = createCardInstance("STD-025", "ai", 224002); target.cost = 2; ai.hand = [target];
  assert.equal(playCard(state, "ai", target.uid, { force: true }), true);
  assert.ok(player.trash.some((card) => card.uid === tackle.uid));
  assert.ok(ai.trash.some((card) => card.uid === target.uid));
});

test("STD-227 installs one random card from each enemy source and counts unique registry colors", () => {
  const state = createGame({ mode: "lab", rng: () => 0 }); const player = state.players.player; const ai = state.players.ai;
  player.memory = 20; player.hand = [createCardInstance("STD-227", "player", 227001)];
  ai.hand = [createCardInstance("STD-020", "ai", 227002)]; ai.front = [createCardInstance("STD-021", "ai", 227003)];
  ai.back = []; ai.trash = [createCardInstance("STD-022", "ai", 227004)]; ai.deck = [createCardInstance("STD-025", "ai", 227005)];
  ai.hand[0].color = "赤"; ai.front[0].color = "青"; ai.trash[0].color = "黄"; ai.deck[0].color = "橙";
  assert.equal(playCard(state, "player", player.hand[0].uid), true);
  const imperial = player.front.find((card) => card.id === "STD-227");
  assert.equal(ai.registry.length, 4);
  assert.ok(cardAtk(state, "player", imperial) >= 1);
});

test("STD-238 requires one own area Ob plus registry material and pays two layers to ready and gain attack", () => {
  const state = createGame({ mode: "lab" }); const player = state.players.player;
  state.players.ai.front = []; state.players.ai.back = [];
  player.memory = 20;
  const cannon = createCardInstance("STD-238", "player", 238001); const ob = createCardInstance("STD-022", "player", 238002); const reg = createCardInstance("STD-020", "player", 238003);
  player.hand = [cannon]; player.front = [ob]; player.registry = [reg];
  assert.equal(playLayeredCard(state, "player", cannon.uid, [ob.uid, reg.uid]), true);
  cannon.summoningSick = false;
  const target = getAttackTargets(state, "player", cannon).find((item) => item.type === "fortress");
  assert.equal(attack(state, "player", cannon.uid, target.uid), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { scope: "レイヤー2枚を破棄して起動", selected: [] }), true);
  for (const layer of [...cannon.mounted]) toggleSelection(state.pending.request, layer.uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.equal(cannon.mounted.length, 0);
  assert.equal(cannon.permanentAtk, 2);
  assert.equal(cannon.sleep, false);
});

test("a layer cost whose trash move opens an STD-003 window defers the declared attack instead of rejecting the payment", () => {
  const stage = (id, layerId) => {
    const state = createGame({ mode: "lab" }); const { player, ai } = state.players;
    state.players.ai.front = []; state.players.ai.back = [];
    const script = createCardInstance("STD-003", "ai", 997001); script.faceDown = true;
    ai.back = [script]; ai.memory = 10; ai.fortressStr = 20;
    const source = createCardInstance(id, "player", 997002);
    source.mounted = [createCardInstance(layerId, "player", 997003), createCardInstance(layerId, "player", 997004)];
    source.summoningSick = false;
    player.front = [source]; player.hand = []; player.memory = 20;
    return { state, source, player, ai };
  };
  // STD-238: pay two layers, +2 ATK, then attack the user and stand by again.
  const { state, source, ai } = stage("STD-238", "STD-020");
  assert.equal(attack(state, "player", source.uid, "ai-fortress"), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { scope: "レイヤー2枚を破棄して起動", selected: [] }), true);
  for (const layer of [...source.mounted]) toggleSelection(state.pending.request, layer.uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.equal(state.prompt?.scriptUid, ai.back[0].uid);
  assert.ok(state.deferredAttack, "the attack waits for the confirmation");
  assert.equal(ai.fortressStr, 20);
  assert.equal(declinePrompt(state), true);
  assert.equal(state.deferredAttack, null);
  assert.ok(ai.fortressStr < 20, "the declared attack resumes and lands");
  assert.equal(source.sleep, false, "the card stands by again after the attack");
});

test("Q4 existing candidates 118/199/203/204/207/209 compile completely", () => {
  for (const id of ["STD-118", "STD-199", "STD-203", "STD-204", "STD-207", "STD-209"]) {
    const card = NEUTRON_CARDS[id] ?? VENGEANCE_CARDS[id];
    const compiled = compileEffectText(card.text, { category: card.category, id });
    assert.equal(compiled.status, "supported", id);
    assert.equal(compiled.warnings.length, 0, id);
  }
});

test("STD-094 compiles its grouped layered requirement and stack-count login damage", () => {
  const card = CARD_LIBRARY["STD-094"];
  const compiled = compileEffectText(card.text, { category: card.category, id: card.id });
  assert.equal(compiled.status, "supported");
  assert.equal(compiled.warnings.length, 0);
  assert.ok(compiled.operations.some((operation) => operation.type === "layered_login_damage"));
});

test("STD-094 requires one Noid plus Red Punks and damages by the whole stack", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const opponent = state.players.ai;
  player.hand = [createCardInstance("STD-094", "player", 94001)];
  player.front = [createCardInstance("STD-092", "player", 94002)];
  player.back = [createCardInstance("STD-078", "player", 94003)];
  player.registry = [createCardInstance("STD-078", "player", 94004)];
  player.memory = 20;
  opponent.fortressStr = 20;
  assert.equal(playLayeredCard(state, "player", player.hand[0].uid, [player.front[0].uid, player.back[0].uid], "front"), true);
  assert.equal(opponent.fortressStr, 17);
  assert.equal(player.front.find((item) => item.id === "STD-094").mounted.length, 2);
});

test("STD-094 rejects material groups without a Noid", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  player.hand = [createCardInstance("STD-094", "player", 94011)];
  player.front = [createCardInstance("STD-078", "player", 94012)];
  player.back = [createCardInstance("STD-079", "player", 94013)];
  player.registry = [createCardInstance("STD-078", "player", 94014)];
  player.memory = 20;
  assert.equal(playLayeredCard(state, "player", player.hand[0].uid, [player.front[0].uid, player.back[0].uid], "front"), false);
});

test("STD-095 Override automatically uses the greatest selected original memory", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  player.hand = [createCardInstance("STD-095", "player", 95001)];
  player.front = [createCardInstance("STD-094", "player", 95002)];
  player.back = [createCardInstance("STD-078", "player", 95003)];
  player.registry = [createCardInstance("STD-078", "player", 95004)];
  player.memory = 3;
  assert.equal(playLayeredCard(state, "player", player.hand[0].uid, [player.front[0].uid, player.back[0].uid], "front"), true);
  assert.equal(player.memory, 3);
});

test("STD-095 gains layer-count attack and deals destroyed Ob original STR", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const opponent = state.players.ai;
  const source = createCardInstance("STD-095", "player", 95101);
  source.mounted = [createCardInstance("STD-094", "player", 95102), createCardInstance("STD-078", "player", 95103)];
  source.summoningSick = false;
  player.front = [source];
  const target = createCardInstance("STD-020", "ai", 95104);
  target.sleep = true;
  opponent.front = [target];
  opponent.fortressStr = 20;
  assert.equal(attack(state, "player", source.uid, target.uid), true);
  assert.equal(opponent.fortressStr, 18);
});

test("STD-099 competes with Backup in one destruction replacement choice", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const target = createCardInstance("STD-094", "player", 99001);
  target.backup = 1;
  player.front = [target];
  player.back = [createCardInstance("STD-078", "player", 99002)];
  player.hand = [createCardInstance("STD-099", "player", 99003)];
  assert.equal(destroyCard(state, "player", target.uid, { source: "test" }), true);
  assert.deepEqual(new Set(state.pending.request.scopeOptions), new Set(["破壊をそのまま適用", "[バックアップ]で置換", "STD-099で置換ログイン"]));
  const first = state.pending.request.continuation;
  assert.equal(resolveCardSelection(state, first, { selected: [], scope: "STD-099で置換ログイン" }), true);
  const second = state.pending.request.continuation;
  assert.equal(resolveCardSelection(state, second, { selected: [player.back[0].uid], scope: null }), true);
  const rebuilt = player.front.find((card) => card.id === "STD-099");
  assert.equal(rebuilt.mounted.length, 2);
  assert.equal(rebuilt.permanentAtk, 2);
  assert.equal(target.backup, 1);
});

test("variable expression composes counts, constants, differences and union deduplication", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  player.front = [createCardInstance("STD-022", "player", 137001)];
  player.back = [createCardInstance("STD-023", "player", 137002)];
  player.fortressStr = 7;
  state.players.ai.fortressStr = 12;
  const both = createCardInstance("STD-139", "player", 137003);
  both.grantedKeywords = ["SECURITY"];
  player.trash = [both, createCardInstance("STD-022", "player", 137004)];
  assert.equal(resolveVariableExpression(state, "player", { count: "own_area_security", add: 1 }), 2);
  assert.equal(resolveVariableExpression(state, "player", { aggregate: "absolute_user_life_difference" }), 5);
  assert.equal(resolveVariableExpression(state, "player", { countUnion: ["own_trash_nom", "own_trash_security"] }), 2);
});

test("STD-137 chooses a life-difference decode or the shared next-turn modifier", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const source = createCardInstance("STD-137", "player", 137011);
  const ownOb = createCardInstance("STD-020", "player", 137012);
  player.front = [ownOb];
  player.hand = [source];
  player.registry = [createCardInstance("STD-126", "player", 137013)];
  player.memory = 10;
  assert.equal(playCard(state, "player", source.uid), true);
  const continuation = state.pending.request.continuation;
  assert.equal(resolveCardSelection(state, continuation, { selected: [], choice: "①自分Obすべてを+2/+2" }), true);
  assert.equal(cardAtk(state, "player", ownOb), Number(ownOb.atk) + 2);

  const decodeState = createGame({ mode: "sandbox", rng: () => 0.5 });
  const decodePlayer = decodeState.players.player;
  const decodeSource = createCardInstance("STD-137", "player", 137021);
  const decodeTarget = createCardInstance("STD-129", "player", 137022);
  decodePlayer.fortressStr = 7;
  decodeState.players.ai.fortressStr = 10;
  decodePlayer.hand = [decodeSource];
  decodePlayer.trash = [decodeTarget];
  decodePlayer.registry = [createCardInstance("STD-126", "player", 137023)];
  decodePlayer.memory = 10;
  assert.equal(playCard(decodeState, "player", decodeSource.uid), true);
  assert.ok(decodeState.pending.request.scopeOptions.includes("②ナイツ・オブ・マキナをデコード"));
  assert.equal(resolveCardSelection(decodeState, decodeState.pending.request.continuation, { selected: [], choice: "②ナイツ・オブ・マキナをデコード" }), true);
  assert.equal(decodeState.pending.request.continuation.type, "runtime-decode");
  assert.deepEqual(decodeState.pending.request.candidates, [decodeTarget.uid]);
  assert.equal(resolveCardSelection(decodeState, decodeState.pending.request.continuation, { selected: [decodeTarget.uid] }), true);
  assert.equal(decodeState.pending.type, "decode-place");
});

test("STD-138 binds X to Security count plus one", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const opponent = state.players.ai;
  const source = createCardInstance("STD-138", "player", 138001);
  player.hand = [source];
  player.front = [createCardInstance("STD-022", "player", 138002)];
  player.registry = [createCardInstance("STD-126", "player", 138003)];
  player.memory = 10;
  const target = createCardInstance("STD-020", "ai", 138004);
  opponent.front = [target];
  assert.equal(playCard(state, "player", source.uid, { targetUid: target.uid }), true);
  assert.equal(target.damage, 2);
});

test("STD-146 counts NOM union Security and decodes only original memory below X", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const source = createCardInstance("STD-146", "player", 146001);
  const eligible = createCardInstance("STD-020", "player", 146002);
  const boundary = createCardInstance("STD-027", "player", 146003);
  const nom = createCardInstance("STD-139", "player", 146004);
  nom.grantedKeywords = ["SECURITY"];
  player.hand = [source];
  player.trash = [eligible, boundary, nom, createCardInstance("STD-022", "player", 146005), createCardInstance("STD-022", "player", 146006)];
  player.registry = [createCardInstance("STD-126", "player", 146007)];
  player.memory = 10;
  assert.equal(playCard(state, "player", source.uid), true);
  assert.deepEqual(state.pending.request.candidates, [eligible.uid]);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [eligible.uid] }), true);
  assert.equal(state.pending.type, "decode-place");
});

test("STD-157 and STD-162 compile LKI-bound destruction follow-ups", () => {
  for (const id of ["STD-157", "STD-162"]) {
    const card = CARD_LIBRARY[id];
    const compiled = compileEffectText(card.text, { id, category: card.category });
    assert.equal(compiled.status, "supported", id);
    assert.equal(compiled.warnings.length, 0, id);
  }
});

test("STD-157 Login snapshots destroyed card original memory and places a black Ob for free", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const solomon = createCardInstance("STD-157", "player", 157001);
  const sacrifice = createCardInstance("STD-021", "player", 157002);
  const black = createCardInstance("STD-150", "player", 157003);
  player.hand = [solomon, black];
  player.front = [sacrifice];
  player.registry = [createCardInstance("STD-150", "player", 157004)];
  player.memory = 10;
  assert.equal(playCard(state, "player", solomon.uid, { zone: "back" }), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [sacrifice.uid] }), true);
  assert.ok(state.pending.request.candidates.includes(black.uid));
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [black.uid] }), true);
  assert.ok([...player.front, ...player.back].some((card) => card.uid === black.uid));
});

test("STD-162 uses original STR after Backup replacement and salvages within aggregate memory", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const spell = createCardInstance("STD-162", "player", 162001);
  const sacrifice = createCardInstance("STD-021", "player", 162002);
  sacrifice.backup = 1;
  const cheap = createCardInstance("STD-020", "player", 162003);
  const expensive = createCardInstance("STD-030", "player", 162004);
  player.hand = [spell];
  player.front = [sacrifice];
  player.back = [];
  player.trash = [cheap, expensive];
  player.registry = [createCardInstance("STD-158", "player", 162005)];
  player.memory = 10;
  assert.equal(playCard(state, "player", spell.uid), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [sacrifice.uid] }), true);
  assert.equal(player.back.some((card) => card.uid === sacrifice.uid), true);
  assert.equal(state.pending.request.budget, Number(sacrifice.str));
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [cheap.uid] }), true);
  assert.ok(player.hand.some((card) => card.uid === cheap.uid));
  assert.equal(sacrifice.backup, 0);
});

test("Q5 batch 1 cards 003/011/026/028/029 compile completely", () => {
  for (const id of ["STD-003", "STD-011", "STD-026", "STD-028", "STD-029"]) {
    const card = CARD_LIBRARY[id];
    const compiled = compileEffectText(card.text, { id, category: card.category });
    assert.equal(compiled.status, "supported", id);
    assert.equal(compiled.warnings.length, 0, id);
  }
});

test("STD-003 declares before trash movement but only replaces later moves after it resolves", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const opponent = state.players.ai;
  const target = createCardInstance("STD-020", "player", 30001);
  const script = createCardInstance("STD-003", "ai", 30002);
  script.faceDown = true;
  player.front = [target];
  opponent.back = [script];
  opponent.memory = 10;
  assert.equal(destroyCard(state, "player", target.uid, { source: "test" }), true);
  assert.equal(state.prompt.scriptUid, script.uid);
  assert.equal(activateScript(state, "ai", script.uid), true);
  assert.equal(player.trash.some((card) => card.uid === target.uid), true);
  assert.equal(player.ban.some((card) => card.uid === target.uid), false);
  assert.equal(opponent.trash.some((card) => card.uid === script.uid), true);
  const later = createCardInstance("STD-021", "player", 30003);
  player.front.push(later);
  assert.equal(destroyCard(state, "player", later.uid, { source: "later" }), true);
  assert.equal(player.ban.some((card) => card.uid === later.uid), true);
});

test("STD-003 declaration lets the current multi-card discard and Sp cleanup finish before its effect", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const opponent = state.players.ai;
  const reboot = createCardInstance("STD-010", "player", 30101);
  const first = createCardInstance("STD-020", "player", 30102);
  const second = createCardInstance("STD-021", "player", 30103);
  const script = createCardInstance("STD-003", "ai", 30104);
  script.faceDown = true;
  player.hand = [reboot, first, second];
  player.memory = 10;
  opponent.back = [script];
  opponent.memory = 10;
  assert.equal(playCard(state, "player", reboot.uid, { force: true }), true);
  assert.equal(state.prompt.scriptUid, script.uid);
  assert.equal(player.trash.length, 0);
  assert.equal(activateScript(state, "ai", script.uid), true);
  assert.deepEqual(new Set(player.trash.map((card) => card.uid)), new Set([reboot.uid, first.uid, second.uid]));
  assert.equal(player.ban.length, 0);
  assert.equal(state.declaredEffects.length, 0);
  assert.equal(state.resolvingDeclaredEffect, null);
});

test("STD-011 removes granted components but preserves printed data damage and layers", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const target = createCardInstance("STD-020", "ai", 11001);
  target.damage = 1;
  target.mounted = [createCardInstance("STD-078", "ai", 11002)];
  target.grantedKeywords = ["SECURITY"];
  target.permanentAtk = 4;
  target.protect = 2;
  state.players.ai.front = [target];
  const spell = createCardInstance("STD-011", "player", 11003);
  player.hand = [spell];
  player.memory = 10;
  assert.equal(playCard(state, "player", spell.uid, { targetUid: target.uid, force: true }), true);
  assert.deepEqual(target.grantedKeywords, []);
  assert.equal(target.permanentAtk, 0);
  assert.equal(target.protect, 0);
  assert.equal(target.damage, 1);
  assert.equal(target.mounted.length, 1);
  assert.equal(target.atk, 2);
});

test("STD-026 Protect, STD-028 Contact and STD-029 Backup use shared keyword runtime", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const protect = createCardInstance("STD-026", "player", 26001);
  player.front = [protect];
  assert.equal(destroyCard(state, "player", protect.uid, { source: "test" }), false);
  assert.equal(protect.protect, 0);
  const backup = createCardInstance("STD-029", "player", 29001);
  player.front = [backup];
  player.back = [];
  assert.equal(destroyCard(state, "player", backup.uid, { source: "test" }), true);
  assert.equal(player.back[0].uid, backup.uid);
  const contact = createCardInstance("STD-028", "player", 28001);
  contact.summoningSick = true;
  player.front = [contact];
  const defender = createCardInstance("STD-020", "ai", 28002);
  defender.sleep = true;
  state.players.ai.front = [defender];
  assert.equal(canAttack(state, "player", contact), true);
});

test("Q5 batch 2 cards 038/043/044/076/082 compile completely", () => {
  for (const id of ["STD-038", "STD-043", "STD-044", "STD-076", "STD-082"]) {
    const card = CARD_LIBRARY[id];
    const compiled = compileEffectText(card.text, { id, category: card.category });
    assert.equal(compiled.status, "supported", id);
    assert.equal(compiled.warnings.length, 0, id);
  }
});

test("STD-038 bans every card from one generation event", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const script = createCardInstance("STD-038", "ai", 38001);
  script.faceDown = true;
  state.players.ai.back = [script];
  state.players.ai.memory = 10;
  const generator = createCardInstance("STD-206", "player", 38002);
  state.players.player.hand = [generator];
  state.players.player.memory = 10;
  assert.equal(playCard(state, "player", generator.uid, { force: true, ignoreColor: true }), true);
  assert.equal(state.prompt.scriptUid, script.uid);
  assert.equal(activateScript(state, "ai", script.uid), true);
  assert.equal(state.players.player.ban.filter((card) => ["STD-189", "STD-205"].includes(card.id)).length, 2);
  assert.equal(state.players.player.trash.filter((card) => card.uid === generator.uid).length, 1);
  assert.equal(state.players.ai.trash.filter((card) => card.uid === script.uid).length, 1);
  assert.equal(state.declaredEffects.length, 0);
  const parentFinished = state.events.findIndex((event) => event.type === "card_executed" && event.cardUid === generator.uid);
  const declaredFinished = state.events.findIndex((event) => event.type === "script_activated" && event.cardUid === script.uid);
  assert.ok(parentFinished >= 0 && declaredFinished > parentFinished);
});

test("condition alias Script normal activation uses its real target selection", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const script = createCardInstance("STD-001", "player", 38011);
  script.faceDown = true; player.back = [script]; player.front = []; state.players.ai.front = []; state.players.ai.back = []; player.memory = 10;
  const target = createCardInstance("STD-003", "ai", 38012); target.faceDown = false; state.players.ai.back = [target];
  assert.equal(activateScript(state, "player", script.uid), true);
  assert.equal(state.pending?.request?.continuation?.type, "destroy-selected");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [target.uid] }), true);
  assert.equal(state.players.ai.trash.some((card) => card.uid === target.uid), true);
  assert.equal(player.trash.some((card) => card.uid === script.uid), true);
});

test("if Scripts support normal idle activation only when their body is event-independent", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const drawScript = createCardInstance("STD-036", "player", 38101);
  const eventScript = createCardInstance("STD-018", "player", 38102);
  drawScript.faceDown = true; eventScript.faceDown = true;
  player.back = [drawScript, eventScript];
  player.deck = [createCardInstance("STD-020", "player", 38103), createCardInstance("STD-021", "player", 38104)];
  player.memory = 10;
  const before = player.memory;
  assert.equal(activateScript(state, "player", eventScript.uid), false);
  assert.equal(player.memory, before);
  assert.equal(eventScript.faceDown, true);
  assert.equal(activateScript(state, "player", drawScript.uid), true);
  assert.equal(player.hand.length, 2);
  assert.equal(player.trash.some((card) => card.uid === drawScript.uid), true);
});

test("normal if activation rejects reentry and face-up residents before declaration mutation", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const script = createCardInstance("STD-036", "player", 38111);
  script.faceDown = true; player.back = [script]; player.memory = 10;
  const serial = state.declarationSerial;
  state.effectResolution = { id: "EFFECT-OUTER", kind: "test", status: "resolving" };
  assert.equal(activateScript(state, "player", script.uid), false);
  assert.equal(player.memory, 10);
  assert.equal(state.declarationSerial, serial);
  assert.equal(state.declaredEffects.length, 0);
  state.effectResolution = null;
  const resident = createCardInstance("STD-139", "player", 38112);
  resident.faceDown = false; resident.residentActive = true; player.back = [resident];
  assert.equal(activateScript(state, "player", resident.uid), false);
  assert.equal(state.declarationSerial, serial);
});

test("declared if effect resolves from snapshot when its source moved during the wait and cleans once", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const first = createCardInstance("STD-036", "player", 38121);
  const second = createCardInstance("STD-036", "player", 38122);
  const victim = createCardInstance("STD-020", "player", 38123);
  first.faceDown = true; second.faceDown = true;
  player.back = [first, second]; player.front = [victim]; player.deck = [createCardInstance("STD-021", "player", 38124), createCardInstance("STD-022", "player", 38125)]; player.memory = 20;
  assert.equal(destroyCard(state, "player", victim.uid, { source: "snapshot-test" }), true);
  assert.equal(activateScript(state, "player", first.uid), true);
  assert.equal(state.prompt?.scriptUid, second.uid);
  assert.equal(destroyCard(state, "player", first.uid, { source: "move-declared-source", suppressReplacement: true }), true);
  assert.equal(declinePrompt(state), true);
  assert.equal(player.hand.length, 2);
  assert.equal(player.trash.filter((card) => card.uid === first.uid).length, 1);
  assert.equal(state.declaredEffects.length, 0);
});

test("STD-139 normal activation declares its real resident selection body", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  const player = state.players.player;
  const script = createCardInstance("STD-139", "player", 38201);
  const target = createCardInstance("STD-020", "player", 38202);
  script.faceDown = true; player.back = [script]; player.front = [target]; player.memory = 10;
  const atkBefore = cardAtk(state, "player", target);
  const strBefore = cardMaxStr(state, "player", target);
  assert.equal(activateScript(state, "player", script.uid), true);
  assert.equal(state.pending?.request?.continuation?.type, "trigger-modify-grant");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [target.uid] }), true);
  assert.equal(target.timedModifiers.at(-1)?.atk, -2);
  assert.equal(target.timedModifiers.at(-1)?.str, 1);
  assert.equal(target.timedModifiers.at(-1)?.expiresAfterTurn, state.turnNumber);
  assert.equal(cardAtk(state, "player", target), atkBefore - 2);
  assert.equal(cardMaxStr(state, "player", target), strBefore + 1);
  assert.equal(cardHasKeyword(target, "SECURITY"), true);
  assert.equal(script.residentActive, true);
  assert.equal(script.declaredEffectId, undefined);
});

test("same-event duplicate if Scripts retain one deterministic window per copy", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const first = createCardInstance("STD-036", "ai", 38301);
  const second = createCardInstance("STD-036", "ai", 38302);
  const victim = createCardInstance("STD-020", "ai", 38303);
  first.faceDown = true; second.faceDown = true;
  state.players.ai.back = [first, second]; state.players.ai.front = [victim]; state.players.ai.memory = 10;
  assert.equal(destroyCard(state, "ai", victim.uid, { source: "duplicate-window-test" }), true);
  assert.equal(state.prompt?.scriptUid, first.uid);
  assert.deepEqual(state.scriptActivationQueue.map((entry) => entry.prompt.scriptUid), [second.uid]);
});

test("STD-043 Security, STD-044 QA and STD-076 Backup use shared keyword runtime", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const security = createCardInstance("STD-043", "ai", 43001);
  const qa = createCardInstance("STD-044", "player", 44001);
  qa.summoningSick = true;
  const backup = createCardInstance("STD-076", "player", 76001);
  state.players.ai.front = [security];
  state.players.player.front = [qa, backup];
  assert.equal(cardHasKeyword(security, "SECURITY"), true);
  assert.equal(cardHasKeyword(qa, "QA"), true);
  assert.equal(destroyCard(state, "player", backup.uid, { source: "test" }), true);
  assert.equal(state.players.player.back.some((card) => card.uid === backup.uid), true);
});

test("STD-082 mills deck top then offers one memory-three Code for placement", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const source = createCardInstance("STD-082", "player", 82001);
  const code = { id: "TEST-CODE", uid: "code-82002", owner: "player", name: "テストCode", category: "Code", color: "赤", cost: 3, atk: 0, str: 1, text: "", mounted: [] };
  player.hand = [source];
  player.deck = [code];
  player.memory = 10;
  player.front = [];
  player.back = [];
  assert.equal(playCard(state, "player", source.uid, { force: true, ignoreColor: true }), true);
  assert.equal(state.pending.request.continuation.type, "runtime-decode");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [code.uid], valid: true }), true);
  assert.equal(state.pending.type, "decode-place");
  assert.equal(resolveAccessDragPlacement(state, "player", "front", source.uid), true);
  assert.equal(source.mounted.some((card) => card.uid === code.uid), true);
});

test("Q5 batch 3 cards 088/091/093/100/105 compile completely", () => {
  for (const id of ["STD-088", "STD-091", "STD-093", "STD-100", "STD-105"]) {
    const card = CARD_LIBRARY[id];
    const compiled = compileEffectText(card.text, { id, category: card.category });
    assert.equal(compiled.status, "supported", id);
    assert.equal(compiled.warnings.length, 0, id);
  }
});

test("STD-088 cannot be executed and STD-093 places one Punks on Login", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  player.front = [];
  player.back = [];
  player.memory = 20;
  const yoshida = createCardInstance("STD-088", "player", 88001);
  const soundman = createCardInstance("STD-093", "player", 93001);
  player.hand = [yoshida, soundman];
  assert.equal(playCard(state, "player", yoshida.uid, { force: true, ignoreColor: true }), false);
  assert.equal(playCard(state, "player", soundman.uid, { force: true, ignoreColor: true }), true);
  assert.equal([...player.front, ...player.back].some((card) => card.id === "STD-092"), true);
});

test("STD-091 must attack an Ob if one remains attackable", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  player.front = [];
  player.back = [];
  player.memory = 10;
  const atsuto = createCardInstance("STD-091", "player", 91001);
  player.hand = [atsuto];
  const enemy = createCardInstance("STD-020", "ai", 91002);
  enemy.sleep = true;
  state.players.ai.front = [enemy];
  assert.equal(playCard(state, "player", atsuto.uid, { force: true, ignoreColor: true }), true);
  assert.equal(endTurn(state), false);
  assert.match(state.message, /Obを攻撃/);
});

test("STD-100 reduces execution cost once per distinct Red Punks name", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const sasuke = createCardInstance("STD-100", "player", 100001);
  const one = createCardInstance("STD-093", "player", 100002);
  const duplicate = createCardInstance("STD-093", "player", 100003);
  const other = createCardInstance("STD-094", "player", 100004);
  player.front = [one, duplicate];
  player.back = [other];
  assert.equal(executionCost(sasuke, state, "player"), 10);
});

test("STD-105 interrupts a fortress attack and force-executes one sleeping Security Lyd-Ob", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const ai = state.players.ai;
  player.front = [];
  player.back = [];
  ai.front = [];
  ai.back = [];
  state.active = "ai";
  const script = createCardInstance("STD-105", "player", 105001);
  script.faceDown = true;
  player.back = [script];
  player.memory = 10;
  player.registry = [createCardInstance("STD-091", "player", 105004)];
  const lyd = createCardInstance("STD-195", "player", 105002);
  player.hand = [lyd];
  const attacker = createCardInstance("STD-020", "ai", 105003);
  attacker.summoningSick = false;
  ai.front = [attacker];
  assert.equal(attack(state, "ai", attacker.uid, "player-fortress"), true);
  assert.equal(state.prompt.scriptUid, script.uid);
  assert.equal(activateScript(state, "player", script.uid), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [lyd.uid], valid: true }), true);
  const placed = [...player.front, ...player.back].find((card) => card.uid === lyd.uid);
  assert.equal(placed.sleep, true);
  assert.equal(cardHasKeyword(placed, "SECURITY"), true);
  assert.equal(state.delayedEffects.some((effect) => effect.cardUid === lyd.uid && effect.dueTurn === state.turnNumber + 1), true);
});

test("STD-105 force-executes only its controller's hand Lyd-Ob without that Ob's memory", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player; const ai = state.players.ai;
  const operation = compileEffectText(CARD_LIBRARY["STD-105"].text, { id: "STD-105", category: "Script" }).operations.find((item) => item.type === "fortress_attack_interrupt");
  assert.deepEqual(operation.execute.destination, { owner: "controller", zone: "area" });
  const script = createCardInstance("STD-105", "player", 105011); script.faceDown = true;
  const forced = createCardInstance("STD-195", "player", 105012); const excluded = createCardInstance("STD-195", "ai", 105013); const attacker = createCardInstance("STD-020", "ai", 105014); attacker.summoningSick = false;
  player.front = []; player.back = [script]; player.hand = [forced]; player.memory = 3; player.registry = [createCardInstance("STD-091", "player", 105015)];
  ai.front = [attacker]; ai.back = []; ai.hand = [excluded]; ai.memory = 0; state.active = "ai";
  assert.equal(attack(state, "ai", attacker.uid, "player-fortress"), true);
  assert.equal(activateScript(state, "player", script.uid), true);
  assert.deepEqual(state.pending.request.candidates, [forced.uid]);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [forced.uid] }), true);
  const placed = [...player.front, ...player.back].find((card) => card.uid === forced.uid);
  assert.ok(placed);
  assert.equal(player.memory, 0);
  assert.equal(ai.memory, 0);
  assert.equal(placed.sleep, true);
  assert.equal(cardHasKeyword(placed, "SECURITY"), true);
  assert.equal(ai.hand.some((card) => card.uid === excluded.uid), true);
  assert.equal(state.delayedEffects.some((effect) => effect.ownerId === "player" && effect.cardUid === forced.uid), true);
});

test("Q5 batch 4 cards 110/113/114/115/116 compile completely", () => {
  for (const id of ["STD-110", "STD-113", "STD-114", "STD-115", "STD-116"]) {
    const compiled = compileEffectText(CARD_LIBRARY[id].text, { id, category: CARD_LIBRARY[id].category });
    assert.equal(compiled.status, "supported", id);
    assert.equal(compiled.warnings.length, 0, id);
  }
});

test("STD-110 grants current own Ob Encryption through the next turn end", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const ob = createCardInstance("STD-020", "player", 110001);
  const wall = createCardInstance("STD-110", "player", 110002);
  player.front = [ob];
  player.back = [];
  player.hand = [wall];
  player.memory = 20;
  assert.equal(playCard(state, "player", wall.uid, { force: true, ignoreColor: true }), true);
  assert.equal(cardHasKeyword(ob, "ENCRYPTION"), true);
  assert.equal(ob.keywordExpiries.ENCRYPTION, state.turnNumber + 1);
  assert.equal(endTurn(state), true);
  assert.equal(cardHasKeyword(ob, "ENCRYPTION"), true);
  assert.equal(endTurn(state), true);
  assert.equal(cardHasKeyword(ob, "ENCRYPTION"), false);
});

test("STD-113 places one printed-memory-two Electron Fairy on Login", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const sister = createCardInstance("STD-113", "player", 113001);
  const fairy = createCardInstance("STD-124", "player", 113002);
  fairy.cost = 2;
  player.front = [];
  player.back = [];
  player.hand = [sister, fairy];
  player.memory = 20;
  assert.equal(playCard(state, "player", sister.uid, { force: true, ignoreColor: true }), true);
  assert.equal(state.pending?.request?.continuation?.type, "runtime-action-selection");
  assert.deepEqual(state.pending.request.candidates, [fairy.uid]);
  toggleSelection(state.pending.request, fairy.uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.ok([...player.front, ...player.back].some((card) => card.uid === fairy.uid));
  assert.equal(player.memory, 15);
});

test("STD-113 uses the same shared placement runtime at own turn start", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 }); const player = state.players.player;
  const sister = createCardInstance("STD-113", "player", 113011); const fairy = createCardInstance("STD-124", "player", 113012);
  fairy.cost = 2; player.front = [sister]; player.back = []; player.hand = [fairy]; player.deck = [createCardInstance("STD-020", "player", 113013)];
  state.turnNumber = 2;
  startTurn(state, "player");
  assert.equal(state.pending?.request?.continuation?.type, "runtime-action-selection");
  assert.deepEqual(state.pending.request.candidates, [fairy.uid]);
});

test("STD-114 grants Hacking before its declared attack resolves", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const attacker = createCardInstance("STD-114", "player", 114001);
  const ally = createCardInstance("STD-020", "player", 114002);
  attacker.summoningSick = false;
  player.front = [attacker, ally];
  player.back = [];
  state.players.ai.front = [];
  const before = state.players.ai.fortressStr;
  assert.equal(attack(state, "player", attacker.uid, "ai-fortress"), true);
  assert.equal(attacker.sleep, false);
  assert.deepEqual(state.pending.request.candidates, [ally.uid]);
  toggleSelection(state.pending.request, ally.uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.equal(cardHasKeyword(ally, "HACKING"), true);
  assert.equal(state.players.ai.fortressStr, before - 2);
});

test("STD-115 continuously encrypts own Electron Fairies", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const attacker = createCardInstance("STD-020", "player", 115001);
  attacker.summoningSick = false;
  const source = createCardInstance("STD-115", "ai", 115002);
  const fairy = createCardInstance("STD-124", "ai", 115003);
  fairy.sleep = true;
  state.players.player.front = [attacker];
  state.players.ai.front = [fairy];
  state.players.ai.back = [source];
  assert.deepEqual(getAttackTargets(state, "player", attacker).map((target) => target.uid), ["ai-fortress"]);
  state.players.ai.back = [];
  assert.ok(getAttackTargets(state, "player", attacker).some((target) => target.uid === fairy.uid));
});

test("STD-116 grants turn Hacking and resolves draw then one damage on user attack success", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const fairy = createCardInstance("STD-124", "player", 116001);
  const program = createCardInstance("STD-116", "player", 116002);
  const draw = createCardInstance("STD-020", "player", 116003);
  fairy.summoningSick = false;
  player.front = [fairy];
  player.back = [];
  player.hand = [program];
  player.deck = [draw];
  player.memory = 20;
  state.players.ai.front = [];
  assert.equal(playCard(state, "player", program.uid, { force: true, ignoreColor: true }), true);
  assert.equal(cardHasKeyword(fairy, "HACKING"), true);
  const handBefore = player.hand.length;
  const fortressBefore = state.players.ai.fortressStr;
  assert.equal(attack(state, "player", fairy.uid, "ai-fortress"), true);
  assert.equal(player.hand.length, handBefore + 1);
  assert.equal(state.players.ai.fortressStr, fortressBefore - cardAtk(state, "player", fairy) - 1);
});

test("Q5 batch 5 cards 117/119/120/122/123 compile completely", () => {
  for (const id of ["STD-117", "STD-119", "STD-120", "STD-122", "STD-123"]) {
    const compiled = compileEffectText(CARD_LIBRARY[id].text, { id, category: CARD_LIBRARY[id].category });
    assert.equal(compiled.status, "supported", id);
    assert.equal(compiled.warnings.length, 0, id);
  }
});

test("STD-117 applies its position grants and salvages before attack resolution", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const ai = state.players.ai;
  const attacker = createCardInstance("STD-117", "player", 117001);
  const salvage = createCardInstance("STD-149", "player", 117002);
  const security = createCardInstance("STD-100", "ai", 117003);
  attacker.summoningSick = false;
  security.sleep = true;
  player.front = [attacker];
  player.back = [];
  player.trash = [salvage];
  ai.front = [security];
  assert.equal(cardHasKeyword(state, "player", attacker, "HACKING"), true);
  assert.ok(getAttackTargets(state, "player", attacker).some((target) => target.type === "fortress"));
  const before = ai.fortressStr;
  assert.equal(attack(state, "player", attacker.uid, "ai-fortress"), true);
  assert.equal(attacker.sleep, false);
  toggleSelection(state.pending.request, salvage.uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.ok(player.hand.some((card) => card.uid === salvage.uid));
  assert.equal(ai.fortressStr, before - 5);

  attacker.sleep = false;
  player.front = [];
  player.back = [attacker];
  const blue = createCardInstance("STD-109", "player", 117004);
  blue.sleep = true;
  player.front = [blue];
  const enemyAttacker = createCardInstance("STD-020", "ai", 117005);
  enemyAttacker.summoningSick = false;
  ai.front = [enemyAttacker];
  assert.equal(getAttackTargets(state, "ai", enemyAttacker).some((target) => target.uid === blue.uid), false);
});

test("STD-119 and STD-120 use once-per-turn resident spell triggers", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const ai = state.players.ai;
  const sodom = createCardInstance("STD-119", "player", 119001);
  const gomorrah = createCardInstance("STD-120", "player", 120001);
  sodom.residentActive = true;
  gomorrah.residentActive = true;
  player.back = [sodom, gomorrah];
  const enemy = createCardInstance("STD-020", "ai", 119002);
  ai.front = [enemy];
  const trigger = createCardInstance("STD-149", "player", 119003);
  const recycled = createCardInstance("STD-110", "player", 120002);
  const slash = createCardInstance("STD-110", "player", 119004);
  player.hand = [trigger, slash];
  player.trash = [recycled];
  player.memory = 20;
  assert.equal(playCard(state, "player", slash.uid, { force: true, ignoreColor: true }), true);
  assert.equal(enemy.load, 1);
  assert.ok(state.pending);
  toggleSelection(state.pending.request, recycled.uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.ok(player.deck.some((card) => card.uid === recycled.uid));
  assert.equal(player.triggerUsage["STD-119:own-slash-sp-executed"], true);
  assert.equal(player.triggerUsage["STD-120:own-sp-executed"], true);
  startTurn(state, "ai");
  assert.deepEqual(player.triggerUsage, {});
});

test("STD-122 zero selection short-circuits and nonzero creates threshold ghosts", () => {
  const zero = createGame({ mode: "sandbox", rng: () => 0.5 });
  const zeroPlayer = zero.players.player;
  const zeroSpell = createCardInstance("STD-122", "player", 122001);
  const zeroFairy = createCardInstance("STD-124", "player", 122002);
  zeroPlayer.front = [zeroFairy];
  zeroPlayer.hand = [zeroSpell];
  zeroPlayer.memory = 20;
  assert.equal(playCard(zero, "player", zeroSpell.uid, { force: true, ignoreColor: true }), true);
  assert.equal(resolveCardSelection(zero, zero.pending.request.continuation, { selected: [] }), true);
  assert.equal([...zeroPlayer.front, ...zeroPlayer.back].some((card) => card.id === "STD-123"), false);

  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player;
  const spell = createCardInstance("STD-122", "player", 122101);
  const fairy = createCardInstance("STD-124", "player", 122102);
  const copy1 = createCardInstance("STD-124", "player", 122103);
  const copy2 = createCardInstance("STD-124", "player", 122104);
  player.front = [fairy];
  player.back = [];
  player.hand = [spell];
  player.trash = [copy1, copy2];
  player.memory = 20;
  assert.equal(playCard(state, "player", spell.uid, { force: true, ignoreColor: true }), true);
  toggleSelection(state.pending.request, fairy.uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  const ghosts = [...player.front, ...player.back].filter((card) => card.id === "STD-123");
  assert.equal(ghosts.length, 2);
  assert.ok(ghosts.every((ghost) => cardAtk(state, "player", ghost) === 6 && cardMaxStr(state, "player", ghost) === 6));
  assert.ok(ghosts.every((ghost) => cardHasKeyword(state, "player", ghost, "QA") && cardHasKeyword(state, "player", ghost, "HACKING")));
  assert.ok(ghosts.every((ghost) => canAttack(state, "player", ghost)));
});

test("Q5 batch 6 cards 127/129/130/131/132 compile completely", () => {
  for (const id of ["STD-127", "STD-129", "STD-130", "STD-131", "STD-132"]) {
    const compiled = compileEffectText(CARD_LIBRARY[id].text, { id, category: CARD_LIBRARY[id].category });
    assert.equal(compiled.status, "supported", id);
    assert.equal(compiled.warnings.length, 0, id);
  }
  assert.equal(cardHasKeyword(CARD_LIBRARY["STD-129"], "SECURITY"), true);
  assert.equal(cardHasKeyword(CARD_LIBRARY["STD-129"], "BACKUP"), true);
  assert.equal(cardHasKeyword(CARD_LIBRARY["STD-130"], "DECOY"), true);
});

test("STD-127 deals zero battle damage as attacker and defender", () => {
  const first = createGame({ mode: "sandbox" }); const p1 = first.players.player; const a1 = first.players.ai;
  const leo = createCardInstance("STD-127", "player", 127001); const enemy = createCardInstance("STD-026", "ai", 127002);
  leo.summoningSick = false; enemy.sleep = true; p1.front = [leo]; a1.front = [enemy];
  assert.equal(attack(first, "player", leo.uid, enemy.uid), true);
  assert.equal(enemy.damage, 0);
  const second = createGame({ mode: "sandbox" }); const p2 = second.players.player; const a2 = second.players.ai;
  const attacker = createCardInstance("STD-044", "player", 127003); const defender = createCardInstance("STD-127", "ai", 127004);
  attacker.summoningSick = false; defender.sleep = true; p2.front = [attacker]; a2.front = [defender];
  assert.equal(attack(second, "player", attacker.uid, defender.uid), true);
  assert.equal(attacker.damage, 0);
});

test("fixed and capped battle modifiers resolve after additive damage modifiers", () => {
  const fixedState = createGame({ mode: "sandbox" });
  const fixedPlayer = fixedState.players.player;
  const fixedAi = fixedState.players.ai;
  const leo = createCardInstance("STD-127", "player", 127101);
  const glen = createCardInstance("STD-087", "player", 127102);
  const fixedTarget = createCardInstance("STD-020", "ai", 127103);
  leo.summoningSick = false;
  fixedTarget.sleep = true;
  fixedPlayer.front = [leo];
  fixedPlayer.back = [glen];
  fixedAi.front = [fixedTarget];
  fixedAi.back = [];
  assert.equal(attack(fixedState, "player", leo.uid, fixedTarget.uid), true);
  assert.equal(fixedTarget.damage, 0);

  const cappedState = createGame({ mode: "sandbox" });
  const cappedPlayer = cappedState.players.player;
  const cappedAi = cappedState.players.ai;
  const strong = createCardInstance("STD-044", "player", 127104);
  const cappedTarget = createCardInstance("STD-020", "ai", 127105);
  strong.atk = 5;
  strong.summoningSick = false;
  cappedTarget.sleep = true;
  cappedTarget.damageModifiers = [{
    providerScope: "own_area", direction: "received", sourceFilter: "any", targetFilter: "provider",
    damageKind: "battle", destination: "card", operation: "cap_max", amount: 1, duration: "battle"
  }];
  cappedPlayer.front = [strong];
  cappedPlayer.back = [createCardInstance("STD-039", "player", 127106)];
  cappedAi.front = [cappedTarget];
  cappedAi.back = [];
  assert.equal(attack(cappedState, "player", strong.uid, cappedTarget.uid), true);
  assert.equal(cappedTarget.damage, 1);
  assert.equal(cappedTarget.damageModifiers.length, 0);

  const preventedState = createGame({ mode: "sandbox" });
  const preventedPlayer = preventedState.players.player;
  const preventedAi = preventedState.players.ai;
  const preventedAttacker = createCardInstance("STD-044", "player", 127107);
  const preventedTarget = createCardInstance("STD-020", "ai", 127108);
  preventedAttacker.atk = 5;
  preventedAttacker.summoningSick = false;
  preventedTarget.sleep = true;
  preventedTarget.damageModifiers = [{
    providerScope: "own_area", direction: "received", sourceFilter: "any", targetFilter: "provider",
    damageKind: "battle", destination: "card", operation: "set", amount: 0,
    duration: "turn", activeTurn: preventedState.turnNumber
  }];
  preventedPlayer.front = [preventedAttacker];
  preventedPlayer.back = [createCardInstance("STD-039", "player", 127109)];
  preventedAi.front = [preventedTarget];
  preventedAi.back = [];
  assert.equal(attack(preventedState, "player", preventedAttacker.uid, preventedTarget.uid), true);
  assert.equal(preventedTarget.damage, 0);
});

test("STD-130 gains battle-only STR from own NOM Ob", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player; const ai = state.players.ai;
  const attacker = createCardInstance("STD-044", "player", 130001); const isaac = createCardInstance("STD-130", "ai", 130002);
  const nom1 = createCardInstance("STD-026", "ai", 130003); const nom2 = createCardInstance("STD-028", "ai", 130004); const nom3 = createCardInstance("STD-029", "ai", 130005);
  nom1.classes = ["ナイツ・オブ・マキナ"]; nom2.classes = ["ナイツ・オブ・マキナ"]; nom3.classes = ["ナイツ・オブ・マキナ"];
  attacker.summoningSick = false; isaac.sleep = true; player.front = [attacker]; ai.front = [isaac]; ai.back = [nom1, nom2, nom3];
  assert.equal(cardMaxStr(state, "ai", isaac), 1);
  assert.equal(attack(state, "player", attacker.uid, isaac.uid), true);
  const logText = state.log.map((entry) => entry.text ?? entry).join("\n");
  assert.match(logText, /イサクへ3ダメージ、STR 5→2/);
  assert.doesNotMatch(logText, /戦闘: [^\n]*イサクを破壊/);
  // The battle-only STR ends after battle, so the remaining damage destroys it by rule.
  assert.match(logText, /STR0以下の状態判定: [^\n]*イサクを破壊/);
  assert.ok(ai.trash.some((card) => card.uid === isaac.uid));
});

test("STD-131 logout drags one Hanamori from hand for free", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  const source = createCardInstance("STD-131", "player", 131001); const copy = createCardInstance("STD-131", "player", 131002);
  player.front = [source]; player.back = []; player.hand = [copy]; player.memory = 3;
  assert.equal(relogCard(state, "player", source.uid, "back"), true);
  assert.equal(state.pending?.request?.continuation?.type, "runtime-action-selection");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [copy.uid] }), true);
  assert.equal(state.pending?.type, "access-drag-place");
  assert.equal(resolveAccessDragPlacement(state, "player", "front"), true);
  assert.ok(player.front.some((card) => card.uid === copy.uid));
  assert.equal(player.memory, 0);
});

test("destroying the opponent's Hanamori selects only its controller's hand and CPU finishes the drag", () => {
  const state = createGame({ mode: "ai" }); state.interactive = true;
  const ownCopy = createCardInstance("STD-131", "player", 131101);
  const enemySource = createCardInstance("STD-131", "ai", 131102);
  const enemyCopy = createCardInstance("STD-131", "ai", 131103);
  state.players.player.hand = [ownCopy];
  state.players.ai.front = [enemySource]; state.players.ai.hand = [enemyCopy];
  assert.equal(destroyCard(state, "ai", enemySource.uid, { source: "自分の攻撃" }), true);
  assert.equal(state.pending?.request?.continuation?.playerId, "ai");
  assert.deepEqual(state.pending?.request?.candidates, [enemyCopy.uid]);
  resolveAutomatedAiChoices(state);
  assert.equal(state.pending, null);
  assert.ok(state.players.ai.front.some((card) => card.uid === enemyCopy.uid));
  assert.deepEqual(state.players.player.hand.map((card) => card.uid), [ownCopy.uid]);
});

test("Hanamori logout with no own hand target finishes without a dead selection", () => {
  const state = createGame({ mode: "ai" }); state.interactive = true;
  const enemySource = createCardInstance("STD-131", "ai", 131201);
  const ownCopy = createCardInstance("STD-131", "player", 131202);
  state.players.ai.front = [enemySource]; state.players.ai.hand = [];
  state.players.player.hand = [ownCopy];
  assert.equal(destroyCard(state, "ai", enemySource.uid, { source: "自分の攻撃" }), true);
  assert.equal(state.pending, null);
  assert.equal(state.triggerThread?.status === "resolving", false);
  assert.deepEqual(state.players.player.hand.map((card) => card.uid), [ownCopy.uid]);
  assert.equal(state.players.ai.trash.some((card) => card.uid === enemySource.uid), true);
});

test("both Hanamori logouts finish after mutual battle destruction", () => {
  const state = createGame({ mode: "ai" }); state.interactive = true;
  const ownSource = createCardInstance("STD-131", "player", 131301);
  const enemySource = createCardInstance("STD-131", "ai", 131302);
  const ownCopy = createCardInstance("STD-131", "player", 131303);
  const enemyCopy = createCardInstance("STD-131", "ai", 131304);
  ownSource.damage = 2; ownSource.summoningSick = false;
  enemySource.damage = 2; enemySource.sleep = true;
  state.players.player.front = [ownSource]; state.players.player.hand = [ownCopy];
  state.players.ai.front = [enemySource]; state.players.ai.hand = [enemyCopy];
  assert.equal(attack(state, "player", ownSource.uid, enemySource.uid), true);
  assert.equal(state.pending?.type, "trigger-order");
  assert.equal(state.triggerThread?.currentControllerId, "player");
  const playerItem = state.triggerThread.items.find((item) => item.controllerId === "player" && item.status === "pending");
  assert.ok(playerItem);
  assert.equal(resolveTriggerChoice(state, playerItem.id), true);
  assert.equal(state.pending?.request?.continuation?.playerId, "player");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [ownCopy.uid] }), true);
  assert.equal(state.pending?.type, "access-drag-place");
  assert.equal(resolveAccessDragPlacement(state, "player", "front"), true);
  assert.equal(state.pending?.request?.continuation?.playerId, "ai");
  resolveAutomatedAiChoices(state);
  assert.equal(state.pending, null);
  assert.equal(state.triggerThread?.status === "resolving", false);
  assert.ok(state.players.player.front.some((card) => card.uid === ownCopy.uid));
  assert.ok(state.players.ai.front.some((card) => card.uid === enemyCopy.uid));
});

test("STD-132 is a cost-3 response with no additional effect", () => {
  const state = createGame({ mode: "lab" }); state.interactive = true; const player = state.players.player;
  const response = createCardInstance("STD-132", "player", 132001); player.hand = [response]; player.memory = 3;
  dealFortressDamage(state, "player", 1, "ai", "test");
  assert.equal(state.pending?.type, "response-window");
  assert.ok(state.pending.candidates.includes(response.uid));
  assert.equal(activateResponse(state, "player", response.uid), true);
  assert.equal(player.memory, 0);
  assert.ok(player.trash.some((card) => card.uid === response.uid));
});

test("Q5 batch 7 cards 135/136/148/151/152 compile completely", () => {
  for (const id of ["STD-135", "STD-136", "STD-148", "STD-151", "STD-152"]) {
    const compiled = compileEffectText(CARD_LIBRARY[id].text, { id, category: CARD_LIBRARY[id].category });
    assert.equal(compiled.status, "supported", id);
    assert.equal(compiled.warnings.length, 0, id);
  }
});

test("STD-135 revives to front at turn end only if it reached trash after Logout", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  player.front = []; player.back = []; player.hand = []; player.deck = [];
  const siege = createCardInstance("STD-135", "player", 135001); player.front = [siege]; player.memory = 6;
  assert.equal(relogCard(state, "player", siege.uid, "back"), true);
  assert.equal(destroyCard(state, "player", siege.uid, { source: "test", suppressReplacement: true }), true);
  assert.equal(endTurn(state, "player"), true);
  assert.ok(player.front.some((card) => card.uid === siege.uid));
  assert.ok(player.trash.every((card) => card.uid !== siege.uid));
});

test("STD-136 destroys another own Ob to standby and blocks the battled Ob next standby", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player; const ai = state.players.ai;
  const source = createCardInstance("STD-136", "player", 136001); const cost = createCardInstance("STD-026", "player", 136002); const defender = createCardInstance("STD-029", "ai", 136003);
  source.summoningSick = false; defender.sleep = true; player.front = [source, cost]; ai.front = [defender];
  assert.equal(attack(state, "player", source.uid, defender.uid), true);
  assert.equal(state.pending?.request?.continuation?.type, "hahanamori-standby");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [cost.uid] }), true);
  assert.equal(source.sleep, false);
  assert.equal(defender.skipStandby, true);
  startTurn(state, "ai");
  assert.equal(defender.sleep, true);
});

test("STD-148 arms only at opponent turn start and deals one when own Ob battles", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player; const ai = state.players.ai;
  const source = createCardInstance("STD-148", "player", 148001); source.residentActive = true;
  const defender = createCardInstance("STD-129", "player", 148002); const attacker = createCardInstance("STD-044", "ai", 148003);
  defender.sleep = true; attacker.summoningSick = false; player.back = [source]; player.front = [defender]; ai.front = [attacker];
  startTurn(state, "ai"); const before = ai.fortressStr;
  assert.equal(attack(state, "ai", attacker.uid, defender.uid), true);
  assert.equal(ai.fortressStr, before - 1);
});

test("STD-148 normal activation pays once and waits for a later opponent turn to arm", () => {
  const state = createGame({ mode: "lab" }); const player = state.players.player;
  const source = createCardInstance("STD-148", "player", 148011); source.faceDown = true;
  player.back = [source]; player.memory = 10; state.active = "player"; state.phase = "main";
  assert.equal(activateScript(state, "player", source.uid), true);
  assert.equal(player.memory, 8);
  assert.equal(source.residentActive, true);
  assert.equal(source.std148ArmedTurn, undefined);
  assert.equal(activateScript(state, "player", source.uid), false);
  assert.equal(player.memory, 8);
});

test("STD-148 opponent turn window arms that same turn and applies to an own Ob battle", () => {
  const state = createGame({ mode: "lab" }); const player = state.players.player; const ai = state.players.ai;
  const source = createCardInstance("STD-148", "player", 148021); source.faceDown = true;
  const defender = createCardInstance("STD-129", "player", 148022); defender.sleep = true;
  const attacker = createCardInstance("STD-044", "ai", 148023); attacker.summoningSick = false;
  player.back = [source]; player.front = [defender]; player.memory = 10; ai.front = [attacker];
  ai.deck = [createCardInstance("STD-020", "ai", 148024), createCardInstance("STD-021", "ai", 148025), createCardInstance("STD-022", "ai", 148026)];
  startTurn(state, "ai");
  assert.equal(state.prompt?.scriptUid, source.uid);
  const memoryBefore = player.memory;
  assert.equal(activateScript(state, "player", source.uid), true);
  assert.equal(player.memory, memoryBefore - 2);
  assert.equal(source.std148ArmedTurn, state.turnNumber);
  assert.equal(state.pending?.request?.continuation?.type, "std179-place");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { scope: "配置しない", selected: [] }), true);
  assert.equal(state.pending, null);
  const before = ai.fortressStr;
  assert.equal(attack(state, "ai", attacker.uid, defender.uid), true);
  assert.equal(ai.fortressStr, before - 1);
});

test("STD-148 preserves every eligible copy and declined hidden sources do not arm", () => {
  const state = createGame({ mode: "lab" }); const player = state.players.player; const ai = state.players.ai;
  const first = createCardInstance("STD-148", "player", 148031); const second = createCardInstance("STD-148", "player", 148032);
  const defender = createCardInstance("STD-129", "player", 148036); defender.sleep = true;
  const attacker = createCardInstance("STD-044", "ai", 148037); attacker.summoningSick = false;
  first.faceDown = true; second.faceDown = true; player.back = [first, second]; player.memory = 10;
  player.front = [defender]; ai.front = [attacker];
  ai.deck = [createCardInstance("STD-020", "ai", 148033), createCardInstance("STD-021", "ai", 148034), createCardInstance("STD-022", "ai", 148035)];
  startTurn(state, "ai");
  assert.equal(state.prompt?.scriptUid, first.uid);
  assert.deepEqual(state.scriptActivationQueue.map((entry) => entry.prompt.scriptUid), [second.uid]);
  assert.equal(declinePrompt(state), true);
  assert.equal(first.faceDown, true);
  assert.equal(first.std148ArmedTurn, undefined);
  assert.equal(state.prompt?.scriptUid, second.uid);
  assert.equal(declinePrompt(state), true);
  assert.equal(second.faceDown, true);
  assert.equal(second.std148ArmedTurn, undefined);
  assert.equal(player.memory, 10);
  const before = ai.fortressStr;
  assert.equal(attack(state, "ai", attacker.uid, defender.uid), true);
  assert.equal(ai.fortressStr, before);
});

test("STD-151 Logout randomly discards exactly one enemy hand card", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0 }); const player = state.players.player; const ai = state.players.ai;
  const source = createCardInstance("STD-151", "player", 151001); const first = createCardInstance("STD-026", "ai", 151002); const second = createCardInstance("STD-028", "ai", 151003);
  player.front = [source]; player.memory = 2; ai.hand = [first, second];
  assert.equal(relogCard(state, "player", source.uid, "back"), true);
  assert.equal(ai.hand.length, 1);
  assert.ok(ai.trash.some((card) => card.uid === first.uid));
});

test("STD-145 Logout raises both memory limit and current memory by one", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  const source = createCardInstance("STD-145", "player", 145001);
  player.front = [source]; player.memory = 10;
  const limitBefore = player.permanentMemory; const memoryBefore = player.memory;
  assert.equal(relogCard(state, "player", source.uid, "back"), true);
  assert.equal(player.permanentMemory, limitBefore + 1);
  assert.equal(player.memory, memoryBefore - source.cost + 1);
});

test("STD-150 Logout damages one random enemy Ob", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0 }); const player = state.players.player; const ai = state.players.ai;
  const source = createCardInstance("STD-150", "player", 150001);
  const first = createCardInstance("STD-028", "ai", 150002); const second = createCardInstance("STD-029", "ai", 150003);
  player.front = [source]; player.memory = 3; ai.front = [first, second];
  const firstBefore = first.damage; const secondBefore = second.damage;
  assert.equal(relogCard(state, "player", source.uid, "back"), true);
  assert.equal(first.damage, firstBefore + 1);
  assert.equal(second.damage, secondBefore);
});

test("STD-152 decodes printed-memory-two Ob and destroys it at current turn end", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  const source = createCardInstance("STD-152", "player", 152001); const target = createCardInstance("STD-020", "player", 152002);
  target.cost = 2; player.hand = [source]; player.trash = [target]; player.memory = 10; player.front = []; player.back = [];
  assert.equal(playCard(state, "player", source.uid, { zone: "back", force: true, ignoreColor: true }), true);
  assert.equal(state.pending?.request?.continuation?.type, "runtime-decode");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [target.uid] }), true);
  assert.equal(resolveAccessDragPlacement(state, "player", "front"), true);
  assert.ok(player.front.some((card) => card.uid === target.uid));
  assert.equal(endTurn(state, "player"), true);
  assert.ok(player.trash.some((card) => card.uid === target.uid));
});

test("STD-152 Update uses the shared decode gate before paying memory", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  const source = createCardInstance("STD-152", "player", 152011); const target = createCardInstance("STD-020", "player", 152012);
  source.compiled = compileEffectText(source.text, { id: source.id, category: source.category }); target.cost = 2;
  player.front = [source]; player.back = []; player.hand = []; player.trash = [target]; player.memory = 2;
  const effect = getActivatableEffects(state, "player", source).find((item) => item.kind === "update");
  assert.equal(activateCardEffect(state, "player", source.uid, effect.id), true);
  assert.equal(player.memory, 0);
  assert.equal(state.pending?.request?.continuation?.type, "runtime-decode");

  const blocked = createGame({ mode: "sandbox" }); const blockedPlayer = blocked.players.player;
  const blockedSource = createCardInstance("STD-152", "player", 152021);
  blockedSource.compiled = compileEffectText(blockedSource.text, { id: blockedSource.id, category: blockedSource.category });
  blockedPlayer.front = [blockedSource]; blockedPlayer.back = []; blockedPlayer.trash = []; blockedPlayer.memory = 2;
  const blockedEffect = getActivatableEffects(blocked, "player", blockedSource).find((item) => item.kind === "update");
  assert.equal(activateCardEffect(blocked, "player", blockedSource.uid, blockedEffect.id), false);
  assert.equal(blockedPlayer.memory, 2);
});

test("Q5 batch 8 cards 153/154/156/161/165 compile completely", () => {
  for (const id of ["STD-153", "STD-154", "STD-156", "STD-161", "STD-165"]) {
    const compiled = compileEffectText(CARD_LIBRARY[id].text, { id, category: CARD_LIBRARY[id].category });
    assert.equal(compiled.status, "supported", id);
    assert.equal(compiled.warnings.length, 0, id);
  }
});

test("STD-153 gives one selected enemy Ob Load two on Login and Logout", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player; const ai = state.players.ai;
  const source = createCardInstance("STD-153", "player", 153001); const target = createCardInstance("STD-026", "ai", 153002);
  player.hand = [source]; player.memory = 6; ai.front = [target];
  assert.equal(playCard(state, "player", source.uid, { zone: "front", force: true, ignoreColor: true }), true);
  assert.equal(state.pending?.request?.continuation?.type, "runtime-action-selection");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [target.uid] }), true);
  assert.equal(target.load, 2);
  assert.equal(relogCard(state, "player", source.uid, "back"), true);
  assert.equal(state.pending?.request?.continuation?.type, "runtime-action-selection");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [target.uid] }), true);
  assert.equal(target.load, 4);
});

test("STD-154 returns the same trashed UID sleeping at its next controller turn start", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  const source = createCardInstance("STD-154", "player", 154001); player.front = [source]; player.back = [];
  const dueOwnerTurnsTaken = player.turnsTaken + 1;
  assert.equal(destroyCard(state, "player", source.uid, { source: "test", suppressReplacement: true }), true);
  assert.deepEqual(state.delayedEffects.find((effect) => effect.cardUid === source.uid), {
    event: "turn_started", dueOwnerTurnsTaken, type: "move_source_from_trash",
    ownerId: "player", cardUid: source.uid, sourceName: source.name,
    destination: "choose_area", resetDamage: true, standby: false, sleep: true
  });
  startTurn(state, "ai");
  assert.ok(player.trash.some((card) => card.uid === source.uid));
  startTurn(state, "player");
  const revived = [...player.front, ...player.back].find((card) => card.uid === source.uid);
  assert.ok(revived);
  assert.equal(revived.sleep, true);
});

test("STD-156 Logout chooses heal or different-name memory-three decode", () => {
  const heal = createGame({ mode: "sandbox" }); const hp = heal.players.player; const hs = createCardInstance("STD-156", "player", 156001);
  hp.front = [hs]; hp.memory = 3; hp.fortressStr = 5;
  assert.equal(relogCard(heal, "player", hs.uid, "back"), true);
  assert.equal(heal.pending?.request?.continuation?.type, "runtime-effect-choice");
  assert.equal(resolveCardSelection(heal, heal.pending.request.continuation, { choice: "①自分ユーザーを3回復", selected: [] }), true);
  assert.equal(hp.fortressStr, 8);
  const decode = createGame({ mode: "sandbox" }); const dp = decode.players.player; const ds = createCardInstance("STD-156", "player", 156002); const target = createCardInstance("STD-020", "player", 156003);
  dp.front = [ds]; dp.memory = 3; dp.trash = [target];
  assert.equal(relogCard(decode, "player", ds.uid, "back"), true);
  assert.equal(resolveCardSelection(decode, decode.pending.request.continuation, { choice: "②名称の異なるメモリ3以下Obをデコード", selected: [] }), true);
  assert.equal(decode.pending?.request?.continuation?.type, "runtime-decode");
  assert.equal(resolveCardSelection(decode, decode.pending.request.continuation, { selected: [target.uid] }), true);
  assert.equal(resolveAccessDragPlacement(decode, "player", "front"), true);
  assert.ok(dp.front.some((card) => card.uid === target.uid));
});

test("STD-161 sums one d6 per Madness counter immediately and at controller turn start", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.999 }); const player = state.players.player; const ai = state.players.ai;
  const cthulhu = createCardInstance("STD-160", "player", 161001); const victim = createCardInstance("STD-020", "ai", 161002);
  player.hand = [cthulhu]; player.memory = 20; ai.front = [victim];
  assert.equal(playCard(state, "player", cthulhu.uid, { zone: "front", force: true, ignoreColor: true }), true);
  assert.ok(ai.ban.some((card) => card.uid === victim.uid));
  const survivor = createCardInstance("STD-029", "ai", 161003); survivor.counters ??= {}; survivor.counters.madness = 3; survivor.str = 10; ai.front = [survivor];
  startTurn(state, "ai");
  assert.ok(ai.front.some((card) => card.uid === survivor.uid));
});

test("STD-165 destroys itself on fourth destruction and free-logs an Old Ruler", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player; const ai = state.players.ai;
  const source = createCardInstance("STD-165", "player", 165001); source.residentActive = true;
  const ruler = createCardInstance("STD-160", "player", 165002); player.back = [source]; player.hand = [ruler]; ai.back = [];
  const victims = [0, 1, 2, 3].map((i) => createCardInstance("STD-020", "ai", 165010 + i)); ai.front = victims;
  for (const victim of [...victims]) assert.equal(destroyCard(state, "ai", victim.uid, { source: "test", suppressReplacement: true }), true);
  assert.equal(state.pending?.request?.continuation?.type, "std165-login");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [ruler.uid] }), true);
  assert.ok([...player.front, ...player.back].some((card) => card.uid === ruler.uid));
  assert.ok(player.trash.some((card) => card.uid === source.uid));
});

test("STD-165 destroys its resident source even when no Old Ruler can be logged in", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player; const ai = state.players.ai;
  const source = createCardInstance("STD-165", "player", 165011); source.residentActive = true;
  player.back = [source]; player.hand = []; ai.back = [];
  const victims = [0, 1, 2, 3].map((index) => createCardInstance("STD-020", "ai", 165012 + index)); ai.front = victims;
  for (const victim of [...victims]) assert.equal(destroyCard(state, "ai", victim.uid, { source: "test", suppressReplacement: true }), true);
  assert.equal(state.pending, null);
  assert.ok(player.trash.some((card) => card.uid === source.uid));
});

test("STD-165 can trigger again for a new resident on the fifth destruction of the same turn", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player; const ai = state.players.ai;
  const firstSource = createCardInstance("STD-165", "player", 165021); firstSource.residentActive = true;
  const firstRuler = createCardInstance("STD-160", "player", 165022); player.back = [firstSource]; player.hand = [firstRuler]; ai.back = [];
  const victims = [0, 1, 2, 3].map((index) => createCardInstance("STD-020", "ai", 165030 + index)); ai.front = victims;
  for (const victim of [...victims]) assert.equal(destroyCard(state, "ai", victim.uid, { source: "test", suppressReplacement: true }), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [firstRuler.uid] }), true);
  const nextSource = createCardInstance("STD-165", "player", 165041); nextSource.residentActive = true;
  const nextRuler = createCardInstance("STD-160", "player", 165042); player.back.push(nextSource); player.hand.push(nextRuler);
  const fifth = createCardInstance("STD-020", "ai", 165043); ai.front.push(fifth);
  assert.equal(destroyCard(state, "ai", fifth.uid, { source: "test", suppressReplacement: true }), true);
  assert.equal(state.pending?.request?.continuation?.type, "std165-login");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [nextRuler.uid] }), true);
  assert.ok(player.trash.some((card) => card.uid === nextSource.uid));
});

test("STD-165 resolves every resident copy in active-player order without destroying later sources early", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player; const ai = state.players.ai;
  const playerSources = [createCardInstance("STD-165", "player", 165101), createCardInstance("STD-165", "player", 165102)];
  const aiSources = [createCardInstance("STD-165", "ai", 165103), createCardInstance("STD-165", "ai", 165104)];
  for (const source of [...playerSources, ...aiSources]) source.residentActive = true;
  const playerRulers = [createCardInstance("STD-160", "player", 165111), createCardInstance("STD-160", "player", 165112)];
  const aiRulers = [createCardInstance("STD-160", "ai", 165113), createCardInstance("STD-160", "ai", 165114)];
  const sourceUids = [...playerSources, ...aiSources].map((source) => source.uid);
  const rulerUids = [...playerRulers, ...aiRulers].map((ruler) => ruler.uid);
  player.back = playerSources; ai.back = aiSources; player.hand = playerRulers; ai.hand = aiRulers;
  const victims = [0, 1, 2, 3].map((index) => createCardInstance("STD-020", "ai", 165120 + index)); ai.front = victims;
  for (const victim of [...victims]) assert.equal(destroyCard(state, "ai", victim.uid, { source: "test", suppressReplacement: true }), true);
  assert.equal(state.pending?.request?.continuation?.type, "std165-login");
  assert.ok(player.trash.some((card) => card.uid === sourceUids[0]));
  assert.ok(player.back.some((card) => card.uid === sourceUids[1]));
  assert.ok(ai.back.every((card) => sourceUids.includes(card.uid)));
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [rulerUids[0]] }), true);
  assert.equal(state.pending?.request?.continuation?.playerId, "ai");
  assert.ok(ai.trash.some((card) => card.uid === sourceUids[2]));
  assert.ok(ai.back.some((card) => card.uid === sourceUids[3]));
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [rulerUids[2]] }), true);
  assert.equal(state.pending?.request?.continuation?.playerId, "player");
  assert.ok(player.trash.some((card) => card.uid === sourceUids[1]));
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [rulerUids[1]] }), true);
  assert.equal(state.pending?.request?.continuation?.playerId, "ai");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [rulerUids[3]] }), true);
  assert.equal(state.pending, null);
  assert.ok(sourceUids.every((uid) => [...player.trash, ...ai.trash].some((card) => card.uid === uid)));
  assert.ok(rulerUids.every((uid) => ![...player.hand, ...ai.hand].some((card) => card.uid === uid)));
});

test("Q5 batch 9 cards 166/168/170/172/175 compile completely", () => {
  for (const id of ["STD-166", "STD-168", "STD-170", "STD-172", "STD-175"]) {
    const compiled = compileEffectText(CARD_LIBRARY[id].text, { id, category: CARD_LIBRARY[id].category });
    assert.equal(compiled.status, "supported", id);
    assert.equal(compiled.warnings.length, 0, id);
  }
});

test("STD-166 adds one Madness counter only with an own Old Ruler Ob", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0 }); const player = state.players.player; const ai = state.players.ai;
  const ruler = createCardInstance("STD-160", "player", 166001); const spell = createCardInstance("STD-166", "player", 166002);
  player.front = [ruler]; player.hand = [spell]; player.memory = 10; ai.counters = {};
  assert.equal(playCard(state, "player", spell.uid, { force: true, ignoreColor: true }), true);
  assert.equal(ai.counters.madness, 1);
});

test("STD-168 triggers for each destroyed Ob and can give Load to a user", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player; const ai = state.players.ai;
  const source = createCardInstance("STD-168", "player", 168001); source.residentActive = true;
  const victim = createCardInstance("STD-020", "ai", 168002); player.back = [source]; ai.front = [victim];
  const before = ai.fortressStr;
  assert.equal(destroyCard(state, "ai", victim.uid, { source: "test", suppressReplacement: true }), true);
  assert.equal(state.pending?.request?.continuation?.type, "trigger-selected-entity-action");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: ["ai-fortress"] }), true);
  assert.equal(ai.load, 1);
  assert.equal(ai.fortressStr, before - 1);
});

test("STD-170 Update four randomly generates and places one listed card", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0 }); const player = state.players.player;
  const source = createCardInstance("STD-170", "player", 170001); source.compiled = compileEffectText(source.text, { id: source.id, category: source.category }); player.front = [source]; player.back = []; player.memory = 4;
  const effect = getActivatableEffects(state, "player", source).find((item) => item.kind === "update");
  assert.ok(effect?.enabled);
  assert.equal(activateCardEffect(state, "player", source.uid, effect.id), true);
  assert.equal(player.memory, 0);
  assert.ok(player.back.some((card) => card.id === "STD-165" && card.faceDown && !card.residentActive));
});

test("STD-172 Logout randomly BANs one card from each hand-or-area pool", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0 }); const player = state.players.player; const ai = state.players.ai;
  const source = createCardInstance("STD-172", "player", 172001); const own = createCardInstance("STD-020", "player", 172002); const enemy = createCardInstance("STD-020", "ai", 172003);
  player.front = [source]; player.hand = [own]; player.memory = 1; ai.hand = [enemy]; ai.front = [];
  assert.equal(relogCard(state, "player", source.uid, "back"), true);
  assert.ok(player.ban.some((card) => card.uid === own.uid));
  assert.ok(ai.ban.some((card) => card.uid === enemy.uid));
});

test("STD-225 destroys any selected registry count and recovers that much memory", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  const source = createCardInstance("STD-225", "player", 225001); const first = createCardInstance("STD-020", "player", 225002); const second = createCardInstance("STD-021", "player", 225003);
  player.hand = [source]; player.front = []; player.back = []; player.registry = [first, second]; player.memory = 0; state.players.ai.back = [];
  assert.equal(playCard(state, "player", source.uid, { force: true, free: true, ignoreColor: true }), true);
  assert.equal(state.pending?.request?.continuation?.type, "runtime-action-selection");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [first.uid, second.uid] }), true);
  assert.equal(player.registry.length, 0);
  assert.ok(player.trash.some((card) => card.uid === first.uid));
  assert.ok(player.trash.some((card) => card.uid === second.uid));
  assert.equal(player.memory, 2);
});

test("STD-175 salvages one own Script whenever an Insect is destroyed", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player; const ai = state.players.ai;
  const source = createCardInstance("STD-175", "player", 175001); const insect = createCardInstance("STD-020", "ai", 175002); const script = createCardInstance("STD-168", "player", 175003);
  insect.sourceSheet = "インセクト"; player.front = [source]; player.trash = [script]; ai.front = [insect];
  assert.equal(destroyCard(state, "ai", insect.uid, { source: "test", suppressReplacement: true }), true);
  assert.equal(state.pending?.request?.continuation?.type, "runtime-action-selection");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [script.uid] }), true);
  assert.ok(player.hand.some((card) => card.uid === script.uid));
});

test("automatic selection triggers retain later windows instead of overwriting them", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player; const ai = state.players.ai;
  const poison = createCardInstance("STD-168", "player", 175101); poison.residentActive = true;
  const pupa = createCardInstance("STD-175", "player", 175102);
  const insect = createCardInstance("STD-020", "ai", 175103); insect.sourceSheet = "インセクト";
  const script = createCardInstance("STD-176", "player", 175104);
  player.front = [pupa]; player.back = [poison]; player.trash = [script];
  ai.front = [insect]; ai.back = []; ai.hand = [];
  assert.equal(destroyCard(state, "ai", insect.uid, { source: "test", suppressReplacement: true }), true);
  assert.equal(state.pending?.request?.continuation?.type, "runtime-action-selection");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [script.uid] }), true);
  assert.equal(state.pending?.request?.continuation?.type, "trigger-selected-entity-action");
  assert.equal(state.triggerQueue.length, 0);
});

test("Q5 batch 10 cards 176/179/181/182/184 compile completely", () => {
  for (const id of ["STD-176", "STD-179", "STD-181", "STD-182", "STD-184"]) {
    const compiled = compileEffectText(CARD_LIBRARY[id].text, { id, category: CARD_LIBRARY[id].category });
    assert.equal(compiled.status, "supported", id);
    assert.equal(compiled.warnings.length, 0, id);
  }
});

test("STD-176 activates at enemy turn start and grants Slash through next turn end", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  const script = createCardInstance("STD-176", "player", 176001); const ob = createCardInstance("STD-020", "player", 176002);
  script.faceDown = true; player.back = [script]; player.front = [ob]; player.registry = [createCardInstance("STD-175", "player", 176003)]; player.memory = 0;
  startTurn(state, "ai");
  assert.equal(state.prompt?.scriptUid, script.uid);
  assert.equal(activateScript(state, "player", script.uid), true);
  assert.equal(cardHasKeyword(state, "player", ob, "SLASH"), true);
  const finishTurn = () => { if (!endTurn(state)) assert.equal(endTurn(state), true); };
  finishTurn();
  assert.equal(cardHasKeyword(state, "player", ob, "SLASH"), true);
  finishTurn();
  assert.equal(cardHasKeyword(state, "player", ob, "SLASH"), false);
});

test("STD-179 may place each hand copy after its controller activates a Script", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  const script = createCardInstance("STD-168", "player", 179001); const hopper = createCardInstance("STD-179", "player", 179002);
  script.faceDown = true; player.back = [script]; player.hand = [hopper]; player.registry = [createCardInstance("STD-166", "player", 179003)]; player.memory = 3;
  assert.equal(activateScript(state, "player", script.uid), true);
  assert.equal(state.pending?.request?.continuation?.type, "std179-place");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { scope: "配置する", selected: [] }), true);
  assert.ok([...player.front, ...player.back].some((card) => card.uid === hopper.uid));
});

test("STD-181 can attack only on a turn where its controller activated a Script", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  const beetle = createCardInstance("STD-181", "player", 181001); const script = createCardInstance("STD-168", "player", 181002);
  beetle.summoningSick = false; script.faceDown = true; player.front = [beetle]; player.back = [script]; player.registry = [createCardInstance("STD-166", "player", 181003)]; player.memory = 3;
  assert.equal(canAttack(state, "player", beetle), false);
  assert.equal(activateScript(state, "player", script.uid), true);
  assert.equal(canAttack(state, "player", beetle), true);
});

test("STD-182 sets a setup-memory-two Script on Login and activates a low-cost Script on attack", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  const source = createCardInstance("STD-182", "player", 182001); const setTarget = createCardInstance("STD-168", "player", 182002);
  setTarget.setupCost = 2; setTarget.activationCost = 1; player.hand = [source, setTarget]; player.registry = [createCardInstance("STD-166", "player", 182003)]; player.memory = 10; player.front = []; player.back = [];
  assert.equal(playCard(state, "player", source.uid, { force: true, ignoreColor: true }), true);
  assert.equal(state.pending?.request?.continuation?.type, "runtime-action-selection");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [setTarget.uid] }), true);
  assert.ok(player.back.some((card) => card.uid === setTarget.uid && card.faceDown));
  source.summoningSick = false; source.sleep = false;
  assert.equal(attack(state, "player", source.uid, "ai-fortress"), true);
  assert.equal(state.pending?.request?.continuation?.type, "std182-attack-script");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [setTarget.uid] }), true);
  assert.ok(player.back.some((card) => card.uid === setTarget.uid && card.residentActive));
  assert.equal(source.attackedThisTurn, true);
});

test("STD-213 moves one selected hand card face-down to registry then draws one", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  const source = createCardInstance("STD-213", "player", 213001); const hidden = createCardInstance("STD-020", "player", 213002); const drawn = createCardInstance("STD-021", "player", 213003);
  player.hand = [source, hidden]; player.deck = [drawn]; player.front = []; player.back = []; player.registry = []; player.memory = 20;
  assert.equal(playCard(state, "player", source.uid, { force: true, ignoreColor: true }), true);
  assert.equal(state.pending?.request?.continuation?.type, "runtime-action-selection");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [hidden.uid] }), true);
  assert.ok(player.registry.some((card) => card.uid === hidden.uid && card.faceDown));
  assert.ok(player.hand.some((card) => card.uid === drawn.uid));
});

test("STD-236 installs exactly two selected deck cards and cannot reduce the requirement", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 }); const player = state.players.player;
  const source = createCardInstance("STD-236", "player", 236001); const first = createCardInstance("STD-020", "player", 236002); const second = createCardInstance("STD-021", "player", 236003);
  player.hand = [source]; player.deck = [first, second]; player.front = []; player.back = []; player.registry = []; player.memory = 20;
  assert.equal(playCard(state, "player", source.uid, { force: true, ignoreColor: true }), true);
  assert.equal(state.pending?.request?.mode, "exact");
  assert.equal(state.pending?.request?.minimum, 2);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [first.uid] }), false);
  assert.equal(player.registry.length, 0);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [first.uid, second.uid] }), true);
  assert.deepEqual(player.registry.map((card) => card.uid).sort(), [first.uid, second.uid].sort());
  assert.equal(player.deck.length, 0);

  const insufficient = createGame({ mode: "sandbox" }); const shortPlayer = insufficient.players.player;
  const shortSource = createCardInstance("STD-236", "player", 236011); const only = createCardInstance("STD-020", "player", 236012);
  shortPlayer.hand = [shortSource]; shortPlayer.deck = [only]; shortPlayer.front = []; shortPlayer.back = []; shortPlayer.registry = []; shortPlayer.memory = 20;
  assert.equal(playCard(insufficient, "player", shortSource.uid, { force: true, ignoreColor: true }), true);
  assert.equal(insufficient.pending, null);
  assert.deepEqual(shortPlayer.deck.map((card) => card.uid), [only.uid]);
  assert.equal(shortPlayer.registry.length, 0);
});

test("STD-184 sets as a 3-0 Script and may become an Ob on an Ob Login", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  const cicada = createCardInstance("STD-184", "player", 184001); const login = createCardInstance("STD-020", "player", 184002);
  player.hand = [cicada, login]; player.front = []; player.back = []; player.memory = 10;
  assert.equal(playCard(state, "player", cicada.uid, { asScript: true, zone: "back", ignoreColor: true }), true);
  assert.equal(player.memory, 7);
  assert.ok(player.back.some((card) => card.uid === cicada.uid && card.category === "Script" && card.faceDown));
  assert.equal(playCard(state, "player", login.uid, { force: true, ignoreColor: true }), true);
  assert.equal(state.pending?.request?.continuation?.type, "std184-place-ob");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { scope: "Obとして配置する", selected: [] }), true);
  assert.ok([...player.front, ...player.back].some((card) => card.uid === cicada.uid && card.category === "Ob" && !card.faceDown));
});

test("Q5 final 15 cards compile completely", () => {
  const ids = ["STD-185", "STD-214", "STD-215", "STD-216", "STD-217", "STD-220", "STD-222", "STD-226", "STD-228", "STD-229", "STD-230", "STD-231", "STD-234", "STD-235", "STD-237"];
  for (const id of ids) {
    const compiled = compileEffectText(CARD_LIBRARY[id].text, { id, category: CARD_LIBRARY[id].category });
    assert.equal(compiled.status, "supported", id);
    assert.equal(compiled.warnings.length, 0, id);
  }
});

test("STD-211 compiles its selected own-area class destruction and actual-count draw", () => {
  const card = CARD_LIBRARY["STD-211"];
  const compiled = compileEffectText(card.text, { id: card.id, category: card.category });
  const operation = compiled.operations.find((item) => item.type === "select_own_area_class_destroy_then_draw");
  assert.equal(compiled.status, "supported");
  assert.deepEqual(compiled.warnings, []);
  assert.deepEqual(operation, {
    type: "select_own_area_class_destroy_then_draw",
    selection: { source: "own_area", selector: "class", count: 1 },
    destroy: { target: "selected_own_area_class", all: true, recordAs: "destroyed_count" },
    followUp: { type: "draw", valueFrom: "destroyed_count", zeroShortCircuit: true }
  });
});

test("runtime-connected compiler coverage batch has no residual clauses", () => {
  const ids = ["STD-124", "STD-159", "STD-174", "STD-186", "STD-208", "STD-219", "SZTB-098", "SZTB-101", "SZTB-102"];
  for (const id of ids) {
    const card = CARD_LIBRARY[id];
    const compiled = compileEffectText(card.text, { id, category: card.category });
    assert.equal(compiled.status, "supported", id);
    assert.deepEqual(compiled.warnings, [], id);
  }
});

test("STD-185 substitutes for a defending Insect and STD-214 pays its registry attack cost", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player; const ai = state.players.ai;
  player.hand = []; ai.hand = []; player.front = [createCardInstance("STD-214", "player", 214001)];
  const attacker = player.front[0]; attacker.summoningSick = false; player.registry = [createCardInstance("STD-020", "player", 214002)]; player.memory = 10;
  assert.equal(attack(state, "player", attacker.uid, "ai-fortress"), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [player.registry[0].uid] }), true);
  assert.equal(attacker.attackedThisTurn, true);
  const enemy = createCardInstance("STD-020", "ai", 185001); enemy.summoningSick = false;
  const insect = createCardInstance("STD-214", "player", 185002); insect.sleep = true;
  const general = createCardInstance("STD-185", "player", 185003); general.summoningSick = false;
  state.active = "ai"; ai.front = [enemy]; player.front = [insect, general];
  assert.equal(attack(state, "ai", enemy.uid, insect.uid), true);
  assert.equal(state.pending.request.continuation.type, "std185-defender-substitute");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { scope: "クワガタ将軍と戦闘", selected: [] }), true);
  assert.equal(enemy.attackedThisTurn, true);
});

test("STD-185 may substitute for an attacking Insect after its declaration costs", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player; const ai = state.players.ai;
  player.hand = []; ai.hand = []; player.memory = 10;
  const insect = createCardInstance("STD-214", "player", 185101); insect.summoningSick = false;
  const general = createCardInstance("STD-185", "player", 185102); general.summoningSick = false;
  const registry = createCardInstance("STD-020", "player", 185103);
  player.front = [insect, general]; player.registry = [registry]; ai.front = [];
  assert.equal(attack(state, "player", insect.uid, "ai-fortress"), true);
  assert.equal(state.pending.request.continuation.type, "std214-attack-cost");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [registry.uid] }), true);
  assert.equal(state.pending.request.continuation.type, "std185-attacker-substitute");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { scope: "クワガタ将軍と戦闘", selected: [] }), true);
  assert.equal(general.attackedThisTurn, true);
  assert.equal(general.sleep, true);
  assert.equal(insect.attackedThisTurn, false);
});

test("STD-215/216/217/220 connect registry execution install and leave events", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player; const ai = state.players.ai;
  player.hand = []; ai.hand = []; player.front = []; player.back = []; player.registry = []; player.memory = 20;
  const cydra = createCardInstance("STD-215", "player", 215001); player.registry = [cydra];
  assert.equal(executeRegistryCard(state, "player", cydra.uid, { zone: "front" }), true);
  assert.ok(player.front.some((card) => card.uid === cydra.uid));
  assert.equal(relogCard(state, "player", cydra.uid, "back"), true);
  assert.ok(player.registry.some((card) => card.uid === cydra.uid));
  const soldier = createCardInstance("STD-216", "player", 216001); const top = createCardInstance("STD-020", "player", 216002);
  player.hand = [soldier]; player.deck = [top];
  assert.equal(playCard(state, "player", soldier.uid, { force: true, ignoreColor: true }), true);
  assert.ok(player.registry.some((card) => card.uid === top.uid));
  const holy = createCardInstance("STD-217", "player", 217001); player.front.push(holy);
  const before = ai.fortressStr; assert.equal(recoverRegistryCard(state, "player", top.uid), true); assert.equal(ai.fortressStr, before - 1);
  const fighter = createCardInstance("STD-220", "player", 220001); player.registry.push(fighter); player.registryActionUsed = false;
  assert.equal(executeRegistryCard(state, "player", fighter.uid, { zone: "front" }), true);
  assert.equal(getAttackTargets(state, "player", fighter).some((target) => target.type === "fortress"), false);
});

test("STD-222/226/228 connect mass install compression and random enemy placement", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0 }); const player = state.players.player; const ai = state.players.ai;
  player.hand = []; ai.hand = []; player.front = []; player.back = []; player.registry = [createCardInstance("STD-214", "player", 222000)]; player.deck = [createCardInstance("STD-020", "player", 222010), createCardInstance("STD-021", "player", 222011)]; player.memory = 20;
  const jump = createCardInstance("STD-222", "player", 222001); const a = createCardInstance("STD-020", "player", 222002); const b = createCardInstance("STD-021", "player", 222003); player.hand = [jump, a, b];
  assert.equal(playCard(state, "player", jump.uid, { force: true, ignoreColor: true }), true);
  assert.ok(player.registry.some((card) => card.uid === a.uid)); assert.ok(player.registry.some((card) => card.uid === b.uid));
  const baris = createCardInstance("STD-226", "player", 226001); player.front = [baris]; const enemyInstall = createCardInstance("STD-020", "ai", 226002); ai.hand = [enemyInstall]; ai.registryActionUsed = false; state.active = "ai";
  assert.equal(installCard(state, "ai", enemyInstall.uid), true);
  assert.equal(state.pending.request.continuation.type, "std226-compress");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [enemyInstall.uid] }), true);
  assert.equal(enemyInstall.faceDown, true); assert.equal(baris.sleep, true);
  const hiddenState = createGame({ mode: "sandbox" }); const hiddenPlayer = hiddenState.players.player; const hiddenAi = hiddenState.players.ai;
  const hiddenBaris = createCardInstance("STD-226", "player", 226011); const alreadyCompressed = createCardInstance("STD-020", "ai", 226012); const hiddenInstall = createCardInstance("STD-021", "ai", 226013);
  alreadyCompressed.faceDown = true; hiddenPlayer.front = [hiddenBaris]; hiddenAi.registry = [alreadyCompressed]; hiddenAi.hand = [hiddenInstall]; hiddenState.active = "ai";
  assert.equal(installCard(hiddenState, "ai", hiddenInstall.uid), true);
  assert.deepEqual(hiddenState.pending?.validTargets, [hiddenInstall.uid]);
  assert.equal(resolveCardSelection(hiddenState, hiddenState.pending.request.continuation, { selected: [] }), true);
  assert.equal(alreadyCompressed.faceDown, true); assert.equal(hiddenBaris.sleep, false);
  state.active = "player"; const proof = createCardInstance("STD-228", "player", 228001); proof.compiled = compileEffectText(proof.text, { id: proof.id, category: proof.category }); player.front = [proof]; player.memory = 10; ai.front = []; ai.back = [];
  const effect = getActivatableEffects(state, "player", proof).find((item) => item.kind === "update");
  assert.equal(activateCardEffect(state, "player", proof.uid, effect.id), true);
  assert.ok([...ai.front, ...ai.back].some((card) => card.uid === proof.uid));
});

test("STD-229/230/231 connect extra turn Ambush and adjacent generation", () => {
  const extra = createGame({ mode: "sandbox" }); const ep = extra.players.player; ep.hand = []; ep.memory = 20; ep.registry = Array.from({ length: 5 }, (_, i) => createCardInstance("STD-020", "player", 229010 + i));
  const conquest = createCardInstance("STD-229", "player", 229001); ep.hand = [conquest];
  assert.equal(playCard(extra, "player", conquest.uid, { force: true, ignoreColor: true }), true);
  assert.equal(resolveCardSelection(extra, extra.pending.request.continuation, { selected: ep.registry.map((card) => card.uid) }), true);
  assert.equal(extra.extraTurnPlayerId, "player");
  const ambushState = createGame({ mode: "sandbox", rng: () => 0 }); const p = ambushState.players.player; const ai = ambushState.players.ai;
  const ambush = createCardInstance("STD-230", "player", 230001); const attacker = createCardInstance("STD-020", "ai", 230002); attacker.summoningSick = false;
  p.hand = []; p.memory = 3; p.registry = [ambush, createCardInstance("STD-214", "player", 230005), createCardInstance("STD-020", "player", 230006)]; ai.hand = [createCardInstance("STD-020", "ai", 230003), createCardInstance("STD-021", "ai", 230004)]; ai.front = [attacker]; ambushState.active = "ai";
  assert.equal(attack(ambushState, "ai", attacker.uid, "player-fortress"), true);
  assert.equal(resolveCardSelection(ambushState, ambushState.pending.request.continuation, { scope: "[アンブッシュ:3]を起動", selected: [] }), true);
  assert.equal(resolveCardSelection(ambushState, ambushState.pending.request.continuation, { selected: [ai.hand[0].uid] }), true);
  assert.equal(p.registry.length, 4);
  const scriptState = createGame({ mode: "sandbox" }); const sp = scriptState.players.player; const sai = scriptState.players.ai;
  const script = createCardInstance("STD-231", "player", 231001); script.faceDown = true; sp.back = [script]; sp.registry = [createCardInstance("STD-214", "player", 231003)]; sp.memory = 3; const ob = createCardInstance("STD-020", "ai", 231002); sai.hand = [ob]; sai.front = []; scriptState.active = "ai";
  assert.equal(playCard(scriptState, "ai", ob.uid, { force: true, ignoreColor: true }), true);
  assert.equal(scriptState.prompt?.scriptUid, script.uid);
  assert.equal(activateScript(scriptState, "player", script.uid), true);
  assert.ok(sai.front.some((card) => card.id === "STD-228"));
});

test("STD-230 Ambush requires a face-up registry source and registry count at least its memory", () => {
  const createScenario = ({ sourceZone, sourceFaceDown = false, registrySupport = 0 }) => {
    const state = createGame({ mode: "sandbox" }); const player = state.players.player; const ai = state.players.ai;
    const source = createCardInstance("STD-230", "player", 230101); const attacker = createCardInstance("STD-020", "ai", 230102); attacker.summoningSick = false;
    source.faceDown = sourceFaceDown;
    player.memory = 3; player.hand = sourceZone === "hand" ? [source] : [];
    player.registry = [ ...(sourceZone === "registry" ? [source] : []), ...Array.from({ length: registrySupport }, (_, index) => createCardInstance("STD-020", "player", 230110 + index)) ];
    ai.hand = [createCardInstance("STD-021", "ai", 230120), createCardInstance("STD-022", "ai", 230121)]; ai.front = [attacker]; state.active = "ai";
    return { state, source, attacker };
  };
  for (const scenario of [
    createScenario({ sourceZone: "hand", registrySupport: 3 }),
    createScenario({ sourceZone: "registry", registrySupport: 1 }),
    createScenario({ sourceZone: "registry", sourceFaceDown: true, registrySupport: 2 })
  ]) {
    assert.equal(attack(scenario.state, "ai", scenario.attacker.uid, "player-fortress"), true);
    assert.equal(scenario.state.pending, null);
  }
  const valid = createScenario({ sourceZone: "registry", registrySupport: 2 });
  assert.equal(attack(valid.state, "ai", valid.attacker.uid, "player-fortress"), true);
  assert.equal(valid.state.pending?.request?.continuation?.type, "std230-ambush-choice");
});

test("STD-230 Ambush rechecks its registry threshold when the response is accepted", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player; const ai = state.players.ai;
  const source = createCardInstance("STD-230", "player", 230201); const support = [createCardInstance("STD-020", "player", 230202), createCardInstance("STD-021", "player", 230203)];
  const attacker = createCardInstance("STD-020", "ai", 230204); attacker.summoningSick = false;
  player.memory = 3; player.registry = [source, ...support]; ai.hand = [createCardInstance("STD-022", "ai", 230205)]; ai.front = [attacker]; state.active = "ai";
  assert.equal(attack(state, "ai", attacker.uid, "player-fortress"), true);
  player.registry.pop();
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { scope: "[アンブッシュ:3]を起動", selected: [] }), true);
  assert.equal(player.memory, 3);
  assert.ok(player.registry.includes(source));
  assert.equal(state.pending, null);
});

test("STD-230 Ambush removes its source after both installs and waits for a trash Script window", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0 }); const player = state.players.player; const ai = state.players.ai;
  const source = createCardInstance("STD-230", "player", 230301); const attacker = createCardInstance("STD-020", "ai", 230302); attacker.summoningSick = false;
  const blocker = createCardInstance("STD-003", "ai", 230303); blocker.faceDown = true;
  player.memory = 3; player.registry = [source, createCardInstance("STD-020", "player", 230304), createCardInstance("STD-021", "player", 230305)];
  ai.memory = 10; ai.back = [blocker]; ai.hand = [createCardInstance("STD-022", "ai", 230306), createCardInstance("STD-023", "ai", 230307)]; ai.front = [attacker]; state.active = "ai";
  assert.equal(attack(state, "ai", attacker.uid, "player-fortress"), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { scope: "[アンブッシュ:3]を起動", selected: [] }), true);
  assert.ok(player.registry.includes(source));
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [ai.hand[0].uid] }), true);
  assert.equal(state.pending, null);
  assert.equal(state.prompt?.scriptUid, blocker.uid);
  assert.ok(state.deferredTrashMoves.some((entry) => entry.card.uid === source.uid));
  assert.equal(player.trash.includes(source), false);
  assert.equal(declinePrompt(state), true);
  assert.ok(player.trash.includes(source));
  assert.equal(state.std230AmbushCleanup, null);
  assert.equal(state.pending, null);
});

test("STD-231 generates proofs only in vacant in-range adjacent board slots", () => {
  const scenario = (targetSlot, occupiedSlots = [], limit = 5) => {
    const state = createGame({ mode: "sandbox", rng: () => 0.5 });
    const player = state.players.player; const ai = state.players.ai;
    const script = createCardInstance("STD-231", "player", 231100 + targetSlot);
    script.faceDown = true; player.back = [script]; player.memory = 20;
    player.registry = [createCardInstance("STD-214", "player", 231090 + targetSlot)];
    ai.user.frontLimit = limit;
    const target = createCardInstance("STD-020", "ai", 231200 + targetSlot);
    Object.assign(target, { boardSlot: targetSlot, boardSlotController: "ai", boardSlotZone: "front" });
    ai.front = [target, ...occupiedSlots.map((slot, index) => {
      const card = createCardInstance("STD-021", "ai", 231300 + targetSlot * 10 + index);
      Object.assign(card, { boardSlot: slot, boardSlotController: "ai", boardSlotZone: "front" });
      return card;
    })];
    state.active = "ai";
    const serialBefore = state.tokenSerial;
    const eventsBefore = state.events.length;
    const trashBefore = ai.trash.length;
    emitGameEvent(state, { type: "card_executed", playerId: "ai", ownerId: "ai", cardUid: target.uid,
      cardId: target.id, cardName: target.name, category: target.category });
    assert.equal(state.prompt?.scriptUid, script.uid);
    assert.equal(activateScript(state, "player", script.uid), true);
    return {
      state, ai, target, serialBefore, eventsBefore, trashBefore,
      proofs: ai.front.filter((card) => card.id === "STD-228")
    };
  };

  const both = scenario(3);
  assert.deepEqual(both.proofs.map((card) => card.boardSlot).sort(), [2, 4]);
  assert.equal(both.state.tokenSerial, both.serialBefore + 2);

  const one = scenario(3, [2]);
  assert.deepEqual(one.proofs.map((card) => card.boardSlot), [4]);
  assert.equal(one.state.tokenSerial, one.serialBefore + 1);

  const none = scenario(3, [2, 4]);
  assert.equal(none.proofs.length, 0);
  assert.equal(none.state.tokenSerial, none.serialBefore);
  assert.equal(none.state.events.slice(none.eventsBefore).some((event) => event.type === "card_effect_placed"), false);
  assert.equal(none.ai.trash.length, none.trashBefore);

  const edge = scenario(1);
  assert.deepEqual(edge.proofs.map((card) => card.boardSlot), [2]);
  assert.equal(edge.state.tokenSerial, edge.serialBefore + 1);

  const noAdjacentSlot = scenario(1, [], 1);
  assert.equal(noAdjacentSlot.proofs.length, 0);
  assert.equal(noAdjacentSlot.state.tokenSerial, noAdjacentSlot.serialBefore);
});

test("mounted replacement and reveal preserve the square while ordinary relog chooses a fresh vacant slot", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const code = createCardInstance("STD-008", "player", 231501);
  Object.assign(code, { boardSlot: 4, boardSlotController: "player", boardSlotZone: "front" });
  const upper = createCardInstance("STD-020", "player", 231502);
  player.front = [code]; player.hand = [upper]; player.memory = 20;
  assert.equal(playCard(state, "player", upper.uid, { zone: "front", baseUid: code.uid }), true);
  assert.equal(upper.boardSlot, 4);
  assert.equal(destroyCard(state, "player", upper.uid, { source: "slot test", suppressReplacement: true, suppressTrashScriptWindow: true }), true);
  assert.equal(player.front.some((card) => card.uid === code.uid && card.boardSlot === 4), true);

  const mover = createCardInstance("STD-020", "player", 231503);
  Object.assign(mover, { boardSlot: 4, boardSlotController: "player", boardSlotZone: "front", summoningSick: false });
  const blocker = createCardInstance("STD-021", "player", 231504);
  Object.assign(blocker, { boardSlot: 1, boardSlotController: "player", boardSlotZone: "back" });
  player.front = [mover]; player.back = [blocker]; player.memory = 20;
  assert.equal(relogCard(state, "player", mover.uid, "back"), true);
  assert.equal(mover.boardSlot, 2);
  assert.equal(blocker.boardSlot, 1);
});

test("direct relog snapshots legacy compact-array slots before removing the moving card", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const mover = createCardInstance("STD-020", "player", 231551);
  const remaining = createCardInstance("STD-021", "player", 231552);
  player.front = [mover, remaining]; player.back = []; player.memory = 20;
  assert.equal(Object.hasOwn(remaining, "boardSlot"), false);
  assert.equal(relogCard(state, "player", mover.uid, "back"), true);
  assert.equal(remaining.boardSlot, 2);
  assert.equal(mover.boardSlot, 1);
  assert.equal(mover.boardSlotZone, "back");
});

test("STD-234/235 mounted sleep effects and STD-237 random Ob placement resolve", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0 }); const player = state.players.player; const ai = state.players.ai;
  player.hand = [createCardInstance("STD-020", "player", 234003)]; ai.hand = []; const attacker = createCardInstance("STD-020", "player", 234001); attacker.summoningSick = false;
  attacker.mounted = [createCardInstance("STD-234", "player", 234002), createCardInstance("STD-235", "player", 235002)]; player.front = [attacker]; ai.front = []; const before = player.fortressStr;
  assert.equal(attack(state, "player", attacker.uid, "ai-fortress"), true); assert.equal(player.fortressStr, before - 2);
  assert.equal(state.pending.request.continuation.type, "mounted-event-discard");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [player.hand[0].uid] }), true);
  const doctor = createCardInstance("STD-237", "player", 237001); doctor.compiled = compileEffectText(doctor.text, { id: doctor.id, category: doctor.category }); player.front = [doctor]; player.back = []; player.memory = 10;
  const effect = getActivatableEffects(state, "player", doctor).find((item) => item.kind === "update");
  assert.equal(activateCardEffect(state, "player", doctor.uid, effect.id), true);
  assert.ok([...player.front, ...player.back].some((card) => card.uid !== doctor.uid && isObCard(card)));
});

test("STD-237 generation places without Login or execution while normal play retains Login", () => {
  const ids = Object.values(CARD_LIBRARY).filter((item) => isObCard(item) && !item.token && item.id !== "STD-237").map((item) => item.id);
  const state = createGame({ mode: "lab" });
  state.rng = () => (ids.indexOf("STD-133") + 0.5) / ids.length;
  const player = state.players.player;
  const doctor = createCardInstance("STD-237", "player", 237701);
  doctor.compiled = compileEffectText(doctor.text, { id: doctor.id, category: doctor.category });
  player.front = [doctor, createCardInstance("STD-132", "player", 237702)];
  player.back = []; player.hand = []; player.memory = 20;
  player.deck = [createCardInstance("STD-020", "player", 237703), createCardInstance("STD-021", "player", 237704)];
  const before = state.events.length;
  const effect = getActivatableEffects(state, "player", doctor).find((item) => item.kind === "update");
  assert.equal(activateCardEffect(state, "player", doctor.uid, effect.id), true);
  const generated = player.front.find((item) => item.id === "STD-133");
  assert.ok(generated);
  assert.equal(player.memory, 16);
  assert.equal(player.hand.length, 0);
  assert.equal(player.deck.length, 2);
  assert.equal(generated.summoningSick, false); // QA is static, not Login.
  const events = state.events.slice(before);
  assert.equal(events.filter((item) => item.type === "card_generated").length, 1);
  assert.equal(events.filter((item) => item.type === "card_effect_placed" && item.cardUid === generated.uid).length, 1);
  assert.equal(events.some((item) => item.type === "card_executed" && item.cardUid === generated.uid), false);
  const normal = createCardInstance("STD-133", "player", 237705);
  player.hand = [normal];
  assert.equal(playCard(state, "player", normal.uid, { zone: "back" }), true);
  assert.equal(player.hand.length, 1);
  assert.equal(player.deck.length, 1);
  assert.ok(state.events.some((item) => item.type === "card_executed" && item.cardUid === normal.uid));
});

test("STD-237 generation falls back to back and full boards reject placement without Login", () => {
  const ids = Object.values(CARD_LIBRARY).filter((item) => isObCard(item) && !item.token && item.id !== "STD-237").map((item) => item.id);
  for (const full of [false, true]) {
    const state = createGame({ mode: "lab" });
    state.rng = () => (ids.indexOf("STD-133") + 0.5) / ids.length;
    const player = state.players.player;
    const doctor = createCardInstance("STD-237", "player", 237801);
    doctor.compiled = compileEffectText(doctor.text, { id: doctor.id, category: doctor.category });
    player.user.frontLimit = 1; player.user.backLimit = 1;
    player.front = [doctor]; player.back = full ? [createCardInstance("STD-132", "player", 237802)] : [];
    player.hand = []; player.memory = 20;
    const effect = getActivatableEffects(state, "player", doctor).find((item) => item.kind === "update");
    const start = state.events.length;
    assert.equal(activateCardEffect(state, "player", doctor.uid, effect.id), true);
    const generated = (full ? player.trash : player.back).find((item) => item.id === "STD-133");
    assert.ok(generated);
    assert.equal(player.memory, 16);
    assert.equal(player.hand.length, 0);
    const events = state.events.slice(start);
    assert.equal(events.filter((item) => item.type === "card_generated").length, 1);
    assert.equal(events.filter((item) => item.type === "card_effect_placed" && item.cardUid === generated.uid).length, full ? 0 : 1);
    assert.equal(events.some((item) => item.type === "card_executed" && item.cardUid === generated.uid), false);
  }
});

test("STD-233 generates the canonical mask cards through the shared runtime", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const spell = createCardInstance("STD-233", "player", 233001);
  player.hand = [spell];
  player.memory = 10;
  assert.equal(playCard(state, "player", spell.uid), true);
  const white = player.hand.find((card) => card.id === "STD-234");
  const black = player.hand.find((card) => card.id === "STD-235");
  assert.deepEqual({ name: white.name, category: white.category, cost: white.cost }, { name: "白い仮面", category: "Code", cost: 1 });
  assert.deepEqual({ name: black.name, category: black.category, cost: black.cost }, { name: "黒の仮面", category: "Code", cost: 2 });
});

test("STD-199 grants the move follow-up to the moved card owner", () => {
  const state = createGame({ mode: "lab" }); const player = state.players.player; const ai = state.players.ai;
  player.memory = 10; ai.memory = 0; ai.deck = [createCardInstance("STD-020", "ai", 199003)];
  const source = createCardInstance("STD-199", "player", 199001); const target = createCardInstance("STD-022", "ai", 199002);
  player.hand = [source]; ai.front = [target];
  assert.equal(playCard(state, "player", source.uid), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [target.uid] }), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { choice: "手札に戻す", selected: [] }), true);
  assert.equal(ai.memory, 2);
  assert.equal(player.memory, 7);
});

test("STD-199 back movement draws for the moved card owner", () => {
  const state = createGame({ mode: "lab" }); const player = state.players.player; const ai = state.players.ai;
  const source = createCardInstance("STD-199", "player", 199011); const target = createCardInstance("STD-022", "ai", 199012);
  const draw = createCardInstance("STD-020", "ai", 199013);
  player.hand = [source]; ai.front = [target]; ai.back = []; ai.hand = []; ai.deck = [draw];
  assert.equal(playCard(state, "player", source.uid), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [target.uid] }), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { choice: "バックに移動", selected: [] }), true);
  assert.equal(findCard(state, target.uid).zoneName, "back");
  assert.equal(ai.hand.some((card) => card.uid === draw.uid), true);
});

test("STD-202 moves an enemy front Ob and generates Dolls in its original area", () => {
  const state = createGame({ mode: "lab" }); const player = state.players.player; const ai = state.players.ai;
  const source = createCardInstance("STD-202", "player", 202001); const target = createCardInstance("STD-022", "ai", 202002);
  player.hand = [source]; player.memory = 10; ai.front = [target]; ai.back = [];
  assert.equal(playCard(state, "player", source.uid, { targetUid: target.uid }), true);
  assert.equal(findCard(state, target.uid).zoneName, "back");
  assert.equal(ai.front.some((card) => card.id === "STD-189" && card.owner === "ai"), true);
});

test("STD-209 generates by the destroyed card category family", () => {
  for (const category of ["Ob", "Lyd-Ob", "Code"]) {
    const state = createGame({ mode: "lab" }); const player = state.players.player; const ai = state.players.ai;
    const targetIsOb = category !== "Code";
    const source = createCardInstance("STD-209", "player", category === "Ob" ? 209001 : category === "Lyd-Ob" ? 209021 : 209011);
    const target = createCardInstance(category === "Ob" ? "STD-022" : category === "Lyd-Ob" ? "SZTB-092" : "STD-016", "ai", category === "Ob" ? 209002 : category === "Lyd-Ob" ? 209022 : 209012);
    player.hand = [source]; player.memory = 10; ai.front = targetIsOb ? [target] : []; ai.back = category === "Code" ? [target] : [];
    assert.equal(playCard(state, "player", source.uid, { targetUid: target.uid }), true);
    assert.equal(player.hand.filter((card) => card.id === "STD-189").length, 1 + (category === "Code" ? 1 : 0));
    assert.equal(player.hand.filter((card) => card.id === "STD-205").length, targetIsOb ? 1 : 0);
  }
});

test("STD-203 uses a grouped Response selection and follows destruction determination", () => {
  const state = createGame({ mode: "lab" }); const player = state.players.player; const ai = state.players.ai;
  player.memory = 1;
  const card = createCardInstance("STD-203", "player", 203001); const own = createCardInstance("STD-022", "player", 203002);
  const enemy = createCardInstance("STD-020", "ai", 203003); enemy.str = 2;
  const sameColumn = createCardInstance("STD-021", "ai", 203004);
  const otherColumn = createCardInstance("STD-021", "ai", 203005);
  Object.assign(enemy, { boardSlot: 4, boardSlotController: "ai", boardSlotZone: "front" });
  Object.assign(sameColumn, { boardSlot: 4, boardSlotController: "ai", boardSlotZone: "back" });
  Object.assign(otherColumn, { boardSlot: 1, boardSlotController: "ai", boardSlotZone: "back" });
  player.hand = [card]; player.front = [own]; ai.front = [enemy]; ai.back = [otherColumn, sameColumn];
  state.pending = { type: "response-window", playerId: "player", candidates: [card.uid], event: { sourcePlayerId: "ai", amount: 1 } };
  assert.equal(activateResponse(state, "player", card.uid), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [own.uid, enemy.uid] }), true);
  assert.ok(player.trash.some((item) => item.uid === own.uid));
  assert.ok(ai.trash.some((item) => item.uid === enemy.uid));
  assert.equal(state.pending.request.continuation.type, "deal-selected-damage");
  assert.deepEqual(state.pending.validTargets, [sameColumn.uid]);
});

test("STD-207 is executable from the shared Response window", () => {
  const state = createGame({ mode: "lab" }); const player = state.players.player; state.players.ai.back = [];
  player.memory = 3;
  const card = createCardInstance("STD-207", "player", 207001); player.hand = [card];
  state.pending = { type: "response-window", playerId: "player", candidates: [card.uid], event: { sourcePlayerId: "ai", amount: 1 } };
  assert.equal(activateResponse(state, "player", card.uid), true);
  assert.equal(player.trash.some((item) => item.uid === card.uid), false);
  assert.equal(state.pending.request.continuation.type, "std207-reveal");
  const revealUid = state.pending.request.candidates[0];
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [revealUid] }), true);
  assert.ok(player.trash.some((item) => item.uid === card.uid));
});

test("BIGBOSS can mulligan exactly three times before another opening action", () => {
  const state = createGame({ mode: "ai", playerUserId: "bigboss", rng: () => 0 });
  const player = state.players.player;
  assert.equal(player.hand.length, 5);
  for (let count = 1; count <= 3; count += 1) {
    assert.equal(openingMulligan(state, "player"), true);
    assert.equal(player.hand.length, 5);
    assert.equal(player.mulligansUsed, count);
  }
  assert.equal(openingMulligan(state, "player"), false);
});

// 開始手順 v2.4 (規則書2.4): 各ユーザーが1回、任意枚数を山札の下へ戻して引き直し、最後にダイスで先攻を決める。
const openingGame = (extra = {}) => {
  const dice = { value: 0.1 };
  const state = createGame({ mode: "ai", openingProtocol: "v2.4", rng: () => dice.value, ...extra });
  return { state, dice };
};

test("v2.4 starts in an opening phase with dealt hands, no turn started and the player deciding first", () => {
  const { state } = openingGame();
  assert.deepEqual(state.opening, { status: "mulligan", order: ["player", "ai"], index: 0 });
  assert.equal(state.phase, "opening");
  assert.equal(state.active, "player");
  assert.equal(state.players.player.hand.length, 4);
  assert.equal(state.players.ai.hand.length, 4);
  assert.equal(state.players.player.turnsTaken, 0);
  assert.equal(state.players.ai.turnsTaken, 0);
  assert.equal(canOpeningMulligan(state, "player"), true);
  assert.equal(canOpeningMulligan(state, "ai"), false, "the other user waits for its turn to decide");
  // Unspecified and non-ai modes keep the old flow (no opening phase at all).
  assert.equal("opening" in createGame({ mode: "ai" }), false);
  for (const mode of ["tutorial", "lab", "sandbox"]) assert.equal("opening" in createGame({ mode, openingProtocol: "v2.4" }), false, mode);
});

test("v2.4 refuses every normal action until both users have decided", () => {
  const { state } = openingGame();
  const player = state.players.player;
  const card = player.hand[0];
  assert.equal(playCard(state, "player", card.uid), false);
  assert.equal(installCard(state, "player", card.uid), false);
  assert.equal(endTurn(state), false);
  assert.equal(activateTurbo(state, "player"), false);
  assert.equal(recoverRegistryCard(state, "player", card.uid), false);
  assert.equal(player.hand.includes(card), true);
  assert.equal(keepOpeningHand(state, "ai"), false, "only the deciding user can keep");
  assert.equal(openingMulligan(state, "ai", { uids: [state.players.ai.hand[0].uid] }), false);
  assert.ok(state.opening);
});

test("v2.4 mulligan returns the chosen cards to the bottom, redraws the same number and shuffles", () => {
  const { state } = openingGame();
  const player = state.players.player;
  const deckBefore = player.deck.length;
  const handBefore = player.hand.map((card) => card.uid);
  const chosen = handBefore.slice(0, 2);
  assert.equal(openingMulligan(state, "player", { uids: [] }), false, "at least one card");
  assert.equal(openingMulligan(state, "player", { uids: [chosen[0], chosen[0]] }), false, "no duplicates");
  assert.equal(openingMulligan(state, "player", { uids: ["not-in-hand"] }), false);
  assert.equal(player.mulligansUsed, 0);

  assert.equal(openingMulligan(state, "player", { uids: chosen }), true);
  assert.equal(player.hand.length, 4);
  assert.equal(player.deck.length, deckBefore);
  assert.equal(player.mulligansUsed, 1);
  assert.ok(handBefore.slice(2).every((uid) => player.hand.some((card) => card.uid === uid)), "unchosen cards stay in hand");
  assert.equal(new Set([...player.hand, ...player.deck].map((card) => card.uid)).size, 4 + deckBefore, "no card lost or duplicated");
  // The single mulligan is spent, so the decision passes to the next user.
  assert.equal(state.active, "ai");
  assert.equal(canOpeningMulligan(state, "player"), false);
  assert.equal(state.opening.index, 1);
});

test("v2.4 rolls the dice in the last decision and starts the first player's turn", () => {
  for (const [value, first, second] of [[0.1, "player", "ai"], [0.9, "ai", "player"]]) {
    const { state, dice } = openingGame();
    assert.equal(keepOpeningHand(state, "player"), true);
    assert.equal(state.active, "ai");
    assert.equal(state.opening.status, "mulligan");
    dice.value = value;
    assert.equal(keepOpeningHand(state, "ai"), true);
    assert.equal("opening" in state, false);
    assert.equal(state.firstPlayer, first);
    assert.equal(state.active, first);
    assert.equal(state.phase, "main");
    assert.equal(state.turnNumber, 1);
    assert.equal(state.players[first].hand.length, 4, "the first player skips the first draw");
    assert.equal(state.players[first].turnsTaken, 1);
    assert.equal(state.players[second].turnsTaken, 0);
    assert.ok(state.log.some((entry) => entry.text.includes("先攻")));
  }
});

test("v2.4 gives the second player the two-card first-turn draw after the dice", () => {
  const { state, dice } = openingGame();
  dice.value = 0.9; // ai goes first
  keepOpeningHand(state, "player");
  keepOpeningHand(state, "ai");
  const player = state.players.player;
  assert.equal(endTurn(state), true);
  assert.equal(state.active, "player");
  assert.equal(player.hand.length, 6);
});

test("v2.4 is deterministic for the same random stream", () => {
  const run = () => {
    let seed = 7;
    const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const state = createGame({ mode: "ai", openingProtocol: "v2.4", rng });
    openingMulligan(state, "player", { uids: [state.players.player.hand[0].uid] });
    keepOpeningHand(state, "ai");
    return JSON.stringify([state.firstPlayer, state.players.player.hand.map((card) => card.uid), state.players.ai.hand.map((card) => card.uid)]);
  };
  assert.equal(run(), run());
});

test("v2.4 lets BIGBOSS repeat the mulligan up to three times or keep earlier", () => {
  const { state } = openingGame({ playerUserId: "bigboss" });
  const player = state.players.player;
  assert.equal(player.hand.length, 5);
  assert.equal(openingMulligan(state, "player", { uids: [player.hand[0].uid] }), true);
  assert.equal(state.active, "player", "BIGBOSS still decides after the first mulligan");
  assert.equal(openingMulligan(state, "player", { uids: player.hand.slice(0, 3).map((card) => card.uid) }), true);
  assert.equal(state.active, "player");
  assert.equal(openingMulligan(state, "player", { uids: player.hand.map((card) => card.uid) }), true);
  assert.equal(player.mulligansUsed, 3);
  assert.equal(state.active, "ai", "the third mulligan ends the decision");
  assert.equal(player.hand.length, 5);

  const early = openingGame({ playerUserId: "bigboss" }).state;
  assert.equal(openingMulligan(early, "player", { uids: [early.players.player.hand[0].uid] }), true);
  assert.equal(keepOpeningHand(early, "player"), true);
  assert.equal(early.active, "ai");
});

test("Savage same-symbol turn-end mill offers an optional one-card salvage", () => {
  const state = createGame({ mode: "sandbox", playerUserId: "savage_salvage" });
  const player = state.players.player;
  const reserve = createCardInstance("STD-020", "player", 990000);
  player.deck = [reserve, createCardInstance("STD-076", "player", 990001), createCardInstance("STD-075", "player", 990002)];
  assert.equal(endTurn(state), false);
  assert.equal(state.pending?.request?.continuation?.type, "user-savage-salvage");
  assert.equal(state.pending.request.minimum, 0);
  assert.equal(state.pending.request.maximum, 1);
  const chosen = state.pending.request.candidates[1];
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [chosen] }), true);
  assert.ok(player.hand.some((card) => card.uid === chosen));
  assert.equal(player.trash.length, 1);
  assert.equal(state.winner, null);
  assert.equal(player.hand.some((card) => card.uid === reserve.uid), true);
  assert.equal(player.deck.some((card) => card.uid === reserve.uid), false);
});

test("Savage affects both users at their own turn end", () => {
  for (const [playerUserId, aiUserId, activeId] of [
    ["doors_zx", "savage_salvage", "player"],
    ["savage_salvage", "doors_zx", "ai"]
  ]) {
    const state = createGame({ mode: "ai", playerUserId, aiUserId });
    state.active = activeId;
    const active = state.players[activeId];
    active.front = [];
    active.back = [];
    active.deck = [createCardInstance("STD-020", activeId, 990100), createCardInstance("STD-076", activeId, 990101), createCardInstance("STD-075", activeId, 990102)];
    assert.equal(endTurn(state), false);
    assert.equal(state.pending?.request?.continuation?.type, "user-savage-salvage");
    assert.equal(state.pending.request.continuation.playerId, activeId);
    assert.deepEqual(state.pending.request.candidates, active.trash.map((card) => card.uid));
  }
});

const userAbilityFeedback = (state, abilityKey) => state.events.filter((event) => event.type === "user_ability_feedback" && event.abilityKey === abilityKey);

test("Turbo feedback requires a confirmed activation", () => {
  const feedback = userAbilityFeedback;
  const turbo = createGame({ mode: "sandbox", playerUserId: "doors_zx" });
  const originalMax = getMaxMemory(turbo.players.player);
  assert.equal(canActivateTurbo(turbo, "player"), true);
  assert.equal(activateTurbo(turbo, "player"), true);
  assert.equal(canActivateTurbo(turbo, "player"), false);
  assert.deepEqual(feedback(turbo, "turbo").map((event) => [event.branch, event.before, event.after]), [["activated", originalMax, originalMax + 2]]);
  const turboFailure = createGame({ mode: "sandbox", playerUserId: "doors_zx" });
  turboFailure.active = "ai";
  assert.equal(canActivateTurbo(turboFailure, "player"), false);
  assert.equal(activateTurbo(turboFailure, "player"), false);
  assert.equal(feedback(turboFailure, "turbo").length, 0);
});

test("BIGBOSS mulligan emits confirmed feedback", () => {
  const boss = createGame({ mode: "ai", playerUserId: "bigboss", rng: () => 0 });
  assert.equal(openingMulligan(boss, "player"), true);
  assert.equal(userAbilityFeedback(boss, "watching_you")[0]?.branch, "mulligan");
});

test("Mono synthetic reevaluation emits enabled feedback", () => {
  const mono = createGame({ mode: "sandbox", playerUserId: "suckintosh" });
  mono.players.player.registry = [createCardInstance("STD-075", "player", 991001)];
  mono.players.player.front = [createCardInstance("STD-076", "player", 991002)];
  emitGameEvent(mono, { type: "test-visible-state", playerId: "player" });
  assert.equal(userAbilityFeedback(mono, "mono_color")[0]?.branch, "enabled");
});

test("PHOENIX first install emits draw and extra-install feedback", () => {
  const phoenix = createGame({ mode: "sandbox", playerUserId: "phoenix" });
  const installed = createCardInstance("STD-075", "player", 991003);
  phoenix.players.player.hand = [installed];
  phoenix.players.player.deck = [createCardInstance("STD-076", "player", 991004)];
  assert.equal(installCard(phoenix, "player", installed.uid), true);
  assert.deepEqual(userAbilityFeedback(phoenix, "registry_liberty").map((event) => [event.branch, event.outcome]), [["first-install", "install-ready"]]);
  assert.deepEqual(userAbilityFeedback(phoenix, "registry_liberty")[0].steps.map((step) => step.kind), ["transfer", "state_change"]);
});

test("Humanoid recovery feedback follows the actual STR state", () => {
  const recovery = createGame({ mode: "sandbox", playerUserId: "humanoid" });
  dealFortressDamage(recovery, "player", recovery.players.player.fortressStr, "ai", "test");
  assert.equal(recovery.players.player.fortressStr, 1);
  assert.deepEqual(userAbilityFeedback(recovery, "recovery_boot").map((event) => [event.branch, event.before, event.after, event.steps]), [["recovered", 0, 1, [{ kind: "value_change", target: { kind: "player_stat", playerId: "player", metric: "str" }, before: 0, after: 1 }]]]);
});

test("By OS replaces damage with BAN without reducing STR", () => {
  const byOs = createGame({ mode: "sandbox", playerUserId: "by_os" });
  const banCards = [createCardInstance("STD-075", "player", 991005), createCardInstance("STD-076", "player", 991006)];
  byOs.players.player.deck = [...banCards];
  const originalStr = byOs.players.player.fortressStr;
  const originalBan = byOs.players.player.ban.map((card) => card.uid);
  assert.equal(dealFortressDamage(byOs, "player", 2, "ai", "test"), 2);
  assert.equal(byOs.players.player.fortressStr, originalStr);
  assert.deepEqual(byOs.players.player.deck.map((card) => card.uid), []);
  assert.deepEqual(byOs.players.player.ban.map((card) => card.uid), [...originalBan, ...banCards.map((card) => card.uid).reverse()]);
  assert.deepEqual(userAbilityFeedback(byOs, "dimension_innovation").map((event) => [event.branch, event.outcome, event.after, event.strBefore, event.strAfter, event.steps]), [["damage-replaced", "ban", 2, originalStr, originalStr, [{ kind: "transfer", from: { kind: "zone_count", playerId: "player", zone: "deck" }, to: { kind: "zone_count", playerId: "player", zone: "ban" }, count: 2 }]]]);
});

test("EXTREME doubles received damage and emits the multiply step", () => {
  const extreme = createGame({ mode: "sandbox", playerUserId: "extreme" });
  const originalStr = extreme.players.player.fortressStr;
  dealFortressDamage(extreme, "player", 1, "ai", "test");
  assert.equal(extreme.players.player.fortressStr, originalStr - 2);
  assert.deepEqual(userAbilityFeedback(extreme, "kickass").map((event) => [event.branch, event.before, event.after, event.steps]), [["damage-doubled", 1, 2, [{ kind: "multiply", target: { kind: "player_stat", playerId: "player", metric: "damage" }, before: 1, factor: 2, after: 2 }]]]);
});

test("DOORS NT first Ob placement uses a matching registry symbol and emits discount feedback", () => {
  const doorsNt = createGame({ mode: "sandbox", playerUserId: "doors_nt" });
  const firstOb = createCardInstance("STD-075", "player", 991007);
  doorsNt.players.player.registry = [createCardInstance("STD-075", "player", 991012)];
  doorsNt.players.player.hand = [firstOb];
  doorsNt.players.player.memory = 10;
  assert.equal(playCard(doorsNt, "player", firstOb.uid, { zone: "front" }), true);
  assert.equal(doorsNt.players.player.front.some((card) => card.uid === firstOb.uid), true);
  assert.equal(doorsNt.players.player.hand.some((card) => card.uid === firstOb.uid), false);
  assert.deepEqual(userAbilityFeedback(doorsNt, "do_or_isnt").filter((event) => event.branch === "first-ob-discount").map((event) => [event.amount, event.steps]), [[0, [{ kind: "measurement", target: { kind: "card_stat", playerId: "player", metric: "effective_cost", cardUid: firstOb.uid }, before: 0, after: 0 }]]]);
});

test("Savage feedback affects each active player and preserves the next draw", () => {
  const savage = createGame({ mode: "sandbox", playerUserId: "savage_salvage" });
  const reserve = createCardInstance("STD-020", "player", 991013);
  const milled = [createCardInstance("STD-076", "player", 991008), createCardInstance("STD-075", "player", 991009)];
  savage.players.player.deck = [reserve, ...milled];
  assert.equal(endTurn(savage), false);
  assert.equal(userAbilityFeedback(savage, "trash_never_empty").some((event) => event.branch === "milled-same-symbol"), true);
  const salvageRequest = savage.pending.request;
  const salvagedUid = salvageRequest.candidates[0];
  assert.equal(resolveCardSelection(savage, salvageRequest.continuation, { selected: [salvagedUid] }), true);
  assert.equal(userAbilityFeedback(savage, "trash_never_empty").some((event) => event.branch === "salvaged"), true);
  assert.equal(savage.players.player.hand.some((card) => card.uid === salvagedUid), true);
  assert.equal(savage.players.player.trash.length, 1);
  assert.equal(savage.winner, null);
  assert.equal(savage.players.player.hand.some((card) => card.uid === reserve.uid), true);
  assert.equal(savage.players.player.deck.some((card) => card.uid === reserve.uid), false);

  const remoteSavage = createGame({ mode: "sandbox", playerUserId: "doors_zx", aiUserId: "savage_salvage" });
  const remoteReserve = createCardInstance("STD-020", "player", 991014);
  remoteSavage.players.player.deck = [remoteReserve, createCardInstance("STD-076", "player", 991010), createCardInstance("STD-075", "player", 991011)];
  assert.equal(endTurn(remoteSavage), false);
  const remoteMill = userAbilityFeedback(remoteSavage, "trash_never_empty").find((event) => event.branch === "milled-same-symbol");
  assert.deepEqual([remoteMill.ownerPlayerId, remoteMill.affectedPlayerId, remoteMill.amount], ["ai", "player", 2]);
  const remoteRequest = remoteSavage.pending.request;
  const remoteSalvagedUid = remoteRequest.candidates[0];
  assert.equal(resolveCardSelection(remoteSavage, remoteRequest.continuation, { selected: [remoteSalvagedUid] }), true);
  const remoteSalvage = userAbilityFeedback(remoteSavage, "trash_never_empty").find((event) => event.branch === "salvaged");
  assert.deepEqual([remoteSalvage.ownerPlayerId, remoteSalvage.affectedPlayerId, remoteSalvage.amount], ["ai", "player", 1]);
  assert.equal(remoteSavage.players.player.hand.some((card) => card.uid === remoteSalvagedUid), true);
  assert.equal(remoteSavage.players.player.trash.length, 1);
  assert.equal(remoteSavage.winner, null);
  assert.equal(remoteSavage.players.player.hand.some((card) => card.uid === remoteReserve.uid), true);
  assert.equal(remoteSavage.players.player.deck.some((card) => card.uid === remoteReserve.uid), false);

  for (const event of savage.events.filter((item) => item.type === "user_ability_feedback")) {
    assert.equal("cardUid" in event || "cardName" in event || "sourceUid" in event || "targetUid" in event, false);
  }
});

test("deck builder validates user-specific size and same-name limits", () => {
  const uniqueCards = [...new Map(BUILDABLE_CARDS.map((card) => [card.name, card])).values()];
  const byOs = { id: "by-os", name: "By OS", userId: "by_os", cards: Object.fromEntries(uniqueCards.slice(0, 30).map((card) => [card.id, 2])) };
  assert.equal(validateDeck(byOs).valid, true);
  byOs.cards["STD-001"] = 3;
  assert.equal(validateDeck(byOs).valid, false);
  const extreme = { id: "extreme", name: "EXTREME", userId: "extreme", cards: Object.fromEntries(uniqueCards.slice(0, 60).map((card) => [card.id, 1])) };
  assert.equal(validateDeck(extreme).valid, true);
  assert.ok(BUILDABLE_CARDS.every((card) => /^(STD|SZTB)-/.test(card.id)));
  assert.equal(new Set(BUILDABLE_CARDS.map((card) => card.id)).size, BUILDABLE_CARDS.length);
});

test("deck storage caps at twenty and custom recipes enter the runtime", () => {
  const values = new Map(); const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  const base = { userId: "doors_zx", cards: recommendDeck({ userId: "doors_zx" }).cards };
  assert.equal(validateDeck(base).valid, true);
  const saved = saveDeckCollection(Array.from({ length: 25 }, (_, index) => ({ ...base, id: `d${index}`, name: `Deck ${index}` })), storage);
  assert.equal(saved.length, MAX_SAVED_DECKS);
  assert.equal(loadSavedDecks(storage).length, MAX_SAVED_DECKS);
  const state = createGame({ mode: "ai", playerDeckRecipe: deckToRecipe(saved[0]), playerUserId: saved[0].userId, rng: () => 0 });
  assert.equal(state.players.player.hand.length + state.players.player.deck.length, 40);
});

test("configured saved decks enter a clean sandbox with each user's opening hand", () => {
  const recipe = deckToRecipe({ userId: "doors_zx", cards: recommendDeck({ userId: "doors_zx" }).cards });
  const state = createGame({ mode: "sandbox", playerDeckRecipe: recipe, aiDeckRecipe: recipe, sandboxDeckSetup: true, rng: () => 0 });
  for (const player of Object.values(state.players)) {
    assert.equal(player.hand.length, Number(player.user.initialHand ?? 4));
    assert.equal(player.hand.length + player.deck.length, 40);
    assert.equal(player.front.length, 0);
    assert.equal(player.back.length, 0);
    assert.equal(player.memory, 99);
  }
});

test("placement policy preserves zero-slot mounts and rejects only added bounded slots", () => {
  assert.equal(evaluatePlacement({ zone: "front", occupied: 2, limit: 2, addedSlots: 0 }).ok, true);
  assert.equal(evaluatePlacement({ zone: "front", occupied: 2, limit: 2, addedSlots: 1 }).ok, false);
  assert.equal(evaluatePlacement({ zone: "registry", occupied: 99, limit: 0, addedSlots: 1 }).ok, true);
});

test("placement policy normalizes malformed occupancy and never makes effective occupancy negative", () => {
  for (const value of [NaN, -1, Infinity]) {
    const result = evaluatePlacement({ zone: "front", occupied: value, limit: 2, addedSlots: 1, freedSlots: Infinity });
    assert.equal(result.effectiveOccupied, 0);
  }
  assert.equal(evaluatePlacement({ zone: "front", occupied: 1, limit: Infinity, addedSlots: 1 }).ok, false);
});

test("placement policy normalizes every numeric input for both bounded zones", () => {
  for (const zone of ["front", "back"]) {
    for (const value of [NaN, -4, Infinity]) assert.ok(evaluatePlacement({ zone, occupied: value, limit: 2, addedSlots: value, freedSlots: value }).effectiveOccupied >= 0);
    // An over-limit input is defensive-only: it is never a legal game state.
    assert.equal(evaluatePlacement({ zone, occupied: 3, limit: 2, addedSlots: 1, freedSlots: 1 }).ok, false);
    assert.equal(evaluatePlacement({ zone, occupied: 3, limit: 2, addedSlots: 2, freedSlots: 1 }).ok, false);
  }
  for (const zone of ["registry", "trash"]) assert.equal(evaluatePlacement({ zone, occupied: 999, limit: 0, addedSlots: 999 }).ok, true);
});

test("createGame existing cards default temporaryLayer to false", () => {
  const state = createGame({ mode: "sandbox" });
  let checked = 0;
  for (const player of Object.values(state.players)) for (const zone of ["deck", "hand", "front", "back", "registry", "trash"]) {
    for (const card of player[zone]) { checked += 1; assert.equal(card.temporaryLayer, false); for (const mounted of card.mounted ?? []) assert.equal(mounted.temporaryLayer, false); }
  }
  assert.ok(checked > 0);
});

test("cloneForHistory preserves nested temporaryLayer and layerRole", () => {
  const state = createGame({ mode: "sandbox" }); const card = state.players.player.deck[0];
  card.temporaryLayer = true; card.layerRole = "layered";
  card.mounted = [{ ...createCardInstance("STD-020", "player", 973001), temporaryLayer: true, layerRole: "mount" }];
  const clone = cloneForHistory(state); const copied = clone.players.player.deck[0];
  assert.equal(copied.temporaryLayer, true); assert.equal(copied.layerRole, "layered");
  assert.equal(copied.mounted[0].temporaryLayer, true); assert.equal(copied.mounted[0].layerRole, "mount");
});

test("trigger generate multiple cards crosses last slot and continues", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  player.user.frontLimit = 2; player.user.backLimit = 0;
  const source = createCardInstance("STD-106", "player", 974002); source.summoningSick = false; player.hand = [source];
  // STD-106's attack entry is the public trigger route; both generated tokens
  // must be processed even when neither bounded zone has a free slot.
  const target = createCardInstance("STD-020", "ai", 974003); target.sleep = true; state.players.ai.front = [target];
  assert.equal(playCard(state, "player", source.uid, { zone: "front", force: true, free: true, ignoreColor: true }), true);
  const attacker = player.front.find((card) => card.uid === source.uid); attacker.summoningSick = false;
  assert.equal(attack(state, "player", attacker.uid, target.uid), true);
  assert.ok(player.trash.filter((card) => card.id === "STD-078").length >= 1);
});

test("STD093 legally occupies the last slot and finalizes only its generated overflow token", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  player.user.frontLimit = 1; player.user.backLimit = 0;
  const source = createCardInstance("STD-093", "player", 974101);
  player.front = []; player.hand = [source];
  assert.ok(player.front.length <= player.user.frontLimit && player.back.length <= player.user.backLimit);
  assert.equal(playCard(state, "player", source.uid, { zone: "front", force: true, free: true, ignoreColor: true }), true);
  const token = player.trash.find((card) => card.token);
  assert.ok(player.front.some((card) => card.uid === source.uid));
  assert.ok(token);
  assert.equal(player.trash.filter((card) => card.uid === token.uid).length, 1);
  assert.equal(state.events.filter((event) => event.cardUid === token.uid && event.ruleDestruction).length, 1);
  assert.equal(state.events.filter((event) => event.cardUid === token.uid && event.type === "card_effect_placed").length, 0);
  assert.equal(state.events.filter((event) => event.cardUid === source.uid && event.type === "card_placed").length, 1);
  assert.equal(state.events.filter((event) => event.cardUid === source.uid && event.type === "card_executed").length, 1);
  assert.equal(player.front.length, 1); assert.equal(player.back.length, 0);
});

test("STD228 random selection may choose a full opponent zone", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0 }); const player = state.players.player; const opponent = state.players.ai;
  const proof = createCardInstance("STD-228", "player", 974201); proof.compiled = compileEffectText(proof.text, { id: proof.id, category: proof.category }); player.front = [proof]; player.memory = 10;
  opponent.user.frontLimit = 1; opponent.front = [createCardInstance("STD-020", "ai", 974202)]; opponent.back = [];
  assert.equal(activateCardEffect(state, "player", proof.uid, `${proof.id}:update:0`), true);
  assert.equal(player.trash.filter((card) => card.uid === proof.uid).length, 1);
  assert.equal(opponent.back.some((card) => card.uid === proof.uid), false);
});

test("normal movement and backup retain their pre-cap rejection contract", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  const source = createCardInstance("STD-020", "player", 974301); player.front = [source]; player.user.backLimit = 0; const memory = player.memory;
  assert.equal(relogCard(state, "player", source.uid, "back"), false);
  assert.equal(player.front[0].uid, source.uid); assert.equal(player.memory, memory);
  source.backup = 1;
  assert.equal(destroyCard(state, "player", source.uid, { source: "cap test" }), true);
  assert.equal(player.back.some((card) => card.uid === source.uid), false);
});

test("STD048 second player's first mandatory draw failure serializes, rejects illegal input, and resumes once", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.ai;
  player.front = []; player.back = []; player.user.frontLimit = 0; player.user.backLimit = 0; player.turnsTaken = 0;
  const dawn = createCardInstance("STD-048", "ai", 974401); const ruleDraw = createCardInstance("STD-020", "ai", 974402);
  player.deck = [ruleDraw, dawn]; const fortress = player.fortressStr;
  startTurn(state, "ai"); assert.equal(state.pending?.type, "std048-draw-place");
  assert.deepEqual(JSON.parse(JSON.stringify(state)).mandatoryDrawContinuation, state.mandatoryDrawContinuation);
  assert.deepEqual(cloneForHistory(state).mandatoryDrawContinuation, state.mandatoryDrawContinuation);
  const protectedState = { hand: player.hand.map((card) => card.uid), deck: player.deck.map((card) => card.uid), fortress: player.fortressStr, trash: player.trash.length, ban: player.ban.length };
  assert.equal(resolveAccessDragPlacement(state, "ai", "invalid-zone"), false);
  assert.equal(resolveAccessDragPlacement(state, "ai", "front", "missing-host"), false);
  assert.equal(resolveAccessDragPlacement(state, "player", "front"), false);
  assert.equal(state.mandatoryDrawContinuation.placementOutcome, "pending");
  assert.equal(state.pending?.type, "std048-draw-place"); assert.deepEqual(player.hand.map((card) => card.uid), protectedState.hand); assert.deepEqual(player.deck.map((card) => card.uid), protectedState.deck);
  assert.equal(player.fortressStr, protectedState.fortress); assert.equal(player.trash.length, protectedState.trash); assert.equal(player.ban.length, protectedState.ban);
  assert.equal(resolveAccessDragPlacement(state, "ai", "front"), true);
  assert.equal(player.fortressStr, fortress); assert.ok(player.trash.some((card) => card.uid === dawn.uid));
  assert.ok(player.hand.some((card) => card.uid === ruleDraw.uid));
  assert.equal(state.mandatoryDrawContinuation, null);
  const handCount = player.hand.length;
  assert.equal(resolveAccessDragPlacement(state, "ai", "front"), false);
  assert.equal(player.hand.length, handCount);
});

test("STD048 successful second-player mandatory draw resolves rule draw before effect draw", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.ai;
  player.front = []; player.back = []; player.user.frontLimit = 1; player.user.backLimit = 0; player.turnsTaken = 0;
  const dawn = createCardInstance("STD-048", "ai", 974411); const effectDraw = createCardInstance("STD-020", "ai", 974412); const ruleDraw = createCardInstance("STD-021", "ai", 974413);
  player.deck = [effectDraw, ruleDraw, dawn]; player.fortressStr = player.user.maxStr - 5; const fortress = player.fortressStr;
  startTurn(state, "ai"); assert.equal(resolveAccessDragPlacement(state, "ai", "front"), true);
  assert.equal(player.fortressStr, Math.min(player.user.maxStr, fortress + 3));
  assert.ok(player.hand.some((card) => card.uid === effectDraw.uid));
  assert.ok(player.hand.some((card) => card.uid === ruleDraw.uid));
  assert.equal(state.log.filter((entry) => entry.text.includes("ドラッグ成功。自分ユーザーを3回復し、1枚ドロー。")).length, 1);
  const draws = state.events.filter((event) => event.type === "card_drawn" && [ruleDraw.uid, effectDraw.uid].includes(event.cardUid));
  assert.deepEqual(draws.map((event) => event.cardUid), [ruleDraw.uid, effectDraw.uid]);
  assert.equal(draws.filter((event) => event.cardUid === ruleDraw.uid).length, 1);
  assert.equal(draws.filter((event) => event.cardUid === effectDraw.uid).length, 1);
  assert.equal(state.mandatoryDrawContinuation, null);
});

test("STD048 completes the remaining rule draw before placement and waits through STD003 finalization", () => {
  for (const decision of ["accept", "decline"]) {
    const state = createGame({ mode: "sandbox" }); const player = state.players.ai; const opponent = state.players.player;
    player.front = []; player.back = []; player.user.frontLimit = 0; player.user.backLimit = 0; player.turnsTaken = 0;
    const dawn = createCardInstance("STD-048", "ai", decision === "accept" ? 974421 : 974431); const ruleDraw = createCardInstance("STD-020", "ai", decision === "accept" ? 974422 : 974432);
    const script = createCardInstance("STD-003", "player", decision === "accept" ? 974423 : 974433); script.faceDown = true;
    player.deck = [ruleDraw, dawn]; opponent.back = [script]; opponent.memory = 10;
    startTurn(state, "ai"); assert.equal(resolveAccessDragPlacement(state, "ai", "front"), true);
    assert.equal(state.prompt?.scriptUid, script.uid); assert.equal(state.mandatoryDrawContinuation.placementOutcome, "failed");
    assert.ok(player.hand.some((card) => card.uid === ruleDraw.uid)); assert.equal(player.fortressStr, player.user.maxStr);
    assert.ok(state.deferredTrashMoves.some((item) => item.card.uid === dawn.uid));
    assert.equal(decision === "accept" ? activateScript(state, "player", script.uid) : declinePrompt(state), true);
    assert.ok(player.hand.some((card) => card.uid === ruleDraw.uid));
    assert.equal(state.mandatoryDrawContinuation, null);
    assert.equal(player.fortressStr, player.user.maxStr);
    assert.equal(player.trash.filter((card) => card.uid === dawn.uid).length, 1);
    assert.equal(player.ban.filter((card) => card.uid === dawn.uid).length, 0);
    assert.equal(state.events.filter((event) => event.cardUid === dawn.uid && event.ruleDestruction).length, 1);
    assert.equal(state.events.filter((event) => event.cardUid === ruleDraw.uid && event.type === "card_drawn").length, 1);
    assert.equal(state.log.filter((entry) => entry.text.includes("ドラッグ成功。自分ユーザーを3回復し、1枚ドロー。")).length, 0);
    const count = player.hand.length; assert.equal(declinePrompt(state), false); assert.equal(resolveAccessDragPlacement(state, "ai", "front"), false); assert.equal(player.hand.length, count);
  }
});

test("STD048 pauses a successful continuation through STD186 then STD179 selection", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player; const ai = state.players.ai;
  ai.front = []; ai.back = []; ai.user.frontLimit = 1; ai.user.backLimit = 0; ai.turnsTaken = 0;
  const dawn = createCardInstance("STD-048", "ai", 974441); const effectDraw = createCardInstance("STD-020", "ai", 974442); const ruleDraw = createCardInstance("STD-021", "ai", 974443);
  const harvest = createCardInstance("STD-186", "player", 974444); const thread = createCardInstance("STD-179", "player", 974445);
  const greenRegistry = createCardInstance("STD-173", "player", 974446);
  harvest.faceDown = true; player.back = [harvest]; player.registry = [greenRegistry]; player.hand = [thread]; player.memory = 10;
  ai.deck = [effectDraw, ruleDraw, dawn];
  startTurn(state, "ai"); assert.equal(resolveAccessDragPlacement(state, "ai", "front"), true);
  assert.equal(state.prompt?.scriptUid, harvest.uid); assert.equal(state.mandatoryDrawContinuation.ruleDrawDone, true); assert.equal(state.mandatoryDrawContinuation.successEffectDone, false);
  assert.ok(ai.hand.some((card) => card.uid === ruleDraw.uid)); assert.equal(ai.hand.some((card) => card.uid === effectDraw.uid), false);
  assert.equal(activateScript(state, "player", harvest.uid), true);
  assert.equal(state.pending?.request?.continuation?.type, "std179-place");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { scope: "配置しない", selected: [] }), true);
  assert.ok(ai.hand.some((card) => card.uid === effectDraw.uid));
  assert.equal(ai.hand.filter((card) => card.uid === ruleDraw.uid).length, 1);
  assert.equal(state.mandatoryDrawContinuation, null);
});

test("STD048 continuation clones and JSON roundtrips resume independently exactly once", () => {
  const state = createGame({ mode: "sandbox" }); const ai = state.players.ai;
  ai.front = []; ai.back = []; ai.user.frontLimit = 0; ai.user.backLimit = 0; ai.turnsTaken = 0;
  const dawn = createCardInstance("STD-048", "ai", 974451); const ruleDraw = createCardInstance("STD-020", "ai", 974452);
  ai.deck = [ruleDraw, dawn]; startTurn(state, "ai");
  const historyClone = cloneForHistory(state); const jsonClone = JSON.parse(JSON.stringify(state)); jsonClone.rng = state.rng;
  for (const copy of [historyClone, jsonClone]) {
    assert.equal(resolveAccessDragPlacement(copy, "ai", "front"), true);
    assert.equal(copy.players.ai.hand.filter((card) => card.uid === ruleDraw.uid).length, 1);
    assert.equal(copy.mandatoryDrawContinuation, null);
    assert.equal(resolveAccessDragPlacement(copy, "ai", "front"), false);
  }
  assert.equal(state.pending?.type, "std048-draw-place"); assert.equal(ai.hand.some((card) => card.uid === ruleDraw.uid), true);
});

test("STD048 common deferredDestruction guard waits for its existing completion route", () => {
  // Hand-made guard fixture: deferredDestruction is the real singular engine field.
  const state = createGame({ mode: "sandbox" }); const ai = state.players.ai; const player = state.players.player;
  ai.front = []; ai.back = []; ai.user.frontLimit = 1; ai.user.backLimit = 0; ai.turnsTaken = 0; ai.fortressStr = ai.user.maxStr - 5;
  const dawn = createCardInstance("STD-048", "ai", 974461); const ruleDraw = createCardInstance("STD-020", "ai", 974462); const effectDraw = createCardInstance("STD-021", "ai", 974463);
  const victim = createCardInstance("STD-020", "player", 974464); player.front = [victim]; ai.deck = [effectDraw, ruleDraw, dawn];
  state.deferredDestruction = { ownerId: "player", uid: victim.uid, source: "guard fixture", suppressReplacement: true };
  startTurn(state, "ai"); assert.equal(resolveAccessDragPlacement(state, "ai", "front"), true);
  assert.equal(state.mandatoryDrawContinuation.ruleDrawDone, true); assert.equal(state.mandatoryDrawContinuation.successEffectDone, false);
  assert.ok(ai.hand.some((card) => card.uid === ruleDraw.uid)); assert.equal(ai.fortressStr, ai.user.maxStr - 5);
  state.prompt = { message: "deferred child completion" }; assert.equal(declinePrompt(state), true);
  assert.ok(player.trash.some((card) => card.uid === victim.uid)); assert.ok(ai.hand.some((card) => card.uid === ruleDraw.uid)); assert.ok(ai.hand.some((card) => card.uid === effectDraw.uid));
  assert.equal(ai.fortressStr, ai.user.maxStr - 2); assert.equal(state.mandatoryDrawContinuation, null);
});

test("STD048 mandatory rule draw loss ends before its successful placement effect", () => {
  const state = createGame({ mode: "sandbox" }); const ai = state.players.ai;
  ai.front = []; ai.back = []; ai.user.frontLimit = 1; ai.user.backLimit = 0; ai.turnsTaken = 0; ai.fortressStr = ai.user.maxStr - 5;
  const dawn = createCardInstance("STD-048", "ai", 974471); ai.deck = [dawn];
  startTurn(state, "ai"); assert.equal(state.pending, null);
  assert.equal(state.winner, "player"); assert.equal(ai.fortressStr, ai.user.maxStr - 5);
  assert.equal(state.log.filter((entry) => entry.text.includes("ドラッグ成功。自分ユーザーを3回復し、1枚ドロー。")).length, 0);
  assert.equal(state.mandatoryDrawContinuation, null);
});

test("common decode queue unit retains a single UID on overflow", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  player.front = []; player.back = []; player.user.frontLimit = 0; player.user.backLimit = 0;
  const decoded = createCardInstance("STD-020", "player", 974501);
  state.pending = { type: "decode-place", playerId: "player", sourceName: "real-origin guard", queue: [decoded.uid], cards: [decoded], sourceUid: decoded.uid };
  assert.equal(resolveAccessDragPlacement(state, "player", "front"), true);
  assert.equal(player.trash.filter((card) => card.uid === decoded.uid).length, 1);
  assert.equal(state.events.filter((event) => event.cardUid === decoded.uid && event.ruleDestruction).length, 1);
});

test("STD142 hand and trash overflow reach forced finalizer", () => {
  for (const origin of ["hand", "trash"]) {
    const state = createGame({ mode: "sandbox" }); const player = state.players.player;
    player.user.backLimit = 1;
    const script = createCardInstance("STD-142", "player", 975001); script.faceDown = true; player.back = [script]; player.memory = 20;
    const sacred = createCardInstance("STD-139", "player", origin === "hand" ? 975002 : 975003);
    player[origin] = [sacred]; player.registry = [createCardInstance("STD-142", "player", origin === "hand" ? 975004 : 975005)];
    assert.equal(activateScript(state, "player", script.uid), true);
    assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [sacred.uid] }), true);
    assert.equal(player.trash.filter((card) => card.uid === sacred.uid).length, 1);
    assert.equal(state.events.filter((event) => event.cardUid === sacred.uid && event.ruleDestruction).length, 1);
  }
});

test("STD086 defers Sp cleanup, permits zero, and gates follow-up damage on actual destruction", () => {
  const zero = createGame({ mode: "sandbox", rng: () => 0.5 });
  const zeroPlayer = zero.players.player; const zeroEnemy = zero.players.ai;
  const zeroShot = createCardInstance("STD-086", "player", 975010); const zeroVictim = createCardInstance("STD-131", "ai", 975011);
  zeroVictim.permanentStr = 20; zeroPlayer.hand = [zeroShot]; zeroEnemy.front = [zeroVictim]; zeroPlayer.memory = 20;
  assert.equal(playCard(zero, "player", zeroShot.uid, { targetUid: zeroVictim.uid, force: true, ignoreColor: true }), true);
  assert.equal(zeroPlayer.trash.some((card) => card.uid === zeroShot.uid), false);
  assert.equal(resolveCardSelection(zero, zero.pending.request.continuation, { selected: [] }), true);
  assert.equal(zeroVictim.damage, 3);
  assert.equal(zeroPlayer.trash.some((card) => card.uid === zeroShot.uid), true);

  const blocked = createGame({ mode: "sandbox", rng: () => 0.5 });
  const blockedPlayer = blocked.players.player; const blockedEnemy = blocked.players.ai;
  const shot = createCardInstance("STD-086", "player", 975012); const victim = createCardInstance("STD-131", "ai", 975013);
  const sacrifice = createCardInstance("STD-020", "player", 975014); sacrifice.protect = 1; victim.permanentStr = 20;
  blockedPlayer.hand = [shot]; blockedPlayer.front = [sacrifice]; blockedEnemy.front = [victim]; blockedPlayer.memory = 20;
  const blockedFortress = blockedEnemy.fortressStr;
  assert.equal(playCard(blocked, "player", shot.uid, { targetUid: victim.uid, force: true, ignoreColor: true }), true);
  assert.equal(resolveCardSelection(blocked, blocked.pending.request.continuation, { selected: [sacrifice.uid] }), true);
  assert.equal(victim.damage, 3);
  assert.equal(blockedEnemy.fortressStr, blockedFortress);
  assert.equal(sacrifice.protect, 0);
  assert.equal(blockedPlayer.trash.some((card) => card.uid === shot.uid), true);

  const replaced = createGame({ mode: "sandbox", rng: () => 0.5 });
  const replacedPlayer = replaced.players.player; const replacedEnemy = replaced.players.ai;
  const replacedShot = createCardInstance("STD-086", "player", 975015); const replacedVictim = createCardInstance("STD-131", "ai", 975016);
  const backup = createCardInstance("STD-020", "player", 975017); backup.backup = 1; replacedVictim.permanentStr = 20;
  replacedPlayer.hand = [replacedShot]; replacedPlayer.front = [backup]; replacedPlayer.back = []; replacedEnemy.front = [replacedVictim]; replacedPlayer.memory = 20;
  const replacedFortress = replacedEnemy.fortressStr;
  assert.equal(playCard(replaced, "player", replacedShot.uid, { targetUid: replacedVictim.uid, force: true, ignoreColor: true }), true);
  assert.equal(resolveCardSelection(replaced, replaced.pending.request.continuation, { selected: [backup.uid] }), true);
  assert.ok(replacedPlayer.back.some((card) => card.uid === backup.uid));
  assert.equal(replacedVictim.damage, 3);
  assert.equal(replacedEnemy.fortressStr, replacedFortress - 2);
});

test("STD086 deferred cleanup never runs the Arms Band Jacket post-effect", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 }); const player = state.players.player; const ai = state.players.ai;
  const shot = createCardInstance("STD-086", "player", 975018); const armsBand = createCardInstance("SZTB-090", "player", 975019);
  const victim = createCardInstance("STD-131", "ai", 975120); victim.permanentStr = 20;
  player.hand = [shot]; player.front = [armsBand]; player.back = []; ai.front = [victim]; player.memory = 20;
  assert.equal(playCard(state, "player", shot.uid, { targetUid: victim.uid, force: true, ignoreColor: true }), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [] }), true);
  assert.equal(state.pending?.request?.continuation?.type === "sztb-jacket-place", false);
  assert.equal([...player.front, ...player.back].some((card) => card.id === "SZTB-091"), false);
});

function simultaneousBackHackerState({ interactive }) {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  state.interactive = interactive;
  const { player, ai } = state.players;
  player.hand = []; ai.hand = []; player.front = []; ai.front = [];
  player.deck = Array.from({ length: 6 }, (_, index) => createCardInstance("STD-020", "player", 71100 + index));
  ai.deck = Array.from({ length: 6 }, (_, index) => createCardInstance("STD-020", "ai", 71200 + index));
  player.back = [createCardInstance("STD-190", "player", 71001)];
  ai.back = [createCardInstance("STD-190", "ai", 71002)];
  player.fortressStr = 2; ai.fortressStr = 2;
  player.incidentsTriggered = [999]; ai.incidentsTriggered = [999];
  return state;
}

test("simultaneous turn-end triggers are separate effects: the first lethal one locks and the other never runs", () => {
  const state = simultaneousBackHackerState({ interactive: false });
  assert.equal(endTurn(state), true);
  // The active user's trigger resolves first (4.7); its completion boundary decides the result.
  assert.equal(state.winner, "player");
  assert.equal(state.victory.lockedOutcome, "player");
  assert.equal(state.victory.finished, true);
  assert.equal(state.players.ai.fortressStr, 0);
  assert.equal(state.players.player.fortressStr, 2, "the undeclared simultaneous trigger of the loser does not run");
  assert.equal(state.log.filter((entry) => entry.text.includes("バックハッカー: Doors ZXへ2ダメージ")).length, 1);
});

test("a simultaneous trigger thread cancels the remaining items once an earlier item locks the result", () => {
  const state = simultaneousBackHackerState({ interactive: true });
  assert.equal(endTurn(state), true);
  assert.equal(state.pending?.type, "trigger-order");
  const own = state.triggerThread.items.find((item) => item.controllerId === "player");
  assert.equal(resolveTriggerChoice(state, own.id), true);
  assert.equal(state.winner, "player");
  assert.equal(state.victory.finished, true);
  assert.deepEqual(state.triggerThread.items.map((item) => `${item.controllerId}:${item.status}`), ["player:resolved", "ai:cancelled-after-victory-lock"]);
  assert.equal(state.players.player.fortressStr, 2);
});

test("automatic triggers wait for the parent Spell boundary and do not run after its victory lock", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 }); const player = state.players.player; const ai = state.players.ai;
  const shot = createCardInstance("STD-086", "player", 975030); const dolls = createCardInstance("STD-189", "player", 975031);
  const web = createCardInstance("STD-208", "player", 975032); const victim = createCardInstance("STD-131", "ai", 975033);
  web.residentActive = true; victim.permanentStr = 20;
  player.hand = [shot]; player.front = [dolls]; player.back = [web]; player.memory = 20;
  ai.front = [victim]; ai.fortressStr = 2;
  assert.equal(playCard(state, "player", shot.uid, { targetUid: victim.uid, force: true, ignoreColor: true }), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [dolls.uid] }), true);
  assert.equal(state.winner, "player");
  assert.ok(player.trash.some((card) => card.uid === shot.uid));
  assert.equal(victim.tempAtk ?? 0, 0);
  assert.equal(state.log.some((entry) => entry.text.includes(`誘発: ${web.name}`)), false);
});

test("missing Response cards fail without touching unrelated destruction continuations", () => {
  const direct = createGame({ mode: "sandbox", rng: () => 0.5 });
  direct.pending = { type: "response-window", playerId: "player", candidates: ["missing-response"], event: { type: "damage" } };
  direct.runtimeDestructionContinuations = { sentinel: { recordAs: "kept" } };
  assert.equal(activateResponse(direct, "player", "missing-response"), false);
  assert.deepEqual(Object.keys(direct.runtimeDestructionContinuations), ["sentinel"]);

  const selected = createGame({ mode: "sandbox", rng: () => 0.5 });
  const own = createCardInstance("STD-020", "player", 975121); const enemy = createCardInstance("STD-021", "ai", 975122);
  selected.players.player.front = [own]; selected.players.ai.front = [enemy];
  selected.runtimeDestructionContinuations = { sentinel: { recordAs: "kept" } };
  assert.equal(resolveCardSelection(selected, {
    type: "activate-std203-response", playerId: "player", cardUid: "missing-response", responseEvent: { type: "damage" }
  }, { selected: [own.uid, enemy.uid] }), false);
  assert.deepEqual(Object.keys(selected.runtimeDestructionContinuations), ["sentinel"]);
});

test("STD142 queues every face-up copy and exposes both public areas without face-down names", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player; const ai = state.players.ai;
  player.front = []; player.back = []; ai.front = []; ai.back = [];
  player.deck = [createCardInstance("STD-020", "player", 975020)]; ai.deck = [createCardInstance("STD-020", "ai", 975021)];
  const first = createCardInstance("STD-142", "player", 975022); const second = createCardInstance("STD-142", "ai", 975023);
  const ownSacred = createCardInstance("STD-139", "player", 975024); const enemySacred = createCardInstance("STD-140", "ai", 975025);
  const hiddenSacred = createCardInstance("STD-139", "ai", 975026); hiddenSacred.faceDown = true;
  player.back = [first, ownSacred]; ai.back = [second, enemySacred, hiddenSacred];
  assert.equal(endTurn(state), false);
  assert.equal(state.pending.request.continuation.playerId, "player");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [first.uid] }), true);
  assert.ok(state.pending.validTargets.includes(ownSacred.uid));
  assert.ok(state.pending.validTargets.includes(enemySacred.uid));
  assert.equal(state.pending.validTargets.includes(hiddenSacred.uid), false);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [] }), true);
  assert.equal(state.pending.request.continuation.playerId, "ai");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [] }), true);
  assert.equal(state.active, "player"); // Sandbox retains player control.
  assert.equal(state.turnNumber, 2);
  assert.equal(state.pending, null);
  assert.equal(state.std142TurnEndQueue, undefined);
});

test("STD142 salvage maximum uses successful destruction determinations", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player; const ai = state.players.ai;
  player.front = []; player.back = []; ai.front = []; ai.back = [];
  const source = createCardInstance("STD-142", "player", 975030);
  const destroyed = createCardInstance("STD-139", "player", 975031); destroyed.backup = 1;
  const prevented = createCardInstance("STD-140", "ai", 975032); prevented.protect = 1;
  player.front = [destroyed]; player.back = [source]; ai.back = [prevented];
  player.deck = [createCardInstance("STD-020", "player", 975033)]; ai.deck = [createCardInstance("STD-020", "ai", 975034)];
  assert.equal(endTurn(state), false);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [source.uid] }), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [destroyed.uid, prevented.uid] }), true);
  assert.equal(state.pending.request.continuation.type, "std142-salvage");
  assert.equal(state.pending.request.maximum, 1);
  assert.ok(player.back.some((card) => card.uid === destroyed.uid));
  assert.equal(prevented.protect, 0);
});

test("STD142 does not open its second selection when source destruction is prevented", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player; const ai = state.players.ai;
  player.front = []; player.back = []; ai.front = []; ai.back = [];
  const source = createCardInstance("STD-142", "player", 975035); source.protect = 1;
  const sacred = createCardInstance("STD-139", "player", 975036);
  player.back = [source, sacred]; player.deck = [createCardInstance("STD-020", "player", 975037)]; ai.deck = [createCardInstance("STD-020", "ai", 975038)];
  assert.equal(endTurn(state), false);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [source.uid] }), true);
  assert.equal(state.pending?.request?.continuation?.type === "std142-destroy", false);
  assert.ok(player.back.some((card) => card.uid === source.uid));
});

test("STD159 is immune and counts Ob destruction only while face-up, independently per copy", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 });
  const player = state.players.player; const ai = state.players.ai;
  player.front = []; player.back = []; ai.front = []; ai.back = [];
  const first = createCardInstance("STD-159", "player", 975040); const second = createCardInstance("STD-159", "ai", 975041);
  const enemyOb = createCardInstance("STD-020", "ai", 975042); const script = createCardInstance("STD-003", "ai", 975043);
  player.front = [first]; ai.front = [second, enemyOb]; ai.back = [script];
  assert.equal(destroyCard(state, "player", first.uid, { source: "face-up check", suppressReplacement: true }), false);
  assert.equal(destroyCard(state, "ai", script.uid, { source: "non-Ob", suppressReplacement: true, suppressTrashScriptWindow: true }), true);
  assert.equal(first.tempAtk ?? 0, 0); assert.equal(second.tempAtk ?? 0, 0);
  assert.equal(destroyCard(state, "ai", enemyOb.uid, { source: "Ob", suppressReplacement: true, suppressTrashScriptWindow: true }), true);
  assert.equal(first.tempAtk, 1); assert.equal(second.tempAtk, 1);
  first.faceDown = true;
  const another = createCardInstance("STD-021", "ai", 975044); ai.front.push(another);
  assert.equal(destroyCard(state, "ai", another.uid, { source: "Ob two", suppressReplacement: true, suppressTrashScriptWindow: true }), true);
  assert.equal(first.tempAtk, 1); assert.equal(second.tempAtk, 2);
  assert.equal(destroyCard(state, "player", first.uid, { source: "face-down check", suppressReplacement: true }), true);
  ai.deck = [createCardInstance("STD-022", "ai", 975045)];
  startTurn(state, "ai");
  assert.equal(second.tempAtk, 0);
});

test("STD124 Login applies exact cumulative X thresholds 0/2/3/5/7/20", () => {
  for (const count of [0, 2, 3, 5, 7, 20]) {
    const state = createGame({ mode: "sandbox", rng: () => 0.5 });
    const player = state.players.player; const ai = state.players.ai;
    player.front = []; player.back = []; ai.front = []; ai.back = [];
    const source = createCardInstance("STD-124", "player", 975050 + count * 100);
    player.hand = [source]; player.trash = Array.from({ length: count }, (_, index) => createCardInstance("STD-124", "player", 975051 + count * 100 + index));
    player.deck = [createCardInstance("STD-021", "player", 979900 + count), createCardInstance("STD-022", "player", 979950 + count)];
    const enemyOb = createCardInstance("STD-020", "ai", 980000 + count); const enemyCode = createCardInstance("STD-008", "ai", 980050 + count);
    assert.equal(enemyOb.category, "Ob"); assert.equal(enemyCode.category, "Code");
    ai.front = [enemyOb]; ai.back = [enemyCode]; player.memory = 99;
    assert.equal(playCard(state, "player", source.uid, { zone: "front", force: true, ignoreColor: true }), true);
    assert.equal(source.permanentAtk, count); assert.equal(source.permanentStr, count);
    assert.equal(player.hand.length, count >= 3 ? 2 : 0);
    assert.equal(enemyOb.sleep, count >= 5); assert.equal(enemyCode.sleep, false);
    assert.equal(cardHasKeyword(source, "QA"), count >= 7); assert.equal(cardHasKeyword(source, "DISCONNECT"), count >= 7);
    assert.equal(state.winner === "player", count >= 20);
  }
});

test("STD124 recalculates X and accumulates its stat bonus on relog", () => {
  const state = createGame({ mode: "sandbox", rng: () => 0.5 }); const player = state.players.player;
  player.front = []; player.back = [];
  const source = createCardInstance("STD-124", "player", 981000);
  player.hand = [source]; player.trash = [createCardInstance("STD-124", "player", 981001), createCardInstance("STD-124", "player", 981002)]; player.memory = 99;
  assert.equal(playCard(state, "player", source.uid, { zone: "front", force: true, ignoreColor: true }), true);
  assert.equal(source.permanentAtk, 2);
  assert.equal(cardHasKeyword(source, "LOGIN"), true);
  assert.equal(Boolean(cardHasKeyword(source, "QA")), false);
  assert.equal(Boolean(cardHasKeyword(source, "DISCONNECT")), false);
  assert.equal(relogCard(state, "player", source.uid, "back"), true);
  assert.equal(source.permanentAtk, 4); assert.equal(source.permanentStr, 4);
});

test("STD105 attack window overflow has zero execution and placement follow-up", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  player.user.frontLimit = 0; player.user.backLimit = 1; player.memory = 20; state.active = "ai";
  const script = createCardInstance("STD-105", "player", 975101); script.faceDown = true; player.back = [script];
  const forced = createCardInstance("STD-195", "player", 975102); player.hand = [forced]; player.registry = [createCardInstance("STD-105", "player", 975104)];
  const attacker = createCardInstance("STD-020", "ai", 975103); attacker.summoningSick = false; state.players.ai.front = [attacker];
  assert.equal(attack(state, "ai", attacker.uid, "player-fortress"), true);
  assert.equal(activateScript(state, "player", script.uid), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [forced.uid] }), true);
  assert.equal(player.trash.filter((card) => card.uid === forced.uid).length, 1);
  assert.equal(state.events.filter((event) => event.cardUid === forced.uid && /placed|executed/.test(event.type)).length, 0);
  assert.equal(state.delayedEffects.some((effect) => effect.cardUid === forced.uid), false);
});

test("STD154 scheduled return uses its controller turn entry", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  player.user.frontLimit = 0; player.user.backLimit = 0;
  const returned = createCardInstance("STD-154", "player", 975201); player.trash = [returned];
  state.delayedEffects.push({
    event: "turn_started", dueOwnerTurnsTaken: 0, type: "move_source_from_trash",
    ownerId: "player", cardUid: returned.uid, sourceName: returned.name,
    destination: "choose_area", resetDamage: true, sleep: true
  });
  startTurn(state, "player");
  assert.equal(player.trash.filter((card) => card.uid === returned.uid).length, 1);
  assert.equal(state.events.filter((event) => event.cardUid === returned.uid && event.ruleDestruction).length, 1);
});

test("STD135 delayed revival is produced by its destruction path", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  const source = createCardInstance("STD-135", "player", 975202); player.front = [source];
  assert.equal(destroyCard(state, "player", source.uid, { source: "test", suppressReplacement: true }), true);
  assert.equal(state.delayedEffects.some((effect) => effect.type === "move_source_from_trash" && effect.cardUid === source.uid), true);
});

test("STD049 armed proxy resolves only at the opposing turn end", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  const armed = createCardInstance("STD-049", "player", 975203); armed.std049ProxyArmed = true;
  const calamity = createCardInstance("STD-050", "player", 975204); player.trash = [armed]; player.front = [calamity];
  state.players.ai.front = []; state.players.ai.back = [];
  state.active = "ai";
  assert.equal(endTurn(state, "ai"), true);
  assert.equal(player.trash.filter((card) => card.uid === armed.uid).length <= 1, true);
});

test("real STD041 decode queue processes overflow after its selection entry", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  player.user.frontLimit = 1; player.user.backLimit = 1;
  const source = createCardInstance("STD-041", "player", 976002); const first = createCardInstance("STD-021", "player", 976003); const second = createCardInstance("STD-022", "player", 976004);
  player.front = []; player.hand = [source]; player.trash = [first, second]; player.memory = 10;
  assert.equal(playCard(state, "player", source.uid, { zone: "front", force: true, ignoreColor: true }), true);
  assert.equal(destroyCard(state, "player", source.uid, { source: "logout", suppressReplacement: true }), true);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [first.uid, second.uid] }), true);
  assert.equal(resolveAccessDragPlacement(state, "player", "front"), true);
  assert.equal(resolveAccessDragPlacement(state, "player", "front"), true);
  assert.equal(player.front.some((card) => card.uid === first.uid), true);
  assert.equal(player.trash.filter((card) => card.uid === second.uid).length, 1);
});

test("forced overflow finalizer records each category exactly once", () => {
  for (const [id, zone] of [["STD-021", "front"], ["STD-003", "back"]]) {
    const state = createGame({ mode: "sandbox" }); const player = state.players.player;
    player.front = []; player.back = []; player.user[`${zone}Limit`] = 0;
    const card = createCardInstance(id, "player", 976100); player.hand = [card];
    assert.ok(player.front.length <= player.user.frontLimit && player.back.length <= player.user.backLimit);
    assert.equal(playCard(state, "player", card.uid, { zone, free: true, force: true, ignoreColor: true, placementMode: "forced-effect" }), true);
    assert.equal(state.turnStats.destroyedCards, 1); assert.equal(state.events.filter((event) => event.cardUid === card.uid && event.ruleDestruction).length, 1);
  }
});

test("STD204 opponent replacement checks script owners front and back limits", () => {
  for (const zone of ["front", "back"]) {
    const state = createGame({ mode: "lab" }); const owner = state.players.player; const opponent = state.players.ai;
    const takeover = owner.hand.find((card) => card.id === "STD-204");
    assert.equal(playCard(state, "player", takeover.uid, { zone: "back" }), true);
    owner.user.frontLimit = owner.front.length; owner.user.backLimit = owner.back.length; state.active = "ai"; opponent.memory = 99;
    assert.equal(owner.front.length, owner.user.frontLimit); assert.equal(owner.back.length, owner.user.backLimit);
    const executed = createCardInstance("STD-020", "ai", zone === "front" ? 976301 : 976302);
    opponent.hand = [executed];
    assert.equal(playCard(state, "ai", executed.uid, { zone, force: true, free: true, ignoreColor: true }), true);
    assert.equal(state.prompt.scriptUid, takeover.uid);
    assert.equal(activateScript(state, "player", takeover.uid), true);
    assert.equal(owner.front.concat(owner.back).some((card) => card.id === "STD-205"), false);
    const destroyed = state.events.filter((event) => event.cardId === "STD-205" && event.ruleDestruction);
    assert.equal(destroyed.length, 1); assert.equal(destroyed[0].zone, zone);
    assert.equal(state.log.some((entry) => entry.text.includes("ドールズ・ギガンテス") && entry.text.includes("レイヤーとして配置")), false);
  }
});

test("layered slot accounting frees only own same-zone top-level material", () => {
  const state = createGame({ mode: "lab" }); const player = state.players.player;
  const layered = player.hand.find((card) => card.id === "STD-195");
  player.front.push(createCardInstance("STD-189", "player", 976401), createCardInstance("STD-189", "player", 976402));
  const candidates = getLayeredCandidates(state, "player", layered).filter((entry) => entry.playerId === "player" && entry.zoneName === "front");
  player.user.frontLimit = player.front.length;
  assert.ok(candidates.length >= getLayeredRequirement(layered).minimum);
  assert.equal(playLayeredCard(state, "player", layered.uid, candidates.slice(0, getLayeredRequirement(layered).minimum).map((entry) => entry.card.uid), "front"), true);
  assert.ok(player.front.some((card) => card.uid === layered.uid));
});

test("normal placement remains non-consuming while a forced effect is rule destruction", () => {
  for (const playerId of ["player", "ai"]) for (const zone of ["front", "back"]) {
    const normal = createGame({ mode: "sandbox" }); const player = normal.players[playerId];
    player.user[`${zone}Limit`] = 1; player[zone] = [createCardInstance("STD-020", playerId, 970001)];
    const rejected = createCardInstance("STD-021", playerId, 970002); player.hand = [rejected]; const beforeMemory = player.memory;
    assert.equal(playCard(normal, playerId, rejected.uid, { zone, force: true, free: false, ignoreColor: true }), false);
    assert.equal(player.hand[0].uid, rejected.uid); assert.equal(player.memory, beforeMemory);
  }

  const forced = createGame({ mode: "sandbox" }); const forcedPlayer = forced.players.player;
  forcedPlayer.user.frontLimit = 1; forcedPlayer.front = [createCardInstance("STD-020", "player", 970003)];
  const consumed = createCardInstance("STD-021", "player", 970004); forcedPlayer.hand = [consumed];
  assert.equal(playCard(forced, "player", consumed.uid, { free: true, force: true, ignoreColor: true, placementCause: "effect", placementSource: "test", placementMode: "forced-effect" }), true);
  assert.ok(forcedPlayer.trash.some((card) => card.uid === consumed.uid));
  assert.equal(forced.events.filter((event) => event.cardUid === consumed.uid && event.type === "card_placed").length, 0);
  assert.equal(forced.events.filter((event) => event.cardUid === consumed.uid && event.ruleDestruction === true).length, 1);
});

test("forced decode overflow consumes once, keeps the queue moving, and has no placement follow-up", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  player.user.frontLimit = 1; player.front = [createCardInstance("STD-020", "player", 971001)];
  const first = createCardInstance("STD-021", "player", 971002); const second = createCardInstance("STD-022", "player", 971003);
  state.pending = { type: "decode-place", playerId: "player", sourceName: "decode test", queue: [first.uid, second.uid], cards: [first, second], sourceUid: first.uid, enterSleep: true, destroyAtTurnEnd: true };
  assert.equal(resolveAccessDragPlacement(state, "player", "front"), true);
  assert.equal(player.trash.filter((card) => card.uid === first.uid).length, 1);
  assert.equal(state.events.filter((event) => event.cardUid === first.uid && event.ruleDestruction).length, 1);
  assert.deepEqual(state.pending.queue, [second.uid]);
  assert.equal(state.delayedEffects.some((effect) => effect.cardUid === first.uid), false);
  assert.equal(player.front.some((card) => card.uid === first.uid), false);
});

test("forced overflow finalizes once through STD-003 decline and an already-active BAN", () => {
  const declined = createGame({ mode: "sandbox" }); const player = declined.players.player; const opponent = declined.players.ai;
  player.user.frontLimit = 1; player.front = [createCardInstance("STD-020", "player", 971101)];
  const card = createCardInstance("STD-021", "player", 971102); const script = createCardInstance("STD-003", "ai", 971103);
  script.faceDown = true; player.hand = [card]; opponent.back = [script]; opponent.memory = 10;
  assert.equal(playCard(declined, "player", card.uid, { free: true, force: true, ignoreColor: true, placementMode: "forced-effect", placementCause: "effect", placementSource: "decline test" }), true);
  assert.equal(declined.prompt?.scriptUid, script.uid); assert.equal(declinePrompt(declined), true);
  assert.equal(player.trash.filter((item) => item.uid === card.uid).length, 1);
  assert.equal(declined.events.filter((event) => event.cardUid === card.uid && event.ruleDestruction).length, 1);

  const banned = createGame({ mode: "sandbox" }); const bannedPlayer = banned.players.player;
  bannedPlayer.user.frontLimit = 1; bannedPlayer.front = [createCardInstance("STD-020", "player", 971104)];
  const banCard = createCardInstance("STD-021", "player", 971105); bannedPlayer.hand = [banCard]; bannedPlayer.trashBanUntilTurn = banned.turnNumber;
  assert.equal(playCard(banned, "player", banCard.uid, { free: true, force: true, ignoreColor: true, placementMode: "forced-effect", placementCause: "effect", placementSource: "BAN test" }), true);
  assert.equal(bannedPlayer.ban.filter((item) => item.uid === banCard.uid).length, 1);
  assert.equal(banned.events.filter((event) => event.cardUid === banCard.uid && event.ruleDestruction).length, 1);
  assert.equal(banned.events.filter((event) => event.cardUid === banCard.uid && event.type === "card_placed").length, 0);
});

test("forced overflow finalizes before the accepted STD-003 declared effect", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player; const ai = state.players.ai;
  player.user.frontLimit = 1; player.front = [createCardInstance("STD-020", "player", 971201)];
  const card = createCardInstance("STD-021", "player", 971202); const script = createCardInstance("STD-003", "ai", 971203);
  script.faceDown = true; player.hand = [card]; ai.back = [script]; ai.memory = 10;
  assert.equal(playCard(state, "player", card.uid, { free: true, force: true, ignoreColor: true, placementMode: "forced-effect", placementCause: "effect", placementSource: "accept test" }), true);
  assert.equal(state.events.filter((event) => event.cardUid === card.uid && event.ruleDestruction).length, 0);
  assert.equal(activateScript(state, "ai", script.uid), true);
  assert.equal(player.trash.filter((item) => item.uid === card.uid).length, 1);
  assert.equal(player.ban.filter((item) => item.uid === card.uid).length, 0);
  assert.equal(state.events.filter((event) => event.cardUid === card.uid && event.ruleDestruction).length, 1);
  assert.equal(state.events.filter((event) => event.cardUid === card.uid && /placed|executed/.test(event.type)).length, 0);
});

test("registry rejection preserves index, and game hydration keeps temporary state independent", () => {
  const state = createGame({ mode: "sandbox" }); const player = state.players.player;
  player.user.frontLimit = 1; player.front = [createCardInstance("STD-020", "player", 972001)];
  const before = createCardInstance("STD-007", "player", 972002); const executable = createCardInstance("STD-215", "player", 972003); const after = createCardInstance("STD-008", "player", 972004);
  player.registry = [before, executable, after]; player.memory = 20;
  assert.equal(executeRegistryCard(state, "player", executable.uid, { zone: "front", ignoreColor: true }), false);
  assert.deepEqual(player.registry.map((card) => card.uid), [before.uid, executable.uid, after.uid]);
  const nested = player.front[0]; nested.temporaryLayer = true; nested.layerRole = "layered"; nested.mounted = [{ ...createCardInstance("STD-021", "player", 972005), temporaryLayer: true, layerRole: "mount" }];
  const roundTrip = JSON.parse(JSON.stringify(state));
  assert.equal(roundTrip.players.player.front[0].temporaryLayer, true);
  assert.equal(roundTrip.players.player.front[0].mounted[0].temporaryLayer, true);
  assert.equal(roundTrip.players.player.front[0].layerRole, "layered");
});

test("temporary layer state is boolean-only and survives nested clone data", () => {
  const layer = normalizeLayerState({ temporaryLayer: "true", mounted: [{ temporaryLayer: true }] });
  assert.equal(layer.temporaryLayer, false); assert.equal(layer.mounted[0].temporaryLayer, true);
  assert.deepEqual(JSON.parse(JSON.stringify(layer)), layer);
});

test("automatic recommendations are deterministic and legal for every user and strategy", () => {
  for (const userId of ["doors_zx", "by_os", "doors_nt", "extreme", "bigboss"]) {
    for (const strategy of Object.keys(DECK_STRATEGIES)) {
      const first = recommendDeck({ userId, color: "赤", strategy });
      const second = recommendDeck({ userId, color: "赤", strategy });
      const deck = { id: `${userId}-${strategy}`, name: "auto", userId, cards: first.cards };
      assert.equal(validateDeck(deck).valid, true, `${userId}/${strategy}`);
      assert.deepEqual(first.cards, second.cards, `${userId}/${strategy}`);
      assert.match(first.explanation, /赤/);
    }
  }
});

test("deck builder color options include every buildable color including orange", () => {
  const buildableColors = new Set(BUILDABLE_CARDS.map((card) => card.color ?? "無色"));
  assert.deepEqual(new Set(DECK_COLOR_OPTIONS), buildableColors);
  assert.equal(DECK_COLOR_OPTIONS.includes("橙"), true);
  const orange = recommendDeck({ userId: "doors_zx", color: "橙", strategy: "balanced" });
  assert.equal(validateDeck({ id: "orange", name: "orange", userId: "doors_zx", cards: orange.cards }).valid, true);
  assert.match(orange.explanation, /橙/);
  assert.equal(Object.entries(orange.cards).some(([id, count]) => count > 0 && CARD_LIBRARY[id]?.color === "橙"), true);
});

const projectionState = () => ({ pending: null, prompt: null, projectionSerial: 0, projectionSlotRevision: { pending: 0, prompt: 0 }, selectionQueue: [], selectionQueueSerial: 0, legacyProjectionOwnerSerial: 0 });
const projectionMeta = (overrides = {}) => ({ version: 1, runtime: "legacy", channel: "pending", scope: "internal", producerId: "test:projection", owner: { kind: "candidate", id: "owner-1", revision: 0 }, actorId: "player", ticket: null, ...overrides });
const projectionPayload = (overrides = {}) => ({ type: "selection", request: { id: "request-1", continuation: { playerId: "player" } }, ...overrides });

test("G16 projection accepts empty then exact9 occupied commit and replaces atomically", () => {
  const state = projectionState(); const first = buildProjectionSpec(projectionPayload(), projectionMeta());
  assert.equal(first.ok, true); const committed = commitProjection(state, { channel: "pending", spec: first.spec, expected: { mode: "empty", slotRevision: 0 } });
  assert.equal(committed.ok, true); assert.deepEqual(Object.keys(committed.identity).sort(), ["actorId", "channel", "ownerId", "ownerKind", "ownerRevision", "producerId", "projectionId", "runtime", "scope"]);
  const beforeInvalid = JSON.parse(JSON.stringify(state));
  assert.equal(replaceProjection(state, committed.identity, { payload: { bad: undefined }, meta: projectionMeta() }).ok, false);
  assert.deepEqual(state, beforeInvalid);
  const second = buildProjectionSpec(projectionPayload({ type: "replacement" }), projectionMeta({ producerId: "test:replacement" }));
  assert.equal(replaceProjection(state, committed.identity, second.spec).ok, true);
  assert.equal(state.projectionSlotRevision.pending, 2); assert.equal(state.projectionSerial, 2); assert.equal(state.pending.type, "replacement");
});

test("G16 projection strict JSON and exact schemas reject without mutation while shared JSON is copied", () => {
  const shared = { value: 1 }; const accepted = buildProjectionSpec({ left: shared, right: shared }, projectionMeta());
  assert.equal(accepted.ok, true); shared.value = 2; assert.equal(accepted.spec.payload.left.value, 1); assert.equal(accepted.spec.payload.right.value, 1);
  const cycle = {}; cycle.self = cycle;
  for (const bad of [undefined, () => {}, Symbol("x"), 1n, new Map(), new Date(), cycle, [1, , 3]]) assert.equal(buildProjectionSpec({ bad }, projectionMeta()).ok, false);
  const state = projectionState(); const before = JSON.parse(JSON.stringify(state));
  const valid = buildProjectionSpec(projectionPayload(), projectionMeta());
  for (const malformed of [
    { ...valid.spec, meta: { ...valid.spec.meta, extra: true } },
    { ...valid.spec, meta: { ...valid.spec.meta, owner: { kind: "candidate", id: "owner-1" } } },
    { ...valid.spec, payload: { ...valid.spec.payload, resolutionMeta: {} } }
  ]) assert.equal(commitProjection(state, { channel: "pending", spec: malformed, expected: { mode: "empty", slotRevision: 0 } }).ok, false);
  assert.deepEqual(state, before);
});

test("G16 projection clear restore preserves full identity and rejects foreign or stale tokens", () => {
  const state = projectionState(); const spec = buildProjectionSpec(projectionPayload(), projectionMeta());
  const first = commitProjection(state, { channel: "pending", spec: spec.spec, expected: { mode: "empty", slotRevision: 0 } }); const saved = JSON.parse(JSON.stringify(state.pending));
  const foreign = { ...first.identity, actorId: "ai" }; const beforeForeign = JSON.parse(JSON.stringify(state));
  assert.equal(clearProjection(state, foreign).ok, false); assert.deepEqual(state, beforeForeign);
  const cleared = clearProjection(state, first.identity); assert.equal(cleared.ok, true); assert.equal(restoreProjection(state, cleared.clearToken, saved).ok, true);
  const second = clearProjection(state, state.pending.resolutionMeta && { channel: "pending", projectionId: state.pending.resolutionMeta.projectionId, runtime: "legacy", scope: "internal", producerId: "test:projection", ownerKind: "candidate", ownerId: "owner-1", ownerRevision: state.pending.resolutionMeta.owner.revision, actorId: "player" });
  assert.equal(second.ok, true);
  const fresh = buildProjectionSpec(projectionPayload({ type: "fresh" }), projectionMeta({ owner: { kind: "candidate", id: "owner-2", revision: 0 } }));
  assert.equal(commitProjection(state, { channel: "pending", spec: fresh.spec, expected: { mode: "empty", slotRevision: second.clearToken.slotRevision } }).ok, true);
  assert.equal(clearProjection(state, state.pending.resolutionMeta && { channel: "pending", projectionId: state.pending.resolutionMeta.projectionId, runtime: "legacy", scope: "internal", producerId: "test:projection", ownerKind: "candidate", ownerId: "owner-2", ownerRevision: state.pending.resolutionMeta.owner.revision, actorId: "player" }).ok, true);
  assert.equal(restoreProjection(state, second.clearToken, saved).ok, false);
});

test("G16 projection coordinator root and active frame gate enqueue and promotion without consumption", () => {
  for (const blocked of [{ resolutionRuntime: "coordinator" }, { resolutionCoordinator: { activeFrame: { waits: [] } } }]) {
    const state = { ...projectionState(), ...blocked }; const before = JSON.parse(JSON.stringify(state));
    assert.equal(coordinatorProjectionBlocked(state), true);
    assert.equal(enqueueLegacyProjection(state, { queueName: "selectionQueue", channel: "pending", payload: projectionPayload(), metaBase: { scope: "internal", producerId: "test:queue", ownerKind: "candidate", actorId: "player" } }).ok, false);
    state.selectionQueue.push({ queueEntryId: "selection-1", payload: projectionPayload(), metaBase: projectionMeta() });
    const queued = JSON.parse(JSON.stringify(state.selectionQueue)); assert.equal(promoteLegacyQueueHead(state, { queueName: "selectionQueue", channel: "pending", build: (entry) => entry }), "blocked"); assert.deepEqual(state.selectionQueue, queued);
    assert.equal(state.projectionSerial, before.projectionSerial);
  }
  const state = projectionState(); state.pending = { existing: true };
  const enqueued = enqueueLegacyProjection(state, { queueName: "selectionQueue", channel: "pending", payload: projectionPayload(), metaBase: { scope: "internal", producerId: "test:queue", ownerKind: "candidate", actorId: "player" } });
  assert.equal(enqueued.ok, true); assert.equal(state.selectionQueue.length, 1); state.pending = null;
  assert.equal(promoteLegacyQueueHead(state, { queueName: "selectionQueue", channel: "pending", build: (entry) => entry }), "projected"); assert.equal(state.selectionQueue.length, 0); assert.equal(state.projectionSerial, 1);
});

test("G17 projection JSON copy accepts dense empty and nested candidate arrays", () => {
  const payload = projectionPayload({ request: { id: "request-arrays", candidates: ["one", { nested: ["two", []] }], continuation: { playerId: "player" } } });
  const built = buildProjectionSpec(payload, projectionMeta());
  assert.equal(built.ok, true);
  assert.deepEqual(built.spec.payload.request.candidates, ["one", { nested: ["two", []] }]);
  payload.request.candidates[1].nested[0] = "changed";
  assert.equal(built.spec.payload.request.candidates[1].nested[0], "two");
});

test("G18 projection rejects dense arrays with extra enumerable own string keys without mutation", () => {
  const candidates = ["one"]; candidates.extra = "unexpected";
  const payload = projectionPayload({ request: { id: "request-extra-key", candidates, continuation: { playerId: "player" } } }); const meta = projectionMeta();
  const beforePayload = Object.getOwnPropertyDescriptors(payload); const beforeRequest = Object.getOwnPropertyDescriptors(payload.request); const beforeCandidates = Object.getOwnPropertyDescriptors(candidates); const beforeContinuation = Object.getOwnPropertyDescriptors(payload.request.continuation); const beforeMeta = Object.getOwnPropertyDescriptors(meta); const beforeOwner = Object.getOwnPropertyDescriptors(meta.owner);
  let built;
  assert.doesNotThrow(() => { built = buildProjectionSpec(payload, meta); });
  assert.equal(built.ok, false);
  assert.deepEqual(Object.getOwnPropertyDescriptors(payload), beforePayload); assert.deepEqual(Object.getOwnPropertyDescriptors(payload.request), beforeRequest); assert.deepEqual(Object.getOwnPropertyDescriptors(candidates), beforeCandidates); assert.deepEqual(Object.getOwnPropertyDescriptors(payload.request.continuation), beforeContinuation); assert.deepEqual(Object.getOwnPropertyDescriptors(meta), beforeMeta); assert.deepEqual(Object.getOwnPropertyDescriptors(meta.owner), beforeOwner);
});

test("G18 projection rejects dense arrays with accessor elements without getter execution or mutation", () => {
  let getterCalls = 0; const candidates = ["one"];
  Object.defineProperty(candidates, "0", { enumerable: true, configurable: true, get() { getterCalls += 1; return "one"; } });
  const payload = projectionPayload({ request: { id: "request-accessor", candidates, continuation: { playerId: "player" } } }); const meta = projectionMeta();
  const beforePayload = Object.getOwnPropertyDescriptors(payload); const beforeRequest = Object.getOwnPropertyDescriptors(payload.request); const beforeCandidates = Object.getOwnPropertyDescriptors(candidates); const beforeContinuation = Object.getOwnPropertyDescriptors(payload.request.continuation); const beforeMeta = Object.getOwnPropertyDescriptors(meta); const beforeOwner = Object.getOwnPropertyDescriptors(meta.owner);
  let built;
  assert.doesNotThrow(() => { built = buildProjectionSpec(payload, meta); });
  assert.equal(built.ok, false); assert.equal(getterCalls, 0);
  assert.deepEqual(Object.getOwnPropertyDescriptors(payload), beforePayload); assert.deepEqual(Object.getOwnPropertyDescriptors(payload.request), beforeRequest); assert.deepEqual(Object.getOwnPropertyDescriptors(candidates), beforeCandidates); assert.deepEqual(Object.getOwnPropertyDescriptors(payload.request.continuation), beforeContinuation); assert.deepEqual(Object.getOwnPropertyDescriptors(meta), beforeMeta); assert.deepEqual(Object.getOwnPropertyDescriptors(meta.owner), beforeOwner);
});

test("G17 projection identity rejects every missing extra and tampered exact9 key without mutation", () => {
  const state = projectionState(); const spec = buildProjectionSpec(projectionPayload(), projectionMeta());
  const committed = commitProjection(state, { channel: "pending", spec: spec.spec, expected: { mode: "empty", slotRevision: 0 } });
  const replacements = { channel: "prompt", projectionId: "projection-other", runtime: "coordinator", scope: "draft", producerId: "test:other", ownerKind: "draft", ownerId: "owner-other", ownerRevision: committed.identity.ownerRevision + 1, actorId: "ai" };
  for (const key of Object.keys(committed.identity)) {
    const missing = { ...committed.identity }; delete missing[key];
    const extra = { ...committed.identity, extra: true };
    const tampered = { ...committed.identity, [key]: replacements[key] };
    for (const candidate of [missing, extra, tampered]) {
      const before = JSON.parse(JSON.stringify(state));
      assert.equal(clearProjection(state, candidate).ok, false, key);
      assert.deepEqual(state, before, key);
    }
  }
});

test("G17 projection restore safely copies JSON and preserves monotonic IDs", () => {
  const state = projectionState(); const spec = buildProjectionSpec(projectionPayload(), projectionMeta());
  const first = commitProjection(state, { channel: "pending", spec: spec.spec, expected: { mode: "empty", slotRevision: 0 } });
  const saved = JSON.parse(JSON.stringify(state.pending)); const cleared = clearProjection(state, first.identity);
  assert.equal(restoreProjection(state, cleared.clearToken, saved).ok, true);
  assert.equal(state.pending.resolutionMeta.projectionId, "projection-2");
  const second = clearProjection(state, state.pending.request.continuation.projectionIdentity);
  assert.equal(second.ok, true);
  assert.equal(commitProjection(state, { channel: "pending", spec: spec.spec, expected: { mode: "empty", slotRevision: second.clearToken.slotRevision } }).identity.projectionId, "projection-3");
});

test("G17 projection restore rejects accessors without throwing or mutating", () => {
  const state = projectionState(); const spec = buildProjectionSpec(projectionPayload(), projectionMeta());
  const committed = commitProjection(state, { channel: "pending", spec: spec.spec, expected: { mode: "empty", slotRevision: 0 } });
  const cleared = clearProjection(state, committed.identity); const before = JSON.parse(JSON.stringify(state));
  const accessor = {};
  Object.defineProperty(accessor, "resolutionMeta", { enumerable: true, get() { throw new Error("must not run"); } });
  assert.doesNotThrow(() => assert.equal(restoreProjection(state, cleared.clearToken, accessor).ok, false));
  assert.deepEqual(state, before);
});

test("G17 projection coordinator ticket actor must match metadata actor", () => {
  const ticket = { frameId: "frame-1", waitId: "wait-1", effectId: "effect-1", choiceId: "choice-1", revision: 0, actorId: "player" };
  assert.equal(buildProjectionSpec(projectionPayload(), projectionMeta({ runtime: "coordinator", ticket })).ok, true);
  assert.equal(buildProjectionSpec(projectionPayload(), projectionMeta({ runtime: "coordinator", actorId: "ai", ticket })).ok, false);
});

test("G17 selection projection writes an independent exact9 continuation identity", () => {
  const state = projectionState(); const spec = buildProjectionSpec(projectionPayload(), projectionMeta());
  const committed = commitProjection(state, { channel: "pending", spec: spec.spec, expected: { mode: "empty", slotRevision: 0 } });
  const continuationIdentity = state.pending.request.continuation.projectionIdentity;
  assert.deepEqual(continuationIdentity, committed.identity);
  assert.notEqual(continuationIdentity, committed.identity);
  assert.equal(Object.hasOwn(continuationIdentity, "resolutionMeta"), false);
});

test("SZTB-090 through SZTB-102 are catalogued in canonical ID order with available artwork", () => {
  const ids = Array.from({ length: 13 }, (_, index) => `SZTB-${String(index + 90).padStart(3, "0")}`);
  assert.deepEqual(LAB_CARD_IDS.filter((id) => id.startsWith("SZTB-")), ids);
  assert.deepEqual(ids.map((id) => CARD_LIBRARY[id]?.sourceId), ids.map((id) => id.replace("-", "")));
  assert.equal(CARD_LIBRARY["SZTB-090"].name, "アームズバンド・アマルガム");
  assert.equal(CARD_LIBRARY["SZTB-102"].name, "アームズバンド・ブートキャンプ");
  assert.deepEqual(Object.keys(CARD_ART).filter((id) => id.startsWith("SZTB-")).sort(), ids);
  assert.equal(BUILDABLE_CARDS.filter((card) => ids.includes(card.id)).length, 13);
});

test("SZTB-100 adds Amalgam layers to every matching layered card across both areas at each turn start", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const ai = state.players.ai;
  const provider = createCardInstance("SZTB-100", "player", 98990);
  const ownHost = createCardInstance("SZTB-092", "player", 98991);
  const enemyHost = createCardInstance("SZTB-093", "ai", 98992);
  const unrelatedLayered = createCardInstance("STD-103", "ai", 98993);
  provider.residentActive = true;
  player.back = [provider];
  player.front = [ownHost];
  ai.front = [enemyHost, unrelatedLayered];
  player.deck = [createCardInstance("STD-020", "player", 98994)];
  ai.deck = [
    createCardInstance("STD-020", "ai", 98995),
    createCardInstance("STD-021", "ai", 98996),
    createCardInstance("STD-022", "ai", 98997)
  ];

  startTurn(state, "ai");

  assert.equal(state.winner, null);
  assert.deepEqual(ownHost.mounted.map((card) => card.id), ["SZTB-090"]);
  assert.deepEqual(enemyHost.mounted.map((card) => card.id), ["SZTB-090"]);
  assert.equal(unrelatedLayered.mounted.length, 0);
  assert.equal(ownHost.mounted[0].owner, "player");
  assert.equal(enemyHost.mounted[0].owner, "player");
  assert.equal(state.events.at(-1).type, "card_generated");
  assert.equal(state.events.at(-1).amount, 2);
});

test("SZTB-101 grants the same Amalgam layer operation to own Arms Band layered Login and attack events", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const provider = createCardInstance("SZTB-101", "player", 98994);
  const host = createCardInstance("SZTB-092", "player", 98995);
  const enemyHost = createCardInstance("SZTB-093", "ai", 98996);
  provider.residentActive = true;
  player.back = [provider];
  player.front = [host];
  state.players.ai.front = [enemyHost];

  emitGameEvent(state, { type: "card_executed", playerId: "player", ownerId: "player", cardUid: host.uid,
    cardId: host.id, cardName: host.name, category: host.category });
  emitGameEvent(state, { type: "attack_declared", playerId: "player", ownerId: "player", cardUid: host.uid,
    cardId: host.id, cardName: host.name, category: host.category, attackerUid: host.uid });
  emitGameEvent(state, { type: "attack_declared", playerId: "ai", ownerId: "ai", cardUid: enemyHost.uid,
    cardId: enemyHost.id, cardName: enemyHost.name, category: enemyHost.category, attackerUid: enemyHost.uid });

  assert.deepEqual(host.mounted.map((card) => card.id), ["SZTB-090", "SZTB-090"]);
  assert.equal(enemyHost.mounted.length, 0);
});

test("SZTB-102 shares its activation and Update workflow and repeats salvage once per two consumed layers", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const script = player.hand.find((card) => card.id === "SZTB-102");
  player.hand.splice(player.hand.indexOf(script), 1);
  player.back = [script];
  script.faceDown = true;
  const host = createCardInstance("SZTB-092", "player", 98997);
  const layers = ["SZTB-090", "SZTB-091", "SZTB-092", "SZTB-093"]
    .map((id, index) => createCardInstance(id, "player", 98998 + index));
  for (const layer of layers) layer.layerRole = "layered";
  host.mounted = [...layers];
  player.front = [host];
  const firstSalvage = createCardInstance("SZTB-096", "player", 99010);
  player.trash = [firstSalvage];
  player.memory = 20;

  assert.equal(getActivatableEffects(state, "player", script).find((effect) => effect.kind === "update")?.enabled, false);
  assert.equal(activateScript(state, "player", script.uid), true);
  assert.equal(script.residentActive, true);
  toggleSelection(state.pending.request, firstSalvage.uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  for (const layer of layers) toggleSelection(state.pending.request, layer.uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.equal(state.pending.request.continuation.type, "runtime-repeat-select-move");
  toggleSelection(state.pending.request, layers[0].uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  toggleSelection(state.pending.request, layers[1].uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);

  assert.equal(state.pending, null);
  assert.equal(host.mounted.length, 0);
  assert.equal(player.hand.some((card) => card.uid === firstSalvage.uid), true);
  assert.equal(player.hand.some((card) => card.uid === layers[0].uid), true);
  assert.equal(player.hand.some((card) => card.uid === layers[1].uid), true);
  assert.equal(player.trash.length, 2);
  assert.equal(getActivatableEffects(state, "player", script).find((effect) => effect.kind === "update")?.enabled, true);
});

test("STD-112 draws through the shared attack event only for an own Hacking user attack", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const observer = player.hand.find((card) => card.id === "STD-112");
  player.hand.splice(player.hand.indexOf(observer), 1);
  player.back = [observer];
  player.deck = [createCardInstance("STD-020", "player", 99020)];
  const before = player.hand.length;

  emitGameEvent(state, { type: "attack_declared", playerId: "player", ownerId: "player",
    cardUid: "attacker", attackerUid: "attacker", targetUid: "ai-fortress", attackerKeywords: ["HACKING"] });
  assert.equal(player.hand.length, before + 1);

  emitGameEvent(state, { type: "attack_declared", playerId: "ai", ownerId: "ai",
    cardUid: "enemy-attacker", attackerUid: "enemy-attacker", targetUid: "player-fortress", attackerKeywords: ["HACKING"] });
  assert.equal(player.hand.length, before + 1);
});

test("Magazine prompts before Sp execution and can decline without consuming layers", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const spell = createCardInstance("SZTB-099", "player", 99001);
  const host = createCardInstance("SZTB-092", "player", 99002);
  const layer = createCardInstance("SZTB-090", "player", 99003);
  host.mounted = [layer];
  player.front = [host];
  player.hand.push(spell);
  player.memory = 10;

  const beforeMemory = player.memory;
  assert.equal(playCard(state, "player", spell.uid), true);
  assert.equal(state.pending.request.label, "弾倉：1を使用しますか？");
  setSelectionScope(state.pending.request, "使用しない");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.equal(player.memory, beforeMemory - executionCost(spell, state, "player"));
  assert.equal(host.mounted[0].uid, layer.uid);
  assert.equal(player.hand.length >= 2, true);
  assert.match(state.pending.request.label, /ジャケットの配置先/);
  setSelectionScope(state.pending.request, "フロント");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.ok(player.front.some((card) => card.id === "SZTB-091"));
  assert.ok(player.trash.some((card) => card.uid === spell.uid));
});

test("Magazine selects exact own layers, consumes them, and reduces execution memory", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const spell = createCardInstance("SZTB-097", "player", 99101);
  const host = createCardInstance("SZTB-094", "player", 99102);
  const first = createCardInstance("SZTB-090", "player", 99103);
  const second = createCardInstance("SZTB-091", "player", 99104);
  const accessed = createCardInstance("SZTB-093", "player", 99105);
  host.mounted = [first, second];
  player.front = [host];
  player.hand.push(spell);
  player.deck.push(accessed);
  player.memory = 3;

  assert.equal(playCard(state, "player", spell.uid), true);
  setSelectionScope(state.pending.request, "使用する");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.equal(state.pending.request.label, "弾倉：消費するレイヤーを2枚選択");
  toggleSelection(state.pending.request, first.uid);
  toggleSelection(state.pending.request, second.uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.equal(player.memory, 0);
  assert.equal(host.mounted.length, 0);
  assert.ok(player.trash.some((card) => card.uid === first.uid));
  assert.ok(player.trash.some((card) => card.uid === second.uid));
  setSelectionScope(state.pending.request, "①アームズバンドObへアクセス");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  toggleSelection(state.pending.request, accessed.uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  setSelectionScope(state.pending.request, "バック");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.ok(player.hand.some((card) => card.uid === accessed.uid));
  assert.ok(player.back.some((card) => card.id === "SZTB-091"));
  assert.ok(player.trash.some((card) => card.uid === spell.uid));
  assert.equal(state.events.some((event) => event.type === "layers_consumed" && event.amount === 2), true);
});

test("SZTB-096 and SZTB-098 resolve their printed bodies before Jacket generation", () => {
  const damageState = createGame({ mode: "lab" });
  const damagePlayer = damageState.players.player;
  const target = createCardInstance("SZTB-092", "ai", 99201);
  target.str = 20;
  damageState.players.ai.front = [target];
  const host = createCardInstance("SZTB-093", "player", 99202);
  damagePlayer.front = [host];
  const blitz = createCardInstance("SZTB-096", "player", 99203);
  damagePlayer.hand.push(blitz);
  damagePlayer.memory = 10;
  assert.equal(playCard(damageState, "player", blitz.uid, { targetUid: target.uid }), true);
  setSelectionScope(damageState.pending.request, "使用しない");
  resolveCardSelection(damageState, damageState.pending.request.continuation, confirmSelection(damageState.pending.request));
  assert.equal(target.damage, 5);
  assert.match(damageState.pending.request.label, /ジャケットの配置先/);

  const jamState = createGame({ mode: "lab" });
  const jamPlayer = jamState.players.player;
  const jamHost = createCardInstance("SZTB-094", "player", 99204);
  jamHost.sleep = true;
  jamHost.damage = 3;
  jamPlayer.front = [jamHost];
  const jam = createCardInstance("SZTB-098", "player", 99205);
  jamPlayer.hand.push(jam);
  jamPlayer.memory = 10;
  assert.equal(playCard(jamState, "player", jam.uid), true);
  setSelectionScope(jamState.pending.request, "使用しない");
  resolveCardSelection(jamState, jamState.pending.request.continuation, confirmSelection(jamState.pending.request));
  assert.equal(jamHost.damage, 0);
  assert.equal(jamHost.sleep, false);
  assert.equal(jamHost.permanentAtk, 1);
});

test("SZTB-095 reacts to Magazine layer consumption and replaces Sp trash once per turn", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const host = createCardInstance("SZTB-095", "player", 99301);
  const layer = createCardInstance("SZTB-090", "player", 99302);
  host.mounted = [layer];
  player.front = [host];
  const spell = createCardInstance("SZTB-099", "player", 99303);
  player.hand.push(spell);
  player.memory = 10;
  const beforeStr = state.players.ai.fortressStr;

  playCard(state, "player", spell.uid);
  setSelectionScope(state.pending.request, "使用する");
  resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request));
  toggleSelection(state.pending.request, layer.uid);
  resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request));
  assert.equal(state.players.ai.fortressStr, beforeStr - 1);
  setSelectionScope(state.pending.request, "フロント");
  resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request));
  assert.match(state.pending.request.label, /Spをレイヤーへ加える/);
  toggleSelection(state.pending.request, host.uid);
  resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request));
  assert.ok(host.mounted.some((card) => card.uid === spell.uid));
  assert.equal(player.trash.some((card) => card.uid === spell.uid), false);
  assert.equal(player.triggerUsage[`${host.uid}:sztb095-sp-replacement`], true);
});

test("SZTB-092 deals three damage to its declared attack target before normal attack damage", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  const player = state.players.player;
  const source = player.hand.find((card) => card.id === "SZTB-092");
  player.hand.splice(player.hand.indexOf(source), 1); player.front = [source];
  source.summoningSick = false; player.memory = 20;
  const before = state.players.ai.fortressStr;
  assert.equal(attack(state, "player", source.uid, "ai-fortress"), true);
  assert.equal(state.players.ai.fortressStr, before - cardAtk(state, "player", source) - 3);
});

test("SZTB-093 damages its attacker and places Jacket before battle starts", () => {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  const player = state.players.player;
  const ai = state.players.ai;
  const attacker = player.hand.find((card) => card.id === "STD-020");
  player.hand.splice(player.hand.indexOf(attacker), 1); player.front = [attacker];
  const defender = createCardInstance("SZTB-093", "ai", 99331);
  ai.front = [defender]; ai.back = [];
  attacker.summoningSick = false; attacker.atk = 0; defender.atk = 0; defender.sleep = true;
  const jacketsBefore = [...ai.front, ...ai.back].filter((card) => card.id === "SZTB-091").length;
  assert.equal(attack(state, "player", attacker.uid, defender.uid), true);
  assert.equal(attacker.damage, 2);
  assert.equal([...ai.front, ...ai.back].filter((card) => card.id === "SZTB-091").length, jacketsBefore + 1);
});

test("SZTB-094 can counter an opponent execution with an off-turn Magazine Sp", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const source = createCardInstance("SZTB-094", "player", 99401);
  player.front = [source];
  const spell = createCardInstance("SZTB-099", "player", 99402);
  player.hand.push(spell);
  player.memory = 10;
  const enemy = createCardInstance("STD-020", "ai", 99403);
  state.players.ai.hand.push(enemy);
  state.active = "ai";

  assert.equal(playCard(state, "ai", enemy.uid, { zone: "front" }), true);
  assert.match(state.pending.request.label, /\[弾倉\]Spを実行/);
  toggleSelection(state.pending.request, spell.uid);
  resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request));
  assert.equal(source.sleep, true);
  assert.equal(state.pending.request.label, "弾倉：1を使用しますか？");
});

test("SZTB-094 layers from hand and accesses on Login and turn end", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  player.hand = [];
  player.front = [];
  player.back = [];
  player.deck = [];
  player.memory = 10;
  const source = createCardInstance("SZTB-094", "player", 99501);
  const materials = [
    createCardInstance("SZTB-090", "player", 99502),
    createCardInstance("SZTB-091", "player", 99503),
    createCardInstance("SZTB-096", "player", 99504)
  ];
  const loginAccess = createCardInstance("SZTB-099", "player", 99505);
  const excludedLyd = createCardInstance("SZTB-092", "player", 99507);
  player.hand.push(source, ...materials);
  player.deck.push(loginAccess, excludedLyd);
  assert.equal(getLayeredRequirement(source).minimum, 3);
  assert.equal(getLayeredCandidates(state, "player", source).filter((entry) => entry.zoneName === "hand").length, 3);
  assert.equal(playLayeredCard(state, "player", source.uid, materials.map((card) => card.uid), "front"), true);
  assert.match(state.pending.request.label, /Ob以外のアームズバンド/);
  assert.equal(state.pending.request.candidates.includes(excludedLyd.uid), false);
  toggleSelection(state.pending.request, loginAccess.uid);
  resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request));
  assert.ok(player.hand.some((card) => card.uid === loginAccess.uid));

  const turnEndAccess = createCardInstance("SZTB-098", "player", 99506);
  player.deck.push(turnEndAccess);
  assert.equal(endTurn(state), false);
  assert.match(state.pending.request.label, /Ob以外のアームズバンド/);
});

test("SZTB-094 turn end resolves every snapped face-up copy before ending the turn", () => {
  const state = createGame({ mode: "lab" }); const player = state.players.player;
  const firstSource = createCardInstance("SZTB-094", "player", 995101); const secondSource = createCardInstance("SZTB-094", "player", 995102);
  const firstAccess = createCardInstance("SZTB-099", "player", 995103); const secondAccess = createCardInstance("SZTB-098", "player", 995104);
  player.hand = []; player.front = [firstSource, secondSource]; player.back = []; player.deck = [firstAccess, secondAccess];
  assert.equal(endTurn(state), false);
  assert.equal(state.pending?.request?.continuation?.type, "access-to-hand");
  assert.equal(state.std094TurnEndQueue?.entries.player.length, 1);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [firstAccess.uid] }), true);
  assert.equal(state.pending?.request?.continuation?.type, "access-to-hand");
  assert.equal(player.hand.some((card) => card.uid === firstAccess.uid), true);
  assert.equal(state.events.filter((event) => event.type === "turn_ended").length, 0);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [secondAccess.uid] }), true);
  assert.equal(player.hand.some((card) => card.uid === secondAccess.uid), true);
  assert.equal(state.events.filter((event) => event.type === "turn_ended").length, 1);
  assert.equal(state.turnNumber, 2);
  assert.equal(state.active, "player");
});

test("SZTB-094 turn end alternates the active and nonactive owners", () => {
  const state = createGame({ mode: "lab" }); const player = state.players.player; const ai = state.players.ai;
  const playerSource = createCardInstance("SZTB-094", "player", 995151); const aiSource = createCardInstance("SZTB-094", "ai", 995152);
  const playerAccess = createCardInstance("SZTB-099", "player", 995153); const aiAccess = createCardInstance("SZTB-098", "ai", 995154);
  player.hand = []; player.front = [playerSource]; player.back = []; player.deck = [playerAccess];
  ai.hand = []; ai.front = [aiSource]; ai.back = []; ai.deck = [aiAccess];
  assert.equal(endTurn(state), false);
  assert.equal(state.pending?.request?.continuation?.playerId, "player");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [playerAccess.uid] }), true);
  assert.equal(state.pending?.request?.continuation?.playerId, "ai");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [aiAccess.uid] }), true);
  assert.ok(player.hand.some((card) => card.uid === playerAccess.uid));
  assert.ok(ai.hand.some((card) => card.uid === aiAccess.uid));
  assert.equal(state.events.filter((event) => event.type === "turn_ended").length, 1);
});

test("SZTB-094 skips a snapped source that leaves the area before its turn-end effect", () => {
  const state = createGame({ mode: "lab" }); const player = state.players.player;
  const firstSource = createCardInstance("SZTB-094", "player", 995201); const secondSource = createCardInstance("SZTB-094", "player", 995202);
  const access = createCardInstance("SZTB-099", "player", 995203);
  player.hand = []; player.front = [firstSource, secondSource]; player.back = []; player.deck = [access];
  assert.equal(endTurn(state), false);
  player.front.splice(player.front.findIndex((card) => card.uid === secondSource.uid), 1);
  player.trash.push(secondSource);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, { selected: [access.uid] }), true);
  assert.equal(player.hand.some((card) => card.uid === access.uid), true);
  assert.equal(state.events.filter((event) => event.type === "turn_ended").length, 1);
  assert.equal(state.turnNumber, 2);
  assert.equal(state.active, "player");
});

test("SZTB-097 option two destroys an Ob within the selected own ATK total", () => {
  const state = createGame({ mode: "lab" });
  const player = state.players.player;
  const host = createCardInstance("SZTB-094", "player", 99601);
  const attacker = createCardInstance("SZTB-092", "player", 99602);
  attacker.atk = 4;
  player.front = [host, attacker];
  const target = createCardInstance("SZTB-093", "ai", 99603);
  target.str = 3;
  state.players.ai.front = [target];
  const spell = createCardInstance("SZTB-097", "player", 99604);
  player.hand.push(spell);
  player.memory = 10;

  playCard(state, "player", spell.uid);
  setSelectionScope(state.pending.request, "使用しない");
  resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request));
  setSelectionScope(state.pending.request, "②自分Obの合計ATK以下を破壊");
  resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request));
  toggleSelection(state.pending.request, attacker.uid);
  resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request));
  toggleSelection(state.pending.request, target.uid);
  resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request));
  assert.ok(state.players.ai.trash.some((card) => card.uid === target.uid));
  assert.equal(state.prompt?.type, "script-activation");
  assert.match(state.prompt?.detail ?? "", /自分Obが破壊された時/);
  assert.equal(declinePrompt(state), true);
  assert.match(state.pending.request.label, /ジャケットの配置先/);
});

function reachSztb097DestroySelection(configure = () => {}, targetId = "SZTB-093") {
  const state = createGame({ mode: "lab", rng: () => 0.5 });
  const player = state.players.player;
  const ai = state.players.ai;
  const host = createCardInstance("SZTB-094", "player", 99701);
  const contributor = createCardInstance("SZTB-092", "player", 99702);
  contributor.atk = 8;
  const target = createCardInstance(targetId, "ai", 99703);
  target.str = 3;
  const spell = createCardInstance("SZTB-097", "player", 99704);
  player.front = [host, contributor];
  player.back = [];
  player.hand = [spell];
  player.memory = 10;
  ai.front = [target];
  ai.back = [];
  configure({ state, player, ai, host, contributor, target, spell });

  assert.equal(playCard(state, "player", spell.uid), true);
  setSelectionScope(state.pending.request, "使用しない");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  setSelectionScope(state.pending.request, "②自分Obの合計ATK以下を破壊");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  toggleSelection(state.pending.request, contributor.uid);
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.equal(state.pending.request.continuation.type, "sztb097-destroy");
  return { state, player, ai, host, contributor, target, spell };
}

function resolveSztb097Jacket(state, player, spell) {
  assert.match(state.pending.request.label, /ジャケットの配置先/);
  assert.equal(player.trash.some((card) => card.uid === spell.uid), false);
  setSelectionScope(state.pending.request, "フロント");
  assert.equal(resolveCardSelection(state, state.pending.request.continuation, confirmSelection(state.pending.request)), true);
  assert.equal([...player.front, ...player.back].filter((card) => card.id === "SZTB-091").length, 1);
  assert.equal(player.trash.filter((card) => card.uid === spell.uid).length, 1);
}

test("SZTB-097 preserves a Protect result before Jacket and cleans the spell once", () => {
  const scenario = reachSztb097DestroySelection(({ target }) => { target.protect = 1; });
  toggleSelection(scenario.state.pending.request, scenario.target.uid);
  assert.equal(resolveCardSelection(scenario.state, scenario.state.pending.request.continuation, confirmSelection(scenario.state.pending.request)), true);
  assert.equal(scenario.ai.front.some((card) => card.uid === scenario.target.uid), true);
  assert.equal(scenario.target.protect, 0);
  resolveSztb097Jacket(scenario.state, scenario.player, scenario.spell);
});

test("SZTB-097 preserves the STD-099 replacement selections before Jacket", () => {
  const scenario = reachSztb097DestroySelection(({ ai }) => {
    const material = createCardInstance("STD-075", "ai", 99705);
    material.classes = ["レッドパンクス"];
    ai.back = [material];
    ai.hand = [createCardInstance("STD-099", "ai", 99706)];
  }, "STD-094");
  const material = scenario.ai.back[0];
  toggleSelection(scenario.state.pending.request, scenario.target.uid);
  assert.equal(resolveCardSelection(scenario.state, scenario.state.pending.request.continuation, confirmSelection(scenario.state.pending.request)), true);
  assert.equal(scenario.state.pending.request.continuation.type, "destruction-replacement-choice");
  assert.equal(scenario.player.trash.some((card) => card.uid === scenario.spell.uid), false);
  assert.equal(resolveCardSelection(scenario.state, scenario.state.pending.request.continuation, { scope: "STD-099で置換ログイン", selected: [] }), true);
  assert.equal(scenario.state.pending.request.continuation.type, "std099-replacement-materials");
  assert.equal(resolveCardSelection(scenario.state, scenario.state.pending.request.continuation, { selected: [material.uid] }), true);
  assert.equal(scenario.ai.front.some((card) => card.id === "STD-099"), true);
  resolveSztb097Jacket(scenario.state, scenario.player, scenario.spell);
});

test("SZTB-097 keeps an STD-003 prompt and resumes cleanup once after accept or decline", () => {
  for (const decision of ["decline", "activate"]) {
    const scenario = reachSztb097DestroySelection(({ player }) => {
      const script = createCardInstance("STD-003", "player", decision === "decline" ? 99707 : 99708);
      script.faceDown = true;
      player.back = [script];
    });
    const script = scenario.player.back.find((card) => card.id === "STD-003");
    toggleSelection(scenario.state.pending.request, scenario.target.uid);
    assert.equal(resolveCardSelection(scenario.state, scenario.state.pending.request.continuation, confirmSelection(scenario.state.pending.request)), true);
    assert.equal(scenario.state.prompt?.scriptUid, script.uid);
    assert.equal(scenario.player.trash.some((card) => card.uid === scenario.spell.uid), false);
    if (decision === "activate") assert.equal(activateScript(scenario.state, "player", script.uid), true);
    else assert.equal(declinePrompt(scenario.state), true);
    resolveSztb097Jacket(scenario.state, scenario.player, scenario.spell);
  }
});

// CPU policy (src/adapters/simple-ai-policy.js). Kept in this file because `pnpm test` runs an explicit file list.
{
  const redeploy = cardRef => ({ actionId: `action:${cardRef}`, kind: 'fixed', action: { type: 'redeploy', cardRef, destination: { zone: 'back', slot: 0 } } });
  const endTurn = { actionId: 'action:end', kind: 'fixed', action: { type: 'endTurn' } };
  const query = ({ matchId, seat = 'cpu', turn, legalActions }) => ({
    status: { matchId, revision: 7, viewerSeat: seat }, observation: { turnNumber: turn },
    requiredInput: null, legalActions
  });
  const pick = (q, id) => chooseSimpleAiIntent(q, id).value.action;

  test('the CPU re-executes the same card at most once per turn and ends the turn instead of looping', () => {
    const legalActions = [redeploy('r:a'), endTurn];
    const mk = turn => query({ matchId: 'ai-limit-1', turn, legalActions });
    assert.equal(pick(mk(5), 'c1').type, 'redeploy');
    assert.equal(pick(mk(5), 'c2').type, 'endTurn', 'a second re-execution of the same card in the same turn is skipped');
    assert.equal(pick(mk(7), 'c3').type, 'redeploy', 'the allowance returns on the next turn');
  });

  test('the CPU activates the same card effect at most once per turn (cost-neutral effects must not loop)', () => {
    // STD-196 swapped with a memory-recovering card made the CPU activate it for ever (start-purple mirror, seed 31).
    const effect = ref => ({ actionId: `action:eff:${ref}`, kind: 'fixed', actionType: 'activateCardEffect', action: { type: 'activateCardEffect', cardRef: ref, effectKey: 'effect:x', targets: [] } });
    const legalActions = [effect('r:a'), effect('r:b'), endTurn];
    const mk = turn => query({ matchId: 'ai-limit-effect', turn, legalActions });
    assert.equal(pick(mk(9), 'c1').cardRef, 'r:a');
    assert.equal(pick(mk(9), 'c2').cardRef, 'r:b');
    assert.equal(pick(mk(9), 'c3').type, 'endTurn');
    assert.equal(pick(mk(11), 'c4').cardRef, 'r:a', 'the allowance returns on the next turn');
  });

  test('the CPU re-execution allowance is tracked per card, match and seat', () => {
    const both = [redeploy('r:a'), redeploy('r:b'), endTurn];
    const first = pick(query({ matchId: 'ai-limit-2', turn: 3, legalActions: both }), 'c1');
    assert.deepEqual([first.type, first.cardRef], ['redeploy', 'r:a']);
    const second = pick(query({ matchId: 'ai-limit-2', turn: 3, legalActions: both }), 'c2');
    assert.deepEqual([second.type, second.cardRef], ['redeploy', 'r:b'], 'another card is still allowed');
    assert.equal(pick(query({ matchId: 'ai-limit-2', turn: 3, legalActions: both }), 'c3').type, 'endTurn');
    assert.equal(pick(query({ matchId: 'ai-limit-3', turn: 3, legalActions: both }), 'c4').type, 'redeploy', 'a different match is independent');
    assert.equal(pick(query({ matchId: 'ai-limit-2', seat: 'other', turn: 3, legalActions: both }), 'c5').type, 'redeploy', 'a different seat is independent');
  });

  const pickInput = options => ({
    choiceId: 'choice:7:selection', kind: 'selection', presentationKey: 'card', actorSeat: 'cpu', canAnswer: true, optional: false,
    constraints: { kind: 'pick', minimum: 1, maximum: 1, aggregate: null, groups: [] }, options: options.map(optionId => ({ optionId }))
  });
  const answerQuery = (matchId, revision, options = ['o1', 'o2', 'o3']) => ({
    status: { matchId, revision, viewerSeat: 'cpu' }, observation: { turnNumber: 4 }, legalActions: [], requiredInput: pickInput(options)
  });
  const answered = q => chooseSimpleAiIntent(q, 'c').value.action.optionIds[0];

  test('the CPU tries a different option when the same required input comes back at the same revision', () => {
    // A rejected answer leaves the revision unchanged; repeating it would never advance the match.
    assert.equal(answered(answerQuery('ai-answer-1', 12)), 'o1');
    assert.equal(answered(answerQuery('ai-answer-1', 12)), 'o2');
    assert.equal(answered(answerQuery('ai-answer-1', 12)), 'o3');
    assert.equal(answered(answerQuery('ai-answer-1', 12)), 'o1', 'wraps around after every option was tried');
    assert.equal(answered(answerQuery('ai-answer-1', 13)), 'o1', 'a new revision starts again from the first option');
    assert.equal(answered(answerQuery('ai-answer-2', 13)), 'o1', 'another match is independent');
  });

  test('the CPU keeps its opening hand when keeping is legal and still mulligans in the legacy opening', () => {
    const mulligan = { actionId: 'action:mull', kind: 'fixed', action: { type: 'openingMulligan' } };
    const keep = { actionId: 'action:keep', kind: 'fixed', action: { type: 'keepOpeningHand' } };
    assert.equal(pick(query({ matchId: 'ai-open-1', turn: 1, legalActions: [mulligan, keep] }), 'c1').type, 'keepOpeningHand');
    assert.equal(pick(query({ matchId: 'ai-open-2', turn: 1, legalActions: [mulligan, endTurn] }), 'c2').type, 'openingMulligan');
  });

  test('the CPU reports no legal action instead of repeating a spent re-execution', () => {
    const q = query({ matchId: 'ai-limit-4', turn: 2, legalActions: [redeploy('r:a')] });
    assert.equal(chooseSimpleAiIntent(q, 'c1').ok, true);
    const exhausted = chooseSimpleAiIntent(q, 'c2');
    assert.equal(exhausted.ok, false);
    assert.equal(exhausted.error.code, 'AI_NO_LEGAL_ACTION');
  });
}
