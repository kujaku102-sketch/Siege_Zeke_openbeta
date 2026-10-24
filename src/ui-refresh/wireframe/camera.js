// Camera state only. Never selects cards or submits game commands.
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export function cameraView(state, aspect) {
  const zoom = clamp(state.zoom, 1, 1.65), baseWidth = 900 * aspect;
  const width = baseWidth / zoom, height = 900 / zoom;
  const panX = clamp(state.panX, -(baseWidth - width) / 2 - 110, (baseWidth - width) / 2 + 110);
  const panY = clamp(state.panY, -(900 - height) / 2 - 70, (900 - height) / 2 + 70);
  return { zoom, panX, panY, x: 800 + panX - width / 2, y: 450 + panY - height / 2, width, height };
}
export function attachBoardCamera(board) {
  const lifetime = new AbortController();
  const listen = (target, type, handler, options = {}) => target.addEventListener(type, handler,
    { ...(typeof options === 'boolean' ? {capture:options} : options), signal:lifetime.signal });
  let state = { zoom: 1, panX: 0, panY: 0 }, view, gesture = null, moved = false, blockClick = false;
  const pointers = new Map();
  const paint = () => {
    const rect = board.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    view = cameraView(state, rect.width / rect.height);
    state = { zoom: view.zoom, panX: view.panX, panY: view.panY };
    board.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`);
    board.dispatchEvent(new CustomEvent('board-camera-change', { bubbles:true }));
  };
  const center = () => {
    const [a,b] = [...pointers.values()];
    return b ? { x: (a.x+b.x)/2, y: (a.y+b.y)/2, distance: Math.hypot(a.x-b.x,a.y-b.y) } : { ...a, distance: 0 };
  };
  const transform = (from, to, factor = 1) => {
    const rect = board.getBoundingClientRect();
    const worldX = view.x + (from.x-rect.left)/rect.width*view.width;
    const worldY = view.y + (from.y-rect.top)/rect.height*view.height;
    const zoom = clamp(state.zoom * factor, 1, 1.65);
    const width = 900*rect.width/rect.height/zoom, height = 900/zoom;
    state = { zoom,
      panX: worldX-(to.x-rect.left)/rect.width*width + width/2-800,
      panY: worldY-(to.y-rect.top)/rect.height*height + height/2-450 };
    paint();
  };
  const cancelSelectionGesture = () => {
    moved = true; blockClick = true;
    board.classList.add('camera-dragging');
    board.dispatchEvent(new CustomEvent('board-camera-gesture', { bubbles: true }));
  };
  listen(board, 'pointerdown', e => {
    if (e.button !== 0) return;
    if (!pointers.size) { moved = false; blockClick = false; }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture = center();
    if (pointers.size > 1) { cancelSelectionGesture(); e.stopPropagation(); }
  }, true);
  listen(board, 'pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const next = center();
    if (!moved && Math.hypot(next.x-gesture.x,next.y-gesture.y) < 7) return;
    if (!moved) cancelSelectionGesture();
    board.setPointerCapture(e.pointerId);
    transform(gesture, next, gesture.distance > 0 && next.distance > 0 ? next.distance/gesture.distance : 1);
    gesture = next;
    e.preventDefault(); e.stopPropagation();
  }, { capture: true, passive: false });
  const finish = e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (e.type === 'pointercancel') { blockClick = true; board.dispatchEvent(new CustomEvent('board-camera-gesture', { bubbles: true })); }
    if (board.hasPointerCapture(e.pointerId)) board.releasePointerCapture(e.pointerId);
    gesture = pointers.size ? center() : null;
    if (!pointers.size) board.classList.remove('camera-dragging');
  };
  listen(window, 'pointerup', finish, true);
  listen(window, 'pointercancel', finish, true);
  listen(board, 'click', e => {
    if (!blockClick || e.detail === 0) return;
    blockClick = false; e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  listen(board, 'wheel', e => {
    e.preventDefault();
    const point = { x: e.clientX, y: e.clientY };
    transform(point,point,Math.exp(-clamp(e.deltaY * (e.deltaMode===1?16:e.deltaMode===2?300:1),-150,150)*.002));
  }, { passive: false });
  listen(window, 'blur', () => {
    pointers.clear(); gesture=null; board.classList.remove('camera-dragging');
    board.dispatchEvent(new CustomEvent('board-camera-gesture', { bubbles:true }));
  });
  const observer = new ResizeObserver(paint); observer.observe(board); paint();
  const dispose = () => { observer.disconnect(); lifetime.abort(); pointers.clear(); };
  listen(window, 'pagehide', dispose, { once:true });
  return { refresh:paint, dispose };
}
