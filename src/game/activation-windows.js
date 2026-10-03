import { isObCard, isObCategory, matchesCardCategory } from "./card-types.js";

const otherPlayer = (id) => id === "player" ? "ai" : "player";

export function createEventContext(state, event) {
  const raw = Object.freeze({
    ...event,
    traits: Object.freeze([...(event.traits ?? [])]),
    cardUids: Object.freeze([...(event.cardUids ?? [])]),
    attackerKeywords: Object.freeze([...(event.attackerKeywords ?? [])])
  });
  return Object.freeze({
    id: event.id,
    type: event.type,
    turnNumber: state.turnNumber,
    activePlayerId: state.active,
    eventPlayerId: event.playerId ?? null,
    ownerId: event.ownerId ?? event.playerId ?? null,
    cardUid: event.cardUid ?? null,
    cardId: event.cardId ?? null,
    cardName: event.cardName ?? null,
    category: event.category ?? null,
    color: event.color ?? null,
    traits: Object.freeze([...(event.traits ?? [])]),
    placementCause: event.placementCause ?? null,
    from: event.from ?? null,
    to: event.to ?? null,
    amount: Number(event.amount ?? 0),
    kind: event.kind ?? null,
    attackerUid: event.attackerUid ?? null,
    defenderUid: event.defenderUid ?? null,
    targetUid: event.targetUid ?? null,
    source: event.source ?? null,
    raw
  });
}

export function createTriggerSpec({ id, cardId, event, conditions = [], actions = [], limit = null, activation = "automatic" }) {
  if (!id || !cardId || !event) throw new Error("TriggerSpec requires id, cardId and event");
  return Object.freeze({ id, cardId, event, conditions: Object.freeze([...conditions]), actions: Object.freeze([...actions]), limit, activation });
}

export function triggerConditionMatches(state, window, condition) {
  const { source, context } = window;
  if (condition.type === "source_zone") return source.zoneName === condition.zone;
  if (condition.type === "source_face_up") return source.card.faceDown !== true;
  if (condition.type === "source_face_down") return source.card.faceDown === true;
  if (condition.type === "source_controller_is_event_player") return source.playerId === context.eventPlayerId;
  if (condition.type === "source_controller_is_active_player") return source.playerId === state.active;
  if (condition.type === "event_card_owner_is_source_controller") return context.ownerId === source.playerId;
  if (condition.type === "event_card_category") return matchesCardCategory({ category: context.category }, condition.category);
  if (condition.type === "event_card_is_source") return context.cardUid === source.card.uid;
  if (condition.type === "event_player_is_enemy") return context.eventPlayerId === otherPlayer(source.playerId);
  if (condition.type === "source_resident_active") return source.card.residentActive === true;
  if (condition.type === "event_card_name") return context.cardName === condition.name;
  if (condition.type === "event_card_name_pattern" && condition.pattern === "slash_spell") {
    return String(context.cardName ?? "").startsWith("/") && String(context.cardName ?? "").endsWith("/*");
  }
  if (condition.type === "event_card_trait") return context.traits.includes(condition.trait);
  if (condition.type === "event_not_rule_destruction") return context.raw.ruleDestruction !== true;
  if (condition.type === "event_attacker_has_keyword") return (context.raw.attackerKeywords ?? []).includes(condition.keyword);
  if (condition.type === "event_card_family" && condition.family === "arms_band") {
    const number = Number(String(context.cardId ?? "").match(/^SZTB-(\d+)$/)?.[1] ?? -1);
    return String(context.cardName ?? "").includes("アームズバンド") || (number >= 90 && number <= 102);
  }
  if (condition.type === "event_card_printed_category") {
    const printedCategory = state.players[context.eventPlayerId]?.front.concat(state.players[context.eventPlayerId]?.back ?? [])
      .find((card) => card.uid === context.cardUid)?.printedCategory;
    return printedCategory === condition.category;
  }
  if (condition.type === "event_damage_kind") return context.kind === condition.kind;
  if (condition.type === "event_player_is_source_controller") return context.eventPlayerId === source.playerId;
  if (condition.type === "source_card_is_battler") return [context.attackerUid, context.defenderUid].includes(source.card.uid);
  if (condition.type === "event_target_is_own_security") {
    const target = state.players[source.playerId].front.find((card) => card.uid === context.targetUid);
    return Boolean(target && isObCard(target) && (/(?:\[|［)セキュリティ(?:\]|］)/.test(String(target.text ?? ""))
      || (target.grantedKeywords ?? []).includes("SECURITY")
      || (target.timedModifiers ?? []).some((item) => item.keyword === "SECURITY")));
  }
  if (condition.type === "event_target_is_source_controller_fortress") return context.targetUid === `${source.playerId}-fortress`;
  if (condition.type === "event_target_is_enemy_fortress") return context.targetUid === `${otherPlayer(source.playerId)}-fortress`;
  return false;
}

export function createActivationWindow({ context, spec, source, optional = spec.activation === "optional" }) {
  return {
    id: `${context.id}:${spec.id}:${source.card.uid}`,
    context,
    event: context.raw,
    spec,
    source,
    controllerId: source.playerId,
    optional,
    status: "pending"
  };
}

export function collectActivationWindows(state, context, specs, sources) {
  const windows = [];
  for (const spec of specs.filter((item) => item.event === context.type)) {
    for (const source of sources.filter((entry) => entry.card.id === spec.cardId)) {
      const window = createActivationWindow({ context, spec, source });
      if (spec.limit === "once_per_turn" && state.players[source.playerId].triggerUsage[spec.id]) continue;
      if (spec.conditions.every((condition) => triggerConditionMatches(state, window, condition))) windows.push(window);
    }
  }
  const active = windows.filter((item) => item.controllerId === state.active);
  const inactive = windows.filter((item) => item.controllerId !== state.active);
  const ordered = [];
  while (active.length || inactive.length) {
    if (active.length) ordered.push(active.shift());
    if (inactive.length) ordered.push(inactive.shift());
  }
  return ordered;
}

export function scriptConditionMatches(context, controllerId, conditionText) {
  const condition = String(conditionText ?? "").replace(/\s+/g, "");
  if (context.type === "card_destroyed" && isObCategory(context.category)) {
    if (condition.includes("自分Obが破壊された時")) return context.ownerId === controllerId;
    if (condition.includes("相手Obが破壊された時")) return context.ownerId !== controllerId;
  }
  if (context.type === "card_executed" && isObCategory(context.category) && condition.includes("相手がObを実行する時")) return context.eventPlayerId !== controllerId;
  if (context.type === "card_would_move_to_trash" && condition.includes("相手のカードがゴミ箱に送られる時")) return context.ownerId !== controllerId;
  if (context.type === "card_generated" && condition.includes("カードが生成された時")) return true;
  if (context.type === "turn_started" && condition.includes("いずれかのユーザーのターン開始時")) return true;
  if (context.type === "turn_ended" && condition.includes("いずれかのユーザーのターン終了時")) return true;
  if (context.type === "memory_limit_increased" && condition.includes("相手のメモリ上限が増えた時")) return context.eventPlayerId !== controllerId;
  return false;
}

export function createScriptActivationWindow(state, context, controllerId, source, conditionText) {
  return createActivationWindow({
    context,
    source,
    optional: true,
    spec: createTriggerSpec({
      id: `${source.card.id}:if`, cardId: source.card.id, event: context.type,
      activation: "optional", conditions: [], actions: [], limit: null
    })
  });
}
