// Screen check (1920x1080): the opponent CPU is chosen by name on the battle setup screen. What it checks is the product's behaviour:
//  - the picker lists the CPUs (simple, beatZIG, lightZIG); one without weights shows 準備中, is shut and cannot be chosen;
//  - the choice is kept (localStorage "simple-zeke.cpu") and is still the choice after the page is opened again;
//  - when the CPU of a match gives way to a lighter one, the match screen says so: 「<理由>、相手のCPUを <元> から <先> に切り替えました。」
//    for each reason that can be brought about from the page: device-slow-before (the device's kept hint), not-loaded (the weights file does not load),
//    error (the learned CPU throws), slow (the page's CPU is slowed down). The reasons must read differently from one another. The wording of a reason is
//    not pinned here (it is the screen's own text); its frame and the two CPU names are.
// A CPU without weights (準備中) is checked only when the picker offers one (none does while all three have weights).
// "not-available" (a CPU whose weights were learned under other rules) cannot be reached from a build whose weights match its rules; it is reported as not reached.
import { openBrowser, assertNoErrors, until, DEFAULT_VIEWPORT } from "../parts/browser.mjs";
import { clickEntryControl } from "../parts/entry.mjs";
import { keepOpening } from "../parts/opening.mjs";

const CHOICE_KEY = "simple-zeke.cpu";
const HINT_KEY = "simple-zeke.cpu-slow";
const EXPECTED = ["simple", "beatZIG", "lightZIG"];
const FRAME = /^(.+)、相手のCPUを (.+?) から (.+?) に切り替えました。$/;

const { browser, base, newPage, errors } = await openBrowser();
const report = { listed: false, kept: false, shut: [], notices: {}, beatZIG: null, notReached: ["not-available"] };

async function openSetup(page) {
  if (!await page.locator("[data-ai-cpu]").count()) await clickEntryControl(page, '[data-mode="ai"]');
  await page.locator("[data-ai-cpu]").first().waitFor({ state: "attached", timeout: 15000 });
}
const radios = (page) => page.locator("[data-ai-cpu]").evaluateAll((list) => list.map((node) => ({
  id: node.value, checked: node.checked, disabled: node.disabled || node.closest("label")?.getAttribute("aria-disabled") === "true",
  label: node.closest("label")?.textContent?.trim() ?? ""
})));
const choose = (page, id) => clickEntryControl(page, `[data-ai-cpu][value="${id}"]`);
const kept = (page) => page.evaluate((key) => localStorage.getItem(key), CHOICE_KEY);

try {
  // 1 the picker, the kept choice, the shut ones
  const page = await newPage({ hook: true });
  await openSetup(page);
  let list = await radios(page);
  const ids = list.map((cpu) => cpu.id);
  if (EXPECTED.some((id) => !ids.includes(id)) || ids.length !== EXPECTED.length) throw new Error(`the picker lists ${ids.join(", ")}; expected ${EXPECTED.join(", ")}`);
  report.listed = true;
  for (const cpu of list) if (cpu.disabled !== /準備中/.test(cpu.label)) throw new Error(`${cpu.id}: shut=${cpu.disabled} but the label says ${JSON.stringify(cpu.label)}`);
  const shut = list.filter((cpu) => cpu.disabled);
  report.shut = shut.map((cpu) => cpu.id);
  const usable = list.filter((cpu) => !cpu.disabled && cpu.id !== "simple");
  if (!usable.length) throw new Error("no learned CPU is offered");
  const learned = usable.find((cpu) => cpu.id === "lightZIG") ?? usable[0];
  await choose(page, learned.id);
  if (await kept(page) !== learned.id) throw new Error(`the choice was not kept: ${await kept(page)}`);
  for (const cpu of shut) {
    await choose(page, cpu.id).catch(() => {});
    if (await kept(page) !== learned.id) throw new Error(`${cpu.id} is shut but it changed the kept choice`);
  }
  await page.reload({ waitUntil: "networkidle" });
  await openSetup(page);
  list = await radios(page);
  const checked = list.find((cpu) => cpu.checked)?.id;
  if (checked !== learned.id) throw new Error(`after opening the page again the choice is ${checked}, not ${learned.id}`);
  report.kept = learned.id;
  await page.context().close();

  // 2 the switch notice, one match for each reason that can be reached
  const keepChoice = ({ key, id, hintKey, hint }) => {
    localStorage.setItem(key, id);
    if (hint) localStorage.setItem(hintKey, JSON.stringify({ id: hint, at: new Date().toISOString() }));
  };
  const scenarios = [
    ["device-slow-before", { arg: { key: CHOICE_KEY, id: learned.id, hintKey: HINT_KEY, hint: "simple" } }, 30000],
    ["not-loaded", { arg: { key: CHOICE_KEY, id: learned.id }, route: (route) => route.abort() }, 30000],
    ["error", { arg: { key: CHOICE_KEY, id: learned.id }, play: true,
      route: (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "export default { id: 'e2e-throws', create() { return { choose() { throw new Error('e2e: the learned CPU fails'); } }; } };" }) }, 90000],
    ["slow", { arg: { key: CHOICE_KEY, id: learned.id }, throttle: 60, play: true }, 300000]
  ];
  for (const [reason, { arg, route, throttle, play }, timeout] of scenarios) {
    const context = await browser.newContext({ viewport: DEFAULT_VIEWPORT });
    await context.addInitScript(keepChoice, arg);
    if (route) await context.route(/ZIG[^/]*\.m?js(\?.*)?$/i, route);
    const p = await context.newPage();
    p.on("pageerror", (error) => errors.push(error.message));
    await p.goto(new URL("?e2e=1", base).toString(), { waitUntil: "networkidle" });
    const slowDown = async () => (await context.newCDPSession(p)).send("Emulation.setCPUThrottlingRate", { rate: throttle });
    if (throttle && !play) await slowDown();
    await openSetup(p);
    await p.evaluate(() => {
      window.__notices = new Set();
      const read = () => { for (const node of document.querySelectorAll(".r2-notice")) { const text = node.textContent.trim(); if (text) window.__notices.add(text); } };
      new MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true });
      read();
    });
    await p.locator('[data-start="ai"]').click();
    if (play) {
      // the CPU is judged slow from its own decisions: the player passes each turn until it has made enough
      await keepOpening(p, 120000);
      if (throttle) await slowDown();
      const noticed = () => p.evaluate(() => [...window.__notices].some((text) => /切り替えました/.test(text)));
      for (const end = Date.now() + timeout; !await noticed() && Date.now() < end;) {
        await p.evaluate(() => { const control = document.querySelector("[data-runtime-end-turn]"); if (control?.dataset.turnSide === "mine" && !control.disabled) control.click(); });
        await p.waitForTimeout(500);
      }
    }
    await until(p, () => [...window.__notices].some((text) => /切り替えました/.test(text)), null, `the switch notice for ${reason}`, timeout);
    const text = await p.evaluate(() => [...window.__notices].find((item) => /切り替えました/.test(item)));
    const match = FRAME.exec(text);
    if (!match) throw new Error(`${reason}: the notice is not in the frame: ${JSON.stringify(text)}`);
    const [, said, from, to] = match;
    if (from === to) throw new Error(`${reason}: the notice names the same CPU twice`);
    const named = (name) => EXPECTED.some((id) => name === id || name.startsWith(`${id} `));
    if (!named(from) || !named(to)) throw new Error(`${reason}: the notice names ${from} / ${to}, not CPUs of the picker`);
    report.notices[reason] = { reason: said, from, to };
    await context.close();
  }

  // 3 a match played with beatZIG chosen: its log says beatZIG was chosen and played, and the reader's states reached it (no 'no-lookahead' switch)
  if (!list.some((cpu) => cpu.id === "beatZIG" && !cpu.disabled)) report.notReached.push("beatZIG-match");
  else {
    const context = await browser.newContext({ viewport: DEFAULT_VIEWPORT });
    await context.addInitScript(keepChoice, { key: CHOICE_KEY, id: "beatZIG" });
    const p = await context.newPage();
    p.on("pageerror", (error) => errors.push(error.message));
    p.on("dialog", (dialog) => dialog.accept());
    await p.goto(new URL("?e2e=1", base).toString(), { waitUntil: "networkidle" });
    await openSetup(p);
    await p.locator('[data-start="ai"]').click();
    const turn = await keepOpening(p, 60000);
    await p.locator("[data-runtime-end-turn]").click();
    await p.waitForFunction((next) => { const control = document.querySelector("[data-runtime-end-turn]"); return control?.dataset.turnSide === "mine" && control.dataset.turn === String(next) && !control.disabled; }, turn + 1, { timeout: 180000 });
    await p.locator("[data-runtime-menu]").click();
    await p.locator(".runtime-host-options").waitFor({ state: "visible", timeout: 3000 });
    await p.locator('.runtime-host-options [data-live="home"]').click();
    await p.locator(".r2-entry").waitFor({ state: "visible", timeout: 5000 });
    const cpu = await p.evaluate(() => JSON.parse(localStorage.getItem("sz-match-logs") ?? "[]")[0]?.cpu ?? null);
    if (!cpu) throw new Error("the match log of the match carries no cpu record");
    const reasonsGiven = (cpu.switches ?? []).map((entry) => entry.reason);
    if (cpu.chosen !== "beatZIG") throw new Error(`the log says the chosen CPU is ${cpu.chosen}, not beatZIG`);
    if (!cpu.played.some((entry) => entry.id === "beatZIG" && entry.n > 0)) throw new Error(`beatZIG did not play: ${JSON.stringify(cpu.played)}`);
    if (reasonsGiven.includes("no-lookahead")) throw new Error("beatZIG was switched for 'no-lookahead': the reader's states did not reach it");
    report.beatZIG = { chosen: cpu.chosen, played: cpu.played.map((entry) => entry.id), switches: reasonsGiven };
    await context.close();
  }
  const reasons = Object.values(report.notices).map((item) => item.reason);
  if (new Set(reasons).size !== reasons.length) throw new Error(`two reasons read the same: ${JSON.stringify(reasons)}`);
  assertNoErrors(errors, "cpu-choice");
  console.log(JSON.stringify({ suite: "screen/cpu-choice", ...report, ok: true }));
} finally {
  await browser.close();
}
