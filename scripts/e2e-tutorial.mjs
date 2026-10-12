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
  for (let index=0;index<await locator.count();index+=1) if (await locator.nth(index).isVisible()) {await locator.nth(index).click();return;}
  throw new Error('visible target unavailable: '+selector);
}
const read = page => page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.query());
function cards(query) {
  const output=[];const visit=card => {output.push(card);if (!card.faceDown) card.mounted.forEach(visit);};
  for (const seat of query.observation.seats) for (const zone of ['hand','front','back','registry','trash','ban']) seat[zone].cards?.forEach(visit);
  return output;
}
function answerFor(request,query,preference={}) {
  const preferred = request.options.filter(option => (!preference.zone || !option.zone || option.zone === preference.zone)
    && (!preference.targetId || !option.cardRef || cards(query).some(card => card.cardRef === option.cardRef && !card.faceDown && card.definition.id === preference.targetId))
    && (!preference.user || option.kind !== 'card')
    && (!preference.scope || !option.label || option.label.includes(preference.scope)));
  const ordered = [...preferred,...request.options.filter(option => !preferred.includes(option))];
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
  for (let count=request.constraints.minimum ?? 0;count<=Math.min(request.constraints.maximum ?? 0,ordered.length);count+=1) {const found=search(0,count);if(found)return found;}
  throw new Error('no valid safe selection: '+request.presentationKey);
}
async function choose(page,request,query,preference) {
  const answer=answerFor(request,query,preference);
  for (const id of answer.optionIds) await clickVisible(page,'[data-option-id="'+id+'"]');
  for (const row of answer.allocation) await page.locator('[data-allocation-option="'+row.optionId+'"]').fill(String(row.amount));
  await clickVisible(page,'[data-runtime-confirm]');
  return answer;
}
async function settle(page,{decline=false,checkBack=false}={}) {
  for (let index=0;index<50;index+=1) {
    const result=await read(page);if (!result.ok) throw new Error(JSON.stringify(result));
    const query=result.value,input=query.requiredInput;
    if (!input) return;
    if (!input.canAnswer) {await page.waitForFunction(() => {const input=window.__SIMPLE_ZEKE_E2E__.query().value?.requiredInput;return !input || input.canAnswer;});continue;}
    if (checkBack) {
      await clickVisible(page,'[data-runtime-back]');
      const after=(await read(page)).value;
      if (after.status.revision !== query.status.revision || after.requiredInput.choiceId !== input.choiceId) throw new Error('required Back changed committed state');
      await clickVisible(page,'[data-selection-collapse]');checkBack=false;
    }
    if (decline && input.optional) {await clickVisible(page,'[data-runtime-decline]');continue;}
    await choose(page,{...input,requestId:input.choiceId},query,{scope:'レイヤー'});
  }
  throw new Error('required input failed to settle');
}
async function action(page,type,id,preference={}) {
  const query=(await read(page)).value;
  const card=id && cards(query).find(card => !card.faceDown && card.definition.id === id && (type === 'attack' || type === 'redeploy' || type === 'activateCardEffect' ? ['front','back'].includes(card.location?.zone) : card.location?.zone === 'hand'));
  const entry=query.legalActions.find(entry => (entry.actionType ?? entry.action?.type) === type && (!id || (entry.base?.cardRef ?? entry.base?.attackerRef ?? entry.action?.cardRef) === card?.cardRef));
  if (!entry) throw new Error('legal action missing: '+type+' '+id);
  if (card) {if (!await page.locator('[data-card-ref="'+card.cardRef+'"]').first().isVisible()) await clickVisible(page,'[data-runtime-hand]');await clickVisible(page,'[data-card-ref="'+card.cardRef+'"]');}
  await clickVisible(page,'[data-action-id="'+entry.actionId+'"]');
  if (entry.kind === 'fixed') return;
  const selections=[];
  for (let index=0;index<6;index+=1) {
    const planned=await page.evaluate(input => window.__SIMPLE_ZEKE_E2E__.queryAction(input),{expectedRevision:query.status.revision,actionId:entry.actionId,selections});
    if (!planned.ok) throw new Error(JSON.stringify(planned));
    if (planned.value.completion) {await clickVisible(page,'[data-runtime-confirm]');return;}
    const request=planned.value.selectionRequests[0];
    selections.push(await choose(page,request,query,preference));
  }
  throw new Error('planning failed to complete');
}
async function intro(page,id) {
  for (let index=0;index<7;index+=1) {
    const guide=page.locator('.live-guide');
    if (await guide.getAttribute('data-tutorial-step') !== 'intro:'+index || (await guide.locator('.live-guide-cast strong').textContent())?.trim() !== 'じぐさぽ') throw new Error('introduction mismatch');
    if (index===3 && await guide.locator('ruby rt').textContent() !== 'ベータテスト') throw new Error('beta ruby missing');
    await clickVisible(page,'[data-runtime-tutorial-next]');
  }
  await step(page,id,0);await clickVisible(page,'[data-runtime-tutorial-next]');
}
async function step(page,id,index) {
  await page.waitForFunction(({id,index}) => document.querySelector('.live-guide')?.dataset.tutorialStep === id+':'+index && window.__SIMPLE_ZEKE_E2E__.tutorial().value?.opponentScript === null,{id,index});
  const audit=await page.locator('.live-guide').evaluate(node => {const rect=node.getBoundingClientRect();return {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,w:innerWidth,h:innerHeight};});
  if (audit.left<0 || audit.top<0 || audit.right>audit.w+1 || audit.bottom>audit.h+1) throw new Error('guide clipped: '+JSON.stringify(audit));
  if (!await page.locator('.live-focus[data-tutorial-focus-label]').count()) throw new Error('tutorial focus missing');
}
async function freshCompletion(page,old) {
  await page.waitForFunction(matchId => window.__SIMPLE_ZEKE_E2E__.scope()?.matchId !== matchId,old.matchId);
  const scope=await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.scope()),query=(await read(page)).value;
  if (scope.sessionGeneration<=old.sessionGeneration || query.status.revision!==0 || query.requiredInput || query.observation.seats.some(seat => seat.front.cards.length || seat.back.cards.length || seat.trash.cards.length)) throw new Error('tutorial completion carried old match');
  await action(page,'endTurn');
  if ((await read(page)).value.status.activeSeat===query.status.activeSeat) throw new Error('fresh sandbox end-turn unavailable');
}
async function run(page,id) {
  const target=new URL(url);target.searchParams.set('e2e','1');
  await page.goto(target.toString(),{waitUntil:'networkidle'});
  await page.evaluate(id => window.__SIMPLE_ZEKE_E2E__.start('tutorial',id,1),id);
  const old=await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.scope());
  await intro(page,id);
  if (id==='basics') {
    await step(page,id,1);await action(page,'install','STD-076');
    await step(page,id,2);await action(page,'executeCard','STD-075',{zone:'front'});
    await step(page,id,3);await action(page,'attack','STD-075',{user:true});
    await step(page,id,4);await action(page,'endTurn');await settle(page);
    await step(page,id,5);await action(page,'executeCard','STD-090',{zone:'front'});await settle(page);
    await step(page,id,6);await action(page,'endTurn');await settle(page);
    await step(page,id,7);await action(page,'attack','STD-090',{user:true});await settle(page);
    await step(page,id,8);await action(page,'executeSpell','STD-086',{targetId:'STD-131'});await settle(page,{decline:true});
  } else {
    await step(page,id,1);await action(page,'install','STD-191');
    await step(page,id,2);await action(page,'executeLayered','STD-195',{zone:'front'});await settle(page);
    await step(page,id,3);await action(page,'redeploy','STD-195',{zone:'back'});await settle(page,{checkBack:true});
    const moved=(await read(page)).value.observation.seats[0].back.cards.find(card => !card.faceDown && card.definition.id==='STD-195');
    if (!moved || moved.mounted.length!==1) throw new Error('selected relog layer cost not reflected');
    await step(page,id,4);await action(page,'executeCard','STD-194',{zone:'front'});await settle(page);
    await step(page,id,5);await action(page,'executeCard','STD-192',{zone:'front'});await settle(page);
    await step(page,id,6);await action(page,'activateCardEffect','STD-192',{targetId:'STD-194',zone:'back'});await settle(page);
  }
  await freshCompletion(page,old);
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
  console.log(JSON.stringify({suite:'tutorial',runs,freshCompletion:true,freshSkip:true,requiredBackPreserves:true,keyboardMode,ok:true}));
} finally {await browser.close();}
