import * as THREE from "three";
import { Water } from "three/addons/objects/Water.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { MeshBVH, acceleratedRaycast } from 'https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.9.1/build/index.module.js';
import { Capsule } from 'https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/math/Capsule.js';

// -----------------------------
// Safety polyfill & BVH setup
// -----------------------------
if (!THREE.Line3.prototype.closestPointToPoint) {
  THREE.Line3.prototype.closestPointToPoint = function (point, target = new THREE.Vector3()) {
    if (this.closestPointToPointParameter) {
      const t = this.closestPointToPointParameter(point, true);
      return target.copy(this.end).sub(this.start).multiplyScalar(t).add(this.start);
    }
    const ab = new THREE.Vector3().subVectors(this.end, this.start);
    const ap = new THREE.Vector3().subVectors(point, this.start);
    const ab2 = ab.dot(ab);
    let t = ab2 === 0 ? 0 : ap.dot(ab) / ab2;
    t = Math.max(0, Math.min(1, t));
    return target.copy(this.start).addScaledVector(ab, t);
  };
}
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// -----------------------------
// Canvas, scene, camera, renderer
// -----------------------------
const canvas = document.querySelector(".webgl");
const scene = new THREE.Scene();
const sizes = { width: window.innerWidth, height: window.innerHeight };

const camera = new THREE.PerspectiveCamera(75, sizes.width / sizes.height, 0.1, 150);

const yawObject = new THREE.Object3D();
const pitchObject = new THREE.Object3D();
yawObject.add(pitchObject);
pitchObject.add(camera);
scene.add(yawObject);
camera.position.set(0, 2, 0);
pitchObject.rotation.x = 0;

const renderer = new THREE.WebGLRenderer({ canvas });
renderer.setSize(sizes.width, sizes.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.shadowMap.enabled = true;

// -----------------------------
// Player + Collision Setup
// -----------------------------
let playerCapsule = null;
let verticalVelocity = 0;
let playerOnGround = false;

const GRAVITY = -9.8;
const SPEED = 6.0;

const keyStates = {};
document.addEventListener('keydown', (e) => { keyStates[e.code] = true; });
document.addEventListener('keyup', (e) => { keyStates[e.code] = false; });

document.body.addEventListener('click', () => { document.body.requestPointerLock?.(); });

const YAW_SPEED = 0.0025;
const PITCH_SPEED = 0.0025;
const MAX_PITCH = Math.PI / 2 - 0.01;
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === document.body) {
    yawObject.rotation.y -= e.movementX * YAW_SPEED;
    pitchObject.rotation.x -= e.movementY * PITCH_SPEED;
    pitchObject.rotation.x = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitchObject.rotation.x));
  }
});

// -----------------------------
// collision meshes + cheap simple colliders (used by fish/bubbles/butterflies)
// -----------------------------
const collisionMeshes = [];
const simpleColliders = []; // { box: THREE.Box3, sphere: THREE.Sphere }

// addCollisionMesh now creates both the precise BVH and a cheap AABB+sphere entry immediately
function addCollisionMesh(object) {
  // ensure world matrices are up-to-date for this object before computing bounds
  object.updateMatrixWorld(true);

  object.traverse(child => {
    if (child.isMesh && child.geometry && !(child instanceof THREE.InstancedMesh)) {
      // BVH for precise capsule-vs-mesh collisions (used by resolveCollisions)
      if (!child.geometry.boundsTree) child.geometry.boundsTree = new MeshBVH(child.geometry, { lazyGeneration: false });

      collisionMeshes.push(child);

      // create a cheap AABB + bounding sphere snapshot for fast, approximate checks (butterflies/fish/bubbles)
      const tmpBox = new THREE.Box3().setFromObject(child);
      tmpBox.expandByScalar(0.05);
      const tmpSphere = tmpBox.getBoundingSphere(new THREE.Sphere());
      simpleColliders.push({ box: tmpBox.clone(), sphere: tmpSphere.clone() });
    }
  });
}

// optional helper to rebuild simple colliders snapshot (call if many static meshes added in batch)
function createSimpleColliders() {
  simpleColliders.length = 0;
  const tmpBox = new THREE.Box3();
  const tmpSphere = new THREE.Sphere();
  for (const m of collisionMeshes) {
    tmpBox.setFromObject(m);
    tmpBox.expandByScalar(0.05);
    tmpBox.getBoundingSphere(tmpSphere);
    simpleColliders.push({ box: tmpBox.clone(), sphere: tmpSphere.clone() });
  }
}

// -----------------------------
// Lights & lens flare
// -----------------------------
scene.add(new THREE.AmbientLight(0xffffff, 0.3));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(100, 100, 100);
scene.add(dirLight);

// improved multi-layer lens flare (three layers: main glow, halo, streak)
function makeFlareCircle(size, innerColor = '255,255,255', outerColor = '255,200,150', alpha = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  g.addColorStop(0, `rgba(${innerColor}, ${alpha})`);
  g.addColorStop(0.35, `rgba(${outerColor}, ${alpha*0.6})`);
  g.addColorStop(1, `rgba(${outerColor}, 0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0,0,size,size);
  return new THREE.CanvasTexture(c);
}

function makeFlareStreak(width = 256, height = 64, color = '255,230,200', alpha = 0.9) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const ctx = c.getContext('2d');
  // horizontal gradient streak
  const g = ctx.createLinearGradient(0, 0, width, 0);
  g.addColorStop(0, `rgba(${color}, 0)`);
  g.addColorStop(0.15, `rgba(${color}, ${alpha*0.2})`);
  g.addColorStop(0.5, `rgba(${color}, ${alpha})`);
  g.addColorStop(0.85, `rgba(${color}, ${alpha*0.2})`);
  g.addColorStop(1, `rgba(${color}, 0)`);
  ctx.fillStyle = g;
  // soft vertical falloff
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    ctx.globalAlpha = 1 - i*0.14;
    ctx.fillRect(0, (height/2 - (i+1)), width, 2*(i+1));
  }
  return new THREE.CanvasTexture(c);
}

// build three-layer flare
const flareGroup = new THREE.Group();

const flareMain = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeFlareCircle(256, '255,255,240', '255,200,160', 1.0), blending: THREE.AdditiveBlending, transparent: true
}));
flareMain.scale.set(3,3,1);
flareGroup.add(flareMain);

const flareHalo = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeFlareCircle(384, '255,220,200', '255,120,80', 0.9), blending: THREE.AdditiveBlending, transparent: true
}));
flareHalo.scale.set(6,6,1);
flareGroup.add(flareHalo);

const flareStreak = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeFlareStreak(512, 80, '255,230,200', 0.9), blending: THREE.AdditiveBlending, transparent: true
}));
flareStreak.scale.set(8,1.6,1); // elongated by default
flareStreak.center.set(0.5, 0.5);
flareGroup.add(flareStreak);

scene.add(flareGroup);

// small helper temps for animation loop
const _lf_camPos = new THREE.Vector3();
const _lf_lightDir = new THREE.Vector3();
const _lf_right = new THREE.Vector3();
const _lf_up = new THREE.Vector3();
const _lf_tmp = new THREE.Vector3();

// store base scales for easy modulation
flareMain.userData.baseScale = 3;
flareHalo.userData.baseScale = 6;
flareStreak.userData.baseScale = 8;

// -----------------------------
// Spawn/reset
// -----------------------------
const PLAYER_SPAWN = new THREE.Vector3(0, 7, 6);
function resetPlayerToSpawn() {
  if (!playerCapsule) return;
  const offset = playerCapsule.end.clone().sub(playerCapsule.start);
  playerCapsule.start.copy(PLAYER_SPAWN);
  playerCapsule.end.copy(PLAYER_SPAWN.clone().add(offset));
  verticalVelocity = 0;
  playerOnGround = false;
  pitchObject.rotation.x = 0;
  yawObject.position.copy(playerCapsule.end);
}

// -----------------------------
// HDR loader
// -----------------------------
function loadEnvironment(hdrPath, onLoaded) {
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();
  new RGBELoader()
    .setPath("./assets/")
    .load(hdrPath, (texture) => {
      const envMap = pmremGenerator.fromEquirectangular(texture).texture;
      scene.environment = envMap;
      scene.background = envMap;
      texture.dispose();
      pmremGenerator.dispose();
      if (onLoaded) onLoaded();
    });
}

// -----------------------------
// Main scene load
// -----------------------------
loadEnvironment("kloofendal_48d_partly_cloudy_puresky_4k.hdr", () => {
  const gltfLoader = new GLTFLoader();

  // Dome
  gltfLoader.load("./assets/Dome.glb", (gltf) => {
    const dome = gltf.scene;
    dome.name = "Dome";
    dome.position.set(0, 0.8, 0);
    dome.scale.set(2, 2, 2);
    dome.rotation.set(0, Math.PI / 4, 0);
    dome.traverse((child) => {
      if (child.isMesh) {
        child.material = new THREE.MeshPhysicalMaterial({
          color: 0xffffff, metalness: 0.3, roughness: 0.2,
          clearcoat: 0.3, clearcoatRoughness: 0.1, envMapIntensity: 0.5
        });
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    scene.add(dome);
    addCollisionMesh(dome);
  });

  // Main Column
  gltfLoader.load("./assets/Main Column.glb", (gltf) => {
    const mainColumn = gltf.scene;
    mainColumn.name = "MainColumn";
    mainColumn.position.set(0, 2, 0);
    mainColumn.scale.set(0.6,0.6,0.6);
    scene.add(mainColumn);
    addCollisionMesh(mainColumn);
  });

  // Computer
  gltfLoader.load("./assets/Computer.glb", (gltf) => {
    const computer = gltf.scene;
    computer.name = "Computer";
    computer.position.set(0, 4.5, -0.2);
    computer.scale.set(0.52, 0.52, 0.52);
    computer.rotation.set(0, 3 * Math.PI / 2, 0);
    scene.add(computer);
    addCollisionMesh(computer);
  });

  // Columns
  ["FirstColumn", "SecondColumn", "ThirdColumn", "FourthColumn"].forEach((name, i) => {
    const positions = [
      [15, 1.2, 15],
      [15, 1.2, -15],
      [-15, 1.2, -15],
      [-15, 1.2, 15],
    ];
    gltfLoader.load("./assets/Column.glb", (gltf) => {
      const column = gltf.scene;
      column.name = name;
      column.position.set(...positions[i]);
      column.scale.set(0.8, 0.8, 0.8);
      scene.add(column);
      addCollisionMesh(column);
    });
  });


//---------------------- //
// -------- Fish ------- //
//---------------------- //

  const fishSwimmers = [];

  function addFish(path, { name = "Fish", scale = 1.5, tankPosition = [0, 5, 0] }) {
    const l = new GLTFLoader();
    l.load(path, (gltf) => {
      const fish = gltf.scene;
      fish.name = name;
      fish.scale.set(scale, scale, scale);

      // Tank holds the fish
      const tank = new THREE.Object3D();
      tank.name = `${name}_Tank`;
      tank.position.set(...tankPosition);
      scene.add(tank);

      // Parent object for direction/orientation
      const fishParent = new THREE.Object3D();
      fishParent.name = `${name}_Parent`;
      fishParent.add(fish);
      fish.rotation.y = Math.PI / 2; // orient model
      tank.add(fishParent);

      // Animation mixer
      const mixer = new THREE.AnimationMixer(fish);
      gltf.animations.forEach((clip) => mixer.clipAction(clip).play());

      // --- Motion setup ---
      const speed = 1 + Math.random() * 2; // 🐟 faster than bubbles
      let direction = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.2, Math.random() - 0.5).normalize();

      // Give fish more room to swim
      const swimRadius = 50;
      const swimHeightMin = 5;
      const swimHeightMax = 20;

      // random spawn
      const r = Math.sqrt(Math.random()) * swimRadius;
      const theta = Math.random() * Math.PI * 2;
      fishParent.position.set(
        Math.cos(theta) * r,
        swimHeightMin + Math.random() * (swimHeightMax - swimHeightMin),
        Math.sin(theta) * r
      );

      function swimFish(delta) {
        // Predict next position
        const nextPos = fishParent.position.clone().addScaledVector(direction, speed * delta);

        // --- Collision check (like bubbles) ---
        let collided = false;
        const tmpClosest = new THREE.Vector3();
        const tmpNormal = new THREE.Vector3();

        for (let c = 0; c < simpleColliders.length; c++) {
          const col = simpleColliders[c];
          const rsum = col.sphere.radius + scale;

          if (nextPos.distanceToSquared(col.sphere.center) > (rsum * rsum)) continue;

          tmpClosest.copy(nextPos).clamp(col.box.min, col.box.max);
          const distSq = tmpClosest.distanceToSquared(nextPos);
          if (distSq <= (scale * scale)) {
            // bounce like bubbles
            tmpNormal.copy(nextPos).sub(tmpClosest);
            if (tmpNormal.lengthSq() === 0) tmpNormal.set(0, 1, 0);
            else tmpNormal.normalize();

            direction.reflect(tmpNormal).normalize();
            collided = true;
            break;
          }
        }

        if (!collided) {
          // Apply move
          fishParent.position.addScaledVector(direction, speed * delta);
        } else {
          // push away slightly after collision
          fishParent.position.addScaledVector(direction, 0.2);
        }

        // Random "schooling turn" sometimes
        if (Math.random() < 0.005) {
          direction = new THREE.Vector3(
            Math.random() - 0.5,
            (Math.random() - 0.5) * 0.2,
            Math.random() - 0.5
          ).normalize();
        }

        // Stay in tank bounds
        if (fishParent.position.y > swimHeightMax || fishParent.position.y < swimHeightMin) direction.y *= -1;

        // Smoothly rotate fish to face direction
        const targetQuaternion = new THREE.Quaternion();
        targetQuaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction.clone().normalize());
        fishParent.quaternion.slerp(targetQuaternion, 0.05);

        mixer.update(delta);
      }

      fishSwimmers.push(swimFish);
    });
  }

  // 🐟 Add some fish
  addFish("./assets/Fish_Placeholder.glb", { name: "BlueFish", scale: 0.8 });
  addFish("./assets/Fish_Placeholder.glb", { name: "Goldfish", scale: 0.6, tankPosition: [5, 8, -3] });
  addFish("./assets/Fish_Placeholder.glb", { name: "BabyShark", scale: 1.2, tankPosition: [-5, 12, 2] });

  // ---- update loop ----
  function updateFish(delta) {
    for (const swim of fishSwimmers) swim(delta);
  }



//---------------------- //
// ---- Butterflies ---- //
//---------------------- //

const butterflyFliers = [];

// ---- addButterfly (tweaked: faster, more unpredictable, vertical movement) ----
function addButterfly(path, { name = "Butterfly", scale = 0.9, spawnPosition = null } = {}) {
  const loader = new GLTFLoader();
  loader.load(path, (gltf) => {
    const model = gltf.scene;
    model.name = name;
    model.scale.setScalar(scale);

    const parent = new THREE.Object3D();
    parent.name = `${name}_Parent`;
    parent.add(model);

    // spawn band inside dome
    const minH = 1.5;
    const maxH = Math.min(18, (typeof domeHeight === 'number' ? domeHeight : 18) + 8);
    if (spawnPosition) parent.position.set(...spawnPosition);
    else {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * (typeof radius === 'number' ? radius : 30) * 0.65;
      parent.position.set(Math.cos(angle) * r, minH + Math.random() * (maxH - minH), Math.sin(angle) * r);
    }

    scene.add(parent);

    // model faces right by default — rotate 90° left so forward = -Z visually
    model.rotation.y = -Math.PI / 2;

    // animation mixer
    const mixer = new THREE.AnimationMixer(model);
    if (gltf.animations && gltf.animations.length) gltf.animations.forEach((clip) => mixer.clipAction(clip).play());

    // Behavior params (energetic & unpredictable)
    let state = "glide";
    const baseCruise = 0.45 + Math.random() * 0.9; // baseline speed
    const maxSpeed = baseCruise * (1.6 + Math.random() * 1.0);
    const energy = 0.4 + Math.random() * 1.0; // affects twitchiness
    const direction = new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.3) * 0.25, (Math.random() - 0.5)).normalize();
    const timers = { stateTimer: 0.4 + Math.random() * 1.2, panicTimer: 0 };

    // flower preference
    const flowerAffinity = 0.6 + Math.random() * 1.4; // higher => more likely to visit/hover flowers

    // vertical motion params
    const verticalPhase = Math.random() * Math.PI * 2;
    const verticalFreq = 0.6 + Math.random() * 1.6;
    const verticalAmp = 0.06 + Math.random() * 0.12;

    // spontaneity params
    const flitChance = 0.04 + Math.random() * 0.06;
    const pauseChance = 0.002 + Math.random() * 0.006;
    const twitchChance = 0.02 + Math.random() * 0.04;
    const burstChance = 0.008 + Math.random() * 0.01;

    // Build a small sampled set of nearby flowers (only done once at spawn)
    const nearbyFlowers = [];
    try {
      if (typeof petalMesh !== "undefined" && petalMesh.count > 0) {
        const samples = Math.min(14, petalMesh.count);
        const tmpMat = new THREE.Matrix4();
        const tmpPos = new THREE.Vector3();
        for (let s = 0; s < samples; s++) {
          const idx = Math.floor(Math.random() * petalMesh.count);
          petalMesh.getMatrixAt(idx, tmpMat);
          tmpPos.setFromMatrixPosition(tmpMat);
          nearbyFlowers.push(tmpPos.clone());
        }
      }
    } catch (e) {
      // ignore sampling errors
    }

    // main wander target
    const wanderTarget = new THREE.Vector3();
    function pickWander() {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * (typeof radius === 'number' ? radius : 30) * (0.35 + Math.random() * 0.45);
      const ty = minH + Math.random() * (maxH - minH);
      wanderTarget.set(Math.cos(a) * rr, Math.max(ty, minH + 0.4), Math.sin(a) * rr);
    }
    pickWander();

    // store state object and preallocate per-butterfly temps (avoid allocations in loop)
    const b = {
      parent,
      model,
      mixer,
      scale,
      state,
      baseCruise,
      maxSpeed,
      energy,
      direction,
      timers,
      verticalPhase,
      verticalFreq,
      verticalAmp,
      flitChance,
      pauseChance,
      twitchChance,
      burstChance,
      wanderTarget,
      nearbyFlowers,
      flowerAffinity,
      _lastPos: parent.position.clone(),
      _stuckTime: 0,
      _flitTarget: null,
      hoverCenter: null,
      // per-butterfly temps
      _tmpDesired: new THREE.Vector3(),
      _tmpClosest: new THREE.Vector3(),
      _tmpNormal: new THREE.Vector3(),
      _tmpToCenter: new THREE.Vector3(),
      _tmpQ: new THREE.Quaternion(),
      _tmpForward: new THREE.Vector3(0,0,-1),
      _tmpRight: new THREE.Vector3(),
      _desiredDir: new THREE.Vector3()
    };

    // flight function (uses b's preallocated temps)
    function flyButterfly(delta) {
      if (!b || !b.parent) return;
      const parent = b.parent;
      const tmpDesired = b._tmpDesired;
      const tmpClosest = b._tmpClosest;
      const tmpNormal = b._tmpNormal;
      const tmpToCenter = b._tmpToCenter;
      const tmpQ = b._tmpQ;
      const forwardVec = b._tmpForward;
      const rightVec = b._tmpRight;
      const desiredDirVec = b._desiredDir;

      // timers
      b.timers.stateTimer -= delta;
      if (b.timers.panicTimer > 0) b.timers.panicTimer -= delta;

      // quick escape near player
      if (typeof playerCapsule !== "undefined" && playerCapsule) {
        const playerPos = playerCapsule.end;
        const distSq = parent.position.distanceToSquared(playerPos);
        const fleeRadius = 6.0 * (1.0 + (1 - b.energy) * 1.4);
        if (distSq < (fleeRadius * fleeRadius)) {
          tmpToCenter.subVectors(parent.position, playerPos).normalize();
          b.direction.lerp(tmpToCenter.multiplyScalar(1.3 + (fleeRadius / Math.sqrt(Math.max(1e-6, distSq)))), 0.92).normalize();
          b.state = "escape";
          b.timers.stateTimer = 0.35 + Math.random() * 0.4;
          b.timers.panicTimer = 0.35 + Math.random() * 0.6;
        }
      }

      // occasional twitch/jolt
      if (Math.random() < b.twitchChance * (1 + (1 - b.energy))) {
        const twitch = new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5) * 0.6, (Math.random() - 0.5)).normalize();
        b.direction.lerp(twitch, 0.7).normalize();
        if (Math.random() < b.burstChance) {
          parent.userData._butterflySpeed = Math.max(parent.userData._butterflySpeed || b.baseCruise, Math.min(b.maxSpeed * 1.1, b.baseCruise * (1.6 + Math.random())));
        }
      }

      // spontaneous hover near flowers (biased by affinity)
      if (Math.random() < b.pauseChance * (1 + b.flowerAffinity) && b.state !== "escape" && b.timers.stateTimer > 0.12) {
        b.state = "hover";
        b.timers.stateTimer = (0.6 + Math.random() * 1.6) * (1 + 0.8 * b.flowerAffinity);
      }

      // state switching
      if (b.timers.stateTimer <= 0) {
        const r = Math.random();
        if (b.state === "glide") {
          if (r < b.flitChance * (1 + (1 - b.energy))) { b.state = "flit"; b.timers.stateTimer = 0.06 + Math.random() * 0.25; }
          else if (r < 0.35 * b.flowerAffinity && b.nearbyFlowers.length) {
            b.state = "hover";
            const idx = Math.floor(Math.random() * b.nearbyFlowers.length);
            const f = b.nearbyFlowers[idx];
            b.wanderTarget.copy(f); b.wanderTarget.y += 0.24 + Math.random() * 0.5;
            b.timers.stateTimer = (1.2 + Math.random() * 2.2) * (1 + 1.0 * b.flowerAffinity);
            b.hoverCenter = b.wanderTarget.clone();
          } else if (r < 0.28) {
            b.state = "figure8";
            const center = parent.position.clone();
            b.figure8 = { center, radius: 0.6 + Math.random() * 1.8, t: 0, speed: 2.0 + Math.random() * 3.0 };
            b.timers.stateTimer = 0.6 + Math.random() * 1.6;
          } else { b.state = "glide"; b.timers.stateTimer = 0.3 + Math.random() * 1.4; }
        } else if (b.state === "flit") {
          if (r < 0.5) { b.state = "hover"; b.timers.stateTimer = (0.4 + Math.random() * 1.2) * (1 + 0.8 * b.flowerAffinity); }
          else { b.state = "glide"; b.timers.stateTimer = 0.2 + Math.random() * 1.0; }
        } else if (b.state === "hover") {
          if (r < 0.5) { b.state = "flit"; b.timers.stateTimer = 0.06 + Math.random() * 0.3; }
          else { b.state = "glide"; b.timers.stateTimer = 0.3 + Math.random() * 1.0; }
        } else if (b.state === "figure8") {
          b.state = "glide"; b.timers.stateTimer = 0.3 + Math.random() * 1.0; b.figure8 = null;
        } else if (b.state === "escape") {
          b.state = "glide"; b.timers.stateTimer = 0.4 + Math.random() * 0.9;
        }
      }

      // compute desired speed & wander target per state
      let desiredSpeed = b.baseCruise;
      if (b.state === "glide") {
        desiredSpeed = b.baseCruise * (0.95 + Math.random() * 0.45);
        // occasionally prefer the nearest flower
        if (b.nearbyFlowers.length && Math.random() < 0.025 * b.flowerAffinity) {
          // find nearest sampled flower
          let bestIdx = -1, bestD = Infinity;
          for (let fi = 0; fi < b.nearbyFlowers.length; fi++) {
            const d = parent.position.distanceToSquared(b.nearbyFlowers[fi]);
            if (d < bestD) { bestD = d; bestIdx = fi; }
          }
          if (bestIdx >= 0) {
            const f = b.nearbyFlowers[bestIdx];
            b.wanderTarget.copy(f); b.wanderTarget.y = Math.max(b.wanderTarget.y + 0.25 + Math.random() * 0.4, minH + 0.5);
            b.timers.stateTimer = (0.6 + Math.random() * 1.2) * (1 + 0.8 * b.flowerAffinity);
            b.hoverCenter = b.wanderTarget.clone();
          } else if (parent.position.distanceToSquared(b.wanderTarget) < 0.5 || Math.random() < 0.02) {
            pickWander();
          }
        } else if (parent.position.distanceToSquared(b.wanderTarget) < 0.5 || Math.random() < 0.02) pickWander();
      } else if (b.state === "flit") {
        desiredSpeed = Math.min(b.maxSpeed, b.baseCruise * (1.9 + Math.random() * 2.0));
        if (!b._flitTarget || Math.random() < 0.4) {
          const a = Math.random() * Math.PI * 2;
          const rr = 0.25 + Math.random() * 2.6;
          b._flitTarget = parent.position.clone().add(new THREE.Vector3(Math.cos(a) * rr, (Math.random() - 0.5) * 0.8, Math.sin(a) * rr));
        }
        b.wanderTarget.copy(b._flitTarget);
      } else if (b.state === "hover") {
        desiredSpeed = 0.02 + Math.random() * 0.06;
        if (!b.hoverCenter) b.hoverCenter = parent.position.clone();
        const jitter = 0.4 * (1 + 0.6 * b.flowerAffinity);
        b.wanderTarget.set(
          b.hoverCenter.x + (Math.random() - 0.5) * jitter,
          THREE.MathUtils.clamp(b.hoverCenter.y + (Math.random() - 0.5) * 0.3, minH, maxH),
          b.hoverCenter.z + (Math.random() - 0.5) * jitter
        );
      } else if (b.state === "figure8" && b.figure8) {
        const f = b.figure8; f.t += delta * f.speed;
        const x = Math.cos(f.t) * f.radius;
        const z = Math.sin(2 * f.t) * (f.radius * 0.5);
        const y = Math.sin(f.t * 1.6) * 0.18;
        b.wanderTarget.copy(f.center).add(new THREE.Vector3(x, y, z));
        desiredSpeed = b.baseCruise * (0.7 + Math.random() * 0.5);
      } else if (b.state === "escape") {
        desiredSpeed = b.maxSpeed * 1.08;
      }

      // desired velocity with vertical bobbing + gentle climb/dive tendencies
      tmpDesired.subVectors(b.wanderTarget, parent.position);
      const distToTarget = tmpDesired.length();
      if (distToTarget > 0.0001) tmpDesired.normalize().multiplyScalar(desiredSpeed);
      else tmpDesired.set((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.04);

      // continuous vertical sinusoidal motion
      const tNow = performance.now() * 0.001;
      const sine = Math.sin(tNow * b.verticalFreq + b.verticalPhase);
      tmpDesired.y += sine * b.verticalAmp;

      // occasional climb or dive phase
      if (Math.random() < 0.003) tmpDesired.y += (Math.random() < 0.5 ? 1 : -1) * (0.08 + Math.random() * 0.12);

      // steering toward desired direction (smoothed)
      desiredDirVec.copy(tmpDesired).normalize();
      b.direction.lerp(desiredDirVec, 0.08 + Math.random() * 0.06).normalize();

      // soft collision avoidance against simpleColliders
      const nextPos = parent.position.clone().addScaledVector(b.direction, desiredSpeed * delta);
      for (let c = 0; c < (Array.isArray(simpleColliders) ? simpleColliders.length : 0); c++) {
        const col = simpleColliders[c];
        const rsum = (col.sphere && col.sphere.radius ? col.sphere.radius : 0) + (b.scale * 0.45);
        if (nextPos.distanceToSquared(col.sphere.center) > (rsum * rsum)) continue;

        tmpClosest.copy(nextPos).clamp(col.box.min, col.box.max);
        const distSq = tmpClosest.distanceToSquared(nextPos);
        if (distSq <= (0.06 * b.scale) * (0.06 * b.scale)) {
          tmpNormal.copy(nextPos).sub(tmpClosest);
          if (tmpNormal.lengthSq() === 0) tmpNormal.set(0, 1, 0);
          else tmpNormal.normalize();
          b.direction.reflect(tmpNormal).normalize();
          b.state = "escape";
          b.timers.stateTimer = 0.28 + Math.random() * 0.5;
          b.timers.panicTimer = 0.3 + Math.random() * 0.6;
          break;
        }
      }

      // ensure speed tracking and minSpeed
      if (parent.userData._butterflySpeed === undefined) parent.userData._butterflySpeed = b.baseCruise;
      const minSpeed = Math.max(0.04, b.baseCruise * 0.28);
      const currentSpeed = parent.userData._butterflySpeed || 0;
      const smoothSpeed = THREE.MathUtils.lerp(currentSpeed, desiredSpeed, 0.10);
      parent.userData._butterflySpeed = Math.max(smoothSpeed, minSpeed);

      // apply movement
      parent.position.addScaledVector(b.direction, parent.userData._butterflySpeed * delta);

      // stuck detection & recovery
      const moved = parent.position.distanceTo(b._lastPos);
      if (moved < 0.01) b._stuckTime += delta; else b._stuckTime = Math.max(0, b._stuckTime - delta * 2.0);
      b._lastPos.copy(parent.position);
      if (b._stuckTime > 0.45) {
        b._stuckTime = 0;
        b.state = "flit";
        b.timers.stateTimer = 0.06 + Math.random() * 0.2;
        pickWander();
        parent.position.y = Math.max(parent.position.y + 0.22, minH + 0.2);
        parent.userData._butterflySpeed = Math.max(parent.userData._butterflySpeed, Math.min(b.maxSpeed, b.baseCruise * 1.5));
      }

      // keep inside dome & clamp vertical
      const horizontalDist = Math.sqrt(parent.position.x * parent.position.x + parent.position.z * parent.position.z);
      const maxDist = (typeof radius === 'number' ? radius : 30) * 0.92;
      if (horizontalDist > maxDist) {
        tmpToCenter.subVectors(new THREE.Vector3(0, parent.position.y, 0), parent.position).normalize();
        b.direction.lerp(tmpToCenter, 0.6).normalize();
        b.timers.stateTimer = 0.4;
      }
      if (parent.position.y < minH) parent.position.y = minH + 0.02;
      else if (parent.position.y > maxH) parent.position.y = maxH - 0.02;

      // orientation & banking
      if (b.direction.lengthSq() > 1e-6) {
        // target rotation: rotate forwardVec (0,0,-1) to point in b.direction (projected)
        const dirNoY = b.direction.clone(); dirNoY.y = 0; if (dirNoY.lengthSq() < 1e-6) dirNoY.copy(b.direction);
        dirNoY.normalize();
        tmpQ.identity().setFromUnitVectors(forwardVec, dirNoY);
        // banking based on lateral component
        rightVec.crossVectors(b.direction, new THREE.Vector3(0,1,0)).normalize();
        const lateral = desiredDirVec.dot(rightVec);
        const bankAngle = THREE.MathUtils.clamp(-lateral * 0.9, -0.6, 0.6);
        const bankQ = tmpQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(b.direction.clone().normalize(), bankAngle));
        parent.quaternion.slerp(bankQ, 0.14);
      }

      // update mixer (animations)
      if (b.mixer) b.mixer.update(delta);
    }

    butterflyFliers.push(flyButterfly);
  });
}

// usage (keep your calls)
addButterfly("./assets/Butterfly.glb", { name: "ButterflyA", scale: 0.8 });
addButterfly("./assets/Butterfly.glb", { name: "ButterflyB", scale: 0.7 });
addButterfly("./assets/Butterfly.glb", { name: "ButterflyC", scale: 1.0 });

// ---- update loop ----
function updateButterflies(delta) {
  for (const fly of butterflyFliers) {
    try { fly(delta); } catch (e) { console.warn('butterfly fly error', e); }
  }
}




 // -----------------------------
// Bubble Settings (improved)
// -----------------------------
const bubbleCount = 50;       // 🔹 How many bubbles to spawn
const bubbleMinSize = 0.2;    // 🔹 Minimum bubble size
const bubbleMaxSize = 1.0;    // 🔹 Maximum bubble size

// spawn extents (reused from your code)
const spawnRadius = 100;
const spawnMinY = 2;
const spawnMaxY = 40;
const speedMin = 0.1;
const speedMax = 1;

// buoyancy / drag tuning
const BASE_LIFT = 0.6;     // base upward acceleration (units/s^2)
const BASE_DRAG = 0.6;     // drag coefficient (per second)
const LATERAL_AMP = 0.6;   // how strongly bubbles drift sideways
const WOBBLE_AMP = 0.004;   // how much the bubble scale wobbles (fraction)
const SURFACE_POP_MARGIN = 2; // how far above spawnMaxY we consider "popped"

// ---- Create bubbles (instanced) ----
const textureLoader = new THREE.TextureLoader();
const bubbleTexture = textureLoader.load("./assets/World-Map.png"); // keep yours

// keep your geometry as-is to avoid breaking scale assumptions (you scale per-instance)
const bubbleGeometry = new THREE.SphereGeometry(5, 8, 8);
const bubbleMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x88ccff,
  transmission: 1.0,
  opacity: 0.7,
  transparent: true,
  roughness: 0,
  metalness: 0,
  clearcoat: 1,
  clearcoatRoughness: 0.1,
  depthWrite: false,
  emissiveMap: bubbleTexture,
  emissive: new THREE.Color(0x88ccff),
  emissiveIntensity: 0.1
});
const bubbles = new THREE.InstancedMesh(bubbleGeometry, bubbleMaterial, bubbleCount);
bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(bubbles);

const bubbleData = [];
const bubbleDummy = new THREE.Object3D();

// helper to spawn/reset a bubble into bubbleData[index]
function spawnBubble(b, i) {
  // random cylindrical distribution
  const r = Math.sqrt(Math.random()) * spawnRadius;
  const theta = Math.random() * Math.PI * 2;
  b.position.set(Math.cos(theta) * r, spawnMinY + Math.random() * (spawnMaxY - spawnMinY), Math.sin(theta) * r);

  // size
  b.scale = bubbleMinSize + Math.random() * (bubbleMaxSize - bubbleMinSize);

  // velocity: small upward bias + random lateral
  const dir = new THREE.Vector3(Math.random() - 0.5, 0.2 + Math.random() * 0.8, Math.random() - 0.5).normalize();
  const speed = speedMin + Math.random() * (speedMax - speedMin);
  b.velocity.copy(dir.multiplyScalar(speed));

  // physics tuning per-bubble (makes big bubbles rise faster)
  b.buoyancy = BASE_LIFT * (0.6 + 0.8 * Math.random()) * b.scale; // ~scale * constant
  b.drag = BASE_DRAG * (0.6 + 0.6 * Math.random()); // variance in drag

  // lateral drift / wobble params
  b.phase = Math.random() * Math.PI * 2;
  b.lateralAmp = LATERAL_AMP * (0.3 + Math.random() * 1.2) * b.scale;
  b.lateralFreq = 0.6 + Math.random() * 1.4;
  b.wobbleAmp = WOBBLE_AMP * (0.6 + Math.random() * 1.2);

  // rotation
  b.rotationSpeed = THREE.MathUtils.randFloat(-0.6, 0.6);
  b.rotationY = Math.random() * Math.PI * 2;

  // store index for instance updates
  b._i = i;
}

// initial spawn
for (let i = 0; i < bubbleCount; i++) {
  const b = {
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    scale: 1,
    rotationSpeed: 0,
    rotationY: 0,
    phase: 0,
    buoyancy: BASE_LIFT,
    drag: BASE_DRAG,
    lateralAmp: LATERAL_AMP,
    lateralFreq: 1.0,
    wobbleAmp: WOBBLE_AMP,
    _i: i
  };
  spawnBubble(b, i);
  bubbleData.push(b);

  // set instance matrix once at spawn
  bubbleDummy.position.copy(b.position);
  bubbleDummy.scale.set(b.scale, b.scale, b.scale);
  bubbleDummy.rotation.set(0, b.rotationY, 0);
  bubbleDummy.updateMatrix();
  bubbles.setMatrixAt(i, bubbleDummy.matrix);
}
bubbles.instanceMatrix.needsUpdate = true;

// ---- updateBubbles (buoyancy + collisions + wobble) ----
let collisionFrameCounter = 0;
const COLLISION_SKIP = 1;

function updateBubbles(delta) {
  // temporaries (cached on function to avoid recreation)
  const tmpClosest = updateBubbles._tmpClosest || (updateBubbles._tmpClosest = new THREE.Vector3());
  const tmpNormal = updateBubbles._tmpNormal || (updateBubbles._tmpNormal = new THREE.Vector3());
  const tmpNextPos = updateBubbles._tmpNextPos || (updateBubbles._tmpNextPos = new THREE.Vector3());
  const tmpRespawnDir = updateBubbles._tmpRespawnDir || (updateBubbles._tmpRespawnDir = new THREE.Vector3());

  const doCollisions = (++collisionFrameCounter % COLLISION_SKIP) === 0;
  // accumulate a running time for smooth noise/wobble
  updateBubbles._time = (updateBubbles._time || 0) + delta;
  const time = updateBubbles._time;

  for (let i = 0; i < bubbleCount; i++) {
    const b = bubbleData[i];

    // 1) lateral drift & wobble phase progression
    b.phase += b.lateralFreq * delta;

    // 2) buoyancy: upward acceleration proportional to bubble size (volume/area heuristic)
    //    dv = buoyancy * dt  (simple integrator)
    b.velocity.y += b.buoyancy * delta;

    // 3) gentle lateral sinusoidal current (makes motion organic)
    b.velocity.x += Math.cos(b.phase + i) * b.lateralAmp * delta;
    b.velocity.z += Math.sin(b.phase * 0.7 - i * 0.5) * b.lateralAmp * 0.7 * delta;

    // 4) apply fluid drag (damp velocities) — scaled by delta so it's framerate-independent
    const dragFactor = Math.max(0, 1 - b.drag * delta);
    b.velocity.multiplyScalar(dragFactor);

    // predicted next position
    tmpNextPos.copy(b.position).addScaledVector(b.velocity, delta);

    // 5) collisions against simpleColliders (broad-phase + narrow-phase)
    if (doCollisions && Array.isArray(simpleColliders) && simpleColliders.length > 0) {
      let collided = false;
      for (let c = 0; c < simpleColliders.length; c++) {
        const col = simpleColliders[c];
        // bounding-sphere quick test
        const rsum = (col.sphere && col.sphere.radius ? col.sphere.radius : 0) + b.scale;
        if (tmpNextPos.distanceToSquared(col.sphere.center) > (rsum * rsum)) continue;

        // clamp to collider AABB (narrow phase)
        tmpClosest.copy(tmpNextPos);
        tmpClosest.clamp(col.box.min, col.box.max);

        const distSq = tmpClosest.distanceToSquared(tmpNextPos);
        if (distSq <= (b.scale * b.scale)) {
          // collision occured: compute normal, reflect velocity and nudge out
          tmpNormal.copy(tmpNextPos).sub(tmpClosest);
          if (tmpNormal.lengthSq() === 0) tmpNormal.set(0, 1, 0);
          else tmpNormal.normalize();

          // reflect and dampen, then add a small upward nudge to preserve buoyancy feel
          b.velocity.reflect(tmpNormal).multiplyScalar(0.7);
          b.velocity.addScaledVector(tmpNormal, 0.15); // slight push away from surface
          b.velocity.addScaledVector(new THREE.Vector3(0,1,0), Math.abs(b.buoyancy) * 0.05); // small upward kick

          // move next position slightly out of collider surface
          tmpNextPos.copy(tmpClosest).addScaledVector(tmpNormal, b.scale * 0.6);

          collided = true;
          break;
        }
      }
      if (collided) {
        // gentle additional damping after collision
        b.velocity.multiplyScalar(0.95);
      }
    }

    // 6) apply next position
    b.position.copy(tmpNextPos);

    // 7) bubble popping / respawn when reaching the surface (or going too high)
    const surfaceY = spawnMaxY + SURFACE_POP_MARGIN;
    if (b.position.y >= surfaceY) {
      // small chance to "pop" visually before respawn: shrink and respawn
      // immediate respawn keeps it simple and avoids long-lived tiny bubbles
      spawnBubble(b, i);
    }

    // 8) fallback respawn if below world (safety)
    if (b.position.y <= 0) {
      spawnBubble(b, i);
    }

    // 9) rotation update
    b.rotationY += b.rotationSpeed * delta;

    // 10) wobble scale (slight pulsation to sell bubble elasticity)
    const wobble = 1 + Math.sin(b.phase * 3 + time * 4 + i) * b.wobbleAmp;

    // 11) Update instance matrix for rendering (position, scale, rotation)
    bubbleDummy.position.copy(b.position);
    const finalScale = Math.max(0.001, b.scale * wobble);
    bubbleDummy.scale.set(finalScale, finalScale, finalScale);
    bubbleDummy.rotation.set(0, b.rotationY, 0);
    bubbleDummy.updateMatrix();
    bubbles.setMatrixAt(i, bubbleDummy.matrix);
  }

  // push instance updates to GPU
  bubbles.instanceMatrix.needsUpdate = true;
}


  // Water
  const waterGeometry = new THREE.PlaneGeometry(300, 300);
  const water = new Water(waterGeometry, {
    textureWidth: 512, textureHeight: 512,
    waterNormals: new THREE.TextureLoader().load("https://threejs.org/examples/textures/waternormals.jpg", (t)=>{ t.wrapS=t.wrapT=THREE.RepeatWrapping; }),
    alpha: 1, sunDirection: dirLight.position.clone().normalize(), sunColor: 0xbbbbbb,
    waterColor: 0x0099ff, distortionScale: 3.0, fog: scene.fog !== undefined
  });
  water.rotation.x = -Math.PI/2;
  water.position.y = -0.1;
  scene.add(water);

  // Floor + Grass
  const radius = 80;
  const segments = 150;
  const floorGeometry = new THREE.CircleGeometry(radius, segments);
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x006400, side: THREE.DoubleSide });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);

  const domeHeight = 3;
  for (let i = 0; i < floorGeometry.attributes.position.count; i++) {
    const x = floorGeometry.attributes.position.getX(i);
    const z = floorGeometry.attributes.position.getY(i);
    const distance = Math.sqrt(x * x + z * z);
    const y = domeHeight * (1 - distance / radius);
    floorGeometry.attributes.position.setZ(i, y);
  }
  floorGeometry.computeVertexNormals();
  floor.rotation.x = -Math.PI/2;
  floor.position.y = -1;
  scene.add(floor);

  // Floor collider (invisible)
  const floorCollider = new THREE.Mesh(floorGeometry.clone(), new THREE.MeshStandardMaterial({ visible: false }));
  floorCollider.rotation.copy(floor.rotation);
  floorCollider.position.copy(floor.position);
  scene.add(floorCollider);
  addCollisionMesh(floorCollider);

  // ---- GRASS ----
  const blade = new THREE.PlaneGeometry(0.05, 0.5, 1, 4);
  blade.translate(0, 0.25, 0);
  const grassMaterial = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `
      uniform float time;
      varying vec2 vUv;
      varying float vRandom;
      attribute float randHeight;
      attribute float randColor;
      void main() {
        vUv = uv;
        vRandom = randColor;
        vec3 pos = position;
        float sway = sin(time*2.0 + pos.y*5.0 + instanceMatrix[3].x*0.5 + instanceMatrix[3].z*0.5) * 0.1;
        pos.x += sway * pos.y;
        pos.y *= randHeight;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying float vRandom;
      void main() {
        vec3 base = mix(vec3(0.05, 0.4, 0.05), vec3(0.1, 0.6, 0.1), vUv.y);
        vec3 varied = mix(base, vec3(0.0, 0.8, 0.0), vRandom);
        gl_FragColor = vec4(varied, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });

  const GRASS_COUNT = 200000;
  const grassMesh = new THREE.InstancedMesh(blade, grassMaterial, GRASS_COUNT);
  grassMesh.frustumCulled = false;
  grassMesh.position.y = -1;
  scene.add(grassMesh);

  const randHeight = new Float32Array(GRASS_COUNT);
  const randColor = new Float32Array(GRASS_COUNT);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < GRASS_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const rot = Math.random() * Math.PI;
    const distance = Math.sqrt(x * x + z * z);
    const y = domeHeight * (1 - distance / radius);
    dummy.position.set(x, y, z);
    dummy.rotation.y = rot;
    dummy.updateMatrix();
    grassMesh.setMatrixAt(i, dummy.matrix);
    randHeight[i] = 0.8 + Math.random() * 0.6;
    randColor[i] = Math.random();
  }
  blade.setAttribute("randHeight", new THREE.InstancedBufferAttribute(randHeight, 1));
  blade.setAttribute("randColor", new THREE.InstancedBufferAttribute(randColor, 1));
  grassMesh.instanceMatrix.needsUpdate = true;

  // ---------- FLOWERS (very few, placed after grass) ----------
  const FLOWER_COUNT = 300; // very few compared to grass

  // stem geometry (thin blade)
  const flowerStemGeo = new THREE.PlaneGeometry(0.02, 0.4, 1, 1);
  flowerStemGeo.translate(0, 0.1, 0);

  // stem shader
  const stemMaterial = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `
      uniform float time;
      attribute float randStemH;
      varying float vRandH;
      void main() {
        vRandH = randStemH;
        vec3 pos = position;
        pos.y *= randStemH; // scale height
        float sway = sin(time * 1.5 + instanceMatrix[3].x * 0.5 + instanceMatrix[3].z * 0.3) * 0.03;
        pos.x += sway * pos.y;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      varying float vRandH;
      void main() {
        vec3 base = mix(vec3(0.06,0.45,0.06), vec3(0.08,0.6,0.08), smoothstep(0.8,1.2,vRandH));
        gl_FragColor = vec4(base, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });

  // petal geometry (small plane, shader draws a circular disk)
  const petalGeo = new THREE.PlaneGeometry(0.3, 0.3, 1, 1);
  petalGeo.translate(0, 0.15, 0);

  const petalMaterial = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `
      uniform float time;
      attribute float randScale;
      attribute float randColor;
      varying vec2 vUv;
      varying float vRand;
      void main() {
        vUv = uv;
        vRand = randColor;
        vec3 pos = position;
        pos.xy *= randScale; // scale petal
        float sway = sin(time * 1.8 + instanceMatrix[3].x * 0.4) * 0.03;
        pos.x += sway * (pos.y + 0.1);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying float vRand;
      void main() {
        vec2 uv = vUv - 0.5;
        float d = length(uv);
        // soft circular petal head
        if (d > 0.5) discard;
        vec3 petal = mix(vec3(1.0,0.5,0.6), vec3(1.0,1.0,0.45), vRand);
        float alpha = smoothstep(0.5, 0.42, d);
        float centerDark = smoothstep(0.2, 0.0, d) * 0.15;
        gl_FragColor = vec4(petal - centerDark, alpha);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // create instanced meshes
  const stemMesh = new THREE.InstancedMesh(flowerStemGeo, stemMaterial, FLOWER_COUNT);
  stemMesh.frustumCulled = false;
  scene.add(stemMesh);

  const petalMesh = new THREE.InstancedMesh(petalGeo, petalMaterial, FLOWER_COUNT);
  petalMesh.frustumCulled = false;
  scene.add(petalMesh);

  // per-instance attributes
  const randStemH = new Float32Array(FLOWER_COUNT);
  const randPetalScale = new Float32Array(FLOWER_COUNT);
  const randPetalColor = new Float32Array(FLOWER_COUNT);

  const flowerDummy = new THREE.Object3D();
  for (let i = 0; i < FLOWER_COUNT; i++) {
    // distribute within dome similarly to grass but much sparser
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius * 0.9;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const distance = Math.sqrt(x * x + z * z);
    const y = domeHeight * (1 - distance / radius) - 0.5; // ground-level offset

    flowerDummy.position.set(x, y, z);
    flowerDummy.rotation.y = Math.random() * Math.PI * 2;
    flowerDummy.rotation.x = (Math.random() - 0.5) * 0.25; // slight tilt
    flowerDummy.updateMatrix();

    stemMesh.setMatrixAt(i, flowerDummy.matrix);
    petalMesh.setMatrixAt(i, flowerDummy.matrix);

    randStemH[i] = 0.9 + Math.random() * 0.6;
    randPetalScale[i] = 0.6 + Math.random() * 0.9;
    randPetalColor[i] = Math.random();
  }

  flowerStemGeo.setAttribute("randStemH", new THREE.InstancedBufferAttribute(randStemH, 1));
  petalGeo.setAttribute("randScale", new THREE.InstancedBufferAttribute(randPetalScale, 1));
  petalGeo.setAttribute("randColor", new THREE.InstancedBufferAttribute(randPetalColor, 1));

  stemMesh.instanceMatrix.needsUpdate = true;
  petalMesh.instanceMatrix.needsUpdate = true;

  // build simple colliders snapshot now that we've added major colliders (floor + initial gltf collisions added earlier)
  scene.updateMatrixWorld(true);
  createSimpleColliders();

  // create butterflies now that simpleColliders has initial content
 //createButterflies();

  // Initialize player capsule
  playerCapsule = new Capsule(
    new THREE.Vector3(PLAYER_SPAWN.x, PLAYER_SPAWN.y, PLAYER_SPAWN.z),
    new THREE.Vector3(PLAYER_SPAWN.x, PLAYER_SPAWN.y + 1, PLAYER_SPAWN.z),
    0.35
  );
  yawObject.position.copy(playerCapsule.end);

  // -----------------------------
  // Collision helpers & render loop
  // -----------------------------
  const tempBox = new THREE.Box3();
  const tempMat = new THREE.Matrix4();
  const tempSegment = new THREE.Line3(new THREE.Vector3(), new THREE.Vector3());
  const triPoint = new THREE.Vector3();
  const capPoint = new THREE.Vector3();
  const newStartWorld = new THREE.Vector3();
  const oldStartWorld = new THREE.Vector3();
  const deltaWorld = new THREE.Vector3();
  const tmpNormal = new THREE.Vector3();
  const clock = new THREE.Clock();

  // resolveCollisions(allowGrounding)
  // - if allowGrounding === false -> apply corrections but DO NOT mark player as grounded
  // - if allowGrounding === true  -> apply corrections and return whether an upward landing correction occurred
  function resolveCollisions(allowGrounding = true) {
    let anyUpCorrection = false;
    for (const colMesh of collisionMeshes) {
      if (!colMesh.geometry?.boundsTree) continue;

      tempMat.copy(colMesh.matrixWorld).invert();
      tempSegment.start.copy(playerCapsule.start).applyMatrix4(tempMat);
      tempSegment.end.copy(playerCapsule.end).applyMatrix4(tempMat);

      tempBox.makeEmpty();
      tempBox.expandByPoint(tempSegment.start);
      tempBox.expandByPoint(tempSegment.end);
      tempBox.min.addScalar(-playerCapsule.radius);
      tempBox.max.addScalar(playerCapsule.radius);

      colMesh.geometry.boundsTree.shapecast({
        intersectsBounds: (box) => box.intersectsBox(tempBox),
        intersectsTriangle: (tri) => {
          const dist = tri.closestPointToSegment(tempSegment, triPoint, capPoint);
          if (dist < playerCapsule.radius) {
            const depth = playerCapsule.radius - dist;
            tri.getNormal(tmpNormal);
            const dir = capPoint.clone().sub(triPoint);
            if (dir.lengthSq() === 0) dir.copy(tmpNormal);
            else dir.normalize();

            tempSegment.start.addScaledVector(dir, depth);
            tempSegment.end.addScaledVector(dir, depth);

            tempBox.expandByPoint(tempSegment.start);
            tempBox.expandByPoint(tempSegment.end);
          }
        }
      });

      newStartWorld.copy(tempSegment.start).applyMatrix4(colMesh.matrixWorld);
      oldStartWorld.copy(playerCapsule.start);
      deltaWorld.subVectors(newStartWorld, oldStartWorld);

      if (deltaWorld.lengthSq() > 0) {
        const verticalDelta = new THREE.Vector3(0, deltaWorld.y, 0);
        const horizontalDelta = new THREE.Vector3(deltaWorld.x, 0, deltaWorld.z);

        // always apply vertical correction to avoid falling through
        if (Math.abs(verticalDelta.y) > 1e-6) {
          playerCapsule.translate(verticalDelta);
          // only consider this an "onGround" landing if allowGrounding is true
          // this prevents walking-up-slope corrections from freezing grounded state
          if (allowGrounding && verticalDelta.y > 0.0001) {
            anyUpCorrection = true;
            verticalVelocity = 0;
          }
        }

        // apply horizontal correction
        if (horizontalDelta.lengthSq() > 0.0) {
          playerCapsule.translate(horizontalDelta);
        }
      }
    }
    return anyUpCorrection;
  }

  // debug: counts (remove if you want)
  console.log("Initial collisionMeshes:", collisionMeshes.length, "simpleColliders:", simpleColliders.length);



// ----------------------------//
// ----- ANIMATION LOOP -------//
// ----------------------------//

// ---------- Fixed timestep config ----------
const FIXED_STEP_MS = 16;
const FIXED_STEP_S = FIXED_STEP_MS / 1000; // 0.016 seconds
const MAX_STEPS_PER_FRAME = 10; // safety cap to avoid spiral-of-death

// accumulator for fixed-step simulation
let accumulator = 0;

// interpolation snapshots for player position
const prevPlayerPos = new THREE.Vector3();
const currPlayerPos = new THREE.Vector3();
if (playerCapsule) {
  prevPlayerPos.copy(playerCapsule.end);
  currPlayerPos.copy(playerCapsule.end);
}

// ---------- Simulation function (delta in seconds) ----------
function updatePlayer(deltaS) {
  // --- horizontal movement (stepped) ---
  const move = new THREE.Vector3();
  const forward = new THREE.Vector3();
  yawObject.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();

  const right = new THREE.Vector3();
  right.crossVectors(new THREE.Vector3(0, 1, 0), forward).normalize();

  if (keyStates['KeyW']) move.add(forward.clone().negate());
  if (keyStates['KeyS']) move.add(forward);
  if (keyStates['KeyA']) move.add(right.clone().negate());
  if (keyStates['KeyD']) move.add(right);

  let desiredMove = new THREE.Vector3();
  if (move.lengthSq() > 0) {
    desiredMove.copy(move).normalize().multiplyScalar(SPEED * deltaS);
  }

  // step horizontally in small increments to avoid invisible-wall behavior
  const maxStep = 0.25;
  const totalDist = desiredMove.length();
  if (totalDist > 0) {
    const steps = Math.max(1, Math.ceil(totalDist / maxStep));
    const stepVec = desiredMove.clone().multiplyScalar(1 / steps);
    for (let i = 0; i < steps; i++) {
      playerCapsule.translate(stepVec);
      // resolve collisions but DO NOT set grounded from horizontal pushes
      try {
        resolveCollisions(false);
      } catch (e) {
        console.warn('resolveCollisions (horizontal) error:', e);
      }
    }
  }

  // --- Quick floor-safety fallback (prevents rare slip-throughs) ---
  if (playerCapsule) {
    const capsuleBottomY = Math.min(playerCapsule.start.y, playerCapsule.end.y);
    const floorY = (typeof floor !== "undefined" && floor && floor.position) ? floor.position.y : -1;
    const penetration = (capsuleBottomY - playerCapsule.radius) - floorY;
    if (penetration < -0.001) {
      const pushUp = -penetration + 0.001;
      playerCapsule.translate(new THREE.Vector3(0, pushUp, 0));
      verticalVelocity = 0;
      playerOnGround = true;
    }
  }

  // --- Vertical integration ---
  if (!playerOnGround) {
    verticalVelocity += GRAVITY * deltaS;
  } else {
    verticalVelocity = Math.max(verticalVelocity, 0);
  }

  // apply vertical displacement and now allow grounding corrections (landing detection)
  const dY = verticalVelocity * deltaS;
  if (Math.abs(dY) > 1e-6) {
    playerCapsule.translate(new THREE.Vector3(0, dY, 0));
    try {
      const landed = resolveCollisions(true); // allowGrounding = true
      playerOnGround = !!landed;
    } catch (e) {
      console.warn('resolveCollisions (vertical) error:', e);
    }
  } else {
    try {
      const landed = resolveCollisions(true);
      playerOnGround = !!landed;
    } catch (e) {
      console.warn('resolveCollisions (vertical-check) error:', e);
    }
  }

  // If grounded, zero vertical velocity
  if (playerOnGround) verticalVelocity = 0;

  // small ground-normal projection to avoid downhill sliding when grounded
  if (playerOnGround && desiredMove.lengthSq() > 0) {
    let groundNormal = null;
    let bestDist = Infinity;
    const downOrigin = playerCapsule.end.clone();

    const inverse = new THREE.Matrix4();
    for (const colMesh of collisionMeshes) {
      if (!colMesh || !colMesh.geometry || !colMesh.geometry.boundsTree) continue;
      inverse.copy(colMesh.matrixWorld).invert();
      const localOrigin = downOrigin.clone().applyMatrix4(inverse);

      // small local bbox near origin
      const rayBox = new THREE.Box3(
        new THREE.Vector3(localOrigin.x - 0.1, localOrigin.y - 2, localOrigin.z - 0.1),
        new THREE.Vector3(localOrigin.x + 0.1, localOrigin.y + 0.1, localOrigin.z + 0.1)
      );

      colMesh.geometry.boundsTree.shapecast({
        intersectsBounds: (box) => box.intersectsBox(rayBox),
        intersectsTriangle: (tri) => {
          const p = tri.closestPointToPoint(localOrigin, new THREE.Vector3());
          const worldP = p.clone().applyMatrix4(colMesh.matrixWorld);
          const dist = downOrigin.distanceTo(worldP);
          if (dist < bestDist && dist <= 2.0) {
            bestDist = dist;
            const n = tri.getNormal(new THREE.Vector3())
              .applyMatrix3(new THREE.Matrix3().getNormalMatrix(colMesh.matrixWorld))
              .normalize();
            groundNormal = n.clone();
          }
        }
      });
    }

    if (groundNormal) {
      const moveOnPlane = desiredMove.clone().projectOnPlane(groundNormal);
      if (moveOnPlane.lengthSq() > 0) {
        playerCapsule.translate(moveOnPlane);
        try {
          resolveCollisions(false);
        } catch (e) {
          console.warn('resolveCollisions (ground project) error:', e);
        }
      }
    }
  }

  // NOTE: yawObject position will be updated from the render loop (interpolated)
}

// ---------- renderer loop with fixed-step physics ----------
renderer.setAnimationLoop(() => {
  // clamp frame delta to avoid huge spikes
  const delta = Math.min(clock.getDelta(), 0.05); // seconds

  // update time-driven materials
  if (grassMaterial && grassMaterial.uniforms && grassMaterial.uniforms.time) grassMaterial.uniforms.time.value += delta;
  if (stemMaterial && stemMaterial.uniforms && stemMaterial.uniforms.time) stemMaterial.uniforms.time.value += delta;
  if (petalMaterial && petalMaterial.uniforms && petalMaterial.uniforms.time) petalMaterial.uniforms.time.value += delta;
  if (water && water.material && water.material.uniforms && water.material.uniforms.time) water.material.uniforms.time.value += delta;

  // animate actors (once each)
  if (Array.isArray(fishSwimmers)) fishSwimmers.forEach((swim) => swim(delta));
  if (Array.isArray(butterflyFliers)) butterflyFliers.forEach((fly) => fly(delta));
  if (typeof updateBubbles === 'function') updateBubbles(delta);

  
  //----------------------//
  // ---- Lens flare ---- //
  //----------------------//

let flareSystem = null;

function createLensFlare() {
  // avoid double creation
  if (flareSystem) return flareSystem;

  // small helpers to build procedural textures
  function makeRingTexture(size = 256, innerR = 0.35, outerR = 0.5, color = '#ffffff', feather = 0.02) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const cx = size / 2, cy = size / 2;
    const grad = ctx.createRadialGradient(cx, cy, innerR * size, cx, cy, outerR * size);
    grad.addColorStop(0, color);
    grad.addColorStop(Math.max(0, 1 - feather), color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(c);
  }

  function makeDiskTexture(size = 256, color = '#ffffff', soft = 0.6) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const cx = size / 2, cy = size / 2;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size/2);
    grad.addColorStop(0, color);
    grad.addColorStop(soft, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,size,size);
    return new THREE.CanvasTexture(c);
  }

  function makeStreakTexture(w = 256, h = 64) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    // horizontal soft streak
    const grad = ctx.createLinearGradient(0, h/2, w, h/2);
    grad.addColorStop(0.0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.8)');
    grad.addColorStop(0.5, 'rgba(255,255,255,1.0)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.8)');
    grad.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,w,h);
    // vertical soft fade to avoid hard edges
    const vGrad = ctx.createLinearGradient(0,0,0,h);
    vGrad.addColorStop(0,'rgba(255,255,255,0)');
    vGrad.addColorStop(0.5,'rgba(255,255,255,1)');
    vGrad.addColorStop(1,'rgba(255,255,255,0)');
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = vGrad;
    ctx.fillRect(0,0,w,h);
    return new THREE.CanvasTexture(c);
  }

  // Textures
  const texMain = makeDiskTexture(256, '#fff', 0.4);
  const texHalo = makeDiskTexture(256, '#ffd9c7', 0.6);
  const texRingA = makeRingTexture(256, 0.42, 0.52, '#ffffff', 0.05);
  const texRingB = makeRingTexture(256, 0.25, 0.42, '#ffccaa', 0.06);
  const texGhost = makeDiskTexture(128, '#ffb3b3', 0.25);
  const texStreak = makeStreakTexture(512, 64);

  // Materials (additive, no depth)
  const matMain = new THREE.MeshBasicMaterial({ map: texMain, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false });
  const matHalo = new THREE.MeshBasicMaterial({ map: texHalo, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false });
  const matRingA = new THREE.MeshBasicMaterial({ map: texRingA, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false });
  const matRingB = new THREE.MeshBasicMaterial({ map: texRingB, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false });
  const matGhost = new THREE.MeshBasicMaterial({ map: texGhost, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false });
  const matStreak = new THREE.MeshBasicMaterial({ map: texStreak, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide });

  // plane geometry for quads
  const quad = new THREE.PlaneGeometry(1, 1);

  // Root group
  const group = new THREE.Group();
  group.name = 'LensFlareGroup';
  scene.add(group);

  // Main glow (closest to camera)
  const main = new THREE.Mesh(quad, matMain);
  main.userData.baseScale = 2.0;
  group.add(main);

  // Halo
  const halo = new THREE.Mesh(quad, matHalo);
  halo.userData.baseScale = 3.6;
  group.add(halo);

  // Streak (an anamorphic horizontal streak)
  const streak = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), matStreak);
  streak.userData.baseScale = 2.6;
  group.add(streak);

  // Chromatic ghost sprites (multiple colored ghosts along the axis)
  const ghosts = [];
  const ghostColors = [0xffe6e6, 0xe6f0ff, 0xfff6e0]; // warm/pale chromas
  for (let i = 0; i < 4; i++) {
    const m = matGhost.clone();
    const mesh = new THREE.Mesh(quad, m);
    mesh.userData.baseScale = 0.6 + i * 0.25;
    mesh.material.color = new THREE.Color(ghostColors[i % ghostColors.length]);
    group.add(mesh);
    ghosts.push(mesh);
  }

  // Concentric rings (3 rings that rotate/pulse)
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const mat = (i % 2 === 0) ? matRingA.clone() : matRingB.clone();
    const ring = new THREE.Mesh(quad, mat);
    ring.userData.baseScale = 0.6 + i * 0.9;
    ring.userData.speed = 0.2 + i * 0.14;
    ring.material.opacity = 0.9;
    group.add(ring);
    rings.push(ring);
  }

  // small lens artifacts (subtle dots along axis)
  const artifacts = [];
  for (let i = 0; i < 5; i++) {
    const m = matGhost.clone();
    const mesh = new THREE.Mesh(quad, m);
    mesh.userData.baseScale = 0.08 + Math.random() * 0.2;
    mesh.material.color = new THREE.Color(0xffffff).lerp(new THREE.Color(0xffccaa), Math.random() * 0.6);
    group.add(mesh);
    artifacts.push(mesh);
  }

  // store system
  flareSystem = {
    group, main, halo, streak, ghosts, rings, artifacts,
    // runtime values reused (to avoid allocations)
    _tmpCamPos: new THREE.Vector3(),
    _tmpBasePos: new THREE.Vector3(),
    _tmpRight: new THREE.Vector3(),
    _tmpUp: new THREE.Vector3(),
    _tmpScreen: new THREE.Vector3(),
    occlusionCached: 0 // smoothed occlusion value
  };

  return flareSystem;
}
//-------------------------------------------------------------------//


  // Respawn if too low
  if (playerCapsule && playerCapsule.end.y < -10) resetPlayerToSpawn();
  if (!playerCapsule) { renderer.render(scene, camera); return; }

  // ---------- Fixed-step physics accumulation & stepping ----------
  accumulator += delta; // seconds

  // snapshot before stepping
  prevPlayerPos.copy(currPlayerPos);

  let steps = 0;
  while (accumulator >= FIXED_STEP_S && steps < MAX_STEPS_PER_FRAME) {
    updatePlayer(FIXED_STEP_S);
    currPlayerPos.copy(playerCapsule.end);
    accumulator -= FIXED_STEP_S;
    steps++;
  }

  // if we hit the cap, drop remaining time to avoid spiral
  if (steps === MAX_STEPS_PER_FRAME) {
    accumulator = 0;
    // optionally: console.warn('Max physics steps/frame reached; dropping leftover time.');
  }

  // interpolation alpha (0..1)
  const alpha = THREE.MathUtils.clamp(accumulator / FIXED_STEP_S, 0, 1);

  // interpolate player position for smooth rendering
  yawObject.position.lerpVectors(prevPlayerPos, currPlayerPos, alpha);

  // final render
  renderer.render(scene, camera);
}); // end animation loop

// -----------------------------
// Resize handler
// -----------------------------
function onResize() {
  sizes.width = window.innerWidth;
  sizes.height = window.innerHeight;
  camera.aspect = sizes.width / sizes.height;
  camera.updateProjectionMatrix();
  renderer.setSize(sizes.width, sizes.height);
}
window.addEventListener("resize", onResize);
})
