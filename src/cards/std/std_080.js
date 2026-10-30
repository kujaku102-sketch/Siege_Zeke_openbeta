// STD-080 ジャンクアーマー
export const definition = {
  "id": "STD-080",
  "name": "ジャンクアーマー",
  "category": "Code",
  "color": "赤",
  "cost": 3,
  "classes": [
    "レッドパンクス"
  ],
  "text": "マウントしたObを+0/+2して[セキュリティ]と[プロテクト]を与える。"
};

// mountedStatModifierSpec (was continuous-effect-specs.js)
export const mountedStatModifierSpec = [{ type: "modify_stats", target: "mounted_host", atk: 0, str: 2 }];

// mountedKeywordSpec (was continuous-effect-specs.js)
export const mountedKeywordSpec = [
    { type: "grant_keyword", target: "mounted_host", keyword: "SECURITY" },
    { type: "grant_keyword", target: "mounted_host", keyword: "PROTECT", consumedFlag: "protectConsumed" }
  ];
