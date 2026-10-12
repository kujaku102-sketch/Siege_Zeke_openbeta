import { createPlanningContext } from './planning-context.js';
import { planningCatalog } from './legal-actions.js';
import { attackOptions, completeAttack } from './attack-planning.js';
import { executionDestinations, layeredMaterials, completeExecution, executionPlacements, executionTargetPlan,
  executionEffects, targetOptions } from './execution-planning.js';
import { readPlanningInput, selectionRequest, validSelectionAnswer } from './selection-contract.js';
import { opaqueOrdinal } from './opaque-id.js';
import { buildRequiredInput } from './required-input.js';

const failure = code => ({ ok: false, error: { code } });
const pick = (minimum = 1, maximum = 1) => ({ kind: 'pick', minimum, maximum, aggregate: null, groups: [] });

export function queryRuntimeAction(authority, viewerSeat, input, currentCatalog = null, allowTutorial = false) {
  try {
    const request = readPlanningInput(input);
    if (request.expectedRevision !== authority.revision) return failure('STALE_REVISION');
    const required = buildRequiredInput(authority, viewerSeat);
    if (!required.ok || required.value !== null) return failure('ACTION_NOT_ALLOWED');
    const context = createPlanningContext(authority, viewerSeat, null, allowTutorial);
    if (!context.allowed) return failure('ACTION_NOT_ALLOWED');
    const entry = (currentCatalog ?? planningCatalog(context)).find(item => item.actionId === request.actionId);
    if (!entry) return failure('ACTION_NOT_ALLOWED');
    const result = { matchId: context.metadata.matchId, revision: context.revision, viewerSeat,
      actionId: entry.actionId, purpose: 'draft', selectionRequests: [], completion: null };
    let consumed = 0;
    const select = (stage, key, values, constraints = pick()) => {
      const parent = request.selections.slice(0, consumed).map(answer => answer.optionIds.join('.')).join(':') || 'root';
      const scope = opaqueOrdinal('scope', JSON.stringify([context.metadata.matchId, viewerSeat, entry.actionId, stage, parent]));
      const dto = selectionRequest(`${entry.actionId}:${stage}:${scope}`, key,
        values.map((value, index) => ({ optionId: opaqueOrdinal(stage, index), ...value })), constraints);
      const answer = request.selections[consumed];
      if (!answer) { result.selectionRequests.push(dto); return null; }
      if (!validSelectionAnswer(dto, answer)) throw new Error('INVALID_SELECTION');
      consumed += 1;
      return answer.optionIds.map(id => dto.options.find(option => option.optionId === id));
    };
    let action = null;
    if (entry.kind === 'fixed') action = structuredClone(entry.action);
    else if (entry.actionType === 'attack') {
      const chosen = select('target', 'attack-target', attackOptions(context, entry.base.attackerRef));
      if (chosen) {
        const { optionId, ...target } = chosen[0];
        action = completeAttack(entry, target);
      }
    } else if (['executeSpell','executeRegistry','activateCardEffect','mountCard'].includes(entry.actionType)) {
      const clean = option => {
        const {optionId,label,...value} = option;
        return value;
      };
      let ready = true, effectKey = null, placement = {kind:'none'}, targets = [], selectionScope = null, targetZone = null;
      if (entry.actionType === 'activateCardEffect') {
        const chosen = select('effect','card-effect',executionEffects(context,entry));
        ready = chosen !== null; if (chosen) effectKey = chosen[0].effectKey;
      } else if (['executeRegistry','mountCard'].includes(entry.actionType)) {
        const placements = executionPlacements(context,entry);
        if (!placements.length) return failure('ACTION_NOT_ALLOWED');
        const chosen = select('placement','execution-placement',placements);
        ready = chosen !== null; if (chosen) placement = clean(chosen[0]);
      }
      let plan = null;
      if (ready && entry.actionType !== 'mountCard') {
        plan = executionTargetPlan(context,entry,effectKey);
        if (entry.actionType === 'executeRegistry' && !plan) {
          // Board cards have no spell input.
          plan = {candidates:[],minimum:0,maximum:0,scopes:[],groups:[]};
        }
        if (!plan) return failure('ACTION_NOT_ALLOWED');
        if (plan.maximum > 0) {
          const options = targetOptions(context,plan);
          if (options.length < plan.minimum) return failure('ACTION_NOT_ALLOWED');
          const groups = (plan.groups ?? []).map((group,index) => ({
            groupId:opaqueOrdinal('target-group',index),minimum:1,maximum:1,
            optionIds:group.map(card => options.findIndex(option => option.cardRef === context.refFor(card)))
              .filter(index => index >= 0).map(index => opaqueOrdinal('targets',index))
          }));
          const chosen = select('targets','execution-targets',options,{...pick(plan.minimum,plan.maximum),groups});
          ready = chosen !== null; if (chosen) targets = chosen.map(clean);
        }
        if (ready && plan.scopes?.length) {
          const chosen = select('scope','execution-scope',plan.scopes.map(scope => ({scope,label:scope})));
          ready = chosen !== null; if (chosen) selectionScope = chosen[0].scope;
        }
        if (ready && plan.needsZone) {
          plan = executionTargetPlan(context,entry,effectKey,targets);
          if (!plan.zones.length) return failure('ACTION_NOT_ALLOWED');
          const chosen = select('target-zone','effect-destination',plan.zones.map(zone => ({zone})));
          ready = chosen !== null; if (chosen) targetZone = chosen[0].zone;
        }
      }
      if (ready) action = entry.actionType === 'mountCard'
        ? {type:'mountCard',cardRef:entry.base.cardRef,hostRef:placement.hostRef,mountKind:placement.kind}
        : entry.actionType === 'executeRegistry' ? {type:'executeRegistry',cardRef:entry.base.cardRef,placement,targets,selectionScope}
        : entry.actionType === 'activateCardEffect' ? {type:'activateCardEffect',cardRef:entry.base.cardRef,effectKey,targets,targetZone}
        : {type:'executeSpell',cardRef:entry.base.cardRef,targets,selectionScope};
    } else {
      let materialRefs = [];
      let materialsReady = true;
      if (entry.actionType === 'executeLayered') {
        const plan = layeredMaterials(context, entry);
        if (!plan) return failure('ACTION_NOT_ALLOWED');
        const values = plan.entries.map(item => ({ cardRef: context.refFor(item.card) }));
        if (values.some(item => !item.cardRef)) return failure('ACTION_NOT_ALLOWED');
        const chosen = select('materials', 'layered-materials', values, {
          ...pick(plan.minimum, plan.maximum), assignment: 'exclusive',
          groups: plan.groups.map((group, index) => ({
            groupId: opaqueOrdinal('material-group', index), minimum: group.minimum, maximum: group.maximum,
            optionIds: group.entries.map(item => opaqueOrdinal('materials', plan.entries.indexOf(item)))
          }))
        });
        materialsReady = chosen !== null;
        if (chosen) materialRefs = chosen.map(item => item.cardRef);
      }
      if (materialsReady) {
        const destinations = executionDestinations(context, entry, materialRefs);
        if (!destinations.length) return failure('ACTION_NOT_ALLOWED');
        const chosen = select('destination', 'execution-destination', destinations);
        if (chosen) {
          const { optionId, ...destination } = chosen[0];
          action = completeExecution(entry, destination, materialRefs);
        }
      }
    }
    if (consumed !== request.selections.length) return failure('INVALID_SELECTION');
    result.completion = action ? { action } : null;
    return { ok: true, value: result };
  } catch {
    return failure('INVALID_PLANNING_INPUT');
  }
}
