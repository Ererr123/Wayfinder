// Grass — Simon Dev instanced-blade technique (github.com/simondevyoutube/Quick_Grass)
// InstancedBufferGeometry: 'vertIndex' cycles per-vertex, 'aOffset' advances per-blade.
// All blade geometry is computed in the vertex shader.
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const GRASS_SEGMENTS = 6;
const GRASS_VERTICES = (GRASS_SEGMENTS + 1) * 2;   // 14
const NUM_GRASS      = 4500000;
const FIELD_RADIUS   = 160;
const GRASS_WIDTH    = 0.10;
const GRASS_HEIGHT   = 0.30;

// ─────────────────────────────────────────────────────────────────────────────
const VERT = /* glsl */`
  attribute float vertIndex;
  attribute vec2  aOffset;

  uniform float uTime;
  uniform float uSegs;
  uniform float uVerts;
  uniform vec2  uBlade;

  varying vec3  vCol;
  varying float vH;

  // ── helpers ────────────────────────────────────────────────────────────────

  float hash1(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  vec2 hash2(vec2 p) {
    return vec2(hash1(p), hash1(p + vec2(57.0, 31.0)));
  }
  vec4 hash4(vec2 p) {
    return vec4(
      hash1(p),
      hash1(p + vec2(1.0,  0.0)),
      hash1(p + vec2(0.0,  1.0)),
      hash1(p + vec2(1.0,  1.0))
    );
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash1(i),           hash1(i + vec2(1,0)), u.x),
      mix(hash1(i + vec2(0,1)), hash1(i + vec2(1,1)), u.x),
      u.y
    ) * 2.0 - 1.0;
  }

  float easeIn(float x, float t)  { return pow(x, t); }
  float easeOut(float x, float t) { return 1.0 - pow(1.0 - x, t); }
  float remap(float v, float a, float b, float c, float d) {
    return mix(c, d, clamp((v - a) / (b - a), 0.0, 1.0));
  }

  mat3 rotX(float t) {
    float c = cos(t), s = sin(t);
    return mat3(1,0,0, 0,c,s, 0,-s,c);
  }
  mat3 rotY(float t) {
    float c = cos(t), s = sin(t);
    return mat3(c,0,-s, 0,1,0, s,0,c);
  }
  mat3 rotAxis(vec3 ax, float t) {
    ax = normalize(ax);
    float c = cos(t), s = sin(t), oc = 1.0 - c;
    return mat3(
      oc*ax.x*ax.x+c,       oc*ax.x*ax.y-ax.z*s,  oc*ax.z*ax.x+ax.y*s,
      oc*ax.x*ax.y+ax.z*s,  oc*ax.y*ax.y+c,        oc*ax.y*ax.z-ax.x*s,
      oc*ax.z*ax.x-ax.y*s,  oc*ax.y*ax.z+ax.x*s,  oc*ax.z*ax.z+c
    );
  }

  // ── main ───────────────────────────────────────────────────────────────────

  void main() {
    // Blade world XZ (Simon Dev: position.x = worldX, position.y = worldZ)
    vec2 bxz = aOffset;

    // Per-blade randoms
    vec4 h4 = hash4(bxz);
    vec2 h2 = hash2(bxz + vec2(13.7, 47.3));

    float rAngle  = h4.x * 6.28318;
    float rHeight = remap(h4.y, 0.0, 1.0, 0.75, 1.50);
    float rLean   = remap(h4.z, 0.0, 1.0, 0.10, 0.40);
    float rShade  = remap(h4.w, 0.0, 1.0, 0.70, 1.00);

    // Lean animation
    float leanAnim = noise(vec2(uTime * 0.35) + bxz * 0.137) * 0.1;

    // Which vertex of the blade (Simon Dev logic)
    float vertID   = mod(vertIndex, uVerts);
    float xSide    = mod(vertID, 2.0);
    float heightPct = (vertID - xSide) / (uSegs * 2.0);  // 0=base 1=tip

    float totalH = uBlade.y * rHeight;
    float totalW = uBlade.x * easeOut(1.0 - heightPct, 2.0);

    float x = (xSide - 0.5) * totalW;
    float y = heightPct * totalH;

    // Wind — two-layer noise (Simon Dev)
    float windDir    = noise(bxz * 0.05 + vec2(0.05 * uTime));
    float windSample = noise(bxz * 0.25 + vec2(uTime));
    float windAngle  = remap(windSample, -1.0, 1.0, 0.25, 1.0);
    windAngle        = easeIn(windAngle, 2.0) * 1.25 * heightPct;
    vec3 windAxis    = vec3(cos(windDir), 0.0, sin(windDir));

    // Curvature
    rLean += leanAnim;
    float curve = -rLean * easeIn(heightPct, 2.0);

    // Build vertex
    mat3 grassMat = rotAxis(windAxis, windAngle) * rotY(rAngle);
    vec3 vtx = vec3(x, y, 0.0);
    vtx = rotX(curve) * vtx;
    vtx = grassMat * vtx;
    vtx.x += bxz.x;
    vtx.y -= 0.5;          // ground at y = -0.5
    vtx.z += bxz.y;

    // Night colour gradient (dark root → dark-green tip)
    vec3 baseCol = mix(vec3(0.010,0.028,0.006), vec3(0.014,0.038,0.008), h2.x);
    vec3 tipCol  = mix(vec3(0.025,0.075,0.013), vec3(0.033,0.092,0.017), h2.y);
    vCol = mix(baseCol, tipCol, easeIn(heightPct, 4.0)) * rShade;
    vH   = heightPct;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(vtx, 1.0);
  }
`;

const FRAG = /* glsl */`
  varying vec3  vCol;
  varying float vH;
  void main() {
    float ao = 0.15 + vH * 0.85;
    gl_FragColor = vec4(vCol * ao, 1.0);
  }
`;

export function createGrassField(scene) {
  // vertIndex: per-vertex, cycles 0..GRASS_VERTICES*2-1
  const vertIdx = new Float32Array(GRASS_VERTICES * 2);
  for (let i = 0; i < GRASS_VERTICES * 2; i++) vertIdx[i] = i;

  // Index buffer — Simon Dev's exact #CreateGeometry_ logic
  const indices = [];
  for (let i = 0; i < GRASS_SEGMENTS; ++i) {
    const vi = i * 2;
    indices.push(vi,    vi+1,  vi+2);
    indices.push(vi+2,  vi+1,  vi+3);
    const fi = GRASS_VERTICES + vi;
    indices.push(fi+2,  fi+1,  fi);
    indices.push(fi+3,  fi+1,  fi+2);
  }

  // Per-instance XZ blade positions
  const offsets = new Float32Array(NUM_GRASS * 2);
  for (let i = 0; i < NUM_GRASS; i++) {
    const r = Math.sqrt(Math.random()) * FIELD_RADIUS;
    const a = Math.random() * Math.PI * 2;
    offsets[i*2]   = Math.cos(a) * r;
    offsets[i*2+1] = Math.sin(a) * r;
  }

  const geo = new THREE.InstancedBufferGeometry();
  geo.instanceCount = NUM_GRASS;
  geo.setAttribute('vertIndex', new THREE.BufferAttribute(vertIdx, 1));
  geo.setAttribute('aOffset',   new THREE.InstancedBufferAttribute(offsets, 2));
  geo.setAttribute('position',  new THREE.BufferAttribute(
    new Float32Array(GRASS_VERTICES * 2 * 3), 3));
  geo.setIndex(indices);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), FIELD_RADIUS + 2);

  const mat = new THREE.ShaderMaterial({
    vertexShader:   VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
    uniforms: {
      uTime:  { value: 0 },
      uSegs:  { value: GRASS_SEGMENTS },
      uVerts: { value: GRASS_VERTICES },
      uBlade: { value: new THREE.Vector2(GRASS_WIDTH, GRASS_HEIGHT) },
    },
  });

  scene.add(new THREE.Mesh(geo, mat));
  return mat;
}
