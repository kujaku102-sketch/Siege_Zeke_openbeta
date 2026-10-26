
export const TUTORIAL_SPEAKER = "じぐさぽ";
// どのチュートリアルも、相手ユーザーのSTR5から始めて0にして勝つ流れで終える。engine.js の初期配置がこの値を使う。
export const TUTORIAL_OPPONENT_STR = 5;
export const TUTORIAL_OPPONENT_SCRIPTS = Object.freeze({
  'yellow-demo': Object.freeze([{type:'install',cardId:'STD-125'}, {type:'executeCard',cardId:'STD-131',zone:'front'}, {type:'endTurn'}]),
  'yellow-pass': Object.freeze([{type:'endTurn'}])
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
    text: "赤デッキを渡す。まずDoors ZXを起動してみる。『開始』を押して。",
    focus: [{ kind: "action", action: "tutorial-advance", label: "開始" }, { kind: "fortress", owner: "player", label: "自分のDoors ZX" }],
    expect: { type: "advance" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "赤カードを使うには赤シンボルが要る。手札の『こそ泥』を選び、レジストリへインストール。",
    focus: [{ kind: "card", cardId: "STD-076", owner: "player", zone: "hand", label: "こそ泥" }, { kind: "admin", owner: "player", zone: "registry", label: "レジストリ" }],
    expect: { type: "install", cardId: "STD-076" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "メモリ1で『ジャンキー』をフロントへ実行。[QA]だから今すぐ殴れる。",
    focus: [{ kind: "card", cardId: "STD-075", owner: "player", zone: "hand", label: "ジャンキー" }, { kind: "zone", owner: "player", zone: "front", label: "自分フロント" }],
    expect: { type: "play", cardId: "STD-075" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "ジャンキーで相手のDoors ZXを攻撃。相手フロントに壁はいない。",
    focus: [{ kind: "card", cardId: "STD-075", owner: "player", zone: "front", label: "ジャンキー" }, { kind: "fortress", owner: "ai", label: "相手ユーザー" }],
    expect: { type: "attack", cardId: "STD-075", targetType: "fortress" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "ターン終了。攻撃したジャンキーは終了時効果で自壊する。黄側の準備は自動で進める。",
    focus: [{ kind: "card", cardId: "STD-075", owner: "player", zone: "front", label: "ジャンキー" }, { kind: "action", action: "end-turn", label: "ターン終了" }],
    expect: { type: "end-turn" },
    after: "yellow-demo"
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "黄側は『華守り』をスリープして[セキュリティ]を構えた。『サプライヤー・カネコ』をフロントへ実行して、アクセスしたジャンクパーツの配置先も選んで。Codeは単体で場に残る。",
    focus: [{ kind: "card", cardId: "STD-090", owner: "player", zone: "hand", label: "カネコ" }, { kind: "zone", owner: "player", zone: "front", label: "自分フロント" }, { kind: "card", cardId: "STD-131", owner: "ai", zone: "front", label: "華守り" }],
    expect: { type: "play", cardId: "STD-090", zone: "front" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "QAも[コンタクト]もないカネコは、実行したターンには攻撃できない。ターンを終了して黄側を自動でパスさせる。",
    focus: [{ kind: "card", cardId: "STD-090", owner: "player", zone: "front", label: "カネコ" }, { kind: "action", action: "end-turn", label: "ターン終了" }],
    expect: { type: "end-turn" },
    after: "yellow-pass"
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "次の自ターンになった。カネコで相手Doors ZXへ攻撃してみろ。対象はスリープ中のセキュリティへ変更される。",
    focus: [{ kind: "card", cardId: "STD-090", owner: "player", zone: "front", label: "カネコ" }, { kind: "card", cardId: "STD-131", owner: "ai", zone: "front", label: "セキュリティ" }, { kind: "fortress", owner: "ai", label: "攻撃宣言先" }],
    expect: { type: "attack", cardId: "STD-090" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "最後。『グレンのラッキー☆ショット』を華守りへ実行。3ダメージ後のダイアログで任意追加効果を選べる。使うなら自分エリアのカードも選択。",
    focus: [{ kind: "card", cardId: "STD-086", owner: "player", zone: "hand", label: "ラッキー☆ショット" }, { kind: "card", cardId: "STD-131", owner: "ai", zone: "front", label: "華守り" }],
    expect: { type: "play", cardId: "STD-086", targetCardId: "STD-131" }
  },
  {
    speaker: TUTORIAL_SPEAKER,
    text: "ここまで。実行先選択、QA、セキュリティ、マウント、任意追加効果まで動いた。以降は自由操作。カードを選べば左の詳細欄からリログもできる。",
    expect: null
  }
];

const VENGEANCE_STEPS = [
  {
    speaker: TUTORIAL_SPEAKER,
    text: "ヴェンジェンスはObの移動とレイヤードを使う。まず『開始』を押して盤面を確認。",
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
    text: "終了。ヴェンジェンスの基本は、生成したドールズを素材・移動元の穴埋め・攻撃役へ使い回すこと。以降は自由操作。",
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
