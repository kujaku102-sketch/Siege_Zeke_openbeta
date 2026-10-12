const failure = code => ({ ok: false, error: { code } });
const nonempty = value => typeof value === 'string' && value.length > 0;

function plainExact(value, keys) {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) return null;
  const output = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    output[key] = descriptor.value;
  }
  return output;
}

function denseStrings(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !nonempty(descriptor.value)) return null;
    output.push(descriptor.value);
  }
  return Reflect.ownKeys(value).length === value.length + 1 ? output : null;
}

function denseAllocation(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    const entry = descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
      ? plainExact(descriptor.value, ['optionId', 'amount']) : null;
    if (!entry || !nonempty(entry.optionId) || !Number.isSafeInteger(entry.amount)
      || entry.amount <= 0 || Object.is(entry.amount, -0)) return null;
    output.push(entry);
  }
  return Reflect.ownKeys(value).length === value.length + 1
    && new Set(output.map(entry => entry.optionId)).size === output.length ? output : null;
}

function templateAction(value, query) {
  const input = plainExact(value, ['actionId', 'materialOptionIds', 'destinationOptionId']);
  const materialOptionIds = input && denseStrings(input.materialOptionIds);
  if (!input || materialOptionIds === null || !nonempty(input.actionId) || !nonempty(input.destinationOptionId)) return null;
  const entry = query.legalActions.find(item => item.actionId === input.actionId && item.kind === 'template');
  if (!entry || entry.actionType !== 'executeLayered') return null;
  const materials = entry.parameters?.materials?.options;
  const destinations = entry.parameters?.destination?.options;
  if (!Array.isArray(materials) || !Array.isArray(destinations)) return null;
  const byId = new Map(materials.map(option => [option.optionId, option.cardRef]));
  if (new Set(materialOptionIds).size !== materialOptionIds.length
    || materialOptionIds.some(optionId => !byId.has(optionId))) return null;
  const destination = destinations.find(option => option.optionId === input.destinationOptionId);
  if (!destination) return null;
  return {
    type: 'executeLayered', cardRef: entry.base.cardRef,
    materialRefs: materialOptionIds.map(optionId => byId.get(optionId)),
    destination: { zone: destination.zone, slot: destination.slot }
  };
}

function selection(input, query) {
  const base = plainExact(input, ['commandId', 'kind', 'value']);
  if (!base || !nonempty(base.commandId) || !nonempty(base.kind)) return null;
  if (base.kind === 'action') {
    if (!nonempty(base.value)) return null;
    const found = query.legalActions.find(entry => entry.actionId === base.value && entry.kind === 'fixed');
    return found ? structuredClone(found.action) : null;
  }
  if (base.kind === 'template') return templateAction(base.value, query);
  const required = query.requiredInput;
  if (!required?.canAnswer) return null;
  if (base.kind === 'decline') {
    if (base.value !== required.choiceId || !required.optional) return null;
    return { type: 'declineChoice', choiceId: required.choiceId };
  }
  if (base.kind === 'answer') {
    const answer = plainExact(base.value, ['choiceId', 'optionIds', 'allocation'])
      ?? (() => {
        const legacy = plainExact(base.value, ['choiceId', 'optionIds']);
        return legacy ? { ...legacy, allocation: [] } : null;
      })();
    const optionIds = answer && denseStrings(answer.optionIds);
    const allocation = answer && denseAllocation(answer.allocation);
    const allowed = new Set(required.options.map(option => option.optionId));
    if (!answer || answer.choiceId !== required.choiceId || optionIds === null || allocation === null
      || new Set(optionIds).size !== optionIds.length || optionIds.some(id => !allowed.has(id))
      || allocation.some(entry => !allowed.has(entry.optionId))) return null;
    return { type: 'answerChoice', choiceId: answer.choiceId, optionIds, allocation };
  }
  return null;
}

export function createRuntimeCui(port) {
  if (!port || typeof port.query !== 'function' || typeof port.submit !== 'function') return failure('INVALID_CUI_PORT');
  const execute = input => {
    const query = port.query();
    if (!query.ok) return query;
    const planned = plainExact(input, ['commandId', 'kind', 'value']);
    if (planned?.kind === 'plan') {
      const value = plainExact(planned.value, ['actionId', 'selections']);
      if (!value || !nonempty(planned.commandId) || typeof port.queryAction !== 'function') return failure('INVALID_CUI_COMMAND');
      const result = port.queryAction({ expectedRevision: query.value.status.revision, ...value });
      if (!result.ok) return result;
      if (!result.value.completion) return failure('CUI_SELECTION_INCOMPLETE');
      return port.submit({ commandId: planned.commandId, expectedRevision: result.value.revision,
        action: result.value.completion.action });
    }
    const base = input && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'commandId')?.value : null;
    const action = selection(input, query.value);
    if (!action || !nonempty(base)) return failure('INVALID_CUI_COMMAND');
    return port.submit({ commandId: base, expectedRevision: query.value.status.revision, action });
  };
  return { ok: true, value: Object.freeze({
    read() { return port.query(); },
    readAction(input) {
      return typeof port.queryAction === 'function' ? port.queryAction(input) : failure('ACTION_PLANNING_UNAVAILABLE');
    },
    readText() {
      const query = port.query();
      if (!query.ok) return query;
      return formatRuntimeCui(query.value);
    },
    execute,
    executeLine(line) {
      const parsed = parseRuntimeCuiLine(line);
      return parsed.ok ? execute(parsed.value) : parsed;
    }
  }) };
}

const TOKEN = /^[A-Za-z0-9._:-]+$/;
const token = value => typeof value === 'string' && TOKEN.test(value);
const csv = value => {
  if (value === '-') return [];
  const values = value.split(',');
  return values.length > 0 && values.every(token) ? values : null;
};

export function parseRuntimeCuiLine(line) {
  if (typeof line !== 'string' || line.trim() !== line || line.length === 0) return failure('INVALID_CUI_LINE');
  const parts = line.split(/ +/u);
  if (parts.some(part => part.length === 0)) return failure('INVALID_CUI_LINE');
  const [verb, commandId, ...args] = parts;
  if (!token(commandId)) return failure('INVALID_CUI_LINE');
  if (verb === 'action' && args.length === 1 && token(args[0])) {
    return { ok: true, value: { commandId, kind: 'action', value: args[0] } };
  }
  if (verb === 'plan' && args.length >= 1 && token(args[0])) {
    const selections = [];
    for (const part of args.slice(1)) {
      const pieces = part.split('=');
      const ids = pieces.length === 2 ? csv(pieces[1]) : null;
      if (!token(pieces[0]) || ids === null || new Set(ids).size !== ids.length) return failure('INVALID_CUI_LINE');
      selections.push({ requestId: pieces[0], optionIds: ids, allocation: [] });
    }
    return { ok: true, value: { commandId, kind: 'plan', value: { actionId: args[0], selections } } };
  }
  if (verb === 'template' && args.length === 3 && token(args[0]) && token(args[2])) {
    const materialOptionIds = csv(args[1]);
    if (materialOptionIds === null || new Set(materialOptionIds).size !== materialOptionIds.length) {
      return failure('INVALID_CUI_LINE');
    }
    return { ok: true, value: { commandId, kind: 'template', value: {
      actionId: args[0], materialOptionIds, destinationOptionId: args[2]
    } } };
  }
  if (verb === 'decline' && args.length === 1 && token(args[0])) {
    return { ok: true, value: { commandId, kind: 'decline', value: args[0] } };
  }
  if (verb === 'answer' && args.length === 3 && token(args[0])) {
    const optionIds = csv(args[1]);
    const allocationTokens = args[2] === '-' ? [] : args[2].split(',');
    const allocation = allocationTokens.map(entry => {
      const match = /^([A-Za-z0-9._:-]+)=([1-9][0-9]*)$/.exec(entry);
      const amount = match ? Number(match[2]) : null;
      return match && Number.isSafeInteger(amount) ? { optionId: match[1], amount } : null;
    });
    if (optionIds === null || allocationTokens.some(entry => entry.length === 0) || allocation.some(entry => entry === null)
      || new Set(optionIds).size !== optionIds.length
      || new Set(allocation.map(entry => entry.optionId)).size !== allocation.length) return failure('INVALID_CUI_LINE');
    return { ok: true, value: { commandId, kind: 'answer', value: {
      choiceId: args[0], optionIds, allocation
    } } };
  }
  return failure('INVALID_CUI_LINE');
}

function cardLine(prefix, card) {
  if (card?.faceDown) return `${prefix} ${card.cardRef} [HIDDEN]`;
  const name = visible(card?.definition?.name ?? '[UNKNOWN]');
  return `${prefix} ${card.cardRef} ${name}`;
}

const visible = value => String(value).replace(/[\u0000-\u001f\u007f]/gu, ' ');

export function formatRuntimeCui(query) {
  if (!query || typeof query !== 'object' || !query.status || !query.observation
    || !Array.isArray(query.legalActions)) return failure('INVALID_CUI_QUERY');
  const lines = [
    `STATUS ${query.status.progress} REV ${query.status.revision} VIEW ${query.status.viewerSeat} ACTIVE ${query.status.activeSeat}`,
    `TURN ${query.observation.turnNumber}`
  ];
  for (const seat of query.observation.seats ?? []) {
    lines.push(`SEAT ${seat.seatId} STR ${seat.fortressStr} MEM ${seat.memory?.current} DECK ${seat.deck?.count} HAND ${seat.hand?.count}`);
    for (const card of seat.hand?.cards ?? []) lines.push(cardLine('HAND', card));
    for (const zone of ['front', 'back', 'registry', 'trash', 'ban']) {
      for (const card of seat[zone]?.cards ?? []) lines.push(cardLine(zone.toUpperCase(), card));
    }
  }
  for (const entry of query.legalActions) {
    const type = entry.kind === 'fixed' ? entry.action?.type : entry.actionType;
    lines.push(`ACTION ${entry.actionId} ${entry.kind} ${type}`);
    if (entry.kind === 'template') {
      for (const option of entry.parameters?.materials?.options ?? []) {
        lines.push(`MATERIAL ${option.optionId} ${option.cardRef}`);
      }
      for (const option of entry.parameters?.destination?.options ?? []) {
        lines.push(`DESTINATION ${option.optionId} ${option.zone}:${option.slot}`);
      }
    }
  }
  if (query.requiredInput) {
    lines.push(`INPUT ${query.requiredInput.choiceId ?? '-'} ${query.requiredInput.kind} ${query.requiredInput.canAnswer ? 'ANSWER' : 'WAIT'}`);
    for (const option of query.requiredInput.options ?? []) {
      lines.push(`OPTION ${option.optionId} ${visible(option.label ?? option.cardRef ?? '-')}`);
    }
  }
  return { ok: true, value: lines.join('\n') };
}
