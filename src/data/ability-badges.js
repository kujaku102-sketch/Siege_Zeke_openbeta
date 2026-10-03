const asset = (name) => new URL(`../assets/ability-badges/${name}`, import.meta.url).href;

export const ABILITY_BADGES = Object.freeze({
  QA: { label: "QA", asset: asset("quick_action.png") },
  SECURITY: { label: "セキュリティ", asset: asset("security.png") },
  CONTACT: { label: "コンタクト", asset: asset("contact.png") },
  HACKING: { label: "ハッキング", asset: asset("hacking.png") },
  DISCONNECT: { label: "切断", asset: asset("disconnect.png") },
  ENCRYPTION: { label: "暗号化", asset: asset("encryption.png") },
  RESIDENT: { label: "レジデント", asset: asset("resident.png") },
  DECOY: { label: "デコイ", asset: asset("decoy.png") },
  PROTECT: { label: "プロテクト", asset: asset("protection.png") },
  LAYERED: { label: "レイヤード", asset: asset("layered_bar.png") },
  LOGIN: { label: "ログイン", asset: asset("login.png") },
  LOGOUT: { label: "ログアウト", asset: asset("logout.png") },
  LOAD: { label: "負荷", asset: asset("load_purple.png") }
});

const ALIASES = Object.freeze({
  Security: "SECURITY", Contact: "CONTACT", Hacking: "HACKING", Encryption: "ENCRYPTION",
  Disconnect: "DISCONNECT", Resident: "RESIDENT", Decoy: "DECOY", Protect: "PROTECT",
  Layered: "LAYERED", Login: "LOGIN", Logout: "LOGOUT", Load: "LOAD", Backup: "BACKUP",
  QuickAction: "QA", クイックアクション: "QA", セキュリティ: "SECURITY", コンタクト: "CONTACT", ハッキング: "HACKING",
  切断: "DISCONNECT", 暗号化: "ENCRYPTION", レジデント: "RESIDENT", デコイ: "DECOY",
  プロテクト: "PROTECT", レイヤード: "LAYERED", ログイン: "LOGIN", ログアウト: "LOGOUT", 負荷: "LOAD"
});

export const normalizeAbilityName = (name) => ALIASES[name] ?? String(name ?? "").toUpperCase();

export function abilityBadgeDefinition(name) {
  const canonical = normalizeAbilityName(name);
  return { canonical, label: ABILITY_BADGES[canonical]?.label ?? canonical, asset: ABILITY_BADGES[canonical]?.asset ?? null };
}
