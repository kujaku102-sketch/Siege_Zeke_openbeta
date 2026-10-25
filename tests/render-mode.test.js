import test from 'node:test';
import assert from 'node:assert/strict';
import { RENDER_STORAGE_KEY, readRenderPreference, urlRenderPreference, resolveRenderMode } from '../src/ui-refresh/render-mode.js';
import { isIosWebKit } from '../src/ui-refresh/model.js';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36'
};
const detect = (userAgent, platform = '', maxTouchPoints = 0) => ({ iosWebKit: isIosWebKit({ userAgent, platform, maxTouchPoints }) });

test('render mode: the stored key sits with the other UI preferences', () => {
  assert.equal(RENDER_STORAGE_KEY, 'sz-ui-render');
});

test('render mode follows URL > saved > detection > default', () => {
  const ios = detect(UA.iphone), desk = detect(UA.mac, 'MacIntel', 0);
  assert.deepEqual(resolveRenderMode({ url: '?render=full', saved: 'compat', detection: ios }), { mode: 'full', reason: 'url' });
  assert.deepEqual(resolveRenderMode({ url: 'https://x.test/pc/?e2e=1&render=compat#a', saved: 'full', detection: desk }), { mode: 'compat', reason: 'url' });
  assert.deepEqual(resolveRenderMode({ url: '?render=auto', saved: 'full', detection: ios }), { mode: 'compat', reason: 'detected' }, 'URL auto skips the saved choice');
  assert.deepEqual(resolveRenderMode({ url: '', saved: 'full', detection: ios }), { mode: 'full', reason: 'saved' });
  assert.deepEqual(resolveRenderMode({ url: '', saved: 'compat', detection: desk }), { mode: 'compat', reason: 'saved' });
  assert.deepEqual(resolveRenderMode({ url: '', saved: 'auto', detection: ios }), { mode: 'compat', reason: 'detected' });
  assert.deepEqual(resolveRenderMode({ url: '', saved: null, detection: desk }), { mode: 'full', reason: 'default' });
  assert.deepEqual(resolveRenderMode(), { mode: 'full', reason: 'default' });
});

test('render mode: iPhone, iPad and the iPadOS desktop-site Mac are detected; a Mac and Android are not', () => {
  assert.equal(resolveRenderMode({ detection: detect(UA.iphone) }).mode, 'compat');
  assert.equal(resolveRenderMode({ detection: detect(UA.ipad) }).mode, 'compat');
  assert.equal(resolveRenderMode({ detection: detect(UA.mac, 'MacIntel', 5) }).mode, 'compat');
  assert.equal(resolveRenderMode({ detection: detect(UA.mac, 'MacIntel', 0) }).mode, 'full');
  assert.equal(resolveRenderMode({ detection: detect(UA.android, 'Linux armv8l', 5) }).mode, 'full');
});

test('render mode: a broken saved value or URL reads as auto', () => {
  for (const value of ['', 'COMPAT', 'lite', '{"mode":"full"}', undefined, null, 0, true]) assert.equal(readRenderPreference(value), 'auto');
  assert.equal(urlRenderPreference('?render=FULL'), null);
  assert.equal(urlRenderPreference('?render='), null);
  assert.equal(urlRenderPreference(undefined), null);
  assert.deepEqual(resolveRenderMode({ url: '?render=bogus', saved: 'nonsense', detection: detect(UA.iphone) }), { mode: 'compat', reason: 'detected' });
});

test('render mode: a lost context drops to compat even after full was chosen; choosing again comes back', () => {
  const desk = detect(UA.mac, 'MacIntel', 0), ios = detect(UA.iphone);
  assert.deepEqual(resolveRenderMode({ saved: 'full', detection: ios, contextLost: true }), { mode: 'compat', reason: 'context-lost' });
  assert.deepEqual(resolveRenderMode({ url: '?render=full', detection: desk, contextLost: true }), { mode: 'compat', reason: 'context-lost' });
  assert.deepEqual(resolveRenderMode({ saved: 'auto', detection: desk, contextLost: true }), { mode: 'compat', reason: 'context-lost' });
  // The host clears contextLost when the player picks a mode again: auto then follows detection.
  assert.deepEqual(resolveRenderMode({ saved: 'auto', detection: desk, contextLost: false }), { mode: 'full', reason: 'default' });
  assert.deepEqual(resolveRenderMode({ saved: 'full', detection: ios, contextLost: false }), { mode: 'full', reason: 'saved' });
});
