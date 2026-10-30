import { STD_CARD_MODULES } from "./std_ex.js";
import { SZTB_CARD_MODULES } from "./sztb_ex.js";

// card id -> card module, across every prefix (STD first, then SZTB)
export const CARD_MODULES = Object.freeze({ ...STD_CARD_MODULES, ...SZTB_CARD_MODULES });

// The export `exportName` of every card that has it, as an object keyed by card id.
export function collectSpecs(exportName, order = Object.keys(CARD_MODULES)) {
  const table = {};
  for (const id of order) if (CARD_MODULES[id][exportName] !== undefined) table[id] = CARD_MODULES[id][exportName];
  return table;
}

// The list-valued export of every card, flattened in the given order of [card id, position] pairs.
export function collectSpecList(exportName, order) {
  return order.map(([id, position]) => CARD_MODULES[id][exportName][position]);
}

// The ids (in the given order) of the cards whose module sets the flag `exportName`.
export function collectFlagged(exportName, order) {
  return order.filter((id) => CARD_MODULES[id][exportName] === true);
}
