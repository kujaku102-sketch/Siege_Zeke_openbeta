
export const TUTORIAL_SPEAKER = "じぐさぽ";
// どのチュートリアルも、相手ユーザーのSTR5から始めて0にして勝つ流れで終える。engine.js の初期配置がこの値を使う。
export const TUTORIAL_OPPONENT_STR = 5;
// 赤チュートリアルの初手(文豪の台本)。台本の「兵士」は剣士(STD-021、メモリ2・3/3・無色)に統一している。
export const TUTORIAL_SOLDIER_ID = "STD-021";
export const TUTORIAL_RED_HAND = Object.freeze(["STD-087", TUTORIAL_SOLDIER_ID, "STD-091", "STD-078"]);
// 青チュートリアル(文豪の台本、2026-10-28)。手札は ルチル・漣・フラウ・セキュリティウォール。山札はオフェンスプロトコル1枚とアサルトプログラム6枚。
// ルチルのアクセスでオフェンスプロトコルが手札に移ると山札はアサルトだけになり、山札が混ぜられても、どのターンの引きもアサルトプログラムになる。
// 引く枚数: 2ターン目の開始・STR 5→1 のインシデントの1ドロー・3ターン目の開始・勝利後のアサルトの追加ドロー(必須ドロー、失敗は敗北)の4枚。
// アサルトは 6 枚で、最後に2枚残る。
export const TUTORIAL_BLUE_HAND = Object.freeze(["STD-107", "STD-117", "STD-109", "STD-110"]);
export const TUTORIAL_BLUE_DECK = Object.freeze([["STD-111", 1], ["STD-116", 6]].map((row) => Object.freeze(row)));
// 相手の無色サンドバッグデッキ(設計メモ 08 §2.2)。台本が使う装甲兵 メルク(STD-043)は手札に直接置く。計40枚・同名3枚まで。
export const TUTORIAL_SANDBAG_DECK = Object.freeze([
  ["STD-020", 3], ["STD-021", 3], ["STD-022", 3], ["STD-023", 3], ["STD-024", 3], ["STD-025", 3], ["STD-026", 3],
  ["STD-027", 3], ["STD-028", 3], ["STD-029", 3], ["STD-031", 3], ["STD-043", 3], ["STD-044", 3], ["STD-004", 1]
].map((row) => Object.freeze(row)));
export const TUTORIAL_OPPONENT_SCRIPTS = Object.freeze({
  'yellow-demo': Object.freeze([{type:'install',cardId:'STD-125'}, {type:'executeCard',cardId:'STD-131',zone:'front'}, {type:'endTurn'}]),
  'yellow-pass': Object.freeze([{type:'endTurn'}]),
  // 赤チュートリアル: 相手はセキュリティのObガードマンを実行し、スリープさせてターンを終える。
  'guardman-demo': Object.freeze([{type:'executeCard',cardId:'STD-022',zone:'front'}, {type:'endTurn'}]),
  // 青チュートリアル: 1) 装甲兵 メルクを実行してスリープさせ、ターンを終える。2) 次のターン、メルクで相手ユーザーを攻撃してターンを終える。
  'sandbag-1': Object.freeze([{type:'executeCard',cardId:'STD-043',zone:'front'}, {type:'endTurn'}]),
  'sandbag-2': Object.freeze([{type:'attack',cardId:'STD-043',targetType:'fortress'}, {type:'endTurn'}])
});

const INTRO_STEPS = [
  { speaker: TUTORIAL_SPEAKER, text: "初めまして。Siege÷Zeke(ジーグ)の世界へようこそ。私は『じぐさぽ』です。" },
  { speaker: TUTORIAL_SPEAKER, text: "人間様……いえ、ユーザー様のサポートを仰せつかっております。どうぞよろしく。" },
  { speaker: TUTORIAL_SPEAKER, text: "早速ですが、Siege÷Zekeについてお伝えすることがございます……" },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "現在、ここは世界Ver0.9.1…つまり産まれる前(ベータテスト)です！",
    parts: ["現在、ここは世界Ver0.9.1…つまり", { ruby: "産まれる前", rt: "ベータテスト" }, "です！"]
  },
  { speaker: TUTORIAL_SPEAKER, text: "なので、不可思議なことや思い通りにならないことが多々あると思われます" },
  { speaker: TUTORIAL_SPEAKER, text: "産まれるまで優しく見守ってください！" },
  { speaker: TUTORIAL_SPEAKER, text: "それでは参りましょう、オープンソースTCGの世界へ！" }
];

const BASIC_STEPS = [
  {
    speaker: TUTORIAL_SPEAKER,
    text: "では、まずカードを出してみましょう。▽ここでは手札のOb(オブジェクト)を使います。",
    focus: [{ kind: "card", cardId: "STD-021", owner: "player", zone: "hand", label: "剣士" }, { kind: "card", cardId: "STD-091", owner: "player", zone: "hand", label: "アツト" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "Obは他のゲームではモンスター・クリーチャーに分類されるカテゴリです。",
    focus: [{ kind: "card", cardId: "STD-021", owner: "player", zone: "hand", label: "剣士" }, { kind: "card", cardId: "STD-091", owner: "player", zone: "hand", label: "アツト" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "これらの攻撃で相手の耐久力、つまりSTRを0にすることで勝利します。",
    focus: [{ kind: "fortress", owner: "ai", label: "相手ユーザー" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "もう一枚、違うカテゴリのカードがありますね。",
    focus: [{ kind: "card", cardId: "STD-078", owner: "player", zone: "hand", label: "ジャンクパーツ" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "これはCode。装備やフィールド、といった分類になるカテゴリです。",
    focus: [{ kind: "card", cardId: "STD-078", owner: "player", zone: "hand", label: "ジャンクパーツ" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "Obや他のカテゴリのカードと組み合わせることができ、戦略の幅を広げられます！",
    focus: [{ kind: "card", cardId: "STD-078", owner: "player", zone: "hand", label: "ジャンクパーツ" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "ちなみに、この『ジャンクパーツ』にはスタッツ(ATK/STR)への補正値がついているので",
    focus: [{ kind: "card", cardId: "STD-078", owner: "player", zone: "hand", label: "ジャンクパーツ" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "マウントしている限りObに対して『+1/+1』の補正を与えます。",
    focus: [{ kind: "card", cardId: "STD-078", owner: "player", zone: "hand", label: "ジャンクパーツ" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "では、実際にObを出してみましょう",
    focus: [{ kind: "card", cardId: "STD-021", owner: "player", zone: "hand", label: "剣士" }, { kind: "card", cardId: "STD-091", owner: "player", zone: "hand", label: "アツト" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "今はアクティブメモリ(使用可能)が5あるから、▽メモリ2の『剣士』と『切込隊長アツト』をそれぞれ出してみましょう。",
    focus: [{ kind: "card", cardId: "STD-021", owner: "player", zone: "hand", label: "剣士" }, { kind: "card", cardId: "STD-091", owner: "player", zone: "hand", label: "アツト" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "この操作を『実行』と呼びます！",
    focus: [{ kind: "card", cardId: "STD-021", owner: "player", zone: "hand", label: "剣士" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "では『剣士』を出してみましょう",
    focus: [{ kind: "card", cardId: "STD-021", owner: "player", zone: "hand", label: "剣士" }, { kind: "zone", owner: "player", zone: "front", label: "自分フロント" }],
    expect: { type: "play", cardId: "STD-021", zone: "front" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "2メモリを支払うことで実行が完了しました。",
    focus: [{ kind: "card", cardId: "STD-021", owner: "player", zone: "front", label: "剣士" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "では『アツト』を出してみましょう",
    focus: [{ kind: "card", cardId: "STD-091", owner: "player", zone: "hand", label: "アツト" }, { kind: "button", button: "play", cardId: "STD-091", label: "実行(出せないことを確かめる)" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "……あれ、出せませんね？",
    focus: [{ kind: "card", cardId: "STD-091", owner: "player", zone: "hand", label: "アツト" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "ごめんなさい！『シンボルが点灯』していませんでした！",
    focus: [{ kind: "admin", owner: "player", zone: "registry", label: "レジストリ" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "左端のこの領域、『レジストリ』が見えますか？",
    focus: [{ kind: "admin", owner: "player", zone: "registry", label: "レジストリ" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "ここにカードをインストールすることで、その色に対応したシンボルが点灯します。",
    focus: [{ kind: "admin", owner: "player", zone: "registry", label: "レジストリ" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "手札の『グレン』を選んで、レジストリへインストールしてみましょう。",
    focus: [{ kind: "card", cardId: "STD-087", owner: "player", zone: "hand", label: "グレン" }, { kind: "admin", owner: "player", zone: "registry", label: "レジストリ" }],
    expect: { type: "install", cardId: "STD-087" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "こうすることで、その色のカードは使用可能になります！情報ボタンを押してみてください",
    focus: [{ kind: "ui", target: "info-button", label: "情報ボタン" }],
    // 押したら進む手順(文豪、2026-10-28)。開いたものを閉じると次のセリフが出る(runtime-match-surface.js)。
    expect: { type: "advance", press: "info-button" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "あと6色分のシンボルが見えますね、他にもいろいろ・・・",
    focus: [{ kind: "ui", target: "info-button", label: "情報ボタン" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "話が逸れました！『アツト』を実行しましょう！",
    focus: [{ kind: "card", cardId: "STD-091", owner: "player", zone: "hand", label: "アツト" }, { kind: "zone", owner: "player", zone: "front", label: "自分フロント" }],
    expect: { type: "play", cardId: "STD-091", zone: "front" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "これで『剣士』と『アツト』が実行されましたね。",
    focus: [{ kind: "card", cardId: "STD-021", owner: "player", zone: "front", label: "剣士" }, { kind: "card", cardId: "STD-091", owner: "player", zone: "front", label: "アツト" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "『アツト』が『剣士』と比べて枠の色が違うのに気づきましたか？",
    focus: [{ kind: "card", cardId: "STD-021", owner: "player", zone: "front", label: "剣士" }, { kind: "card", cardId: "STD-091", owner: "player", zone: "front", label: "アツト" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "そう、緑枠。つまり『攻撃可能』です。",
    focus: [{ kind: "card", cardId: "STD-091", owner: "player", zone: "front", label: "アツト" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "通常、Obは配置してから1ターン待たないと攻撃できませんが『アツト』は『QA』を持っています。",
    focus: [{ kind: "card", cardId: "STD-091", owner: "player", zone: "front", label: "アツト" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "横のカード詳細から能力バッジを押して解説を見てください。これを持っている『アツト』はすぐに攻撃できます！",
    focus: [{ kind: "card", cardId: "STD-091", owner: "player", zone: "front", label: "アツト" }, { kind: "ui", target: "ability-badge", cardId: "STD-091", badge: "QA", label: "QAバッジ" }],
    expect: { type: "advance", press: "ability-badge", cardId: "STD-091" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "さっそく攻撃してみましょう！",
    focus: [{ kind: "card", cardId: "STD-091", owner: "player", zone: "front", label: "アツト" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "Obを押してみると行動のメニューが出てきます。まずは『攻撃』を押してみましょう！",
    focus: [{ kind: "card", cardId: "STD-091", owner: "player", zone: "front", label: "アツト" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "攻撃対象が選べます。ここでは、相手ユーザーを選びましょう。",
    focus: [{ kind: "card", cardId: "STD-091", owner: "player", zone: "front", label: "アツト" }, { kind: "fortress", owner: "ai", label: "相手ユーザー" }],
    expect: { type: "attack", cardId: "STD-091", targetType: "fortress" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "攻撃成功！ダメージが通り、相手ユーザーのSTRが削れました。",
    focus: [{ kind: "fortress", owner: "ai", label: "相手ユーザー" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "では、ここでターンを終了しましょう",
    focus: [{ kind: "action", action: "end-turn", label: "ターン終了" }],
    expect: { type: "end-turn" },
    after: "guardman-demo"
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "ターンの開始時には1枚ドロー！▽スリープしていたObのスタンバイが行われ、アクティブメモリも上限まで回復します。",
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "そして、相手のエリアには『セキュリティ』を持ったObが配置されています。",
    focus: [{ kind: "card", cardId: "STD-022", owner: "ai", zone: "front", label: "ガードマン" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "これがスリープしている間、攻撃対象はスリープしたObだけが可能になります。▽つまり、相手ユーザーへの攻撃が届きません。",
    focus: [{ kind: "card", cardId: "STD-022", owner: "ai", zone: "front", label: "ガードマン" }, { kind: "fortress", owner: "ai", label: "相手ユーザー" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "しかも、STRは4と高いです。ここでCodeを使ったパワーアップを説明します！",
    focus: [{ kind: "card", cardId: "STD-022", owner: "ai", zone: "front", label: "ガードマン" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "手札にある『ジャンクパーツ』をご覧ください！",
    focus: [{ kind: "card", cardId: "STD-078", owner: "player", zone: "hand", label: "ジャンクパーツ" }, { kind: "ui", target: "card-detail", cardId: "STD-078", label: "ジャンクパーツの詳細" }],
    expect: { type: "advance", press: "card-detail", cardId: "STD-078" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "これをObの下に実行し、マウントすることでそのObはATKとSTRが1ずつ上がります！では、『アツト』の下に『ジャンクパーツ』を実行しましょう！",
    focus: [{ kind: "card", cardId: "STD-078", owner: "player", zone: "hand", label: "ジャンクパーツ" }, { kind: "card", cardId: "STD-091", owner: "player", zone: "front", label: "アツト" }],
    expect: { type: "play", cardId: "STD-078", zone: "front" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "これで『アツト』のATKは4、相手のObを倒せるパワーになりましたね",
    focus: [{ kind: "card", cardId: "STD-091", owner: "player", zone: "front", label: "アツト" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "Obに攻撃してみましょう！",
    focus: [{ kind: "card", cardId: "STD-091", owner: "player", zone: "front", label: "アツト" }, { kind: "card", cardId: "STD-022", owner: "ai", zone: "front", label: "ガードマン" }],
    expect: { type: "attack", cardId: "STD-091", targetCardId: "STD-022" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "Obに対して攻撃すると、『戦闘』に入ります。▽『戦闘』では、お互いにATK分のダメージを与え合います。▽そして、これでSTRが0になったObは破壊されます。",
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "今回の戦闘で相手のObを破壊できました。▽これで『セキュリティ』がいなくなり、相手ユーザーを攻撃対象に選べるようになりました！",
    focus: [{ kind: "card", cardId: "STD-021", owner: "player", zone: "front", label: "剣士" }, { kind: "fortress", owner: "ai", label: "相手ユーザー" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "では、『剣士』で相手ユーザーを攻撃してSTRを0にしてしまいましょう！",
    focus: [{ kind: "card", cardId: "STD-021", owner: "player", zone: "front", label: "剣士" }, { kind: "fortress", owner: "ai", label: "相手ユーザー" }],
    expect: { type: "attack", cardId: "STD-021", targetType: "fortress" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "やりましたね！これで私達の勝利です！",
    expect: null
  }
];

// 青(セキュリティ・ハッキング・暗号化)。文豪の台本 02-青-台本-修正反映.md の「」を 1 つずつ 1 ステップにしている(原文のまま、順番どおり)。
// 括弧の演出は focus / expect に移した。手順3のルチルだけ、実行(ログイン効果の選択が開く)を先に行い、説明と「お、起動しましたね。」は
// 選択を開いたまま進め、最後の行でオフェンスプロトコルを選ぶ。leavesChoice の実行(step.leavesChoice)は、選択が開いたままでも次のステップへ進む。
const BLUE_CARD = (cardId, label, zone = "hand", owner = "player") => ({ kind: "card", cardId, owner, zone, label });
const BLUE_FRONT = { kind: "zone", owner: "player", zone: "front", label: "自分フロント" };
const BLUE_USER = { kind: "fortress", owner: "ai", label: "相手ユーザー" };
const BLUE_STEP = (text, focus, expect, rest = {}) => ({ speaker: TUTORIAL_SPEAKER, text, ...(focus ? { focus } : {}), expect, ...rest });
const BLUE_ADVANCE = (text, focus) => BLUE_STEP(text, focus, { type: "advance" });

const BLUE_STEPS = [
  // 1 開始
  BLUE_ADVANCE("青のデッキを使います。青は『ハッキング』と『暗号化』という、相手のセキュリティをすり抜ける、あるいは攻撃を受けない能力を得意とします。"),
  // 2 インストール(シンボル)
  BLUE_STEP("青のカードを使うには青のシンボルが必要なので『漣』をレジストリにインストールしましょう。",
    [BLUE_CARD("STD-117", "漣"), { kind: "admin", owner: "player", zone: "registry", label: "レジストリ" }], { type: "install", cardId: "STD-117" }),
  // 3 ルチル
  BLUE_STEP("では、『ルチル』を実行してみましょう。", [BLUE_CARD("STD-107", "ルチル"), BLUE_FRONT],
    { type: "play", cardId: "STD-107", zone: "front" }, { leavesChoice: true }),
  BLUE_ADVANCE("『ルチル』は青の得意なSp(スペル)とアクセスを駆使する戦術、特に『/…/*』系Spのサポートカードです。", [BLUE_CARD("STD-107", "ルチル", "front")]),
  BLUE_ADVANCE("『ログイン』効果は実行してエリアに出た時に起動する能力です。", [BLUE_CARD("STD-107", "ルチル", "front")]),
  BLUE_ADVANCE("お、起動しましたね。", [BLUE_CARD("STD-107", "ルチル", "front")]),
  BLUE_STEP("今は『/オフェンスプロトコル/*』にアクセスして手札に加えましょう！", undefined, { type: "answerChoice", cardId: "STD-111" }),
  // 4 フラウ
  BLUE_STEP("次に『フラウ』を実行します。メモリ2です。", [BLUE_CARD("STD-109", "フラウ"), BLUE_FRONT], { type: "play", cardId: "STD-109", zone: "front" }),
  BLUE_ADVANCE("フラウは『ハッキング』か『暗号化』を持っている間、+1/+1されます。今はどちらも持っていないので、2/2のままです。", [BLUE_CARD("STD-109", "フラウ", "front")]),
  // 5 ターン終了
  BLUE_STEP("ターンを終了しましょう。", [{ kind: "action", action: "end-turn", label: "ターン終了" }], { type: "end-turn" }, { after: "sandbag-1" }),
  // 6 相手のセキュリティ
  BLUE_ADVANCE("相手が『装甲兵 メルク』を出して、スリープさせました。『セキュリティ』を持つObがスリープしている間、普通のObは相手ユーザーを攻撃できません。",
    [BLUE_CARD("STD-043", "装甲兵 メルク", "front", "ai"), BLUE_USER]),
  // 7 Spの使用、ハッキングで攻撃
  BLUE_ADVANCE("では私達のターンですね。"),
  BLUE_STEP("今回は『フラウ』を選んで『/オフェンスプロトコル/*』を使ってみましょう",
    [BLUE_CARD("STD-111", "オフェンスプロトコル"), BLUE_CARD("STD-109", "フラウ", "front")], { type: "play", cardId: "STD-111", targetCardId: "STD-109" }),
  // 台本の「ハッキング(アイコン)」: (アイコン) は演出なのでセリフから外し、icons で名前の後ろにアイコンを出す。
  BLUE_STEP("エリアの『フラウ』が『ハッキング』を得て、さらに+1/0されます", [BLUE_CARD("STD-109", "フラウ", "front")], { type: "advance" }, { icons: ["ハッキング"] }),
  BLUE_ADVANCE("さらに！『フラウ』自身の効果で追加で+1/+1されました！", [BLUE_CARD("STD-109", "フラウ", "front")]),
  BLUE_ADVANCE("『ハッキング』は、相手の『セキュリティ』を無視して攻撃対象を選べるようになる効果です",
    [BLUE_CARD("STD-109", "フラウ", "front"), { kind: "ui", target: "ability-badge", cardId: "STD-109", badge: "ハッキング", label: "ハッキングのバッジ" }]),
  BLUE_STEP("それでは、攻撃してみましょう！", [BLUE_CARD("STD-109", "フラウ", "front"), BLUE_USER], { type: "attack", cardId: "STD-109", targetType: "fortress" }),
  BLUE_ADVANCE("攻撃成功！相手のSTRが5から1になりました。", [BLUE_USER]),
  // 8 ハッキングを持たないObで攻撃
  BLUE_STEP("では『ルチル』で攻撃してみましょう。", [BLUE_CARD("STD-107", "ルチル", "front"), BLUE_CARD("STD-043", "装甲兵 メルク", "front", "ai")],
    { type: "attack", cardId: "STD-107", targetCardId: "STD-043" }),
  BLUE_ADVANCE("ハッキングを持たない『ルチル』では、攻撃の対象を『セキュリティ』に吸われてしまいます。残念。", [BLUE_CARD("STD-043", "装甲兵 メルク", "front", "ai")]),
  // 9 暗号化
  BLUE_ADVANCE("次は第二の戦術、『暗号化』です。これを持つObは相手Obの攻撃対象になりません", [BLUE_CARD("STD-110", "セキュリティウォール")]),
  BLUE_STEP("『セキュリティウォール』を実行しましょう。", [BLUE_CARD("STD-110", "セキュリティウォール")], { type: "play", cardId: "STD-110" }),
  // 10 ターン終了と相手の攻撃
  // 暗号化がフラウに付いているのはこの手順の間だけ(相手ターン終了で切れる)なので、暗号化のバッジはここで見せる。
  BLUE_STEP("ターンを終了します。相手の装甲兵が攻撃してきますが……", [{ kind: "action", action: "end-turn", label: "ターン終了" },
    { kind: "ui", target: "ability-badge", cardId: "STD-109", badge: "暗号化", label: "暗号化のバッジ" }], { type: "end-turn" }, { after: "sandbag-2" }),
  BLUE_ADVANCE("『暗号化』のおかげで、私たちのObは攻撃されません。", [BLUE_CARD("STD-109", "フラウ", "front")]),
  BLUE_ADVANCE("攻撃は相手ユーザーのあなたにだけ届きます。"),
  // 11 とどめ
  BLUE_STEP("今引いてきた『/アサルトプログラム/*』を起動しましょう！", [BLUE_CARD("STD-116", "アサルトプログラム")], { type: "play", cardId: "STD-116" }),
  BLUE_STEP("最後です。『フラウ』で相手ユーザーを攻撃しましょう！", [BLUE_CARD("STD-109", "フラウ", "front"), BLUE_USER], { type: "attack", cardId: "STD-109", targetType: "fortress" }),
  BLUE_STEP("STRが0になりました！完璧な勝利を貴方に。Powered by Neutron Security！……企業案件です。", undefined, null)
];

const VENGEANCE_STEPS = [
  {
    speaker: TUTORIAL_SPEAKER,
    text: "ヴェンジェンスはObの移動とレイヤードを使う。今回は相手Doors ZXのSTR5を0にして勝つ。まず『開始』を押して盤面を確認。",
    focus: [{ kind: "action", action: "tutorial-advance", label: "開始" }, { kind: "zone", owner: "player", zone: "front", label: "ドールズ2体" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "紫カードの実行に紫シンボルが要る。手札の『淫魔像』をレジストリへインストール。",
    focus: [{ kind: "card", cardId: "STD-191", owner: "player", zone: "hand", label: "淫魔像" }, { kind: "admin", owner: "player", zone: "registry", label: "レジストリ" }],
    expect: { type: "install", cardId: "STD-191" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "『マーダードールズ=トライプビア』を選び、フロントへレイヤード。場の『ドールズ』2体を素材として選択する。",
    focus: [{ kind: "card", cardId: "STD-195", owner: "player", zone: "hand", label: "トライプビア" }, { kind: "card", cardId: "STD-189", owner: "player", zone: "front", label: "素材ドールズ" }, { kind: "zone", owner: "player", zone: "front", label: "自分フロント" }],
    expect: { type: "layered", cardId: "STD-195", zone: "front" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "トライプビアを選び、バックへリログ。レイヤー1枚を破棄することで移動コストが1になり、移動後はスタンバイする。",
    focus: [{ kind: "card", cardId: "STD-195", owner: "player", zone: "front", label: "トライプビア" }, { kind: "zone", owner: "player", zone: "back", label: "自分バック" }],
    expect: { type: "relog", cardId: "STD-195", zone: "back" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "次は『マーダードールズ=アクロィア』をフロントへ実行。",
    focus: [{ kind: "card", cardId: "STD-194", owner: "player", zone: "hand", label: "アクロィア" }, { kind: "zone", owner: "player", zone: "front", label: "自分フロント" }],
    expect: { type: "play", cardId: "STD-194", zone: "front" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "『マーダードールズ=タナフォリア』をフロントへ実行。リログではなく、次にこのカードの効果でアクロィアを動かす。",
    focus: [{ kind: "card", cardId: "STD-192", owner: "player", zone: "hand", label: "タナフォリア" }, { kind: "zone", owner: "player", zone: "front", label: "自分フロント" }],
    expect: { type: "play", cardId: "STD-192", zone: "front" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "タナフォリアを選んで『効果起動』。[アップデート:2]を選び、対象にアクロィア、移動先にバックを指定。アクロィアの移動時効果と1ドローまで処理される。",
    focus: [{ kind: "card", cardId: "STD-192", owner: "player", zone: "front", label: "タナフォリア" }, { kind: "card", cardId: "STD-194", owner: "player", zone: "front", label: "アクロィア" }, { kind: "zone", owner: "player", zone: "back", label: "移動先バック" }],
    expect: { type: "activate-effect", cardId: "STD-192", zone: "back" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "ここまでで、動かしたObは次のターンから攻撃に使える。ターンを終了して黄側を自動でパスさせる。",
    focus: [{ kind: "action", action: "end-turn", label: "ターン終了" }, { kind: "card", cardId: "STD-195", owner: "player", zone: "back", label: "トライプビア" }],
    expect: { type: "end-turn" },
    after: "yellow-pass"
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "次の自ターン。『マーダードールズ=トライプビア』を選び、フロントへリログ。レイヤー1枚を破棄すれば移動コストは1で、移動後はスタンバイするからそのまま攻撃できる。",
    focus: [{ kind: "card", cardId: "STD-195", owner: "player", zone: "back", label: "トライプビア" }, { kind: "zone", owner: "player", zone: "front", label: "自分フロント" }],
    expect: { type: "relog", cardId: "STD-195", zone: "front" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "トライプビアで相手のDoors ZXを攻撃。ATK4で、相手のSTRは5から1になる。",
    focus: [{ kind: "card", cardId: "STD-195", owner: "player", zone: "front", label: "トライプビア" }, { kind: "fortress", owner: "ai", label: "相手ユーザー" }],
    expect: { type: "attack", cardId: "STD-195", targetType: "fortress" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "最後は、アクロィアの移動で生成された『ドールズ』。これで相手のDoors ZXを攻撃して、STR1を0にすれば勝ち。",
    focus: [{ kind: "card", cardId: "STD-189", owner: "player", zone: "front", label: "ドールズ" }, { kind: "fortress", owner: "ai", label: "相手ユーザー" }],
    expect: { type: "attack", cardId: "STD-189", targetType: "fortress" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "勝利。ヴェンジェンスの基本は、生成したドールズを素材・移動元の穴埋め・攻撃役へ使い回すこと。",
    expect: null
  }
];

const tutorialSteps = (tutorialId) => tutorialId === "vengeance" ? VENGEANCE_STEPS : tutorialId === "blue" ? BLUE_STEPS : BASIC_STEPS;

export function createTutorialFlow(tutorialId = "basics") {
  return { tutorialId, introIndex: 0, introComplete: false, index: 0, complete: false, error: "", pendingAction: null };
}

export function currentTutorialPresentation(flow) {
  if (!flow?.introComplete) return { ...INTRO_STEPS[Math.min(flow?.introIndex ?? 0, INTRO_STEPS.length - 1)], intro: true };
  return currentTutorialStep(flow);
}

export function advanceTutorialIntroduction(flow) {
  if (!flow || flow.introComplete) return false;
  flow.introIndex += 1;
  if (flow.introIndex >= INTRO_STEPS.length) {
    flow.introIndex = INTRO_STEPS.length - 1;
    flow.introComplete = true;
  }
  flow.error = "";
  return true;
}

export function completeTutorialIntroduction(flow) {
  if (!flow) return false;
  flow.introIndex = INTRO_STEPS.length - 1;
  flow.introComplete = true;
  flow.error = "";
  return true;
}

export function currentTutorialStep(flow) {
  const steps = tutorialSteps(flow?.tutorialId);
  return steps[Math.min(flow.index, steps.length - 1)];
}

function matches(expect, action) {
  if (!expect) return true;
  return Object.entries(expect).every(([key, value]) => action[key] === value);
}

export function isTutorialActionExpected(flow, action) {
  if (!flow?.introComplete) return false;
  return matches(currentTutorialStep(flow)?.expect, action);
}


export { tutorialSteps, matches };
