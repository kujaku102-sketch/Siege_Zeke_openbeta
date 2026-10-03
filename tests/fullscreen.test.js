import test from "node:test";
import assert from "node:assert/strict";
import { isFullscreen, toggleFullscreen } from "../src/ui-refresh/fullscreen.js";

test("fullscreen requests the stable document root with navigation UI hidden", async () => {
  let requested;
  const doc = { fullscreenEnabled:true, documentElement:{ requestFullscreen(options) { requested=options; } } };
  const pending = toggleFullscreen(doc);
  assert.deepEqual(requested, { navigationUI:"hide" }); // before yielding user activation
  assert.equal((await pending).ok, true);
  assert.equal(isFullscreen(doc), false); // no optimistic status before browser event
});
test("fullscreen exit uses browser state", async () => {
  let exits=0;
  const doc = { fullscreenElement:{}, exitFullscreen:async () => { exits++; } };
  assert.equal(isFullscreen(doc), true);
  assert.equal((await toggleFullscreen(doc)).ok, true);
  assert.equal(exits, 1);
});
test("unsupported and rejected fullscreen return a recoverable message", async () => {
  for (const doc of [
    { documentElement:{} },
    { fullscreenEnabled:false, documentElement:{requestFullscreen() { throw Error("must not call"); }} },
    { documentElement:{requestFullscreen:async () => { throw Error("denied"); }} }
  ]) {
    const result = await toggleFullscreen(doc);
    assert.equal(result.ok, false);
    assert.ok(result.message);
  }
});
