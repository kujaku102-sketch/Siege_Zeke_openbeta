// STD-223 異次元ショット
export const definition = {
  "id": "STD-223",
  "name": "異次元ショット",
  "category": "Sp",
  "color": "橙",
  "cost": 3,
  "classes": [],
  "text": "[アンブッシュ:2]（これがレジストリにありこれのメモリ以上のカードがレジストリにある場合、相手Obの攻撃宣言時に指定のメモリを消費し実行できる。[インシデント]による効果起動はその攻撃宣言につき1回しかできない。）①Ob1体に3ダメージ。この効果によるダメージでObを破壊したならカードを1枚引く。"
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "ambush", cost: 2, trigger: "enemy_ob_attack_declared", registryThreshold: "source_original_memory", incidentLimit: "once_per_attack", effect: "damage_ob_3_draw_if_destroyed" };
