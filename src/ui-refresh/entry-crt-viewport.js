import { fxMs } from "./fx-speed.js";
import { drawCrtDebugPage } from "./crt-debug-page.js";
// Local opt-in prototype: draw the existing title layout onto a curved WebGL viewport.
// The original HTML buttons remain in the document for keyboard and screen-reader use.
const CRT_CURVE = 0.16;
const BUTTON_GLITCH_MS = 220;
const PAGE_SLIDE_MS = 320;
const MENU_FONT = 'SZDotGothic, "Yu Gothic UI", sans-serif';
const POINTER_ACTIVATION_SLOP = 12;
const vertexSource = `
attribute vec2 a_position;
attribute vec2 a_uv;
uniform float u_curve;
varying vec2 v_uv;
void main() {
  float radius = dot(a_position, a_position);
  float perspective = 1.0 / (1.0 + u_curve * radius);
  gl_Position = vec4(a_position * perspective, 0.0, 1.0);
  v_uv = a_uv;
}`;

const fragmentSource = `
precision mediump float;
uniform sampler2D u_title;
uniform float u_time;
varying vec2 v_uv;
float tapeNoise(vec2 seed) {
  return fract(sin(dot(seed, vec2(127.1, 311.7))) * 43758.5453);
}
void main() {
  float frame = floor(u_time * 18.0);
  float burstTick = floor(u_time * 0.625);
  float burst = step(0.52, tapeNoise(vec2(burstTick, 9.0))) * (1.0 - step(0.195, fract(u_time * 0.625)));
  float bandScale = 1.0 + floor(tapeNoise(vec2(burstTick, 17.0)) * 4.0);
  float row = floor(v_uv.y * 76.0 / bandScale);
  float tornRow = step(0.89, tapeNoise(vec2(row, frame))) * burst;
  float trackingY = tapeNoise(vec2(burstTick, 21.0));
  float trackingBand = burst * (1.0 - smoothstep(0.0, 0.012 * bandScale, abs(v_uv.y - trackingY)));
  float tear = tornRow * (tapeNoise(vec2(row, burstTick + 3.0)) - 0.5) * 0.033;
  vec2 sampleUv = clamp(v_uv + vec2(tear + trackingBand * 0.003, 0.0), 0.001, 0.999);
  float chroma = abs(tear) * 0.45 + trackingBand * 0.0018;
  vec4 center = texture2D(u_title, sampleUv);
  vec3 ink = vec3(
    texture2D(u_title, clamp(sampleUv + vec2(chroma, 0.0), 0.001, 0.999)).r,
    center.g,
    texture2D(u_title, clamp(sampleUv - vec2(chroma, 0.0), 0.001, 0.999)).b
  );
  float edge = length((v_uv - 0.5) * vec2(1.18, 1.0));
  float vignette = 1.0 - 0.52 * smoothstep(0.31, 0.72, edge);
  float scan = 0.89 + 0.11 * sin(gl_FragCoord.y * 3.14159265);
  float grain = (tapeNoise(floor(gl_FragCoord.xy * 0.5) + frame) - 0.5) * 0.075;
  float dropout = tornRow * step(0.55, tapeNoise(vec2(row, frame + 7.0))) * 0.3;
  ink = clamp(ink + grain + trackingBand * 0.055 - dropout, 0.0, 1.0);
  float colorIndex = floor(tapeNoise(vec2(row, burstTick + 29.0)) * 4.0);
  vec3 bandColor = colorIndex < 1.0 ? vec3(1.0, 0.82, 0.04)
    : colorIndex < 2.0 ? vec3(0.06, 0.36, 1.0)
    : colorIndex < 3.0 ? vec3(0.02, 1.0, 0.16)
    : vec3(1.0, 0.08, 0.12);
  ink = mix(ink, bandColor, clamp(tornRow * 0.28 + trackingBand * 0.36, 0.0, 0.6));
  gl_FragColor = vec4(ink * vignette * scan, 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function mesh(columns = 40, rows = 24) {
  const data = [];
  const point = (x, y) => [x / columns * 2 - 1, 1 - y / rows * 2, x / columns, y / rows];
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < columns; x += 1) {
    data.push(...point(x, y), ...point(x + 1, y), ...point(x, y + 1));
    data.push(...point(x + 1, y), ...point(x + 1, y + 1), ...point(x, y + 1));
  }
  return new Float32Array(data);
}

function localRect(node, frame) {
  const rect = node.getBoundingClientRect();
  return { x: rect.left - frame.left, y: rect.top - frame.top, width: rect.width, height: rect.height };
}

function drawIcon(ctx, svg, frame, color) {
  if (!svg) return;
  const box = localRect(svg, frame);
  ctx.save();
  ctx.translate(box.x, box.y);
  ctx.scale(box.width / 34, box.height / 34);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.55;
  ctx.lineCap = "square";
  ctx.lineJoin = "miter";
  for (const path of svg.querySelectorAll("path")) ctx.stroke(new Path2D(path.getAttribute("d")));
  ctx.restore();
}

export function shouldActivateCrtPointer(start, end, maxDistance = POINTER_ACTIVATION_SLOP) {
  if (!start?.target || start.pointerId !== end?.pointerId || start.target !== end.target) return false;
  return Math.hypot(end.clientX - start.clientX, end.clientY - start.clientY) <= maxDistance;
}

export function activateCrtTarget(target, createEvent = () => new MouseEvent("click", {
  bubbles: true,
  cancelable: true,
  view: window
})) {
  if (!target || typeof target.dispatchEvent !== "function") return false;
  target.focus?.({ preventScroll: true });
  return target.dispatchEvent(createEvent());
}

function mount(entry, initialOptions = {}) {
  const inner = entry.querySelector(".r2-entry-inner");
  const logo = entry.querySelector(".r2-intro img");
  const logoNoise = entry.querySelector(".r2-logo-canvas");
  const buttons = [...entry.querySelectorAll(".r2-mode-grid>button")];
  const menuButton = entry.parentElement?.querySelector('.r2-utilities [data-live="options"]');
  if (!inner || !logo || buttons.length !== 4 || !menuButton) return null;
  const canvas = document.createElement("canvas");
  canvas.className = "r2-crt-viewport";
  canvas.setAttribute("aria-hidden", "true");
  const gl = canvas.getContext("webgl", { alpha: false, antialias: true, powerPreference: "low-power" });
  if (!gl) return null;

  let program, vertex, fragment, buffer, texture;
  try {
    vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
    fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const vertices = mesh();
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    for (const [name, offset] of [["a_position", 0], ["a_uv", 2]]) {
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 16, offset * 4);
    }
    gl.uniform1f(gl.getUniformLocation(program, "u_curve"), CRT_CURVE);
    gl.uniform1i(gl.getUniformLocation(program, "u_title"), 0);
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // The mesh UV already uses the 2D canvas's top-left origin.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    canvas.dataset.vertices = String(vertices.length / 4);
  } catch (error) {
    console.warn("Curved title viewport unavailable; using HTML.", error);
    if (buffer) gl.deleteBuffer(buffer);
    if (texture) gl.deleteTexture(texture);
    if (program) gl.deleteProgram(program);
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }

  const source = document.createElement("canvas");
  const ctx = source.getContext("2d");
  const menuSource = document.createElement("canvas");
  const menuCtx = menuSource.getContext("2d");
  const dotTile = document.createElement("canvas");
  dotTile.width = dotTile.height = 3;
  const dotCtx = dotTile.getContext("2d");
  dotCtx.fillStyle = "#00ff00";
  dotCtx.beginPath();
  dotCtx.arc(1.5, 1.5, 1.35, 0, Math.PI * 2);
  dotCtx.fill();
  const dotPattern = menuCtx.createPattern(dotTile, "repeat");
  let hovered = null;
  let disposed = false;
  let frameId = 0;
  let lastNoiseFrame = 0;
  let options = initialOptions;
  let ready = false;
  let pressed = null;
  let menuTargets = [];
  // Each menu page keeps its own scroll; `slide` is the page change in progress.
  const scrolls = { options: 0, debug: 0 };
  let menuPage = "options";
  let slide = null;
  let menuScrollMax = 0;
  let lastFocusedItem = null;
  const glitchStart = new Map();
  const listeners = [];
  const listen = (node, type, handler) => { node.addEventListener(type, handler); listeners.push([node, type, handler]); };
  const observer = new ResizeObserver(() => redraw());

  function publishReady(next, force = false) {
    entry.classList.toggle("r2-entry-crt-ready", next);
    if (!force && ready === next) return;
    ready = next;
    options.onReadyChange?.(next);
  }

  function redraw() {
    if (disposed || !entry.isConnected || !logo.complete || !logo.naturalWidth) return;
    const frame = entry.getBoundingClientRect();
    if (frame.width < 1 || frame.height < 1) return;
    const scale = Math.min(devicePixelRatio || 1, 1.5, 2048 / frame.width, 1536 / frame.height);
    const width = Math.max(1, Math.round(frame.width * scale));
    const height = Math.max(1, Math.round(frame.height * scale));
    if (canvas.width !== width || canvas.height !== height) canvas.width = width, canvas.height = height;
    if (source.width !== width || source.height !== height) source.width = width, source.height = height;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, frame.width, frame.height);
    if (logoNoise?.dataset.noise === "playing" && logoNoise.width && logoNoise.height) {
      const noiseBox = localRect(logoNoise, frame);
      ctx.drawImage(logoNoise, noiseBox.x, noiseBox.y, noiseBox.width, noiseBox.height);
    } else {
      const logoBox = localRect(logo, frame);
      ctx.drawImage(logo, logoBox.x, logoBox.y, logoBox.width, logoBox.height);
    }
    for (const [index, button] of buttons.entries()) {
      const box = localRect(button, frame);
      const active = button === hovered || button === document.activeElement;
      const glitchAge = performance.now() - (glitchStart.get(button) ?? -Infinity);
      const glitching = glitchAge >= 0 && glitchAge < fxMs(BUTTON_GLITCH_MS);
      const ink = active ? "#fff" : "#111820";
      if (active) {
        ctx.fillStyle = "#111820";
        ctx.fillRect(box.x, box.y, box.width, box.height);
      }
      if (button === document.activeElement) {
        ctx.strokeStyle = "#111820";
        ctx.lineWidth = 2;
        ctx.strokeRect(box.x - 2, box.y - 2, box.width + 4, box.height + 4);
      }
      if (glitching) {
        const phase = Math.floor(glitchAge / 36);
        ctx.save();
        ctx.beginPath();
        ctx.rect(box.x, box.y, box.width, box.height);
        ctx.clip();
        for (let line = 0; line < 3; line += 1) {
          const bandY = box.y + ((phase * 17 + line * 23 + index * 11) % Math.max(1, box.height));
          const bandX = box.x + ((phase * 37 + line * 53) % Math.max(1, box.width * .28));
          ctx.fillStyle = active ? "rgba(255,255,255,.43)" : "rgba(17,24,32,.32)";
          ctx.fillRect(bandX, bandY, box.width * (.72 - line * .09), line === 0 ? 4 : 2);
        }
        ctx.restore();
      }
      drawIcon(ctx, button.querySelector("svg"), frame, ink);
      const strong = button.querySelector("strong");
      const textBox = localRect(strong, frame);
      const style = getComputedStyle(strong);
      ctx.fillStyle = ink;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const text = strong.textContent.trim();
      const centerX = textBox.x + textBox.width / 2;
      const centerY = textBox.y + textBox.height / 2;
      if (glitching) {
        ctx.fillStyle = "rgba(72,232,246,.8)";
        ctx.fillText(text, centerX + 3, centerY - 1, textBox.width);
        ctx.fillStyle = "rgba(250,79,172,.75)";
        ctx.fillText(text, centerX - 3, centerY + 1, textBox.width);
      }
      ctx.fillStyle = ink;
      ctx.fillText(text, centerX + (glitching ? [0,2,-2,1,-1,0][Math.floor(glitchAge / 36) % 6] : 0), centerY, textBox.width);
    }
    const menuBox = localRect(menuButton, frame);
    if (menuBox.width > 0 && menuBox.height > 0) {
      const menuWidth = Math.max(1, Math.round(menuBox.width));
      const menuHeight = Math.max(1, Math.round(menuBox.height));
      if (menuSource.width !== menuWidth || menuSource.height !== menuHeight) menuSource.width = menuWidth, menuSource.height = menuHeight;
      menuCtx.clearRect(0, 0, menuWidth, menuHeight);
      const active = menuButton === hovered || menuButton === document.activeElement;
      if (active) {
        menuCtx.fillStyle = "#00ff00";
        menuCtx.fillRect(0, 0, menuWidth, menuHeight);
      }
      const style = getComputedStyle(menuButton);
      menuCtx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      menuCtx.textAlign = "center";
      menuCtx.textBaseline = "middle";
      menuCtx.fillStyle = active ? "#071015" : "#00ff00";
      menuCtx.fillText(menuButton.textContent.trim(), menuWidth / 2, menuHeight / 2, menuWidth - 4);
      if (!active) {
        menuCtx.globalCompositeOperation = "source-in";
        menuCtx.fillStyle = dotPattern;
        menuCtx.fillRect(0, 0, menuWidth, menuHeight);
        menuCtx.globalCompositeOperation = "source-over";
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(menuSource, menuBox.x, menuBox.y, menuBox.width, menuBox.height);
      ctx.imageSmoothingEnabled = true;
    }
    menuTargets = [];
    if (!options.menuOpen) { menuPage = "options"; slide = null; scrolls.options = 0; scrolls.debug = 0; menuScrollMax = 0; }
    if (options.menuOpen) {
      const panel = { x: frame.width * .26, y: frame.height * .145, width: frame.width * .48, height: frame.height * .71 };
      const unit = frame.height;
      ctx.fillStyle = "rgba(4, 13, 18, .87)";
      ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
      ctx.strokeStyle = "#00ff00";
      ctx.lineWidth = Math.max(1, unit * .002);
      ctx.strokeRect(panel.x, panel.y, panel.width, panel.height);
      // The options and the debug page slide like the HTML window's pages (debug-view.js): デバッグ ▶ sends the
      // options out to the left and brings the debug page in from the right, ◀ 戻る the other way, at the effect
      // speed. Only the page at rest takes the pointer.
      const wanted = options.debugOpen ? "debug" : "options";
      if (wanted !== menuPage) { slide = { from: menuPage, to: wanted, at: performance.now() }; menuPage = wanted; scrolls[wanted] = 0; lastFocusedItem = null; }
      const progress = slide ? Math.min(1, (performance.now() - slide.at) / fxMs(PAGE_SLIDE_MS)) : 1;
      if (progress >= 1) slide = null;
      const eased = progress < .5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2;
      const focusedIn = selector => entry.parentElement?.querySelector(`.r2-title-options ${selector}`) === document.activeElement;
      const view = { top: panel.y + panel.height * .2, bottom: panel.y + panel.height * .97 };
      const left = panel.x + panel.width * .07;
      const width = panel.width * .86;
      const header = (title, titleX, button, live) => {
        ctx.fillStyle = "#00ff00";
        ctx.font = `400 ${Math.max(15, unit * .047)}px ${MENU_FONT}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(title, titleX, panel.y + panel.height * .105);
        ctx.font = `400 ${Math.max(12, unit * .035)}px ${MENU_FONT}`;
        if (focusedIn(button.selector)) { ctx.fillStyle = "rgba(0,255,0,.14)"; ctx.fillRect(button.box.x, button.box.y, button.box.width, button.box.height); ctx.fillStyle = "#00ff00"; }
        ctx.fillText(button.label, button.box.x, button.box.y + button.box.height / 2);
        if (live) menuTargets.push({ box: button.box, selector: button.selector });
        ctx.strokeStyle = "rgba(0,255,0,.6)";
        ctx.beginPath(); ctx.moveTo(panel.x + panel.width * .06, panel.y + panel.height * .18); ctx.lineTo(panel.x + panel.width * .94, panel.y + panel.height * .18); ctx.stroke();
      };
      const scrollbar = maxScroll => {
        if (maxScroll <= 0) return;
        const track = { x: panel.x + panel.width * .975, y: view.top, height: view.bottom - view.top };
        const thumb = track.height * (track.height / (track.height + maxScroll));
        ctx.fillStyle = "rgba(0,255,0,.18)";
        ctx.fillRect(track.x, track.y, Math.max(2, unit * .004), track.height);
        ctx.fillStyle = "#00ff00";
        ctx.fillRect(track.x, track.y + (track.height - thumb) * (scrolls[menuPage] / maxScroll), Math.max(2, unit * .004), thumb);
      };
      const drawOptionsPage = (dx, live) => {
        ctx.save();
        ctx.translate(dx, 0);
        header("オプション", panel.x + panel.width * .07, { label: "閉じる", selector: '[data-live="close-options"]', box: { x: panel.x + panel.width * .81, y: panel.y + panel.height * .045, width: panel.width * .14, height: panel.height * .12 } }, live);
        // Rows sit in a list that scrolls under the header when it outgrows the panel. デバッグ ▶ is the first row,
        // in view as the menu opens.
        const rowGap = panel.height * .084;
        const rowHeight = panel.height * .07;
        const counts = options.storedCounts ?? { logs: 0, replays: 0 };
        const toggles = [
          ["全画面", Boolean(options.fullscreen), '[data-live="fullscreen"]'],
          ["PC版", options.view === "pc", '[data-view="pc"]'],
          ["モバイル版", options.view === "mobile", '[data-view="mobile"]'],
          ["通常タップで詳細", Boolean(options.tapDetails), '[data-title-tap-details]'],
          ["演出", Boolean(options.effectsEnabled), '[data-toggle-effects]']
        ];
        const items = [];
        let cursor = panel.height * .04;
        items.push({ kind: "open", label: "デバッグ", selector: "[data-debug-open]", y: cursor }); cursor += rowGap;
        for (const [label, checked, selector] of toggles) { items.push({ kind: "toggle", label, checked, selector, y: cursor }); cursor += rowGap; }
        items.push({ kind: "volume", y: cursor + panel.height * .03 }); cursor += panel.height * .2;
        for (const [label, kind] of [["対戦ログ", "logs"], ["対戦リプレイ", "replays"]]) {
          items.push({ kind: "record", label, count: counts[kind] ?? 0, selector: `[data-stored-export="${kind}"]`, y: cursor }); cursor += rowGap;
        }
        items.push({ kind: "toggle", label: "対戦後に対戦ログを送信", checked: Boolean(options.sendMatchLogs), selector: "[data-toggle-send-logs]", y: cursor }); cursor += rowGap;
        const maxScroll = Math.max(0, cursor + panel.height * .02 - (view.bottom - view.top));
        const focusedItem = live ? items.find(item => item.selector && focusedIn(item.selector)) : null;
        if (live) {
          if (focusedItem && focusedItem.selector !== lastFocusedItem) {
            if (focusedItem.y < scrolls.options) scrolls.options = focusedItem.y;
            else if (focusedItem.y + rowHeight > scrolls.options + view.bottom - view.top) scrolls.options = focusedItem.y + rowHeight - (view.bottom - view.top);
          }
          lastFocusedItem = focusedItem?.selector ?? null;
          menuScrollMax = maxScroll;
        }
        scrolls.options = Math.max(0, Math.min(maxScroll, scrolls.options));
        const visible = box => box.y >= view.top - 1 && box.y + box.height <= view.bottom + 1;
        const target = (box, selector) => { if (live && visible(box)) menuTargets.push({ box, selector }); };
        ctx.save();
        ctx.beginPath();
        ctx.rect(panel.x, view.top, panel.width, view.bottom - view.top);
        ctx.clip();
        const checkbox = (box, checked) => {
          const size = Math.min(rowHeight * .75, unit * .044);
          const cx = box.x + box.width - size;
          const cy = box.y + (rowHeight - size) / 2;
          ctx.strokeStyle = "#00ff00";
          ctx.lineWidth = Math.max(1.5, unit * .003);
          ctx.strokeRect(cx, cy, size, size);
          if (checked) { ctx.beginPath(); ctx.moveTo(cx + size * .18, cy + size * .51); ctx.lineTo(cx + size * .43, cy + size * .75); ctx.lineTo(cx + size * .85, cy + size * .18); ctx.stroke(); }
        };
        for (const item of items) {
          const y = view.top + item.y - scrolls.options;
          if (item.kind === "volume") {
            ctx.fillStyle = "#e8ffe8";
            ctx.textAlign = "left";
            ctx.font = `400 ${Math.max(13, unit * .037)}px ${MENU_FONT}`;
            ctx.fillText(`音量  ${options.masterVolume ?? 7}/10`, left, y);
            const barsY = y + panel.height * .055;
            const barGap = Math.max(2, unit * .005);
            const barWidth = (width - barGap * 9) / 10;
            const barHeight = panel.height * .074;
            for (let index = 0; index < 10; index += 1) {
              const box = { x: left + index * (barWidth + barGap), y: barsY, width: barWidth, height: barHeight };
              ctx.fillStyle = index < (options.masterVolume ?? 7) ? "#00ff00" : "#183b2e";
              ctx.fillRect(box.x, box.y, box.width, box.height);
              target(box, `[data-volume="${index + 1}"]`);
            }
            continue;
          }
          ctx.font = `400 ${Math.max(14, unit * .041)}px ${MENU_FONT}`;
          const row = { x: left, y, width, height: rowHeight };
          const focused = item === focusedItem;
          if (item.kind === "record") {
            const button = { x: left + width * .68, y, width: width * .32, height: rowHeight };
            if (focused) { ctx.fillStyle = "rgba(0,255,0,.14)"; ctx.fillRect(button.x, button.y, button.width, button.height); }
            ctx.fillStyle = "#e8ffe8";
            ctx.textAlign = "left";
            ctx.fillText(item.label, left, y + rowHeight / 2, width * .4);
            ctx.fillStyle = "#00ff00";
            ctx.textAlign = "right";
            ctx.fillText(`${item.count}件`, left + width * .64, y + rowHeight / 2);
            ctx.strokeStyle = item.count ? "#00ff00" : "#2f6b46";
            ctx.lineWidth = Math.max(1, unit * .002);
            ctx.strokeRect(button.x, button.y, button.width, button.height);
            ctx.fillStyle = item.count ? "#e8ffe8" : "#5d7f68";
            ctx.textAlign = "center";
            ctx.font = `400 ${Math.max(12, unit * .033)}px ${MENU_FONT}`;
            ctx.fillText("書き出す", button.x + button.width / 2, y + rowHeight / 2, button.width - 4);
            if (item.count) target(button, item.selector);
            continue;
          }
          if (focused) { ctx.fillStyle = "rgba(0,255,0,.14)"; ctx.fillRect(row.x, row.y, row.width, row.height); }
          ctx.fillStyle = "#e8ffe8";
          ctx.textAlign = "left";
          ctx.fillText(item.label, left, y + rowHeight / 2, width * .84);
          if (item.kind === "open") { ctx.fillStyle = "#00ff00"; ctx.textAlign = "right"; ctx.fillText("▶", left + width, y + rowHeight / 2); }
          else checkbox(row, item.checked);
          target(row, item.selector);
        }
        ctx.restore();
        if (live) scrollbar(maxScroll);
        ctx.restore();
      };
      const drawDebugPage = (dx, live) => {
        ctx.save();
        ctx.translate(dx, 0);
        header("デバッグ", panel.x + panel.width * .3, { label: "◀ 戻る", selector: "[data-debug-close]", box: { x: panel.x + panel.width * .06, y: panel.y + panel.height * .045, width: panel.width * .2, height: panel.height * .12 } }, live);
        const area = { left, width, top: view.top, bottom: view.bottom, unit, font: MENU_FONT };
        const debug = options.debug ?? {};
        const laidOut = drawCrtDebugPage(ctx, debug, area, { scroll: scrolls.debug, paint: false });
        const maxScroll = Math.max(0, laidOut.height - (view.bottom - view.top));
        const focusedItem = live ? laidOut.all.find(item => focusedIn(item.selector)) : null;
        if (live) {
          if (focusedItem && focusedItem.selector !== lastFocusedItem) {
            if (focusedItem.y < scrolls.debug) scrolls.debug = focusedItem.y;
            else if (focusedItem.y + focusedItem.height > scrolls.debug + view.bottom - view.top) scrolls.debug = focusedItem.y + focusedItem.height - (view.bottom - view.top);
          }
          lastFocusedItem = focusedItem?.selector ?? null;
          menuScrollMax = maxScroll;
        }
        scrolls.debug = Math.max(0, Math.min(maxScroll, scrolls.debug));
        ctx.save();
        ctx.beginPath();
        ctx.rect(panel.x, view.top, panel.width, view.bottom - view.top);
        ctx.clip();
        const drawn = drawCrtDebugPage(ctx, debug, area, { scroll: scrolls.debug, focused: focusedItem?.selector ?? null });
        ctx.restore();
        if (live) { menuTargets.push(...drawn.targets); scrollbar(maxScroll); }
        ctx.restore();
      };
      const pages = { options: drawOptionsPage, debug: drawDebugPage };
      ctx.save();
      ctx.beginPath();
      ctx.rect(panel.x, panel.y, panel.width, panel.height);
      ctx.clip();
      if (slide) {
        const side = slide.to === "debug" ? 1 : -1;
        pages[slide.from](-side * eased * panel.width, false);
        pages[slide.to](side * (1 - eased) * panel.width, false);
      } else pages[menuPage](0, true);
      ctx.restore();
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(gl.getUniformLocation(program, "u_time"), performance.now() / 1000);
    gl.uniform1f(gl.getUniformLocation(program, "u_curve"), CRT_CURVE);
    gl.drawArrays(gl.TRIANGLES, 0, Number(canvas.dataset.vertices));
    publishReady(true, !entry.classList.contains("r2-entry-crt-ready"));
  }

  // Invert the radial perspective so a pointer on a rendered button reaches
  // its actual HTML button instead of relying on an approximate overlay hitbox.
  function sourcePoint(event) {
    const box = canvas.getBoundingClientRect();
    const screenX = (event.clientX - box.left) / box.width * 2 - 1;
    const screenY = 1 - (event.clientY - box.top) / box.height * 2;
    let x = screenX, y = screenY;
    for (let i = 0; i < 8; i += 1) {
      const factor = 1 + CRT_CURVE * (x * x + y * y);
      x = screenX * factor;
      y = screenY * factor;
    }
    return { x: (x + 1) / 2 * box.width, y: (1 - y) / 2 * box.height };
  }

  function targetAt(event) {
    const point = sourcePoint(event);
    const frame = entry.getBoundingClientRect();
    if (options.menuOpen) {
      const target = menuTargets.find(({ box }) => point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height);
      return target ? entry.parentElement?.querySelector(`.r2-title-options ${target.selector}`) ?? null : null;
    }
    return [...buttons, menuButton].find(button => {
      const box = localRect(button, frame);
      return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
    }) ?? null;
  }

  listen(canvas, "wheel", event => {
    if (!options.menuOpen || !menuScrollMax) return;
    event.preventDefault();
    scrolls[menuPage] = Math.max(0, Math.min(menuScrollMax, scrolls[menuPage] + event.deltaY * .5));
    redraw();
  });
  listen(canvas, "pointermove", event => {
    if (!pressed || !options.menuOpen || !menuScrollMax || pressed.pointerId !== event.pointerId) return;
    const box = canvas.getBoundingClientRect();
    const scale = entry.getBoundingClientRect().height / Math.max(1, box.height);
    scrolls[menuPage] = Math.max(0, Math.min(menuScrollMax, scrolls[menuPage] - (event.clientY - (pressed.lastY ?? pressed.clientY)) * scale));
    pressed.lastY = event.clientY;
    redraw();
  });
  listen(canvas, "pointermove", event => { const next = targetAt(event); if (next !== hovered) { hovered = next; if (next) glitchStart.set(next, performance.now()); canvas.style.cursor = next ? "pointer" : "default"; redraw(); } });
  listen(canvas, "pointerdown", event => {
    if (event.button !== 0) return;
    pressed = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, target: targetAt(event) };
    try { canvas.setPointerCapture?.(event.pointerId); } catch { /* Synthetic pointer tests have no active native pointer. */ }
  });
  listen(canvas, "pointerup", event => {
    const end = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, target: targetAt(event) };
    const start = pressed;
    pressed = null;
    try { if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId); } catch { /* Capture may already be released. */ }
    if (shouldActivateCrtPointer(start, end)) {
      event.preventDefault();
      activateCrtTarget(end.target);
    }
  });
  listen(canvas, "pointercancel", () => { pressed = null; });
  listen(canvas, "pointerleave", event => { if (!canvas.hasPointerCapture?.(event.pointerId)) pressed = null; hovered = null; redraw(); });
  listen(entry, "focusin", event => { if (buttons.includes(event.target)) glitchStart.set(event.target, performance.now()); redraw(); });
  listen(entry, "focusout", () => requestAnimationFrame(redraw));
  listen(menuButton, "focusin", redraw);
  listen(menuButton, "focusout", () => requestAnimationFrame(redraw));
  listen(logo, "load", redraw);
  listen(canvas, "webglcontextlost", event => { event.preventDefault(); dispose(); });
  observer.observe(entry);
  entry.append(canvas);
  document.fonts.load('24px SZDotGothic', 'オプション全画面モバイル版通常タップで詳細演出音量閉じる対戦ログリプレイ件書き出す後に送信0123456789デバッグ◀▶戻る版保存したファイルを消して読み直すエラーの記録まとめてコピーメモリの見積もり更新合計描画の倍率演出のスピード×.%MB').then(redraw, redraw);
  document.fonts.ready.then(redraw);
  function tick(now) {
    if (disposed) return;
    if (!document.hidden && (!lastNoiseFrame || now - lastNoiseFrame >= 1000 / 30)) {
      lastNoiseFrame = now;
      redraw();
    }
    frameId = requestAnimationFrame(tick);
  }
  frameId = requestAnimationFrame(tick);

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frameId);
    observer.disconnect();
    for (const [node, type, handler] of listeners) node.removeEventListener(type, handler);
    publishReady(false);
    options = {};
    scrolls.options = 0; scrolls.debug = 0;
    canvas.remove();
    gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
  }
  return { dispose, redraw, setOptions(next) { options = next; redraw(); } };
}

let active = null;
let activeEntry = null;
export function syncEntryCrtViewport(root, enabled, options = {}) {
  const entry = enabled ? root.querySelector(".r2-entry") : null;
  if (entry !== activeEntry) {
    active?.dispose();
    active = null;
    activeEntry = entry;
  }
  if (entry && active && !entry.querySelector(".r2-crt-viewport")) {
    active.dispose();
    active = null;
  }
  if (entry && !active) active = mount(entry, options);
  else active?.setOptions(options);
}
