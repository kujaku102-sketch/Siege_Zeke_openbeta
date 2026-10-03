// Reconcile the public HTML projection, never the private engine state.
// Keys identify UI instances. Only visible board/hand cards may move across parents.
export function nodeKey(node) {
  if (node.nodeType !== 1) return null;
  if (node.classList.contains("hand-card")) return `hand:${node.querySelector('[data-card-uid]')?.dataset.cardUid ?? "empty"}`;
  for (const name of ["id", "data-live-region", "data-card-uid", "data-deck-card-id", "data-slot-index", "data-fortress", "data-action", "data-live", "data-mode", "data-view", "data-effect-id", "data-selection-option", "data-trigger-item", "data-response-card", "data-security-uid", "data-catalog-card", "data-deck-plus", "data-deck-minus"]) {
    if (node.hasAttribute(name)) return `${node.tagName}:${name}:${node.getAttribute(name)}`;
  }
  if (node.hasAttribute("data-admin-zone")) return `admin:${node.dataset.owner}:${node.dataset.adminZone}`;
  if (node.classList.contains("zone")) return `zone:${node.dataset.player}:${node.classList.contains("zone-front") ? "front" : "back"}`;
  if (node.classList.contains("side")) return `side:${node.classList.contains("opponent") ? "ai" : "player"}`;
  if (node.classList.contains("stat")) return `stat:${node.classList.contains("stat-atk") ? "atk" : "str"}`;
  // Structural identity keeps optional panels from consuming unrelated siblings.
  return node.classList.length ? `${node.tagName}:class:${node.classList[0]}` : null;
}

const movableKey = node => node.nodeType === 1 && node.matches('.card[data-card-uid][data-card-id]') && node.closest('.r2-stage, .r2-hand') ? node.dataset.cardUid : null;
const compatible = (a, b) => a.nodeType === b.nodeType && (a.nodeType !== 1 || a.tagName === b.tagName && nodeKey(a) === nodeKey(b));

export function patchHtml(root, html) {
  const template = root.ownerDocument.createElement("template");
  template.innerHTML = html;
  const cards = new Map([...root.querySelectorAll('.r2-stage .card[data-card-uid][data-card-id], .r2-hand .card[data-card-uid][data-card-id]')].map(node => [node.dataset.cardUid, node]));
  const claimed = new Set();
  const sync = (old, next) => {
    if (old.nodeType !== 1) {
      if (old.nodeValue !== next.nodeValue) old.nodeValue = next.nodeValue;
      return;
    }
    for (const attr of [...old.attributes]) if (!next.hasAttribute(attr.name)) old.removeAttribute(attr.name);
    for (const attr of next.attributes) if (old.getAttribute(attr.name) !== attr.value) old.setAttribute(attr.name, attr.value);
    children(old, next);
    // Live form properties can differ from attributes after typing/toggling.
    if (old.tagName === "INPUT") {
      if (old.type !== "file" && old.value !== next.value) old.value = next.value;
      if (old.checked !== next.checked) old.checked = next.checked;
    } else if (["TEXTAREA", "SELECT"].includes(old.tagName) && old.value !== next.value) old.value = next.value;
  };
  const children = (parent, nextParent) => {
    const previous = [...parent.childNodes];
    const keyed = new Map(previous.map(node => [nodeKey(node), node]).filter(([key]) => key));
    let cursor = parent.firstChild;
    for (const next of [...nextParent.childNodes]) {
      const key = nodeKey(next), moving = movableKey(next);
      let old = moving ? cards.get(moving) : null;
      if (!old || claimed.has(old) || !compatible(old, next)) old = cursor && compatible(cursor, next) ? cursor : key ? keyed.get(key) : null;
      if (!old || claimed.has(old) || !compatible(old, next)) old = null;
      if (!old) {
        // Build containers recursively so existing cards can enter new wrappers.
        old = next.cloneNode(false);
        parent.insertBefore(old, cursor);
      } else if (old !== cursor) parent.insertBefore(old, cursor);
      claimed.add(old);
      sync(old, next);
      cursor = old.nextSibling;
    }
    while (cursor) { const next = cursor.nextSibling; cursor.remove(); cursor = next; }
  };
  children(root, template.content);
}
