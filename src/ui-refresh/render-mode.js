// Render mode of the whole app: 'full' draws the WebGL scenes (3D board, HUD, CRT title, logo
// noise, result shader); 'compat' keeps the wireframe SVG/CSS only (V092-09). DOM-free.
// Order: URL (?render=, never saved) > saved preference > detection (iOS WebKit) > default.
// A lost WebGL context drops to 'compat' for the session unless the player chose it again.

export const RENDER_STORAGE_KEY = 'sz-ui-render';
export const RENDER_PREFERENCES = Object.freeze(['auto', 'compat', 'full']);

// A stored value from an older build, a typo or another tab's garbage reads as 'auto'.
export const readRenderPreference = value => RENDER_PREFERENCES.includes(value) ? value : 'auto';

// `url` may be a whole address, a search string ("?render=full") or empty.
export function urlRenderPreference(url) {
  const text = String(url ?? '');
  const query = text.includes('?') ? text.slice(text.indexOf('?') + 1).split('#')[0] : text;
  const value = new URLSearchParams(query).get('render');
  return RENDER_PREFERENCES.includes(value) ? value : null;
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
