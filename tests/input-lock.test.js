import test from "node:test";
import assert from "node:assert/strict";
import { liveInputLocked, syncLiveInputLocks } from "../src/ui-refresh/input-lock.js";
import { activateCrtTarget, shouldActivateCrtPointer } from "../src/ui-refresh/entry-crt-viewport.js";

function node(entry = false) {
  return { inert: false, matches: selector => entry && selector === ".r2-entry" };
}

function root(nodes) {
  return { querySelectorAll: () => nodes };
}

test("title options wait for CRT readiness and return to HTML fallback", () => {
  const entry = node(true), main = node();
  syncLiveInputLocks(root([entry, main]), { optionsOpen: true, entryCrtReady: false });
  assert.equal(entry.inert, true);
  assert.equal(main.inert, true);
  syncLiveInputLocks(root([entry, main]), { optionsOpen: true, entryCrtReady: true });
  assert.equal(entry.inert, false);
  assert.equal(main.inert, true);
  syncLiveInputLocks(root([entry, main]), { optionsOpen: true, entryCrtReady: false });
  assert.equal(entry.inert, true);
  assert.equal(main.inert, true);
});

test("closing title options releases the live input regions", () => {
  const nodes = [node(true), node(), node(), node()];
  syncLiveInputLocks(root(nodes), { optionsOpen: true });
  syncLiveInputLocks(root(nodes), { optionsOpen: false });
  assert.ok(nodes.every(item => item.inert === false));
});

test("unique and result modals keep priority over CRT readiness", () => {
  const entry = node(true);
  assert.equal(liveInputLocked(entry, { optionsOpen: true, entryCrtReady: true, uniqueOpen: true }), true);
  assert.equal(liveInputLocked(entry, { optionsOpen: true, entryCrtReady: true, resultOpen: true }), true);
});

test("repeated readiness synchronization is idempotent", () => {
  const entry = node(true), other = node();
  const scope = root([entry, other]);
  for (let index = 0; index < 3; index += 1) syncLiveInputLocks(scope, { optionsOpen: true, entryCrtReady: true });
  assert.equal(entry.inert, false);
  assert.equal(other.inert, true);
});

test("non-entry live regions stay locked behind an open title modal", () => {
  const main = node(), utilities = node(), overlays = node();
  syncLiveInputLocks(root([main, utilities, overlays]), { optionsOpen: true, entryCrtReady: true });
  assert.ok([main, utilities, overlays].every(item => item.inert === true));
});

test("CRT pointer activation accepts a tap and rejects drags or changed targets", () => {
  const target = {};
  const start = { pointerId: 7, clientX: 100, clientY: 200, target };
  assert.equal(shouldActivateCrtPointer(start, { pointerId: 7, clientX: 108, clientY: 206, target }), true);
  assert.equal(shouldActivateCrtPointer(start, { pointerId: 7, clientX: 120, clientY: 200, target }), false);
  assert.equal(shouldActivateCrtPointer(start, { pointerId: 8, clientX: 100, clientY: 200, target }), false);
  assert.equal(shouldActivateCrtPointer(start, { pointerId: 7, clientX: 100, clientY: 200, target: {} }), false);
});

test("CRT target activation focuses once and dispatches one bubbling click", () => {
  const calls = [];
  const event = { type: "click", bubbles: true };
  const target = {
    focus: options => calls.push(["focus", options]),
    dispatchEvent: received => { calls.push(["dispatch", received]); return true; }
  };
  assert.equal(activateCrtTarget(target, () => event), true);
  assert.deepEqual(calls, [["focus", { preventScroll: true }], ["dispatch", event]]);
});
