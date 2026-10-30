import { STD_CARDS, VENGEANCE_DECK, VENGEANCE_IDS, NEUTRON_DECK, NEUTRON_IDS, RED_DECK, YELLOW_DECK } from "../cards/std_ex.js";
import { SZTB_CARDS } from "../cards/sztb_ex.js";

// The library is assembled from the per-prefix indexes in src/cards/ (STD first, then SZTB: the order of the old single table).
export const CARD_LIBRARY = Object.freeze({ ...STD_CARDS, ...SZTB_CARDS });
export const LAB_CARD_IDS = Object.freeze([...Object.keys(CARD_LIBRARY)].sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })));

export { VENGEANCE_DECK, VENGEANCE_IDS, NEUTRON_DECK, NEUTRON_IDS, RED_DECK, YELLOW_DECK };

export const USER_CARDS = Object.freeze({
  "doors_zx": {
    "initialHand": 4,
    "frontLimit": 5,
    "backLimit": 5,
    "deckRule": null,
    "id": "DOORS-ZX",
    "name": "Doors ZX",
    "maxStr": 20,
    "memory": 5,
    "incidents": [
      15,
      11,
      7,
      3
    ],
    "abilityKey": "turbo",
    "abilityName": "ターボ・ブースト！",
    "ability": "自分ターン開始時に起動できる。次の自ターン開始時までメモリ上限を2増やす。ゲーム中1度だけ使用可能。"
  },
  "suckintosh": {
    "initialHand": 4,
    "frontLimit": 5,
    "backLimit": 5,
    "deckRule": null,
    "id": "SUCKINTOSH",
    "name": "Suckintosh",
    "maxStr": 20,
    "memory": 5,
    "incidents": [
      15,
      11,
      7,
      3
    ],
    "abilityKey": "mono_color",
    "abilityName": "モノカラー・ユナイト",
    "ability": "自分ユーザーの持つシンボルが1つのみであれば、自分Obすべてを+1/0する。"
  },
  "phoenix": {
    "initialHand": 4,
    "frontLimit": 5,
    "backLimit": 5,
    "deckRule": null,
    "id": "PHOENIX",
    "name": "PHOENIX",
    "maxStr": 20,
    "memory": 5,
    "incidents": [
      15,
      12,
      7,
      3
    ],
    "abilityKey": "registry_liberty",
    "abilityName": "レジストリバティ",
    "ability": "ゲーム中初めてレジストリにインストールした時、カードを1枚引きもう1度インストールすることができる。"
  },
  "humanoid": {
    "initialHand": 4,
    "frontLimit": 5,
    "backLimit": 5,
    "deckRule": null,
    "id": "HUMANOID",
    "name": "Humanoid",
    "maxStr": 18,
    "memory": 5,
    "incidents": [
      13,
      9,
      5,
      1
    ],
    "abilityKey": "recovery_boot",
    "abilityName": "リカバリーブート",
    "ability": "自分ユーザーのSTRが0以下になった時起動する。STRを1に回復しゲームを続行する。"
  },
  "by_os": {
    "initialHand": 8,
    "frontLimit": 3,
    "backLimit": 3,
    "deckRule": "60枚、同名2枚",
    "id": "BY-OS",
    "name": "By OS",
    "maxStr": 1,
    "memory": 3,
    "incidents": [],
    "abilityKey": "dimension_innovation",
    "abilityName": "異次元のイノベーション",
    "ability": "自分はダメージを受けるかわりに、受けるダメージ分の山札をBANする。"
  },
  "doors_nt": {
    "initialHand": 3,
    "frontLimit": 4,
    "backLimit": 4,
    "deckRule": "30枚",
    "id": "DOORS-NT",
    "name": "Doors NT",
    "maxStr": 16,
    "memory": 4,
    "incidents": [
      12,
      8,
      4
    ],
    "abilityKey": "do_or_isnt",
    "abilityName": "DO OR is'NT",
    "ability": "自分エリアのOb数に応じ、2体以下はターン最初のOb実行-1、3体は終了時STRとメモリ1回復、5体以上は自分Obの与ダメージ-1。"
  },
  "savage_salvage": {
    "initialHand": 4,
    "frontLimit": 3,
    "backLimit": 4,
    "deckRule": null,
    "id": "SAVAGE-SALVAGE",
    "name": "Savage_Salvage",
    "maxStr": 15,
    "memory": 6,
    "incidents": [
      11,
      7,
      3
    ],
    "abilityKey": "trash_never_empty",
    "abilityName": "*ゴミ箱は空にならない*",
    "ability": "アクティブターン終了時、山札上2枚をゴミ箱へ送り、同シンボルなら1枚サルベージ、異なるなら1枚引く。"
  },
  "extreme": {
    "initialHand": 4,
    "frontLimit": 2,
    "backLimit": 2,
    "deckRule": "60枚、同名1枚",
    "id": "EXTREME",
    "name": "!EXTREME!",
    "maxStr": 60,
    "memory": 10,
    "incidents": [
      40,
      30,
      20,
      10
    ],
    "abilityKey": "kickass",
    "abilityName": "?KickASS?",
    "ability": "自分が受けるダメージは倍になる。"
  },
  "bigboss": {
    "initialHand": 5,
    "frontLimit": 1,
    "backLimit": 5,
    "deckRule": "50枚",
    "id": "BIGBOSS",
    "name": "BIGBOSS",
    "maxStr": 25,
    "memory": 5,
    "incidents": [
      20,
      15,
      10,
      5
    ],
    "abilityKey": "watching_you",
    "abilityName": "Watching you",
    "ability": "引き直し3回。Sp・Script実行-1、Ob・Code実行+1。"
  }
});
export const USERS = Object.freeze({ player: USER_CARDS.doors_zx, ai: USER_CARDS.doors_zx });
export const normalizeCardClasses = (definition) => { const aliases = ["classes", "cardClass", "className", "class", "クラス", "affiliation", "affiliations", "所属", "tribe", "tribes", "種族", "species"]; return [...new Set(aliases.flatMap((key) => { const value = definition?.[key]; if (value === undefined || value === null || value === "") return []; return (Array.isArray(value) ? value : [value]).flatMap((item) => String(item).split(/[\/／,，]/)).map((item) => String(item).trim()).filter(Boolean); }))]; };
export function expandDeck(recipe, owner) { let serial = 0; return recipe.flatMap(([cardId, count]) => Array.from({ length: count }, () => ({ ...CARD_LIBRARY[cardId], uid: `${owner}-${cardId}-${++serial}`, owner, sleep: false, damage: 0, attackedThisTurn: false, summoningSick: true, mounted: [], tempAtk: 0, tempStr: 0, skipStandby: false }))); }
export function createToken(owner, serial) { return { ...CARD_LIBRARY["STD-092"], uid: `${owner}-STD-092-${serial}`, owner, token: true, virtual: true, sleep: false, damage: 0, attackedThisTurn: false, summoningSick: true, mounted: [], tempAtk: 0, tempStr: 0, skipStandby: false }; }
export function createCardInstance(cardId, owner, serial = 1) { const source = CARD_LIBRARY[cardId]; return { ...source, category: source.category === "Sc" ? "Script" : source.category, uid: `${owner}-${cardId}-lab-${serial}`, owner, sleep: false, damage: 0, attackedThisTurn: false, summoningSick: true, mounted: [], tempAtk: 0, tempStr: 0, skipStandby: false, faceDown: false, residentActive: false, layerRole: null }; }
