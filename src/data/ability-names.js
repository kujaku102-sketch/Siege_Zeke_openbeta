// Ability names without any asset URL: pure data, safe to import from a Worker (no import.meta.url, no DOM).
// src/data/ability-badges.js adds the badge images on top of these labels.
export const ABILITY_LABELS = Object.freeze({
  QA: "QA", SECURITY: "セキュリティ", CONTACT: "コンタクト", HACKING: "ハッキング", DISCONNECT: "切断", ENCRYPTION: "暗号化",
  RESIDENT: "レジデント", DECOY: "デコイ", PROTECT: "プロテクト", LAYERED: "レイヤード", LOGIN: "ログイン", LOGOUT: "ログアウト", LOAD: "負荷"
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

// The label shown for an ability: its Japanese name, or the canonical name itself when it has none.
export const abilityLabel = (name) => {
  const canonical = normalizeAbilityName(name);
  return ABILITY_LABELS[canonical] ?? canonical;
};
