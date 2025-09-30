import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

/* ===========================
   TUNABLES
   =========================== */
const PIXEL_RATIO = 1;
const STAR_count = 300;
const STAR_COUNT = STAR_count; // keep old name
const SPHERE_W = 64;
const SPHERE_H = 48;

const RIPPLE_CANVAS = 128;
const CAUSTIC_CANVAS = 512;

const PHYSICS_TICK = 2;

/* ===========================
   Minimal 3D simplex noise
   =========================== */
const noise = (function () {
  function Grad(x, y, z) { this.x = x; this.y = y; this.z = z; }
  Grad.prototype.dot3 = function (x, y, z) { return this.x * x + this.y * y + this.z * z; };
  const grad3 = [
    new Grad(1,1,0), new Grad(-1,1,0), new Grad(1,-1,0), new Grad(-1,-1,0),
    new Grad(1,0,1), new Grad(-1,0,1), new Grad(1,0,-1), new Grad(-1,0,-1),
    new Grad(0,1,1), new Grad(0,-1,1), new Grad(0,1,-1), new Grad(0,-1,-1)
  ];
  const p = [151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180];
  const perm = new Array(512), gradP = new Array(512);
  (function init(seed = 0) {
    if (seed > 0 && seed < 1) seed *= 65536;
    seed = Math.floor(seed);
    if (seed < 256) seed |= seed << 8;
    for (let i = 0; i < 256; i++) {
      const v = (i & 1) ? (p[i] ^ (seed & 255)) : (p[i] ^ ((seed >> 8) & 255));
      perm[i] = perm[i + 256] = v;
      gradP[i] = gradP[i + 256] = grad3[v % 12];
    }
  })();
  const F3 = 1/3, G3 = 1/6;
  function simplex3(xin, yin, zin) {
    let n0, n1, n2, n3;
    const s = (xin + yin + zin) * F3;
    let i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - i + t, y0 = yin - j + t, z0 = zin - k + t;
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    i &= 255; j &= 255; k &= 255;
    const gi0 = gradP[i + perm[j + perm[k]]];
    const gi1 = gradP[i + i1 + perm[j + j1 + perm[k + k1]]];
    const gi2 = gradP[i + i2 + perm[j + j2 + perm[k + k2]]];
    const gi3 = gradP[i + 1 + perm[j + 1 + perm[k + 1]]];
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 < 0) n0 = 0; else { t0 *= t0; n0 = t0 * t0 * gi0.dot3(x0, y0, z0); }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 < 0) n1 = 0; else { t1 *= t1; n1 = t1 * t1 * gi1.dot3(x1, y1, z1); }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 < 0) n2 = 0; else { t2 *= t2; n2 = t2 * t2 * gi2.dot3(x2, y2, z2); }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 < 0) n3 = 0; else { t3 *= t3; n3 = t3 * t3 * gi3.dot3(x3, y3, z3); }
    return 32 * (n0 + n1 + n2 + n3);
  }
  return { simplex3 };
})();

/* ===========================
   Pointer ripples
   =========================== */
const ripples = [];
const MAX_RIPPLES = 6;
const RIPPLE_LIFETIME = 2;
const RIPPLE_SPEED = 3.6;
const RIPPLE_RADIUS = 1.0;
const RIPPLE_WAVELENGTH = 1;

function addRipple(localPos, strength = 0.9) {
  if (!localPos) return;
  const time = performance.now() * 0.001;
  const worldPos = ocean ? ocean.localToWorld(localPos.clone()) : localPos.clone();
  ripples.push({ pos: localPos.clone(), worldPos, time, strength, speed: RIPPLE_SPEED, radius: RIPPLE_RADIUS, wavelength: RIPPLE_WAVELENGTH });
  if (ripples.length > MAX_RIPPLES) ripples.shift();
}
function cleanupRipples() {
  const t = performance.now() * 0.001;
  for (let i = ripples.length - 1; i >= 0; i--) if (t - ripples[i].time > RIPPLE_LIFETIME) ripples.splice(i, 1);
}

/* ===========================
   Waves params
   =========================== */
const WAVE_PARAMS = [];
(function initWaves() {
  const seeds = [0.12, 0.76, 0.42];
  for (let s = 0; s < seeds.length; s++) {
    const a = (s * 1.234 + 0.31) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a + s * 0.6), 0.06 * (s - 1), Math.sin(a + s * 0.4)).normalize();
    const amp = 0.24 + 0.08 * (Math.random());
    const wavelength = 6.0 + s * 1.2 + Math.random() * 2.2;
    const speed = 0.6 + s * 0.14 + Math.random() * 0.5;
    const phase = Math.random() * Math.PI * 2;
    WAVE_PARAMS.push({ dir, amp, wavelength, speed, phase });
  }
})();

/* MeshWarper class (unchanged) */
class MeshWarper {
  static warpMesh(mesh, opts = {}) {
    if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return;
    const time = performance.now() * 0.001;
    if (!mesh.warpGeometry) mesh.warpGeometry = mesh.geometry.clone();

    const posAttr = mesh.geometry.attributes.position;
    const pos = posAttr.array;
    const orig = mesh.warpGeometry.attributes.position.array;
    const nrm = mesh.warpGeometry.attributes.normal.array;

    const noiseAmp = opts.noiseAmp ?? 0.06;
    const noiseScale = opts.noiseScale ?? 0.6;
    const mix = opts.mix ?? 0.92;
    const maxDisp = opts.maxDisp ?? 1.0;

    const dirRotateSpeed = 0.03;
    const rotatedDirs = WAVE_PARAMS.map((w, idx) => {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dirRotateSpeed * time * (0.6 + idx * 0.2));
      return w.dir.clone().applyQuaternion(q).normalize();
    });

    for (let i = 0; i < pos.length; i += 3) {
      const vx = orig[i], vy = orig[i + 1], vz = orig[i + 2];

      let waveSum = 0;
      for (let w = 0; w < WAVE_PARAMS.length; w++) {
        const wp = WAVE_PARAMS[w];
        const dir = rotatedDirs[w];
        const spatial = (vx * dir.x + vy * dir.y + vz * dir.z);
        const k = (2 * Math.PI) / wp.wavelength;
        const phase = spatial * k - wp.speed * time + wp.phase;
        const latAtten = 1.0 - 0.22 * Math.abs(vy) / (Math.abs(vy) + 0.001);
        waveSum += Math.sin(phase) * wp.amp * latAtten;
      }

      const n = noise.simplex3(vx * noiseScale + time * 0.05, vy * noiseScale + time * 0.03, vz * noiseScale) * noiseAmp;

      let rippleSum = 0;
      for (let r = 0; r < ripples.length; r++) {
        const rp = ripples[r];
        const age = time - rp.time;
        if (age < 0 || age > RIPPLE_LIFETIME) continue;
        const dx = vx - rp.pos.x, dy = vy - rp.pos.y, dz = vz - rp.pos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const propagation = rp.speed * age;
        const diff = dist - propagation;
        const sigma = rp.radius * 1.15;
        const envelope = Math.exp(-(diff * diff) / (2 * sigma * sigma));
        const phase = Math.cos((diff / rp.wavelength) * Math.PI * 2);
        const ageAtten = Math.exp(-age * 2.6);
        rippleSum += rp.strength * envelope * phase * ageAtten * 0.75;
      }

      const raw = waveSum + n + rippleSum;
      const bounded = Math.tanh(raw * 1.0) * Math.min(maxDisp, 1.0);

      const dx = orig[i] + nrm[i] * bounded;
      const dy = orig[i + 1] + nrm[i + 1] * bounded;
      const dz = orig[i + 2] + nrm[i + 2] * bounded;

      pos[i]     = THREE.MathUtils.lerp(orig[i], dx, mix);
      pos[i + 1] = THREE.MathUtils.lerp(orig[i + 1], dy, mix);
      pos[i + 2] = THREE.MathUtils.lerp(orig[i + 2], dz, mix);
    }

    posAttr.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    cleanupRipples();
  }
}

/* Ripple canvas + caustics (unchanged) */
const rippleCanvas = document.createElement('canvas');
rippleCanvas.width = rippleCanvas.height = RIPPLE_CANVAS;
const rippleCtx = rippleCanvas.getContext('2d');
const rippleTex = new THREE.CanvasTexture(rippleCanvas);
rippleTex.wrapS = rippleTex.wrapT = THREE.RepeatWrapping;
rippleTex.encoding = THREE.LinearEncoding;

function updateRippleNormal(time, scale = 1.9, octaves = 2) {
  const w = rippleCanvas.width, h = rippleCanvas.height;
  const img = rippleCtx.createImageData(w, h);
  const data = img.data;
  const heights = new Float32Array(w * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const ny = (y / h) * 2 - 1;
    for (let x = 0; x < w; x++) {
      const nx = (x / w) * 2 - 1;
      let v = 0, amp = 1, freq = 1;
      for (let o = 0; o < octaves; o++) {
        v += amp * noise.simplex3(nx * scale * freq + time * (0.45 + o * 0.02), ny * scale * freq + time * (0.25 + o * 0.01), o * 0.12);
        amp *= 0.5; freq *= 2.0;
      }
      heights[p++] = v * 0.45;
    }
  }
  p = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w, xp = (x + 1) % w, ym = (y - 1 + h) % h, yp = (y + 1) % h;
      const hL = heights[y * w + xm], hR = heights[y * w + xp];
      const hU = heights[ym * w + x], hD = heights[yp * w + x];
      const ddx = (hR - hL) * 0.5, ddy = (hD - hU) * 0.5;
      let nxv = -ddx, nyv = -ddy, nzv = 1.0;
      const len = Math.sqrt(nxv * nxv + nyv * nyv + nzv * nzv) || 1.0;
      nxv /= len; nyv /= len; nzv /= len;
      data[p++] = Math.floor((nxv * 0.5 + 0.5) * 255);
      data[p++] = Math.floor((nyv * 0.5 + 0.5) * 255);
      data[p++] = Math.floor((nzv * 0.5 + 0.5) * 255);
      data[p++] = 255;
    }
  }
  rippleCtx.putImageData(img, 0, 0);
  rippleTex.needsUpdate = true;
}

const caCanvas = document.createElement('canvas');
caCanvas.width = caCanvas.height = CAUSTIC_CANVAS;
const caCtx = caCanvas.getContext('2d');
const causticTex = new THREE.CanvasTexture(caCanvas);
causticTex.wrapS = causticTex.wrapT = THREE.RepeatWrapping;
causticTex.encoding = THREE.sRGBEncoding;

function updateCausticCanvas(time, intensity = 0.85) {
  const w = caCanvas.width, h = caCanvas.height;
  const img = caCtx.createImageData(w, h);
  const data = img.data;
  let k = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x / w - 0.5) * 2.0, ny = (y / h - 0.5) * 2.0;
      const v = noise.simplex3(nx * 1.6, ny * 1.4, time * 0.6) * 0.85 + noise.simplex3(nx * 3.8, ny * 3.2, time * 1.2) * 0.28;
      let b = Math.abs(v);
      b = Math.pow(b, 1.7);
      b = THREE.MathUtils.clamp((b - 0.12) * 1.8 * intensity, 0, 1);
      const c = Math.floor(255 * b);
      data[k++] = c; data[k++] = Math.floor(c * 0.95); data[k++] = Math.floor(c * 0.85); data[k++] = Math.floor(255 * b);
    }
  }
  caCtx.putImageData(img, 0, 0);
  causticTex.needsUpdate = true;
}

/* ===========================
   Scene, camera, renderer
   =========================== */
document.body.style.margin = '0';
document.body.style.background = '#000';

const canvasEl = document.querySelector('.webgl') || (() => { const c = document.createElement('canvas'); c.className = 'webgl'; document.body.appendChild(c); return c; })();
const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(PIXEL_RATIO);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.debug.checkShaderErrors = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000012);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 2.8, 12);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

/* lights */
const ambient = new THREE.AmbientLight(0xffffff, 0.28); scene.add(ambient);
const sun = new THREE.DirectionalLight(0xffffff, 1.0); sun.position.set(8, 7, 2); scene.add(sun);

/* stars */
function makeStars(n = STAR_COUNT) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = THREE.MathUtils.randFloat(90, 220);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
    pos[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
    pos[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * r;
    pos[i * 3 + 2] = Math.cos(phi) * r;
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ size: 0.45, color: 0xffffff, opacity: 0.9, transparent: true, depthWrite: false }));
}
scene.add(makeStars());

/* ----------------------------
   planet + welded ocean (fix seam)
   ---------------------------- */
const planetGroup = new THREE.Group(); scene.add(planetGroup);
const R = 4.0;

function smoothVertexNormals(geom, eps = 1e-4) {
  geom.computeVertexNormals();
  const pos = geom.attributes.position.array;
  const nor = geom.attributes.normal.array;
  const count = pos.length / 3;
  const map = new Map();
  for (let i = 0; i < count; i++) {
    const ix = pos[i * 3], iy = pos[i * 3 + 1], iz = pos[i * 3 + 2];
    const kx = Math.round(ix / eps);
    const ky = Math.round(iy / eps);
    const kz = Math.round(iz / eps);
    const key = `${kx}_${ky}_${kz}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(i);
  }
  const newNormals = new Float32Array(nor.length);
  for (const indices of map.values()) {
    let ax = 0, ay = 0, az = 0;
    for (const i of indices) {
      ax += nor[i * 3];
      ay += nor[i * 3 + 1];
      az += nor[i * 3 + 2];
    }
    const len = Math.hypot(ax, ay, az) || 1;
    ax /= len; ay /= len; az /= len;
    for (const i of indices) {
      newNormals[i * 3]     = ax;
      newNormals[i * 3 + 1] = ay;
      newNormals[i * 3 + 2] = az;
    }
  }
  geom.setAttribute('normal', new THREE.BufferAttribute(newNormals, 3));
  geom.attributes.normal.needsUpdate = true;
}

let oceanGeo = new THREE.SphereGeometry(R, SPHERE_W, SPHERE_H);
oceanGeo = BufferGeometryUtils.mergeVertices(oceanGeo, 1e-4);
oceanGeo.computeVertexNormals();
smoothVertexNormals(oceanGeo, 1e-4);
oceanGeo.setAttribute('origPosition', oceanGeo.attributes.position.clone());
oceanGeo.computeBoundingSphere();

/* ===========================
   Procedural sky -> environment map
   =========================== */
function makeProceduralEnv(renderer) {
  const w = 1024, h = 512;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#07102b');
  g.addColorStop(0.45, '#1e3a6b');
  g.addColorStop(1, '#8fc5ff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const sunX = Math.floor(w * 0.75);
  const sunY = Math.floor(h * 0.62);
  const rad = Math.min(w, h) * 0.06;
  const rg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, rad);
  rg.addColorStop(0, 'rgba(255,235,200,0.95)');
  rg.addColorStop(0.5, 'rgba(255,235,200,0.12)');
  rg.addColorStop(1, 'rgba(255,235,200,0.0)');
  ctx.fillStyle = rg;
  ctx.fillRect(sunX - rad, sunY - rad, rad * 2, rad * 2);

  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.encoding = THREE.sRGBEncoding;
  tex.mapping = THREE.EquirectangularReflectionMapping;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  return env;
}
const envMap = makeProceduralEnv(renderer);
scene.environment = envMap;

/* ===========================
   Fish - spherical orbits around origin (on sphere surface)
   - each fish gets a random orbit axis and a perpendicular start vector
   - fish rotate that start vector around axis => great-circle motion
   =========================== */

const FISH_GLB_URL = './assets/Fish_Placeholder.glb';
const fishEntities = []; // each: { parent, mixer, angle, orbitRadius, angularSpeed, bobAmp, phase, scale, orbitAxis, orbitStartVec }
const GLTF = new GLTFLoader();
try {
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/');
  GLTF.setDRACOLoader(draco);
} catch (e) {}

const REQUEST_ORBIT_RADIUS = 5; // desired radius
const FISH_CLEARANCE = 0.25;      // clearance above planet radius
const ORBIT_RADIUS = Math.max(REQUEST_ORBIT_RADIUS, R + FISH_CLEARANCE + 0.05); // ensure outside planet

function addOrbitFish(path, opts = {}) {
  const { name = 'Fish', scale = 0.8 } = opts;
  GLTF.load(path, (gltf) => {
    const fishScene = gltf.scene;
    fishScene.traverse(m => {
      if (m.isMesh) {
        if (m.material && m.material.clone) m.material = m.material.clone();
        m.frustumCulled = false;
      }
    });

    // parent that will be positioned on orbit circle (we will set parent.position)
    const parent = new THREE.Object3D();
    parent.name = `${name}_Parent`;
    scene.add(parent);

    // attach fish model to parent (model forward = -Z expected)
    fishScene.rotation.y = Math.PI / 2;
    fishScene.scale.setScalar(scale);
    parent.add(fishScene);

    // animation mixer
    const mixer = new THREE.AnimationMixer(fishScene);
    if (gltf.animations && gltf.animations.length) {
      for (const c of gltf.animations) mixer.clipAction(c).play();
    }

    // per-fish params
    const angle = Math.random() * Math.PI * 2;
    const jitterRadius = (Math.random() - 0.5) * 0.18;
    const orbitRadius = ORBIT_RADIUS + jitterRadius;
    const angularSpeed = THREE.MathUtils.randFloat(0.25, 1.2) / Math.max(0.0001, orbitRadius);
    const bobAmp = THREE.MathUtils.randFloat(0.06, 0.28);
    const phase = Math.random() * Math.PI * 2;
    const scaleLocal = scale;

    // orbit axis: random unit vector
    const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    // pick helper vec not parallel to axis
    let helper = new THREE.Vector3(1, 0, 0);
    if (Math.abs(axis.dot(helper)) > 0.9) helper.set(0, 1, 0);
    // start vector perpendicular to axis
    const startVec = new THREE.Vector3().crossVectors(axis, helper).normalize(); // now perpendicular to axis
    if (startVec.lengthSq() < 1e-6) {
      // fallback
      startVec.set(0, 0, -1);
    }

    fishEntities.push({
      parent,
      mixer,
      angle,
      orbitRadius,
      angularSpeed,
      bobAmp,
      phase,
      scale: scaleLocal,
      orbitAxis: axis,
      orbitStartVec: startVec
    });
  }, undefined, (err) => {
    console.error('Fish load failed:', err);
  });
}

// add some fish
addOrbitFish(FISH_GLB_URL, { name: 'BlueFish', scale: 0.8 });
addOrbitFish(FISH_GLB_URL, { name: 'Goldfish', scale: 0.6 });
addOrbitFish(FISH_GLB_URL, { name: 'BabyShark', scale: 1.1 });
addOrbitFish(FISH_GLB_URL, { name: 'TwinFish', scale: 0.7 });
addOrbitFish(FISH_GLB_URL, { name: 'Solo', scale: 0.9 });

/* update orbiting fish each frame */
const _tmpQuat = new THREE.Quaternion();
const _tmpVec = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

function updateOrbitingFish(delta) {
  if (fishEntities.length === 0) return;
  const now = performance.now() * 0.001;

  // tuning: limits and smoothness for pitch
  const MAX_PITCH = 0.45; // radians (~25.8°) maximum nose-up/down
  const ORIENTATION_SMOOTH = 0.08; // slerp factor for overall heading
  const PITCH_BLEND = 0.5; // how much of the vertical tangent influences pitch (0..1)

  for (let i = 0; i < fishEntities.length; i++) {
    const f = fishEntities[i];

    // slight schooling nudges (keeps them not perfectly independent)
    if (fishEntities.length > 1 && Math.random() < 0.25) {
      let avgAngle = 0, cnt = 0;
      for (const g of fishEntities) { if (g !== f) { avgAngle += g.angle; cnt++; } }
      if (cnt > 0) f.angle += (avgAngle / cnt - f.angle) * 0.002;
    }

    // advance angle (rotation about the orbit axis)
    f.angle += f.angularSpeed * delta;

    // rotate startVec around orbitAxis by angle -> unit position vector on sphere (before scaling)
    const q = new THREE.Quaternion().setFromAxisAngle(f.orbitAxis, f.angle);
    const posOnSphere = f.orbitStartVec.clone().applyQuaternion(q).normalize(); // unit direction from origin

    // radial jitter / bobbing along the radial normal (makes fish "float" slightly off the surface)
    const radialBob = Math.sin(now * 1.6 + f.phase) * f.bobAmp;

    // final world position = radial direction * (orbitRadius + radialBob)
    const worldPos = posOnSphere.clone().multiplyScalar(f.orbitRadius + radialBob);
    f.parent.position.copy(worldPos);

    // compute tangent vector (direction of motion) = cross(axis, posOnSphere) (gives direction along great circle)
    // include a small vertical component due to bobbing derivative
    const tangent = new THREE.Vector3().crossVectors(f.orbitAxis, posOnSphere).normalize();

    // incorporate vertical derivative (approx): derivative of radialBob: vy = cos(...) * amplitude * freq
    const vy = Math.cos(now * 1.6 + f.phase) * f.bobAmp * 1.6; // match earlier formula frequency (1.6)
    // incorporate vy into tangent so forward has vertical component
    tangent.y += vy * 0.25; // small influence so tangent isn't dominated by vertical bob
    tangent.normalize();

    // Keep fish upright: compute a horizontal-facing quaternion (zero pitch) first
    const flatTangent = tangent.clone();
    flatTangent.y = 0;
    if (flatTangent.lengthSq() < 1e-6) {
      // pick a horizontal direction perpendicular to posOnSphere
      flatTangent.set(-posOnSphere.z, 0, posOnSphere.x).normalize();
      if (flatTangent.lengthSq() < 1e-6) flatTangent.set(0, 0, -1);
    } else {
      flatTangent.normalize();
    }

    // quaternion that faces flatTangent (model forward is -Z)
    const faceQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), flatTangent);

    // compute desired pitch from the true tangent's vertical component:
    // pitch = atan2(forward.y, horizontal_length)
    const horizLen = Math.sqrt(Math.max(0, tangent.x * tangent.x + tangent.z * tangent.z));
    let pitchTarget = Math.atan2(PITCH_BLEND * tangent.y, horizLen || 1e-6);
    // clamp
    pitchTarget = THREE.MathUtils.clamp(pitchTarget, -MAX_PITCH, MAX_PITCH);

    // build pitch quaternion around the fish's local right axis
    // local right in world coords = (1,0,0) rotated by faceQuat
    const rightWorld = new THREE.Vector3(1, 0, 0).applyQuaternion(faceQuat).normalize();
    const pitchQuat = new THREE.Quaternion().setFromAxisAngle(rightWorld, pitchTarget);

    // final target orientation = apply pitch after facing (so pitchQuat * faceQuat)
    const targetQuat = new THREE.Quaternion().copy(pitchQuat).multiply(faceQuat);

    // smoothly slerp to target to avoid popping
    f.parent.quaternion.slerp(targetQuat, ORIENTATION_SMOOTH);

    // tiny banking if you want (kept minimal to preserve "upright" look)
    // const bank = f.angularSpeed * 0.15;
    // const bankQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), bank * Math.sin(now * 2.0 + f.phase));
    // f.parent.quaternion.multiply(bankQuat);

    // update mixer
    if (f.mixer) f.mixer.update(delta);
  }
}

/* ===========================
   Water material & rest of scene (unchanged)
   =========================== */
const waterMat = new THREE.MeshPhysicalMaterial({
  color: new THREE.Color(0x0b5f97),
  roughness: 0.06,
  metalness: 0.0,
  clearcoat: 0.95,
  clearcoatRoughness: 0.02,
  reflectivity: 0.9,
  envMap: envMap,
  envMapIntensity: 1.25,
  transmission: 0.14,
  thickness: 0.8,
  ior: 1.33,
  side: THREE.FrontSide,
  normalMap: rippleTex,
  normalScale: new THREE.Vector2(0.6, 0.6),
  sheen: 0.22,
  sheenRoughness: 0.25
});
waterMat.needsUpdate = true;

const ocean = new THREE.Mesh(oceanGeo, waterMat);
planetGroup.add(ocean);

/* caustic projector */
const projectorCam = new THREE.OrthographicCamera(-6, 6, 6, -6, 0.1, 40);
projectorCam.position.copy(sun.position);
projectorCam.lookAt(new THREE.Vector3(0, 0, 0));
projectorCam.updateMatrixWorld(); projectorCam.updateProjectionMatrix();

const causticUniforms = {
  caTex: { value: causticTex },
  projectorMatrix: { value: new THREE.Matrix4() },
  sunPos: { value: sun.position.clone() },
  intensity: { value: 1.0 },
  opacity: { value: 0.9 }
};

const causticMaterial = new THREE.ShaderMaterial({
  uniforms: causticUniforms,
  vertexShader: `
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    void main() {
      vNormal = normalMatrix * normal;
      vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    uniform sampler2D caTex;
    uniform mat4 projectorMatrix;
    uniform vec3 sunPos;
    uniform float intensity;
    uniform float opacity;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    void main() {
      vec4 proj = projectorMatrix * vec4(vWorldPos, 1.0);
      vec3 uvw = proj.xyz / proj.w;
      vec2 uv = uvw.xy * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
      vec4 causticSample = texture2D(caTex, uv);
      vec3 L = normalize(sunPos - vWorldPos);
      float ndotl = clamp(dot(normalize(vNormal), L), 0.0, 1.0);
      float mask = pow(ndotl, 1.6);
      float alpha = causticSample.a * mask * opacity * intensity;
      gl_FragColor = vec4(causticSample.rgb * mask * intensity, alpha);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});

const causticSphere = new THREE.Mesh(new THREE.SphereGeometry(R * 1.0015, SPHERE_W, SPHERE_H), causticMaterial);
causticSphere.renderOrder = 3; planetGroup.add(causticSphere);

/* pointer handlers */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let isPointerDown = false, lastPointerWorld = null, lastPointerTime = 0;
let lastHoverWorld = null;
let lastHoverTime = 0;
const HOVER_MIN_DT = 0.06;
const HOVER_MIN_MOVE = 0.15;
const HOVER_STRENGTH_SCALE = 0.012;
const HOVER_MAX_STRENGTH = 0.8;

function getPointerIntersection(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(ocean, false);
  return (hits && hits.length) ? hits[0] : null;
}

function onPointerDown(e) {
  isPointerDown = true;
  const inter = getPointerIntersection(e.clientX, e.clientY);
  if (inter) {
    const local = ocean.worldToLocal(inter.point.clone());
    addRipple(local, 1.0);
    lastPointerWorld = inter.point.clone(); lastPointerTime = performance.now() * 0.001;
    lastHoverWorld = null; lastHoverTime = 0;
  }
}

function onPointerMove(e) {
  const now = performance.now() * 0.001;
  const inter = getPointerIntersection(e.clientX, e.clientY);

  if (isPointerDown) {
    if (inter) {
      if (lastPointerWorld) {
        const dx = inter.point.clone().sub(lastPointerWorld);
        const dt = Math.max(0.001, now - lastPointerTime);
        const speed = dx.length() / dt;
        const strength = THREE.MathUtils.clamp(speed * 0.12, 0.05, 1.6);
        if (speed > 0.12) {
          const local = ocean.worldToLocal(inter.point.clone());
          addRipple(local, strength);
        }
      }
      lastPointerWorld = inter.point.clone(); lastPointerTime = now;
    } else {
      lastPointerWorld = null; lastPointerTime = 0;
    }
    lastHoverWorld = null; lastHoverTime = 0;
    return;
  }

  if (inter) {
    if (lastHoverWorld) {
      const dx = inter.point.clone().sub(lastHoverWorld);
      const dt = Math.max(1e-4, now - lastHoverTime);
      if (dt >= HOVER_MIN_DT) {
        const speed = dx.length() / dt;
        if (speed > HOVER_MIN_MOVE) {
          const strength = THREE.MathUtils.clamp(speed * HOVER_STRENGTH_SCALE, 0.02, HOVER_MAX_STRENGTH);
          const local = ocean.worldToLocal(inter.point.clone());
          addRipple(local, strength);
          lastHoverTime = now;
          lastHoverWorld = inter.point.clone();
        } else {
          lastHoverWorld = inter.point.clone();
          lastHoverTime = now;
        }
      }
    } else {
      lastHoverWorld = inter.point.clone();
      lastHoverTime = now;
    }
  } else {
    lastHoverWorld = null;
    lastHoverTime = 0;
  }
}

function onPointerUp() {
  isPointerDown = false;
  lastPointerWorld = null;
  lastPointerTime = 0;
}

renderer.domElement.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);

/* initial procedural textures */
updateRippleNormal(performance.now() * 0.001, 1.9, 2);
updateCausticCanvas(performance.now() * 0.001, 1.0);

/* params */
const params = { waveMixAmp: 1.0, rotateSpeed: 0.012, causticIntensity: 1.0 };

/* ===========================
   Animation loop (calls updateOrbitingFish)
   =========================== */
let last = performance.now();
let frameCounter = 0;
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = (now - last) * 0.001;
  last = now;

  planetGroup.rotation.y += params.rotateSpeed * dt;

  if ((frameCounter % Math.max(1, PHYSICS_TICK)) === 0) updateRippleNormal(now * 0.001 * 0.6, 1.9, 2);
  if ((frameCounter % PHYSICS_TICK) === 0) MeshWarper.warpMesh(ocean, { noiseAmp: 0.06, noiseScale: 0.6, mix: 0.92, maxDisp: 1.0 });
  if ((frameCounter % (PHYSICS_TICK * 3)) === 0) updateCausticCanvas(now * 0.001 * 0.7, params.causticIntensity);

  projectorCam.position.copy(sun.position);
  projectorCam.lookAt(new THREE.Vector3(0, 0, 0));
  projectorCam.updateMatrixWorld();
  projectorCam.updateProjectionMatrix();
  causticUniforms.projectorMatrix.value.multiplyMatrices(projectorCam.projectionMatrix, projectorCam.matrixWorldInverse);
  causticUniforms.sunPos.value.copy(sun.position);
  causticUniforms.caTex.value = causticTex;

  controls.update();

  // update orbiting fish
  updateOrbitingFish(dt);

  renderer.render(scene, camera);
  frameCounter++;
}
animate();

/* resize & quick keys */
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});
window.addEventListener('keydown', (e) => {
  if (e.key === '+' || e.key === '=') WAVE_PARAMS.forEach(w => w.amp = Math.min(1.2, w.amp + 0.02));
  if (e.key === '-') WAVE_PARAMS.forEach(w => w.amp = Math.max(0, w.amp - 0.02));
  if (e.key === 'r') { camera.position.set(0, 2.8, 12); controls.update(); }
  if (e.key === 'c') params.causticIntensity = Math.min(2, params.causticIntensity + 0.05);
  if (e.key === 'x') params.causticIntensity = Math.max(0, params.causticIntensity - 0.05);
});

console.log(`Requested orbit radius ${REQUEST_ORBIT_RADIUS} -> using ${ORBIT_RADIUS} (auto-adjusted if inside planet). Ensure ./assets/Fish_Placeholder.glb is served.`);
