// The CRT glass shared by the curved title (entry-crt-viewport.js) and the curved flow screens (flow-crt-viewport.js):
// a 2D page bent by a radial perspective, with tape noise, scanlines and a vignette.
export const CRT_CURVE = 0.16;
export const vertexSource = `
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

export const fragmentSource = `
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

export function compile(gl, type, source) {
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

export function mesh(columns = 40, rows = 24) {
  const data = [];
  const point = (x, y) => [x / columns * 2 - 1, 1 - y / rows * 2, x / columns, y / rows];
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < columns; x += 1) {
    data.push(...point(x, y), ...point(x + 1, y), ...point(x, y + 1));
    data.push(...point(x + 1, y), ...point(x + 1, y + 1), ...point(x, y + 1));
  }
  return new Float32Array(data);
}

// A pointer on the bent glass, as a point on the flat page under it: the radial perspective inverted.
export function crtSourcePoint(event, box) {
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

// The glass on a canvas: its program, mesh and page texture. `draw(source)` bends the 2D page `source` (already
// uploaded with `upload`, or uploaded now) at the time given; null when WebGL or the shaders are not there.
export function createCrtGlass(canvas) {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: true, powerPreference: "low-power" });
  if (!gl) return null;
  let program, vertex, fragment, buffer, texture, count = 0;
  const release = () => {
    if (buffer) gl.deleteBuffer(buffer);
    if (texture) gl.deleteTexture(texture);
    if (program) gl.deleteProgram(program);
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
  };
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
    count = vertices.length / 4;
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
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  } catch (error) {
    console.warn("Curved viewport unavailable; using HTML.", error);
    release();
    return null;
  }
  const time = gl.getUniformLocation(program, "u_time");
  return {
    upload(source) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    },
    draw(width, height, seconds) {
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(time, seconds);
      gl.drawArrays(gl.TRIANGLES, 0, count);
    },
    dispose: release
  };
}
