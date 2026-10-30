import { RuntimeError } from "../runtime/factory.js";
import { addLog, exactKeys, isCounter, isNonEmptyString, isPlainObject, runtimeRng } from "./shared.js";
import { resumeStd230AmbushCleanup } from "../effects/custom/std_230.js";

const PROJECTION_CHANNELS = new Set(["pending", "prompt"]);

const PROJECTION_SCOPES = new Set(["draft", "internal", "declaration", "separate"]);

const PROJECTION_RUNTIMES = new Set(["legacy", "coordinator"]);

const PROJECTION_OWNER_KINDS = new Set(["legacy-root", "draft", "candidate", "coordinator-frame", "separate"]);

const IDENTITY_KEYS = ["channel", "projectionId", "runtime", "scope", "producerId", "ownerKind", "ownerId", "ownerRevision", "actorId"];

const META_KEYS = ["version", "runtime", "channel", "scope", "producerId", "owner", "actorId", "ticket"];

const TICKET_KEYS = ["frameId", "waitId", "effectId", "choiceId", "revision", "actorId"];

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

function validateProjection(state, expectedIdentity, { allowedScopes = null, actorId = expectedIdentity?.actorId } = {}) {
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

export function enqueueSelection(state, pending, metaBase) {
  return enqueueLegacyProjection(state, { queueName: "selectionQueue", channel: "pending", payload: pending, metaBase }).ok;
}

export function openNextQueuedSelection(state) {
  const opened = promoteLegacyQueueHead(state, { queueName: "selectionQueue", channel: "pending", build: (entry) => entry }) === "projected";
  if (!opened) resumeStd230AmbushCleanup(state);
  return opened;
}

export function selectionProjectionMeta(producerId, actorId) {
  return { scope: "internal", producerId, ownerKind: "candidate", actorId };
}
