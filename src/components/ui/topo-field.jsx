import { useEffect, useMemo, useRef } from "react";

/**
 * TopoField — animated WebGL topographic background (faint grid + drifting
 * contour lines from 2D simplex noise), rendered in a sandboxed iframe so the
 * shader loop stays fully self-contained.
 *
 * Adapted from MengTo/threeui (MIT) `TopoField`: the original document pulled
 * Tailwind/iconify/GSAP from CDNs and rendered a full marketing page — all of
 * that is stripped here. What remains is a minimal document (canvas + two
 * readability overlays + the raw WebGL script), so there are zero external
 * requests and nothing that can throw at runtime. Dark-only, matching Troxe.
 */

const topoFieldDocument = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
#topo-bg { position: fixed; inset: 0; pointer-events: none; }
#topo-bg canvas { display: block; width: 100%; height: 100%; }
</style>
</head>
<body>
<div id="topo-bg">
<canvas id="topo-canvas"></canvas>
<div style="position:absolute;inset:0;background:linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0) 45%, #000);"></div>
<div style="position:absolute;inset:0;background:radial-gradient(circle at center, rgba(0,0,0,0) 0%, #000 100%);opacity:0.9;"></div>
</div>
<script>
(function () {
  var controls = { speed: 1, opacity: 1 };
  window.addEventListener('message', function (event) {
    if (!event.data || event.data.type !== 'topo-controls') return;
    var next = event.data.controls || {};
    if (typeof next.speed === 'number') controls.speed = next.speed;
    if (typeof next.opacity === 'number') controls.opacity = next.opacity;
    var bg = document.getElementById('topo-bg');
    if (bg) bg.style.opacity = String(controls.opacity == null ? 1 : controls.opacity);
  });

  var canvas = document.getElementById('topo-canvas');
  var gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false });
  if (!gl) return;

  var vsSource = [
    'attribute vec2 a_position;',
    'void main() { gl_Position = vec4(a_position, 0.0, 1.0); }'
  ].join('\\n');

  var fsSource = [
    'precision highp float;',
    'uniform vec2 u_resolution;',
    'uniform float u_time;',
    'uniform float u_dpr;',
    '',
    'vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }',
    'float snoise(vec2 v){',
    '    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);',
    '    vec2 i  = floor(v + dot(v, C.yy) );',
    '    vec2 x0 = v -   i + dot(i, C.xx);',
    '    vec2 i1; i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);',
    '    vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;',
    '    i = mod(i, 289.0);',
    '    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));',
    '    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);',
    '    m = m*m; m = m*m;',
    '    vec3 x = 2.0 * fract(p * C.www) - 1.0;',
    '    vec3 h = abs(x) - 0.5; vec3 ox = floor(x + 0.5);',
    '    vec3 a0 = x - ox; m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );',
    '    vec3 g; g.x  = a0.x  * x0.x  + h.x  * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw;',
    '    return 130.0 * dot(m, g);',
    '}',
    '',
    'void main() {',
    '    vec2 st = gl_FragCoord.xy / u_resolution.xy;',
    '    st.x *= u_resolution.x / u_resolution.y;',
    '',
    '    float gridSize = 48.0 * u_dpr;',
    '    vec2 gridSt = gl_FragCoord.xy / gridSize;',
    '    vec2 gridFract = fract(gridSt);',
    '    float lineThickness = 1.0 / gridSize;',
    '    float gridLines = step(1.0 - lineThickness, gridFract.x) + step(1.0 - lineThickness, gridFract.y);',
    '    gridLines = clamp(gridLines, 0.0, 1.0) * 0.12;',
    '',
    '    float noiseScale = __NOISE_SCALE__;',
    '    vec2 noisePos = st * noiseScale + vec2(u_time * 0.015, u_time * 0.025);',
    '    float n = snoise(noisePos) * 0.5 + 0.5;',
    '    float numBands = __NUM_BANDS__;',
    '    float bandVal = n * numBands;',
    '    float triangleWave = abs(fract(bandVal) - 0.5) * 2.0;',
    '    float topoLines = smoothstep(0.02, 0.00, triangleWave) * 0.45;',
    '',
    '    vec3 color = vec3(0.0);',
    '    color += vec3(1.0) * gridLines;',
    '    color += vec3(1.0) * topoLines;',
    '',
    '    gl_FragColor = vec4(color, 1.0);',
    '}'
  ].join('\\n');

  function createShader(type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return null;
    return shader;
  }

  var vertexShader = createShader(gl.VERTEX_SHADER, vsSource);
  var fragmentShader = createShader(gl.FRAGMENT_SHADER, fsSource);
  if (!vertexShader || !fragmentShader) return;
  var program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
  gl.useProgram(program);

  var positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  var positionLocation = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  var resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
  var timeLocation = gl.getUniformLocation(program, 'u_time');
  var dprLocation = gl.getUniformLocation(program, 'u_dpr');

  function resizeCanvas() {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
    gl.uniform1f(dprLocation, dpr);
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  var origin = performance.now();
  var virtual = 0;
  var last = origin;
  function now() {
    var real = performance.now();
    virtual += (real - last) * (controls.speed || 1);
    last = real;
    return origin + virtual;
  }

  function render() {
    gl.uniform1f(timeLocation, (now() - origin) * 0.001);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
})();
</script>
</body>
</html>`;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function glslFloat(value, digits = 3) {
  const fixed = Number(value).toFixed(digits);
  return fixed.includes(".") ? fixed : `${fixed}.0`;
}

/**
 * Props mirror the original (dark-only here):
 * speed (0–3), length (0.35–2.5), density (0.25–2.5), opacity (0.05–1).
 */
export default function TopoField({
  speed = 1,
  length = 1,
  density = 1,
  opacity = 1,
  className,
  style,
}) {
  const iframeRef = useRef(null);

  const safeSpeed = clamp(speed, 0, 3);
  const safeLength = clamp(length, 0.35, 2.5);
  const safeDensity = clamp(density, 0.25, 2.5);
  const safeOpacity = clamp(opacity, 0.05, 1);

  const source = useMemo(
    () =>
      topoFieldDocument
        .replace("__NOISE_SCALE__", glslFloat(1.4 * safeLength, 3))
        .replace("__NUM_BANDS__", glslFloat(10 * safeDensity, 2)),
    [safeLength, safeDensity],
  );

  useEffect(() => {
    const frame = iframeRef.current?.contentWindow;
    if (!frame) return;
    frame.postMessage(
      { type: "topo-controls", controls: { speed: safeSpeed, opacity: safeOpacity } },
      "*",
    );
  }, [safeSpeed, safeOpacity, source]);

  return (
    <iframe
      ref={iframeRef}
      className={className}
      title="Topographic background"
      aria-hidden="true"
      tabIndex={-1}
      srcDoc={source}
      sandbox="allow-scripts"
      loading="eager"
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        border: 0,
        background: "#000",
        ...style,
      }}
    />
  );
}
