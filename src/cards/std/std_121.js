// STD-121 情報管理端末X型トリニティ
export const definition = {
  "id": "STD-121",
  "name": "情報管理端末X型トリニティ",
  "category": "Script",
  "printedCategory": "Sc",
  "color": "青",
  "cost": 4,
  "classes": [],
  "text": "[レジデント]このカードを実行する時、名前の異なる「情報管理端末」カード3枚を破壊して設置する。このカードの起動時と各ターン1回目のOb攻撃時、①を起動する。①アクティブユーザーは手札を3枚捨てる。捨てられなかった場合、3ダメージ受ける。その後、カードを2枚引く。",
  "sourceId": "STD-121",
  "atk": null,
  "str": null,
  "cardClass": null
};

// placement cost spec (was card-runtime-specs.js)
export const placementCostSpec = Object.freeze({
    selection: Object.freeze({
      zones: Object.freeze(["front", "back"]), controller: "any", faceUp: true,
      namePrefix: "情報管理端末", count: 3, distinctBy: "name"
    }),
    payment: Object.freeze({ operation: "destroy", allRequired: true })
  });
