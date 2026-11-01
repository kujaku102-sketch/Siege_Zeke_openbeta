// The browser side every e2e shares: where the page is, which Playwright to use, the 1920x1080 default, and the page-error log.
// Usage in an e2e:  const { browser, base, newPage, errors } = await openBrowser();  ...  await browser.close();
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_VIEWPORT = Object.freeze({ width: 1920, height: 1080 });

// "<url> --playwright-module <path>" as before; the module also comes from SIMPLE_ZEKE_PLAYWRIGHT_MODULE.
export function readArgs(argv = process.argv.slice(2)) {
  const flag = argv.indexOf("--playwright-module");
  const module = flag >= 0 ? argv[flag + 1] : process.env.SIMPLE_ZEKE_PLAYWRIGHT_MODULE;
  const rest = flag >= 0 ? argv.filter((item, index) => index !== flag && index !== flag + 1) : argv;
  const url = rest.find((item) => !item.startsWith("--")) ?? "http://127.0.0.1:4173/";
  return { module, url, flags: new Set(rest.filter((item) => item.startsWith("--"))) };
}

export async function loadPlaywright(module) {
  if (!module) throw new Error("provide --playwright-module or SIMPLE_ZEKE_PLAYWRIGHT_MODULE for the external browser runner");
  const specifier = module.startsWith("file:") ? module : pathToFileURL(path.resolve(module)).href;
  if (!specifier.startsWith("file:") || !existsSync(new URL(specifier))) throw new Error("explicit Playwright module path is unavailable");
  const loaded = await import(specifier);
  return loaded.default ?? loaded;
}

// base: the site root (no query). pageUrl(): the page with ?e2e=1, the test-mode hook, which a public player never gets.
export async function openBrowser(argv) {
  const { module, url, flags } = readArgs(argv);
  const { chromium } = await loadPlaywright(module);
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const base = new URL(url); base.search = "";
  const errors = [];
  const pageUrl = (suffix = "") => { const target = new URL(suffix, base); target.searchParams.set("e2e", "1"); return target.toString(); };
  // A new page; the hook is on unless `hook: false`. Page errors are collected in `errors`.
  async function newPage({ viewport = DEFAULT_VIEWPORT, hook = true, touch = false, path: at = "", wait = "networkidle", context = null } = {}) {
    const ctx = context ?? await browser.newContext({ viewport, ...(touch ? { hasTouch: true, isMobile: true } : {}) });
    const page = await ctx.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(hook ? pageUrl(at) : new URL(at, base).toString(), { waitUntil: wait });
    return page;
  }
  return { browser, base, flags, errors, pageUrl, newPage };
}

// A page error is a failure, whatever else passed.
export function assertNoErrors(errors, label = "page") {
  if (errors.length) throw new Error(`${label} errors: ${errors.slice(0, 5).join(" | ")}`);
}

// A fixed wait is not used: this waits for a condition like a player waits for the screen.
export const until = (page, fn, arg, what, timeout = 5000) => page.waitForFunction(fn, arg, { timeout }).catch(() => { throw new Error(`never: ${what}`); });
