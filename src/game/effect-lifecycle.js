function copyJsonData(value, visiting = new Set(), copies = new Map()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return { ok: true, value };
  if (typeof value === "number") return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  if (typeof value !== "object") return { ok: false };
  if (visiting.has(value)) return { ok: false };
  if (copies.has(value)) return { ok: true, value: copies.get(value) };
  const prototype = Object.getPrototypeOf(value);
  const keys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some((key) => typeof key !== "string")) return { ok: false };
  visiting.add(value);
  if (Array.isArray(value)) {
    const length = descriptors.length;
    if (!length || length.get || length.set || length.value !== value.length
      || keys.length !== value.length + 1 || keys.some((key) => key !== "length" && !/^(?:0|[1-9]\d*)$/.test(key))) {
      visiting.delete(value); return { ok: false };
    }
    const output = []; copies.set(value, output);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) { visiting.delete(value); return { ok: false }; }
      const copied = copyJsonData(descriptor.value, visiting, copies);
      if (!copied.ok) { visiting.delete(value); return copied; }
      output.push(copied.value);
    }
    visiting.delete(value); return { ok: true, value: output };
  }
  if (prototype !== Object.prototype && prototype !== null) { visiting.delete(value); return { ok: false }; }
  if (keys.some((key) => !descriptors[key].enumerable || descriptors[key].get || descriptors[key].set)) { visiting.delete(value); return { ok: false }; }
  const output = Object.create(prototype); copies.set(value, output);
  for (const key of keys) {
    const copied = copyJsonData(descriptors[key].value, visiting, copies);
    if (!copied.ok) { visiting.delete(value); return copied; }
    Object.defineProperty(output, key, { value: copied.value, enumerable: true, configurable: true, writable: true });
  }
  visiting.delete(value); return { ok: true, value: output };
}

function descriptorValid(descriptor) {
  const copied = copyJsonData(descriptor);
  return copied.ok && copied.value && !Array.isArray(copied.value)
    && typeof copied.value.kind === "string" && copied.value.kind.length > 0
    && (copied.value.playerId === "player" || copied.value.playerId === "ai")
    && (copied.value.sourceUid === undefined || typeof copied.value.sourceUid === "string") ? copied : { ok: false };
}

function outcomeValid(outcome) { return outcome === null || outcome === "player" || outcome === "ai" || outcome === "draw"; }

function ticketMatches(choice, ticket) {
  const copied = copyJsonData(ticket);
  return copied.ok && copied.value && !Array.isArray(copied.value)
    && copied.value.effectId === choice.effectId && copied.value.choiceId === choice.choiceId;
}

export function createEffectLifecycle() { return { serial: 0, choiceSerial: 0, active: null, queue: [], winner: null }; }

export function beginEffect(lifecycle, descriptor) {
  const copied = descriptorValid(descriptor);
  if (lifecycle.active || lifecycle.winner || !copied.ok) return null;
  const id = `effect-${lifecycle.serial + 1}`;
  lifecycle.serial += 1;
  lifecycle.active = { id, descriptor: copied.value, status: "resolving", choice: null };
  return id;
}

export function suspendEffect(lifecycle, id, continuation, options = {}) {
  const copiedContinuation = copyJsonData(continuation);
  const copiedOptions = copyJsonData(options);
  if (!lifecycle.active || lifecycle.active.id !== id || lifecycle.active.status !== "resolving" || !copiedContinuation.ok || !copiedOptions.ok
    || !copiedOptions.value || typeof copiedOptions.value !== "object" || Array.isArray(copiedOptions.value) || Object.keys(copiedOptions.value).some((key) => key !== "cancellable")
    || (Object.hasOwn(copiedOptions.value, "cancellable") && typeof copiedOptions.value.cancellable !== "boolean")) return null;
  const cancellable = copiedOptions.value.cancellable ?? false;
  const choice = { effectId: id, choiceId: `choice-${lifecycle.choiceSerial + 1}`, continuation: copiedContinuation.value, cancellable };
  lifecycle.choiceSerial += 1;
  lifecycle.active.status = "awaiting-choice";
  lifecycle.active.choice = choice;
  return copyJsonData(choice).value;
}

export function resumeEffect(lifecycle, ticket) {
  const choice = lifecycle.active?.choice;
  if (!lifecycle.active || lifecycle.active.status !== "awaiting-choice" || !choice || !ticketMatches(choice, ticket)) return null;
  lifecycle.active.status = "resolving";
  lifecycle.active.choice = null;
  return { effectId: choice.effectId, choiceId: choice.choiceId, continuation: copyJsonData(choice.continuation).value };
}

function settle(lifecycle, outcome) {
  lifecycle.active = null;
  if (outcome !== null) { lifecycle.winner = outcome; lifecycle.queue = []; }
  return true;
}

export function completeEffect(lifecycle, id, outcome = null) {
  if (!lifecycle.active || lifecycle.active.id !== id || lifecycle.active.status !== "resolving" || !outcomeValid(outcome)) return false;
  return settle(lifecycle, outcome);
}

export function cancelEffect(lifecycle, ticket, outcome = null) {
  const choice = lifecycle.active?.choice;
  if (!lifecycle.active || lifecycle.active.status !== "awaiting-choice" || !choice || !choice.cancellable || !ticketMatches(choice, ticket) || !outcomeValid(outcome)) return false;
  return settle(lifecycle, outcome);
}

export function enqueueEffect(lifecycle, descriptor) {
  const copied = descriptorValid(descriptor);
  if (lifecycle.winner || !copied.ok) return false;
  lifecycle.queue.push(copied.value);
  return true;
}

export function beginNextEffect(lifecycle) {
  if (lifecycle.active || lifecycle.winner || !lifecycle.queue.length) return null;
  const descriptor = lifecycle.queue[0];
  const id = beginEffect(lifecycle, descriptor);
  if (id) lifecycle.queue.shift();
  return id;
}

function coordinatorDescriptor(descriptor) {
  const copied = descriptorValid(descriptor);
  const reserved = new Set(["declarationId", "frameId", "waitId", "effectId", "choiceId", "actorId", "revision", "declaredRevision", "status", "resultLock", "lifecycle"]);
  return copied.ok && typeof copied.value.handlerId === "string" && copied.value.handlerId.length > 0
    && !Object.keys(copied.value).some((key) => reserved.has(key)) ? copied : { ok: false };
}

export function createResolutionCoordinator() {
  return { version: 1, phase: "open", nextFrameId: 0, nextDeclarationId: 0, nextWaitId: 0, revision: 0,
    activeFrame: null, declaredQueue: [], waits: [], resultLock: null };
}

export function declareResolution(coordinator, descriptor) {
  const copied = coordinatorDescriptor(descriptor);
  if (coordinator.phase !== "open" || !copied.ok) return null;
  const declarationId = `declaration-${coordinator.nextDeclarationId + 1}`;
  coordinator.nextDeclarationId += 1; coordinator.revision += 1;
  coordinator.declaredQueue.push({ ...copied.value, declarationId, declaredRevision: coordinator.revision, status: "declared" });
  return declarationId;
}

export function beginDeclaredResolution(coordinator) {
  if (coordinator.activeFrame || !coordinator.declaredQueue.length || coordinator.phase === "ended") return null;
  const declaration = coordinator.declaredQueue[0]; const payload = copyJsonData({ handlerId: declaration?.handlerId, args: declaration?.args ?? null });
  const lifecycle = createEffectLifecycle(); const effectId = payload.ok && typeof payload.value.handlerId === "string" ? beginEffect(lifecycle, declaration) : null;
  if (!effectId) return null;
  const frameId = `frame-${coordinator.nextFrameId + 1}`;
  coordinator.declaredQueue.shift(); coordinator.nextFrameId += 1; coordinator.revision += 1;
  coordinator.activeFrame = { frameId, declarationId: declaration.declarationId, kind: declaration.kind, playerId: declaration.playerId,
    sourceUid: declaration.sourceUid ?? null, handlerId: payload.value.handlerId, args: payload.value.args,
    lifecycle, effectId, operationCursor: 0, operationState: null, status: "resolving" };
  return copyJsonData(coordinator.activeFrame).value;
}

export function suspendResolution(coordinator, frameId, actorId, requestData, kind = "internal-choice") {
  const copied = copyJsonData(requestData); const frame = coordinator.activeFrame;
  if (!frame || frame.frameId !== frameId || frame.status !== "resolving" || !copied.ok || !["player", "ai"].includes(actorId) || !["internal-choice", "declaration-choice"].includes(kind)) return null;
  const lifecycleTicket = suspendEffect(frame.lifecycle, frame.effectId, { operationCursor: frame.operationCursor, operationState: frame.operationState, requestData: copied.value });
  if (!lifecycleTicket) return null;
  const wait = { waitId: `wait-${coordinator.nextWaitId + 1}`, frameId, effectId: lifecycleTicket.effectId,
    choiceId: lifecycleTicket.choiceId, revision: coordinator.revision + 1, actorId, kind, requestData: copied.value };
  coordinator.nextWaitId += 1; coordinator.revision += 1; frame.status = "awaiting-choice"; coordinator.waits.push(wait);
  return { frameId: wait.frameId, waitId: wait.waitId, effectId: wait.effectId, choiceId: wait.choiceId, revision: wait.revision, actorId: wait.actorId };
}

export function resumeResolution(coordinator, ticket) {
  const copied = copyJsonData(ticket); const frame = coordinator.activeFrame;
  if (!copied.ok || !frame || frame.status !== "awaiting-choice" || !copied.value || Object.keys(copied.value).length !== 6) return null;
  const index = coordinator.waits.findIndex((wait) => wait.waitId === copied.value.waitId && wait.frameId === copied.value.frameId && wait.frameId === frame.frameId
    && wait.revision === copied.value.revision && wait.actorId === copied.value.actorId && wait.effectId === copied.value.effectId && wait.choiceId === copied.value.choiceId
    && frame.effectId === wait.effectId && frame.lifecycle.active?.id === wait.effectId && frame.lifecycle.active?.choice?.choiceId === wait.choiceId);
  if (index < 0) return null;
  const [wait] = coordinator.waits.splice(index, 1); const resumed = resumeEffect(frame.lifecycle, copied.value);
  if (!resumed) { coordinator.waits.splice(index, 0, wait); return null; }
  frame.operationCursor = resumed.continuation.operationCursor; frame.operationState = resumed.continuation.operationState;
  coordinator.revision += 1; frame.status = "resolving";
  return copyJsonData(wait).value;
}

export function completeResolution(coordinator, frameId, outcome = null, reasons = []) {
  const copiedReasons = copyJsonData(reasons); const frame = coordinator.activeFrame;
  if (!frame || frame.frameId !== frameId || frame.status !== "resolving" || coordinator.waits.some((wait) => wait.frameId === frameId) || !outcomeValid(outcome) || !copiedReasons.ok || !Array.isArray(copiedReasons.value)) return false;
  if (!completeEffect(frame.lifecycle, frame.effectId, null)) return false;
  coordinator.activeFrame = null; coordinator.revision += 1;
  if (outcome !== null && coordinator.resultLock === null) {
    coordinator.resultLock = { outcome, frameId, declarationId: frame.declarationId, boundaryRevision: coordinator.revision, reasons: copiedReasons.value };
    coordinator.phase = "locked-draining";
  }
  if (!coordinator.declaredQueue.length && coordinator.resultLock) coordinator.phase = "ended";
  return true;
}
