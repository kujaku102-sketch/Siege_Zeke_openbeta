// Read-only glossary snapshot. Descriptions are verbatim; not runtime rulings.
export const ABILITY_GLOSSARY = Object.freeze([
  {
    "id": "ability-14",
    "name": "アクセス制限",
    "aliases": [
      "アクセス制限"
    ],
    "description": "これを持つObは攻撃宣言できない"
  },
  {
    "id": "ability-15",
    "name": "QA(クイックアクション)",
    "aliases": [
      "QA",
      "クイックアクション",
      "QuickAction"
    ],
    "description": "これを持つObは配置したターンに攻撃できる。"
  },
  {
    "id": "ability-16",
    "name": "コンタクト",
    "aliases": [
      "コンタクト",
      "Contact"
    ],
    "description": "これを持つObは配置したターンにObを攻撃できる。"
  },
  {
    "id": "ability-17",
    "name": "セキュリティ",
    "aliases": [
      "セキュリティ",
      "Security"
    ],
    "description": "相手は攻撃する時、これを持つObがスリープしているなら優先して攻撃しなければならない。また、自分ターン終了時にこれを持つObをスリープできる。"
  },
  {
    "id": "ability-18",
    "name": "デコイ",
    "aliases": [
      "デコイ",
      "Decoy"
    ],
    "description": "相手が効果による対象を選ぶ時、これを持つカードを優先して選ばなければならない。"
  },
  {
    "id": "ability-19",
    "name": "ハッキング",
    "aliases": [
      "ハッキング",
      "Hacking"
    ],
    "description": "これを持つObの攻撃または効果による対象を選ぶ時、[セキュリティ][デコイ]の効果を無視できる。"
  },
  {
    "id": "ability-20",
    "name": "プロテクト",
    "aliases": [
      "プロテクト",
      "Protect"
    ],
    "description": "これを持つカードは1度だけ戦闘または効果によるダメージを受けず、破壊されない。この効果の適用後[プロテクト]を1つ失う。また、重複して[プロテクト]を所持できる。"
  },
  {
    "id": "ability-21",
    "name": "レイヤード",
    "aliases": [
      "レイヤード",
      "Layered"
    ],
    "description": "これを持つカードを配置する時、効果テキストにある[レイヤード:〇]の条件を満たすように下に重ねて配置する。"
  },
  {
    "id": "ability-22",
    "name": "レイヤー",
    "aliases": [
      "レイヤー"
    ],
    "description": "[レイヤード]処理により複数枚重ねられたカード群。これらは最上段のカードを「レイヤー1」とし上から順に2.3…と数え、それらカード群をまとめて1体のOb(または他カテゴリのカード)として扱う。"
  },
  {
    "id": "ability-23",
    "name": "テンポラリレイヤー",
    "aliases": [
      "テンポラリレイヤー"
    ],
    "description": "裏向きのままレイヤーに加えるカードの効果によって加わったレイヤーです。この状態のレイヤーは消費またはレイヤー1がエリアを離れることでゴミ箱に送られる場合、かわりにBANされます。"
  },
  {
    "id": "ability-24",
    "name": "オーバーライド",
    "aliases": [
      "オーバーライド"
    ],
    "description": "実行による[レイヤード]処理で選んだ対象の中から最大メモリを持つカード分実行メモリが少なくなる。"
  },
  {
    "id": "ability-25",
    "name": "パラレルオーバーライド",
    "aliases": [
      "パラレルオーバーライド"
    ],
    "description": "上記オーバーライドの参照がレイヤーに選んだ対象すべての合計メモリ分実行メモリが少なくなる。"
  },
  {
    "id": "ability-26",
    "name": "アップデート",
    "aliases": [
      "アップデート"
    ],
    "description": "これを持つカードが既にエリアにある状態で、指定のメモリを消費することで起動できる効果。"
  },
  {
    "id": "ability-27",
    "name": "OC(オーバークロック)",
    "aliases": [
      "OC",
      "オーバークロック"
    ],
    "description": "これを持つカードをログインする際、追加で指定のメモリを消費することで起動できる効果。"
  },
  {
    "id": "ability-28",
    "name": "マウント",
    "aliases": [
      "マウント"
    ],
    "description": "そのカードがCodeの上に配置されている状態のこと。"
  },
  {
    "id": "ability-29",
    "name": "暗号化",
    "aliases": [
      "暗号化",
      "Encryption"
    ],
    "description": "これを持つObは攻撃対象にならない。"
  },
  {
    "id": "ability-30",
    "name": "ファイアウォール",
    "aliases": [
      "ファイアウォール"
    ],
    "description": "これを持つカードは効果の対象にならない。"
  },
  {
    "id": "ability-31",
    "name": "切断",
    "aliases": [
      "切断",
      "Disconnect"
    ],
    "description": "これを持つObと戦闘した相手を破壊します。"
  },
  {
    "id": "ability-35",
    "name": "ドラッグ",
    "aliases": [
      "ドラッグ"
    ],
    "description": "対象のカードをメモリ消費せずエリアに出すこと。この際、[ログイン]能力は誘発しない。"
  },
  {
    "id": "ability-36",
    "name": "アクセス",
    "aliases": [
      "アクセス"
    ],
    "description": "山札から条件を満たすカードを指定の枚数選び、公開すること。この処理後に山札をシャッフルする。"
  },
  {
    "id": "ability-37",
    "name": "レジデント",
    "aliases": [
      "レジデント",
      "Resident"
    ],
    "description": "これを持つScriptは起動後、ゴミ箱に置かれずエリアに残る。"
  },
  {
    "id": "ability-38",
    "name": "プロキシ",
    "aliases": [
      "プロキシ"
    ],
    "description": "手札にあるこの効果を持つObをSp扱いとして[プロキシ]効果を実行できる。実行後、Spと同じくゴミ箱に置かれる。"
  },
  {
    "id": "ability-39",
    "name": "サルベージ",
    "aliases": [
      "サルベージ"
    ],
    "description": "対象のカードをゴミ箱から選び、持ち主の手札に加えること。"
  },
  {
    "id": "ability-40",
    "name": "デコード",
    "aliases": [
      "デコード"
    ],
    "description": "対象のカードをゴミ箱からエリアに配置すること。(この際、[ログイン]能力は誘発しない)"
  },
  {
    "id": "ability-41",
    "name": "レスポンス",
    "aliases": [
      "レスポンス"
    ],
    "description": "自分のユーザーがダメージを受けた時に誘発する。指定のメモリを消費してこの効果を持つカードをログインまたは起動できる。"
  },
  {
    "id": "ability-54",
    "name": "ログイン",
    "aliases": [
      "ログイン",
      "Login"
    ],
    "description": "実行した時に誘発し、起動する効果。実行の伴わない設置またはドラッグでこの効果は誘発しない。"
  },
  {
    "id": "ability-55",
    "name": "ログアウト",
    "aliases": [
      "ログアウト",
      "Logout"
    ],
    "description": "この効果を持つカードがエリアにある状態で破壊された時に誘発する効果。"
  },
  {
    "id": "ability-56",
    "name": "バックアップ",
    "aliases": [
      "バックアップ",
      "Backup"
    ],
    "description": "この効果を持つカードがフロントで破壊された時、ゴミ箱からスリープしてバックに配置する。"
  },
  {
    "id": "ability-57",
    "name": "if",
    "aliases": [
      "if"
    ],
    "description": "Scriptの起動条件。〇〇した時に発動できる。"
  },
  {
    "id": "ability-58",
    "name": "DDドライブ",
    "aliases": [
      "DDドライブ"
    ],
    "description": "X個の龍素カウンターを取り除いて起動する。"
  },
  {
    "id": "ability-59",
    "name": "弾倉",
    "aliases": [
      "弾倉"
    ],
    "description": "実行する時、自分のレイヤーをX枚消費し、実行メモリをX少なくする。"
  },
  {
    "id": "ability-60",
    "name": "全体攻撃",
    "aliases": [
      "全体攻撃"
    ],
    "description": "これを持つObは攻撃宣言時、攻撃可能なObすべてに同時に攻撃する。(任意の順番で可能な限りすべてのObと戦闘する、途中で破壊されたなら終了)"
  },
  {
    "id": "ability-61",
    "name": "DANGER",
    "aliases": [
      "DANGER",
      "DANGER!"
    ],
    "description": "これを持つカードはゲーム開始時のデッキに1枚のみ入れることができる。"
  },
  {
    "id": "ability-63",
    "name": "負荷",
    "aliases": [
      "負荷",
      "Load"
    ],
    "description": "これを置かれたObまたはユーザー(フォートレスカード)はATK/STRに対し1つにつき-1/-1の補正を受ける。"
  },
  {
    "id": "ability-64",
    "name": "狂気カウンター",
    "aliases": [
      "狂気カウンター"
    ],
    "description": "狂気カウンターを置かれたObまたはユーザーは置かれた時、現在付与されている「狂気カウンター」分でダイスを振る。その出目の合計がSTRの値以上になったなら発狂する。(ObならBAN、ユーザーなら強制敗北)"
  },
  {
    "id": "ability-67",
    "name": "スタートアップ",
    "aliases": [
      "スタートアップ"
    ],
    "description": "これを持つカードはゲーム開始時の手札の1枚になる。"
  }
]);
