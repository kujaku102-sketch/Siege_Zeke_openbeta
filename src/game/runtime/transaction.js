import { cloneForHistory } from '../engine.js';
import { prepareRuntimeCommand } from './command-bridge.js';
import { recordTerminal } from './command-record.js';
import { buildRuntimeReferenceFrame } from './reference-frame.js';
import { advanceRuntimeReferenceTransition, planRuntimeReferenceTransition } from './references.js';
import { applyPreparedRuntimeAction, classifyPreparedRuntimeAction } from './transaction-actions.js';
import { buildRuntimePublicResult } from './public-result.js';
import { createRuntimeReferenceTokens } from './reference-token.js';

const AUTHORITY_KEYS = ['metadata', 'revision', 'engineState', 'referenceState', 'journal'];
const REFERENCE_ACTIONS = new Set([
  'restSecurity', 'install', 'recoverRegistry', 'activateScript', 'executeCard', 'executeLayered', 'redeploy', 'attack',
  'executeSpell','mountCard','setScript','executeRegistry','activateCardEffect',
  'answerChoice', 'declineChoice'
]);
const RECORDABLE_REJECTIONS = new Map([
  ['STALE_REVISION', 'STALE_REVISION'],
  ['ACTION_NOT_ALLOWED', 'ACTION_NOT_ALLOWED'],
  ['UNAVAILABLE_MODE', 'ACTION_NOT_ALLOWED'],
  ['REVISION_EXHAUSTED', 'REVISION_EXHAUSTED']
]);
const REF_TOKEN = /^r:[0-9a-f]{32}$/;

class TransactionError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const fail = code => { throw new TransactionError(code); };
const failure = code => ({ ok: false, error: { code } });

function ordinary(value, code = 'INVALID_AUTHORITY') {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
}

function own(value, key, code = 'INVALID_AUTHORITY') {
  ordinary(value, code);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail(code);
  return descriptor.value;
}

function authorityRoot(value) {
  ordinary(value);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== AUTHORITY_KEYS.length || keys.some(key => typeof key !== 'string' || !AUTHORITY_KEYS.includes(key))) {
    fail('INVALID_AUTHORITY');
  }
  return Object.fromEntries(AUTHORITY_KEYS.map(key => [key, own(value, key)]));
}

function actionType(command) {
  if (command === null || typeof command !== 'object') return null;
  const action = Object.getOwnPropertyDescriptor(command, 'action');
  if (!action || !Object.hasOwn(action, 'value') || action.value === null || typeof action.value !== 'object') return null;
  const type = Object.getOwnPropertyDescriptor(action.value, 'type');
  return type && Object.hasOwn(type, 'value') && typeof type.value === 'string' ? type.value : null;
}

// The v2.4 opening mulligan names cards, so only that form reads references; the legacy form stays reference-free.
function needsReferences(command) {
  const type = actionType(command);
  if (REFERENCE_ACTIONS.has(type)) return true;
  if (type !== 'openingMulligan') return false;
  const action = Object.getOwnPropertyDescriptor(command, 'action').value;
  return Object.getOwnPropertyDescriptor(action, 'cardRefs') !== undefined;
}

function preparationAuthority(root, command) {
  const base = {
    metadata: root.metadata, revision: root.revision, engineState: root.engineState, journal: root.journal
  };
  return needsReferences(command) ? { ...base, referenceState: root.referenceState } : base;
}

function terminalReceipt(command, status, revision, reasonCode) {
  return { matchId: command.matchId, commandId: command.commandId, status, revision, reasonCode };
}

function recordRejection(root, context, command, reasonCode) {
  const receipt = terminalReceipt(command, 'rejected', root.revision, reasonCode);
  const recorded = recordTerminal(root.journal, context, command, {
    status: receipt.status, revision: receipt.revision, reasonCode: receipt.reasonCode
  });
  if (!recorded.ok) return recorded;
  const authority = { ...root, journal: recorded.value };
  const publicResult = buildRuntimePublicResult(authority, command, receipt);
  if (!publicResult.ok) return publicResult;
  return { ok: true, value: {
    kind: 'rejected', receipt, publicResult: publicResult.value,
    authority
  } };
}

function issuedReferenceSet(referenceState) {
  const issued = own(referenceState, 'issuedRefs');
  if (!Array.isArray(issued) || Object.getPrototypeOf(issued) !== Array.prototype) fail('INVALID_AUTHORITY');
  const keys = Reflect.ownKeys(issued);
  const length = Object.getOwnPropertyDescriptor(issued, 'length');
  if (!length || !Object.hasOwn(length, 'value') || length.enumerable || length.configurable
    || keys.length !== length.value + 1) fail('INVALID_AUTHORITY');
  const result = new Set();
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(issued, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')
      || !REF_TOKEN.test(descriptor.value) || result.has(descriptor.value)) fail('INVALID_AUTHORITY');
    result.add(descriptor.value);
  }
  return result;
}

function opaqueReferences(count, referenceState) {
  const generated = createRuntimeReferenceTokens({ count, issuedRefs: [...issuedReferenceSet(referenceState)] });
  if (!generated.ok) fail(generated.error.code);
  return generated.value;
}

function baseline(root) {
  const frame = buildRuntimeReferenceFrame(root.engineState);
  if (!frame.ok) return frame;
  const planned = planRuntimeReferenceTransition(root.referenceState, { beforeFrame: frame.value, afterFrame: frame.value });
  if (!planned.ok || planned.value.invalidatedIdentities.length || planned.value.newRefCount) return failure('INVALID_AUTHORITY');
  return { ok: true, value: frame.value };
}

export function submitRuntimeCommand(authority, context, command, policy = {}) {
  try {
    const root = authorityRoot(authority);
    const prepared = prepareRuntimeCommand(preparationAuthority(root, command), context, command, policy);
    if (!prepared.ok) {
      const reason = RECORDABLE_REJECTIONS.get(prepared.error.code);
      return reason ? recordRejection(root, context, command, reason) : prepared;
    }
    if (prepared.value.kind === 'retry') {
      const publicResult = buildRuntimePublicResult(root, command, prepared.value.receipt, { retry: true });
      if (!publicResult.ok) return publicResult;
      return { ok: true, value: {
        kind: 'retry', receipt: prepared.value.receipt, publicResult: publicResult.value, authority
      } };
    }

    const before = baseline(root);
    if (!before.ok) return before;
    const classified = classifyPreparedRuntimeAction(prepared.value.adapter);
    if (!classified.ok) return classified;
    if (classified.value.kind === 'unsupported') {
      return recordRejection(root, context, prepared.value.command, 'UNSUPPORTED_ACTION');
    }
    const workingEngine = cloneForHistory(root.engineState);
    const applied = applyPreparedRuntimeAction(workingEngine, prepared.value.adapter, {
      metadata: root.metadata, referenceState: root.referenceState
    });
    if (!applied.ok) return applied;
    if (applied.value.kind === 'refused') {
      return recordRejection(root, context, prepared.value.command, 'ACTION_NOT_ALLOWED');
    }
    if (!['applied-complete', 'applied-awaiting-input'].includes(applied.value.kind)) {
      return failure('INVALID_PREPARED_ACTION_RESULT');
    }

    const after = buildRuntimeReferenceFrame(workingEngine);
    if (!after.ok) return after;
    const planned = planRuntimeReferenceTransition(root.referenceState, {
      beforeFrame: before.value, afterFrame: after.value
    });
    if (!planned.ok) return planned;
    const advanced = advanceRuntimeReferenceTransition(root.referenceState, {
      beforeFrame: before.value, afterFrame: after.value,
      newRefs: opaqueReferences(planned.value.newRefCount, root.referenceState)
    });
    if (!advanced.ok) return advanced;

    const revision = root.revision + 1;
    const receipt = terminalReceipt(prepared.value.command, 'accepted', revision, 'ACCEPTED');
    const nextAuthority = {
      metadata: structuredClone(root.metadata), revision, engineState: workingEngine,
      referenceState: advanced.value, journal: root.journal
    };
    const publicResult = buildRuntimePublicResult(nextAuthority, prepared.value.command, receipt);
    if (!publicResult.ok) return publicResult;
    const recorded = recordTerminal(root.journal, context, prepared.value.command, {
      status: receipt.status, revision: receipt.revision, reasonCode: receipt.reasonCode
    });
    if (!recorded.ok) return recorded;
    nextAuthority.journal = recorded.value;
    return { ok: true, value: {
      kind: 'accepted', receipt, publicResult: publicResult.value,
      authority: nextAuthority
    } };
  } catch (error) {
    if (error instanceof TransactionError) return failure(error.code);
    throw error;
  }
}
