import { compileSelectionModules } from "./effect-selection-modules.js";

const KEYWORD_PATTERNS = [
  ["QA", /\[(?:QA|クイックアクション)\]/g],
  ["SECURITY", /\[セキュリティ\]/g],
  ["BACKUP", /\[バックアップ\]/g],
  ["CONTACT", /\[コンタクト\]/g],
  ["HACKING", /\[ハッキング\]/g],
  ["ENCRYPTION", /\[暗号化\]/g],
  ["DECOY", /\[デコイ\]/g],
  ["DISCONNECT", /\[切断\]/g],
  ["FIREWALL", /\[ファイアウォール\]/g],
  ["ACCESS_RESTRICTION", /\[アクセス制限\]/g],
  ["TRANSFORM_RELEASE", /\[変身解除\]/g],
  ["PROTECT", /\[(?:プロテクト|装甲)(?:[:：](\d+))?\]/g, "number"],
  ["PROXY", /\[プロキシ[:：](\d+)\]/g, "number"],
  ["LOGIN", /\[ログイン\]/g],
  ["LOGOUT", /\[ログアウト\]/g],
  ["LAYERED", /\[レイヤード[:：]([^\]]+)\]/g, "text"],
  ["RESIDENT", /\[レジデント\]/g],
  ["IF", /\[(?:if|条件)[:：]([^\]]+)\]/gi, "text"],
  ["RESPONSE", /\[レスポンス[:：]\s*(\d+)\]/g, "number"],
  ["UPDATE", /\[アップデート[:：]\s*(\d+)\]/g, "number"],
  ["OVERRIDE", /\[オーバーライド[:：]\s*(\d+)?X\]/gi, "number"],
  ["OC", /\[OC\+(\d+)\]/g, "number"],
  ["MAGAZINE", /\[弾倉[:：]\s*(\d+)\]/g, "number"]
];

const ZONE_WORDS = [
  ["registry", "レジストリ"], ["trash", "ゴミ箱"], ["deck", "山札"], ["hand", "手札"],
  ["front", "フロント"], ["back", "バック"], ["area", "エリア"], ["ban", "BAN"]
];

export function normalizeEffectText(sourceText = "") {
  return String(sourceText)
    .replaceAll("**", "")
    .replaceAll("ｰ", "-")
    .replace(/\[ログイン(?=\s*カード)/g, "[ログイン]")
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/\s*。\s*/g, "。")
    .trim();
}

export function normalizeCardCategory(category = "") {
  const value = String(category).trim();
  return /^(?:Sc|Script)$/i.test(value) ? "Script" : value;
}

function allMatches(text, pattern) {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)];
}

function parseKeywords(text) {
  const keywords = [];
  for (const [name, pattern, valueType] of KEYWORD_PATTERNS) {
    for (const match of allMatches(text, pattern)) {
      const raw = match[1] ?? null;
      const prefix = text.slice(0, match.index).replace(/\[[^\]]+\]/g, "").trim();
      // Activation headers can start a separate ability after another ability's text.
      const activationHeader = ["LOGIN", "LOGOUT", "UPDATE", "IF", "RESPONSE", "RESIDENT", "PROXY", "OC", "MAGAZINE"].includes(name)
        && /^(?:\s|[①②③④⑤⑥⑦⑧⑨⑩])*$/.test(text.slice(text.lastIndexOf("。", match.index - 1) + 1, match.index));
      keywords.push({ name, value: raw === null ? null : valueType === "number" ? Number(raw) : raw, intrinsic: prefix === "" || activationHeader, index: match.index });
    }
  }
  return keywords.sort((a, b) => a.index - b.index).map(({ index: _index, ...keyword }) => keyword);
}

function parseTrigger(clause, keywords) {
  const triggerKeywords = keywords.filter(({ name }) => ["LOGIN", "LOGOUT", "UPDATE", "IF", "RESPONSE", "RESIDENT"].includes(name));
  if (triggerKeywords.length) return triggerKeywords.map(({ name, value }) => ({ type: name.toLowerCase(), value }));
  const layerThreshold = clause.match(/このObのレイヤーが(\d+)枚以下になった時/);
  if (layerThreshold) {
    return [{
      type: "layer_count_threshold",
      comparator: "<=",
      value: Number(layerThreshold[1]),
      countMode: "stack_including_source",
      timing: "after_current_effect_resolution"
    }];
  }
  if (/(?:このカード|このOb)がマウントしていない時/.test(clause)) {
    return [{
      type: "state_condition",
      condition: { sourceMounted: false, mountType: "Code" },
      checkTiming: ["after_area_entry", "after_state_change"],
      mandatory: true
    }];
  }
  const patterns = [
    ["moved", /これが(?:エリアを)?移動した時|これが移動した場合/],
    ["turn_end", /ターン終了時/],
    ["turn_start", /ターン開始時/],
    ["attack", /攻撃時|攻撃する時|攻撃宣言時/],
    ["attacked", /攻撃される時/],
    ["card_executed", /カードを実行した時/],
    ["ob_mounted_on_source", /これにObがマウントした時/],
    ["destroyed", /破壊された時|破壊される時/]
    ,["mandatory_rule_draw", /(?:ルールによる)?最初の(?:1枚の)?ドローでこれを引いたなら/]
  ];
  return patterns.filter(([, pattern]) => pattern.test(clause)).map(([type]) => ({ type, value: null }));
}

function parseResultReference(clause) {
  if (/破壊した(?:カードの)?枚数|破壊した数だけ/.test(clause)) {
    return { type: "recorded_operation_count", operation: "destroy", countField: "attemptedCount", record: "destroy_attempts", gate: { minimum: 1, zeroBehavior: "skip_dependent_block" } };
  }
  if (/こうして破壊したOb一体につき/.test(clause)) {
    return { type: "recorded_operation_count", operation: "destroy", countField: "attemptedCount", record: "destroyed_ob_attempts", filter: { category: "Ob" }, gate: { minimum: 1, zeroBehavior: "skip_dependent_block" } };
  }
  if (/^そうしたら/.test(clause)) return { type: "previous_resolution_group_succeeded" };
  if (/破壊したなら/.test(clause)) return { type: "operation_succeeded", operation: "destroy", successField: "determined", includeReplacement: true };
  const didMatch = clause.match(/([^。]+?)したなら/);
  if (didMatch) return { type: "operation_succeeded", operationText: didMatch[1].trim() };
  if (/その後.*だった場合/.test(clause)) return { type: "last_known_property", dependsOnOperationSuccess: false, count: "attempted_targets" };
  if (/こうしてゴミ箱に送られた/.test(clause)) return { type: "recorded_actual_arrivals", record: "milled_to_trash", destination: "trash", excludeReplacedDestinations: true };
  if (/こうしてドラッグしたなら/.test(clause)) return { type: "operation_succeeded", operation: "drag", requireCompletedMove: true };
  if (/こうして破壊したなら/.test(clause)) return { type: "operation_succeeded", operation: "destroy", successField: "determined", includeReplacement: true };
  return null;
}

function inferSelector(fragment) {
  const owner = /お互い/.test(fragment) ? "both" : /相手/.test(fragment) ? "enemy" : "self";
  const zones = ZONE_WORDS.filter(([, word]) => fragment.includes(word)).map(([zone]) => zone);
  const categoryUnion = /Ob(?:または|か)Code|Code(?:または|か)Ob/.test(fragment) ? ["Ob", "Code"] : null;
  const category = categoryUnion ? null : /Ob/.test(fragment) ? "Ob" : /Sp/.test(fragment) ? "Sp" : /Code/.test(fragment) ? "Code" : null;
  const countMatch = fragment.match(/(\d+)(?:体|枚)/);
  const memoryMaximum = fragment.match(/(?:元々の)?メモリ(\d+)以下/)?.[1] ?? null;
  const quoted = fragment.match(/[「『]([^」』]+)[」』]/)?.[1] ?? null;
  const className = fragment.match(/クラス[:：]([^\s「『]+?)(?=(?:の|カード|Ob|Sp|Code|\d|$))/)?.[1] ?? null;
  const nameGroup = fragment.match(/名称[:：]([^\s「『]+?)(?=(?:の|カード|Ob|Sp|Code|\d|$))/)?.[1] ?? null;
  return {
    owner,
    zones: zones.length ? zones : ["area"],
    visibility: zones.includes("hand") || zones.includes("deck") ? "private_allowed" : "public",
    category,
    ...(categoryUnion ? { categories: categoryUnion } : {}),
    cardName: quoted,
    className,
    nameGroup,
    count: countMatch ? Number(countMatch[1]) : /すべて|全て/.test(fragment) ? "all" : 1,
    maximum: /まで/.test(fragment) ? Number(countMatch?.[1] ?? 1) : null,
    ...(memoryMaximum === null ? {} : { originalMemoryMaximum: Number(memoryMaximum) })
  };
}

function parseOperations(clause, context = {}) {
  const operations = [];
  const lifetime = context.category === "P-in" ? "source_bound" : /このターン/.test(clause) ? "turn" : "unspecified";
  const selectPattern = /((?:自分|相手|お互い)[^。①②]*?(?:Ob|Sp|Code|カード)[^。①②]*?(?:\d+(?:体|枚)|すべて|全て|任意の枚数)?)(?:を選び|を選ぶ|を指定)/g;
  const decoyReminder = /\[デコイ\].*相手が効果でカードを選ぶ時/.test(clause);
  if (/攻撃する時、レイヤーを1枚破棄することでこれをスタンバイする/.test(clause)) operations.push({ type: "pay_layer_then", count: 1, optional: true, trigger: "attack", followUp: { type: "standby", target: "source" } });
  if (/戦闘する時、レイヤー1枚を破棄して$/.test(clause)) operations.push({ type: "pay_layer_then", count: 1, optional: true, trigger: "battle", activatesEffectNumber: 1 });
  if (/①受けるダメージを1にする/.test(clause)) operations.push({ type: "replace_damage", target: "source", event: "current_battle_incoming", value: 1 });
  if (/このObのレイヤーにしたLyd-Ob1体につき$/.test(clause)) operations.push({ type: "repeat_numbered_effect", effectNumber: 1, countFrom: { source: "source_layers", category: "Lyd-Ob" } });
  if (/攻撃時、このObのレイヤー1枚をゴミ箱に送って$/.test(clause)) operations.push({ type: "pay_layer_then", count: 1, optional: true, trigger: "attack", destination: "trash", activatesEffectNumber: 1 });
  if (/レイヤーが1枚以下のこのObは破壊される/.test(clause)) operations.push({ type: "destroy", target: "source", condition: { layerCountMaximum: 1 }, timing: "mandatory_state_check" });
  if (/レイヤーに対応するカード1枚をゴミ箱から選び、1番下のレイヤーに加える/.test(clause)) operations.push({ type: "attach_corresponding_layer", source: "trash", target: "selected_lyd_ob", position: "bottom", count: 1 });
  if (/公開し続けている限り、そのObを配置するために消費するメモリは1になる/.test(clause)) operations.push({ type: "replace_execution_cost", target: "revealed_lyd_ob", value: 1, lifetime: "while_revealed" });
  for (const match of allMatches(clause, /[「『]ジャンクパーツ[」』](\d+)(?:枚|体)を配置する/g)) operations.push({ type: "generate", cardName: "ジャンクパーツ", count: Number(match[1]), destination: "choose_area" });
  if (!decoyReminder) for (const match of allMatches(clause, selectPattern)) operations.push({ type: "select", selector: inferSelector(match[1]), raw: match[0] });
  if (/プレイヤーを1人選ぶ/.test(clause)) operations.push({ type: "select_player", count: 1, eligibility: /ゴミ箱を(?:すべて|全て)デッキ/.test(clause) ? { zone: "trash", minimumCards: 1 } : null });

  for (const match of allMatches(clause, /(?:相手|敵)(?:の)?(?:フォートレス|ユーザー)に(\d+|X)ダメージ/g)) {
    operations.push({ type: "deal_damage", target: "enemy_user", value: match[1] === "X" ? "X" : Number(match[1]) });
  }
  for (const match of allMatches(clause, /相手に(\d+|X)ダメージ/g)) {
    operations.push({ type: "deal_damage", target: "enemy_user", value: match[1] === "X" ? "X" : Number(match[1]) });
  }
  const registryDamage = clause.match(/これがレジストリから実行されていた場合、?(\d+)ダメージ/);
  if (registryDamage) operations.push({ type: "deal_damage", target: "enemy_user", value: Number(registryDamage[1]), condition: { sourceExecutionZone: "registry" }, replacesPreviousValue: true });
  for (const match of allMatches(clause, /それがスリープしているならさらに(\d+|X)ダメージ/g)) {
    operations.push({
      type: "deal_damage", target: "previous_selected_target", value: match[1] === "X" ? "X" : Number(match[1]),
      condition: { targetState: "sleep" }, reference: "previous_target"
    });
  }
  for (const match of allMatches(clause, /相手(?:の)?Ob1体と相手ユーザーに(\d+|X)ダメージ/g)) {
    operations.push({ type: "deal_damage", target: "enemy_ob_one", value: match[1] === "X" ? "X" : Number(match[1]), simultaneousGroup: "shared_value_targets" });
  }
  for (const match of allMatches(clause, /自分(?:ユーザー)?は(\d+|X)ダメージ受ける/g)) {
    const operation = { type: "deal_damage", target: "self_user", value: match[1] === "X" ? "X" : Number(match[1]) };
    if (/使用可能メモリが0なら/.test(clause)) operation.condition = { usableMemory: 0 };
    operations.push(operation);
  }
  for (const match of allMatches(clause, /使用可能メモリが0なら(\d+|X)ダメージ受ける/g)) {
    operations.push({
      type: "deal_damage", target: "self_user", value: match[1] === "X" ? "X" : Number(match[1]),
      condition: { usableMemory: 0 }
    });
  }
  for (const match of allMatches(clause, /((?:相手|自分)[^。]*?Ob(?:1体|すべて|全て)?)に(\d+|X)ダメージ/g)) {
    operations.push({ type: "deal_damage", target: inferSelector(match[1]), value: match[2] === "X" ? "X" : Number(match[2]) });
  }
  for (const match of allMatches(clause, /カードを(\d+|X)枚引く/g)) operations.push({ type: "draw", target: "self", value: match[1] === "X" ? "X" : Number(match[1]) });
  for (const match of allMatches(clause, /([①②③④])を(?:適用|起動)/g)) {
    operations.push({ type: "apply_numbered_effect", effectNumber: "①②③④".indexOf(match[1]) + 1 });
  }
  for (const match of allMatches(clause, /(?:マウントしたOb|これにマウントした(?:Ob|カード))は?\[([^\]]+)\]を(?:(\d+))?得(?:て|る)/g)) {
    const keyword = match[1].replace(/[:：]\d+$/, "");
    const printedAmount = match[1].match(/[:：](\d+)$/)?.[1];
    const amount = Number(match[2] ?? printedAmount ?? (["プロテクト", "バックアップ"].includes(keyword) ? 1 : 0));
    operations.push({ type: "grant_keyword", target: "mounted_ob", keyword, amount, lifetime: "persistent_component" });
  }
  for (const match of allMatches(clause, /(?:マウントしたOb|これにマウントした(?:Ob|カード)).*?((?:\[[^\]]+\](?:と)?)+)を与える/g)) {
    for (const keywordMatch of allMatches(match[1], /\[([^\]]+)\]/g)) {
      const keyword = keywordMatch[1].replace(/[:：]\d+$/, "");
      const printedAmount = keywordMatch[1].match(/[:：](\d+)$/)?.[1];
      const amount = Number(printedAmount ?? (["プロテクト", "バックアップ"].includes(keyword) ? 1 : 0));
      operations.push({ type: "grant_keyword", target: "mounted_ob", keyword, amount, lifetime: "source_bound" });
    }
  }
  if (/手札を(?:すべて|全て)捨てる/.test(clause)) operations.push({ type: "discard", target: "all_hand", recordAs: "discarded_count", allowZero: true });
  if (/相手は自身の手札を1枚捨てる/.test(clause)) operations.push({ type: "discard", target: "opponent_hand", count: 1, asMuchAsPossible: true });
  if (/相手のOb1体を選び毒カウンターを2つ置く/.test(clause)) operations.push({ type: "add_counter", target: "selected_enemy_ob", counter: "poison", value: 2 });
  if (/①または②を1つ選び起動する/.test(clause)) operations.push({ type: "choose_numbered_effect", options: [1, 2], count: 1 });
  for (const match of allMatches(clause, /手札の[「『]([^」』]+)[」』](\d+)枚を捨てる/g)) {
    operations.push({ type: "discard", target: "selected", source: "hand", owner: "self", className: match[1], count: Number(match[2]), minimum: Number(match[2]), recordAs: "discarded_cards" });
  }
  if (/捨てた枚数と同じだけカードを引く/.test(clause)) operations.push({ type: "draw", target: "self", valueFrom: "discarded_count" });
  for (const match of allMatches(clause, /メモリを(\d+|X)回復/g)) operations.push({ type: "recover_memory", target: "self", value: match[1] === "X" ? "X" : Number(match[1]) });
  for (const match of allMatches(clause, /(?:(自分|相手)の)?メモリを(\d+|X)消費する/g)) {
    operations.push({ type: "consume_memory", target: match[1] === "相手" ? "opponent" : "self", value: match[2] === "X" ? "X" : Number(match[2]), minimum: 0, asMuchAsPossible: true });
  }
  if (/自分が与えるダメージすべてを\+1/.test(clause)) operations.push({ type: "modify_damage", controller: "self", direction: "dealt", value: 1, appliesTo: "all_damage_events", lifetime: "source_bound", stacking: "additive" });
  if (/自分の効果テキストを持たないObの与えるダメージを\+1する/.test(clause)) operations.push({
    type: "modify_damage", controller: "self", sourceFilter: { category: "Ob", effectText: "none" },
    direction: "dealt", value: 1, appliesTo: "all_damage_events", lifetime: "source_bound", stacking: "additive"
  });
  if (/自分の赤のカードによるダメージを\+1する/.test(clause)) operations.push({ type: "modify_damage", controller: "self", sourceFilter: { color: "赤" }, direction: "dealt", value: 1, appliesTo: "all_damage_events", lifetime: "source_bound", stacking: "additive" });
  if (/自分が受けるダメージすべてを-1/.test(clause) || /受けるダメージを-1/.test(clause)) operations.push({ type: "modify_damage", controller: "self", direction: "received", value: -1, appliesTo: "all_damage_events", minimum: 0, lifetime: "source_bound", stacking: "additive" });
  if (/バックにのみ配置できる/.test(clause)) operations.push({ type: "placement_restriction", target: "source", timing: "execution", destination: "back" });
  if (/これにカードをマウントできない/.test(clause)) operations.push({ type: "mount_restriction", target: "source", allowed: false, lifetime: "source_bound" });
  if (/これが移動した時スタンバイする/.test(clause)) operations.push({ type: "standby", target: "source" });
  if (/レイヤーを1枚破棄することでこれを移動する消費メモリを1にできる/.test(clause)) operations.push({
    type: "replace_move_cost", target: "source", value: 1, optional: true,
    additionalCost: { type: "discard_layer", count: 1 }
  });
  if (/クラス:アーティファクトまたはマスターピースのカードから受けるダメージは-1/.test(clause)) operations.push({
    type: "modify_damage", controller: "self", direction: "received", value: -1,
    sourceFilter: { classesAny: ["アーティファクト", "マスターピース"] }, minimum: 0,
    lifetime: "source_bound", stacking: "additive"
  });
  const decodeMatch = clause.match(/合計メモリが(\d+)以下になるようObを(\d+)体までデコードする/);
  if (decodeMatch) operations.push({ type: "decode", owner: "self", source: "trash", destination: "choose_area", category: "Ob", maximum: Number(decodeMatch[2]), totalOriginalMemoryMaximum: Number(decodeMatch[1]), minimum: 0, optional: true });
  const exactPlacementMatch = clause.match(/メモリ合計が(\d+)になるように、ゴミ箱から(ObまたはCode)を任意の枚数選び配置する/);
  if (exactPlacementMatch) operations.push({
    type: "select_and_place", owner: "self", source: "trash", destination: "choose_area",
    categories: ["Ob", "Code"], minimum: 1, maximum: "all", aggregateConstraint: {
      field: "original_memory", comparator: "=", value: Number(exactPlacementMatch[1])
    }, requireFeasibleAtDeclaration: true, onInfeasible: "cannot_activate"
  });
  const millMatch = clause.match(/山札の上から(\d+)枚をゴミ箱に送る/);
  if (millMatch) operations.push({ type: "mill", owner: "self", source: "deck_top", destination: "trash", value: Number(millMatch[1]), asMuchAsPossible: true, recordActualArrivalsAs: "milled_to_trash" });
  if (/これを(?:自分エリアに)?ドラッグ(?:する|し)/.test(clause)) operations.push({ type: "drag", target: "source", destination: "self_choose_area", requireOpenSlot: true });
  if (/これを山札の上に置く/.test(clause)) operations.push({ type: "move", target: "source", destination: "deck", position: "top", replacesDefaultProxyTrash: true });
  if (/これをデコードする/.test(clause)) operations.push({ type: "decode", owner: "self", source: "trash", destination: "choose_area", target: "source", maximum: 1, minimum: 1, optional: false });
  for (const match of allMatches(clause, /[「『]([^」』]+)[」』](\d+)?体?を配置(?:する|し)/g)) {
    operations.push({ type: "place_named_virtual", cardName: match[1], count: Number(match[2] ?? 1), source: "virtual_pool", destination: "choose_area" });
  }
  for (const match of allMatches(clause, /(?:(自分|相手)(?:ユーザー|ライフ)?(?:は|を|のダメージを)?)(\d+|X)回復(?:する)?/g)) {
    operations.push({ type: "recover_damage", target: match[1] === "相手" ? "opponent_user" : "self_user", value: match[2] === "X" ? "X" : Number(match[2]), minimumDamage: 0 });
  }
  for (const match of allMatches(clause, /メモリ上限を([+-]\d+)する/g)) {
    operations.push({ type: "modify_memory_limit", target: /相手の/.test(clause) ? "opponent" : "self", value: Number(match[1]), lifetime });
  }
  for (const match of allMatches(clause, /(?:実行|消費)メモリ(?:は|を)([+-]\d+)(?:される|する)?/g)) {
    operations.push({
      type: "modify_execution_cost",
      target: /相手の/.test(clause) ? "opponent_cards" : /その|これの/.test(clause) ? "referenced_card" : "self_cards",
      value: Number(match[1]),
      minimum: 0,
      lifetime,
      stacking: /ゴミ箱に同じ名称/.test(clause) ? "fixed" : "additive"
    });
  }
  if (/(?:このカード|このOb)がマウントしていない時、?破壊される/.test(clause)) {
    operations.push({ type: "destroy", target: "source", mandatory: true, reason: "unmounted_state" });
  } else if (/このObのレイヤーが\d+枚以下になった時、?破壊される/.test(clause)) {
    operations.push({ type: "destroy", target: "source", mandatory: true, reason: "layer_count_threshold" });
  } else if (/破壊する/.test(clause)) {
    operations.push({
      type: "destroy",
      target: /これを破壊する/.test(clause) ? "source" : /そのObを破壊する/.test(clause) ? "trigger_event_ob" : /そのカードを破壊する/.test(clause) ? "trigger_event_card" : /すべて|全て/.test(clause) ? "selected_all" : "selected",
      ...(/任意の数|好きな数/.test(clause) ? { minimum: 0, optionalSelection: true, recordOperationCountAs: /Ob/.test(clause) ? "destroyed_ob_attempts" : "destroy_attempts" } : {}),
      ...(/破壊したカードの枚数|破壊した枚数|破壊した数だけ/.test(clause) ? { recordOperationCountAs: "destroy_attempts" } : {})
    });
  }
  if ((/手札に戻す|手札に加える/.test(clause)) && !/アクセス/.test(clause)) operations.push({ type: "move", destination: "hand", target: "selected" });
  if (/ゴミ箱を(?:すべて|全て)デッキに(?:もどす|戻す)/.test(clause)) operations.push({ type: "move_all", source: "trash", destination: "deck", target: "selected_player", position: "unspecified" });
  if (/バックに(?:下げる|移動する)/.test(clause)) operations.push({ type: "move", destination: "back", target: "selected" });
  if (/フロント(?:またはバック)?に移動/.test(clause) || /エリアのいずれかに移動/.test(clause)) operations.push({ type: "move", destination: "choose_area", target: "selected_or_self" });
  if (/位置を入れ替える/.test(clause)) operations.push({ type: "swap", target: "selected_pair" });
  for (const match of allMatches(clause, /[「『]([^」』]+)[」』](\d+)(?:体|枚)を生成/g)) {
    operations.push({ type: "generate", cardName: match[1], count: Number(match[2]), destination: /手札/.test(clause) ? "hand" : /レイヤー/.test(clause) ? "layer" : "area" });
  }
  for (const match of allMatches(clause, /[「『]([^」』]+)[」』](\d+)(?:体|枚)を(?:手札に)?生成/g)) {
    if (!operations.some((operation) => operation.type === "generate" && operation.cardName === match[1])) {
      operations.push({ type: "generate", cardName: match[1], count: Number(match[2]), destination: /手札/.test(clause) ? "hand" : "area" });
    }
  }
  const pairedGenerate = clause.match(/[「『]([^」』]+)[」』]と[「『]([^」』]+)[」』]それぞれ(\d+)枚を生成/);
  if (pairedGenerate) for (const cardName of [pairedGenerate[1], pairedGenerate[2]]) operations.push({ type: "generate", cardName, count: Number(pairedGenerate[3]), destination: /手札/.test(clause) ? "hand" : "area" });
  const variableGenerate = clause.match(/[「『]([^」』]+)[」』]を生成/);
  if (variableGenerate && !operations.some((operation) => operation.type === "generate" && operation.cardName === variableGenerate[1])) {
    operations.push({ type: "generate", cardName: variableGenerate[1], count: /枚数分/.test(clause) ? "X" : 1, destination: /手札/.test(clause) ? "hand" : "area" });
  }
  if (/アクセス(?!制限)/.test(clause)) {
    const selector = inferSelector(clause);
    const accessOperation = {
    type: "access",
    target: "deck",
    selector,
    match: /同じクラス/.test(clause) ? { kind: "shared_class", minimumShared: 1 } : null,
    revealReference: /公開/.test(clause),
    requireResultAtDeclaration: true,
    shuffleRemainingDeck: true,
    destination: /山札の上/.test(clause) ? "deck" : /山札の下/.test(clause) ? "deck" : /手札に加える/.test(clause) ? "hand" : "unspecified",
    position: /山札の上/.test(clause) ? "top" : /山札の下/.test(clause) ? "bottom" : null,
    sequence: ["search", "shuffle_remaining_deck", "move_accessed_card"]
    };
    const accessDragMatch = /アクセスし、?それを(?:(スリープ)して)?ドラッグする/.exec(clause);
    if (accessDragMatch) {
      Object.assign(accessOperation, {
        destination: "drag",
        followUp: {
          type: "drag",
          destination: "self_choose_area",
          useAccessedCards: true,
          ...(accessDragMatch[1] ? { enterSleep: true } : {})
        }
      });
    }
    if (/メモリ2以下になるよう任意の枚数のCode/.test(clause)) {
      Object.assign(accessOperation.selector, { category: "Code", count: "variable", minimum: 0, totalOriginalMemoryMaximum: 2 });
      Object.assign(accessOperation, { destination: "drag", optional: true, followUp: { type: "drag", destination: "self_choose_area", useAccessedCards: true } });
    }
    if (/[「『]レッドパンクス[」』]Lyd-Ob2枚/.test(clause)) {
      Object.assign(accessOperation.selector, { cardName: null, className: "レッドパンクス", category: "Lyd-Ob", count: 2, minimum: 1, maximum: 2 });
      Object.assign(accessOperation, { revealReference: true, requireResultAtDeclaration: true, asMuchAsPossible: true, destination: "split_hand_trash", distribution: { hand: 1, trash: 1, asMuchAsPossible: true } });
    }
    operations.push(accessOperation);
  }
  for (const match of allMatches(clause, /([+-]?)(\d+)\/([+-]?\d+)/g)) operations.push({
    type: "modify_stats",
    atk: Number(`${match[1] || "+"}${match[2]}`),
    str: Number(match[3]),
    duration: /このターン/.test(clause) ? "turn" : "persistent",
    application: /(?:すべて|全て)を/.test(clause) ? "snapshot" : "selected",
    target: /自分のクラス:([^Ob]+)Ob(?:すべて|全て)/.test(clause)
      ? { owner: "self", zones: ["area"], category: "Ob", className: clause.match(/自分のクラス:([^Ob]+)Ob(?:すべて|全て)/)?.[1] }
      : /マウントしたOb/.test(clause) ? "mounted_ob" : /1枚につき/.test(clause) || /^[①②③④][+-]?\d+\/[+-]?\d+/.test(clause) ? "source" : "selected",
    ...(/^[①②③④][+-]?\d+\/[+-]?\d+/.test(clause) && !/このターン/.test(clause) ? { stacking: "additive" } : {}),
    ...(/こうしてゴミ箱に送られたOb1枚につき/.test(clause) ? { multiplierFrom: { record: "milled_to_trash", filter: { category: "Ob" } } } : {})
  });
  return operations;
}

function parseCosts(text) {
  const costs = [];
  if (/そのカードと同じ色の自分の手札1枚を捨てて起動する/.test(text)) {
    costs.push({
      type: "discard",
      selector: {
        owner: "self",
        zones: ["hand"],
        count: 1,
        colorMatch: "trigger_event_card",
        requireColor: true,
        allowColorless: false
      }
    });
  }
  const layerCost = text.match(/レイヤーを(\d+)枚ゴミ箱に送ることで([①②③④])を起動する/);
  if (layerCost) {
    costs.push({
      type: "move_layer",
      source: "source_layers",
      destination: "trash",
      count: Number(layerCost[1]),
      minimum: Number(layerCost[1]),
      timing: "trigger_activation",
      activatesEffectNumber: "①②③④".indexOf(layerCost[2]) + 1
    });
  }
  return costs;
}

function splitClauses(text) {
  return text.split(/(?<=。)|(?=[①②③④])/).map((part) => part.replace(/^。|。$/g, "").trim()).filter(Boolean);
}

export function compileEffectText(sourceText = "", context = {}) {
  context = { ...context, category: normalizeCardCategory(context.category) };
  const normalizedText = normalizeEffectText(sourceText);
  const keywords = parseKeywords(normalizedText);
  const costs = parseCosts(normalizedText);
  const clauses = splitClauses(normalizedText).map((text, index) => {
    const localKeywords = parseKeywords(text);
    return { index, text, triggers: parseTrigger(text, localKeywords), operations: parseOperations(text, context), resultReference: parseResultReference(text), optional: /できる/.test(text), replacement: /かわりに/.test(text) };
  });
  let groupId = 0;
  for (let index = 0; index < clauses.length; index += 1) {
    const clause = clauses[index];
    if (index === 0 || clause.triggers.length || clause.resultReference || /^(?:その後|そうしたら)/.test(clause.text)) groupId += 1;
    clause.resolutionGroup = groupId;
    clause.resolutionMode = "sequential";
    const previous = clauses[index - 1];
    const standalonePersistentClause = context.category === "P-in" && previous?.triggers.length > 0;
    if (previous && !standalonePersistentClause && !clause.triggers.length && !clause.resultReference && !/^(?:その後|そうしたら)/.test(clause.text) && !/(?:その後|そうしたら)$/.test(previous.text)) {
      clause.resolutionGroup = previous.resolutionGroup;
      clause.resolutionMode = "simultaneous";
      previous.resolutionMode = "simultaneous";
    }
  }
  const operations = clauses.flatMap((clause) => clause.operations);
  const runtimeSpecials = {
    "STD-003": { type: "turn_trash_destination_replacement", trigger: "enemy_card_would_move_to_trash", affected: "enemy_cards", destination: "ban", duration: "turn" },
    "STD-011": { type: "remove_components", target: "one_user_or_card", preserve: ["printed_text", "base_stats", "damage", "layers"] },
    "STD-026": { type: "intrinsic_component", component: "Protect", amount: 1, stackable: true },
    "STD-028": { type: "intrinsic_keyword", keyword: "Contact" },
    "STD-029": { type: "intrinsic_destruction_replacement", keyword: "Backup", limit: "once_per_turn", condition: "front_and_back_space" },
    "STD-038": { type: "generated_cards_ban", trigger: "card_generated", subject: "generated_cards" },
    "STD-043": { type: "intrinsic_keyword", keyword: "Security" },
    "STD-044": { type: "intrinsic_keyword", keyword: "QA" },
    "STD-076": { type: "intrinsic_destruction_replacement", keyword: "Backup", limit: "once_per_turn", condition: "front_and_back_space" },
    "STD-082": { type: "login_mill_then_place", mill: { source: "deck_top", count: 1, destination: "trash" }, followUp: { source: "trash", category: "Code", originalMemoryMaximum: 3, count: 1, destination: "area" } },
    "STD-088": { type: "execution_restriction", executionAllowed: false, keyword: "QA" },
    "STD-091": { type: "mandatory_attack", targetPriority: "ob_if_possible", keyword: "QA" },
    "STD-093": { type: "login_place_virtual", token: "Punks", count: 1 },
    "STD-100": { type: "execution_cost_by_distinct_names", area: "own", className: "レッドパンクス", modifierPerName: -1, keywords: ["QA", "Security"] },
    "STD-105": { type: "fortress_attack_interrupt", trigger: "enemy_attacks_own_fortress", execute: { source: "hand", owner: "self", controller: "activator", destination: { owner: "controller", zone: "area" }, category: "Lyd-Ob", forced: true, memoryCost: 0 }, followUp: { sleep: true, grant: "Security", destroyAt: "next_turn_end" } },
    "STD-110": { type: "grant_keyword_group", target: "own_ob_snapshot", keyword: "Encryption", expires: "next_turn_end" },
    "STD-113": { type: "place_from_hand_trigger", triggers: ["login", "own_turn_start"], filter: { className: "エレクトロンフェアリー", originalMemoryLte: 2 }, count: 1, free: true },
    "STD-114": { type: "attack_trigger_grant_keyword", target: "other_own_ob", keyword: "Hacking", duration: "while_in_area" },
    "STD-115": { type: "resident_grant_keyword_group", target: "own_class", className: "エレクトロンフェアリー", keyword: "Encryption" },
    "STD-116": { type: "turn_grant_attack_success", target: "own_class_snapshot", className: "エレクトロンフェアリー", keyword: "Hacking", onUserAttackSuccess: [{ type: "draw", value: 1 }, { type: "deal_damage", target: "enemy_user", value: 1 }] },
    "STD-117": { type: "position_dependent_attack_card", keyword: "Backup", onAttack: { salvage: { source: "own_trash", categories: ["Sp"], orClassName: "エレクトロンフェアリー", count: 1 } }, front: { grantSelf: "Hacking" }, back: { grantOwnColor: { color: "青", keyword: "Encryption" } } },
    "STD-119": { type: "resident_once_per_turn_spell_trigger", spellNamePattern: "slash_wrapped", action: { type: "add_counter_group", target: "enemy_area_ob", counter: "Load", value: 1 } },
    "STD-120": { type: "resident_once_per_turn_spell_trigger", action: { type: "activate_from_trash_then_deck", filter: { category: "Sp", namePattern: "slash_wrapped", originalMemoryLte: 2 }, count: 1, free: true, deckMove: "shuffle" } },
    "STD-122": { type: "destroy_any_count_then", target: "own_area_class", className: "エレクトロンフェアリー", zeroShortCircuit: true, followUp: { placeToken: "STD-123", count: 2, statVariable: { trashMatchingDestroyedNames: true, multiplier: 2 } } },
    "STD-123": { type: "state_threshold_keywords", destroyIfStrLte: 0, condition: { stat: "ATK", gte: 5 }, keywords: ["QA", "Hacking"] },
    "STD-127": { type: "battle_outgoing_damage_replacement", target: "source", opposingCategory: "Ob", value: 0, keyword: "Security" },
    "STD-129": { type: "intrinsic_keywords", keywords: ["Security", "Backup"] },
    "STD-130": { type: "battle_stat_variable", target: "source", stat: "STR", value: { count: "own_area_ob", className: "ナイツ・オブ・マキナ" }, keywords: ["Security", "Decoy"] },
    "STD-131": { type: "logout_drag_from_hand", filter: { cardName: "華守り" }, count: 1, free: true, keyword: "Security" },
    "STD-132": { type: "response_no_additional_effect", cost: 3, keyword: "Security" },
    "STD-135": { type: "logout_delayed_self_revive", timing: "current_turn_end", condition: { sourceZone: "trash" }, destination: "front", keyword: "Security" },
    "STD-136": { type: "attack_optional_destroy_to_standby", target: "other_own_ob", followUp: { battledOb: { skipNextStandby: true } }, keyword: "Contact" },
    "STD-148": { type: "resident_opponent_turn_battle_damage", armAt: "opponent_turn_start", trigger: "own_ob_battles", target: "enemy_user", value: 1 },
    "STD-151": { type: "logout_random_discard", target: "enemy_hand", count: 1 },
    "STD-152": { type: "login_or_update_decode", updateCost: 2, filter: { category: "Ob", originalMemoryLte: 2 }, count: 1, followUp: { destroyAt: "current_turn_end" } },
    "STD-153": { type: "login_logout_add_counter", target: "enemy_ob_one", counter: "Load", value: 2 },
    "STD-154": { type: "area_to_trash_next_turn_revive", target: "source_uid", destination: "choose_area", enterSleep: true },
    "STD-156": { type: "logout_choice", choices: [{ type: "heal_user", value: 3 }, { type: "decode", filter: { category: "Ob", originalMemoryLte: 3, differentNameFromSource: true }, count: 1 }] },
    "STD-161": { type: "madness_counter_rule", timings: ["counter_added", "target_controller_turn_start"], roll: "sum_one_d6_per_counter", banIf: "roll_gt_original_str_plus_15" },
    "STD-165": { type: "resident_destruction_threshold", threshold: 4, count: "destroyed_cards_this_turn", cost: "destroy_source", followUp: { executeFreeLogin: { zones: ["trash", "hand"], category: "Ob", className: "旧支配者" } } },
    "STD-166": { type: "conditional_add_counter", condition: { ownAreaObClass: "旧支配者" }, target: "enemy_user", counter: "Madness", value: 1 },
    "STD-168": { type: "resident_each_ob_destroyed", action: { type: "select_add_counter", target: "any_user_or_ob", counter: "Load", value: 1 } },
    "STD-170": { type: "update_random_generate_place", cost: 4, cardIds: ["STD-165", "STD-171", "STD-172"], count: 1 },
    "STD-172": { type: "logout_random_ban_each_player", zones: ["area", "hand"], countPerPlayer: 1 },
    "STD-175": { type: "insect_destroyed_salvage", trigger: "any_insect_destroyed", source: "own_trash", category: "Script", count: 1, keyword: "Security" },
    "STD-176": { type: "enemy_turn_start_grant_all", target: "own_ob_all", keyword: "Slash", duration: "through_next_turn" },
    "STD-179": { type: "optional_hand_place_on_own_script_activated", target: "self", free: true },
    "STD-181": { type: "attack_permission", condition: "own_script_activated_this_turn" },
    "STD-182": { type: "login_set_script_and_attack_activate_script", login: { source: "own_hand", category: "Script", setupMemoryMaximum: 2 }, attack: { source: "own_back", category: "Script", activationMemoryMaximum: 2, optional: true } },
    "STD-184": { type: "dual_ob_script", scriptSetupMemory: 3, scriptActivationMemory: 0, onObLogin: "place_self_as_ob" },
    "STD-185": { type: "optional_battle_substitution", condition: "own_insect_battles", substitute: "self" },
    "STD-214": { type: "mandatory_attack_cost", cost: "recover_one_registry_card", failure: "attack_fails" },
    "STD-215": { type: "registry_executable_and_logout_install_self" },
    "STD-216": { type: "login_install_deck_top" },
    "STD-217": { type: "own_registry_left_damage", target: "enemy_user", value: 1 },
    "STD-220": { type: "logout_registry_replacement_and_registry_execute", cannotAttack: "user_if_registry_executed" },
    "STD-222": { type: "install_hand_then_draw_count" },
    "STD-226": { type: "optional_enemy_registry_install_compress", condition: "source_standby", cost: "sleep_self", target: "one_registry_card" },
    "STD-228": { type: "update_self_damage_random_enemy_area", cost: 4, damage: 3 },
    "STD-229": { type: "registry_five_extra_turn", damageModifier: -2 },
    "STD-230": { type: "ambush_hand_inspection_install", source: "own_faceup_registry", cost: 3, registryCardCountMinimum: "source_original_memory", choose: 1, randomAdditional: 1 },
    "STD-231": { type: "enemy_ob_execute_adjacent_domination" },
    "STD-234": { type: "mounted_sleep_owner_discard", value: 1, keyword: "Security" },
    "STD-235": { type: "mounted_sleep_owner_damage", value: 2, keyword: "Contact" },
    "STD-237": { type: "update_random_ob_generate_place", cost: 4 },
    "STD-094": { type: "layered_login_damage", requirement: { groups: [{ class: "ノイド", count: 1 }, { class: "レッドパンクス", minimum: 1 }] }, damage: { target: "enemy_user", value: "source_stack_count" } },
    "STD-085": { type: "layered_attack_cost_effect", cost: { layerToTrash: 1 }, effect: { atk: 2, str: 0 }, afterResolution: { destroyIfStackMaximum: 1 } },
    "STD-095": { type: "override_layered_battle", executionDiscount: "maximum_original_memory_among_selected_layers", attackBonus: "source_layer_count", onBattleDestroy: "enemy_user_damage_destroyed_ob_original_str" },
    "STD-099": { type: "hand_destruction_replacement_login", timing: "same_as_backup", competingReplacements: "controller_choice_one", free: true, destroyedObBecomesLayer: true, loginBonusPerLayer: { atk: 1, str: 1 } },
    "STD-232": { type: "layered_turn_start_logout", turnStart: "move_each_deck_top_to_source_layer", logout: "allocate_source_layer_memory_as_damage_then_install_layers_to_owners_registry" },
    "SZTB-092": { type: "layered_attack_target_damage", amount: 3 },
    "SZTB-093": { type: "layered_attacked_prebattle", damageAttacker: 2, thenGenerateAndPlace: "SZTB-091" },
    "SZTB-094": { type: "layered_login_turn_end_access_counter", access: "non_ob_arms_band_to_hand", counter: "sleep_source_then_execute_magazine_sp" },
    "SZTB-095": { type: "layered_magazine_support", oncePerTurn: "replace_magazine_sp_trash_with_source_layer", onMagazineLayerConsumed: "enemy_user_damage_1" },
    "STD-137": { type: "variable_choice_spell", variable: { aggregate: "absolute_user_life_difference" }, choices: ["own_ob_all_2_2_through_next_turn", "decode_nom_ob_original_memory_lte_x"] },
    "STD-138": { type: "variable_damage", variable: { count: "own_area_security", add: 1 }, target: "enemy_ob" },
    "STD-146": { type: "variable_decode", variable: { countUnion: ["own_trash_nom", "own_trash_security"] }, filter: { category: "Ob", originalMemory: "lt_x" }, count: 1 },
    "STD-157": { type: "destroy_lki_place", trigger: ["login", "update_3"], target: "other_own_area_card", lki: "original_memory", followUp: { source: "hand", filter: { category: "Ob", color: "黒", originalMemory: "lte_x" }, destination: "area", free: true } },
    "STD-162": { type: "destroy_lki_salvage", target: "one_own_ob", lki: "original_str", followUp: { source: "trash", filter: { category: "Ob" }, aggregateOriginalMemory: "lte_x", count: "any", destination: "hand" } },
    "STD-121": { type: "trinity_resident", executionCost: { operation: "destroy", zones: ["front", "back"], controller: "any", faceUp: true, namePrefix: "情報管理端末", count: 3, distinctBy: "name", allRequired: true }, triggers: ["self_activated", "first_ob_attack_each_turn"] },
    "STD-140": { type: "resident_battle_branch", effects: ["modify_own_ob", "prevent_battle_damage", "salvage_nonself_sacred_tree"] },
    "STD-141": { type: "resident_destroyed_count_branch", count: "destroyed_sacred_tree_scripts_this_turn", thresholds: [2, 3, 5] },
    "STD-143": { type: "sleep_all_enemy_ob", conditionalDraw: { count: 2, condition: "executed_on_enemy_turn" } },
    "STD-223": { type: "ambush", cost: 2, trigger: "enemy_ob_attack_declared", registryThreshold: "source_original_memory", incidentLimit: "once_per_attack", effect: "damage_ob_3_draw_if_destroyed" },
    "STD-224": { type: "install_number_watch", value: "chosen_number", trigger: "enemy_card_executed_and_placed", compare: "printed_memory", effect: "destroy_source_and_event_card" },
    "STD-227": { type: "imperial_project", loginAndUpdate: "random_install_from_enemy_hand_area_trash_deck", continuousAtk: "unique_registry_colors", attack: "atk_7_destroy_enemy_front_generate_proof" },
    "STD-238": { type: "layered_attack", requirement: "one_own_area_ob_plus_one_own_registry", optionalCost: { zone: "layer", count: 2 }, effects: ["standby", "modify_self_permanent_2_0"] },
    "STD-118": { type: "resident_replacement", limit: "once_per_turn", trigger: "slash_spell_activated", replacement: "trash_to_hand" },
    "STD-199": { type: "login_move_choice", target: "any_front_ob", destinations: ["owner_hand", "owner_back"], followUpByDestination: { hand: "owner_recover_memory_2", back: "owner_draw_1" } },
    "STD-203": { type: "response_grouped_cost_damage", cost: 1, groups: ["one_own_ob_destroy", "one_enemy_ob_damage_2"], followUp: "if_enemy_destroyed_damage_same_column_ob_2" },
    "STD-204": { type: "execution_placement_replacement", trigger: "enemy_ob_executing", replacement: "generated_dolls_gigantes_with_executed_ob_as_layer" },
    "STD-207": { type: "response_generate_reveal", cost: 3, generate: { cardId: "STD-189", destination: "hand" }, reveal: "one_purple_hand", revealedExecutionCostModifier: -2 },
    "STD-209": { type: "destroy_category_branch", target: "enemy_area_card", branches: { Ob: ["STD-205", "STD-189"], nonOb: ["STD-189", "STD-189"] }, destination: "hand" },
    "STD-211": { type: "select_own_area_class_destroy_then_draw", selection: { source: "own_area", selector: "class", count: 1 }, destroy: { target: "selected_own_area_class", all: true, recordAs: "destroyed_count" }, followUp: { type: "draw", valueFrom: "destroyed_count", zeroShortCircuit: true } },
    "STD-124": { type: "proxy_generate_then_login_trash_thresholds", proxy: { generatedCardId: "STD-124", count: 2, destination: "hand" }, login: { statModifier: { atk: "own_trash_same_id_count", str: "own_trash_same_id_count" }, thresholds: [{ minimum: 3, effect: { type: "draw", value: 2 } }, { minimum: 5, effect: { type: "sleep", target: "enemy_ob_all" } }, { minimum: 7, effect: { type: "grant_keywords", target: "source", keywords: ["QA", "Disconnect"] } }, { minimum: 20, effect: { type: "win_game", target: "source_controller" } }] } },
    "STD-159": { type: "indestructible_on_any_ob_destroyed_turn_stat", immunity: { target: "source", operation: "destroy" }, trigger: { event: "ob_destroyed", scope: "any_faceup_area_ob" }, effect: { type: "modify_stats", target: "source", atk: 1, str: 0, duration: "turn" } },
    "STD-174": { type: "once_per_turn_script_activated_ready_self", trigger: { event: "script_activated", scope: "any" }, effect: [{ type: "modify_stats", target: "source", atk: 1, str: 0, duration: "turn" }, { type: "standby", target: "source" }] },
    "STD-186": { type: "optional_enemy_draw_trigger", trigger: { event: "card_drawn", controller: "opponent" }, effect: { type: "draw", target: "source_controller", value: 1 } },
    "STD-208": { type: "resident_dolls_destroyed_enemy_ob_debuff", trigger: { event: "ob_destroyed", namePattern: "ドールズ" }, effect: { type: "modify_stats", target: "enemy_ob_all", atk: -1, str: 0, duration: "turn" } },
    "STD-219": { type: "login_access_install_then_registry_free_execute", login: { type: "access_install", count: 1, destination: "registry" }, attack: { selection: { source: "own_registry", originalMemoryMaximumFrom: "self_registry_count", count: 1 }, executionCost: 0 } },
    "SZTB-098": { type: "magazine_arms_band_ready_then_generate_jacket", magazineCost: 4, effect: [{ type: "modify_stats", target: "own_named_ob_all", namePattern: "アームズバンド", atk: 1, str: 0, duration: "turn" }, { type: "remove_damage_and_standby", target: "own_named_ob_all", namePattern: "アームズバンド" }, { type: "generate_and_place", cardId: "SZTB-091", condition: "own_arms_band_ob_exists" }] },
    "SZTB-101": { type: "resident_arms_band_amalgam_layer_generation", triggers: [{ event: "layered_login", target: "own_arms_band_layered_ob" }, { event: "attack_declared", target: "own_arms_band_layered_ob" }], effect: { type: "generate_as_layer", cardId: "SZTB-090" } },
    "SZTB-102": { type: "resident_arms_band_salvage_then_layer_consume_repeat", activations: ["normal", "update_2"], action: { type: "salvage", source: "own_trash", namePattern: "アームズバンド", count: 1 }, followUp: { type: "consume_layers", count: "any", repeatActionPer: 2 } }
  };
  if (runtimeSpecials[context.id]) operations.push(runtimeSpecials[context.id]);
  if (/①または②を1つ選び起動する/.test(normalizedText) && !operations.some((operation) => operation.type === "choose_numbered_effect")) {
    operations.push({ type: "choose_numbered_effect", options: [1, 2], count: 1 });
  }
  const selectionModules = compileSelectionModules(normalizedText);
  const selectionSpecs = selectionModules.flatMap((module) => [module.selection, module.allocation].filter(Boolean));
  if (/手札を1枚選び公開する。?それと同じクラス/.test(normalizedText)) {
    const access = operations.find((operation) => operation.type === "access" && operation.match?.kind === "shared_class");
    if (access) access.revealReference = true;
  }
  if (/プレイヤーを1人選ぶ。?そのプレイヤーはゴミ箱を(?:すべて|全て)デッキに(?:もどす|戻す)/.test(normalizedText)) {
    const selection = operations.find((operation) => operation.type === "select_player");
    if (selection) selection.eligibility = { zone: "trash", minimumCards: 1 };
  }
  for (const move of operations.filter((operation) => ["move", "move_all"].includes(operation.type) && operation.destination === "deck")) {
    if ((move.position ?? "unspecified") === "unspecified" && !/シャッフルしない/.test(normalizedText)) {
      operations.push({ type: "shuffle", target: move.target === "selected_player" ? "selected_player_deck" : "destination_deck", timing: "after_move" });
    }
  }
  for (const keyword of keywords) {
    if (keyword.name === "LAYERED") operations.unshift({ type: "layered_execution", requirement: keyword.value });
  }
  const warnings = [];
  for (let index = 0; index < clauses.length; index += 1) {
    if (clauses[index].operations.some((operation) => operation.reference === "previous_target")
      && !clauses.slice(0, index).some((entry) => entry.operations.some((operation) => ["select", "deal_damage"].includes(operation.type)))) {
      warnings.push({ code: "dangling_reference", clauseIndex: index, text: clauses[index].text, message: "参照可能な直前の対象がない" });
    }
  }
  const complexSignals = [
    ["choice_branch", /①②いずれか/], ["variable", /\b[XY]\b/], ["replacement", /かわりに/],
    ["same_column", /同じ縦列/], ["until_revealed", /公開している間/], ["count_history", /ターン中.*枚目|ターン中.*回目/]
  ];
  for (const [code, pattern] of complexSignals) {
    const representedChoice = code === "choice_branch" && operations.some((operation) => operation.type === "choose_numbered_effect");
    if (pattern.test(normalizedText) && !representedChoice) warnings.push({ code, message: `個別確認が必要: ${code}` });
  }
  const effectVerbPattern = /(?:ダメージ|回復|引く|捨て|破壊|配置|アクセス|ドラッグ|デコード|サルベージ|生成|移動|スタンバイ|スリープ|マウント|レイヤー|インストール|起動|実行メモリ|メモリ上限|\+[0-9XY]+\/[+-]?[0-9XY]+|-[0-9XY]+\/[+-]?[0-9XY]+)/;
  for (const clause of clauses) {
    const representedLayerThreshold = /レイヤー.*1枚以下.*破壊/.test(clause.text)
      && operations.some((operation) => operation.type === "destroy" && operation.reason === "layer_threshold_after_effect");
    const representedSplitCost = costs.length > 0 && /(?:送る|捨てる|破棄する)ことで$/.test(clause.text);
    const pureTriggerClause = /^これにObがマウントした時$/.test(clause.text);
    const reminderClause = /\[(?:QA|クイックアクション)\]\s*これを持(?:つ|った)Obは配置されたターンに攻撃できます。?/.test(clause.text)
      || /\[レスポンス(?::\d+)?\]\(相手からダメージを受けた時、\[レスポンス\]を持つカードを手札から指定のメモリを消費して使うことができます/.test(clause.text);
    const representedSharedClause = /\[ログイン\]自分のOb1体を破壊して$/.test(clause.text)
      || /\[レジデント\]自分のターン中、自分のカードが破壊される度、?$/.test(clause.text)
      || /^②を1つ選び起動する$/.test(clause.text)
      || /^\(上限以上に回復しない$/.test(clause.text);
    if (clause.operations.length === 0 && parseCosts(clause.text).length === 0 && !representedSplitCost && !pureTriggerClause
      && !reminderClause && !representedSharedClause && !representedLayerThreshold
      && effectVerbPattern.test(clause.text.replace(/\[[^\]]+\]/g, "")) && !/^①を起動する$/.test(clause.text)) {
      warnings.push({ code: "unparsed_effect_clause", clauseIndex: clause.index, text: clause.text, message: "効果を示す語が残っているが命令へ変換されていない" });
    }
  }
  if (runtimeSpecials[context.id]) {
    const representedByRuntimeSpecial = new Set([
      "unparsed_effect_clause",
      "choice_branch",
      "replacement",
      "same_column",
      "until_revealed",
      "variable"
    ]);
    for (let index = warnings.length - 1; index >= 0; index -= 1) {
      if (representedByRuntimeSpecial.has(warnings[index].code)) warnings.splice(index, 1);
    }
  }
  const effectful = normalizedText && !/効果なし/.test(normalizedText);
  const reminderPatterns = [
    /\[デコイ\]\s*相手が効果でカードを選ぶ時、「デコイ」を持つカードしか選べません。/,
    /\[セキュリティ\]\s*Obが攻撃する時、「セキュリティ」を持つオブジェクトにしか攻撃対象を選択できません。ターン終了時にこれをスリープすることができます。/,
    /\[ハッキング\]\s*これを持つObは相手の\[セキュリティ\]を持つObを無視して攻撃できます。/,
    /\[暗号化\]\s*これを持つObは攻撃されません。/,
    /\[(?:QA|クイックアクション)\]\s*これを持(?:つ|った)Obは配置されたターンに攻撃できます。/
  ];
  const reminderTextDetected = reminderPatterns.some((pattern) => pattern.test(normalizedText));
  const status = !effectful || reminderTextDetected ? "supported" : operations.length === 0 ? "manual" : warnings.length ? "partial" : "supported";
  const hasIf = keywords.some((keyword) => keyword.name === "IF");
  const primaryResolutionGroup = clauses.find((clause) => clause.operations.length > 0)?.resolutionGroup ?? null;
  const referencesTriggerColor = costs.some((cost) => cost.selector?.colorMatch === "trigger_event_card");
  const ifCondition = keywords.find((keyword) => keyword.name === "IF")?.value ?? "";
  const triggerCardinality = /(?:毎|たび)に/.test(normalizedText) ? "per_occurrence" : "once_per_event";
  const triggerEventPolicy = /Obが破壊された時/.test(ifCondition)
    ? { event: "destruction", requiresDetermination: true, includeReplacement: true, excludePreventedOrNegated: true }
    : null;
  const attackTriggered = clauses.some((clause) => clause.triggers.some((trigger) => trigger.type === "attack"));
  const parentActionPolicy = attackTriggered
    ? { timing: "after_attack_declaration_before_combat", effectFailureCancelsParentAction: false, missingAttackTargetCancelsCombat: true }
    : null;
  const activationPolicy = context.category === "Script" && hasIf
    ? { triggerConditionRequired: true, effectApplicabilityRequired: true, applicabilityScope: "primary_resolution_group", primaryResolutionGroup, costsPayableRequired: costs.length > 0, triggerSubjectRequirements: referencesTriggerColor ? { faceUp: true, hasColor: true, allowColorless: false } : null, recheckTriggerAtResolution: false }
    : { triggerConditionRequired: false, effectApplicabilityRequired: true, applicabilityScope: "primary_resolution_group", primaryResolutionGroup, costsPayableRequired: costs.length > 0, triggerSubjectRequirements: referencesTriggerColor ? { faceUp: true, hasColor: true, allowColorless: false } : null, recheckTriggerAtResolution: false };
  return { version: 2, sourceText, normalizedText, status, keywords, clauses, costs, operations, selectionModules, selectionSpecs, warnings, reminderTextDetected, activationPolicy: { ...activationPolicy, triggerCardinality, triggerEventPolicy }, resolutionPolicy: { partialApplication: "as_much_as_possible", costsMustBePaidInFull: true }, parentActionPolicy };
}

export function hasKeyword(card, name) {
  if (card.id === "STD-100" && ["QA", "SECURITY"].includes(name)) return true;
  const compiled = card.compiled ?? compileEffectText(card.text);
  return compiled.keywords.some((keyword) => keyword.name === name && keyword.intrinsic !== false) || card.grantedKeywords?.includes(name);
}

export function keywordValue(card, name) {
  const compiled = card.compiled ?? compileEffectText(card.text);
  const keyword = compiled.keywords.find((item) => item.name === name && item.intrinsic !== false);
  if (!keyword) return null;
  if (keyword.value === null && ["PROTECT", "BACKUP"].includes(name)) return 1;
  return keyword.value;
}
