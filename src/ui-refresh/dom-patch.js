// Reconcile the public HTML projection, never the private engine state.
// Keys identify UI instances. Only visible board/hand cards may move across parents.
export function nodeKey(node) {
  if (node.nodeType !== 1) return null;
  if (node.classList.contains('board-slot') && node.hasAttribute('data-slot')) {
    return `slot:${node.dataset.seat}:${node.dataset.zone}:${node.dataset.slot}`;
  }
  if (node.classList.contains("hand-card")) {
    const card = node.querySelector('[data-card-ref], [data-card-uid]');
    return `hand:${card?.dataset.cardRef ?? card?.dataset.cardUid ?? "empty"}`;
  }
  for (const name of ['data-event-id', 'data-card-ref', 'data-action-id', 'data-option-id', 'data-request-id', 'data-user-seat', 'data-slot']) {
    if (node.hasAttribute(name)) return `${node.tagName}:${name}:${node.getAttribute(name)}`;
  }
  if (node.hasAttribute('data-runtime-zone')) return `admin:${node.dataset.seat}:${node.dataset.runtimeZone}`;
  for (const name of ["id", "data-live-region", "data-card-uid", "data-deck-card-id", "data-slot-index", "data-fortress", "data-action", "data-live", "data-mode", "data-view", "data-effect-id", "data-selection-option", "data-trigger-item", "data-response-card", "data-security-uid", "data-catalog-card", "data-deck-plus", "data-deck-minus"]) {
    if (node.hasAttribute(name)) return `${node.tagName}:${name}:${node.getAttribute(name)}`;
  }
  if (node.hasAttribute("data-admin-zone")) return `admin:${node.dataset.owner}:${node.dataset.adminZone}`;
  if (node.classList.contains("zone")) return `zone:${node.dataset.seat ?? node.dataset.player}:${node.classList.contains("zone-front") ? "front" : "back"}`;
  if (node.classList.contains("side")) return `side:${node.dataset.seat ?? (node.classList.contains("opponent") ? "ai" : "player")}`;
  if (node.classList.contains("stat")) return `stat:${node.classList.contains("stat-atk") ? "atk" : "str"}`;
  // Structural identity keeps optional panels from consuming unrelated siblings.
  return node.classList.length ? `${node.tagName}:class:${node.classList[0]}` : null;
}

const movableKey = node => node.nodeType === 1 && node.matches('.card[data-card-id]') && node.closest('.r2-stage, .r2-hand')
  ? node.dataset.cardRef ?? node.dataset.cardUid ?? null : null;
const compatible = (a, b) => a.nodeType === b.nodeType && (a.nodeType !== 1 || a.tagName === b.tagName && nodeKey(a) === nodeKey(b));

// A scene marks its own node after drawing (canvas size, WebGL tag, a "drawn" class).
// The node lists those in data-patch-keep ("width", "class:wf-hud-rendered") so a
// re-render leaves them as the scene set them.
export function syncAttributes(old, next) {
  const keep = (next.getAttribute('data-patch-keep') ?? '').split(/\s+/).filter(Boolean);
  const keepClasses = keep.filter(token => token.startsWith('class:')).map(token => token.slice(6));
  for (const attr of [...old.attributes]) if (!next.hasAttribute(attr.name) && !keep.includes(attr.name)) old.removeAttribute(attr.name);
  for (const attr of next.attributes) {
    if (keep.includes(attr.name)) continue;
    const value = attr.name === 'class' && keepClasses.length
      ? [attr.value, ...keepClasses.filter(name => old.classList.contains(name) && !next.classList.contains(name))].join(' ')
      : attr.value;
    if (old.getAttribute(attr.name) !== value) old.setAttribute(attr.name, value);
  }
}

export function patchHtml(root, html) {
  const template = root.ownerDocument.createElement("template");
  template.innerHTML = html;
  const cards = new Map([...root.querySelectorAll('.r2-stage .card[data-card-id], .r2-hand .card[data-card-id]')]
    .map(node => [node.dataset.cardRef ?? node.dataset.cardUid, node]).filter(([key]) => key));
  const claimed = new Set();
  const sync = (old, next) => {
    if (old.nodeType !== 1) {
      if (old.nodeValue !== next.nodeValue) old.nodeValue = next.nodeValue;
      return;
    }
    syncAttributes(old, next);
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
