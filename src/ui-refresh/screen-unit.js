// The UI size unit --u (styles.css) in px on this screen, measured, so placement done in JS follows the same
// screen ratio as the CSS. 16 only where it cannot be measured (no styles, or a document stand-in in tests).
export function screenUnit(doc = globalThis.document) {
  const host = doc?.body ?? doc?.documentElement;
  if (!host?.append || typeof doc.createElement !== 'function') return 16;
  const probe = doc.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:var(--u);height:0';
  host.append(probe);
  const unit = probe.getBoundingClientRect().width;
  probe.remove();
  return unit || 16;
}
