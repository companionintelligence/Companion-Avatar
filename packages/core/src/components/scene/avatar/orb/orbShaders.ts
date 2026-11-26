/**
 * GLSL for the orb (OrbAvatar). Four parts, all drawn with premultiplied "over" blending, so the light adds to a dark
 * backdrop and the body still reads as a green ball on the light theme:
 *
 * - the ball: a ray through a unit sphere in object space. A translucent shell that brightens toward its edge, a hot
 *   core that swells and whitens with the voice, and filaments: ridged gradient noise over direction from the centre,
 *   sampled at three depths, so they read as tendrils reaching out from the core;
 * - the halo: a camera-facing quad with a soft radial glow;
 * - the rings: one camera-facing quad that draws up to six expanding speech rings;
 * - the motes: points orbiting the ball on tilted axes.
 *
 * The noise is written here rather than copied: a sin hash, unit gradients and a quintic fade.
 */

/** Ridged-noise building blocks shared by the ball's fragment shader. */
const NOISE = /* glsl */ `
float orbHash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}

vec3 orbGradient(vec3 cell) {
  vec3 g = vec3(orbHash(cell), orbHash(cell + vec3(17.0, 59.4, 15.0)), orbHash(cell + vec3(-41.0, 23.2, 87.6)));
  return normalize(g * 2.0 - 1.0 + 1e-4);
}

// Gradient noise, roughly -1..1.
float orbNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = dot(orbGradient(i), f);
  float n100 = dot(orbGradient(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));
  float n010 = dot(orbGradient(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));
  float n110 = dot(orbGradient(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));
  float n001 = dot(orbGradient(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));
  float n101 = dot(orbGradient(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));
  float n011 = dot(orbGradient(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));
  float n111 = dot(orbGradient(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));
  return 1.4 * mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z
  );
}

vec3 orbTwist(vec3 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}
`

/** Output chunks: tone mapping and the output colour space, which three resolves per render target. */
const OUTPUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`

export const ORB_CORE_VERTEX = /* glsl */ `
varying vec3 vObject;
varying vec3 vCamera;

void main() {
  vObject = position;
  // The camera in the ball's own space, so the fragment shader can trace a ray through a unit sphere. Per vertex, not
  // per frame in JS: in XR three sets cameraPosition for each eye.
  vCamera = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const ORB_CORE_FRAGMENT = /* glsl */ `
uniform float uFlow;
uniform float uChurn;
uniform float uGlow;
uniform float uVoice;
uniform float uSparkle;
uniform float uOpacity;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uBright;
uniform vec3 uHot;

varying vec3 vObject;
varying vec3 vCamera;

${NOISE}

void main() {
  // The ball is drawn on its back faces, so it still draws with the camera inside it (an XR visitor can walk into it).
  vec3 ro = vCamera;
  vec3 rd = normalize(vObject - vCamera);
  float b = dot(ro, rd);
  float c = dot(ro, ro) - 1.0;
  float disc = b * b - c;
  if (disc <= 0.0) discard;
  float root = sqrt(disc);
  float tNear = max(-b - root, 0.0);
  float tFar = -b + root;
  if (tFar <= 0.0) discard;

  // How near the ray passes to the centre: 0 through the middle, 1 grazing the edge.
  float edge = sqrt(clamp(dot(ro, ro) - b * b, 0.0, 1.0));

  // The shell: translucent deep green in the middle, brighter toward the edge, like light caught in glass.
  float fresnel = edge * edge * edge;
  vec3 shell = mix(uDeep * 0.55, uMid * 1.1, fresnel) + uBright * pow(edge, 10.0) * 0.6;
  float shellAlpha = 0.3 + 0.5 * fresnel;

  // The core: a hot point at the centre that swells and whitens with the voice.
  float coreSize = 0.24 + 0.08 * uVoice;
  float core = exp(-(edge * edge) / (coreSize * coreSize));
  vec3 coreLight = mix(uBright, uHot, 0.45 + 0.3 * uVoice) * core * (0.5 + 0.9 * uVoice);

  // Filaments: ridged noise over direction from the centre, so each ridge is a sheet through the middle and reads as a
  // tendril reaching out from the core. Sampled at three depths along the ray, so they sit inside the ball.
  float filaments = 0.0;
  for (int i = 0; i < 3; i++) {
    float s = (float(i) + 0.5) / 3.0;
    vec3 p = ro + rd * mix(tNear, tFar, s);
    float r = length(p);
    vec3 dir = orbTwist(p / max(r, 1e-3), uFlow * 0.3);
    vec3 q = dir * 2.3 + vec3(0.0, r * 0.9 - uFlow * 0.45, r * 0.5);
    q += 0.35 * orbNoise(q * 0.8 + vec3(uFlow * 0.17, -uFlow * 0.11, 0.0));
    float n = orbNoise(q);
    float ridge = clamp(1.0 - abs(n), 0.0, 1.0);
    float line = pow(ridge, 14.0) + 0.18 * pow(ridge, 4.0);
    filaments += line * smoothstep(1.0, 0.2, r);
  }
  filaments /= 3.0;
  vec3 filamentLight = mix(uBright, uHot, 0.25 + 0.4 * uSparkle) * filaments * (0.9 + 1.6 * uChurn);

  vec3 colour = (shell + coreLight + filamentLight) * uGlow;
  float alpha = clamp(shellAlpha + 0.6 * core + 0.4 * filaments, 0.0, 1.0);

  gl_FragColor = vec4(colour * uOpacity, alpha * uOpacity);
  ${OUTPUT}
}
`

/** A camera-facing quad: the plane is drawn in view space, sized by the object's world scale. */
export const ORB_BILLBOARD_VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  vec4 centre = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  centre.xy += position.xy * length(modelMatrix[0].xyz);
  gl_Position = projectionMatrix * centre;
}
`

export const ORB_HALO_FRAGMENT = /* glsl */ `
uniform float uGlow;
uniform float uOpacity;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uBright;

varying vec2 vUv;

void main() {
  float d = length(vUv - 0.5) * 2.0;
  if (d >= 1.0) discard;
  float inner = exp(-d * d * 9.0);
  float outer = exp(-d * d * 3.0) * (1.0 - d);
  vec3 colour = (uBright * inner * 0.7 + uMid * outer * 0.45 + uDeep * outer * 0.25) * uGlow;
  float alpha = (inner * 0.3 + outer * 0.1) * min(uGlow, 1.5);
  gl_FragColor = vec4(colour * uOpacity, alpha * uOpacity);
  ${OUTPUT}
}
`

/** Matches ORB_MAX_RINGS in orbMotion.ts; the ring uniform array is this long. */
export const ORB_RING_SLOTS = 6

export const ORB_RINGS_FRAGMENT = /* glsl */ `
uniform vec2 uRings[${ORB_RING_SLOTS}];
uniform float uOpacity;
uniform vec3 uBright;
uniform vec3 uHot;

varying vec2 vUv;

void main() {
  float d = length(vUv - 0.5) * 2.0;
  if (d >= 1.0) discard;
  float light = 0.0;
  for (int i = 0; i < ${ORB_RING_SLOTS}; i++) {
    vec2 ring = uRings[i];
    if (ring.y <= 0.0) continue;
    float age = ring.x;
    // Leaves the ball's edge fast and slows as it spreads; thins and fades as it goes.
    float left = clamp(1.0 - age, 0.0, 1.0);
    float radius = mix(0.33, 0.97, 1.0 - pow(left, 2.2));
    float width = mix(0.035, 0.01, age);
    float x = (d - radius) / width;
    light += 0.6 * exp(-x * x) * pow(left, 1.5) * ring.y;
  }
  vec3 colour = mix(uBright, uHot, 0.2) * light;
  gl_FragColor = vec4(colour * uOpacity, clamp(light * 0.25, 0.0, 1.0) * uOpacity);
  ${OUTPUT}
}
`

export const ORB_MOTES_VERTEX = /* glsl */ `
attribute vec4 aSeed; // x: phase, y: speed, z: radius, w: tilt; all 0..1

uniform float uOrbit;
uniform float uFlow;
uniform float uVoice;
uniform float uPointScale;

varying float vLight;

vec3 orbSpin(vec3 v, vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

void main() {
  float tilt = aSeed.w * 6.2831853;
  vec3 axis = normalize(vec3(sin(tilt) * 0.6, 1.0, cos(tilt) * 0.6));
  vec3 p = orbSpin(normalize(position), axis, uOrbit * (0.35 + aSeed.y) + aSeed.x * 6.2831853);
  float r = mix(1.2, 2.2, aSeed.z) * (1.0 + 0.1 * sin(uFlow * 2.0 + aSeed.x * 31.0) + 0.3 * uVoice);
  vec4 view = modelViewMatrix * vec4(p * r, 1.0);
  gl_Position = projectionMatrix * view;
  float twinkle = 0.5 + 0.5 * sin(uFlow * (3.0 + 4.0 * aSeed.y) + aSeed.x * 47.0);
  vLight = twinkle * (1.0 - smoothstep(1.6, 2.4, r));
  float worldSize = length(modelMatrix[0].xyz) * (0.05 + 0.05 * aSeed.z);
  gl_PointSize = max(1.0, worldSize * uPointScale / -view.z);
}
`

export const ORB_MOTES_FRAGMENT = /* glsl */ `
uniform float uGlow;
uniform float uSparkle;
uniform float uOpacity;
uniform vec3 uBright;
uniform vec3 uHot;

varying float vLight;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d >= 1.0) discard;
  float a = (1.0 - d) * (1.0 - d) * vLight;
  vec3 colour = mix(uBright, uHot, 0.3 + 0.5 * uSparkle) * a * (0.6 + 0.6 * uGlow);
  gl_FragColor = vec4(colour * uOpacity, a * 0.3 * uOpacity);
  ${OUTPUT}
}
`
