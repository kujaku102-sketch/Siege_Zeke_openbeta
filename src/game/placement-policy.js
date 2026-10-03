const BOUNDED_ZONES = new Set(["front", "back"]);

// This intentionally has no state or event dependencies: callers decide when a
// rejected normal placement is observable, and when a failed forced placement
// becomes rule destruction.
export function evaluatePlacement({ zone, occupied = 0, limit = Infinity, addedSlots = 1, freedSlots = 0, mode = "normal" } = {}) {
  if (!BOUNDED_ZONES.has(zone)) return { ok: true, bounded: false, occupied, limit, addedSlots: 0, freedSlots: 0, mode };
  const finiteNonNegative = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const normalizedAdded = finiteNonNegative(addedSlots);
  const normalizedFreed = finiteNonNegative(freedSlots);
  const effectiveOccupied = Math.max(0, finiteNonNegative(occupied) - normalizedFreed);
  const normalizedLimit = finiteNonNegative(limit);
  const ok = effectiveOccupied + normalizedAdded <= normalizedLimit;
  return {
    ok,
    bounded: true,
    occupied: finiteNonNegative(occupied),
    effectiveOccupied,
    limit: normalizedLimit,
    addedSlots: normalizedAdded,
    freedSlots: normalizedFreed,
    mode: mode === "forced-effect" ? "forced-effect" : "normal"
  };
}
