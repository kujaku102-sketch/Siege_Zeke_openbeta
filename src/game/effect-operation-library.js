// カード固有名に依存しない、効果処理の共通語彙。
// compiler / trigger specs / UI はこの形へ正規化してから engine に渡す。
export const EFFECT_OPERATION_TYPES = Object.freeze({
  SELECT: "select",
  SELECT_ENTITY: "select_entity",
  SELECT_PLAYER: "select_player",
  DEAL_DAMAGE: "deal_damage",
  DESTROY: "destroy",
  DESTROY_ALL: "destroy_all",
  MOVE: "move",
  MOVE_ALL: "move_all",
  MOVE_EVENT_CARD: "move_event_card",
  MOVE_EVENT_CARDS: "move_event_cards",
  SELECT_EXECUTE_FROM_TRASH: "select_execute_from_trash",
  DISCARD: "discard",
  REMOVE_COMPONENTS: "remove_components",
  SHUFFLE: "shuffle",
  DRAW: "draw",
  RECOVER_MEMORY: "recover_memory",
  INCREASE_MEMORY_LIMIT: "increase_memory_limit",
  RECOVER_DAMAGE: "recover_damage",
  CONSUME_MEMORY: "consume_memory",
  MODIFY_DAMAGE: "modify_damage",
  DECODE: "decode",
  MILL: "mill",
  DRAG: "drag",
  PLACE_NAMED_VIRTUAL: "place_named_virtual",
  GENERATE: "generate",
  GENERATE_AS_LAYER: "generate_as_layer",
  GENERATE_AS_LAYER_FOR_EACH: "generate_as_layer_for_each",
  CONSUME_LAYERS: "consume_layers",
  REPEAT_SELECT_MOVE: "repeat_select_move",
  MOVE_EACH_DECK_TOP_AS_LAYER: "move_each_deck_top_as_layer",
  APPLY_NUMBERED_EFFECT: "apply_numbered_effect",
  GRANT_KEYWORD: "grant_keyword",
  MODIFY_STATS: "modify_stats",
  MODIFY_EXECUTION_COST: "modify_execution_cost",
  ADD_COUNTER: "add_counter",
  CHOOSE_EFFECT: "choose_effect",
  CHOOSE_ZONE: "choose_zone",
  STANDBY: "standby",
  SLEEP: "sleep",
  ACCESS: "access",
  SWAP: "swap",
  SET_FLAG: "set_flag",
  SCHEDULE_DELAYED: "schedule_delayed"
});

// 対象ユーザーが明記されていない効果は、敵味方を問わずエリア全体を既定範囲とする。
export function selector({ owner = "both", zones = ["area"], category = null, count = 1, ...filters } = {}) {
  return { owner, zones, category, count, visibility: "public", ...filters };
}

export function operation(type, options = {}) {
  if (!Object.values(EFFECT_OPERATION_TYPES).includes(type)) throw new Error(`Unknown effect operation: ${type}`);
  return Object.freeze({ type, ...options });
}

export function deckMovePolicy({ direction = "into_deck", position = "unspecified", shuffle = null } = {}) {
  if (shuffle === false || direction !== "into_deck") return { shuffleAfter: false };
  if (["top", "bottom"].includes(position)) return { shuffleAfter: false };
  return { shuffleAfter: true };
}

export function accessPolicy({ destination = "hand", position = null } = {}) {
  return Object.freeze({
    search: "deck",
    shuffleRemainingDeck: true,
    destination,
    position,
    sequence: ["search", "shuffle_remaining_deck", "move_accessed_card"]
  });
}

export function destructionOutcome({ attempted = true, determined = false, replacement = null, completed = false, negated = false, lastKnownInformation = null } = {}) {
  return Object.freeze({
    attempted,
    determined: Boolean(determined && !negated),
    replaced: replacement !== null,
    replacement,
    completed: Boolean(completed && !negated),
    negated,
    lastKnownInformation,
    succeededForDidClause: Boolean(determined && !negated)
  });
}

// 実績件数を参照する後続効果は、0件を値として実行しない。
// 0枚ドロー等を呼び出すと、将来イベント化した際に空イベントが誘発源になるため、
// 共通境界で依存ブロックそのものを短絡する。
export function resultCountGate(actualCount) {
  const count = Number.isFinite(Number(actualCount)) ? Math.max(0, Math.trunc(Number(actualCount))) : 0;
  return Object.freeze({ count, shouldResolveDependentBlock: count > 0, zeroBehavior: "skip_dependent_block" });
}

export function describeOperation(item) {
  const amount = item.amount ?? item.value ?? "";
  const descriptions = {
    select: `対象を選択（${item.selector?.owner ?? "both"}/${item.selector?.zones?.join(",") ?? "area"}）`,
    select_entity: `${item.scope ?? "entity"}から対象を選択`,
    select_player: "ユーザーを選択",
    deal_damage: `${item.target}へ${amount}ダメージ`,
    destroy: `${item.target ?? "selected"}を破壊`,
    destroy_all: `${item.target ?? "selected"}をすべて破壊`,
    move: `${item.target ?? "selected"}を${item.destination}へ移動`,
    move_all: `${item.source}すべてを${item.destination}へ移動`,
    move_event_cards: `イベント対象を${item.destination}へ移動`,
    select_execute_from_trash: "ゴミ箱から条件に合うカードを選んで起動",
    discard: `${item.target ?? "selected"}を捨てる`,
    shuffle: `${item.target ?? "deck"}をシャッフル`,
    draw: `${amount}枚ドロー`,
    recover_memory: `メモリを${amount}回復`,
    increase_memory_limit: `メモリ上限を${amount}増加`,
    recover_damage: `${item.target ?? "self_user"}のダメージを${amount}回復`,
    consume_memory: `${item.target ?? "self"}のメモリを可能な限り${amount}消費`,
    modify_damage: `${item.direction}ダメージを${amount}修正`,
    decode: `ゴミ箱からObを${item.maximum ?? item.count ?? 1}体までエリアへ配置`,
    mill: `山札の上から${amount}枚をゴミ箱へ送る`,
    drag: `${item.target ?? "selected"}を${item.destination}へドラッグ`,
    place_named_virtual: `${item.cardName}を${item.count ?? 1}体配置`,
    generate: `${item.cardId ?? item.cardName}を${item.count ?? 1}枚生成`,
    apply_numbered_effect: `効果${item.effectNumber}を適用`,
    grant_keyword: `${item.target ?? "selected"}へ[${item.keyword}]を${amount}付与`,
    modify_stats: `${item.target}を${item.atk ?? 0}/${item.str ?? 0}修正`,
    modify_execution_cost: `${item.target}の実行メモリを${amount}修正`,
    add_counter: `${item.target}へ${item.counter}を${amount}追加`,
    choose_zone: `${item.target ?? "source"}の移動先を選択`,
    standby: `${item.target}をスタンバイ`,
    access: `${item.target ?? "deck"}へアクセス`,
    swap: "選択した位置を交換",
    schedule_delayed: `${item.event ?? "指定時点"}に遅延処理を予約`
  };
  return descriptions[item.type] ?? item.type;
}
