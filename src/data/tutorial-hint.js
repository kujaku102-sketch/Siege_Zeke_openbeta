import { CARD_LIBRARY } from "./cards.js";
import { currentTutorialStep } from "./tutorial-script.js";

// 操作待ちの手順で、セリフを閉じたあとも画面に出し続ける「〇〇をしよう」。台本には書かず、手順の `expect` から作る。
// 絞り込みのある手順(TUTORIAL_STEP_GUARDS の `action`)は、その対象も文面に入れる。

// 台本が呼ぶ短い名前: 「警戒機用素体S型 フラウ」→「フラウ」、「マーダードールズ=トライプビア」→「トライプビア」、「/オフェンスプロトコル/*」→「オフェンスプロトコル」。
export function tutorialCardName(cardId) {
  const full = CARD_LIBRARY[cardId]?.name ?? cardId;
  const bare = full.replace(/^\/(.*)\/\*?$/, "$1");
  return bare.split(/[ 　=＝]/).filter(Boolean).pop() ?? bare;
}

const quoted = (cardId) => `『${tutorialCardName(cardId)}』`;
const ZONE_NAME = Object.freeze({ front: "フロント", back: "バック" });

function pressHint(step, expect) {
  if (expect.press === "info-button") return "情報ボタンを押そう";
  if (expect.press === "ability-badge") {
    const badge = step.focus?.find((item) => item.kind === "ui" && item.target === "ability-badge")?.badge ?? "アビリティ";
    return `${quoted(expect.cardId)}の${badge}バッジを押そう`;
  }
  if (expect.press === "card-detail") return `${quoted(expect.cardId)}の詳細を開こう`;
  return "光っているところを押そう";
}

function playHint(expect) {
  const name = quoted(expect.cardId);
  if (expect.hostCardId) return `${name}を${quoted(expect.hostCardId)}にマウントしよう`;
  if (expect.targetCardId) return `${name}を${quoted(expect.targetCardId)}に使おう`;
  if (CARD_LIBRARY[expect.cardId]?.category === "Ob") {
    return expect.zone ? `${name}を${ZONE_NAME[expect.zone] ?? ""}に実行しよう` : `${name}を実行しよう`;
  }
  return `${name}を使おう`;
}

// 手順 `step` の期待操作を求める一文。進めるだけの手順(`advance` で押す対象もないもの)と、最後の締めの手順は空文字。
// `guard` はその手順の TUTORIAL_STEP_GUARDS の項目(なければ null)。
export function tutorialActionHint(step, guard = null) {
  const base = step?.expect;
  if (!base) return "";
  if (base.type === "advance") return base.press ? pressHint(step, base) : "";
  const expect = { ...base, ...guard?.action };
  const name = expect.cardId ? quoted(expect.cardId) : "";
  const zone = ZONE_NAME[expect.zone] ?? "";
  switch (expect.type) {
    case "install": return `${name}をインストールしよう`;
    case "play": return playHint(expect);
    case "attack":
      if (expect.targetCardId) return `${name}で${quoted(expect.targetCardId)}を攻撃しよう`;
      return expect.targetType === "fortress" ? `${name}で相手ユーザーを攻撃しよう` : `${name}で攻撃しよう`;
    case "end-turn": return "ターンを終了しよう";
    case "answerChoice": return `${name}を選ぼう`;
    case "layered": return `${name}を${zone}にレイヤードしよう`;
    case "relog": return `${name}を${zone}へリログしよう`;
    case "activate-effect": return expect.targetCardId ? `${name}の効果を${quoted(expect.targetCardId)}を対象に発動しよう` : `${name}の効果を発動しよう`;
    case "registry-execute": return `${name}をレジストリから実行しよう`;
    case "registry-recover": return `${name}をレジストリから戻そう`;
    case "script-activate": return `${name}のスクリプトを発動しよう`;
    case "turbo": return `${name}のターボを発動しよう`;
    default: return name ? `${name}を操作しよう` : "";
  }
}

// いまの手順の文面。導入中・終了後・進めるだけの手順は空文字。`guards` は TUTORIAL_STEP_GUARDS(の全体)。
export function currentTutorialHint(flow, guards = {}) {
  if (!flow?.introComplete || flow.complete) return "";
  return tutorialActionHint(currentTutorialStep(flow), guards[flow.tutorialId]?.[flow.index] ?? null);
}
