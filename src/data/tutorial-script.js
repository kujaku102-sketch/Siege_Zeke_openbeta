
export const TUTORIAL_SPEAKER = "じぐさぽ";
// どのチュートリアルも、相手ユーザーのSTR5から始めて0にして勝つ流れで終える。engine.js の初期配置がこの値を使う。
export const TUTORIAL_OPPONENT_STR = 5;
// 赤チュートリアルの初手(文豪の台本)。「兵士」は台本の呼び名で、メモリ2・無色の剣士(STD-021)を当てている。
export const TUTORIAL_SOLDIER_ID = "STD-021";
export const TUTORIAL_RED_HAND = Object.freeze(["STD-087", TUTORIAL_SOLDIER_ID, "STD-091", "STD-078"]);
export const TUTORIAL_OPPONENT_SCRIPTS = Object.freeze({
  'yellow-demo': Object.freeze([{type:'install',cardId:'STD-125'}, {type:'executeCard',cardId:'STD-131',zone:'front'}, {type:'endTurn'}]),
  'yellow-pass': Object.freeze([{type:'endTurn'}]),
  // 赤チュートリアル: 相手はセキュリティのObガードマンを実行し、スリープさせてターンを終える。
  'guardman-demo': Object.freeze([{type:'executeCard',cardId:'STD-022',zone:'front'}, {type:'endTurn'}])
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
    text: "では、まずカードを出してみましょう。ここでは手札のOb(オブジェクト)を使います。Obは他のゲームではモンスター・クリーチャーに分類されるカテゴリです。これらの攻撃で相手の耐久力、つまりSTRを0にすることで勝利します。",
    focus: [{ kind: "card", cardId: "STD-021", owner: "player", zone: "hand", label: "兵士" }, { kind: "card", cardId: "STD-091", owner: "player", zone: "hand", label: "アツト" }, { kind: "fortress", owner: "ai", label: "相手ユーザー" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "もう一枚、違うカテゴリのカードがありますよ。これはCode。装備やフィールド、といった分類になるカテゴリです。Obや他のカテゴリのカードと組み合わせることができ、戦略の幅を広げられます！ちなみに、この『ジャンクパーツ』にはスタッツ(ATK/STR)への補正値がついているのでマウントしている限りObに対して『+1/+1』の補正を与えます。",
    focus: [{ kind: "card", cardId: "STD-078", owner: "player", zone: "hand", label: "ジャンクパーツ" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "では、実際にObを出してみましょう。今はアクティブメモリ(使用可能)が5あるから、メモリ2の『兵士』と『切込隊長アツト』をそれぞれ出してみましょう。この操作を『実行』と呼びます！では『兵士』を出してみましょう。",
    focus: [{ kind: "card", cardId: "STD-021", owner: "player", zone: "hand", label: "兵士" }, { kind: "zone", owner: "player", zone: "front", label: "自分フロント" }],
    expect: { type: "play", cardId: "STD-021", zone: "front" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "2メモリを支払うことで実行が完了しました。では『アツト』を出してみましょう。",
    focus: [{ kind: "card", cardId: "STD-091", owner: "player", zone: "hand", label: "アツト" }, { kind: "button", button: "play", cardId: "STD-091", label: "実行(出せないことを確かめる)" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "……あれ、出せませんね？ごめんなさい！『シンボルが点灯』していませんでした！左端のこの領域、『レジストリ』が見えますか？ここにカードをインストールすることで、その色に対応したシンボルが点灯します。こうすることで、その色のカードは使用可能になります！",
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
    text: "情報ボタンを押してみてください。あと6色分のシンボルが見えますね、他にもいろいろ・・・",
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
    text: "これで『兵士』と『アツト』が実行されましたね。『アツト』が『兵士』と比べて枠の色が違うのに気づきましたか？そう、緑枠。つまり『攻撃可能』です。通常、Obは配置してから1ターン待たないと攻撃できませんが『アツト』は『QA』を持っています。横のカード詳細から能力バッジを押して解説を見てください。",
    focus: [{ kind: "card", cardId: "STD-091", owner: "player", zone: "front", label: "アツト" }, { kind: "ui", target: "ability-badge", cardId: "STD-091", badge: "QA", label: "QAバッジ" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "これを持っている『アツト』はすぐに攻撃できます！さっそく攻撃してみましょう！Obを押してみると行動のメニューが出てきます。まずは『攻撃』を押してみましょう！攻撃対象が選べます。ここでは、相手ユーザーを選びましょう。",
    focus: [{ kind: "card", cardId: "STD-091", owner: "player", zone: "front", label: "アツト" }, { kind: "fortress", owner: "ai", label: "相手ユーザー" }],
    expect: { type: "attack", cardId: "STD-091", targetType: "fortress" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "攻撃成功！ダメージが通り、相手ユーザーのSTRが削れました。では、ここでターンを終了しましょう。",
    focus: [{ kind: "action", action: "end-turn", label: "ターン終了" }],
    expect: { type: "end-turn" },
    after: "guardman-demo"
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "ターンの開始時には1枚ドロー！スリープしていたObのスタンバイが行われ、アクティブメモリも上限まで回復します。そして、相手のエリアには『セキュリティ』を持ったObが配置されています。これがスリープしている間、攻撃対象はスリープしたObだけが可能になります。つまり、相手ユーザーへの攻撃が届きません。しかも、STRは4と高いです。ここでCodeを使ったパワーアップを説明します！手札にある『ジャンクパーツ』をご覧ください！",
    focus: [{ kind: "card", cardId: "STD-022", owner: "ai", zone: "front", label: "ガードマン" }, { kind: "card", cardId: "STD-078", owner: "player", zone: "hand", label: "ジャンクパーツ" }, { kind: "ui", target: "card-detail", cardId: "STD-078", label: "ジャンクパーツの詳細" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "これをObの下に実行し、マウントすることでそのObはATKとSTRが1ずつ上がります！では、『アツト』の下に『ジャンクパーツ』を実行しましょう！",
    focus: [{ kind: "card", cardId: "STD-078", owner: "player", zone: "hand", label: "ジャンクパーツ" }, { kind: "card", cardId: "STD-091", owner: "player", zone: "front", label: "アツト" }],
    expect: { type: "play", cardId: "STD-078", zone: "front" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "これで『アツト』のATKは4、相手のObを倒せるパワーになりましたね。Obに攻撃してみましょう！",
    focus: [{ kind: "card", cardId: "STD-091", owner: "player", zone: "front", label: "アツト" }, { kind: "card", cardId: "STD-022", owner: "ai", zone: "front", label: "ガードマン" }],
    expect: { type: "attack", cardId: "STD-091", targetCardId: "STD-022" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "Obに対して攻撃すると、『戦闘』に入ります。『戦闘』では、お互いにATK分のダメージを与え合います。そして、これでSTRが0になったObは破壊されます。今回の戦闘で相手のObを破壊できました。これで『セキュリティ』がいなくなり、相手ユーザーを攻撃対象に選べるようになりました！",
    focus: [{ kind: "card", cardId: "STD-021", owner: "player", zone: "front", label: "兵士" }, { kind: "fortress", owner: "ai", label: "相手ユーザー" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "では、『兵士』で相手ユーザーを攻撃してSTRを0にしてしまいましょう！",
    focus: [{ kind: "card", cardId: "STD-021", owner: "player", zone: "front", label: "兵士" }, { kind: "fortress", owner: "ai", label: "相手ユーザー" }],
    expect: { type: "attack", cardId: "STD-021", targetType: "fortress" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "やりましたね！これで私達の勝利です！",
    expect: null
  }
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

const tutorialSteps = (tutorialId) => tutorialId === "vengeance" ? VENGEANCE_STEPS : BASIC_STEPS;

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
