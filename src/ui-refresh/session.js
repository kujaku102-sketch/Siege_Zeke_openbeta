import { endTurn, cardHasKeyword, findCard, canExecuteAtSlot, canExecuteRegistryCard, canPlayLayeredCard } from "../game/engine.js";
import { projectZoneSlots } from "../game/board-slots.js";
import { isObCard } from "../game/card-types.js";

export const actorFor = state => state.mode === "sandbox" ? state.sandboxUi?.actor ?? state.active : "player";
export const resolutionBusy = state => Boolean(state.pending || state.prompt || state.effectResolution || state.resolvingDeclaredEffect || state.triggerThread?.status === "resolving");
export const shouldAutoStartAiTurn = (state, { iterator, pacing, startedState, startedTurn }) =>
  (state.mode === "ai" || state.mode === "sandbox" && state.sandboxUi?.opponentControl === "ai")
  && state.active === "ai" && !state.winner && !resolutionBusy(state)
  && !iterator && !pacing && (startedState !== state || startedTurn !== state.turnNumber);
export const canLeaveTutorial = state => !resolutionBusy(state);
export const canStepBackInput = (state, ui, aiPacing = false) => !resolutionBusy(state) && !aiPacing
  && Boolean(ui.draft || ui.detailUid || state.selectedUid);

// Only UI input before commitment is reversible here; never touch engine history.
export function stepBackInput(state, ui, aiPacing = false) {
  if (!canStepBackInput(state, ui, aiPacing)) return false;
  if (ui.draft) ui.draft = null;
  else if (ui.detailUid) ui.detailUid = null;
  else state.selectedUid = null;
  return true;
}

export function dismissBoardSelection(state, ui, aiPacing = false) {
  if (resolutionBusy(state) || aiPacing || !canStepBackInput(state, ui)) return false;
  ui.draft = null;
  ui.detailUid = null;
  state.selectedUid = null;
  return true;
}

export function mobileConsoleScale(viewportHeight, safeTop = 0, safeBottom = 0) {
  return Math.min(1, Math.max(0, (viewportHeight - 68 - safeTop - safeBottom) / 660));
}

export function isDownwardHandSwipe(start, end, pointerType = "touch") {
  if (pointerType !== "touch" && pointerType !== "pen") return false;
  const dx = end.x - start.x, dy = end.y - start.y;
  return dy >= 52 && dy > Math.abs(dx) * 1.25;
}

// Exiting the guide changes control, not the board, counters, costs or result.
export function leaveTutorial(state) {
  if (state.mode !== "tutorial" || !canLeaveTutorial(state)) return false;
  state.mode = "sandbox";
  state.sandboxUi = { query: "", expansion: "all", catalogOwner: state.active, opponentControl: "manual", actor: state.active, alternateTurns: true };
  state.selectedUid = null;
  return true;
}

export function securityCandidates(state, playerId = actorFor(state)) {
  return state.players[playerId].front.filter(card => isObCard(card) && !card.faceDown && !card.sleep && cardHasKeyword(card, "SECURITY"));
}

// False from the engine can mean a preserved end-phase choice, not failure.
export function requestTurnEnd(state) {
  if (resolutionBusy(state) || state.winner || state.victory?.lockedOutcome) return "blocked";
  const active = state.active, turn = state.turnNumber;
  const ok = endTurn(state);
  if (state.mode === "sandbox" && state.sandboxUi?.opponentControl === "manual") state.sandboxUi.actor = state.active;
  if (state.active !== active || state.turnNumber !== turn || ok) return "advanced";
  if (state.securityRestWindow || resolutionBusy(state)) return "waiting";
  return "blocked";
}

export function executionSlots(state, playerId, uid, options = {}) {
  if (resolutionBusy(state) || state.winner || state.victory?.lockedOutcome || state.securityRestWindow || state.active !== playerId) return [];
  const found = findCard(state, uid);
  if (!found || found.playerId !== playerId || !["hand", "registry"].includes(found.zoneName)) return [];
  const card = found.card;
  const zones = card.category === "Script" || options.asScript ? ["back"] : ["front", "back"];
  return zones.flatMap(zone => {
    const slots = projectZoneSlots(state.players[playerId][zone], { controllerId: playerId, zoneName: zone, limit: state.players[playerId].user[`${zone}Limit`] });
    return slots.flatMap((host, index) => {
      const extra = host ? isObCard(card) && host.category === "Code" ? { baseUid: host.uid }
        : card.category === "Code" && isObCard(host) ? { underUid: host.uid } : null : { requestedSlot: index + 1 };
      if (!extra || options.asScript && host) return [];
      const command = { ...options, ...extra, zone };
      const check = found.zoneName === "registry" ? canExecuteRegistryCard(state, playerId, card, command) : canExecuteAtSlot(state, playerId, card, command);
      return check.ok ? [{ zone, slot: index + 1, options: command }] : [];
    });
  });
}

export function livePlacementSlots(state, draft) {
  if (!draft || resolutionBusy(state) || state.winner || state.victory?.lockedOutcome || state.securityRestWindow) return [];
  const actor = actorFor(state), found = findCard(state, draft.sourceUid);
  if (!found || found.playerId !== actor || state.active !== actor) return [];
  if (draft.kind !== "layered" && draft.kind !== "relog") return executionSlots(state, actor, draft.sourceUid, draft.options);
  const zones = draft.zone ? [draft.zone] : ["front", "back"];
  return zones.flatMap(zone => {
    const slots = projectZoneSlots(state.players[actor][zone], { controllerId: actor, zoneName: zone, limit: state.players[actor].user[`${zone}Limit`] });
    return slots.flatMap((host, index) => {
      const requestedSlot = index + 1;
      const allowed = draft.kind === "layered" ? canPlayLayeredCard(state, actor, draft.sourceUid, draft.materialUids, zone, requestedSlot).ok
        : !host && found.zoneName !== zone && state.players[actor].memory >= (found.card.id === "STD-195" && found.card.mounted?.length ? 1 : Number(found.card.cost ?? 0));
      return allowed ? [{ zone, slot: requestedSlot, options: { zone, requestedSlot } }] : [];
    });
  });
}

export function avoidFocus(panel, targets, viewport, margin = 8) {
  const width = Math.min(panel.width, viewport.width - margin * 2), height = Math.min(panel.height, viewport.height - margin * 2);
  const x0 = (viewport.left ?? 0) + margin, y0 = (viewport.top ?? 0) + margin;
  const x1 = x0 + viewport.width - width - margin * 2, y1 = y0 + viewport.height - height - margin * 2;
  const candidates = [{ left: x1, top: y0 }, { left: x0, top: y0 }, { left: x1, top: y1 }, { left: x0, top: y1 }];
  // A larger ADV frame may fit between the detail panel and console, not at a corner.
  const xs = new Set([x0, x1]), ys = new Set([y0, y1]);
  for (const rect of targets) {
    for (const x of [rect.right + margin, rect.left - width - margin]) xs.add(Math.max(x0, Math.min(x1, x)));
    for (const y of [rect.bottom + margin, rect.top - height - margin]) ys.add(Math.max(y0, Math.min(y1, y)));
  }
  for (const left of xs) for (const top of ys) candidates.push({ left, top });
  const overlap = pos => targets.reduce((sum, rect) => sum + Math.max(0, Math.min(pos.left + width, rect.right + margin) - Math.max(pos.left, rect.left - margin)) * Math.max(0, Math.min(pos.top + height, rect.bottom + margin) - Math.max(pos.top, rect.top - margin)), 0);
  return candidates.map(pos => ({ ...pos, overlap: overlap(pos) })).sort((a, b) => a.overlap - b.overlap)[0];
}
