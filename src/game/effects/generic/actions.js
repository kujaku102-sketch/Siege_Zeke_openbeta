import { swapBoardSlots } from "../../board-slots.js";
import { cardRuntimeSpec } from "../../card-runtime-specs.js";
import { isObCard } from "../../card-types.js";
import { createRuntimeToken } from "../../runtime/factory.js";
import { createSelectionRequest } from "../../selection-model.js";
import { dealCardDamage, dealFortressDamage } from "../../core/deal-damage.js";
import { drawCards } from "../../core/draw.js";
import { playCard } from "../../core/play.js";
import { queueMemoryLimitIncreasePrompt } from "../../core/scripts.js";
import { hydrateCard } from "../../core/setup.js";
import { addLog, findCard, otherPlayer, shuffle } from "../../core/shared.js";
import { resolveMadnessChecks } from "../../core/turn.js";
import { runtimeSpecCondition, runtimeSpecMatchesCard, runtimeSpecTargets, runtimeSpecValue } from "./action-values.js";
import { getMaxMemory, ownLayerEntries } from "./cost.js";
import { destroyCard, queueRuntimeDestructionContinuation } from "./destroy.js";
import { banGeneratedCards, createVengeanceCard, emitCardsGenerated } from "./generate.js";
import { emitEffectPlacement, emitRegistryInstalled, moveCardByEffect, placeByMode, placeCardByEffect, placementResult, setCardSleeping } from "./placement.js";
import { openRuntimeAccessSelection, openRuntimeChoiceSelection, openRuntimeDecodeSelection, openRuntimePlayerSelection, openRuntimeRepeatSelectMove, openRuntimeTargetSelection, openRuntimeZoneChoice } from "./selection.js";
import { clearComponents, distributeLayeredFollowers, moveCardToTrash, revealMountedCode, triggerMoved } from "./trash.js";
import { addTimedModifier } from "./trigger-actions.js";

export function executeRuntimeActions(state, playerId, source, actions, { targetUid = null, targetUids = [], runtime = { records: Object.create(null) }, continuationMeta = {} } = {}) {
  const player = state.players[playerId];
  const enemyId = otherPlayer(playerId);
  for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
    const action = actions[actionIndex];
    if (!runtimeSpecCondition(state, playerId, source, action.condition, runtime, targetUid)) continue;
    const amount = action.amount === undefined ? 0 : Number(runtimeSpecValue(state, playerId, source, action.amount, runtime));
    if (action.type === "select") {
      return openRuntimeTargetSelection(state, playerId, source, action, runtime, continuationMeta);
    } else if (action.type === "select_player") {
      return openRuntimePlayerSelection(state, playerId, source, action, runtime);
    } else if (action.type === "choose_zone") {
      return openRuntimeZoneChoice(state, playerId, source, action, runtime);
    } else if (action.type === "deal_damage" && action.target === "enemy_user") {
      dealFortressDamage(state, enemyId, amount, playerId, source.name);
    } else if (action.type === "deal_damage" && action.target === "self_user") {
      dealFortressDamage(state, playerId, amount, playerId, source.name);
    } else if (action.type === "deal_damage" && action.target === "selected_enemy_ob") {
      const target = runtimeSpecTargets(state, playerId, source, targetUid, action.target)[0];
      if (target) {
        state.lastDamageOutcome = null;
        dealCardDamage(state, enemyId, target.uid, amount, source.name, { sourcePlayerId: playerId });
        if (action.recordAs) runtime.records[action.recordAs] = state.lastDamageOutcome;
      }
    } else if (action.type === "deal_damage" && action.target === "attack_target") {
      if (targetUid === `${enemyId}-fortress`) dealFortressDamage(state, enemyId, amount, playerId, source.name);
      else {
        const target = findCard(state, targetUid);
        if (target) dealCardDamage(state, target.playerId, target.card.uid, amount, source.name, { sourcePlayerId: playerId });
      }
    } else if (action.type === "deal_damage" && action.target === "random_enemy_ob") {
      const candidates = [...state.players[enemyId].front, ...state.players[enemyId].back].filter(isObCard);
      const target = candidates[Math.floor(state.rng() * candidates.length)];
      if (target) dealCardDamage(state, enemyId, target.uid, amount, source.name, { sourcePlayerId: playerId });
    } else if (action.type === "draw") {
      const drawPlayerId = action.target === "recorded_player" ? runtime.records?.[action.playerRecord] : playerId;
      if (!state.players[drawPlayerId]) return false;
      drawCards(state, drawPlayerId, amount);
    } else if (action.type === "recover_memory" && action.target === "source_controller") {
      const before = player.memory;
      player.memory = Math.min(getMaxMemory(player), player.memory + amount);
      addLog(state, `${source.name}: メモリ ${before}→${player.memory}。`, "effect");
    } else if (action.type === "recover_memory" && action.target === "recorded_player") {
      const beneficiary = state.players[runtime.records?.[action.playerRecord]];
      if (!beneficiary) return false;
      const before = beneficiary.memory;
      beneficiary.memory = Math.min(getMaxMemory(beneficiary), beneficiary.memory + amount);
      addLog(state, `${source.name}: 所持ユーザーのメモリ ${before}→${beneficiary.memory}。`, "effect");
    } else if (action.type === "consume_memory") {
      const target = action.target === "enemy_player" ? state.players[enemyId] : player;
      const consumed = Math.min(Math.max(0, amount), Math.max(0, Number(target.memory ?? 0)));
      target.memory -= consumed;
      if (action.recordAs) runtime.records[action.recordAs] = consumed;
      addLog(state, `${source.name}: ${action.target === "enemy_player" ? "相手の" : ""}使用可能メモリを${consumed}消費。`, "effect");
    } else if (action.type === "schedule_delayed") {
      state.delayedEffects.push({
        event: action.event,
        ...(action.timing === "current_turn_end" ? { turnPlayerId: state.active } : {}),
        ...(action.timing === "next_controller_turn" ? { dueOwnerTurnsTaken: player.turnsTaken + 1 } : {}),
        type: action.action,
        ownerId: playerId,
        cardUid: source.uid,
        sourceName: source.name,
        destination: action.destination,
        resetDamage: Boolean(action.resetDamage),
        standby: Boolean(action.standby),
        sleep: Boolean(action.sleep)
      });
    } else if (action.type === "increase_memory_limit" && action.target === "source_controller") {
      player.permanentMemory += amount;
      player.memory += amount;
      queueMemoryLimitIncreasePrompt(state, playerId, source.name);
    } else if (action.type === "recover_damage" && action.target === "self_user") {
      const before = player.fortressStr;
      player.fortressStr = Math.min(player.user.maxStr, player.fortressStr + amount);
      addLog(state, `${source.name}: 自分ユーザーを${player.fortressStr - before}回復。`, "effect");
    } else if (action.type === "recover_damage" && action.target === "enemy_user") {
      const opponent = state.players[enemyId];
      const before = opponent.fortressStr;
      opponent.fortressStr = Math.min(opponent.user.maxStr, opponent.fortressStr + amount);
      addLog(state, `${source.name}: 相手ユーザーを${opponent.fortressStr - before}回復。`, "effect");
    } else if (action.type === "discard" && action.target === "own_hand_all") {
      const discarded = player.hand.splice(0);
      for (const discardedCard of discarded) moveCardToTrash(state, playerId, discardedCard, source.name);
      if (action.recordAs) runtime.records[action.recordAs] = discarded.length;
      addLog(state, `${source.name}: 手札${discarded.length}枚を捨てた。`, "effect");
    } else if (action.type === "discard" && action.target === "selected_cards") {
      let discarded = 0;
      for (const uid of targetUids.length ? targetUids : [targetUid].filter(Boolean)) {
        const index = player.hand.findIndex((card) => card.uid === uid);
        if (index < 0) continue;
        moveCardToTrash(state, playerId, player.hand.splice(index, 1)[0], source.name);
        discarded += 1;
      }
      if (action.recordAs) runtime.records[action.recordAs] = discarded;
      if (!discarded) return false;
      addLog(state, `${source.name}: 選択した手札${discarded}枚を捨てた。`, "effect");
    } else if (action.type === "discard" && action.target === "random_enemy_hand") {
      const enemy = state.players[enemyId];
      let discarded = 0;
      for (let index = 0; index < Number(action.count ?? 1) && enemy.hand.length; index += 1) {
        const randomIndex = Math.floor(state.rng() * enemy.hand.length);
        moveCardToTrash(state, enemyId, enemy.hand.splice(randomIndex, 1)[0], source.name);
        discarded += 1;
      }
      addLog(state, `${source.name}: 相手手札をランダムに${discarded}枚捨てた。`, "effect");
    } else if (action.type === "destroy" && action.target === "selected_enemy_area_card") {
      destroyCard(state, enemyId, targetUid, { source: source.name });
    } else if (action.type === "destroy" && action.target === "selected_own_ob") {
      const target = runtimeSpecTargets(state, playerId, source, targetUid, action.target)[0];
      if (target) destroyCard(state, playerId, target.uid, { source: source.name });
    } else if (action.type === "destroy" && action.target === "selected_own_area_card") {
      const location = findCard(state, targetUid);
      if (action.recordAs && location?.playerId === playerId && ["front", "back"].includes(location.zoneName)) {
        queueRuntimeDestructionContinuation(state, targetUid, {
          playerId,
          sourceId: source.id,
          sourceUid: source.uid,
          sourceName: source.name,
          sourceRuntime: source.runtimeTargetClass ? { runtimeTargetClass: source.runtimeTargetClass } : {},
          recordAs: action.recordAs,
          remainingActions: actions.slice(actionIndex + 1),
          runtime
        });
        destroyCard(state, playerId, targetUid, { source: source.name, suppressReplacement: Boolean(action.suppressReplacement) });
        return true;
      }
      const destroyed = location?.playerId === playerId && ["front", "back"].includes(location.zoneName)
        ? destroyCard(state, playerId, targetUid, { source: source.name, suppressReplacement: Boolean(action.suppressReplacement) })
        : false;
      if (action.recordAs) runtime.records[action.recordAs] = destroyed ? 1 : 0;
    } else if (action.type === "destroy" && action.target === "source") {
      if (!destroyCard(state, playerId, source.uid, { source: `${source.name}の効果`, suppressReplacement: Boolean(action.suppressReplacement) })) return false;
    } else if (action.type === "destroy" && action.target === "activation_target") {
      const uid = runtime.records?.activation_target_uid ?? targetUid;
      const location = findCard(state, uid);
      if (!location || (action.owner === "enemy" && location.playerId === playerId)
        || (action.zones?.includes("area") && !["front", "back"].includes(location.zoneName))) return false;
      const category = location.card.category;
      const destroyed = destroyCard(state, location.playerId, uid, { source: source.name, suppressReplacement: Boolean(action.suppressReplacement) });
      if (action.recordAs) runtime.records[action.recordAs] = destroyed ? 1 : 0;
      if (destroyed && action.recordCategoryAs) runtime.records[action.recordCategoryAs] = category;
    } else if (action.type === "destroy" && action.target === "selected_own_registry_cards") {
      let destroyed = 0;
      for (const uid of targetUids.length ? targetUids : [targetUid].filter(Boolean)) {
        const index = player.registry.findIndex((card) => card.uid === uid);
        if (index < 0) continue;
        moveCardToTrash(state, playerId, player.registry.splice(index, 1)[0], source.name);
        destroyed += 1;
      }
      if (action.recordAs) runtime.records[action.recordAs] = destroyed;
    } else if (action.type === "remove_components" && action.target === "selected_user_or_card") {
      if (String(targetUid).endsWith("-fortress")) {
        const targetPlayer = state.players[String(targetUid).startsWith("player-") ? "player" : "ai"];
        targetPlayer.counters = {};
        targetPlayer.timedModifiers = [];
      } else {
        const target = findCard(state, targetUid)?.card;
        if (target) clearComponents(target);
      }
    } else if (action.type === "sleep" && action.target === "enemy_ob_all") {
      for (const target of [...state.players[enemyId].front, ...state.players[enemyId].back].filter(isObCard)) {
        setCardSleeping(state, enemyId, target);
      }
    } else if (action.type === "add_counter" && action.target === "enemy_user") {
      const target = state.players[enemyId];
      target.counters ??= {};
      target.counters[action.counter] = Number(target.counters[action.counter] ?? 0) + amount;
      if (action.counter === "madness") resolveMadnessChecks(state, enemyId);
    } else if (action.type === "add_counter" && action.target === "selected_enemy_ob") {
      const target = runtimeSpecTargets(state, playerId, source, targetUid, action.target)[0];
      if (target) {
        if (action.counter === "load") target.load = Number(target.load ?? 0) + amount;
        else {
          target.counters ??= {};
          target.counters[action.counter] = Number(target.counters[action.counter] ?? 0) + amount;
        }
      }
    } else if (action.type === "move_all" && action.source === "own_hand" && action.destination === "registry") {
      const moved = player.hand.splice(0);
      for (const card of moved) {
        player.registry.push(card);
        emitRegistryInstalled(state, playerId, card, source.name);
      }
    } else if (action.type === "move_event_cards" && action.destination === "ban") {
      const moved = banGeneratedCards(state, runtime.records?.eventCardUids ?? [], source.name);
      if (action.recordAs) runtime.records[action.recordAs] = moved;
    } else if (action.type === "move_all" && action.source === "recorded_player_trash" && action.destination === "recorded_player_deck") {
      const target = state.players[runtime.records?.[action.playerRecord]];
      if (!target) return false;
      const moved = target.trash.filter((card) => !action.excludeSource || card.uid !== source.uid);
      target.trash = target.trash.filter((card) => action.excludeSource && card.uid === source.uid);
      target.deck.push(...moved);
      if (action.shuffleAfter) target.deck = shuffle(target.deck, state.rng);
    } else if (action.type === "move" && action.target === "selected_cards") {
      let moved = 0;
      let blockedByFullArea = 0;
      for (const uid of targetUids.length ? targetUids : [targetUid].filter(Boolean)) {
        const location = findCard(state, uid);
        if (!location || location.playerId !== playerId || location.zoneName !== action.source) continue;
        if (["front", "back"].includes(action.source) && ["front", "back"].includes(action.destination)) {
          // 移動先が埋まっている時は移動だけ不発にして、後続の処理(生成など)は続ける
          if (!placementResult(player, action.destination).ok) { blockedByFullArea += 1; continue; }
          if (moveCardByEffect(state, playerId, uid, action.destination, source.name)) moved += 1;
          continue;
        }
        if (["area", "back"].includes(action.destination)) {
          const zone = action.destination === "back"
            ? "back"
            : player.front.length < player.user.frontLimit ? "front" : player.back.length < player.user.backLimit ? "back" : "front";
          const placed = placeCardByEffect(state, {
            sourceOwnerId: playerId, controllerId: playerId, sourceZone: action.source, targetZone: zone, cardUid: uid,
            sourceName: source.name, placementMode: action.forced ? "forced-effect" : "normal",
            onPlaced: (card) => { card.summoningSick = zone === "front"; card.faceDown = Boolean(action.asScript); }
          });
          if (placed.status === "placed") moved += 1;
          // 強制配置が上限で入らなかった時はルール破壊で処理済み(ゴミ箱へ)。巻き戻さずに先へ進める
          else if (placed.status === "failed-placement") blockedByFullArea += 1;
          continue;
        }
        if (action.destination === "drag") {
          state.pending = { type: "access-drag-place", playerId, sourceName: source.name, queue: [uid], sourceUid: uid,
            ...(continuationMeta.triggerItemId ? { triggerItemId: continuationMeta.triggerItemId } : {}) };
          moved += 1;
          continue;
        }
        if (action.destination === "registry") {
          const index = player[action.source].findIndex((card) => card.uid === uid);
          if (index < 0) continue;
          const [card] = player[action.source].splice(index, 1);
          if (["front", "back"].includes(action.source)) revealMountedCode(player[action.source], index, card, playerId, action.source);
          card.faceDown = Boolean(action.faceDown);
          player.registry.push(card);
          if (["front", "back"].includes(action.source)) distributeLayeredFollowers(state, card, "registry", source.name);
          if (!card.faceDown) emitRegistryInstalled(state, playerId, card, source.name);
          moved += 1;
        }
        if (action.destination === "hand") {
          const index = player[action.source].findIndex((card) => card.uid === uid);
          if (index < 0) continue;
          const [card] = player[action.source].splice(index, 1);
          if (["front", "back"].includes(action.source)) revealMountedCode(player[action.source], index, card, playerId, action.source);
          player.hand.push(card);
          if (["front", "back"].includes(action.source)) distributeLayeredFollowers(state, card, "hand", source.name);
          moved += 1;
        }
        if (action.destination === "bottom_layer_of_recorded_host") {
          const recorded = runtime.records?.[action.hostRecord];
          const hostUid = Array.isArray(recorded) ? recorded[0] : recorded;
          const host = findCard(state, hostUid)?.card;
          const index = player[action.source].findIndex((card) => card.uid === uid);
          if (!host || index < 0) continue;
          const [layer] = player[action.source].splice(index, 1);
          layer.layerRole = "layered";
          host.mounted.unshift(layer);
          moved += 1;
        }
      }
      if (!moved && blockedByFullArea) addLog(state, `${source.name}: 移動先エリアが埋まっているため移動できない。`, "effect");
      else if (!moved) return false;
      else addLog(state, `${source.name}: 選択した${moved}枚を${action.destination === "registry" ? "レジストリ" : "エリア"}へ移動。`, "effect");
    } else if (action.type === "move" && action.target === "source") {
      const destination = runtimeSpecValue(state, playerId, source, action.destination, runtime);
      if (!moveCardByEffect(state, playerId, source.uid, destination, source.name)) return false;
    } else if (action.type === "move" && action.target === "activation_target") {
      const destination = runtimeSpecValue(state, playerId, source, action.destination, runtime);
      const uid = runtime.records?.activation_target_uid ?? targetUid;
      const location = findCard(state, uid);
      const controllerId = location?.playerId;
      if (!controllerId || (action.owner === "enemy" && controllerId === playerId) || (action.source !== "area" && location.zoneName !== action.source)) return false;
      if (action.controllerRecord) runtime.records[action.controllerRecord] = controllerId;
      if (action.sourceZoneRecord) runtime.records[action.sourceZoneRecord] = location.zoneName;
      if (!moveCardByEffect(state, controllerId, uid, destination, source.name)) return false;
    } else if (action.type === "move" && action.target === "recorded_cards") {
      const recorded = runtime.records?.[action.recordKey];
      const uid = Array.isArray(recorded) ? recorded[0] : recorded;
      const location = findCard(state, uid);
      if (!location || location.zoneName !== action.source) return false;
      const controller = state.players[location.playerId];
      const beneficiaryId = location.card.owner ?? location.playerId;
      const index = controller[action.source].findIndex((card) => card.uid === uid);
      if (index < 0) return false;
      if (action.destination === "hand") {
        controller.hand.push(...controller[action.source].splice(index, 1));
      } else if (action.destination === "back") {
        if (!placementResult(controller, "back").ok) return false;
        const [moved] = controller[action.source].splice(index, 1);
        if (placeByMode(state, location.playerId, moved, { zone: "back", mode: "normal", from: action.source, source: source.name }) !== "placed") return false;
        triggerMoved(state, location.playerId, moved, action.source, "back");
      } else return false;
      if (action.beneficiaryRecord) runtime.records[action.beneficiaryRecord] = beneficiaryId;
    } else if (action.type === "move" && action.target === "random_each_player" && action.destination === "ban") {
      for (const targetPlayer of Object.values(state.players)) {
        const pool = action.source === "hand_and_area"
          ? ["hand", "front", "back"].flatMap((zoneName) => targetPlayer[zoneName].map((card) => ({ zoneName, card })))
          : [];
        if (!pool.length) continue;
        const chosen = pool[Math.floor(state.rng() * pool.length)];
        const index = targetPlayer[chosen.zoneName].findIndex((card) => card.uid === chosen.card.uid);
        if (index < 0) continue;
        const [card] = targetPlayer[chosen.zoneName].splice(index, 1);
        if (["front", "back"].includes(chosen.zoneName)) revealMountedCode(targetPlayer[chosen.zoneName], index, card, card.controller ?? card.owner, chosen.zoneName);
        targetPlayer.ban.push(card);
        if (["front", "back"].includes(chosen.zoneName)) distributeLayeredFollowers(state, card, "ban", source.name);
      }
    } else if (action.type === "swap" && action.target === "selected_own_area_cards") {
      const selected = [...new Set(targetUids.length ? targetUids : [targetUid].filter(Boolean))]
        .map((uid) => findCard(state, uid))
        .filter((entry) => entry?.playerId === playerId && ["front", "back"].includes(entry.zoneName) && isObCard(entry.card));
      if (selected.length !== 2) return false;
      const [first, second] = selected;
      const firstIndex = player[first.zoneName].findIndex((card) => card.uid === first.card.uid);
      const secondIndex = player[second.zoneName].findIndex((card) => card.uid === second.card.uid);
      swapBoardSlots(first.card, second.card);
      player[first.zoneName][firstIndex] = second.card;
      player[second.zoneName][secondIndex] = first.card;
      triggerMoved(state, playerId, first.card, first.zoneName, second.zoneName);
      triggerMoved(state, playerId, second.card, second.zoneName, first.zoneName);
      addLog(state, `${source.name}: ${first.card.name}と${second.card.name}の位置を交換。`, "effect");
    } else if (action.type === "mill" && action.target === "own_deck_top" && action.destination === "trash") {
      let recorded = 0;
      for (let index = 0; index < amount && player.deck.length; index += 1) {
        const card = player.deck.pop();
        const outcome = card.trashReplacement === "ban" || card.replaceTrashWithBan
          ? (player.ban.push(card), "ban")
          : moveCardToTrash(state, playerId, card, source.name);
        if (outcome === "trash" && runtimeSpecMatchesCard(card, action.recordFilter, null, { state, playerId, source, runtime })) recorded += 1;
      }
      if (action.recordAs) runtime.records[action.recordAs] = recorded;
    } else if (action.type === "shuffle" && action.target === "own_deck") {
      player.deck = shuffle(player.deck, state.rng);
    } else if (action.type === "access") {
      openRuntimeAccessSelection(state, playerId, source, action, null, null, continuationMeta);
    } else if (action.type === "decode") {
      return openRuntimeDecodeSelection(state, playerId, source, action, runtime);
    } else if (action.type === "choose_effect") {
      return openRuntimeChoiceSelection(state, playerId, source, action, runtime);
    } else if (action.type === "modify_stats") {
      const runtimeSource = action.className ? { ...source, runtimeTargetClass: action.className } : source;
      for (const target of runtimeSpecTargets(state, playerId, runtimeSource, targetUid, action.target)) {
        const multiplier = action.perTargetMultiplier === "layer_count"
          ? Number(target.mounted?.length ?? 0)
          : action.multiplier ? Number(runtimeSpecValue(state, playerId, source, action.multiplier, runtime)) : 1;
        if (action.duration === "through_next_turn") {
          addTimedModifier(state, target, { ...action, atk: Number(action.atk ?? 0) * multiplier, str: Number(action.str ?? 0) * multiplier }, source.name);
        } else {
          const atkField = action.duration === "turn" ? "tempAtk" : "permanentAtk";
          const strField = action.duration === "turn" ? "tempStr" : "permanentStr";
          target[atkField] = Number(target[atkField] ?? 0) + Number(action.atk ?? 0) * multiplier;
          target[strField] = Number(target[strField] ?? 0) + Number(action.str ?? 0) * multiplier;
        }
      }
    } else if (action.type === "modify_execution_cost" && action.target === "selected_cards") {
      for (const uid of targetUids.length ? targetUids : [targetUid].filter(Boolean)) {
        const target = findCard(state, uid)?.card;
        if (!target) continue;
        target.turnCostModifier = Number(target.turnCostModifier ?? 0) + amount;
      }
    } else if (action.type === "grant_keyword") {
      const runtimeSource = action.className ? { ...source, runtimeTargetClass: action.className } : source;
      for (const target of runtimeSpecTargets(state, playerId, runtimeSource, targetUid, action.target)) {
        target.grantedKeywords = [...new Set([...(target.grantedKeywords ?? []), action.keyword])];
        if (action.duration === "turn") target.keywordExpiries = { ...(target.keywordExpiries ?? {}), [action.keyword]: state.turnNumber };
        if (action.duration === "through_next_turn_end") target.keywordExpiries = { ...(target.keywordExpiries ?? {}), [action.keyword]: state.turnNumber + 1 };
      }
    } else if (action.type === "set_flag") {
      const value = runtimeSpecValue(state, playerId, source, action.value);
      if (action.target === "own_class_ob_all") {
        for (const target of runtimeSpecTargets(state, playerId, { ...source, runtimeTargetClass: action.className }, targetUid, action.target)) target[action.flag] = value;
      } else {
        const target = action.target === "enemy_player" ? state.players[enemyId] : source;
        target[action.flag] = value;
      }
    } else if (action.type === "move" && action.target === "deck_top" && action.destination === "registry") {
      for (let index = 0; index < Number(action.count ?? 1); index += 1) {
        const installed = player.deck.pop();
        if (!installed) break;
        player.registry.push(installed);
        emitRegistryInstalled(state, playerId, installed, source.name);
      }
    } else if (action.type === "generate") {
      const generated = [];
      const generatedPlayerId = action.playerRecord ? runtime.records?.[action.playerRecord] : playerId;
      const generatedPlayer = state.players[generatedPlayerId];
      if (!generatedPlayer) return false;
      const availableIds = action.cardIds ?? Array(Number(action.count ?? 1)).fill(action.cardId);
      const cardIds = action.randomOne
        ? [availableIds[Math.floor(state.rng() * availableIds.length)]]
        : availableIds;
      const destination = runtimeSpecValue(state, playerId, source, action.destination, runtime);
      for (let index = 0; index < cardIds.length; index += 1) {
        const card = action.factory === "punks_token"
          ? hydrateCard(createRuntimeToken(state.runtimeContext ?? null, generatedPlayerId, ++state.tokenSerial))
          : createVengeanceCard(state, cardIds[index], generatedPlayerId);
        generated.push(card);
        if (destination === "hand") {
          generatedPlayer.hand.push(card);
          continue;
        }
        if (destination === "execute") {
          generatedPlayer.hand.push(card);
          const zone = card.category === "Script"
            ? (generatedPlayer.back.length < generatedPlayer.user.backLimit ? "back" : "front")
            : (generatedPlayer.front.length < generatedPlayer.user.frontLimit ? "front" : generatedPlayer.back.length < generatedPlayer.user.backLimit ? "back" : "front");
          playCard(state, generatedPlayerId, card.uid, {
            zone, free: Boolean(action.free), force: Boolean(action.forced), ignoreColor: Boolean(action.free),
            placementCause: "effect", placementSource: source.name, placementMode: action.forced ? "forced-effect" : "normal"
          });
          continue;
        }
        const zone = ["front", "back"].includes(destination)
          ? destination
          : generatedPlayer.front.length < generatedPlayer.user.frontLimit ? "front" : generatedPlayer.back.length < generatedPlayer.user.backLimit ? "back" : "front";
        card.summoningSick = zone === "front";
        const placed = placeByMode(state, generatedPlayerId, card, { zone, from: "generated", source: source.name });
        if (placed === "placed" && action.factory === "punks_token") emitEffectPlacement(state, generatedPlayerId, card, zone, source.name);
      }
      if (destination === "hand" && generated.length) emitCardsGenerated(state, generatedPlayerId, generated, source.name);
    } else if (action.type === "consume_layers" && action.target === "selected_cards") {
      const selected = new Set(targetUids.length ? targetUids : [targetUid].filter(Boolean));
      let consumed = 0;
      for (const owner of Object.values(state.players)) {
        for (const { host, layer } of ownLayerEntries(owner)) {
          if (!selected.has(layer.uid)) continue;
          const index = host.mounted.findIndex((candidate) => candidate.uid === layer.uid);
          if (index < 0) continue;
          const [removed] = host.mounted.splice(index, 1);
          moveCardToTrash(state, removed.owner ?? playerId, removed, `${source.name}のレイヤー消費`);
          consumed += 1;
        }
      }
      if (action.recordAs) runtime.records[action.recordAs] = consumed;
      addLog(state, `${source.name}: レイヤー${consumed}枚を消費。`, "effect");
    } else if (action.type === "repeat_select_move") {
      const remaining = Number(runtimeSpecValue(state, playerId, source, action.count, runtime));
      if (remaining > 0) return openRuntimeRepeatSelectMove(state, playerId, source, action, runtime, remaining);
    } else throw new Error(`Unsupported card runtime operation: ${action.type}`);
  }
  return true;
}

export function executeCardRuntimeSpec(state, phase, playerId, source, { targetUid = null, continuationMeta = {} } = {}) {
  const spec = cardRuntimeSpec(source.id, phase);
  if (!spec) return false;
  return executeRuntimeActions(state, playerId, source, spec.actions, { targetUid, continuationMeta });
}

export function resumeDestroyLkiFollowUp(state, targetUid) {
  const followUp = state.destroyLkiFollowUps?.[targetUid];
  if (!followUp) return false;
  delete state.destroyLkiFollowUps[targetUid];
  const player = state.players[followUp.playerId];
  if (followUp.type === "std157") {
    const candidates = player.hand.filter((card) => isObCard(card) && card.color === "黒" && Number(card.cost ?? 0) <= followUp.x);
    if (!candidates.length) return true;
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((card) => card.uid), count: 1,
      label: `元メモリ${followUp.x}以下の黒Obを無償配置`, message: followUp.sourceName,
      continuation: { type: "std157-place", playerId: followUp.playerId, sourceName: followUp.sourceName } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  const candidates = player.trash.filter(isObCard);
  if (!candidates.length) return true;
  const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((card) => card.uid), minimum: 0, maximum: candidates.length,
    budget: followUp.x, candidateValues: Object.fromEntries(candidates.map((card) => [card.uid, Number(card.cost ?? 0)])),
    label: `元メモリ合計${followUp.x}以下でObを任意サルベージ`, message: followUp.sourceName,
    continuation: { type: "std162-salvage", playerId: followUp.playerId, sourceName: followUp.sourceName } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}
