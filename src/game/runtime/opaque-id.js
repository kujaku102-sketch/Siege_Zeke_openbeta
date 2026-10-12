export function opaqueOrdinal(namespace, index) {
  let hash = 2166136261;
  const source = `${namespace}:${index}`;
  for (let offset = 0; offset < source.length; offset += 1) {
    hash ^= source.charCodeAt(offset);
    hash = Math.imul(hash, 16777619);
  }
  return `${namespace}:${(hash >>> 0).toString(36).padStart(7, '0')}`;
}
