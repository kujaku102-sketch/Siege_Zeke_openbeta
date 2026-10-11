export class ActionRegistryError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const fail = code => { throw new ActionRegistryError(code); };

export function createActionRegistry(entries) {
  if (!Array.isArray(entries) || Object.getPrototypeOf(entries) !== Array.prototype) fail('INVALID_ACTION_REGISTRY');
  const handlers = new Map();
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object' || Object.getPrototypeOf(entry) !== Object.prototype) fail('INVALID_ACTION_REGISTRY');
    const keys = Reflect.ownKeys(entry);
    if (keys.length !== 3 || keys.some(key => typeof key !== 'string'
      || !['type', 'requiresReferenceState', 'prepare'].includes(key))) fail('INVALID_ACTION_REGISTRY');
    const typeDescriptor = Object.getOwnPropertyDescriptor(entry, 'type');
    const referenceDescriptor = Object.getOwnPropertyDescriptor(entry, 'requiresReferenceState');
    const prepareDescriptor = Object.getOwnPropertyDescriptor(entry, 'prepare');
    for (const descriptor of [typeDescriptor, referenceDescriptor, prepareDescriptor]) {
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('INVALID_ACTION_REGISTRY');
    }
    const { type, requiresReferenceState, prepare } = entry;
    if (typeof type !== 'string' || type.length === 0 || typeof requiresReferenceState !== 'boolean'
      || typeof prepare !== 'function' || handlers.has(type)) fail('INVALID_ACTION_REGISTRY');
    handlers.set(type, Object.freeze({ type, requiresReferenceState, prepare }));
  }
  if (handlers.size === 0) fail('INVALID_ACTION_REGISTRY');
  return Object.freeze({
    types: Object.freeze([...handlers.keys()]),
    lookup(type) { return handlers.get(type) ?? null; }
  });
}

export function lookupActionHandler(registry, type) {
  if (registry === null || typeof registry !== 'object' || typeof registry.lookup !== 'function'
    || typeof type !== 'string' || type.length === 0) fail('INVALID_ACTION_REGISTRY');
  return registry.lookup(type);
}
