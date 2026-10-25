const LIVE_INPUT_SELECTOR = "main, .r2-entry, .r2-utilities, .r2-overlays, .r2-title-links, .r2-flow";

export function liveInputLocked(node, { optionsOpen = false, uniqueOpen = false, resultOpen = false, entryCrtReady = false } = {}) {
  if (uniqueOpen || resultOpen) return true;
  if (!optionsOpen) return false;
  return !(entryCrtReady && node.matches(".r2-entry"));
}

export function syncLiveInputLocks(root, state = {}) {
  const nodes = root.querySelectorAll(LIVE_INPUT_SELECTOR);
  for (const node of nodes) node.inert = liveInputLocked(node, state);
  return nodes;
}
