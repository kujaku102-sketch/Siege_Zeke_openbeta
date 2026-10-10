import { CARD_LIBRARY, LAB_CARD_IDS, NEUTRON_DECK, RED_DECK, USER_CARDS, USERS, VENGEANCE_DECK, YELLOW_DECK } from "../data/cards.js";
import { createRuntimeCard, createRuntimeToken, expandRuntimeDeck, RuntimeError } from "./runtime/factory.js";
import { nextRng } from "./runtime/rng.js";
import { compileEffectText, hasKeyword, keywordValue } from "./effect-compiler.js";
import { describeOperation, resultCountGate } from "./effect-operation-library.js";
import { createAllocationSpec, createChoiceSpec, createSelectionRequest, createSelectionSpec, isSelectionRequestFeasible, selectionRequestFromSpec } from "./selection-model.js";
import { hasOptionalActivationSpec, optionalSpecsForCard, specsForEvent } from "./trigger-specs.js";
import { collectActivationWindows, createEventContext, createScriptActivationWindow } from "./activation-windows.js";
import { evaluatePlacement } from "./placement-policy.js";
import { normalizeLayerState } from "./layer-state.js";
import { boardSlotOf, cardAtBoardSlot, inheritBoardSlot, normalizeBoardSlots, normalizeZoneSlots, placeCardInBoardSlot, projectZoneSlots, swapBoardSlots } from "./board-slots.js";
import { flattenMaterialStack, flattenedLayerCount, flattenedLayers, layeredCandidates, layeredSpecFor, normalizeMountedStack, validatesLayeredSelection } from "./layered-specs.js";
import { battleStatModifierSpecsFor, cardPlacementCostSpec, cardRuntimeRoute, cardRuntimeSpec } from "./card-runtime-specs.js";
import { damageModifierSpecsFor } from "./damage-modifier-specs.js";
import { isLydCard, isObCard, isObCategory, matchesCardCategory } from "./card-types.js";
import {
  conditionalKeywordSpecsFor,
  continuousStatModifierSpecsFor,
  destructionPermissionSpecsFor,
  attackPermissionSpecsFor,
  auraKeywordSpecsFor,
  executionCostModifierSpecsFor,
  mountedKeywordSpecsFor,
  mountEventSpecsFor,
  mountedStatModifierSpecsFor,
  placementPermissionSpecsFor,
  playerValueModifierSpecsFor,
  mandatoryStateCheckSpecsFor
} from "./continuous-effect-specs.js";

const otherPlayer = (id) => id === "player" ? "ai" : "player";
const PROJECTION_CHANNELS = new Set(["pending", "prompt"]);
const PROJECTION_SCOPES = new Set(["draft", "internal", "declaration", "separate"]);
const PROJECTION_RUNTIMES = new Set(["legacy", "coordinator"]);
const DECLARED_IF_SCRIPT_IDS = new Set(["STD-001", "STD-002", "STD-003", "STD-018", "STD-019", "STD-036", "STD-037", "STD-038", "STD-139", "STD-140", "STD-148"]);
const NORMAL_IF_SCRIPT_IDS = new Set(["STD-001", "STD-002", "STD-003", "STD-036", "STD-037", "STD-139", "STD-140", "STD-148"]);
const EVENT_CONTEXT_REQUIRED_IF_IDS = new Set(["STD-018", "STD-019", "STD-038", "STD-204"]);
const PROJECTION_OWNER_KINDS = new Set(["legacy-root", "draft", "candidate", "coordinator-frame", "separate"]);
const STD121_PLACEMENT_PERMIT = Symbol("STD-121 placement cost paid");

const exactKeys = (value, keys) => isPlainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const isPlainObject = (value) => value !== null && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
const isCounter = (value) => Number.isSafeInteger(value) && value >= 0;
const IDENTITY_KEYS = ["channel", "projectionId", "runtime", "scope", "producerId", "ownerKind", "ownerId", "ownerRevision", "actorId"];
const META_KEYS = ["version", "runtime", "channel", "scope", "producerId", "owner", "actorId", "ticket"];
const TICKET_KEYS = ["frameId", "waitId", "effectId", "choiceId", "revision", "actorId"];

export function supportsNormalScriptActivation(card) {
  if (card?.category !== "Script" || EVENT_CONTEXT_REQUIRED_IF_IDS.has(card.id)) return false;
  const condition = keywordValue(card, "IF");
  if (condition) return NORMAL_IF_SCRIPT_IDS.has(card.id);
  return !hasOptionalActivationSpec(card.id);
}

function overclockChoice(card) {
  return String(card?.text ?? "").match(/\[OC\+(\d+)\]/i);
}

// Direct hand execution can prepare only entries whose extra input does not
// precede placement. Login choices happen after placement and remain a later
// continuation; OC, Layered material and placement-cost input do not.
export function supportsDirectHandObExecution(card) {
  return Boolean(card && isObCategory(card.category) && !overclockChoice(card)
    && !Number.isFinite(card.setupCost) && !layeredSpecFor(card) && !cardPlacementCostSpec(card.id));
}

function relogPreparationKind(card, layerCount = flattenedLayerCount(card)) {
  const compiled = compileEffectText(card?.text ?? "", { category: card?.category, id: card?.id });
  const operationTypes = new Set((compiled.operations ?? []).map((operation) => operation.type));
  if (operationTypes.has("registry_executable_and_logout_install_self")
    || operationTypes.has("logout_registry_replacement_and_registry_execute")) return "registry";
  if (layerCount > 0 && operationTypes.has("replace_move_cost")) return "payment-choice";
  return "normal";
}

export function canDirectRelogAtSlot(state, playerId, card, { sourceZone, zone, requestedSlot, layerCount = null } = {}) {
  const player = state?.players?.[playerId];
  if (!player || state.active !== playerId || !isObCard(card)) return { ok: false };
  const effectiveLayerCount = layerCount === null ? flattenedLayerCount(card) : layerCount;
  if (!Number.isSafeInteger(effectiveLayerCount) || effectiveLayerCount < 0 || Object.is(effectiveLayerCount, -0)) return { ok: false };
  if (!["front", "back"].includes(sourceZone) || !["front", "back"].includes(zone)
    || sourceZone === zone || sourceZone !== (zone === "front" ? "back" : "front")) return { ok: false };
  if (relogPreparationKind(card, effectiveLayerCount) !== "normal") return { ok: false };
  const slot = requestedExecutionSlot(state, playerId, card, { zone, requestedSlot });
  if (!slot.ok) return slot;
  if (!placementResult(player, zone).ok) return { ok: false };
  if (player.memory < Number(card.cost ?? 0)) return { ok: false };
  return { ok: true };
}

// JSON.stringify is deliberately not used here: it silently drops values and
// structuredClone accepts several values that cannot be persisted as JSON.
function jsonCopy(value, ancestors = new Set()) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return { ok: true, value };
  if (typeof value === "number") return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  if (typeof value !== "object" || ancestors.has(value)) return { ok: false };
  let descriptors; let keys; let names; let isArray;
  try {
    isArray = Array.isArray(value);
    if (Object.getOwnPropertySymbols(value).length || (!isArray && !isPlainObject(value))) return { ok: false };
    descriptors = Object.getOwnPropertyDescriptors(value); keys = Object.keys(value); names = Object.getOwnPropertyNames(value);
  } catch { return { ok: false }; }
  if (isArray) {
    const length = descriptors.length;
    if (!length || !Object.hasOwn(length, "value") || length.enumerable || !Number.isSafeInteger(length.value) || length.value < 0
      || names.length !== keys.length + 1 || names.some((key) => key !== "length" && !keys.includes(key))
      || keys.length !== length.value || keys.some((key, index) => key !== String(index))) return { ok: false };
  } else if (names.length !== keys.length) return { ok: false };
  if (keys.some((key) => !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], "value"))) return { ok: false };
  const nextAncestors = new Set(ancestors); nextAncestors.add(value);
  const copy = isArray ? [] : {};
  for (const key of keys) { const child = jsonCopy(descriptors[key].value, nextAncestors); if (!child.ok) return child; copy[key] = child.value; }
  return { ok: true, value: copy };
}

function validTicket(ticket) {
  return exactKeys(ticket, TICKET_KEYS) && ["frameId", "waitId", "effectId", "choiceId"].every((key) => isNonEmptyString(ticket[key]))
    && isCounter(ticket.revision) && ["player", "ai"].includes(ticket.actorId);
}

function validMeta(meta) {
  return exactKeys(meta, META_KEYS) && meta.version === 1 && PROJECTION_RUNTIMES.has(meta.runtime) && PROJECTION_CHANNELS.has(meta.channel)
    && PROJECTION_SCOPES.has(meta.scope) && isNonEmptyString(meta.producerId) && exactKeys(meta.owner, ["kind", "id", "revision"])
    && PROJECTION_OWNER_KINDS.has(meta.owner.kind) && isNonEmptyString(meta.owner.id) && isCounter(meta.owner.revision)
    && ["player", "ai"].includes(meta.actorId) && (meta.runtime === "legacy" ? meta.ticket === null : validTicket(meta.ticket) && meta.ticket.actorId === meta.actorId);
}

function validStoredMeta(meta) {
  const baseMeta = isPlainObject(meta) ? Object.fromEntries(META_KEYS.map((key) => [key, meta[key]])) : null;
  return exactKeys(meta, [...META_KEYS, "projectionId"]) && isNonEmptyString(meta.projectionId) && validMeta(baseMeta);
}

function validIdentity(identity) {
  return exactKeys(identity, IDENTITY_KEYS) && PROJECTION_CHANNELS.has(identity.channel) && isNonEmptyString(identity.projectionId)
    && PROJECTION_RUNTIMES.has(identity.runtime) && PROJECTION_SCOPES.has(identity.scope) && isNonEmptyString(identity.producerId)
    && PROJECTION_OWNER_KINDS.has(identity.ownerKind) && isNonEmptyString(identity.ownerId) && isCounter(identity.ownerRevision)
    && ["player", "ai"].includes(identity.actorId);
}

function projectionIdentity(projection) {
  const meta = projection?.resolutionMeta;
  if (!validStoredMeta(meta)) return null;
  const identity = { channel: meta.channel, projectionId: meta.projectionId, runtime: meta.runtime, scope: meta.scope,
    producerId: meta.producerId, ownerKind: meta.owner.kind, ownerId: meta.owner.id, ownerRevision: meta.owner.revision, actorId: meta.actorId };
  return validIdentity(identity) ? identity : null;
}

function sameProjectionIdentity(left, right) {
  return validIdentity(left) && validIdentity(right) && IDENTITY_KEYS.every((key) => left[key] === right[key]);
}

function validCounters(state, channel) {
  return isPlainObject(state) && isCounter(state.projectionSerial) && isPlainObject(state.projectionSlotRevision) && isCounter(state.projectionSlotRevision[channel]);
}

export function coordinatorProjectionBlocked(state) {
  return state?.resolutionRuntime === "coordinator" || state?.resolutionCoordinator?.activeFrame != null;
}

export function buildProjectionSpec(payload, metaBase) {
  const payloadCopy = jsonCopy(payload); const metaCopy = jsonCopy(metaBase);
  if (!payloadCopy.ok || !metaCopy.ok || !isPlainObject(payloadCopy.value) || Object.hasOwn(payloadCopy.value, "resolutionMeta") || !validMeta(metaCopy.value)) return { ok: false, reason: "invalid-spec" };
  return { ok: true, spec: { payload: payloadCopy.value, meta: metaCopy.value } };
}

function validExpected(expected, channel, revision) {
  if (exactKeys(expected, ["mode", "slotRevision"]) && expected.mode === "empty") return expected.slotRevision === revision;
  return validIdentity(expected) && expected.channel === channel;
}

export function commitProjection(state, { channel, spec, expected } = {}) {
  if (!PROJECTION_CHANNELS.has(channel) || coordinatorProjectionBlocked(state) || !validCounters(state, channel) || !validExpected(expected, channel, state.projectionSlotRevision[channel])) return { ok: false, reason: "invalid-commit" };
  const rebuilt = buildProjectionSpec(spec?.payload, spec?.meta);
  if (!rebuilt.ok || rebuilt.spec.meta.channel !== channel) return { ok: false, reason: "invalid-commit" };
  const current = state[channel]; const revision = state.projectionSlotRevision[channel];
  if (expected.mode === "empty" ? current !== null : !sameProjectionIdentity(projectionIdentity(current), expected)) return { ok: false, reason: "stale" };
  const nextRevision = revision + 1; const nextSerial = state.projectionSerial + 1;
  if (!isCounter(nextRevision) || !isCounter(nextSerial)) return { ok: false, reason: "invalid-commit" };
  const projection = { ...rebuilt.spec.payload, resolutionMeta: { ...rebuilt.spec.meta, projectionId: `projection-${nextSerial}`, owner: { ...rebuilt.spec.meta.owner, revision: nextRevision } } };
  const identity = projectionIdentity(projection);
  if (!identity) return { ok: false, reason: "invalid-commit" };
  if (projection.type === "selection" && isPlainObject(projection.request) && isPlainObject(projection.request.continuation)) {
    projection.request.continuation.projectionIdentity = { ...identity };
  }
  state.projectionSerial = nextSerial; state.projectionSlotRevision[channel] = nextRevision; state[channel] = projection;
  return { ok: true, projection, identity };
}

export function validateProjection(state, expectedIdentity, { allowedScopes = null, actorId = expectedIdentity?.actorId } = {}) {
  if (!validIdentity(expectedIdentity) || !["player", "ai"].includes(actorId) || (allowedScopes !== null && (!Array.isArray(allowedScopes) || allowedScopes.some((scope) => !PROJECTION_SCOPES.has(scope))))) return { ok: false, reason: "invalid-identity" };
  const projection = state?.[expectedIdentity.channel]; const identity = projectionIdentity(projection);
  if (!sameProjectionIdentity(identity, expectedIdentity) || identity.actorId !== actorId || (allowedScopes && !allowedScopes.includes(identity.scope))) return { ok: false, reason: "stale" };
  return { ok: true, projection };
}

export function clearProjection(state, expectedIdentity) {
  const checked = validateProjection(state, expectedIdentity); const channel = expectedIdentity?.channel;
  if (!checked.ok || !validCounters(state, channel)) return checked.ok ? { ok: false, reason: "invalid-clear" } : checked;
  const slotRevision = state.projectionSlotRevision[channel] + 1; if (!isCounter(slotRevision)) return { ok: false, reason: "invalid-clear" };
  state[channel] = null; state.projectionSlotRevision[channel] = slotRevision;
  return { ok: true, clearToken: { identity: { ...expectedIdentity }, slotRevision } };
}

export function replaceProjection(state, expectedIdentity, nextSpec) {
  const channel = expectedIdentity?.channel;
  if (!validIdentity(expectedIdentity) || !validCounters(state, channel) || coordinatorProjectionBlocked(state)) return { ok: false, reason: "invalid-replace" };
  const checked = validateProjection(state, expectedIdentity); const rebuilt = buildProjectionSpec(nextSpec?.payload, nextSpec?.meta);
  if (!checked.ok || !rebuilt.ok || rebuilt.spec.meta.channel !== channel) return { ok: false, reason: checked.ok ? "invalid-replace" : checked.reason };
  return commitProjection(state, { channel, spec: rebuilt.spec, expected: expectedIdentity });
}

export function restoreProjection(state, clearToken, savedProjection) {
  if (!exactKeys(clearToken, ["identity", "slotRevision"]) || !validIdentity(clearToken.identity) || !isCounter(clearToken.slotRevision)) return { ok: false, reason: "invalid-restore" };
  const savedCopy = jsonCopy(savedProjection);
  if (!savedCopy.ok || !isPlainObject(savedCopy.value)) return { ok: false, reason: "invalid-restore" };
  const { identity } = clearToken; const channel = identity.channel;
  if (!validCounters(state, channel) || coordinatorProjectionBlocked(state) || state[channel] !== null || state.projectionSlotRevision[channel] !== clearToken.slotRevision) return { ok: false, reason: "stale" };
  const savedIdentity = projectionIdentity(savedCopy.value);
  if (!sameProjectionIdentity(savedIdentity, identity)) return { ok: false, reason: "owner" };
  const payload = { ...savedCopy.value }; delete payload.resolutionMeta;
  const meta = { ...savedCopy.value.resolutionMeta }; delete meta.projectionId;
  const spec = buildProjectionSpec(payload, meta);
  if (!spec.ok) return spec;
  return commitProjection(state, { channel, spec: spec.spec, expected: { mode: "empty", slotRevision: clearToken.slotRevision } });
}

function legacyProjectionMeta(state, pending, metaBase) {
  if (!isPlainObject(metaBase) || !PROJECTION_SCOPES.has(metaBase.scope) || !isNonEmptyString(metaBase.producerId)
    || !PROJECTION_OWNER_KINDS.has(metaBase.ownerKind) || !["player", "ai"].includes(metaBase.actorId)) return null;
  const ownerId = metaBase.ownerId ?? state.effectResolution?.id ?? `legacy-${state.legacyProjectionOwnerSerial + 1}`;
  return { version: 1, runtime: "legacy", channel: "pending", scope: metaBase.scope, producerId: metaBase.producerId,
    owner: { kind: metaBase.ownerKind, id: ownerId, revision: 0 }, actorId: metaBase.actorId, ticket: null };
}
const classKey = (value) => String(value ?? "").replaceAll("・", "").trim();
const isElectronFairy = (card) => {
  const values = card.classes ?? card.cardClass ?? [];
  return (Array.isArray(values) ? values : String(values).split(/[\/／]/)).some((value) => classKey(value) === "エレクトロンフェアリー");
};
const isSlashSpell = (card) => card.category === "Sp" && card.name.startsWith("/") && card.name.endsWith("/*");
function moveCardToTrash(state, ownerId, card, source = "移動", { suppressScriptWindow = false, fromArea = false, ruleDestruction = null } = {}) {
  const owner = state.players[ownerId];
  if (!suppressScriptWindow && !state.winner && owner.trashBanUntilTurn !== state.turnNumber) {
    const scriptOwnerId = otherPlayer(ownerId);
    const scriptOwner = state.players[scriptOwnerId];
    const script = scriptOwner.back.find((candidate) => candidate.id === "STD-003" && candidate.faceDown === true
      && scriptOwner.memory >= Number(candidate.cost ?? 0));
    if (script) {
      (state.deferredTrashMoves ??= []).push({ ownerId, card, source, fromArea, ruleDestruction });
      const alreadyQueued = state.prompt?.scriptUid === script.uid
        || state.scriptActivationQueue.some((entry) => entry.prompt?.scriptUid === script.uid);
      if (!alreadyQueued) openScriptActivationWindow(state, scriptOwnerId, script, {
          type: "card_would_move_to_trash", ownerId, playerId: ownerId,
          cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category, source
        });
      return "deferred";
    }
  }
  if (owner.trashBanUntilTurn === state.turnNumber) {
    owner.ban.push(card);
    distributeLayeredFollowers(state, card, "ban", source);
    addLog(state, `${source}: ${card.name}のゴミ箱移動をBANへ置換。`, "effect");
    if (ruleDestruction) finalizeRuleDestruction(state, ownerId, card, { ...ruleDestruction, to: "ban" });
    return "ban";
  }
  owner.trash.push(card);
  distributeLayeredFollowers(state, card, "trash", source);
  if (fromArea) executeCardRuntimeSpec(state, "area_to_trash", ownerId, card);
  if (ruleDestruction) finalizeRuleDestruction(state, ownerId, card, { ...ruleDestruction, to: "trash" });
  return "trash";
}

function resumeDeferredTrashMove(state) {
  if (state.prompt || !state.deferredTrashMoves?.length) return false;
  let resumed = false;
  while (!state.prompt && state.deferredTrashMoves.length) {
    const deferred = state.deferredTrashMoves.shift();
    moveCardToTrash(state, deferred.ownerId, deferred.card, deferred.source, {
      suppressScriptWindow: true,
      fromArea: deferred.fromArea,
      ruleDestruction: deferred.ruleDestruction
    });
    if (deferred.fromArea) resolveLogoutAfterAreaExit(state, deferred.ownerId, deferred.card);
    resumed = true;
  }
  if (resumed) resumeStd230AmbushCleanup(state);
  return resumed;
}

function clearComponents(target) {
  target.grantedKeywords = [];
  target.timedModifiers = [];
  target.damageModifiers = [];
  target.permanentAtk = 0;
  target.permanentStr = 0;
  target.tempAtk = 0;
  target.tempStr = 0;
  target.protect = 0;
  target.backup = 0;
  target.load = 0;
  target.counters = {};
  target.turnCostModifier = 0;
  delete target.revealedExecutionCost;
}
const backupLimit = (card) => {
  const match = String(card?.text ?? "").match(/\[バックアップ(?:[:：](\d+))?\]/);
  return match ? Number(match[1] ?? 1) : 0;
};

function resolveMountedSourceTrigger(state, playerId, host, source) {
  const specs = source ? mountEventSpecsFor(source.id).filter((spec) => spec.event === "ob_mounted_on_source") : [];
  if (!specs.length) return false;
  const layerIndex = host.mounted.findIndex((card) => card.uid === source.uid);
  if (layerIndex < 0) return false;
  for (const spec of specs) for (const action of spec.actions) {
    if (action.type === "grant_backup" && action.target === "mounted_host") host.backup = Number(host.backup ?? 0) + Number(action.amount ?? 0);
    else if (action.type === "grant_protect" && action.target === "mounted_host") host.protect = Number(host.protect ?? 0) + Number(action.amount ?? 0);
    else if (action.type === "modify_stats" && action.target === "mounted_host") {
      host.permanentAtk = Number(host.permanentAtk ?? 0) + Number(action.atk ?? 0);
      host.permanentStr = Number(host.permanentStr ?? 0) + Number(action.str ?? 0);
    } else if (action.type === "draw" && action.target === "source_controller") drawCards(state, playerId, Number(action.amount ?? 0));
    else if (action.type === "destroy" && action.target === "source_layer") {
      const currentIndex = host.mounted.findIndex((card) => card.uid === source.uid);
      if (currentIndex < 0) continue;
      host.mounted.splice(currentIndex, 1);
      moveCardToTrash(state, source.owner ?? playerId, source, `${source.name}のマウント誘発`);
      state.turnStats.destroyedCards += 1;
      addLog(state, `${source.name}のマウント誘発: ${source.name}を破壊。`, "damage");
      emitGameEvent(state, {
        type: "card_destroyed", playerId, ownerId: source.owner ?? playerId,
        cardUid: source.uid, cardId: source.id, cardName: source.name,
        category: source.category, from: "layer", source: `${source.name}のマウント誘発`
      });
    } else throw new Error(`Unsupported mount event action: ${action.type}`);
  }
  addLog(state, `${source.name}: ${host.name}へマウント誘発を適用。`, "effect");
  return true;
}

function shuffle(items, rng = Math.random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function runtimeRng(context) {
  return () => {
    const result = nextRng(context.rngState);
    if (!result.ok) throw new RuntimeError(result.error.code);
    context.rngState = result.value.state;
    return result.value.value;
  };
}

function normalizeClasses(instance) {
  const values = instance.classes ?? instance.cardClass ?? instance.className ?? instance.class
    ?? instance.affiliation ?? instance.tribe ?? instance.species ?? instance["所属"] ?? instance["種族"] ?? [];
  return [...new Set((Array.isArray(values) ? values : String(values).split(/[\/／]/))
    .map((value) => String(value).trim()).filter(Boolean))];
}

function hydrateCard(instance) {
  if (!cardRuntimeRoute(instance.id)) throw new Error(`Unregistered card runtime: ${instance.id}`);
  const compiled = compileEffectText(instance.text, { category: instance.category, id: instance.id });
  const printedCategory = instance.printedCategory ?? instance.category;
  return normalizeLayerState({
    ...instance,
    category: instance.category === "LOb" ? "Ob" : instance.category,
    printedCategory,
    classes: normalizeClasses(instance),
    compiled,
    protect: Number(instance.protect ?? keywordValue({ ...instance, compiled }, "PROTECT") ?? 0)
  });
}

function buildPlayer(id, user, deck) {
  return {
    id,
    user: { ...user },
    fortressStr: user.maxStr,
    baseMemory: user.memory,
    permanentMemory: 0,
    memory: user.memory,
    turboActive: false,
    turboUsed: false,
    userAbilityUsed: false,
    mulligansUsed: 0,
    firstRegistryInstallResolved: false,
    firstObExecutionTurn: null,
    deck: deck.map(hydrateCard),
    hand: [],
    front: [],
    back: [],
    registry: [],
    trash: [],
    ban: [],
    virtual: [],
    incidentsTriggered: [],
    installedThisTurn: false,
    registryActionUsed: false,
    scriptUsage: {},
    triggerUsage: {},
    turnsTaken: 0,
    forceAttack: false
  };
}

function pullCard(deck, cardId) {
  const index = deck.findIndex((card) => card.id === cardId);
  if (index < 0) throw new Error(`Tutorial card missing: ${cardId}`);
  return deck.splice(index, 1)[0];
}

function arrangeTutorial(players) {
  players.player.hand = ["STD-076", "STD-075", "STD-090", "STD-086"].map((id) => pullCard(players.player.deck, id));
  players.ai.hand = ["STD-125", "STD-131", "STD-149"].map((id) => pullCard(players.ai.deck, id));
  // 後攻AIの2ドローを固定。末尾が山札上。
  const george = pullCard(players.ai.deck, "STD-129");
  const bash = pullCard(players.ai.deck, "STD-138");
  players.ai.deck.push(george, bash);
}

function arrangeVengeanceTutorial(players, runtimeContext = null) {
  players.player.hand = [
    hydrateCard(createRuntimeCard(runtimeContext, "STD-191", "player", 301)),
    hydrateCard(createRuntimeCard(runtimeContext, "STD-195", "player", 302)),
    hydrateCard(createRuntimeCard(runtimeContext, "STD-194", "player", 303)),
    hydrateCard(createRuntimeCard(runtimeContext, "STD-192", "player", 304)),
    hydrateCard(createRuntimeCard(runtimeContext, "STD-202", "player", 307))
  ];
  players.player.front = [
    hydrateCard(createRuntimeCard(runtimeContext, "STD-189", "player", 305)),
    hydrateCard(createRuntimeCard(runtimeContext, "STD-189", "player", 306))
  ];
  for (const card of players.player.front) card.summoningSick = false;
  players.player.baseMemory = 15;
  players.player.memory = 15;
  players.player.user.memory = 15;
  players.player.user.color = "紫";
  players.ai.hand = ["STD-125", "STD-131", "STD-149"].map((id) => pullCard(players.ai.deck, id));
}

function arrangeSandbox(players, { useConfiguredDecks = false } = {}, runtimeContext = null) {
  if (useConfiguredDecks) {
    for (const player of Object.values(players)) {
      player.hand = [];
      player.front = [];
      player.back = [];
      for (let index = 0; index < Number(player.user.initialHand ?? 4); index += 1) drawCardRaw(player);
      player.baseMemory = 99;
      player.memory = 99;
      player.user.memory = 99;
    }
    return;
  }
  const dummyIds = ["STD-022", "STD-023", "STD-024", "STD-025", "STD-031"];
  players.player.deck = Array.from({ length: 10 }, (_, index) => hydrateCard(createRuntimeCard(runtimeContext, dummyIds[index % dummyIds.length], "player", 7000 + index)));
  players.player.hand = [];
  players.player.front = [hydrateCard(createRuntimeCard(runtimeContext, "STD-020", "player", 101))];
  players.player.back = [];
  players.player.baseMemory = 99;
  players.player.memory = 99;
  players.player.user.memory = 99;

  const mountedHost = hydrateCard(createRuntimeCard(runtimeContext, "STD-131", "ai", 201));
  const mountedCode = hydrateCard(createRuntimeCard(runtimeContext, "STD-078", "ai", 202));
  mountedCode.layerRole = "mount";
  mountedHost.mounted.push(mountedCode);
  const hiddenScript = hydrateCard(createRuntimeCard(runtimeContext, "STD-036", "ai", 203));
  hiddenScript.faceDown = true;
  players.ai.deck = Array.from({ length: 10 }, (_, index) => hydrateCard(createRuntimeCard(runtimeContext, dummyIds[index % dummyIds.length], "ai", 8000 + index)));
  players.ai.hand = [];
  players.ai.front = [
    hydrateCard(createRuntimeCard(runtimeContext, "STD-127", "ai", 204)),
    mountedHost,
    hydrateCard(createRuntimeCard(runtimeContext, "STD-020", "ai", 205))
  ];
  players.ai.back = [
    hiddenScript,
    hydrateCard(createRuntimeCard(runtimeContext, "STD-078", "ai", 206))
  ];
  players.ai.baseMemory = 99;
  players.ai.memory = 99;
  players.ai.user.memory = 99;
}

function arrangeLab(players, runtimeContext = null) {
  players.player.deck = [];
  players.player.hand = LAB_CARD_IDS.map((id, index) => hydrateCard(createRuntimeCard(runtimeContext, id, "player", index + 1)));
  players.player.front = [hydrateCard(createRuntimeCard(runtimeContext, "STD-020", "player", 101))];
  players.player.back = [];
  players.player.baseMemory = 99;
  players.player.memory = 99;
  players.player.user.memory = 99;

  const mountedHost = hydrateCard(createRuntimeCard(runtimeContext, "STD-131", "ai", 201));
  const mountedCode = hydrateCard(createRuntimeCard(runtimeContext, "STD-078", "ai", 202));
  mountedCode.layerRole = "mount";
  mountedHost.mounted.push(mountedCode);
  const hiddenScript = hydrateCard(createRuntimeCard(runtimeContext, "STD-036", "ai", 203));
  hiddenScript.faceDown = true;
  players.ai.deck = [];
  players.ai.hand = [];
  players.ai.front = [
    hydrateCard(createRuntimeCard(runtimeContext, "STD-127", "ai", 204)),
    mountedHost,
    hydrateCard(createRuntimeCard(runtimeContext, "STD-020", "ai", 205))
  ];
  players.ai.back = [hiddenScript, hydrateCard(createRuntimeCard(runtimeContext, "STD-078", "ai", 206))];
  players.ai.baseMemory = 99;
  players.ai.memory = 99;
  players.ai.user.memory = 99;
}

export function addSandboxCardToHand(state, playerId, cardId) {
  if (!["lab", "sandbox"].includes(state.mode) || !CARD_LIBRARY[cardId] || !state.players[playerId]) return false;
  const card = hydrateCard(createRuntimeCard(state.runtimeContext ?? null, cardId, playerId, ++state.tokenSerial + 9000));
  state.players[playerId].hand.push(card);
  addLog(state, `ALL CARD LISTから${state.players[playerId].user.name}の手札へ「${card.name}」を追加。`, "system");
  return true;
}

export function canOpeningMulligan(state, playerId) {
  const player = state.players[playerId];
  return Boolean(player
    && player.user.abilityKey === "watching_you"
    && state.turnNumber === 1 && state.active === playerId
    && Number(player.mulligansUsed ?? 0) < 3
    && player.front.length === 0 && player.back.length === 0 && player.registry.length === 0
    && player.trash.length === 0 && player.ban.length === 0
    && player.hand.length === Number(player.user.initialHand ?? 5));
}

export function openingMulligan(state, playerId) {
  if (!canOpeningMulligan(state, playerId)) return fail(state, "マリガン可能な開始状態ではない。", false);
  const player = state.players[playerId];
  player.deck.push(...player.hand.splice(0));
  player.deck = shuffle(player.deck, state.rng);
  for (let index = 0; index < Number(player.user.initialHand ?? 5); index += 1) drawCardRaw(player);
  player.mulligansUsed += 1;
  state.selectedUid = null;
  addLog(state, `${player.user.name}: マリガン ${player.mulligansUsed}/3。`, "effect");
  emitUserAbilityFeedback(state, "watching_you", playerId, playerId, {
    branch: "mulligan", amount: Number(player.mulligansUsed), steps: [{ kind: "transfer", from: { kind: "zone_count", playerId, zone: "hand" }, to: { kind: "zone_count", playerId, zone: "deck" }, count: Number(player.user.initialHand ?? 5) }, { kind: "transfer", from: { kind: "zone_count", playerId, zone: "deck" }, to: { kind: "zone_count", playerId, zone: "hand" }, count: player.hand.length }]
  });
  return true;
}

export const DECK_OPTIONS = Object.freeze({
  red: { label: "レッドパンクス・赤", color: "赤", recipe: RED_DECK },
  yellow: { label: "NOM・黄", color: "黄", recipe: YELLOW_DECK },
  vengeance: { label: "ヴェンジェンス・紫", color: "紫", recipe: VENGEANCE_DECK },
  neutron: { label: "ニュートロン・セキュリティ・青", color: "青", recipe: NEUTRON_DECK }
});

export const USER_OPTIONS = USER_CARDS;

export function createGame({ mode = "ai", tutorialId = "basics", playerDeckId = "red", aiDeckId = "yellow", playerDeckRecipe = null, aiDeckRecipe = null, playerUserId = "doors_zx", aiUserId = "doors_zx", sandboxDeckSetup = false, rng = Math.random, runtimeContext = null } = {}) {
  if (runtimeContext !== null) rng = runtimeRng(runtimeContext);
  const isVengeanceTutorial = mode === "tutorial" && tutorialId === "vengeance";
  const selectedPlayerDeck = isVengeanceTutorial ? DECK_OPTIONS.vengeance : (DECK_OPTIONS[playerDeckId] ?? DECK_OPTIONS.red);
  const selectedAiDeck = DECK_OPTIONS[aiDeckId] ?? DECK_OPTIONS.yellow;
  const skipInitialDecks = runtimeContext !== null && (mode === "lab" || (mode === "sandbox" && !sandboxDeckSetup));
  const red = skipInitialDecks ? [] : expandRuntimeDeck(runtimeContext, playerDeckRecipe ?? selectedPlayerDeck.recipe, "player");
  const yellow = skipInitialDecks ? [] : expandRuntimeDeck(runtimeContext, aiDeckRecipe ?? selectedAiDeck.recipe, "ai");
  const playerUser = USER_CARDS[playerUserId] ?? USERS.player;
  const aiUser = USER_CARDS[aiUserId] ?? USERS.ai;
  const players = {
    player: buildPlayer("player", { ...playerUser, color: selectedPlayerDeck.color }, mode === "tutorial" ? red : shuffle(red, rng)),
    ai: buildPlayer("ai", { ...aiUser, color: selectedAiDeck.color }, mode === "tutorial" ? yellow : shuffle(yellow, rng))
  };
  if (mode === "tutorial") isVengeanceTutorial ? arrangeVengeanceTutorial(players, runtimeContext) : arrangeTutorial(players);
  else if (mode === "lab") arrangeLab(players, runtimeContext);
  else if (mode === "sandbox") arrangeSandbox(players, { useConfiguredDecks: sandboxDeckSetup }, runtimeContext);
  else {
    for (let i = 0; i < Number(players.player.user.initialHand ?? 4); i += 1) drawCardRaw(players.player);
    for (let i = 0; i < Number(players.ai.user.initialHand ?? 4); i += 1) drawCardRaw(players.ai);
  }

  const state = {
    ...(runtimeContext === null ? {} : { runtimeContext }),
    mode,
    tutorialId,
    playerDeckId: isVengeanceTutorial ? "vengeance" : playerDeckId,
    aiDeckId,
    playerUserId,
    aiUserId,
    players,
    active: "player",
    firstPlayer: "player",
    turnNumber: 1,
    phase: "main",
    winner: null,
    victory: { lockedOutcome: null, lockedAtEffectId: null, finished: false },
    projectionSerial: 0,
    projectionSlotRevision: { pending: 0, prompt: 0 },
    selectionQueueSerial: 0,
    selectionQueue: [],
    legacyProjectionOwnerSerial: 0,
    // A resolution is deliberately data-only: a save/history JSON roundtrip can
    // resume an internal choice without treating unrelated trigger work as part
    // of the same card text.
    effectResolution: null,
    effectSerial: 0,
    victoryFacts: [],
    selectedUid: null,
    openAdmin: null,
    pending: null,
    prompt: null,
    mandatoryDrawContinuation: null,
    message: "",
    log: [],
    history: [],
    tokenSerial: 0,
    provisional: [],
    events: [],
    activationWindows: [],
    scriptActivationQueue: [],
    lastEventContext: null,
    triggerQueue: [],
    triggerSerial: 0,
    processingTriggers: false,
    effectDepth: 0,
    turnStats: { destroyedOb: 0, destroyedCards: 0, destroyedSacredTreeScripts: 0 },
    delayedEffects: [],
    declaredEffects: [],
    declarationSerial: 0,
    resolvingDeclaredEffect: null,
    deferredDeclaredResponseCleanup: null,
    deferredDeclaredScriptCleanup: null,
    placementCostBatch: null,
    responseEventQueue: [],
    resolvingResponse: false,
    triggerThread: null,
    threadNotice: null,
    interactive: false,
    rng
  };
  if (["lab", "sandbox"].includes(mode)) {
    state.sandboxUi = { query: "", expansion: "all", catalogOwner: "player", opponentControl: "manual", actor: "player" };
  }
  if (runtimeContext !== null) normalizeBoardSlots(state);
  startTurn(state, state.active);
  return state;
}

export function cloneForHistory(state) {
  const rng = state.rng;
  const copy = structuredClone({ ...state, rng: null, history: [] });
  copy.rng = copy.runtimeContext ? runtimeRng(copy.runtimeContext) : rng;
  copy.history = [];
  return copy;
}

export function remember(state) {
  state.history.push(cloneForHistory(state));
  if (state.history.length > 30) state.history.shift();
}

export function undo(state) {
  if (state.runtimeContext) throw new RuntimeError("RUNTIME_UNDO_UNSUPPORTED");
  const previous = state.history.pop();
  if (!previous) return state;
  previous.history = state.history;
  addLog(previous, "直前の操作を取り消した。", "system");
  return previous;
}

const logCardNames = Object.values(CARD_LIBRARY).filter((card) => card?.name).sort((a, b) => b.name.length - a.name.length);

function logSource(state, text, tone) {
  const quoted = text.match(/「([^」]+)」を.{0,16}(?:実行|インストール|配置|起動)/)?.[1];
  const source = logCardNames.find((card) => text.startsWith(`${card.name}:`)
    || text.startsWith(`${card.name}：`) || text.startsWith(`${card.name}が`)
    || text.startsWith(`${card.name}を`) || text.startsWith(`誘発: ${card.name}`)
    || quoted === card.name);
  if (!source) return { cardId: null, actor: ["action", "turn"].includes(tone) ? state.active : null };
  const ownersIn = (zones) => Object.entries(state.players ?? {}).filter(([, player]) =>
    zones.some((zone) => player[zone]?.some((card) => card.name === source.name))).map(([playerId]) => playerId);
  const publicOwners = ownersIn(["front", "back", "registry"]);
  const owners = publicOwners.length ? publicOwners : ownersIn(["hand", "trash"]);
  return { cardId: source.id, actor: owners.length === 1 ? owners[0] : tone === "action" ? state.active : null };
}

export function addLog(state, text, tone = "info", details = {}) {
  const source = logSource(state, text, tone);
  state.log.push({ id: `${Date.now()}-${state.log.length}`, text, tone, turn: state.turnNumber, ...source, ...details });
  if (state.log.length > 120) state.log.shift();
}

function cardsInPlay(state) {
  const entries = [];
  for (const [playerId, player] of Object.entries(state.players)) {
    for (const zoneName of ["front", "back"]) for (const card of player[zoneName]) entries.push({ playerId, zoneName, card });
  }
  return entries;
}

function collectTriggers(state, event) {
  const context = createEventContext(state, event);
  state.lastEventContext = context;
  const windows = collectActivationWindows(state, context, specsForEvent(event.type), cardsInPlay(state));
  state.activationWindows.push(...windows);
  if (state.activationWindows.length > 200) state.activationWindows.splice(0, state.activationWindows.length - 200);
  return windows;
}

function executeTriggerAction(state, trigger, action) {
  const { source, event } = trigger;
  const controller = state.players[source.playerId];
  const enemyId = otherPlayer(source.playerId);
  if (action.type === "deal_damage" && action.target === "enemy_user") {
    dealFortressDamage(state, enemyId, action.amount, source.playerId, source.card.name);
  } else if (action.type === "deal_damage" && action.target === "enemy_front_all") {
    for (const target of [...state.players[enemyId].front]) dealCardDamage(state, enemyId, target.uid, action.amount, source.card.name);
  } else if (action.type === "recover_memory") {
    const before = controller.memory;
    controller.memory = Math.min(getMaxMemory(controller), controller.memory + action.amount);
    addLog(state, `${source.card.name}: メモリ ${before}→${controller.memory}。`, "effect");
  } else if (action.type === "draw" && action.target === "source_controller") {
    drawCards(state, source.playerId, action.amount);
    addLog(state, `${source.card.name}: カードを${action.amount}枚引く。`, "effect");
  } else if (action.type === "modify_stats" && action.target === "source") {
    const atkField = action.duration === "turn" ? "tempAtk" : "permanentAtk";
    const strField = action.duration === "turn" ? "tempStr" : "permanentStr";
    source.card[atkField] = Number(source.card[atkField] ?? 0) + action.atk;
    source.card[strField] = Number(source.card[strField] ?? 0) + action.str;
    addLog(state, `${source.card.name}: ${action.atk >= 0 ? "+" : ""}${action.atk}/${action.str >= 0 ? "+" : ""}${action.str}。`, "effect");
  } else if (action.type === "modify_stats" && action.target === "enemy_ob_all") {
    for (const target of [...state.players[enemyId].front, ...state.players[enemyId].back]) {
      target.tempAtk = Number(target.tempAtk ?? 0) + action.atk;
      target.tempStr = Number(target.tempStr ?? 0) + action.str;
    }
    addLog(state, `${source.card.name}: 相手Obすべてをこのターン${action.atk}/0。`, "effect");
  } else if (action.type === "modify_stats" && action.target === "own_battler") {
    const uid = trigger.event.attackerUid && findCard(state, trigger.event.attackerUid)?.playerId === source.playerId
      ? trigger.event.attackerUid : trigger.event.defenderUid;
    const target = findCard(state, uid)?.card;
    if (target) addTimedModifier(state, target, action, source.card.name);
  } else if (action.type === "modify_stats" && action.target === "own_ob_all") {
    for (const target of [...controller.front, ...controller.back].filter(isObCard)) addTimedModifier(state, target, action, source.card.name);
  } else if (action.type === "destroy_all" && action.target === "enemy_non_ob") {
    for (const target of [...state.players[enemyId].front, ...state.players[enemyId].back].filter((card) => !isObCard(card))) {
      destroyCard(state, enemyId, target.uid, { source: source.card.name, suppressReplacement: true });
    }
  } else if (action.type === "add_counter" && action.target === "enemy_ob_all") {
    for (const target of [...state.players[enemyId].front, ...state.players[enemyId].back].filter(isObCard)) {
      if (action.counter === "load") target.load = Number(target.load ?? 0) + Number(action.amount ?? 0);
      else {
        target.counters ??= {};
        target.counters[action.counter] = Number(target.counters[action.counter] ?? 0) + Number(action.amount ?? 0);
      }
    }
    addLog(state, `${source.card.name}: 相手Obすべてに${action.counter}を${action.amount}付与。`, "effect");
  } else if (action.type === "move_event_card" && action.source === "trash" && action.destination === "hand") {
    const index = controller.trash.findIndex((card) => card.uid === event.cardUid);
    if (index >= 0) controller.hand.push(...controller.trash.splice(index, 1));
    addLog(state, `${source.card.name}: ${event.cardName}をゴミ箱から手札へ戻した。`, "effect");
  } else if (action.type === "select_execute_from_trash") {
    const candidates = controller.trash.filter((card) => {
      if (action.filter?.category && !matchesCardCategory(card, action.filter.category)) return false;
      if (action.filter?.excludeCategory && matchesCardCategory(card, action.filter.excludeCategory)) return false;
      if (action.filter?.namePattern === "slash_spell" && !isSlashSpell(card)) return false;
      if (action.filter?.maximumCost !== undefined && Number(card.cost ?? 0) > Number(action.filter.maximumCost)) return false;
      return true;
    });
    if (!candidates.length) return;
    const request = createSelectionRequest({
      mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, `${card.name} / メモリ${card.cost}`])),
      label: "ゴミ箱から起動するSpを選択", message: source.card.text,
      continuation: {
        type: "runtime-execute-from-trash", playerId: source.playerId, sourceUid: source.card.uid,
        sourceName: source.card.name, destinationAfterExecution: action.destinationAfterExecution,
        shuffleAfter: Boolean(action.shuffleAfter), triggerItemId: trigger.id
      }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
  } else if (action.type === "add_counter" && action.target === "enemy_user") {
    const target = state.players[enemyId];
    target.counters ??= {};
    target.counters[action.counter] = Number(target.counters[action.counter] ?? 0) + action.amount;
    addLog(state, `${source.card.name}: 相手ユーザーへ${action.counter}カウンター${action.amount}個。`, "effect");
  } else if (action.type === "add_counter" && action.target === "enemy_battler") {
    const uid = trigger.event.attackerUid === source.card.uid ? trigger.event.defenderUid : trigger.event.attackerUid;
    const target = findCard(state, uid)?.card;
    if (target) {
      target.load = Number(target.load ?? 0) + action.amount;
      addLog(state, `${source.card.name}: ${target.name}へ[負荷]${action.amount}。`, "effect");
    }
  } else if (action.type === "choose_effect") {
    const request = selectionRequestFromSpec(createChoiceSpec({ options: ["①相手の手札を1枚捨てる", "②相手Obに毒カウンター2"] }), {
      label: `${source.card.name}: ①または②`, message: source.card.text,
      continuation: { type: "std164-choice", playerId: source.playerId, sourceName: source.card.name, triggerItemId: trigger.id }
    });
    state.pending = { type: "selection", validTargets: [], request };
  } else if (action.type === "select" && action.selector && typeof action.selector === "object") {
    openRuntimeTargetSelection(state, source.playerId, source.card, action, { records: Object.create(null) }, { triggerItemId: trigger.id });
  } else if (action.type === "select_entity" && action.scope === "all_users_and_all_area_ob") {
    const cards = Object.values(state.players).flatMap((owner) => [...owner.front, ...owner.back]).filter(isObCard);
    const users = Object.keys(state.players).map((id) => `${id}-fortress`);
    const request = createSelectionRequest({
      mode: "single", candidates: [...users, ...cards.map((card) => card.uid)], count: 1,
      candidateLabels: {
        ...Object.fromEntries(Object.entries(state.players).map(([id, owner]) => [`${id}-fortress`, owner.user.name])),
        ...Object.fromEntries(cards.map((card) => [card.uid, card.name]))
      },
      label: `${source.card.name}: [負荷]1`, message: source.card.text,
      continuation: { type: "trigger-selected-entity-action", playerId: source.playerId, sourceName: source.card.name, action: action.then, triggerItemId: trigger.id }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
  } else if (action.type === "standby") {
    source.card.sleep = false;
    addLog(state, `${source.card.name}: スタンバイ。`, "effect");
  } else if (action.type === "generate") {
    const destination = action.destination === "event_from_zone" ? event.from : action.destination;
    for (let index = 0; index < action.count; index += 1) {
      const card = createVengeanceCard(state, action.cardId, source.playerId);
      const zone = destination === "choose_area" ? (controller.front.length < controller.user.frontLimit ? "front" : controller.back.length < controller.user.backLimit ? "back" : "front") : destination;
      if (!["front", "back", "hand"].includes(zone)) continue;
      if (["front", "back"].includes(zone)) {
        if (placeByMode(state, source.playerId, card, { zone, from: "generated", source: source.card.name }) === "placed") emitEffectPlacement(state, source.playerId, card, zone, source.card.name);
      } else controller[zone].push(card);
    }
    addLog(state, `${source.card.name}: 「${CARD_LIBRARY[action.cardId].name}」を生成。`, "effect");
  } else if (action.type === "generate_as_layer_for_each") {
    const targets = runtimeSelectionCandidates(state, source.playerId, source.card, { selector: action.selector });
    const generated = [];
    for (const host of targets) {
      const layer = createVengeanceCard(state, action.cardId, source.playerId);
      layer.layerRole = "layered";
      host.mounted.push(layer);
      generated.push(layer);
    }
    if (generated.length) emitCardsGenerated(state, source.playerId, generated, source.card.name);
    addLog(state, `${source.card.name}: 対象${targets.length}枚のレイヤーに「${CARD_LIBRARY[action.cardId].name}」を生成。`, "effect");
  } else if (action.type === "generate_as_layer" && action.target === "event_card") {
    const host = findCard(state, event.cardUid)?.card;
    if (!host) return;
    const layer = createVengeanceCard(state, action.cardId, source.playerId);
    layer.layerRole = "layered";
    host.mounted.push(layer);
    emitCardsGenerated(state, source.playerId, [layer], source.card.name);
    addLog(state, `${source.card.name}: ${host.name}のレイヤーに「${CARD_LIBRARY[action.cardId].name}」を生成。`, "effect");
  } else if (action.type === "move_each_deck_top_as_layer" && action.target === "source") {
    let moved = 0;
    for (const ownerId of ["player", "ai"]) {
      const layer = state.players[ownerId].deck.pop();
      if (!layer) continue;
      layer.layerRole = "layered";
      source.card.mounted.push(layer);
      moved += 1;
    }
    addLog(state, `${source.card.name}: お互いの山札上から合計${moved}枚をレイヤーに加えた。`, "effect");
  } else if (action.type === "access" && action.matchCategory === "event_card") {
    const index = controller.deck.findIndex((card) => matchesCardCategory(card, event.category));
    if (index >= 0) {
      const [found] = controller.deck.splice(index, 1);
      controller.hand.push(found);
      addLog(state, `${source.card.name}: ${event.category}「${found.name}」へアクセス。`, "effect");
    }
  } else if (action.type === "access" && action.filter) {
    openRuntimeAccessSelection(state, source.playerId, source.card, action, null, null, { triggerItemId: trigger.id });
  } else if (action.type === "access" && action.destination === "hand") {
    const candidates = controller.deck.filter((card) => (!action.matchCategory || matchesCardCategory(card, action.matchCategory)) && (!action.matchColor || card.color === action.matchColor));
    if (candidates.length) {
      const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
        candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])), label: `${source.card.name}のアクセス`, message: source.card.text,
        continuation: { type: "q2-access-hand", playerId: source.playerId, sourceName: source.card.name, triggerItemId: trigger.id } });
      enqueueSelection(state, { type: "selection", validTargets: request.candidates, request }, selectionProjectionMeta("engine:trigger-access", source.playerId));
    }
  } else if (action.type === "select" && action.selector === "one_own_and_one_enemy_ob") {
    const own = [...controller.front, ...controller.back].filter(isObCard).map((card) => card.uid);
    const enemy = [...state.players[enemyId].front, ...state.players[enemyId].back].filter(isObCard).map((card) => card.uid);
    if (!own.length || !enemy.length) return;
    const request = createSelectionRequest({
      mode: "exact", candidates: [...own, ...enemy], count: 2,
      label: "自分と相手のObを1体ずつ選択", message: "2体とも選んだ場合、それらを破壊する。",
      groups: [
        { id: "own", label: "自分Ob", candidates: own, minimum: 1, maximum: 1 },
        { id: "enemy", label: "相手Ob", candidates: enemy, minimum: 1, maximum: 1 }
      ],
      continuation: { type: "destroy-selected", playerId: source.playerId, sourceName: source.card.name, triggerItemId: trigger.id }
    });
    enqueueSelection(state, { type: "selection", validTargets: request.candidates, request }, selectionProjectionMeta("engine:trigger-paired-destroy", source.playerId));
  } else if (action.type === "select" && ["one_non_ob", "one_own_ob", "one_enemy_ob"].includes(action.selector)) {
    const candidates = action.selector === "one_own_ob"
      ? [...controller.front, ...controller.back].filter(isObCard)
      : action.selector === "one_enemy_ob"
        ? [...state.players[enemyId].front, ...state.players[enemyId].back].filter(isObCard)
      : Object.values(state.players).flatMap((player) => [...player.front, ...player.back]).filter((card) => !isObCard(card));
    if (!candidates.length) return;
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])), label: "効果対象を選択", message: source.card.text,
      continuation: { type: action.then === "destroy" ? "destroy-selected" : action.then === "deal_damage" ? "deal-selected-damage" : action.then === "modify_and_prevent_battle_damage" ? "trigger-modify-prevent-battle" : "trigger-modify-grant", playerId: source.playerId,
        ...(action.amount !== undefined ? { amount: action.amount } : {}),
        sourceName: source.card.name, triggerItemId: trigger.id, action } });
    enqueueSelection(state, { type: "selection", validTargets: request.candidates, request }, selectionProjectionMeta("engine:trigger-select", source.playerId));
  }
}

export function enqueueLegacyProjection(state, { queueName, channel, payload, metaBase } = {}) {
  if (!Array.isArray(state?.[queueName]) || !PROJECTION_CHANNELS.has(channel) || coordinatorProjectionBlocked(state)
    || !validCounters(state, channel) || !isCounter(state.selectionQueueSerial) || channel !== "pending") return { ok: false, reason: "invalid-enqueue" };
  const meta = legacyProjectionMeta(state, payload, metaBase);
  const spec = buildProjectionSpec(payload, meta);
  if (!spec.ok || meta.channel !== channel) return { ok: false, reason: "invalid-enqueue" };
  const ownerWasIssued = !metaBase.ownerId && !state.effectResolution?.id;
  if (state[channel] === null) {
    const committed = commitProjection(state, { channel, spec: spec.spec, expected: { mode: "empty", slotRevision: state.projectionSlotRevision[channel] } });
    if (!committed.ok) return committed;
    if (ownerWasIssued) state.legacyProjectionOwnerSerial += 1;
    return { ok: true, queueEntryId: null, identity: committed.identity };
  }
  const nextQueueSerial = state.selectionQueueSerial + 1;
  if (!isCounter(nextQueueSerial)) return { ok: false, reason: "invalid-enqueue" };
  state.selectionQueueSerial = nextQueueSerial;
  if (ownerWasIssued) state.legacyProjectionOwnerSerial += 1;
  state[queueName].push({ queueEntryId: `selection-${nextQueueSerial}`, payload: spec.spec.payload, metaBase: spec.spec.meta });
  return { ok: true, queueEntryId: `selection-${nextQueueSerial}` };
}

export function promoteLegacyQueueHead(state, { queueName, channel, build } = {}) {
  if (!Array.isArray(state?.[queueName]) || !PROJECTION_CHANNELS.has(channel) || typeof build !== "function" || coordinatorProjectionBlocked(state)
    || !validCounters(state, channel) || state[channel] !== null) return "blocked";
  if (!state[queueName].length) return "empty";
  const entry = state[queueName][0]; const candidate = build(entry);
  if (!candidate || !candidate.payload || !candidate.metaBase) return "discarded";
  const spec = buildProjectionSpec(candidate.payload, candidate.metaBase);
  if (!spec.ok || spec.spec.meta.channel !== channel) return "discarded";
  const committed = commitProjection(state, { channel, spec: spec.spec, expected: { mode: "empty", slotRevision: state.projectionSlotRevision[channel] } });
  if (!committed.ok) return committed.reason === "invalid-commit" && coordinatorProjectionBlocked(state) ? "blocked" : "discarded";
  state[queueName].shift(); return "projected";
}

function enqueueSelection(state, pending, metaBase) {
  return enqueueLegacyProjection(state, { queueName: "selectionQueue", channel: "pending", payload: pending, metaBase }).ok;
}

function openNextQueuedSelection(state) {
  const opened = promoteLegacyQueueHead(state, { queueName: "selectionQueue", channel: "pending", build: (entry) => entry }) === "projected";
  if (!opened) resumeStd230AmbushCleanup(state);
  return opened;
}

function selectionProjectionMeta(producerId, actorId) {
  return { scope: "internal", producerId, ownerKind: "candidate", actorId };
}

function addTimedModifier(state, card, action, sourceName) {
  const expiresAfterTurn = action.duration === "through_next_turn" ? state.turnNumber + 1 : state.turnNumber;
  (card.timedModifiers ??= []).push({ atk: Number(action.atk ?? 0), str: Number(action.str ?? 0), keyword: action.keyword ?? null, expiresAfterTurn });
  addLog(state, `${sourceName}: ${card.name}を${action.atk >= 0 ? "+" : ""}${action.atk}/${action.str >= 0 ? "+" : ""}${action.str}${action.keyword ? `、[${action.keyword}]付与` : ""}。`, "effect");
}

export function resolveVariableExpression(state, playerId, expression) {
  let runtimeExpression = null;
  if (expression.aggregate === "absolute_user_life_difference") runtimeExpression = { expression: "absolute_user_str_difference" };
  if (expression.count === "own_area_security") runtimeExpression = { expression: "own_area_filter_count", filter: { keyword: "SECURITY" } };
  if (expression.countUnion) runtimeExpression = {
    expression: "own_trash_filter_union_count",
    filters: [
      ...(expression.countUnion.includes("own_trash_nom") ? [{ className: "ナイツ・オブ・マキナ" }] : []),
      ...(expression.countUnion.includes("own_trash_security") ? [{ keyword: "SECURITY" }] : [])
    ]
  };
  const value = runtimeExpression ? runtimeSpecValue(state, playerId, {}, runtimeExpression) : 0;
  return Math.max(0, value + Number(expression.add ?? 0));
}

function runtimeSpecValue(state, playerId, source, value, runtime = null) {
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return value;
  const expression = value?.expression;
  const player = state.players[playerId];
  if (expression === "turn_number") return state.turnNumber;
  if (expression === "source_layer_count") return flattenedLayerCount(source);
  if (expression === "source_stack_count") return 1 + flattenedLayerCount(source);
  if (expression === "source_lyd_layer_count") {
    return flattenedLayers(source).filter(isLydCard).length;
  }
  if (expression === "own_area_security_count" || expression === "own_area_security_count_plus_one") {
    const count = [...player.front, ...player.back].filter((card) => cardHasKeyword(card, "SECURITY")).length;
    return count + (expression.endsWith("plus_one") ? 1 : 0);
  }
  if (expression === "registry_execution_damage") return source.executedFromRegistry ? value.registry : value.normal;
  if (expression === "recorded_count") return Number(runtime?.records?.[value.key] ?? 0);
  if (expression === "recorded_count_divided_floor") {
    return Math.floor(Number(runtime?.records?.[value.key] ?? 0) / Math.max(1, Number(value.divisor ?? 1)));
  }
  if (expression === "recorded_value") return runtime?.records?.[value.key];
  if (expression === "absolute_user_str_difference") {
    return Math.abs(Number(player.fortressStr) - Number(state.players[otherPlayer(playerId)].fortressStr));
  }
  if (expression === "own_area_filter_count") {
    return [...player.front, ...player.back].filter((card) => runtimeSpecMatchesCard(card, value.filter, null, { state, playerId, source, runtime })).length;
  }
  if (expression === "own_trash_filter_union_count") {
    return player.trash.filter((card) => value.filters.some((filter) => runtimeSpecMatchesCard(card, filter, null, { state, playerId, source, runtime }))).length;
  }
  throw new Error(`Unsupported card runtime value expression: ${expression ?? "(missing)"}`);
}

function runtimeSpecCondition(state, playerId, source, condition, runtime = null, targetUid = null) {
  if (!condition) return true;
  const player = state.players[playerId];
  if (condition.expression === "source_has_lyd_layer") return runtimeSpecValue(state, playerId, source, { expression: "source_lyd_layer_count" }) > 0;
  if (condition.expression === "another_own_ob_has_security") {
    return [...player.front, ...player.back].some((card) => card.uid !== source.uid && isObCard(card) && cardHasKeyword(card, "SECURITY"));
  }
  if (condition.expression === "recorded_damage_destroyed") return Boolean(runtime?.records?.[condition.key]?.destructionDetermined);
  if (condition.expression === "selected_target_is_sleeping_ob") {
    const target = findCard(state, targetUid);
    return target?.playerId === otherPlayer(playerId)
      && ["front", "back"].includes(target.zoneName)
      && isObCard(target.card)
      && target.card.sleep;
  }
  if (condition.expression === "opponent_turn") return state.active !== playerId;
  if (condition.expression === "own_area_has_class_ob") {
    return [...player.front, ...player.back].some((card) => isObCard(card) && hasClass(card, condition.className));
  }
  if (condition.expression === "source_is_mounted") return Boolean(source.mounted?.length);
  if (condition.expression === "source_oc_paid_at_least") return Number(source.ocPaidAmount ?? 0) >= Number(condition.amount ?? 0);
  if (condition.expression === "recorded_count_positive") return Number(runtime?.records?.[condition.key] ?? 0) > 0;
  if (condition.expression === "recorded_value_equals") {
    const recorded = runtime?.records?.[condition.key];
    return /category/i.test(condition.key)
      ? matchesCardCategory({ category: recorded }, condition.value)
      : recorded === condition.value;
  }
  if (condition.expression === "recorded_value_not_equals") {
    if (condition.requiresKey && !Object.hasOwn(runtime?.records ?? {}, condition.key)) return false;
    const recorded = runtime?.records?.[condition.key];
    return /category/i.test(condition.key)
      ? !matchesCardCategory({ category: recorded }, condition.value)
      : recorded !== condition.value;
  }
  if (condition.expression === "own_user_str_less_than_opponent") {
    return Number(player.fortressStr) < Number(state.players[otherPlayer(playerId)].fortressStr);
  }
  if (condition.expression === "source_controller_memory_equals") return Number(player.memory) === Number(condition.amount ?? 0);
  if (condition.expression === "source_attacked_this_turn") return Boolean(source.attackedThisTurn);
  throw new Error(`Unsupported card runtime condition: ${condition.expression ?? "(missing)"}`);
}

function battleStatModifierValue(state, playerId, source, stat) {
  let value = 0;
  for (const spec of battleStatModifierSpecsFor(source.id).filter((item) => item.stat === stat)) {
    const amount = Number(runtimeSpecValue(state, playerId, source, spec.value));
    if (spec.operation === "add") value += amount;
    else if (spec.operation === "set") value = amount;
    else throw new Error(`Unsupported battle stat modifier operation: ${spec.operation ?? "(missing)"}`);
  }
  return value;
}

function continuousEffectConditionMatches(state, playerId, source, condition) {
  if (!condition) return true;
  if (condition.expression === "source_has_any_keyword") {
    return condition.keywords.some((keyword) => cardHasRuntimeKeyword(state, playerId, source, keyword));
  }
  if (condition.expression === "source_atk_at_least") return cardAtk(state, playerId, source) >= Number(condition.amount ?? 0);
  if (condition.expression === "source_max_str_at_most") return cardMaxStr(state, playerId, source) <= Number(condition.amount ?? 0);
  if (condition.expression === "source_is_not_mounted") return (source.mounted?.length ?? 0) === 0;
  throw new Error(`Unsupported continuous effect condition: ${condition.expression ?? "(missing)"}`);
}

function continuousStatModifierValue(state, playerId, source, stat) {
  return continuousStatModifierSpecsFor(source.id)
    .filter((item) => continuousEffectConditionMatches(state, playerId, source, item.condition))
    .reduce((sum, item) => sum + Number(item[stat] ?? 0), 0);
}

function mountedStatModifierValue(source, stat) {
  return (source.mounted ?? []).reduce((sum, provider) => sum
    + mountedStatModifierSpecsFor(provider.id).reduce((providerSum, spec) => providerSum + Number(spec[stat] ?? 0), 0), 0);
}

function runtimeSpecTargets(state, playerId, source, targetUid, target) {
  const player = state.players[playerId];
  if (target === "source") return [source];
  if (target === "own_ob_all") return [...player.front, ...player.back].filter(isObCard);
  if (target === "own_mounted_ob_all") {
    return [...player.front, ...player.back].filter((card) => isObCard(card) && card.mounted?.length);
  }
  if (target === "own_class_ob_all") {
    return [...player.front, ...player.back].filter((card) => isObCard(card) && hasClass(card, source.runtimeTargetClass));
  }
  if (target === "selected_own_ob") {
    const entry = findCard(state, targetUid);
    return entry?.playerId === playerId && isObCard(entry.card) ? [entry.card] : [];
  }
  if (target === "selected_enemy_ob") {
    const entry = findCard(state, targetUid);
    return entry?.playerId === otherPlayer(playerId) && isObCard(entry.card) ? [entry.card] : [];
  }
  throw new Error(`Unsupported card runtime target: ${target ?? "(missing)"}`);
}

function runtimeFieldValues(card, field) {
  const values = Array.isArray(card?.[field]) ? card[field] : card?.[field] === undefined ? [] : [card[field]];
  return field === "classes" ? values.map(classKey) : values.map(String);
}

function runtimeSpecMatchesCard(card, filter = {}, referenceCard = null, context = null) {
  const filterValue = (value) => value?.expression && context
    ? runtimeSpecValue(context.state, context.playerId, context.source, value, context.runtime)
    : value;
  if (filter.anyOf && !filter.anyOf.some((branch) => runtimeSpecMatchesCard(card, branch, referenceCard, context))) return false;
  if (filter.category && !matchesCardCategory(card, filter.category)) return false;
  if (filter.excludeCategory && matchesCardCategory(card, filter.excludeCategory)) return false;
  if (filter.printedCategory && card.printedCategory !== filter.printedCategory) return false;
  if (filter.categories && !filter.categories.some((category) => matchesCardCategory(card, category))) return false;
  if (filter.color && card.color !== filter.color) return false;
  if (filter.className && !hasClass(card, filter.className)) return false;
  if (filter.keyword && !cardHasKeyword(card, filter.keyword)) return false;
  if (filter.trait && !cardTraits(card).includes(filter.trait)) return false;
  if (filter.family === "arms_band" && !isArmsBandCard(card)) return false;
  if (filter.name && card.name !== filter.name) return false;
  if (filter.nameIncludes && !card.name.includes(filter.nameIncludes)) return false;
  if (filter.normalizedName && card.name.replace(/[「」]/g, "") !== filter.normalizedName) return false;
  if (filter.excludeSourceName && card.name === context?.source?.name) return false;
  if (filter.nameStartsWith && !card.name.startsWith(filter.nameStartsWith)) return false;
  if (filter.nameEndsWith && !card.name.endsWith(filter.nameEndsWith)) return false;
  if (filter.effectText === "none" && !hasNoEffectText(card)) return false;
  if (filter.originalMemoryMaximum !== undefined && Number(card.cost ?? 0) > Number(filterValue(filter.originalMemoryMaximum))) return false;
  if (filter.originalMemoryMinimum !== undefined && Number(card.cost ?? 0) < Number(filterValue(filter.originalMemoryMinimum))) return false;
  if (filter.originalMemoryMaximumExclusive !== undefined && Number(card.cost ?? 0) >= Number(filterValue(filter.originalMemoryMaximumExclusive))) return false;
  if (filter.originalSetupMemoryMaximum !== undefined && Number(card.setupCost ?? card.cost ?? 0) > Number(filter.originalSetupMemoryMaximum)) return false;
  if (filter.sharesFieldWithReference) {
    const candidateValues = runtimeFieldValues(card, filter.sharesFieldWithReference);
    const referenceValues = new Set(runtimeFieldValues(referenceCard, filter.sharesFieldWithReference));
    if (!candidateValues.some((value) => referenceValues.has(value))) return false;
  }
  return true;
}

function runtimeAccessCandidates(player, action, referenceCard = null) {
  return player.deck.filter((card) => runtimeSpecMatchesCard(card, action.filter, referenceCard));
}

function runtimeSelectionCandidates(state, playerId, source, action, runtime = { records: Object.create(null) }) {
  const selector = action.selector ?? {};
  const ownerScope = selector.owner ?? "both";
  const ownerIds = ownerScope === "both"
    ? [playerId, otherPlayer(playerId)]
    : ownerScope === "enemy" ? [otherPlayer(playerId)] : [playerId];
  const candidates = [];
  for (const ownerId of ownerIds) {
    const owner = state.players[ownerId];
    if (selector.effectTargeting) {
      candidates.push(...getEffectTargets(state, ownerId, source));
      continue;
    }
    for (const zone of selector.zones ?? ["area"]) {
      if (zone === "area") candidates.push(...owner.front, ...owner.back);
      else if (zone === "layers") candidates.push(...ownLayerEntries(owner).map((entry) => entry.layer));
      else if (Array.isArray(owner[zone])) candidates.push(...owner[zone]);
    }
  }
  return candidates.filter((card) => {
    if (card.uid === (selector.excludeSource ? source.uid : null) || !runtimeSpecMatchesCard(card, selector)) return false;
    if (selector.correspondsToRecordedHost) {
      const recorded = runtime.records?.[selector.correspondsToRecordedHost];
      const hostUid = Array.isArray(recorded) ? recorded[0] : recorded;
      const host = findCard(state, hostUid)?.card;
      if (!host) return false;
      const requirement = String(keywordValue(host, "LAYERED") ?? "");
      if (!requirement.includes(card.name) && !(card.classes ?? []).some((name) => requirement.includes(name))) return false;
    }
    return true;
  });
}

function openRuntimeTargetSelection(state, playerId, source, action, runtime, continuationMeta = {}) {
  const candidates = runtimeSelectionCandidates(state, playerId, source, action, runtime);
  if (!candidates.length && action.continueWhenEmpty) {
    return action.skipAfterActionsWhenEmpty
      ? true
      : executeRuntimeActions(state, playerId, source, action.afterActions ?? [], { targetUid: null, runtime });
  }
  const minimum = Math.max(0, Number(action.minimum ?? action.count ?? 1));
  const configuredMaximum = action.maximum === "all" ? candidates.length : Number(action.maximum ?? action.count ?? 1);
  const maximum = Math.min(candidates.length, Math.max(0, configuredMaximum));
  if (candidates.length < minimum) return false;
  const mode = action.mode ?? (minimum === maximum ? (maximum === 1 ? "single" : "exact") : "up_to");
  const request = createSelectionRequest({
    mode,
    candidates: candidates.map((card) => card.uid),
    count: maximum,
    minimum,
    maximum,
    budget: action.totalOriginalMemoryMaximum,
    candidateValues: action.totalOriginalMemoryMaximum === undefined
      ? undefined
      : Object.fromEntries(candidates.map((card) => [card.uid, Number(card.cost ?? 0)])),
    candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])),
    label: action.label ?? `${source.name}: 対象を選択`,
    message: source.text,
    continuation: {
      type: "runtime-action-selection",
      playerId,
      sourceId: source.id,
      sourceUid: source.uid,
      sourceName: source.name,
      selector: action.selector ?? {},
      recordAs: action.recordAs,
      minimum,
      maximum,
      afterActions: action.afterActions ?? [],
      skipAfterActionsWhenEmpty: Boolean(action.skipAfterActionsWhenEmpty),
      runtime,
      ...continuationMeta
    }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

function runtimePlayerCandidates(state, action) {
  return Object.entries(state.players)
    .filter(([, player]) => !action.filter?.trashNonEmpty || player.trash.length > 0)
    .map(([id]) => id);
}

function openRuntimePlayerSelection(state, playerId, source, action, runtime) {
  const candidates = runtimePlayerCandidates(state, action);
  if (!candidates.length) return false;
  const request = createSelectionRequest({
    mode: "single", candidates, count: 1,
    candidateLabels: Object.fromEntries(candidates.map((id) => [id, state.players[id].user.name])),
    label: `${source.name}: ユーザーを選択`, message: source.text,
    continuation: {
      type: "runtime-player-selection", playerId, sourceId: source.id, sourceUid: source.uid, sourceName: source.name,
      candidates, recordAs: action.recordAs, afterActions: action.afterActions ?? [], runtime
    }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

function runtimeAccessBounds(action, candidateCount) {
  const configuredMaximum = action.maximum === "all" ? candidateCount : Number(action.maximum ?? action.count ?? 1);
  return {
    maximum: Math.min(candidateCount, Math.max(0, configuredMaximum)),
    minimum: Math.max(0, Number(action.minimum ?? action.count ?? 1))
  };
}

function runtimeReferenceCandidates(player, source, action) {
  if (!action.referenceSelection) return [];
  const zone = action.referenceSelection.source === "own_hand" ? player.hand : [];
  return zone.filter((card) => card.uid !== source.uid && runtimeAccessCandidates(player, action, card).length >= runtimeAccessBounds(action, runtimeAccessCandidates(player, action, card).length).minimum);
}

function runtimeSourceFromContinuation(state, continuation) {
  const source = {
    ...(CARD_LIBRARY[continuation.sourceId] ?? {}),
    id: continuation.sourceId,
    uid: continuation.sourceUid,
    name: continuation.sourceName,
    ...(continuation.sourceRuntime ?? {})
  };
  if (state.runtimeContext) {
    const alias = state.runtimeContext.uidAliases.find((entry) => entry.uid === continuation.sourceUid);
    if (!alias) throw new RuntimeError("RUNTIME_UNKNOWN_SOURCE_ALIAS");
    source.identity = { ...alias.identity };
    source.ownerSeat = alias.ownerSeat;
  }
  return source;
}

function openRuntimeAccessSelection(state, playerId, source, action, referenceCard = null, revealedUid = null, continuationMeta = {}) {
  const player = state.players[playerId];
  if (action.referenceSelection && !referenceCard) {
    const references = runtimeReferenceCandidates(player, source, action);
    if (!references.length) return false;
    const request = createSelectionRequest({
      mode: "single",
      candidates: references.map((card) => card.uid),
      count: 1,
      candidateLabels: Object.fromEntries(references.map((card) => [card.uid, card.name])),
      label: `${source.name}: 参照するカードを選択`,
      message: source.text,
      continuation: {
        type: "runtime-access-reference", playerId, sourceId: source.id, sourceUid: source.uid,
        sourceName: source.name, action
      }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  const candidates = runtimeAccessCandidates(player, action, referenceCard);
  const { minimum, maximum } = runtimeAccessBounds(action, candidates.length);
  if (candidates.length < minimum) return false;
  const mode = action.mode ?? (minimum === maximum ? (maximum === 1 ? "single" : "exact") : "up_to");
  const destinationType = action.destination === "drag"
    ? "access-drag"
    : action.destination === "distribute"
      ? "access-distribute"
      : "access-to-hand";
  const request = createSelectionRequest({
    mode,
    candidates: candidates.map((card) => card.uid),
    count: maximum,
    minimum,
    maximum,
    budget: action.totalOriginalMemoryMaximum,
    candidateValues: action.totalOriginalMemoryMaximum === undefined
      ? undefined
      : Object.fromEntries(candidates.map((card) => [card.uid, Number(card.cost ?? 0)])),
    candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])),
    label: `${source.name}: アクセスするカードを選択`,
    message: source.text,
    continuation: {
      type: destinationType,
      playerId,
      sourceId: source.id,
      sourceUid: source.uid,
      sourceName: source.name,
      sourceRuntime: {
        ocPaidAmount: source.ocPaidAmount,
        executedFromRegistry: source.executedFromRegistry
      },
      enterSleep: Boolean(action.enterSleep),
      destinations: action.destinations,
      afterActions: action.afterActions,
      revealSelected: Boolean(action.reveal),
      revealedUid,
      ...continuationMeta
    }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

function runtimeActionCandidates(state, playerId, source, action, runtime) {
  if (action.type !== "decode") return [];
  const context = { state, playerId, source, runtime };
  return state.players[playerId].trash.filter((card) => runtimeSpecMatchesCard(card, action.filter, null, context)
    && (action.totalOriginalMemoryMaximum === undefined || Number(card.cost ?? 0) <= Number(action.totalOriginalMemoryMaximum)));
}

function runtimeActionFeasible(state, playerId, source, action, runtime) {
  if (action.type === "select") {
    return runtimeSelectionCandidates(state, playerId, source, action, runtime).length >= Number(action.minimum ?? action.count ?? 1);
  }
  if (action.type === "select_player") return runtimePlayerCandidates(state, action).length > 0;
  if (action.type === "choose_zone") return runtimeZoneChoiceOptions(state, playerId, source, action).length > 0;
  if (action.type === "move" && action.target === "recorded_cards") {
    const recorded = runtime.records?.[action.recordKey];
    const uid = Array.isArray(recorded) ? recorded[0] : recorded;
    const location = findCard(state, uid);
    if (!location || location.zoneName !== action.source) return false;
    return action.destination !== "back" || placementResult(state.players[location.playerId], "back").ok;
  }
  if (action.type === "move" && action.target === "activation_target") {
    const location = findCard(state, runtime.records?.activation_target_uid);
    const destination = runtimeSpecValue(state, playerId, source, action.destination, runtime);
    return location?.playerId === playerId
      && ["front", "back"].includes(location.zoneName)
      && isObCard(location.card)
      && ["front", "back"].includes(destination)
      && location.zoneName !== destination
      && placementResult(state.players[playerId], destination).ok;
  }
  if (action.type === "destroy" && action.target === "activation_target") {
    const location = findCard(state, runtime.records?.activation_target_uid);
    return Boolean(location && ["front", "back"].includes(location.zoneName));
  }
  if (action.type !== "decode") return true;
  return runtimeActionCandidates(state, playerId, source, action, runtime).length >= Number(action.minimum ?? action.count ?? 1);
}

function triggerActionFeasible(state, playerId, action) {
  const enemyId = otherPlayer(playerId);
  if (action.type === "select") {
    if (action.selector === "one_own_ob") return [...state.players[playerId].front, ...state.players[playerId].back].some(isObCard);
    if (action.selector === "one_enemy_ob") return [...state.players[enemyId].front, ...state.players[enemyId].back].some(isObCard);
    if (action.selector === "one_non_ob") return Object.values(state.players).some((player) => [...player.front, ...player.back].some((card) => !isObCard(card)));
  }
  if (action.type === "destroy_all" && action.target === "enemy_non_ob") {
    return [...state.players[enemyId].front, ...state.players[enemyId].back].some((card) => !isObCard(card));
  }
  return true;
}

function openRuntimeDecodeSelection(state, playerId, source, action, runtime) {
  const candidates = runtimeActionCandidates(state, playerId, source, action, runtime);
  const minimum = Math.max(0, Number(action.minimum ?? action.count ?? 1));
  const maximum = Math.min(candidates.length, Math.max(0, Number(action.maximum ?? action.count ?? 1)));
  if (candidates.length < minimum) return false;
  const request = createSelectionRequest({
    mode: minimum === maximum ? (maximum === 1 ? "single" : "exact") : "up_to",
    candidates: candidates.map((card) => card.uid),
    count: maximum,
    minimum,
    maximum,
    budget: action.totalOriginalMemoryMaximum,
    candidateValues: action.totalOriginalMemoryMaximum === undefined
      ? undefined
      : Object.fromEntries(candidates.map((card) => [card.uid, Number(card.cost ?? 0)])),
    candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])),
    label: `${source.name}: デコードするカードを選択`,
    message: source.text,
    continuation: {
      type: "runtime-decode",
      playerId,
      sourceId: source.id,
      sourceUid: source.uid,
      sourceName: source.name,
      runtime,
      enterSleep: Boolean(action.enterSleep),
      destroyAtTurnEnd: Boolean(action.destroyAtTurnEnd),
      destroyTurnPlayerId: action.destroyAtTurnEnd ? state.active : null
    }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

function openRuntimeChoiceSelection(state, playerId, source, action, runtime) {
  if (action.recordAs) runtime.records[action.recordAs] = runtimeSpecValue(state, playerId, source, action.value, runtime);
  const choices = action.choices.filter((choice) => choice.actions.every((nested) => runtimeActionFeasible(state, playerId, source, nested, runtime)));
  if (!choices.length) return false;
  const request = selectionRequestFromSpec(createChoiceSpec({ options: choices.map((choice) => choice.label) }), {
    label: `${source.name}: 効果を選択`,
    message: action.recordAs ? `X=${runtime.records[action.recordAs]}` : source.text,
    continuation: {
      type: "runtime-effect-choice",
      playerId,
      sourceId: source.id,
      sourceUid: source.uid,
      sourceName: source.name,
      choices,
      runtime
    }
  });
  state.pending = { type: "selection", validTargets: [], request };
  return true;
}

function runtimeZoneChoiceOptions(state, playerId, source, action) {
  const location = findCard(state, source.uid);
  if (location?.playerId !== playerId || !["front", "back"].includes(location.zoneName)) return [];
  const requested = action.destinations === "other_area"
    ? [location.zoneName === "front" ? "back" : "front"]
    : action.destinations ?? [];
  return requested.filter((zone) => ["front", "back"].includes(zone) && placementResult(state.players[playerId], zone).ok);
}

function openRuntimeZoneChoice(state, playerId, source, action, runtime) {
  const location = findCard(state, source.uid);
  const options = runtimeZoneChoiceOptions(state, playerId, source, action);
  if (!location || !options.length) return false;
  const request = createSelectionRequest({
    mode: "scope", scopeField: "destination", scopeOptions: options,
    label: `${source.name}: 移動先を選択`, message: source.text,
    continuation: {
      type: "runtime-zone-choice", playerId, sourceId: source.id, sourceUid: source.uid, sourceName: source.name,
      options, sourceZone: location.zoneName, sourceZoneRecord: action.sourceZoneRecord,
      destinationRecord: action.destinationRecord, afterActions: action.afterActions ?? [], runtime
    }
  });
  state.pending = { type: "selection", validTargets: [], request };
  return true;
}

function runtimeSpellAccessFailure(state, playerId, card) {
  const spec = cardRuntimeSpec(card.id, "spell");
  if (!spec) return null;
  const player = state.players[playerId];
  for (const action of spec.actions.filter((item) => item.type === "select_player")) {
    if (!runtimePlayerCandidates(state, action).length) return "条件を満たすユーザーがいない。";
  }
  for (const action of spec.actions.filter((item) => item.type === "access")) {
    if (action.referenceSelection) {
      if (!runtimeReferenceCandidates(player, card, action).length) return "参照条件を満たすアクセス先がない。";
      continue;
    }
    const candidates = runtimeAccessCandidates(player, action);
    if (candidates.length < runtimeAccessBounds(action, candidates.length).minimum) return "条件を満たすアクセス先が足りない。";
  }
  return null;
}

function queueRuntimeDestructionContinuation(state, targetUid, continuation) {
  (state.runtimeDestructionContinuations ??= {})[targetUid] = continuation;
}

function settleRuntimeDestructionContinuation(state, targetUid, destroyed) {
  const continuation = state.runtimeDestructionContinuations?.[targetUid];
  if (!continuation) return false;
  delete state.runtimeDestructionContinuations[targetUid];
  continuation.runtime.records[continuation.recordAs] = destroyed ? 1 : 0;
  return executeRuntimeActions(
    state,
    continuation.playerId,
    runtimeSourceFromContinuation(state, continuation),
    continuation.remainingActions,
    { runtime: continuation.runtime }
  );
}

function settleDestructionContinuations(state, targetUid, destroyed) {
  const runtime = settleRuntimeDestructionContinuation(state, targetUid, destroyed);
  const sacredTree = settleStd142DestructionContinuation(state, targetUid, destroyed);
  const scrapPatchwork = settleStd211DestructionContinuation(state, targetUid, destroyed);
  const placementCost = settlePlacementCostDestruction(state, targetUid, destroyed);
  return runtime || sacredTree || scrapPatchwork || placementCost;
}

function continueStd211DestructionBatch(state) {
  const batch = state.std211DestructionBatch;
  if (!batch || state.pending || state.prompt || state.deferredDestruction) return false;
  const player = state.players[batch.playerId];
  while (batch.queue.length) {
    const targetUid = batch.queue.shift();
    const target = findCard(state, targetUid);
    if (!target || target.playerId !== batch.playerId || !["front", "back"].includes(target.zoneName)
      || !(target.card.classes ?? []).some((value) => classKey(value) === classKey(batch.className))) continue;
    (state.std211DestructionContinuations ??= {})[targetUid] = true;
    destroyCard(state, batch.playerId, targetUid, { source: batch.sourceName, suppressReplacement: true });
    return true;
  }
  const resultGate = resultCountGate(batch.destroyedCount);
  if (resultGate.shouldResolveDependentBlock) {
    drawCards(state, batch.playerId, resultGate.count);
    addLog(state, `${batch.sourceName}: クラス「${batch.className}」を${resultGate.count}枚破壊し、${resultGate.count}枚ドロー。`, "effect");
  } else {
    addLog(state, `${batch.sourceName}: 破壊実績が0枚のため、後続のドロー処理を行わず終了。`, "effect");
  }
  delete state.std211DestructionBatch;
  return continueDeferredSpellCleanup(state);
}

function settleStd211DestructionContinuation(state, targetUid, destroyed) {
  if (!state.std211DestructionContinuations?.[targetUid]) return false;
  delete state.std211DestructionContinuations[targetUid];
  if (!Object.keys(state.std211DestructionContinuations).length) delete state.std211DestructionContinuations;
  if (destroyed) state.std211DestructionBatch.destroyedCount += 1;
  return continueStd211DestructionBatch(state);
}

function executeRuntimeActions(state, playerId, source, actions, { targetUid = null, targetUids = [], runtime = { records: Object.create(null) }, continuationMeta = {} } = {}) {
  const player = state.players[playerId];
  const enemyId = otherPlayer(playerId);
  for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
    const action = actions[actionIndex];
    if (!runtimeSpecCondition(state, playerId, source, action.condition, runtime, targetUid)) continue;
    const amount = action.amount === undefined ? 0 : Number(runtimeSpecValue(state, playerId, source, action.amount, runtime));
    if (action.type === "select") {
      return openRuntimeTargetSelection(state, playerId, source, action, runtime, continuationMeta);
    } else if (action.type === "select_player") {
      return openRuntimePlayerSelection(state, playerId, source, action, runtime);
    } else if (action.type === "choose_zone") {
      return openRuntimeZoneChoice(state, playerId, source, action, runtime);
    } else if (action.type === "deal_damage" && action.target === "enemy_user") {
      dealFortressDamage(state, enemyId, amount, playerId, source.name);
    } else if (action.type === "deal_damage" && action.target === "self_user") {
      dealFortressDamage(state, playerId, amount, playerId, source.name);
    } else if (action.type === "deal_damage" && action.target === "selected_enemy_ob") {
      const target = runtimeSpecTargets(state, playerId, source, targetUid, action.target)[0];
      if (target) {
        state.lastDamageOutcome = null;
        dealCardDamage(state, enemyId, target.uid, amount, source.name, { sourcePlayerId: playerId });
        if (action.recordAs) runtime.records[action.recordAs] = state.lastDamageOutcome;
      }
    } else if (action.type === "deal_damage" && action.target === "attack_target") {
      if (targetUid === `${enemyId}-fortress`) dealFortressDamage(state, enemyId, amount, playerId, source.name);
      else {
        const target = findCard(state, targetUid);
        if (target) dealCardDamage(state, target.playerId, target.card.uid, amount, source.name, { sourcePlayerId: playerId });
      }
    } else if (action.type === "deal_damage" && action.target === "random_enemy_ob") {
      const candidates = [...state.players[enemyId].front, ...state.players[enemyId].back].filter(isObCard);
      const target = candidates[Math.floor(state.rng() * candidates.length)];
      if (target) dealCardDamage(state, enemyId, target.uid, amount, source.name, { sourcePlayerId: playerId });
    } else if (action.type === "draw") {
      const drawPlayerId = action.target === "recorded_player" ? runtime.records?.[action.playerRecord] : playerId;
      if (!state.players[drawPlayerId]) return false;
      drawCards(state, drawPlayerId, amount);
    } else if (action.type === "recover_memory" && action.target === "source_controller") {
      const before = player.memory;
      player.memory = Math.min(getMaxMemory(player), player.memory + amount);
      addLog(state, `${source.name}: メモリ ${before}→${player.memory}。`, "effect");
    } else if (action.type === "recover_memory" && action.target === "recorded_player") {
      const beneficiary = state.players[runtime.records?.[action.playerRecord]];
      if (!beneficiary) return false;
      const before = beneficiary.memory;
      beneficiary.memory = Math.min(getMaxMemory(beneficiary), beneficiary.memory + amount);
      addLog(state, `${source.name}: 所持ユーザーのメモリ ${before}→${beneficiary.memory}。`, "effect");
    } else if (action.type === "consume_memory") {
      const target = action.target === "enemy_player" ? state.players[enemyId] : player;
      const consumed = Math.min(Math.max(0, amount), Math.max(0, Number(target.memory ?? 0)));
      target.memory -= consumed;
      if (action.recordAs) runtime.records[action.recordAs] = consumed;
      addLog(state, `${source.name}: ${action.target === "enemy_player" ? "相手の" : ""}使用可能メモリを${consumed}消費。`, "effect");
    } else if (action.type === "schedule_delayed") {
      state.delayedEffects.push({
        event: action.event,
        ...(action.timing === "current_turn_end" ? { turnPlayerId: state.active } : {}),
        ...(action.timing === "next_controller_turn" ? { dueOwnerTurnsTaken: player.turnsTaken + 1 } : {}),
        type: action.action,
        ownerId: playerId,
        cardUid: source.uid,
        sourceName: source.name,
        destination: action.destination,
        resetDamage: Boolean(action.resetDamage),
        standby: Boolean(action.standby),
        sleep: Boolean(action.sleep)
      });
    } else if (action.type === "increase_memory_limit" && action.target === "source_controller") {
      player.permanentMemory += amount;
      player.memory += amount;
      queueMemoryLimitIncreasePrompt(state, playerId, source.name);
    } else if (action.type === "recover_damage" && action.target === "self_user") {
      const before = player.fortressStr;
      player.fortressStr = Math.min(player.user.maxStr, player.fortressStr + amount);
      addLog(state, `${source.name}: 自分ユーザーを${player.fortressStr - before}回復。`, "effect");
    } else if (action.type === "recover_damage" && action.target === "enemy_user") {
      const opponent = state.players[enemyId];
      const before = opponent.fortressStr;
      opponent.fortressStr = Math.min(opponent.user.maxStr, opponent.fortressStr + amount);
      addLog(state, `${source.name}: 相手ユーザーを${opponent.fortressStr - before}回復。`, "effect");
    } else if (action.type === "discard" && action.target === "own_hand_all") {
      const discarded = player.hand.splice(0);
      for (const discardedCard of discarded) moveCardToTrash(state, playerId, discardedCard, source.name);
      if (action.recordAs) runtime.records[action.recordAs] = discarded.length;
      addLog(state, `${source.name}: 手札${discarded.length}枚を捨てた。`, "effect");
    } else if (action.type === "discard" && action.target === "selected_cards") {
      let discarded = 0;
      for (const uid of targetUids.length ? targetUids : [targetUid].filter(Boolean)) {
        const index = player.hand.findIndex((card) => card.uid === uid);
        if (index < 0) continue;
        moveCardToTrash(state, playerId, player.hand.splice(index, 1)[0], source.name);
        discarded += 1;
      }
      if (action.recordAs) runtime.records[action.recordAs] = discarded;
      if (!discarded) return false;
      addLog(state, `${source.name}: 選択した手札${discarded}枚を捨てた。`, "effect");
    } else if (action.type === "discard" && action.target === "random_enemy_hand") {
      const enemy = state.players[enemyId];
      let discarded = 0;
      for (let index = 0; index < Number(action.count ?? 1) && enemy.hand.length; index += 1) {
        const randomIndex = Math.floor(state.rng() * enemy.hand.length);
        moveCardToTrash(state, enemyId, enemy.hand.splice(randomIndex, 1)[0], source.name);
        discarded += 1;
      }
      addLog(state, `${source.name}: 相手手札をランダムに${discarded}枚捨てた。`, "effect");
    } else if (action.type === "destroy" && action.target === "selected_enemy_area_card") {
      destroyCard(state, enemyId, targetUid, { source: source.name });
    } else if (action.type === "destroy" && action.target === "selected_own_ob") {
      const target = runtimeSpecTargets(state, playerId, source, targetUid, action.target)[0];
      if (target) destroyCard(state, playerId, target.uid, { source: source.name });
    } else if (action.type === "destroy" && action.target === "selected_own_area_card") {
      const location = findCard(state, targetUid);
      if (action.recordAs && location?.playerId === playerId && ["front", "back"].includes(location.zoneName)) {
        queueRuntimeDestructionContinuation(state, targetUid, {
          playerId,
          sourceId: source.id,
          sourceUid: source.uid,
          sourceName: source.name,
          sourceRuntime: source.runtimeTargetClass ? { runtimeTargetClass: source.runtimeTargetClass } : {},
          recordAs: action.recordAs,
          remainingActions: actions.slice(actionIndex + 1),
          runtime
        });
        destroyCard(state, playerId, targetUid, { source: source.name, suppressReplacement: Boolean(action.suppressReplacement) });
        return true;
      }
      const destroyed = location?.playerId === playerId && ["front", "back"].includes(location.zoneName)
        ? destroyCard(state, playerId, targetUid, { source: source.name, suppressReplacement: Boolean(action.suppressReplacement) })
        : false;
      if (action.recordAs) runtime.records[action.recordAs] = destroyed ? 1 : 0;
    } else if (action.type === "destroy" && action.target === "source") {
      if (!destroyCard(state, playerId, source.uid, { source: `${source.name}の効果`, suppressReplacement: Boolean(action.suppressReplacement) })) return false;
    } else if (action.type === "destroy" && action.target === "activation_target") {
      const uid = runtime.records?.activation_target_uid ?? targetUid;
      const location = findCard(state, uid);
      if (!location || (action.owner === "enemy" && location.playerId === playerId)
        || (action.zones?.includes("area") && !["front", "back"].includes(location.zoneName))) return false;
      const category = location.card.category;
      const destroyed = destroyCard(state, location.playerId, uid, { source: source.name, suppressReplacement: Boolean(action.suppressReplacement) });
      if (action.recordAs) runtime.records[action.recordAs] = destroyed ? 1 : 0;
      if (destroyed && action.recordCategoryAs) runtime.records[action.recordCategoryAs] = category;
    } else if (action.type === "destroy" && action.target === "selected_own_registry_cards") {
      let destroyed = 0;
      for (const uid of targetUids.length ? targetUids : [targetUid].filter(Boolean)) {
        const index = player.registry.findIndex((card) => card.uid === uid);
        if (index < 0) continue;
        moveCardToTrash(state, playerId, player.registry.splice(index, 1)[0], source.name);
        destroyed += 1;
      }
      if (action.recordAs) runtime.records[action.recordAs] = destroyed;
    } else if (action.type === "remove_components" && action.target === "selected_user_or_card") {
      if (String(targetUid).endsWith("-fortress")) {
        const targetPlayer = state.players[String(targetUid).startsWith("player-") ? "player" : "ai"];
        targetPlayer.counters = {};
        targetPlayer.timedModifiers = [];
      } else {
        const target = findCard(state, targetUid)?.card;
        if (target) clearComponents(target);
      }
    } else if (action.type === "sleep" && action.target === "enemy_ob_all") {
      for (const target of [...state.players[enemyId].front, ...state.players[enemyId].back].filter(isObCard)) {
        setCardSleeping(state, enemyId, target);
      }
    } else if (action.type === "add_counter" && action.target === "enemy_user") {
      const target = state.players[enemyId];
      target.counters ??= {};
      target.counters[action.counter] = Number(target.counters[action.counter] ?? 0) + amount;
      if (action.counter === "madness") resolveMadnessChecks(state, enemyId);
    } else if (action.type === "add_counter" && action.target === "selected_enemy_ob") {
      const target = runtimeSpecTargets(state, playerId, source, targetUid, action.target)[0];
      if (target) {
        if (action.counter === "load") target.load = Number(target.load ?? 0) + amount;
        else {
          target.counters ??= {};
          target.counters[action.counter] = Number(target.counters[action.counter] ?? 0) + amount;
        }
      }
    } else if (action.type === "move_all" && action.source === "own_hand" && action.destination === "registry") {
      const moved = player.hand.splice(0);
      for (const card of moved) {
        player.registry.push(card);
        emitRegistryInstalled(state, playerId, card, source.name);
      }
    } else if (action.type === "move_event_cards" && action.destination === "ban") {
      banGeneratedCards(state, runtime.records?.eventCardUids ?? [], source.name);
      if (action.recordAs) runtime.records[action.recordAs] = moved.length;
    } else if (action.type === "move_all" && action.source === "recorded_player_trash" && action.destination === "recorded_player_deck") {
      const target = state.players[runtime.records?.[action.playerRecord]];
      if (!target) return false;
      const moved = target.trash.filter((card) => !action.excludeSource || card.uid !== source.uid);
      target.trash = target.trash.filter((card) => action.excludeSource && card.uid === source.uid);
      target.deck.push(...moved);
      if (action.shuffleAfter) target.deck = shuffle(target.deck, state.rng);
    } else if (action.type === "move" && action.target === "selected_cards") {
      let moved = 0;
      for (const uid of targetUids.length ? targetUids : [targetUid].filter(Boolean)) {
        const location = findCard(state, uid);
        if (!location || location.playerId !== playerId || location.zoneName !== action.source) continue;
        if (["front", "back"].includes(action.source) && ["front", "back"].includes(action.destination)) {
          if (moveCardByEffect(state, playerId, uid, action.destination, source.name)) moved += 1;
          continue;
        }
        if (["area", "back"].includes(action.destination)) {
          const zone = action.destination === "back"
            ? "back"
            : player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
          const placed = placeCardByEffect(state, {
            sourceOwnerId: playerId, controllerId: playerId, sourceZone: action.source, targetZone: zone, cardUid: uid,
            sourceName: source.name, placementMode: action.forced ? "forced-effect" : "normal",
            onPlaced: (card) => { card.summoningSick = zone === "front"; card.faceDown = Boolean(action.asScript); }
          });
          if (placed.status === "placed") moved += 1;
          continue;
        }
        if (action.destination === "drag") {
          state.pending = { type: "access-drag-place", playerId, sourceName: source.name, queue: [uid], sourceUid: uid,
            ...(continuationMeta.triggerItemId ? { triggerItemId: continuationMeta.triggerItemId } : {}) };
          moved += 1;
          continue;
        }
        if (action.destination === "registry") {
          const index = player[action.source].findIndex((card) => card.uid === uid);
          if (index < 0) continue;
          const [card] = player[action.source].splice(index, 1);
          if (["front", "back"].includes(action.source)) revealMountedCode(player[action.source], index, card, playerId, action.source);
          card.faceDown = Boolean(action.faceDown);
          player.registry.push(card);
          if (["front", "back"].includes(action.source)) distributeLayeredFollowers(state, card, "registry", source.name);
          if (!card.faceDown) emitRegistryInstalled(state, playerId, card, source.name);
          moved += 1;
        }
        if (action.destination === "hand") {
          const index = player[action.source].findIndex((card) => card.uid === uid);
          if (index < 0) continue;
          const [card] = player[action.source].splice(index, 1);
          if (["front", "back"].includes(action.source)) revealMountedCode(player[action.source], index, card, playerId, action.source);
          player.hand.push(card);
          if (["front", "back"].includes(action.source)) distributeLayeredFollowers(state, card, "hand", source.name);
          moved += 1;
        }
        if (action.destination === "bottom_layer_of_recorded_host") {
          const recorded = runtime.records?.[action.hostRecord];
          const hostUid = Array.isArray(recorded) ? recorded[0] : recorded;
          const host = findCard(state, hostUid)?.card;
          const index = player[action.source].findIndex((card) => card.uid === uid);
          if (!host || index < 0) continue;
          const [layer] = player[action.source].splice(index, 1);
          layer.layerRole = "layered";
          host.mounted.unshift(layer);
          moved += 1;
        }
      }
      if (!moved) return false;
      addLog(state, `${source.name}: 選択した${moved}枚を${action.destination === "registry" ? "レジストリ" : "エリア"}へ移動。`, "effect");
    } else if (action.type === "move" && action.target === "source") {
      const destination = runtimeSpecValue(state, playerId, source, action.destination, runtime);
      if (!moveCardByEffect(state, playerId, source.uid, destination, source.name)) return false;
    } else if (action.type === "move" && action.target === "activation_target") {
      const destination = runtimeSpecValue(state, playerId, source, action.destination, runtime);
      const uid = runtime.records?.activation_target_uid ?? targetUid;
      const location = findCard(state, uid);
      const controllerId = location?.playerId;
      if (!controllerId || (action.owner === "enemy" && controllerId === playerId) || (action.source !== "area" && location.zoneName !== action.source)) return false;
      if (action.controllerRecord) runtime.records[action.controllerRecord] = controllerId;
      if (action.sourceZoneRecord) runtime.records[action.sourceZoneRecord] = location.zoneName;
      if (!moveCardByEffect(state, controllerId, uid, destination, source.name)) return false;
    } else if (action.type === "move" && action.target === "recorded_cards") {
      const recorded = runtime.records?.[action.recordKey];
      const uid = Array.isArray(recorded) ? recorded[0] : recorded;
      const location = findCard(state, uid);
      if (!location || location.zoneName !== action.source) return false;
      const controller = state.players[location.playerId];
      const beneficiaryId = location.card.owner ?? location.playerId;
      const index = controller[action.source].findIndex((card) => card.uid === uid);
      if (index < 0) return false;
      if (action.destination === "hand") {
        controller.hand.push(...controller[action.source].splice(index, 1));
      } else if (action.destination === "back") {
        if (!placementResult(controller, "back").ok) return false;
        const [moved] = controller[action.source].splice(index, 1);
        if (placeByMode(state, location.playerId, moved, { zone: "back", mode: "normal", from: action.source, source: source.name }) !== "placed") return false;
        triggerMoved(state, location.playerId, moved, action.source, "back");
      } else return false;
      if (action.beneficiaryRecord) runtime.records[action.beneficiaryRecord] = beneficiaryId;
    } else if (action.type === "move" && action.target === "random_each_player" && action.destination === "ban") {
      for (const targetPlayer of Object.values(state.players)) {
        const pool = action.source === "hand_and_area"
          ? ["hand", "front", "back"].flatMap((zoneName) => targetPlayer[zoneName].map((card) => ({ zoneName, card })))
          : [];
        if (!pool.length) continue;
        const chosen = pool[Math.floor(state.rng() * pool.length)];
        const index = targetPlayer[chosen.zoneName].findIndex((card) => card.uid === chosen.card.uid);
        if (index < 0) continue;
        const [card] = targetPlayer[chosen.zoneName].splice(index, 1);
        if (["front", "back"].includes(chosen.zoneName)) revealMountedCode(targetPlayer[chosen.zoneName], index, card, card.controller ?? card.owner, chosen.zoneName);
        targetPlayer.ban.push(card);
        if (["front", "back"].includes(chosen.zoneName)) distributeLayeredFollowers(state, card, "ban", source.name);
      }
    } else if (action.type === "swap" && action.target === "selected_own_area_cards") {
      const selected = [...new Set(targetUids.length ? targetUids : [targetUid].filter(Boolean))]
        .map((uid) => findCard(state, uid))
        .filter((entry) => entry?.playerId === playerId && ["front", "back"].includes(entry.zoneName) && isObCard(entry.card));
      if (selected.length !== 2) return false;
      const [first, second] = selected;
      const firstIndex = player[first.zoneName].findIndex((card) => card.uid === first.card.uid);
      const secondIndex = player[second.zoneName].findIndex((card) => card.uid === second.card.uid);
      swapBoardSlots(first.card, second.card);
      player[first.zoneName][firstIndex] = second.card;
      player[second.zoneName][secondIndex] = first.card;
      triggerMoved(state, playerId, first.card, first.zoneName, second.zoneName);
      triggerMoved(state, playerId, second.card, second.zoneName, first.zoneName);
      addLog(state, `${source.name}: ${first.card.name}と${second.card.name}の位置を交換。`, "effect");
    } else if (action.type === "mill" && action.target === "own_deck_top" && action.destination === "trash") {
      let recorded = 0;
      for (let index = 0; index < amount && player.deck.length; index += 1) {
        const card = player.deck.pop();
        const outcome = card.trashReplacement === "ban" || card.replaceTrashWithBan
          ? (player.ban.push(card), "ban")
          : moveCardToTrash(state, playerId, card, source.name);
        if (outcome === "trash" && runtimeSpecMatchesCard(card, action.recordFilter, null, { state, playerId, source, runtime })) recorded += 1;
      }
      if (action.recordAs) runtime.records[action.recordAs] = recorded;
    } else if (action.type === "shuffle" && action.target === "own_deck") {
      player.deck = shuffle(player.deck, state.rng);
    } else if (action.type === "access") {
      openRuntimeAccessSelection(state, playerId, source, action, null, null, continuationMeta);
    } else if (action.type === "decode") {
      return openRuntimeDecodeSelection(state, playerId, source, action, runtime);
    } else if (action.type === "choose_effect") {
      return openRuntimeChoiceSelection(state, playerId, source, action, runtime);
    } else if (action.type === "modify_stats") {
      const runtimeSource = action.className ? { ...source, runtimeTargetClass: action.className } : source;
      for (const target of runtimeSpecTargets(state, playerId, runtimeSource, targetUid, action.target)) {
        const multiplier = action.perTargetMultiplier === "layer_count"
          ? Number(target.mounted?.length ?? 0)
          : action.multiplier ? Number(runtimeSpecValue(state, playerId, source, action.multiplier, runtime)) : 1;
        if (action.duration === "through_next_turn") {
          addTimedModifier(state, target, { ...action, atk: Number(action.atk ?? 0) * multiplier, str: Number(action.str ?? 0) * multiplier }, source.name);
        } else {
          const atkField = action.duration === "turn" ? "tempAtk" : "permanentAtk";
          const strField = action.duration === "turn" ? "tempStr" : "permanentStr";
          target[atkField] = Number(target[atkField] ?? 0) + Number(action.atk ?? 0) * multiplier;
          target[strField] = Number(target[strField] ?? 0) + Number(action.str ?? 0) * multiplier;
        }
      }
    } else if (action.type === "modify_execution_cost" && action.target === "selected_cards") {
      for (const uid of targetUids.length ? targetUids : [targetUid].filter(Boolean)) {
        const target = findCard(state, uid)?.card;
        if (!target) continue;
        target.turnCostModifier = Number(target.turnCostModifier ?? 0) + amount;
      }
    } else if (action.type === "grant_keyword") {
      const runtimeSource = action.className ? { ...source, runtimeTargetClass: action.className } : source;
      for (const target of runtimeSpecTargets(state, playerId, runtimeSource, targetUid, action.target)) {
        target.grantedKeywords = [...new Set([...(target.grantedKeywords ?? []), action.keyword])];
        if (action.duration === "turn") target.keywordExpiries = { ...(target.keywordExpiries ?? {}), [action.keyword]: state.turnNumber };
        if (action.duration === "through_next_turn_end") target.keywordExpiries = { ...(target.keywordExpiries ?? {}), [action.keyword]: state.turnNumber + 1 };
      }
    } else if (action.type === "set_flag") {
      const value = runtimeSpecValue(state, playerId, source, action.value);
      if (action.target === "own_class_ob_all") {
        for (const target of runtimeSpecTargets(state, playerId, { ...source, runtimeTargetClass: action.className }, targetUid, action.target)) target[action.flag] = value;
      } else {
        const target = action.target === "enemy_player" ? state.players[enemyId] : source;
        target[action.flag] = value;
      }
    } else if (action.type === "move" && action.target === "deck_top" && action.destination === "registry") {
      for (let index = 0; index < Number(action.count ?? 1); index += 1) {
        const installed = player.deck.pop();
        if (!installed) break;
        player.registry.push(installed);
        emitRegistryInstalled(state, playerId, installed, source.name);
      }
    } else if (action.type === "generate") {
      const generated = [];
      const generatedPlayerId = action.playerRecord ? runtime.records?.[action.playerRecord] : playerId;
      const generatedPlayer = state.players[generatedPlayerId];
      if (!generatedPlayer) return false;
      const availableIds = action.cardIds ?? Array(Number(action.count ?? 1)).fill(action.cardId);
      const cardIds = action.randomOne
        ? [availableIds[Math.floor(state.rng() * availableIds.length)]]
        : availableIds;
      const destination = runtimeSpecValue(state, playerId, source, action.destination, runtime);
      for (let index = 0; index < cardIds.length; index += 1) {
        const card = action.factory === "punks_token"
          ? hydrateCard(createRuntimeToken(state.runtimeContext ?? null, generatedPlayerId, ++state.tokenSerial))
          : createVengeanceCard(state, cardIds[index], generatedPlayerId);
        generated.push(card);
        if (destination === "hand") {
          generatedPlayer.hand.push(card);
          continue;
        }
        if (destination === "execute") {
          generatedPlayer.hand.push(card);
          const zone = card.category === "Script"
            ? (generatedPlayer.back.length < generatedPlayer.user.backLimit ? "back" : "front")
            : (generatedPlayer.front.length < generatedPlayer.user.frontLimit ? "front" : generatedPlayer.back.length < generatedPlayer.user.backLimit ? "back" : "front");
          playCard(state, generatedPlayerId, card.uid, {
            zone, free: Boolean(action.free), force: Boolean(action.forced), ignoreColor: Boolean(action.free),
            placementCause: "effect", placementSource: source.name, placementMode: action.forced ? "forced-effect" : "normal"
          });
          continue;
        }
        const zone = ["front", "back"].includes(destination)
          ? destination
          : generatedPlayer.front.length < generatedPlayer.user.frontLimit ? "front" : generatedPlayer.back.length < generatedPlayer.user.backLimit ? "back" : "front";
        card.summoningSick = zone === "front";
        const placed = placeByMode(state, generatedPlayerId, card, { zone, from: "generated", source: source.name });
        if (placed === "placed" && action.factory === "punks_token") emitEffectPlacement(state, generatedPlayerId, card, zone, source.name);
      }
      if (destination === "hand" && generated.length) emitCardsGenerated(state, generatedPlayerId, generated, source.name);
    } else if (action.type === "consume_layers" && action.target === "selected_cards") {
      const selected = new Set(targetUids.length ? targetUids : [targetUid].filter(Boolean));
      let consumed = 0;
      for (const owner of Object.values(state.players)) {
        for (const { host, layer } of ownLayerEntries(owner)) {
          if (!selected.has(layer.uid)) continue;
          const index = host.mounted.findIndex((candidate) => candidate.uid === layer.uid);
          if (index < 0) continue;
          const [removed] = host.mounted.splice(index, 1);
          moveCardToTrash(state, removed.owner ?? playerId, removed, `${source.name}のレイヤー消費`);
          consumed += 1;
        }
      }
      if (action.recordAs) runtime.records[action.recordAs] = consumed;
      addLog(state, `${source.name}: レイヤー${consumed}枚を消費。`, "effect");
    } else if (action.type === "repeat_select_move") {
      const remaining = Number(runtimeSpecValue(state, playerId, source, action.count, runtime));
      if (remaining > 0) return openRuntimeRepeatSelectMove(state, playerId, source, action, runtime, remaining);
    } else throw new Error(`Unsupported card runtime operation: ${action.type}`);
  }
  return true;
}

function executeCardRuntimeSpec(state, phase, playerId, source, { targetUid = null, continuationMeta = {} } = {}) {
  const spec = cardRuntimeSpec(source.id, phase);
  if (!spec) return false;
  return executeRuntimeActions(state, playerId, source, spec.actions, { targetUid, continuationMeta });
}

function openRuntimeRepeatSelectMove(state, playerId, source, action, runtime, remaining) {
  const candidates = runtimeSelectionCandidates(state, playerId, source, { selector: action.selector }, runtime);
  if (!candidates.length || remaining <= 0) return true;
  const request = createSelectionRequest({
    mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
    candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])),
    label: `${action.label ?? "カードを選択"}（残り${remaining}回）`, message: source.text,
    continuation: {
      type: "runtime-repeat-select-move", playerId, sourceId: source.id, sourceUid: source.uid,
      sourceName: source.name, selector: action.selector, sourceZone: action.source,
      destination: action.destination, remaining, runtime, label: action.label
    }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

function resumeDestroyLkiFollowUp(state, targetUid) {
  const followUp = state.destroyLkiFollowUps?.[targetUid];
  if (!followUp) return false;
  delete state.destroyLkiFollowUps[targetUid];
  const player = state.players[followUp.playerId];
  if (followUp.type === "std157") {
    const candidates = player.hand.filter((card) => isObCard(card) && card.color === "黒" && Number(card.cost ?? 0) <= followUp.x);
    if (!candidates.length) return true;
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      label: `元メモリ${followUp.x}以下の黒Obを無償配置`, message: followUp.sourceName,
      continuation: { type: "std157-place", playerId: followUp.playerId, sourceName: followUp.sourceName } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  const candidates = player.trash.filter(isObCard);
  if (!candidates.length) return true;
  const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((card) => card.uid), minimum: 0, maximum: candidates.length,
    budget: followUp.x, candidateValues: Object.fromEntries(candidates.map((card) => [card.uid, Number(card.cost ?? 0)])),
    label: `元メモリ合計${followUp.x}以下でObを任意サルベージ`, message: followUp.sourceName,
    continuation: { type: "std162-salvage", playerId: followUp.playerId, sourceName: followUp.sourceName } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

function executeQueuedTrigger(state, trigger) {
  trigger.status = "resolving";
  if (trigger.spec.limit === "once_per_turn") state.players[trigger.source.playerId].triggerUsage[trigger.spec.id] = true;
  addLog(state, `誘発: ${trigger.source.card.name}（${trigger.event.type}）`, "effect");
  if (trigger.runtimePhase) executeCardRuntimeSpec(state, trigger.runtimePhase, trigger.source.playerId, trigger.source.card, {
    continuationMeta: { triggerItemId: trigger.id }
  });
  else for (const action of trigger.spec.actions) executeTriggerAction(state, trigger, action);
  if (!state.pending) trigger.status = "resolved";
}

function finishTriggerThread(state) {
  state.triggerThread.status = "resolved";
  state.triggerThread.message = "スレッドが解決しました";
  state.threadNotice = "スレッドが解決しました";
  if (state.pending?.type === "trigger-order") state.pending = null;
  addLog(state, "スレッドが解決しました。", "system");
  state.processingTriggers = false;
  if (state.winner) finishGameIfSettled(state);
  else drainTriggerQueue(state);
}

function advanceTriggerThread(state) {
  const thread = state.triggerThread;
  if (!thread || thread.status !== "resolving") return;
  if (state.winner) {
    for (const item of thread.items.filter((entry) => entry.status === "pending")) item.status = "cancelled-after-victory-lock";
    return finishTriggerThread(state);
  }
  const unresolved = thread.items.filter((item) => item.status === "pending");
  if (!unresolved.length) return finishTriggerThread(state);

  let choices = unresolved.filter((item) => item.controllerId === thread.currentControllerId);
  if (!choices.length) {
    thread.currentControllerId = otherPlayer(thread.currentControllerId);
    choices = unresolved.filter((item) => item.controllerId === thread.currentControllerId);
  }
  if (thread.currentControllerId === "player") {
    state.pending = { type: "trigger-order", validTargets: [], threadId: thread.id };
    state.processingTriggers = false;
    return;
  }
  const item = choices[0];
  item.status = "resolving";
  executeQueuedTrigger(state, item.trigger);
  if (state.pending?.type === "selection") {
    item.status = "awaiting-selection";
    state.processingTriggers = false;
    return;
  }
  item.status = "resolved";
  thread.currentControllerId = otherPlayer(item.controllerId);
  advanceTriggerThread(state);
}

export function resolveTriggerChoice(state, itemId) {
  const thread = state.triggerThread;
  if (!thread || thread.status !== "resolving" || thread.currentControllerId !== "player") return false;
  const item = thread.items.find((entry) => entry.id === itemId && entry.status === "pending" && entry.controllerId === "player");
  if (!item) return false;
  state.processingTriggers = true;
  item.status = "resolving";
  executeQueuedTrigger(state, item.trigger);
  if (state.pending?.type === "selection") {
    item.status = "awaiting-selection";
    state.processingTriggers = false;
    return true;
  }
  item.status = "resolved";
  thread.currentControllerId = "ai";
  advanceTriggerThread(state);
  return true;
}

export function dismissThreadNotice(state) {
  state.threadNotice = null;
  if (state.triggerThread?.status === "resolved") state.triggerThread = null;
}

function resumeTriggerThreadAfterSelection(state, itemId) {
  const thread = state.triggerThread;
  const item = thread?.items.find((entry) => entry.id === itemId && entry.status === "awaiting-selection");
  if (!item) return;
  item.status = "resolved";
  thread.currentControllerId = otherPlayer(item.controllerId);
  state.processingTriggers = true;
  advanceTriggerThread(state);
}

const TRIGGER_CHOICE_ACTIONS = new Set(["select", "select_entity", "select_execute_from_trash", "choose_effect"]);

function triggerRequiresChoice(trigger) {
  if (trigger.runtimePhase) {
    const runtime = cardRuntimeSpec(trigger.source.card.id, trigger.runtimePhase);
    return runtime?.actions.some((action) => TRIGGER_CHOICE_ACTIONS.has(action.type)
      || (action.type === "access" && (action.filter || action.destination === "hand"))) ?? false;
  }
  return trigger.spec.actions.some((action) => TRIGGER_CHOICE_ACTIONS.has(action.type)
    || (action.type === "access" && (action.filter || action.destination === "hand")));
}

function drainTriggerQueue(state) {
  if (state.processingTriggers || state.effectDepth > 0) return;
  if (state.interactive && state.triggerQueue.length > 1 && !state.triggerThread?.status?.includes("resolving")) {
    const triggers = state.triggerQueue.splice(0);
    state.triggerThread = {
      id: `THREAD-${state.triggerSerial}`,
      status: "resolving",
      currentControllerId: state.active,
      message: "同時に誘発した効果の処理順を選択",
      items: triggers.map((trigger) => ({
        id: trigger.id,
        controllerId: trigger.source.playerId,
        cardName: trigger.source.card.name,
        eventType: trigger.event.type,
        text: trigger.source.card.text,
        summary: trigger.spec.actions.map(describeOperation).join(" → "),
        status: "pending",
        trigger
      }))
    };
    state.processingTriggers = true;
    advanceTriggerThread(state);
    return;
  }
  state.processingTriggers = true;
  while (state.triggerQueue.length) {
    const choiceOccupied = Boolean(state.pending || state.prompt);
    const triggerIndex = choiceOccupied ? state.triggerQueue.findIndex((trigger) => !triggerRequiresChoice(trigger)) : 0;
    if (triggerIndex < 0) break;
    const [trigger] = state.triggerQueue.splice(triggerIndex, 1);
    executeQueuedTrigger(state, trigger);
  }
  state.processingTriggers = false;
}

export function emitGameEvent(state, event) {
  const normalized = { id: `EV-${++state.triggerSerial}`, ...event };
  state.events.push(normalized);
  if (state.winner) {
    if (state.events.length > 200) state.events.shift();
    return normalized;
  }
  if (normalized.type === "registry_left") {
    const controller = state.players[normalized.playerId];
    for (const source of [...controller.front, ...controller.back].filter((card) => card.id === "STD-217" && !card.faceDown)) {
      (state.independentEffects ??= []).push({ kind: "STD-217", playerId: normalized.playerId, sourceUid: source.uid, sourceName: source.name });
    }
  }
  if (normalized.type !== "user_ability_feedback") syncMonoColorFeedback(state);
  if (state.events.length > 200) state.events.shift();
  const windows = collectTriggers(state, normalized);
  state.triggerQueue.push(...windows.filter((window) => !window.optional));
  for (const window of windows.filter((item) => item.optional)) queueDeclaredScriptActivationWindow(state, window);
  if (state.effectDepth === 0) drainTriggerQueue(state);
  return normalized;
}

const USER_ABILITY_FEEDBACK_KEYS = new Set([
  "turbo", "mono_color", "registry_liberty", "recovery_boot", "dimension_innovation",
  "do_or_isnt", "trash_never_empty", "kickass", "watching_you"
]);

const PRESENTATION_STEP_KINDS = new Set(["value_change", "measurement", "transfer", "multiply", "state_change"]);
const PRESENTATION_ZONES = new Set(["hand", "deck", "trash", "ban", "registry"]);
const PRESENTATION_METRICS = new Set(["str", "memory", "memory_limit", "atk", "effective_cost", "damage"]);
function validPresentationTarget(state, target) {
  if (!target || !state.players[target.playerId]) return false;
  if (target.kind === "zone_count") return PRESENTATION_ZONES.has(target.zone);
  if (target.kind === "player_stat") return PRESENTATION_METRICS.has(target.metric);
  if (target.kind === "card_stat") {
    if (!["atk", "effective_cost"].includes(target.metric) || typeof target.cardUid !== "string") return false;
    const found = findCard(state, target.cardUid);
    const viewer = state.viewerId ?? "player";
    return Boolean(found && found.playerId === target.playerId && (!found.card.faceDown || found.playerId === viewer)
      && (["front", "back", "registry", "trash"].includes(found.zoneName) || found.zoneName === "hand" && found.playerId === viewer));
  }
  return target.kind === "status" && typeof target.status === "string";
}
function validPresentationStep(state, step) {
  if (!step || !PRESENTATION_STEP_KINDS.has(step.kind)) return false;
  if (step.kind === "transfer") return validPresentationTarget(state, step.from) && validPresentationTarget(state, step.to) && Number.isFinite(step.count) && step.count >= 0;
  if (step.kind === "multiply") return validPresentationTarget(state, step.target) && Number.isFinite(step.before) && Number.isFinite(step.factor) && Number.isFinite(step.after);
  if (step.kind === "state_change") return validPresentationTarget(state, step.target) && typeof step.before === "boolean" && typeof step.after === "boolean";
  return validPresentationTarget(state, step.target) && Number.isFinite(step.before) && Number.isFinite(step.after);
}

function emitUserAbilityFeedback(state, abilityKey, ownerPlayerId, affectedPlayerId, fields = {}) {
  if (!USER_ABILITY_FEEDBACK_KEYS.has(abilityKey) || !state.players[ownerPlayerId] || !state.players[affectedPlayerId]) return null;
  const steps = fields.steps ?? [];
  if (!steps.length || steps.some((step) => !validPresentationStep(state, step))) return null;
  return emitGameEvent(state, {
    type: "user_ability_feedback",
    abilityKey,
    ownerPlayerId,
    affectedPlayerId,
    branch: fields.branch ?? "resolved",
    before: Number.isFinite(fields.before) ? fields.before : undefined,
    after: Number.isFinite(fields.after) ? fields.after : undefined,
    amount: Number.isFinite(fields.amount) ? fields.amount : undefined,
    strBefore: Number.isFinite(fields.strBefore) ? fields.strBefore : undefined,
    strAfter: Number.isFinite(fields.strAfter) ? fields.strAfter : undefined,
    memoryBefore: Number.isFinite(fields.memoryBefore) ? fields.memoryBefore : undefined,
    memoryAfter: Number.isFinite(fields.memoryAfter) ? fields.memoryAfter : undefined,
    anchorCardUid: typeof fields.anchorCardUid === "string" ? fields.anchorCardUid : undefined,
    steps: steps.map((step) => structuredClone(step)),
    outcome: fields.outcome ?? null
  });
}

function syncMonoColorFeedback(state) {
  const feedbackState = (state.userAbilityFeedbackState ??= {});
  for (const [playerId, player] of Object.entries(state.players)) {
    if (player.user.abilityKey !== "mono_color") continue;
    const active = enabledSymbols(player).length === 1
      && [...player.front, ...player.back].some(isObCard);
    const key = `${playerId}:mono_color`;
    const previous = Boolean(feedbackState[key]);
    feedbackState[key] = active;
    if (active && !previous) emitUserAbilityFeedback(state, "mono_color", playerId, playerId, { branch: "enabled", amount: 1, steps: [{ kind: "state_change", target: { kind: "status", playerId, status: "mono_color" }, before: false, after: true }] });
  }
}

function resolveEffect(state, resolver) {
  const ownsResolution = !state.effectResolution;
  if (ownsResolution) state.effectResolution = {
    id: `EFFECT-${++state.effectSerial}`, kind: "runtime", source: null,
    playerId: null, status: "resolving"
  };
  state.effectDepth += 1;
  try {
    return resolver();
  } finally {
    state.effectDepth -= 1;
    if (state.effectDepth === 0) {
      resolveMandatoryStateChecks(state);
      // A pending/prompt is an internal choice only when it was opened by this
      // resolution. Queued triggers are intentionally *not* a completion gate.
      if (state.pending || state.prompt) {
        if (state.effectResolution) state.effectResolution.status = "awaiting-choice";
      } else if (state.effectResolution) {
        finalizeEffectResolution(state);
      }
      if (!state.winner) drainIndependentEffects(state);
      if (!state.winner) drainTriggerQueue(state);
    }
  }
}

function recordVictoryFact(state, fact) {
  (state.victoryFacts ??= []).push({ ...fact, effectId: state.effectResolution?.id ?? null });
}

function runEffectEntry(state, kind, playerId, resolver) {
  const continuingDeclaredEffect = Boolean(
    state.winner
    && state.effectResolution?.declaredEffectId
    && ["selection", "prompt-decline"].includes(kind)
  );
  if (state.winner && kind !== "declared-effect" && !continuingDeclaredEffect) return false;
  if (!state.effectResolution) {
    state.effectResolution = { id: `EFFECT-${++state.effectSerial}`, kind, source: null, playerId, status: "resolving" };
  } else {
    state.effectResolution.status = "resolving";
  }
  normalizeBoardSlots(state);
  try {
    return resolveEffect(state, resolver);
  } finally {
    normalizeBoardSlots(state);
  }
}

function drainIndependentEffects(state) {
  if (state.effectResolution || state.pending || state.prompt || state.drainingIndependentEffects) return;
  const next = state.independentEffects?.shift();
  if (!next) return;
  state.drainingIndependentEffects = true;
  try {
    if (next.kind === "STD-217") runEffectEntry(state, next.kind, next.playerId, () => dealFortressDamage(state, otherPlayer(next.playerId), 1, next.playerId, next.sourceName));
    else if (next.kind === "SZTB-094-COUNTER") runEffectEntry(state, next.kind, next.playerId, () => beginSztb094Counter(state, next.playerId, next.sourceUid));
    else if (next.kind === "STD-165") runEffectEntry(state, next.kind, next.playerId, () => beginStd165ThresholdEffect(state, next.playerId, next.sourceUid));
  } finally {
    state.drainingIndependentEffects = false;
  }
  if (!state.winner) drainIndependentEffects(state);
}

function finalizeEffectResolution(state) {
  const completedResolution = state.effectResolution;
  const alreadyLocked = Boolean(state.victory?.lockedOutcome);
  if (!alreadyLocked) {
    const candidates = new Set();
    for (const [playerId, player] of Object.entries(state.players)) {
      if (Number(player.fortressStr) <= 0 || player.userBanned || player.mandatoryDrawFailed) candidates.add(otherPlayer(playerId));
    }
    for (const fact of state.victoryFacts ?? []) if (fact.type === "special" && fact.playerId) candidates.add(fact.playerId);
    if (candidates.size > 1) state.winner = "draw";
    else if (candidates.size === 1) state.winner = [...candidates][0];
  }
  if (state.winner && !alreadyLocked) {
    state.victory = {
      lockedOutcome: state.winner,
      lockedAtEffectId: state.effectResolution?.id ?? null,
      finished: false
    };
    state.pending = null; state.prompt = null; state.triggerQueue = [];
    state.scriptActivationQueue = []; state.activationWindows = [];
    state.selectionQueue = []; state.deferredAttack = null;
    state.responseEventQueue = []; state.mandatoryDrawContinuation = null;
    addLog(state, state.winner === "draw" ? "両ユーザーが勝利条件を満たしたため引き分け。" : `${state.players[state.winner].user.name}の勝利。`, "win");
  }
  if (completedResolution?.declaredEffectId && state.resolvingDeclaredEffect?.id === completedResolution.declaredEffectId) {
    state.resolvingDeclaredEffect.status = "resolved";
    state.resolvingDeclaredEffect = null;
  }
  state.victoryFacts = [];
  state.effectResolution = null;
  if (!drainDeclaredEffects(state)) finishGameIfSettled(state);
}

export function finishGameIfSettled(state) {
  if (!state?.winner) return false;
  const victory = state.victory ??= { lockedOutcome: state.winner, lockedAtEffectId: null, finished: false };
  if (!victory.lockedOutcome) victory.lockedOutcome = state.winner;
  const declaredWork = Boolean(
    state.effectResolution
    || state.resolvingDeclaredEffect
    || state.declaredEffects?.length
    || state.placementCostBatch
    || state.pending?.resolutionMeta
    || state.prompt?.resolutionMeta
    || state.triggerThread?.items?.some((item) => ["resolving", "awaiting-selection"].includes(item.status))
  );
  if (declaredWork || victory.finished) return false;
  victory.finished = true;
  return true;
}

function declareEffect(state, effect) {
  state.declarationSerial = Number.isSafeInteger(state.declarationSerial) && state.declarationSerial >= 0
    ? state.declarationSerial + 1
    : 1;
  const declared = {
    id: `DECLARED-${state.declarationSerial}`,
    declaredAtEffectId: state.effectResolution?.id ?? null,
    status: "declared",
    ...effect
  };
  (state.declaredEffects ??= []).push(declared);
  return declared;
}

function finishDeclaredScriptCleanup(state) {
  const deferred = state.deferredDeclaredScriptCleanup;
  if (!deferred) return false;
  const { declared, source } = deferred;
  const player = state.players[declared.playerId];
  const live = findCard(state, declared.sourceUid);
  const resident = hasKeyword(source, "RESIDENT");
  if (live) delete live.card.declaredEffectId;
  if (resident && live && live.playerId === declared.playerId && live.zoneName === "back") {
    live.card.residentActive = true;
    addLog(state, `${source.name}を起動。[レジデント]として場に残る。`, "action");
  } else if (!resident && live && live.playerId === declared.playerId && ["front", "back"].includes(live.zoneName)) {
    state.players[live.playerId][live.zoneName].splice(state.players[live.playerId][live.zoneName].findIndex((card) => card.uid === live.card.uid), 1);
    moveCardToTrash(state, declared.playerId, live.card, source.name);
    addLog(state, `${source.name}の宣言済み効果を解決し、ゴミ箱へ。`, "action");
  }
  emitGameEvent(state, {
    type: "script_activated", playerId: declared.playerId, ownerId: source.owner ?? declared.playerId,
    cardUid: source.uid, cardId: source.id, cardName: source.name, category: source.category,
    declaredEffectId: declared.id
  });
  player.scriptActivatedTurn = state.turnNumber;
  for (const candidate of player.hand.filter((card) => card.id === "STD-179")) {
    const request = createSelectionRequest({ mode: "scope", scopeField: "place", scopeOptions: ["配置しない", "配置する"],
      label: `${candidate.name}: 手札から配置`, message: candidate.text,
      continuation: { type: "std179-place", playerId: declared.playerId, sourceUid: candidate.uid, sourceName: candidate.name } });
    enqueueSelection(state, { type: "selection", validTargets: [], request }, selectionProjectionMeta("engine:std179-place", declared.playerId));
  }
  state.deferredDeclaredScriptCleanup = null;
  return true;
}

function continueDeferredDeclaredScriptCleanup(state) {
  if (!state.deferredDeclaredScriptCleanup || state.pending || state.prompt || state.deferredTrashMoves?.length || state.deferredDestruction || state.deferredAttack) return false;
  return finishDeclaredScriptCleanup(state);
}

function resolveDeclaredScript(state, declared) {
  const source = declared.sourceSnapshot;
  state.deferredDeclaredScriptCleanup = { declared, source };
  if (declared.cardId === "STD-003") {
    state.players[otherPlayer(declared.playerId)].trashBanUntilTurn = state.turnNumber;
    addLog(state, `${source.name}: このターン、以降の相手カードのゴミ箱移動をBANへ置換。`, "effect");
  } else if (declared.cardId === "STD-148") {
    const live = findCard(state, declared.sourceUid);
    const opponentTurnStart = declared.activationCause === "event"
      && declared.eventContext?.type === "turn_started"
      && declared.eventContext?.eventPlayerId === otherPlayer(declared.playerId);
    if (opponentTurnStart && live?.playerId === declared.playerId && live.zoneName === "back") {
      live.card.std148ArmedTurn = state.turnNumber;
      addLog(state, `${source.name}: この相手ターン中の戦闘時ダメージを有効化。`, "effect");
    }
  } else if (declared.runtime) {
    executeRuntimeActions(state, declared.playerId, source, declared.runtime.actions, {
      targetUid: declared.eventTargetUid,
      runtime: { records: { eventCardUids: [...declared.eventCardUids] } }
    });
  } else {
    const trigger = {
      id: declared.id,
      source: { playerId: declared.playerId, zoneName: "back", card: source },
      event: declared.eventContext?.raw ?? declared.eventContext ?? {},
      spec: { actions: declared.actions }
    };
    for (const action of declared.actions) executeTriggerAction(state, trigger, action);
  }
  if (!state.pending && !state.prompt) continueDeferredDeclaredScriptCleanup(state);
  return true;
}

function drainDeclaredEffects(state) {
  if (state.effectResolution || state.pending || state.prompt || state.resolvingDeclaredEffect) return false;
  const declared = state.declaredEffects?.at(-1);
  if (!declared) return !state.winner && startNextQueuedResponse(state);
  const supported = declared.kind === "response" || (declared.kind === "script" && DECLARED_IF_SCRIPT_IDS.has(declared.cardId));
  if (!supported) {
    addLog(state, `未対応の宣言済み効果 ${declared.kind}:${declared.cardId ?? "unknown"} は保持した。`, "system");
    return false;
  }
  state.declaredEffects.pop();
  declared.status = "resolving";
  state.resolvingDeclaredEffect = declared;
  runEffectEntry(state, "declared-effect", declared.playerId, () => {
    state.effectResolution.declaredEffectId = declared.id;
    if (declared.kind === "script") resolveDeclaredScript(state, declared);
    else if (declared.kind === "response") resolveDeclaredResponse(state, declared);
  });
  return true;
}

function hasClass(card, className) {
  const expected = classKey(className);
  return (card.classes ?? []).some((value) => classKey(value) === expected);
}

function cardTraits(card) {
  const traits = [...new Set(Array.isArray(card.traits) ? card.traits : [])];
  if (isObCard(card) && (String(card.sourceSheet ?? "").includes("インセクト") || hasClass(card, "インセクト")) && !traits.includes("インセクト")) traits.push("インセクト");
  return traits;
}

function triggerMountedSleepEffects(state, playerId, card) {
  for (const source of card.mounted ?? []) for (const spec of mountEventSpecsFor(source.id).filter((item) => item.event === "mounted_host_slept")) {
    const ownerId = source.owner ?? playerId;
    const owner = state.players[ownerId];
    for (const action of spec.actions) {
      if (action.type === "discard" && action.target === "source_owner_hand") {
        if (!owner?.hand.length) continue;
        const count = Math.min(Number(action.count ?? 1), owner.hand.length);
        const request = createSelectionRequest({ mode: count === 1 ? "single" : "exact", candidates: owner.hand.map((item) => item.uid), count,
          candidateLabels: Object.fromEntries(owner.hand.map((item) => [item.uid, item.name])), label: `${source.name}: 手札を${count}枚捨てる`, message: source.text,
          continuation: { type: "mounted-event-discard", playerId: ownerId, sourceName: source.name, count } });
        enqueueSelection(state, { type: "selection", validTargets: request.candidates, request }, selectionProjectionMeta("engine:mounted-event-discard", ownerId));
      } else if (action.type === "deal_damage" && action.target === "source_owner_user") {
        dealFortressDamage(state, ownerId, Number(action.amount ?? 0), ownerId, source.name);
      } else throw new Error(`Unsupported mounted host event action: ${action.type}`);
    }
  }
}

function setCardSleeping(state, playerId, card) {
  if (card.sleep) return false;
  card.sleep = true;
  triggerMountedSleepEffects(state, playerId, card);
  return true;
}

function emitEffectPlacement(state, playerId, card, zone, source) {
  return emitGameEvent(state, {
    type: "card_effect_placed", playerId, ownerId: card.owner ?? playerId,
    cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category,
    color: card.color, traits: cardTraits(card), to: zone, placementCause: "effect", source
  });
}

function emitCardsGenerated(state, playerId, cards, source) {
  if (!cards.length) return null;
  const event = emitGameEvent(state, {
    type: "card_generated", playerId, ownerId: playerId,
    cardUid: cards[0].uid, cardUids: cards.map((card) => card.uid), amount: cards.length, source
  });
  for (const controllerId of ["player", "ai"]) {
    const scripts = state.players[controllerId].back.filter((card) => card.id === "STD-038" && card.faceDown === true
      && state.players[controllerId].memory >= Number(card.cost ?? 0));
    for (const script of scripts) openScriptActivationWindow(state, controllerId, script, event);
  }
  return event;
}

function banGeneratedCards(state, uids, source) {
  let moved = 0;
  for (const playerId of ["player", "ai"]) {
    const player = state.players[playerId];
    for (const uid of uids) {
      for (const zoneName of ["hand", "front", "back", "registry", "trash", "deck"]) {
        const index = player[zoneName].findIndex((card) => card.uid === uid);
        if (index < 0) continue;
        const [card] = player[zoneName].splice(index, 1);
        if (["front", "back"].includes(zoneName)) revealMountedCode(player[zoneName], index, card, playerId, zoneName);
        player.ban.push(card);
        if (["front", "back"].includes(zoneName)) distributeLayeredFollowers(state, card, "ban", source);
        moved += 1;
        break;
      }
    }
  }
  addLog(state, `${source}: 生成されたカード${moved}枚をBAN。`, "effect");
  return moved;
}

function emitCardPlacement(state, playerId, card, zone, placementCause, source = null) {
  return emitGameEvent(state, { type: "card_placed", playerId, ownerId: card.owner ?? playerId,
    cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category,
    color: card.color, traits: cardTraits(card), to: zone, placementCause, source });
}

function finalizeRuleDestruction(state, ownerId, card, { from = "hand", to = "trash", source = "配置上限", zone = null } = {}) {
  state.turnStats.destroyedCards += 1;
  if (isObCard(card)) state.turnStats.destroyedOb += 1;
  if (card.category === "Script" && card.name.includes("聖樹")) state.turnStats.destroyedSacredTreeScripts += 1;
  emitGameEvent(state, {
    type: "card_destroyed", playerId: ownerId, ownerId,
    cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category,
    from, to, zone, source, ruleDestruction: true
  });
  return true;
}

function placementResult(player, zone, { addedSlots = 1, freedSlots = 0, mode = "normal" } = {}) {
  return evaluatePlacement({
    zone,
    occupied: player[zone]?.length ?? 0,
    limit: player.user?.[`${zone}Limit`],
    addedSlots,
    freedSlots,
    mode
  });
}

function failForcedPlacement(state, ownerId, card, { from = "hand", zone, source = "効果による強制配置", suppressScriptWindow = false } = {}) {
  const owner = state.players[ownerId];
  if (from === "trash") {
    if (!owner.trash.some((item) => item.uid === card.uid)) owner.trash.push(card);
    finalizeRuleDestruction(state, ownerId, card, { from, to: "trash", zone, source });
  } else {
    moveCardToTrash(state, ownerId, card, source, {
      fromArea: false, suppressScriptWindow,
      ruleDestruction: { from, zone, source }
    });
  }
  addLog(state, `${source}: ${card.name}は配置上限によりエリアへ入らずルール破壊。`, "effect");
  return "failed-forced";
}

function placeByMode(state, ownerId, card, { zone, mode = "forced-effect", from = "generated", source = "効果による強制配置", addedSlots = 1, freedSlots = 0, suppressScriptWindow = false, requestedSlot = null } = {}) {
  const player = state.players[ownerId];
  const placement = placementResult(player, zone, { addedSlots, freedSlots, mode });
  if (!placement.ok) {
    if (placement.mode === "forced-effect") return failForcedPlacement(state, card.owner ?? ownerId, card, { from, zone, source, suppressScriptWindow });
    return "normal-rejected";
  }
  const placed = placeCardInBoardSlot(player[zone], card, {
    controllerId: ownerId, zoneName: zone, limit: player.user?.[`${zone}Limit`], requestedSlot
  });
  if (!placed) {
    if (placement.mode === "forced-effect") return failForcedPlacement(state, card.owner ?? ownerId, card, { from, zone, source, suppressScriptWindow });
    return "normal-rejected";
  }
  return "placed";
}

function emitRegistryInstalled(state, playerId, card, source = "インストール") {
  card.faceDown = false;
  const event = emitGameEvent(state, { type: "registry_installed", playerId, ownerId: card.owner ?? playerId,
    cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category, source });
  const installer = state.players[playerId];
  if (installer.user.abilityKey === "registry_liberty" && !installer.firstRegistryInstallResolved) {
    installer.firstRegistryInstallResolved = true;
    const drawn = drawCards(state, playerId, 1);
    installer.registryActionUsed = false;
    addLog(state, `${installer.user.abilityName}: 1枚引き、追加のインストール権を得た。`, "effect");
    emitUserAbilityFeedback(state, "registry_liberty", playerId, playerId, {
      branch: "first-install", amount: drawn, outcome: "install-ready", steps: [{ kind: "transfer", from: { kind: "zone_count", playerId, zone: "deck" }, to: { kind: "zone_count", playerId, zone: "hand" }, count: drawn }, { kind: "state_change", target: { kind: "status", playerId, status: "extra_install" }, before: false, after: true }]
    });
  }
  const opponentId = otherPlayer(playerId);
  for (const observer of [...state.players[opponentId].front, ...state.players[opponentId].back].filter((item) => item.id === "STD-226" && !item.sleep && !item.faceDown)) {
    const candidates = [...state.players.player.registry, ...state.players.ai.registry].filter((item) => !item.faceDown);
    if (!candidates.length) continue;
    const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((item) => item.uid), minimum: 0, maximum: 1,
      candidateLabels: Object.fromEntries(candidates.map((item) => [item.uid, item.name])), label: `${observer.name}: レジストリを裏向き`, message: observer.text,
      continuation: { type: "std226-compress", playerId: opponentId, sourceUid: observer.uid, sourceName: observer.name } });
    enqueueSelection(state, { type: "selection", validTargets: request.candidates, request }, selectionProjectionMeta("engine:std226-compress", opponentId));
  }
  return event;
}

function resumeStd230AmbushCleanup(state) {
  const cleanup = state.std230AmbushCleanup;
  if (!cleanup || state.pending || state.prompt || state.deferredTrashMoves?.length) return false;
  const player = state.players[cleanup.playerId];
  if (!cleanup.sourceRemovalStarted) {
    cleanup.sourceRemovalStarted = true;
    const sourceIndex = player.registry.findIndex((card) => card.uid === cleanup.sourceUid && card.id === "STD-230");
    if (sourceIndex >= 0) {
      const [source] = player.registry.splice(sourceIndex, 1);
      emitGameEvent(state, { type: "registry_left", playerId: cleanup.playerId, ownerId: source.owner ?? cleanup.playerId,
        cardUid: source.uid, cardId: source.id, cardName: source.name, category: source.category, reason: "ambush" });
      const destination = moveCardToTrash(state, cleanup.playerId, source, "アンブッシュ");
      if (destination === "deferred") return true;
    }
    cleanup.sourceRemovalDone = true;
  }
  if (!cleanup.sourceRemovalDone) {
    const removed = [...player.trash, ...player.ban].some((card) => card.uid === cleanup.sourceUid);
    if (!removed) return false;
    cleanup.sourceRemovalDone = true;
  }
  if (state.selectionQueue?.length) {
    openNextQueuedSelection(state);
    return true;
  }
  state.std230AmbushCleanup = null;
  const attacker = state.players[cleanup.attackerPlayerId].front.find((card) => card.uid === cleanup.attackerUid);
  if (!attacker) return true;
  attacker.skipStd230Ambush = true;
  return attack(state, cleanup.attackerPlayerId, attacker.uid, cleanup.targetUid);
}

function sourceCardByName(state, playerId, sourceName) {
  const player = state.players[playerId];
  return [...player.front, ...player.back, ...player.hand, ...player.trash, ...player.registry]
    .find((card) => card.name === sourceName)
    ?? Object.values(CARD_LIBRARY).find((card) => card.name === sourceName);
}

function activeCards(state, playerId, cardId) {
  const player = state.players[playerId];
  return [...player.front, ...player.back].filter((card) => card.id === cardId);
}

function hasNoEffectText(card) {
  return /^(?:|\(効果なし\)|（効果なし）)$/.test(String(card?.text ?? "").trim());
}

function damageCardMatchesFilter(card, filter) {
  if (filter === "any") return true;
  if (!card || !filter) return false;
  if (filter.color && card.color !== filter.color) return false;
  if (filter.category && !matchesCardCategory(card, filter.category)) return false;
  if (filter.effectText === "none" && !hasNoEffectText(card)) return false;
  if (filter.classesAny && !filter.classesAny.some((className) => hasClass(card, className))) return false;
  return true;
}

function damageModifierApplies(spec, provider, providerPlayerId, event) {
  if (spec.providerScope !== "own_area") return false;
  if (spec.direction === "dealt" && event.sourcePlayerId !== providerPlayerId) return false;
  if (spec.direction === "received" && event.victimPlayerId !== providerPlayerId) return false;
  if (spec.damageKind !== "all" && spec.damageKind !== event.kind) return false;
  if (spec.destination !== "all" && spec.destination !== event.destination) return false;
  if (spec.sourceFilter === "provider") {
    if (event.sourceCard?.uid !== provider.uid) return false;
  } else if (!damageCardMatchesFilter(event.sourceCard, spec.sourceFilter)) return false;
  if (spec.targetFilter === "provider" && event.victimCard?.uid !== provider.uid) return false;
  if (spec.activeTurn !== undefined && spec.activeTurn !== event.turnNumber) return false;
  return true;
}

function grantDamageModifier(card, modifier) {
  card.damageModifiers ??= [];
  card.damageModifiers.push({
    providerScope: "own_area",
    sourceFilter: "any",
    targetFilter: "provider",
    destination: "card",
    ...modifier
  });
}

function clearDamageModifiers(card, duration) {
  if (!card.damageModifiers) return;
  card.damageModifiers = card.damageModifiers.filter((modifier) => modifier.duration !== duration);
}

function applyDamageModifiers(state, sourcePlayerId, sourceCard, victimPlayerId, amount, {
  kind = "effect",
  destination = "card",
  victimCard = null
} = {}) {
  let value = Number(amount);
  const event = { sourcePlayerId, sourceCard, victimPlayerId, victimCard, kind, destination, turnNumber: state.turnNumber };
  const applicable = [];
  for (const [providerPlayerId, player] of Object.entries(state.players)) {
    for (const provider of [...player.front, ...player.back]) {
      for (const spec of [...damageModifierSpecsFor(provider.id), ...(provider.damageModifiers ?? [])]) {
        if (!damageModifierApplies(spec, provider, providerPlayerId, event)) continue;
        applicable.push(spec);
      }
    }
  }
  for (const spec of applicable.filter((item) => item.operation === "add")) value += Number(spec.amount ?? 0);
  const sourcePlayer = state.players[sourcePlayerId];
  const doOrIsntDamageDown = sourcePlayer.user.abilityKey === "do_or_isnt" && isObCard(sourceCard)
    && [...sourcePlayer.front, ...sourcePlayer.back].filter(isObCard).length >= 5;
  const beforeDoOrIsnt = value;
  if (doOrIsntDamageDown) value -= 1;
  for (const spec of applicable.filter((item) => item.operation === "cap_max")) value = Math.min(value, Number(spec.amount ?? 0));
  for (const spec of applicable.filter((item) => item.operation === "set")) value = Number(spec.amount ?? 0);
  const unsupported = applicable.find((item) => !["add", "cap_max", "set"].includes(item.operation));
  if (unsupported) throw new Error(`Unsupported damage modifier operation: ${unsupported.operation ?? "(missing)"}`);
  const finalValue = Math.max(0, value);
  if (doOrIsntDamageDown) {
    let withoutAbility = beforeDoOrIsnt;
    for (const spec of applicable.filter((item) => item.operation === "cap_max")) withoutAbility = Math.min(withoutAbility, Number(spec.amount ?? 0));
    for (const spec of applicable.filter((item) => item.operation === "set")) withoutAbility = Number(spec.amount ?? 0);
    withoutAbility = Math.max(0, withoutAbility);
    if (finalValue < withoutAbility) emitUserAbilityFeedback(state, "do_or_isnt", sourcePlayerId, victimPlayerId, {
      branch: "five-plus-damage-down", before: withoutAbility, after: finalValue, anchorCardUid: sourceCard?.uid, steps: [{ kind: "value_change", target: { kind: "player_stat", playerId: victimPlayerId, metric: "damage" }, before: withoutAbility, after: finalValue }]
    });
  }
  return finalValue;
}

function resolveMandatoryStateChecks(state) {
  for (const [playerId, player] of Object.entries(state.players)) {
    for (const card of [...player.front, ...player.back]) {
      for (const spec of mandatoryStateCheckSpecsFor(card.id)) {
        if (!continuousEffectConditionMatches(state, playerId, card, spec.condition)) continue;
        if (spec.type === "destroy" && spec.target === "source") {
          destroyCard(state, playerId, card.uid, {
            source: `${card.name}の強制状態判定`,
            suppressReplacement: Boolean(spec.suppressReplacement)
          });
          break;
        }
        throw new Error(`Unsupported mandatory state check: ${spec.type ?? "(missing)"}`);
      }
    }
  }
}

export function getMaxMemory(player) {
  const appliedOnce = new Set();
  let modifier = 0;
  for (const provider of player.registry ?? []) {
    for (const spec of playerValueModifierSpecsFor(provider.id)) {
      if (spec.value !== "max_memory" || spec.providerZone !== "registry" || (spec.faceUp && provider.faceDown)) continue;
      if (spec.aggregation === "once" && appliedOnce.has(spec)) continue;
      modifier += Number(spec.amount ?? 0);
      if (spec.aggregation === "once") appliedOnce.add(spec);
    }
  }
  return player.baseMemory + player.permanentMemory + modifier + (player.turboActive ? 2 : 0);
}

function executionCostModifierValue(card, state, playerId) {
  const appliedOnce = new Set();
  let modifier = 0;
  for (const spec of executionCostModifierSpecsFor(card.id).filter((item) => item.target === "source")) {
    if (spec.multiplier?.expression === "own_area_distinct_name_count") {
      const player = state.players[playerId];
      const count = new Set([...player.front, ...player.back]
        .filter((item) => runtimeSpecMatchesCard(item, spec.multiplier.filter))
        .map((item) => item.name)).size;
      modifier += Number(spec.amount ?? 0) * count;
    }
  }
  for (const [providerPlayerId, providerPlayer] of Object.entries(state.players)) {
    const zones = { registry: providerPlayer.registry ?? [], area: [...providerPlayer.front, ...providerPlayer.back] };
    for (const [zone, providers] of Object.entries(zones)) {
      for (const provider of providers) {
        for (const spec of executionCostModifierSpecsFor(provider.id)) {
          if (spec.providerZone !== zone || (spec.faceUp && provider.faceDown)) continue;
          if (spec.providerOwner === "self" && providerPlayerId !== playerId) continue;
          if (spec.providerOwner === "enemy" && providerPlayerId === playerId) continue;
          if (spec.condition?.expression === "target_name_in_controller_trash"
            && !state.players[playerId].trash.some((item) => item.name === card.name)) continue;
          if (spec.aggregation === "once" && appliedOnce.has(spec)) continue;
          modifier += Number(spec.amount ?? 0);
          if (spec.aggregation === "once") appliedOnce.add(spec);
        }
      }
    }
  }
  return modifier;
}

export function executionCost(card, state = null, playerId = null) {
  if (card.revealedExecutionCost === 1) return 1;
  let modifier = Number(card.turnCostModifier ?? 0) - Number(card.costReductionThisTurn ?? 0);
  if (state && playerId) {
    modifier += executionCostModifierValue(card, state, playerId);
    const player = state.players[playerId];
    if (player.user.abilityKey === "watching_you") modifier += ["Sp", "Script"].includes(card.category) ? -1 : isObCard(card) || card.category === "Code" ? 1 : 0;
    if (player.user.abilityKey === "do_or_isnt" && isObCard(card)
      && player.firstObExecutionTurn !== state.turnNumber
      && [...player.front, ...player.back].filter(isObCard).length <= 2) modifier -= 1;
  }
  return Math.max(0, Number(card.cost ?? 0) + modifier);
}

export function visibleHandExecutionPayment(state, playerId, card, viewerId = null) {
  const viewer = viewerId ?? state.viewerId ?? (state.mode === "sandbox" ? state.sandboxUi?.actor ?? "player" : "player");
  const printed = Math.max(0, Number(card.cost ?? 0));
  if (playerId !== viewer) return null;
  const value = card.category === "Script" ? 0 : executionCost(card, state, playerId);
  return { printed, value, delta: value - printed };
}

function drawCardRaw(player) {
  const card = player.deck.pop();
  if (card) player.hand.push(card);
  return card;
}

export function drawCards(state, playerId, count = 1) {
  const player = state.players[playerId];
  let drawn = 0;
  for (let i = 0; i < count; i += 1) {
    const card = drawCardRaw(player);
    if (!card) continue;
    drawn += 1;
    emitGameEvent(state, {
      type: "card_drawn", playerId, ownerId: card.owner ?? playerId,
      cardUid: card.uid, cardId: card.id, cardName: card.name,
      category: card.category, color: card.color, amount: 1,
      drawIndex: drawn, requestedCount: count, source: "draw"
    });
  }
  if (drawn) addLog(state, `${player.user.name}が${drawn}枚ドロー。`);
  return drawn;
}

function continueMandatoryTurnDraw(state, playerId, count) {
  const drawn = drawCards(state, playerId, count);
  if (drawn < count) {
    state.players[playerId].mandatoryDrawFailed = true;
    recordVictoryFact(state, { type: "mandatory-draw-failed", playerId });
    addLog(state, `${state.players[playerId].user.name}はターン開始時の必要ドローを完了できず敗北。`, "win");
    if (!state.effectResolution) finalizeEffectResolution(state);
  }
}

function hasMandatoryDrawChildWork(state) {
  return Boolean(
    // Only the placement/replacement continuation belongs to Dawn's mandatory
    // draw. Newly queued triggers (STD186/179 etc.) are separate effects.
    state.pending || state.prompt || state.deferredTrashMoves?.length || state.deferredDestruction
  );
}

function resumeMandatoryDrawContinuation(state) {
  const continuation = state.mandatoryDrawContinuation;
  if (!continuation || continuation.type !== "std048-mandatory-draw" || hasMandatoryDrawChildWork(state)) return false;
  if (continuation.placementOutcome === "pending") return false;
  if (!continuation.ruleDrawDone) {
    continuation.ruleDrawDone = true;
    continueMandatoryTurnDraw(state, continuation.playerId, continuation.remainingRuleDraws);
    if (state.players[continuation.playerId].mandatoryDrawFailed) {
      state.mandatoryDrawContinuation = null;
      finalizeEffectResolution(state);
      return true;
    }
    if (hasMandatoryDrawChildWork(state)) return true;
  }
  if (continuation.placementOutcome === "placed" && !continuation.successEffectDone) {
    continuation.successEffectDone = true;
    const player = state.players[continuation.playerId];
    player.fortressStr = Math.min(player.user.maxStr, player.fortressStr + 3);
    drawCards(state, continuation.playerId, 1);
    addLog(state, `${continuation.sourceName}: ドラッグ成功。自分ユーザーを3回復し、1枚ドロー。`, "effect");
    if (hasMandatoryDrawChildWork(state)) return true;
  }
  state.mandatoryDrawContinuation = null;
  if (state.effectResolution?.kind === "STD-048-mandatory-draw") {
    resolveMandatoryStateChecks(state);
    finalizeEffectResolution(state);
  }
  if (!state.winner) runPostDrawTurnStart(state, continuation.playerId);
  return true;
}

function settleStd048MandatoryPlacement(state, pending, placed) {
  const continuation = state.mandatoryDrawContinuation;
  if (pending?.type !== "std048-draw-place" || !continuation
    || continuation.type !== "std048-mandatory-draw"
    || continuation.sourceUid !== pending.sourceUid
    || continuation.placementOutcome !== "pending") return false;
  continuation.placementOutcome = placed ? "placed" : "failed";
  return resumeMandatoryDrawContinuation(state);
}

function beginStd048MandatoryDraw(state, playerId, card, remainingRuleDraws) {
  card.dragFree = true;
  state.effectResolution = {
    id: `EFFECT-${++state.effectSerial}`, kind: "STD-048-mandatory-draw", source: card.uid,
    playerId, status: "awaiting-choice"
  };
  state.mandatoryDrawContinuation = {
    type: "std048-mandatory-draw", playerId, sourceUid: card.uid, sourceName: card.name,
    remainingRuleDraws, placementOutcome: "pending", ruleDrawDone: remainingRuleDraws === 0, successEffectDone: false
  };
  state.pending = {
    type: "std048-draw-place", playerId, sourceName: card.name,
    queue: [card.uid], sourceUid: card.uid
  };
  addLog(state, `${card.name}: ルールによる最初のドローで引いた。配置先を選択。`, "effect");
  return true;
}

function rollMadness(state, count) {
  let total = 0;
  for (let index = 0; index < count; index += 1) total += Math.floor(state.rng() * 6) + 1;
  return total;
}

function resolveMadnessChecks(state, playerId) {
  const player = state.players[playerId];
  for (const card of [...player.front, ...player.back]) {
    const count = Number(card.counters?.madness ?? 0);
    if (!count) continue;
    const roll = rollMadness(state, count);
    if (roll > Number(card.str ?? 0) + 15) {
      const location = findCard(state, card.uid);
      if (location && ["front", "back"].includes(location.zoneName)) {
        const index = player[location.zoneName].indexOf(card);
        player[location.zoneName].splice(index, 1);
        revealMountedCode(player[location.zoneName], index, card, playerId, location.zoneName);
        player.ban.push(card);
        distributeLayeredFollowers(state, card, "ban", card.name);
        addLog(state, `${card.name}: 狂気判定${roll}が${Number(card.str ?? 0) + 15}を超えBAN。`, "effect");
      }
    }
  }
  const userCount = Number(player.counters?.madness ?? 0);
  if (userCount) {
    const roll = rollMadness(state, userCount);
    if (roll > Number(player.user.maxStr ?? 0) + 15) {
      player.userBanned = true;
      recordVictoryFact(state, { type: "user-banned", playerId });
      addLog(state, `${player.user.name}: 狂気判定${roll}によりBAN。`, "effect");
    }
  }
}

function runPostDrawTurnStart(state, playerId) {
  const player = state.players[playerId];
  for (const provider of player.registry.filter((card) => !card.faceDown && cardRuntimeSpec(card.id, "turn_start"))) {
    runEffectEntry(state, "turn-start", playerId, () => executeCardRuntimeSpec(state, "turn_start", playerId, provider));
    if (state.winner) return;
  }
  for (const sister of [...player.front, ...player.back].filter((card) => card.id === "STD-113")) {
    runEffectEntry(state, "turn-start", playerId, () => executeCardRuntimeSpec(state, "turn_start", playerId, sister));
    if (state.winner) return;
  }
  const opponentId = otherPlayer(playerId);
  for (const source of state.players[opponentId].back.filter((card) => card.id === "STD-148" && card.residentActive)) source.std148ArmedTurn = state.turnNumber;
  emitGameEvent(state, { type: "turn_started", playerId });
}

export function startTurn(state, playerId) {
  const player = state.players[playerId];
  for (const current of Object.values(state.players)) current.damageReceivedThisTurn = 0;
  for (const current of Object.values(state.players)) current.triggerUsage = {};
  for (const current of Object.values(state.players)) {
    for (const card of [...current.front, ...current.back]) {
      card.timedModifiers = (card.timedModifiers ?? []).filter((item) => state.turnNumber <= item.expiresAfterTurn);
      card.damageModifiers = (card.damageModifiers ?? []).filter((item) => item.duration !== "turn" || state.turnNumber <= item.activeTurn);
      card.tempAtk = 0;
      card.tempStr = 0;
    }
  }
  state.turnStats = { destroyedOb: 0, destroyedCards: 0, destroyedSacredTreeScripts: 0 };
  if (player.turboActive) {
    player.turboActive = false;
    addLog(state, `${player.user.name}のターボ・ブーストが終了。`, "system");
  }
  for (const card of [...player.front, ...player.back]) {
    if (card.skipStandby) card.skipStandby = false;
    else card.sleep = false;
    card.attackedThisTurn = false;
    card.attackedObThisTurn = false;
    card.summoningSick = false;
  }
  for (const card of [...player.hand, ...player.deck, ...player.registry, ...player.trash]) {
    card.turnCostModifier = 0;
    card.revealed = false;
  }
  player.installedThisTurn = false;
  player.registryActionUsed = false;
  for (const current of Object.values(state.players)) current.scriptUsage = {};
  player.memory = getMaxMemory(player);

  resolveTurnStartDelayedEffects(state, playerId);

  let drawCount = 1;
  if (player.turnsTaken === 0 && playerId === state.firstPlayer) drawCount = 0;
  else if (player.turnsTaken === 0) drawCount = 2;
  player.turnsTaken += 1;
  state.active = playerId;
  state.phase = "main";
  resolveMadnessChecks(state, playerId);
  addLog(state, `TURN ${state.turnNumber}: ${player.user.name}の開始。メモリ${player.memory}。`, "turn");
  if (drawCount) {
    const first = drawCardRaw(player);
    if (first) addLog(state, `${player.user.name}が1枚ドロー。`);
    if (!first) continueMandatoryTurnDraw(state, playerId, 1);
    else if (first.id === "STD-048") {
      continueMandatoryTurnDraw(state, playerId, drawCount - 1);
      if (!player.mandatoryDrawFailed) beginStd048MandatoryDraw(state, playerId, first, 0);
    }
    else continueMandatoryTurnDraw(state, playerId, drawCount - 1);
  }
  if (state.mandatoryDrawContinuation) return;
  runPostDrawTurnStart(state, playerId);
}

export function installCard(state, playerId, uid, { force = false } = {}) {
  const player = state.players[playerId];
  const index = player.hand.findIndex((card) => card.uid === uid);
  if (index < 0) return fail(state, "そのカードは手札にない。", force);
  if (!force && state.active !== playerId) return fail(state, "今は自分のターンじゃない。", force);
  if (!force && player.registryActionUsed) return fail(state, "このターンのレジストリ操作権は使用済み。", force);
  const [card] = player.hand.splice(index, 1);
  player.registry.push(card);
  player.installedThisTurn = true;
  player.registryActionUsed = true;
  emitRegistryInstalled(state, playerId, card, "通常インストール");
  addLog(state, `${player.user.name}が「${card.name}」をレジストリへインストール。${card.category === "Plugin" ? `P-in（${card.name}）有効。` : `${card.color}シンボル有効。`}`, "action");
  if (card.id === "STD-224") {
    state.prompt = { type: "plugin-number", playerId, pluginUid: card.uid, message: `P-in（${card.name}）：監視するメモリ値を指定`, detail: "0～7から選択" };
  }
  return true;
}

export function configurePlugin(state, playerId, uid, value) {
  const plugin = state.players[playerId].registry.find((card) => card.uid === uid && !card.faceDown && (card.category === "Plugin" || card.id === "STD-224"));
  if (!plugin) return fail(state, "指定するPluginがレジストリにない。", false);
  plugin.pluginValue = Number(value);
  state.prompt = null;
  addLog(state, `P-in（${plugin.name}）：メモリ${plugin.pluginValue}を監視。`, "effect");
  return true;
}

function recoverRegistryCardCore(state, playerId, uid) {
  const player = state.players[playerId];
  if (state.active !== playerId) return fail(state, "回収は自分ターン中だけ。", false);
  if (player.registryActionUsed) return fail(state, "このターンのレジストリ操作権は使用済み。", false);
  const index = player.registry.findIndex((card) => card.uid === uid);
  if (index < 0) return fail(state, "そのカードはレジストリにない。", false);
  const [card] = player.registry.splice(index, 1);
  player.hand.push(card);
  emitGameEvent(state, { type: "registry_left", playerId, ownerId: card.owner ?? playerId, cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category, reason: "recover" });
  player.registryActionUsed = true;
  player.installedThisTurn = true;
  addLog(state, `${player.user.name}が「${card.name}」をレジストリから手札へ回収。`, "action");
  return true;
}

export function recoverRegistryCard(state, playerId, uid) {
  return runEffectEntry(state, "registry-recover", playerId, () => recoverRegistryCardCore(state, playerId, uid));
}

export function canExecuteRegistryCard(state, playerId, card, options = {}) {
  const player = state.players[playerId];
  const selfExecutable = ["STD-215", "STD-220"].includes(card.id);
  const sourceActive = [...player.front, ...player.back].some((item) => item.id === "STD-236");
  if (!sourceActive && !selfExecutable) return { ok: false, reason: "不乱 健博士がエリアにいない。" };
  if (state.active !== playerId) return { ok: false, reason: "自分ターン中だけ。" };
  if (!selfExecutable && player.triggerUsage["STD-236:registry-execute"]) return { ok: false, reason: "このターンは実行済み。" };
  if (card.faceDown) return { ok: false, reason: "裏向きのレジストリカードは実行できない。" };
  if (!player.registry.some((item) => item.uid === card.uid)) return { ok: false, reason: "レジストリにない。" };
  const magazineMatch = card.category === "Sp" ? String(card.text ?? "").match(/\[弾倉[:：]\s*(\d+)\]/) : null;
  const magazineAmount = Number(magazineMatch?.[1] ?? 0);
  const executionCostReduction = magazineAmount > 0 && ownLayerEntries(player).length >= magazineAmount ? magazineAmount : 0;
  return canPlayCard(state, playerId, card, { ...options, executionCostReduction });
}

export function executeRegistryCard(state, playerId, uid, options = {}) {
  const player = state.players[playerId];
  const index = player.registry.findIndex((item) => item.uid === uid);
  if (index < 0) return false;
  const card = player.registry[index];
  const check = canExecuteRegistryCard(state, playerId, card, { ...options, zone: options.zone ?? "front", baseUid: options.baseUid ?? null, underUid: options.underUid ?? null });
  if (!check.ok) return fail(state, check.reason, false);
  player.registry.splice(index, 1);
  player.hand.push(card);
  const outcome = playCard(state, playerId, uid, { ...options, ignoreColor: options.ignoreColor ?? ["STD-215", "STD-220"].includes(card.id), registryExecution: true, registryOriginIndex: index });
  const awaitingExecutionChoice = outcome === true
    && ["play-card-oc", "play-card-magazine-confirm", "play-card-magazine-layers"].includes(state.pending?.request?.continuation?.type)
    && state.pending.request.continuation.sourceUid === uid;
  if (awaitingExecutionChoice) return true;
  const resultingLocation = findCard(state, uid);
  const ok = outcome === true && (card.category === "Sp" || ["front", "back", "mounted"].includes(resultingLocation?.zoneName));
  if (!ok) {
    const handIndex = player.hand.findIndex((item) => item.uid === uid);
    if (handIndex >= 0) player.registry.splice(index, 0, ...player.hand.splice(handIndex, 1));
  } else emitGameEvent(state, { type: "registry_left", playerId, ownerId: card.owner ?? playerId, cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category, reason: "execute" });
  return outcome;
}

export function enabledSymbols(player) {
  return [...new Set(player.registry.filter((card) => card.category !== "Plugin" && !card.faceDown).map((card) => card.color).filter(Boolean))];
}

// Standalone execution/set uses explicit slots. Mounting inherits its host slot.
function requestedExecutionSlot(state, playerId, card, { requestedSlot = null, zone = "front", baseUid = null, underUid = null, asScript = false, placementMode = "normal" } = {}) {
  if (requestedSlot === null) return { ok: true };
  if (!card || !(isObCard(card) || ["Code", "Script"].includes(card.category)) || baseUid || underUid || placementMode !== "normal") return { ok: false, reason: "この実行経路では空きマスを指定できません。" };
  if ((card.category === "Script" || asScript) && zone !== "back") return { ok: false, reason: "設置先はバックです。" };
  const player = state.players[playerId];
  const limit = Number(player?.user?.[`${zone}Limit`]);
  if (!player || !["front", "back"].includes(zone) || !Number.isSafeInteger(limit) || !Number.isSafeInteger(requestedSlot) || requestedSlot < 1 || requestedSlot > limit) return { ok: false, reason: "配置マスが不正。" };
  const slots = projectZoneSlots(player[zone], { controllerId: playerId, zoneName: zone, limit: player.user[`${zone}Limit`] });
  return slots[requestedSlot - 1] ? { ok: false, reason: "そのマスには既にカードがあります。" } : { ok: true };
}

export function canExecuteAtSlot(state, playerId, card, options = {}) {
  const slot = requestedExecutionSlot(state, playerId, card, options);
  if (!slot.ok) return slot;
  if (card.category !== "Script" && !options.asScript) return canPlayCard(state, playerId, card, options);
  const player = state.players[playerId];
  if (state.active !== playerId || !placementResult(player, "back").ok) return { ok: false, reason: "設置するターンまたはバック上限を確認してください。" };
  if (cardPlacementCostSpec(card.id)) return canPlayCard(state, playerId, card, options);
  if (options.asScript && (card.id !== "STD-184" || player.memory < Number(card.setupCost ?? 3) || state.mode !== "lab" && card.color && !enabledSymbols(player).includes(card.color))) return { ok: false, reason: "Script設置条件を満たしていません。" };
  return { ok: true };
}

export function canPlayCard(state, playerId, card, { ignoreColor = false, free = false, force = false, allowOffTurn = false, zone = "front", baseUid = null, underUid = null, freedSlots = 0, placementMode = "normal", executionCostReduction = 0, requestedSlot = null } = {}) {
  const slotCheck = requestedExecutionSlot(state, playerId, card, { requestedSlot, zone, baseUid, underUid, placementMode });
  if (!slotCheck.ok) return slotCheck;
  const player = state.players[playerId];
  if (baseUid || underUid) {
    const host = player[zone]?.find(item => item.uid === (baseUid ?? underUid));
    if (!host || baseUid && underUid || baseUid && (host.category !== "Code" || !isObCard(card)) || underUid && (!isObCard(host) || card.category !== "Code") || host.faceDown || placementPermissionSpecsFor(host.id).some(spec => spec.type === "forbid_mount_on_source")) return { ok: false, reason: "このカードにはマウントできません。" };
  }
  const placementCostSpec = cardPlacementCostSpec(card.id);
  if (placementPermissionSpecsFor(card.id).some((spec) => spec.type === "forbid_execution")) return { ok: false, reason: "このカードは実行できない。" };
  if (!force && !allowOffTurn && state.active !== playerId) return { ok: false, reason: "今は自分のターンじゃない。" };
  if (card.category === "Plugin") return { ok: false, reason: "Pluginはレジストリへインストールして。" };
  if (!free && !placementCostSpec && player.memory < Math.max(0, executionCost(card, state, playerId) - Number(executionCostReduction ?? 0))) return { ok: false, reason: "メモリ不足。" };
  const accessFailure = runtimeSpellAccessFailure(state, playerId, card);
  if (accessFailure) return { ok: false, reason: accessFailure };
  const requiredZone = placementPermissionSpecsFor(card.id).find((spec) => spec.type === "require_execution_zone")?.zone;
  if (requiredZone && zone !== requiredZone) return { ok: false, reason: `このカードは実行時${requiredZone === "back" ? "バック" : "フロント"}にのみ配置できる。` };
  if (state.mode !== "lab" && !ignoreColor && card.color && !enabledSymbols(player).includes(card.color)) return { ok: false, reason: `${card.color}シンボルがない。先にインストールして。` };
  if (card.category !== "Sp" && !["front", "back"].includes(zone)) return { ok: false, reason: "実行先が不正。" };
  let effectiveFreedSlots = freedSlots;
  if (placementCostSpec) {
    const candidates = placementCostCandidates(state, placementCostSpec);
    const requiredCount = Number(placementCostSpec.selection.count ?? 0);
    if (new Set(candidates.map(({ card: candidate }) => candidate.name)).size < requiredCount) {
      return { ok: false, reason: `名前の異なる情報管理端末が${requiredCount}枚必要。` };
    }
    if (zone === "back" && candidates.some(({ ownerId, zoneName }) => ownerId === playerId && zoneName === "back")) {
      effectiveFreedSlots = Math.max(Number(effectiveFreedSlots ?? 0), 1);
    }
  }
  const placement = placementResult(player, zone, { addedSlots: baseUid || underUid ? 0 : 1, freedSlots: effectiveFreedSlots, mode: placementMode });
  if (card.category !== "Sp" && !placement.ok && placement.mode === "normal") return { ok: false, reason: `${zone === "front" ? "フロント" : "バック"}上限。` };
  return { ok: true };
}

export function spellNeedsTarget(card) {
  return ["STD-011", "STD-014", "STD-015", "STD-032", "STD-033", "STD-086", "STD-104", "STD-111", "STD-138", "STD-202", "STD-203", "STD-209", "SZTB-096"].includes(card.id);
}

function ownLayerEntries(player) {
  return ["front", "back"].flatMap((zoneName) => player[zoneName].flatMap((host) =>
    (host.mounted ?? []).map((layer) => ({ zoneName, host, layer }))));
}

function beginSourceLayerSelection(state, playerId, source, count, continuation, candidateUids = null) {
  normalizeMountedStack(source);
  const allowed = candidateUids ? new Set(candidateUids) : null;
  const layers = source.mounted.filter((layer) => !allowed || allowed.has(layer.uid));
  if (layers.length < count) return false;
  const labels = Object.fromEntries(layers.map((layer) => {
    const index = source.mounted.findIndex((candidate) => candidate.uid === layer.uid);
    return [layer.uid, `レイヤー${index + 1}: ${layer.name}`];
  }));
  const request = createSelectionRequest({
    mode: count === 1 ? "single" : "exact",
    candidates: layers.map((layer) => layer.uid),
    count,
    minimum: count,
    maximum: count,
    candidateLabels: labels,
    label: `${source.name}: 消費するレイヤーを${count}枚選択`,
    message: source.text,
    continuation
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

function consumeSelectedSourceLayers(state, playerId, source, selectedUids, reason) {
  normalizeMountedStack(source);
  const unique = [...new Set(selectedUids ?? [])];
  const layers = unique.map((uid) => source.mounted.find((layer) => layer.uid === uid));
  if (layers.some((layer) => !layer) || layers.length !== unique.length) return null;
  for (const layer of layers) {
    const index = source.mounted.findIndex((candidate) => candidate.uid === layer.uid);
    source.mounted.splice(index, 1);
    moveCardToTrash(state, layer.owner ?? playerId, layer, reason);
  }
  addLog(state, `${source.name}: ${layers.map((layer) => `「${layer.name}」`).join("、")}をレイヤーから消費。`, "effect");
  return layers;
}

function isArmsBandCard(card) {
  const number = Number(String(card?.id ?? "").match(/^SZTB-(\d{3})$/)?.[1]);
  return card?.name?.includes("アームズバンド") || (number >= 90 && number <= 102);
}

function isArmsBandOb(card) {
  return isArmsBandCard(card) && isObCard(card);
}

function finalizeDeferredSpellCleanup(state, { replacementHostUid = null } = {}) {
  const deferred = state.deferredSpellCleanup;
  if (!deferred) return false;
  const { playerId, card, zone, placementCause, placementSource } = deferred;
  const player = state.players[playerId];
  const host = replacementHostUid
    ? [...player.front, ...player.back].find((item) => item.uid === replacementHostUid && item.id === "SZTB-095" && !item.faceDown)
    : null;
  if (host) {
    card.layerRole = "layered";
    host.mounted.push(card);
    player.triggerUsage[`${host.uid}:sztb095-sp-replacement`] = true;
    addLog(state, `${host.name}: ${card.name}をゴミ箱へ送るかわりにレイヤーへ加えた。`, "effect");
  } else {
    moveCardToTrash(state, playerId, card, card.name);
  }
  state.deferredSpellCleanup = null;
  notifyCardExecuted(state, playerId, card);
  emitCardPlacement(state, playerId, card, zone, placementCause, placementSource);
  return true;
}

function continueDeferredSpellCleanup(state) {
  const deferred = state.deferredSpellCleanup;
  if (!deferred || state.pending || state.prompt) return false;
  if (state.std211DestructionBatch) return continueStd211DestructionBatch(state);
  const { playerId, card } = deferred;
  const player = state.players[playerId];
  if (deferred.postEffect === "arms-band-jacket" && !deferred.postEffectDone) {
    deferred.postEffectDone = true;
    if ([...player.front, ...player.back].some(isArmsBandOb)) {
      const request = createSelectionRequest({
        mode: "scope", scopeField: "zone", scopeOptions: ["フロント", "バック"],
        label: `${card.name}: アームズバンド・ジャケットの配置先`,
        message: "自分エリアに名称:アームズバンドObが存在するため、ジャケットを生成し配置する。",
        continuation: { type: "sztb-jacket-place", playerId, sourceName: card.name }
      });
      state.pending = { type: "selection", validTargets: [], request };
      return true;
    }
  }
  const hosts = [...player.front, ...player.back].filter((item) => item.id === "SZTB-095" && !item.faceDown
    && !player.triggerUsage[`${item.uid}:sztb095-sp-replacement`]);
  if (hasKeyword(card, "MAGAZINE") && hosts.length) {
    const request = createSelectionRequest({
      mode: "up_to", candidates: hosts.map((item) => item.uid), count: 1, minimum: 0, maximum: 1,
      candidateLabels: Object.fromEntries(hosts.map((item) => [item.uid, item.name])),
      label: "実行したSpをレイヤーへ加える", message: "選ばず確定すると通常通りゴミ箱へ送る。各ターン1度。",
      continuation: { type: "sztb095-sp-replacement", playerId }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  return finalizeDeferredSpellCleanup(state);
}

function placementCostCandidates(state, spec) {
  if (!spec?.selection) return [];
  const { zones = [], faceUp = false, namePrefix = "" } = spec.selection;
  return Object.entries(state.players).flatMap(([ownerId, owner]) => zones.flatMap((zoneName) =>
    (owner[zoneName] ?? [])
      .filter((card) => (!faceUp || card.faceDown !== true) && card.name.startsWith(namePrefix))
      .map((card) => ({ ownerId, zoneName, card }))
  ));
}

function finishPlacementCostBatch(state, paid) {
  const batch = state.placementCostBatch;
  if (!batch) return false;
  state.placementCostBatch = null;
  if (!paid) {
    addLog(state, `${batch.sourceName}: 必要な破壊コストをすべて支払えなかったため設置しない。`, "effect");
    return true;
  }
  const source = state.players[batch.playerId].hand.find((card) => card.uid === batch.sourceUid);
  if (!source) return fail(state, `${batch.sourceName}: 発動元が手札を離れたため設置できない。`, false);
  const resume = batch.options?.requestedSlot != null ? playCardCore : playCard;
  return resume(state, batch.playerId, batch.sourceUid, { ...batch.options, placementCostPermit: STD121_PLACEMENT_PERMIT });
}

function continuePlacementCostBatch(state) {
  const batch = state.placementCostBatch;
  if (!batch || batch.currentUid || state.pending || state.prompt || state.deferredTrashMoves?.length || state.deferredDestruction) return false;
  if (batch.failed) return finishPlacementCostBatch(state, false);
  if (!batch.queue.length) return finishPlacementCostBatch(state, batch.paidCount === batch.requiredCount);
  const uid = batch.queue.shift();
  const location = findCard(state, uid);
  if (!location || !["front", "back"].includes(location.zoneName) || location.card.faceDown === true || !location.card.name.startsWith(batch.namePrefix)) {
    batch.failed = true;
    return finishPlacementCostBatch(state, false);
  }
  batch.currentUid = uid;
  const started = destroyCard(state, location.playerId, uid, { source: `${batch.sourceName}の設置コスト` });
  if (!started && batch.currentUid === uid) {
    batch.currentUid = null;
    batch.failed = true;
    return finishPlacementCostBatch(state, false);
  }
  return true;
}

function settlePlacementCostDestruction(state, uid, destroyed) {
  const batch = state.placementCostBatch;
  if (!batch || batch.currentUid !== uid) return false;
  batch.currentUid = null;
  if (destroyed) batch.paidCount += 1;
  else batch.failed = true;
  return true;
}

function playCardCore(state, playerId, uid, { targetUid = null, targetUids = [], selectionScope = null, free = false, ignoreColor = false, force = false, allowOffTurn = false, zone = "front", baseUid = null, underUid = null, placementCause = "execution", placementSource = null, placementMode = "normal", ocDecision = null, magazineDecision = null, magazineLayerUids = [], registryExecution = false, registryOriginIndex = null, asScript = false, placementCostPermit = null, requestedSlot = null } = {}) {
  const player = state.players[playerId];
  const index = player.hand.findIndex((card) => card.uid === uid);
  if (index < 0) return fail(state, "そのカードは手札にない。", force);
  const card = player.hand[index];
  const slotCheck = requestedExecutionSlot(state, playerId, card, { requestedSlot, zone, baseUid, underUid, asScript, placementMode });
  if (!slotCheck.ok) return fail(state, slotCheck.reason, force);
  const placementCostSpec = cardPlacementCostSpec(card.id);
  if (placementCostSpec && placementCostPermit !== STD121_PLACEMENT_PERMIT) {
    if (state.placementCostBatch || state.pending || state.prompt) return fail(state, "別の処理または設置コストを処理中。", force);
    if (!force && state.active !== playerId) return fail(state, "Scriptの設置は自分ターン中だけ。", force);
    const candidates = placementCostCandidates(state, placementCostSpec);
    const distinctNames = new Set(candidates.map(({ card: candidate }) => candidate.name));
    const requiredCount = Number(placementCostSpec.selection.count ?? 0);
    if (distinctNames.size < requiredCount) return fail(state, `名前の異なる情報管理端末が${requiredCount}枚必要。`, force);
    if (!placementResult(player, "back", { mode: placementMode }).ok
      && !candidates.some(({ ownerId, zoneName }) => ownerId === playerId && zoneName === "back")) {
      return fail(state, "バック上限を空けられる設置コスト候補がない。", force);
    }
    const request = createSelectionRequest({
      mode: "exact", candidates: candidates.map(({ card: candidate }) => candidate.uid), count: requiredCount,
      candidateLabels: Object.fromEntries(candidates.map(({ ownerId, zoneName, card: candidate }) => [candidate.uid, `${ownerId}/${zoneName}: ${candidate.name}`])),
      label: `設置コストとして破壊する異名カード${requiredCount}枚`, message: card.text,
      continuation: {
        type: "placement-cost-destroy", playerId, sourceUid: card.uid, sourceName: card.name,
        requiredCount, distinctBy: placementCostSpec.selection.distinctBy, namePrefix: placementCostSpec.selection.namePrefix,
        options: { targetUid, targetUids, selectionScope, free, ignoreColor, force, allowOffTurn, zone, baseUid, underUid, placementCause, placementSource, placementMode, registryExecution, registryOriginIndex, asScript, requestedSlot }
      }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (card.id === "STD-229" && targetUids.length !== 5) {
    if (player.registry.length < 5) return fail(state, "レジストリに戻せるカードが5枚ない。", force);
    const request = createSelectionRequest({ mode: "exact", candidates: player.registry.map((item) => item.uid), count: 5,
      candidateLabels: Object.fromEntries(player.registry.map((item) => [item.uid, item.name])), label: `${card.name}: 山札へ戻す5枚`, message: card.text,
      continuation: { type: "play-std229", playerId, sourceUid: card.uid, options: { free, ignoreColor, force, zone, requestedSlot } } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (card.id === "STD-184" && asScript) {
    const setupCost = Number(card.setupCost ?? 3);
    if (!force && state.active !== playerId) return fail(state, "Scriptの設置は自分ターン中だけ。", force);
    if (!placementResult(player, "back", { mode: placementMode }).ok && placementMode !== "forced-effect") return fail(state, "バック上限。", force);
    if (!free && player.memory < setupCost) return fail(state, "設置メモリ不足。", force);
    if (state.mode !== "lab" && !ignoreColor && card.color && !enabledSymbols(player).includes(card.color)) return fail(state, `${card.color}シンボルがない。先にインストールして。`, force);
    if (!placementResult(player, "back", { mode: placementMode }).ok && placementMode === "forced-effect") {
      player.hand.splice(index, 1); failForcedPlacement(state, card.owner ?? playerId, card, { from: registryExecution ? "registry" : "hand", zone: "back", source: placementSource ?? "効果による強制配置" }); return true;
    }
    player.hand.splice(index, 1);
    if (!free) player.memory -= setupCost;
    if (!placementResult(player, "back", { mode: placementMode }).ok && placementMode === "forced-effect") {
      failForcedPlacement(state, card.owner ?? playerId, card, { zone: "back", source: placementSource ?? "効果による強制配置" });
      return true;
    }
    card.category = "Script";
    card.std184Script = true;
    card.faceDown = true;
    card.residentActive = false;
    card.sleep = false;
    if (placeByMode(state, playerId, card, { zone: "back", mode: placementMode, from: "hand", source: placementSource ?? "Script設置", requestedSlot }) !== "placed") return true;
    addLog(state, `${player.user.name}が「${card.name}」を3-0のScriptとして設置。`, "action");
    emitCardPlacement(state, playerId, card, "back", "set");
    return true;
  }
  const magazineMatch = card.category === "Sp" ? String(card.text ?? "").match(/\[弾倉[:：]\s*(\d+)\]/) : null;
  if (!free && !force && magazineMatch && magazineDecision === null) {
    const amount = Number(magazineMatch[1]);
    const layers = ownLayerEntries(player);
    const discountedCost = Math.max(0, executionCost(card, state, playerId) - amount);
    const canUse = layers.length >= amount && player.memory >= discountedCost;
    const request = createSelectionRequest({
      mode: "scope",
      scopeField: "magazine",
      scopeOptions: canUse ? ["使用しない", "使用する"] : ["使用しない"],
      label: `弾倉：${amount}を使用しますか？`,
      message: canUse ? `自分のレイヤーを${amount}枚消費し、実行メモリを${amount}少なくする。` : `使用に必要なレイヤー${amount}枚または実行メモリが不足している。`,
      continuation: { type: "play-card-magazine-confirm", playerId, sourceUid: uid, amount, options: { targetUid, targetUids, selectionScope, ignoreColor, allowOffTurn, zone, baseUid, underUid, placementCause, placementSource, registryExecution, registryOriginIndex } }
    });
    state.pending = { type: "selection", validTargets: [], request };
    return true;
  }
  const ocMatch = overclockChoice(card);
  if (!free && !force && ocMatch && ocDecision === null) {
    const amount = Number(ocMatch[1]);
    const canPay = player.memory >= executionCost(card, state, playerId) + amount;
    const request = createSelectionRequest({ mode: "scope", scopeField: "oc", scopeOptions: canPay ? ["支払わない", `+${amount}払う`] : ["支払わない"],
      label: `[OC]メモリを追加で+${amount}払いますか？`, message: canPay ? "追加で払うとOC以降の能力がトリガーする。" : "追加メモリが不足している。",
      continuation: { type: "play-card-oc", playerId, sourceUid: uid, amount, options: { targetUid, targetUids, selectionScope, ignoreColor, allowOffTurn, zone, baseUid, underUid, placementCause, placementSource, magazineDecision, magazineLayerUids, registryExecution, registryOriginIndex, requestedSlot } } });
    state.pending = { type: "selection", validTargets: [], request };
    return true;
  }
  if (card.category === "Script") {
    if (!force && state.active !== playerId) return fail(state, "Scriptの設置は自分ターン中だけ。", force);
    if (!placementResult(player, "back", { mode: placementMode }).ok && placementMode !== "forced-effect") return fail(state, "バック上限。", force);
    if (!placementResult(player, "back", { mode: placementMode }).ok && placementMode === "forced-effect") {
      player.hand.splice(index, 1); failForcedPlacement(state, card.owner ?? playerId, card, { from: registryExecution ? "registry" : "hand", zone: "back", source: placementSource ?? "効果による強制配置" }); return true;
    }
    player.hand.splice(index, 1);
    if (!placementResult(player, "back", { mode: placementMode }).ok && placementMode === "forced-effect") {
      failForcedPlacement(state, card.owner ?? playerId, card, { zone: "back", source: placementSource ?? "効果による強制配置" });
      return true;
    }
    card.faceDown = true;
    card.residentActive = false;
    card.sleep = false;
    if (placeByMode(state, playerId, card, { zone: "back", mode: placementMode, from: "hand", source: placementSource ?? "Script設置", requestedSlot }) !== "placed") return true;
    addLog(state, `${player.user.name}がScriptをバックへ裏向きで設置。`, "action");
    emitCardPlacement(state, playerId, card, "back", "set");
    return true;
  }
  let baseIndex = -1;
  let baseCard = null;
  let upperCard = null;
  if (baseUid && underUid) return fail(state, "上下両方の配置先は同時に選べない。", force);
  if (baseUid) {
    baseIndex = player[zone]?.findIndex((item) => item.uid === baseUid) ?? -1;
    baseCard = baseIndex >= 0 ? player[zone][baseIndex] : null;
    if (!baseCard || baseCard.category !== "Code") return fail(state, "上に実行するCodeを選んで。", force);
    if (placementPermissionSpecsFor(baseCard.id).some((spec) => spec.type === "forbid_mount_on_source")) return fail(state, "このCodeにはカードをマウントできない。", force);
    if (!isObCard(card)) return fail(state, "Codeの上へ実行できるのはOb。", force);
  }
  if (underUid) {
    upperCard = player[zone]?.find((item) => item.uid === underUid) ?? null;
    if (!upperCard || !isObCard(upperCard)) return fail(state, "Codeを配置するObを選んで。", force);
    if (card.category !== "Code") return fail(state, "Obの下へ配置できるのはCode。", force);
    if (placementPermissionSpecsFor(upperCard.id).some((spec) => spec.type === "forbid_mount_on_source")) return fail(state, "このカードにはカードをマウントできない。", force);
  }
  const magazineAmount = magazineDecision && magazineMatch ? Number(magazineMatch[1]) : 0;
  const uniqueMagazineLayerUids = [...new Set(magazineLayerUids)];
  const magazineEntries = magazineAmount > 0
    ? ownLayerEntries(player).filter(({ layer }) => uniqueMagazineLayerUids.includes(layer.uid))
    : [];
  if (magazineAmount > 0 && (uniqueMagazineLayerUids.length !== magazineAmount || magazineEntries.length !== magazineAmount)) {
    return fail(state, `弾倉に使用する自分のレイヤーを${magazineAmount}枚選んで。`, force);
  }
  const check = canPlayCard(state, playerId, card, { free: free || Boolean(card.dragFree), ignoreColor, force, allowOffTurn, zone, baseUid, underUid, placementMode, executionCostReduction: magazineAmount });
  if (!check.ok) return fail(state, check.reason, force);
  const firstObExecutionDiscount = !free && !card.dragFree && player.user.abilityKey === "do_or_isnt"
    && isObCard(card) && player.firstObExecutionTurn !== state.turnNumber
    && [...player.front, ...player.back].filter(isObCard).length <= 2;
  const paidExecutionMemory = !free && !card.dragFree
    ? Math.max(0, executionCost(card, state, playerId) - magazineAmount)
    : null;
  const optionalEmptyTarget = card.id === "STD-015" && getEffectTargets(state, otherPlayer(playerId), card).length === 0;
  if (spellNeedsTarget(card) && !targetUid && !targetUids.length && !optionalEmptyTarget) return fail(state, "対象を選んで。", force);
  if (card.id === "STD-211" && !selectionScope) return fail(state, "破壊するクラスを指定して。", force);

  const prePlacement = placementResult(player, zone, { addedSlots: baseUid || underUid ? 0 : 1, mode: placementMode });
  if (card.category !== "Sp" && !prePlacement.ok && prePlacement.mode === "forced-effect") {
    player.hand.splice(index, 1);
    failForcedPlacement(state, card.owner ?? playerId, card, { from: registryExecution ? "registry" : "hand", zone, source: placementSource ?? "効果による強制配置" });
    return true;
  }

  player.hand.splice(index, 1);
  if (registryExecution && !["STD-215", "STD-220"].includes(card.id)) player.triggerUsage["STD-236:registry-execute"] = true;
  if (registryExecution && card.id === "STD-220") card.std220RegistryExecutedTurn = state.turnNumber;
  card.executedFromRegistry = Boolean(registryExecution);
  if (paidExecutionMemory !== null) player.memory -= paidExecutionMemory;
  if (magazineAmount > 0) {
    const consumed = [];
    for (const { host, layer } of magazineEntries) {
      const layerIndex = host.mounted.findIndex((candidate) => candidate.uid === layer.uid);
      if (layerIndex < 0) continue;
      const [paidLayer] = host.mounted.splice(layerIndex, 1);
      consumed.push(paidLayer);
      moveCardToTrash(state, paidLayer.owner ?? playerId, paidLayer, `${card.name}の[弾倉:${magazineAmount}]`);
    }
    addLog(state, `${card.name}: [弾倉:${magazineAmount}]でレイヤー${consumed.length}枚を消費し、実行メモリを${magazineAmount}軽減。`, "effect");
    emitGameEvent(state, {
      type: "layers_consumed",
      playerId,
      ownerId: playerId,
      amount: consumed.length,
      cardUids: consumed.map((layer) => layer.uid),
      sourceCardId: card.id,
      sourceCardUid: card.uid,
      source: card.name,
      reason: "magazine"
    });
    for (const source of [...player.front, ...player.back].filter((item) => item.id === "SZTB-095" && !item.faceDown)) {
      dealFortressDamage(state, otherPlayer(playerId), 1, playerId, source.name);
      addLog(state, `${source.name}: [弾倉]によるレイヤー消費を検知し、相手ユーザーに1ダメージ。`, "effect");
    }
    resolveMandatoryStateChecks(state);
  }
  delete card.revealedExecutionCost;
  delete card.revealed;
  if (!free && ocDecision && ocMatch) {
    player.memory -= Number(ocMatch[1]);
    card.ocPaidAmount = Number(ocMatch[1]);
  } else delete card.ocPaidAmount;
  delete card.dragFree;
  addLog(state, `${player.user.name}が「${card.name}」を${free ? "ドラッグ" : "実行"}。`, "action");

  const placement = placementResult(player, zone, { addedSlots: baseUid || underUid ? 0 : 1, mode: placementMode });
  if (card.category !== "Sp" && !placement.ok && placement.mode === "forced-effect") {
    failForcedPlacement(state, card.owner ?? playerId, card, { zone, source: placementSource ?? "効果による強制配置" });
    return true;
  }

  if (card.category === "Sp") {
    if (["STD-086", "STD-211", "SZTB-096", "SZTB-097", "SZTB-098", "SZTB-099"].includes(card.id)) {
      state.deferredSpellCleanup = {
        playerId, card, zone, placementCause, placementSource,
        ...(["SZTB-096", "SZTB-097", "SZTB-098", "SZTB-099"].includes(card.id) ? { postEffect: "arms-band-jacket", postEffectDone: false } : {})
      };
      resolveEffect(state, () => {
        resolveSpell(state, playerId, card, targetUid, { targetUids, selectionScope });
        continueDeferredSpellCleanup(state);
      });
    } else {
      resolveEffect(state, () => resolveSpell(state, playerId, card, targetUid, { targetUids, selectionScope }));
      moveCardToTrash(state, playerId, card, card.name);
      notifyCardExecuted(state, playerId, card);
      emitCardPlacement(state, playerId, card, zone, placementCause, placementSource);
    }
    return true;
  }

  card.sleep = false;
  card.damage = 0;
  card.summoningSick = !hasKeyword(card, "QA");
  if (upperCard) {
    upperCard.mounted.push(card);
    card.layerRole = "mount";
    addLog(state, `${card.name}を${upperCard.name}の下へ配置。レイヤー${upperCard.mounted.length + 1}。`, "effect");
    notifyCardExecuted(state, playerId, card, { firstObExecutionDiscount, paidExecutionMemory });
    return true;
  } else if (baseCard) {
    inheritBoardSlot(card, baseCard, { controllerId: playerId, zoneName: zone });
    player[zone].splice(baseIndex, 1, card);
    baseCard.layerRole = "mount";
    card.mounted = [baseCard, ...(baseCard.mounted.splice(0))];
    addLog(state, `${card.name}を${baseCard.name}の上へ実行。レイヤー${card.mounted.length + 1}。`, "effect");
    resolveMountedSourceTrigger(state, playerId, card, baseCard);
  } else {
    if (placeByMode(state, playerId, card, { zone, mode: placementMode, from: "hand", source: placementSource ?? "実行", requestedSlot }) !== "placed") return true;
  }
  resolveEffect(state, () => resolveLogin(state, playerId, card));
  notifyCardExecuted(state, playerId, card, { firstObExecutionDiscount, paidExecutionMemory });
  emitCardPlacement(state, playerId, card, zone, placementCause, placementSource);
  if (placementCause === "effect") emitEffectPlacement(state, playerId, card, zone, placementSource);
  return true;
}

export function playCard(state, playerId, uid, options = {}) {
  if (options.requestedSlot != null) {
    // Reject a new explicit-slot command before entering/mutating effect state.
    if (state.winner || state.victory?.lockedOutcome || state.pending || state.prompt || state.effectResolution) return false;
    const card = state.players[playerId]?.hand.find(item => item.uid === uid);
    if (!card || !canExecuteAtSlot(state, playerId, card, { ...options, free: options.free || Boolean(card.dragFree) }).ok) return false;
  }
  return runEffectEntry(state, "card", playerId, () => playCardCore(state, playerId, uid, options));
}

function magazineExecutionCandidates(state, playerId) {
  const player = state.players[playerId];
  return player.hand.filter((card) => {
    if (card.category !== "Sp" || !hasKeyword(card, "MAGAZINE")) return false;
    if (spellNeedsTarget(card) && getEffectTargets(state, otherPlayer(playerId), card).length === 0) return false;
    const amount = Number(keywordValue(card, "MAGAZINE") ?? 0);
    const reduction = ownLayerEntries(player).length >= amount ? amount : 0;
    return canPlayCard(state, playerId, card, { allowOffTurn: true, executionCostReduction: reduction }).ok;
  });
}

function beginSztb094Counter(state, playerId, sourceUid) {
  const source = findCard(state, sourceUid)?.card;
  if (!source || source.id !== "SZTB-094" || source.sleep) return false;
  const candidates = magazineExecutionCandidates(state, playerId);
  if (!candidates.length) return false;
  const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((item) => item.uid), count: 1, minimum: 0, maximum: 1,
    candidateLabels: Object.fromEntries(candidates.map((item) => [item.uid, `${item.name} / メモリ${executionCost(item, state, playerId)}`])),
    label: `${source.name}: [弾倉]Spを実行`, message: "選んだ場合、これをスリープして選択したSpを実行する。選ばず確定も可能。",
    continuation: { type: "sztb094-counter-select", playerId, sourceUid } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

function notifyCardExecuted(state, executingPlayerId, executedCard, { firstObExecutionDiscount = false, paidExecutionMemory = null } = {}) {
  const residentOwnerId = otherPlayer(executingPlayerId);
  const owner = state.players[residentOwnerId];
  const executingOwner = state.players[executingPlayerId];
  if (isObCard(executedCard)) {
    for (const [controllerId, controller] of Object.entries(state.players)) {
      for (const source of controller.back.filter((card) => card.id === "STD-184" && card.std184Script && card.faceDown)) {
        const request = createSelectionRequest({ mode: "scope", scopeField: "place", scopeOptions: ["配置しない", "Obとして配置する"],
          label: `${source.name}: Obのログイン`, message: source.text,
          continuation: { type: "std184-place-ob", playerId: controllerId, sourceUid: source.uid, sourceName: source.name } });
        enqueueSelection(state, { type: "selection", validTargets: [], request }, selectionProjectionMeta("engine:std184-place", controllerId));
      }
    }
  }
  const tackle = owner.registry.find((card) => card.id === "STD-224" && !card.faceDown && Number(card.pluginValue) === Number(executedCard.cost ?? 0));
  const placedLocation = findCard(state, executedCard.uid);
  if (tackle && placedLocation && ["front", "back"].includes(placedLocation.zoneName)) {
    const tackleIndex = owner.registry.findIndex((card) => card.uid === tackle.uid);
    if (tackleIndex >= 0) moveCardToTrash(state, tackle.owner ?? residentOwnerId, owner.registry.splice(tackleIndex, 1)[0], tackle.name);
    destroyCard(state, executingPlayerId, executedCard.uid, { source: tackle.name, suppressReplacement: true });
    addLog(state, `${tackle.name}: 指定メモリ${tackle.pluginValue}と一致し、これと${executedCard.name}を破壊。`, "effect");
  }
  if (!state.prompt && isObCard(executedCard)) {
    const takeover = owner.back.find((card) => card.id === "STD-204" && card.category === "Script" && card.faceDown);
    if (takeover) {
      openScriptActivationWindow(state, residentOwnerId, takeover, {
        type: "card_executing", playerId: executingPlayerId, ownerId: executedCard.owner ?? executingPlayerId,
        cardUid: executedCard.uid, cardId: executedCard.id, cardName: executedCard.name, category: executedCard.category, color: executedCard.color
      }, { replacementTargetUid: executedCard.uid });
    }
  }
  const placed = findCard(state, executedCard.uid);
  if (!state.prompt && placed && ["front", "back"].includes(placed.zoneName)) {
    const candidateOwners = [otherPlayer(executingPlayerId), executingPlayerId];
    for (const scriptOwnerId of candidateOwners) {
      const scriptOwner = state.players[scriptOwnerId];
      const scripts = scriptOwner.back.filter((item) => {
        if (item.category !== "Script" || !item.faceDown) return false;
        if (item.id === "STD-018") return scriptOwnerId !== executingPlayerId && isObCard(executedCard);
        if (item.id === "STD-019") {
          return Boolean(executedCard.color) && scriptOwner.hand.some((card) => card.color === executedCard.color);
        }
        return false;
      });
      for (const script of scripts) {
        openScriptActivationWindow(state, scriptOwnerId, script, {
          type: "card_executing", playerId: executingPlayerId, ownerId: executedCard.owner ?? executingPlayerId,
          cardUid: executedCard.uid, cardId: executedCard.id, cardName: executedCard.name, category: executedCard.category, color: executedCard.color
        }, { eventTargetUid: executedCard.uid, eventTargetOwnerId: executingPlayerId, eventCardColor: executedCard.color });
      }
    }
  }
  const pluginIndex = owner.registry.findIndex((card) => card.id === "STD-224" && card.pluginValue === Number(executedCard.cost));
  if (pluginIndex >= 0 && executedCard.category !== "Sp") {
    const [plugin] = owner.registry.splice(pluginIndex, 1);
    moveCardToTrash(state, plugin.owner ?? ownerId, plugin, plugin.name);
    const location = findCard(state, executedCard.uid);
    if (location && ["front", "back"].includes(location.zoneName)) destroyCard(state, executingPlayerId, executedCard.uid, { source: `P-in（${plugin.name}）`, suppressReplacement: true });
    addLog(state, `P-in（${plugin.name}）：メモリ${plugin.pluginValue}を検知し、Pluginと実行カードを破壊。`, "effect");
  }
  for (const source of [...owner.front, ...owner.back].filter((card) => card.id === "SZTB-094" && !card.faceDown && !card.sleep)) {
    if (magazineExecutionCandidates(state, residentOwnerId).length) {
      (state.independentEffects ??= []).push({ kind: "SZTB-094-COUNTER", playerId: residentOwnerId, sourceUid: source.uid, sourceName: source.name });
    }
  }
  emitGameEvent(state, {
    type: "card_executed",
    playerId: executingPlayerId,
    ownerId: executedCard.owner ?? executingPlayerId,
    cardUid: executedCard.uid,
    cardId: executedCard.id,
    cardName: executedCard.name,
    category: executedCard.category
    , traits: cardTraits(executedCard)
  });
  if (isObCard(executedCard)) {
    const player = state.players[executingPlayerId];
    player.firstObExecutionTurn = state.turnNumber;
    if (firstObExecutionDiscount) emitUserAbilityFeedback(state, "do_or_isnt", executingPlayerId, executingPlayerId, {
      branch: "first-ob-discount", amount: paidExecutionMemory, anchorCardUid: executedCard.uid, steps: [{ kind: "measurement", target: { kind: "card_stat", playerId: executingPlayerId, metric: "effective_cost", cardUid: executedCard.uid }, before: paidExecutionMemory, after: paidExecutionMemory }]
    });
  }
}

function queueScriptActivationEntry(state, entry) {
  if (state.prompt) {
    state.scriptActivationQueue.push(entry);
    return true;
  }
  state.prompt = entry.prompt;
  addLog(state, entry.prompt.message, "effect");
  return true;
}

function queueDeclaredScriptActivationWindow(state, window) {
  const script = window.source.card;
  return queueScriptActivationEntry(state, {
    window,
    prompt: {
      type: "script-activation", playerId: window.controllerId, scriptUid: script.uid,
      activationWindowId: window.id, eventContext: window.context,
      message: `条件成立：「${script.name}」を起動する？`, detail: script.text
    }
  });
}

function openScriptActivationWindow(state, playerId, script, event, promptData = {}) {
  const normalizedEvent = event?.raw ? event.raw : { id: event?.id ?? `EV-${++state.triggerSerial}`, ...event };
  const eventContext = event?.raw ? event : createEventContext(state, normalizedEvent);
  const window = createScriptActivationWindow(state, eventContext, playerId, { playerId, zoneName: "back", card: script }, keywordValue(script, "IF"));
  const alreadyQueued = state.activationWindows.some((item) => item.id === window.id)
    || state.scriptActivationQueue.some((item) => item.window?.id === window.id)
    || state.prompt?.activationWindowId === window.id;
  if (alreadyQueued) return false;
  state.activationWindows.push(window);
  const entry = {
    window,
    prompt: {
    type: "script-activation", playerId, scriptUid: script.uid,
    activationWindowId: window.id, eventContext,
    message: `条件成立：「${script.name}」を起動する？`, detail: keywordValue(script, "IF"),
    ...promptData
    }
  };
  return queueScriptActivationEntry(state, entry);
}

function openNextScriptActivationWindow(state) {
  if (state.prompt || !state.scriptActivationQueue.length) return false;
  const entry = state.scriptActivationQueue.shift();
  if (entry.window.status !== "pending") return openNextScriptActivationWindow(state);
  const source = findCard(state, entry.window.source.card.uid);
  const residentWindow = source?.card.residentActive === true && ["STD-139", "STD-140"].includes(source.card.id);
  if (!source || source.playerId !== entry.window.controllerId || source.zoneName !== "back" || (source.card.faceDown !== true && !residentWindow)) {
    entry.window.status = "declined";
    return openNextScriptActivationWindow(state);
  }
  state.prompt = entry.prompt;
  addLog(state, `${entry.prompt.message}`, "effect");
  return true;
}

function queueScriptPrompt(state, playerId, triggerText, context = state.lastEventContext) {
  const scripts = state.players[playerId].back.filter((card) =>
    card.category === "Script" && card.faceDown && keywordValue(card, "IF")?.includes(triggerText)
  );
  let queued = false;
  for (const script of scripts) queued = openScriptActivationWindow(state, playerId, script, context ?? {
    type: "legacy_condition", playerId, source: triggerText
  }) || queued;
  return queued;
}

function queueMemoryLimitIncreasePrompt(state, increasedPlayerId, source) {
  const scriptOwnerId = otherPlayer(increasedPlayerId);
  const scripts = state.players[scriptOwnerId].back.filter((card) => card.id === "STD-037" && card.faceDown);
  let queued = false;
  for (const script of scripts) queued = openScriptActivationWindow(state, scriptOwnerId, script, {
    type: "memory_limit_increased", playerId: increasedPlayerId, ownerId: increasedPlayerId, source
  }, { eventTargetOwnerId: increasedPlayerId }) || queued;
  return queued;
}

function activateScriptCore(state, playerId, uid, { costUid = null, selectionUid = null } = {}) {
  const player = state.players[playerId];
  const index = player.back.findIndex((card) => card.uid === uid && card.category === "Script");
  if (index < 0) return fail(state, "そのScriptはバックにない。", false);
  const script = player.back[index];
  if (script.cannotActivateTurn === state.turnNumber) return fail(state, "この効果で配置されたため、このターンは起動できない。", false);
  const condition = keywordValue(script, "IF");
  const requiresWindow = Boolean(condition) || hasOptionalActivationSpec(script.id);
  const prompted = state.prompt?.type === "script-activation" && state.prompt.scriptUid === uid;
  const activationWindow = prompted ? state.activationWindows.find((window) => window.id === state.prompt.activationWindowId) : null;
  const normalIfActivation = Boolean(condition) && !prompted && supportsNormalScriptActivation(script);
  if (requiresWindow && prompted && (!activationWindow || activationWindow.status !== "pending")) return fail(state, "この誘発窓は既に処理済み。", false);
  if (EVENT_CONTEXT_REQUIRED_IF_IDS.has(script.id) && !prompted) return fail(state, "このScriptは参照するイベントがないため通常起動できない。", false);
  if (requiresWindow && !prompted && !normalIfActivation) return fail(state, condition ? `[if:${condition}]が成立していない。` : "発動条件が成立していない。", false);
  if ((!requiresWindow || normalIfActivation) && state.active !== playerId) return fail(state, "Scriptの通常起動は自分ターン中だけ。", false);
  if (normalIfActivation && (state.pending || state.prompt || state.winner)) return fail(state, "処理待ちがないメインアクション時だけ通常起動できる。", false);
  const activationCost = Number(script.activationCost ?? script.cost ?? 0);
  if (player.memory < activationCost) return fail(state, `${script.name}の起動に必要なメモリが足りない。`, false);
  if (state.mode !== "lab" && script.color && !enabledSymbols(player).includes(script.color)) {
    return fail(state, `${script.color}シンボルがない。先にレジストリへインストールして。`, false);
  }
  const activationRuntime = cardRuntimeSpec(script.id, "script_activation");
  const eventContext = activationWindow?.context ?? state.prompt?.eventContext ?? null;
  const eventTargetUid = state.prompt?.eventTargetUid ?? eventContext?.cardUid ?? null;
  const declaredActions = activationWindow?.spec?.actions?.length ? activationWindow.spec.actions : optionalSpecsForCard(script.id)[0]?.actions ?? [];
  const feasibilityRuntime = { records: { activation_target_uid: eventTargetUid } };
  if (activationRuntime && !activationRuntime.actions.every((action) => runtimeActionFeasible(state, playerId, script, action, feasibilityRuntime))) {
    return fail(state, "効果を実行できる対象がない。", false);
  }
  if ((prompted || normalIfActivation) && DECLARED_IF_SCRIPT_IDS.has(script.id) && !declaredActions.every((action) => triggerActionFeasible(state, playerId, action))) {
    return fail(state, "効果を実行できる対象がない。", false);
  }
  const additionalCost = activationRuntime?.additionalCost;
  if (additionalCost) {
    const eventValue = eventContext?.[additionalCost.matchEventField]
      ?? state.prompt?.[`eventCard${additionalCost.matchEventField[0].toUpperCase()}${additionalCost.matchEventField.slice(1)}`];
    const candidates = player[additionalCost.source]?.filter((card) => eventValue && card[additionalCost.matchEventField] === eventValue) ?? [];
    if (candidates.length < Number(additionalCost.count ?? 1)) return fail(state, "追加コストを支払えるカードがない。", false);
    if (!costUid && candidates.length > 1) {
      const request = createSelectionRequest({
        mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
        label: additionalCost.label, message: script.text,
        continuation: { type: "activate-runtime-additional-cost", playerId, scriptUid: uid }
      });
      state.pending = { type: "selection", validTargets: request.candidates, request };
      return true;
    }
    costUid ??= candidates[0].uid;
    if (!candidates.some((card) => card.uid === costUid)) return fail(state, "追加コストの条件を満たすカードを選んで。", false);
  }
  if (DECLARED_IF_SCRIPT_IDS.has(script.id) && (prompted || normalIfActivation)) {
    player.memory -= activationCost;
    script.faceDown = false;
    if (additionalCost?.type === "discard") {
      const discardIndex = player[additionalCost.source].findIndex((card) => card.uid === costUid);
      if (discardIndex >= 0) moveCardToTrash(state, playerId, player[additionalCost.source].splice(discardIndex, 1)[0], `${script.name}の追加コスト`);
    }
    const sourceSnapshot = Object.freeze({
      ...script,
      ...(state.runtimeContext ? { identity: Object.freeze({ ...script.identity }) } : {}),
      classes: Object.freeze([...(script.classes ?? [])]),
      traits: Object.freeze([...(script.traits ?? [])]),
      mounted: Object.freeze([...(script.mounted ?? [])])
    });
    const declared = declareEffect(state, {
      kind: "script", cardId: script.id, playerId, sourceUid: script.uid, sourceSnapshot,
      activationCause: prompted ? "event" : "normal",
      eventContext,
      eventTargetUid,
      eventCardUids: Object.freeze([...(eventContext?.raw?.cardUids ?? [eventTargetUid].filter(Boolean))]),
      runtime: activationRuntime,
      actions: Object.freeze([...declaredActions])
    });
    script.declaredEffectId = declared.id;
    if (activationWindow) activationWindow.status = "declared";
    state.prompt = null;
    addLog(state, `${script.name}を宣言。現在の効果完了後に解決する。`, "action");
    openNextScriptActivationWindow(state);
    resumeDeferredTrashMove(state);
    resumeDeferredDestruction(state);
    resumeDeferredAttack(state);
    resumeMandatoryDrawContinuation(state);
    continueDeferredDeclaredResponseCleanup(state);
    continueDeferredSpellCleanup(state);
    continuePlacementCostBatch(state);
    return true;
  }
  if (script.id === "STD-142") {
    if (player.scriptUsage[`${script.uid}:effect1`]) return fail(state, "このターンは①を起動済み。", false);
    const candidates = [...player.hand, ...player.trash].filter((card) => card.category === "Script" && card.name.includes("聖樹"));
    if (!candidates.length) return fail(state, "手札またはゴミ箱に配置できる「聖樹」Scriptがない。", false);
    if (!selectionUid) {
      const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
        candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])), label: "配置する「聖樹」Scriptを選択", message: script.text,
        continuation: { type: "activate-std142-effect1", playerId, scriptUid: uid } });
      state.pending = { type: "selection", validTargets: request.candidates, request };
      return true;
    }
    if (!candidates.some((card) => card.uid === selectionUid)) return fail(state, "配置する「聖樹」Scriptを選んで。", false);
  }
  if (script.id === "STD-105") {
    const candidates = player.hand.filter((card) => card.printedCategory === "Lyd-Ob" || card.category === "Lyd-Ob");
    if (!candidates.length) return fail(state, "手札に強制実行できるLyd-Obがない。", false);
    if (!selectionUid) {
      const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
        candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])), label: "強制実行するLyd-Ob", message: script.text,
        continuation: { type: "activate-std105", playerId, scriptUid: uid } });
      state.pending = { type: "selection", validTargets: request.candidates, request };
      return true;
    }
    if (!candidates.some((card) => card.uid === selectionUid)) return fail(state, "手札のLyd-Obを選んで。", false);
  }
  const replacementTargetUid = state.prompt?.replacementTargetUid;
  player.memory -= activationCost;
  script.faceDown = false;
  if (additionalCost?.type === "discard") {
    const discardIndex = player[additionalCost.source].findIndex((card) => card.uid === costUid);
    if (discardIndex >= 0) moveCardToTrash(state, playerId, player[additionalCost.source].splice(discardIndex, 1)[0], `${script.name}の追加コスト`);
  }
  if (activationRuntime) executeRuntimeActions(state, playerId, script, activationRuntime.actions, {
    targetUid: eventTargetUid,
    runtime: {
      records: {
        eventCardUids: state.prompt?.eventContext?.raw?.cardUids ?? [eventTargetUid].filter(Boolean)
      }
    }
  });
  if (script.id === "STD-142") {
    player.scriptUsage[`${script.uid}:effect1`] = true;
    const handIndex = player.hand.findIndex((card) => card.uid === selectionUid);
    const trashIndex = player.trash.findIndex((card) => card.uid === selectionUid);
    const [placed] = handIndex >= 0 ? player.hand.splice(handIndex, 1) : player.trash.splice(trashIndex, 1);
    const origin = handIndex >= 0 ? "hand" : "trash";
    if (placeByMode(state, playerId, placed, { zone: "back", from: origin, source: script.name, suppressScriptWindow: origin === "trash" }) === "placed") {
      placed.faceDown = true;
      placed.cannotActivateTurn = state.turnNumber;
      addLog(state, `${script.name}: 「${placed.name}」を配置。このターン起動不可。`, "effect");
    }
  }
  if (script.id === "STD-105") {
    const execution = forceExecuteCard(state, {
      sourceOwnerId: playerId, controllerId: playerId, sourceZone: "hand", targetZone: "area", cardUid: selectionUid, sourceName: script.name,
      onPlaced: (placed) => {
        setCardSleeping(state, playerId, placed);
        placed.summoningSick = false;
        placed.grantedKeywords = [...new Set([...(placed.grantedKeywords ?? []), "SECURITY"])];
      }
    });
    if (execution.status === "placed") {
      state.delayedEffects.push({ event: "turn_ended", dueTurn: state.turnNumber + 1, type: "destroy_card", ownerId: playerId, cardUid: execution.card.uid, sourceName: script.name });
      addLog(state, `${script.name}: ${execution.card.name}を強制実行し、スリープ・[セキュリティ]を付与。`, "effect");
    }
  }
  if (script.id === "STD-204" && replacementTargetUid) {
    const target = findCard(state, replacementTargetUid);
    if (target && ["front", "back"].includes(target.zoneName)) {
      const targetZone = state.players[target.playerId][target.zoneName];
      const targetIndex = targetZone.findIndex((card) => card.uid === replacementTargetUid);
      const [executedOb] = targetZone.splice(targetIndex, 1);
      executedOb.layerRole = "layered";
      const gigantes = createVengeanceCard(state, "STD-205", playerId);
      gigantes.mounted = [executedOb];
      gigantes.summoningSick = true;
      const zone = target.zoneName;
      if (placeByMode(state, playerId, gigantes, { zone, from: target.zoneName, source: script.name }) !== "placed") return true;
      addLog(state, `${script.name}: ${executedOb.name}の配置を置換し、「ドールズ・ギガンテス」のレイヤーとして配置。`, "effect");
    }
  }
  if (script.id === "STD-121") resolveTrinityEffect(state, state.active, script.name);
  if (script.id === "STD-231") {
    const target = findCard(state, state.prompt?.eventContext?.cardUid);
    if (target && ["front", "back"].includes(target.zoneName)) {
      const owner = state.players[target.playerId];
      const context = { controllerId: target.playerId, zoneName: target.zoneName, limit: owner.user?.[`${target.zoneName}Limit`] };
      const targetSlot = boardSlotOf(owner[target.zoneName], target.card, context);
      let count = 0;
      for (const slot of [targetSlot - 1, targetSlot + 1]) {
        if (slot < 1 || slot > context.limit || cardAtBoardSlot(owner[target.zoneName], slot, context)) continue;
        const proof = createVengeanceCard(state, "STD-228", playerId);
        if (placeByMode(state, target.playerId, proof, { zone: target.zoneName, from: "generated", source: script.name, requestedSlot: slot }) === "placed") { emitEffectPlacement(state, target.playerId, proof, target.zoneName, script.name); count += 1; }
      }
      addLog(state, `${script.name}: ${target.card.name}の両隣りへ征服の証${count}枚を配置。`, "effect");
    }
  }
  if (activationWindow?.spec?.actions?.length) {
    if (activationWindow.spec.limit === "once_per_turn") player.triggerUsage[activationWindow.spec.id] = true;
    for (const action of activationWindow.spec.actions) executeTriggerAction(state, activationWindow, action);
  }
  const resident = hasKeyword(script, "RESIDENT") || script.id === "STD-142";
  if (resident) {
    script.residentActive = true;
    addLog(state, script.id === "STD-142" ? `${script.name}の①を起動し、場に残る。` : `${script.name}を起動。[レジデント]として場に残る。`, "action");
  } else {
    player.back.splice(index, 1);
    moveCardToTrash(state, playerId, script, script.name);
    addLog(state, `${script.name}を起動し、解決後にゴミ箱へ。`, "action");
  }
  emitGameEvent(state, {
    type: "script_activated", playerId, ownerId: script.owner ?? playerId,
    cardUid: script.uid, cardId: script.id, cardName: script.name, category: script.category
  });
  player.scriptActivatedTurn = state.turnNumber;
  for (const candidate of player.hand.filter((card) => card.id === "STD-179")) {
    const request = createSelectionRequest({ mode: "scope", scopeField: "place", scopeOptions: ["配置しない", "配置する"],
      label: `${candidate.name}: 手札から配置`, message: candidate.text,
      continuation: { type: "std179-place", playerId, sourceUid: candidate.uid, sourceName: candidate.name } });
    enqueueSelection(state, { type: "selection", validTargets: [], request }, selectionProjectionMeta("engine:std179-place", playerId));
  }
  state.prompt = null;
  if (activationWindow) activationWindow.status = "resolved";
  openNextScriptActivationWindow(state);
  resumeDeferredTrashMove(state);
  resumeDeferredDestruction(state);
  resumeDeferredAttack(state);
  resumeMandatoryDrawContinuation(state);
  continueDeferredDeclaredResponseCleanup(state);
  continueDeferredSpellCleanup(state);
  continuePlacementCostBatch(state);
  return true;
}

export function activateScript(state, playerId, uid, options = {}) {
  const location = findCard(state, uid);
  const prompted = state.prompt?.type === "script-activation" && state.prompt.scriptUid === uid;
  if (!prompted && location?.playerId === playerId && location.zoneName === "back" && keywordValue(location.card, "IF")) {
    const invalidNormalEntry = state.effectResolution || state.resolvingDeclaredEffect || state.phase !== "main"
      || state.pending || state.prompt || state.winner || location.card.faceDown !== true || location.card.declaredEffectId;
    if (invalidNormalEntry) return fail(state, "Scriptの通常起動は処理待ちのない自分メイン中、裏向きの未宣言カードだけ。", false);
  }
  return runEffectEntry(state, "script", playerId, () => activateScriptCore(state, playerId, uid, options));
}

function declinePromptCore(state) {
  if (!state.prompt) return false;
  const window = state.activationWindows.find((item) => item.id === state.prompt.activationWindowId);
  if (window) window.status = "declined";
  addLog(state, `${state.prompt.message} → 起動しない。`, "system");
  state.prompt = null;
  openNextScriptActivationWindow(state);
  resumeDeferredTrashMove(state);
  resumeDeferredDestruction(state);
  resumeDeferredAttack(state);
  resumeMandatoryDrawContinuation(state);
  continueDeferredDeclaredResponseCleanup(state);
  continueDeferredSpellCleanup(state);
  continuePlacementCostBatch(state);
  return true;
}

export function declinePrompt(state) {
  return runEffectEntry(state, "prompt-decline", state.prompt?.playerId ?? null, () => declinePromptCore(state));
}

function resumeDeferredAttack(state) {
  if (state.prompt || state.pending || !state.deferredAttack) return false;
  const deferred = state.deferredAttack;
  state.deferredAttack = null;
  state.attackResumeStage = deferred.stage;
  const result = attack(state, deferred.playerId, deferred.attackerUid, deferred.targetUid);
  delete state.attackResumeStage;
  return result;
}

function resumeDeferredDestruction(state) {
  if (state.prompt || !state.deferredDestruction) return false;
  const deferred = state.deferredDestruction;
  state.deferredDestruction = null;
  const resolved = destroyCard(state, deferred.ownerId, deferred.uid, { source: deferred.source, suppressReplacement: deferred.suppressReplacement, suppressTrashScriptWindow: true });
  continueDeferredSpellCleanup(state);
  return resolved;
}

function matchesModuleFilter(card, filter = {}) {
  if (filter.color && card.color !== filter.color) return false;
  if (filter.category && !matchesCardCategory(card, filter.category)) return false;
  if (filter.excludeCategory && matchesCardCategory(card, filter.excludeCategory)) return false;
  if (filter.className && !hasClass(card, filter.className)) return false;
  if (filter.originalMemoryMaximum !== undefined && Number(card.cost ?? Infinity) > filter.originalMemoryMaximum) return false;
  return true;
}

function moveRemainderToDeck(player, cards, position) {
  if (position === "bottom") player.deck.unshift(...cards);
  else player.deck.push(...cards);
}

function beginDynamicSelectionModule(state, playerId, card, continuation = {}) {
  const module = card.compiled.selectionModules?.find((entry) => entry.module === "dynamic_threshold_selection");
  if (!module) return false;
  const player = state.players[playerId];
  const valueFrom = module.selection.filter.originalMemoryMaximumFrom;
  const maximum = valueFrom === "self_registry_count" ? player.registry.length : 0;
  const zone = player[module.selection.source] ?? [];
  const candidates = zone.filter((candidate) => Number(candidate.cost ?? Infinity) <= maximum && matchesModuleFilter(candidate, module.selection.filter));
  if (!candidates.length) return false;
  const request = selectionRequestFromSpec(createSelectionSpec({ candidates: candidates.map((candidate) => candidate.uid), minimum: 1, maximum: 1 }), {
    candidateLabels: Object.fromEntries(candidates.map((candidate) => [candidate.uid, `${candidate.name} / ${candidate.cost}`])), label: `X=${maximum}以下から選択`, message: card.text,
    continuation: { type: "selection-module-dynamic", playerId, sourceUid: card.uid, sourceName: card.name, module, ...continuation }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

function beginAllocationSelectionModule(state, playerId, card) {
  const module = card.compiled.selectionModules?.find((entry) => entry.module === "select_allocate_follow_up");
  if (!module) return false;
  const targetPlayerId = module.selection.owner === "opponent" ? otherPlayer(playerId) : playerId;
  const targetPlayer = state.players[targetPlayerId];
  const zones = module.selection.source === "area" ? ["front", "back"] : [module.selection.source];
  const candidates = zones.flatMap((zone) => targetPlayer[zone] ?? []).filter((candidate) => matchesModuleFilter(candidate, module.selection));
  const request = selectionRequestFromSpec(createSelectionSpec({ candidates: candidates.map((candidate) => candidate.uid), minimum: 0, maximum: candidates.length }), {
    candidateLabels: Object.fromEntries(candidates.map((candidate) => [candidate.uid, candidate.name])), label: "割り振る対象を任意選択", message: card.text,
    continuation: { type: "selection-module-allocation-targets", playerId, sourceUid: card.uid, sourceName: card.name, module }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

function resolveImperialRandomInstall(state, playerId, sourceName) {
  const opponentId = otherPlayer(playerId);
  const opponent = state.players[opponentId];
  const sources = [
    { name: "hand", cards: opponent.hand },
    { name: "area", cards: [...opponent.front, ...opponent.back] },
    { name: "trash", cards: opponent.trash },
    { name: "deck", cards: opponent.deck }
  ];
  let moved = 0;
  for (const source of sources) {
    if (!source.cards.length) continue;
    const chosen = source.cards[Math.floor(state.rng() * source.cards.length)];
    let zone = source.name;
    if (zone === "area") zone = opponent.front.some((card) => card.uid === chosen.uid) ? "front" : "back";
    const index = opponent[zone].findIndex((card) => card.uid === chosen.uid);
    if (index < 0) continue;
    const [card] = opponent[zone].splice(index, 1);
    opponent.registry.push(card);
    moved += 1;
    emitGameEvent(state, { type: "card_moved", playerId: opponentId, ownerId: card.owner ?? opponentId,
      cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category, from: zone, to: "registry", source: sourceName });
  }
  opponent.deck = shuffle(opponent.deck, state.rng);
  addLog(state, `${sourceName}: 相手の手札・エリア・ゴミ箱・山札から各1枚までをレジストリへインストール（${moved}枚）。`, "effect");
  return moved;
}

function beginSztb094Access(state, playerId, sourceName, { resumeTurnEndActiveId = null } = {}) {
  const player = state.players[playerId];
  const candidates = player.deck.filter((candidate) => isArmsBandCard(candidate) && !isObCard(candidate));
  if (!candidates.length) return false;
  const request = createSelectionRequest({ mode: "single", candidates: candidates.map((candidate) => candidate.uid), count: 1,
    candidateLabels: Object.fromEntries(candidates.map((candidate) => [candidate.uid, candidate.name])),
    label: `${sourceName}: Ob以外のアームズバンド・カードへアクセス`, message: "選んだカードを手札へ加え、山札をシャッフルする。",
    continuation: { type: "access-to-hand", playerId, sourceName, ...(resumeTurnEndActiveId ? { resumeTurnEndActiveId } : {}) } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

function forceExecuteCard(state, { sourceOwnerId, controllerId, cardUid, sourceZone, targetZone, sourceName = "強制実行", onPlaced = null } = {}) {
  const sourcePlayer = state.players[sourceOwnerId];
  const controller = state.players[controllerId];
  const sourceCards = sourcePlayer?.[sourceZone];
  if (!Array.isArray(sourceCards) || !controller || !["area", "front", "back"].includes(targetZone)) return { status: "invalid" };
  const sourceIndex = sourceCards.findIndex((card) => card.uid === cardUid);
  if (sourceIndex < 0) return { status: "missing" };
  const [sourceCard] = sourceCards.splice(sourceIndex, 1);
  const card = hydrateCard(sourceCard);
  const zoneName = targetZone === "area"
    ? (controller.front.length < controller.user.frontLimit ? "front" : controller.back.length < controller.user.backLimit ? "back" : "front")
    : targetZone;
  if (placeByMode(state, controllerId, card, { zone: zoneName, from: sourceZone, source: sourceName, mode: "forced-effect" }) !== "placed") return { status: "failed-placement", card };
  onPlaced?.(card, zoneName);
  resolveEffect(state, () => resolveLogin(state, controllerId, card));
  notifyCardExecuted(state, controllerId, card);
  emitCardPlacement(state, controllerId, card, zoneName, "effect", sourceName);
  return { status: "placed", card, zoneName };
}

function placeCardByEffect(state, { sourceOwnerId, controllerId, cardUid, sourceZone, targetZone, sourceName = "効果配置", placementMode = "forced-effect", placementCause = "effect", underUid = null, onPlaced = null } = {}) {
  const sourcePlayer = state.players[sourceOwnerId];
  const controller = state.players[controllerId];
  const sourceCards = sourcePlayer?.[sourceZone];
  const targetCards = controller?.[targetZone];
  if (!Array.isArray(sourceCards) || !Array.isArray(targetCards) || !["front", "back"].includes(targetZone)) return { status: "invalid" };
  const sourceIndex = sourceCards.findIndex((card) => card.uid === cardUid);
  if (sourceIndex < 0) return { status: "missing" };
  const host = underUid ? targetCards.find((card) => card.uid === underUid && isObCard(card)) : null;
  const sourceCard = sourceCards[sourceIndex];
  if (underUid && (!host || sourceCard.category !== "Code")) return { status: "invalid" };
  const [removed] = sourceCards.splice(sourceIndex, 1);
  const card = removed;
  if (host) {
    card.layerRole = "code";
    host.mounted.push(card);
    onPlaced?.(card, targetZone);
    emitCardPlacement(state, controllerId, card, targetZone, placementCause, sourceName);
    if (placementCause !== "access_drag") emitEffectPlacement(state, controllerId, card, targetZone, sourceName);
    return { status: "placed", card, zoneName: targetZone };
  }
  const placement = placeByMode(state, controllerId, card, { zone: targetZone, from: sourceZone, source: sourceName, mode: placementMode });
  if (placement !== "placed") {
    if (placement === "normal-rejected") sourceCards.splice(sourceIndex, 0, removed);
    return { status: placement === "normal-rejected" ? "rejected" : "failed-placement", card };
  }
  onPlaced?.(card, targetZone);
  emitCardPlacement(state, controllerId, card, targetZone, placementCause, sourceName);
  if (placementCause !== "access_drag") emitEffectPlacement(state, controllerId, card, targetZone, sourceName);
  return { status: "placed", card, zoneName: targetZone };
}

function resolveLogin(state, playerId, card) {
  const player = state.players[playerId];
  const opponent = state.players[otherPlayer(playerId)];
  if (cardRuntimeSpec(card.id, "login")) {
    executeCardRuntimeSpec(state, "login", playerId, card);
    return;
  }
  if (card.id === "SZTB-094") beginSztb094Access(state, playerId, card.name);
  const selectionModule = card.compiled?.selectionModules?.find((module) => module.module === "look_select_remainder");
  if (selectionModule) {
    const viewed = player.deck.splice(Math.max(0, player.deck.length - selectionModule.lookCount));
    const eligible = viewed.filter((candidate) => matchesModuleFilter(candidate, selectionModule.selection.filter));
    if (!eligible.length) {
      moveRemainderToDeck(player, viewed, selectionModule.remainder.position);
      addLog(state, `${card.name}: 見たカードに条件適合なし。残りを山札${selectionModule.remainder.position === "bottom" ? "下" : "上"}へ。`, "effect");
      return;
    }
    const request = selectionRequestFromSpec(createSelectionSpec({ candidates: eligible.map((candidate) => candidate.uid), minimum: 1, maximum: Math.min(selectionModule.selection.maximum, eligible.length) }), {
      candidateLabels: Object.fromEntries(eligible.map((candidate) => [candidate.uid, candidate.name])), label: `見た${viewed.length}枚から選択`, message: card.text,
      continuation: { type: "selection-module-look", playerId, sourceName: card.name, module: selectionModule, viewed }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return;
  }
  const loginAccess = card.compiled?.operations?.find((operation) => operation.type === "access") && /レジストリにインストール/.test(card.text);
  if (loginAccess && player.deck.length) {
    const request = selectionRequestFromSpec(createSelectionSpec({ candidates: player.deck.map((candidate) => candidate.uid), minimum: 1, maximum: 1 }), {
      candidateLabels: Object.fromEntries(player.deck.map((candidate) => [candidate.uid, candidate.name])), label: "アクセスしてレジストリへインストール", message: card.text,
      continuation: { type: "selection-module-access-move", playerId, sourceName: card.name, source: "deck", destination: "registry", shuffleRemaining: true }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return;
  }
  if (card.id === "STD-157") {
    const candidates = [...player.front, ...player.back].filter((item) => item.uid !== card.uid);
    if (candidates.length) {
      const request = createSelectionRequest({ mode: "single", candidates: candidates.map((item) => item.uid), count: 1,
        label: "破壊する他の自分エリアカード", message: card.text,
        continuation: { type: "std157-destroy", playerId, sourceName: card.name } });
      state.pending = { type: "selection", validTargets: request.candidates, request };
    }
  } else if (card.id === "STD-160") {
    for (const target of [...opponent.front, ...opponent.back].filter(isObCard)) {
      target.counters ??= {};
      target.counters.madness = Number(target.counters.madness ?? 0) + 3;
    }
    opponent.counters ??= {};
    opponent.counters.madness = Number(opponent.counters.madness ?? 0) + 3;
    resolveMadnessChecks(state, otherPlayer(playerId));
    addLog(state, `${card.name}: 相手Obすべてとユーザーへ狂気カウンター3個。`, "effect");
  } else if (card.id === "STD-227") {
    resolveImperialRandomInstall(state, playerId, card.name);
  } else if (card.id === "STD-124") {
    const count = player.trash.filter((item) => item.id === "STD-124").length;
    card.permanentAtk = Number(card.permanentAtk ?? 0) + count;
    card.permanentStr = Number(card.permanentStr ?? 0) + count;
    if (count >= 3) drawCards(state, playerId, 2);
    if (count >= 5) for (const target of [...state.players[otherPlayer(playerId)].front, ...state.players[otherPlayer(playerId)].back].filter(isObCard)) setCardSleeping(state, otherPlayer(playerId), target);
    if (count >= 7) card.grantedKeywords = [...new Set([...(card.grantedKeywords ?? []), "QA", "DISCONNECT"])];
    if (count >= 20) recordVictoryFact(state, { type: "special", playerId, sourceUid: card.uid, kind: "STD-124" });
    addLog(state, `${card.name}: ゴミ箱の同名${count}枚を参照し+${count}/+${count}。`, "effect");
  }
  if (hasKeyword(card, "LAYERED")) provisional(state, `${card.name}のレイヤード条件・軽減は簡易処理。`, card);
  if (card.compiled?.status && card.compiled.status !== "supported") provisional(state, `${card.name}: 効果解析 ${card.compiled.status}`, card);
}

function resolveSpell(state, playerId, card, targetUid, { targetUids = [], selectionScope = null } = {}) {
  const opponentId = otherPlayer(playerId);
  const opponent = state.players[opponentId];
  const player = state.players[playerId];
  if (executeCardRuntimeSpec(state, "spell", playerId, card, { targetUid })) return;
  if (card.id === "SZTB-097") {
    const accessAvailable = player.deck.some((item) => isArmsBandOb(item));
    const ownOb = [...player.front, ...player.back].filter(isObCard);
    const maximumAtk = ownOb.reduce((sum, item) => sum + Math.max(0, cardAtk(state, playerId, item)), 0);
    const destroyAvailable = Object.entries(state.players).some(([ownerId, owner]) => [...owner.front, ...owner.back]
      .some((item) => isObCard(item) && cardCurrentStr(state, ownerId, item) <= maximumAtk));
    const scopeOptions = [];
    if (accessAvailable) scopeOptions.push("①アームズバンドObへアクセス");
    if (destroyAvailable) scopeOptions.push("②自分Obの合計ATK以下を破壊");
    if (scopeOptions.length) {
      const request = createSelectionRequest({ mode: "scope", scopeField: "effect", scopeOptions,
        label: `${card.name}: いずれかを選択`, message: card.text,
        continuation: { type: "sztb097-choice", playerId, sourceName: card.name } });
      state.pending = { type: "selection", validTargets: [], request };
    }
  } else if (card.id === "SZTB-098") {
    const targets = [...player.front, ...player.back].filter(isArmsBandOb);
    for (const target of targets) {
      target.permanentAtk = Number(target.permanentAtk ?? 0) + 1;
      target.damage = 0;
      target.sleep = false;
    }
    addLog(state, `${card.name}: 名称:アームズバンドOb${targets.length}体を+1/+0し、ダメージを取り除いてスタンバイ。`, "effect");
  } else if (card.id === "STD-229") {
    const selected = targetUids.map((uid) => player.registry.find((item) => item.uid === uid)).filter(Boolean);
    if (selected.length !== 5 || new Set(selected.map((item) => item.uid)).size !== 5) return;
    for (const item of selected) {
      const registryIndex = player.registry.findIndex((candidate) => candidate.uid === item.uid);
      player.deck.push(...player.registry.splice(registryIndex, 1));
      emitGameEvent(state, { type: "registry_left", playerId, ownerId: item.owner ?? playerId, cardUid: item.uid, cardId: item.id, cardName: item.name, category: item.category, reason: "world-conquest" });
    }
    shuffle(player.deck, state.rng);
    state.extraTurnPlayerId = playerId;
    state.extraTurnDamagePenalty = 2;
    addLog(state, `${card.name}: レジストリ5枚を山札へ戻し、追加ターンを予約。`, "effect");
  } else if (card.id === "STD-104") {
    const target = player.hand.find((item) => item.uid === targetUid && item.printedCategory === "Lyd-Ob");
    if (!target) return;
    const requirement = String(keywordValue(target, "LAYERED") ?? "");
    const candidates = player.deck.filter((item) => requirement.includes(item.name) || (item.classes ?? []).some((name) => requirement.includes(name)));
    target.revealed = true;
    target.revealedExecutionCost = 1;
    if (candidates.length) {
      const request = createSelectionRequest({ mode: "single", candidates: candidates.map((item) => item.uid), count: 1,
        label: "公開Lyd-Obに対応するカードへアクセス", message: card.text,
        continuation: { type: "q2-access-hand", playerId, sourceName: card.name } });
      state.pending = { type: "selection", validTargets: request.candidates, request };
    }
  } else if (card.id === "STD-122") {
    const candidates = [...player.front, ...player.back].filter(isElectronFairy);
    const request = createSelectionRequest({
      mode: "up_to", candidates: candidates.map((item) => item.uid), count: candidates.length, maximum: candidates.length,
      label: "破壊するエレクトロンフェアリーを任意選択", message: card.text,
      continuation: { type: "technology-horizon", playerId, sourceName: card.name }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
  } else if (card.id === "STD-203") {
    const ownEntry = targetUids.map((uid) => findCard(state, uid)).find((entry) => entry?.playerId === playerId && isObCard(entry.card));
    const enemyEntry = targetUids.map((uid) => findCard(state, uid)).find((entry) => entry?.playerId === opponentId && isObCard(entry.card));
    if (ownEntry && enemyEntry) {
      const column = boardSlotOf(state.players[opponentId][enemyEntry.zoneName], enemyEntry.card, {
        controllerId: opponentId, zoneName: enemyEntry.zoneName, limit: state.players[opponentId].user?.[`${enemyEntry.zoneName}Limit`]
      });
      destroyCard(state, playerId, ownEntry.card.uid, { source: card.name, suppressReplacement: true });
      const enemyUid = enemyEntry.card.uid;
      state.lastDamageOutcome = null;
      dealCardDamage(state, opponentId, enemyUid, 2, card.name);
      if (state.lastDamageOutcome?.targetUid === enemyUid && state.lastDamageOutcome.destructionDetermined) {
        const sameColumn = ["front", "back"]
          .map((zoneName) => cardAtBoardSlot(state.players[opponentId][zoneName], column, {
            controllerId: opponentId, zoneName, limit: state.players[opponentId].user?.[`${zoneName}Limit`]
          }))
          .filter((target) => target && target.uid !== enemyUid && isObCard(target));
        if (sameColumn.length) {
          const request = createSelectionRequest({
            mode: "single", candidates: sameColumn.map((item) => item.uid), count: 1,
            label: "同じ縦列のObを1体選択", message: "傀儡特攻の追加2ダメージ。",
            continuation: { type: "deal-selected-damage", playerId, sourceName: card.name, amount: 2 }
          });
          state.pending = { type: "selection", validTargets: request.candidates, request };
        }
      }
    }
  } else if (card.id === "STD-212") {
    state.delayedEffects.push({
      event: "turn_ended",
      turnPlayerId: state.active,
      type: "generate_dolls_for_destroyed_ob",
      controllerId: playerId,
      sourceCardId: card.id,
      sourceName: card.name
    });
    addLog(state, `${card.name}: このターンに破壊されたOb数をターン終了時に参照する。`, "effect");
  } else if (card.id === "STD-163") {
    const candidates = [...player.front, ...player.back].filter(isObCard);
    const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((target) => target.uid), count: candidates.length, minimum: 0, maximum: candidates.length,
      candidateLabels: Object.fromEntries(candidates.map((target) => [target.uid, target.name])), label: "破壊処理を行う自分Obを任意選択", message: card.text,
      continuation: { type: "std163-destroy", playerId, sourceName: card.name } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
  } else if (card.id === "STD-211") {
    const targets = [...player.front, ...player.back].filter((target) => (target.classes ?? []).some((value) => classKey(value) === classKey(selectionScope)));
    state.std211DestructionBatch = { playerId, sourceName: card.name, className: selectionScope, queue: targets.map((target) => target.uid), destroyedCount: 0 };
    continueStd211DestructionBatch(state);
  } else if (card.id === "STD-207") {
    const generatedCard = createVengeanceCard(state, "STD-189", playerId);
    player.hand.push(generatedCard);
    emitCardsGenerated(state, playerId, [generatedCard], card.name);
    const candidates = player.hand.filter((target) => target.color === "紫");
    if (candidates.length) {
      const request = createSelectionRequest({
        mode: "single", candidates: candidates.map((item) => item.uid), count: 1,
        label: "公開する紫のカードを1枚選択", message: card.text,
        continuation: { type: "std207-reveal", playerId, sourceUid: card.uid }
      });
      state.pending = { type: "selection", validTargets: request.candidates, request };
    }
  } else if (card.id === "STD-162") {
    const candidates = [...player.front, ...player.back].filter(isObCard);
    if (candidates.length) {
      const request = createSelectionRequest({ mode: "single", candidates: candidates.map((item) => item.uid), count: 1,
        label: "破壊する自分Ob", message: card.text,
        continuation: { type: "std162-destroy", playerId, sourceName: card.name } });
      state.pending = { type: "selection", validTargets: request.candidates, request };
    }
  }
}

function continueStd163Choices(state, continuation, remaining) {
  if (remaining <= 0) return true;
  const request = selectionRequestFromSpec(createChoiceSpec({ options: ["①カードを2枚引く", "②相手Obに3ダメージ"] }), {
    label: `残り${remaining}回：①または②`, message: continuation.sourceName,
    continuation: { type: "std163-choice", playerId: continuation.playerId, sourceName: continuation.sourceName, remaining }
  });
  state.pending = { type: "selection", validTargets: [], request };
  return true;
}

function scheduleStd142TurnEndResume(state, activeId) {
  state.resumeTurnEndAfterSelection = activeId;
  return true;
}

function scheduleStd141TurnEndResume(state, activeId) {
  state.resumeTurnEndAfterSelection = activeId;
  return true;
}

function isStd141TurnEndSource(state, ownerId, uid) {
  const source = findCard(state, uid);
  return Boolean(source && source.playerId === ownerId && source.zoneName === "back"
    && source.card.id === "STD-141" && source.card.residentActive);
}

function takeStd141TurnEndSource(state, ownerId, uid) {
  const queue = state.std141TurnEndQueue;
  if (!queue) return false;
  queue.entries[ownerId] = (queue.entries[ownerId] ?? []).filter((entryUid) => entryUid !== uid);
  queue.nextOwnerId = otherPlayer(ownerId);
  return isStd141TurnEndSource(state, ownerId, uid);
}

function openStd141EffectChoice(state, ownerId, activeId, sourceUid) {
  const source = findCard(state, sourceUid);
  if (!source || source.playerId !== ownerId || source.card.id !== "STD-141" || !source.card.residentActive) {
    return scheduleStd141TurnEndResume(state, activeId);
  }
  const count = Number(state.turnStats.destroyedSacredTreeScripts ?? 0);
  if (count < 2) return scheduleStd141TurnEndResume(state, activeId);
  const options = count === 2 ? ["①2枚"] : ["②3枚以上"];
  if (count >= 5) options.push("③5枚以上");
  const request = createSelectionRequest({ mode: "scope", scopeField: "effect", scopeOptions: options,
    label: `${source.card.name}: 適用する効果`, message: `${count}枚の「聖樹」Scriptが破壊された。`,
    continuation: { type: "std141-choice", playerId: ownerId, sourceUid, sourceName: source.card.name, activeId } });
  state.pending = { type: "selection", validTargets: [], request };
  return true;
}

function continueStd141TurnEndQueue(state, activeId) {
  const queue = state.std141TurnEndQueue;
  if (!queue || queue.activeId !== activeId) return false;
  for (let attempts = 0; attempts < 2; attempts += 1) {
    const ownerId = queue.nextOwnerId;
    const candidates = (queue.entries[ownerId] ?? []).filter((uid) => isStd141TurnEndSource(state, ownerId, uid));
    queue.entries[ownerId] = candidates;
    if (!candidates.length) {
      queue.nextOwnerId = otherPlayer(ownerId);
      continue;
    }
    if (candidates.length === 1) {
      const sourceUid = candidates[0];
      takeStd141TurnEndSource(state, ownerId, sourceUid);
      return openStd141EffectChoice(state, ownerId, activeId, sourceUid);
    }
    const request = createSelectionRequest({ mode: "single", candidates, count: 1,
      candidateLabels: Object.fromEntries(candidates.map((uid) => [uid, findCard(state, uid)?.card.name ?? "聖樹枝束"])),
      label: "ターン終了時に処理する聖樹枝束を選択", message: "未処理の自分の効果から1つを選択。",
      continuation: { type: "std141-turn-end-source", playerId: ownerId, activeId } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  return false;
}

function std142PublicSacredTreeTargets(state) {
  return Object.entries(state.players).flatMap(([ownerId, owner]) =>
    ["front", "back"].flatMap((zoneName) => owner[zoneName]
      .filter((card) => card.faceDown !== true && card.name.includes("聖樹"))
      .map((card) => ({ ownerId, zoneName, card })))
  );
}

function openStd142DestroySelection(state, continuation) {
  const candidates = std142PublicSacredTreeTargets(state);
  const request = createSelectionRequest({
    mode: "up_to",
    candidates: candidates.map(({ card }) => card.uid),
    count: candidates.length,
    minimum: 0,
    maximum: candidates.length,
    candidateLabels: Object.fromEntries(candidates.map(({ ownerId, card }) => [card.uid, `${state.players[ownerId].name ?? ownerId}: ${card.name}`])),
    label: "破壊処理を行う表向きの「聖樹」カードを任意選択",
    message: continuation.sourceName,
    continuation: {
      type: "std142-destroy",
      playerId: continuation.playerId,
      activeId: continuation.activeId,
      sourceName: continuation.sourceName
    }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

function continueStd142DestroyResolution(state) {
  const batch = state.std142DestroyBatch;
  if (!batch) return false;
  const next = batch.queue.shift();
  if (next) {
    const location = findCard(state, next);
    if (!location || location.card.faceDown === true || !location.card.name.includes("聖樹")) {
      return continueStd142DestroyResolution(state);
    }
    (state.std142DestructionContinuations ??= {})[next] = { type: "target" };
    destroyCard(state, location.playerId, next, { source: batch.sourceName });
    return true;
  }
  const player = state.players[batch.playerId];
  const candidates = player.trash.filter((card) => card.category === "Script");
  const maximum = Math.min(batch.destroyedCount, candidates.length);
  const { activeId, playerId, sourceName } = batch;
  delete state.std142DestroyBatch;
  if (maximum <= 0) return scheduleStd142TurnEndResume(state, activeId);
  const request = createSelectionRequest({
    mode: "up_to",
    candidates: candidates.map((card) => card.uid),
    count: maximum,
    minimum: 0,
    maximum,
    candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])),
    label: `Scriptを${maximum}枚までサルベージ`,
    message: sourceName,
    continuation: { type: "std142-salvage", playerId, activeId, sourceName }
  });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

function settleStd142DestructionContinuation(state, uid, destroyed) {
  const continuation = state.std142DestructionContinuations?.[uid];
  if (!continuation) return false;
  delete state.std142DestructionContinuations[uid];
  if (!Object.keys(state.std142DestructionContinuations).length) delete state.std142DestructionContinuations;
  if (continuation.type === "source") {
    if (destroyed) return openStd142DestroySelection(state, continuation);
    return scheduleStd142TurnEndResume(state, continuation.activeId);
  }
  if (continuation.type === "target" && state.std142DestroyBatch) {
    if (destroyed) state.std142DestroyBatch.destroyedCount += 1;
    return continueStd142DestroyResolution(state);
  }
  return false;
}

function resolveCardSelectionCore(state, continuation, result) {
  const playerId = continuation.playerId ?? "player";
  const player = state.players[playerId];
  if (continuation.type === "placement-cost-destroy") {
    const source = player.hand.find((card) => card.uid === continuation.sourceUid && card.id === "STD-121");
    const spec = source ? cardPlacementCostSpec(source.id) : null;
    const candidates = placementCostCandidates(state, spec);
    const byUid = new Map(candidates.map((entry) => [entry.card.uid, entry]));
    const selectedUids = [...new Set(result.selected ?? [])];
    const selected = selectedUids.map((uid) => byUid.get(uid)).filter(Boolean);
    const requiredCount = Number(continuation.requiredCount ?? 0);
    const distinctNames = new Set(selected.map(({ card }) => card.name));
    const fullBack = !placementResult(player, "back", { mode: continuation.options?.placementMode ?? "normal" }).ok;
    const freesOwnBack = selected.some(({ ownerId, zoneName }) => ownerId === playerId && zoneName === "back");
    if (!source || selectedUids.length !== requiredCount || selected.length !== requiredCount
      || (continuation.distinctBy === "name" && distinctNames.size !== requiredCount)
      || (fullBack && !freesOwnBack)) return false;
    state.pending = null;
    state.placementCostBatch = {
      type: "destroy-to-place", playerId, sourceUid: source.uid, sourceName: source.name,
      requiredCount, namePrefix: continuation.namePrefix, queue: selectedUids,
      paidCount: 0, currentUid: null, failed: false, options: continuation.options ?? {}
    };
    return continuePlacementCostBatch(state);
  }
  if (continuation.type === "runtime-repeat-select-move") {
    const source = runtimeSourceFromContinuation(state, continuation);
    const runtime = continuation.runtime ?? { records: Object.create(null) };
    const candidates = runtimeSelectionCandidates(state, playerId, source, { selector: continuation.selector }, runtime);
    const selected = candidates.find((card) => card.uid === result.selected?.[0]);
    if (!selected) return false;
    const sourceZone = player[continuation.sourceZone];
    const index = sourceZone?.findIndex((card) => card.uid === selected.uid) ?? -1;
    if (index < 0 || continuation.destination !== "hand") return false;
    player.hand.push(...sourceZone.splice(index, 1));
    state.pending = null;
    return openRuntimeRepeatSelectMove(state, playerId, source, {
      selector: continuation.selector, source: continuation.sourceZone,
      destination: continuation.destination, label: continuation.label
    }, runtime, Number(continuation.remaining) - 1);
  }
  if (continuation.type === "runtime-zone-choice") {
    if (!continuation.options.includes(result.scope)) return false;
    const runtime = continuation.runtime ?? { records: Object.create(null) };
    if (continuation.sourceZoneRecord) runtime.records[continuation.sourceZoneRecord] = continuation.sourceZone;
    if (continuation.destinationRecord) runtime.records[continuation.destinationRecord] = result.scope;
    state.pending = null;
    return executeRuntimeActions(state, playerId, runtimeSourceFromContinuation(state, continuation), continuation.afterActions, { runtime });
  }
  if (continuation.type === "runtime-effect-choice") {
    const choice = continuation.choices.find((item) => item.label === result.choice);
    if (!choice) return false;
    state.pending = null;
    return executeRuntimeActions(state, playerId, runtimeSourceFromContinuation(state, continuation), choice.actions, { runtime: continuation.runtime });
  }
  if (continuation.type === "runtime-decode") {
    const decoded = [];
    for (const uid of result.selected) {
      const index = player.trash.findIndex((card) => card.uid === uid);
      if (index >= 0) decoded.push(player.trash.splice(index, 1)[0]);
    }
    if (!decoded.length) {
      state.pending = null;
      return true;
    }
    state.pending = {
      type: "decode-place",
      playerId,
      sourceName: continuation.sourceName,
      queue: decoded.map((card) => card.uid),
      cards: decoded,
      sourceUid: decoded[0].uid,
      enterSleep: continuation.enterSleep,
      destroyAtTurnEnd: continuation.destroyAtTurnEnd,
      destroyTurnPlayerId: continuation.destroyTurnPlayerId
    };
    return true;
  }
  if (continuation.type === "destruction-replacement-choice") {
    state.pending = null;
    if (result.scope === "[バックアップ]で置換") return destroyCard(state, playerId, continuation.targetUid, { source: continuation.source, replacementChoice: "backup" });
    if (result.scope === "STD-099で置換ログイン") {
      const candidates = [...player.front, ...player.back].filter((card) => card.uid !== continuation.targetUid && hasClass(card, "レッドパンクス"));
      const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((card) => card.uid), minimum: 1, maximum: candidates.length,
        label: "STD-099の追加レイヤー素材", message: "レッドパンクスを1枚以上選択。",
        continuation: { type: "std099-replacement-materials", playerId, targetUid: continuation.targetUid, sourceUid: continuation.std099Uid, source: continuation.source } });
      state.pending = { type: "selection", validTargets: request.candidates, request };
      return true;
    }
    return destroyCard(state, playerId, continuation.targetUid, { source: continuation.source, suppressReplacement: true });
  }
  if (continuation.type === "std099-replacement-materials") {
    const targetLocation = findCard(state, continuation.targetUid);
    const sourceIndex = player.hand.findIndex((card) => card.uid === continuation.sourceUid);
    if (!targetLocation || sourceIndex < 0 || result.selected.length < 1) return false;
    const [sourceCard] = player.hand.splice(sourceIndex, 1);
    const targetZone = player[targetLocation.zoneName];
    const [targetCard] = targetZone.splice(targetZone.findIndex((card) => card.uid === continuation.targetUid), 1);
    const materials = [];
    for (const uid of result.selected) {
      const location = findCard(state, uid);
      if (!location || location.playerId !== playerId || !["front", "back"].includes(location.zoneName) || !hasClass(location.card, "レッドパンクス")) continue;
      const materialZone = player[location.zoneName];
      materials.push(...materialZone.splice(materialZone.findIndex((card) => card.uid === uid), 1));
    }
    targetCard.layerRole = "layered";
    for (const material of materials) material.layerRole = "layered";
    sourceCard.mounted = [targetCard, ...materials];
    sourceCard.sleep = false;
    sourceCard.summoningSick = true;
    inheritBoardSlot(sourceCard, targetCard, { controllerId: playerId, zoneName: targetLocation.zoneName });
    player[targetLocation.zoneName].push(sourceCard);
    state.pending = null;
    emitGameEvent(state, { type: "card_destroyed", playerId, ownerId: playerId, cardUid: targetCard.uid, cardId: targetCard.id,
      cardName: targetCard.name, category: targetCard.category, from: targetLocation.zoneName, to: "layer", source: continuation.source, replaced: true });
    resolveLogin(state, playerId, sourceCard);
    addLog(state, `${sourceCard.name}: ${targetCard.name}の破壊を置換し、レイヤーとして無償ログイン。`, "effect");
    settleDestructionContinuations(state, targetCard.uid, true);
    resumeDestroyLkiFollowUp(state, targetCard.uid);
    continuePlacementCostBatch(state);
    return true;
  }
  if (["std157-destroy", "std162-destroy"].includes(continuation.type)) {
    const location = findCard(state, result.selected[0]);
    if (!location || location.playerId !== playerId) return false;
    const target = location.card;
    const x = continuation.type === "std157-destroy" ? Number(target.cost ?? 0) : Number(target.str ?? 0);
    (state.destroyLkiFollowUps ??= {})[target.uid] = { type: continuation.type === "std157-destroy" ? "std157" : "std162", playerId, sourceName: continuation.sourceName, x };
    state.pending = null;
    const resolved = destroyCard(state, playerId, target.uid, { source: continuation.sourceName });
    if (!state.pending) resumeDestroyLkiFollowUp(state, target.uid);
    return resolved;
  }
  if (continuation.type === "std157-place") {
    state.pending = null;
    const zone = player.front.length < player.user.frontLimit ? "front" : "back";
    return placeCardByEffect(state, {
      sourceOwnerId: playerId, controllerId: playerId, sourceZone: "hand", targetZone: zone, cardUid: result.selected[0], sourceName: continuation.sourceName,
      onPlaced: (card) => { card.summoningSick = zone === "front"; }
    }).status === "placed";
  }
  if (continuation.type === "std162-salvage") {
    for (const uid of result.selected) {
      const index = player.trash.findIndex((card) => card.uid === uid && isObCard(card));
      if (index >= 0) player.hand.push(...player.trash.splice(index, 1));
    }
    state.pending = null;
    addLog(state, `${continuation.sourceName}: Ob${result.selected.length}枚をサルベージ。`, "effect");
    return true;
  }
  if (continuation.type === "play-card-oc") {
    const pay = result.scope === `+${continuation.amount}払う`;
    state.pending = null;
    // An OC choice resumes the same effect; it is not a new UI command.
    const resume = continuation.options?.requestedSlot != null ? playCardCore : playCard;
    const resolved = resume(state, playerId, continuation.sourceUid, { ...continuation.options, ocDecision: pay });
    if (!continuation.options?.registryExecution) return resolved;
    const source = findCard(state, continuation.sourceUid);
    if (!resolved || !source || !["front", "back", "mounted", "trash"].includes(source.zoneName)) {
      const handIndex = player.hand.findIndex((card) => card.uid === continuation.sourceUid);
      if (handIndex >= 0) player.registry.splice(continuation.options.registryOriginIndex ?? player.registry.length, 0, ...player.hand.splice(handIndex, 1));
      return false;
    }
    emitGameEvent(state, { type: "registry_left", playerId, ownerId: source.card.owner ?? playerId,
      cardUid: source.card.uid, cardId: source.card.id, cardName: source.card.name, category: source.card.category, reason: "execute" });
    return true;
  }
  if (continuation.type === "sztb-jacket-place") {
    const zone = result.scope === "バック" ? "back" : "front";
    const jacket = hydrateCard(createRuntimeCard(state.runtimeContext ?? null, "SZTB-091", playerId, ++state.tokenSerial + 900));
    emitCardsGenerated(state, playerId, [jacket], continuation.sourceName);
    placeByMode(state, playerId, jacket, { zone, mode: "forced-effect", from: "generated", source: continuation.sourceName });
    state.pending = null;
    return true;
  }
  if (continuation.type === "sztb095-sp-replacement") {
    state.pending = null;
    return finalizeDeferredSpellCleanup(state, { replacementHostUid: result.selected[0] ?? null });
  }
  if (continuation.type === "sztb097-choice") {
    if (result.scope === "①アームズバンドObへアクセス") {
      const candidates = player.deck.filter(isArmsBandOb);
      if (!candidates.length) { state.pending = null; return true; }
      const request = createSelectionRequest({ mode: "single", candidates: candidates.map((item) => item.uid), count: 1,
        candidateLabels: Object.fromEntries(candidates.map((item) => [item.uid, item.name])), label: "アームズバンドObへアクセス", message: continuation.sourceName,
        continuation: { type: "sztb097-access", playerId, sourceName: continuation.sourceName } });
      state.pending = { type: "selection", validTargets: request.candidates, request };
      return true;
    }
    const candidates = [...player.front, ...player.back].filter(isObCard);
    const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((item) => item.uid), count: candidates.length, minimum: 0, maximum: candidates.length,
      candidateLabels: Object.fromEntries(candidates.map((item) => [item.uid, `${item.name} / ATK ${cardAtk(state, playerId, item)}`])),
      label: "合計ATKへ加える自分Obを任意選択", message: "0枚で確定した場合、後続処理は行わない。",
      continuation: { type: "sztb097-atk-sum", playerId, sourceName: continuation.sourceName } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (continuation.type === "sztb097-access") {
    const index = player.deck.findIndex((item) => item.uid === result.selected[0] && isArmsBandOb(item));
    if (index < 0) return false;
    const [accessed] = player.deck.splice(index, 1);
    player.deck = shuffle(player.deck, state.rng);
    player.hand.push(accessed);
    state.pending = null;
    addLog(state, `${continuation.sourceName}: ${accessed.name}へアクセスし手札へ加えた。`, "effect");
    return true;
  }
  if (continuation.type === "sztb097-atk-sum") {
    const selected = result.selected.map((uid) => findCard(state, uid)).filter((entry) => entry?.playerId === playerId
      && ["front", "back"].includes(entry.zoneName) && isObCard(entry.card));
    if (!selected.length) {
      if (state.deferredSpellCleanup) state.deferredSpellCleanup.postEffectDone = true;
      state.pending = null;
      addLog(state, `${continuation.sourceName}: 0体を選択したため、後続処理を行わず終了。`, "effect");
      return true;
    }
    const totalAtk = selected.reduce((sum, entry) => sum + Math.max(0, cardAtk(state, playerId, entry.card)), 0);
    const targets = Object.entries(state.players).flatMap(([ownerId, owner]) => [...owner.front, ...owner.back]
      .filter((item) => isObCard(item) && cardCurrentStr(state, ownerId, item) <= totalAtk)
      .map((item) => ({ ownerId, card: item })));
    if (!targets.length) return false;
    const request = createSelectionRequest({ mode: "single", candidates: targets.map((entry) => entry.card.uid), count: 1,
      candidateLabels: Object.fromEntries(targets.map((entry) => [entry.card.uid, `${entry.card.name} / STR ${cardCurrentStr(state, entry.ownerId, entry.card)}`])),
      label: `合計ATK ${totalAtk} 以下のObを破壊`, message: continuation.sourceName,
      continuation: { type: "sztb097-destroy", playerId, sourceName: continuation.sourceName, totalAtk } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (continuation.type === "sztb097-destroy") {
    const target = findCard(state, result.selected[0]);
    if (!target || !["front", "back"].includes(target.zoneName) || !isObCard(target.card)
      || cardCurrentStr(state, target.playerId, target.card) > continuation.totalAtk) return false;
    state.pending = null;
    destroyCard(state, target.playerId, target.card.uid, { source: continuation.sourceName });
    return true;
  }
  if (continuation.type === "sztb094-counter-select") {
    const source = findCard(state, continuation.sourceUid)?.card;
    const spell = player.hand.find((item) => item.uid === result.selected[0] && item.category === "Sp" && hasKeyword(item, "MAGAZINE"));
    if (!spell) { state.pending = null; return true; }
    if (!source || source.sleep) return false;
    source.sleep = true;
    if (spellNeedsTarget(spell)) {
      const targets = getEffectTargets(state, otherPlayer(playerId), spell);
      if (!targets.length) { source.sleep = false; state.pending = null; return false; }
      const request = createSelectionRequest({ mode: "single", candidates: targets.map((item) => item.uid), count: 1,
        candidateLabels: Object.fromEntries(targets.map((item) => [item.uid, item.name])), label: `${spell.name}: 対象を選択`, message: spell.text,
        continuation: { type: "sztb094-counter-target", playerId, spellUid: spell.uid, sourceUid: source.uid } });
      state.pending = { type: "selection", validTargets: request.candidates, request };
      return true;
    }
    state.pending = null;
    return playCard(state, playerId, spell.uid, { allowOffTurn: true });
  }
  if (continuation.type === "sztb094-counter-target") {
    state.pending = null;
    return playCard(state, playerId, continuation.spellUid, { targetUid: result.selected[0], allowOffTurn: true });
  }
  if (continuation.type === "play-card-magazine-confirm") {
    const useMagazine = result.scope === "使用する";
    state.pending = null;
    if (!useMagazine) {
      const resolved = playCard(state, playerId, continuation.sourceUid, { ...continuation.options, magazineDecision: false });
      if (!continuation.options?.registryExecution) return resolved;
      const source = findCard(state, continuation.sourceUid);
      if (!resolved || !source || !["front", "back", "mounted", "trash"].includes(source.zoneName)) {
        const handIndex = player.hand.findIndex((card) => card.uid === continuation.sourceUid);
        if (handIndex >= 0) player.registry.splice(continuation.options.registryOriginIndex ?? player.registry.length, 0, ...player.hand.splice(handIndex, 1));
        return false;
      }
      emitGameEvent(state, { type: "registry_left", playerId, ownerId: source.card.owner ?? playerId,
        cardUid: source.card.uid, cardId: source.card.id, cardName: source.card.name, category: source.card.category, reason: "execute" });
      return true;
    }
    const layers = ownLayerEntries(player);
    const request = createSelectionRequest({
      mode: "exact",
      candidates: layers.map(({ layer }) => layer.uid),
      count: continuation.amount,
      minimum: continuation.amount,
      maximum: continuation.amount,
      candidateLabels: Object.fromEntries(layers.map(({ host, layer }) => [layer.uid, `${host.name} / ${layer.name}`])),
      label: `弾倉：消費するレイヤーを${continuation.amount}枚選択`,
      message: `選択したレイヤーを消費し、実行メモリを${continuation.amount}軽減する。`,
      continuation: { type: "play-card-magazine-layers", playerId, sourceUid: continuation.sourceUid, amount: continuation.amount, options: continuation.options }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (continuation.type === "play-card-magazine-layers") {
    state.pending = null;
    const resolved = playCard(state, playerId, continuation.sourceUid, {
      ...continuation.options,
      magazineDecision: true,
      magazineLayerUids: result.selected
    });
    if (!continuation.options?.registryExecution) return resolved;
    const source = findCard(state, continuation.sourceUid);
    if (!resolved || !source || !["front", "back", "mounted", "trash"].includes(source.zoneName)) {
      const handIndex = player.hand.findIndex((card) => card.uid === continuation.sourceUid);
      if (handIndex >= 0) player.registry.splice(continuation.options.registryOriginIndex ?? player.registry.length, 0, ...player.hand.splice(handIndex, 1));
      return false;
    }
    emitGameEvent(state, { type: "registry_left", playerId, ownerId: source.card.owner ?? playerId,
      cardUid: source.card.uid, cardId: source.card.id, cardName: source.card.name, category: source.card.category, reason: "execute" });
    return true;
  }
  if (continuation.type === "activate-std203-response") {
    state.pending = null;
    return activateStd203Response(state, playerId, continuation.cardUid, result.selected, continuation.responseEvent);
  }
  if (continuation.type === "std141-choice") {
    const choice = result.scope;
    if (choice === "③5枚以上") {
      const candidates = player.hand.filter((card) => isObCard(card) && card.color === "黄");
      if (!candidates.length) { state.pending = null; return scheduleStd141TurnEndResume(state, continuation.activeId); }
      const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
        label: "配置する黄のOb", message: continuation.sourceName,
        continuation: { type: "std141-place-yellow-ob", playerId, sourceUid: continuation.sourceUid, sourceName: continuation.sourceName, activeId: continuation.activeId } });
      state.pending = { type: "selection", validTargets: request.candidates, request };
      return true;
    }
    const count = choice === "②3枚以上" ? 3 : 2;
    const candidates = player.deck.filter((card) => card.name.includes("聖樹"));
    if (candidates.length < count) { state.pending = null; return scheduleStd141TurnEndResume(state, continuation.activeId); }
    const request = createSelectionRequest({ mode: "exact", candidates: candidates.map((card) => card.uid), count,
      label: `アクセスする「聖樹」カード${count}枚`, message: continuation.sourceName,
      continuation: { type: "std141-access", playerId, sourceUid: continuation.sourceUid, sourceName: continuation.sourceName, count, installOne: count === 3, activeId: continuation.activeId } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (continuation.type === "std141-turn-end-source") {
    state.pending = null;
    const sourceUid = result.selected[0];
    if (!sourceUid || !takeStd141TurnEndSource(state, playerId, sourceUid)) return scheduleStd141TurnEndResume(state, continuation.activeId);
    return openStd141EffectChoice(state, playerId, continuation.activeId, sourceUid);
  }
  if (continuation.type === "std140-update-choice") {
    if (result.scope === "①戦闘保護") {
      const candidates = [...player.front, ...player.back].filter(isObCard);
      if (!candidates.length) { state.pending = null; return true; }
      const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
        label: "-2/0し戦闘ダメージを無効にするOb", message: continuation.sourceName,
        continuation: { type: "std140-protect", playerId, sourceName: continuation.sourceName } });
      state.pending = { type: "selection", validTargets: request.candidates, request };
      return true;
    }
    const candidates = player.trash.filter((card) => card.name.includes("聖樹") && card.name !== "聖樹枝(セフィラリンク)");
    if (!candidates.length) { state.pending = null; return true; }
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      label: "サルベージする『聖樹枝』以外の聖樹カード", message: continuation.sourceName,
      continuation: { type: "salvage-selected", playerId, sourceName: continuation.sourceName } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (continuation.type === "std223-ambush-choice") {
    const attacker = findCard(state, continuation.attackerUid)?.card;
    if (!attacker) return false;
    attacker.skipStd223Ambush = true;
    if (result.scope === "起動しない") { state.pending = null; return attack(state, continuation.attackerPlayerId, attacker.uid, continuation.attackTargetUid); }
    const candidates = Object.values(state.players).flatMap((current) => [...current.front, ...current.back]).filter(isObCard);
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      label: "異次元ショットで3ダメージを与えるOb", message: continuation.sourceName,
      continuation: { type: "std223-ambush-target", playerId, sourceUid: continuation.sourceUid, sourceName: continuation.sourceName,
        attackerPlayerId: continuation.attackerPlayerId, attackerUid: attacker.uid, attackTargetUid: continuation.attackTargetUid } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (continuation.type === "std223-ambush-target") {
    const sourceIndex = player.registry.findIndex((card) => card.uid === continuation.sourceUid && card.id === "STD-223");
    const target = findCard(state, result.selected[0]);
    if (sourceIndex < 0 || !target || !isObCard(target.card) || player.memory < 2) return false;
    const [source] = player.registry.splice(sourceIndex, 1);
    player.memory -= 2;
    moveCardToTrash(state, playerId, source, source.name);
    state.lastDamageOutcome = null;
    dealCardDamage(state, target.playerId, target.card.uid, 3, source.name, { sourcePlayerId: playerId });
    if (state.lastDamageOutcome?.destructionDetermined) drawCards(state, playerId, 1);
    state.pending = null;
    const attacker = findCard(state, continuation.attackerUid)?.card;
    return attacker ? attack(state, continuation.attackerPlayerId, attacker.uid, continuation.attackTargetUid) : true;
  }
  if (continuation.type === "std140-protect") {
    const target = findCard(state, result.selected[0])?.card;
    if (target) {
      addTimedModifier(state, target, { atk: -2, str: 0, duration: "turn" }, continuation.sourceName);
      grantDamageModifier(target, {
        direction: "received", damageKind: "battle", operation: "set", amount: 0,
        duration: "turn", activeTurn: state.turnNumber
      });
    }
    state.pending = null;
    return true;
  }
  if (continuation.type === "std141-access") {
    const selected = result.selected.map((uid) => player.deck.find((card) => card.uid === uid)).filter(Boolean);
    player.deck = player.deck.filter((card) => !result.selected.includes(card.uid));
    player.deck = shuffle(player.deck, state.rng);
    const request = createSelectionRequest({ mode: "single", candidates: selected.map((card) => card.uid), count: 1,
      candidateLabels: Object.fromEntries(selected.map((card) => [card.uid, card.name])), label: continuation.installOne ? "設置する1枚" : "手札に加える1枚", message: continuation.sourceName,
      continuation: { type: "std141-access-destination", playerId, sourceUid: continuation.sourceUid, sourceName: continuation.sourceName, selected, installOne: continuation.installOne, activeId: continuation.activeId } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (continuation.type === "std141-access-destination") {
    const chosen = continuation.selected.find((card) => card.uid === result.selected[0]);
    if (!chosen) return false;
    const rest = continuation.selected.filter((card) => card.uid !== chosen.uid);
    if (continuation.installOne) {
      if (placeByMode(state, playerId, chosen, { zone: "back", from: "deck", source: continuation.sourceName }) === "placed") chosen.faceDown = true;
    } else player.hand.push(chosen);
    for (const remainder of rest) moveCardToTrash(state, playerId, remainder, continuation.sourceName ?? "残りのカード");
    state.pending = null;
    return scheduleStd141TurnEndResume(state, continuation.activeId);
  }
  if (continuation.type === "std141-place-yellow-ob") {
    const index = player.hand.findIndex((card) => card.uid === result.selected[0] && isObCard(card) && card.color === "黄");
    if (index >= 0) {
      const zone = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
      const [card] = player.hand.splice(index, 1); card.summoningSick = true;
      if (placeByMode(state, playerId, card, { zone, from: "hand", source: continuation.sourceName }) === "placed") emitEffectPlacement(state, playerId, card, zone, continuation.sourceName);
    }
    state.pending = null;
    return scheduleStd141TurnEndResume(state, continuation.activeId);
  }
  if (continuation.type === "relog-layer-discount") {
    const useLayerDiscount = result.scope === "レイヤー1枚を破棄して1メモリ";
    state.pending = null;
    if (!useLayerDiscount) return relogCard(state, playerId, continuation.sourceUid, continuation.targetZone, { useLayerDiscount: false, requestedSlot: continuation.requestedSlot ?? null });
    const source = findCard(state, continuation.sourceUid)?.card;
    return source ? beginSourceLayerSelection(state, playerId, source, 1, {
      type: "relog-layer-select", playerId, sourceUid: source.uid, targetZone: continuation.targetZone, requestedSlot: continuation.requestedSlot ?? null
    }) : false;
  }
  if (continuation.type === "relog-layer-select") {
    state.pending = null;
    return relogCard(state, playerId, continuation.sourceUid, continuation.targetZone, {
      useLayerDiscount: true,
      layerUid: result.selected[0],
      requestedSlot: continuation.requestedSlot ?? null
    });
  }
  if (continuation.type === "q3-layer-attack-choice") {
    const source = findCard(state, continuation.sourceUid)?.card;
    state.pending = null;
    if (!source) return false;
    const layerCost = source.id === "STD-238" ? 2 : 1;
    const use = result.scope === `レイヤー${layerCost}枚を破棄して起動`;
    if (!use) {
      source.skipQ3LayerAttackChoice = true;
      return attack(state, playerId, source.uid, continuation.targetUid);
    }
    let candidateUids = null;
    if (source.id === "STD-102") {
      normalizeMountedStack(source);
      candidateUids = source.mounted.filter((layer) => {
        const candidates = [...player.trash, ...(isObCard(layer) || layer.category === "Code" ? [layer] : [])]
          .filter((card, index, cards) => (isObCard(card) || card.category === "Code") && cards.findIndex((item) => item.uid === card.uid) === index);
        const feasibility = createSelectionRequest({ mode: "up_to", candidates: candidates.map((card) => card.uid), minimum: 1, maximum: candidates.length,
          exactBudget: 2, candidateValues: Object.fromEntries(candidates.map((card) => [card.uid, Number(card.cost ?? 0)])) });
        return isSelectionRequestFeasible(feasibility);
      }).map((layer) => layer.uid);
    }
    return beginSourceLayerSelection(state, playerId, source, layerCost, {
      type: "q3-layer-attack-pay", playerId, sourceUid: source.uid, targetUid: continuation.targetUid
    }, candidateUids);
  }
  if (continuation.type === "q3-layer-attack-pay") {
    const source = findCard(state, continuation.sourceUid)?.card;
    state.pending = null;
    if (!source) return false;
    const layerCost = source.id === "STD-238" ? 2 : 1;
    const layers = consumeSelectedSourceLayers(state, playerId, source, result.selected, `${source.name}のレイヤーコスト`);
    if (!layers || layers.length !== layerCost) return false;
    source.skipQ3LayerAttackChoice = true;
    if (source.id === "STD-238") {
      source.permanentAtk = Number(source.permanentAtk ?? 0) + 2;
      const resolved = attack(state, playerId, source.uid, continuation.targetUid);
      if (findCard(state, source.uid)) source.sleep = false;
      return resolved;
    }
    if (source.id === "STD-096") {
      const resolved = attack(state, playerId, source.uid, continuation.targetUid);
      if (findCard(state, source.uid)) source.sleep = false;
      return resolved;
    }
    const candidates = player.trash.filter((card) => isObCard(card) || card.category === "Code");
    const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((card) => card.uid), minimum: 1, maximum: candidates.length,
      exactBudget: 2, candidateValues: Object.fromEntries(candidates.map((card) => [card.uid, Number(card.cost ?? 0)])),
      label: "元々のメモリ合計ちょうど2を選択", message: source.text,
      continuation: { type: "std102-place", playerId, sourceUid: source.uid, targetUid: continuation.targetUid } });
    if (!isSelectionRequestFeasible(request)) return false;
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (continuation.type === "std097-battle-choice") {
    const sourceLocation = findCard(state, continuation.sourceUid);
    state.pending = null;
    if (!sourceLocation) return false;
    const source = sourceLocation.card;
    if (result.scope === "レイヤー1枚を破棄して①を起動") {
      return beginSourceLayerSelection(state, sourceLocation.playerId, source, 1, {
        type: "std097-battle-pay", playerId: sourceLocation.playerId, sourceUid: source.uid,
        attackerPlayerId: continuation.attackerPlayerId, attackerUid: continuation.attackerUid, targetUid: continuation.targetUid
      });
    }
    source.skipStd097BattleChoice = true;
    return attack(state, continuation.attackerPlayerId, continuation.attackerUid, continuation.targetUid);
  }
  if (continuation.type === "std097-battle-pay") {
    const sourceLocation = findCard(state, continuation.sourceUid);
    state.pending = null;
    if (!sourceLocation) return false;
    const source = sourceLocation.card;
    const layers = consumeSelectedSourceLayers(state, sourceLocation.playerId, source, result.selected, `${source.name}のレイヤーコスト`);
    if (!layers || layers.length !== 1) return false;
    source.skipStd097BattleChoice = true;
    grantDamageModifier(source, {
      direction: "received", damageKind: "battle", operation: "cap_max", amount: 1, duration: "battle"
    });
    return attack(state, continuation.attackerPlayerId, continuation.attackerUid, continuation.targetUid);
  }
  if (continuation.type === "std085-layer-pay") {
    const sourceLocation = findCard(state, continuation.sourceUid);
    state.pending = null;
    if (!sourceLocation) return false;
    const source = sourceLocation.card;
    const layers = consumeSelectedSourceLayers(state, sourceLocation.playerId, source, result.selected, `${source.name}の攻撃時コスト`);
    if (!layers || layers.length !== 1) return false;
    source.permanentAtk = Number(source.permanentAtk ?? 0) + 2;
    if (source.mounted.length + 1 <= 1) {
      destroyCard(state, sourceLocation.playerId, source.uid, { source: `${source.name}のレイヤー閾値判定` });
      return true;
    }
    source.skipStd085LayerCost = true;
    return attack(state, continuation.attackerPlayerId, continuation.attackerUid, continuation.targetUid);
  }
  if (continuation.type === "std102-place") {
    const source = findCard(state, continuation.sourceUid)?.card;
    for (const uid of result.selected) {
      const index = player.trash.findIndex((card) => card.uid === uid);
      if (index < 0) continue;
      const zone = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
      const [card] = player.trash.splice(index, 1);
      placeByMode(state, playerId, card, { zone, from: "trash", source: continuation.sourceName, suppressScriptWindow: true });
    }
    state.pending = null;
    if (source && source.mounted.length === 0) destroyCard(state, playerId, source.uid, { source: `${source.name}のレイヤー閾値` });
    const sourceLocation = source ? findCard(state, source.uid) : null;
    return sourceLocation && ["front", "back"].includes(sourceLocation.zoneName)
      ? attack(state, playerId, source.uid, continuation.targetUid)
      : true;
  }
  if (continuation.type === "std164-choice") {
    const opponentId = otherPlayer(playerId);
    const opponent = state.players[opponentId];
    state.pending = null;
    if (result.choice.startsWith("①")) {
      if (opponent.hand.length) moveCardToTrash(state, opponentId, opponent.hand.shift(), continuation.sourceName ?? "手札破棄");
      resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
      return true;
    }
    const candidates = [...opponent.front, ...opponent.back].filter(isObCard);
    if (!candidates.length) {
      resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
      return true;
    }
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      label: "毒カウンターを置く相手Ob", message: continuation.sourceName,
      continuation: { type: "std164-poison", playerId, sourceName: continuation.sourceName, triggerItemId: continuation.triggerItemId } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (continuation.type === "std164-poison") {
    const target = findCard(state, result.selected[0])?.card;
    if (target) {
      target.counters ??= {};
      target.counters.poison = Number(target.counters.poison ?? 0) + 2;
    }
    state.pending = null;
    resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
    return true;
  }
  if (continuation.type === "q2-access-hand") {
    const index = player.deck.findIndex((item) => item.uid === result.selected[0]);
    if (index < 0) return false;
    const [card] = player.deck.splice(index, 1);
    player.deck = shuffle(player.deck, state.rng);
    player.hand.push(card);
    state.pending = null;
    if (continuation.triggerItemId) resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
    openNextQueuedSelection(state);
    return true;
  }
  if (continuation.type === "access-to-deck-top") {
    const index = player.deck.findIndex((item) => item.uid === result.selected[0]);
    if (index < 0) return false;
    const [card] = player.deck.splice(index, 1);
    player.deck = shuffle(player.deck, state.rng);
    player.deck.push(card);
    state.pending = null;
    addLog(state, `${continuation.sourceName}: ${card.name}へアクセスし山札の上へ。`, "effect");
    return true;
  }
  if (continuation.type === "std212-respawn-count") {
    const count = Math.min(continuation.maximum, Math.max(0, Number(result.scope) || 0));
    let generated = 0;
    for (let index = 0; index < count; index += 1) {
      const zoneName = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
      const card = createVengeanceCard(state, "STD-189", playerId);
      card.summoningSick = zoneName === "front";
      if (placeByMode(state, playerId, card, { zone: zoneName, from: "generated", source: continuation.sourceName }) === "placed") generated += 1;
    }
    addLog(state, `${continuation.sourceName}: 破壊されたOb ${continuation.maximum}枚を参照し、「ドールズ」を${generated}枚生成。`, "effect");
    state.pending = null;
    return completeTurnAfterDelayedEffects(state, continuation.activeId);
  }
  if (continuation.type === "activate-std142-effect1") {
    state.pending = null;
    return activateScript(state, playerId, continuation.scriptUid, { selectionUid: result.selected[0] });
  }
  if (continuation.type === "std163-destroy") {
    for (const uid of result.selected) destroyCard(state, playerId, uid, { source: continuation.sourceName });
    state.pending = null;
    if (!result.selected.length) return true;
    const request = selectionRequestFromSpec(createChoiceSpec({ options: ["①カードを2枚引く", "②相手Obに3ダメージ"] }), {
      label: `残り${result.selected.length}回：①または②`, message: continuation.sourceName,
      continuation: { type: "std163-choice", playerId, sourceName: continuation.sourceName, remaining: result.selected.length }
    });
    state.pending = { type: "selection", validTargets: [], request };
    return true;
  }
  if (continuation.type === "std163-choice") {
    state.pending = null;
    if (result.choice.startsWith("①")) {
      drawCards(state, playerId, 2);
      return continueStd163Choices(state, continuation, continuation.remaining - 1);
    }
    const opponentId = otherPlayer(playerId);
    const candidates = [...state.players[opponentId].front, ...state.players[opponentId].back].filter(isObCard);
    if (!candidates.length) return continueStd163Choices(state, continuation, continuation.remaining - 1);
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])), label: "3ダメージを与える相手Ob", message: continuation.sourceName,
      continuation: { ...continuation, type: "std163-damage", remaining: continuation.remaining - 1 } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (continuation.type === "std163-damage") {
    const target = findCard(state, result.selected[0]);
    if (target) dealCardDamage(state, target.playerId, target.card.uid, 3, continuation.sourceName, { sourcePlayerId: playerId });
    state.pending = null;
    return continueStd163Choices(state, continuation, continuation.remaining);
  }
  if (continuation.type === "std142-turn-end-choice") {
    state.pending = null;
    if (!result.selected.length) {
      return scheduleStd142TurnEndResume(state, continuation.activeId);
    }
    const source = findCard(state, continuation.sourceUid);
    if (!source || source.card.faceDown === true || source.card.id !== "STD-142") {
      return scheduleStd142TurnEndResume(state, continuation.activeId);
    }
    (state.std142DestructionContinuations ??= {})[source.card.uid] = {
      type: "source",
      playerId,
      activeId: continuation.activeId,
      sourceName: continuation.sourceName
    };
    destroyCard(state, source.playerId, source.card.uid, { source: `${source.card.name}の②起動コスト` });
    return true;
  }
  if (continuation.type === "std142-destroy") {
    state.pending = null;
    if (!result.selected.length) return scheduleStd142TurnEndResume(state, continuation.activeId);
    state.std142DestroyBatch = {
      playerId,
      activeId: continuation.activeId,
      sourceName: continuation.sourceName,
      queue: [...result.selected],
      destroyedCount: 0
    };
    return continueStd142DestroyResolution(state);
  }
  if (continuation.type === "std142-salvage") {
    for (const uid of result.selected) {
      const index = player.trash.findIndex((card) => card.uid === uid);
      if (index >= 0) player.hand.push(...player.trash.splice(index, 1));
    }
    state.pending = null;
    return scheduleStd142TurnEndResume(state, continuation.activeId);
  }
  if (continuation.type === "user-savage-salvage") {
    for (const uid of result.selected) {
      const index = player.trash.findIndex((card) => card.uid === uid);
      if (index >= 0) player.hand.push(...player.trash.splice(index, 1));
    }
    state.pending = null;
    state.skipSavageTurnEnd = true;
    addLog(state, result.selected.length
      ? `*ゴミ箱は空にならない*: ${result.selected.length}枚をサルベージ。`
      : "*ゴミ箱は空にならない*: サルベージしない。", "effect");
    if (result.selected.length) emitUserAbilityFeedback(state, "trash_never_empty", continuation.ownerPlayerId ?? continuation.playerId, continuation.playerId, {
      branch: "salvaged", amount: result.selected.length, steps: [{ kind: "transfer", from: { kind: "zone_count", playerId: continuation.playerId, zone: "trash" }, to: { kind: "zone_count", playerId: continuation.playerId, zone: "hand" }, count: result.selected.length }]
    });
    return endTurn(state);
  }
  if (continuation.type === "selection-module-look") {
    const viewed = continuation.viewed;
    const chosenUid = result.selected[0];
    const chosenIndex = viewed.findIndex((card) => card.uid === chosenUid);
    if (chosenIndex >= 0) {
      const [chosen] = viewed.splice(chosenIndex, 1);
      player[continuation.module.selection.destination]?.push(chosen);
      addLog(state, `${continuation.sourceName}: 見たカードから「${chosen.name}」を${continuation.module.selection.destination === "hand" ? "手札" : continuation.module.selection.destination}へ。`, "effect");
    }
    moveRemainderToDeck(player, viewed, continuation.module.remainder.position);
    state.pending = null;
    return true;
  }
  if (continuation.type === "selection-module-access-move") {
    const source = player[continuation.source];
    const index = source.findIndex((card) => card.uid === result.selected[0]);
    if (index < 0) return false;
    const [selected] = source.splice(index, 1);
    if (continuation.shuffleRemaining) player.deck = shuffle(player.deck, state.rng);
    player[continuation.destination].push(selected);
    addLog(state, `${continuation.sourceName}: 「${selected.name}」へアクセスしレジストリへインストール。`, "effect");
    state.pending = null;
    return true;
  }
  if (continuation.type === "selection-module-dynamic") {
    const module = continuation.module;
    const source = player[module.selection.source];
    const index = source.findIndex((card) => card.uid === result.selected[0]);
    if (index < 0) return false;
    const [selected] = source.splice(index, 1);
    player.hand.push(selected);
    state.pending = null;
    const executed = playCard(state, playerId, selected.uid, { free: module.followUp?.executionCost === 0 });
    if (!executed) {
      const handIndex = player.hand.findIndex((card) => card.uid === selected.uid);
      if (handIndex >= 0) player.hand.splice(handIndex, 1);
      source.push(selected);
    }
    const attacker = findCard(state, continuation.sourceUid)?.card;
    if (continuation.resumeAttack && attacker) {
      attacker.skipDynamicSelectionAttackEffect = true;
      return attack(state, playerId, attacker.uid, continuation.targetUid);
    }
    return executed;
  }
  if (continuation.type === "selection-module-allocation-targets") {
    const source = findCard(state, continuation.sourceUid)?.card;
    if (!source) return false;
    const total = source.mounted.reduce((sum, layer) => sum + Number(layer.cost ?? 0), 0);
    if (!result.selected.length) {
      for (const layer of source.mounted.splice(0)) state.players[layer.owner ?? playerId].registry.push(layer);
      state.pending = null;
      addLog(state, `${continuation.sourceName}: 対象0体。割り振りを飛ばし、レイヤーをレジストリへ。`, "effect");
      return true;
    }
    const allocationSpec = createAllocationSpec({ targets: result.selected, total, minimumPerTarget: 0, allowNoTargets: false });
    const request = selectionRequestFromSpec(allocationSpec, {
      candidateLabels: Object.fromEntries(result.selected.map((uid) => [uid, findCard(state, uid)?.card.name ?? uid])), label: `${total}ダメージを割り振る`, message: source.text,
      continuation: { type: "selection-module-allocation-resolve", playerId, sourceUid: source.uid, sourceName: source.name }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (continuation.type === "selection-module-allocation-resolve") {
    const source = findCard(state, continuation.sourceUid)?.card;
    if (!source) return false;
    for (const [uid, amount] of Object.entries(result.allocation)) {
      if (amount > 0) {
        const target = findCard(state, uid);
        if (target) dealCardDamage(state, target.playerId, uid, amount, continuation.sourceName, { sourcePlayerId: playerId });
      }
    }
    for (const layer of source.mounted.splice(0)) state.players[layer.owner ?? playerId].registry.push(layer);
    state.pending = null;
    return true;
  }
  if (continuation.type === "runtime-action-selection") {
    const source = runtimeSourceFromContinuation(state, continuation);
    const runtime = continuation.runtime ?? { records: Object.create(null) };
    const validTargets = new Set(runtimeSelectionCandidates(state, playerId, source, { selector: continuation.selector ?? {} }, runtime).map((card) => card.uid));
    const selected = [...new Set(result.selected ?? [])];
    if (selected.length < Number(continuation.minimum ?? 0)
      || selected.length > Number(continuation.maximum ?? selected.length)
      || selected.some((uid) => !validTargets.has(uid))) return false;
    state.pending = null;
    if (continuation.skipAfterActionsWhenEmpty && !selected.length) return true;
    if (continuation.recordAs) runtime.records[continuation.recordAs] = selected;
    const resolved = executeRuntimeActions(state, playerId, source, continuation.afterActions ?? [], {
      targetUid: selected[0] ?? null,
      targetUids: selected,
      runtime,
      continuationMeta: continuation.triggerItemId ? { triggerItemId: continuation.triggerItemId } : {}
    });
    if (continuation.resumeAttack) {
      const attacker = state.players[playerId].front.find((card) => card.uid === continuation.attackerUid);
      if (!attacker) return false;
      const declaredTargetLocation = findCard(state, continuation.targetUid);
      const declaredTargetExists = continuation.targetUid?.endsWith("-fortress")
        || Boolean(declaredTargetLocation && ["front", "back"].includes(declaredTargetLocation.zoneName));
      if (!declaredTargetExists && continuation.settleMissingTargetAsCompleted) {
        setCardSleeping(state, playerId, attacker);
        attacker.attackedThisTurn = true;
        addLog(state, `${attacker.name}の攻撃対象は攻撃前効果で破壊され、戦闘を終了。`, "effect");
        return true;
      }
      if (state.pending || state.prompt) {
        state.deferredAttack = { stage: "start", playerId, attackerUid: attacker.uid, targetUid: continuation.targetUid };
        return resolved;
      }
      attacker.skipRuntimeAttackEffect = true;
      return attack(state, playerId, attacker.uid, continuation.targetUid);
    }
    if (continuation.triggerItemId && !state.pending) resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
    return resolved;
  }
  if (continuation.type === "runtime-player-selection") {
    const selected = result.selected?.[0];
    if (!continuation.candidates.includes(selected)) return false;
    const runtime = continuation.runtime ?? { records: Object.create(null) };
    if (continuation.recordAs) runtime.records[continuation.recordAs] = selected;
    state.pending = null;
    return executeRuntimeActions(state, playerId, runtimeSourceFromContinuation(state, continuation), continuation.afterActions, { runtime });
  }
  if (continuation.type === "runtime-access-reference") {
    const source = runtimeSourceFromContinuation(state, continuation);
    const reference = player.hand.find((card) => card.uid === result.selected[0]);
    if (!reference) return false;
    if (continuation.action.referenceSelection?.reveal) reference.revealed = true;
    if (!openRuntimeAccessSelection(state, playerId, source, continuation.action, reference, reference.uid)) {
      reference.revealed = false;
      return false;
    }
    return true;
  }
  if (["access-to-hand", "access-drag", "access-distribute"].includes(continuation.type)) {
    const accessed = [];
    for (const uid of result.selected) {
      const index = player.deck.findIndex((card) => card.uid === uid);
      if (index >= 0) accessed.push(player.deck.splice(index, 1)[0]);
    }
    player.deck = shuffle(player.deck, state.rng);
    if (continuation.type === "access-distribute") {
      for (const [index, card] of accessed.entries()) {
        const destination = continuation.destinations?.[index] ?? "hand";
        if (destination === "trash") moveCardToTrash(state, playerId, card, continuation.sourceName ?? "アクセス");
        else player.hand.push(card);
      }
    } else {
      player.hand.push(...accessed);
    }
    if (continuation.revealSelected) {
      for (const card of accessed) card.revealed = true;
    }
    state.pending = continuation.type === "access-drag" && accessed.length ? {
      type: "access-drag-place", playerId, sourceName: continuation.sourceName,
      queue: accessed.map((card) => card.uid), sourceUid: accessed[0].uid, enterSleep: continuation.enterSleep
    } : null;
    if (continuation.revealedUid) {
      const revealed = player.hand.find((card) => card.uid === continuation.revealedUid);
      if (revealed) revealed.revealed = false;
    }
    if (!state.pending && continuation.afterActions?.length) {
      executeRuntimeActions(state, playerId, runtimeSourceFromContinuation(state, continuation), continuation.afterActions, {
        targetUids: accessed.map((card) => card.uid),
        continuationMeta: continuation.triggerItemId ? { triggerItemId: continuation.triggerItemId } : {}
      });
    }
    const resultText = continuation.type === "access-drag"
      ? (accessed.length ? "。配置先を選択。" : "。対象なし。")
      : continuation.type === "access-distribute"
        ? "し、指定された領域へ移動。"
        : "し手札へ。";
    addLog(state, `${continuation.sourceName}: ${accessed.length}枚へアクセス${resultText}`, "effect");
    if (!state.pending && continuation.resumeTurnEndActiveId) state.resumeTurnEndAfterSelection = continuation.resumeTurnEndActiveId;
    if (continuation.triggerItemId && !state.pending) resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
    if (!state.pending) openNextQueuedSelection(state);
    return true;
  }
  if (continuation.type === "activate-runtime-additional-cost") {
    state.pending = null;
    return activateScript(state, playerId, continuation.scriptUid, { costUid: result.selected[0] });
  }
  if (continuation.type === "activate-std105") {
    state.pending = null;
    return activateScript(state, playerId, continuation.scriptUid, { selectionUid: result.selected[0] });
  }
  if (continuation.type === "std165-login") {
    const uid = result.selected[0];
    let index = player.hand.findIndex((card) => card.uid === uid && isObCard(card) && hasClass(card, "旧支配者"));
    if (index < 0) {
      index = player.trash.findIndex((card) => card.uid === uid && isObCard(card) && hasClass(card, "旧支配者"));
      if (index < 0) return false;
      player.hand.push(player.trash.splice(index, 1)[0]);
    }
    state.pending = null;
    const zone = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
    return playCard(state, playerId, uid, { zone, free: true, force: true, ignoreColor: true, placementCause: "effect", placementSource: continuation.sourceName, placementMode: "forced-effect" });
  }
  if (continuation.type === "trigger-selected-entity-action") {
    const uid = result.selected[0];
    const action = continuation.action;
    if (action?.type !== "add_counter" || action.target !== "selected_entity") return false;
    if (uid?.endsWith("-fortress")) {
      const targetId = uid.slice(0, -"-fortress".length);
      const target = state.players[targetId];
      if (!target) return false;
      target.load = Number(target.load ?? 0) + Number(action.amount ?? 0);
      if (action.counter === "load") target.fortressStr = Math.max(0, target.fortressStr - Number(action.amount ?? 0));
    } else {
      const target = findCard(state, uid);
      if (!target || !["front", "back"].includes(target.zoneName) || !isObCard(target.card)) return false;
      if (action.counter === "load") target.card.load = Number(target.card.load ?? 0) + Number(action.amount ?? 0);
    }
    state.pending = null;
    if (continuation.triggerItemId) resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
    return true;
  }
  if (continuation.type === "std179-place") {
    state.pending = null;
    if (result.scope !== "配置する") { openNextQueuedSelection(state); return true; }
    const card = player.hand.find((item) => item.uid === continuation.sourceUid && item.id === "STD-179");
    if (!card) { openNextQueuedSelection(state); return true; }
    const zone = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
    const placed = placeCardByEffect(state, {
      sourceOwnerId: playerId, controllerId: playerId, sourceZone: "hand", targetZone: zone, cardUid: card.uid, sourceName: continuation.sourceName,
      onPlaced: (placedCard) => { placedCard.summoningSick = zone === "front"; }
    }).status === "placed";
    openNextQueuedSelection(state);
    return placed;
  }
  if (continuation.type === "std182-attack-script") {
    state.pending = null;
    const attacker = player.front.find((item) => item.uid === continuation.attackerUid && item.id === "STD-182");
    if (!attacker) return false;
    attacker.skipStd182AttackEffect = true;
    if (!result.selected.length) return attack(state, playerId, attacker.uid, continuation.targetUid);
    const script = player.back.find((item) => item.uid === result.selected[0] && item.category === "Script" && item.faceDown
      && Number(item.activationCost ?? item.cost ?? Infinity) <= 2);
    if (!script) return attack(state, playerId, attacker.uid, continuation.targetUid);
    state.deferredAttack = { stage: "std182-script", playerId, attackerUid: attacker.uid, targetUid: continuation.targetUid };
    const activated = activateScript(state, playerId, script.uid);
    if (!activated) { state.deferredAttack = null; return attack(state, playerId, attacker.uid, continuation.targetUid); }
    resumeDeferredAttack(state);
    return true;
  }
  if (continuation.type === "std184-place-ob") {
    state.pending = null;
    if (result.scope !== "Obとして配置する") { openNextQueuedSelection(state); return true; }
    const index = player.back.findIndex((item) => item.uid === continuation.sourceUid && item.id === "STD-184" && item.std184Script && item.faceDown);
    if (index < 0) { openNextQueuedSelection(state); return true; }
    const zone = player.front.length < player.user.frontLimit ? "front" : player.back.length - 1 < player.user.backLimit ? "back" : "front";
    const [card] = player.back.splice(index, 1);
    card.category = "Ob";
    delete card.std184Script;
    card.faceDown = false;
    card.residentActive = false;
    card.sleep = false;
    card.damage = 0;
    card.summoningSick = zone === "front";
    if (placeByMode(state, playerId, card, { zone, from: "back", source: continuation.sourceName }) !== "placed") { openNextQueuedSelection(state); return true; }
    emitEffectPlacement(state, playerId, card, zone, continuation.sourceName);
    addLog(state, `${continuation.sourceName}: Script状態からObとして${zone === "front" ? "フロント" : "バック"}へ配置。`, "effect");
    openNextQueuedSelection(state);
    return true;
  }
  if (continuation.type === "play-std229") {
    state.pending = null;
    const resume = continuation.options?.requestedSlot != null ? playCardCore : playCard;
    return resume(state, playerId, continuation.sourceUid, { ...continuation.options, targetUids: result.selected });
  }
  if (continuation.type === "std214-attack-cost") {
    const index = player.registry.findIndex((item) => item.uid === result.selected[0]);
    const attacker = player.front.find((item) => item.uid === continuation.attackerUid && item.id === "STD-214");
    state.pending = null;
    if (index < 0 || !attacker) return false;
    const [recovered] = player.registry.splice(index, 1); player.hand.push(recovered);
    emitGameEvent(state, { type: "registry_left", playerId, ownerId: recovered.owner ?? playerId, cardUid: recovered.uid, cardId: recovered.id, cardName: recovered.name, category: recovered.category, reason: "attack-cost" });
    attacker.skipStd214AttackCost = true;
    return attack(state, playerId, attacker.uid, continuation.targetUid);
  }
  if (continuation.type === "std185-defender-substitute") {
    state.pending = null;
    const attacker = state.players[continuation.attackerPlayerId].front.find((item) => item.uid === continuation.attackerUid);
    if (!attacker) return false;
    attacker.skipStd185Substitution = true;
    const targetUid = result.scope === "クワガタ将軍と戦闘" ? continuation.generalUid : continuation.originalTargetUid;
    return attack(state, continuation.attackerPlayerId, attacker.uid, targetUid);
  }
  if (continuation.type === "std185-attacker-substitute") {
    state.pending = null;
    const original = player.front.find((item) => item.uid === continuation.attackerUid);
    const general = player.front.find((item) => item.uid === continuation.generalUid && item.id === "STD-185" && !item.sleep);
    if (!original || !general) return false;
    if (result.scope !== "クワガタ将軍と戦闘") {
      original.skipStd185AttackerSubstitution = true;
      return attack(state, playerId, original.uid, continuation.targetUid);
    }
    general.skipStd230Ambush = true;
    general.skipStd185AttackerSubstitution = true;
    return attack(state, playerId, general.uid, continuation.targetUid);
  }
  if (continuation.type === "std226-compress") {
    state.pending = null;
    if (!result.selected.length) { openNextQueuedSelection(state); return true; }
    const source = [...player.front, ...player.back].find((item) => item.uid === continuation.sourceUid && item.id === "STD-226" && !item.sleep);
    const target = findCard(state, result.selected[0]);
    if (source && target?.zoneName === "registry") { setCardSleeping(state, playerId, source); target.card.faceDown = true; }
    openNextQueuedSelection(state);
    return true;
  }
  if (continuation.type === "std230-ambush-choice") {
    state.pending = null;
    const attacker = state.players[continuation.attackerPlayerId].front.find((item) => item.uid === continuation.attackerUid);
    if (!attacker) return false;
    if (result.scope !== "[アンブッシュ:3]を起動") { attacker.skipStd230Ambush = true; return attack(state, continuation.attackerPlayerId, attacker.uid, continuation.targetUid); }
    const sourceIndex = player.registry.findIndex((item) => item.uid === continuation.sourceUid && item.id === "STD-230" && !item.faceDown);
    const source = sourceIndex >= 0 ? player.registry[sourceIndex] : null;
    const cost = Number(source?.cost ?? 0);
    if (!source || player.memory < cost || player.registry.length < cost) {
      attacker.skipStd230Ambush = true;
      return attack(state, continuation.attackerPlayerId, attacker.uid, continuation.targetUid);
    }
    player.memory -= cost;
    const opponentId = otherPlayer(playerId); const candidates = state.players[opponentId].hand;
    const cleanup = { playerId, sourceUid: source.uid, attackerPlayerId: continuation.attackerPlayerId, attackerUid: attacker.uid, targetUid: continuation.targetUid };
    if (!candidates.length) { state.std230AmbushCleanup = cleanup; return resumeStd230AmbushCleanup(state); }
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((item) => item.uid), count: 1,
      candidateLabels: Object.fromEntries(candidates.map((item) => [item.uid, item.name])), label: "相手手札からレジストリへ加える1枚", message: continuation.sourceName,
      continuation: { type: "std230-install-hand", playerId, opponentId, cleanup } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (continuation.type === "std230-install-hand") {
    const opponent = state.players[continuation.opponentId];
    const chosenIndex = opponent.hand.findIndex((item) => item.uid === result.selected[0]);
    if (chosenIndex >= 0) { const [chosen] = opponent.hand.splice(chosenIndex, 1); player.registry.push(chosen); emitRegistryInstalled(state, playerId, chosen, "悪の発明"); }
    if (opponent.hand.length) { const randomIndex = Math.floor(state.rng() * opponent.hand.length); const [random] = opponent.hand.splice(randomIndex, 1); player.registry.push(random); emitRegistryInstalled(state, playerId, random, "悪の発明"); }
    state.pending = null;
    state.std230AmbushCleanup = continuation.cleanup;
    return resumeStd230AmbushCleanup(state);
  }
  if (continuation.type === "mounted-event-discard") {
    if (result.selected.length !== continuation.count) return false;
    for (const uid of result.selected) {
      const index = player.hand.findIndex((item) => item.uid === uid);
      if (index >= 0) moveCardToTrash(state, playerId, player.hand.splice(index, 1)[0], continuation.sourceName);
    }
    state.pending = null; openNextQueuedSelection(state); return true;
  }
  if (continuation.type === "grant-keyword") {
    const target = findCard(state, result.selected[0])?.card;
    if (!target) return false;
    target.grantedKeywords = [...new Set([...(target.grantedKeywords ?? []), continuation.keyword])];
    addLog(state, `${continuation.sourceName}: ${target.name}に[${continuation.keyword}]を付与。`, "effect");
    state.pending = null;
    return true;
  }
  if (continuation.type === "salvage-selected") {
    const index = player.trash.findIndex((card) => card.uid === result.selected[0]);
    if (index < 0) return false;
    const [card] = player.trash.splice(index, 1);
    player.hand.push(card);
    addLog(state, `${continuation.sourceName}: ${card.name}をサルベージ。`, "effect");
    state.pending = null;
    return true;
  }
  if (continuation.type === "technology-horizon") {
    if (!result.selected.length) {
      state.pending = null;
      addLog(state, `${continuation.sourceName}: 0体選択のため①以降を処理しない。`, "effect");
      return true;
    }
    const names = [];
    for (const uid of result.selected) {
      const location = findCard(state, uid);
      if (location && destroyCard(state, location.playerId, uid, { source: continuation.sourceName })) names.push(location.card.name);
    }
    if (!names.length) { state.pending = null; return true; }
    const x = names.reduce((sum, name) => sum + player.trash.filter((card) => card.name === name).length * 2, 0);
    for (let index = 0; index < 2; index += 1) {
      const zone = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
      const ghost = hydrateCard(createRuntimeCard(state.runtimeContext ?? null, "STD-123", playerId, ++state.tokenSerial + 1200));
      ghost.permanentAtk = x;
      ghost.permanentStr = x;
      ghost.summoningSick = cardAtk(state, playerId, ghost) < 5;
      if (placeByMode(state, playerId, ghost, { zone, from: "generated", source: continuation.sourceName }) !== "placed") continue;
      emitEffectPlacement(state, playerId, ghost, zone, continuation.sourceName);
      if (cardMaxStr(state, playerId, ghost) <= 0) destroyCard(state, playerId, ghost.uid, { source: "STR0以下の状態判定", suppressReplacement: true });
    }
    addLog(state, `${continuation.sourceName}: ゴースト2体を生成し+${x}/+${x}。`, "effect");
    state.pending = null;
    return true;
  }
  if (continuation.type === "runtime-execute-from-trash") {
    const index = player.trash.findIndex((card) => card.uid === result.selected[0]);
    if (index < 0) return false;
    const [spell] = player.trash.splice(index, 1);
    state.pending = null;
    resolveEffect(state, () => resolveSpell(state, playerId, spell, null));
    if (continuation.destinationAfterExecution === "deck") {
      player.deck.push(spell);
      if (continuation.shuffleAfter) player.deck = shuffle(player.deck, state.rng);
    }
    addLog(state, `${continuation.sourceName}: ${spell.name}をゴミ箱から起動し${continuation.destinationAfterExecution === "deck" ? "デッキへ戻した" : "処理した"}。`, "effect");
    if (continuation.triggerItemId) resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
    return true;
  }
  if (continuation.type === "std207-reveal") {
    const target = player.hand.find((item) => item.uid === result.selected[0] && item.color === "紫");
    if (!target) return false;
    target.revealed = true;
    target.turnCostModifier = Number(target.turnCostModifier ?? 0) - 2;
    addLog(state, `クラフト・パッチワーク: ${target.name}を公開。このターン実行メモリ-2。`, "effect");
    state.pending = null;
    return true;
  }
  if (continuation.type === "destroy-selected") {
    for (const uid of result.selected) {
      const location = findCard(state, uid);
      if (location) destroyCard(state, location.playerId, uid, { source: continuation.sourceName, suppressReplacement: true });
    }
    state.pending = null;
    resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
    return true;
  }
  if (continuation.type === "trigger-modify-grant") {
    const target = findCard(state, result.selected[0])?.card;
    if (target) addTimedModifier(state, target, continuation.action, continuation.sourceName);
    state.pending = null;
    resumeTriggerThreadAfterSelection(state, continuation.triggerItemId);
    return true;
  }
  if (continuation.type === "trigger-modify-prevent-battle") {
    const target = findCard(state, result.selected[0])?.card;
    if (target) {
      addTimedModifier(state, target, continuation.action, continuation.sourceName);
      grantDamageModifier(target, {
        direction: "received", damageKind: "battle", operation: "set", amount: 0,
        duration: "turn", activeTurn: state.turnNumber
      });
    }
    state.pending = null;
    return true;
  }
  if (continuation.type === "deal-selected-damage") {
    const location = findCard(state, result.selected[0]);
    if (!location) return false;
    dealCardDamage(state, location.playerId, location.card.uid, continuation.amount, continuation.sourceName);
    state.pending = null;
    openNextQueuedSelection(state);
    return true;
  }
  if (continuation.type === "hahanamori-standby") {
    const source = findCard(state, continuation.sourceUid)?.card;
    if (!source) return false;
    if (result.selected.length) {
      const target = findCard(state, result.selected[0]);
      if (target) destroyCard(state, target.playerId, target.card.uid, { source: source.name, suppressReplacement: true });
      source.sleep = false;
      const defender = findCard(state, continuation.defenderUid)?.card;
      if (defender) defender.skipStandby = true;
      addLog(state, `${source.name}: 他のObを破壊してスタンバイ。戦闘相手は次の開始時にスタンバイしない。`, "effect");
    }
    state.pending = null;
    return true;
  }
  return false;
}

function resumeCardSelection(state, continuation, result) {
  const resolved = resolveCardSelectionCore(state, continuation, result);
  if (resolved && !state.pending && !state.prompt) continueDeferredSpellCleanup(state);
  if (resolved && !state.pending && !state.prompt) continueDeferredDeclaredResponseCleanup(state);
  if (resolved && !state.pending && !state.prompt) continueDeferredDeclaredScriptCleanup(state);
  if (resolved && !state.pending && !state.prompt) continuePlacementCostBatch(state);
  if (resolved) resumeMandatoryDrawContinuation(state);
  return resolved;
}

export function resolveCardSelection(state, continuation, result) {
  const resolved = runEffectEntry(state, "selection", continuation?.playerId ?? null, () => resumeCardSelection(state, continuation, result));
  const activeId = state.resumeTurnEndAfterSelection;
  if (resolved && activeId && !state.pending && !state.prompt) {
    delete state.resumeTurnEndAfterSelection;
    if (!state.winner) endTurn(state);
  }
  return resolved;
}

export function getEffectTargets(state, targetPlayerId, sourceCard) {
  const player = state.players[targetPlayerId];
  const zones = sourceCard.text?.includes("フロント") ? ["front"] : ["front", "back"];
  let cards = zones.flatMap((zoneName) => player[zoneName]);
  const targetsOpponent = Boolean(sourceCard.owner && sourceCard.owner !== targetPlayerId);
  if (targetsOpponent) {
    cards = cards.filter((card) => !hasKeyword(card, "FIREWALL"));
    const decoys = cards.filter((card) => hasKeyword(card, "DECOY"));
    if (decoys.length && !hasKeyword(sourceCard, "HACKING")) cards = decoys;
  }
  if (sourceCard.id === "STD-011") return [...cards, { uid: `${targetPlayerId}-fortress`, name: player.user.name, category: "User" }];
  if (sourceCard.id === "SZTB-096") return cards.filter(isObCard);
  return ["STD-033", "STD-209"].includes(sourceCard.id) ? cards : cards.filter(isObCard);
}

export function getPublicCards(state) {
  const entries = [];
  for (const [playerId, player] of Object.entries(state.players)) {
    for (const zoneName of ["front", "back", "registry", "trash"]) {
      for (const card of player[zoneName]) {
        if (card.category === "Script" && card.faceDown) continue;
        entries.push({ playerId, zoneName, card });
      }
    }
  }
  return entries;
}

export function getActivatableEffects(state, playerId, card) {
  const location = findCard(state, card.uid);
  if (!location || location.playerId !== playerId || !["hand", "front", "back"].includes(location.zoneName)) return [];
  return card.compiled.keywords
    .filter((keyword) => ["UPDATE", "PROXY"].includes(keyword.name))
    .filter((keyword) => keyword.name !== "PROXY" || ["STD-048", "STD-049", "STD-106", "STD-124", "STD-160", "STD-169"].includes(card.id))
    .filter((keyword) => keyword.name === "PROXY" ? location.zoneName === "hand" : ["front", "back"].includes(location.zoneName))
    .map((keyword, index) => ({
      id: `${card.id}:${keyword.name.toLowerCase()}:${index}`,
      kind: keyword.name.toLowerCase(),
      label: keyword.name === "UPDATE" ? `[アップデート:${keyword.value}]` : `プロキシ:${keyword.value}(コスト)`,
      cost: Number(keyword.value ?? 0),
      text: card.text,
      enabled: state.active === playerId
        && state.players[playerId].memory >= Number(keyword.value ?? 0)
        && (!cardRuntimeSpec(card.id, "update")?.requiresResidentActive || card.residentActive === true)
    }));
}

export function getEffectActivationTargets(state, playerId, card, effectId) {
  if (card.id === "STD-169" && effectId?.startsWith(`${card.id}:proxy:`)) {
    const opponent = state.players[otherPlayer(playerId)];
    return [...opponent.front, ...opponent.back].filter(isObCard);
  }
  if (card.id === "STD-049" && effectId?.startsWith(`${card.id}:proxy:`)) {
    const opponent = state.players[otherPlayer(playerId)];
    return [...opponent.front, ...opponent.back];
  }
  if (!effectId?.startsWith(`${card.id}:update:`)) return [];
  const player = state.players[playerId];
  if (card.id === "STD-192") return [...player.front, ...player.back].filter(isObCard);
  if (card.id === "STD-196") return [...player.front, ...player.back].filter(isObCard);
  if (card.id === "STD-157") return [...player.front, ...player.back].filter((item) => item.uid !== card.uid);
  return [];
}

function moveCardByEffect(state, playerId, uid, targetZone, sourceName) {
  const player = state.players[playerId];
  const sourceZone = player.front.some((card) => card.uid === uid) ? "front" : player.back.some((card) => card.uid === uid) ? "back" : null;
  if (!sourceZone || sourceZone === targetZone) return fail(state, "移動先は現在と異なるエリアを選んで。", false);
  if (!placementResult(player, targetZone).ok) return fail(state, "移動先エリアが上限。", false);
  const index = player[sourceZone].findIndex((card) => card.uid === uid);
  const [card] = player[sourceZone].splice(index, 1);
  const revealed = revealMountedCode(player[sourceZone], index, card, playerId, sourceZone);
  if (placeByMode(state, playerId, card, { zone: targetZone, mode: "normal", from: sourceZone, source: sourceName }) !== "placed") return false;
  card.sleep = false;
  card.summoningSick = targetZone === "front" && !hasKeyword(card, "QA");
  addLog(state, `${sourceName}: 「${card.name}」を${targetZone === "front" ? "フロント" : "バック"}へ効果で移動。`, "effect");
  if (revealed) addLog(state, `${card.name}の下にあった${revealed.name}は移動前のエリアに残る。`, "effect");
  triggerMoved(state, playerId, card, sourceZone, targetZone);
  return true;
}

function resolveLogout(state, playerId, card) {
  if (executeCardRuntimeSpec(state, "logout", playerId, card)) return;
}

function resolveLogoutAfterAreaExit(state, playerId, card) {
  const hasLogout = hasKeyword(card, "LOGOUT") || /(?:\[|［)ログアウト(?:\]|］)/.test(String(card.text ?? ""));
  if (!hasLogout) return false;
  state.triggerQueue.push({
    id: `AUTO-${++state.triggerSerial}`,
    source: { playerId, zoneName: "trash", card },
    event: { type: "logout", playerId, ownerId: card.owner ?? playerId, cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category },
    spec: { id: `${card.id}:logout`, actions: [] },
    runtimePhase: "logout"
  });
  if (state.effectDepth === 0) drainTriggerQueue(state);
  return true;
}

function activateCardEffectCore(state, playerId, cardUid, effectId, { targetUid = null, targetZone = null, targetUids = [] } = {}) {
  const location = findCard(state, cardUid);
  if (!location || location.playerId !== playerId || !["hand", "front", "back"].includes(location.zoneName)) return fail(state, "効果を起動するカードが使用可能な領域にない。", false);
  const card = location.card;
  const effect = getActivatableEffects(state, playerId, card).find((item) => item.id === effectId);
  if (!effect || !effect.enabled) return fail(state, "その効果は現在起動できない。", false);
  const player = state.players[playerId];

  if (effect.kind === "proxy") {
    if (location.zoneName !== "hand") return fail(state, "[プロキシ]は手札から起動する。", false);
    if (player.memory < effect.cost) return fail(state, "メモリ不足。", false);
    if (state.mode !== "lab" && card.color && !enabledSymbols(player).includes(card.color)) return fail(state, `${card.color}シンボルがない。`, false);
  }

  const updateRuntime = effect.kind === "update" ? cardRuntimeSpec(card.id, "update") : null;
  if (updateRuntime) {
    const runtime = { records: Object.assign(Object.create(null), {
      activation_target_uid: targetUid,
      activation_target_uids: targetUids,
      activation_target_zone: targetZone
    }) };
    if (!updateRuntime.actions.every((action) => runtimeActionFeasible(state, playerId, card, action, runtime))) {
      return fail(state, "効果を実行できる対象がない。", false);
    }
    player.memory -= effect.cost;
    return executeRuntimeActions(state, playerId, card, updateRuntime.actions, { runtime });
  }

  if (card.id === "STD-140" && effect.kind === "update") {
    player.memory -= effect.cost;
    const request = createSelectionRequest({ mode: "scope", scopeField: "effect", scopeOptions: ["①戦闘保護", "②聖樹をサルベージ"],
      label: `${card.name}: ①か②`, message: card.text,
      continuation: { type: "std140-update-choice", playerId, sourceName: card.name } });
    state.pending = { type: "selection", validTargets: [], request };
    return true;
  }
  if (card.id === "STD-228" && effect.kind === "update") {
    const opponentId = otherPlayer(playerId); const opponent = state.players[opponentId];
    const zones = ["front", "back"];
    player.memory -= effect.cost;
    dealFortressDamage(state, playerId, 3, playerId, card.name);
    const sourceZone = player.front.some((item) => item.uid === card.uid) ? "front" : "back";
    const sourceIndex = player[sourceZone].findIndex((item) => item.uid === card.uid);
    if (sourceIndex < 0) return false;
    const [moved] = player[sourceZone].splice(sourceIndex, 1);
    const zone = zones[Math.floor(state.rng() * zones.length)];
    if (placeByMode(state, opponentId, moved, { zone, from: sourceZone, source: card.name }) !== "placed") return true;
    emitEffectPlacement(state, opponentId, moved, zone, card.name);
    addLog(state, `${card.name}: 自分へ3ダメージ後、相手${zone}へ配置。`, "effect");
    return true;
  }
  if (card.id === "STD-237" && effect.kind === "update") {
    const zone = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
    const ids = Object.values(CARD_LIBRARY).filter((item) => isObCard(item) && !item.token && item.id !== "STD-237").map((item) => item.id);
    if (!ids.length) return fail(state, "生成候補のObがない。", false);
    player.memory -= effect.cost;
    const generated = hydrateCard(createRuntimeCard(state.runtimeContext ?? null, ids[Math.floor(state.rng() * ids.length)], playerId, ++state.tokenSerial + 23700));
    emitCardsGenerated(state, playerId, [generated], card.name);
    generated.summoningSick = !hasKeyword(generated, "QA");
    if (placeByMode(state, playerId, generated, { zone, from: "generated", source: card.name }) === "placed") {
      emitEffectPlacement(state, playerId, generated, zone, card.name);
    }
    return true;
  }
  if (card.id === "STD-157" && effect.kind === "update") {
    const target = findCard(state, targetUid);
    if (!target || target.playerId !== playerId || !["front", "back"].includes(target.zoneName) || target.card.uid === card.uid) return fail(state, "破壊する他の自分エリアカードを選んで。", false);
    player.memory -= effect.cost;
    const x = Number(target.card.cost ?? 0);
    (state.destroyLkiFollowUps ??= {})[target.card.uid] = { type: "std157", playerId, sourceName: card.name, x };
    const resolved = destroyCard(state, playerId, target.card.uid, { source: card.name });
    if (!state.pending) resumeDestroyLkiFollowUp(state, target.card.uid);
    return resolved;
  }
  if (card.id === "STD-227" && effect.kind === "update") {
    player.memory -= effect.cost;
    resolveImperialRandomInstall(state, playerId, card.name);
    return true;
  }

  if (["STD-048", "STD-049"].includes(card.id) && effect.kind === "proxy") {
    if (location.zoneName !== "hand") return fail(state, "[プロキシ]は手札から起動する。", false);
    const cost = Number(effect.cost ?? 0);
    if (player.memory < cost) return fail(state, "メモリ不足。", false);
    const opponentId = otherPlayer(playerId);
    if (card.id === "STD-049" && !getEffectActivationTargets(state, playerId, card, effectId).some((target) => target.uid === targetUid)) {
      return fail(state, "破壊する相手エリアのカードを選んで。", false);
    }
    let zoneName = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
    player.memory -= cost;
    player.hand.splice(player.hand.findIndex((item) => item.uid === card.uid), 1);
    if (card.id === "STD-048") player.deck.push(card);
    else {
      card.std049ProxyArmed = true;
      moveCardToTrash(state, playerId, card, card.name);
    }
    const calamity = hydrateCard(createRuntimeCard(state.runtimeContext ?? null, "STD-050", playerId, ++state.tokenSerial + 5000));
    calamity.summoningSick = false;
    if (placeByMode(state, playerId, calamity, { zone: zoneName, from: "generated", source: card.name }) !== "placed") {
      if (card.id === "STD-049") delete card.std049ProxyArmed;
      return true;
    }
    if (card.id === "STD-049") destroyCard(state, opponentId, targetUid, { source: card.name });
    addLog(state, `${card.name}: [プロキシ:6]で災いの明星を配置。`, "effect");
    return true;
  }

  if (card.id === "STD-124" && effect.kind === "proxy") {
    player.memory -= effect.cost;
    const sourceIndex = player.hand.findIndex((item) => item.uid === card.uid);
    const [source] = player.hand.splice(sourceIndex, 1);
    moveCardToTrash(state, playerId, source, source.name);
    const generatedCards = [];
    for (let index = 0; index < 2; index += 1) generatedCards.push(hydrateCard(createRuntimeCard(state.runtimeContext ?? null, "STD-124", playerId, ++state.tokenSerial + 1400)));
    player.hand.push(...generatedCards);
    emitCardsGenerated(state, playerId, generatedCards, card.name);
    addLog(state, `${card.name}: 手札からSp扱いで[プロキシ]を起動し、同名カード2枚を生成。元カードはゴミ箱へ。`, "effect");
    return true;
  }
  if (card.id === "STD-106" && effect.kind === "proxy") {
    let zoneName = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : null;
    if (!zoneName) zoneName = "front";
    player.memory -= effect.cost;
    const sourceIndex = player.hand.findIndex((item) => item.uid === card.uid);
    moveCardToTrash(state, playerId, player.hand.splice(sourceIndex, 1)[0], card.name);
    const junk = hydrateCard(createRuntimeCard(state.runtimeContext ?? null, "STD-078", playerId, ++state.tokenSerial + 1600));
    if (placeByMode(state, playerId, junk, { zone: zoneName, from: "generated", source: card.name }) === "placed") emitEffectPlacement(state, playerId, junk, zoneName, card.name);
    return true;
  }
  if (card.id === "STD-169" && effect.kind === "proxy") {
    const target = findCard(state, targetUid);
    if (!target || target.playerId === playerId || !["front", "back"].includes(target.zoneName) || !isObCard(target.card)) return fail(state, "相手Obを選んで。", false);
    player.memory -= effect.cost;
    const sourceIndex = player.hand.findIndex((item) => item.uid === card.uid);
    moveCardToTrash(state, playerId, player.hand.splice(sourceIndex, 1)[0], card.name);
    target.card.load = Number(target.card.load ?? 0) + 3;
    addLog(state, `${card.name}: [プロキシ:${effect.cost}]で${target.card.name}へ[負荷]3。`, "effect");
    return true;
  }
  if (card.id === "STD-160" && effect.kind === "proxy") {
    const zoneName = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
    player.memory -= effect.cost;
    const sourceIndex = player.hand.findIndex((item) => item.uid === card.uid);
    const [source] = player.hand.splice(sourceIndex, 1);
    if (placeByMode(state, playerId, source, { zone: zoneName, from: "hand", source: card.name }) !== "placed") return true;
    emitCardPlacement(state, playerId, source, zoneName, "proxy", source.name);
    destroyCard(state, playerId, source.uid, { source: `${source.name}の[プロキシ]`, suppressReplacement: true });
    const candidates = player.deck.filter((item) => item.category === "Script" && item.name.includes("旧支配者"));
    if (candidates.length) {
      const request = createSelectionRequest({ mode: "single", candidates: candidates.map((item) => item.uid), count: 1,
        candidateLabels: Object.fromEntries(candidates.map((item) => [item.uid, item.name])), label: "旧支配者Scriptへアクセス", message: card.text,
        continuation: { type: "access-to-deck-top", playerId, sourceName: card.name } });
      state.pending = { type: "selection", validTargets: request.candidates, request };
    }
    return true;
  }

  return fail(state, `${effect.label}は解析済みだが専用処理が未登録。`, false);
}

export function activateCardEffect(state, playerId, cardUid, effectId, options = {}) {
  normalizeBoardSlots(state);
  return resolveEffect(state, () => activateCardEffectCore(state, playerId, cardUid, effectId, options));
}

export function getLayeredCandidates(state, _playerId, card) {
  return layeredCandidates(state, _playerId, card);
}

export function getLayeredRequirement(card) {
  const rule = layeredSpecFor(card);
  return { minimum: rule?.minimum ?? Number.POSITIVE_INFINITY, label: rule?.label ?? "未対応のレイヤード条件" };
}

export function canPlayLayeredCard(state, playerId, uid, materialUids, zone = "front", requestedSlot = null) {
  const player = state.players[playerId];
  const handIndex = player.hand.findIndex((card) => card.uid === uid);
  if (handIndex < 0) return { ok: false, reason: "レイヤードするカードが手札にない。" };
  const card = player.hand[handIndex];
  if (!hasKeyword(card, "LAYERED")) return { ok: false, reason: "[レイヤード]を持つカードを選んで。" };
  const rule = layeredSpecFor(card);
  if (!rule) return { ok: false, reason: "未対応のレイヤード条件。" };
  const uniqueUids = [...new Set(materialUids)];
  const eligible = getLayeredCandidates(state, playerId, card);
  const selected = uniqueUids.map((targetUid) => eligible.find((entry) => entry.card.uid === targetUid)).filter(Boolean);
  if (selected.length !== uniqueUids.length || !validatesLayeredSelection(card, playerId, selected)) return { ok: false, reason: `レイヤード条件不足：${rule.label}` };
  if (requestedSlot !== null) {
    const projected = { ...state, players: { ...state.players, [playerId]: { ...player, [zone]: player[zone].filter(item => !uniqueUids.includes(item.uid)) } } };
    const slotCheck = requestedExecutionSlot(projected, playerId, card, { zone, requestedSlot });
    if (!slotCheck.ok) return slotCheck;
  }
  const ownSlotsFreed = selected.filter((entry) => entry.playerId === playerId && entry.zoneName === zone).length;
  if (!placementResult(player, zone, { addedSlots: 1, freedSlots: ownSlotsFreed }).ok) return { ok: false, reason: `${zone === "front" ? "フロント" : "バック"}上限。` };
  const overrideDiscount = hasKeyword(card, "OVERRIDE") ? Math.max(0, ...selected.map((entry) => Number(entry.card.cost ?? 0))) : 0;
  const effectiveCost = Math.max(0, executionCost(card, state, playerId) - overrideDiscount);
  const check = canPlayCard(state, playerId, card, { zone, freedSlots: ownSlotsFreed, free: hasKeyword(card, "OVERRIDE") });
  if (!check.ok) return check;
  if (player.memory < effectiveCost) return { ok: false, reason: "メモリ不足。" };
  return { ok: true, selected, ownSlotsFreed, overrideDiscount, effectiveCost };
}

export function playLayeredCard(state, playerId, uid, materialUids, zone = "front", { requestedSlot = null } = {}) {
  const check = canPlayLayeredCard(state, playerId, uid, materialUids, zone, requestedSlot);
  if (!check.ok) return fail(state, check.reason, false);
  normalizeBoardSlots(state);
  const { selected, ownSlotsFreed, overrideDiscount, effectiveCost } = check;
  const player = state.players[playerId], card = player.hand.find(item => item.uid === uid);

  const materials = [];
  for (const entry of selected) {
    const sourceZone = state.players[entry.playerId][entry.zoneName];
    const index = sourceZone.findIndex((candidate) => candidate.uid === entry.card.uid);
    if (index < 0) continue;
    const [material] = sourceZone.splice(index, 1);
    materials.push(...flattenMaterialStack(material));
  }
  const executionHandIndex = player.hand.findIndex((candidate) => candidate.uid === uid);
  if (executionHandIndex < 0) return fail(state, "レイヤード実行カードが手札から失われた。", false);
  player.hand.splice(executionHandIndex, 1);
  player.memory -= effectiveCost;
  card.mounted = materials;
  card.sleep = false;
  card.damage = 0;
  card.summoningSick = !hasKeyword(card, "QA");
  placeByMode(state, playerId, card, { zone, mode: "normal", from: "hand", addedSlots: 1, freedSlots: ownSlotsFreed, requestedSlot });
  addLog(state, `${card.name}を${materials.length}枚の公開カードでレイヤード実行。実行メモリ${effectiveCost}${overrideDiscount ? `（オーバーライド-${overrideDiscount}）` : ""}。`, "action");
  resolveEffect(state, () => resolveLogin(state, playerId, card));
  notifyCardExecuted(state, playerId, card);
  return true;
}

export function resolveSamLogin(state, playerId, discardUid) {
  const player = state.players[playerId];
  const sourceUid = state.pending?.request?.continuation?.sourceUid;
  const source = sourceUid ? findCard(state, sourceUid)?.card : null;
  const index = player.hand.findIndex((card) => card.uid === discardUid
    && (source?.id === "STD-077" ? hasClass(card, "レッドパンクス") : card.color === "赤"));
  if (index < 0) return fail(state, "サムの効果で捨てる赤カードを選んで。", false);
  const [discarded] = player.hand.splice(index, 1);
  moveCardToTrash(state, playerId, discarded, "サムの効果コスト");
  drawCards(state, playerId, 2);
  state.pending = null;
  addLog(state, `ジャンカー・サム: ${discarded.name}を捨て、2枚ドロー。`, "effect");
  provisional(state, "レッドパンクス分類データが未整備のため、サムの手札コストは赤カード全般を選択可能。", CARD_LIBRARY["STD-077"]);
  return true;
}

export function cardAtk(state, playerId, card) {
  let value = Number(card.atk ?? 0) + Number(card.tempAtk ?? 0) + Number(card.permanentAtk ?? 0) - Number(card.load ?? 0);
  value += (card.timedModifiers ?? []).filter((item) => state.turnNumber <= item.expiresAfterTurn).reduce((sum, item) => sum + Number(item.atk ?? 0), 0);
  value += mountedStatModifierValue(card, "atk");
  if (card.id === "STD-227") {
    const colors = new Set(Object.values(state.players).flatMap((player) => player.registry.map((item) => item.color).filter(Boolean)));
    value += colors.size;
  }
  value += continuousStatModifierValue(state, playerId, card, "atk");
  const player = state.players[playerId];
  if (player.user.abilityKey === "mono_color" && isObCard(card) && enabledSymbols(player).length === 1) value += 1;
  return value;
}

export function cardMaxStr(_state, _playerId, card) {
  let value = Number(card.str ?? 0) + Number(card.tempStr ?? 0) + Number(card.permanentStr ?? 0) + Number(card.battleStrBonus ?? 0) - Number(card.load ?? 0);
  value += (card.timedModifiers ?? []).filter((item) => _state.turnNumber <= item.expiresAfterTurn).reduce((sum, item) => sum + Number(item.str ?? 0), 0);
  value += mountedStatModifierValue(card, "str");
  value += continuousStatModifierValue(_state, _playerId, card, "str");
  return value;
}

export function cardCurrentStr(state, playerId, card) {
  return cardMaxStr(state, playerId, card) - card.damage;
}

function cardHasPrintedOrGrantedKeyword(card, name) {
  if (hasKeyword(card, name)) return true;
  if ((card.timedModifiers ?? []).some((item) => item.keyword === name)) return true;
  return card.mounted?.some((provider) => mountedKeywordSpecsFor(provider.id).some((spec) =>
    spec.keyword === name && (!spec.consumedFlag || !provider[spec.consumedFlag])
  )) ?? false;
}

export function cardHasKeyword(cardOrState, nameOrPlayerId, maybeCard = null, maybeName = null) {
  if (maybeCard && maybeName) return cardHasRuntimeKeyword(cardOrState, nameOrPlayerId, maybeCard, maybeName);
  return cardHasPrintedOrGrantedKeyword(cardOrState, nameOrPlayerId);
}

function cardHasRuntimeKeyword(state, playerId, card, name) {
  if (cardHasPrintedOrGrantedKeyword(card, name)) return true;
  if ((card.timedModifiers ?? []).some((item) => item.keyword === name && state.turnNumber <= item.expiresAfterTurn)) return true;
  if (conditionalKeywordSpecsFor(card.id).some((spec) =>
    spec.keywords.includes(name) && continuousEffectConditionMatches(state, playerId, card, spec.condition)
  )) return true;
  const player = state.players[playerId];
  for (const [zone, providers] of Object.entries({ front: player.front, back: player.back })) {
    for (const provider of providers.filter((item) => !item.faceDown)) {
      for (const spec of auraKeywordSpecsFor(provider.id)) {
        if (spec.keyword !== name || (spec.providerZone !== "area" && spec.providerZone !== zone)) continue;
        if (spec.target === "source" && provider.uid === card.uid) return true;
        if (spec.target === "own_class_ob_all" && isObCard(card) && hasClass(card, spec.className)) return true;
        if (spec.target === "own_color_ob_all" && isObCard(card) && card.color === spec.color) return true;
      }
    }
  }
  return name === "CONTACT" && card.name === "ドールズ" && activeCards(state, playerId, "STD-198").length > 0;
}

export function getAttackTargets(state, attackerPlayerId, attacker) {
  const opponentId = otherPlayer(attackerPlayerId);
  const opponent = state.players[opponentId];
  const attackable = opponent.front.filter((card) => !cardHasRuntimeKeyword(state, opponentId, card, "ENCRYPTION"));
  const securities = attackable.filter((card) => card.sleep && cardHasKeyword(card, "SECURITY"));
  if (securities.length && !cardHasRuntimeKeyword(state, attackerPlayerId, attacker, "HACKING")) return securities.map((card) => ({ type: "card", uid: card.uid, label: card.name }));
  const sleeping = attackable.filter((card) => card.sleep);
  if (attacker?.summoningSick && cardHasRuntimeKeyword(state, attackerPlayerId, attacker, "CONTACT")) {
    return sleeping.map((card) => ({ type: "card", uid: card.uid, label: card.name }));
  }
  if (attackPermissionSpecsFor(attacker?.id).some((spec) => spec.type === "restrict_targets" && spec.rule === "ob_if_possible") && sleeping.length) {
    return sleeping.map((card) => ({ type: "card", uid: card.uid, label: card.name }));
  }
  return [
    ...(attackPermissionSpecsFor(attacker?.id).some((spec) => spec.type === "forbid_target"
      && spec.target === "enemy_user" && spec.condition === "source_registry_executed_this_turn")
      && attacker.std220RegistryExecutedTurn === state.turnNumber ? [] : [{ type: "fortress", uid: `${opponentId}-fortress`, label: opponent.user.name }]),
    ...sleeping.map((card) => ({ type: "card", uid: card.uid, label: card.name }))
  ];
}

export function canAttack(state, playerId, card) {
  if (state.active !== playerId) return false;
  if (!isObCard(card) || card.sleep) return false;
  if (attackPermissionSpecsFor(card.id).some((spec) => spec.type === "require_attack_condition"
    && spec.condition === "own_script_activated_this_turn") && state.players[playerId].scriptActivatedTurn !== state.turnNumber) return false;
  if (hasKeyword(card, "ACCESS_RESTRICTION")) return false;
  if (card.summoningSick && !cardHasRuntimeKeyword(state, playerId, card, "CONTACT") && !cardHasRuntimeKeyword(state, playerId, card, "QA")) return false;
  if (card.summoningSick && cardHasRuntimeKeyword(state, playerId, card, "CONTACT") && getAttackTargets(state, playerId, card).length === 0) return false;
  return true;
}

export function resolveLuckyShotAdditional(state, playerId, targetUid) {
  const continuation = state.pending?.request?.continuation;
  if (continuation?.type === "runtime-action-selection" && continuation.sourceId === "STD-086") {
    return resolveCardSelection(state, continuation, { selected: [targetUid] });
  }
  const source = state.deferredSpellCleanup?.card?.id === "STD-086"
    ? state.deferredSpellCleanup.card
    : { ...CARD_LIBRARY["STD-086"], uid: "STD-086-legacy-compat" };
  const selection = cardRuntimeSpec("STD-086", "spell")?.actions?.find((action) => action.type === "select");
  if (!selection) return false;
  state.pending = null;
  return runEffectEntry(state, "lucky-shot-additional", playerId, () => executeRuntimeActions(
    state,
    playerId,
    source,
    selection.afterActions,
    { targetUid, targetUids: [targetUid], runtime: { records: Object.create(null) } }
  ));
}

function revealUnderlyingCard(zone, index, topCard, controllerId, zoneName) {
  const [baseCard, ...deeperLayers] = topCard.mounted.splice(0);
  if (!baseCard) return null;
  baseCard.mounted.push(...deeperLayers);
  inheritBoardSlot(baseCard, topCard, { controllerId, zoneName });
  zone.splice(index, 0, baseCard);
  return baseCard;
}

// Layered materials follow layer 1. A Code mounted by ordinary execution
// stays in its original square, even when the upper card leaves that area.
function revealMountedCode(zone, index, topCard, controllerId, zoneName) {
  if (!Array.isArray(topCard.mounted) || !topCard.mounted.length) return null;
  normalizeMountedStack(topCard);
  const mountedCode = topCard.mounted.filter((layer) => layer.layerRole !== "layered");
  topCard.mounted = topCard.mounted.filter((layer) => layer.layerRole === "layered");
  if (!mountedCode.length) return null;
  return revealUnderlyingCard(zone, index, { ...topCard, mounted: mountedCode }, controllerId, zoneName);
}

function distributeLayeredFollowers(state, topCard, destination, source) {
  if (!Array.isArray(topCard.mounted) || !topCard.mounted.length) return;
  normalizeMountedStack(topCard);
  const followers = topCard.mounted.filter((layer) => layer.layerRole === "layered");
  topCard.mounted = topCard.mounted.filter((layer) => layer.layerRole !== "layered");
  for (const layer of followers) {
    const zone = destination === "trash" && layer.temporaryLayer ? "ban" : destination;
    state.players[layer.owner ?? topCard.owner][zone].push(layer);
    addLog(state, `${source}: ${layer.name}もレイヤー1と同じ${zone === "trash" ? "ゴミ箱" : zone === "ban" ? "BAN" : zone === "hand" ? "手札" : "レジストリ"}へ移動。`, "effect");
  }
}

function createVengeanceCard(state, cardId, ownerId) {
  return hydrateCard(createRuntimeCard(state.runtimeContext ?? null, cardId, ownerId, ++state.tokenSerial + 800));
}

function triggerMoved(state, playerId, card, sourceZone, targetZone) {
  addLog(state, `${card.name}が${sourceZone}から${targetZone}へ移動。`, "system");
  emitGameEvent(state, {
    type: "card_moved",
    playerId,
    ownerId: card.owner ?? playerId,
    cardUid: card.uid,
    cardId: card.id,
    cardName: card.name,
    category: card.category,
    from: sourceZone,
    to: targetZone
  });
}

function queuePostAttackSelection(state, playerId, attacker, defenderUid = null) {
  const player = state.players[playerId];
  if (attacker.id === "STD-136") {
    const candidates = [...player.front, ...player.back].filter((card) => isObCard(card) && card.uid !== attacker.uid);
    if (candidates.length) {
      const request = createSelectionRequest({
        mode: "up_to", candidates: candidates.map((card) => card.uid), count: 1, maximum: 1,
        label: "破壊する他の自分Obを0～1体選択", message: "選んだ場合、このカードをスタンバイする。",
        continuation: { type: "hahanamori-standby", playerId, sourceUid: attacker.uid, defenderUid }
      });
      state.pending = { type: "selection", validTargets: request.candidates, request };
    }
  }
}

function resolveTrinityEffect(state, activePlayerId, sourceName) {
  const active = state.players[activePlayerId];
  if (active.hand.length >= 3) for (const card of active.hand.splice(0, 3)) moveCardToTrash(state, activePlayerId, card, sourceName);
  else dealFortressDamage(state, activePlayerId, 3, otherPlayer(activePlayerId), sourceName);
  drawCards(state, activePlayerId, 2);
  addLog(state, `${sourceName}: アクティブユーザーが手札3枚を捨てるか3ダメージ、その後2枚ドロー。`, "effect");
}

export function relogCard(state, playerId, uid, targetZone, { useLayerDiscount = null, layerUid = null, requestedSlot = null } = {}) {
  normalizeBoardSlots(state);
  const player = state.players[playerId];
  if (state.active !== playerId) return fail(state, "再実行は自分ターン中だけ。", false);
  if (!["front", "back"].includes(targetZone)) return fail(state, "再実行先が不正。", false);
  const sourceZone = targetZone === "front" ? "back" : "front";
  const index = player[sourceZone].findIndex((card) => card.uid === uid);
  if (index < 0) return fail(state, "反対側エリアのカードを選んで。", false);
  const card = player[sourceZone][index];
  const preparationKind = relogPreparationKind(card);
  if (requestedSlot !== null && !requestedExecutionSlot(state, playerId, card, { zone: targetZone, requestedSlot }).ok) return false;
  if (preparationKind === "registry") {
    const moveCost = Number(card.cost ?? 0);
    if (player.memory < moveCost) return fail(state, "再実行するメモリが足りない。", false);
    player.memory -= moveCost;
    player[sourceZone].splice(index, 1);
    const revealed = revealMountedCode(player[sourceZone], index, card, playerId, sourceZone);
    player.registry.push(card);
    distributeLayeredFollowers(state, card, "registry", card.name);
    card.sleep = false;
    card.summoningSick = false;
    emitRegistryInstalled(state, playerId, card, card.name);
    addLog(state, `${card.name}: [ログアウト]でレジストリへインストール。`, "effect");
    if (revealed) addLog(state, `${card.name}の下にあった${revealed.name}は場に残る。`, "effect");
    return true;
  }
  if (player[targetZone].length >= player.user[`${targetZone}Limit`]) return fail(state, `${targetZone === "front" ? "フロント" : "バック"}上限。`, false);
  if (preparationKind === "payment-choice" && useLayerDiscount === null) {
    const regularCost = Number(card.cost ?? 0);
    const options = player.memory >= regularCost
      ? ["通常コストを払う", "レイヤー1枚を破棄して1メモリ"]
      : ["レイヤー1枚を破棄して1メモリ"];
    const request = createSelectionRequest({
      mode: "scope", scopeField: "moveCost", scopeOptions: options,
      label: "移動コストの支払い方を選択", message: card.text,
      continuation: { type: "relog-layer-discount", playerId, sourceUid: uid, targetZone, requestedSlot }
    });
    state.pending = { type: "selection", validTargets: [], request };
    return true;
  }
  let moveCost = Number(card.cost ?? 0);
  let discountedLayer = null;
  if (preparationKind === "payment-choice" && useLayerDiscount === true) {
    normalizeMountedStack(card);
    moveCost = 1;
    discountedLayer = card.mounted.find((layer) => layer.uid === layerUid) ?? null;
    if (!discountedLayer) return fail(state, "移動コストに使うレイヤーを1枚選んで。", false);
  }
  if (player.memory < moveCost) {
    return fail(state, "再実行するメモリが足りない。", false);
  }

  player.memory -= moveCost;
  if (discountedLayer) {
    const consumed = consumeSelectedSourceLayers(state, playerId, card, [discountedLayer.uid], `${card.name}の移動コスト`);
    if (!consumed) return false;
    addLog(state, `${card.name}: 選んだレイヤーを破棄し、移動コストを1に変更。`, "effect");
  }
  player[sourceZone].splice(index, 1);
  const revealed = revealMountedCode(player[sourceZone], index, card, playerId, sourceZone);
  if (placeByMode(state, playerId, card, { zone: targetZone, mode: "normal", from: sourceZone, source: "再実行", requestedSlot }) !== "placed") return false;
  card.sleep = false;
  card.attackedThisTurn = false;
  card.summoningSick = targetZone === "front" && !hasKeyword(card, "QA");
  addLog(state, `${player.user.name}が「${card.name}」を${targetZone === "front" ? "フロント" : "バック"}へ再実行。メモリ${moveCost}支払い。`, "action");
  if (revealed) addLog(state, `${card.name}の下にあった${revealed.name}は${sourceZone === "front" ? "フロント" : "バック"}に残る。`, "effect");
  if (hasKeyword(card, "LOGIN")) resolveEffect(state, () => resolveLogin(state, playerId, card));
  const hasLogout = hasKeyword(card, "LOGOUT") || /(?:\[|［)ログアウト(?:\]|］)/.test(String(card.text ?? ""));
  if (hasLogout) resolveEffect(state, () => resolveLogout(state, playerId, card));
  if (hasLogout && card.compiled?.selectionModules?.some((module) => module.module === "select_allocate_follow_up")) {
    resolveEffect(state, () => beginAllocationSelectionModule(state, playerId, card));
  }
  triggerMoved(state, playerId, card, sourceZone, targetZone);
  return true;
}

export function attack(state, playerId, attackerUid, targetUid) {
  normalizeBoardSlots(state);
  if (state.winner || state.pending || state.prompt) return false;
  const player = state.players[playerId];
  const attacker = player.front.find((card) => card.uid === attackerUid);
  if (!attacker || !canAttack(state, playerId, attacker)) return fail(state, "そのObは攻撃できない。", false);
  return runEffectEntry(state, "attack", playerId, () => attackCore(state, playerId, attackerUid, targetUid));
}

function attackCore(state, playerId, attackerUid, targetUid) {
  const player = state.players[playerId];
  const attacker = player.front.find((card) => card.uid === attackerUid);
  if (attacker.id === "STD-214" && !attacker.skipStd214AttackCost) {
    const candidates = player.registry.filter((card) => !card.faceDown);
    if (!candidates.length) { addLog(state, `${attacker.name}: レジストリから回収できず攻撃失敗。`, "effect"); return true; }
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])), label: `${attacker.name}: 攻撃宣言時の回収`, message: attacker.text,
      continuation: { type: "std214-attack-cost", playerId, attackerUid, targetUid } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  delete attacker.skipStd214AttackCost;
  if (!attacker.skipStd230Ambush && state.mode !== "lab") {
    const defenderId = otherPlayer(playerId); const defender = state.players[defenderId];
    const ambush = defender.registry.find((card) => card.id === "STD-230" && !card.faceDown
      && defender.memory >= 3 && defender.registry.length >= Number(card.cost ?? 0));
    if (ambush) {
      const request = createSelectionRequest({ mode: "scope", scopeField: "ambush", scopeOptions: ["起動しない", "[アンブッシュ:3]を起動"],
        label: `${ambush.name}: 攻撃宣言`, message: ambush.text,
        continuation: { type: "std230-ambush-choice", playerId: defenderId, sourceUid: ambush.uid, sourceName: ambush.name, attackerPlayerId: playerId, attackerUid, targetUid } });
      state.pending = { type: "selection", validTargets: [], request };
      return true;
    }
  }
  delete attacker.skipStd230Ambush;
  if (attacker.id === "STD-085" && attacker.mounted.length && !attacker.skipStd085LayerCost) {
    return beginSourceLayerSelection(state, playerId, attacker, 1, {
      type: "std085-layer-pay", playerId, sourceUid: attacker.uid,
      attackerPlayerId: playerId, attackerUid: attacker.uid, targetUid
    });
  }
  delete attacker.skipStd085LayerCost;
  for (const owner of Object.values(state.players)) {
    const trinity = owner.back.find((card) => card.id === "STD-121" && card.residentActive && !owner.scriptUsage[`${card.uid}:attack`]);
    if (trinity) {
      owner.scriptUsage[`${trinity.uid}:attack`] = true;
      resolveTrinityEffect(state, playerId, trinity.name);
    }
  }
  if (attacker.id === "STD-182" && !attacker.skipStd182AttackEffect) {
    const candidates = player.back.filter((script) => script.category === "Script" && script.faceDown
      && !keywordValue(script, "IF") && !hasOptionalActivationSpec(script.id)
      && Number(script.activationCost ?? script.cost ?? Infinity) <= 2
      && player.memory >= Number(script.activationCost ?? script.cost ?? 0));
    if (candidates.length) {
      const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((script) => script.uid), minimum: 0, maximum: 1,
        candidateLabels: Object.fromEntries(candidates.map((script) => [script.uid, `${script.name} / 起動${script.activationCost ?? script.cost}`])),
        label: `${attacker.name}: 攻撃時にScriptを起動`, message: attacker.text,
        continuation: { type: "std182-attack-script", playerId, attackerUid: attacker.uid, targetUid } });
      state.pending = { type: "selection", validTargets: request.candidates, request };
      return true;
    }
  }
  delete attacker.skipStd182AttackEffect;
  const resumeStage = state.attackResumeStage;
  const targets = getAttackTargets(state, playerId, attacker);
  let target = resumeStage && targetUid === `${otherPlayer(playerId)}-fortress`
    ? { type: "fortress", uid: targetUid, label: state.players[otherPlayer(playerId)].user.name }
    : targets.find((item) => item.uid === targetUid);
  if (!target) {
    target = targets[0];
    addLog(state, `セキュリティまたは攻撃制約により対象を「${target.label}」へ変更。`, "effect");
  }
  if (cardTraits(attacker).includes("インセクト") && !attacker.skipStd185AttackerSubstitution) {
    const general = player.front.find((card) => card.id === "STD-185" && !card.sleep && card.uid !== attacker.uid);
    if (general) {
      const request = createSelectionRequest({ mode: "scope", scopeField: "substitute", scopeOptions: ["交代しない", "クワガタ将軍と戦闘"],
        label: `${general.name}: 戦闘交代`, message: general.text,
        continuation: { type: "std185-attacker-substitute", playerId, attackerUid: attacker.uid, targetUid: target.uid, generalUid: general.uid } });
      state.pending = { type: "selection", validTargets: [], request };
      return true;
    }
  }
  delete attacker.skipStd185AttackerSubstitution;
  if (target?.type === "card" && !attacker.skipStd185Substitution) {
    const defenderId = otherPlayer(playerId);
    const defender = state.players[defenderId].front.find((card) => card.uid === target.uid);
    const general = state.players[defenderId].front.find((card) => card.id === "STD-185" && !card.sleep && card.uid !== defender?.uid);
    if (defender && cardTraits(defender).includes("インセクト") && general) {
      const request = createSelectionRequest({ mode: "scope", scopeField: "substitute", scopeOptions: ["交代しない", "クワガタ将軍と戦闘"],
        label: `${general.name}: 戦闘交代`, message: general.text,
        continuation: { type: "std185-defender-substitute", playerId: defenderId, attackerPlayerId: playerId, attackerUid, originalTargetUid: target.uid, generalUid: general.uid } });
      state.pending = { type: "selection", validTargets: [], request };
      return true;
    }
  }
  delete attacker.skipStd185Substitution;
  if (attacker.id === "STD-106" && !attacker.resolvingStd106Attack) {
    attacker.resolvingStd106Attack = true;
    for (let index = 0; index < 2; index += 1) {
      const zoneName = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
      const junk = hydrateCard(createRuntimeCard(state.runtimeContext ?? null, "STD-078", playerId, ++state.tokenSerial + 1600));
      if (placeByMode(state, playerId, junk, { zone: zoneName, from: "generated", source: attacker.name }) === "placed") emitEffectPlacement(state, playerId, junk, zoneName, attacker.name);
    }
  }
  if (!attacker.skipStd223Ambush) {
    const defenderId = otherPlayer(playerId);
    const defender = state.players[defenderId];
    const ambush = defender.registry.find((card) => card.id === "STD-223" && !card.faceDown
      && defender.memory >= 2
      && defender.registry.some((other) => other.uid !== card.uid && Number(other.cost ?? 0) >= Number(card.cost ?? 0)));
    const obTargets = Object.values(state.players).flatMap((current) => [...current.front, ...current.back]).filter(isObCard);
    if (ambush && obTargets.length) {
      const request = createSelectionRequest({ mode: "scope", scopeField: "ambush", scopeOptions: ["起動しない", "[アンブッシュ:2]を起動"],
        label: `${ambush.name}: 相手Obの攻撃宣言`, message: ambush.text,
        continuation: { type: "std223-ambush-choice", playerId: defenderId, sourceUid: ambush.uid, sourceName: ambush.name,
          attackerPlayerId: playerId, attackerUid: attacker.uid, attackTargetUid: target.uid } });
      state.pending = { type: "selection", validTargets: [], request };
      return true;
    }
  }
  delete attacker.skipStd223Ambush;
  if (attacker.id === "STD-227" && !attacker.resolvingStd227Attack && cardAtk(state, playerId, attacker) >= 7) {
    attacker.resolvingStd227Attack = true;
    const opponentId = otherPlayer(playerId);
    const victims = [...state.players[opponentId].front];
    let generated = 0;
    for (const victim of victims) {
      if (!destroyCard(state, opponentId, victim.uid, { source: attacker.name })) continue;
      const proof = createVengeanceCard(state, "STD-228", opponentId);
      proof.summoningSick = true;
      if (placeByMode(state, opponentId, proof, { zone: "front", from: "generated", source: attacker.name }) === "placed") { emitEffectPlacement(state, playerId, proof, "front", attacker.name); generated += 1; }
    }
    addLog(state, `${attacker.name}: 相手フロント${victims.length}枚を破壊し、「征服の証」を${generated}枚配置。`, "effect");
  }
  if (["STD-096", "STD-102", "STD-238"].includes(attacker.id) && flattenedLayerCount(attacker) >= (attacker.id === "STD-238" ? 2 : 1) && !attacker.skipQ3LayerAttackChoice) {
    normalizeMountedStack(attacker);
    if (attacker.id === "STD-102") {
      normalizeMountedStack(attacker);
      const hasFeasibleLayer = attacker.mounted.some((layer) => {
        const candidates = [...player.trash, ...(isObCard(layer) || layer.category === "Code" ? [layer] : [])]
          .filter((card, index, cards) => (isObCard(card) || card.category === "Code") && cards.findIndex((item) => item.uid === card.uid) === index);
        const feasibility = createSelectionRequest({ mode: "up_to", candidates: candidates.map((card) => card.uid), minimum: 1, maximum: candidates.length,
          exactBudget: 2, candidateValues: Object.fromEntries(candidates.map((card) => [card.uid, Number(card.cost ?? 0)])) });
        return isSelectionRequestFeasible(feasibility);
      });
      if (!hasFeasibleLayer) attacker.skipQ3LayerAttackChoice = true;
    }
    if (!attacker.skipQ3LayerAttackChoice) {
      const layerCost = attacker.id === "STD-238" ? 2 : 1;
      const request = createSelectionRequest({ mode: "scope", scopeField: "layerAttack", scopeOptions: ["起動しない", `レイヤー${layerCost}枚を破棄して起動`],
        label: `${attacker.name}の攻撃時効果`, message: attacker.text,
        continuation: { type: "q3-layer-attack-choice", playerId, sourceUid: attacker.uid, targetUid: target.uid } });
      state.pending = { type: "selection", validTargets: [], request };
      return true;
    }
  }
  delete attacker.skipQ3LayerAttackChoice;
  if (target.type !== "fortress") {
    const defender = state.players[otherPlayer(playerId)].front.find((card) => card.uid === target.uid);
    const source = [attacker, defender].find((card) => card?.id === "STD-097" && flattenedLayerCount(card) && !card.skipStd097BattleChoice);
    if (source) {
      const sourceOwnerId = findCard(state, source.uid)?.playerId ?? playerId;
      const request = createSelectionRequest({ mode: "scope", scopeField: "battleLayer", scopeOptions: ["起動しない", "レイヤー1枚を破棄して①を起動"],
        label: `${source.name}の戦闘時効果`, message: source.text,
        continuation: { type: "std097-battle-choice", playerId: sourceOwnerId, sourceUid: source.uid, attackerPlayerId: playerId, attackerUid: attacker.uid, targetUid: target.uid } });
      state.pending = { type: "selection", validTargets: [], request };
      return true;
    }
  }
  if (!attacker.skipDynamicSelectionAttackEffect && attacker.compiled?.selectionModules?.some((module) => module.module === "dynamic_threshold_selection")) {
    if (beginDynamicSelectionModule(state, playerId, attacker, { resumeAttack: true, targetUid: target.uid })) return true;
  }
  delete attacker.skipDynamicSelectionAttackEffect;
  const attackRuntime = cardRuntimeSpec(attacker.id, "attack_declared");
  if (attackRuntime && !attacker.skipRuntimeAttackEffect) {
    const opened = executeRuntimeActions(state, playerId, attacker, attackRuntime.actions, {
      targetUid: target.uid,
      continuationMeta: {
        resumeAttack: true, attackerUid: attacker.uid, targetUid: target.uid,
        settleMissingTargetAsCompleted: Boolean(attackRuntime.settleMissingTargetAsCompleted)
      }
    });
    if (opened && state.pending) return true;
  }
  delete attacker.skipRuntimeAttackEffect;
  if (!resumeStage) {
    emitGameEvent(state, { type: "attack_declared", playerId, ownerId: attacker.owner ?? playerId,
      cardUid: attacker.uid, cardId: attacker.id, cardName: attacker.name, category: attacker.category,
      attackerUid: attacker.uid, targetUid: target.uid,
      attackerKeywords: hasKeyword(attacker, "HACKING") ? ["HACKING"] : [] });
    if (state.prompt) {
      state.deferredAttack = { stage: "after-declare", playerId, attackerUid: attacker.uid, targetUid: target.uid };
      return true;
    }
  }
  setCardSleeping(state, playerId, attacker);
  attacker.attackedThisTurn = true;
  if (target.type !== "fortress") attacker.attackedObThisTurn = true;
  const opponentId = otherPlayer(playerId);
  if (target.type === "fortress") {
    const attackValue = cardAtk(state, playerId, attacker) + (attacker.id === "STD-095" ? flattenedLayerCount(attacker) : 0);
    dealFortressDamage(state, opponentId, attackValue, playerId, attacker.name, { kind: "attack" });
    if (attacker.assaultProgramTurn === state.turnNumber) {
      drawCards(state, playerId, 1);
      dealFortressDamage(state, opponentId, 1, playerId, "/アサルトプログラム/*");
    }
    queuePostAttackSelection(state, playerId, attacker);
    delete attacker.resolvingStd106Attack;
    delete attacker.resolvingStd227Attack;
    return true;
  }

  const defender = state.players[opponentId].front.find((card) => card.uid === target.uid);
  if (!defender) {
    delete attacker.resolvingStd106Attack;
    delete attacker.resolvingStd227Attack;
    addLog(state, `${attacker.name}が${target.label}を攻撃。攻撃時効果で対象が消えたため戦闘を行わない。`, "effect", { actor: playerId, cardId: attacker.id });
    return true;
  }
  if (resumeStage !== "after-battle") {
    const attackedRuntime = cardRuntimeSpec(defender.id, "attacked");
    if (attackedRuntime) executeRuntimeActions(state, opponentId, defender, attackedRuntime.actions, { targetUid: attacker.uid });
    if (!findCard(state, attacker.uid) || !findCard(state, defender.uid)) {
      delete attacker.resolvingStd106Attack;
      delete attacker.resolvingStd227Attack;
      addLog(state, `${attacker.name}が${defender.name}を攻撃。戦闘開始前効果で対象が消えたため戦闘を行わない。`, "effect", { actor: playerId, cardId: attacker.id });
      return true;
    }
    emitGameEvent(state, { type: "battle_started", playerId, ownerId: attacker.owner ?? playerId,
      cardUid: attacker.uid, cardId: attacker.id, cardName: attacker.name, category: attacker.category,
      attackerUid: attacker.uid, defenderUid: defender.uid, defenderOwnerId: opponentId });
    if (state.prompt) {
      attacker.sleep = false;
      attacker.attackedThisTurn = false;
      state.deferredAttack = { stage: "after-battle", playerId, attackerUid: attacker.uid, targetUid: target.uid };
      return true;
    }
  }
  for (const [ownerId, battler] of [[playerId, attacker], [opponentId, defender]]) {
    if (!battler || state.active === ownerId) continue;
    for (const source of state.players[ownerId].back.filter((card) => card.id === "STD-148" && card.residentActive && card.std148ArmedTurn === state.turnNumber)) {
      dealFortressDamage(state, otherPlayer(ownerId), 1, ownerId, source.name);
    }
  }
  const attackerDisconnect = hasKeyword(attacker, "DISCONNECT");
  const defenderDisconnect = hasKeyword(defender, "DISCONNECT");
  const std095AttackBonus = attacker.id === "STD-095" ? flattenedLayerCount(attacker) : 0;
  attacker.battleStrBonus = battleStatModifierValue(state, playerId, attacker, "str");
  defender.battleStrBonus = battleStatModifierValue(state, opponentId, defender, "str");
  const attackerStrBefore = cardCurrentStr(state, playerId, attacker);
  const defenderStrBefore = cardCurrentStr(state, opponentId, defender);
  let attackerDamage = applyDamageModifiers(state, playerId, attacker, opponentId, cardAtk(state, playerId, attacker) + std095AttackBonus, { kind: "battle", destination: "card", victimCard: defender });
  let defenderDamage = applyDamageModifiers(state, opponentId, defender, playerId, cardAtk(state, opponentId, defender), { kind: "battle", destination: "card", victimCard: attacker });
  const attackerProtected = defenderDamage > 0 && consumeProtect(state, attacker, "戦闘ダメージ");
  const defenderProtected = attackerDamage > 0 && consumeProtect(state, defender, "戦闘ダメージ");
  if (!attackerProtected) attacker.damage += defenderDamage;
  if (!defenderProtected) defender.damage += attackerDamage;
  const dealt = defenderProtected ? 0 : attackerDamage;
  const received = attackerProtected ? 0 : defenderDamage;
  const attackerStrAfter = cardCurrentStr(state, playerId, attacker);
  const defenderStrAfter = cardCurrentStr(state, opponentId, defender);
  addLog(state, `${attacker.name}が${defender.name}を攻撃。${defender.name}へ${dealt}ダメージ、STR ${defenderStrBefore}→${defenderStrAfter}。${attacker.name}へ${received}ダメージ、STR ${attackerStrBefore}→${attackerStrAfter}。`, "damage", {
    actor: playerId, cardId: attacker.id,
    combat: { targetName: defender.name, damage: dealt, targetStrBefore: defenderStrBefore, targetStrAfter: defenderStrAfter,
      counterDamage: received, sourceStrBefore: attackerStrBefore, sourceStrAfter: attackerStrAfter }
  });
  clearDamageModifiers(attacker, "battle");
  clearDamageModifiers(defender, "battle");
  delete attacker.skipStd097BattleChoice;
  delete defender.skipStd097BattleChoice;

  const defenderDestroyedByBattle = cardCurrentStr(state, opponentId, defender) <= 0;
  const defenderOriginalStr = Number(defender.str ?? 0);
  if (defenderDestroyedByBattle) destroyCard(state, opponentId, defender.uid, { source: "戦闘" });
  if (cardCurrentStr(state, playerId, attacker) <= 0) destroyCard(state, playerId, attacker.uid, { source: "戦闘" });
  if (attacker.id === "STD-095" && defenderDestroyedByBattle) {
    dealFortressDamage(state, opponentId, defenderOriginalStr, playerId, attacker.name);
    addLog(state, `${attacker.name}: 戦闘で破壊した${defender.name}の元のSTR${defenderOriginalStr}ダメージ。`, "effect");
  }
  if (attackerDisconnect) destroyCard(state, opponentId, defender.uid, { source: `${attacker.name}の[切断]` });
  if (defenderDisconnect) destroyCard(state, playerId, attacker.uid, { source: `${defender.name}の[切断]` });
  delete attacker.battleStrBonus;
  delete defender.battleStrBonus;
  if (findCard(state, attacker.uid) && findCard(state, attacker.uid).zoneName !== "trash") queuePostAttackSelection(state, playerId, attacker, defender.uid);
  delete attacker.resolvingStd106Attack;
  delete attacker.resolvingStd227Attack;
  return true;
}

function consumeProtect(state, card, source) {
  if (card.protect === undefined) card.protect = Number(keywordValue(card, "PROTECT") ?? 0);
  if (Number(card.protect ?? 0) > 0) {
    card.protect -= 1;
    addLog(state, `${card.name}の[プロテクト]が${source}を無効。残り${card.protect}。`, "effect");
    return true;
  }
  const mountedProtection = card.mounted?.map((provider) => ({
    provider,
    spec: mountedKeywordSpecsFor(provider.id).find((spec) => spec.keyword === "PROTECT" && (!spec.consumedFlag || !provider[spec.consumedFlag]))
  })).find((entry) => entry.spec);
  if (!mountedProtection) return false;
  if (mountedProtection.spec.consumedFlag) mountedProtection.provider[mountedProtection.spec.consumedFlag] = true;
  addLog(state, `${mountedProtection.provider.name}が与えた[プロテクト]が${source}を無効。`, "effect");
  return true;
}

export function dealCardDamage(state, ownerId, uid, amount, source = "効果", { sourcePlayerId = otherPlayer(ownerId), kind = "effect" } = {}) {
  const player = state.players[ownerId];
  const card = [...player.front, ...player.back].find((item) => item.uid === uid);
  if (!card) return false;
  const sourceCard = sourceCardByName(state, sourcePlayerId, source);
  amount = applyDamageModifiers(state, sourcePlayerId, sourceCard, ownerId, amount, { kind, destination: "card", victimCard: card });
  if (amount > 0 && consumeProtect(state, card, `${source}によるダメージ`)) {
    state.lastDamageOutcome = { targetUid: uid, amount: 0, destructionDetermined: false, prevented: true };
    return true;
  }
  card.damage += amount;
  addLog(state, `${source}: ${card.name}に${amount}ダメージ。残りSTR ${cardCurrentStr(state, ownerId, card)}。`, "effect");
  emitGameEvent(state, {
    type: "card_damaged",
    playerId: ownerId,
    ownerId,
    cardUid: card.uid,
    cardId: card.id,
    cardName: card.name,
    category: card.category,
    amount,
    source
  });
  const destructionDetermined = cardCurrentStr(state, ownerId, card) <= 0;
  state.lastDamageOutcome = { targetUid: uid, amount, destructionDetermined, prevented: false };
  if (destructionDetermined) destroyCard(state, ownerId, uid, { source });
  return true;
}

export function dealFortressDamage(state, victimId, amount, sourcePlayerId, source = "攻撃", { kind = "effect" } = {}) {
  const victim = state.players[victimId];
  const sourcePlayer = state.players[sourcePlayerId];
  amount = applyDamageModifiers(state, sourcePlayerId, sourceCardByName(state, sourcePlayerId, source), victimId, amount, { kind, destination: "user" });
  if (state.damagePenaltyPlayerId === sourcePlayerId && state.damagePenaltyTurn === state.turnNumber && victimId !== sourcePlayerId) {
    amount = Math.max(0, amount - Number(state.extraTurnDamagePenalty ?? 2));
  }
  if (victim.user.abilityKey === "kickass") amount *= 2;
  if (victim.user.abilityKey === "kickass" && amount > 0) emitUserAbilityFeedback(state, "kickass", victimId, victimId, {
    branch: "damage-doubled", before: amount / 2, after: amount, steps: [{ kind: "multiply", target: { kind: "player_stat", playerId: victimId, metric: "damage" }, before: amount / 2, factor: 2, after: amount }]
  });
  if (victim.user.abilityKey === "dimension_innovation") {
    const banCount = Math.min(amount, victim.deck.length);
    for (let index = 0; index < banCount; index += 1) victim.ban.push(victim.deck.pop());
    addLog(state, `${victim.user.abilityName}: ${amount}ダメージを置換し、山札${banCount}枚をBAN。`, "effect");
    if (amount > 0 && banCount > 0) emitUserAbilityFeedback(state, "dimension_innovation", victimId, victimId, {
      branch: "damage-replaced", before: amount, after: banCount, strBefore: victim.fortressStr, strAfter: victim.fortressStr, outcome: "ban", steps: [{ kind: "transfer", from: { kind: "zone_count", playerId: victimId, zone: "deck" }, to: { kind: "zone_count", playerId: victimId, zone: "ban" }, count: banCount }]
    });
    if (kind === "attack") addLog(state, `${source}が${victim.user.name}を攻撃。ダメージは置換され、STRは変動なし。`, "damage", {
      actor: sourcePlayerId, cardId: sourceCardByName(state, sourcePlayerId, source)?.id ?? null,
      combat: { targetName: victim.user.name, damage: 0, targetStrBefore: victim.fortressStr, targetStrAfter: victim.fortressStr }
    });
    return banCount;
  }
  const before = victim.fortressStr;
  victim.fortressStr = Math.max(0, victim.fortressStr - amount);
  if (victim.user.abilityKey === "recovery_boot" && victim.fortressStr <= 0) {
    victim.fortressStr = 1;
    addLog(state, `${victim.user.abilityName}: STRを1へ回復。`, "effect");
    emitUserAbilityFeedback(state, "recovery_boot", victimId, victimId, { branch: "recovered", before: 0, after: 1, steps: [{ kind: "value_change", target: { kind: "player_stat", playerId: victimId, metric: "str" }, before: 0, after: 1 }] });
  }
  victim.damageReceivedThisTurn = Number(victim.damageReceivedThisTurn ?? 0) + amount;
  const sourceCard = kind === "attack" ? sourceCardByName(state, sourcePlayerId, source) : null;
  if (kind === "attack") addLog(state, `${source}が${victim.user.name}を攻撃。${amount}ダメージ、STR ${before}→${victim.fortressStr}。`, "damage", {
    actor: sourcePlayerId, cardId: sourceCard?.id ?? null,
    combat: { targetName: victim.user.name, damage: amount, targetStrBefore: before, targetStrAfter: victim.fortressStr }
  });
  else addLog(state, `${source}: ${victim.user.name}へ${amount}ダメージ。STR ${before}→${victim.fortressStr}。`, "damage");
  if (amount > 0) emitGameEvent(state, { type: "user_damaged", playerId: victimId, ownerId: victimId,
    amount, kind, sourcePlayerId, source });
  const triggered = victim.user.incidents.filter((threshold) =>
    before > threshold && victim.fortressStr <= threshold && !victim.incidentsTriggered.includes(threshold)
  );
  for (const threshold of triggered) {
    victim.incidentsTriggered.push(threshold);
    victim.permanentMemory += 1;
    victim.memory += 1;
    drawCards(state, sourcePlayerId, 1);
    addLog(state, `INCIDENT ${threshold}: ${victim.user.name}のメモリ上限+1・アクティブメモリ1回復、${sourcePlayer.user.name}が1ドロー。`, "incident");
  }
  if (victim.fortressStr <= 0) recordVictoryFact(state, { type: "str-zero", playerId: victimId, sourcePlayerId });
  if (state.interactive && amount > 0 && sourcePlayerId !== victimId) {
    const queued = { playerId: victimId, event: { sourcePlayerId, source, amount, kind } };
    if (state.resolvingResponse) (state.responseEventQueue ??= []).push(queued);
    else openResponseWindow(state, queued.playerId, queued.event) || startNextQueuedResponse(state);
  }
}

const RESPONSE_RUNTIME_IDS = new Set(["STD-015", "STD-034", "STD-047", "STD-132", "STD-143", "STD-167", "STD-203", "STD-207"]);

function responseCardApplicable(state, playerId, card) {
  const opponent = state.players[otherPlayer(playerId)];
  if (card.id === "STD-034") return [...opponent.front, ...opponent.back].some(isObCard);
  if (card.id === "STD-047") return state.players[playerId].deck.some((target) => isObCard(target) && hasClass(target, "フィクサー"));
  if (card.id === "STD-167") return [...opponent.front, ...opponent.back].some((target) => isObCard(target) && cardCurrentStr(state, otherPlayer(playerId), target) < Number(state.players[playerId].damageReceivedThisTurn ?? 0));
  if (card.id === "STD-203") return [...state.players[playerId].front, ...state.players[playerId].back].some(isObCard)
    && [...opponent.front, ...opponent.back].some(isObCard);
  return true;
}

function declareResponse(state, playerId, cardUid, { targetUid = null, targetUids = [], responseEvent } = {}) {
  const player = state.players[playerId];
  const index = player.hand.findIndex((candidate) => candidate.uid === cardUid);
  if (index < 0) return false;
  const card = player.hand[index];
  const cost = Number(keywordValue(card, "RESPONSE") ?? -1);
  if (cost < 0 || player.memory < cost) return false;
  player.hand.splice(index, 1);
  player.memory -= cost;
  const declared = declareEffect(state, {
    kind: "response", cardId: card.id, playerId, sourceUid: card.uid,
    card, targetUid, targetUids, responseEvent
  });
  card.declaredEffectId = declared.id;
  state.pending = null;
  addLog(state, `${card.name}: レスポンス:${cost}を宣言。現在の効果完了後に解決する。`, "action");
  openResponseWindow(state, playerId, responseEvent);
  return true;
}

function activateStd203Response(state, playerId, cardUid, selectedUids, responseEvent) {
  const own = selectedUids.map((uid) => findCard(state, uid)).find((entry) => entry?.playerId === playerId && isObCard(entry.card) && ["front", "back"].includes(entry.zoneName));
  const enemyId = otherPlayer(playerId);
  const enemy = selectedUids.map((uid) => findCard(state, uid)).find((entry) => entry?.playerId === enemyId && isObCard(entry.card) && ["front", "back"].includes(entry.zoneName));
  if (!own || !enemy) return false;
  return declareResponse(state, playerId, cardUid, {
    targetUid: enemy.card.uid, targetUids: [own.card.uid, enemy.card.uid], responseEvent
  });
}

function finishDeclaredResponseCleanup(state) {
  const deferred = state.deferredDeclaredResponseCleanup;
  if (!deferred) return false;
  const { card, cost } = deferred;
  state.resolvingResponse = false;
  state.deferredDeclaredResponseCleanup = null;
  addLog(state, `${card.name}: レスポンス:${cost}の効果と発動元処理を完了。`, "effect");
  return true;
}

function continueDeferredDeclaredResponseCleanup(state) {
  const deferred = state.deferredDeclaredResponseCleanup;
  if (!deferred || state.pending || state.prompt || state.deferredTrashMoves?.length || state.deferredDestruction || state.deferredAttack) return false;
  if (!deferred.cleanupStarted) {
    deferred.cleanupStarted = true;
    const destination = moveCardToTrash(state, deferred.playerId, deferred.card, deferred.card.name);
    if (destination === "deferred") return true;
    deferred.cleanupDone = true;
  } else if (!deferred.cleanupDone) {
    const owner = state.players[deferred.playerId];
    deferred.cleanupDone = [...owner.trash, ...owner.ban].some((card) => card.uid === deferred.card.uid);
    if (!deferred.cleanupDone) return false;
  }
  return finishDeclaredResponseCleanup(state);
}

function resolveDeclaredResponse(state, declared) {
  const { playerId, card, targetUid = null, targetUids = [] } = declared;
  const cost = Number(keywordValue(card, "RESPONSE") ?? 0);
  state.resolvingResponse = true;
  state.deferredDeclaredResponseCleanup = {
    declaredEffectId: declared.id, playerId, card, cost, cleanupStarted: false, cleanupDone: false
  };
  if (card.id === "STD-167") destroyCard(state, otherPlayer(playerId), targetUid, { source: card.name });
  else resolveSpell(state, playerId, card, targetUid, { targetUids });
  if (!state.pending && !state.prompt) continueDeferredDeclaredResponseCleanup(state);
  return true;
}

export function getResponseCandidates(state, playerId) {
  const player = state.players[playerId];
  return player.hand.filter((card) => {
    const cost = Number(keywordValue(card, "RESPONSE") ?? -1);
    return RESPONSE_RUNTIME_IDS.has(card.id) && cost >= 0 && player.memory >= cost
      && (state.mode === "lab" || !card.color || enabledSymbols(player).includes(card.color))
      && responseCardApplicable(state, playerId, card);
  });
}

function openResponseWindow(state, playerId, event) {
  if (state.winner) return false;
  const candidates = getResponseCandidates(state, playerId);
  if (!candidates.length) return false;
  state.pending = {
    type: "response-window", playerId, event,
    candidates: candidates.map((card) => card.uid),
    candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, `${card.name} / レスポンス:${keywordValue(card, "RESPONSE")}`]))
  };
  addLog(state, `${state.players[playerId].user.name}: レスポンス受付。`, "effect");
  return true;
}

function startNextQueuedResponse(state) {
  while (state.responseEventQueue?.length) {
    const next = state.responseEventQueue.shift();
    if (openResponseWindow(state, next.playerId, next.event)) return true;
  }
  return false;
}

export function declineResponse(state, playerId) {
  return runEffectEntry(state, "response-decline", playerId, () => {
    if (state.pending?.type !== "response-window" || state.pending.playerId !== playerId) return false;
    state.pending = null;
    return true;
  });
}

export function activateResponse(state, playerId, cardUid, targetUid = null) {
  return runEffectEntry(state, "response-declaration", playerId, () => activateResponseCore(state, playerId, cardUid, targetUid));
}

function activateResponseCore(state, playerId, cardUid, targetUid = null) {
  const pending = state.pending;
  const fromWindow = pending?.type === "response-window" && pending.playerId === playerId && pending.candidates.includes(cardUid);
  const fromTarget = pending?.type === "response-target" && pending.playerId === playerId && pending.cardUid === cardUid;
  if (!fromWindow && !fromTarget) return false;
  const player = state.players[playerId];
  const index = player.hand.findIndex((card) => card.uid === cardUid);
  if (index < 0) return false;
  const card = player.hand[index];
  const responseEvent = pending.event ?? pending.responseEvent;
  const cost = Number(keywordValue(card, "RESPONSE") ?? -1);
  if (cost < 0 || player.memory < cost || !responseCardApplicable(state, playerId, card)) return false;
  const targets = [...state.players[otherPlayer(playerId)].front, ...state.players[otherPlayer(playerId)].back].filter(isObCard);
  const responseTargets = card.id === "STD-167" ? targets.filter((target) => cardCurrentStr(state, otherPlayer(playerId), target) < Number(player.damageReceivedThisTurn ?? 0)) : targets;
  if (fromWindow && card.id === "STD-203") {
    const own = [...player.front, ...player.back].filter(isObCard).map((target) => target.uid);
    const enemy = targets.map((target) => target.uid);
    const request = createSelectionRequest({ mode: "exact", candidates: [...own, ...enemy], count: 2,
      label: "破壊する自分Obと2ダメージを与える相手Ob", message: card.text,
      groups: [
        { id: "own", label: "自分Ob", candidates: own, minimum: 1, maximum: 1 },
        { id: "enemy", label: "相手Ob", candidates: enemy, minimum: 1, maximum: 1 }
      ], continuation: { type: "activate-std203-response", playerId, cardUid, responseEvent } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  if (fromWindow && ["STD-015", "STD-034", "STD-167"].includes(card.id) && responseTargets.length && !targetUid) {
    state.pending = { type: "response-target", playerId, cardUid, validTargets: responseTargets.map((target) => target.uid), responseEvent: pending.event };
    return true;
  }
  if (card.id === "STD-034" && !targets.some((target) => target.uid === targetUid)) return false;
  if (card.id === "STD-015" && targetUid && !targets.some((target) => target.uid === targetUid)) return false;
  if (card.id === "STD-167" && !responseTargets.some((target) => target.uid === targetUid)) return false;
  return declareResponse(state, playerId, cardUid, { targetUid, responseEvent });
}

function triggerObDestroyedExtras(state, destroyedCard) {
  if (!isObCard(destroyedCard)) return;
  for (const [playerId, player] of Object.entries(state.players)) {
  }
}

function beginStd165ThresholdEffect(state, playerId, sourceUid) {
  const source = findCard(state, sourceUid);
  if (!source || source.playerId !== playerId || source.zoneName !== "back" || source.card.id !== "STD-165" || !source.card.residentActive) return false;
  const player = state.players[playerId];
  const candidates = [...player.hand, ...player.trash].filter((card) => isObCard(card) && hasClass(card, "旧支配者"));
  const sourceName = source.card.name;
  const sourceText = source.card.text;
  state.resolvingStd165 = true;
  const destroyed = destroyCard(state, playerId, sourceUid, { source: sourceName, suppressReplacement: true, suppressTrashScriptWindow: true });
  state.resolvingStd165 = false;
  if (!destroyed) return false;
  if (!candidates.length) return true;
  const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
    candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])), label: `${sourceName}: 旧支配者をログイン`, message: sourceText,
    continuation: { type: "std165-login", playerId, sourceName } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

function triggerStd165Threshold(state) {
  if (state.resolvingStd165 || Number(state.turnStats.destroyedCards ?? 0) < 4) return;
  const ownerOrder = [state.active, otherPlayer(state.active)];
  const entriesByOwner = new Map();
  for (const playerId of ownerOrder) {
    const player = state.players[playerId];
    const entries = [];
    for (const source of player.back.filter((card) => card.id === "STD-165" && card.residentActive)) {
      entries.push({ kind: "STD-165", playerId, sourceUid: source.uid, sourceName: source.name });
    }
    entriesByOwner.set(playerId, entries);
  }
  let hasNext = true;
  while (hasNext) {
    hasNext = false;
    for (const playerId of ownerOrder) {
      const next = entriesByOwner.get(playerId)?.shift();
      if (!next) continue;
      (state.independentEffects ??= []).push(next);
      hasNext = true;
    }
  }
  if (!state.effectResolution && !state.pending && !state.prompt) drainIndependentEffects(state);
}

export function destroyCard(state, ownerId, uid, { source = "破壊", suppressReplacement = false, replacementChoice = null, suppressTrashScriptWindow = false } = {}) {
  const player = state.players[ownerId];
  normalizeZoneSlots(player.front, { controllerId: ownerId, zoneName: "front", limit: player.user?.frontLimit });
  normalizeZoneSlots(player.back, { controllerId: ownerId, zoneName: "back", limit: player.user?.backLimit });
  let zoneName = "front";
  let index = player.front.findIndex((card) => card.uid === uid);
  if (index < 0) {
    zoneName = "back";
    index = player.back.findIndex((card) => card.uid === uid);
  }
  if (index < 0) return false;
  const zone = player[zoneName];
  const protectedCard = zone[index];
  if (destructionPermissionSpecsFor(protectedCard.id).some((spec) => spec.type === "forbid_destruction" && spec.target === "source"
    && (protectedCard.id !== "STD-159" || protectedCard.faceDown !== true))) {
    addLog(state, `${protectedCard.name}は破壊できない。`, "effect");
    settleDestructionContinuations(state, uid, false);
    continuePlacementCostBatch(state);
    return false;
  }
  if (consumeProtect(state, protectedCard, `${source}による破壊`)) {
    settleDestructionContinuations(state, uid, false);
    resumeDestroyLkiFollowUp(state, uid);
    continuePlacementCostBatch(state);
    return false;
  }
  const maxBackupUsesBefore = backupLimit(protectedCard);
  const grantedBackupUsesBefore = Number(protectedCard.backup ?? 0);
  const backupUsesBefore = protectedCard.backupUsedTurn === state.turnNumber ? Number(protectedCard.backupUsesThisTurn ?? 0) : 0;
  const backupAvailable = zoneName === "front" && (grantedBackupUsesBefore > 0 || maxBackupUsesBefore > backupUsesBefore) && player.back.length < player.user.backLimit;
  const std099 = player.hand.find((candidate) => candidate.id === "STD-099");
  const std099Materials = [...player.front, ...player.back].filter((candidate) => candidate.uid !== uid && hasClass(candidate, "レッドパンクス"));
  const std099Available = isObCard(protectedCard) && protectedCard.name.includes("変形合体レッパオー") && std099 && std099Materials.length > 0;
  if (!suppressReplacement && replacementChoice === null && std099Available) {
    const options = ["破壊をそのまま適用", ...(backupAvailable ? ["[バックアップ]で置換"] : []), "STD-099で置換ログイン"];
    const request = createSelectionRequest({ mode: "scope", scopeField: "destructionReplacement", scopeOptions: options,
      label: `${protectedCard.name}の破壊置換`, message: "適用する置換を1つ選択。",
      continuation: { type: "destruction-replacement-choice", playerId: ownerId, targetUid: uid, std099Uid: std099.uid, source } });
    state.pending = { type: "selection", validTargets: [], request };
    return true;
  }
  if (!suppressTrashScriptWindow && !backupAvailable) {
    const scriptOwnerId = otherPlayer(ownerId);
    const script = state.players[scriptOwnerId].back.find((candidate) => candidate.id === "STD-003" && candidate.faceDown && state.players[scriptOwnerId].memory >= Number(candidate.cost ?? 0));
    if (script) {
      state.deferredDestruction = { ownerId, uid, source, suppressReplacement };
      openScriptActivationWindow(state, scriptOwnerId, script, { type: "card_would_move_to_trash", ownerId, playerId: ownerId, cardUid: uid, category: protectedCard.category });
      return true;
    }
  }
  const [card] = zone.splice(index, 1);
  const revealed = revealMountedCode(zone, index, card, ownerId, zoneName);
  if (revealed) addLog(state, `${card.name}の下にあった${revealed.name}は場に残る。`, "effect");

  const maxBackupUses = backupLimit(card);
  const grantedBackupUses = Number(card.backup ?? 0);
  const backupUsesThisTurn = card.backupUsedTurn === state.turnNumber ? Number(card.backupUsesThisTurn ?? 0) : 0;
  if (!suppressReplacement && zoneName === "front" && (replacementChoice === "backup" || (replacementChoice === null && (grantedBackupUses > 0 || maxBackupUses > backupUsesThisTurn))) && player.back.length < player.user.backLimit) {
    setCardSleeping(state, ownerId, card);
    card.damage = 0;
    if (grantedBackupUses > 0) card.backup = grantedBackupUses - 1;
    else {
      card.backupUsedTurn = state.turnNumber;
      card.backupUsesThisTurn = backupUsesThisTurn + 1;
    }
    placeByMode(state, ownerId, card, { zone: "back", mode: "normal", from: "front", source: "バックアップ" });
    addLog(state, `${card.name}は[バックアップ]でスリープしてバックへ移動。`, "effect");
    emitGameEvent(state, {
      type: "card_destroyed", playerId: ownerId, ownerId,
      cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category,
      traits: cardTraits(card), from: zoneName, to: "back", source, replaced: true
    });
    state.turnStats.destroyedCards += 1;
    if (isObCard(card)) state.turnStats.destroyedOb += 1;
    if (isObCard(card)) {
      queueScriptPrompt(state, ownerId, "自分Obが破壊された時");
      queueScriptPrompt(state, otherPlayer(ownerId), "相手Obが破壊された時");
    }
    triggerObDestroyedExtras(state, card);
    settleDestructionContinuations(state, card.uid, true);
    resumeDestroyLkiFollowUp(state, card.uid);
    triggerStd165Threshold(state);
    continuePlacementCostBatch(state);
    return true;
  }
  const trashOutcome = moveCardToTrash(state, ownerId, card, source, { suppressScriptWindow: suppressTrashScriptWindow, fromArea: true });
  addLog(state, `${source}: ${card.name}を破壊。`, "damage");
  state.turnStats.destroyedCards += 1;
  if (isObCard(card)) state.turnStats.destroyedOb += 1;
  if (card.category === "Script" && card.name.includes("聖樹")) state.turnStats.destroyedSacredTreeScripts += 1;
  emitGameEvent(state, {
    type: "card_destroyed",
    playerId: ownerId,
    ownerId,
    cardUid: card.uid,
    cardId: card.id,
    cardName: card.name,
    category: card.category,
    traits: cardTraits(card),
    from: zoneName,
    source
  });
  if (trashOutcome !== "deferred") resolveLogoutAfterAreaExit(state, ownerId, card);
  if (isObCard(card)) {
    queueScriptPrompt(state, ownerId, "自分Obが破壊された時");
    queueScriptPrompt(state, otherPlayer(ownerId), "相手Obが破壊された時");
  }
  triggerObDestroyedExtras(state, card);
  triggerStd165Threshold(state);
  settleDestructionContinuations(state, card.uid, true);
  if (!state.pending) resumeDestroyLkiFollowUp(state, card.uid);
  continuePlacementCostBatch(state);
  return true;
}

export function discardMountedCard(state, ownerId, hostUid, layerUid, source = "レイヤー除去") {
  const host = [...state.players[ownerId].front, ...state.players[ownerId].back].find((card) => card.uid === hostUid);
  if (!host) return false;
  const index = host.mounted.findIndex((card) => card.uid === layerUid);
  if (index < 0) return false;
  const [layer] = host.mounted.splice(index, 1);
  moveCardToTrash(state, layer.owner ?? ownerId, layer, source);
  addLog(state, `${source}: ${host.name}のレイヤー「${layer.name}」をゴミ箱へ。`, "effect");
  resolveMandatoryStateChecks(state);
  return true;
}

function resolveAccessDragPlacementCore(state, playerId, zone, underUid = null) {
  const pending = state.pending;
  if (!["access-drag-place", "decode-place", "std048-draw-place"].includes(pending?.type) || pending.playerId !== playerId) return false;
  const player = state.players[playerId];
  const uid = pending.queue[0];
  const card = pending.type === "decode-place"
    ? pending.cards.find((item) => item.uid === uid)
    : state.players[playerId].hand.find((item) => item.uid === uid);
  if (!card) return false;
  state.pending = null;
  if (pending.type === "decode-place") {
    const target = state.players[playerId][zone];
    const host = underUid ? target?.find((item) => item.uid === underUid && isObCard(item)) : null;
    if (!target || !(isObCard(card) || card.category === "Code") || (underUid && (!host || card.category !== "Code"))) { state.pending = pending; return false; }
    card.sleep = false;
    card.summoningSick = false;
    card.damage = 0;
    if (host) {
      card.layerRole = "code";
      host.mounted.push(card);
      addLog(state, `${pending.sourceName}: ${card.name}を${host.name}の下へ配置。`, "effect");
    } else {
      const outcome = placeByMode(state, playerId, card, { zone, from: "trash", source: pending.sourceName, suppressScriptWindow: true });
      if (outcome !== "placed") {
        const queue = pending.queue.slice(1); const cards = pending.cards?.filter((item) => item.uid !== uid);
        state.pending = queue.length ? { ...pending, queue, cards, sourceUid: queue[0] } : null;
        return true;
      }
      addLog(state, `${pending.sourceName}: ${card.name}を${zone === "front" ? "フロント" : "バック"}へ配置。`, "effect");
      emitEffectPlacement(state, playerId, card, zone, pending.sourceName);
    }
  } else {
    const placement = placeCardByEffect(state, {
      sourceOwnerId: playerId, controllerId: playerId, sourceZone: "hand", targetZone: zone, cardUid: uid, underUid, sourceName: pending.sourceName,
      placementCause: pending.type === "access-drag-place" ? "access_drag" : "effect",
      onPlaced: (placedCard) => { placedCard.summoningSick = zone === "front"; }
    });
    if (["invalid", "missing", "rejected"].includes(placement.status)) {
      state.pending = pending;
      return false;
    }
  }
  const placed = findCard(state, card.uid)?.zoneName;
  if (pending.type === "std048-draw-place") {
    settleStd048MandatoryPlacement(state, pending, ["front", "back"].includes(placed));
    return true;
  }
  if (!["front", "back"].includes(placed)) {
    const queue = pending.queue.slice(1); const cards = pending.cards?.filter((item) => item.uid !== uid);
    state.pending = queue.length ? { ...pending, queue, cards, sourceUid: queue[0] } : null;
    if (pending.triggerItemId && !state.pending) resumeTriggerThreadAfterSelection(state, pending.triggerItemId);
    return true;
  }
  const placedCard = findCard(state, card.uid)?.card;
  if (pending.enterSleep && placedCard) setCardSleeping(state, playerId, placedCard);
  if (pending.destroyAtTurnEnd) state.delayedEffects.push({ event: "turn_ended", turnPlayerId: pending.destroyTurnPlayerId,
    type: "destroy_card", ownerId: playerId, cardUid: card.uid, sourceName: pending.sourceName });
  const placementEffect = state.pending;
  const queue = pending.queue.slice(1);
  const cards = pending.cards?.filter((item) => item.uid !== uid);
  state.pending = placementEffect ?? (queue.length ? { ...pending, queue, cards, sourceUid: queue[0] } : null);
  if (pending.triggerItemId && !state.pending) resumeTriggerThreadAfterSelection(state, pending.triggerItemId);
  return true;
}

export function resolveAccessDragPlacement(state, playerId, zone, underUid = null) {
  return runEffectEntry(state, "placement", playerId, () => resolveAccessDragPlacementCore(state, playerId, zone, underUid));
}

export function restSecurity(state, playerId, uid) {
  if (state.active !== playerId || state.winner || state.victory?.lockedOutcome || state.pending || state.prompt || state.effectResolution) return false;
  const card = state.players[playerId].front.find((item) => item.uid === uid);
  if (!card || !isObCard(card) || card.faceDown || !cardHasKeyword(card, "SECURITY")) return fail(state, "[セキュリティ]を持つフロントObを選んで。", false);
  if (state.securityRestWindow !== playerId) return fail(state, "[セキュリティ]はターン終了時だけスリープできる。", false);
  if (card.sleep) return fail(state, "既にスリープしている。", false);
  setCardSleeping(state, playerId, card);
  addLog(state, `${card.name}を[セキュリティ]待機でスリープ。`, "action");
  return true;
}

export function canActivateTurbo(state, playerId = "player") {
  const player = state.players[playerId];
  return Boolean(player && player.user?.abilityKey === "turbo" && state.active === playerId && !player.turboUsed);
}

export function activateTurbo(state, playerId = "player") {
  const player = state.players[playerId];
  if (!canActivateTurbo(state, playerId)) return fail(state, "ターボ・ブーストは今は使えない。", false);
  const beforeMaxMemory = getMaxMemory(player);
  player.turboUsed = true;
  player.turboActive = true;
  player.memory += 2;
  addLog(state, `${player.user.name}「ターボ・ブースト！」メモリ上限とアクティブメモリ+2。`, "effect");
  emitUserAbilityFeedback(state, "turbo", playerId, playerId, {
    branch: "activated", before: beforeMaxMemory, after: getMaxMemory(player), amount: 2, steps: [{ kind: "value_change", target: { kind: "player_stat", playerId, metric: "memory_limit" }, before: beforeMaxMemory, after: getMaxMemory(player) }]
  });
  queueMemoryLimitIncreasePrompt(state, playerId, "ターボ・ブースト！");
  return true;
}

function resolveDelayedTrashMove(state, effect) {
  const owner = state.players[effect.ownerId];
  if (!owner) return false;
  const index = owner.trash.findIndex((card) => card.uid === effect.cardUid);
  if (index < 0) return false;
  const [card] = owner.trash.splice(index, 1);
  if (effect.destination === "hand") {
    owner.hand.push(card);
    addLog(state, `${effect.sourceName}: 次の自分ターン開始時にゴミ箱から手札へ。`, "effect");
    return true;
  }
  const zone = effect.destination === "choose_area"
    ? owner.front.length < owner.user.frontLimit ? "front" : owner.back.length < owner.user.backLimit ? "back" : "front"
    : effect.destination ?? "front";
  if (placeByMode(state, effect.ownerId, card, { zone, from: "trash", source: effect.sourceName }) !== "placed") return true;
  if (effect.resetDamage) card.damage = 0;
  if (effect.standby) card.sleep = false;
  if (effect.sleep) setCardSleeping(state, effect.ownerId, card);
  card.summoningSick = zone === "front";
  emitEffectPlacement(state, effect.ownerId, card, zone, effect.sourceName);
  return true;
}

function resolveTurnStartDelayedEffects(state, playerId) {
  const player = state.players[playerId];
  const due = state.delayedEffects.filter((effect) => effect.event === "turn_started"
    && effect.ownerId === playerId
    && effect.dueOwnerTurnsTaken <= player.turnsTaken + 1);
  state.delayedEffects = state.delayedEffects.filter((effect) => !due.includes(effect));
  for (const effect of due) {
    if (effect.type === "move_source_from_trash") resolveDelayedTrashMove(state, effect);
  }
}

function resolveTurnEndDelayedEffects(state, activeId) {
  const due = state.delayedEffects.filter((effect) => effect.event === "turn_ended"
    && (effect.dueTurn !== undefined ? effect.dueTurn <= state.turnNumber : effect.turnPlayerId === activeId));
  state.delayedEffects = state.delayedEffects.filter((effect) => !due.includes(effect));
  for (const effect of due) {
    if (effect.type === "destroy_card") {
      destroyCard(state, effect.ownerId, effect.cardUid, { source: `${effect.sourceName}の遅延破壊` });
      continue;
    }
    if (effect.type === "move_source_from_trash") {
      resolveDelayedTrashMove(state, effect);
      continue;
    }
    if (effect.type !== "generate_dolls_for_destroyed_ob") continue;
    const maximum = state.turnStats.destroyedOb;
    if (maximum <= 0) continue;
    const request = createSelectionRequest({ mode: "scope", scopeField: "count",
      scopeOptions: Array.from({ length: maximum + 1 }, (_, index) => String(index)),
      label: `生成するドールズの数（0～${maximum}）`, message: effect.sourceName,
      continuation: { type: "std212-respawn-count", playerId: effect.controllerId, sourceName: effect.sourceName, activeId, maximum } });
    state.pending = { type: "selection", validTargets: [], request };
    return true;
  }
  return false;
}

function completeTurnAfterDelayedEffects(state, activeId) {
  const player = state.players[activeId];
  for (const current of Object.values(state.players)) {
    for (const card of [...current.front, ...current.back, ...current.hand]) {
      for (const [keyword, expiry] of Object.entries(card.keywordExpiries ?? {})) {
        if (expiry <= state.turnNumber) {
          card.grantedKeywords = (card.grantedKeywords ?? []).filter((value) => value !== keyword);
          delete card.keywordExpiries[keyword];
        }
      }
      if (card.assaultProgramTurn === state.turnNumber) delete card.assaultProgramTurn;
    }
  }
  player.forceAttack = false;
  state.turnNumber += 1;
  if (state.extraTurnPlayerId === activeId) {
    state.extraTurnPlayerId = null;
    state.damagePenaltyPlayerId = activeId;
    state.damagePenaltyTurn = state.turnNumber;
    startTurn(state, activeId);
  } else if (["lab", "sandbox"].includes(state.mode) && !state.sandboxUi?.alternateTurns) startTurn(state, "player");
  else startTurn(state, otherPlayer(activeId));
  return true;
}

function resolveStd049TurnEnd(state, activeId) {
  const controllerId = otherPlayer(activeId);
  const player = state.players[controllerId];
  const armed = player.trash.filter((card) => card.id === "STD-049" && card.std049ProxyArmed);
  if (!armed.length) return;
  const calamities = [...player.front, ...player.back].filter((card) => card.id === "STD-050");
  if (!calamities.length) return;
  let destroyed = 0;
  for (const target of calamities) {
    if (destroyCard(state, controllerId, target.uid, { source: "宵の明星の起動コスト" })) destroyed += 1;
  }
  if (!destroyed) return;
  for (const source of armed) {
    dealFortressDamage(state, activeId, 5, controllerId, source.name);
    const trashIndex = player.trash.findIndex((card) => card.uid === source.uid);
    const zoneName = player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
    if (trashIndex >= 0) {
      const [decoded] = player.trash.splice(trashIndex, 1);
      delete decoded.std049ProxyArmed;
      decoded.sleep = false;
      decoded.summoningSick = false;
      decoded.damage = 0;
      const placed = placeByMode(state, controllerId, decoded, { zone: zoneName, from: "trash", source: source.name }) === "placed";
      if (!placed) continue;
      addLog(state, `${source.name}: 災いの明星${destroyed}体を破壊し、5ダメージとデコードを解決。`, "effect");
    }
  }
}

export function endTurn(state) {
  if (state.winner) return false;
  const activeId = state.active;
  const player = state.players[activeId];
  const resumingStd094TurnEnd = state.std094TurnEndQueue?.activeId === activeId || state.std094TurnEndDone === activeId;
  const resumingStd141TurnEnd = state.std141TurnEndQueue?.activeId === activeId || state.std141TurnEndDone === activeId;
  const resumingTurnEnd = state.std142TurnEndQueue?.activeId === activeId || state.std142TurnEndDone === activeId
    || resumingStd094TurnEnd || resumingStd141TurnEnd;
  if (!resumingTurnEnd) {
  if (player.forceAttack && player.front.some((card) => !card.attackedThisTurn && canAttack(state, activeId, card))) {
    return fail(state, "攻撃可能なObすべてで攻撃してからターンを終了して。", false);
  }
  if (player.front.some((card) => card.mustAttackObTurn === state.turnNumber && !card.attackedObThisTurn
    && canAttack(state, activeId, card)
    && getAttackTargets(state, activeId, card).some((target) => target.type === "card"))) {
    return fail(state, "可能ならObを攻撃するカードが攻撃を終えていない。", false);
  }
  const readySecurities = player.front.filter((card) => isObCard(card) && !card.faceDown && !card.sleep && cardHasKeyword(card, "SECURITY"));
  if (readySecurities.length && state.securityRestWindow !== activeId) {
    state.securityRestWindow = activeId;
    addLog(state, "ターン終了時：[セキュリティ]をスリープするなら選択。もう一度ターン終了で確定。", "effect");
    return false;
  }
  delete state.securityRestWindow;
  if (player.user.abilityKey === "do_or_isnt"
    && [...player.front, ...player.back].filter(isObCard).length === 3) {
    const beforeStr = player.fortressStr;
    const beforeMemory = player.memory;
    player.fortressStr = Math.min(player.user.maxStr, player.fortressStr + 1);
    player.memory = Math.min(getMaxMemory(player), player.memory + 1);
    addLog(state, `DO OR is'NT: ${player.user.name}のSTRとメモリを1回復。`, "effect");
    if (beforeStr !== player.fortressStr || beforeMemory !== player.memory) emitUserAbilityFeedback(state, "do_or_isnt", activeId, activeId, {
      branch: "exact-three-recovery", strBefore: beforeStr, strAfter: player.fortressStr,
      memoryBefore: beforeMemory, memoryAfter: player.memory, steps: [{ kind: "value_change", target: { kind: "player_stat", playerId: activeId, metric: "str" }, before: beforeStr, after: player.fortressStr }, { kind: "value_change", target: { kind: "player_stat", playerId: activeId, metric: "memory" }, before: beforeMemory, after: player.memory }]
    });
  }
  const savageOwnerId = Object.entries(state.players).find(([, entry]) => entry.user.abilityKey === "trash_never_empty")?.[0] ?? null;
  if (!state.skipSavageTurnEnd && savageOwnerId) {
    const moved = [];
    for (let index = 0; index < 2; index += 1) {
      const card = player.deck.pop();
      if (!card) break;
      player.trash.push(card); moved.push(card);
    }
    if (moved.length === 2 && moved[0].color && moved[0].color === moved[1].color) {
      emitUserAbilityFeedback(state, "trash_never_empty", savageOwnerId, activeId, { branch: "milled-same-symbol", amount: moved.length, steps: [{ kind: "transfer", from: { kind: "zone_count", playerId: activeId, zone: "deck" }, to: { kind: "zone_count", playerId: activeId, zone: "trash" }, count: moved.length }] });
      const request = createSelectionRequest({ mode: "up_to", candidates: moved.map((card) => card.uid), count: 1, minimum: 0, maximum: 1,
        candidateLabels: Object.fromEntries(moved.map((card) => [card.uid, card.name])), label: "同シンボルから1枚までサルベージ", message: "選ばず確定も可能。",
        continuation: { type: "user-savage-salvage", playerId: activeId, ownerPlayerId: savageOwnerId } });
      state.pending = { type: "selection", validTargets: request.candidates, request };
      return false;
    } else if (moved.length === 2) {
      const drawn = drawCards(state, activeId, 1);
      addLog(state, "*ゴミ箱は空にならない*: 異なるシンボルのため1枚ドロー。", "effect");
      if (drawn) emitUserAbilityFeedback(state, "trash_never_empty", savageOwnerId, activeId, { branch: "milled-different-symbol", amount: drawn, outcome: "draw", steps: [{ kind: "transfer", from: { kind: "zone_count", playerId: activeId, zone: "deck" }, to: { kind: "zone_count", playerId: activeId, zone: "hand" }, count: drawn }] });
    }
  }
  delete state.skipSavageTurnEnd;
  for (const provider of player.registry.filter((card) => !card.faceDown && cardRuntimeSpec(card.id, "turn_end"))) {
    executeCardRuntimeSpec(state, "turn_end", activeId, provider);
  }
  for (const card of [...player.front, ...player.back].filter((item) => !item.faceDown && cardRuntimeSpec(item.id, "turn_end"))) {
    executeCardRuntimeSpec(state, "turn_end", activeId, card);
  }
  }
  if (!state.std142TurnEndQueue && state.std142TurnEndDone !== activeId) {
    const ownerOrder = [activeId, otherPlayer(activeId)];
    state.std142TurnEndQueue = {
      activeId,
      entries: ownerOrder.flatMap((ownerId) => ["front", "back"].flatMap((zoneName) =>
        state.players[ownerId][zoneName]
          .filter((card) => card.id === "STD-142" && card.faceDown !== true)
          .map((card) => ({ playerId: ownerId, sourceUid: card.uid }))))
    };
  }
  while (state.std142TurnEndQueue?.entries.length) {
    const next = state.std142TurnEndQueue.entries.shift();
    const source = findCard(state, next.sourceUid);
    if (!source || source.playerId !== next.playerId || source.card.id !== "STD-142" || source.card.faceDown === true) continue;
    const request = createSelectionRequest({
      mode: "up_to",
      candidates: [source.card.uid],
      count: 1,
      minimum: 0,
      maximum: 1,
      candidateLabels: { [source.card.uid]: "このカードを破壊して②を起動" },
      label: "聖樹枝塊の終了時効果",
      message: "選ばず確定すると起動しない。",
      continuation: {
        type: "std142-turn-end-choice",
        playerId: next.playerId,
        activeId,
        sourceUid: source.card.uid,
        sourceName: source.card.name
      }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return false;
  }
  if (state.std142TurnEndQueue) {
    delete state.std142TurnEndQueue;
    state.std142TurnEndDone = activeId;
  }
  if (!resumingStd141TurnEnd) {
    if (!state.std094TurnEndQueue && state.std094TurnEndDone !== activeId) {
      const ownerOrder = [activeId, otherPlayer(activeId)];
      state.std094TurnEndQueue = {
        activeId,
        nextOwnerId: activeId,
        entries: Object.fromEntries(ownerOrder.map((ownerId) => [ownerId,
          [...state.players[ownerId].front, ...state.players[ownerId].back]
            .filter((card) => card.id === "SZTB-094" && !card.faceDown)
            .map((card) => card.uid)
        ]))
      };
    }
    while (state.std094TurnEndQueue) {
      const queue = state.std094TurnEndQueue;
      const ownerId = queue.nextOwnerId;
      const sourceUid = queue.entries[ownerId].shift();
      queue.nextOwnerId = otherPlayer(ownerId);
      if (!sourceUid) {
        if (queue.entries[queue.nextOwnerId].length) continue;
        break;
      }
      const source = findCard(state, sourceUid);
      if (!source || source.playerId !== ownerId || !["front", "back"].includes(source.zoneName) || source.card.id !== "SZTB-094" || source.card.faceDown) continue;
      if (beginSztb094Access(state, ownerId, source.card.name, { resumeTurnEndActiveId: activeId })) return false;
    }
    if (state.std094TurnEndQueue) {
      delete state.std094TurnEndQueue;
      state.std094TurnEndDone = activeId;
    }
    emitGameEvent(state, { type: "turn_ended", playerId: activeId });
    resolveStd049TurnEnd(state, activeId);
  }
  if (!state.std141TurnEndQueue && state.std141TurnEndDone !== activeId) {
    const ownerOrder = [activeId, otherPlayer(activeId)];
    const count = Number(state.turnStats.destroyedSacredTreeScripts ?? 0);
    state.std141TurnEndQueue = {
      activeId,
      nextOwnerId: activeId,
      entries: Object.fromEntries(ownerOrder.map((ownerId) => [ownerId,
        (count >= 2 ? state.players[ownerId].back : [])
          .filter((card) => card.id === "STD-141" && card.residentActive)
          .map((card) => card.uid)
      ]))
    };
  }
  if (continueStd141TurnEndQueue(state, activeId)) {
    return false;
  }
  if (state.std141TurnEndQueue) {
    delete state.std141TurnEndQueue;
    state.std141TurnEndDone = activeId;
  }
  if (resolveTurnEndDelayedEffects(state, activeId)) return false;
  const completed = completeTurnAfterDelayedEffects(state, activeId);
  if (completed) {
    delete state.std142TurnEndDone;
    delete state.std094TurnEndDone;
    delete state.std141TurnEndDone;
  }
  return completed;
}

export function findCard(state, uid) {
  for (const [playerId, player] of Object.entries(state.players)) {
    for (const zoneName of ["hand", "front", "back", "registry", "trash", "deck"]) {
      const card = player[zoneName].find((item) => item.uid === uid);
      if (card) return { playerId, zoneName, card };
    }
  }
  return null;
}

export function legalPlayableCards(state, playerId) {
  return state.players[playerId].hand.filter((card) => canPlayCard(state, playerId, card).ok);
}

export function provisional(state, text, card = null) {
  const key = `${card?.id ?? "RULE"}:${text}`;
  if (!state.provisional.some((item) => item.key === key)) state.provisional.push({ key, text, cardId: card?.id ?? null });
  addLog(state, `暫定処理: ${text}`, "warning");
}

function fail(state, message, silent) {
  state.message = message;
  if (!silent) addLog(state, message, "warning");
  return false;
}

export { CARD_LIBRARY, otherPlayer };
