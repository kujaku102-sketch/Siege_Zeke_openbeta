import {
  activateScript, activateTurbo, addSandboxCardToHand, attack, endTurn, installCard, keepOpeningHand, openingMulligan,
  playCard, playLayeredCard, recoverRegistryCard, relogCard, restSecurity, executeRegistryCard, activateCardEffect
} from '../engine.js';
import { applyRequiredInputAction } from './required-input.js';

const text = value => typeof value === 'string' && value.length > 0;
const slot = value => Number.isSafeInteger(value) && value > 0 && !Object.is(value, -0);
const exactObject = (value, keys) => value !== null && typeof value === 'object'
  && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).length === keys.length
  && Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key));
const stringList = value => Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype
  && Reflect.ownKeys(value).length === value.length + 1
  && value.length > 0 && value.every(text);

function awaitingInput(state) {
  return state.pending !== null || state.prompt !== null
    || state.effectResolution?.status === 'awaiting-choice'
    || state.securityRestWindow !== undefined && state.securityRestWindow !== null;
}

const normalProgress = state => awaitingInput(state) ? 'awaiting-input' : 'complete';
const slotOptions = value => exactObject(value, ['requestedSlot']) && slot(value.requestedSlot);
const playOptions = value => {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(value);
  const allowed = ['zone','requestedSlot','baseUid','underUid','asScript','targetUid','targetUids','selectionScope'];
  if (keys.some(key => !allowed.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'))) return false;
  if (Object.hasOwn(value,'zone') && !['front','back'].includes(value.zone)
    || Object.hasOwn(value,'requestedSlot') && !slot(value.requestedSlot)
    || value.baseUid && value.underUid || value.baseUid && !text(value.baseUid) || value.underUid && !text(value.underUid)
    || Object.hasOwn(value,'asScript') && value.asScript !== true
    || Object.hasOwn(value,'targetUid') && value.targetUid !== null && !text(value.targetUid)
    || Object.hasOwn(value,'targetUids') && (!Array.isArray(value.targetUids) || !value.targetUids.every(text))
    || Object.hasOwn(value,'selectionScope') && value.selectionScope !== null && !text(value.selectionScope)) return false;
  return true;
};

const HANDLERS = Object.freeze({
  selectSandboxActiveSeat: {
    keys: ['engineFunction', 'playerId'],
    apply: (state, adapter) => {
      if (state.mode !== 'sandbox' || !['player', 'ai'].includes(adapter.playerId)) return false;
      state.active = adapter.playerId;
      return true;
    },
    progress: () => 'complete'
  },
  addSandboxCardToHand: {
    keys: ['engineFunction', 'playerId', 'cardId'],
    apply: (state, adapter) => addSandboxCardToHand(state, adapter.playerId, adapter.cardId),
    progress: () => 'complete'
  },
  installCard: {
    keys: ['engineFunction', 'playerId', 'uid'],
    apply: (state, adapter) => installCard(state, adapter.playerId, adapter.uid),
    progress: normalProgress
  },
  openingMulligan: {
    keys: ['engineFunction', 'playerId'],
    apply: (state, adapter) => openingMulligan(state, adapter.playerId),
    progress: () => 'complete'
  },
  openingMulliganCards: {
    keys: ['engineFunction', 'playerId', 'uids'],
    validate: adapter => stringList(adapter.uids) && new Set(adapter.uids).size === adapter.uids.length,
    apply: (state, adapter) => openingMulligan(state, adapter.playerId, { uids: adapter.uids }),
    progress: normalProgress
  },
  keepOpeningHand: {
    keys: ['engineFunction', 'playerId'],
    apply: (state, adapter) => keepOpeningHand(state, adapter.playerId),
    progress: normalProgress
  },
  recoverRegistryCard: {
    keys: ['engineFunction', 'playerId', 'uid'],
    apply: (state, adapter) => recoverRegistryCard(state, adapter.playerId, adapter.uid),
    progress: () => 'complete'
  },
  restSecurity: {
    keys: ['engineFunction', 'playerId', 'uid'],
    apply: (state, adapter) => restSecurity(state, adapter.playerId, adapter.uid),
    progress: () => 'complete'
  },
  activateScript: {
    keys: ['engineFunction', 'playerId', 'uid'],
    apply: (state, adapter) => activateScript(state, adapter.playerId, adapter.uid),
    progress: normalProgress
  },
  playCard: {
    keys: ['engineFunction', 'playerId', 'uid', 'options'],
    validate: adapter => playOptions(adapter.options),
    apply: (state, adapter) => playCard(state, adapter.playerId, adapter.uid, adapter.options),
    progress: normalProgress
  },
  executeRegistryCard: {
    keys: ['engineFunction','playerId','uid','options'],
    validate: adapter => playOptions(adapter.options),
    apply: (state,adapter) => executeRegistryCard(state,adapter.playerId,adapter.uid,adapter.options),
    progress: normalProgress
  },
  activateCardEffect: {
    keys: ['engineFunction','playerId','uid','effectId','options'],
    validate: adapter => exactObject(adapter.options,['targetUid','targetUids','targetZone'])
      && (adapter.options.targetUid === null || text(adapter.options.targetUid))
      && Array.isArray(adapter.options.targetUids) && adapter.options.targetUids.every(text)
      && [null,'front','back'].includes(adapter.options.targetZone),
    apply: (state,adapter) => activateCardEffect(state,adapter.playerId,adapter.uid,adapter.effectId,adapter.options),
    progress: normalProgress
  },
  playLayeredCard: {
    keys: ['engineFunction', 'playerId', 'uid', 'materialUids', 'zone', 'options'],
    validate: adapter => stringList(adapter.materialUids) && ['front', 'back'].includes(adapter.zone)
      && slotOptions(adapter.options),
    apply: (state, adapter) => playLayeredCard(
      state, adapter.playerId, adapter.uid, adapter.materialUids, adapter.zone, adapter.options
    ),
    progress: normalProgress
  },
  relogCard: {
    keys: ['engineFunction', 'playerId', 'uid', 'targetZone', 'options'],
    validate: adapter => ['front', 'back'].includes(adapter.targetZone)
      && (exactObject(adapter.options,['requestedSlot'])
        && (adapter.options.requestedSlot === null || slot(adapter.options.requestedSlot))
        || exactObject(adapter.options,['requestedSlot','baseUid']) && adapter.options.requestedSlot === null
          && typeof adapter.options.baseUid === 'string' && adapter.options.baseUid.length > 0),
    apply: (state, adapter) => relogCard(state, adapter.playerId, adapter.uid, adapter.targetZone, adapter.options),
    progress: normalProgress
  },
  attack: {
    keys: ['engineFunction', 'playerId', 'attackerUid', 'targetUid'],
    apply: (state, adapter) => attack(state, adapter.playerId, adapter.attackerUid, adapter.targetUid),
    progress: normalProgress
  },
  activateTurbo: {
    keys: ['engineFunction', 'playerId'],
    apply: (state, adapter) => activateTurbo(state, adapter.playerId),
    progress: normalProgress
  },
  endTurn: {
    keys: ['engineFunction', 'playerId'],
    apply: state => endTurn(state),
    progress: normalProgress,
    falseCanAwait: true
  },
  answerRequiredInput: {
    keys: ['engineFunction', 'playerId', 'revision', 'optionIndexes', 'allocation'],
    validate: adapter => Number.isSafeInteger(adapter.revision) && adapter.revision >= 0
      && Array.isArray(adapter.optionIndexes) && adapter.optionIndexes.every(Number.isSafeInteger)
      && Array.isArray(adapter.allocation),
    apply: (state, adapter, runtime) => applyRequiredInputAction(state, runtime.metadata, runtime.referenceState, adapter, false),
    progress: normalProgress
  },
  declineRequiredInput: {
    keys: ['engineFunction', 'playerId', 'revision'],
    validate: adapter => Number.isSafeInteger(adapter.revision) && adapter.revision >= 0,
    apply: (state, adapter, runtime) => applyRequiredInputAction(state, runtime.metadata, runtime.referenceState, adapter, true),
    progress: normalProgress
  }
});

const failure = code => ({ ok: false, error: { code } });

function adapterData(value) {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const engineFunction = Object.getOwnPropertyDescriptor(value, 'engineFunction');
  if (!engineFunction || !engineFunction.enumerable || !Object.hasOwn(engineFunction, 'value')
    || typeof engineFunction.value !== 'string' || engineFunction.value.length === 0) return null;
  const handler = Object.hasOwn(HANDLERS, engineFunction.value) ? HANDLERS[engineFunction.value] : null;
  if (!handler) return { handler: null };
  const keys = Reflect.ownKeys(value);
  if (keys.length !== handler.keys.length || keys.some(key => typeof key !== 'string' || !handler.keys.includes(key))) return null;
  const adapter = {};
  for (const key of handler.keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    adapter[key] = descriptor.value;
  }
  for (const key of handler.keys.filter(key => !['options', 'materialUids', 'uids', 'revision', 'optionIndexes', 'allocation'].includes(key))) {
    if (!text(adapter[key])) return null;
  }
  if (handler.validate && !handler.validate(adapter)) return null;
  return { handler, adapter };
}

export function applyPreparedRuntimeAction(engineState, adapterInput, runtime = {}) {
  const prepared = adapterData(adapterInput);
  if (!prepared) return failure('INVALID_PREPARED_ACTION');
  if (!prepared.handler) return { ok: true, value: { kind: 'unsupported' } };
  const applied = prepared.handler.apply(engineState, prepared.adapter, runtime);
  if (typeof applied !== 'boolean') return failure('INVALID_PREPARED_ACTION_RESULT');
  const progress = prepared.handler.progress(engineState, prepared.adapter);
  if (!['complete', 'awaiting-input'].includes(progress)) return failure('INVALID_PREPARED_ACTION_RESULT');
  if (!applied && !(prepared.handler.falseCanAwait && progress === 'awaiting-input')) {
    return { ok: true, value: { kind: 'refused' } };
  }
  return { ok: true, value: { kind: progress === 'complete' ? 'applied-complete' : 'applied-awaiting-input' } };
}

export function classifyPreparedRuntimeAction(adapterInput) {
  const prepared = adapterData(adapterInput);
  if (!prepared) return failure('INVALID_PREPARED_ACTION');
  return { ok: true, value: { kind: prepared.handler ? 'supported' : 'unsupported' } };
}
