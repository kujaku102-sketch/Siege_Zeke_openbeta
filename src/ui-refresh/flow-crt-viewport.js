import { createCrtGlass, crtSourcePoint } from "./crt-gl.js";
import { composeCrtSlide, keepCrtPage, takeCrtSlide } from "./crt-slide.js";

// The flow screens (tutorial list, battle setup, online play) on the title's curved CRT (文豪, 2026-11-05): the screen's
// own HTML stays in the page, laid out but unseen, for the keyboard and screen readers; what it shows is painted from that
// layout onto a flat page and bent by the same glass as the title (crt-gl.js). A press on the glass is taken back through
// the curve to the control under it. A select opens its list on the glass, since a browser's own list cannot be bent.
const FIELDS = "button,select,input,a[href],label";
const SLOP = 12;
const CARET_MS = 530;
const transparent = color => !color || color === "transparent" || /rgba\([^)]*,\s*0\)$/.test(color);
const fontOf = style => `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

function mount(section) {
  const sheet = section.querySelector(".r2-flow-sheet");
  const host = section.parentElement;
  if (!sheet || !host) return null;
  const canvas = document.createElement("canvas");
  canvas.className = "r2-flow-crt-viewport";
  canvas.setAttribute("aria-hidden", "true");
  const glass = createCrtGlass(canvas);
  if (!glass) return null;
  const source = document.createElement("canvas");
  const ctx = source.getContext("2d");
  const screen = section.dataset.flowScreen;
  // Taken on the first frame, once the screen left (the title, or another flow screen) has kept its page.
  let slide;
  let ops = [], frame = null, scale = 1;
  let dirty = true, disposed = false, frameId = 0, lastFrame = 0;
  let hovered = null, pressed = null, dropdown = null;
  const listeners = [];
  const listen = (node, type, handler, options) => { node.addEventListener(type, handler, options); listeners.push([node, type, handler, options]); };
  const touch = () => { dirty = true; };
  const mutations = new MutationObserver(touch);
  const resize = new ResizeObserver(touch);

  // ---- what the page shows, measured from its layout ------------------------------------------
  const boxOf = (rect, origin) => ({ x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height });
  function textOps(node, style, ink, origin) {
    const chars = [];
    const text = node.data;
    const range = document.createRange();
    for (let index = 0; index < text.length;) {
      const code = text.codePointAt(index);
      const size = code > 0xffff ? 2 : 1;
      const ch = text.slice(index, index + size);
      if (ch.trim()) {
        range.setStart(node, index);
        range.setEnd(node, index + size);
        const rect = [...range.getClientRects()].find(item => item.width > 0);
        if (rect) chars.push({ ch, ...boxOf(rect, origin) });
      }
      index += size;
    }
    return chars.length ? [{ kind: "text", chars, font: fontOf(style), color: ink ?? style.color }] : [];
  }
  function visit(element, ink, origin, out) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return;
    const box = boxOf(element.getBoundingClientRect(), origin);
    const live = element.matches("button") && element.getAttribute("aria-disabled") !== "true" && !element.disabled;
    let background = style.backgroundColor;
    if (element !== sheet && element === hovered && live) {
      background = transparent(background) || background === "rgb(255, 255, 255)" ? "#111820" : "#2b3846";
      ink = "#fff";
    }
    if (element.tagName === "LEGEND") out.push({ kind: "fill", box: { ...box, x: box.x - 2, width: box.width + 4 }, color: "#fff" });
    if (element !== sheet && !transparent(background)) out.push({ kind: "fill", box, color: background });
    for (const [side, edge] of [["Top", "top"], ["Right", "right"], ["Bottom", "bottom"], ["Left", "left"]]) {
      const width = parseFloat(style[`border${side}Width`]);
      if (width > 0 && style[`border${side}Style`] !== "none" && !transparent(style[`border${side}Color`])) out.push({ kind: "edge", box, edge, width, color: style[`border${side}Color`] });
    }
    if (element.matches("input,select")) {
      const pad = { left: parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth), right: parseFloat(style.paddingRight) + parseFloat(style.borderRightWidth) };
      const select = element.tagName === "SELECT";
      const value = select ? element.options[element.selectedIndex]?.text ?? "" : element.value;
      out.push({ kind: "field", box, pad, font: fontOf(style), color: ink ?? style.color, value: value || (select ? "" : element.placeholder ?? ""),
        placeholder: !select && !element.value, select, element, letterSpacing: style.letterSpacing });
    }
    if (element === document.activeElement && element.matches(FIELDS)) out.push({ kind: "focus", box });
    // A field draws its own value; its options are not text on the page.
    if (element.matches("input,select")) return;
    for (const child of element.childNodes) {
      if (child.nodeType === 3) out.push(...textOps(child, style, ink, origin));
      else if (child.nodeType === 1) visit(child, ink, origin, out);
    }
  }
  function measure() {
    frame = sheet.getBoundingClientRect();
    const out = [];
    visit(sheet, null, frame, out);
    ops = out;
    dirty = false;
  }

  // ---- painting the flat page --------------------------------------------------------------------
  const caretOn = () => Math.floor(performance.now() / CARET_MS) % 2 === 0;
  function paint() {
    const width = Math.max(1, Math.round(frame.width * scale)), height = Math.max(1, Math.round(frame.height * scale));
    if (source.width !== width || source.height !== height) { source.width = width; source.height = height; }
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, frame.width, frame.height);
    ctx.textBaseline = "middle";
    for (const op of ops) {
      if (op.kind === "fill") { ctx.fillStyle = op.color; ctx.fillRect(op.box.x, op.box.y, op.box.width, op.box.height); }
      else if (op.kind === "edge") {
        const { x, y, width: w, height: h } = op.box;
        ctx.fillStyle = op.color;
        if (op.edge === "top") ctx.fillRect(x, y, w, op.width);
        else if (op.edge === "bottom") ctx.fillRect(x, y + h - op.width, w, op.width);
        else if (op.edge === "left") ctx.fillRect(x, y, op.width, h);
        else ctx.fillRect(x + w - op.width, y, op.width, h);
      } else if (op.kind === "text") {
        ctx.font = op.font;
        ctx.fillStyle = op.color;
        ctx.textAlign = "center";
        for (const ch of op.chars) ctx.fillText(ch.ch, ch.x + ch.width / 2, ch.y + ch.height / 2);
      } else if (op.kind === "field") paintField(op);
      else if (op.kind === "focus") {
        ctx.strokeStyle = "#111820";
        ctx.lineWidth = 2;
        ctx.strokeRect(op.box.x - 2, op.box.y - 2, op.box.width + 4, op.box.height + 4);
      }
    }
    paintScrollbar();
    if (dropdown) paintDropdown();
  }
  function paintField(op) {
    const { x, y, width, height } = op.box;
    const left = x + op.pad.left, room = width - op.pad.left - op.pad.right - (op.select ? height * .5 : 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    ctx.font = op.font;
    if ("letterSpacing" in ctx) ctx.letterSpacing = op.letterSpacing === "normal" ? "0px" : op.letterSpacing;
    ctx.textAlign = "left";
    ctx.fillStyle = op.placeholder ? "#8a929a" : op.color;
    const focused = op.element === document.activeElement && !op.select;
    const before = focused ? op.element.value.slice(0, op.element.selectionStart ?? op.element.value.length) : "";
    const shift = focused ? Math.max(0, ctx.measureText(before).width - room) : 0;
    ctx.fillText(op.value, left - shift, y + height / 2);
    if (focused && caretOn()) ctx.fillRect(left - shift + ctx.measureText(before).width, y + height * .2, Math.max(1.5, height * .04), height * .6);
    if (op.select) {
      ctx.textAlign = "center";
      ctx.fillStyle = op.color;
      ctx.fillText("▼", x + width - op.pad.right - height * .25, y + height / 2);
    }
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    ctx.restore();
  }
  function paintScrollbar() {
    const overflow = sheet.scrollHeight - sheet.clientHeight;
    if (overflow <= 1) return;
    const track = frame.height * .9, thumb = track * sheet.clientHeight / sheet.scrollHeight;
    const x = frame.width - frame.width * .012, top = frame.height * .05;
    ctx.fillStyle = "rgba(17,24,32,.18)";
    ctx.fillRect(x, top, Math.max(2, frame.height * .005), track);
    ctx.fillStyle = "#111820";
    ctx.fillRect(x, top + (track - thumb) * sheet.scrollTop / overflow, Math.max(2, frame.height * .005), thumb);
  }

  // ---- a select's list, on the glass ---------------------------------------------------------------
  function openDropdown(select) {
    const box = boxOf(select.getBoundingClientRect(), frame);
    const row = Math.max(box.height * .8, frame.height * .045);
    const items = [...select.options].map((option, index) => ({ text: option.text, index, disabled: option.disabled }));
    const below = frame.height - (box.y + box.height) - 4, above = box.y - 4;
    const down = below >= Math.min(items.length * row, frame.height * .4) || below >= above;
    const visible = Math.max(1, Math.min(items.length, Math.floor((down ? below : above) / row)));
    const top = down ? box.y + box.height : box.y - visible * row;
    const first = Math.max(0, Math.min(items.length - visible, select.selectedIndex - Math.floor(visible / 2)));
    dropdown = { select, items, row, visible, first, panel: { x: box.x, y: top, width: box.width, height: visible * row }, hover: select.selectedIndex, font: fontOf(getComputedStyle(select)) };
    canvas.dataset.list = "open";
    touch();
  }
  function paintDropdown() {
    const { panel, row, items, first, visible } = dropdown;
    ctx.fillStyle = "#fff";
    ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
    ctx.font = dropdown.font;
    ctx.textAlign = "left";
    for (let slot = 0; slot < visible; slot += 1) {
      const item = items[first + slot];
      if (!item) break;
      const y = panel.y + slot * row;
      const chosen = item.index === dropdown.select.selectedIndex, lit = item.index === dropdown.hover;
      if (chosen || lit) { ctx.fillStyle = chosen ? "#111820" : "#d9dde1"; ctx.fillRect(panel.x, y, panel.width, row); }
      ctx.fillStyle = item.disabled ? "#9aa3ab" : chosen ? "#fff" : "#111820";
      ctx.fillText(item.text, panel.x + panel.width * .04, y + row / 2, panel.width * .92);
    }
    ctx.strokeStyle = "#111820";
    ctx.lineWidth = 1;
    ctx.strokeRect(panel.x + .5, panel.y + .5, panel.width - 1, panel.height - 1);
  }
  // The list is marked on the glass while it is open (the page under it does not show it).
  const closeDropdown = () => { dropdown = null; delete canvas.dataset.list; touch(); };
  const dropdownItemAt = point => {
    if (!dropdown) return null;
    const { panel, row } = dropdown;
    if (point.x < panel.x || point.x > panel.x + panel.width || point.y < panel.y || point.y > panel.y + panel.height) return null;
    return dropdown.items[dropdown.first + Math.floor((point.y - panel.y) / row)] ?? null;
  };
  function choose(item) {
    const select = dropdown.select;
    closeDropdown();
    if (!item || item.disabled || item.index === select.selectedIndex) return;
    select.selectedIndex = item.index;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ---- presses on the glass ------------------------------------------------------------------------
  // A press reads the page as it is now, also when no frame has been drawn since it changed (a hidden window draws none).
  const pagePoint = event => { if (dirty || !frame) measure(); return crtSourcePoint(event, canvas.getBoundingClientRect()); };
  function controlAt(point) {
    if (!frame) return null;
    const box = canvas.getBoundingClientRect();
    const x = frame.left + point.x * frame.width / box.width, y = frame.top + point.y * frame.height / box.height;
    for (const node of document.elementsFromPoint(x, y)) {
      if (!sheet.contains(node)) continue;
      const control = node.closest(FIELDS);
      if (!control || !sheet.contains(control)) return null;
      return control.tagName === "LABEL" ? control.control ?? control : control;
    }
    return null;
  }
  const inFrame = point => { const box = canvas.getBoundingClientRect(); return { x: point.x * frame.width / box.width, y: point.y * frame.height / box.height }; };
  function activate(control) {
    if (!control) return;
    if (control.tagName === "SELECT") { if (!control.disabled) { control.focus({ preventScroll: true }); openDropdown(control); } return; }
    if (control.tagName === "INPUT") { control.focus({ preventScroll: true }); const end = control.value.length; try { control.setSelectionRange(end, end); } catch { /* not a text field */ } touch(); return; }
    control.focus?.({ preventScroll: true });
    control.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }
  listen(canvas, "pointerdown", event => {
    if (event.button !== 0) return;
    pressed = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, lastY: event.clientY, scrolled: false, scroll: sheet.scrollTop };
    try { canvas.setPointerCapture?.(event.pointerId); } catch { /* a synthetic pointer has no capture */ }
  });
  listen(canvas, "pointermove", event => {
    if (pressed && pressed.pointerId === event.pointerId) {
      if (!pressed.scrolled && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > SLOP) pressed.scrolled = true;
      if (pressed.scrolled && !dropdown) {
        const ratio = frame ? frame.height / Math.max(1, canvas.getBoundingClientRect().height) : 1;
        sheet.scrollTop -= (event.clientY - pressed.lastY) * ratio;
      }
      pressed.lastY = event.clientY;
      return;
    }
    const point = inFrame(pagePoint(event));
    if (dropdown) { const item = dropdownItemAt(point); const next = item ? item.index : dropdown.hover; if (next !== dropdown.hover) { dropdown.hover = next; touch(); } canvas.style.cursor = item ? "pointer" : "default"; return; }
    const control = controlAt(pagePoint(event));
    const next = control?.matches("button,select,input,a[href]") ? control : null;
    if (next !== hovered) { hovered = next; touch(); }
    canvas.style.cursor = next ? (next.tagName === "INPUT" ? "text" : "pointer") : "default";
  });
  listen(canvas, "pointerup", event => {
    const start = pressed;
    pressed = null;
    try { if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId); } catch { /* released already */ }
    if (!start || start.pointerId !== event.pointerId || start.scrolled) return;
    event.preventDefault();
    const point = pagePoint(event);
    if (dropdown) { const item = dropdownItemAt(inFrame(point)); if (item) choose(item); else closeDropdown(); return; }
    activate(controlAt(point));
  });
  listen(canvas, "pointercancel", () => { pressed = null; });
  listen(canvas, "pointerleave", event => { if (!canvas.hasPointerCapture?.(event.pointerId)) pressed = null; if (hovered) { hovered = null; touch(); } });
  listen(canvas, "wheel", event => {
    event.preventDefault();
    if (dropdown) { dropdown.first = Math.max(0, Math.min(dropdown.items.length - dropdown.visible, dropdown.first + Math.sign(event.deltaY))); touch(); return; }
    sheet.scrollTop += event.deltaY;
  }, { passive: false });
  // The list on the glass takes the arrow keys, Enter and Escape before the page does (Escape would leave the screen).
  listen(document, "keydown", event => {
    if (!dropdown) return;
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step) {
      let next = dropdown.hover;
      do next += step; while (dropdown.items[next]?.disabled);
      if (dropdown.items[next]) { dropdown.hover = next; dropdown.first = Math.max(0, Math.min(next, dropdown.items.length - dropdown.visible, Math.max(dropdown.first, next - dropdown.visible + 1))); touch(); }
    } else if (event.key === "Enter" || event.key === " ") choose(dropdown.items[dropdown.hover]);
    else if (event.key === "Escape" || event.key === "Tab") closeDropdown();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  for (const type of ["focusin", "focusout", "input", "change", "selectionchange"]) listen(document, type, touch);
  // A button eased into its hover or focus colour is read again once it has arrived.
  for (const type of ["transitionend", "animationend"]) listen(sheet, type, touch);
  listen(sheet, "scroll", () => { if (dropdown) closeDropdown(); else touch(); });
  listen(canvas, "webglcontextlost", event => { event.preventDefault(); dispose(); });
  mutations.observe(sheet, { subtree: true, childList: true, characterData: true, attributes: true });
  resize.observe(sheet);
  document.fonts?.ready.then(touch);
  host.append(canvas);
  section.classList.add("r2-flow-crt-ready");

  let caretShown = null;
  function tick(now) {
    if (disposed) return;
    frameId = requestAnimationFrame(tick);
    if (document.hidden || now - lastFrame < 1000 / 30) return;
    lastFrame = now;
    if (!section.isConnected) { dispose(); return; }
    const caret = document.activeElement?.matches?.("input") && sheet.contains(document.activeElement) ? caretOn() : null;
    if (caret !== caretShown) { caretShown = caret; dirty = true; }
    if (slide === undefined) slide = takeCrtSlide(screen);
    const repaint = dirty || slide;
    if (dirty) measure();
    if (!frame || frame.width < 1 || frame.height < 1) return;
    scale = Math.min(devicePixelRatio || 1, 1.5, 2048 / frame.width, 1536 / frame.height);
    if (repaint) {
      paint();
      if (slide && !composeCrtSlide(source, slide)) slide = null;
      glass.upload(source);
    }
    glass.draw(canvas.width, canvas.height, now / 1000);
  }
  frameId = requestAnimationFrame(tick);

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (frame) keepCrtPage(source, screen);
    cancelAnimationFrame(frameId);
    mutations.disconnect();
    resize.disconnect();
    for (const [node, type, handler, options] of listeners) node.removeEventListener(type, handler, options);
    section.classList.remove("r2-flow-crt-ready");
    canvas.remove();
    glass.dispose();
  }
  return { dispose, redraw: touch };
}

// Mounts the curved CRT over the flow screen shown (when `enabled`), and takes it down with the screen.
let active = null;
let activeSection = null;
export function syncFlowCrtViewport(root, enabled) {
  const section = enabled ? root.querySelector(".r2-flow[data-flow-screen]") : null;
  if (section !== activeSection) {
    active?.dispose();
    active = null;
    activeSection = section;
    // A screen whose glass could not be made shows its HTML; it is not tried again on every redraw.
    if (section) active = mount(section) ?? { dispose() {}, redraw() {} };
  } else active?.redraw();
}
