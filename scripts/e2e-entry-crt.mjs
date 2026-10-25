// Exercise the visible curved title instead of clicking its hidden semantic controls.
export async function clickEntryControl(page, selector) {
  const control = page.locator(selector).first();
  await control.waitFor({ state: "visible" });
  await page.locator("#boot-splash").waitFor({ state: "detached", timeout: 15000 });
  const viewport = page.locator(".r2-entry-crt-ready .r2-crt-viewport");
  if (!await viewport.count()) return control.click();
  const [source, canvas] = await Promise.all([control.boundingBox(), viewport.boundingBox()]);
  if (!source || !canvas) throw new Error(`CRT entry control has no bounds: ${selector}`);
  const u = (source.x + source.width / 2 - canvas.x) / canvas.width * 2 - 1;
  const v = 1 - (source.y + source.height / 2 - canvas.y) / canvas.height * 2;
  const perspective = 1 / (1 + .16 * (u * u + v * v));
  await page.mouse.click(canvas.x + (1 + u * perspective) * canvas.width / 2,
    canvas.y + (1 - v * perspective) * canvas.height / 2);
}

// The start-up splash hides the page (visibility:hidden) until it detaches, so a script that
// drives a match straight through the E2E hook waits for it like a player would.
export async function waitForBootSplash(page) {
  await page.locator("#boot-splash").waitFor({ state: "detached", timeout: 15000 });
}
