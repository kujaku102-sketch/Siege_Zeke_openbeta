const BOUNDED_ZONES = new Set(["front", "back"]);
const TRIAL_SLOT_EXECUTION_IDS = new Set(["STD-020", "STD-021", "STD-022", "STD-023", "STD-024"]);

// First direct-slot execution packet. This is shared by the current UI and the
// runtime command bridge so the temporary capability boundary cannot drift.
export function supportsTrialSlotExecution(card) {
  return Boolean(card && card.category === "Ob" && TRIAL_SLOT_EXECUTION_IDS.has(card.id));
}

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
