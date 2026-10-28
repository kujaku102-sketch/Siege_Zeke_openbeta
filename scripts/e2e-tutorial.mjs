import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validSelectionAnswer } from '../src/game/runtime/selection-contract.js';

// --screens: the 1920×1080 and 1280×720 PCs and the iPhone 852×393 / 932×430 at DPR3, where the guide takes a third of
// the height (文豪, 2026-10-27).
const args = process.argv.slice(2), keyboardMode = args.includes('--keyboard'), screensMode = args.includes('--screens');
const flag = args.indexOf('--playwright-module');
const explicitPlaywrightModule = flag >= 0 ? args[flag+1] : process.env.SIMPLE_ZEKE_PLAYWRIGHT_MODULE;
const url = args.find((arg,index) => !['--keyboard','--screens','--playwright-module'].includes(arg) && index !== flag+1) ?? 'http://127.0.0.1:4173/';
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
// The guide (its portrait and speech frame) never covers what it asks the player to press: the step's highlights
// (the popup button its move needs among them, 文豪 2026-10-28) and a pick's choices. Checked once the screen stops
// moving, at every step's last page, every popup and every pick; all overlaps are listed when the run ends. Edges
// meeting within a pixel only touch (852×393: the frame's top 0.19px over the pick bar's [戻る]). A popup merely
// left open is not avoided; its covered buttons are only counted.
const covered=[],leftOpen=[];let profileLabel='';
async function guideClear(page,moment) {
  const probe=() => page.evaluate(() => [...document.querySelectorAll('.live-guide,.r2-popup')].map(node => {const r=node.getBoundingClientRect();return [r.left,r.top,r.width,r.height].map(Math.round).join(',');}).join('|'));
  for (let last=null,quiet=0,turn=0;turn<30 && quiet<3;turn+=1) {const now=await probe();quiet=now===last ? quiet+1 : 0;last=now;await page.waitForTimeout(100);}
  const hits=await page.evaluate(() => {
    // Put away, only its [スキップ] stays: clear of the same, and of the opponent's display.
    const guide=document.querySelector('.live-guide'),away=document.querySelector('.live-guide-away');if (!guide && !away) return [];
    const parts=(guide ? [guide.querySelector('.live-guide-cast img,.live-guide-noportrait'),guide.querySelector('.live-guide-speech')] : [away.querySelector('button')]).filter(Boolean).map(node => node.getBoundingClientRect());
    const area=(a,b) => {const x=Math.min(a.right,b.right)-Math.max(a.left,b.left),y=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);return x>=1 && y>=1 ? x*y : 0;};
    const flow=window.__SIMPLE_ZEKE_E2E__.tutorial().value?.flow;
    return [...document.querySelectorAll('.live-focus,.request-target,.runtime-selection-option,[data-runtime-confirm],[data-runtime-back],[data-runtime-decline],.r2-popup button'+(away ? ',.wf-status.wf-enemy' : ''))]
      .filter(node => !node.closest('.live-guide,.live-guide-away') && getComputedStyle(node).visibility!=='hidden' && node.getBoundingClientRect().width>0)
      .map(node => ({name:(node.dataset.tutorialFocusLabel || node.getAttribute('aria-label') || node.textContent || node.className).toString().trim().slice(0,24),
        leftOpen:Boolean(guide) && node.matches('.r2-popup button:not(.live-focus)'),area:Math.round(parts.reduce((sum,part) => sum+area(part,node.getBoundingClientRect()),0))}))
      .filter(hit => hit.area>1).map(hit => ({...hit,step:guide?.dataset.tutorialStep ?? flow?.tutorialId+':'+flow?.index,band:guide ? document.querySelector('.r2-runtime-view')?.dataset.guideBand : 'away'}));
  });
  for (const hit of hits) (hit.leftOpen ? leftOpen : covered).push({at:`${moment}@${hit.step}`,name:hit.name,line:`${profileLabel} ${moment}@${hit.step} (${hit.band}): ${hit.name} ${hit.area}px²`});
}
// Known on the --screens sizes, 文豪's call pending (2026-10-28): with the guide a third of the height (or more, a
// long 「」 growing it), what these vengeance steps point at spans all three bands, so every band covers some of it
// while the line is read. Put away by a tap before the move, it covers nothing at the popups and picks that follow.
// Anything else covered fails.
// Blue 3-6: Rutile's access list stands at the left edge, its first rows under the portrait while the Login is
// explained over the open choice (seen at 1280×720 and 844×390; the --screens sizes not run, 文豪 2026-10-28).
const KNOWN_COVERED={
  'page@vengeance:2':['素材ドールズ'],'page@vengeance:6':['効果起動','アクロィア','タナフォリア'],'page@vengeance:7':['ターン終了','トライプビア'],
  ...Object.fromEntries([3,4,5,6].map(index => ['page@blue:'+index,['2Sp/オフェンスプロトコル','5Sp/アサルトプログラム']]))
};
// One page a 「」 of the script (pages cut at ▽ only), its text inside the frame (one line kept free for a refused
// move's reason), the frame and the portrait on screen, the guide's buttons clear of the text (文豪, 2026-10-28).
// Checked on every page.
const pageIssues=[];let frameMax=0;
async function guidePage(page) {
  await page.waitForFunction(() => !document.querySelector('.live-guide[data-paging="pending"]'),null,{timeout:5000}).catch(() => {});
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const m=await page.evaluate(() => {
    const guide=document.querySelector('.live-guide');if (!guide) return null;
    const presentation=window.__SIMPLE_ZEKE_E2E__.tutorial().value?.presentation;
    const frame=guide.querySelector('.live-guide-speech').getBoundingClientRect(),text=guide.querySelector('.live-guide-text'),line=text.querySelector('p');
    const portrait=guide.querySelector('.live-guide-cast img,.live-guide-noportrait')?.getBoundingClientRect();
    const height=parseFloat(getComputedStyle(line).lineHeight),textBottom=text.getBoundingClientRect().bottom,said=line.getBoundingClientRect();
    const overText=[...guide.querySelectorAll('nav :is(button,.live-guide-page)')].map(node => node.getBoundingClientRect())
      .some(b => b.width>0 && Math.min(b.right,said.right)-Math.max(b.left,said.left)>=1 && Math.min(b.bottom,said.bottom)-Math.max(b.top,said.top)>=1);
    return {step:guide.dataset.tutorialStep,page:guide.dataset.guidePage,shown:line.textContent,ruby:Boolean(presentation?.parts),overText,
      pieces:String(presentation?.text ?? '').split('▽').map(piece => piece.trim()).filter(Boolean),
      spare:(textBottom-line.getBoundingClientRect().bottom)/height,frame:frame.height/innerHeight,
      onScreen:frame.top>=-.5 && frame.bottom<=innerHeight+.5 && (!portrait || (portrait.top>=-.5 && Math.abs(portrait.bottom-frame.bottom)<1.5))};
  });
  if (!m) return;
  const at=`${profileLabel} ${m.step} ${m.page}`,[index,count]=m.page.split('/').map(Number);
  frameMax=Math.max(frameMax,m.frame);
  if (!m.ruby && (count!==m.pieces.length || m.shown!==m.pieces[index-1])) pageIssues.push(`${at}: not one 「」 a page (${m.pieces.length} in the line)`);
  if (m.spare<.99) pageIssues.push(`${at}: ${m.spare<0 ? 'text out of the frame' : 'no free line for a reason'} (${m.spare.toFixed(2)} lines spare)`);
  if (!m.onScreen) pageIssues.push(`${at}: the frame or the portrait off the screen`);
  if (m.overText) pageIssues.push(`${at}: a guide button over the text`);
}
const knownCovered=hit => (KNOWN_COVERED[hit.at] ?? []).some(name => hit.name.startsWith(name));
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
  // A pick that completes a refused plan brings the guide back: the confirm bar waits with the match.
  const confirm=page.locator('[data-runtime-confirm]').first();
  if (!await page.locator('.live-guide').count() && await confirm.count() && await confirm.isVisible() && await confirm.isEnabled()) await clickVisible(page,'[data-runtime-confirm]');
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
  await putAway(page);
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
  await readPages(page);await putAway(page);
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
    await guideClear(page,'popup');
    // The popup button the step's move needs is highlighted (文豪, 2026-10-28).
    if (await page.evaluate(() => ['play','install','attack','layered','relog','activate-effect'].includes(window.__SIMPLE_ZEKE_E2E__.tutorial().value?.presentation?.expect?.type))
      && !await page.locator('.r2-popup [data-route].live-focus').count()) throw new Error('the popup button the step expects is not highlighted: '+type+' '+id);
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
      if (!await page.locator('.live-guide').count() && await confirm.count() && await confirm.isVisible()) await clickVisible(page,'[data-runtime-confirm]');
      // A refused plan stays on its confirm bar; the guide comes back with the reason and the match waits again, the
      // same reason as before too. Once it is put away the player backs out of the plan with [戻る].
      if (preference.refused) {
        await page.waitForTimeout(600);if (await moved()) throw new Error('off-script '+type+' '+id+' was accepted');
        await page.locator('.live-guide').waitFor({state:'visible',timeout:3000}).catch(() => {throw new Error('the guide did not come back on the refused '+preference.label);});
        const reason=await page.locator('.live-guide .live-guide-error').innerText().catch(() => '');
        if (!reason.includes(preference.refused)) throw new Error('the refusal reason is not shown for '+preference.label+': '+reason);
        await tapWhileSpeaking(page,'refused '+preference.label);
        await putAway(page);
        for (let back=0;back<4 && await page.locator('[data-runtime-back]').first().isVisible().catch(() => false);back+=1) await clickVisible(page,'[data-runtime-back]');
        return;
      }
      if (await moved()) return;
      continue;
    }
    await guideClear(page,'pick');
    // What can be picked on the board glows on its own frame (the slot or the user), no box laid over it.
    if (await page.evaluate(() => [...document.querySelectorAll('.wire-board .request-target')].some(node => getComputedStyle(node).outlineStyle!=='none'
      || !/wf-glow/.test(getComputedStyle(node.querySelector(':scope > :is(.slot,.user-target)') ?? node).filter)))) throw new Error('a board pick target is boxed or does not glow: '+type+' '+id);
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
    await guidePage(page);
  }
  throw new Error('guide pages never reached the last one');
}
const next = async page => {await readPages(page);await clickVisible(page,'[data-runtime-tutorial-next]');};
// While the guide speaks the match takes no input; on a step that asks for a move a tap on its line puts it away
// until the next step or a refused move (文豪, 2026-10-28). A step pointing at a button to press is one
// such step, though the script moves it on by [次へ].
async function putAway(page) {
  const press=await page.evaluate(() => Boolean(window.__SIMPLE_ZEKE_E2E__.tutorial().value?.presentation?.focus?.some(focus => focus.kind==='button')));
  if (!await page.locator('.live-guide').count() || await page.locator(press ? '.live-guide [data-runtime-guide-next]' : '.live-guide :is([data-runtime-guide-next],[data-runtime-tutorial-next],[data-runtime-tutorial-finish])').count()) return;
  if (!await page.evaluate(() => ['board','hand','console'].every(name => document.querySelector(`[data-live-region="${name}"]`)?.inert))) throw new Error('the match takes input while the guide speaks');
  await clickVisible(page,'.live-guide-text');
  await page.waitForFunction(() => !document.querySelector('.live-guide'),null,{timeout:3000});
  if (await page.evaluate(() => document.querySelector('[data-live-region="board"]')?.inert)) throw new Error('the match still waits with the guide put away');
  if (!await page.locator('.live-guide-away [data-runtime-tutorial-skip]').isVisible()) throw new Error('[スキップ] not kept with the guide put away');
}
// While the guide speaks a real click (a tap on a phone) on what it does not cover changes nothing: cards, popup and
// pick buttons, slots, the user, the hand button (a phone tap on a card fell on a popup's button left open).
async function tapWhileSpeaking(page,label) {
  const state=() => page.evaluate(() => {const query=window.__SIMPLE_ZEKE_E2E__.query().value,flow=window.__SIMPLE_ZEKE_E2E__.tutorial().value.flow;
    return JSON.stringify({revision:query.status.revision,input:query.requiredInput?.choiceId ?? null,step:flow.index,guide:Boolean(document.querySelector('.live-guide')),
      popups:document.querySelectorAll('.r2-popup').length,details:document.querySelectorAll('.r2-detail').length,hand:document.querySelector('[data-layer="hand"]:not([hidden])') !== null,
      pick:document.querySelectorAll('[data-runtime-confirm],[data-runtime-back],[data-option-id]').length});});
  const touch=await page.evaluate(() => navigator.maxTouchPoints>0);
  // The frame grows a line for a refused move's reason: the points are taken once it has settled.
  await page.waitForTimeout(400);
  const points=await page.evaluate(() => [...document.querySelectorAll('[data-card-ref],[data-action-id],[data-runtime-confirm],[data-runtime-back],[data-option-id],.board-slot,[data-fortress],[data-runtime-hand]')]
    .map(node => {const rect=node.getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2,shown:rect.width>0};})
    .filter(({x,y,shown}) => shown && x>=0 && y>=0 && x<innerWidth && y<innerHeight));
  const before=await state();
  if (!JSON.parse(before).guide) throw new Error('the guide is not speaking at '+label);
  let pressed=0;
  for (const point of points) {
    // A tap on the guide's own line puts it away: only what lies clear of the guide is pressed (a phone's touch
    // adjustment takes a tap just beside the line for the line).
    const hit=await page.evaluate(({x,y}) => {const node=document.elementFromPoint(x,y),margin=innerHeight*.06;
      const near=[...document.querySelectorAll('.live-guide-speech,.live-guide-away button')].some(guide => {const rect=guide.getBoundingClientRect();
        return x>rect.left-margin && x<rect.right+margin && y>rect.top-margin && y<rect.bottom+margin;});
      return near || node?.closest('.live-guide,.live-guide-away') ? null : node?.outerHTML.slice(0,80) ?? '';},point);
    if (hit===null) continue;
    if (touch) await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);
    await page.waitForTimeout(60);
    const after=await state();
    if (after!==before) throw new Error('a tap while the guide speaks changed the match at '+label+' (pressed '+hit+'): '+before+' -> '+after);
    if ((pressed+=1)>=16) break;
  }
  if (!pressed) throw new Error('nothing outside the guide to press at '+label);
}
// A step that asks to press something to see it moves on once it is open; the next line waits until it is closed
// (文豪, 2026-10-28): the info button (held, let go), Atto's QA badge in its detail, the Junk Parts' detail.
async function pressAsked(page,id,index,open,close) {
  await step(page,id,index);await putAway(page);
  await open();
  await page.waitForFunction(step => window.__SIMPLE_ZEKE_E2E__.tutorial().value?.flow.index===step,index+1,{timeout:3000}).catch(() => {throw new Error('pressing what '+id+':'+index+' asks did not move it on');});
  if (close) {
    if (await page.locator('.live-guide').count()) throw new Error('the next line covers what was opened at '+id+':'+index);
    await close();
  }
  await page.locator('.live-guide').waitFor({state:'visible',timeout:3000}).catch(() => {throw new Error('the next line did not come back after '+id+':'+index);});
}
// Blue step 6: Rutile's access lists the Offense Protocol and the Assault Programs. The Offense Protocol is
// highlighted; an Assault Program is refused with the reason, and the guide comes back.
async function accessPick(page) {
  await putAway(page);
  const query=(await read(page)).value,input=query.requiredInput;
  const option=id => input?.options.find(option => option.preview?.definitionId===id);
  if (!option('STD-111') || !option('STD-116')) throw new Error('the access does not list both programs');
  if (!await page.locator('[data-option-card-id="STD-111"].live-focus').count()) throw new Error('the Offense Protocol is not highlighted in the access');
  if (await page.locator('[data-option-card-id="STD-116"].live-focus').count()) throw new Error('an Assault Program is highlighted in the access');
  await guideClear(page,'pick');
  await pick(page,option('STD-116'),query);
  await page.locator('.live-guide').waitFor({state:'visible',timeout:3000}).catch(() => {throw new Error('the guide did not come back on the Assault Program');});
  const reason=await page.locator('.live-guide .live-guide-error').innerText().catch(() => '');
  if (!reason.includes('オフェンスプロトコル') || (await read(page)).value.requiredInput?.choiceId!==input.choiceId) throw new Error('the Assault Program was not refused: '+reason);
  await tapWhileSpeaking(page,'blue 6, refused access');
  await putAway(page);
  await pick(page,option('STD-111'),query);
  const confirm=page.locator('[data-runtime-confirm]').first();
  if (await confirm.count() && await confirm.isVisible() && await confirm.isEnabled()) await clickVisible(page,'[data-runtime-confirm]');
  await settle(page);
  const hand=cards((await read(page)).value).filter(card => !card.faceDown && card.location?.zone==='hand').map(card => card.definition.id);
  if (!hand.includes('STD-111') || hand.includes('STD-116')) throw new Error('the access did not take the Offense Protocol: '+hand.join(','));
}
// A line about an ability opens Frau's detail itself with the badge highlighted (the board draws no badges); the
// detail closes when the step moves on.
async function badgeShown(page,id,index,badge) {
  await step(page,id,index);
  await page.locator(`.r2-detail[data-card-id="STD-109"] [data-ability-help].live-focus[data-tutorial-focus-label*="${badge}"]`).waitFor({state:'visible',timeout:3000})
    .catch(() => {throw new Error(`the ${badge} badge is not shown highlighted at ${id}:${index}`);});
  // In sight: not under the guide's portrait or frame (the detail stands at the left edge like the portrait).
  await page.waitForTimeout(300);
  const hidden=await page.evaluate(() => {const node=document.querySelector('.r2-detail [data-ability-help].live-focus'),rect=node.getBoundingClientRect();
    return document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)?.closest('.live-guide')?.className ?? null;});
  if (hidden) throw new Error(`the ${badge} badge is under the guide at ${id}:${index} (${hidden})`);
}
const detailClosed = (page,id,index) => page.waitForFunction(() => !document.querySelector('.r2-detail'),null,{timeout:3000})
  .catch(() => {throw new Error(`the detail opened at ${id}:${index} stays open`);});
async function abilityLine(page,id,index,badge) {
  await badgeShown(page,id,index,badge);
  await next(page);
  await detailClosed(page,id,index);
}
// Blue step 22: the turn-end line shows the Encryption badge too, the only step Frau has it (文豪, 2026-10-28). The
// detail leaves the turn-end button and its highlight in sight, and the turn is ended from it as usual.
async function turnEndWithBadge(page,id,index) {
  await badgeShown(page,id,index,'暗号化');
  const covered=() => page.evaluate(() => {const node=document.querySelector('[data-runtime-end-turn].live-focus'),rect=node?.getBoundingClientRect();
    if (!rect?.width) return 'no highlighted turn-end button';
    const pad=Math.min(rect.width,rect.height)*.15,points=[[rect.left+rect.width/2,rect.top+rect.height/2],[rect.left+pad,rect.top+pad],[rect.right-pad,rect.bottom-pad]];
    const over=points.map(([x,y]) => document.elementFromPoint(x,y)).find(hit => hit && !node.contains(hit) && hit.closest('.r2-detail'));
    return over ? 'under the detail: '+over.outerHTML.slice(0,80) : null;});
  const before=await covered();
  if (before) throw new Error(`the turn-end button at ${id}:${index}: ${before}`);
  await putAway(page);
  if (!await page.locator('.r2-detail [data-ability-help].live-focus').count()) throw new Error(`the detail closed when the guide was put away at ${id}:${index}`);
  const away=await covered();
  if (away) throw new Error(`the turn-end button at ${id}:${index} with the guide away: ${away}`);
  await action(page,'endTurn');await settle(page);
  await step(page,id,index+1);
  await detailClosed(page,id,index);
}
async function tapCard(page,cardId,zone) {
  const card=cards((await read(page)).value).find(card => !card.faceDown && card.definition.id===cardId && card.location?.zone===zone);
  const selector='[data-card-ref="'+card.cardRef+'"]';
  if (zone==='hand' && !await page.locator(selector).first().isVisible()) await clickVisible(page,'[data-runtime-hand]');
  await clickVisible(page,selector);
}
// Red step 13: Atto's play button is highlighted in its popup; pressing it names the missing red symbol and the step moves on.
async function tryBlockedPlay(page,id,cardId) {
  const after=Number((await page.locator('.live-guide').getAttribute('data-tutorial-step')).split(':')[1])+1;
  await putAway(page);
  const card=cards((await read(page)).value).find(card => !card.faceDown && card.definition.id===cardId && card.location?.zone==='hand');
  const selector='[data-card-ref="'+card.cardRef+'"]';
  if (!await page.locator(selector).first().isVisible()) await clickVisible(page,'[data-runtime-hand]');
  await clickVisible(page,selector);
  await page.locator('.r2-popup[data-card-id="'+cardId+'"] [data-tutorial-try].live-focus').waitFor({state:'attached',timeout:3000}).catch(() => {throw new Error('the blocked play is not highlighted in its popup');});
  await guideClear(page,'popup');
  await clickVisible(page,'[data-tutorial-try]');
  await page.waitForFunction(step => document.querySelector('.live-guide')?.dataset.tutorialStep===step,id+':'+after,{timeout:5000});
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
// The blue script's 「」, one a step, as 文豪 wrote them (02-青-台本-修正反映.md, 2026-10-28). 「(アイコン)」 is a stage
// direction: the line drops it and shows the ability's icon there instead.
const BLUE_SCRIPT=[
  '青のデッキを使います。青は『ハッキング』と『暗号化』という、相手のセキュリティをすり抜ける、あるいは攻撃を受けない能力を得意とします。',
  '青のカードを使うには青のシンボルが必要なので『漣』をレジストリにインストールしましょう。',
  'では、『ルチル』を実行してみましょう。','『ルチル』は青の得意なSp(スペル)とアクセスを駆使する戦術、特に『/…/*』系Spのサポートカードです。',
  '『ログイン』効果は実行してエリアに出た時に起動する能力です。','お、起動しましたね。','今は『/オフェンスプロトコル/*』にアクセスして手札に加えましょう！',
  '次に『フラウ』を実行します。メモリ2です。','フラウは『ハッキング』か『暗号化』を持っている間、+1/+1されます。今はどちらも持っていないので、2/2のままです。',
  'ターンを終了しましょう。',
  '相手が『装甲兵 メルク』を出して、スリープさせました。『セキュリティ』を持つObがスリープしている間、普通のObは相手ユーザーを攻撃できません。',
  'では私達のターンですね。','今回は『フラウ』を選んで『/オフェンスプロトコル/*』を使ってみましょう','エリアの『フラウ』が『ハッキング(アイコン)』を得て、さらに+1/0されます',
  'さらに！『フラウ』自身の効果で追加で+1/+1されました！','『ハッキング』は、相手の『セキュリティ』を無視して攻撃対象を選べるようになる効果です','それでは、攻撃してみましょう！',
  '攻撃成功！相手のSTRが5から1になりました。','では『ルチル』で攻撃してみましょう。','ハッキングを持たない『ルチル』では、攻撃の対象を『セキュリティ』に吸われてしまいます。残念。',
  '次は第二の戦術、『暗号化』です。これを持つObは相手Obの攻撃対象になりません','『セキュリティウォール』を実行しましょう。','ターンを終了します。相手の装甲兵が攻撃してきますが……',
  '『暗号化』のおかげで、私たちのObは攻撃されません。','攻撃は相手ユーザーのあなたにだけ届きます。','今引いてきた『/アサルトプログラム/*』を起動しましょう！',
  '最後です。『フラウ』で相手ユーザーを攻撃しましょう！','STRが0になりました！完璧な勝利を貴方に。Powered by Neutron Security！……企業案件です。'
];
async function step(page,id,index) {
  await page.waitForFunction(({id,index}) => document.querySelector('.live-guide')?.dataset.tutorialStep === id+':'+index && window.__SIMPLE_ZEKE_E2E__.tutorial().value?.opponentScript === null,{id,index});
  if (id==='blue') {
    const said=await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.tutorial().value?.presentation?.text);
    if (said!==BLUE_SCRIPT[index].replace('(アイコン)','')) throw new Error('blue '+index+' is not the script line: '+said);
    // Where the script asks for the icon, the line shows the ability's icon right after its name.
    if (BLUE_SCRIPT[index].includes('(アイコン)') && !await page.locator('.live-guide-text img.live-guide-kw[alt="ハッキング"]').count())
      throw new Error('blue '+index+': the Hacking icon is not in the line');
  }
  await guidePage(page);
  await readPages(page);
  const audit=await page.locator('.live-guide').evaluate(node => {const rect=node.getBoundingClientRect();return {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,w:innerWidth,h:innerHeight};});
  if (audit.left<0 || audit.top<0 || audit.right>audit.w+1 || audit.bottom>audit.h+1) throw new Error('guide clipped: '+JSON.stringify(audit));
  // The focus marks are placed by the frame-coalesced layout, one frame after the guide text changes.
  // A line with nothing to point at (the opponent's turn, the battle explanation) has none.
  if (await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.tutorial().value?.presentation?.focus?.length))
    await page.locator('.live-focus[data-tutorial-focus-label]').first().waitFor({state:'attached',timeout:3000}).catch(() => {throw new Error('tutorial focus missing at '+id+':'+index);});
  // On the board a highlight glows on the board's own lines, no box laid over it; a card to use blinks on itself, on
  // the board or in the hand (文豪, 2026-10-29).
  const marks=await page.evaluate(() => ({boxed:[...document.querySelectorAll('.wire-board .live-focus,.r2-hand .card.live-focus')].filter(node => getComputedStyle(node).outlineStyle!=='none').length,
    still:[...document.querySelectorAll('.wire-board .board-slot.live-focus[data-card-ref] .card-line,.r2-hand .card.live-focus')].filter(node => !/use-card/.test(getComputedStyle(node).animationName)).length}));
  if (marks.boxed || marks.still) throw new Error('board highlight at '+id+':'+index+': '+JSON.stringify(marks));
  await guideClear(page,'page');
}
// V092-08 Q4/Q5: the winning attack ends the tutorial on its closing line (no result window); its button
// leaves the match for the tutorial list, marked done in this browser.
async function completionReturnsToList(page,id) {
  await page.waitForFunction(() => window.__SIMPLE_ZEKE_E2E__.tutorial().value?.flow.complete,null,{timeout:10000});
  await readPages(page);
  await page.locator('.live-guide [data-runtime-tutorial-finish]').waitFor({state:'visible',timeout:10000});
  // The closing line may run over pages on a narrow screen: read it whole.
  const closing=await page.evaluate(() => ({text:window.__SIMPLE_ZEKE_E2E__.tutorial().value?.presentation?.text ?? '',skip:Boolean(document.querySelector('[data-runtime-tutorial-skip]')),
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
  // Every frame from the opening on: a shown guide always has its line on screen (also while its pages are cut).
  await page.evaluate(() => {
    window.__guideBlank=[];
    const tick=() => {
      const guide=document.querySelector('.live-guide'),line=guide?.querySelector('.live-guide-text p');
      if (guide && !(line && line.textContent.trim() && getComputedStyle(line).visibility!=='hidden' && line.getBoundingClientRect().height>0)) window.__guideBlank.push(guide.dataset.tutorialStep);
      if (!window.__guideBlankStop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.evaluate(id => window.__SIMPLE_ZEKE_E2E__.start('tutorial',id,1),id);
  await intro(page,id);
  // A resize recuts the pages: the line stays on screen meanwhile.
  const size=page.viewportSize();
  await page.setViewportSize({width:size.width-40,height:size.height});await page.waitForTimeout(300);
  await page.setViewportSize(size);await page.waitForTimeout(300);
  if (id==='basics') {
    // The author's red script, one speech bubble per "‐" line (44 steps): swordsman, Atto (QA), Glenn for the
    // red symbol, Junk Parts under Atto vs the Guardman.
    const talk=async (from,to) => {for (let index=from;index<=to;index+=1) {await step(page,id,index);await next(page);}};
    await talk(1,10);
    await step(page,id,11);await action(page,'executeCard','STD-021',{zone:'front'});
    await talk(12,12);
    await step(page,id,13);await tryBlockedPlay(page,id,'STD-091');
    await talk(14,17);
    await step(page,id,18);await action(page,'install','STD-087');
    await pressAsked(page,id,19,async () => {
      if (!await page.locator('[data-runtime-counts].live-focus').count()) throw new Error('the info button is not highlighted at 19');
      await clickVisible(page,'[data-runtime-counts]');
    });
    await step(page,id,20);
    if (!await page.locator('[data-runtime-counts].live-focus').count()) throw new Error('the info button is not highlighted at 20');
    await next(page);
    await step(page,id,21);await action(page,'executeCard','STD-091',{zone:'front'});
    await talk(22,25);
    // The badge is scrolled to the middle of the detail once it is marked: pressed after that settles. Its help
    // opens over the detail; Escape closes it before the detail is closed.
    await pressAsked(page,id,26,async () => {
      await tapCard(page,'STD-091','front');
      await page.waitForFunction(() => {const badge=document.querySelector('.r2-detail [data-ability-help].live-focus'),top=badge?.getBoundingClientRect().top;
        const still=top!==undefined && top===window.__badgeTop;window.__badgeTop=top;return still;},null,{polling:150,timeout:3000});
      await clickVisible(page,'.r2-detail [data-ability-help].live-focus');
    },async () => {await page.keyboard.press('Escape');await clickVisible(page,'[data-close-detail]');});
    await talk(27,28);
    await step(page,id,29);await action(page,'attack','STD-091',{user:true});await settle(page);
    await talk(30,30);
    await step(page,id,31);await action(page,'endTurn');await settle(page);
    await talk(32,35);
    await pressAsked(page,id,36,() => tapCard(page,'STD-078','hand'),() => clickVisible(page,'[data-close-detail]'));
    // Alone in a slot, under the soldier or alone in the back the Junk Parts leave Atto too weak for the Guardman:
    // each is refused, with the reason in the guide.
    await step(page,id,37);await tapWhileSpeaking(page,'step 37');
    await action(page,'executeCard','STD-078',{zone:'front',refused:'アツト',label:'alone in the front'});
    await action(page,'executeCard','STD-078',{targetId:'STD-021',cardOnly:true,refused:'アツト',label:'under the soldier'});
    await action(page,'executeCard','STD-078',{zone:'back',refused:'アツト',label:'alone in the back'});
    await action(page,'executeCard','STD-078',{targetId:'STD-091',cardOnly:true});await settle(page);
    await talk(38,38);
    await step(page,id,39);await action(page,'attack','STD-091',{targetId:'STD-022'});await settle(page);
    await talk(40,41);
    await step(page,id,42);await action(page,'attack','STD-021',{user:true});await settle(page);
  } else if (id==='blue') {
    // The author's blue script, one 「」 a step (28 steps): Nami for the blue symbol, Rutile's access, Frau passing Merc
    // by Hacking, Rutile taken by Merc's Security, the Security Wall's Encryption, and the Assault Program: STR 5 -> 1 -> 0.
    const talk=async (from,to) => {for (let index=from;index<=to;index+=1) {await step(page,id,index);await next(page);}};
    await step(page,id,1);await action(page,'install','STD-117');
    await step(page,id,2);await action(page,'executeCard','STD-107',{zone:'front'});
    // Rutile's access stays open while the guide explains the Login: it is not answered until its own line.
    await step(page,id,3);await tapWhileSpeaking(page,'blue 3, the access open');await next(page);
    await talk(4,5);
    await step(page,id,6);await accessPick(page);
    await step(page,id,7);await action(page,'executeCard','STD-109',{zone:'front'});
    await talk(8,8);
    await step(page,id,9);await action(page,'endTurn');await settle(page);
    await talk(10,11);
    await step(page,id,12);
    await action(page,'executeSpell','STD-111',{targetId:'STD-107',cardOnly:true,refused:'フラウ',label:'the Offense Protocol on Rutile'});
    await action(page,'executeSpell','STD-111',{targetId:'STD-109',cardOnly:true});await settle(page);
    await talk(13,14);
    await abilityLine(page,id,15,'ハッキング');
    await step(page,id,16);
    await action(page,'attack','STD-109',{targetId:'STD-043',cardOnly:true,refused:'相手ユーザー',label:'Frau on Merc'});
    await action(page,'attack','STD-109',{user:true});await settle(page);
    await talk(17,17);
    await step(page,id,18);await action(page,'attack','STD-107',{targetId:'STD-043'});await settle(page);
    await talk(19,20);
    await step(page,id,21);await action(page,'executeSpell','STD-110');await settle(page);
    await turnEndWithBadge(page,id,22);
    await next(page);
    await talk(24,24);
    await step(page,id,25);await action(page,'executeSpell','STD-116');await settle(page);
    await step(page,id,26);await action(page,'attack','STD-109',{user:true});await settle(page);
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
  const blank=await page.evaluate(() => {window.__guideBlankStop=true;return window.__guideBlank;});
  if (blank.length) throw new Error('guide shown without its line on '+blank.length+' frames: '+[...new Set(blank)].join(','));
  await completionReturnsToList(page,id);
}
const playwright=await loadPlaywright(),{chromium}=playwright.default ?? playwright;
const browser=await chromium.launch({channel:'msedge',headless:true}),runs=[],errors=[];
try {
  const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
  const phone={deviceScaleFactor:3,userAgent:IPHONE,isMobile:true,hasTouch:true};
  const profiles=keyboardMode ? [{label:'desktop-keyboard',width:1600,height:1000},{label:'zoom-200-equivalent-keyboard',width:640,height:360}]
    : screensMode ? [{label:'1920x1080',width:1920,height:1080},{label:'1280x720',width:1280,height:720},{label:'iphone-pro-852x393',width:852,height:393,device:phone},{label:'iphone-pro-max-932x430',width:932,height:430,device:phone}]
    : [{label:'desktop',width:1600,height:1000},{label:'mobile',width:844,height:390},{label:'zoom-200-equivalent',width:640,height:360}];
  for (const profile of profiles) {
    profileLabel=profile.label;
    const context=await browser.newContext({viewport:{width:profile.width,height:profile.height},...profile.device});
    const page=await context.newPage();
    page.on('pageerror',error => errors.push(error.message));
    for (const id of ['basics','blue','vengeance']) {await run(page,id);runs.push({profile:profile.label,tutorial:id});}
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
    await context.close();
  }
  if (errors.length) throw new Error('tutorial page errors: '+errors.join(' | '));
  // Enforced on the --screens sizes; the other runs only count it.
  const unknown=covered.filter(hit => !knownCovered(hit)),known=[...new Set(covered.filter(knownCovered).map(hit => hit.line.replace(/ \d+px²$/,'')))];
  if (screensMode && unknown.length) throw new Error('the guide covers what can be pressed ('+unknown.length+'):\n'+[...new Set(unknown.map(hit => hit.line))].join('\n'));
  if (screensMode && pageIssues.length) throw new Error('guide pages ('+pageIssues.length+'):\n'+[...new Set(pageIssues)].join('\n'));
  console.log(JSON.stringify({suite:'tutorial',runs,completionReturnsToList:true,offScriptRefused:true,freshSkip:true,requiredBackPreserves:true,
    guideCovers:screensMode ? {unknown:0,known:known.length} : {counted:new Set(covered.map(hit => hit.line)).size},
    leftOpenCovered:[...new Set(leftOpen.map(hit => hit.line.replace(/ \d+px²$/,'')))],guidePages:screensMode ? {issues:0} : {issues:[...new Set(pageIssues)]},
    frameMax:Math.round(frameMax*1000)/10+'%',keyboardMode,screensMode,ok:true}));
} finally {await browser.close();}
