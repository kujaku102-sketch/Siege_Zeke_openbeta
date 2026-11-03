
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
// 紫チュートリアル(文豪の台本 05-紫-台本修正案.md、2026-10-30)。手札はコピー＆ペイスターと淫魔像(使わない)・ドールズ・ギガンテス・アクロィア・骨抜き。
// 場はドールズ2体、レジストリには使わない紫のカード1枚を最初から置いて紫シンボルを点灯させる(判断A)。メモリはユーザーの上限5のまま。
// 相手の手札はライダーとメルク。山札は無色サンドバッグ(判断C)。台本の「STD-187 コピー&北スター」は、名前の合うSTD-188 コピー＆ペイスターとして読む。
export const TUTORIAL_PURPLE_HAND = Object.freeze(["STD-188", "STD-191", "STD-205", "STD-194", "STD-202"]);
export const TUTORIAL_PURPLE_FRONT = Object.freeze(["STD-189", "STD-189"]);
export const TUTORIAL_PURPLE_REGISTRY = Object.freeze(["STD-190"]);
export const TUTORIAL_PURPLE_OPPONENT_HAND = Object.freeze(["STD-025", "STD-043"]);
// 黄チュートリアル(文豪の台本 04-黄-仮台本.md)。相手先攻。手札は大盾の騎士・伝令と、使わない華守り2枚(実物)。使わない黄のカード1枚を
// 最初からレジストリに置いて黄シンボルを点灯させる。後攻の第1ターンは2枚ドロー(4.2)、大盾の騎士のOCで2枚、第2ターンの1枚、伝令のログインの1枚、
// 手順8のインシデント(相手STR 5→2、5.3)で1枚、第3ターンの1枚。自分が引く順(上から): 台本に関係しない札が5枚、シールドバッシュ(6枚目)、台本に関係しない札、騎士団の凱歌(8枚目)。
export const TUTORIAL_YELLOW_HAND = Object.freeze(["STD-125", "STD-126", "STD-131", "STD-131"]);
export const TUTORIAL_YELLOW_REGISTRY = Object.freeze(["STD-129"]);
export const TUTORIAL_YELLOW_DRAWS = Object.freeze(["STD-133", "STD-134", "STD-136", "STD-134", "STD-133", "STD-138", "STD-136", "STD-137"]);
export const TUTORIAL_YELLOW_OPPONENT_HAND = Object.freeze(["STD-025", "STD-020", "STD-028"]);
// 黒チュートリアル(文豪の台本 06-黒-台本修正案.md と判断A〜E)。先攻は自分(第1ターンはドローしない)。黒のカード1枚を最初からレジストリに置いて点灯させる。
// 山札の上から: コンキスタドールの2枚ドローでレメゲトンと任意の札、第2ターンのドローで邪神との取引(レメゲトンのアクセスで山札は混ざるので、引き終えてからアクセス)。
// 相手はメルクAを場に、メルクBを手札に持つ。
export const TUTORIAL_BLACK_HAND = Object.freeze(["STD-150", "STD-155", "STD-156", "STD-152"]);
export const TUTORIAL_BLACK_REGISTRY = Object.freeze(["STD-151"]);
export const TUTORIAL_BLACK_DRAWS = Object.freeze(["STD-158", "STD-162", "STD-163"]);
export const TUTORIAL_BLACK_OPPONENT_FRONT = Object.freeze(["STD-043"]);
export const TUTORIAL_BLACK_OPPONENT_HAND = Object.freeze(["STD-043"]);
export const TUTORIAL_OPPONENT_SCRIPTS = Object.freeze({
  // 赤チュートリアル: 相手はセキュリティのObガードマンを実行し、スリープさせてターンを終える。
  'guardman-demo': Object.freeze([{type:'executeCard',cardId:'STD-022',zone:'front'}, {type:'endTurn'}]),
  // 青チュートリアル: 1) 装甲兵 メルクを実行してスリープさせ、ターンを終える。2) 次のターン、メルクで相手ユーザーを攻撃してターンを終える。
  'sandbag-1': Object.freeze([{type:'executeCard',cardId:'STD-043',zone:'front'}, {type:'endTurn'}]),
  'sandbag-2': Object.freeze([{type:'attack',cardId:'STD-043',targetType:'fortress'}, {type:'endTurn'}]),
  // 紫チュートリアル: ライダーを実行し、スリープ中の[セキュリティ]ギガンテスを攻撃(攻撃先はそれだけ)。メルクを実行してターンを終える(メルクのスリープは相手の操作が答える)。
  'vengeance-opponent': Object.freeze([{type:'executeCard',cardId:'STD-025',zone:'front'}, {type:'attack',cardId:'STD-025',targetCardId:'STD-205'},
    {type:'executeCard',cardId:'STD-043',zone:'front'}, {type:'endTurn'}]),
  // 黄チュートリアル: 1) 開始の相手ターン: ライダーを実行し、(フロントに何もいない)自分ユーザーを攻撃する。2) 歩兵を実行してターンを終える(ライダーは攻撃しない)。
  // 3) 騎馬兵を実行し、スリープ中の大盾の騎士を攻撃(相打ち)。歩兵で、残るスリープ中の伝令を攻撃する。
  'yellow-open': Object.freeze([{type:'executeCard',cardId:'STD-025',zone:'front'}, {type:'attack',cardId:'STD-025',targetType:'fortress'}, {type:'endTurn'}]),
  'yellow-turn2': Object.freeze([{type:'executeCard',cardId:'STD-020',zone:'front'}, {type:'endTurn'}]),
  'yellow-turn3': Object.freeze([{type:'executeCard',cardId:'STD-028',zone:'front'}, {type:'attack',cardId:'STD-028',targetCardId:'STD-125'},
    {type:'attack',cardId:'STD-020',targetCardId:'STD-126'}, {type:'endTurn'}]),
  // 黒チュートリアル: 1) 何もせずターンを終える(終了時にメルクAをスリープ)。2) メルクBを実行してターンを終える(終了時にメルクA・Bをスリープ)。
  'black-1': Object.freeze([{type:'endTurn'}]),
  'black-2': Object.freeze([{type:'executeCard',cardId:'STD-043',zone:'front'}, {type:'endTurn'}])
});

// 「ようこそ」の挨拶は赤(basics)だけで流す。ほかの色は自分の手順1から始まる(文豪 2026-10-29)。
const INTRO_STEPS = [
  { speaker: TUTORIAL_SPEAKER, text: "初めまして。Siege÷Zeke(ジーグ)の世界へようこそ。私は『じぐさぽ』です。" },
  { speaker: TUTORIAL_SPEAKER, text: "人間様……いえ、ユーザー様のサポートを仰せつかっております。どうぞよろしく。" },
  { speaker: TUTORIAL_SPEAKER, text: "早速ですが、Siege÷Zekeについてお伝えすることがございます……" },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "現在、ここは世界Ver0.9.2…つまり産まれる前(ベータテスト)です！",
    parts: ["現在、ここは世界Ver0.9.2…つまり",{ ruby: "産まれる前", rt: "ベータテスト" }, "です！"]
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

// 紫(レイヤード・移動)。文豪の台本 05-紫-台本修正案.md(Drive「SZβ092セリフ台本」)の「」を、原文のまま順番どおり1つずつ1ステップにしている。
// 括弧の演出は focus / expect に移した。相手のターン(ライダーの実行と攻撃、メルクの実行、ターン終了)は 'vengeance-opponent' の1本の台本で続けて動き、
// セリフ送りは相手のターンが終わってから(青・赤と同じ)。「ギガンテスとアクロィアで攻撃」の1行は2回の攻撃なので、同じ行を2ステップで出す。
// 最後の2行は1ステップに「▽」でつなぐ(勝ちが確定すると最後のステップへ飛ぶため)。
const PURPLE_CARD = BLUE_CARD;
const PURPLE_FRONT = BLUE_FRONT;
const PURPLE_USER = BLUE_USER;
const PURPLE_STEP = BLUE_STEP;
const PURPLE_ADVANCE = BLUE_ADVANCE;
const PURPLE_END_TURN = { kind: "action", action: "end-turn", label: "ターン終了" };

const VENGEANCE_STEPS = [
  // 1 開始
  PURPLE_ADVANCE("レディース&ジェントルメーン！"),
  PURPLE_ADVANCE("今回は紫スタートデッキ、『劇団ヴェンジェンス』の紹介です"),
  PURPLE_ADVANCE("紫の得意戦術は『カード位置の移動』と『仮想カードの生成』です"),
  PURPLE_ADVANCE("まず『開始』を押して、エリアを確認してください。", [{ kind: "action", action: "tutorial-advance", label: "開始" }]),
  // 2 レイヤード
  PURPLE_ADVANCE("私が事前に並べておいた『ドールズ』が2体いますね。", [PURPLE_CARD("STD-189", "ドールズ", "front")]),
  PURPLE_ADVANCE("指定のカードを素材(レイヤー)にして実行する必要のあるOb、▽これをレイヤードと呼びます。"),
  PURPLE_STEP("では『ドールズ・ギガンテス』を選んで、フロントに実行します。▽『ドールズ』2体を素材に選んでください。",
    [PURPLE_CARD("STD-205", "ギガンテス"), PURPLE_CARD("STD-189", "素材ドールズ", "front"), PURPLE_FRONT], { type: "layered", cardId: "STD-205", zone: "front" }),
  // 3 ログイン処理
  PURPLE_ADVANCE("ここで『ドールズ・ギガンテス』の[ログイン]が起動です！", [PURPLE_CARD("STD-205", "ギガンテス", "front")]),
  PURPLE_ADVANCE("所持するレイヤーの枚数だけパンプアップ！+2/+2されて強くなりましたね。", [PURPLE_CARD("STD-205", "ギガンテス", "front")]),
  PURPLE_ADVANCE("レイヤードは構成するカードの上から順にレイヤー1,2,3...と数えます。", [PURPLE_CARD("STD-205", "ギガンテス", "front")]),
  PURPLE_ADVANCE("つまり一番上の『ギガンテス』はレイヤー1、『ドールズ』はそれぞれ2,3となりますね！", [PURPLE_CARD("STD-205", "ギガンテス", "front")]),
  // 4 再実行(既に場にあるObの移動)の説明
  PURPLE_STEP("次は『マーダードールズ=アクロィア』をバックに実行してください。",
    [PURPLE_CARD("STD-194", "アクロィア"), { kind: "zone", owner: "player", zone: "back", label: "自分バック" }], { type: "play", cardId: "STD-194", zone: "back" }),
  PURPLE_ADVANCE("『アクロィア』は移動することでパワーアップと『ドールズ』の展開ができるObです。", [PURPLE_CARD("STD-194", "アクロィア", "back")]),
  PURPLE_STEP("このターンは『ギガンテス』をスリープし、攻撃に備えてターン終了しましょう！",
    [PURPLE_END_TURN, PURPLE_CARD("STD-205", "ギガンテス", "front")], { type: "end-turn" }, { leavesChoice: true }),
  // 台本の1行に操作が2つ(終了ボタン、ギガンテスのスリープ)あるので、同じ行を2ステップで出す。ターン終了で開く任意の選択に、ギガンテスを選ぶ。
  PURPLE_STEP("このターンは『ギガンテス』をスリープし、攻撃に備えてターン終了しましょう！",
    [PURPLE_CARD("STD-205", "ギガンテス", "front")], { type: "answerChoice", cardId: "STD-205" }, { after: "vengeance-opponent" }),
  // 5 相手ターン
  PURPLE_ADVANCE("相手は『ライダー』を実行！早速攻撃してきましたね！", [PURPLE_CARD("STD-205", "ギガンテス", "front")]),
  PURPLE_ADVANCE("『装甲兵メルク』も出してきましたね。", [PURPLE_CARD("STD-043", "装甲兵 メルク", "front", "ai")]),
  PURPLE_ADVANCE("相手は『メルク』をスリープしてターン終了のようです。", [PURPLE_CARD("STD-043", "装甲兵 メルク", "front", "ai")]),
  // 6 移動戦術の実践
  PURPLE_STEP("私達のターンですね！まずはバックの『アクロィア』をフロントに移動させます",
    [PURPLE_CARD("STD-194", "アクロィア", "back"), PURPLE_FRONT], { type: "relog", cardId: "STD-194", zone: "front" }),
  PURPLE_ADVANCE("主役の登場です！本日のマスターピース！アクロィアー！", [PURPLE_CARD("STD-194", "アクロィア", "front")]),
  PURPLE_ADVANCE("これで『アクロィア』の効果がトリガーしますね。パワーアップして、元いたエリアに『ドールズ』を生成します。",
    [PURPLE_CARD("STD-194", "アクロィア", "front"), PURPLE_CARD("STD-189", "生成されたドールズ", "back")]),
  PURPLE_STEP("次に手札の『骨抜き』を使います。選ぶのは『メルク』ですね",
    [PURPLE_CARD("STD-202", "骨抜き"), PURPLE_CARD("STD-043", "装甲兵 メルク", "front", "ai")], { type: "play", cardId: "STD-202", targetCardId: "STD-043" }),
  PURPLE_ADVANCE("これでセキュリティをどかしましたね！…相手にうちのドールズをプレゼントしてしまいましたが。",
    [PURPLE_CARD("STD-189", "相手のドールズ", "front", "ai"), PURPLE_USER]),
  PURPLE_STEP("それでは『ギガンテス』と『アクロィア』で攻撃して、相手をやっつけましょう！",
    [PURPLE_CARD("STD-205", "ギガンテス", "front"), PURPLE_USER], { type: "attack", cardId: "STD-205", targetType: "fortress" }),
  PURPLE_STEP("それでは『ギガンテス』と『アクロィア』で攻撃して、相手をやっつけましょう！",
    [PURPLE_CARD("STD-194", "アクロィア", "front"), PURPLE_USER], { type: "attack", cardId: "STD-194", targetType: "fortress" }),
  PURPLE_STEP("やりましたね！私達の勝利です！▽今後とも劇団ヴェンジェンスをよろしくお願いしまーす！▽…案件じゃないですよ", undefined, null)
];

// 黄(セキュリティで守る・OC・ドロー)。文豪の台本 04-黄-仮台本.md の「」を、原文のまま順番どおり1つずつ1ステップにしている。
// 括弧の演出は focus / expect に移した。相手のターンは3本の台本('yellow-open'、'yellow-turn2'、'yellow-turn3')で、それぞれのターンの動きを続けて行い、
// セリフ送りは相手のターンが終わってから(赤・青・紫と同じ)。1行に操作が2つある行(OCの実行と支払い、ターン終了とスリープ、凱歌の起動と①)は、同じ行を2ステップで出す。
// 最後の2行は1ステップに「▽」でつなぐ(勝ちが確定すると最後のステップへ飛ぶため)。
const TUT_CARD = BLUE_CARD;
const TUT_USER = BLUE_USER;
const TUT_STEP = BLUE_STEP;
const TUT_ADVANCE = BLUE_ADVANCE;
const TUT_END_TURN = PURPLE_END_TURN;

const YELLOW_STEPS = [
  // 1 開始(相手ターンで始まる)
  TUT_STEP("黄のデッキを使います。", [{ kind: "action", action: "tutorial-advance", label: "開始" }], { type: "advance" }, { after: "yellow-open" }),
  TUT_ADVANCE("黄は『セキュリティ』で相手の攻撃を受け止めて、粘り強く戦うのが得意です。"),
  // 2 大盾の騎士とOC
  TUT_STEP("それではセキュリティを展開しましょう！『大盾の騎士』を実行します。メモリは1ですが、『OC』という追加メモリを4払う選択ができます。",
    [TUT_CARD("STD-125", "大盾の騎士"), BLUE_FRONT], { type: "play", cardId: "STD-125", zone: "front" }, { leavesChoice: true }),
  TUT_STEP("払うと、カードを2枚引けて、強くなります。払ってみましょう！", undefined, { type: "answerChoice", label: "+4払う" }),
  // 3 ターン終了とスリープ
  TUT_STEP("ターンを終了します。『セキュリティ』を持つObは、ターン終了時に1体スリープさせることで、相手の攻撃を引き受ける壁になれます。",
    [TUT_END_TURN, TUT_CARD("STD-125", "大盾の騎士", "front")], { type: "end-turn" }, { leavesChoice: true }),
  TUT_STEP("ターンを終了します。『セキュリティ』を持つObは、ターン終了時に1体スリープさせることで、相手の攻撃を引き受ける壁になれます。",
    [TUT_CARD("STD-125", "大盾の騎士", "front")], { type: "answerChoice", cardId: "STD-125" }, { after: "yellow-turn2" }),
  // 4 相手の準備
  TUT_ADVANCE("相手が『歩兵』を出しました。実行したターンは攻撃できません。", [TUT_CARD("STD-020", "歩兵", "front", "ai")]),
  TUT_ADVANCE("OCで強くなった『大盾の騎士』を前に、相手は攻撃を躊躇してそのままターンエンドです！", [TUT_CARD("STD-125", "大盾の騎士", "front")]),
  // 5 華守りと伝令
  TUT_STEP("こちらも反撃です。『伝令』を実行しましょう。", [TUT_CARD("STD-126", "伝令"), BLUE_FRONT], { type: "play", cardId: "STD-126", zone: "front" }),
  TUT_ADVANCE("伝令は、他に『セキュリティ』を持つObがいるので、カードを1枚引けました。", [TUT_CARD("STD-126", "伝令", "front")]),
  // 6 シールドバッシュ
  TUT_ADVANCE("『伝令』の効果で引いたカードを良く見てください！", [TUT_CARD("STD-138", "シールドバッシュ")]),
  TUT_STEP("自分のエリアにある『セキュリティ』は2体。『シールドバッシュ』は、その数に1を足した3ダメージを与えます！",
    [TUT_CARD("STD-138", "シールドバッシュ"), TUT_CARD("STD-025", "ライダー", "front", "ai")], { type: "play", cardId: "STD-138", targetCardId: "STD-025" }),
  TUT_ADVANCE("ライダーを破壊！やりましたね！"),
  // 8 攻撃
  TUT_STEP("では『大盾の騎士』で相手ユーザーに反撃しましょう！", [TUT_CARD("STD-125", "大盾の騎士", "front"), TUT_USER], { type: "attack", cardId: "STD-125", targetType: "fortress" }),
  TUT_ADVANCE("相手ユーザーのSTRは残り2、わずかです！", [TUT_USER]),
  TUT_STEP("念のため『伝令』も守りの体制を構えてターンを渡しましょう", [TUT_END_TURN, TUT_CARD("STD-126", "伝令", "front")], { type: "end-turn" }, { leavesChoice: true }),
  TUT_STEP("念のため『伝令』も守りの体制を構えてターンを渡しましょう", [TUT_CARD("STD-126", "伝令", "front")], { type: "answerChoice", cardId: "STD-126" }, { after: "yellow-turn3" }),
  // 9 相手ターン
  TUT_ADVANCE("相手が騎馬兵を出してきました。"),
  TUT_ADVANCE("『コンタクト』は出たターンでもObを攻撃できる能力です。"),
  TUT_ADVANCE("『大盾の騎士』が倒されてしまいました。"),
  TUT_ADVANCE("しかし、二重の守りのおかげであなたにダメージは届いていません！", [TUT_CARD("STD-126", "伝令", "front")]),
  // 10 フィニッシュ
  TUT_ADVANCE("さぁ、トドメです！"),
  TUT_STEP("今引いてきた『騎士団の凱歌』を起動しましょう！", [TUT_CARD("STD-137", "騎士団の凱歌")], { type: "play", cardId: "STD-137" }, { leavesChoice: true }),
  TUT_STEP("今引いてきた『騎士団の凱歌』を起動しましょう！", undefined, { type: "answerChoice", label: "①自分Obすべてを+2/+2" }),
  TUT_ADVANCE("これで『伝令』のATKは3、相手ユーザーのSTRを0にできます。", [TUT_CARD("STD-126", "伝令", "front")]),
  TUT_STEP("では、相手ユーザーを攻撃しましょう", [TUT_CARD("STD-126", "伝令", "front"), TUT_USER], { type: "attack", cardId: "STD-126", targetType: "fortress" }),
  TUT_STEP("やりましたね！私達の勝利です！▽耐えきって勝つ戦術、これが聖機構騎士団です！", undefined, null)
];

// 黒(ログアウトと破壊・デコード)。文豪の台本 06-黒-台本修正案.md を、修正反映版(06-黒-台本-修正反映.md)の決めに沿って1つずつ1ステップにしている。
// 手順3の「カードを2枚引きました」はログアウトの行より先(4.7.1)、手順6の邪神は「手札の」(判断B)。
// 1行に操作が2つある行(ソロモンのログインでレメゲトンを破壊しフラウロスを出す)は、同じ行を2ステップで出す。邪神との取引の中の選択(破壊する2体、②、対象のメルク)は、
// 1ステップの中でガード(TUTORIAL_STEP_GUARDS)が固定する。
const BLACK_STEPS = [
  // 1 開始
  TUT_ADVANCE("黒のスタートデッキ、チュートリアルです。"),
  TUT_ADVANCE("自分のObを破壊して力に変える、リスクも厭わない諸刃の剣戦術が得意です。", [{ kind: "action", action: "tutorial-advance", label: "開始" }]),
  // 2 怨念人形
  TUT_STEP("まず『怨念人形』をフロントに実行しましょう。メモリ1です。", [TUT_CARD("STD-150", "怨念人形"), BLUE_FRONT], { type: "play", cardId: "STD-150", zone: "front" }),
  TUT_ADVANCE("『ログアウト』はエリアで破壊された時に起動する能力です。", [TUT_CARD("STD-150", "怨念人形", "front")]),
  // 3 執念のコンキスタドール(自分のObを破壊)
  TUT_STEP("次に『執念のコンキスタドール』を実行します。", [TUT_CARD("STD-155", "コンキスタドール"), BLUE_FRONT], { type: "play", cardId: "STD-155", zone: "front" }, { leavesChoice: true }),
  TUT_ADVANCE("『ログイン』能力で自分のOb1体を破壊してカードを2枚引くことができます。", [TUT_CARD("STD-155", "コンキスタドール", "front")]),
  TUT_STEP("破壊するのは『怨念人形』を選びましょう。", [TUT_CARD("STD-150", "怨念人形", "front")], { type: "answerChoice", cardId: "STD-150" }),
  TUT_ADVANCE("そして、カードを2枚引きました。"),
  TUT_ADVANCE("『怨念人形』が破壊されて、『ログアウト』が起動します。相手の『装甲兵 メルク』に1ダメージです！", [TUT_CARD("STD-043", "装甲兵 メルク", "front", "ai")]),
  TUT_STEP("ターンを終了しましょう。", [TUT_END_TURN], { type: "end-turn" }, { after: "black-1" }),
  // 4 レメゲトン&ソロモン
  TUT_STEP("私達のターンですね。では『断章・レメゲトン』を実行してみましょう。", [TUT_CARD("STD-158", "レメゲトン"), { kind: "zone", owner: "player", zone: "back", label: "自分バック" }],
    { type: "play", cardId: "STD-158", zone: "back" }, { leavesChoice: true }),
  TUT_STEP("ログイン能力で『魔術王ソロモン』にアクセスして手札に加えましょう！", undefined, { type: "answerChoice", cardId: "STD-157" }),
  TUT_STEP("そのまま、『ソロモン』を実行しましょう", [TUT_CARD("STD-157", "ソロモン"), BLUE_FRONT], { type: "play", cardId: "STD-157", zone: "front" }, { leavesChoice: true }),
  TUT_STEP("そしてログイン能力も起動です！▽『レメゲトン』を破壊します。▽それを触媒に手札の『豹頭男爵フラウロス』をドラッグします！",
    [TUT_CARD("STD-158", "レメゲトン", "back")], { type: "answerChoice", cardId: "STD-158" }, { leavesChoice: true }),
  TUT_STEP("そしてログイン能力も起動です！▽『レメゲトン』を破壊します。▽それを触媒に手札の『豹頭男爵フラウロス』をドラッグします！",
    [TUT_CARD("STD-156", "フラウロス")], { type: "answerChoice", cardId: "STD-156" }),
  TUT_ADVANCE("ここでひとくち解説です。▽ドラッグで出したObのログイン能力は使えません。", [TUT_CARD("STD-156", "フラウロス", "front")]),
  TUT_ADVANCE("つまりログイン能力は『実行』時だけですね！", [TUT_CARD("STD-156", "フラウロス", "front")]),
  // 5 ターン終了
  TUT_STEP("それではターンを終了してください。", [TUT_END_TURN], { type: "end-turn" }, { after: "black-2" }),
  // 6 ゾンビメイカー(デコード)
  TUT_ADVANCE("私達のターンです。先程破壊した『レメゲトン』の効果が起動して手札に加わっていますね。", [TUT_CARD("STD-158", "レメゲトン")]),
  TUT_ADVANCE("黒にはこのように破壊されても戻ってくるタイプのカードも存在します。", [TUT_CARD("STD-158", "レメゲトン")]),
  TUT_ADVANCE("ばんばん壊しましょう。"),
  TUT_STEP("では『ゾンビメイカー』を実行しましょう。", [TUT_CARD("STD-152", "ゾンビメイカー"), BLUE_FRONT], { type: "play", cardId: "STD-152", zone: "front" }, { leavesChoice: true }),
  TUT_STEP("『ログイン』能力内のキーワード、『デコード』は、ゴミ箱から直接エリアに出す効果です。ゴミ箱にいる『怨念人形』を選んでください。", undefined, { type: "answerChoice", cardId: "STD-150" }),
  TUT_ADVANCE("この効果でデコードされたObは、このターンの終了時に破壊されてしまいますが…", [TUT_CARD("STD-150", "怨念人形", "front")]),
  TUT_ADVANCE("そうなる前に、ゾンビメイカー共々▽手札の『邪神との取引』の弾にしてしまいましょう！", [TUT_CARD("STD-163", "邪神との取引")]),
  TUT_STEP("『邪神との取引』を実行して『ゾンビメイカー』『怨念人形』の2体を選び、②の効果を2回起動させましょう",
    [TUT_CARD("STD-163", "邪神との取引"), TUT_CARD("STD-152", "ゾンビメイカー", "front"), TUT_CARD("STD-150", "怨念人形", "front")], { type: "play", cardId: "STD-163" }),
  TUT_ADVANCE("やった！2体のセキュリティを突破して相手ユーザーの懐はガラ空きです！", [TUT_USER]),
  // 7 とどめ
  TUT_STEP("今のうちに勝負を決めましょう！フラウロスで相手ユーザーを攻撃です。", [TUT_CARD("STD-156", "フラウロス", "front"), TUT_USER], { type: "attack", cardId: "STD-156", targetType: "fortress" }),
  TUT_STEP("やった！私たちの勝利です！", undefined, null)
];

const introSteps = (tutorialId) => tutorialId === "basics" ? INTRO_STEPS : [];
const TUTORIAL_STEPS = Object.freeze({ basics: BASIC_STEPS, blue: BLUE_STEPS, yellow: YELLOW_STEPS, vengeance: VENGEANCE_STEPS, black: BLACK_STEPS });
const tutorialSteps = (tutorialId) => TUTORIAL_STEPS[tutorialId] ?? BASIC_STEPS;

export function createTutorialFlow(tutorialId = "basics") {
  return { tutorialId, introIndex: 0, introComplete: introSteps(tutorialId).length === 0, index: 0, complete: false, error: "", pendingAction: null };
}

export function currentTutorialPresentation(flow) {
  if (!flow?.introComplete) { const intro = introSteps(flow?.tutorialId); return { ...intro[Math.min(flow?.introIndex ?? 0, intro.length - 1)], intro: true }; }
  return currentTutorialStep(flow);
}

export function advanceTutorialIntroduction(flow) {
  if (!flow || flow.introComplete) return false;
  const length = introSteps(flow.tutorialId).length;
  flow.introIndex += 1;
  if (flow.introIndex >= length) {
    flow.introIndex = Math.max(length - 1, 0);
    flow.introComplete = true;
  }
  flow.error = "";
  return true;
}

export function completeTutorialIntroduction(flow) {
  if (!flow) return false;
  flow.introIndex = Math.max(introSteps(flow.tutorialId).length - 1, 0);
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
