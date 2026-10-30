// STD-079 ジャンクエンジン
export const definition = {
  "id": "STD-079",
  "name": "ジャンクエンジン",
  "category": "Code",
  "color": "赤",
  "cost": 2,
  "classes": [
    "レッドパンクス"
  ],
  "text": "マウントしたObを+2/+0して[コンタクト]を与える。"
};

// mountedStatModifierSpec (was continuous-effect-specs.js)
export const mountedStatModifierSpec = [{ type: "modify_stats", target: "mounted_host", atk: 2, str: 0 }];

// mountedKeywordSpec (was continuous-effect-specs.js)
export const mountedKeywordSpec = [{ type: "grant_keyword", target: "mounted_host", keyword: "CONTACT" }];
