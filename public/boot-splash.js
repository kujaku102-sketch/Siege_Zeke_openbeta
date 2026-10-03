(() => {
  const splash = document.querySelector("#boot-splash");
  const app = document.querySelector("#app");
  if (!splash || !app) return;

  const first = splash.querySelector('[data-boot-scene="architecture"]');
  const second = splash.querySelector('[data-boot-scene="haven"]');
  const blackout = splash.querySelector(".boot-splash-blackout");
  const skip = splash.querySelector("[data-boot-skip]");
  const error = splash.querySelector("[data-boot-error]");
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const fadeMs = reducedMotion ? 0 : 400;
  const holdMs = 1500;
  const delay = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  let generation = 0;
  let finishing = false;
  let ready = Boolean(app.querySelector(".r2-entry"));
  let resolveReady;
  const readyPromise = new Promise(resolve => { resolveReady = resolve; });
  const observer = new MutationObserver(() => {
    if (!ready && app.querySelector(".r2-entry")) {
      ready = true;
      observer.disconnect();
      error.hidden = true;
      resolveReady();
    }
  });
  if (ready) resolveReady();
  else observer.observe(app, { childList: true, subtree: true });

  const watchdog = window.setTimeout(() => {
    if (!ready) {
      error.hidden = false;
      skip.hidden = true;
    }
  }, 12000);

  async function finish() {
    if (finishing) return;
    finishing = true;
    generation += 1;
    skip.hidden = true;
    blackout.classList.add("is-dark");
    await delay(fadeMs);
    await readyPromise;
    window.clearTimeout(watchdog);
    app.inert = false;
    document.body.classList.add("boot-done");
    first.hidden = true;
    second.hidden = true;
    blackout.classList.remove("is-dark");
    await delay(fadeMs);
    splash.remove();
  }

  async function play() {
    const current = generation;
    await delay(holdMs);
    if (current !== generation) return;
    blackout.classList.add("is-dark");
    await delay(fadeMs);
    if (current !== generation) return;
    first.hidden = true;
    second.hidden = false;
    blackout.classList.remove("is-dark");
    await delay(fadeMs);
    if (current !== generation) return;
    await delay(holdMs);
    if (current !== generation) return;
    finish();
  }

  skip.addEventListener("click", finish);
  splash.querySelector("[data-boot-retry]").addEventListener("click", () => window.location.reload());
  play();
})();
