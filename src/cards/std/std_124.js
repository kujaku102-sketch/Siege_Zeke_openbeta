// STD-124 情報蓄積C型素体 シニョーラ
export const definition = {
  "id": "STD-124",
  "name": "情報蓄積C型素体 シニョーラ",
  "category": "Ob",
  "color": "青",
  "cost": 4,
  "atk": 1,
  "str": 1,
  "classes": [
    "ニュートロン・セキュリティ",
    "エレクトロン・フェアリー"
  ],
  "text": "[プロキシ:2]手札に『情報蓄積C型素体 シニョーラ』2枚を生成する。[ログイン]+X/+Xする。この時、Xに応じて以下の効果を起動する。①3以上:カードを2枚引く。②5以上:相手Obすべてをスリープする。③7以上:これは[QA]と[切断]を持つ。④20以上:ゲームに勝利する。（Xはゴミ箱の『情報蓄積C型素体 シニョーラ』の数である）",
  "sourceId": "STD-124",
  "printedCategory": "Ob",
  "cardClass": "ニュートロン・セキュリティ/エレクトロン・フェアリー"
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "proxy_generate_then_login_trash_thresholds", proxy: { generatedCardId: "STD-124", count: 2, destination: "hand" }, login: { statModifier: { atk: "own_trash_same_id_count", str: "own_trash_same_id_count" }, thresholds: [{ minimum: 3, effect: { type: "draw", value: 2 } }, { minimum: 5, effect: { type: "sleep", target: "enemy_ob_all" } }, { minimum: 7, effect: { type: "grant_keywords", target: "source", keywords: ["QA", "Disconnect"] } }, { minimum: 20, effect: { type: "win_game", target: "source_controller" } }] } };
