import { getActivatableEffects, normalCardEffectSelection } from '../../engine.js';
import { opaqueOrdinal } from '../opaque-id.js';
import { finiteNumberField, own, reject, selectedArray, selectedField, selectedObject } from './common.js';

export function normalPlanningView(engineState) {
  const code = 'INVALID_AUTHORITY';
  const scalar = (object, key, fallback = null) => {
    const value = selectedField(object, key, code, fallback);
    if (value === undefined || value === null) return fallback;
    if (!['string', 'number', 'boolean'].includes(typeof value) || typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) reject(code);
    return value;
  };
  const ancestors = new Set();
  const cardView = card => {
    selectedObject(card, code, ancestors);
    try {
      const result = {};
      for (const key of ['uid','id','name','owner','category','printedCategory','text','color','cost','setupCost','activationCost',
        'faceDown','sleep','residentActive','summoningSick','dragFree','boardSlot','boardSlotController','boardSlotZone',
        'atk','str','damage','tempAtk','tempStr','permanentAtk','permanentStr','load','turnCostModifier','costReductionThisTurn','revealedExecutionCost']) {
        const value = scalar(card, key); if (value !== null) result[key] = value;
      }
      for (const key of ['classes','grantedKeywords']) result[key] = selectedArray(selectedField(card,key,code,[]),code,ancestors,item => {
        if (typeof item !== 'string') reject(code); return item;
      });
      const compiled = selectedField(card,'compiled',code,null);
      result.compiled = { keywords: compiled ? selectedArray(selectedField(compiled,'keywords',code),code,ancestors,item => ({
        name: scalar(item,'name'), value: scalar(item,'value'), intrinsic: scalar(item,'intrinsic',true)
      })) : [] };
      result.mounted = selectedArray(selectedField(card,'mounted',code,[]),code,ancestors,cardView);
      return result;
    } finally { ancestors.delete(card); }
  };
  const state = { active: own(engineState,'active',code), mode: own(engineState,'mode',code), turnNumber: own(engineState,'turnNumber',code), players: {} };
  const players = own(engineState,'players',code);
  for (const id of ['player','ai']) {
    const source = own(players,id,code), user = selectedField(source,'user',code);
    const player = { user: {}, memory: finiteNumberField(source,'memory',code,{minimum:0}),
      firstObExecutionTurn: scalar(source,'firstObExecutionTurn'), triggerUsage: {} };
    for (const key of ['abilityKey','name','frontLimit','backLimit']) player.user[key] = scalar(user,key);
    const usage = selectedField(source,'triggerUsage',code,{});
    player.triggerUsage['STD-236:registry-execute'] = scalar(usage,'STD-236:registry-execute',false);
    for (const zone of ['hand','deck','front','back','registry','trash','ban']) player[zone] = selectedArray(selectedField(source,zone,code),code,new Set(),cardView);
    state.players[id] = player;
  }
  return state;
}
export function normalCardInView(view, uid) {
  return Object.values(view.players).flatMap(player => ['hand','front','back','registry'].flatMap(zone => player[zone])).find(card => card.uid === uid);
}
export function normalEffectEntries(view, playerId, card) {
  return getActivatableEffects(view,playerId,card).flatMap((effect,index) => {
    const plan = normalCardEffectSelection(view,playerId,card,effect.id);
    return plan && plan.candidates.length >= plan.minimum ? [{ effectKey: opaqueOrdinal('effect',index), label: effect.label, plan }] : [];
  });
}
