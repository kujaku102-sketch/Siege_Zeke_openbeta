import { isObCard } from './card-types.js';

export const DECK_EVALUATION_AXES = Object.freeze([
  'body','pressure','removal','disruption','draw','resource','defense','registry','layered','script','damage','sustain',
  'early','mid','late'
]);

// Manual corrections live here instead of contaminating the rules data.
// Add only evidence-backed exceptions; every other card uses the common evaluator.
export const CARD_EVALUATION_OVERRIDES = Object.freeze({
  'STD-001': Object.freeze({ removal:1, disruption:.5, reliability:.75 }),
  'STD-002': Object.freeze({ removal:3, reliability:.45 })
});

const has = (text, terms) => terms.some(term => text.includes(term));
const value = (condition, amount = 1) => condition ? amount : 0;

export function evaluateCardForDeck(card) {
  const text = `${card.name ?? ''} ${card.text ?? ''}`;
  const cost = Number(card.cost ?? 0);
  const body = isObCard(card);
  const inferred = {
    body:value(body),
    pressure:value(body,Math.max(.25,Number(card.atk ?? 0) / 3)) + value(has(text,['[QA]','[コンタクト]','攻撃時']),.8),
    removal:value(has(text,['破壊する','BANする','ゴミ箱に送る']),has(text,['すべて','全て']) ? 2.5 : 1),
    disruption:value(has(text,['スリープ','起動できない','攻撃できない','無効','使用不可']),1),
    draw:value(has(text,['カードを1枚引く','1枚ドロー']),1) + value(has(text,['アクセスする','アクセスし']),.65),
    resource:value(has(text,['メモリ上限','使用可能メモリ','消費メモリを-','コストを-']),1),
    defense:value(has(text,['セキュリティ','プロテクト','暗号化','ファイアウォール']),1),
    registry:value(has(text,['レジストリ','インストール']),1),
    layered:value(has(text,['レイヤード','レイヤー','マウント','オーバーライド']) || card.printedCategory === 'LOb',1),
    script:value(card.category === 'Script',1) + value(has(text,['Script','スクリプト']),.4),
    damage:value(has(text,['ダメージを与える','ダメージ与える','ダメージを受ける']),1) + Math.max(0,Number(card.atk ?? 0)) / 5,
    sustain:value(has(text,['回復','バックアップ','STRを+','STR+']),1) + Math.max(0,Number(card.str ?? 0)) / 8,
    early:value(cost <= 2),mid:value(cost >= 3 && cost <= 4),late:value(cost >= 5),
    reliability:has(text,['[条件:','[if:','時]','なら']) ? .72 : 1
  };
  return Object.freeze({ ...inferred, ...(CARD_EVALUATION_OVERRIDES[card.id] ?? {}) });
}

const profile = (targets, weights = {}) => Object.freeze({ targets:Object.freeze(targets), weights:Object.freeze(weights) });
export const DECK_STRATEGY_PROFILES = Object.freeze({
  balanced:profile({body:.45,removal:.10,draw:.08,defense:.08,early:.25,mid:.35,late:.12}),
  rush:profile({body:.58,pressure:.28,damage:.12,early:.45,mid:.28},{pressure:1.35,early:1.25}),
  control:profile({removal:.18,disruption:.16,draw:.12,defense:.12,mid:.30,late:.18},{removal:1.4,disruption:1.3}),
  registry:profile({registry:.28,body:.42,draw:.10,mid:.32},{registry:1.6}),
  layered:profile({layered:.25,body:.48,defense:.10,mid:.34},{layered:1.7}),
  script:profile({script:.30,draw:.12,removal:.12,resource:.08,early:.22,mid:.36},{script:1.6}),
  security:profile({defense:.28,body:.46,sustain:.12,mid:.32},{defense:1.65}),
  damage:profile({damage:.25,pressure:.25,body:.50,early:.34},{damage:1.55,pressure:1.3}),
  endurance:profile({sustain:.24,defense:.22,body:.48,draw:.08,mid:.34},{sustain:1.6,defense:1.35}),
  class_synergy:profile({body:.52,draw:.08,early:.24,mid:.34},{body:1.1})
});

export function strategyTargets(strategy, deckSize) {
  const selected = DECK_STRATEGY_PROFILES[strategy] ?? DECK_STRATEGY_PROFILES.balanced;
  return Object.freeze(Object.fromEntries(Object.entries(selected.targets).map(([axis,ratio]) => [axis,ratio * deckSize])));
}
