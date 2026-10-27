import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Shapes kept on every screen (文豪, 2026-10-27): what is drawn keeps its box's shape, boxes sized from two bases
// keep a fixed ratio, nothing moves when Safari's toolbar comes or goes, and the tutorial guide takes the same
// share of every screen. Playwright cannot show the toolbar, so
// it is emulated: the viewport is the visible height (dvh), and in the page every `vh` is rewritten to the
// toolbar-hidden height and every `svh` to the toolbar-shown one, as Safari resolves them; on the phones the notch
// safe areas (landscape: 59px left and right, 21px bottom) go into env().
const args = process.argv.slice(2), flag = args.indexOf('--playwright-module');
const explicitPlaywrightModule = flag >= 0 ? args[flag + 1] : process.env.SIMPLE_ZEKE_PLAYWRIGHT_MODULE;
const url = args.find((arg, index) => arg !== '--playwright-module' && index !== flag + 1) ?? 'http://127.0.0.1:4173/';
async function loadPlaywright() {
  if (!explicitPlaywrightModule) throw new Error('provide --playwright-module or SIMPLE_ZEKE_PLAYWRIGHT_MODULE');
  const specifier = explicitPlaywrightModule.startsWith('file:') ? explicitPlaywrightModule : pathToFileURL(path.resolve(explicitPlaywrightModule)).href;
  if (!specifier.startsWith('file:') || !existsSync(new URL(specifier))) throw new Error('explicit Playwright module path is unavailable');
  return import(specifier);
}
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
// [label, width, toolbar-hidden height, toolbar-shown height, dpr, phone]
const SCREENS = [['1920x1080', 1920, 1080, 1080, 1, false], ['1280x720', 1280, 720, 720, 1, false],
  ['iphone-pro-852x393', 852, 393, 341, 3, true], ['iphone-pro-max-932x430', 932, 430, 378, 3, true]];

const emulateSafari = (page, large, small, phone) => page.evaluate(([L, S, phone]) => {
  const SAFE = phone ? { left: 59, right: 59, top: 0, bottom: 21 } : null;
  const rewrite = value => {
    let out = value;
    if (SAFE) out = out.replace(/env\(safe-area-inset-(left|right|top|bottom)(?:,[^)]*)?\)/g, (m, side) => `${SAFE[side]}px`);
    out = out.replace(/(-?\d*\.?\d+)svh\b/g, (m, n) => `${(Number(n) * S / 100).toFixed(3)}px`);
    return out.replace(/(-?\d*\.?\d+)vh\b/g, (m, n, i, all) => /[dl]/.test(all[i - 1] ?? '') ? m : `${(Number(n) * L / 100).toFixed(3)}px`);
  };
  const visit = rules => {
    for (const rule of rules) {
      if (rule.cssRules) visit(rule.cssRules);
      if (!rule.style) continue;
      for (let i = 0; i < rule.style.length; i += 1) {
        const name = rule.style[i], value = rule.style.getPropertyValue(name);
        if (!/\d(?:s)?vh\b/.test(value) && !(SAFE && value.includes('safe-area-inset'))) continue;
        const next = rewrite(value);
        if (next !== value) rule.style.setProperty(name, next, rule.style.getPropertyPriority(name));
      }
    }
  };
  for (const sheet of document.styleSheets) { try { visit(sheet.cssRules); } catch { /* cross-origin */ } }
  window.dispatchEvent(new Event('resize'));
}, [large, small, phone]);

const measure = page => page.evaluate(() => {
  const box = node => node.getBoundingClientRect();
  const shown = node => { const r = box(node), s = getComputedStyle(node); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'; };
  const problems = [];
  for (const canvas of document.querySelectorAll('canvas')) {
    if (!shown(canvas) || !canvas.width || !canvas.height) continue;
    const r = box(canvas), scale = Math.sqrt(canvas.width * canvas.height / (r.width * r.height));
    // A buffer at one scale is within half a drawing pixel per side; allow a pixel.
    const off = Math.max(Math.abs(canvas.width - r.width * scale), Math.abs(canvas.height - r.height * scale));
    if (off > 1) problems.push(`canvas ${canvas.className || canvas.parentElement?.className}: buffer ${canvas.width}×${canvas.height} in ${r.width.toFixed(1)}×${r.height.toFixed(1)}`);
  }
  for (const image of document.querySelectorAll('img')) {
    if (!shown(image) || !image.naturalWidth) continue;
    const fit = getComputedStyle(image).objectFit;
    if (['contain', 'cover', 'scale-down'].includes(fit)) continue;
    const r = box(image), error = Math.abs((image.naturalWidth / image.naturalHeight) / (r.width / r.height) - 1);
    if (error > .01) problems.push(`img ${image.getAttribute('src')?.split('/').pop()}: ${image.naturalWidth}×${image.naturalHeight} stretched into ${r.width.toFixed(0)}×${r.height.toFixed(0)} (object-fit ${fit})`);
  }
  for (const svg of document.querySelectorAll('svg[preserveAspectRatio="none"]')) if (shown(svg)) problems.push(`svg ${svg.className.baseVal}: preserveAspectRatio none`);
  const ratio = selector => { const n = document.querySelector(selector); if (!n || !shown(n)) return null; const r = box(n); return r.width / r.height; };
  const entry = document.querySelector('.r2-entry'), util = document.querySelector('.r2-utilities');
  let corner = null;
  if (entry && util && getComputedStyle(util).display !== 'none') { const e = box(entry), u = box(util); corner = [Math.round(e.right - u.right), Math.round(u.top - e.top)]; }
  return { problems, scroll: document.scrollingElement.scrollHeight - innerHeight, entry: ratio('.r2-entry'), crtMenu: ratio('.r2-entry-crt-menu>section'), log: ratio('.r2-runtime-view .r2-log'), corner };
});

const playwright = await loadPlaywright(), { chromium } = playwright.default ?? playwright;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const failures = [], checked = [], guides = [];
try {
  for (const [label, width, large, small, dpr, phone] of SCREENS) for (const toolbar of large === small ? ['none'] : ['hidden', 'shown']) {
    const height = toolbar === 'shown' ? small : large;
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, ...(phone ? { userAgent: IPHONE, isMobile: true, hasTouch: true } : {}) });
    await context.addInitScript(() => { try { localStorage.setItem('sz-ui-effects', 'on'); } catch { /* storage off */ } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const target = new URL(url); target.searchParams.set('e2e', '1'); target.searchParams.set('render', 'full');
    const check = async scene => {
      await page.waitForTimeout(1500);
      const m = await measure(page), at = `${label} toolbar ${toolbar} ${scene}`;
      checked.push(at);
      if (m.scroll > 0) failures.push(`${at}: the page scrolls ${m.scroll}px (in-flow content moves against fixed controls)`);
      for (const problem of m.problems) failures.push(`${at}: ${problem}`);
      if (m.entry !== null && Math.abs(m.entry - 1.4) > .005) failures.push(`${at}: title box ${m.entry.toFixed(3)}, not 7:5`);
      if (m.crtMenu !== null && Math.abs(m.crtMenu - 1.4) > .01) failures.push(`${at}: CRT menu ${m.crtMenu.toFixed(3)}, not 7:5`);
      if (m.log !== null && Math.abs(m.log - 4 / 3) > .01) failures.push(`${at}: battle log ${m.log.toFixed(3)}, not 4:3`);
      if (m.corner && (Math.abs(m.corner[0]) > 1 || Math.abs(m.corner[1]) > 1)) failures.push(`${at}: title buttons ${m.corner.join(',')}px off the title box's corner`);
      // The page scrolled as far as it can: nothing may move.
      if (m.scroll > 0) { await page.evaluate(() => window.scrollTo(0, 1e5)); const moved = await measure(page); if (moved.corner) failures.push(`${at}: scrolled, title buttons ${moved.corner.join(',')}px off`); await page.evaluate(() => window.scrollTo(0, 0)); }
    };
    await page.goto(target.toString(), { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.body.classList.contains('boot-done'), null, { timeout: 30000 });
    await emulateSafari(page, large, small, phone);
    await check('title');
    await page.evaluate(() => document.querySelector('[data-live="options"]')?.click());
    await check('title menu');
    await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.start('ai', 'basics', 1));
    await page.locator('.r2-board').waitFor({ state: 'visible', timeout: 20000 });
    await emulateSafari(page, large, small, phone);
    await check('match');
    await page.evaluate(() => document.querySelector('[data-runtime-log]')?.click());
    await check('battle log');
    // The tutorial guide takes the same share of every screen: its band a third of the height, its text 4.2%. Measured
    // on a one-line page (intro:5): a longer 「」 grows its frame (2026-10-28).
    await page.goto(target.toString(), { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.body.classList.contains('boot-done'), null, { timeout: 30000 });
    await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.start('tutorial', 'basics', 1));
    await page.locator('.live-guide').waitFor({ state: 'visible', timeout: 20000 });
    for (let turn = 0; turn < 12 && await page.locator('.live-guide').getAttribute('data-tutorial-step') !== 'intro:5'; turn += 1) {
      const step = await page.locator('.live-guide').getAttribute('data-tutorial-step');
      await page.locator('.live-guide :is([data-runtime-guide-next],[data-runtime-tutorial-next])').first().click();
      await page.waitForFunction(step => document.querySelector('.live-guide')?.dataset.tutorialStep !== step || document.querySelector('.live-guide')?.dataset.guidePage !== '1/1', step);
    }
    await emulateSafari(page, large, small, phone);
    await check('tutorial guide');
    const guide = await page.evaluate(() => {
      const frame = document.querySelector('.live-guide').getBoundingClientRect(), text = document.querySelector('.live-guide p');
      return { band: (frame.height + innerHeight * .02) / innerHeight, text: parseFloat(getComputedStyle(text).fontSize) / innerHeight, height: innerHeight };
    });
    if (Math.abs(guide.band - 1 / 3) * guide.height > 1) failures.push(`${label} toolbar ${toolbar}: guide band ${(guide.band * 100).toFixed(2)}% of the height, not a third`);
    // 4.2% of the height, or the 15px floor that keeps it readable (an 852×393 phone with the toolbar shown).
    const text = Math.max(15, guide.height * .042) / guide.height;
    if (Math.abs(guide.text - text) * guide.height > .5) failures.push(`${label} toolbar ${toolbar}: guide text ${(guide.text * 100).toFixed(2)}% of the height, not ${(text * 100).toFixed(2)}%`);
    guides.push(`${label}/${toolbar}: band ${(guide.band * 100).toFixed(2)}% text ${(guide.text * 100).toFixed(2)}%`);
    for (const error of errors) failures.push(`${label} toolbar ${toolbar}: page error ${error}`);
    await context.close();
  }
} finally { await browser.close(); }
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(JSON.stringify({ suite: 'aspect', checked: checked.length, screens: SCREENS.map(s => s[0]), guides, ok: true }));
