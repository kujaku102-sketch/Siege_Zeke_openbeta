import { cardHtml } from "../ui/render.js";
import { projectZoneSlots } from "../game/board-slots.js";

// Only call after UI-only changes. Game mutations must use the full renderer.
export function selectionFlags(state, uid) {
  const pending = state.pending;
  return {
    selected: state.selectedUid === uid,
    targetable: Boolean(pending?.validTargets?.includes(uid)),
    "material-selected": Boolean(
      ["layered-select", "effect-target-multi"].includes(pending?.type) && pending.selectedTargets?.includes(uid)
      || pending?.type === "selection" && pending.request?.selected?.includes(uid)
    )
  };
}

export function updateSelectionMarkers(root, state) {
  const added = [];
  // Concealed cards have no identifying DOM attributes unless legally targetable.
  // Only swap the anonymous back itself when it needs to become a target button.
  for (const zone of root.querySelectorAll(".r2-stage .zone[data-player]")) {
    const owner = zone.dataset.player;
    const zoneName = zone.classList.contains("zone-front") ? "front" : "back";
    const player = state.players[owner];
    const cards = projectZoneSlots(player[zoneName], { controllerId: owner, zoneName, limit: player.user?.[`${zoneName}Limit`] });
    for (const slot of zone.querySelectorAll("[data-slot-index]")) {
      const card = cards[Number(slot.dataset.slotIndex) - 1];
      const back = slot.querySelector(".card-back");
      if (!back || !card || owner === state.viewerId || !card.faceDown) continue;
      const targetable = Boolean(state.pending?.validTargets?.includes(card.uid));
      if (back.matches("button") === targetable) continue;
      const template = root.ownerDocument.createElement("template");
      template.innerHTML = cardHtml(state, owner, card, zoneName, { hidden: true });
      const next = template.content.firstElementChild;
      back.replaceWith(next);
      // Bind through the slot so the new button is included by querySelectorAll.
      added.push(slot);
    }
  }
  for (const node of root.querySelectorAll("[data-card-uid]")) {
    if (node.classList.contains("card-back")) continue;
    const flags = selectionFlags(state, node.dataset.cardUid);
    for (const [name, enabled] of Object.entries(flags)) node.classList.toggle(name, enabled);
  }
  for (const node of root.querySelectorAll("[data-fortress]")) {
    const owner = node.dataset.fortress;
    node.classList.toggle("selected", state.selectedUid === `${owner}-user-card`);
    node.classList.toggle("targetable", Boolean(state.pending?.validTargets?.includes(`${owner}-fortress`)));
  }
  return added;
}

export function createInteractionPatcher() {
  let markup = new Map();
  return {
    reset() { markup = new Map(); },
    patch(root, parts) {
      const changed = [];
      for (const [name, html] of Object.entries(parts)) {
        const host = root.querySelector(`[data-live-region="${name}"]`);
        if (!host || markup.get(name) === html) continue;
        host.innerHTML = html;
        markup.set(name, html);
        changed.push(host);
      }
      return changed;
    }
  };
}
