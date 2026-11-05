import { ABILITY_LABELS, abilityLabel, normalizeAbilityName } from "./ability-names.js";

export { normalizeAbilityName };

const asset = (name) => new URL(`../assets/ability-badges/${name}`, import.meta.url).href;

const FILES = Object.freeze({
  QA: "quick_action.png", SECURITY: "security.png", CONTACT: "contact.png", HACKING: "hacking.png", DISCONNECT: "disconnect.png",
  ENCRYPTION: "encryption.png", RESIDENT: "resident.png", DECOY: "decoy.png", PROTECT: "protection.png", LAYERED: "layered_bar.png",
  LOGIN: "login.png", LOGOUT: "logout.png", LOAD: "load_purple.png"
});

export const ABILITY_BADGES = Object.freeze(Object.fromEntries(Object.keys(ABILITY_LABELS)
  .map((name) => [name, { label: ABILITY_LABELS[name], asset: asset(FILES[name]) }])));

export function abilityBadgeDefinition(name) {
  const canonical = normalizeAbilityName(name);
  return { canonical, label: abilityLabel(canonical), asset: ABILITY_BADGES[canonical]?.asset ?? null };
}
