const failure = code => ({ ok: false, error: { code } });
const TOKEN = /^r:[0-9a-f]{32}$/;

export function createRuntimeReferenceTokens(input) {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) {
    return failure('REFERENCE_GENERATION_FAILED');
  }
  const keys = Reflect.ownKeys(input);
  if (keys.length !== 2 || keys.some(key => typeof key !== 'string' || !['count', 'issuedRefs'].includes(key))) {
    return failure('REFERENCE_GENERATION_FAILED');
  }
  const count = Object.getOwnPropertyDescriptor(input, 'count');
  const refs = Object.getOwnPropertyDescriptor(input, 'issuedRefs');
  if (!count?.enumerable || !Object.hasOwn(count, 'value') || !refs?.enumerable || !Object.hasOwn(refs, 'value')
    || !Number.isSafeInteger(count.value) || count.value < 0 || Object.is(count.value, -0)
    || !Array.isArray(refs.value) || Object.getPrototypeOf(refs.value) !== Array.prototype
    || Reflect.ownKeys(refs.value).length !== refs.value.length + 1) return failure('REFERENCE_GENERATION_FAILED');
  const issued = new Set();
  for (let index = 0; index < refs.value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(refs.value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
      || !TOKEN.test(descriptor.value) || issued.has(descriptor.value)) return failure('REFERENCE_GENERATION_FAILED');
    issued.add(descriptor.value);
  }
  const crypto = globalThis.crypto;
  if (!crypto || typeof crypto.getRandomValues !== 'function') return failure('REFERENCE_GENERATION_FAILED');
  const result = [];
  for (let index = 0; index < count.value; index += 1) {
    let token = null;
    for (let attempt = 0; attempt < 1024 && token === null; attempt += 1) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      const candidate = `r:${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
      if (!issued.has(candidate)) token = candidate;
    }
    if (token === null) return failure('REFERENCE_GENERATION_FAILED');
    issued.add(token);
    result.push(token);
  }
  return { ok: true, value: result };
}
