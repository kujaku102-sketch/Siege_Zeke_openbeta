import { NAME_KEY } from "../network/online-client.js";
import { LIMITS, sanitizeGuestName } from "../network/protocol.js";

// Who the player is in online play: a profile { source, name, icon }. Today the only source is "guest", the name typed
// once on the name screen and kept in this browser (文豪, 2026-11-05: 「簡易登録でユーザー名入力(ブラウザキャッシュ保存で初回のみ)」).
// A later source (a Discord sign-in, with its own name and icon) adds its reader here; the screens read only the profile.
// A browser that refuses its storage (a private window) keeps no profile, so the name is asked again on the next visit.

// Why a typed name cannot be kept: "empty", "long" (over 16 characters, not UTF-16 units), or null when it can.
export function onlineNameProblem(input) {
  const collapsed = String(input ?? "").replace(/[\p{C}\p{Z}]+/gu, " ").trim();
  if (!collapsed) return "empty";
  return [...collapsed].length > LIMITS.maxNameLength ? "long" : null;
}
export const onlineNameProblemText = problem => ({ empty: "名前を入れてください。", long: `名前は${LIMITS.maxNameLength}文字までです。` })[problem] ?? "";

const guest = name => Object.freeze({ source: "guest", name: sanitizeGuestName(name, ""), icon: null });

// The kept profile, or null when none is kept, it cannot be read, or what is kept is not a name.
export function readOnlineProfile(storage) {
  let name;
  try { name = storage?.getItem(NAME_KEY); } catch { return null; }
  return typeof name === "string" && !onlineNameProblem(name) ? guest(name) : null;
}

// Keeps a typed name (already checked with onlineNameProblem) and returns its profile; a storage that refuses still
// gives the profile for this page.
export function saveOnlineProfile(storage, input) {
  const profile = guest(input);
  try { storage?.setItem(NAME_KEY, profile.name); } catch { /* kept for this page only */ }
  return profile;
}
