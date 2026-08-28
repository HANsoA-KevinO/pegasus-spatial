'use client'

import { useEffect, useRef, type JSX } from 'react'

interface BreathingAirMassProps {
  state: 'landing' | 'idle' | 'running'
}

interface RenderTarget {
  framebuffer: WebGLFramebuffer
  texture: WebGLTexture
  width: number
  height: number
}

interface DoubleRenderTarget {
  read: RenderTarget
  write: RenderTarget
  swap: () => void
}

interface FluidSplat {
  x: number
  y: number
  velocityX: number
  velocityY: number
  radius: number
}

interface FluidPrograms {
  advection: WebGLProgram
  boundary: WebGLProgram
  clear: WebGLProgram
  curl: WebGLProgram
  densityCohesion: WebGLProgram
  densityMaintenance: WebGLProgram
  densitySeed: WebGLProgram
  divergence: WebGLProgram
  display: WebGLProgram
  gradientSubtract: WebGLProgram
  pressure: WebGLProgram
  splat: WebGLProgram
  vorticity: WebGLProgram
}

const SIMULATION_LONG_SIDE = 256
const PRESSURE_ITERATIONS = 12
const MAX_RENDER_FPS = 60
const VISUAL_DENSITY_BOOST = 1.56
const DENSITY_AMOUNT_BOOST = 2.2
const WALL_RESTITUTION = 0.78
const DENSITY_COHESION_RATE = 0.72
const MAX_PENDING_SPLATS = 28
const POINTER_SPLAT_RADIUS_MIN = 0.011
const POINTER_SPLAT_RADIUS_MAX = 0.019
const SEED_COLUMNS = 5
const SEED_ROWS = 3
const AMBIENT_STREAMS = [
  { phase: 0.0, xAmplitude: 0.43, yAmplitude: 0.34, xRate: 0.033, yRate: 0.045, radius: 0.092 },
  { phase: 2.47, xAmplitude: 0.39, yAmplitude: 0.38, xRate: 0.028, yRate: 0.051, radius: 0.082 },
] as const
const POINTER_IGNORE_SELECTOR = [
  '#pegasus-chat-input',
  '#workbench-composer',
  '[data-fluid-interaction="ignore"]',
].join(', ')

// The solver follows Jos Stam's Stable Fluids pipeline (semi-Lagrangian
// advection + pressure projection), using the WebGL pass structure popularised
// by the MIT-licensed PavelDoGreat/WebGL-Fluid-Simulation project.
const VERTEX_SHADER = `#version 300 es
precision highp float;

out vec2 vUv;

const vec2 POSITIONS[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2(3.0, -1.0),
  vec2(-1.0, 3.0)
);

void main() {
  vec2 position = POSITIONS[gl_VertexID];
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const ADVECTION_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform float uDeltaTime;
uniform float uDissipation;

float mirrorCoordinate(float coordinate) {
  float folded = mod(coordinate, 2.0);
  return folded <= 1.0 ? folded : 2.0 - folded;
}

void main() {
  vec2 velocity = texture(uVelocity, vUv).xy;
  vec2 tracedPosition = vUv - velocity * uDeltaTime;
  vec2 previousPosition = vec2(
    mirrorCoordinate(tracedPosition.x),
    mirrorCoordinate(tracedPosition.y)
  );
  outColor = texture(uSource, previousPosition) * uDissipation;
}
`

const BOUNDARY_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uVelocity;
uniform vec2 uTexelSize;
uniform float uRestitution;

void main() {
  vec2 velocity = texture(uVelocity, vUv).xy;
  vec2 wallBand = uTexelSize * 1.6;

  if (vUv.x <= wallBand.x && velocity.x < 0.0) {
    velocity.x = -velocity.x * uRestitution;
    velocity.y *= 0.985;
  }
  if (vUv.x >= 1.0 - wallBand.x && velocity.x > 0.0) {
    velocity.x = -velocity.x * uRestitution;
    velocity.y *= 0.985;
  }
  if (vUv.y <= wallBand.y && velocity.y < 0.0) {
    velocity.y = -velocity.y * uRestitution;
    velocity.x *= 0.985;
  }
  if (vUv.y >= 1.0 - wallBand.y && velocity.y > 0.0) {
    velocity.y = -velocity.y * uRestitution;
    velocity.x *= 0.985;
  }

  outColor = vec4(velocity, 0.0, 1.0);
}
`

const CLEAR_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTexture;
uniform float uValue;

void main() {
  outColor = texture(uTexture, vUv) * uValue;
}
`

const SPLAT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTarget;
uniform vec2 uPoint;
uniform vec3 uValue;
uniform float uAspect;
uniform float uRadius;
uniform vec2 uStretch;
uniform float uAngle;
uniform float uOrganic;
uniform float uShapeSeed;

void main() {
  vec2 offset = vUv - uPoint;
  offset.x *= uAspect;
  float sine = sin(uAngle);
  float cosine = cos(uAngle);
  vec2 local = mat2(cosine, -sine, sine, cosine) * offset;
  local /= max(uStretch, vec2(0.1));

  float polarAngle = atan(local.y, local.x);
  float contour = 1.0 + uOrganic * (
    sin(polarAngle * 3.0 + uShapeSeed) * 0.24
    + sin(polarAngle * 5.0 - uShapeSeed * 0.7) * 0.11
  );
  vec2 lobeDirection = vec2(cos(uShapeSeed), sin(uShapeSeed));
  vec2 lobeLocal = local - lobeDirection * uRadius * uOrganic * 0.72;
  float core = exp(-dot(local, local) / max(2.0 * uRadius * uRadius * contour * contour, 0.000001));
  float lobe = exp(-dot(lobeLocal, lobeLocal) / max(1.35 * uRadius * uRadius, 0.000001));
  float falloff = core * (1.0 - uOrganic * 0.10) + lobe * uOrganic * 0.24;
  outColor = texture(uTarget, vUv) + vec4(uValue * falloff, 0.0);
}
`

const DENSITY_SEED_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform float uSeed;
uniform float uAmount;

float hash21(vec2 point) {
  point = fract(point * vec2(123.34, 456.21));
  point += dot(point, point + 45.32);
  return fract(point.x * point.y);
}

float valueNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}

float fbm(vec2 point) {
  float sum = 0.0;
  float amplitude = 0.52;
  mat2 rotation = mat2(0.80, -0.60, 0.60, 0.80);
  for (int octave = 0; octave < 5; octave++) {
    sum += valueNoise(point) * amplitude;
    point = rotation * point * 2.03 + vec2(9.7, 13.1);
    amplitude *= 0.5;
  }
  return sum;
}

void main() {
  vec2 point = (vUv - 0.5) * vec2(2.05, 1.45);
  vec2 warp = vec2(
    fbm(point * 1.18 + vec2(uSeed, -uSeed * 0.43)),
    fbm(point * 1.11 + vec2(-uSeed * 0.71, uSeed))
  ) - 0.5;
  float broad = fbm(point * 0.82 + warp * 1.55 + uSeed * 0.17);
  float detail = fbm(point * 1.76 - warp * 0.84 - uSeed * 0.11);
  float filament = 1.0 - abs(fbm(point * 1.23 + warp * 2.10 + 5.7) * 2.0 - 1.0);
  float density = max(0.0, (broad - 0.29) * 0.62 + (detail - 0.42) * 0.20 + filament * 0.055);
  outColor = vec4(density * uAmount, 0.0, 0.0, 1.0);
}
`

const DENSITY_MAINTENANCE_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uDensity;
uniform float uSeed;
uniform float uAmount;
uniform float uTime;
uniform float uDeltaTime;

float hash21(vec2 point) {
  point = fract(point * vec2(123.34, 456.21));
  point += dot(point, point + 45.32);
  return fract(point.x * point.y);
}

float valueNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}

float fbm(vec2 point) {
  float sum = 0.0;
  float amplitude = 0.52;
  mat2 rotation = mat2(0.80, -0.60, 0.60, 0.80);
  for (int octave = 0; octave < 5; octave++) {
    sum += valueNoise(point) * amplitude;
    point = rotation * point * 2.03 + vec2(9.7, 13.1);
    amplitude *= 0.5;
  }
  return sum;
}

void main() {
  vec2 drift = vec2(
    sin(uTime * 0.011 + uSeed) * 0.24,
    cos(uTime * 0.009 - uSeed * 0.61) * 0.19
  );
  vec2 point = (vUv - 0.5) * vec2(2.05, 1.45) + drift;
  vec2 warp = vec2(
    fbm(point * 1.18 + vec2(uSeed, -uSeed * 0.43) + uTime * 0.0017),
    fbm(point * 1.11 + vec2(-uSeed * 0.71, uSeed) - uTime * 0.0013)
  ) - 0.5;
  float broad = fbm(point * 0.82 + warp * 1.55 + uSeed * 0.17);
  float detail = fbm(point * 1.76 - warp * 0.84 - uSeed * 0.11);
  float filament = 1.0 - abs(fbm(point * 1.23 + warp * 2.10 + 5.7) * 2.0 - 1.0);
  float targetDensity = max(0.0, (broad - 0.29) * 0.62 + (detail - 0.42) * 0.20 + filament * 0.055);
  float currentDensity = max(texture(uDensity, vUv).r, 0.0);
  float relaxation = 1.0 - exp(-0.052 * uDeltaTime);
  float maintainedDensity = mix(currentDensity, targetDensity * uAmount, relaxation);
  outColor = vec4(maintainedDensity, 0.0, 0.0, 1.0);
}
`

const DENSITY_COHESION_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uDensity;
uniform vec2 uTexelSize;
uniform float uDeltaTime;
uniform float uCohesionRate;

void main() {
  float center = max(texture(uDensity, vUv).r, 0.0);
  float left = max(texture(uDensity, vUv - vec2(uTexelSize.x, 0.0)).r, 0.0);
  float right = max(texture(uDensity, vUv + vec2(uTexelSize.x, 0.0)).r, 0.0);
  float bottom = max(texture(uDensity, vUv - vec2(0.0, uTexelSize.y)).r, 0.0);
  float top = max(texture(uDensity, vUv + vec2(0.0, uTexelSize.y)).r, 0.0);
  float bottomLeft = max(texture(uDensity, vUv - uTexelSize).r, 0.0);
  float bottomRight = max(texture(uDensity, vUv + vec2(uTexelSize.x, -uTexelSize.y)).r, 0.0);
  float topLeft = max(texture(uDensity, vUv + vec2(-uTexelSize.x, uTexelSize.y)).r, 0.0);
  float topRight = max(texture(uDensity, vUv + uTexelSize).r, 0.0);

  const float diagonalWeight = 0.70710678;
  float localAverage = (
    left + right + bottom + top
    + (bottomLeft + bottomRight + topLeft + topRight) * diagonalWeight
  ) / (4.0 + 4.0 * diagonalWeight);
  float localMinimum = min(
    min(min(left, right), min(bottom, top)),
    min(min(bottomLeft, bottomRight), min(topLeft, topRight))
  );
  float localMaximum = max(
    max(max(left, right), max(bottom, top)),
    max(max(bottomLeft, bottomRight), max(topLeft, topRight))
  );

  float cohesion = 1.0 - exp(-uCohesionRate * uDeltaTime);
  float gatheredDensity = center + (center - localAverage) * cohesion;
  gatheredDensity = clamp(gatheredDensity, min(center, localMinimum), max(center, localMaximum));
  outColor = vec4(max(gatheredDensity, 0.0), 0.0, 0.0, 1.0);
}
`

const CURL_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uVelocity;
uniform vec2 uTexelSize;

void main() {
  float left = texture(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).y;
  float right = texture(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).y;
  float bottom = texture(uVelocity, vUv - vec2(0.0, uTexelSize.y)).x;
  float top = texture(uVelocity, vUv + vec2(0.0, uTexelSize.y)).x;
  outColor = vec4(0.5 * (right - left - top + bottom), 0.0, 0.0, 1.0);
}
`

const VORTICITY_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform vec2 uTexelSize;
uniform float uDeltaTime;
uniform float uStrength;

void main() {
  float left = abs(texture(uCurl, vUv - vec2(uTexelSize.x, 0.0)).x);
  float right = abs(texture(uCurl, vUv + vec2(uTexelSize.x, 0.0)).x);
  float bottom = abs(texture(uCurl, vUv - vec2(0.0, uTexelSize.y)).x);
  float top = abs(texture(uCurl, vUv + vec2(0.0, uTexelSize.y)).x);
  float center = texture(uCurl, vUv).x;

  vec2 force = 0.5 * vec2(top - bottom, right - left);
  force /= length(force) + 0.0001;
  force *= uStrength * center;
  force.y *= -1.0;

  vec2 velocity = texture(uVelocity, vUv).xy;
  outColor = vec4(velocity + force * uDeltaTime, 0.0, 1.0);
}
`

const DIVERGENCE_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uVelocity;
uniform vec2 uTexelSize;

void main() {
  vec2 center = texture(uVelocity, vUv).xy;
  float left = texture(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).x;
  float right = texture(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).x;
  float bottom = texture(uVelocity, vUv - vec2(0.0, uTexelSize.y)).y;
  float top = texture(uVelocity, vUv + vec2(0.0, uTexelSize.y)).y;

  if (vUv.x < uTexelSize.x) left = -center.x;
  if (vUv.x > 1.0 - uTexelSize.x) right = -center.x;
  if (vUv.y < uTexelSize.y) bottom = -center.y;
  if (vUv.y > 1.0 - uTexelSize.y) top = -center.y;

  outColor = vec4(0.5 * (right - left + top - bottom), 0.0, 0.0, 1.0);
}
`

const PRESSURE_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexelSize;

void main() {
  float left = texture(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
  float right = texture(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
  float bottom = texture(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
  float top = texture(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
  float divergence = texture(uDivergence, vUv).x;
  outColor = vec4((left + right + bottom + top - divergence) * 0.25, 0.0, 0.0, 1.0);
}
`

const GRADIENT_SUBTRACT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uTexelSize;

void main() {
  float left = texture(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
  float right = texture(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
  float bottom = texture(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
  float top = texture(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
  vec2 velocity = texture(uVelocity, vUv).xy;
  velocity -= 0.5 * vec2(right - left, top - bottom);
  outColor = vec4(velocity, 0.0, 1.0);
}
`

const DISPLAY_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uDensity;
uniform float uIntensity;

void main() {
  float density = max(texture(uDensity, vUv).r, 0.0);
  float mappedDensity = 1.0 - exp(-density * 1.82);
  float body = pow(mappedDensity, 1.26);
  float whiteCore = smoothstep(0.10, 0.38, density);
  vec3 thinColor = vec3(0.60, 0.69, 0.84);
  vec3 middleColor = vec3(0.82, 0.88, 0.97);
  vec3 gasColor = mix(thinColor, middleColor, smoothstep(0.025, 0.18, density));
  gasColor = mix(gasColor, vec3(0.995, 0.997, 1.0), pow(whiteCore, 0.72));
  float alpha = body * (0.14 + whiteCore * 0.34) * uIntensity;
  outColor = vec4(gasColor, clamp(alpha, 0.0, 0.58));
}
`

const uniformCache = new WeakMap<WebGLProgram, Map<string, WebGLUniformLocation>>()

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('无法创建呼吸气团着色器')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? '未知着色器错误'
    gl.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertex: WebGLShader,
  fragmentSource: string,
): WebGLProgram {
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = gl.createProgram()
  if (!program) throw new Error('无法创建呼吸气团渲染程序')
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? '未知链接错误'
    gl.deleteProgram(program)
    throw new Error(message)
  }
  return program
}

function uniform(gl: WebGL2RenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation {
  let programLocations = uniformCache.get(program)
  if (!programLocations) {
    programLocations = new Map()
    uniformCache.set(program, programLocations)
  }
  const cached = programLocations.get(name)
  if (cached) return cached
  const location = gl.getUniformLocation(program, name)
  if (location === null) throw new Error(`呼吸气团缺少 uniform：${name}`)
  programLocations.set(name, location)
  return location
}

function bindTexture(gl: WebGL2RenderingContext, texture: WebGLTexture, unit: number): void {
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, texture)
}

function createRenderTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): RenderTarget {
  const texture = gl.createTexture()
  const framebuffer = gl.createFramebuffer()
  if (!texture || !framebuffer) throw new Error('无法创建呼吸气团流体缓冲区')

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null)

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteTexture(texture)
    gl.deleteFramebuffer(framebuffer)
    throw new Error('当前设备不支持呼吸气团的浮点流体缓冲区')
  }
  return { framebuffer, texture, width, height }
}

function createDoubleRenderTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): DoubleRenderTarget {
  let read = createRenderTarget(gl, width, height)
  let write = createRenderTarget(gl, width, height)
  return {
    get read() {
      return read
    },
    set read(value: RenderTarget) {
      read = value
    },
    get write() {
      return write
    },
    set write(value: RenderTarget) {
      write = value
    },
    swap: () => {
      const nextRead = write
      write = read
      read = nextRead
    },
  }
}

function destroyRenderTarget(gl: WebGL2RenderingContext, target: RenderTarget | null): void {
  if (!target) return
  gl.deleteFramebuffer(target.framebuffer)
  gl.deleteTexture(target.texture)
}

function destroyDoubleRenderTarget(gl: WebGL2RenderingContext, target: DoubleRenderTarget | null): void {
  if (!target) return
  destroyRenderTarget(gl, target.read)
  destroyRenderTarget(gl, target.write)
}

export function BreathingAirMass({ state }: BreathingAirMassProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
      premultipliedAlpha: true,
    })
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) return

    let vertex: WebGLShader | null = null
    let programs: FluidPrograms | null = null
    try {
      vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
      programs = {
        advection: createProgram(gl, vertex, ADVECTION_SHADER),
        boundary: createProgram(gl, vertex, BOUNDARY_SHADER),
        clear: createProgram(gl, vertex, CLEAR_SHADER),
        curl: createProgram(gl, vertex, CURL_SHADER),
        densityCohesion: createProgram(gl, vertex, DENSITY_COHESION_SHADER),
        densityMaintenance: createProgram(gl, vertex, DENSITY_MAINTENANCE_SHADER),
        densitySeed: createProgram(gl, vertex, DENSITY_SEED_SHADER),
        divergence: createProgram(gl, vertex, DIVERGENCE_SHADER),
        display: createProgram(gl, vertex, DISPLAY_SHADER),
        gradientSubtract: createProgram(gl, vertex, GRADIENT_SUBTRACT_SHADER),
        pressure: createProgram(gl, vertex, PRESSURE_SHADER),
        splat: createProgram(gl, vertex, SPLAT_SHADER),
        vorticity: createProgram(gl, vertex, VORTICITY_SHADER),
      }
    } catch (error) {
      if (vertex) gl.deleteShader(vertex)
      console.warn('[呼吸气团] WebGL 流体求解器初始化失败，使用静态回退。', error)
      return
    }
    gl.deleteShader(vertex)

    const fluidPrograms = programs
    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.BLEND)

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const pendingSplats: FluidSplat[] = []
    const seed = Math.random() * Math.PI * 2
    let velocity: DoubleRenderTarget | null = null
    let density: DoubleRenderTarget | null = null
    let pressure: DoubleRenderTarget | null = null
    let curl: RenderTarget | null = null
    let divergence: RenderTarget | null = null
    let simulationWidth = 0
    let simulationHeight = 0
    let frame = 0
    let previousFrame = performance.now()
    let lastRenderedAt = 0
    let lastPointer: { x: number; y: number; time: number } | null = null

    const draw = (target: RenderTarget | null) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null)
      gl.viewport(0, 0, target?.width ?? canvas.width, target?.height ?? canvas.height)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    const deleteSimulationTargets = () => {
      destroyDoubleRenderTarget(gl, velocity)
      destroyDoubleRenderTarget(gl, density)
      destroyDoubleRenderTarget(gl, pressure)
      destroyRenderTarget(gl, curl)
      destroyRenderTarget(gl, divergence)
      velocity = null
      density = null
      pressure = null
      curl = null
      divergence = null
    }

    const applySplat = (
      target: DoubleRenderTarget,
      x: number,
      y: number,
      valueX: number,
      valueY: number,
      valueZ: number,
      radius: number,
      stretchX = 1,
      stretchY = 1,
      angle = 0,
      organic = 0,
      shapeSeed = 0,
    ) => {
      const program = fluidPrograms.splat
      gl.useProgram(program)
      bindTexture(gl, target.read.texture, 0)
      gl.uniform1i(uniform(gl, program, 'uTarget'), 0)
      gl.uniform2f(uniform(gl, program, 'uPoint'), x, y)
      gl.uniform3f(uniform(gl, program, 'uValue'), valueX, valueY, valueZ)
      gl.uniform1f(uniform(gl, program, 'uAspect'), simulationWidth / simulationHeight)
      gl.uniform1f(uniform(gl, program, 'uRadius'), radius)
      gl.uniform2f(uniform(gl, program, 'uStretch'), stretchX, stretchY)
      gl.uniform1f(uniform(gl, program, 'uAngle'), angle)
      gl.uniform1f(uniform(gl, program, 'uOrganic'), organic)
      gl.uniform1f(uniform(gl, program, 'uShapeSeed'), shapeSeed)
      draw(target.write)
      target.swap()
    }

    const seedSimulation = () => {
      if (!velocity || !density) return
      const velocityTarget = velocity
      const densityTarget = density
      const densitySeedProgram = fluidPrograms.densitySeed
      gl.useProgram(densitySeedProgram)
      gl.uniform1f(uniform(gl, densitySeedProgram, 'uSeed'), seed)
      gl.uniform1f(uniform(gl, densitySeedProgram, 'uAmount'), DENSITY_AMOUNT_BOOST)
      draw(densityTarget.read)

      for (let row = 0; row < SEED_ROWS; row++) {
        for (let column = 0; column < SEED_COLUMNS; column++) {
          const x = (column + 0.5) / SEED_COLUMNS + (Math.random() - 0.5) * 0.105
          const y = (row + 0.5) / SEED_ROWS + (Math.random() - 0.5) * 0.14
          const radius = 0.055 + Math.random() * 0.035
          const angle = Math.random() * Math.PI * 2
          const velocityAmount = 0.006 + Math.random() * 0.006
          applySplat(
            velocityTarget,
            x,
            y,
            Math.cos(angle) * velocityAmount,
            Math.sin(angle) * velocityAmount,
            0,
            radius * 1.18,
          )
        }
      }
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      const displayScale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.58
      const displayWidth = Math.max(1, Math.round(rect.width * displayScale))
      const displayHeight = Math.max(1, Math.round(rect.height * displayScale))
      if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        canvas.width = displayWidth
        canvas.height = displayHeight
      }

      const aspect = rect.width / rect.height
      const nextWidth = aspect >= 1
        ? SIMULATION_LONG_SIDE
        : Math.max(96, Math.round(SIMULATION_LONG_SIDE * aspect))
      const nextHeight = aspect >= 1
        ? Math.max(96, Math.round(SIMULATION_LONG_SIDE / aspect))
        : SIMULATION_LONG_SIDE
      if (nextWidth === simulationWidth && nextHeight === simulationHeight) return

      simulationWidth = nextWidth
      simulationHeight = nextHeight
      deleteSimulationTargets()
      try {
        velocity = createDoubleRenderTarget(gl, simulationWidth, simulationHeight)
        density = createDoubleRenderTarget(gl, simulationWidth, simulationHeight)
        pressure = createDoubleRenderTarget(gl, simulationWidth, simulationHeight)
        curl = createRenderTarget(gl, simulationWidth, simulationHeight)
        divergence = createRenderTarget(gl, simulationWidth, simulationHeight)
        seedSimulation()
      } catch (error) {
        deleteSimulationTargets()
        console.warn('[呼吸气团] 无法调整流体缓冲区，已暂停动态渲染。', error)
      }
    }

    const addAmbientCurrent = (now: number, deltaTime: number) => {
      if (!velocity || reducedMotion.matches) return
      const velocityTarget = velocity
      const time = now / 1000
      AMBIENT_STREAMS.forEach((stream, index) => {
        const phase = stream.phase + seed * (0.31 + index * 0.09)
        const x = 0.5 + Math.sin(time * stream.xRate + phase) * stream.xAmplitude
        const y = 0.5 + Math.cos(time * stream.yRate + phase * 0.73) * stream.yAmplitude
        const tangentX = Math.cos(time * stream.xRate + phase) * stream.xAmplitude * stream.xRate
        const tangentY = -Math.sin(time * stream.yRate + phase * 0.73) * stream.yAmplitude * stream.yRate
        const tangentLength = Math.max(Math.hypot(tangentX, tangentY), 0.0001)
        const radius = stream.radius + Math.sin(time * 0.037 + phase) * 0.011
        applySplat(
          velocityTarget,
          x,
          y,
          (tangentX / tangentLength) * 0.0022 * deltaTime,
          (tangentY / tangentLength) * 0.0022 * deltaTime,
          0,
          radius * 0.78,
        )
      })
    }

    const applyPendingSplats = () => {
      if (!velocity) return
      for (const splat of pendingSplats.splice(0)) {
        applySplat(
          velocity,
          splat.x,
          splat.y,
          splat.velocityX,
          splat.velocityY,
          0,
          splat.radius,
        )
      }
    }

    const applyVelocityBoundary = () => {
      if (!velocity) return
      const program = fluidPrograms.boundary
      gl.useProgram(program)
      bindTexture(gl, velocity.read.texture, 0)
      gl.uniform1i(uniform(gl, program, 'uVelocity'), 0)
      gl.uniform2f(
        uniform(gl, program, 'uTexelSize'),
        1 / simulationWidth,
        1 / simulationHeight,
      )
      gl.uniform1f(uniform(gl, program, 'uRestitution'), WALL_RESTITUTION)
      draw(velocity.write)
      velocity.swap()
    }

    const runFluidStep = (deltaTime: number, now: number) => {
      if (!velocity || !density || !pressure || !curl || !divergence) return
      const texelX = 1 / simulationWidth
      const texelY = 1 / simulationHeight

      let program = fluidPrograms.advection
      gl.useProgram(program)
      bindTexture(gl, velocity.read.texture, 0)
      bindTexture(gl, velocity.read.texture, 1)
      gl.uniform1i(uniform(gl, program, 'uVelocity'), 0)
      gl.uniform1i(uniform(gl, program, 'uSource'), 1)
      gl.uniform1f(uniform(gl, program, 'uDeltaTime'), deltaTime)
      gl.uniform1f(uniform(gl, program, 'uDissipation'), Math.exp(-0.16 * deltaTime))
      draw(velocity.write)
      velocity.swap()

      applyPendingSplats()
      applyVelocityBoundary()

      program = fluidPrograms.curl
      gl.useProgram(program)
      bindTexture(gl, velocity.read.texture, 0)
      gl.uniform1i(uniform(gl, program, 'uVelocity'), 0)
      gl.uniform2f(uniform(gl, program, 'uTexelSize'), texelX, texelY)
      draw(curl)

      program = fluidPrograms.vorticity
      gl.useProgram(program)
      bindTexture(gl, velocity.read.texture, 0)
      bindTexture(gl, curl.texture, 1)
      gl.uniform1i(uniform(gl, program, 'uVelocity'), 0)
      gl.uniform1i(uniform(gl, program, 'uCurl'), 1)
      gl.uniform2f(uniform(gl, program, 'uTexelSize'), texelX, texelY)
      gl.uniform1f(uniform(gl, program, 'uDeltaTime'), deltaTime)
      gl.uniform1f(uniform(gl, program, 'uStrength'), 6.0)
      draw(velocity.write)
      velocity.swap()
      applyVelocityBoundary()

      program = fluidPrograms.divergence
      gl.useProgram(program)
      bindTexture(gl, velocity.read.texture, 0)
      gl.uniform1i(uniform(gl, program, 'uVelocity'), 0)
      gl.uniform2f(uniform(gl, program, 'uTexelSize'), texelX, texelY)
      draw(divergence)

      program = fluidPrograms.clear
      gl.useProgram(program)
      bindTexture(gl, pressure.read.texture, 0)
      gl.uniform1i(uniform(gl, program, 'uTexture'), 0)
      gl.uniform1f(uniform(gl, program, 'uValue'), 0.78)
      draw(pressure.write)
      pressure.swap()

      program = fluidPrograms.pressure
      gl.useProgram(program)
      gl.uniform1i(uniform(gl, program, 'uPressure'), 0)
      gl.uniform1i(uniform(gl, program, 'uDivergence'), 1)
      gl.uniform2f(uniform(gl, program, 'uTexelSize'), texelX, texelY)
      bindTexture(gl, divergence.texture, 1)
      for (let iteration = 0; iteration < PRESSURE_ITERATIONS; iteration++) {
        bindTexture(gl, pressure.read.texture, 0)
        draw(pressure.write)
        pressure.swap()
      }

      program = fluidPrograms.gradientSubtract
      gl.useProgram(program)
      bindTexture(gl, pressure.read.texture, 0)
      bindTexture(gl, velocity.read.texture, 1)
      gl.uniform1i(uniform(gl, program, 'uPressure'), 0)
      gl.uniform1i(uniform(gl, program, 'uVelocity'), 1)
      gl.uniform2f(uniform(gl, program, 'uTexelSize'), texelX, texelY)
      draw(velocity.write)
      velocity.swap()
      applyVelocityBoundary()

      program = fluidPrograms.advection
      gl.useProgram(program)
      bindTexture(gl, velocity.read.texture, 0)
      bindTexture(gl, density.read.texture, 1)
      gl.uniform1i(uniform(gl, program, 'uVelocity'), 0)
      gl.uniform1i(uniform(gl, program, 'uSource'), 1)
      gl.uniform1f(uniform(gl, program, 'uDeltaTime'), deltaTime)
      gl.uniform1f(uniform(gl, program, 'uDissipation'), 1.0)
      draw(density.write)
      density.swap()

      program = fluidPrograms.densityCohesion
      gl.useProgram(program)
      bindTexture(gl, density.read.texture, 0)
      gl.uniform1i(uniform(gl, program, 'uDensity'), 0)
      gl.uniform2f(uniform(gl, program, 'uTexelSize'), texelX, texelY)
      gl.uniform1f(uniform(gl, program, 'uDeltaTime'), deltaTime)
      gl.uniform1f(uniform(gl, program, 'uCohesionRate'), DENSITY_COHESION_RATE)
      draw(density.write)
      density.swap()

      program = fluidPrograms.densityMaintenance
      gl.useProgram(program)
      bindTexture(gl, density.read.texture, 0)
      gl.uniform1i(uniform(gl, program, 'uDensity'), 0)
      gl.uniform1f(uniform(gl, program, 'uSeed'), seed)
      gl.uniform1f(uniform(gl, program, 'uAmount'), DENSITY_AMOUNT_BOOST)
      gl.uniform1f(uniform(gl, program, 'uTime'), now / 1000)
      gl.uniform1f(uniform(gl, program, 'uDeltaTime'), deltaTime)
      draw(density.write)
      density.swap()
    }

    const displayFluid = () => {
      if (!density) return
      const program = fluidPrograms.display
      const baseIntensity = stateRef.current === 'running' ? 1.04 : stateRef.current === 'idle' ? 1 : 0.84
      const intensity = baseIntensity * VISUAL_DENSITY_BOOST
      gl.useProgram(program)
      bindTexture(gl, density.read.texture, 0)
      gl.uniform1i(uniform(gl, program, 'uDensity'), 0)
      gl.uniform1f(uniform(gl, program, 'uIntensity'), intensity)
      draw(null)
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (reducedMotion.matches) return
      const eventTarget = event.target
      if (eventTarget instanceof Element && eventTarget.closest(POINTER_IGNORE_SELECTOR)) {
        lastPointer = null
        pendingSplats.length = 0
        return
      }

      const rect = canvas.getBoundingClientRect()
      const interactionRect = root.parentElement?.getBoundingClientRect() ?? rect
      if (rect.width <= 0 || rect.height <= 0) return
      if (
        event.clientX < interactionRect.left
        || event.clientX > interactionRect.right
        || event.clientY < interactionRect.top
        || event.clientY > interactionRect.bottom
      ) {
        lastPointer = null
        pendingSplats.length = 0
        return
      }

      const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
      const y = Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height))
      const now = performance.now()
      if (lastPointer) {
        const elapsedSeconds = Math.max((now - lastPointer.time) / 1000, 1 / 120)
        const deltaX = x - lastPointer.x
        const deltaY = y - lastPointer.y
        const distance = Math.hypot(deltaX, deltaY)
        if (distance > 0.0015) {
          const speed = Math.min(distance / elapsedSeconds, 1.1)
          const directionX = deltaX / distance
          const directionY = deltaY / distance
          const force = Math.min(0.19, 0.035 + speed * 0.16)
          const radius = POINTER_SPLAT_RADIUS_MIN
            + (POINTER_SPLAT_RADIUS_MAX - POINTER_SPLAT_RADIUS_MIN) * Math.min(speed / 1.1, 1)
          const steps = Math.min(4, Math.max(1, Math.ceil(distance / 0.018)))
          for (let step = 1; step <= steps; step++) {
            const progress = step / steps
            pendingSplats.push({
              x: lastPointer.x + deltaX * progress,
              y: lastPointer.y + deltaY * progress,
              velocityX: directionX * force,
              velocityY: directionY * force,
              radius,
            })
          }
          if (pendingSplats.length > MAX_PENDING_SPLATS) {
            pendingSplats.splice(0, pendingSplats.length - MAX_PENDING_SPLATS)
          }
        }
      }
      lastPointer = { x, y, time: now }
    }

    const releasePointer = () => {
      lastPointer = null
      pendingSplats.length = 0
    }

    const render = (now: number) => {
      frame = window.requestAnimationFrame(render)
      // A small tolerance prevents a nominal 60 Hz display from accidentally
      // falling to 30 fps because requestAnimationFrame lands just under 16.67 ms.
      if (now - lastRenderedAt < (1000 / MAX_RENDER_FPS) * 0.72) return
      lastRenderedAt = now
      resize()
      if (!velocity || !density) return

      const deltaTime = reducedMotion.matches
        ? 0
        : Math.min(Math.max((now - previousFrame) / 1000, 1 / 120), 1 / 20)
      previousFrame = now
      if (!reducedMotion.matches) {
        addAmbientCurrent(now, deltaTime)
        runFluidStep(deltaTime, now)
      }
      displayFluid()
    }

    const handleMotionPreference = () => {
      pendingSplats.length = 0
      lastPointer = null
      previousFrame = performance.now()
    }

    root.dataset.renderer = 'webgl'
    root.dataset.solver = 'stable-fluids'
    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    window.addEventListener('blur', releasePointer)
    document.documentElement.addEventListener('pointerleave', releasePointer)
    reducedMotion.addEventListener('change', handleMotionPreference)
    window.addEventListener('resize', resize, { passive: true })
    resize()
    frame = window.requestAnimationFrame(render)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('blur', releasePointer)
      document.documentElement.removeEventListener('pointerleave', releasePointer)
      reducedMotion.removeEventListener('change', handleMotionPreference)
      window.removeEventListener('resize', resize)
      deleteSimulationTargets()
      gl.deleteVertexArray(vao)
      Object.values(fluidPrograms).forEach(program => gl.deleteProgram(program))
    }
  }, [])

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      data-effect-name="呼吸气团"
      data-state={state}
      data-renderer="fallback"
      className="pmo-breathing-air-mass"
    >
      <canvas
        ref={canvasRef}
        className="pmo-breathing-air-mass__canvas"
        style={{ filter: 'blur(12px) saturate(1.04)' }}
      />
    </div>
  )
}
