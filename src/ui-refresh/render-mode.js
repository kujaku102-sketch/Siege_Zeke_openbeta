// Render mode of the whole app: 'full' draws the WebGL scenes (3D board, HUD, CRT title, logo
// noise, result shader); 'compat' keeps the wireframe SVG/CSS only (V092-09). DOM-free.
// Order: URL (?render=, never saved) > saved preference > detection (iOS WebKit) > default.
// A lost WebGL context drops to 'compat' for the session unless the player chose it again.

export const RENDER_STORAGE_KEY = 'sz-ui-render';
export const RENDER_PREFERENCES = Object.freeze(['auto', 'compat', 'full']);

// A stored value from an older build, a typo or another tab's garbage reads as 'auto'.
export const readRenderPreference = value => RENDER_PREFERENCES.includes(value) ? value : 'auto';

// `url` may be a whole address, a search string ("?render=full") or empty.
const urlQuery = url => {
  const text = String(url ?? '');
  return new URLSearchParams(text.includes('?') ? text.slice(text.indexOf('?') + 1).split('#')[0] : text);
};
export function urlRenderPreference(url) {
  const value = urlQuery(url).get('render');
  return RENDER_PREFERENCES.includes(value) ? value : null;
}

// ?renderScale= is a sample route for comparing full-mode drawing scales (e.g. 1, 0.5): never
// saved, clamped to the range, ignored when not a number. Compat keeps its own scale.
export const RENDER_SCALE_RANGE = Object.freeze([0.25, 3]);
export function urlRenderScale(url) {
  const raw = urlQuery(url).get('renderScale');
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(RENDER_SCALE_RANGE[1], Math.max(RENDER_SCALE_RANGE[0], value)) : null;
}

export function resolveRenderMode({ url = '', saved = null, detection = {}, contextLost = false } = {}) {
  const fromUrl = urlRenderPreference(url);
  const preference = fromUrl ?? readRenderPreference(saved);
  const source = fromUrl ? 'url' : 'saved';
  if (preference === 'compat') return { mode: 'compat', reason: source };
  if (contextLost) return { mode: 'compat', reason: 'context-lost' };
  if (preference === 'full') return { mode: 'full', reason: source };
  return detection?.iosWebKit === true ? { mode: 'compat', reason: 'detected' } : { mode: 'full', reason: 'default' };
}
