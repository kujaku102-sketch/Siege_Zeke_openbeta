import { abilityBadgeDefinition, normalizeAbilityName } from "../data/ability-badges.js";

// Read-only inspector projection. Never consume counters or change runtime state.
export function runtimeComponents(card, turnNumber) {
  const rows = [];
  const add = (label, value = "", note = "", ability = null, tone = "") => {
    rows.push({ label, value, note, asset: ability ? abilityBadgeDefinition(ability).asset : null, tone });
  };
  const signed = (value) => Number(value) > 0 ? `+${Number(value)}` : String(Number(value));
  const abilityLabel = (name) => name === "BACKUP" ? "バックアップ" : abilityBadgeDefinition(name).label;
  for (const name of new Set((card.grantedKeywords ?? []).map(normalizeAbilityName))) {
    add(abilityLabel(name), "", "付与", name);
  }
  for (const item of card.timedModifiers ?? []) {
    if (!(turnNumber <= Number(item.expiresAfterTurn))) continue;
    const note = `T${Number(item.expiresAfterTurn)}終了まで`;
    if (item.keyword) {
      const name = normalizeAbilityName(item.keyword);
      add(abilityLabel(name), "", `付与・${note}`, name);
    }
    if (Number(item.atk)) add("ATK", signed(item.atk), note, null, "atk");
    if (Number(item.str)) add("STR", signed(item.str), note, null, "str");
  }
  if (Number(card.load) > 0) add("負荷", `×${Number(card.load)}`, "ATK / STR −1ずつ", "LOAD");
  for (const [name, count] of Object.entries(card.counters ?? {})) {
    if (Number(count) > 0) add(({ madness: "狂気", poison: "毒" })[name] ?? name, `×${Number(count)}`, "カウンター");
  }
  const printedProtect = (card.compiled?.keywords ?? []).find((item) => normalizeAbilityName(item.name) === "PROTECT");
  if (Number(card.protect) > 0 || printedProtect) {
    add("プロテクト", `残り${Number(card.protect ?? printedProtect?.value ?? 0)}回`, "残数", "PROTECT");
  }
  if (Number(card.backup) > 0) add("バックアップ", `残り${Number(card.backup)}回`, "付与分", "BACKUP");
  // Match the engine's printed backup limit; granted uses are a separate pool.
  const printedBackup = String(card.text ?? "").match(/\[バックアップ(?:[:：](\d+))?\]/);
  if (printedBackup) {
    const limit = Number(printedBackup[1] ?? 1);
    const used = card.backupUsedTurn === turnNumber ? Number(card.backupUsesThisTurn ?? 0) : 0;
    add("バックアップ", `残り${Math.max(0, limit - used)}/${limit}回`, "基本能力・このターン", "BACKUP");
  }
  for (const [field, label, note, tone] of [
    ["permanentAtk", "ATK", "期限指定なし", "atk"], ["permanentStr", "STR", "期限指定なし", "str"],
    ["tempAtk", "ATK", "このターン", "atk"], ["tempStr", "STR", "このターン", "str"],
    ["battleStrBonus", "STR", "この戦闘", "str"], ["turnCostModifier", "実行メモリ", "このターン", ""]
  ]) {
    if (Number(card[field])) add(label, signed(card[field]), note, null, tone);
  }
  if (Number(card.costReductionThisTurn)) add("実行メモリ", signed(-Number(card.costReductionThisTurn)), "このターン");
  if (card.revealedExecutionCost !== undefined) add("実行メモリ", `${Number(card.revealedExecutionCost)}に固定`);
  for (const item of card.damageModifiers ?? []) {
    if (item.activeTurn !== undefined && item.activeTurn !== turnNumber) continue;
    const kind = ({ battle: "戦闘", effect: "効果", all: "全" })[item.damageKind] ?? item.damageKind ?? "";
    const direction = ({ received: "受ける", dealt: "与える" })[item.direction] ?? item.direction ?? "";
    const value = item.operation === "set" ? `${Number(item.amount)}に固定`
      : item.operation === "cap_max" ? `最大${Number(item.amount)}` : signed(item.amount ?? 0);
    add(`${direction}${kind}ダメージ`, value, ({ turn: "このターン", battle: "この戦闘" })[item.duration] ?? "期限指定なし");
  }
  return rows;
}
