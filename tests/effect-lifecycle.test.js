import test from "node:test";
import assert from "node:assert/strict";
import { beginDeclaredResolution, beginEffect, beginNextEffect, cancelEffect, completeEffect, completeResolution, createEffectLifecycle, createResolutionCoordinator, declareResolution, enqueueEffect, resumeEffect, resumeResolution, suspendEffect, suspendResolution } from "../src/game/effect-lifecycle.js";

const descriptor = (kind = "spell", playerId = "player") => ({ kind, playerId, sourceUid: "source-1" });
const snapshot = (value) => JSON.parse(JSON.stringify(value));

test("1 begin assigns owner, copies descriptor, and rejects a second active owner", () => {
  const state = createEffectLifecycle(); const input = descriptor(); const id = beginEffect(state, input); input.kind = "changed";
  assert.equal(id, "effect-1"); assert.equal(state.active.descriptor.kind, "spell"); const before = snapshot(state);
  assert.equal(beginEffect(state, descriptor()), null); assert.deepEqual(state, before);
});

test("2 suspend and resume copy continuation and rotate tickets for a second choice", () => {
  const state = createEffectLifecycle(); const id = beginEffect(state, descriptor()); const continuation = { target: ["a"] };
  const first = suspendEffect(state, id, continuation); continuation.target.push("tamper"); assert.deepEqual(resumeEffect(state, first), { effectId: id, choiceId: first.choiceId, continuation: { target: ["a"] } });
  const second = suspendEffect(state, id, { target: ["b"] }); assert.notEqual(second.choiceId, first.choiceId); assert.deepEqual(resumeEffect(state, second), { effectId: id, choiceId: second.choiceId, continuation: { target: ["b"] } });
  const nullable = suspendEffect(state, id, null); assert.deepEqual(resumeEffect(state, nullable), { effectId: id, choiceId: nullable.choiceId, continuation: null });
});

test("3 foreign, stale, and duplicate tickets leave lifecycle unchanged", () => {
  const state = createEffectLifecycle(); const id = beginEffect(state, descriptor()); const ticket = suspendEffect(state, id, { x: 1 });
  for (const invalid of [{ ...ticket, effectId: "other" }, { ...ticket, choiceId: "other" }]) { const before = snapshot(state); assert.equal(resumeEffect(state, invalid), null); assert.deepEqual(state, before); }
  assert.deepEqual(resumeEffect(state, ticket), { effectId: id, choiceId: ticket.choiceId, continuation: { x: 1 } }); const before = snapshot(state); assert.equal(resumeEffect(state, ticket), null); assert.deepEqual(state, before);
});

test("4 complete rejects pending, foreign ids, and invalid outcomes", () => {
  const state = createEffectLifecycle(); const id = beginEffect(state, descriptor()); const ticket = suspendEffect(state, id, {}); let before = snapshot(state);
  assert.equal(completeEffect(state, id), false); assert.deepEqual(state, before); assert.deepEqual(resumeEffect(state, ticket), { effectId: id, choiceId: ticket.choiceId, continuation: {} }); before = snapshot(state);
  assert.equal(completeEffect(state, "other"), false); assert.equal(completeEffect(state, id, "invalid"), false); assert.deepEqual(state, before);
});

test("5 cancellation requires saved cancellable authority and cannot be escalated", () => {
  const state = createEffectLifecycle(); const id = beginEffect(state, descriptor()); const optional = suspendEffect(state, id, { paid: true }, { cancellable: true });
  assert.equal(cancelEffect(state, optional), true); assert.equal(state.active, null); assert.equal(cancelEffect(state, optional), false);
  const required = beginEffect(state, descriptor()); const mandatory = suspendEffect(state, required, { paid: true }); const forged = { ...mandatory, cancellable: true }; const before = snapshot(state);
  assert.equal(cancelEffect(state, forged), false); assert.deepEqual(state, before);
});

test("6 queued effects do not alter parent ownership and begin FIFO after completion", () => {
  const state = createEffectLifecycle(); const parent = beginEffect(state, descriptor("parent")); const ticket = suspendEffect(state, parent, { choose: 1 });
  assert.equal(enqueueEffect(state, descriptor("child-a")), true); assert.equal(enqueueEffect(state, descriptor("child-b", "ai")), true); assert.equal(state.active.id, parent); assert.equal(state.active.choice.choiceId, ticket.choiceId); assert.equal(beginNextEffect(state), null);
  resumeEffect(state, ticket); completeEffect(state, parent); const child = beginNextEffect(state); assert.equal(child, "effect-2"); assert.equal(state.active.descriptor.kind, "child-a"); completeEffect(state, child); const childB = beginNextEffect(state); assert.equal(state.active.descriptor.kind, "child-b"); assert.equal(childB, "effect-3");
});

test("7 every terminal outcome clears queue and blocks future work", () => {
  for (const outcome of ["player", "ai", "draw"]) { const state = createEffectLifecycle(); const id = beginEffect(state, descriptor()); enqueueEffect(state, descriptor("later")); assert.equal(completeEffect(state, id, outcome), true); assert.equal(state.winner, outcome); assert.deepEqual(state.queue, []); const before = snapshot(state); assert.equal(beginEffect(state, descriptor()), null); assert.equal(enqueueEffect(state, descriptor()), false); assert.equal(beginNextEffect(state), null); assert.deepEqual(state, before); }
});

test("8 JSON and structured clones resume and complete independently", () => {
  const resolving = createEffectLifecycle(); const resolvingId = beginEffect(resolving, descriptor()); const resolvingCopy = structuredClone(resolving); assert.equal(completeEffect(resolvingCopy, resolvingId), true); assert.notEqual(resolving.active, null);
  const waiting = createEffectLifecycle(); const waitingId = beginEffect(waiting, descriptor()); const ticket = suspendEffect(waiting, waitingId, { x: 1 }); const jsonCopy = JSON.parse(JSON.stringify(waiting)); assert.deepEqual(resumeEffect(jsonCopy, ticket), { effectId: waitingId, choiceId: ticket.choiceId, continuation: { x: 1 } }); assert.equal(completeEffect(jsonCopy, waitingId), true); assert.equal(waiting.active.status, "awaiting-choice");
});

test("9 invalid JSON data never advances counters or mutates state", () => {
  const invalid = [{ kind: "", playerId: "player" }, { kind: "x", playerId: "bad" }, { kind: "x", playerId: "player", sourceUid: undefined }, { kind: "x", playerId: "player", n: NaN }, { kind: "x", playerId: "player", fn() {} }]; const cycle = { kind: "x", playerId: "player" }; cycle.self = cycle; invalid.push(cycle);
  for (const input of invalid) { const state = createEffectLifecycle(); const before = snapshot(state); assert.equal(beginEffect(state, input), null); assert.deepEqual(state, before); }
  const state = createEffectLifecycle(); const id = beginEffect(state, descriptor()); for (const value of [undefined, () => {}, { n: NaN }]) { const before = snapshot(state); assert.equal(suspendEffect(state, id, value), null); assert.deepEqual(state, before); }
});

test("10 latest fixture state, not intermediate STR zero, determines a nonterminal completion", () => {
  const state = createEffectLifecycle(); const game = { player: { str: 5 }, ai: { str: 5 } }; const id = beginEffect(state, descriptor()); game.ai.str = 0; const ticket = suspendEffect(state, id, { step: "heal" }); assert.equal(state.winner, null); resumeEffect(state, ticket); game.ai.str = 1; const outcome = game.player.str <= 0 && game.ai.str <= 0 ? "draw" : game.ai.str <= 0 ? "player" : game.player.str <= 0 ? "ai" : null; assert.equal(completeEffect(state, id, outcome), true); assert.equal(state.winner, null);
});

test("11 latest simultaneous zero is draw and cancellation can receive that outcome", () => {
  const state = createEffectLifecycle(); const id = beginEffect(state, descriptor()); enqueueEffect(state, descriptor("waiting")); const ticket = suspendEffect(state, id, { optional: true }, { cancellable: true }); const game = { player: 0, ai: 0 }; const outcome = game.player <= 0 && game.ai <= 0 ? "draw" : null; assert.equal(cancelEffect(state, ticket, outcome), true); assert.equal(state.winner, "draw"); assert.deepEqual(state.queue, []); assert.equal(beginNextEffect(state), null);
});

test("12 lifecycle does not roll back caller-owned costs for required resume or optional cancellation", () => {
  const requiredState = createEffectLifecycle(); const requiredId = beginEffect(requiredState, descriptor()); const requiredGame = { cost: 3 }; const requiredTicket = suspendEffect(requiredState, requiredId, { paid: true }); assert.equal(cancelEffect(requiredState, requiredTicket), false); assert.equal(requiredGame.cost, 3); resumeEffect(requiredState, requiredTicket); completeEffect(requiredState, requiredId);
  const optionalState = createEffectLifecycle(); const optionalId = beginEffect(optionalState, descriptor()); const optionalGame = { cost: 2 }; const optionalTicket = suspendEffect(optionalState, optionalId, { paid: true }, { cancellable: true }); cancelEffect(optionalState, optionalTicket); assert.equal(optionalGame.cost, 2);
});

test("G8 rejects null options and hostile hidden values without executing getters or toJSON", () => {
  const state = createEffectLifecycle(); const id = beginEffect(state, descriptor());
  const cases = [];
  let toJsonCalls = 0; const hiddenToJson = { value: 1 }; Object.defineProperty(hiddenToJson, "toJSON", { value() { toJsonCalls += 1; }, enumerable: false }); cases.push(hiddenToJson);
  let getterCalls = 0; const getter = {}; Object.defineProperty(getter, "value", { get() { getterCalls += 1; return 1; }, enumerable: true }); cases.push(getter);
  const symbol = { value: 1 }; symbol[Symbol("hidden")] = 1; cases.push(symbol);
  const arrayToJson = [1]; arrayToJson.toJSON = () => 1; cases.push(arrayToJson);
  for (const continuation of [null, ...cases]) { const before = snapshot(state); assert.equal(suspendEffect(state, id, continuation, null), null); assert.deepEqual(state, before); }
  for (const continuation of cases) { const before = snapshot(state); assert.equal(suspendEffect(state, id, continuation), null); assert.deepEqual(state, before); }
  assert.equal(toJsonCalls, 0); assert.equal(getterCalls, 0);
});

test("G8 copies nested and __proto__ data without invoking JSON serialization", () => {
  const state = createEffectLifecycle(); const input = { kind: "nested", playerId: "player", nested: { list: [1, { ok: true }] } };
  Object.defineProperty(input.nested, "__proto__", { value: { safe: true }, enumerable: true, configurable: true, writable: true });
  const id = beginEffect(state, input); input.nested.list[1].ok = false; assert.equal(state.active.descriptor.nested.list[1].ok, true); assert.equal(Object.getPrototypeOf(state.active.descriptor.nested), Object.prototype); assert.deepEqual(Object.getOwnPropertyDescriptor(state.active.descriptor.nested, "__proto__").value, { safe: true });
  const ticket = suspendEffect(state, id, { nested: input.nested }); input.nested.list.push(2); assert.equal(resumeEffect(state, ticket).continuation.nested.list.length, 2);
});

test("G9 rejects self, mutual, and array cycles in descriptors and continuations", () => {
  const self = descriptor("self"); self.self = self;
  const left = descriptor("mutual"); const right = { left }; left.right = right;
  const array = []; array.push(array);
  for (const input of [self, left, { kind: "array", playerId: "player", array }]) { const state = createEffectLifecycle(); const before = snapshot(state); assert.equal(beginEffect(state, input), null); assert.deepEqual(state, before); }
  for (const continuation of [self, left, array]) { const state = createEffectLifecycle(); const id = beginEffect(state, descriptor()); const before = snapshot(state); assert.equal(suspendEffect(state, id, continuation), null); assert.deepEqual(state, before); }
});

test("G9 permits completed shared references while rejecting primitive options", () => {
  const shared = { value: 1 }; const state = createEffectLifecycle(); const id = beginEffect(state, { kind: "shared", playerId: "player", left: shared, right: shared });
  assert.equal(state.active.descriptor.left, state.active.descriptor.right); const continuation = { left: shared, right: shared }; const ticket = suspendEffect(state, id, continuation); assert.equal(ticket.continuation.left, ticket.continuation.right);
  const optionsState = createEffectLifecycle(); const optionsId = beginEffect(optionsState, descriptor()); for (const options of [1, true, "yes"]) { const before = snapshot(optionsState); assert.equal(suspendEffect(optionsState, optionsId, {}, options), null); assert.deepEqual(optionsState, before); }
  assert.ok(suspendEffect(optionsState, optionsId, {}));
});

test("G10 coordinator assigns global declaration and frame IDs then drains FIFO", () => {
  const coordinator = createResolutionCoordinator(); const first = { ...descriptor("first"), handlerId: "first" }; const second = { ...descriptor("second", "ai"), handlerId: "second" };
  assert.equal(declareResolution(coordinator, first), "declaration-1"); assert.equal(declareResolution(coordinator, second), "declaration-2"); const frame = beginDeclaredResolution(coordinator); assert.equal(frame.frameId, "frame-1"); assert.equal(frame.declarationId, "declaration-1"); assert.equal(completeResolution(coordinator, frame.frameId), true); assert.equal(beginDeclaredResolution(coordinator).declarationId, "declaration-2");
});

test("G10 coordinator ticket rejects stale actor and revision without mutation", () => {
  const coordinator = createResolutionCoordinator(); declareResolution(coordinator, { ...descriptor(), handlerId: "handler" }); const frame = beginDeclaredResolution(coordinator); const wait = suspendResolution(coordinator, frame.frameId, "player", { selected: [] });
  for (const ticket of [{ ...wait, actorId: "ai" }, { ...wait, revision: 0 }]) { const before = snapshot(coordinator); assert.equal(resumeResolution(coordinator, ticket), null); assert.deepEqual(coordinator, before); }
  assert.equal(resumeResolution(coordinator, wait).waitId, wait.waitId);
});

test("G10 result locks first outcome, rejects new declarations, drains declared work before ended", () => {
  const coordinator = createResolutionCoordinator(); declareResolution(coordinator, { ...descriptor("winner"), handlerId: "winner" }); declareResolution(coordinator, { ...descriptor("declared", "ai"), handlerId: "declared" }); const first = beginDeclaredResolution(coordinator);
  assert.equal(completeResolution(coordinator, first.frameId, "player", ["STR"]), true); assert.equal(coordinator.phase, "locked-draining"); assert.equal(declareResolution(coordinator, { ...descriptor(), handlerId: "late" }), null); const declared = beginDeclaredResolution(coordinator); assert.equal(completeResolution(coordinator, declared.frameId, "draw"), true); assert.equal(coordinator.resultLock.outcome, "player"); assert.equal(coordinator.phase, "ended");
});

test("G12 reserved coordinator descriptor keys are rejected without mutation", () => {
  const keys = ["declarationId", "frameId", "waitId", "effectId", "choiceId", "actorId", "revision", "declaredRevision", "status", "resultLock", "lifecycle"];
  for (const key of keys) { const coordinator = createResolutionCoordinator(); const before = snapshot(coordinator); assert.equal(declareResolution(coordinator, { ...descriptor(), handlerId: "h", [key]: "forged" }), null); assert.deepEqual(coordinator, before); }
});

test("G12 missing or forged six-field tickets are rejected without mutation", () => {
  const coordinator = createResolutionCoordinator(); declareResolution(coordinator, { ...descriptor(), handlerId: "h" }); const frame = beginDeclaredResolution(coordinator); const ticket = suspendResolution(coordinator, frame.frameId, "player", { pick: 1 });
  for (const key of ["frameId", "waitId", "effectId", "choiceId", "revision", "actorId"]) { const missing = { ...ticket }; delete missing[key]; const before = snapshot(coordinator); assert.equal(resumeResolution(coordinator, missing), null); assert.deepEqual(coordinator, before); const forged = { ...ticket, [key]: key === "actorId" ? "ai" : `${ticket[key]}-x` }; assert.equal(resumeResolution(coordinator, forged), null); assert.deepEqual(coordinator, before); }
});

test("G12 declared payload survives JSON roundtrip and inner lifecycle stays synchronized", () => {
  const failed = createResolutionCoordinator(); failed.declaredQueue.push({ kind: "bad", playerId: "player", handlerId: null }); const before = snapshot(failed); assert.equal(beginDeclaredResolution(failed), null); assert.deepEqual(failed, before);
  const coordinator = createResolutionCoordinator(); const args = { nested: [1] }; assert.equal(declareResolution(coordinator, { ...descriptor(), handlerId: "h", args }), "declaration-1"); args.nested.push(2); const frame = beginDeclaredResolution(coordinator); assert.equal(frame.frameId, "frame-1"); assert.deepEqual(frame.args, { nested: [1] }); const ticket = suspendResolution(coordinator, frame.frameId, "player", {}); const restored = JSON.parse(JSON.stringify(coordinator)); assert.ok(resumeResolution(restored, ticket)); assert.equal(restored.waits.length, 0); assert.equal(restored.activeFrame.status, "resolving"); assert.equal(restored.activeFrame.lifecycle.active.status, "resolving"); assert.equal(completeResolution(restored, frame.frameId), true); assert.equal(restored.activeFrame, null); assert.equal(coordinator.activeFrame.status, "awaiting-choice");
});

test("G12 restored coordinator continues global IDs and never reuses a six-field ticket tuple", () => {
  const coordinator = createResolutionCoordinator(); assert.equal(declareResolution(coordinator, { ...descriptor(), handlerId: "a" }), "declaration-1"); let frame = beginDeclaredResolution(coordinator); const first = suspendResolution(coordinator, frame.frameId, "player", {}); assert.deepEqual(first, { frameId: "frame-1", waitId: "wait-1", effectId: "effect-1", choiceId: "choice-1", revision: 3, actorId: "player" }); assert.ok(resumeResolution(coordinator, first)); assert.equal(completeResolution(coordinator, frame.frameId), true);
  const restored = JSON.parse(JSON.stringify(coordinator)); assert.equal(declareResolution(restored, { ...descriptor("b"), handlerId: "b" }), "declaration-2"); frame = beginDeclaredResolution(restored); const second = suspendResolution(restored, frame.frameId, "player", {}); assert.deepEqual(second, { frameId: "frame-2", waitId: "wait-2", effectId: "effect-1", choiceId: "choice-1", revision: 8, actorId: "player" }); assert.notDeepEqual(second, first); const before = snapshot(restored); assert.equal(resumeResolution(restored, first), null); assert.deepEqual(restored, before); assert.ok(resumeResolution(restored, second)); assert.equal(completeResolution(restored, frame.frameId), true);
});

test("G12 completion rejects dangling waits and preserves first result lock while draining FIFO", () => {
  const coordinator = createResolutionCoordinator(); assert.equal(declareResolution(coordinator, { ...descriptor(), handlerId: "a" }), "declaration-1"); assert.equal(declareResolution(coordinator, { ...descriptor("b", "ai"), handlerId: "b" }), "declaration-2"); const first = beginDeclaredResolution(coordinator); const ticket = suspendResolution(coordinator, first.frameId, "player", {}); const before = snapshot(coordinator); assert.equal(completeResolution(coordinator, first.frameId, "player"), false); assert.deepEqual(coordinator, before); assert.ok(resumeResolution(coordinator, ticket)); assert.equal(completeResolution(coordinator, first.frameId, "player"), true); assert.equal(coordinator.phase, "locked-draining"); const lock = snapshot(coordinator.resultLock); const next = beginDeclaredResolution(coordinator); assert.equal(next.declarationId, "declaration-2"); assert.equal(next.kind, "b"); assert.equal(next.playerId, "ai"); assert.equal(completeResolution(coordinator, next.frameId, "draw"), true); assert.deepEqual(coordinator.resultLock, lock); assert.equal(coordinator.phase, "ended");
});

test("G13 public ticket projects exact six fields while internal wait retains request data", () => {
  const coordinator = createResolutionCoordinator(); declareResolution(coordinator, { ...descriptor(), handlerId: "h" }); const frame = beginDeclaredResolution(coordinator); const ticket = suspendResolution(coordinator, frame.frameId, "player", { selected: ["x"] });
  assert.deepEqual(Object.keys(ticket).sort(), ["actorId", "choiceId", "effectId", "frameId", "revision", "waitId"]); assert.equal(coordinator.waits[0].kind, "internal-choice"); assert.deepEqual(coordinator.waits[0].requestData, { selected: ["x"] }); assert.ok(resumeResolution(coordinator, ticket)); assert.equal(coordinator.waits.length, 0); assert.equal(coordinator.activeFrame.status, "resolving"); assert.equal(coordinator.activeFrame.lifecycle.active.status, "resolving"); assert.equal(completeResolution(coordinator, frame.frameId), true);
});

test("G13 every forged or missing public field preserves state then the original ticket resumes", () => {
  const keys = ["frameId", "waitId", "effectId", "choiceId", "revision", "actorId"];
  for (const key of keys) for (const mode of ["missing", "forged"]) {
    const coordinator = createResolutionCoordinator(); declareResolution(coordinator, { ...descriptor(), handlerId: "h" }); const frame = beginDeclaredResolution(coordinator); const ticket = suspendResolution(coordinator, frame.frameId, "player", {}); const candidate = { ...ticket };
    if (mode === "missing") delete candidate[key]; else candidate[key] = key === "revision" ? ticket.revision + 1 : key === "actorId" ? "ai" : `${ticket[key]}-forged`;
    const before = snapshot(coordinator); assert.equal(resumeResolution(coordinator, candidate), null); assert.deepEqual(coordinator, before); assert.ok(resumeResolution(coordinator, ticket));
  }
});

test("G13 duplicate and frame or inner lifecycle ticket mismatches reject before mutation", () => {
  const build = () => { const coordinator = createResolutionCoordinator(); declareResolution(coordinator, { ...descriptor(), handlerId: "h" }); const frame = beginDeclaredResolution(coordinator); return { coordinator, frame, ticket: suspendResolution(coordinator, frame.frameId, "player", {}) }; };
  for (const mutate of [(c) => { c.activeFrame.effectId = "wrong"; }, (c) => { c.activeFrame.lifecycle.active.id = "wrong"; }, (c) => { c.activeFrame.lifecycle.active.choice.choiceId = "wrong"; }, (c) => { c.activeFrame.lifecycle.active.choice.effectId = "wrong"; }]) { const { coordinator, ticket } = build(); mutate(coordinator); const before = snapshot(coordinator); assert.equal(resumeResolution(coordinator, ticket), null); assert.deepEqual(coordinator, before); }
  const { coordinator, ticket } = build(); assert.ok(resumeResolution(coordinator, ticket)); const before = snapshot(coordinator); assert.equal(resumeResolution(coordinator, ticket), null); assert.deepEqual(coordinator, before);
});
