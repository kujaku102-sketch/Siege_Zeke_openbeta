import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validSelectionAnswer } from '../src/game/runtime/selection-contract.js';
import { clickEntryControl } from "./e2e-entry-crt.mjs";

const args = process.argv.slice(2);
const victoryMode = args.includes("--victory");
const playwrightFlag = args.indexOf("--playwright-module");
const explicitPlaywrightModule = playwrightFlag >= 0 ? args[playwrightFlag + 1] : process.env.SIMPLE_ZEKE_PLAYWRIGHT_MODULE;
const url = args.find((argument, index) => argument !== "--victory" && argument !== "--playwright-module" && index !== playwrightFlag + 1) ?? "http://127.0.0.1:4173/";

async function loadPlaywright() {
  if (!explicitPlaywrightModule) throw new Error("provide --playwright-module or SIMPLE_ZEKE_PLAYWRIGHT_MODULE for the external browser runner");
  const specifier = explicitPlaywrightModule.startsWith("file:") ? explicitPlaywrightModule : pathToFileURL(path.resolve(explicitPlaywrightModule)).href;
  if (!specifier.startsWith("file:") || !existsSync(new URL(specifier))) throw new Error("explicit Playwright module path is unavailable");
  return import(specifier);
}

// V092-08: the title's tutorial and battle buttons open their screens, and the match starts there.
async function startMode(page, mode) {
  await clickEntryControl(page, `[data-mode="${mode}"]`);
  const start = { tutorial: '[data-start="tutorial"][data-tutorial-id="basics"]', ai: '[data-start="ai"]' }[mode];
  if (start) await page.locator(start).click();
}

// V092-08 entry flow, by real clicks and keys on the public build (no E2E hook): the title links are
// 準備中 outside the stage, both flow screens open and come back by [戻る] and Escape, and the
// online button does nothing.
async function checkEntryFlow(page) {
  // The links sit in the margin beside the stage; where that margin is narrow (16:10 here) they may
  // reach over the stage's empty corner, but never over the title's buttons or menu, nor off screen.
  const title = await page.evaluate(() => {
    const box = node => node.getBoundingClientRect().toJSON();
    const links = [...document.querySelectorAll(".r2-title-link")].map(link => ({ text: link.textContent, href: link.getAttribute("href"), box: box(link) }));
    const controls = [...document.querySelectorAll(".r2-mode-grid>button, .r2-utilities button")].map(box);
    return { battle: document.querySelector('[data-mode="ai"] strong')?.textContent, links, controls, width: innerWidth, height: innerHeight };
  });
  const meets = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  if (title.battle !== "対戦") throw new Error(`title battle button is not 対戦: ${title.battle}`);
  if (title.links.length !== 2 || title.links.some(link => link.href !== null || !link.text.includes("準備中"))) throw new Error(`title links are not 準備中: ${JSON.stringify(title.links)}`);
  if (title.links.some(({ box }) => title.controls.some(control => meets(box, control)) || box.left < 0 || box.top < 0 || box.right > title.width || box.bottom > title.height)) throw new Error(`title links cover a title control or leave the screen: ${JSON.stringify(title)}`);
  await page.locator('[data-mode="tutorial"]').click();
  await page.locator('[data-flow-screen="tutorial-select"]').waitFor({ state: "visible" });
  const items = await page.locator("[data-tutorial-item]").evaluateAll(nodes => nodes.map(node => `${node.dataset.tutorialItem}:${node.dataset.done}`));
  if (items.join() !== "basics:false,vengeance:false") throw new Error(`tutorial list is wrong: ${items}`);
  const menu = await page.locator(".r2-utilities button").boundingBox();
  if (!menu || menu.width < 44 || menu.height < 44) throw new Error(`flow screen menu is under 44 CSS px: ${JSON.stringify(menu)}`);
  // The options window leaves the focus on <body>: Escape still closes it, and the next Escape goes back.
  await page.locator('.r2-utilities [data-live="options"]').click();
  await page.locator(".r2-title-options").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await page.locator(".r2-title-options").waitFor({ state: "detached" });
  if (!await page.locator('[data-flow-screen="tutorial-select"]').count()) throw new Error("Escape on the options window left the tutorial list");
  await page.keyboard.press("Escape");
  await page.locator(".r2-entry").waitFor({ state: "visible" });
  await page.locator('[data-mode="ai"]').click();
  await page.locator('[data-flow-screen="battle-setup"]').waitFor({ state: "visible" });
  if (await page.locator(".r2-flow select").count() !== 4) throw new Error("battle setup does not offer deck and user for both sides");
  if (await page.locator("[data-online-battle]").getAttribute("aria-disabled") !== "true") throw new Error("online battle is not marked unavailable");
  await page.locator("[data-online-battle]").click({ force: true });
  if (!await page.locator('[data-flow-screen="battle-setup"]').count() || await page.locator(".r2-notice").count()) throw new Error("online battle did something");
  // Right after the deck builder closes by its button, Escape goes back with no Tab in between.
  await page.locator(".r2-flow [data-deck-open]").click();
  await page.locator("[data-deck-close]").first().click();
  await page.locator("[data-deck-close]").waitFor({ state: "detached" });
  await page.keyboard.press("Escape");
  await page.locator(".r2-entry").waitFor({ state: "visible", timeout: 3000 }).catch(() => { throw new Error("Escape after closing the deck builder did not go back"); });
  await page.locator('[data-mode="ai"]').click();
  await page.locator("[data-flow-back]").click();
  await page.locator(".r2-entry").waitFor({ state: "visible" });
}

// A guide line may run over several pages, depending on the screen: press [次へ] up to its last page,
// where the step's highlights and its own button appear.
async function readGuidePages(page) {
  await page.waitForFunction(() => !document.querySelector(".live-guide[data-paging='pending']"), null, { timeout: 5000 }).catch(() => {});
  for (let turn = 0; turn < 12; turn += 1) {
    const forward = page.locator(".live-guide [data-runtime-guide-next]");
    if (!await forward.count()) return;
    const before = await page.locator(".live-guide").getAttribute("data-guide-page");
    await forward.click();
    await page.waitForFunction(before => document.querySelector(".live-guide")?.dataset.guidePage !== before, before, { timeout: 3000 });
  }
  throw new Error("guide pages never reached the last one");
}

async function advanceTutorialIntroduction(page) {
  for (let index = 0; index < 7; index += 1) {
    const guide = page.locator(".live-guide");
    await guide.waitFor({ state: "visible" });
    const step = await guide.getAttribute("data-tutorial-step");
    const speaker = (await guide.locator(".live-guide-cast strong").textContent())?.trim();
    const visibleText = await guide.innerText();
    if (step !== `intro:${index}` || speaker !== "じぐさぽ") throw new Error(`tutorial introduction mismatch: ${JSON.stringify({ index, step, speaker })}`);
    if (/\bTUTORIAL\b|\bFOCUS\b/.test(visibleText)) throw new Error(`temporary tutorial label remained: ${visibleText}`);
    if (index === 3 && (await guide.locator("ruby rt").textContent())?.trim() !== "ベータテスト") throw new Error("tutorial beta ruby is missing");
    await readGuidePages(page);
    await guide.locator('[data-runtime-tutorial-next]').click();
  }
}

async function tutorialFocusLabels(page) {
  // The marks are placed by the frame-coalesced layout once the step's pages are cut.
  await page.locator(".live-focus[data-tutorial-focus-label]").first().waitFor({ state: "attached", timeout: 3000 }).catch(() => {});
  return page.locator(".live-focus[data-tutorial-focus-label]").evaluateAll(nodes => [...new Set(nodes.map(node => node.dataset.tutorialFocusLabel))]);
}

const playwright = await loadPlaywright();
const { chromium } = playwright.default ?? playwright;
const base = new URL(url);
base.searchParams.delete("e2e");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

if (victoryMode) {
  try { await runNormalVictory({page,base,browser}); }
  finally { await browser.close(); }
  process.exit(0);
}

try {
  const manifestResponse = await page.request.get(new URL("release-manifest.json", base).toString());
  if (!manifestResponse.ok()) throw new Error(`public release manifest is unavailable: ${manifestResponse.status()}`);
  const manifest = await manifestResponse.json();
  if (manifest.release?.environment !== "staging" || manifest.release?.productionApproved !== false) throw new Error("public release boundary is invalid");
  if (manifest.publicCardPool?.cardCount !== 214 || new Set(manifest.publicCardPool.canonicalIds).size !== 214) throw new Error("public release card pool is invalid");
  const [pwaManifestResponse, serviceWorkerResponse] = await Promise.all([page.request.get(new URL("manifest.webmanifest", base).toString()), page.request.get(new URL("sw.js", base).toString())]);
  if (!pwaManifestResponse.ok() || !serviceWorkerResponse.ok()) throw new Error("PWA manifest or service worker is unavailable");
  const pwaManifest = await pwaManifestResponse.json();
  if (pwaManifest.display !== "standalone" || pwaManifest.orientation !== "landscape" || pwaManifest.icons?.length < 2) throw new Error("PWA install contract is invalid");

  await page.goto(base.toString(), { waitUntil: "networkidle" });
  await page.waitForFunction(async () => Boolean(await navigator.serviceWorker?.getRegistration?.()));
  if (await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__ !== undefined)) throw new Error("public build exposes a hidden E2E hook");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  if (await page.locator('[data-mode="tutorial"], [data-mode="ai"], [data-mode="sandbox"], [data-deck-open]').count() !== 4) throw new Error("R2 entry does not expose the four primary routes");
  await checkEntryFlow(page);

  await startMode(page, "tutorial");
  await advanceTutorialIntroduction(page);
  await readGuidePages(page);
  const guide = page.locator(".live-guide");
  const guideAudit = await guide.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const image = node.querySelector(".live-guide-cast img");
    return { step: node.dataset.tutorialStep, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, imageWidth: image.naturalWidth, imageHeight: image.naturalHeight, speaker: node.querySelector("strong")?.textContent?.trim(), text: node.querySelector(".live-guide-text")?.textContent?.trim() };
  });
  const basicsZeroLabels = await tutorialFocusLabels(page);
  if (guideAudit.step !== "basics:0" || guideAudit.left < 0 || guideAudit.top < 0 || guideAudit.right > guideAudit.viewportWidth || guideAudit.bottom > guideAudit.viewportHeight || guideAudit.imageWidth !== 540 || guideAudit.imageHeight !== 640 || guideAudit.speaker !== "じぐさぽ" || !guideAudit.text || !basicsZeroLabels.includes("剣士") || !basicsZeroLabels.includes("アツト")) throw new Error(`desktop live tutorial guide is invalid: ${JSON.stringify({ guideAudit, basicsZeroLabels })}`);
  // Steps 1–2 still talk about Obs; step 3 turns to the Code in the hand.
  for (const index of [1, 2, 3]) {
    await page.locator('[data-runtime-tutorial-next]').click();
    if (await guide.getAttribute("data-tutorial-step") !== `basics:${index}`) throw new Error(`tutorial did not advance to basics:${index}`);
    await readGuidePages(page);
  }
  const basicsThreeLabels = await tutorialFocusLabels(page);
  if (!basicsThreeLabels.includes("ジャンクパーツ") || basicsThreeLabels.includes("剣士")) throw new Error(`tutorial focus did not follow basics:3: ${basicsThreeLabels.join(", ")}`);

  await page.locator('[data-runtime-menu]').click();
  await page.locator("[data-deck-open]").click();
  const deckThumbnail = await page.locator('.deck-tile[data-deck-card-id="STD-075"]').evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { art: Boolean(node.querySelector("img")), ratio: rect.width / rect.height, name: node.querySelector("strong")?.textContent?.trim() };
  });
  // Deck tiles share the card's 5:8 portrait shape on every view.
  if (!deckThumbnail.art || Math.abs(deckThumbnail.ratio - 5 / 8) > 0.03 || deckThumbnail.name !== "ジャンキー") throw new Error(`desktop deck thumbnail is invalid: ${JSON.stringify(deckThumbnail)}`);
  await page.locator("[data-deck-close]").click();

  await page.goto(base.toString(), { waitUntil: "networkidle" });
  await startMode(page, "ai");
  if (!await page.locator(".r2-board").count() || !await page.locator(".r2-console").count() || !await page.locator(".r2-hand").count()) throw new Error("AI mode did not mount the separated board, console and hand layers");
  await page.locator('[data-runtime-end-turn]').click();
  // The turn control is a HUD button counting each side's own turns: once the CPU is done it is enabled again as the player's 2nd turn.
  await page.waitForFunction(() => { const turn = document.querySelector("[data-runtime-end-turn]"); return turn?.dataset.turnSide === "mine" && turn.dataset.turn === "2" && !turn.disabled; }, null, { timeout: 15000 });

  const mobilePage = await browser.newPage({ viewport: { width: 844, height: 390 } });
  await mobilePage.addInitScript(() => Object.defineProperty(window.navigator, "standalone", { value: true, configurable: true }));
  const mobileUrl = new URL("mobile/", base);
  await mobilePage.goto(mobileUrl.toString(), { waitUntil: "networkidle" });
  await mobilePage.waitForFunction(async () => (await caches.keys()).includes("sz-pwa-meta"));
  await startMode(mobilePage, "tutorial");
  const mobileGuide = mobilePage.locator(".live-guide");
  const mobileGuideAudit = await mobileGuide.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, speechPointerEvents: getComputedStyle(node.querySelector(".live-guide-speech")).pointerEvents };
  });
  if (mobileGuideAudit.left < 0 || mobileGuideAudit.top < 0 || mobileGuideAudit.right > mobileGuideAudit.viewportWidth || mobileGuideAudit.bottom > mobileGuideAudit.viewportHeight || mobileGuideAudit.speechPointerEvents !== "none") throw new Error(`mobile guide is clipped or blocks board input: ${JSON.stringify(mobileGuideAudit)}`);
  await advanceTutorialIntroduction(mobilePage);
  await readGuidePages(mobilePage);
  const startButton = mobilePage.locator('[data-runtime-tutorial-next]');
  const startHit = await startButton.evaluate(node => { const rect = node.getBoundingClientRect(); return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest?.('[data-runtime-tutorial-next]') === node; });
  if (!startHit) throw new Error("mobile tutorial guide blocks the focused start action");

  await mobilePage.goto(mobileUrl.toString(), { waitUntil: "networkidle" });
  await startMode(mobilePage, "ai");
  await mobilePage.locator(".r2-hand [data-card-ref]").first().click();
  const detailAudit = await mobilePage.locator(".r2-detail").evaluate(node => ({ effect: Boolean(node.querySelector(".card-effect-copy")) && (node.querySelector(".card-effect-copy")?.textContent?.trim().length ?? 0) > 0, runtime: Boolean(node.querySelector(".runtime-detail-section")), inViewport: node.getBoundingClientRect().left >= 0 && node.getBoundingClientRect().right <= innerWidth }));
  if (!detailAudit.effect || !detailAudit.runtime || !detailAudit.inViewport || !await mobilePage.locator(".r2-popup").count()) throw new Error(`mobile card detail or operation popup is invalid: ${JSON.stringify(detailAudit)}`);
  await mobilePage.close();

  console.log(JSON.stringify({ environment: manifest.release.environment, revision: manifest.release.buildRevision, cardCount: manifest.publicCardPool.cardCount, entryRoutes: 4, entryFlow: true, liveTutorialGuide: true, tutorialFocus: true, deckBuilder: true, separatedLayers: true, pacedAiTurn: true, mobilePwa: true, mobileGuideClickThrough: true, mobileDetail: true, ok: true }));
} finally {
  await browser.close();
}
async function runNormalVictory({page,base,browser}) {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base.toString(),{waitUntil:'networkidle'});
  if(await page.evaluate(()=>window.__SIMPLE_ZEKE_E2E__!==undefined))throw new Error('ordinary public URL exposes E2E hook');
  let target=new URL(base);target.searchParams.set('e2e','1');
  let touch=false;const waitingRoutes=[];
  const readQuery=(seat='player')=>page.evaluate(seat=>window.__SIMPLE_ZEKE_E2E__.query(seat),seat).then(result=>{
    if(!result?.ok)throw new Error(JSON.stringify(result));return result.value;
  });
  const side=(query,seat)=>query.observation.seats.find(item=>item.seatId===seat);
  const shownCards=query=>{
    const cards=[];const visit=card=>{cards.push(card);if(!card.faceDown)card.mounted.forEach(visit);};
    for(const seat of query.observation.seats)for(const zone of ['hand','front','back','registry','trash','ban'])seat[zone].cards?.forEach(visit);
    return cards;
  };
  const readCurrent=()=>page.evaluate(()=>window.__SIMPLE_ZEKE_E2E__.query()).then(result=>{
    if(!result?.ok)throw new Error(JSON.stringify(result));return result.value;
  });
  const scope=()=>page.evaluate(()=>window.__SIMPLE_ZEKE_E2E__.scope());
  const hitControl=async selector=>{
    const nodes=page.locator(selector);
    await page.waitForFunction(selector=>[...document.querySelectorAll(selector)].some(node=>{
      const rect=node.getBoundingClientRect(),style=getComputedStyle(node);
      return rect.width>0&&rect.height>0&&style.visibility!=='hidden'&&style.display!=='none';
    }),selector,{timeout:2000}).catch(()=>{throw new Error('victory control not shown: '+selector+(touch?' (touch)':' (mouse)'));});
    const diagnostics=[];
    for(let index=0;index<await nodes.count();index+=1){
      const control=nodes.nth(index);if(!await control.isVisible())continue;
      // The hand is fixed to the screen edge; scrolling cannot bring a fanned card fully into view.
      const inHand=await control.evaluate(node=>Boolean(node.closest('.r2-hand')));
      let hit=null;
      // A raised touch hand lowers itself 2.5s after the last touch: raise it again if it dropped before the tap.
      for(let attempt=0;attempt<(inHand?3:1);attempt+=1){
        // A lowered hand only peeks above the screen edge: the player points at (or taps) the strip, it rises,
        // then the card is reachable. A raised hand is left alone so the tap cannot pick a card by accident.
        if(await control.evaluate(node=>Boolean(node.closest('.r2-hand'))&&!document.querySelector('.wf-hand-raised'))){
          const strip=await control.evaluate(node=>{const hand=node.closest('.r2-hand').getBoundingClientRect(),rect=node.getBoundingClientRect();
            return {x:Math.min(Math.max(rect.left+rect.width/2,1),innerWidth-1),y:Math.min(hand.bottom,innerHeight)-4};});
          if(touch)await page.touchscreen.tap(strip.x,strip.y);else await page.mouse.move(strip.x,strip.y);
          await page.waitForFunction(()=>Boolean(document.querySelector('.wf-hand-raised')),null,{timeout:2000}).catch(()=>{});
          await page.waitForTimeout(350);
        }
        // A long hand scrolls sideways inside its strip (the strip itself stays on screen), so only that scroll is wanted.
        if(inHand)await control.evaluate(node=>node.scrollIntoView({block:'nearest',inline:'center'}));
        else await control.scrollIntoViewIfNeeded();
        // A tap never focuses first: a programmatic focus opens the choice peek, and a touch then only closes it.
        if(!touch)await control.focus();
        hit=await control.evaluate((node,selector)=>{
          const rect=node.getBoundingClientRect(),enabled=!node.matches(':disabled')&&!node.closest('[inert]')&&rect.width>0&&rect.height>0
            &&(Boolean(node.closest('.r2-hand'))||(rect.left>=0&&rect.top>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight));
          // A fanned hand card bleeds past the screen edge by design; the hit point below must still land on it.
          const points=[[.5,.5],[.5,.18],[.2,.18],[.8,.18],[.18,.5],[.82,.5],[.5,.82],[.2,.82],[.8,.82]]
            .map(([rx,ry])=>({x:rect.left+rect.width*rx,y:rect.top+rect.height*ry}));
          const point=enabled?points.find(({x,y})=>document.elementFromPoint(x,y)?.closest(selector)===node):null;
          return {x:point?.x??0,y:point?.y??0,valid:Boolean(point),rect:{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height},tops:points.map(({x,y})=>document.elementFromPoint(x,y)?.outerHTML?.slice(0,160)??null)};
        },selector);
        if(hit.valid)break;
      }
      if(hit.valid)return {control,x:hit.x,y:hit.y};
      diagnostics.push(hit);
    }
  throw new Error('enabled reachable victory control unavailable '+selector+' '+JSON.stringify(diagnostics));
  };
  const visibleClick=async selector=>{
    const {x,y}=await hitControl(selector);
    if(touch)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);
  };
  const viewer=async seat=>{
    const before=await readCurrent();if(before.status.viewerSeat===seat)return;
    const beforeScope=await scope(),answering=await readQuery(seat),input=answering.requiredInput;
    const waiting=before.requiredInput?.canAnswer===false;
    await visibleClick(waiting?'.effect-modal [data-runtime-menu]':'[data-runtime-menu]');
    const selector=await hitControl('.runtime-host-options [data-sandbox-actor]');
    await selector.control.selectOption(seat);
    await visibleClick('.runtime-host-options [data-live="close-options"]');
    const after=await readCurrent(),afterScope=await scope();
    if(beforeScope.matchId!==afterScope.matchId||beforeScope.sessionGeneration!==afterScope.sessionGeneration
      ||before.status.revision!==after.status.revision||before.status.activeSeat!==after.status.activeSeat
      ||after.status.viewerSeat!==seat||input?.choiceId!==after.requiredInput?.choiceId
      ||input?.actorSeat!==after.requiredInput?.actorSeat||input&&(!after.requiredInput.canAnswer||after.requiredInput.actorSeat!==seat)
      ||await page.locator('.runtime-host-options').count())throw new Error('GUI viewer changed authority or retained host menu');
    if(await page.locator('.r2-detail,.art-preview-overlay,.r2-log,.admin-drawer').count())throw new Error('old viewer private presentation remained');
    if(input){
      if(after.requiredInput.options.length)await hitControl('[data-option-id="'+after.requiredInput.options[0].optionId+'"]');
      else await hitControl('[data-runtime-confirm]');
      if(after.requiredInput.optional)await hitControl('[data-runtime-decline]');
    }
    if(waiting)waitingRoutes.push({choiceId:input.choiceId,actorSeat:seat,pointer:touch?'touch':'mouse'});
  };
  const setActive=async seat=>{
    if((await readQuery()).requiredInput)throw new Error('active setup attempted during choice');
    await visibleClick('[data-runtime-menu]');await (await hitControl('[data-sandbox-active]')).control.selectOption(seat);
    await visibleClick('[data-live="close-options"]');
    if((await readQuery()).status.activeSeat!==seat)throw new Error('normal active-seat admin failed');
    await viewer(seat);
  };
  const add=async (id,seat='player')=>{
    const result=await page.evaluate(({id,seat})=>window.__SIMPLE_ZEKE_E2E__.sandbox({type:'sandboxAddCard',definitionId:id,targetSeat:seat}),{id,seat});
    if(!result?.ok||result.value.kind!=='accepted')throw new Error('catalog capability refused '+JSON.stringify(result));
    const query=await readQuery(seat);
    return side(query,seat).hand.cards.findLast(card=>!card.faceDown&&card.definition.id===id).cardRef;
  };
  const selectAnswer=(request,query,preference=null)=>{
    const explicit=preference!==null,options=explicit?request.options.filter(preference):[...request.options],chosen=[];
    if(explicit&&!options.length)throw new Error('VICTORY_REQUESTED_OPTION_UNAVAILABLE');
    const search=(start,count)=>{
      if(!count){const answer={requestId:request.requestId,optionIds:[...chosen],allocation:[]};return validSelectionAnswer(request,answer)?answer:null;}
      for(let index=start;index<=options.length-count;index+=1){chosen.push(options[index].optionId);const found=search(index+1,count-1);chosen.pop();if(found)return found;}return null;
    };
    if(request.constraints.kind==='allocation'){
      const answer={requestId:request.requestId,optionIds:options.length?[options[0].optionId]:[],
        allocation:options.length?[{optionId:options[0].optionId,amount:request.constraints.total}]:[]};
      if((!explicit||answer.optionIds.length>0)&&validSelectionAnswer(request,answer))return answer;
    }
    for(let count=explicit?Math.max(1,request.constraints.minimum??0):request.constraints.minimum??0;
      count<=Math.min(request.constraints.maximum??0,options.length);count+=1){const answer=search(0,count);if(answer)return answer;}
    throw new Error(explicit?'VICTORY_REQUESTED_ANSWER_INVALID':'no valid safe victory choice');
  };
  const explicitRegression=async (query,predicate)=>{
    const input=query.requiredInput,request={...input,requestId:input.choiceId},beforeScope=await scope();
    if(!input.canAnswer||request.constraints.minimum!==0||request.constraints.maximum!==1)throw new Error('real optional 0..1 regression request missing');
    let missing=false;
    try{selectAnswer(request,query,()=>false);}catch(error){if(error.message!=='VICTORY_REQUESTED_OPTION_UNAVAILABLE')throw error;missing=true;}
    const selected=selectAnswer(request,query,predicate),generic=selectAnswer(request,query);
    const intended=request.options.filter(predicate);
    if(!missing||selected.optionIds.length!==1||!intended.some(option=>option.optionId===selected.optionIds[0])
      ||!validSelectionAnswer(request,selected)||generic.optionIds.length!==0||!validSelectionAnswer(request,generic))throw new Error('explicit optional choice regression failed');
    if(JSON.stringify(await readQuery(input.actorSeat))!==JSON.stringify(query)||JSON.stringify(await scope())!==JSON.stringify(beforeScope))throw new Error('pure selection checks mutated match');
  };
  // A single pick is made on the board itself (the lit slot, card or user) and decides the step; a list or
  // multi pick uses its option buttons and a confirm. Either way the control is found like a player would.
  const pickOption=async (option,query)=>{
    const listed=page.locator('[data-option-id="'+option.optionId+'"]');
    for(let index=0;index<await listed.count();index+=1)if(await listed.nth(index).isVisible())return visibleClick('[data-option-id="'+option.optionId+'"]');
    if(option.cardRef??option.hostRef)return visibleClick('[data-card-ref="'+(option.cardRef??option.hostRef)+'"]');
    if(option.zone&&Number.isSafeInteger(option.slot))return visibleClick('.board-slot[data-seat="'+(option.seatId??query.status.viewerSeat)+'"][data-zone="'+option.zone+'"][data-slot="'+option.slot+'"]');
    if(option.kind==='user'||option.targetKind==='user')return visibleClick('[data-fortress="'+option.seatId+'"]');
    throw new Error('no control for option '+JSON.stringify(option));
  };
  const confirmIfShown=async ()=>{
    const confirm=page.locator('[data-runtime-confirm]').first();
    if(await confirm.count()&&await confirm.isVisible()&&await confirm.isEnabled())await visibleClick('[data-runtime-confirm]');
  };
  const answer=async (query,preference=null)=>{
    const input=query.requiredInput;if(!input?.canAnswer)throw new Error('wrong answering viewer');
    const request={...input,requestId:input.choiceId},selected=selectAnswer(request,query,preference);
    for(const id of selected.optionIds){await pickOption(request.options.find(option=>option.optionId===id),query);}
    for(const row of selected.allocation)await page.locator('[data-allocation-option="'+row.optionId+'"]').fill(String(row.amount));
    await confirmIfShown();
  };
  const settle=async ()=>{
    while(true){
      const query=await readQuery(),input=query.requiredInput;if(!input)return;
      await viewer(input.actorSeat);const current=await readQuery(input.actorSeat);
      if(current.requiredInput.optional)await visibleClick('[data-runtime-decline]');
      else await answer(current);
      const after=await readQuery(input.actorSeat);
      if(after.status.revision<=current.status.revision)throw new Error('victory choice did not progress');
    }
  };
  const play=async (type,ref,seat='player',preference=null)=>{
    await viewer(seat);const query=await readQuery(seat);
    const entry=query.legalActions.find(item=>(item.actionType??item.action?.type)===type&&(item.base?.cardRef??item.action?.cardRef)===ref);
    if(!entry)throw new Error('victory normal legal action unavailable '+type);
    const card=shownCards(query).find(card=>card.cardRef===ref);if(!card)throw new Error('victory source is not visible');
    const source='[data-card-ref="'+ref+'"]';
    await page.locator(source).first().waitFor({state:'attached',timeout:2000});
    const sourceVisible=await page.locator(source).evaluateAll(nodes=>nodes.some(node=>{
      const rect=node.getBoundingClientRect(),style=getComputedStyle(node);
      return rect.width>0&&rect.height>0&&style.visibility!=='hidden'&&style.display!=='none';
    }));
    if(card.location?.zone==='hand'&&!sourceVisible)await visibleClick('[data-runtime-hand]');
    // The first touch on a lowered hand only raises it, and a raised hand lowers itself 2.5s after the last touch:
    // like a player, tap again when the card did not take the selection.
    for(let attempt=0;;attempt+=1){
      await visibleClick(source);
      const taken=await page.waitForFunction(()=>Boolean(document.querySelector('.r2-popup')),null,{timeout:1500}).then(()=>true,()=>false);
      if(taken)break;if(attempt>=2)throw new Error('victory source did not take the selection: '+source);
    }
    await visibleClick('[data-action-id="'+entry.actionId+'"]');
    if(entry.kind==='fixed')return;
    const selections=[],moved=async ()=>(await readQuery(seat)).status.revision!==query.status.revision;
    while(true){
      // A finished plan is submitted by the UI itself; the pick that completes it ends the action.
      if(await moved())return;
      const planned=await page.evaluate(({input,seat})=>window.__SIMPLE_ZEKE_E2E__.queryAction(input,seat),{
        input:{expectedRevision:query.status.revision,actionId:entry.actionId,selections},seat});
      if(!planned?.ok){if(await moved())return;throw new Error(JSON.stringify(planned));}
      if(planned.value.completion){await confirmIfShown();if(await moved())return;throw new Error('victory plan is complete but was not submitted');}
      const request=planned.value.selectionRequests[0],selected=selectAnswer(request,query,preference);
      for(const id of selected.optionIds)await pickOption(request.options.find(option=>option.optionId===id),query);
      await confirmIfShown();selections.push(selected);
    }
  };
  const fresh=async ()=>{
    await page.goto(target.toString(),{waitUntil:'networkidle'});
    await page.waitForFunction(()=>document.body.classList.contains('boot-done')&&!document.querySelector('#boot-splash'),null,{timeout:10000});
    const result=await page.evaluate(()=>window.__SIMPLE_ZEKE_E2E__.start('sandbox','basics',1));
    if(!result?.ok)throw new Error(JSON.stringify(result));
    let query=await readQuery();
    if(query.requiredInput||query.status.finished||query.observation.seats.some(seat=>seat.front.cards.length||seat.back.cards.length))throw new Error('trusted sandbox start is not fresh');
    // Progress is determined by public STR, never fixed iteration counts or injected STR.
    while(side(query,'ai').fortressStr>1){
      const before=side(query,'ai').fortressStr,gun=await add('STD-015');
      await play('executeSpell',gun);await settle();query=await readQuery();
      if(side(query,'ai').fortressStr!==before-1||query.status.finished||query.status.lockedOutcome)throw new Error('normal damage setup did not advance exactly one STR');
    }
    await viewer('player');return query;
  };
  const assertNotFinal=async gun=>{
    const query=await readQuery();
    if(query.status.lockedOutcome!==null||query.status.finished||await page.locator('.r2-result').count())throw new Error('fatal result finalized before optional declaration');
    return query;
  };
  const cleanupSnapshot=query=>({
    trash:side(query,'player').trash.cards.filter(card=>!card.faceDown&&card.definition.id==='STD-015').length,
    ban:side(query,'player').ban.cards.filter(card=>!card.faceDown&&card.definition.id==='STD-015').length
  });
  const assertFinished=async (gun,responseId=null,beforeCleanup=null)=>{
    await settle();const query=await readQuery();
    if(!query.status.finished||query.status.lockedOutcome?.kind!=='win'||query.status.lockedOutcome.winnerSeat!=='player'||!await page.locator('.r2-result').count())throw new Error('normal victory not finished or modal missing');
    const afterCleanup=cleanupSnapshot(query);
    if(beforeCleanup ? afterCleanup.trash!==beforeCleanup.trash+1||afterCleanup.ban!==beforeCleanup.ban
      : !side(query,'player').trash.cards.some(card=>card.cardRef===gun)||side(query,'player').ban.cards.some(card=>card.cardRef===gun))throw new Error('fatal source cleanup is not trash');
    if(responseId&&!side(query,'ai').trash.cards.some(card=>!card.faceDown&&card.definition.id===responseId))throw new Error('declared response cleanup missing');
    return query;
  };
  await fresh();let gun=await add('STD-015');const forbidden=await add('STD-015');
  await play('executeSpell',gun);await assertFinished(gun);
  let query=await readQuery();const denied=await page.evaluate(input=>window.__SIMPLE_ZEKE_E2E__.submit(input),{
    commandId:'finished-play',expectedRevision:query.status.revision,action:{type:'executeSpell',cardRef:forbidden,targets:[],selectionScope:null}});
  if(denied?.ok&&denied.value.kind==='accepted')throw new Error('finished match accepted new play');

  await fresh();await setActive('ai');const script=await add('STD-003','ai');
  await play('executeCard',script,'ai',option=>option.zone==='back');await setActive('player');
  gun=await add('STD-015');const scriptCleanup=cleanupSnapshot(await readQuery());await play('executeSpell',gun);query=await assertNotFinal(gun);
  if(query.requiredInput?.kind!=='waiting'||query.requiredInput.actorSeat!=='ai'||query.requiredInput.canAnswer!==false)throw new Error('normal STD-003 waiting boundary missing');
  let routeCount=waitingRoutes.length;
  await viewer('ai');query=await readQuery('ai');const activation=option=>option.kind==='value'&&option.label==='起動';
  if(query.requiredInput?.presentationKey!=='script-activation'||query.requiredInput.actorSeat!=='ai')throw new Error('normal STD-003 activation window missing');
  if(waitingRoutes.length!==routeCount+1||waitingRoutes.at(-1).pointer!=='mouse')throw new Error('STD-003 did not use real desktop waiting menu');
  await explicitRegression(query,activation);const scriptRevision=query.status.revision;
  await answer(query,activation);
  if((await readQuery('ai')).status.revision<=scriptRevision)throw new Error('STD-003 declaration did not advance revision');
  await assertFinished(gun,null,scriptCleanup);
  query=await readQuery();if(side(query,'ai').back.cards.some(card=>card.cardRef===script)||!side(query,'ai').trash.cards.some(card=>card.definition.id==='STD-003'))throw new Error('STD-003 cleanup missing');

  await fresh();const response15=await add('STD-015','ai');gun=await add('STD-015');const response15Cleanup=cleanupSnapshot(await readQuery());await play('executeSpell',gun);query=await assertNotFinal(gun);
  if(query.requiredInput?.kind!=='waiting'||query.requiredInput.actorSeat!=='ai'||query.requiredInput.canAnswer!==false)throw new Error('normal STD-015 waiting boundary missing');
  routeCount=waitingRoutes.length;await viewer('ai');query=await readQuery('ai');
  if(query.requiredInput?.presentationKey!=='response-window'||query.requiredInput.actorSeat!=='ai')throw new Error('normal STD-015 response window missing');
  if(waitingRoutes.length!==routeCount+1||waitingRoutes.at(-1).pointer!=='mouse')throw new Error('STD-015 did not use real desktop waiting menu');
  const response15Predicate=option=>option.cardRef===response15;
  await explicitRegression(query,response15Predicate);const response15Revision=query.status.revision;
  await answer(query,response15Predicate);
  if((await readQuery('ai')).status.revision<=response15Revision)throw new Error('STD-015 declaration did not advance revision');
  await assertFinished(gun,'STD-015',response15Cleanup);

  page=await browser.newPage({viewport:{width:844,height:390},hasTouch:true,isMobile:true});touch=true;
  page.on('pageerror',error=>errors.push(error.message));target=new URL('mobile/',base);target.searchParams.set('e2e','1');
  await fresh();await setActive('ai');const purple=await add('STD-191','ai');
  await play('install',purple,'ai');const response207=await add('STD-207','ai');await setActive('player');
  const lockedSource=await add('SZTB-091');gun=await add('STD-015');const response207Cleanup=cleanupSnapshot(await readQuery());await play('executeSpell',gun);query=await assertNotFinal(gun);
  if(query.requiredInput?.kind!=='waiting'||query.requiredInput.actorSeat!=='ai'||query.requiredInput.canAnswer!==false)throw new Error('normal STD-207 waiting boundary missing');
  routeCount=waitingRoutes.length;await viewer('ai');query=await readQuery('ai');
  if(query.requiredInput?.presentationKey!=='response-window'||query.requiredInput.actorSeat!=='ai')throw new Error('normal STD-207 response window missing');
  if(waitingRoutes.length!==routeCount+1||waitingRoutes.at(-1).pointer!=='touch')throw new Error('STD-207 did not use real mobile waiting menu');
  const response207Predicate=option=>option.cardRef===response207;
  await explicitRegression(query,response207Predicate);const response207Revision=query.status.revision;
  await answer(query,response207Predicate);
  if((await readQuery('ai')).status.revision<=response207Revision)throw new Error('STD-207 declaration did not advance revision');
  query=await readQuery('ai');
  if(query.status.progress!=='resultLocked'||query.status.finished||query.status.lockedOutcome?.winnerSeat!=='player'
    ||!query.requiredInput?.canAnswer||query.requiredInput.actorSeat!=='ai'||cleanupSnapshot(query).trash!==response207Cleanup.trash+1||cleanupSnapshot(query).ban!==response207Cleanup.ban
    ||await page.locator('.r2-result').count())throw new Error('real STD-207 reveal did not preserve locked-not-finished boundary');
  const lockRevision=query.status.revision;
  const lockedDenied=await page.evaluate(input=>window.__SIMPLE_ZEKE_E2E__.submit(input,'player'),{
    commandId:'locked-play',expectedRevision:lockRevision,action:{type:'executeCard',cardRef:lockedSource,destination:{zone:'front',slot:1}}});
  if(lockedDenied?.ok&&lockedDenied.value.kind==='accepted'||(await readQuery('ai')).status.revision!==lockRevision)throw new Error('resultLocked new play changed match');
  await answer(await readQuery('ai'));await assertFinished(gun,'STD-207',response207Cleanup);
  if(errors.length)throw new Error('victory page errors '+errors.join(' | '));
  console.log(JSON.stringify({suite:'public-victory',single:true,script003:true,response015:true,realResultLocked207:true,
    normalDomAndSafeReads:true,explicitOptionalRegression:true,waitingMouse:waitingRoutes.filter(route=>route.pointer==='mouse').length,
    waitingTouch:waitingRoutes.filter(route=>route.pointer==='touch').length,mobileTouchContext:true,ok:true}));
}
