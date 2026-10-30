// STD-220 パラレルウィード・ファイター
export const definition = {
  "id": "STD-220",
  "name": "パラレルウィード・ファイター",
  "category": "Ob",
  "color": "橙",
  "cost": 3,
  "atk": 5,
  "str": 3,
  "classes": [],
  "text": "[コンタクト][ログアウト]ゴミ箱に送るかわりにレジストリにインストールする。①レジストリからこれを実行できる。この効果で配置した場合これはユーザーを攻撃できない。"
};

// attackPermissionSpec (was continuous-effect-specs.js)
export const attackPermissionSpec = [{ type: "forbid_target", target: "enemy_user", condition: "source_registry_executed_this_turn" }];
