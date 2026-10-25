// Drawing pixels only. Never use these dimensions for layout or hit testing.
export const DEFAULT_RENDER_QUALITY = Object.freeze({ scale: 3, maxPixels: 8_294_400 });
export const DISPLAY_FONT = 'Georgia, serif';

export function renderResolution(width, height, quality = DEFAULT_RENDER_QUALITY, dpr = 1, maxDimension = 16384) {
  if (!(width > 0 && height > 0 && Number.isFinite(width + height))) return null;
  const requested = quality.scale === 'device' ? Math.min(Math.max(dpr || 1, 1), 2) : quality.scale;
  const scale = Math.min(requested > 0 ? requested : 1,
    Math.sqrt((quality.maxPixels || DEFAULT_RENDER_QUALITY.maxPixels) / (width * height)),
    maxDimension / width, maxDimension / height);
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), scale };
}

// Coalesce resize / DPR changes; listeners do not survive the owning surface.
export function observeDrawing(element, draw) {
  const win = element.ownerDocument.defaultView;
  let frame = 0, disposed = false, media;
  const request = () => {
    if (!disposed && !frame) frame = win.requestAnimationFrame(() => { frame = 0; draw(); });
  };
  const watchDpr = () => {
    media?.removeEventListener('change', changed);
    media = win.matchMedia(`(resolution: ${win.devicePixelRatio || 1}dppx)`);
    media.addEventListener('change', changed);
  };
  const changed = () => { watchDpr(); request(); };
  const observer = new ResizeObserver(request);
  observer.observe(element); watchDpr();
  win.addEventListener('resize', request);
  element.ownerDocument.fonts?.addEventListener('loadingdone', request);
  return { request, dispose() {
    disposed = true; observer.disconnect(); win.cancelAnimationFrame(frame);
    media?.removeEventListener('change', changed); win.removeEventListener('resize', request);
    element.ownerDocument.fonts?.removeEventListener('loadingdone', request);
  } };
}

// A lost WebGL context is answered at once, not waited for: the owner drops to its HTML/SVG form
// (onLost) and returns to the drawn form when the browser gives the context back (onRestored).
export function watchContextLoss(canvas, { onLost = () => {}, onRestored = () => {} } = {}) {
  const lost = event => { event.preventDefault(); onLost(); };
  const restored = () => onRestored();
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  return () => { canvas.removeEventListener('webglcontextlost', lost); canvas.removeEventListener('webglcontextrestored', restored); };
}

export function drawingLimit(renderer) {
  const gl = renderer.getContext(), viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  return Math.min(renderer.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), ...viewport);
}
