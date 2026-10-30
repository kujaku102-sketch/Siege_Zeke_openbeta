// STD-227 プロジェクト=インペリアル
export const definition = {
  "id": "STD-227",
  "name": "プロジェクト=インペリアル",
  "category": "Ob",
  "color": "橙",
  "cost": 7,
  "atk": 0,
  "str": 7,
  "classes": [
    "ヴェンジェンス",
    "マスターピース"
  ],
  "text": "[ログイン]または[アップデート:5]相手の手札・エリア・ゴミ箱・山札からランダムに1枚ずつ選びそれぞれを所有ユーザーのレジストリにインストールする。①これはお互いのレジストリにあるカラー1つにつき+1/0する。②これの攻撃宣言時、ATKが7以上なら相手フロントのカード全てを破壊し、破壊したカードの位置に『征服の証』を生成し配置する。"
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "imperial_project", loginAndUpdate: "random_install_from_enemy_hand_area_trash_deck", continuousAtk: "unique_registry_colors", attack: "atk_7_destroy_enemy_front_generate_proof" };
