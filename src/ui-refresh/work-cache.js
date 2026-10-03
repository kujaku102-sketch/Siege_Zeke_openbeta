// Callers own invalidation: mutable engine state must start a new epoch on every
// game render. Keys contain only projection inputs, never a serialized game/history.
export function createWorkCache(limit = 1) {
  const entries = new Map(), counts = new Map();
  return {
    invalidate(name) { if (name === undefined) entries.clear(); else entries.delete(name); },
    reuse(name, key, build) {
      const bucket = entries.get(name) ?? [];
      const stats = counts.get(name) ?? { runs: 0, hits: 0 };
      counts.set(name, stats);
      const index = bucket.findIndex(entry => entry.key.length === key.length && entry.key.every((value, i) => Object.is(value, key[i])));
      if (index !== -1) {
        stats.hits++;
        const [entry] = bucket.splice(index, 1); bucket.push(entry);
        return entry.value;
      }
      const value = build();
      stats.runs++;
      bucket.push({ key: [...key], value });
      if (bucket.length > limit) bucket.shift();
      entries.set(name, bucket);
      return value;
    },
    snapshot() { return Object.fromEntries([...counts].map(([name, value]) => [name, { ...value }])); }
  };
}

// Only passive geometry events are coalesced. Game commands still render now.
export function createFrameScheduler(run, request, cancel) {
  let pending = null;
  return {
    schedule() { if (pending === null) pending = request(() => { pending = null; run(); }); },
    cancel() { if (pending !== null) cancel(pending); pending = null; }
  };
}
