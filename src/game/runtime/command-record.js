const FORMAT_VERSION = 1;
const JOURNAL_VERSION = 1;
const ENVELOPE_KEYS = ['contractVersion', 'matchId', 'commandId', 'actorSeat', 'expectedRevision', 'action'];
const CONTEXT_KEYS = ['matchId', 'actorSeat'];
const JOURNAL_KEYS = ['schemaVersion', 'matchId', 'seatIds', 'entries'];
const ENTRY_KEYS = ['commandId', 'actorSeat', 'canonicalPayload', 'receipt'];
const RECEIPT_KEYS = ['matchId', 'commandId', 'status', 'revision', 'reasonCode'];
const TERMINAL_KEYS = ['status', 'revision', 'reasonCode'];
const REJECTION_REASONS = ['UNSUPPORTED_ACTION', 'STALE_REVISION', 'ACTION_NOT_ALLOWED', 'REVISION_EXHAUSTED'];
const REFERENCE_ACTIONS = new Set(['restSecurity', 'install', 'recoverRegistry', 'activateScript']);
const REFERENCE_TOKEN = /^r:[0-9a-f]{32}$/;
const MISSING = Symbol('missing');

class CommandRecordError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const reject = code => { throw new CommandRecordError(code); };
const nonempty = value => typeof value === 'string' && value.length > 0;
const revision = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);

function ordinary(value, code) {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) reject(code);
}

function own(value, key, code, optional = false) {
  ordinary(value, code);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor && optional) return MISSING;
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
  return descriptor.value;
}

function exact(value, keys, code) {
  ordinary(value, code);
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) reject(code);
  const result = {};
  for (const key of keys) Object.defineProperty(result, key, {
    value: own(value, key, code), enumerable: true, writable: true, configurable: true
  });
  return result;
}

function dense(value, code, ancestors = new Set()) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) reject(code);
  const keys = Reflect.ownKeys(value);
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (!length || !Object.hasOwn(length, 'value') || length.enumerable || length.configurable
    || !Number.isSafeInteger(length.value) || length.value < 0 || keys.length !== length.value + 1) reject(code);
  const rows = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
    rows.push(copyData(descriptor.value, code, ancestors));
  }
  return rows;
}

function copyData(value, code, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) reject(code);
    return value;
  }
  if (typeof value !== 'object') reject(code);
  if (ancestors.has(value)) reject(code);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return dense(value, code, ancestors);
    ordinary(value, code);
    const result = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') reject(code);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject(code);
      Object.defineProperty(result, key, {
        value: copyData(descriptor.value, code, ancestors), enumerable: true, writable: true, configurable: true
      });
    }
    return result;
  } finally { ancestors.delete(value); }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function reference(value) {
  if (typeof value !== 'string' || !REFERENCE_TOKEN.test(value)) reject('INVALID_COMMAND');
  return value;
}
function destination(value, registry = false) {
  ordinary(value, 'INVALID_COMMAND');
  if (registry && own(value, 'zone', 'INVALID_COMMAND') === 'registry') return exact(value, ['zone'], 'INVALID_COMMAND');
  // Re-execution may name a Code in the target area instead of a slot.
  if (registry && Object.hasOwn(value, 'hostRef')) {
    const result = exact(value, ['zone', 'hostRef'], 'INVALID_COMMAND');
    if (!['front', 'back'].includes(result.zone)) reject('INVALID_COMMAND');
    reference(result.hostRef);
    return result;
  }
  const result = exact(value, ['zone', 'slot'], 'INVALID_COMMAND');
  if (!['front', 'back'].includes(result.zone) || !Number.isSafeInteger(result.slot)
    || result.slot < 1 || Object.is(result.slot, -0)) reject('INVALID_COMMAND');
  return result;
}
function target(value) {
  ordinary(value, 'INVALID_COMMAND');
  const kind = own(value, 'kind', 'INVALID_COMMAND');
  if (kind === 'card') { const result = exact(value, ['kind', 'cardRef'], 'INVALID_COMMAND'); reference(result.cardRef); return result; }
  if (kind === 'user') { const result = exact(value, ['kind', 'seatId'], 'INVALID_COMMAND'); if (!nonempty(result.seatId)) reject('INVALID_COMMAND'); return result; }
  reject('INVALID_COMMAND');
}
function targets(value) {
  const result = dense(value, 'INVALID_COMMAND').map(target);
  if (new Set(result.map(canonicalJson)).size !== result.length) reject('INVALID_COMMAND');
  return result;
}
function placement(value) {
  ordinary(value, 'INVALID_COMMAND');
  const kind = own(value, 'kind', 'INVALID_COMMAND');
  if (kind === 'none') return exact(value, ['kind'], 'INVALID_COMMAND');
  if (kind === 'slot') { const result = exact(value, ['kind', 'zone', 'slot'], 'INVALID_COMMAND'); destination({zone:result.zone,slot:result.slot}); return result; }
  if (kind === 'aboveCode' || kind === 'belowOb') { const result = exact(value, ['kind', 'hostRef'], 'INVALID_COMMAND'); reference(result.hostRef); return result; }
  if (kind === 'asScript') { const result = exact(value, ['kind', 'slot'], 'INVALID_COMMAND'); destination({zone:'back',slot:result.slot}); return result; }
  reject('INVALID_COMMAND');
}

function canonicalCommand(input) {
  const source = exact(input, ENVELOPE_KEYS, 'INVALID_COMMAND');
  if (!Number.isSafeInteger(source.contractVersion) || Object.is(source.contractVersion, -0) || source.contractVersion < 0) reject('INVALID_COMMAND');
  if (source.contractVersion !== FORMAT_VERSION) reject('UNSUPPORTED_CONTRACT');
  if (!nonempty(source.matchId) || !nonempty(source.commandId) || !nonempty(source.actorSeat) || !revision(source.expectedRevision)) reject('INVALID_COMMAND');
  const action = copyData(source.action, 'INVALID_COMMAND');
  ordinary(action, 'INVALID_COMMAND');
  const type = own(action, 'type', 'INVALID_COMMAND');
  if (!nonempty(type)) reject('INVALID_COMMAND');
  let canonicalAction;
  if (type === 'endTurn' || type === 'openingMulligan') canonicalAction = exact(action, ['type'], 'INVALID_COMMAND');
  else if (type === 'executeSpell' || type === 'executeRegistry' || type === 'activateCardEffect') {
    const keys = type === 'executeSpell' ? ['type','cardRef','targets','selectionScope']
      : type === 'executeRegistry' ? ['type','cardRef','placement','targets','selectionScope']
      : ['type','cardRef','effectKey','targets','targetZone'];
    canonicalAction = exact(action, keys, 'INVALID_COMMAND');
    reference(canonicalAction.cardRef);
    canonicalAction.targets = targets(canonicalAction.targets);
    if (type === 'activateCardEffect') {
      if (!nonempty(canonicalAction.effectKey) || ![null,'front','back'].includes(canonicalAction.targetZone)) reject('INVALID_COMMAND');
    } else if (canonicalAction.selectionScope !== null && !nonempty(canonicalAction.selectionScope)) reject('INVALID_COMMAND');
    if (type === 'executeRegistry') canonicalAction.placement = placement(canonicalAction.placement);
  }
  else if (type === 'mountCard') {
    canonicalAction = exact(action, ['type','cardRef','hostRef','mountKind'], 'INVALID_COMMAND');
    reference(canonicalAction.cardRef); reference(canonicalAction.hostRef);
    if (canonicalAction.cardRef === canonicalAction.hostRef || !['aboveCode','belowOb'].includes(canonicalAction.mountKind)) reject('INVALID_COMMAND');
  }
  else if (type === 'executeCard' || type === 'redeploy' || type === 'setScript') {
    canonicalAction = exact(action, ['type', 'cardRef', 'destination'], 'INVALID_COMMAND');
    if (typeof canonicalAction.cardRef !== 'string' || canonicalAction.cardRef.length !== 34
      || !REFERENCE_TOKEN.test(canonicalAction.cardRef)) reject('INVALID_COMMAND');
    canonicalAction.destination = destination(canonicalAction.destination, type === 'redeploy');
    if (type === 'setScript' && canonicalAction.destination.zone !== 'back') reject('INVALID_COMMAND');
  }
  else if (type === 'executeLayered') {
    canonicalAction = exact(action, ['type', 'cardRef', 'materialRefs', 'destination'], 'INVALID_COMMAND');
    if (typeof canonicalAction.cardRef !== 'string' || canonicalAction.cardRef.length !== 34
      || !REFERENCE_TOKEN.test(canonicalAction.cardRef)) reject('INVALID_COMMAND');
    canonicalAction.materialRefs = dense(canonicalAction.materialRefs, 'INVALID_COMMAND');
    if (canonicalAction.materialRefs.length < 1
      || !canonicalAction.materialRefs.every(cardRef => typeof cardRef === 'string' && cardRef.length === 34
        && REFERENCE_TOKEN.test(cardRef))
      || new Set(canonicalAction.materialRefs).size !== canonicalAction.materialRefs.length) reject('INVALID_COMMAND');
    canonicalAction.destination = exact(canonicalAction.destination, ['zone', 'slot'], 'INVALID_COMMAND');
    if (!['front', 'back'].includes(canonicalAction.destination.zone)
      || !Number.isSafeInteger(canonicalAction.destination.slot) || canonicalAction.destination.slot < 1
      || Object.is(canonicalAction.destination.slot, -0)) reject('INVALID_COMMAND');
  }
  else if (type === 'activateAbility') {
    canonicalAction = exact(action, ['type', 'ability'], 'INVALID_COMMAND');
    canonicalAction.ability = exact(canonicalAction.ability, ['kind', 'key'], 'INVALID_COMMAND');
    if (!nonempty(canonicalAction.ability.kind) || !nonempty(canonicalAction.ability.key)) reject('INVALID_COMMAND');
    if (canonicalAction.ability.kind !== 'user' || canonicalAction.ability.key !== 'turbo') reject('ACTION_SCHEMA_UNAVAILABLE');
  }
  else if (type === 'sandboxAddCard') {
    canonicalAction = exact(action, ['type', 'definitionId', 'targetSeat'], 'INVALID_COMMAND');
    if (!nonempty(canonicalAction.definitionId) || !nonempty(canonicalAction.targetSeat)) reject('INVALID_COMMAND');
  }
  else if (type === 'sandboxSelectActiveSeat') {
    canonicalAction = exact(action, ['type', 'targetSeat'], 'INVALID_COMMAND');
    if (!nonempty(canonicalAction.targetSeat)) reject('INVALID_COMMAND');
  }
  else if (type === 'attack') {
    canonicalAction = exact(action, ['type', 'attackerRef', 'target'], 'INVALID_COMMAND');
    if (typeof canonicalAction.attackerRef !== 'string' || canonicalAction.attackerRef.length !== 34
      || !REFERENCE_TOKEN.test(canonicalAction.attackerRef)) reject('INVALID_COMMAND');
    ordinary(canonicalAction.target, 'INVALID_COMMAND');
    const kind = own(canonicalAction.target, 'kind', 'INVALID_COMMAND');
    if (kind === 'card') {
      canonicalAction.target = exact(canonicalAction.target, ['kind', 'cardRef'], 'INVALID_COMMAND');
      if (typeof canonicalAction.target.cardRef !== 'string' || canonicalAction.target.cardRef.length !== 34
        || !REFERENCE_TOKEN.test(canonicalAction.target.cardRef)) reject('INVALID_COMMAND');
    } else if (kind === 'user') {
      canonicalAction.target = exact(canonicalAction.target, ['kind', 'seatId'], 'INVALID_COMMAND');
      if (!nonempty(canonicalAction.target.seatId)) reject('INVALID_COMMAND');
    } else reject('INVALID_COMMAND');
  }
  else if (type === 'answerChoice') {
    canonicalAction = exact(action, ['type', 'choiceId', 'optionIds', 'allocation'], 'INVALID_COMMAND');
    if (!nonempty(canonicalAction.choiceId)) reject('INVALID_COMMAND');
    canonicalAction.optionIds = dense(canonicalAction.optionIds, 'INVALID_COMMAND');
    if (!canonicalAction.optionIds.every(nonempty) || new Set(canonicalAction.optionIds).size !== canonicalAction.optionIds.length) reject('INVALID_COMMAND');
    canonicalAction.allocation = dense(canonicalAction.allocation, 'INVALID_COMMAND').map(entry => {
      const value = exact(entry, ['optionId', 'amount'], 'INVALID_COMMAND');
      if (!nonempty(value.optionId) || !Number.isSafeInteger(value.amount) || value.amount < 0 || Object.is(value.amount, -0)) reject('INVALID_COMMAND');
      return value;
    });
    if (new Set(canonicalAction.allocation.map(entry => entry.optionId)).size !== canonicalAction.allocation.length) reject('INVALID_COMMAND');
  }
  else if (type === 'declineChoice') {
    canonicalAction = exact(action, ['type', 'choiceId'], 'INVALID_COMMAND');
    if (!nonempty(canonicalAction.choiceId)) reject('INVALID_COMMAND');
  }
  else if (REFERENCE_ACTIONS.has(type)) {
    canonicalAction = exact(action, ['type', 'cardRef'], 'INVALID_COMMAND');
    if (typeof canonicalAction.cardRef !== 'string' || canonicalAction.cardRef.length !== 34
      || !REFERENCE_TOKEN.test(canonicalAction.cardRef)) reject('INVALID_COMMAND');
  } else reject('INVALID_COMMAND');
  const command = { ...source, action: canonicalAction };
  return { command, canonicalPayload: canonicalJson(command) };
}

function seatList(value, code) {
  const seats = dense(value, code);
  if (seats.length !== 2 || !seats.every(nonempty) || seats[0] === seats[1]) reject(code);
  return seats;
}

function journalData(input) {
  const journal = exact(input, JOURNAL_KEYS, 'INVALID_JOURNAL');
  if (journal.schemaVersion !== JOURNAL_VERSION || !nonempty(journal.matchId)) reject('INVALID_JOURNAL');
  journal.seatIds = seatList(journal.seatIds, 'INVALID_JOURNAL');
  const entries = dense(journal.entries, 'INVALID_JOURNAL');
  const seen = new Set();
  journal.entries = entries.map(entryValue => {
    const entry = exact(entryValue, ENTRY_KEYS, 'INVALID_JOURNAL');
    if (!nonempty(entry.commandId) || !nonempty(entry.actorSeat) || !journal.seatIds.includes(entry.actorSeat)
      || typeof entry.canonicalPayload !== 'string' || seen.has(entry.commandId)) reject('INVALID_JOURNAL');
    seen.add(entry.commandId);
    let parsed;
    try { parsed = JSON.parse(entry.canonicalPayload); } catch (error) {
      if (error instanceof SyntaxError) reject('INVALID_JOURNAL');
      throw error;
    }
    let canonical;
    try { canonical = canonicalCommand(parsed); } catch (error) {
      if (error instanceof CommandRecordError) reject('INVALID_JOURNAL');
      throw error;
    }
    if (canonical.canonicalPayload !== entry.canonicalPayload || canonical.command.commandId !== entry.commandId
      || canonical.command.actorSeat !== entry.actorSeat || canonical.command.matchId !== journal.matchId) reject('INVALID_JOURNAL');
    const receipt = exact(entry.receipt, RECEIPT_KEYS, 'INVALID_JOURNAL');
    if (receipt.matchId !== journal.matchId || receipt.commandId !== entry.commandId || !revision(receipt.revision)) reject('INVALID_JOURNAL');
    if (receipt.status === 'accepted') {
      if (receipt.reasonCode !== 'ACCEPTED' || canonical.command.expectedRevision === Number.MAX_SAFE_INTEGER
        || receipt.revision !== canonical.command.expectedRevision + 1) reject('INVALID_JOURNAL');
    } else if (receipt.status === 'rejected') {
      if (!REJECTION_REASONS.includes(receipt.reasonCode)) reject('INVALID_JOURNAL');
    } else reject('INVALID_JOURNAL');
    return entry;
  });
  return journal;
}

function authorizationHeader(journal, context, command) {
  const trusted = exact(context, CONTEXT_KEYS, 'NOT_AUTHORIZED');
  if (!nonempty(trusted.matchId) || !nonempty(trusted.actorSeat) || trusted.matchId !== command.matchId
    || trusted.actorSeat !== command.actorSeat) reject('NOT_AUTHORIZED');
  ordinary(journal, 'INVALID_JOURNAL');
  if (own(journal, 'schemaVersion', 'INVALID_JOURNAL') !== JOURNAL_VERSION) reject('INVALID_JOURNAL');
  const matchId = own(journal, 'matchId', 'INVALID_JOURNAL');
  const seatIds = seatList(own(journal, 'seatIds', 'INVALID_JOURNAL'), 'INVALID_JOURNAL');
  if (!nonempty(matchId)) reject('INVALID_JOURNAL');
  if (matchId !== command.matchId || !seatIds.includes(trusted.actorSeat)) reject('NOT_AUTHORIZED');
  return trusted;
}

function classifyData(journalInput, contextInput, envelopeInput) {
  const canonical = canonicalCommand(envelopeInput);
  authorizationHeader(journalInput, contextInput, canonical.command);
  const journal = journalData(journalInput);
  if (journal.matchId !== canonical.command.matchId || !journal.seatIds.includes(canonical.command.actorSeat)) reject('NOT_AUTHORIZED');
  const existing = journal.entries.find(entry => entry.commandId === canonical.command.commandId);
  if (existing) {
    if (existing.actorSeat === canonical.command.actorSeat && existing.canonicalPayload === canonical.canonicalPayload) {
      return { kind: 'retry', receipt: copyData(existing.receipt, 'INVALID_JOURNAL') };
    }
    reject('COMMAND_ID_COLLISION');
  }
  return { kind: 'new', journal, command: canonical.command, canonicalPayload: canonical.canonicalPayload };
}

function terminalData(input, command, matchId) {
  const terminal = exact(copyData(input, 'INVALID_TERMINAL'), TERMINAL_KEYS, 'INVALID_TERMINAL');
  if (!revision(terminal.revision) || !nonempty(terminal.status) || !nonempty(terminal.reasonCode)) reject('INVALID_TERMINAL');
  if (terminal.status === 'accepted') {
    if (terminal.reasonCode !== 'ACCEPTED') reject('INVALID_TERMINAL');
    if (command.expectedRevision === Number.MAX_SAFE_INTEGER) reject('REVISION_EXHAUSTED');
    if (terminal.revision !== command.expectedRevision + 1) reject('INVALID_TERMINAL');
  } else if (terminal.status === 'rejected') {
    if (!REJECTION_REASONS.includes(terminal.reasonCode)) reject('INVALID_TERMINAL');
  } else reject('INVALID_TERMINAL');
  return { matchId, commandId: command.commandId, ...terminal };
}

function envelope(action) {
  try { return { ok: true, value: action() }; }
  catch (error) {
    if (error instanceof CommandRecordError) return { ok: false, error: { code: error.code } };
    throw error;
  }
}

export function createCommandJournal(input) {
  return envelope(() => {
    const args = exact(copyData(input, 'INVALID_COMMAND'), ['matchId', 'seatIds'], 'INVALID_COMMAND');
    if (!nonempty(args.matchId)) reject('INVALID_COMMAND');
    return { schemaVersion: JOURNAL_VERSION, matchId: args.matchId, seatIds: seatList(args.seatIds, 'INVALID_COMMAND'), entries: [] };
  });
}

export function canonicalizeCommand(input) {
  return envelope(() => canonicalCommand(input));
}

export function validateCommandJournal(input) {
  return envelope(() => copyData(journalData(input), 'INVALID_JOURNAL'));
}

export function classifyCommand(journal, context, command) {
  return envelope(() => {
    const result = classifyData(journal, context, command);
    return result.kind === 'retry' ? { kind: 'retry', receipt: result.receipt } : { kind: 'new' };
  });
}

export function recordTerminal(journal, context, command, terminal) {
  return envelope(() => {
    const result = classifyData(journal, context, command);
    if (result.kind === 'retry') reject('COMMAND_ALREADY_RECORDED');
    const receipt = terminalData(terminal, result.command, result.journal.matchId);
    const next = copyData(result.journal, 'INVALID_JOURNAL');
    next.entries.push({
      commandId: result.command.commandId,
      actorSeat: result.command.actorSeat,
      canonicalPayload: result.canonicalPayload,
      receipt
    });
    return next;
  });
}
