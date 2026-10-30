// STD-129 不屈の守り手 ジョージ
export const definition = {
  "id": "STD-129",
  "name": "不屈の守り手 ジョージ",
  "category": "Ob",
  "color": "黄",
  "cost": 2,
  "atk": 2,
  "str": 1,
  "classes": [
    "ナイツ・オブ・マキナ",
    "ノイド"
  ],
  "text": "[セキュリティ][バックアップ]"
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "intrinsic_keywords", keywords: ["Security", "Backup"] };
