// スタートデッキ7色(各40枚・同名3枚まで)。デッキ構築の保存形式(id/name/userId/cards)と同じ形で持つ。
// tactic はCPU評価用の狙いメモ。
export const START_DECKS = Object.freeze([
  Object.freeze({ id: "start-red", name: "赤・レッドパンクス", color: "赤", userId: "doors_zx", tactic: "Codeを乗せたObで殴り、合体レッパオーで決める",
    cards: Object.freeze({ "STD-078": 3, "STD-090": 3, "STD-093": 3, "STD-077": 3, "STD-079": 2, "STD-080": 2, "STD-084": 2, "STD-076": 2, "STD-091": 3, "STD-101": 2, "STD-102": 2, "STD-094": 2, "STD-086": 3, "STD-021": 3, "STD-014": 3, "STD-025": 2 }) }),
  Object.freeze({ id: "start-yellow", name: "黄・NOM", color: "黄", userId: "doors_zx", tactic: "セキュリティの壁で受け、壁の数をドローとダメージに変える",
    cards: Object.freeze({ "STD-125": 3, "STD-126": 3, "STD-127": 2, "STD-128": 2, "STD-129": 3, "STD-131": 3, "STD-132": 2, "STD-133": 2, "STD-134": 2, "STD-138": 3, "STD-149": 2, "STD-145": 2, "STD-136": 1, "STD-144": 1, "STD-022": 3, "STD-026": 3, "STD-015": 3 }) }),
  Object.freeze({ id: "start-purple", name: "紫・ヴェンジェンス", color: "紫", userId: "doors_zx", tactic: "前後の移動で誘発を起こし、ドールズで盤面を埋める",
    cards: Object.freeze({ "STD-187": 3, "STD-188": 3, "STD-189": 2, "STD-192": 3, "STD-193": 2, "STD-194": 3, "STD-191": 2, "STD-195": 2, "STD-199": 3, "STD-198": 2, "STD-202": 3, "STD-203": 2, "STD-196": 2, "STD-021": 3, "STD-014": 3, "STD-036": 2 }) }),
  Object.freeze({ id: "start-blue", name: "青・ニュートロン・セキュリティ", color: "青", userId: "doors_zx", tactic: "ハッキングと暗号化で殴りつつ、/…/* Spを使い回す",
    cards: Object.freeze({ "STD-107": 3, "STD-109": 3, "STD-110": 3, "STD-111": 3, "STD-112": 3, "STD-114": 3, "STD-115": 2, "STD-117": 2, "STD-118": 2, "STD-119": 2, "STD-124": 3, "STD-113": 1, "STD-120": 1, "STD-023": 3, "STD-024": 3, "STD-014": 3 }) }),
  Object.freeze({ id: "start-black", name: "黒・破壊誘発", color: "黒", userId: "doors_zx", tactic: "自分のObを壊してログアウトとドローを稼ぎ、デコードで戻す",
    cards: Object.freeze({ "STD-150": 3, "STD-151": 3, "STD-154": 3, "STD-155": 3, "STD-152": 2, "STD-153": 3, "STD-156": 3, "STD-157": 2, "STD-158": 2, "STD-162": 2, "STD-163": 3, "STD-168": 1, "STD-167": 2, "STD-036": 3, "STD-046": 3, "STD-033": 2 }) }),
  Object.freeze({ id: "start-green", name: "緑・インセクト・Script", color: "緑", userId: "doors_zx", tactic: "裏向きの罠を並べ、起動のたびにObが強くなる",
    cards: Object.freeze({ "STD-173": 3, "STD-174": 3, "STD-175": 3, "STD-176": 3, "STD-179": 3, "STD-180": 3, "STD-181": 2, "STD-182": 2, "STD-183": 2, "STD-184": 3, "STD-185": 1, "STD-186": 3, "STD-036": 3, "STD-001": 3, "STD-018": 3 }) }),
  Object.freeze({ id: "start-orange", name: "橙・微橙院", color: "橙", userId: "doors_zx", tactic: "レジストリへの出し入れでダメージとメモリを稼ぐ",
    cards: Object.freeze({ "STD-213": 3, "STD-215": 3, "STD-216": 3, "STD-217": 3, "STD-220": 3, "STD-221": 3, "STD-214": 2, "STD-218": 2, "STD-222": 2, "STD-223": 3, "STD-225": 1, "STD-219": 1, "STD-236": 1, "STD-230": 1, "STD-021": 3, "STD-014": 3, "STD-004": 3 }) }),
]);
