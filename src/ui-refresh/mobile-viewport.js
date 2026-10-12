const CONSOLE_WIDTH = 210;
const CONSOLE_HEIGHT = 660;
const CHROME_HEIGHT = 68;

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// HTML layout is always calculated in CSS pixels. devicePixelRatio belongs to
// Canvas/WebGL backing stores and must never change these measurements.
export function mobileViewportMetrics({
  width,
  height,
  safeTop = 0,
  safeRight = 0,
  safeBottom = 0,
  safeLeft = 0,
} = {}) {
  const viewportWidth = Math.max(1, finite(width, 1));
  const viewportHeight = Math.max(1, finite(height, 1));
  const insets = {
    top: clamp(finite(safeTop), 0, viewportHeight / 2),
    right: clamp(finite(safeRight), 0, viewportWidth / 2),
    bottom: clamp(finite(safeBottom), 0, viewportHeight / 2),
    left: clamp(finite(safeLeft), 0, viewportWidth / 2),
  };
  const contentWidth = Math.max(1, viewportWidth - insets.left - insets.right);
  const contentHeight = Math.max(1, viewportHeight - insets.top - insets.bottom);
  const gutter = clamp(Math.min(contentWidth, contentHeight) * .012, 4, 10);
  const heightScale = Math.max(0, (contentHeight - CHROME_HEIGHT) / CONSOLE_HEIGHT);
  const widthScale = Math.max(0, contentWidth * .25 / CONSOLE_WIDTH);
  const consoleScale = clamp(Math.min(heightScale, widthScale), 0, 1);
  const consoleWidth = CONSOLE_WIDTH * consoleScale;
  const playWidth = Math.max(1, contentWidth - consoleWidth - gutter * 2);
  return Object.freeze({
    viewportWidth,
    viewportHeight,
    contentWidth,
    contentHeight,
    consoleScale,
    consoleWidth,
    playWidth,
    gutter,
    insets: Object.freeze(insets),
  });
}

function cssInset(view, content, name) {
  const style = view.getComputedStyle(content);
  const direct = Number.parseFloat(style.getPropertyValue(name));
  if (Number.isFinite(direct)) return direct;
  const fallback = ({
    '--safe-top': style.paddingTop,
    '--safe-right': style.paddingRight,
    '--safe-bottom': style.paddingBottom,
    '--safe-left': style.paddingLeft,
  })[name];
  return Number.parseFloat(fallback) || 0;
}

export function installMobileViewport(root, windowObject = root?.ownerDocument?.defaultView) {
  if (!root || !windowObject) return { sync() {}, dispose() {} };
  let view = "pc";
  const visual = windowObject.visualViewport;
  const update = () => {
    const content = root.querySelector('.r2-content');
    if (!content) return null;
    const source = visual ?? windowObject;
    const metrics = mobileViewportMetrics({
      width: source.width ?? windowObject.innerWidth,
      height: source.height ?? windowObject.innerHeight,
      safeTop: cssInset(windowObject, content, '--safe-top'),
      safeRight: cssInset(windowObject, content, '--safe-right'),
      safeBottom: cssInset(windowObject, content, '--safe-bottom'),
      safeLeft: cssInset(windowObject, content, '--safe-left'),
    });
    content.style.setProperty('--mobile-viewport-width', `${metrics.viewportWidth}px`);
    content.style.setProperty('--mobile-viewport-height', `${metrics.viewportHeight}px`);
    content.style.setProperty('--mobile-console-scale', String(view === 'mobile' ? metrics.consoleScale : 1));
    content.style.setProperty('--mobile-console-width', `${metrics.consoleWidth}px`);
    content.style.setProperty('--mobile-play-width', `${metrics.playWidth}px`);
    content.style.setProperty('--mobile-gutter', `${metrics.gutter}px`);
    const portrait = view === 'mobile' && metrics.viewportHeight > metrics.viewportWidth;
    content.inert = portrait;
    content.classList.toggle('r2-portrait-blocked', portrait);
    const rotate = root.querySelector('.r2-rotate');
    if (rotate) rotate.hidden = !portrait;
    return metrics;
  };
  const onViewportChange = () => update();
  windowObject.addEventListener('resize', onViewportChange, { passive: true });
  visual?.addEventListener('resize', onViewportChange, { passive: true });
  visual?.addEventListener('scroll', onViewportChange, { passive: true });
  return {
    sync(nextView = view) { view = nextView; return update(); },
    dispose() {
      windowObject.removeEventListener('resize', onViewportChange);
      visual?.removeEventListener('resize', onViewportChange);
      visual?.removeEventListener('scroll', onViewportChange);
    },
  };
}
