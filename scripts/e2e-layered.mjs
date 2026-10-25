import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validSelectionAnswer } from '../src/game/runtime/selection-contract.js';
import { waitForBootSplash } from './e2e-entry-crt.mjs';
const args=process.argv.slice(2),flag=args.indexOf('--playwright-module');
const explicitPlaywrightModule=flag>=0 ? args[flag+1] : process.env.SIMPLE_ZEKE_PLAYWRIGHT_MODULE;
const url=args.find((arg,index) => arg !== '--playwright-module' && index !== flag+1) ?? 'http://127.0.0.1:4173/';
async function loadPlaywright() {
  if (!explicitPlaywrightModule) throw new Error('provide --playwright-module or SIMPLE_ZEKE_PLAYWRIGHT_MODULE');
  const specifier=explicitPlaywrightModule.startsWith('file:') ? explicitPlaywrightModule : pathToFileURL(path.resolve(explicitPlaywrightModule)).href;
  if (!specifier.startsWith('file:') || !existsSync(new URL(specifier))) throw new Error('explicit Playwright module path is unavailable');
  return import(specifier);
}
const playwright=await loadPlaywright(),{chromium}=playwright.default ?? playwright;
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];
page.on('pageerror',error => errors.push(error.message));
const read=() => page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.query().value);
const visibleCards=query => {
  const output=[];const visit=card => {output.push(card);if (!card.faceDown)card.mounted.forEach(visit);};
  for(const seat of query.observation.seats)for(const zone of ['hand','front','back','registry','trash','ban'])seat[zone].cards?.forEach(visit);
  return output;
};
const own=query => query.observation.seats[0];
function selection(request,query,{zone='front',ids=[],scope=''}={}) {
  const ordered=[...request.options].sort((a,b) => {
    const rank=option => (option.zone===zone ? 100 : 0)+(option.kind==='user' ? 100 : 0)
      +(ids.includes(visibleCards(query).find(card => card.cardRef===(option.cardRef ?? option.hostRef))?.definition?.id) ? 1000 : 0)
      +(scope && option.label?.includes(scope) ? 1000 : 0);
    return rank(b)-rank(a);
  });
  const picked=[],search=(start,count) => {
    if (!count) {const value={requestId:request.requestId,optionIds:[...picked],allocation:[]};return validSelectionAnswer(request,value) ? value : null;}
    for(let index=start;index<=ordered.length-count;index+=1){picked.push(ordered[index].optionId);const value=search(index+1,count-1);picked.pop();if(value)return value;}
    return null;
  };
  for(let count=request.constraints.minimum ?? 0;count<=Math.min(request.constraints.maximum ?? 0,ordered.length);count+=1){const value=search(0,count);if(value)return value;}
  throw new Error('no safe valid selection '+request.presentationKey);
}
async function click(selector) {const nodes=page.locator(selector);for(let index=0;index<await nodes.count();index+=1)if(await nodes.nth(index).isVisible()){await nodes.nth(index).click();return;}throw new Error('visible control missing '+selector);}
// A single pick is made on the board itself (the lit slot, card or user) and decides the step; a list or
// multi pick uses its option buttons and a confirm. Either way the control is found like a player would.
async function pick(option,query) {
  const listed=page.locator('[data-option-id="'+option.optionId+'"]');
  for(let index=0;index<await listed.count();index+=1)if(await listed.nth(index).isVisible()){await listed.nth(index).click();return;}
  if(option.cardRef ?? option.hostRef)return click('[data-card-ref="'+(option.cardRef ?? option.hostRef)+'"]');
  if(option.zone && Number.isSafeInteger(option.slot))return click('.board-slot[data-seat="'+(option.seatId ?? query.status.viewerSeat)+'"][data-zone="'+option.zone+'"][data-slot="'+option.slot+'"]');
  if(option.kind==='user' || option.targetKind==='user')return click('[data-fortress="'+option.seatId+'"]');
  throw new Error('no control for option '+JSON.stringify(option));
}
async function choose(request,query,preference) {
  const answer=selection(request,query,preference);
  for(const id of answer.optionIds){await pick(request.options.find(option => option.optionId===id),query);}
  const confirm=page.locator('[data-runtime-confirm]').first();
  if(await confirm.count() && await confirm.isVisible() && await confirm.isEnabled())await confirm.click();
  return answer;
}
async function settle(preference={}) {
  for(let index=0;index<50;index+=1){
    const query=await read(),input=query.requiredInput;if(!input)return;
    if(!input.canAnswer)throw new Error('fixture normal action left choice to other seat');
    await choose({...input,requestId:input.choiceId},query,preference);
  }
  throw new Error('normal fixture choice did not settle');
}
async function action(type,id,preference={}) {
  const query=await read(),card=id && visibleCards(query).find(card => !card.faceDown && card.definition.id===id && card.controllerSeat==='player'
    && (['attack','redeploy'].includes(type) ? ['front','back'].includes(card.location?.zone) : card.location?.zone==='hand'));
  const entry=query.legalActions.find(entry => (entry.actionType ?? entry.action?.type)===type
    && (!id || (entry.base?.cardRef ?? entry.base?.attackerRef ?? entry.action?.cardRef)===card?.cardRef));
  if(!entry)throw new Error('normal action missing '+type+' '+id);
  if(card){await click('[data-card-ref="'+card.cardRef+'"]');}
  await click('[data-action-id="'+entry.actionId+'"]');
  if(entry.kind==='fixed')return;
  const selections=[],moved=async () => (await read()).status.revision!==query.status.revision;
  for(let index=0;index<6;index+=1){
    // A finished plan is submitted by the UI itself (no extra confirm); a pick that completes it ends the action.
    if(await moved())return;
    const result=await page.evaluate(input => window.__SIMPLE_ZEKE_E2E__.queryAction(input),{expectedRevision:query.status.revision,actionId:entry.actionId,selections});
    if(!result.ok){if(await moved())return;throw new Error(JSON.stringify(result));}
    if(result.value.completion){const confirm=page.locator('[data-runtime-confirm]').first();if(await confirm.count() && await confirm.isVisible())await confirm.click();if(await moved())return;continue;}
    selections.push(await choose(result.value.selectionRequests[0],query,preference));
  }
  if(await moved())return;
  throw new Error('normal plan did not complete');
}
async function fresh(ids) {
  const target=new URL(url);target.searchParams.set('e2e','1');await page.goto(target.toString(),{waitUntil:'networkidle'});await waitForBootSplash(page);
  const start=await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.start('sandbox','basics',1));
  if(!start.ok)throw new Error(JSON.stringify(start));
  for(const id of ids){const result=await page.evaluate(id => window.__SIMPLE_ZEKE_E2E__.sandbox({type:'sandboxAddCard',definitionId:id,targetSeat:'player'}),id);if(!result.ok || result.value.kind!=='accepted')throw new Error(JSON.stringify(result));}
}
async function turn() {
  await action('endTurn');await settle();
  await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.switchViewer('ai'));
  const query=await read(),result=await page.evaluate(query => window.__SIMPLE_ZEKE_E2E__.submit({commandId:'pass:'+query.status.revision,expectedRevision:query.status.revision,action:{type:'endTurn'}},'ai'),query);
  if(!result.ok || result.value.kind!=='accepted')throw new Error(JSON.stringify(result));
  await settle();await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.switchViewer('player'));
}
function top(query,id) {return own(query).front.cards.find(card => !card.faceDown && card.definition.id===id);}
try {
  await fresh(['STD-205','STD-205','STD-020']);await action('install','STD-205');await action('executeCard','STD-020');await action('executeLayered','STD-205',{ids:['STD-020']});await settle();
  let query=await read();if(top(query,'STD-205')?.mounted.map(card => card.definition.id).join()!=='STD-020')throw new Error('area-only layered mismatch');

  await fresh(['STD-238','STD-238','STD-020','STD-001']);await action('install','STD-238');await turn();await action('install','STD-001');await action('executeCard','STD-020');
  await action('executeLayered','STD-238',{ids:['STD-020','STD-001']});await settle();
  query=await read();if(top(query,'STD-238')?.mounted.length!==2 || own(query).registry.cards.some(card => card.definition.id==='STD-001'))throw new Error('registry layered mismatch');

  await fresh(['SZTB-093','SZTB-090','SZTB-091']);await action('executeCard','SZTB-091',{zone:'back'});await action('executeLayered','SZTB-093',{ids:['SZTB-090','SZTB-091']});await settle();
  query=await read();if(top(query,'SZTB-093')?.mounted.length!==2 || own(query).hand.cards.some(card => card.definition.id==='SZTB-090'))throw new Error('hand-area layered mismatch');

  // Real layered prerequisites replace the former impossible raw STD-096 stack.
  await fresh(['STD-094','STD-096','STD-096','STD-092','STD-075','STD-075']);await action('install','STD-096');
  await action('executeCard','STD-092');await action('executeCard','STD-075');await action('executeCard','STD-075');
  await action('executeLayered','STD-094',{ids:['STD-092','STD-075']});await settle();
  await action('executeLayered','STD-096',{ids:['STD-094','STD-075']});await settle();await turn();
  query=await read();const layers=top(query,'STD-096').mounted,chosen=layers[1].definition.id;
  await action('attack','STD-096');await settle({scope:'破棄して起動',ids:[chosen]});
  query=await read();if(top(query,'STD-096').mounted.length!==layers.length-1 || !own(query).trash.cards.some(card => card.definition.id===chosen) || top(query,'STD-096').status.sleep)throw new Error('user-selected attack layer cost mismatch');

  // A legal mounted Code preserves a nested subtree when consumed as material.
  await fresh(['STD-205','STD-205','STD-020','SZTB-091']);await action('install','STD-205');await action('executeCard','STD-020');
  // A Code is mounted through its normal execution: the destination list offers the host Ob.
  await action('executeCard','SZTB-091',{ids:['STD-020']});await action('executeLayered','STD-205',{ids:['STD-020']});await settle();
  query=await read();if(top(query,'STD-205').mounted.map(card => card.definition.id).join()!=='STD-020,SZTB-091')throw new Error('nested layered mismatch');

  // All negative surfaces are reached through normal setup/commands.
  await fresh(['STD-205','STD-205','STD-020','STD-020','STD-184','STD-184']);await action('install','STD-205');await turn();await action('install','STD-184');await action('executeCard','STD-020');await action('executeCard','STD-020',{zone:'back'});await action('setScript','STD-184',{zone:'back'});await settle();
  query=await read();const entry=query.legalActions.find(entry => entry.actionType==='executeLayered');
  const first=await page.evaluate(input => window.__SIMPLE_ZEKE_E2E__.queryAction(input),{expectedRevision:query.status.revision,actionId:entry.actionId,selections:[]});
  const materialRequest=first.value.selectionRequests[0];
  for(const option of materialRequest.options){const card=visibleCards(query).find(card => card.cardRef===option.cardRef);if(!card || card.faceDown || card.controllerSeat!=='player' || !['front','back'].includes(card.location?.zone))throw new Error('illegal layered candidate leaked');}
  if(errors.length)throw new Error('layered page errors: '+errors.join(' | '));
  console.log(JSON.stringify({suite:'layered',areaOnly:true,registry:true,handAndArea:true,userSelectedLayerCost:true,nestedStack:true,illegalCandidatesRejected:true,rawFixtures:false,ok:true}));
} finally {await browser.close();}
