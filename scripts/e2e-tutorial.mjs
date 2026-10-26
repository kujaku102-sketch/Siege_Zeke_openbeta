import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validSelectionAnswer } from '../src/game/runtime/selection-contract.js';

const args = process.argv.slice(2), keyboardMode = args.includes('--keyboard');
const flag = args.indexOf('--playwright-module');
const explicitPlaywrightModule = flag >= 0 ? args[flag+1] : process.env.SIMPLE_ZEKE_PLAYWRIGHT_MODULE;
const url = args.find((arg,index) => !['--keyboard','--playwright-module'].includes(arg) && index !== flag+1) ?? 'http://127.0.0.1:4173/';
async function loadPlaywright() {
  if (!explicitPlaywrightModule) throw new Error('provide --playwright-module or SIMPLE_ZEKE_PLAYWRIGHT_MODULE');
  const specifier = explicitPlaywrightModule.startsWith('file:') ? explicitPlaywrightModule : pathToFileURL(path.resolve(explicitPlaywrightModule)).href;
  if (!specifier.startsWith('file:') || !existsSync(new URL(specifier))) throw new Error('explicit Playwright module path is unavailable');
  return import(specifier);
}
async function clickVisible(page,selector) {
  if (keyboardMode) {
    for (let index=0;index<500;index+=1) {
      await page.keyboard.press('Tab');
      if (!await page.locator(selector).evaluateAll(nodes => nodes.some(node => node === document.activeElement && node.getClientRects().length))) continue;
      if (!await page.evaluate(() => {const style=getComputedStyle(document.activeElement);return parseFloat(style.outlineWidth)>0 || style.boxShadow !== 'none';})) throw new Error('keyboard focus invisible: '+selector);
      await page.keyboard.press('Enter');return;
    }
    throw new Error('keyboard target unreachable: '+selector);
  }
  const locator = page.locator(selector);
  for (let index=0;index<await locator.count();index+=1) if (await locator.nth(index).isVisible()) {
    const control=locator.nth(index);await control.scrollIntoViewIfNeeded();await control.focus();
    const point=await control.evaluate((node,selector)=>{const rect=node.getBoundingClientRect();return [[.5,.5],[.5,.18],[.2,.18],[.8,.18],[.18,.5],[.82,.5],[.5,.82],[.2,.82],[.8,.82]]
      .map(([rx,ry])=>({x:rect.left+rect.width*rx,y:rect.top+rect.height*ry}))
      .find(({x,y})=>document.elementFromPoint(x,y)?.closest(selector)===node)??null;},selector);
    if(point){await page.mouse.click(point.x,point.y);return;}
  }
  throw new Error('visible target unavailable: '+selector);
}
const read = page => page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.query());
function cards(query) {
  const output=[];const visit=card => {output.push(card);if (!card.faceDown) card.mounted.forEach(visit);};
  for (const seat of query.observation.seats) for (const zone of ['hand','front','back','registry','trash','ban']) seat[zone].cards?.forEach(visit);
  return output;
}
function answerFor(request,query,preference={},hidden=new Set()) {
  const preferred = request.options.filter(option => (!preference.zone || !option.zone || option.zone === preference.zone)
    // A mount destination names its host by hostRef.
    && (!preference.targetId || !(option.cardRef ?? option.hostRef) || cards(query).some(card => card.cardRef === (option.cardRef ?? option.hostRef) && !card.faceDown && card.definition.id === preference.targetId))
    && (!preference.user || option.kind !== 'card')
    && (!preference.cardOnly || Boolean(option.cardRef ?? option.hostRef))
    && (!preference.scope || !option.label || option.label.includes(preference.scope)));
  const others=request.options.filter(option => !preferred.includes(option)),shown=option => !hidden.has(option.optionId);
  const ordered = [...preferred.filter(shown),...preferred.filter(option => !shown(option)),...others.filter(shown),...others.filter(option => !shown(option))];
  const selected = [];
  const search = (start,count) => {
    if (!count) {const answer={requestId:request.requestId,optionIds:[...selected],allocation:[]};return validSelectionAnswer(request,answer) ? answer : null;}
    for (let index=start;index<=ordered.length-count;index+=1) {selected.push(ordered[index].optionId);const found=search(index+1,count-1);selected.pop();if(found)return found;}
    return null;
  };
  if (request.constraints.kind === 'allocation') {
    const option=ordered[0];const answer={requestId:request.requestId,optionIds:option ? [option.optionId] : [],allocation:option ? [{optionId:option.optionId,amount:request.constraints.total}] : []};
    if (validSelectionAnswer(request,answer)) return answer;
  }
  for (let count=Math.max(request.constraints.minimum ?? 0,preference.pick ? 1 : 0);count<=Math.min(request.constraints.maximum ?? 0,ordered.length);count+=1) {const found=search(0,count);if(found)return found;}
  throw new Error('no valid safe selection: '+request.presentationKey);
}
// A single pick is made on the board itself (the lit slot, card or user) and decides the step; a list or
// multi pick uses its option buttons and a confirm. Either way the control is found like a player would.
async function pick(page,option,query) {
  const listed=page.locator('[data-option-id="'+option.optionId+'"]');
  for (let index=0;index<await listed.count();index+=1) if (await listed.nth(index).isVisible()) return clickVisible(page,'[data-option-id="'+option.optionId+'"]');
  if (option.cardRef ?? option.hostRef) return clickVisible(page,'[data-card-ref="'+(option.cardRef ?? option.hostRef)+'"]');
  if (option.zone && Number.isSafeInteger(option.slot)) {
    const selector='.board-slot[data-seat="'+(option.seatId ?? query.status.viewerSeat)+'"][data-zone="'+option.zone+'"][data-slot="'+option.slot+'"]';
    for (let attempt=0;;attempt+=1) {
      try {return await clickVisible(page,selector);}
      catch (error) {if (attempt>=8 || !String(error.message).startsWith('visible target unavailable')) throw error;await page.waitForTimeout(200);}
    }
  }
  if (option.kind==='user' || option.targetKind==='user') return clickVisible(page,'[data-fortress="'+option.seatId+'"]');
  throw new Error('no control for option '+JSON.stringify(option));
}
const SLOT_POINTS=[[.5,.5],[.5,.18],[.2,.18],[.8,.18],[.18,.5],[.82,.5],[.5,.82],[.2,.82],[.8,.82]];
async function hiddenSlots(page,request,query) {
  const slots=request.options.filter(option => option.zone && Number.isSafeInteger(option.slot) && !(option.cardRef ?? option.hostRef))
    .map(option => ({id:option.optionId,selector:'.board-slot[data-seat="'+(option.seatId ?? query.status.viewerSeat)+'"][data-zone="'+option.zone+'"][data-slot="'+option.slot+'"]'}));
  if (!slots.length) return new Set();
  return new Set(await page.evaluate(({slots,points}) => slots.filter(({selector}) => {
    const node=document.querySelector(selector);if (!node) return true;const rect=node.getBoundingClientRect();
    return !points.some(([x,y]) => document.elementFromPoint(rect.left+rect.width*x,rect.top+rect.height*y)?.closest(selector)===node);
  }).map(slot => slot.id),{slots,points:SLOT_POINTS}));
}
async function choose(page,request,query,preference) {
  const answer=answerFor(request,query,preference,await hiddenSlots(page,request,query));
  for (const id of answer.optionIds) await pick(page,request.options.find(option => option.optionId===id),query);
  for (const row of answer.allocation) await page.locator('[data-allocation-option="'+row.optionId+'"]').fill(String(row.amount));
  const confirm=page.locator('[data-runtime-confirm]').first();
  if (await confirm.count() && await confirm.isVisible() && await confirm.isEnabled()) await clickVisible(page,'[data-runtime-confirm]');
  return answer;
}
// The tutorial refuses an off-script answer that would leave it unwinnable: the same choice stays open
// and the guide says why (tutorial-mode-controller.js, TUTORIAL_STEP_GUARDS).
async function refusedAnswer(page,input,query,label,reason) {
  const option=input.options.find(option => option.label===label);
  if (!option) throw new Error('off-script option missing: '+label);
  await pick(page,option,query);
  await page.locator('.live-guide .live-guide-error').waitFor({state:'visible',timeout:5000}).catch(() => {throw new Error('refusal reason not shown for '+label);});
  const text=await page.locator('.live-guide .live-guide-error').innerText(),after=(await read(page)).value;
  if (!text.includes(reason) || after.requiredInput?.choiceId!==input.choiceId || after.status.revision!==query.status.revision) throw new Error('off-script answer not refused: '+JSON.stringify({text,after:after.requiredInput?.choiceId}));
}
async function settle(page,{decline=false,checkBack=false,preference={scope:'レイヤー'},refuse=null}={}) {
  for (let index=0;index<50;index+=1) {
    const result=await read(page);
    if (!result.ok) throw new Error(JSON.stringify(result));
    const query=result.value,input=query.requiredInput;
    if (!input) return;
    if (!input.canAnswer) {await page.waitForFunction(() => {const input=window.__SIMPLE_ZEKE_E2E__.query().value?.requiredInput;return !input || input.canAnswer;});continue;}
    if (checkBack) {
      await clickVisible(page,'.effect-modal [data-runtime-back]');
      const after=(await read(page)).value;
      if (after.status.revision !== query.status.revision || after.requiredInput.choiceId !== input.choiceId) throw new Error('required Back changed committed state');
      await clickVisible(page,'[data-selection-collapse]');checkBack=false;
    }
    if (decline && input.optional) {await clickVisible(page,'[data-runtime-decline]');continue;}
    if (refuse && input.options.some(option => option.label===refuse.label)) {await refusedAnswer(page,input,query,refuse.label,refuse.reason);refuse=null;}
    await choose(page,{...input,requestId:input.choiceId},(await read(page)).value,preference);
  }
  throw new Error('required input failed to settle');
}
async function action(page,type,id,preference={}) {
  await readPages(page);
  const query=(await read(page)).value;
  const entryFor=card => query.legalActions.find(entry => (entry.actionType ?? entry.action?.type) === type && (!id || (entry.base?.cardRef ?? entry.base?.attackerRef ?? entry.action?.cardRef) === card?.cardRef));
  // A layer under another card has the same id: take the copy that has the action.
  const card=id && cards(query).find(card => !card.faceDown && card.definition.id === id && (type === 'attack' || type === 'redeploy' || type === 'activateCardEffect' ? ['front','back'].includes(card.location?.zone) : card.location?.zone === 'hand') && entryFor(card));
  const entry=entryFor(card);
  if (!entry) throw new Error('legal action missing: '+type+' '+id);
  if (card) {
    const cardSelector='[data-card-ref="'+card.cardRef+'"]';
    if (card.location?.zone === 'hand' && !await page.locator(cardSelector).first().isVisible()) await clickVisible(page,'[data-runtime-hand]');
    if (['front','back'].includes(card.location?.zone) && await page.locator('[data-layer="hand"]:not([hidden])').count()) await clickVisible(page,'[data-runtime-hand]');
    await clickVisible(page,cardSelector);
  }
  await clickVisible(page,'[data-action-id="'+entry.actionId+'"]');
  if (entry.kind === 'fixed') return;
  const selections=[],moved=async () => (await read(page)).value.status.revision!==query.status.revision;
  for (let index=0;index<6;index+=1) {
    // A finished plan is submitted by the UI itself; a pick that completes it ends the action.
    if (await moved()) return;
    const planned=await page.evaluate(input => window.__SIMPLE_ZEKE_E2E__.queryAction(input),{expectedRevision:query.status.revision,actionId:entry.actionId,selections});
    if (!planned.ok) {if (await moved()) return;throw new Error(JSON.stringify(planned));}
    if (planned.value.completion) {
      const confirm=page.locator('[data-runtime-confirm]').first();
      if (await confirm.count() && await confirm.isVisible()) await clickVisible(page,'[data-runtime-confirm]');
      // A refused plan stays on its confirm bar; the player backs out of it with [戻る].
      if (preference.refused) {
        await page.waitForTimeout(600);if (await moved()) throw new Error('off-script '+type+' '+id+' was accepted');
        for (let back=0;back<4 && await page.locator('[data-runtime-back]').first().isVisible().catch(() => false);back+=1) await clickVisible(page,'[data-runtime-back]');
        return;
      }
      if (await moved()) return;
      continue;
    }
    const request=planned.value.selectionRequests[0];
    selections.push(await choose(page,request,query,preference));
  }
  if (await moved()) return;
  throw new Error('planning failed to complete');
}
// A guide line may run over several pages (how many depends on the screen): press [次へ] until the
// step's last page, where its highlights and its own button appear.
async function readPages(page) {
  await page.waitForFunction(() => !document.querySelector('.live-guide[data-paging="pending"]'),null,{timeout:5000}).catch(() => {});
  for (let turn=0;turn<12;turn+=1) {
    const before=await page.locator('.live-guide').getAttribute('data-guide-page').catch(() => null);
    if (!await page.locator('.live-guide [data-runtime-guide-next]').first().isVisible().catch(() => false)) return;
    await clickVisible(page,'.live-guide [data-runtime-guide-next]');
    await page.waitForFunction(before => document.querySelector('.live-guide')?.dataset.guidePage!==before,before,{timeout:3000});
  }
  throw new Error('guide pages never reached the last one');
}
const next = async page => {await readPages(page);await clickVisible(page,'[data-runtime-tutorial-next]');};
// Red step 3: Atto's play button is highlighted in its popup; pressing it names the missing red symbol and the step moves on.
async function tryBlockedPlay(page,id,cardId) {
  const card=cards((await read(page)).value).find(card => !card.faceDown && card.definition.id===cardId && card.location?.zone==='hand');
  const selector='[data-card-ref="'+card.cardRef+'"]';
  if (!await page.locator(selector).first().isVisible()) await clickVisible(page,'[data-runtime-hand]');
  await clickVisible(page,selector);
  await page.locator('.r2-popup[data-card-id="'+cardId+'"] [data-tutorial-try].live-focus').waitFor({state:'attached',timeout:3000}).catch(() => {throw new Error('the blocked play is not highlighted in its popup');});
  await clickVisible(page,'[data-tutorial-try]');
  await page.waitForFunction(id => document.querySelector('.live-guide')?.dataset.tutorialStep===id+':4',id,{timeout:5000});
  // The guide hides its lines for the frame in which the new step's pages are being cut.
  await page.waitForFunction(() => !document.querySelector('.live-guide[data-paging="pending"]'),null,{timeout:5000});
  const reason=await page.locator('.live-guide .live-guide-error').innerText().catch(() => '');
  if (!reason.includes('シンボル')) throw new Error('the missing symbol is not named in the guide: '+reason);
}
async function intro(page,id) {
  for (let index=0;index<7;index+=1) {
    const guide=page.locator('.live-guide');
    if (await guide.getAttribute('data-tutorial-step') !== 'intro:'+index || (await guide.locator('.live-guide-cast strong').textContent())?.trim() !== 'じぐさぽ') throw new Error('introduction mismatch');
    if (index===3 && await guide.locator('ruby rt').textContent() !== 'ベータテスト') throw new Error('beta ruby missing');
    await next(page);
  }
  await step(page,id,0);await next(page);
}
async function step(page,id,index) {
  await page.waitForFunction(({id,index}) => document.querySelector('.live-guide')?.dataset.tutorialStep === id+':'+index && window.__SIMPLE_ZEKE_E2E__.tutorial().value?.opponentScript === null,{id,index});
  await readPages(page);
  const audit=await page.locator('.live-guide').evaluate(node => {const rect=node.getBoundingClientRect();return {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,w:innerWidth,h:innerHeight};});
  if (audit.left<0 || audit.top<0 || audit.right>audit.w+1 || audit.bottom>audit.h+1) throw new Error('guide clipped: '+JSON.stringify(audit));
  // The focus marks are placed by the frame-coalesced layout, one frame after the guide text changes.
  await page.locator('.live-focus[data-tutorial-focus-label]').first().waitFor({state:'attached',timeout:3000}).catch(() => {throw new Error('tutorial focus missing at '+id+':'+index);});
}
// V092-08 Q4/Q5: the winning attack ends the tutorial on its closing line (no result window); its button
// leaves the match for the tutorial list, marked done in this browser.
async function completionReturnsToList(page,id) {
  await page.waitForFunction(() => window.__SIMPLE_ZEKE_E2E__.tutorial().value?.flow.complete,null,{timeout:10000});
  await readPages(page);
  await page.locator('.live-guide [data-runtime-tutorial-finish]').waitFor({state:'visible',timeout:10000});
  const closing=await page.evaluate(() => ({text:document.querySelector('.live-guide-text')?.innerText ?? '',skip:Boolean(document.querySelector('[data-runtime-tutorial-skip]')),
    result:Boolean(document.querySelector('.r2-result')),won:window.__SIMPLE_ZEKE_E2E__.query().value?.status.lockedOutcome?.winnerSeat,
    opponentStr:window.__SIMPLE_ZEKE_E2E__.query().value?.observation.seats.find(seat => seat.seatId!=='player')?.fortressStr}));
  if (!closing.text.includes('勝利') || closing.skip || closing.result || closing.won!=='player' || closing.opponentStr!==0) throw new Error('closing line wrong: '+JSON.stringify(closing));
  await clickVisible(page,'[data-runtime-tutorial-finish]');
  await page.locator('[data-flow-screen="tutorial-select"]').waitFor({state:'visible',timeout:10000});
  const state=await page.evaluate(id => ({scope:window.__SIMPLE_ZEKE_E2E__.scope(),done:document.querySelector(`[data-tutorial-item="${id}"]`)?.dataset.done,
    saved:JSON.parse(localStorage.getItem('sz-tutorial-done') ?? '[]'),board:Boolean(document.querySelector('[data-live-region="board"]'))}),id);
  if (state.scope!==null || state.board) throw new Error('tutorial completion kept the match');
  if (state.done!=='true' || !state.saved.includes(id)) throw new Error('tutorial completion not marked: '+JSON.stringify(state));
}
async function run(page,id) {
  const target=new URL(url);target.searchParams.set('e2e','1');
  await page.goto(target.toString(),{waitUntil:'networkidle'});
  await page.waitForFunction(() => document.body.classList.contains('boot-done') && !document.querySelector('#boot-splash'), null, {timeout:10000});
  await page.evaluate(id => window.__SIMPLE_ZEKE_E2E__.start('tutorial',id,1),id);
  await intro(page,id);
  if (id==='basics') {
    // The author's 17-step red script: soldier, Atto (QA), Glenn for the red symbol, Junk Parts under Atto vs the Guardman.
    await step(page,id,1);await next(page);
    await step(page,id,2);await action(page,'executeCard','STD-021',{zone:'front'});
    await step(page,id,3);await tryBlockedPlay(page,id,'STD-091');
    await step(page,id,4);await next(page);
    await step(page,id,5);await action(page,'install','STD-087');
    await step(page,id,6);
    if (!await page.locator('[data-runtime-counts].live-focus').count()) throw new Error('the info button is not highlighted');
    await next(page);
    await step(page,id,7);await action(page,'executeCard','STD-091',{zone:'front'});
    await step(page,id,8);await next(page);
    await step(page,id,9);await action(page,'attack','STD-091',{user:true});await settle(page);
    await step(page,id,10);await action(page,'endTurn');await settle(page);
    await step(page,id,11);await next(page);
    // Alone in a slot the Junk Parts leave Atto too weak for the Guardman: refused, with the reason in the guide.
    await step(page,id,12);await action(page,'executeCard','STD-078',{zone:'front',refused:true});
    if (!(await page.locator('.live-guide .live-guide-error').innerText().catch(() => '')).includes('アツト')) throw new Error('the Junk Parts refusal reason is not shown');
    await action(page,'executeCard','STD-078',{targetId:'STD-091',cardOnly:true});await settle(page);
    await step(page,id,13);await action(page,'attack','STD-091',{targetId:'STD-022'});await settle(page);
    await step(page,id,14);await next(page);
    await step(page,id,15);await action(page,'attack','STD-021',{user:true});await settle(page);
  } else {
    await step(page,id,1);await action(page,'install','STD-191');
    await step(page,id,2);await action(page,'executeLayered','STD-195',{zone:'front'});await settle(page);
    await step(page,id,3);await action(page,'redeploy','STD-195',{zone:'back'});await settle(page,{checkBack:true});
    const moved=(await read(page)).value.observation.seats[0].back.cards.find(card => !card.faceDown && card.definition.id==='STD-195');
    if (!moved || moved.mounted.length!==1) throw new Error('selected relog layer cost not reflected');
    await step(page,id,4);await action(page,'executeCard','STD-194',{zone:'front'});await settle(page);
    await step(page,id,5);await action(page,'executeCard','STD-192',{zone:'front'});await settle(page);
    await step(page,id,6);await action(page,'activateCardEffect','STD-192',{targetId:'STD-194',zone:'back'});await settle(page);
    await step(page,id,7);await action(page,'endTurn');await settle(page);
    await step(page,id,8);await action(page,'redeploy','STD-195',{zone:'front'});await settle(page);
    await step(page,id,9);await action(page,'attack','STD-195',{user:true});await settle(page);
    await step(page,id,10);await action(page,'attack','STD-189',{user:true});await settle(page);
  }
  await completionReturnsToList(page,id);
}
const playwright=await loadPlaywright(),{chromium}=playwright.default ?? playwright;
const browser=await chromium.launch({channel:'msedge',headless:true}),runs=[],errors=[];
try {
  const profiles=keyboardMode ? [{label:'desktop-keyboard',width:1600,height:1000},{label:'zoom-200-equivalent-keyboard',width:640,height:360}]
    : [{label:'desktop',width:1600,height:1000},{label:'mobile',width:844,height:390},{label:'zoom-200-equivalent',width:640,height:360}];
  for (const profile of profiles) {
    const page=await browser.newPage({viewport:{width:profile.width,height:profile.height}});
    page.on('pageerror',error => errors.push(error.message));
    for (const id of ['basics','vengeance']) {await run(page,id);runs.push({profile:profile.label,tutorial:id});}
    // Skip during a committed required choice revokes old refs and cannot carry it.
    await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.start('tutorial','vengeance',1));
    await intro(page,'vengeance');await action(page,'install','STD-191');await action(page,'executeLayered','STD-195',{zone:'front'});await action(page,'redeploy','STD-195',{zone:'back'});
    const old=(await read(page)).value,scope=await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.scope());
    if (!old.requiredInput) throw new Error('skip case not in required choice');
    await clickVisible(page,'[data-runtime-tutorial-skip]');
    const after=(await read(page)).value;
    if (after.requiredInput || after.status.revision!==0 || after.status.matchId===scope.matchId) throw new Error('skip did not create fresh sandbox');
    const stale=await page.evaluate(input => window.__SIMPLE_ZEKE_E2E__.submit(input),{commandId:'old-choice',expectedRevision:0,action:{type:'answerChoice',choiceId:old.requiredInput.choiceId,optionIds:[],allocation:[]}});
    if (stale.ok && stale.value.kind==='accepted') throw new Error('old choice accepted after skip');
    await page.close();
  }
  if (errors.length) throw new Error('tutorial page errors: '+errors.join(' | '));
  console.log(JSON.stringify({suite:'tutorial',runs,completionReturnsToList:true,offScriptRefused:true,freshSkip:true,requiredBackPreserves:true,keyboardMode,ok:true}));
} finally {await browser.close();}
