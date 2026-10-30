import { CARD_LIBRARY } from "../../../data/cards.js";
import { isObCard, matchesCardCategory } from "../../card-types.js";
import { createChoiceSpec, createSelectionRequest, selectionRequestFromSpec } from "../../selection-model.js";
import { dealCardDamage, dealFortressDamage } from "../../core/deal-damage.js";
import { drawCards } from "../../core/draw.js";
import { enqueueSelection, selectionProjectionMeta } from "../../core/projection.js";
import { addLog, findCard, isSlashSpell, otherPlayer } from "../../core/shared.js";
import { getMaxMemory } from "./cost.js";
import { destroyCard } from "./destroy.js";
import { createVengeanceCard, emitCardsGenerated } from "./generate.js";
import { emitEffectPlacement, placeByMode } from "./placement.js";
import { openRuntimeAccessSelection } from "./selection-access.js";
import { openRuntimeTargetSelection, runtimeSelectionCandidates } from "./selection-target.js";

export function executeTriggerAction(state, trigger, action) {
  const { source, event } = trigger;
  const controller = state.players[source.playerId];
  const enemyId = otherPlayer(source.playerId);
  if (action.type === "deal_damage" && action.target === "enemy_user") {
    dealFortressDamage(state, enemyId, action.amount, source.playerId, source.card.name);
  } else if (action.type === "deal_damage" && action.target === "enemy_front_all") {
    for (const target of [...state.players[enemyId].front]) dealCardDamage(state, enemyId, target.uid, action.amount, source.card.name);
  } else if (action.type === "recover_memory") {
    const before = controller.memory;
    controller.memory = Math.min(getMaxMemory(controller), controller.memory + action.amount);
    addLog(state, `${source.card.name}: メモリ ${before}→${controller.memory}。`, "effect");
  } else if (action.type === "draw" && action.target === "source_controller") {
    drawCards(state, source.playerId, action.amount);
    addLog(state, `${source.card.name}: カードを${action.amount}枚引く。`, "effect");
  } else if (action.type === "modify_stats" && action.target === "source") {
    const atkField = action.duration === "turn" ? "tempAtk" : "permanentAtk";
    const strField = action.duration === "turn" ? "tempStr" : "permanentStr";
    source.card[atkField] = Number(source.card[atkField] ?? 0) + action.atk;
    source.card[strField] = Number(source.card[strField] ?? 0) + action.str;
    addLog(state, `${source.card.name}: ${action.atk >= 0 ? "+" : ""}${action.atk}/${action.str >= 0 ? "+" : ""}${action.str}。`, "effect");
  } else if (action.type === "modify_stats" && action.target === "enemy_ob_all") {
    for (const target of [...state.players[enemyId].front, ...state.players[enemyId].back]) {
      target.tempAtk = Number(target.tempAtk ?? 0) + action.atk;
      target.tempStr = Number(target.tempStr ?? 0) + action.str;
    }
    addLog(state, `${source.card.name}: 相手Obすべてをこのターン${action.atk}/0。`, "effect");
  } else if (action.type === "modify_stats" && action.target === "own_battler") {
    const uid = trigger.event.attackerUid && findCard(state, trigger.event.attackerUid)?.playerId === source.playerId
      ? trigger.event.attackerUid : trigger.event.defenderUid;
    const target = findCard(state, uid)?.card;
    if (target) addTimedModifier(state, target, action, source.card.name);
  } else if (action.type === "modify_stats" && action.target === "own_ob_all") {
    for (const target of [...controller.front, ...controller.back].filter(isObCard)) addTimedModifier(state, target, action, source.card.name);
  } else if (action.type === "destroy_all" && action.target === "enemy_non_ob") {
    for (const target of [...state.players[enemyId].front, ...state.players[enemyId].back].filter((card) => !isObCard(card))) {
      destroyCard(state, enemyId, target.uid, { source: source.card.name, suppressReplacement: true });
    }
  } else if (action.type === "add_counter" && action.target === "enemy_ob_all") {
    for (const target of [...state.players[enemyId].front, ...state.players[enemyId].back].filter(isObCard)) {
      if (action.counter === "load") target.load = Number(target.load ?? 0) + Number(action.amount ?? 0);
      else {
        target.counters ??= {};
        target.counters[action.counter] = Number(target.counters[action.counter] ?? 0) + Number(action.amount ?? 0);
      }
    }
    addLog(state, `${source.card.name}: 相手Obすべてに${action.counter}を${action.amount}付与。`, "effect");
  } else if (action.type === "move_event_card" && action.source === "trash" && action.destination === "hand") {
    const index = controller.trash.findIndex((card) => card.uid === event.cardUid);
    if (index >= 0) controller.hand.push(...controller.trash.splice(index, 1));
    addLog(state, `${source.card.name}: ${event.cardName}をゴミ箱から手札へ戻した。`, "effect");
  } else if (action.type === "select_execute_from_trash") {
    const candidates = controller.trash.filter((card) => {
      if (action.filter?.category && !matchesCardCategory(card, action.filter.category)) return false;
      if (action.filter?.excludeCategory && matchesCardCategory(card, action.filter.excludeCategory)) return false;
      if (action.filter?.namePattern === "slash_spell" && !isSlashSpell(card)) return false;
      if (action.filter?.maximumCost !== undefined && Number(card.cost ?? 0) > Number(action.filter.maximumCost)) return false;
      return true;
    });
    if (!candidates.length) return;
    const request = createSelectionRequest({
      mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, `${card.name} / メモリ${card.cost}`])),
      label: "ゴミ箱から起動するSpを選択", message: source.card.text,
      continuation: {
        type: "runtime-execute-from-trash", playerId: source.playerId, sourceUid: source.card.uid,
        sourceName: source.card.name, destinationAfterExecution: action.destinationAfterExecution,
        shuffleAfter: Boolean(action.shuffleAfter), triggerItemId: trigger.id
      }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
  } else if (action.type === "add_counter" && action.target === "enemy_user") {
    const target = state.players[enemyId];
    target.counters ??= {};
    target.counters[action.counter] = Number(target.counters[action.counter] ?? 0) + action.amount;
    addLog(state, `${source.card.name}: 相手ユーザーへ${action.counter}カウンター${action.amount}個。`, "effect");
  } else if (action.type === "add_counter" && action.target === "enemy_battler") {
    const uid = trigger.event.attackerUid === source.card.uid ? trigger.event.defenderUid : trigger.event.attackerUid;
    const target = findCard(state, uid)?.card;
    if (target) {
      target.load = Number(target.load ?? 0) + action.amount;
      addLog(state, `${source.card.name}: ${target.name}へ[負荷]${action.amount}。`, "effect");
    }
  } else if (action.type === "choose_effect") {
    const request = selectionRequestFromSpec(createChoiceSpec({ options: ["①相手の手札を1枚捨てる", "②相手Obに毒カウンター2"] }), {
      label: `${source.card.name}: ①または②`, message: source.card.text,
      continuation: { type: "std164-choice", playerId: source.playerId, sourceName: source.card.name, triggerItemId: trigger.id }
    });
    state.pending = { type: "selection", validTargets: [], request };
  } else if (action.type === "select" && action.selector && typeof action.selector === "object") {
    openRuntimeTargetSelection(state, source.playerId, source.card, action, { records: Object.create(null) }, { triggerItemId: trigger.id });
  } else if (action.type === "select_entity" && action.scope === "all_users_and_all_area_ob") {
    const cards = Object.values(state.players).flatMap((owner) => [...owner.front, ...owner.back]).filter(isObCard);
    const users = Object.keys(state.players).map((id) => `${id}-fortress`);
    const request = createSelectionRequest({
      mode: "single", candidates: [...users, ...cards.map((card) => card.uid)], count: 1,
      candidateLabels: {
        ...Object.fromEntries(Object.entries(state.players).map(([id, owner]) => [`${id}-fortress`, owner.user.name])),
        ...Object.fromEntries(cards.map((card) => [card.uid, card.name]))
      },
      label: `${source.card.name}: [負荷]1`, message: source.card.text,
      continuation: { type: "trigger-selected-entity-action", playerId: source.playerId, sourceName: source.card.name, action: action.then, triggerItemId: trigger.id }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
  } else if (action.type === "standby") {
    source.card.sleep = false;
    addLog(state, `${source.card.name}: スタンバイ。`, "effect");
  } else if (action.type === "generate") {
    const destination = action.destination === "event_from_zone" ? event.from : action.destination;
    for (let index = 0; index < action.count; index += 1) {
      const card = createVengeanceCard(state, action.cardId, source.playerId);
      const zone = destination === "choose_area" ? (controller.front.length < controller.user.frontLimit ? "front" : controller.back.length < controller.user.backLimit ? "back" : "front") : destination;
      if (!["front", "back", "hand"].includes(zone)) continue;
      if (["front", "back"].includes(zone)) {
        if (placeByMode(state, source.playerId, card, { zone, from: "generated", source: source.card.name }) === "placed") emitEffectPlacement(state, source.playerId, card, zone, source.card.name);
      } else controller[zone].push(card);
    }
    addLog(state, `${source.card.name}: 「${CARD_LIBRARY[action.cardId].name}」を生成。`, "effect");
  } else if (action.type === "generate_as_layer_for_each") {
    const targets = runtimeSelectionCandidates(state, source.playerId, source.card, { selector: action.selector });
    const generated = [];
    for (const host of targets) {
      const layer = createVengeanceCard(state, action.cardId, source.playerId);
      layer.layerRole = "layered";
      host.mounted.push(layer);
      generated.push(layer);
    }
    if (generated.length) emitCardsGenerated(state, source.playerId, generated, source.card.name);
    addLog(state, `${source.card.name}: 対象${targets.length}枚のレイヤーに「${CARD_LIBRARY[action.cardId].name}」を生成。`, "effect");
  } else if (action.type === "generate_as_layer" && action.target === "event_card") {
    const host = findCard(state, event.cardUid)?.card;
    if (!host) return;
    const layer = createVengeanceCard(state, action.cardId, source.playerId);
    layer.layerRole = "layered";
    host.mounted.push(layer);
    emitCardsGenerated(state, source.playerId, [layer], source.card.name);
    addLog(state, `${source.card.name}: ${host.name}のレイヤーに「${CARD_LIBRARY[action.cardId].name}」を生成。`, "effect");
  } else if (action.type === "move_each_deck_top_as_layer" && action.target === "source") {
    let moved = 0;
    for (const ownerId of ["player", "ai"]) {
      const layer = state.players[ownerId].deck.pop();
      if (!layer) continue;
      layer.layerRole = "layered";
      source.card.mounted.push(layer);
      moved += 1;
    }
    addLog(state, `${source.card.name}: お互いの山札上から合計${moved}枚をレイヤーに加えた。`, "effect");
  } else if (action.type === "access" && action.matchCategory === "event_card") {
    const index = controller.deck.findIndex((card) => matchesCardCategory(card, event.category));
    if (index >= 0) {
      const [found] = controller.deck.splice(index, 1);
      controller.hand.push(found);
      addLog(state, `${source.card.name}: ${event.category}「${found.name}」へアクセス。`, "effect");
    }
  } else if (action.type === "access" && action.filter) {
    openRuntimeAccessSelection(state, source.playerId, source.card, action, null, null, { triggerItemId: trigger.id });
  } else if (action.type === "access" && action.destination === "hand") {
    const candidates = controller.deck.filter((card) => (!action.matchCategory || matchesCardCategory(card, action.matchCategory)) && (!action.matchColor || card.color === action.matchColor));
    if (candidates.length) {
      const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
        candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])), label: `${source.card.name}のアクセス`, message: source.card.text,
        continuation: { type: "q2-access-hand", playerId: source.playerId, sourceName: source.card.name, triggerItemId: trigger.id } });
      enqueueSelection(state, { type: "selection", validTargets: request.candidates, request }, selectionProjectionMeta("engine:trigger-access", source.playerId));
    }
  } else if (action.type === "select" && action.selector === "one_own_and_one_enemy_ob") {
    const own = [...controller.front, ...controller.back].filter(isObCard).map((card) => card.uid);
    const enemy = [...state.players[enemyId].front, ...state.players[enemyId].back].filter(isObCard).map((card) => card.uid);
    if (!own.length || !enemy.length) return;
    const request = createSelectionRequest({
      mode: "exact", candidates: [...own, ...enemy], count: 2,
      label: "自分と相手のObを1体ずつ選択", message: "2体とも選んだ場合、それらを破壊する。",
      groups: [
        { id: "own", label: "自分Ob", candidates: own, minimum: 1, maximum: 1 },
        { id: "enemy", label: "相手Ob", candidates: enemy, minimum: 1, maximum: 1 }
      ],
      continuation: { type: "destroy-selected", playerId: source.playerId, sourceName: source.card.name, triggerItemId: trigger.id }
    });
    enqueueSelection(state, { type: "selection", validTargets: request.candidates, request }, selectionProjectionMeta("engine:trigger-paired-destroy", source.playerId));
  } else if (action.type === "select" && ["one_non_ob", "one_own_ob", "one_enemy_ob"].includes(action.selector)) {
    const candidates = action.selector === "one_own_ob"
      ? [...controller.front, ...controller.back].filter(isObCard)
      : action.selector === "one_enemy_ob"
        ? [...state.players[enemyId].front, ...state.players[enemyId].back].filter(isObCard)
      : Object.values(state.players).flatMap((player) => [...player.front, ...player.back]).filter((card) => !isObCard(card));
    if (!candidates.length) return;
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      candidateLabels: Object.fromEntries(candidates.map((card) => [card.uid, card.name])), label: "効果対象を選択", message: source.card.text,
      continuation: { type: action.then === "destroy" ? "destroy-selected" : action.then === "deal_damage" ? "deal-selected-damage" : action.then === "modify_and_prevent_battle_damage" ? "trigger-modify-prevent-battle" : "trigger-modify-grant", playerId: source.playerId,
        ...(action.amount !== undefined ? { amount: action.amount } : {}),
        sourceName: source.card.name, triggerItemId: trigger.id, action } });
    enqueueSelection(state, { type: "selection", validTargets: request.candidates, request }, selectionProjectionMeta("engine:trigger-select", source.playerId));
  }
}

export function addTimedModifier(state, card, action, sourceName) {
  const expiresAfterTurn = action.duration === "through_next_turn" ? state.turnNumber + 1 : state.turnNumber;
  (card.timedModifiers ??= []).push({ atk: Number(action.atk ?? 0), str: Number(action.str ?? 0), keyword: action.keyword ?? null, expiresAfterTurn });
  addLog(state, `${sourceName}: ${card.name}を${action.atk >= 0 ? "+" : ""}${action.atk}/${action.str >= 0 ? "+" : ""}${action.str}${action.keyword ? `、[${action.keyword}]付与` : ""}。`, "effect");
}
