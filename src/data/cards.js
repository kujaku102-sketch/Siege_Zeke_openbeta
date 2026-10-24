export const CARD_LIBRARY = Object.freeze({
  "STD-001": {
    "id": "STD-001",
    "name": "マテリアル・スナイプ",
    "category": "Script",
    "color": null,
    "cost": 2,
    "classes": [],
    "text": "[条件:相手がカードを配置した時]Ob以外のカード1枚を破壊する。"
  },
  "STD-002": {
    "id": "STD-002",
    "name": "シャットアウト・プログラム",
    "category": "Script",
    "color": null,
    "cost": 3,
    "classes": [],
    "text": "[条件:攻撃によるダメージを受けた時]相手エリアのOb以外のカードすべてを破壊する。"
  },
  "STD-003": {
    "id": "STD-003",
    "name": "/ゴミ箱を空にする/*",
    "category": "Script",
    "cost": 3,
    "text": "[if:相手のカードがゴミ箱に送られる時]このターン、相手のカードがゴミ箱に送られるならそれをBANする。",
    "classes": []
  },
  "STD-004": {
    "id": "STD-004",
    "name": "増設メモリ",
    "category": "P-in",
    "color": null,
    "cost": null,
    "classes": [],
    "text": "自分のメモリ上限を+1する。"
  },
  "STD-005": {
    "id": "STD-005",
    "name": "違法増設メモリ",
    "category": "P-in",
    "color": null,
    "cost": null,
    "classes": [],
    "text": "自分ターン終了時、自分は2ダメージ受ける。自分のメモリ上限を+2する。"
  },
  "STD-006": {
    "id": "STD-006",
    "name": "ペタクラスドライブ",
    "category": "P-in",
    "color": null,
    "cost": null,
    "classes": [],
    "text": "[DANGER]ターン開始時、カードを1枚引く。ターン終了時、使用可能メモリが0なら2ダメージ受ける。"
  },
  "STD-007": {
    "id": "STD-007",
    "name": "効率化モジュール",
    "category": "P-in",
    "color": null,
    "cost": null,
    "classes": [],
    "text": "ゴミ箱に同じ名称のあるカードを実行する時、その消費メモリを-1する。"
  },
  "STD-008": {
    "id": "STD-008",
    "name": "ジャミングウェイブ",
    "category": "Code",
    "color": null,
    "cost": 4,
    "classes": [],
    "text": "相手の実行メモリを+1する。"
  },
  "STD-009": {
    "id": "STD-009",
    "name": "第一種戦闘配置",
    "category": "Code",
    "color": null,
    "cost": 1,
    "classes": [],
    "text": "[アップデート:2]このターン中、自分のOb全てを+1/0する。"
  },
  "STD-010": {
    "id": "STD-010",
    "name": "リブート",
    "category": "Sp",
    "color": null,
    "cost": 2,
    "classes": [],
    "text": "手札を全て捨てる。その後、捨てた枚数と同じだけカードを引く。"
  },
  "STD-011": {
    "id": "STD-011",
    "name": "キャッシュ・クリアー",
    "category": "Sp",
    "cost": 0,
    "text": "ユーザーまたはカード1枚を選び、それの持つコンポーネントをすべて取り除く。",
    "classes": []
  },
  "STD-012": {
    "id": "STD-012",
    "name": "デフラグ",
    "category": "Sp",
    "color": null,
    "cost": 0,
    "classes": [],
    "text": "プレイヤーを1人選ぶ。そのプレイヤーはゴミ箱を全てデッキにもどす。"
  },
  "STD-013": {
    "id": "STD-013",
    "name": "エクスプローラー",
    "category": "Sp",
    "color": null,
    "cost": 2,
    "classes": [],
    "text": "手札を1枚選び公開する。それと同じクラスを持つカード1枚にアクセスし、それを手札に加える。"
  },
  "STD-014": {
    "id": "STD-014",
    "name": "ハックアンドスラッシュ",
    "category": "Sp",
    "color": null,
    "cost": 2,
    "classes": [],
    "text": "相手Ob1体に3ダメージ。この効果でObを破壊したならカードを1枚引く。"
  },
  "STD-015": {
    "id": "STD-015",
    "name": "ショックガン",
    "category": "Sp",
    "color": null,
    "cost": 2,
    "classes": [],
    "text": "[レスポンス:1]相手Ob1体に2ダメージ。相手ユーザーに1ダメージ。"
  },
  "STD-016": {
    "id": "STD-016",
    "name": "緊急バックアップキット",
    "category": "Code",
    "color": null,
    "cost": 2,
    "text": "これにObがマウントした時①を適用しこれを破壊する。①マウントしたObは[バックアップ]を1得る。カードを1枚引く。",
    "classes": []
  },
  "STD-017": {
    "id": "STD-017",
    "name": "応急手当装置",
    "category": "Code",
    "color": null,
    "cost": 3,
    "text": "これにObがマウントした時①を適用しこれを破壊する。①マウントしたObは[プロテクト]を得て、0/+3する。",
    "classes": []
  },
  "STD-018": {
    "id": "STD-018",
    "name": "Neutron Beam",
    "category": "Script",
    "color": null,
    "cost": 2,
    "text": "[if:相手がObを配置した時]そのObを破壊する。その後、相手は3回復する。",
    "classes": []
  },
  "STD-019": {
    "id": "STD-019",
    "name": "X-ray Shot",
    "category": "Script",
    "color": null,
    "cost": 2,
    "text": "[if:カードを配置した時]そのカードと同じ色の手札1枚を捨て、対象を破壊する。",
    "classes": []
  },
  "STD-020": {
    "id": "STD-020",
    "name": "歩兵",
    "category": "Ob",
    "color": null,
    "cost": 1,
    "atk": 2,
    "str": 2,
    "classes": [
      "連合軍",
      "ノイド"
    ],
    "text": "(効果なし)"
  },
  "STD-021": {
    "id": "STD-021",
    "name": "剣士",
    "category": "Ob",
    "color": null,
    "cost": 2,
    "atk": 3,
    "str": 3,
    "classes": [
      "連合軍",
      "ノイド"
    ],
    "text": "(効果なし)"
  },
  "STD-022": {
    "id": "STD-022",
    "name": "ガードマン",
    "category": "Ob",
    "color": null,
    "cost": 3,
    "atk": 2,
    "str": 4,
    "classes": [
      "連合軍",
      "ノイド"
    ],
    "text": "[セキュリティ] Obが攻撃する時、「セキュリティ」を持つオブジェクトにしか攻撃対象を選択できません。ターン終了時にこれをスリープすることができます。"
  },
  "STD-023": {
    "id": "STD-023",
    "name": "ガンナー",
    "category": "Ob",
    "color": null,
    "cost": 3,
    "atk": 3,
    "str": 3,
    "classes": [
      "連合軍",
      "ノイド"
    ],
    "text": "[ハッキング] これを持つObは相手の[セキュリティ]を持つObを無視して攻撃できます。"
  },
  "STD-024": {
    "id": "STD-024",
    "name": "忍者",
    "category": "Ob",
    "color": null,
    "cost": 3,
    "atk": 4,
    "str": 1,
    "classes": [
      "連合軍",
      "ノイド"
    ],
    "text": "[暗号化]これを持つObは攻撃されません。"
  },
  "STD-025": {
    "id": "STD-025",
    "name": "ライダー",
    "category": "Ob",
    "color": null,
    "cost": 3,
    "atk": 2,
    "str": 3,
    "classes": [
      "連合軍",
      "ノイド"
    ],
    "text": "[QA]これを持つObは配置されたターンに攻撃できます。"
  },
  "STD-026": {
    "id": "STD-026",
    "name": "重装歩兵",
    "category": "Ob",
    "cost": 3,
    "atk": 3,
    "str": 4,
    "classes": [
      "連合軍",
      "ノイド"
    ],
    "text": "[プロテクト:1]"
  },
  "STD-027": {
    "id": "STD-027",
    "name": "道化師",
    "category": "Ob",
    "color": null,
    "cost": 3,
    "atk": 2,
    "str": 6,
    "classes": [
      "連合軍",
      "ノイド"
    ],
    "text": "[デコイ] 相手が効果でカードを選ぶ時、「デコイ」を持つカードしか選べません。"
  },
  "STD-028": {
    "id": "STD-028",
    "name": "騎馬兵",
    "category": "Ob",
    "cost": 3,
    "atk": 5,
    "str": 3,
    "classes": [
      "連合軍",
      "ノイド"
    ],
    "text": "[コンタクト]"
  },
  "STD-029": {
    "id": "STD-029",
    "name": "大英雄",
    "category": "Ob",
    "cost": 5,
    "atk": 5,
    "str": 5,
    "classes": [
      "連合軍",
      "ノイド"
    ],
    "text": "[バックアップ]"
  },
  "STD-030": {
    "id": "STD-030",
    "name": "砲撃部隊",
    "category": "Ob",
    "color": null,
    "cost": 5,
    "atk": 3,
    "str": 3,
    "classes": [
      "連合軍",
      "ノイド"
    ],
    "text": "[ログイン]相手のOb1体と相手ユーザーに3ダメージ。"
  },
  "STD-031": {
    "id": "STD-031",
    "name": "ドラゴン",
    "category": "Ob",
    "color": null,
    "cost": 6,
    "atk": 5,
    "str": 6,
    "classes": [
      "連合軍",
      "ドラゴン"
    ],
    "text": "[QA]これを持ったObは配置されたターンに攻撃できます。このObの攻撃時に相手エリアのObを1体破壊する。"
  },
  "STD-032": {
    "id": "STD-032",
    "name": "辻斬り",
    "category": "Sp",
    "color": null,
    "cost": 2,
    "classes": [],
    "text": "相手のOb1体に3ダメージ。それがスリープしているならさらに3ダメージ。"
  },
  "STD-033": {
    "id": "STD-033",
    "name": "クリティカルチェスト",
    "category": "Sp",
    "color": null,
    "cost": 5,
    "classes": [],
    "text": "相手エリアにあるカード1枚を破壊する。相手に2ダメージ。"
  },
  "STD-034": {
    "id": "STD-034",
    "name": "ショックキャノン",
    "category": "Sp",
    "color": null,
    "cost": 4,
    "classes": [],
    "text": "[レスポンス:3](相手からダメージを受けた時、[レスポンス]を持つカードを手札から指定のメモリを消費して使うことができます。)相手のOb1体に6ダメージ。"
  },
  "STD-035": {
    "id": "STD-035",
    "name": "進軍",
    "category": "Sp",
    "color": null,
    "cost": 5,
    "classes": [],
    "text": "クラス:連合軍Ob2枚にアクセスし、それらを手札に加える。その後、このターン自分のクラス:連合軍Obすべてを+1/0する。"
  },
  "STD-036": {
    "id": "STD-036",
    "name": "キャッシュ・バック",
    "category": "Script",
    "color": null,
    "cost": 1,
    "text": "[if:自分Obが破壊された時]カードを2枚引く。",
    "classes": []
  },
  "STD-037": {
    "id": "STD-037",
    "name": "緊急徴収",
    "category": "Script",
    "color": null,
    "cost": 1,
    "text": "[if:相手のメモリ上限が効果で増加した時]相手のメモリを5消費する。",
    "classes": []
  },
  "STD-038": {
    "id": "STD-038",
    "name": "仮想領域追放",
    "category": "Script",
    "cost": 2,
    "text": "[if:カードが生成された時]生成されたそれらをBANする。",
    "classes": []
  },
  "STD-039": {
    "id": "STD-039",
    "name": "大軍師 メイコウ",
    "category": "Ob",
    "color": null,
    "cost": 6,
    "atk": 1,
    "str": 6,
    "text": "[ファイアウォール]自分が与えるダメージすべてを+1、受けるダメージを-1する。",
    "classes": []
  },
  "STD-040": {
    "id": "STD-040",
    "name": "兵士長 デュース",
    "category": "Ob",
    "color": null,
    "cost": 2,
    "atk": 1,
    "str": 1,
    "classes": [],
    "text": "[ログイン]効果テキストを持たないOb1体にアクセスし、それをスリープしてドラッグする。"
  },
  "STD-041": {
    "id": "STD-041",
    "name": "頼れる先輩軍人 ガゴウ",
    "category": "Ob",
    "color": null,
    "cost": 3,
    "atk": 1,
    "str": 1,
    "text": "自分の効果テキストを持たないObの与えるダメージを+1する。[ログアウト]合計メモリが2以下になるようObを2体までデコードする。",
    "classes": []
  },
  "STD-042": {
    "id": "STD-042",
    "name": "偵察兵 ダイン",
    "category": "Ob",
    "color": null,
    "cost": 1,
    "atk": 1,
    "str": 1,
    "classes": [],
    "text": "[ログイン]効果テキストを持たないOb2枚にアクセスし、それを手札に加える。"
  },
  "STD-043": {
    "id": "STD-043",
    "name": "装甲兵 メルク",
    "category": "Ob",
    "cost": 2,
    "atk": 1,
    "str": 4,
    "text": "[セキュリティ]",
    "classes": []
  },
  "STD-044": {
    "id": "STD-044",
    "name": "突撃散弾銃",
    "category": "Ob",
    "cost": 2,
    "atk": 3,
    "str": 1,
    "text": "[QA]",
    "classes": []
  },
  "STD-045": {
    "id": "STD-045",
    "name": "二刀流剣士 フローレンス",
    "category": "Ob",
    "color": null,
    "cost": 3,
    "atk": 1,
    "str": 1,
    "classes": [
      "連合軍",
      "ノイド"
    ],
    "text": "[ログイン]効果テキストを持たないOb1体にアクセスし、それをドラッグする。"
  },
  "STD-046": {
    "id": "STD-046",
    "name": "博打屋砲兵 アッシュ",
    "category": "Ob",
    "color": null,
    "cost": 3,
    "atk": 1,
    "str": 2,
    "text": "[コンタクト][ログイン]山札の上から3枚をゴミ箱に送る。こうしてゴミ箱に送られたOb1枚につき+1/+1する。",
    "classes": []
  },
  "STD-047": {
    "id": "STD-047",
    "name": "フィクス・インシデント",
    "category": "Sp",
    "color": null,
    "cost": 2,
    "classes": [],
    "text": "[レスポンス:2]クラス:フィクサーOb1体にアクセスし、それを手札に加える。"
  },
  "STD-048": {
    "id": "STD-048",
    "name": "明けの明星",
    "category": "Ob",
    "color": null,
    "cost": 13,
    "atk": 7,
    "str": 6,
    "classes": [
      "エージェント"
    ],
    "text": "[QA][セキュリティ]自分ターン開始時の最初のドローでこれを引いたなら、これをドラッグし、①を起動する。①自分ユーザーを3回復し、カードを1枚引く。[プロキシ:6]これを山札の上に置く。その後、『災いの明星』1体を配置する。"
  },
  "STD-049": {
    "id": "STD-049",
    "name": "宵の明星",
    "category": "Ob",
    "color": null,
    "cost": 13,
    "atk": 6,
    "str": 7,
    "classes": [
      "エージェント"
    ],
    "text": "[切断][ファイアウォール][プロキシ:6]『災いの明星』を配置し、相手エリアのカード1枚を破壊する。相手ターン終了時、エリアの『災いの明星』をすべて破壊することで①を起動する。①相手ユーザーに5ダメージ。これをデコードする。"
  },
  "STD-050": {
    "id": "STD-050",
    "name": "災いの明星",
    "category": "VOb",
    "color": null,
    "cost": 13,
    "atk": 1,
    "str": 1,
    "classes": [
      "エージェント"
    ],
    "text": "[切断][デコイ][アクセス制限][セキュリティ]",
    "token": true
  },
  "STD-075": {
    "id": "STD-075",
    "name": "ジャンキー",
    "category": "Ob",
    "color": "赤",
    "cost": 1,
    "atk": 1,
    "str": 1,
    "classes": [
      "レッドパンクス"
    ],
    "text": "[QA]ターン終了時、このObが攻撃していたら破壊する。"
  },
  "STD-076": {
    "id": "STD-076",
    "name": "こそ泥",
    "category": "Ob",
    "color": "赤",
    "cost": 2,
    "atk": 2,
    "str": 1,
    "text": "[バックアップ]",
    "classes": [
      "レッドパンクス"
    ]
  },
  "STD-077": {
    "id": "STD-077",
    "name": "ジャンカー・サム",
    "category": "Ob",
    "color": "赤",
    "cost": 2,
    "atk": 2,
    "str": 2,
    "classes": [
      "レッドパンクス",
      "ギークス"
    ],
    "text": "[ログイン]このObがマウントしているなら手札の「レッドパンクス」1枚を捨てる。そうしたら、カードを2枚引く。",
    "rulingOverride": "STD-077-R65: 捨てた場合のみ後続ドロー"
  },
  "STD-078": {
    "id": "STD-078",
    "name": "ジャンクパーツ",
    "category": "Code",
    "color": "赤",
    "cost": 1,
    "classes": [
      "レッドパンクス"
    ],
    "text": "マウントしたObを+1/+1する。(このカードは山札に4枚以上入れられる。)"
  },
  "STD-079": {
    "id": "STD-079",
    "name": "ジャンクエンジン",
    "category": "Code",
    "color": "赤",
    "cost": 2,
    "classes": [
      "レッドパンクス"
    ],
    "text": "マウントしたObを+2/+0して[コンタクト]を与える。"
  },
  "STD-080": {
    "id": "STD-080",
    "name": "ジャンクアーマー",
    "category": "Code",
    "color": "赤",
    "cost": 3,
    "classes": [
      "レッドパンクス"
    ],
    "text": "マウントしたObを+0/+2して[セキュリティ]と[プロテクト]を与える。"
  },
  "STD-081": {
    "id": "STD-081",
    "name": "ジェネレーター・ジュン",
    "category": "Ob",
    "color": "赤",
    "cost": 4,
    "atk": 2,
    "str": 2,
    "classes": [
      "レッドパンクス",
      "ギークス"
    ],
    "text": "[ログイン]元々のメモリ合計2以下になるよう任意の枚数のCodeにアクセスし、それをドラッグする。",
    "rulingOverride": "STD-081-R66: 元々のメモリ合計を参照"
  },
  "STD-082": {
    "id": "STD-082",
    "name": "リメイカー・ジェイク",
    "category": "Ob",
    "color": "赤",
    "cost": 3,
    "atk": 3,
    "str": 2,
    "text": "[ログイン]山札の上から1枚をゴミ箱に送る。その後、ゴミ箱からメモリ3以下のCode1枚を配置する。",
    "classes": [
      "レッドパンクス"
    ]
  },
  "STD-083": {
    "id": "STD-083",
    "name": "マシーナリー・ボルツ",
    "category": "Ob",
    "color": "赤",
    "cost": 3,
    "atk": 2,
    "str": 2,
    "text": "[ログイン]マウントしているならクラス:レッドパンクスかつカテゴリ:Lyd-Obを1枚以上2枚まで可能な限りアクセスする。1枚を手札に加え、もう1枚をゴミ箱へ送る。",
    "rulingOverride": "STD-083-R67: 1枚以上2枚まで可能な限り",
    "classes": [
      "レッドパンクス"
    ]
  },
  "STD-084": {
    "id": "STD-084",
    "name": "汎用戦闘装甲ミカヅキ",
    "category": "Ob",
    "color": "赤",
    "cost": 2,
    "atk": 3,
    "str": 4,
    "text": "[セキュリティ]このカードがマウントしていない時、破壊される。",
    "classes": [
      "レッドパンクス"
    ]
  },
  "STD-085": {
    "id": "STD-085",
    "name": "試作合体レッパオー・ゼロ",
    "category": "Ob",
    "color": "赤",
    "cost": 6,
    "atk": 4,
    "str": 4,
    "text": "[レイヤード:レッドパンクスCode1枚以上とノイド1体][QA]攻撃時、レイヤー1枚をゴミ箱へ送り①を起動する。①+2/+0する。解決後、積層全体が1枚以下なら破壊される。",
    "rulingOverride": "STD-085-R72: 効果解決後に積層全体を判定",
    "classes": [
      "レッドパンクス"
    ]
  },
  "STD-086": {
    "id": "STD-086",
    "name": "グレンのラッキー☆ショット",
    "category": "Sp",
    "color": "赤",
    "cost": 2,
    "text": "相手のOb1体に3ダメージ。その後、自分エリアのカード1枚を破壊して①を起動できる。①相手ユーザーに2ダメージ。",
    "classes": []
  },
  "STD-087": {
    "id": "STD-087",
    "name": "とつげき☆おうえん団 グレン",
    "category": "Ob",
    "color": "赤",
    "cost": 4,
    "atk": 1,
    "str": 4,
    "text": "[ログイン]メモリ1以下のObまたはCode1枚にアクセスし、それをドラッグする。自分の赤のカードによるダメージを+1する。",
    "rulingOverride": "STD-087-R73: 対象はObまたはCodeのみ",
    "classes": [
      "レッドパンクス"
    ]
  },
  "STD-088": {
    "id": "STD-088",
    "name": "武装応援団新入部員 ヨシダ",
    "category": "Ob",
    "color": "赤",
    "cost": 1,
    "atk": 2,
    "str": 2,
    "text": "[QA]このカードは実行できない。",
    "classes": [
      "レッドパンクス"
    ]
  },
  "STD-089": {
    "id": "STD-089",
    "name": "ドリル親父",
    "category": "Ob",
    "color": "赤",
    "cost": 3,
    "atk": 1,
    "str": 1,
    "classes": [
      "レッドパンクス"
    ],
    "text": "[ログイン]自分のレイヤーを持つObすべてはこのターン、レイヤー1枚につき+1/0する。"
  },
  "STD-090": {
    "id": "STD-090",
    "name": "サプライヤー・カネコ",
    "category": "Ob",
    "color": "赤",
    "cost": 2,
    "atk": 1,
    "str": 1,
    "classes": [
      "レッドパンクス"
    ],
    "text": "[ログイン]「ジャンクパーツ」1枚にアクセスし、それをドラッグする。"
  },
  "STD-091": {
    "id": "STD-091",
    "name": "切込隊長 アツト",
    "category": "Ob",
    "color": "赤",
    "cost": 2,
    "atk": 3,
    "str": 1,
    "text": "[QA]これは可能であればObを攻撃する。",
    "classes": [
      "レッドパンクス"
    ]
  },
  "STD-092": {
    "id": "STD-092",
    "name": "パンクス",
    "category": "VOb",
    "color": "赤",
    "cost": 1,
    "atk": 1,
    "str": 2,
    "classes": [
      "レッドパンクス",
      "ノイド"
    ],
    "text": "(効果なし)"
  },
  "STD-093": {
    "id": "STD-093",
    "name": "サウンドマン",
    "category": "Ob",
    "color": "赤",
    "cost": 2,
    "atk": 1,
    "str": 1,
    "classes": [
      "レッドパンクス",
      "ノイド"
    ],
    "text": "[ログイン]「パンクス」を1体配置する。"
  },
  "STD-094": {
    "id": "STD-094",
    "name": "変形合体レッパオー・G(ギガント)",
    "category": "Ob",
    "color": "赤",
    "cost": 7,
    "atk": 5,
    "str": 5,
    "classes": [
      "レッドパンクス",
      "オートメイル"
    ],
    "text": "[レイヤード:ノイド1体と1枚以上のレッドパンクス][QA][ログイン]相手フォートレスにXダメージ。XはこのObのレイヤーの数である。",
    "rulingOverride": "STD-094: Xは解決時点の積層全体（自身を含む）の枚数"
  },
  "STD-095": {
    "id": "STD-095",
    "name": "変形合体レッパオー・DS(ドリルスタイル)",
    "category": "Ob",
    "color": "赤",
    "cost": 7,
    "atk": 5,
    "str": 5,
    "classes": [
      "レッドパンクス",
      "オートメイル"
    ],
    "text": "[レイヤード:「変形合体レッパオー」1体とレッドパンクス1枚以上][オーバーライド:2X][コンタクト]攻撃中、+X/+0し、①を得る。①戦闘で破壊したObの元のSTR分のダメージを相手に与える。XはこのObの持つレイヤーの数である。",
    "rulingOverride": "オーバーライドは選択素材の元々のメモリ最大値を実行メモリから自動軽減"
  },
  "STD-096": {
    "id": "STD-096",
    "name": "変形合体レッパオー・GS(ガトリングスタイル)",
    "category": "Ob",
    "color": "赤",
    "cost": 4,
    "atk": 1,
    "str": 5,
    "classes": [
      "レッドパンクス",
      "オートメイル"
    ],
    "text": "[レイヤード:「変形合体レッパオー」1体とレッドパンクス1枚以上][オーバーライド:2X][QA]このObが攻撃する時、レイヤーを1枚破棄することでこれをスタンバイする。"
  },
  "STD-097": {
    "id": "STD-097",
    "name": "変形合体レッパオー・SS(シールドスタイル)",
    "category": "Ob",
    "color": "赤",
    "cost": 4,
    "atk": 5,
    "str": 5,
    "classes": [
      "レッドパンクス",
      "オートメイル"
    ],
    "text": "[レイヤード:「変形合体レッパオー」1体とレッドパンクス1枚以上][オーバーライド:2X][セキュリティ][コンタクト]このObが戦闘する時、レイヤー1枚を破棄して①を起動できる。①受けるダメージを1にする。"
  },
  "STD-098": {
    "id": "STD-098",
    "name": "真・変形合体レッパオーSSS(スーパースタンドバイスタイル)",
    "category": "Ob",
    "color": "赤",
    "cost": 7,
    "atk": 5,
    "str": 10,
    "classes": [
      "レッドパンクス",
      "オートメイル"
    ],
    "text": "[レイヤード:「変形合体レッパオー」1体と2体以上のLyd-Ob][ログイン]このObのレイヤーにしたLyd-Ob1体につき①を起動する。①+2/+0し[QA]を持つ。"
  },
  "STD-099": {
    "id": "STD-099",
    "name": "変形合体レッパオー・RB(リビルド)",
    "category": "Ob",
    "color": "赤",
    "cost": 1,
    "atk": 1,
    "str": 1,
    "classes": [
      "レッドパンクス",
      "オートメイル"
    ],
    "text": "[レイヤード:「変形合体レッパオー」Ob1体とクラス:レッドパンクスのカード1枚以上]①このObは「変形合体レッパオー」Obが破壊される時、手札からメモリを消費せずログインできる。この時、対象Obを破壊するかわりにこのObのレイヤーにする。[ログイン]このObの持つレイヤー1枚につき+1/+1する。",
    "rulingOverride": "破壊置換はバックアップと同じ窓で排他的に選択"
  },
  "STD-100": {
    "id": "STD-100",
    "name": "番長(カシラ)・サスケ",
    "category": "Ob",
    "color": "赤",
    "cost": 12,
    "atk": 8,
    "str": 6,
    "classes": [
      "レッドパンクス",
      "ノイド"
    ],
    "text": "これの実行メモリは名称の異なるエリアのクラス：レッドパンクス1つにつき-1される。[QA][セキュリティ]"
  },
  "STD-101": {
    "id": "STD-101",
    "name": "合吐労(アウトロー)・ライダー シュタイン",
    "category": "Ob",
    "color": "赤",
    "cost": 4,
    "atk": 4,
    "str": 3,
    "classes": [
      "レッドパンクス",
      "ノイド"
    ],
    "text": "「ログイン」「ジャンクエンジン」1枚にアクセスし、それをドラッグする。"
  },
  "STD-102": {
    "id": "STD-102",
    "name": "簡易合体レッパ・ビギニング",
    "category": "Ob",
    "color": "赤",
    "cost": 5,
    "atk": 3,
    "str": 5,
    "classes": [
      "レッドパンクス",
      "オートメイル"
    ],
    "text": "[レイヤード:レッドパンクス1体以上+「ジャンク」カード1枚以上][QA]攻撃時、このObのレイヤー1枚をゴミ箱に送って①を起動できる。①メモリ合計が2になるように、ゴミ箱からObまたはCodeを任意の枚数選び配置する。レイヤーが1枚以下のこのObは破壊される。"
  },
  "STD-103": {
    "id": "STD-103",
    "name": "メンテナンスボーイ",
    "category": "Ob",
    "color": "赤",
    "cost": 2,
    "atk": 2,
    "str": 2,
    "classes": [
      "レッドパンクス",
      "オートメイル"
    ],
    "text": "[ログイン]自分のLyd-Ob1体を選ぶ。そのObのレイヤーに対応するカード1枚をゴミ箱から選び、1番下のレイヤーに加える。"
  },
  "STD-104": {
    "id": "STD-104",
    "name": "緊急合体要請",
    "category": "Sp",
    "color": "赤",
    "cost": 5,
    "classes": [],
    "text": "手札のLyd-Ob1枚を公開し、そのObのレイヤーに対応したカード1枚にアクセスし、手札に加える。この効果で公開し続けている限り、そのObを配置するために消費するメモリは1になる。"
  },
  "STD-105": {
    "id": "STD-105",
    "name": "緊急発進指令",
    "category": "Script",
    "color": "赤",
    "cost": 3,
    "text": "相手がフォートレスを攻撃する時起動できる。手札のLyd-Ob1体をメモリを支払わず強制実行する。この効果でログインしたObはスリープして[セキュリティ]を得、次のターン終了時に破壊される。",
    "classes": []
  },
  "STD-106": {
    "id": "STD-106",
    "name": "烈火の重武装特攻車(ファイアタンカー・レッカー)",
    "category": "LOb",
    "color": "赤",
    "cost": 6,
    "atk": 6,
    "str": 6,
    "classes": [
      "レッドパンクス",
      "ビルダー"
    ],
    "text": "[レイヤード:レッドパンクスOb1体とオートメイル1枚]攻撃時、『ジャンクパーツ』2枚を配置する。[プロキシ:2]『ジャンクパーツ』1枚を配置する。"
  },
  "STD-107": {
    "id": "STD-107",
    "name": "解析用素体A型 ルチル",
    "category": "Ob",
    "color": "青",
    "cost": 1,
    "atk": 1,
    "str": 1,
    "classes": [
      "ニュートロン・セキュリティ",
      "エレクトロン・フェアリー"
    ],
    "text": "[ログイン]「/」から始まり「/*」で終わる名称を持つSp1枚にアクセスし、それを手札に加える。",
    "sourceId": "STD-107",
    "printedCategory": "Ob",
    "cardClass": null
  },
  "STD-108": {
    "id": "STD-108",
    "name": "末端エンジニア",
    "category": "Ob",
    "color": "青",
    "cost": 2,
    "atk": 1,
    "str": 2,
    "classes": [],
    "text": "[ログイン]エレクトロンフェアリー1枚にアクセスし、それを手札に加える。",
    "sourceId": "STD-108",
    "printedCategory": "Ob",
    "cardClass": null
  },
  "STD-109": {
    "id": "STD-109",
    "name": "警戒機用素体S型 フラウ",
    "category": "Ob",
    "color": "青",
    "cost": 2,
    "atk": 2,
    "str": 2,
    "classes": [
      "ニュートロン・セキュリティ",
      "エレクトロン・フェアリー"
    ],
    "text": "このObが[ハッキング]または[暗号化]を持っている間、+1/+1する。",
    "sourceId": "STD-109",
    "printedCategory": "Ob"
  },
  "STD-110": {
    "id": "STD-110",
    "name": "/セキュリティウォール/*",
    "category": "Sp",
    "color": "青",
    "cost": 1,
    "classes": [],
    "text": "次のターン終了時まで、自分のObすべては[暗号化]を持つ。",
    "sourceId": "STD-110",
    "printedCategory": "Sp",
    "atk": null,
    "str": null
  },
  "STD-111": {
    "id": "STD-111",
    "name": "/オフェンスプロトコル/*",
    "category": "Sp",
    "color": "青",
    "cost": 2,
    "classes": [],
    "text": "自分のOb1体はこのターン+1/+0され[ハッキング]を持つ。",
    "sourceId": "STD-111",
    "printedCategory": "Sp",
    "atk": null,
    "str": null
  },
  "STD-112": {
    "id": "STD-112",
    "name": "観測機用素体F型 ネージュ",
    "category": "Ob",
    "color": "青",
    "cost": 3,
    "atk": 2,
    "str": 3,
    "classes": [
      "ニュートロン・セキュリティ",
      "エレクトロン・フェアリー"
    ],
    "text": "[暗号化]自分の[ハッキング]を持つObがユーザーに攻撃する時、カードを1枚引く。",
    "sourceId": "STD-112",
    "printedCategory": "Ob"
  },
  "STD-113": {
    "id": "STD-113",
    "name": "ビッグシスター",
    "category": "Ob",
    "color": "青",
    "cost": 5,
    "atk": 1,
    "str": 5,
    "classes": [
      "ニュートロン・セキュリティ",
      "ビルダー"
    ],
    "text": "[ログイン]と自分ターン開始時、手札からメモリ2以下のエレクトロンフェアリー1体を配置する。",
    "sourceId": "STD-113",
    "printedCategory": "Ob",
    "cardClass": "ニュートロン・セキュリティ/ビルダー"
  },
  "STD-114": {
    "id": "STD-114",
    "name": "戦闘用素体F型 ライラ",
    "category": "Ob",
    "color": "青",
    "cost": 3,
    "atk": 2,
    "str": 4,
    "classes": [
      "ニュートロン・セキュリティ",
      "エレクトロン・フェアリー"
    ],
    "text": "[ハッキング]攻撃時、他の自分のOb1体に[ハッキング]を与える。",
    "sourceId": "STD-114",
    "printedCategory": "Ob",
    "cardClass": null
  },
  "STD-115": {
    "id": "STD-115",
    "name": "戦闘支援機J型 吹雪",
    "category": "Ob",
    "color": "青",
    "cost": 4,
    "atk": 1,
    "str": 5,
    "classes": [],
    "text": "[デコイ]自分のエレクトロンフェアリー全ては[暗号化]を得る。",
    "sourceId": "STD-115",
    "printedCategory": "Ob",
    "cardClass": null
  },
  "STD-116": {
    "id": "STD-116",
    "name": "/アサルトプログラム/*",
    "category": "Sp",
    "color": "青",
    "cost": 5,
    "classes": [],
    "text": "このターン、自分のエレクトロンフェアリーは[ハッキング]と「ユーザーへの攻撃成功時、カードを1枚引き相手に1ダメージ。」を得る。",
    "sourceId": "STD-116",
    "printedCategory": "Sp",
    "atk": null,
    "str": null,
    "cardClass": null
  },
  "STD-117": {
    "id": "STD-117",
    "name": "次世代試作素体Δ型 漣",
    "category": "Ob",
    "color": "青",
    "cost": 6,
    "atk": 5,
    "str": 3,
    "classes": [
      "ニュートロン・セキュリティ",
      "エレクトロン・フェアリー"
    ],
    "text": "[バックアップ]攻撃時、ゴミ箱からSpまたはクラス:エレクトロンフェアリー1枚をサルベージする。フロントにある時①を、バックにある時②をそれぞれ適用する。①[ハッキング]②自分の青のOb全ては[暗号化]。",
    "sourceId": "STD-117",
    "printedCategory": "Ob",
    "cardClass": null
  },
  "STD-118": {
    "id": "STD-118",
    "name": "情報管理端末Ⅰ型バベル",
    "category": "Script",
    "printedCategory": "Sc",
    "color": "青",
    "cost": 3,
    "classes": [],
    "text": "[レジデント]各ターン1度、「/」で始まり「/*」で終わるSpを起動した時、そのSpをゴミ箱に置くかわりに手札に加える。",
    "sourceId": "STD-118",
    "atk": null,
    "str": null,
    "cardClass": null
  },
  "STD-119": {
    "id": "STD-119",
    "name": "情報管理端末Ⅱ型ソドム",
    "category": "Script",
    "printedCategory": "Sc",
    "color": "青",
    "cost": 3,
    "classes": [],
    "text": "[レジデント]各ターン1度、「/」で始まり「/*」で終わるSpを起動した時、相手エリアのObすべてに[負荷]を1与える。",
    "sourceId": "STD-119",
    "atk": null,
    "str": null,
    "cardClass": null
  },
  "STD-120": {
    "id": "STD-120",
    "name": "情報管理端末Ⅲ型ゴモラ",
    "category": "Script",
    "printedCategory": "Sc",
    "color": "青",
    "cost": 3,
    "classes": [],
    "text": "[レジデント]各ターン1度、Spを起動した時①を起動する。①「/」で始まり「/*」で終わるメモリ2以下のSp1枚をゴミ箱から起動し、それをデッキに戻す。",
    "sourceId": "STD-120",
    "atk": null,
    "str": null,
    "cardClass": null
  },
  "STD-121": {
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
  },
  "STD-122": {
    "id": "STD-122",
    "name": "/技術の地平線/*",
    "category": "Sp",
    "color": "青",
    "cost": 3,
    "classes": [],
    "text": "自分エリアのクラス:エレクトロンフェアリーを任意の数破壊して①を起動する。①「技術地平のゴースト」2体を配置する。これらのObを+X/+Xする。Xはゴミ箱にある破壊したObと同じ名称のカードの枚数x2である。",
    "sourceId": "STD-122",
    "printedCategory": "Sp",
    "atk": null,
    "str": null,
    "cardClass": null
  },
  "STD-123": {
    "id": "STD-123",
    "name": "技術地平のゴースト",
    "category": "Ob",
    "color": "青",
    "cost": 1,
    "atk": 0,
    "str": 0,
    "classes": [
      "ヴァーチャルファントム"
    ],
    "text": "(STR0以下のObは破壊される。)このObのATKが5以上の時、[QA]と[ハッキング]を得る。",
    "sourceId": "STD-123",
    "printedCategory": "VOb",
    "cardClass": "ヴァーチャルファントム",
    "token": true
  },
  "STD-124": {
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
  },
  "STD-125": {
    "id": "STD-125",
    "name": "大盾の騎士",
    "category": "Ob",
    "color": "黄",
    "cost": 1,
    "atk": 1,
    "str": 1,
    "classes": [
      "ナイツ・オブ・マキナ",
      "ノイド"
    ],
    "text": "[セキュリティ][ログイン][OC+4]カードを2枚引く。+2/2する。"
  },
  "STD-126": {
    "id": "STD-126",
    "name": "聖機構騎士団の伝令",
    "category": "Ob",
    "color": "黄",
    "cost": 2,
    "atk": 1,
    "str": 3,
    "classes": [
      "ナイツ・オブ・マキナ",
      "ノイド"
    ],
    "text": "[セキュリティ][ログイン]他に「セキュリティ」を持つObが自分エリアにいるなら、カードを1枚引く。"
  },
  "STD-127": {
    "id": "STD-127",
    "name": "兵長 不殺のレオ",
    "category": "Ob",
    "color": "黄",
    "cost": 3,
    "atk": 3,
    "str": 6,
    "classes": [
      "ナイツ・オブ・マキナ",
      "ノイド"
    ],
    "text": "[セキュリティ]このObがObとの戦闘で与えるダメージは0になる。"
  },
  "STD-128": {
    "id": "STD-128",
    "name": "歯車の守り手 ジョン",
    "category": "Ob",
    "color": "黄",
    "cost": 3,
    "atk": 2,
    "str": 2,
    "classes": [
      "ナイツ・オブ・マキナ",
      "ノイド"
    ],
    "text": "[ログイン]「ナイツ・オブ・マキナ」Ob1体にアクセスし、それを手札に加える。[OC+2]さらに、メモリ6以上・黃のOb1体にアクセスしそれを手札に加える。"
  },
  "STD-129": {
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
  },
  "STD-130": {
    "id": "STD-130",
    "name": "潔白の守り手 代理人のイサク",
    "category": "Ob",
    "color": "黄",
    "cost": 4,
    "atk": 3,
    "str": 1,
    "classes": [
      "ナイツ・オブ・マキナ",
      "ノイド"
    ],
    "text": "[セキュリティ][デコイ]戦闘するとき、+0/+Xする。Xは自分エリアの「ナイツ・オブ・マキナ」Obの数である。"
  },
  "STD-131": {
    "id": "STD-131",
    "name": "「華守り」",
    "category": "Ob",
    "color": "黄",
    "cost": 3,
    "atk": 1,
    "str": 3,
    "classes": [
      "ニュートロン・セキュリティ",
      "ビルダー"
    ],
    "text": "[セキュリティ][ログアウト]「華守り」1体を手札からドラッグする。"
  },
  "STD-132": {
    "id": "STD-132",
    "name": "「火除け」",
    "category": "Ob",
    "color": "黄",
    "cost": 3,
    "atk": 1,
    "str": 4,
    "text": "[レスポンス:3][セキュリティ]",
    "classes": []
  },
  "STD-133": {
    "id": "STD-133",
    "name": "栄光の騎士　セフィラ",
    "category": "Ob",
    "color": "黄",
    "cost": 5,
    "atk": 4,
    "str": 3,
    "classes": [
      "ナイツ・オブ・マキナ",
      "ノイド"
    ],
    "text": "[QA][ログイン]自分エリアの[セキュリティ]1体につきカードを1枚引く。"
  },
  "STD-134": {
    "id": "STD-134",
    "name": "騎士団長 不敗のアークツルス",
    "category": "Ob",
    "color": "黄",
    "cost": 7,
    "atk": 4,
    "str": 6,
    "classes": [
      "ナイツ・オブ・マキナ",
      "ノイド"
    ],
    "text": "[ログイン]次のターン、相手のObすべては攻撃しなければならない。自分の[セキュリティ]を持つObが攻撃された時、相手ユーザーに2ダメージ。"
  },
  "STD-135": {
    "id": "STD-135",
    "name": "不知死のシーグ",
    "category": "Ob",
    "color": "黄",
    "cost": 6,
    "atk": 1,
    "str": 1,
    "text": "[セキュリティ][ログアウト]ターン終了時、ゴミ箱のこのObを前線に配置する。",
    "classes": [
      "ナイツ・オブ・マキナ",
      "ノイド"
    ]
  },
  "STD-136": {
    "id": "STD-136",
    "name": "「破華守り」",
    "category": "Ob",
    "color": "黄",
    "cost": 8,
    "atk": 4,
    "str": 8,
    "text": "[コンタクト]このObの攻撃宣言時、自分の他のObを破壊してこのObをスタンバイできる。このObと戦闘したObは次の相手のターンの始めにスタンバイしない。",
    "classes": []
  },
  "STD-137": {
    "id": "STD-137",
    "name": "騎士団の凱歌",
    "category": "Sp",
    "color": "黄",
    "cost": 4,
    "text": "①または②のうち1つを選び起動する。①次のターン終了時まで、自分のObすべてを+2/+2する。②メモリX以下の「ナイツ・オブ・マキナ」1体をデコードする。Xは相手と自分のライフの差分である。",
    "classes": []
  },
  "STD-138": {
    "id": "STD-138",
    "name": "シールドバッシュ",
    "category": "Sp",
    "color": "黄",
    "cost": 2,
    "text": "相手Ob1体にXダメージ。Xは自分エリアにある[セキュリティ]の数+1である。",
    "classes": []
  },
  "STD-139": {
    "id": "STD-139",
    "name": "聖樹枝片(セフィラビット)",
    "category": "Script",
    "color": "黄",
    "cost": null,
    "classes": [],
    "text": "[レジデント][if:いずれかのユーザーのターン開始時]①自分のOb1体はこのターン、-2/+1され［セキュリティ］を得る。[アップデート:2]①か②を起動する。②これを破壊し、[レジデント]を持つScript1枚にアクセスしそれを手札に加える。",
    "setupCost": 1,
    "activationCost": 0,
    "printedCost": "1-0"
  },
  "STD-140": {
    "id": "STD-140",
    "name": "聖樹枝(セフィラリンク)",
    "category": "Script",
    "color": "黄",
    "cost": null,
    "classes": [],
    "text": "[レジデント][if:Obの戦闘時]①自分のOb1体はこのターン、-2/0され戦闘でのダメージを受けない。[アップデート:2]①か②を起動する。②『聖樹枝』以外の「聖樹」カード1枚をサルベージする。",
    "setupCost": 2,
    "activationCost": 0,
    "printedCost": "2-0"
  },
  "STD-141": {
    "id": "STD-141",
    "name": "聖樹枝束(セフィラフォルダ)",
    "category": "Script",
    "color": "黄",
    "cost": null,
    "classes": [],
    "text": "[レジデント]各ターン終了時、このターン中に破壊された「聖樹」Scriptの数によりいずれかの効果を適用する。①2枚:「聖樹」カード2枚にアクセスし、1枚を手札に加え、残りをゴミ箱に送る。②3枚以上:「聖樹」カード3枚にアクセスし、うち1枚を自分エリアに設置する。残りはゴミ箱に送る。③5枚以上:手札から黄のOb1体を配置する。",
    "setupCost": 3,
    "activationCost": 0,
    "printedCost": "3-0"
  },
  "STD-142": {
    "id": "STD-142",
    "name": "聖樹枝塊(セフィラクラスタ)",
    "category": "Script",
    "color": "黄",
    "cost": 2,
    "classes": [],
    "text": "各ターン1度、①を起動できる。①【2】手札またはゴミ箱から「聖樹」Script1枚を配置する。この効果で配置したカードの効果はこのターン起動できない。各ターン終了時、このカードを破壊して②を起動できる。②任意の数だけ「聖樹 」カードを破壊する。その後、破壊した枚数以下だけScriptをサルベージする。"
  },
  "STD-143": {
    "id": "STD-143",
    "name": "叛逆の機械螺子",
    "category": "Sp",
    "color": "黄",
    "cost": 5,
    "classes": [],
    "text": "[レスポンス:6]相手Obすべてをスリープする。このSpを相手ターンに起動したなら、カードを2枚引く。"
  },
  "STD-144": {
    "id": "STD-144",
    "name": "「夜叉しさ」",
    "category": "Ob",
    "color": "黄",
    "cost": 3,
    "atk": 1,
    "str": 1,
    "classes": [],
    "text": "[セキュリティ][ログイン]自分のライフが相手より少ないなら、メモリ上限を+1する。"
  },
  "STD-145": {
    "id": "STD-145",
    "name": "補給部隊長 ヤハブ",
    "category": "Ob",
    "color": "黄",
    "cost": 5,
    "atk": 3,
    "str": 3,
    "classes": [],
    "text": "[セキュリティ][ログアウト]メモリ上限を+1する。"
  },
  "STD-146": {
    "id": "STD-146",
    "name": "祝福の援軍",
    "category": "Sp",
    "color": "黄",
    "cost": 4,
    "text": "ゴミ箱から元々のメモリがX未満のOb1体をデコードする。Xはゴミ箱の「ナイツ・オブ・マキナ」および[セキュリティ]を持つカードの合計枚数である。",
    "rulingOverride": "STD-146: NOMとSecurityの和をX、元メモリX未満のObをゴミ箱からデコード",
    "classes": []
  },
  "STD-147": {
    "id": "STD-147",
    "name": "機械螺子の山",
    "category": "Script",
    "color": "黄",
    "cost": 3,
    "classes": [],
    "text": "[レジデント]「if;ダメージを受けた時起動できる」自分がダメージを受けた時、メモリを1回復する。"
  },
  "STD-148": {
    "id": "STD-148",
    "name": "機械螺子の束",
    "category": "Script",
    "color": "黄",
    "cost": 2,
    "text": "[レジデント][if:相手ターン開始時]相手ターン中、自分Obが戦闘する時相手に1ダメージ。",
    "classes": []
  },
  "STD-149": {
    "id": "STD-149",
    "name": "祈る力",
    "category": "Sp",
    "color": "黄",
    "cost": 2,
    "classes": [],
    "text": "自分ライフを2回復し、カードを1枚引く。"
  },
  "STD-150": {
    "id": "STD-150",
    "name": "怨念人形",
    "category": "Ob",
    "color": "黒",
    "cost": 1,
    "atk": 1,
    "str": 1,
    "classes": [
      "サーヴァント"
    ],
    "text": "[ログアウト]相手のランダムなOb1体に1ダメージ。"
  },
  "STD-151": {
    "id": "STD-151",
    "name": "炸裂ガール",
    "category": "Ob",
    "color": "黒",
    "cost": 2,
    "atk": 1,
    "str": 1,
    "classes": [
      "サーヴァント"
    ],
    "text": "[ログアウト]相手の手札を1枚ランダムに捨てさせる。"
  },
  "STD-152": {
    "id": "STD-152",
    "name": "ゾンビメイカー",
    "category": "Ob",
    "color": "黒",
    "cost": 3,
    "atk": 1,
    "str": 2,
    "classes": [
      "ウィザード"
    ],
    "text": "[ログイン]または[アップデート:2]メモリ2以下のOb1体をデコードする。そのObはこのターン終了時に破壊される。"
  },
  "STD-153": {
    "id": "STD-153",
    "name": "クロード・メル",
    "category": "Ob",
    "color": "黒",
    "cost": 3,
    "atk": 2,
    "str": 4,
    "classes": [
      "オーバーロード"
    ],
    "text": "[ログイン][ログアウト]相手のOb1体に[負荷]を2つ与える。"
  },
  "STD-154": {
    "id": "STD-154",
    "name": "不屈マンドラゴラ",
    "category": "Ob",
    "color": "黒",
    "cost": 2,
    "atk": 1,
    "str": 1,
    "classes": [
      "イモータルス"
    ],
    "text": "このカードがエリアからゴミ箱に置かれた次ターン開始時、ゴミ箱のこのカードをスリープして配置する。"
  },
  "STD-155": {
    "id": "STD-155",
    "name": "執念のコンキスタドール",
    "category": "Ob",
    "color": "黒",
    "cost": 2,
    "atk": 1,
    "str": 3,
    "classes": [
      "イモータルス"
    ],
    "text": "[ログイン]自分のOb1体を破壊して①を起動できる。①カードを2枚引く。"
  },
  "STD-156": {
    "id": "STD-156",
    "name": "豹頭男爵フラウロス",
    "category": "Ob",
    "color": "黒",
    "cost": 3,
    "atk": 5,
    "str": 3,
    "classes": [
      "ゴエティア",
      "オーバーロード"
    ],
    "text": "[ログアウト]①②いずれかを選んで起動する。①自分ユーザーを3回復②これと名称の異なるメモリ3以下のOb1体をデコードする。"
  },
  "STD-157": {
    "id": "STD-157",
    "name": "魔術王ソロモン",
    "category": "Ob",
    "color": "黒",
    "cost": 2,
    "atk": 1,
    "str": 2,
    "classes": [
      "ゴエティア",
      "ウィザード"
    ],
    "text": "[ログイン]または[アップデート:3]自分エリアの他のカード1枚を選び①を起動する。①対象カードを破壊しメモリX以下の黒のOb1体を手札から配置する。Xは対象カードの元々のメモリである。"
  },
  "STD-158": {
    "id": "STD-158",
    "name": "断章・レメゲトン",
    "category": "Code",
    "color": "黒",
    "cost": 3,
    "classes": [
      "ゴエティア"
    ],
    "text": "このカードは名称を「レメゲトン」としても扱う。[ログイン]または自分ターン開始時、黒のOb1体にアクセスしそれを手札に加える。[ログアウト]次のターン開始時、ゴミ箱のこのカードを手札に加える。"
  },
  "STD-159": {
    "id": "STD-159",
    "name": "死ねない男 ジーク",
    "category": "Ob",
    "color": "黒",
    "cost": 5,
    "atk": 1,
    "str": 1,
    "classes": [
      "イモータルス"
    ],
    "text": "このObは破壊できない。Obが破壊されるたび、このターン中+1/0する。"
  },
  "STD-160": {
    "id": "STD-160",
    "name": "クトゥルフ(実際のカード表記では━━)",
    "category": "Ob",
    "color": "黒",
    "cost": 18,
    "atk": 6,
    "str": 6,
    "classes": [
      "旧支配者"
    ],
    "text": "[プロキシ:2]これをエリアに配置し破壊する。その後、「旧支配者」Script1枚にアクセスしそれを山札の上に置く。[ログイン]相手Obすべてとユーザーに「狂気カウンター」を3つ与える。自分ターン開始時、相手ユーザーに「狂気カウンター」を1つ与える。"
  },
  "STD-161": {
    "id": "STD-161",
    "name": "狂気カウンター",
    "category": "説明",
    "color": "黒",
    "text": "狂気カウンターを置かれたObまたはユーザーは置かれた時とそのユーザーのターン開始時にカウンター1つにつき1d6を行い、その出目がXを超えた場合BANされる。Xは「その対象の元々のSTR+15」である。",
    "classes": []
  },
  "STD-162": {
    "id": "STD-162",
    "name": "リィンカーネーション",
    "category": "Sp",
    "color": "黒",
    "cost": 2,
    "text": "自分Ob1体を破壊する。その後、元々のメモリ合計がX以下になるよう任意の枚数のObをサルベージする。Xはこうして破壊処理を行ったObの元々のSTR値である。",
    "classes": []
  },
  "STD-163": {
    "id": "STD-163",
    "name": "邪神との取引",
    "category": "Sp",
    "color": "黒",
    "cost": 2,
    "classes": [],
    "text": "自分のObを好きな数破壊する。こうして破壊したOb一体につき①または②を1回起動する。①カードを2枚引く。②相手のOb一体に3ダメージを与える。"
  },
  "STD-164": {
    "id": "STD-164",
    "name": "デス・キル・サツ・ゾーン",
    "category": "Script",
    "color": "黒",
    "cost": 4,
    "classes": [],
    "text": "[レジデント]自分のターン中、自分のカードが破壊される度、①または②を1つ選び起動する。①相手は自身の手札を1枚捨てる。②相手のOb1体を選び毒カウンターを2つ置く。"
  },
  "STD-165": {
    "id": "STD-165",
    "name": "旧支配者の呼び声",
    "category": "Script",
    "color": "黒",
    "cost": 6,
    "text": "[レジデント]カードが破壊された時、それがこのターン4体目以降ならこのカードを破壊してゴミ箱または手札のカテゴリ:旧支配者Ob1体をメモリを消費せずログインさせる。",
    "classes": []
  },
  "STD-166": {
    "id": "STD-166",
    "name": "冒涜的な歌",
    "category": "Sp",
    "color": "黒",
    "cost": 3,
    "text": "自分エリアにクラス:旧支配者Obがあるなら、相手ユーザーに狂気カウンターを1つ置く。",
    "classes": []
  },
  "STD-167": {
    "id": "STD-167",
    "name": "呪詛返し",
    "category": "Sp",
    "color": "黒",
    "cost": 1,
    "classes": [],
    "text": "[レスポンス:2]このターン自分の受けたダメージ未満のSTRを持つOb1体を選びそれを破壊する。"
  },
  "STD-168": {
    "id": "STD-168",
    "name": "毒の蔓延",
    "category": "Script",
    "color": "黒",
    "cost": 3,
    "text": "[レジデント]Obが破壊されるたび①を起動する。①ユーザーまたはOb1体を選び、それに[負荷]を1つ与える。",
    "classes": []
  },
  "STD-169": {
    "id": "STD-169",
    "name": "怠惰侯爵ベルフェゴル",
    "category": "Ob",
    "color": "黒",
    "cost": 5,
    "atk": 1,
    "str": 6,
    "classes": [
      "ｗｗｗ"
    ],
    "text": "[プロキシ:3]相手Ob1体を選び、それに[負荷]を3つ与える。このObの戦闘時、相手Obに[負荷]を2つ与える。"
  },
  "STD-170": {
    "id": "STD-170",
    "name": "冒涜的な狂信者",
    "category": "Ob",
    "color": "黒",
    "cost": 2,
    "atk": 0,
    "str": 1,
    "text": "[アップデート:4]いずれかのカードをランダムに生成し配置する。●『旧支配者の呼び声』●『冒涜の聖母像』●『穢れたもの』",
    "classes": []
  },
  "STD-171": {
    "id": "STD-171",
    "name": "冒涜の聖母像",
    "category": "VOb",
    "color": "黒",
    "cost": 5,
    "atk": 1,
    "str": 5,
    "classes": [],
    "text": "[切断]カードが破壊される度、これの所持ユーザーはカードを1枚引く。"
  },
  "STD-172": {
    "id": "STD-172",
    "name": "穢れたもの",
    "category": "VOb",
    "color": "黒",
    "cost": 1,
    "atk": 1,
    "str": 1,
    "token": true,
    "text": "[ログアウト]お互いのエリアか手札からランダムに1枚ずつBANする。",
    "classes": []
  },
  "STD-173": {
    "id": "STD-173",
    "name": "知らせ虫",
    "category": "Ob",
    "color": "緑",
    "cost": 1,
    "atk": 1,
    "str": 1,
    "classes": [],
    "text": "[ログイン]設置コスト1以下のScript1枚にアクセスし、それを手札に加える。",
    "traits": [
      "インセクト"
    ]
  },
  "STD-174": {
    "id": "STD-174",
    "name": "警戒虫",
    "category": "Ob",
    "color": "緑",
    "cost": 2,
    "atk": 2,
    "str": 2,
    "classes": [],
    "text": "1ターンに1度、Scriptを起動した時に①を起動する。①+1/+0してこのObをスタンバイする。",
    "traits": [
      "インセクト"
    ]
  },
  "STD-175": {
    "id": "STD-175",
    "name": "ピューパ・ゼクター",
    "category": "Ob",
    "color": "緑",
    "cost": 3,
    "atk": 2,
    "str": 3,
    "classes": [],
    "text": "[セキュリティ]インセクトが破壊された時、ゴミ箱からScriptをサルベージする。",
    "traits": [
      "インセクト"
    ]
  },
  "STD-176": {
    "id": "STD-176",
    "name": "蜂の大群",
    "category": "Script",
    "printedCategory": "Sc",
    "color": "緑",
    "cost": 0,
    "setupCost": 1,
    "activationCost": 0,
    "classes": [],
    "text": "相手ターン開始時に起動する。次のターン終了時まで、自分のObすべては[切断]を持つ。",
    "traits": [
      "インセクト"
    ]
  },
  "STD-177": {
    "id": "STD-177",
    "name": "甲虫の突撃",
    "category": "Sc",
    "printedCategory": "Sc",
    "color": "緑",
    "cost": 44197,
    "classes": [],
    "text": "自分のObが戦闘する時、そのObを次のターン終了時まで+2/+2する。",
    "setupCost": 1,
    "activationCost": 1,
    "printedCost": "1-1",
    "traits": [
      "インセクト"
    ]
  },
  "STD-178": {
    "id": "STD-178",
    "name": "ムカデの隊列",
    "category": "Sc",
    "printedCategory": "Sc",
    "color": "緑",
    "cost": 44199,
    "classes": [],
    "text": "1ターンに1度①を起動できる。①Obが攻撃する時、次のターン終了時まで自分のObすべてを+2/+2して[セキュリティ]を与える。",
    "setupCost": 1,
    "activationCost": 3,
    "printedCost": "1-3",
    "traits": [
      "インセクト"
    ]
  },
  "STD-179": {
    "id": "STD-179",
    "name": "噛みつきバッタ",
    "category": "Ob",
    "color": "緑",
    "cost": 2,
    "atk": 1,
    "str": 3,
    "classes": [],
    "text": "自分のScriptが起動した時、手札からこのObを配置できる。",
    "traits": [
      "インセクト"
    ]
  },
  "STD-180": {
    "id": "STD-180",
    "name": "コクーン・ゼクター",
    "category": "Ob",
    "color": "緑",
    "cost": 3,
    "atk": 2,
    "str": 4,
    "classes": [],
    "text": "[ログイン]インセクト1枚にアクセスし、それを手札に加える。インセクトのログイン時、相手Obに2ダメージ。",
    "traits": [
      "インセクト"
    ]
  },
  "STD-181": {
    "id": "STD-181",
    "name": "鉄甲カブト虫",
    "category": "Ob",
    "color": "緑",
    "cost": 3,
    "atk": 5,
    "str": 5,
    "text": "このObはScを起動したターンのみ攻撃できる。",
    "classes": [],
    "traits": [
      "インセクト"
    ]
  },
  "STD-182": {
    "id": "STD-182",
    "name": "大王サソリ",
    "category": "Ob",
    "color": "緑",
    "cost": 5,
    "atk": 5,
    "str": 5,
    "text": "[レスポンス:5][コンタクト][ログイン]手札から設置メモリ2以下のScript1枚を設置する。攻撃時、起動メモリ2以下の自分のScript1枚を起動できる。",
    "classes": [],
    "traits": [
      "インセクト"
    ]
  },
  "STD-183": {
    "id": "STD-183",
    "name": "モルフォ・ゼクター",
    "category": "Ob",
    "color": "緑",
    "cost": 6,
    "atk": 4,
    "str": 6,
    "classes": [],
    "text": "自分のScriptが起動した時またはインセクトが効果で配置された時、相手フォートレスに2ダメージ。",
    "traits": [
      "インセクト"
    ]
  },
  "STD-184": {
    "id": "STD-184",
    "name": "爆弾セミ",
    "category": "Ob",
    "color": "緑",
    "cost": 3,
    "atk": 3,
    "str": 3,
    "setupCost": 3,
    "activationCost": 0,
    "text": "3-0のScript扱いで設置できる。(Script時の効果:Obのログイン時、このカードをObとして配置できる。)",
    "classes": [],
    "traits": [
      "インセクト"
    ]
  },
  "STD-185": {
    "id": "STD-185",
    "name": "クワガタ将軍",
    "category": "Ob",
    "color": "緑",
    "cost": 7,
    "atk": 5,
    "str": 9,
    "text": "[QA]自分のインセクトが戦闘する時、かわりにこのObと戦闘させることができる。",
    "classes": [],
    "traits": [
      "インセクト"
    ]
  },
  "STD-186": {
    "id": "STD-186",
    "name": "地虫の豊穣",
    "category": "Script",
    "color": "緑",
    "cost": null,
    "classes": [],
    "text": "相手がカードを引いた時起動できる。カードを1枚引く。",
    "setupCost": 1,
    "activationCost": 0,
    "printedCost": "1-0",
    "traits": [
      "インセクト"
    ]
  },
  "STD-187": {
    "id": "STD-187",
    "name": "魔水晶のギークス",
    "category": "Ob",
    "color": "紫",
    "cost": 2,
    "atk": 2,
    "str": 2,
    "classes": [
      "ヴェンジェンス",
      "ギークス"
    ],
    "text": "[ログイン]山札の上から3枚を見る。その中からメモリ3以下・紫のカードを選びそれを手札に加える。残りを山札の下に戻す。",
    "sourceId": "STD-187",
    "printedCategory": "Ob",
    "cardClass": "ヴェンジェンス/ギークス"
  },
  "STD-188": {
    "id": "STD-188",
    "name": "コピー＆ペイスター",
    "category": "Ob",
    "color": "紫",
    "cost": 2,
    "atk": 1,
    "str": 1,
    "classes": [
      "ヴェンジェンス",
      "ノイド"
    ],
    "text": "[ログイン]これ以外の自分フロントエリアのOb1体を選びバックに下げる。その後、『ドールズ』1体を生成し配置する。",
    "sourceId": "STD-188",
    "printedCategory": "Ob",
    "cardClass": "ヴェンジェンス/ノイド"
  },
  "STD-189": {
    "id": "STD-189",
    "name": "ドールズ",
    "category": "Ob",
    "color": "紫",
    "cost": 1,
    "atk": 1,
    "str": 1,
    "classes": [
      "アーティファクト"
    ],
    "text": "(効果なし)",
    "sourceId": "STD-189",
    "printedCategory": "Ob",
    "cardClass": "アーティファクト"
  },
  "STD-190": {
    "id": "STD-190",
    "name": "バックハッカー",
    "category": "Ob",
    "color": "紫",
    "cost": 3,
    "atk": 2,
    "str": 4,
    "classes": [
      "ニュートロン・セキュリティ",
      "ノイド"
    ],
    "text": "これがバックにいる場合、ターン終了時に相手ユーザーに2ダメージ。",
    "sourceId": "STD-190",
    "printedCategory": "Ob",
    "cardClass": "ニュートロン・セキュリティ/ノイド"
  },
  "STD-191": {
    "id": "STD-191",
    "name": "淫魔像",
    "category": "Ob",
    "color": "紫",
    "cost": 3,
    "atk": 1,
    "str": 1,
    "classes": [
      "マスターピース"
    ],
    "text": "自分のObがエリアを移動した場合、メモリを1回復する。",
    "sourceId": "STD-191",
    "printedCategory": "Ob",
    "cardClass": "マスターピース"
  },
  "STD-192": {
    "id": "STD-192",
    "name": "マーダードールズ=タナフォリア",
    "category": "Ob",
    "color": "紫",
    "cost": 2,
    "atk": 1,
    "str": 3,
    "classes": [
      "マスターピース"
    ],
    "text": "[アップデート:2]自分Ob1体をフロントまたはバックに移動させる。カードを1枚引く。これが移動した時、相手フロントObすべてに1ダメージ。",
    "sourceId": "STD-192",
    "printedCategory": "Ob",
    "cardClass": "マスターピース"
  },
  "STD-193": {
    "id": "STD-193",
    "name": "マーダードールズ=ネクリア",
    "category": "Ob",
    "color": "紫",
    "cost": 3,
    "atk": 5,
    "str": 3,
    "classes": [
      "マスターピース"
    ],
    "text": "[ハッキング]これを実行する時バックにのみ配置できる。これが移動した時、自分と相手のOb1体ずつを選び破壊できる。",
    "sourceId": "STD-193",
    "printedCategory": "Ob",
    "cardClass": "マスターピース"
  },
  "STD-194": {
    "id": "STD-194",
    "name": "マーダードールズ=アクロィア",
    "category": "Ob",
    "color": "紫",
    "cost": 2,
    "atk": 2,
    "str": 2,
    "classes": [
      "マスターピース"
    ],
    "text": "これが移動した時+1/+1し、元のエリアに『ドールズ』1体を生成し配置する。",
    "sourceId": "STD-194",
    "printedCategory": "Ob",
    "cardClass": "マスターピース"
  },
  "STD-195": {
    "id": "STD-195",
    "name": "マーダードールズ=トライプビア",
    "category": "Ob",
    "color": "紫",
    "cost": 4,
    "atk": 4,
    "str": 4,
    "classes": [
      "マスターピース"
    ],
    "text": "[レイヤード:「ドールズ」Ob2体以上][セキュリティ]レイヤーを1枚破棄することでこれを移動する消費メモリを1にできる。これが移動した時スタンバイする。",
    "sourceId": "STD-195",
    "printedCategory": "Lyd-Ob",
    "cardClass": "マスターピース"
  },
  "STD-196": {
    "id": "STD-196",
    "name": "技師ストリカズラ",
    "category": "Ob",
    "color": "紫",
    "cost": 2,
    "atk": 1,
    "str": 1,
    "classes": [
      "ヴェンジェンス",
      "アーティスト"
    ],
    "text": "[ログイン]と[アップデート:3]所持ユーザーが同じとなるOb2体を選び、そのOb同士の位置を入れ替える。",
    "sourceId": "STD-196",
    "printedCategory": "Ob",
    "cardClass": "ヴェンジェンス/アーティスト"
  },
  "STD-197": {
    "id": "STD-197",
    "name": "手品師トリキック",
    "category": "Ob",
    "color": "紫",
    "cost": 3,
    "atk": 2,
    "str": 2,
    "classes": [
      "ヴェンジェンス",
      "アーティスト"
    ],
    "text": "各ターン1度、相手がカードを実行した時、それと同じカテゴリとなるカード1枚にアクセスしそれを手札に加える。その後、『ドールズ』1体を生成し配置する。",
    "sourceId": "STD-197",
    "printedCategory": "Ob",
    "cardClass": "ヴェンジェンス/アーティスト"
  },
  "STD-198": {
    "id": "STD-198",
    "name": "スケア=アイアン=クロウ",
    "category": "Ob",
    "color": "紫",
    "cost": 6,
    "atk": 6,
    "str": 6,
    "classes": [
      "ヴェンジェンス",
      "イモータルス"
    ],
    "text": "[ログイン]『ドールズ』3体を生成し配置する。自分の『ドールズ』は[コンタクト]を得る。",
    "sourceId": "STD-198",
    "printedCategory": "Ob",
    "cardClass": "ヴェンジェンス/イモータルス"
  },
  "STD-199": {
    "id": "STD-199",
    "name": "罠師ガナルスベル",
    "category": "Ob",
    "color": "紫",
    "cost": 3,
    "atk": 3,
    "str": 3,
    "classes": [
      "ヴェンジェンス",
      "アーティスト"
    ],
    "text": "[ログイン]フロントのOb1体を選び、それを手札に戻すかバックに移動する。その後、所持ユーザーは①②いずれかを起動する。①手札に戻した場合、メモリを2回復する。②移動した場合、カードを1枚引く。",
    "sourceId": "STD-199",
    "printedCategory": "Ob",
    "cardClass": "ヴェンジェンス/アーティスト"
  },
  "STD-200": {
    "id": "STD-200",
    "name": "プロジェクト=デカダンス",
    "category": "Ob",
    "color": "紫",
    "cost": 7,
    "atk": 0,
    "str": 7,
    "classes": [
      "ヴェンジェンス",
      "マスターピース"
    ],
    "text": "[ログイン]または[アップデート:4]これをエリアのいずれかに移動させる。その後、元々のエリアに『足跡』を生成し配置する。",
    "sourceId": "STD-200",
    "printedCategory": "Ob",
    "cardClass": "ヴェンジェンス/マスターピース"
  },
  "STD-201": {
    "id": "STD-201",
    "name": "足跡",
    "category": "Code",
    "color": "紫",
    "cost": 7,
    "classes": [
      "アーティファクト"
    ],
    "text": "これにカードをマウントできない。[アップデート:4]これを破壊する。",
    "sourceId": "STD-201",
    "printedCategory": "Code",
    "atk": null,
    "str": null,
    "cardClass": "アーティファクト"
  },
  "STD-202": {
    "id": "STD-202",
    "name": "骨抜き",
    "category": "Sp",
    "color": "紫",
    "cost": 2,
    "classes": [],
    "text": "相手フロントのOb1体をバックに移動する。その後、元々のエリアに『ドールズ』1体を生成し配置する。",
    "sourceId": "STD-202",
    "printedCategory": "Sp",
    "atk": null,
    "str": null,
    "cardClass": null
  },
  "STD-203": {
    "id": "STD-203",
    "name": "傀儡特攻",
    "category": "Sp",
    "color": "紫",
    "cost": 2,
    "classes": [],
    "text": "[レスポンス:1]自分のOb1体を破壊し、相手Ob1体に2ダメージ。この効果で相手Obが破壊された場合、同じ縦列のOb1体に2ダメージ。",
    "sourceId": "STD-203",
    "printedCategory": "Sp",
    "atk": null,
    "str": null,
    "cardClass": null
  },
  "STD-204": {
    "id": "STD-204",
    "name": "乗っ取り",
    "category": "Script",
    "color": "紫",
    "cost": 3,
    "classes": [],
    "text": "[if:相手がObを実行する時]そのObを配置するかわりに『ドールズ・ギガンテス』1体を生成しそのレイヤーとして配置する。",
    "sourceId": "STD-204",
    "printedCategory": "Script",
    "atk": null,
    "str": null,
    "cardClass": null
  },
  "STD-205": {
    "id": "STD-205",
    "name": "ドールズ・ギガンテス",
    "category": "Ob",
    "printedCategory": "Lyd-Ob",
    "color": "紫",
    "cost": 3,
    "atk": 1,
    "str": 1,
    "classes": [
      "ヴェンジェンス",
      "アーティファクト"
    ],
    "text": "[レイヤード:Ob1体以上][セキュリティ][ログイン]これのレイヤー1枚につき+1/+1する。これがクラス:アーティファクトまたはマスターピースのカードから受けるダメージは-1される。",
    "sourceId": "STD-205",
    "cardClass": "ヴェンジェンス/アーティファクト"
  },
  "STD-206": {
    "id": "STD-206",
    "name": "ギガント・パッチワーク",
    "category": "Sp",
    "color": "紫",
    "cost": 1,
    "classes": [],
    "text": "自分の手札に『ドールズ』と『ドールズ・ギガンテス』それぞれ1枚を生成する。",
    "sourceId": "STD-206",
    "printedCategory": "Sp",
    "atk": null,
    "str": null,
    "cardClass": null
  },
  "STD-207": {
    "id": "STD-207",
    "name": "クラフト・パッチワーク",
    "category": "Sp",
    "color": "紫",
    "cost": 1,
    "classes": [],
    "text": "[レスポンス:3]『ドールズ』1枚を手札に生成し、①を起動する。①手札の紫のカード1枚を公開する。公開している間その実行メモリは-2される。",
    "sourceId": "STD-207",
    "printedCategory": "Sp",
    "atk": null,
    "str": null,
    "cardClass": null
  },
  "STD-208": {
    "id": "STD-208",
    "name": "糸の絡め取り",
    "category": "Script",
    "color": "紫",
    "cost": 3,
    "classes": [],
    "text": "[レジデント]名称:ドールズのObが破壊される度①を起動する。①相手Ob全てはこのターン-1/0する。",
    "sourceId": "STD-208",
    "printedCategory": "Script",
    "atk": null,
    "str": null,
    "cardClass": null
  },
  "STD-209": {
    "id": "STD-209",
    "name": "コープス・パッチワーク",
    "category": "Sp",
    "color": "紫",
    "cost": 5,
    "classes": [],
    "text": "相手エリアのカード1枚を破壊する。この効果で破壊したカードの種類によって①②いずれかを起動する。①Obなら『ドールズ・ギガンテス』と『ドールズ』を生成し手札に加える。②Ob以外なら『ドールズ』2枚を生成し手札に加える。",
    "sourceId": "STD-209",
    "printedCategory": "Sp",
    "atk": null,
    "str": null,
    "cardClass": null
  },
  "STD-210": {
    "id": "STD-210",
    "name": "漣縫(さざなみ ぬい)",
    "category": "Ob",
    "color": "紫",
    "cost": 2,
    "atk": 0,
    "str": 1,
    "classes": [
      "ヴェンジェンス",
      "ギークス"
    ],
    "text": "[ログイン]または[アップデート:3]名称:パッチワークSp1枚にアクセスしそれを手札に加え公開する。この効果で加えたカードはターン中、実行メモリを-2する。",
    "sourceId": "STD-210",
    "printedCategory": "Ob",
    "cardClass": "ヴェンジェンス/ギークス"
  },
  "STD-211": {
    "id": "STD-211",
    "name": "スクラップ・パッチワーク",
    "category": "Sp",
    "color": "紫",
    "cost": 4,
    "classes": [],
    "text": "自分エリアに存在するクラスをひとつ指定する。そのクラスのカード全て破壊する。その後、破壊したカードの枚数分カードを引く。",
    "sourceId": "STD-211",
    "printedCategory": "Sp",
    "atk": null,
    "str": null,
    "cardClass": null
  },
  "STD-212": {
    "id": "STD-212",
    "name": "リスポーン・パッチワーク",
    "category": "Sp",
    "color": "紫",
    "cost": 1,
    "classes": [],
    "text": "このターン終了時、ターン中破壊されたObの枚数分まで『ドールズ』を生成しそれを配置する。",
    "sourceId": "STD-212",
    "printedCategory": "Sp",
    "atk": null,
    "str": null,
    "cardClass": null
  },
  "STD-213": {
    "id": "STD-213",
    "name": "サイコ・モザイコ",
    "category": "Ob",
    "color": "橙",
    "cost": 2,
    "atk": 2,
    "str": 2,
    "classes": [
      "微橙院",
      "ノイド"
    ],
    "text": "[ログイン]手札を1枚裏向きでレジストリに加える。その後カードを1枚引く。"
  },
  "STD-214": {
    "id": "STD-214",
    "name": "超侵略型昆虫兵器トビケラス",
    "category": "Ob",
    "color": "橙",
    "cost": 2,
    "atk": 5,
    "str": 5,
    "classes": [
      "微橙院",
      "インセクト"
    ],
    "text": "これの攻撃宣言時、カードを1枚レジストリから手札に加えなければ攻撃に失敗する。"
  },
  "STD-215": {
    "id": "STD-215",
    "name": "多層怪人サイドラ",
    "category": "Ob",
    "color": "橙",
    "cost": 1,
    "atk": 1,
    "str": 2,
    "classes": [
      "微橙院",
      "エージェント"
    ],
    "text": "レジストリからこれを実行できる。[ログアウト]これをレジストリにインストールする。"
  },
  "STD-216": {
    "id": "STD-216",
    "name": "三級戦闘員",
    "category": "Ob",
    "color": "橙",
    "cost": 3,
    "atk": 3,
    "str": 3,
    "classes": [
      "微橙院",
      "イモータルス"
    ],
    "text": "[ログイン]山札の上1枚をレジストリにインストールする。"
  },
  "STD-217": {
    "id": "STD-217",
    "name": "岩投怪人 ホーリーゲル",
    "category": "Ob",
    "color": "橙",
    "cost": 3,
    "atk": 3,
    "str": 1,
    "classes": [
      "微橙院",
      "エレクトロン・フェアリー"
    ],
    "text": "自分のレジストリからカードが離れる度、相手に1ダメージ。"
  },
  "STD-218": {
    "id": "STD-218",
    "name": "死の商人",
    "category": "Ob",
    "color": "橙",
    "cost": 5,
    "atk": 5,
    "str": 5,
    "classes": [],
    "text": "いずれかのユーザーのレジストリからカードが離れるたび、自分のメモリを1回復。(上限以上に回復しない。)"
  },
  "STD-219": {
    "id": "STD-219",
    "name": "転送怪人カサンドラ",
    "category": "Ob",
    "color": "橙",
    "cost": 7,
    "atk": 5,
    "str": 3,
    "classes": [],
    "text": "[ログイン]カード1枚にアクセスし、それをレジストリにインストールする。①これの攻撃時、レジストリからX以下のカードを選びそれをメモリを支払わず実行できる。(Xは自分のレジストリの枚数である。)"
  },
  "STD-220": {
    "id": "STD-220",
    "name": "パラレルウィード・ファイター",
    "category": "Ob",
    "color": "橙",
    "cost": 3,
    "atk": 5,
    "str": 3,
    "classes": [],
    "text": "[コンタクト][ログアウト]ゴミ箱に送るかわりにレジストリにインストールする。①レジストリからこれを実行できる。この効果で配置した場合これはユーザーを攻撃できない。"
  },
  "STD-221": {
    "id": "STD-221",
    "name": "パラレルウィード・アタッカー",
    "category": "Ob",
    "color": "橙",
    "cost": 2,
    "atk": 2,
    "str": 2,
    "classes": [],
    "text": "[ログイン]相手ユーザーに1ダメージ。これがレジストリから実行されていた場合、3ダメージ。"
  },
  "STD-222": {
    "id": "STD-222",
    "name": "世界線の跳躍",
    "category": "Sp",
    "color": "橙",
    "cost": 2,
    "classes": [],
    "text": "手札を全てレジストリにインストールし、その枚数分カードを引く。"
  },
  "STD-223": {
    "id": "STD-223",
    "name": "異次元ショット",
    "category": "Sp",
    "color": "橙",
    "cost": 3,
    "classes": [],
    "text": "[アンブッシュ:2]（これがレジストリにありこれのメモリ以上のカードがレジストリにある場合、相手Obの攻撃宣言時に指定のメモリを消費し実行できる。[インシデント]による効果起動はその攻撃宣言につき1回しかできない。）①Ob1体に3ダメージ。この効果によるダメージでObを破壊したならカードを1枚引く。"
  },
  "STD-224": {
    "id": "STD-224",
    "name": "亜空間タックル",
    "category": "P-in",
    "color": "橙",
    "cost": 2,
    "classes": [],
    "text": "これのインストール時、任意の数字を指定する。相手が実行し配置したカードに記載されたメモリが指定した数字だった場合、これとそのカードの両方を破壊する。"
  },
  "STD-225": {
    "id": "STD-225",
    "name": "大怪人ギガントアーク",
    "category": "Ob",
    "color": "橙",
    "cost": 6,
    "atk": 6,
    "str": 6,
    "classes": [],
    "text": "[QA][ログイン]レジストリのカードを好きな枚数破壊し、破壊した数だけメモリを1回復する。"
  },
  "STD-226": {
    "id": "STD-226",
    "name": "反転怪人 バリース",
    "category": "Ob",
    "color": "橙",
    "cost": 4,
    "atk": 3,
    "str": 1,
    "classes": [],
    "text": "このObがスタンバイ状態の時、相手がレジストリにカードをインストールした場合に①を起動できる。①このObをスリープし、レジストリのカード1枚を裏向きにする。"
  },
  "STD-227": {
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
  },
  "STD-228": {
    "id": "STD-228",
    "name": "征服の証",
    "category": "Code",
    "color": "橙",
    "cost": 7,
    "text": "これにカードをマウントできない。[アップデート:4]自分は3ダメージ受ける。これをランダムな相手エリアに配置する。",
    "classes": []
  },
  "STD-229": {
    "id": "STD-229",
    "name": "世界征服",
    "category": "Sp",
    "color": "橙",
    "cost": 5,
    "text": "レジストリのカード5枚を山札に戻すことで①を起動する。①自分は追加ターンを得る。この効果で得たターン中、相手に与えるダメージは-2される。",
    "classes": []
  },
  "STD-230": {
    "id": "STD-230",
    "name": "悪の発明",
    "category": "Sp",
    "color": "橙",
    "cost": 3,
    "text": "[アンブッシュ:3]相手の手札を見て、1枚をレジストリに加える。その後、ランダムにもう1枚選びレジストリに加える。",
    "classes": []
  },
  "STD-231": {
    "id": "STD-231",
    "name": "帝国式肉体改造",
    "category": "Script",
    "color": "橙",
    "cost": 3,
    "text": "[相手がObを実行する時]そのObの両隣りに『征服の証』をそれぞれ生成し配置する。",
    "classes": []
  },
  "STD-232": {
    "id": "STD-232",
    "name": "合体怪人 膨張のフットブロ",
    "category": "Lyd-Ob",
    "printedCategory": "Lyd-Ob",
    "color": "橙",
    "cost": 3,
    "atk": 5,
    "str": 1,
    "classes": [],
    "text": "[レイヤード:自分エリアとレジストリのカード2枚以上]各ターン開始時、お互いの山札の上から1枚をこれのレイヤーに加える。[ログアウト]相手エリアのObを好きな数選び、Xを割り振ってダメージを与える。その後、これのレイヤーを全て所有ユーザーのレジストリにインストールする。Xはこれのレイヤーが持つメモリの合計である。"
  },
  "STD-233": {
    "id": "STD-233",
    "name": "デビルマスク",
    "category": "Sp",
    "color": "橙",
    "cost": 1,
    "classes": [],
    "text": "自分の手札に『白い仮面』と『黒い仮面』それぞれ1枚を生成する。"
  },
  "STD-234": {
    "id": "STD-234",
    "name": "白い仮面",
    "category": "Code",
    "printedCategory": "仮想Code",
    "color": "橙",
    "cost": 1,
    "atk": -2,
    "str": 2,
    "token": true,
    "text": "[セキュリティ]これにマウントしたカードがスリープする時、所有ユーザーは手札を1枚捨てる。",
    "classes": []
  },
  "STD-235": {
    "id": "STD-235",
    "name": "黒の仮面",
    "category": "Code",
    "printedCategory": "仮想Code",
    "color": "橙",
    "cost": 2,
    "atk": 2,
    "str": -2,
    "token": true,
    "text": "[コンタクト]これにマウントしたカードがスリープする時、所有ユーザーは2ダメージ受ける。",
    "classes": []
  },
  "STD-236": {
    "id": "STD-236",
    "name": "不乱 健博士(みだれず たける)",
    "category": "Ob",
    "color": "橙",
    "cost": 5,
    "atk": 1,
    "str": 1,
    "classes": [
      "ｗｗｗ"
    ],
    "text": "[ログイン]山札のカード2枚にアクセスし、それをレジストリにインストールする。①1ターンに1度、レジストリからカードを実行できる。"
  },
  "STD-237": {
    "id": "STD-237",
    "name": "ドクター・カラヘンジ",
    "category": "Ob",
    "color": "橙",
    "cost": 2,
    "atk": 0,
    "str": 1,
    "text": "[アップデート:4]ランダムなOb1体を生成し配置する。",
    "classes": []
  },
  "STD-238": {
    "id": "STD-238",
    "name": "合体怪人 千手のキャノーン",
    "category": "Ob",
    "color": "橙",
    "cost": 5,
    "atk": 1,
    "str": 5,
    "classes": [],
    "text": "[レイヤード:自分のOb1体+自分レジストリのカード1枚以上][切断][セキュリティ]攻撃時①を起動できる。①これのレイヤーを2枚消費し、スタンバイする。これを+2/0する。"
  },
  "SZTB-090": {
    "id": "SZTB-090",
    "sourceId": "SZTB090",
    "name": "アームズバンド・アマルガム",
    "category": "Script",
    "printedCategory": "Sc",
    "color": null,
    "cost": 1,
    "text": "[レジデント]",
    "classes": ["エレクトロン・フェアリー"]
  },
  "SZTB-091": {
    "id": "SZTB-091",
    "sourceId": "SZTB091",
    "name": "アームズバンド・ジャケット",
    "category": "Code",
    "printedCategory": "Code",
    "color": null,
    "cost": 1,
    "text": "(効果なし)",
    "classes": ["エレクトロン・フェアリー"]
  },
  "SZTB-092": {
    "id": "SZTB-092",
    "sourceId": "SZTB092",
    "name": "銃装重装 種ヶ島ハジメ",
    "category": "Lyd-Ob",
    "printedCategory": "Lyd-Ob",
    "color": null,
    "cost": 3,
    "atk": 1,
    "str": 1,
    "text": "[レイヤード:手札の名称:アームズバンド・カード1枚]これの攻撃宣言時、攻撃対象に3ダメージ与える。",
    "classes": ["連合軍", "ノイド"]
  },
  "SZTB-093": {
    "id": "SZTB-093",
    "sourceId": "SZTB093",
    "name": "銃装重奏 鉄ヶ崎カサネ",
    "category": "Lyd-Ob",
    "printedCategory": "Lyd-Ob",
    "color": null,
    "cost": 2,
    "atk": 1,
    "str": 2,
    "text": "[レイヤード:手札とエリアの名称:アームズバンド・カード1枚ずつ][セキュリティ]これが攻撃される時、戦闘開始前に相手Obに2ダメージ。その後、『アームズバンド・ジャケット』1枚を生成し配置する。",
    "classes": ["連合軍", "ノイド"]
  },
  "SZTB-094": {
    "id": "SZTB-094",
    "sourceId": "SZTB094",
    "name": "銃装重奏 十六夜マキナ",
    "category": "Lyd-Ob",
    "printedCategory": "Lyd-Ob",
    "color": null,
    "cost": 5,
    "atk": 5,
    "str": 6,
    "text": "[レイヤード:手札とエリアの名称:アームズバンド・カード合計3枚以上][ログイン]とターン終了時、Ob以外の名称:アームズバンド・カード1枚にアクセスしそれを手札に加える。相手がカードを実行した時これをスリープし、[弾倉]を持つSpを実行できる。",
    "classes": ["連合軍", "ノイド"]
  },
  "SZTB-095": {
    "id": "SZTB-095",
    "sourceId": "SZTB095",
    "name": "銃装重奏 赤羽チナツ",
    "category": "Lyd-Ob",
    "printedCategory": "Lyd-Ob",
    "color": null,
    "cost": 7,
    "atk": 6,
    "str": 2,
    "text": "[レイヤード:手札とエリアの名称:アームズバンド・カード合計3枚以上][QA]各ターン1度、自分が[弾倉]を持つSpを実行した後、それをゴミ箱に送るかわりにこれのレイヤーに加えることができる。[弾倉]によりレイヤーが消費された時、相手に1ダメージ。",
    "classes": ["連合軍", "ノイド"]
  },
  "SZTB-096": {
    "id": "SZTB-096",
    "sourceId": "SZTB096",
    "name": "アームズバンド・ブリッツ",
    "category": "Sp",
    "printedCategory": "Sp",
    "color": null,
    "cost": 3,
    "text": "[弾倉:1]相手Ob1体に5ダメージ。その後、自分エリアに名称:アームズバンドObが存在するなら、『アームズバンド・ジャケット』を生成し配置する。",
    "classes": []
  },
  "SZTB-097": {
    "id": "SZTB-097",
    "sourceId": "SZTB097",
    "name": "アームズバンド・セッション",
    "category": "Sp",
    "printedCategory": "Sp",
    "color": null,
    "cost": 5,
    "text": "[弾倉:2]いずれかを選択する。①名称:アームズバンドのOb1体にアクセスし、それを手札に加える。②自分Obを任意の数選びその合計ATK以下のSTRを持つOb1体を選びそれを破壊する。その後、自分エリアに名称:アームズバンドObが存在するなら、『アームズバンド・ジャケット』を生成し配置する。",
    "classes": []
  },
  "SZTB-098": {
    "id": "SZTB-098",
    "sourceId": "SZTB098",
    "name": "アームズバンド・ジャムセッション",
    "category": "Sp",
    "printedCategory": "Sp",
    "color": null,
    "cost": 5,
    "text": "[弾倉:4]自分の名称:アームズバンドObすべて+1/0する。ダメージを取り除きスタンバイする。その後、自分エリアに名称:アームズバンドObが存在するなら、『アームズバンド・ジャケット』を生成し配置する。",
    "classes": []
  },
  "SZTB-099": {
    "id": "SZTB-099",
    "sourceId": "SZTB099",
    "name": "アームズバンド・リロード",
    "category": "Sp",
    "printedCategory": "Sp",
    "color": null,
    "cost": 3,
    "text": "[弾倉:1]カードを2枚引く。その後、自分エリアに名称:アームズバンドObが存在するなら、『アームズバンド・ジャケット』を生成し配置する。",
    "classes": []
  },
  "SZTB-100": {
    "id": "SZTB-100",
    "sourceId": "SZTB100",
    "name": "『我ら 特殊部隊銃装重奏』",
    "category": "Script",
    "printedCategory": "Sc",
    "color": null,
    "cost": 3,
    "text": "[レジデント]各ターン開始時、すべての名称:アームズバンド・レイヤードのレイヤーに『アームズバンド・アマルガム』1枚を生成し加える。",
    "classes": []
  },
  "SZTB-101": {
    "id": "SZTB-101",
    "sourceId": "SZTB101",
    "name": "銃装重奏重工",
    "category": "Script",
    "printedCategory": "Sc",
    "color": null,
    "cost": 3,
    "text": "[レジデント]自分のレイヤードに①を適用する。①[ログイン]と攻撃時、『アームズバンド・アマルガム』1枚を生成しレイヤーに加える。",
    "classes": []
  },
  "SZTB-102": {
    "id": "SZTB-102",
    "sourceId": "SZTB102",
    "name": "アームズバンド・ブートキャンプ",
    "category": "Script",
    "printedCategory": "Sc",
    "color": null,
    "cost": 5,
    "text": "[レジデント]起動時または[アップデート:2]①ゴミ箱の名称:アームズバンドカード1枚をサルベージする。その後、自分のレイヤーを任意の枚数消費する。こうして消費したレイヤー2枚につき1回追加で①を起動する。",
    "classes": []
  }
});
export const LAB_CARD_IDS = Object.freeze([...Object.keys(CARD_LIBRARY)].sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })));
export const VENGEANCE_DECK = Object.freeze([
  [
    "STD-187",
    1
  ],
  [
    "STD-188",
    1
  ],
  [
    "STD-189",
    1
  ],
  [
    "STD-190",
    1
  ],
  [
    "STD-191",
    1
  ],
  [
    "STD-192",
    1
  ],
  [
    "STD-193",
    1
  ],
  [
    "STD-194",
    1
  ],
  [
    "STD-195",
    1
  ],
  [
    "STD-196",
    1
  ],
  [
    "STD-197",
    1
  ],
  [
    "STD-198",
    1
  ],
  [
    "STD-199",
    1
  ],
  [
    "STD-200",
    1
  ],
  [
    "STD-201",
    1
  ],
  [
    "STD-202",
    1
  ],
  [
    "STD-203",
    1
  ],
  [
    "STD-204",
    1
  ],
  [
    "STD-205",
    1
  ],
  [
    "STD-206",
    1
  ],
  [
    "STD-207",
    1
  ],
  [
    "STD-208",
    1
  ],
  [
    "STD-209",
    1
  ],
  [
    "STD-210",
    1
  ],
  [
    "STD-211",
    1
  ],
  [
    "STD-212",
    1
  ]
]);
export const VENGEANCE_IDS = Object.freeze([
  "STD-187",
  "STD-188",
  "STD-189",
  "STD-190",
  "STD-191",
  "STD-192",
  "STD-193",
  "STD-194",
  "STD-195",
  "STD-196",
  "STD-197",
  "STD-198",
  "STD-199",
  "STD-200",
  "STD-201",
  "STD-202",
  "STD-203",
  "STD-204",
  "STD-205",
  "STD-206",
  "STD-207",
  "STD-208",
  "STD-209",
  "STD-210",
  "STD-211",
  "STD-212"
]);
export const NEUTRON_DECK = Object.freeze([
  [
    "STD-107",
    1
  ],
  [
    "STD-108",
    1
  ],
  [
    "STD-109",
    1
  ],
  [
    "STD-110",
    1
  ],
  [
    "STD-111",
    1
  ],
  [
    "STD-112",
    1
  ],
  [
    "STD-113",
    1
  ],
  [
    "STD-114",
    1
  ],
  [
    "STD-115",
    1
  ],
  [
    "STD-116",
    1
  ],
  [
    "STD-117",
    1
  ],
  [
    "STD-118",
    1
  ],
  [
    "STD-119",
    1
  ],
  [
    "STD-120",
    1
  ],
  [
    "STD-121",
    1
  ],
  [
    "STD-122",
    1
  ],
  [
    "STD-123",
    1
  ],
  [
    "STD-124",
    1
  ],
  [
    "STD-107",
    1
  ],
  [
    "STD-108",
    1
  ]
]);
export const NEUTRON_IDS = Object.freeze([
  "STD-107",
  "STD-108",
  "STD-109",
  "STD-110",
  "STD-111",
  "STD-112",
  "STD-113",
  "STD-114",
  "STD-115",
  "STD-116",
  "STD-117",
  "STD-118",
  "STD-119",
  "STD-120",
  "STD-121",
  "STD-122",
  "STD-123",
  "STD-124"
]);
export const RED_DECK = Object.freeze([
  [
    "STD-075",
    3
  ],
  [
    "STD-078",
    3
  ],
  [
    "STD-090",
    2
  ],
  [
    "STD-077",
    2
  ],
  [
    "STD-076",
    2
  ],
  [
    "STD-091",
    2
  ],
  [
    "STD-086",
    2
  ],
  [
    "STD-102",
    2
  ],
  [
    "STD-093",
    1
  ],
  [
    "STD-094",
    1
  ]
]);
export const YELLOW_DECK = Object.freeze([
  [
    "STD-125",
    3
  ],
  [
    "STD-131",
    3
  ],
  [
    "STD-129",
    2
  ],
  [
    "STD-127",
    2
  ],
  [
    "STD-132",
    2
  ],
  [
    "STD-144",
    2
  ],
  [
    "STD-138",
    2
  ],
  [
    "STD-149",
    2
  ],
  [
    "STD-134",
    1
  ],
  [
    "STD-136",
    1
  ]
]);
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
