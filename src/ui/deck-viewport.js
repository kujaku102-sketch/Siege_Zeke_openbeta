const SCROLLERS = [".deck-builder-modal", ".deck-builder", ".deck-card-list", ".deck-summary", ".deck-selected"];

export function captureDeckViewport(root) {
  if (!root.querySelector(".deck-builder")) return null;
  const scrolls = SCROLLERS.flatMap((selector) => {
    const element = root.querySelector(selector);
    return element ? [{ selector, top: element.scrollTop, left: element.scrollLeft }] : [];
  });
  // On mobile the outer panel scrolls; desktop has an independently scrolling list.
  const containerSelector = [".deck-card-list", ".deck-builder"].find((selector) => {
    const element = root.querySelector(selector);
    return element && element.scrollHeight > element.clientHeight + 1;
  });
  const container = containerSelector && root.querySelector(containerSelector);
  const bounds = container?.getBoundingClientRect();
  const anchor = bounds && [...root.querySelectorAll("[data-deck-card-id]")].find((card) => {
    const rect = card.getBoundingClientRect();
    return rect.bottom > bounds.top && rect.top < bounds.bottom;
  });
  const active = root.ownerDocument?.activeElement;
  const attribute = ["data-deck-plus", "data-deck-minus"].find((name) => active?.hasAttribute?.(name));
  return {
    scrolls,
    anchor: anchor ? { containerSelector, id: anchor.dataset.deckCardId, offset: anchor.getBoundingClientRect().top - bounds.top } : null,
    focus: attribute ? { attribute, id: active.getAttribute(attribute) } : null
  };
}

export function restoreDeckViewport(root, snapshot) {
  if (!snapshot) return;
  for (const { selector, top, left } of snapshot.scrolls) {
    const element = root.querySelector(selector);
    if (element) { element.scrollTop = top; element.scrollLeft = left; }
  }
  if (snapshot.anchor) {
    const { containerSelector, id, offset } = snapshot.anchor;
    const container = root.querySelector(containerSelector);
    const card = [...root.querySelectorAll("[data-deck-card-id]")].find((entry) => entry.dataset.deckCardId === id);
    // Deck-summary height can change after adding a card; keep the visible card anchored.
    if (container && card) container.scrollTop += card.getBoundingClientRect().top - container.getBoundingClientRect().top - offset;
  }
  if (snapshot.focus) {
    const { attribute, id } = snapshot.focus;
    const button = [...root.querySelectorAll(`[${attribute}]`)].find((entry) => entry.getAttribute(attribute) === id);
    if (button && !button.disabled) button.focus({ preventScroll: true });
  }
}
