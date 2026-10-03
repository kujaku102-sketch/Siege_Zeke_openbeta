// Decorative only: game results and controls remain HTML when WebGL is unavailable.
let active = null;

export function syncResultFx(root, enabled) {
  const canvas = enabled && !matchMedia("(prefers-reduced-motion: reduce)").matches
    ? root.querySelector(".r2-result-fx") : null;
  if (active?.canvas === canvas) return;
  active?.dispose();
  active = null;
  if (!canvas) return;
  const gl = canvas.getContext("webgl", { alpha: true, antialias: false, powerPreference: "low-power" });
  if (!gl) return;
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
  if (!vertex || !fragment) { if (vertex) gl.deleteShader(vertex); if (fragment) gl.deleteShader(fragment); return; }
  const program = gl.createProgram();
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteShader(vertex); gl.deleteShader(fragment); gl.deleteProgram(program); return; }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
  gl.useProgram(program);
  gl.enableVertexAttribArray(gl.getAttribLocation(program,"p"));
  gl.vertexAttribPointer(gl.getAttribLocation(program,"p"),2,gl.FLOAT,false,0,0);
  const time = gl.getUniformLocation(program,"t"), aspect = gl.getUniformLocation(program,"aspect"), tint = gl.getUniformLocation(program,"tint");
  const outcome = canvas.closest(".r2-result")?.dataset.outcome;
  gl.uniform3fv(tint, outcome === "ai" ? [1,.19,.45] : outcome === "draw" ? [1,.75,.27] : [.16,.86,1]);
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
  active = { canvas, dispose() { stopped = true; cancelAnimationFrame(frame); gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment); } };
}
