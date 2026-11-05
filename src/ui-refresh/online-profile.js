import { NAME_KEY } from "../network/online-client.js";
import { LIMITS, sanitizeGuestName } from "../network/protocol.js";

// Who the player is in online play: a profile { source, name, icon, discordName, typedName }.
// - source "guest": the name typed once on the name screen and kept in this browser (文豪, 2026-11-05: 「簡易登録でユーザー名
//   入力(ブラウザキャッシュ保存で初回のみ)」).
// - source "discord": with a Discord login (discord-login.js profile()), its name is the first choice (design Q2); the typed
//   name stays kept and can be taken back. The icon is the Discord picture whichever name is used.
// The screens read only the profile. A browser that refuses its storage keeps nothing, so the name is asked again next visit.
export const NAME_USE_KEY = "sz-online-name-use"; // "typed": the typed name over the Discord one; anything else: Discord's

// Why a typed name cannot be kept: "empty", "long" (over 16 characters, not UTF-16 units), or null when it can.
export function onlineNameProblem(input) {
  const collapsed = String(input ?? "").replace(/[\p{C}\p{Z}]+/gu, " ").trim();
  if (!collapsed) return "empty";
  return [...collapsed].length > LIMITS.maxNameLength ? "long" : null;
}
export const onlineNameProblemText = problem => ({ empty: "名前を入れてください。", long: `名前は${LIMITS.maxNameLength}文字までです。` })[problem] ?? "";

// A Discord name as a name for the room: the same cleaning, cut to 16 characters.
const asName = value => sanitizeGuestName(value, "");
const read = (storage, key) => { try { return storage?.getItem(key) ?? null; } catch { return null; } };

// The profile from what this browser keeps and the Discord login's profile (or null); null when there is no name yet.
export function readOnlineProfile(storage, discord = null) {
  const kept = read(storage, NAME_KEY);
  const typedName = typeof kept === "string" && !onlineNameProblem(kept) ? asName(kept) : null;
  const discordName = discord && typeof discord.name === "string" && asName(discord.name) || null;
  const icon = discordName && typeof discord.avatarUrl === "string" ? discord.avatarUrl : null;
  const useTyped = read(storage, NAME_USE_KEY) === "typed" && typedName;
  if (discordName && !useTyped) return Object.freeze({ source: "discord", name: discordName, icon, discordName, typedName });
  return typedName ? Object.freeze({ source: "guest", name: typedName, icon, discordName, typedName }) : null;
}

// Keeps the name from the name screen (already checked with onlineNameProblem). The Discord name, when chosen, is kept as
// the choice only; any other name is kept as the typed one. A storage that refuses still gives the profile for this page.
export function saveOnlineProfile(storage, input, discord = null) {
  const name = asName(input);
  const discordName = discord && typeof discord.name === "string" && asName(discord.name) || null;
  const useDiscord = Boolean(discordName) && name === discordName;
  try {
    if (useDiscord) storage?.removeItem?.(NAME_USE_KEY);
    else { storage?.setItem(NAME_KEY, name); if (discordName) storage?.setItem(NAME_USE_KEY, "typed"); }
  } catch { /* kept for this page only */ }
  const typedName = useDiscord ? readOnlineProfile(storage)?.typedName ?? null : name;
  return Object.freeze({ source: useDiscord ? "discord" : "guest", name, icon: discordName ? discord.avatarUrl ?? null : null, discordName, typedName });
}

// After a new login the Discord name is the first choice again (Q2).
export function preferDiscordName(storage) {
  try { storage?.removeItem?.(NAME_USE_KEY); } catch { /* the choice stays as it was */ }
}
