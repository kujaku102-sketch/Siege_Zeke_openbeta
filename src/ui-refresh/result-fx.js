// Decorative only: game results and controls remain HTML when WebGL is unavailable.
// A loss or a draw gets the scanning shader; a win gets dot confetti.
let active = null;

export function syncResultFx(root, enabled) {
  const canvas = enabled && !matchMedia("(prefers-reduced-motion: reduce)").matches
    ? root.querySelector(".r2-result-fx") : null;
  if (active?.canvas === canvas) return;
  active?.dispose();
  active = null;
  if (!canvas) return;
  const outcome = canvas.closest(".r2-result")?.dataset.outcome;
  const dispose = outcome === "win" ? confetti(canvas) : scanShader(canvas, outcome === "draw" ? [1,.75,.27] : [1,.19,.45]);
  if (dispose) active = { canvas, dispose };
}

// PS1 style confetti: square dots on a coarse grid, stepped at a low frame rate.
export const CONFETTI = Object.freeze({
  dot: 6, fps: 20, count: 160, burst: 100, gravity: 34, drag: .985,
  colors: ["#29dbff","#ff3d8b","#ffd23f","#3dff6e","#f6f8fc","#a77bff"]
});

// Pure: one piece of confetti. A burst piece shoots up from a lower corner, a rain piece drifts down from the top.
export function confettiPiece(random, width, height, burst) {
  const color = CONFETTI.colors[Math.floor(random() * CONFETTI.colors.length)];
  const phase = random() * Math.PI * 2, spin = 4 + random() * 6, size = random() < .3 ? 2 : 1;
  if (burst) {
    const left = random() < .5;
    return { x: left ? 0 : width, y: height, vx: (left ? 1 : -1) * width * (.15 + random() * .3), vy: -height * (.5 + random() * .35),
      color, phase, spin, size };
  }
  return { x: random() * width, y: -2 - random() * height * .5, vx: (random() - .5) * 6, vy: 6 + random() * 10, color, phase, spin, size };
}

// Pure: advances a piece by dt seconds. Sway and the flip both come from the phase.
export function stepPiece(piece, dt) {
  const drag = CONFETTI.drag ** (dt * 60);
  piece.vx *= drag; piece.vy = piece.vy * drag + CONFETTI.gravity * dt;
  piece.vy = Math.min(piece.vy, 14);
  piece.phase += piece.spin * dt;
  piece.x += (piece.vx + Math.sin(piece.phase) * 5) * dt;
  piece.y += piece.vy * dt;
  return piece;
}

function confetti(canvas) {
  const g = canvas.getContext("2d");
  if (!g) return null;
  canvas.classList.add("is-dots");
  const random = Math.random;
  let width = 0, height = 0, pieces = [], frame = 0, last = 0, stopped = false;
  const resize = () => {
    const w = Math.max(1, Math.round(canvas.clientWidth / CONFETTI.dot)), h = Math.max(1, Math.round(canvas.clientHeight / CONFETTI.dot));
    if (w === width && h === height) return;
    width = w; height = h; canvas.width = w; canvas.height = h; g.imageSmoothingEnabled = false;
  };
  resize();
  pieces = Array.from({ length: CONFETTI.count }, (_, i) => confettiPiece(random, width, height, i < CONFETTI.burst));
  const draw = now => {
    if (stopped) return;
    frame = requestAnimationFrame(draw);
    if (last && now - last < 1000 / CONFETTI.fps) return;
    const dt = last ? Math.min(.1, (now - last) / 1000) : 0;
    last = now;
    resize();
    g.clearRect(0, 0, width, height);
    for (let i = 0; i < pieces.length; i++) {
      const piece = stepPiece(pieces[i], dt);
      if (piece.y > height + 2 || piece.x < -4 || piece.x > width + 4) { pieces[i] = confettiPiece(random, width, height, false); continue; }
      // The flip: a dot narrows to a sliver and back as it turns.
      const face = Math.abs(Math.cos(piece.phase));
      g.fillStyle = face < .35 ? "#0b1424" : piece.color;
      g.fillRect(Math.round(piece.x), Math.round(piece.y), face < .35 ? 1 : piece.size, piece.size);
    }
  };
  frame = requestAnimationFrame(draw);
  return () => { stopped = true; cancelAnimationFrame(frame); canvas.classList.remove("is-dots"); };
}

function scanShader(canvas, tintColor) {
  const gl = canvas.getContext("webgl", { alpha: true, antialias: false, powerPreference: "low-power" });
  if (!gl) return null;
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    return null;
  };
  const vertex = compile(gl.VERTEX_SHADER, "attribute vec2 p; varying vec2 uv; void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}");
  const fragment = compile(gl.FRAGMENT_SHADER, `precision mediump float;
    varying vec2 uv; uniform float t; uniform float aspect; uniform vec3 tint;
    float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    void main(){
      vec2 q=uv; q.x*=aspect;
      float ray=pow(max(0.,1.-abs(q.y-.5-0.05*sin(q.x*7.+t*.8))*5.),7.);
      float grid=max(step(.982,fract(q.x*21.+t*.05)),step(.987,fract(q.y*30.-t*.08)))*.11;
      float scan=step(.91,h(vec2(floor(q.y*110.),floor(t*11.))))*.18;
      float sparks=step(.997,h(floor(q*vec2(150.,85.))+floor(t*9.)))*.6;
      float pulse=.55+.45*sin(t*2.5+q.x*10.);
      vec3 color=tint*(ray*.55+grid*pulse+scan+sparks);
      gl_FragColor=vec4(color,clamp(ray*.27+grid+scan+sparks,0.,.62));
    }`);
  if (!vertex || !fragment) { if (vertex) gl.deleteShader(vertex); if (fragment) gl.deleteShader(fragment); return null; }
  const program = gl.createProgram();
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteShader(vertex); gl.deleteShader(fragment); gl.deleteProgram(program); return null; }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
  gl.useProgram(program);
  gl.enableVertexAttribArray(gl.getAttribLocation(program,"p"));
  gl.vertexAttribPointer(gl.getAttribLocation(program,"p"),2,gl.FLOAT,false,0,0);
  const time = gl.getUniformLocation(program,"t"), aspect = gl.getUniformLocation(program,"aspect"), tint = gl.getUniformLocation(program,"tint");
  gl.uniform3fv(tint, tintColor);
  let frame = 0, stopped = false;
  const started = performance.now();
  const draw = now => {
    if (stopped) return;
    const width = Math.max(1,Math.round(canvas.clientWidth * Math.min(devicePixelRatio || 1,2)));
    const height = Math.max(1,Math.round(canvas.clientHeight * Math.min(devicePixelRatio || 1,2)));
    if (canvas.width !== width || canvas.height !== height) { canvas.width=width; canvas.height=height; gl.viewport(0,0,width,height); }
    gl.uniform1f(time,(now-started)/1000);
    gl.uniform1f(aspect,width/height);
    gl.drawArrays(gl.TRIANGLES,0,6);
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
  // A lost context ends this decoration (the result stays HTML); it is not drawn again.
  const lost = event => { event.preventDefault(); stopped = true; cancelAnimationFrame(frame); canvas.hidden = true; };
  canvas.addEventListener("webglcontextlost", lost);
  return () => { canvas.removeEventListener("webglcontextlost", lost); stopped = true; cancelAnimationFrame(frame); gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment); };
}
