import { cardAtk, cardHasKeyword, visibleHandExecutionPayment } from "../game/engine.js";
import { isObCard } from "../game/card-types.js";
const BOARD_ZONES = new Set(["front", "back"]);
const USER_ABILITY_LABELS = Object.freeze({
  turbo: "TURBO BOOST",
  mono_color: "MONO COLOR",
  registry_liberty: "REGISTRY LIBERTY",
  recovery_boot: "RECOVERY BOOT",
  dimension_innovation: "DIMENSION SHIFT",
  do_or_isnt: "DO OR IS'NT",
  trash_never_empty: "SALVAGE",
  kickass: "KICKASS ×2",
  watching_you: "WATCHING YOU"
});

function userAbilityPresentation(event) {
  const target = event.affectedPlayerId === "player" ? "YOU" : "OPPONENT";
  const amount = Number(event.amount ?? 0);
  const change = Number.isFinite(event.before) && Number.isFinite(event.after) ? ` ${event.before}→${event.after}` : "";
  const labels = {
    turbo: `TURBO BOOST / ${target} / MEM${change}`,
    mono_color: `MONO COLOR / ${target} / ATK +${amount}`,
    registry_liberty: `REGISTRY LIBERTY / ${target} / DRAW ${amount}`,
    recovery_boot: `RECOVERY BOOT / ${target} / STR${change}`,
    dimension_innovation: `DIMENSION SHIFT / ${target} / BAN ${event.after ?? amount} / STR ${event.strAfter}`,
    do_or_isnt: event.branch === "first-ob-discount"
      ? `DO OR IS'NT / ${target} / COST ${amount}`
      : event.branch === "five-plus-damage-down"
        ? `DO OR IS'NT / ${target} / DAMAGE${change}`
        : `DO OR IS'NT / ${target} / STR ${event.strBefore}→${event.strAfter} / MEM ${event.memoryBefore}→${event.memoryAfter}`,
    trash_never_empty: event.branch === "salvaged"
      ? `SALVAGE / ${target} / RECOVER ${amount}`
      : event.branch === "milled-different-symbol"
        ? `SALVAGE / ${target} / DRAW ${amount}`
        : `SALVAGE / ${target} / MILL ${amount}`,
    kickass: `KICKASS ×2 / ${target}${change}`,
    watching_you: `WATCHING YOU / ${target} / MULLIGAN ${amount}/3`
  };
  return { profile: event.abilityKey, label: labels[event.abilityKey] ?? USER_ABILITY_LABELS[event.abilityKey] };
}

function cardsOf(state, viewer) {
  const cards = new Map();
  for (const [playerId, player] of Object.entries(state?.players ?? {})) {
    for (const zone of ["hand", "front", "back", "registry", "trash", "deck", "ban"]) {
      // Hand costs have their own viewer-safe snapshot.  Board-card statistics
      // must never use a hand projection as their visual baseline.
      if (["hand", "deck", "ban"].includes(zone)) continue;
      for (const card of player[zone] ?? []) {
        // A viewer may see that an opponent has a face-down card, but its
        // identity and combat data must never enter the VFX snapshot.
        if (playerId !== viewer && card.faceDown) continue;
        cards.set(card.uid, {
        uid: card.uid,
        id: card.id,
        name: card.name,
        playerId,
        zone,
        damage: Number(card.damage ?? 0),
        atk: isObCard(card) && !card.faceDown ? cardAtk(state, playerId, card) : null,
        attacked: Boolean(card.attackedThisTurn),
        sleep: Boolean(card.sleep),
        faceDown: Boolean(card.faceDown),
        securityGuard: zone === "front" && Boolean(card.sleep) && !card.faceDown && cardHasKeyword(state, playerId, card, "SECURITY"),
        layers: Number(card.mounted?.length ?? 0)
        });
      }
    }
  }
  return cards;
}

const finite = (value) => Number.isFinite(value) ? Number(value) : undefined;
const viewerFor = (state) => state.viewerId ?? (state.mode === "sandbox" ? state.sandboxUi?.actor ?? "player" : "player");
const placementPair = (events, index) => {
  const event = events[index]; const prior = events[index - 1];
  return event?.type === "card_effect_placed" && prior?.type === "card_placed"
    && prior.cardUid === event.cardUid && prior.playerId === event.playerId && prior.to === event.to
    && prior.placementCause === event.placementCause && prior.source === event.source;
};
const eventStart = (previous, events) => {
  const seen = new Set((previous?.events ?? []).map((event) => event.id));
  for (let index = events.length - 1; index >= 0; index -= 1) if (seen.has(events[index]?.id)) return index + 1;
  return 0;
};
function rawCard(state, uid) {
  for (const player of Object.values(state?.players ?? {})) for (const zone of ["hand", "front", "back", "registry", "trash", "deck", "ban"]) {
    const card = (player[zone] ?? []).find((item) => item.uid === uid); if (card) return card;
  }
  return null;
}
function projectedStep(step, owners) {
  if (!step || !["value_change", "measurement", "state_change", "multiply", "transfer"].includes(step.kind)) return null;
  const safeTarget = (target) => {
    if (!target || !["player_stat", "card_stat", "status", "zone_count"].includes(target.kind)) return null;
    if (target.kind === "player_stat") return { kind: target.kind, playerId: target.playerId, metric: target.metric };
    if (target.kind === "zone_count") return { kind: target.kind, playerId: target.playerId, zone: target.zone };
    if (target.kind === "status") return { kind: target.kind, playerId: target.playerId, status: target.status };
    return owners.get(target.cardUid) === target.playerId ? { kind: "card_stat", playerId: target.playerId, metric: target.metric, cardUid: target.cardUid } : null;
  };
  if (step.kind === "transfer") {
    const from = safeTarget(step.from), to = safeTarget(step.to);
    return from?.kind === "zone_count" && to?.kind === "zone_count" && Number.isFinite(step.count) ? { kind: "transfer", from, to, count: Number(step.count) } : null;
  }
  const target = safeTarget(step.target); if (!target) return null;
  if (step.kind === "state_change") {
    return typeof step.before === "boolean" && typeof step.after === "boolean"
      ? { kind: step.kind, target, before: step.before, after: step.after }
      : null;
  }
  const result = { kind: step.kind, target };
  for (const key of ["before", "after", "factor"]) if (Number.isFinite(step[key])) result[key] = Number(step[key]);
  return result;
}
function projectEvents(state, previous, viewer, owners) {
  const raw = state?.events ?? [], start = eventStart(previous, raw);
  const initialSnapshot = !previous;
  const privateIds = new Set(previous?.privatePlacementEventIds ?? []);
  const rollingIds = new Set(raw.map((event) => event.id));
  for (const id of privateIds) if (!rollingIds.has(id)) privateIds.delete(id);
  for (let index = start; index < raw.length; index += 1) {
    const event = raw[index];
    if (!["card_placed", "card_effect_placed"].includes(event.type) || event.playerId === viewer) continue;
    const hidden = rawCard(state, event.cardUid)?.faceDown;
    if (initialSnapshot || event.placementCause === "set" || hidden || owners.get(event.cardUid) !== event.playerId) {
      privateIds.add(event.id); if (placementPair(raw, index)) privateIds.add(raw[index - 1].id);
    }
  }
  const ref = (uid, playerId) => owners.get(uid) === playerId ? uid : undefined;
  const events = raw.map((event, index) => {
    const base = { id: event.id, type: event.type };
    const privatePlacement = privateIds.has(event.id);
    if (["card_placed", "card_effect_placed"].includes(event.type)) return { ...base, playerId: event.playerId, to: event.to, placementCause: event.placementCause, pairedPlacement: placementPair(raw, index), ...(privatePlacement ? {} : { cardUid: ref(event.cardUid, event.playerId) }) };
    if (["registry_installed", "registry_left", "card_moved"].includes(event.type)) return { ...base, playerId: event.playerId, from: event.from, to: event.to, reason: event.reason === "recover" ? "recover" : undefined, cardUid: ref(event.cardUid, event.playerId) };
    if (event.type === "attack_declared") return { ...base, playerId: event.playerId, attackerUid: ref(event.attackerUid, event.playerId), targetUid: ref(event.targetUid, event.targetPlayerId) };
    if (["card_damaged", "user_damaged", "layers_consumed", "memory_limit_increased"].includes(event.type)) return { ...base, playerId: event.playerId, amount: finite(event.amount), cardUid: ref(event.cardUid, event.playerId), sourceCardUid: ref(event.sourceCardUid, event.playerId) };
    if (event.type === "user_ability_feedback" && USER_ABILITY_LABELS[event.abilityKey]) return { ...base, abilityKey: event.abilityKey, ownerPlayerId: event.ownerPlayerId, affectedPlayerId: event.affectedPlayerId, branch: event.branch, before: finite(event.before), after: finite(event.after), amount: finite(event.amount), strBefore: finite(event.strBefore), strAfter: finite(event.strAfter), memoryBefore: finite(event.memoryBefore), memoryAfter: finite(event.memoryAfter), steps: (event.steps ?? []).map((step) => projectedStep(step, owners)).filter(Boolean) };
    return base;
  });
  return { events, privatePlacementEventIds: privateIds };
}
export function snapshotVisualState(state, previous = null) {
  const viewer = state.viewerId ?? (state.mode === "sandbox" ? state.sandboxUi?.actor ?? "player" : "player");
  const handCosts = Object.fromEntries((state.players[viewer]?.hand ?? []).map((card) => [card.uid, visibleHandExecutionPayment(state, viewer, card, viewer)]).filter(([, value]) => value));
  const cards = cardsOf(state, viewer);
  const owners = new Map([...cards].map(([uid, card]) => [uid, card.playerId]));
  for (const uid of Object.keys(handCosts)) owners.set(uid, viewer);
  const projected = projectEvents(state, previous, viewer, owners);
  return {
    cards,
    users: Object.fromEntries(Object.entries(state?.players ?? {}).map(([playerId, player]) => [playerId, {
      str: Number(player.fortressStr), memory: Number(player.memory)
    }])),
    events: projected.events,
    visibleCardOwners: owners,
    privatePlacementEventIds: projected.privatePlacementEventIds,
    handCosts,
    winner: state?.winner ?? null,
    victory: state?.victory ? { ...state.victory } : null
  };
}

function cardElement(root, uid) {
  return [...root.querySelectorAll("[data-card-ref], [data-card-uid]")].find((element) => (element.dataset.cardRef ?? element.dataset.cardUid) === uid) ?? null;
}

// Production receives only viewer-safe events and read models. Legacy snapshot
// helpers above remain available to isolated historical unit tests.
export function applyRuntimeVisualEvents(root, events, model) {
  const owners = new Map();
  const visit = card => { owners.set(card.cardRef,card.controllerSeat); if (!card.faceDown) card.mounted.forEach(visit); };
  for (const seat of model.seats) {
    seat.hand.cards?.forEach(visit);
    for (const zone of ['front','back','registry','trash','ban']) seat[zone].cards.forEach(visit);
  }
  const target = value => value ? {...value,playerId:value.seatId,cardUid:value.cardRef} : null;
  const effects = [];
  for (const event of events) {
    if (event.type === 'attack_declared' && event.source?.cardRef) effects.push({type:'attack',uid:event.source.cardRef,playerId:event.actorSeat === model.match.viewerSeat ? 'player' : 'ai'});
    if (event.type === 'combat_resolved' && event.target?.cardRef) effects.push({type:'hit',uid:event.target.cardRef,amount:event.damage});
    if (event.type === 'card_damaged' && event.target?.cardRef) effects.push({type:'hit',uid:event.target.cardRef,amount:event.amount});
    if (event.type === 'user_damaged') effects.push({type:'user-hit',playerId:event.target.seatId,amount:event.amount});
    if (event.type === 'card_moved' && event.target?.cardRef) effects.push({type:event.to.kind === 'board' ? 'deploy' : 'move',uid:event.target.cardRef});
    if (event.type === 'user_ability_feedback') effects.push({type:'user-ability',profile:event.abilityKey,abilityKey:event.abilityKey,
      ownerPlayerId:event.actorSeat,affectedPlayerId:event.affectedSeat,sourceEventId:event.eventId,label:USER_ABILITY_LABELS[event.abilityKey],
      steps:event.steps.map(step => step.kind === 'transfer' ? {...step,from:target(step.from),to:target(step.to)} : {...step,target:target(step.target)})});
  }
  applyVisualEffects(root,{effects,next:{visibleCardOwners:owners}});
}

export function planVisualEffects(root, previous, state, queuedEffects = []) {
  const next = snapshotVisualState(state, previous);
  if (!previous) return { effects: [], next };
  const effects = [];
  const add = (effect) => effects.push({ sequence: effects.length + 1, ...effect });
  const has = (type, uid = null, playerId = null) => effects.some((effect) => effect.type === type
    && (!uid || effect.uid === uid) && (!playerId || effect.playerId === playerId));
  for (const effect of queuedEffects) add(effect);
  const placementVisualType = (event) => event.placementCause === "access_drag" ? "access-drag" : event.placementCause === "set" ? "set" : event.placementCause === "execution" ? "login" : "deploy";
  for (let eventIndex = eventStart(previous, next.events); eventIndex < next.events.length; eventIndex += 1) {
    const event = next.events[eventIndex];
    const base = { sourceEventId: event.id, uid: event.cardUid, playerId: event.playerId, amount: Number(event.amount ?? 0),
      fromZone: event.from, toZone: event.to };
    if (event.type === "card_placed" || event.type === "card_effect_placed") {
      const type = placementVisualType(event);
      if (event.pairedPlacement) continue;
      add({ ...base, type, label: type === "access-drag" ? "ACCESS / DRAG" : type === "set" ? "SET" : type === "login" ? "LOGIN" : "PLACED" });
    } else if (event.type === "registry_installed") add({ ...base, type: "install", label: "INSTALL" });
    else if (event.type === "registry_left") add({ ...base, type: "registry-left", label: event.reason === "recover" ? "RECOVER" : "REGISTRY OUT" });
    else if (event.type === "card_moved") add({ ...base, type: BOARD_ZONES.has(event.from) && BOARD_ZONES.has(event.to) ? "relog" : "move", label: "MOVE" });
    else if (event.type === "attack_declared") add({ ...base, type: "attack", uid: event.attackerUid, targetUid: event.targetUid, label: "ATTACK" });
    else if (event.type === "card_damaged") add({ ...base, type: "hit", label: `DAMAGE ${Number(event.amount ?? 0)}` });
    else if (event.type === "user_damaged") add({ ...base, type: "user-hit", label: `USER DAMAGE ${Number(event.amount ?? 0)}` });
    else if (event.type === "card_destroyed") add({ ...base, type: "destroy", name: event.cardName, label: "DESTROY" });
    else if (event.type === "layers_consumed") add({ ...base, type: "layer-move", uid: event.sourceCardUid, label: `LAYER -${Number(event.amount ?? 0)}` });
    else if (event.type === "script_activated") add({ ...base, type: "script-activated", label: "SCRIPT ACTIVE" });
    else if (event.type === "memory_limit_increased") add({ ...base, type: "memory-change", label: "MEMORY LIMIT" });
    else if (event.type === "user_ability_feedback" && USER_ABILITY_LABELS[event.abilityKey]) {
      const presentation = userAbilityPresentation(event);
      add({
        ...base,
        type: "user-ability",
        playerId: event.affectedPlayerId,
        ownerPlayerId: event.ownerPlayerId,
        affectedPlayerId: event.affectedPlayerId,
        abilityKey: event.abilityKey,
        profile: presentation.profile,
        branch: event.branch,
        before: event.before,
        after: event.after,
        strBefore: event.strBefore,
        strAfter: event.strAfter,
        memoryBefore: event.memoryBefore,
        memoryAfter: event.memoryAfter,
        steps: structuredClone(event.steps ?? []),
        label: presentation.label
      });
    }
  }
  for (const [uid, cost] of Object.entries(next.handCosts)) {
    const before = previous.handCosts?.[uid];
    if (!before ? cost.value !== cost.printed : before.value !== cost.value) add({ type: "cost-change", uid, playerId: state.viewerId ?? (state.mode === "sandbox" ? state.sandboxUi?.actor ?? "player" : "player"), profile: "watching_you", steps: [{ kind: "value_change", target: { kind: "card_stat", playerId: state.viewerId ?? (state.mode === "sandbox" ? state.sandboxUi?.actor ?? "player" : "player"), metric: "effective_cost", cardUid: uid }, before: before?.value ?? cost.printed, after: cost.value }], label: `COST ${before?.value ?? cost.printed}→${cost.value}` });
  }
  for (const [uid, card] of next.cards) {
    const before = previous.cards.get(uid);
    const monoEvent = effects.find((effect) => effect.type === "user-ability" && effect.abilityKey === "mono_color" && effect.playerId === card.playerId);
    if (monoEvent && BOARD_ZONES.has(card.zone) && Number.isFinite(card.atk) && (!before || Number.isFinite(before.atk) && before.atk !== card.atk)) monoEvent.steps.push({ kind: "value_change", target: { kind: "card_stat", playerId: card.playerId, metric: "atk", cardUid: uid }, before: before?.atk ?? card.atk - 1, after: card.atk });
    if (card.securityGuard && !before?.securityGuard) add({ type: "security-shield-on", uid, label: "SECURITY" });
    if (BOARD_ZONES.has(card.zone) && (!before || !BOARD_ZONES.has(before.zone)) && !has("deploy", uid) && !has("access-drag", uid) && !has("login", uid) && !has("set", uid)) add({ type: "deploy", uid, playerId: card.playerId, label: "PLACED" });
    if (BOARD_ZONES.has(card.zone) && before && !before.attacked && card.attacked && !has("attack", uid)) add({ type: "attack", uid, playerId: card.playerId, label: "ATTACK" });
    if (BOARD_ZONES.has(card.zone) && before && card.damage > before.damage && !has("hit", uid)) add({ type: "hit", uid, amount: card.damage - before.damage, label: `DAMAGE ${card.damage - before.damage}` });
    if (before && card.damage < before.damage) add({ type: "heal", uid, amount: before.damage - card.damage, label: `HEAL ${before.damage - card.damage}` });
    if (before && !before.sleep && card.sleep) add({ type: "sleep", uid, label: "SLEEP" });
    if (before && before.sleep && !card.sleep) add({ type: "standby", uid, label: "STANDBY" });
    if (before && card.zone === "registry" && !before.faceDown && card.faceDown) add({ type: "compress", uid, label: "COMPRESS" });
    if (before && card.zone === "registry" && before.faceDown && !card.faceDown) add({ type: "decompress", uid, label: "DECOMPRESS" });
    if (before && before.layers !== card.layers && !has("layer-move", uid)) add({ type: "layer-move", uid, amount: card.layers - before.layers, label: `LAYER ${card.layers - before.layers > 0 ? "+" : ""}${card.layers - before.layers}` });
    if (before && before.zone !== card.zone && !has("relog", uid) && !has("move", uid)) {
      const type = card.zone === "trash" ? "trash" : card.zone === "ban" ? "ban" : BOARD_ZONES.has(before.zone) && card.zone === "hand" ? "bounce" : BOARD_ZONES.has(before.zone) && BOARD_ZONES.has(card.zone) ? "relog" : "move";
      add({ type, uid, playerId: card.playerId, fromZone: before.zone, toZone: card.zone, label: type.toUpperCase() });
    }
  }
  for (const [uid, before] of previous.cards) {
    const after = next.cards.get(uid);
    if (before.securityGuard && !after?.securityGuard) {
      const rect = cardElement(root, uid)?.querySelector(".card-security-shield")?.getBoundingClientRect();
      add({ type: "security-shield-off", uid, rect: rect?.width ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null });
    }
    if (!BOARD_ZONES.has(before.zone) || !after || after.zone !== "trash") continue;
    if (has("destroy", uid)) {
      const effect = effects.find((item) => item.type === "destroy" && item.uid === uid);
      const element = cardElement(root, uid);
      const rect = element?.getBoundingClientRect();
      if (effect && rect?.width && rect?.height) effect.rect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      continue;
    }
    const element = cardElement(root, uid);
    const rect = element?.getBoundingClientRect();
    if (rect?.width && rect?.height) add({ type: "destroy", uid, name: before.name, label: "DESTROY", rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } });
  }
  for (const [playerId, value] of Object.entries(next.users)) {
    const before = previous.users[playerId];
    if (!before) continue;
    if (value.str < before.str && !has("user-hit", null, playerId)) add({ type: "user-hit", playerId, amount: before.str - value.str, label: `USER DAMAGE ${before.str - value.str}` });
    if (value.str > before.str) add({ type: "user-heal", playerId, amount: value.str - before.str, label: `USER HEAL ${value.str - before.str}` });
    if (Number.isFinite(value.memory) && Number.isFinite(before.memory) && value.memory !== before.memory && !has("memory-change", null, playerId)) add({ type: "memory-change", playerId, amount: value.memory - before.memory, label: `MEM ${value.memory - before.memory > 0 ? "+" : ""}${value.memory - before.memory}` });
  }
  const previousLocked = previous.victory?.lockedOutcome ?? previous.winner ?? null;
  const nextLocked = next.victory?.lockedOutcome ?? next.winner ?? null;
  if (!previousLocked && nextLocked) add({ type: "win-locked", outcome: nextLocked, label: nextLocked === "draw" ? "DRAW LOCKED" : `${nextLocked.toUpperCase()} WIN LOCKED` });
  if (!(previous.victory?.finished ?? Boolean(previous.winner)) && (next.victory?.finished ?? Boolean(next.winner))) add({ type: "game-finished", outcome: nextLocked, label: "GAME FINISHED" });
  return { effects, next };
}

function removeAfterAnimation(element, duration = 900) {
  element.addEventListener("animationend", () => element.remove(), { once: true });
  setTimeout(() => element.remove(), duration);
}

function transientClass(element, className) {
  if (!element) return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  element.addEventListener("animationend", () => element.classList.remove(className), { once: true });
}

function popup(container, amount) {
  if (!container) return;
  const node = document.createElement("span");
  node.className = "vfx-damage-popup";
  node.textContent = `-${amount}`;
  container.append(node);
  removeAfterAnimation(node);
}

function eventChip(root, effect) {
  if (!effect.label) return;
  let feed = root.querySelector(".vfx-event-feed");
  if (!feed) {
    feed = document.createElement("div");
    feed.className = "vfx-event-feed";
    feed.setAttribute("aria-hidden", "true");
    root.append(feed);
  }
  const chip = document.createElement("span");
  chip.className = `vfx-event-chip vfx-event-${effect.type}${effect.profile ? ` vfx-ability-${effect.profile}` : effect.abilityKey ? ` vfx-ability-${effect.abilityKey}` : ""}`;
  chip.textContent = effect.label;
  feed.append(chip);
  removeAfterAnimation(chip, effect.type === "user-ability" ? 1100 : 900);
}

function anchorElements(root, target, snapshot) {
  const player = CSS.escape(target.playerId);
  const firstVisible = (elements) => elements.find((element) => { const rect = element.getBoundingClientRect(); return rect.width && rect.height; }) ? [elements.find((element) => { const rect = element.getBoundingClientRect(); return rect.width && rect.height; })] : [];
  if (target.kind === "zone_count") return firstVisible([...root.querySelectorAll(`[data-vfx-anchor="${target.zone}"][data-owner="${player}"]`)]);
  if (target.kind === "player_stat") {
    const anchor = target.metric === "memory_limit" ? "memory-limit" : target.metric === "memory" ? "fortress-memory" : target.metric === "damage" ? "combat-result" : "fortress-str";
    return firstVisible([...root.querySelectorAll(`[data-vfx-anchor="${anchor}"][data-owner="${player}"]`)]);
  }
  if (target.kind === "card_stat") {
    if (snapshot.visibleCardOwners?.get(target.cardUid) !== target.playerId) return [];
    return firstVisible(target.metric === "effective_cost" ? [cardElement(root, target.cardUid)?.querySelector(".cost")].filter(Boolean) : [cardElement(root, target.cardUid)].filter(Boolean));
  }
  if (target.kind === "status") return firstVisible([...root.querySelectorAll(`[data-vfx-anchor="registry"][data-owner="${player}"]`)]);
  return [];
}

function stepText(step, role = "single") {
  if (step.kind === "transfer") return role === "from" ? `${step.from.zone.toUpperCase()} −${step.count}` : `${step.to.zone.toUpperCase()} +${step.count}`;
  if (step.kind === "multiply") return `${step.before}×${step.factor}=${step.after}`;
  if (step.kind === "state_change") return `${step.target.status.replaceAll("_", " ").toUpperCase()} ${step.after === true ? "ON" : "OFF"}`;
  return `${step.before}→${step.after}`;
}

function anchorOverlay(anchor, effect, step, target = step.target ?? step.to, stepIndex = 0, role = "single") {
  const rect = anchor.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const overlay = document.createElement("span");
  overlay.className = `vfx-ability-anchor vfx-ability-${effect.profile} vfx-anchor-${step.target?.kind ?? step.to?.kind ?? "zone"}`;
  overlay.setAttribute("aria-hidden", "true");
  overlay.dataset.vfxOwner = effect.ownerPlayerId ?? "";
  overlay.dataset.vfxAffectedPlayer = effect.affectedPlayerId ?? "";
  overlay.dataset.vfxTargetPlayer = target?.playerId ?? "";
  overlay.dataset.vfxTarget = target ? `${target.kind}:${target.metric ?? target.zone ?? target.status ?? ""}` : "";
  overlay.dataset.vfxSourceEventId = effect.sourceEventId ?? "";
  overlay.dataset.vfxAbilityKey = effect.abilityKey ?? "";
  overlay.dataset.vfxBranch = effect.branch ?? "";
  overlay.dataset.vfxStepIndex = String(stepIndex);
  overlay.dataset.vfxEndpointRole = role;
  overlay.dataset.vfxCardUid = target?.kind === "card_stat" ? target.cardUid ?? "" : "";
  overlay.textContent = stepText(step, role);
  Object.assign(overlay.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  document.body.append(overlay);
  removeAfterAnimation(overlay, 1100);
  return rect;
}

function anchorConnector(from, to, effect) {
  if (!from || !to) return;
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const length = Math.hypot(dx, dy);
  if (!length) return;
  const line = document.createElement("span");
  line.className = `vfx-ability-connector vfx-ability-${effect.profile}`;
  line.setAttribute("aria-hidden", "true");
  Object.assign(line.style, { left: `${from.left + from.width / 2}px`, top: `${from.top + from.height / 2}px`, width: `${length}px`, rotate: `${Math.atan2(dy, dx)}rad` });
  document.body.append(line);
  removeAfterAnimation(line, 1100);
}

function applyAbilityAnchors(root, effect, snapshot) {
  for (const [stepIndex, step] of (effect.steps ?? []).entries()) {
    if (step.kind === "transfer") {
      const from = anchorElements(root, step.from, snapshot).map((element) => anchorOverlay(element, effect, step, step.from, stepIndex, "from")).filter(Boolean)[0];
      const to = anchorElements(root, step.to, snapshot).map((element) => anchorOverlay(element, effect, step, step.to, stepIndex, "to")).filter(Boolean)[0];
      anchorConnector(from, to, effect);
      continue;
    }
    anchorElements(root, step.target, snapshot).forEach((element) => anchorOverlay(element, effect, step, step.target, stepIndex));
  }
}

export function applyVisualEffects(root, transition) {
  for (const effect of transition.effects) {
    eventChip(root, effect);
    if (effect.type === "user-ability" || effect.type === "cost-change") {
      applyAbilityAnchors(root, effect, transition.next);
      continue;
    }
    if (effect.type === "security-shield-on") {
      transientClass(cardElement(root, effect.uid)?.querySelector(".card-security-shield"), "vfx-shield-enter");
      continue;
    }
    if (effect.type === "security-shield-off") {
      if (!effect.rect) continue;
      const ghost = document.createElement("span");
      ghost.className = "vfx-shield-exit";
      ghost.setAttribute("aria-hidden", "true");
      ghost.innerHTML = '<svg viewBox="0 0 80 96"><path d="M40 4 72 17v30c0 21-13 35-32 45C21 82 8 68 8 47V17Z"/></svg>';
      Object.assign(ghost.style, { left: `${effect.rect.left}px`, top: `${effect.rect.top}px`, width: `${effect.rect.width}px`, height: `${effect.rect.height}px` });
      document.body.append(ghost);
      removeAfterAnimation(ghost);
      continue;
    }
    if (["deploy", "access-drag", "login", "set", "install", "relog", "move", "trash", "ban", "bounce", "attack", "hit", "heal", "sleep", "standby", "compress", "decompress", "layer-move", "script-activated", "response-declared", "trigger-declared"].includes(effect.type)) {
      const card = cardElement(root, effect.uid);
      if (!card) continue;
      if (["deploy", "access-drag", "login", "set", "install"].includes(effect.type)) transientClass(card, "vfx-deploy");
      if (["relog", "move", "trash", "ban", "bounce", "layer-move"].includes(effect.type)) transientClass(card, "vfx-move");
      if (effect.type === "heal") transientClass(card, "vfx-heal");
      if (effect.type === "sleep") transientClass(card, "vfx-sleep");
      if (effect.type === "standby") transientClass(card, "vfx-standby");
      if (["compress", "decompress", "script-activated", "response-declared", "trigger-declared"].includes(effect.type)) transientClass(card, "vfx-trigger");
      if (effect.type === "attack") {
        transientClass(card, effect.playerId === "ai" ? "vfx-lunge-back" : "vfx-lunge-forward");
        const slash = document.createElement("span");
        slash.className = "vfx-slash";
        card.closest(".board-slot")?.append(slash);
        removeAfterAnimation(slash);
      }
      if (effect.type === "hit") {
        transientClass(card, "vfx-hit");
        popup(card.closest(".board-slot"), effect.amount);
      }
      continue;
    }
    if (effect.type === "user-hit") {
      const user = root.querySelector(`[data-fortress="${effect.playerId}"]`);
      transientClass(user, "vfx-user-hit");
      popup(user?.parentElement, effect.amount);
      continue;
    }
    if (effect.type === "user-heal") {
      const user = root.querySelector(`[data-fortress="${effect.playerId}"]`);
      transientClass(user, "vfx-user-heal");
      continue;
    }
    if (effect.type === "memory-change") {
      transientClass(root.querySelector(`[data-fortress="${effect.playerId}"]`), "vfx-memory");
      continue;
    }
    if (effect.type === "win-locked") {
      transientClass(root.querySelector(".winner"), "vfx-win-lock");
      continue;
    }
    if (effect.type === "game-finished") {
      transientClass(root.querySelector(".winner"), "vfx-win-lock");
      continue;
    }
    if (effect.type === "destroy") {
      if (!effect.rect) continue;
      const ghost = document.createElement("span");
      ghost.className = "vfx-destroy-ghost";
      ghost.textContent = effect.name;
      Object.assign(ghost.style, { left: `${effect.rect.left}px`, top: `${effect.rect.top}px`, width: `${effect.rect.width}px`, height: `${effect.rect.height}px` });
      document.body.append(ghost);
      removeAfterAnimation(ghost);
    }
  }
}
