import * as THREE from "three";
import { ImprovedNoise } from "three/addons/math/ImprovedNoise.js";

import { HandLandmarker, FilesetResolver, DrawingUtils }
  from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
// -----------------------
// DOM
// -----------------------
const barSteer = document.getElementById("barSteer");
const barThrot = document.getElementById("barThrot");
const txtSteer = document.getElementById("txtSteer");
const txtThrot = document.getElementById("txtThrot");
const canvas = document.getElementById("gameCanvas");
const statusEl = document.getElementById("status");
const hudEl = document.getElementById("hud");
const btnStart = document.getElementById("btnStart");
const btnCalibrate = document.getElementById("btnCalibrate");
const chkDebug = document.getElementById("chkDebug");
const debugWrap = document.getElementById("debugWrap");
const videoEl = document.getElementById("webcam");
const debugCanvas = document.getElementById("debugCanvas");
const debugCtx = debugCanvas.getContext("2d");


// -----------------------
// Hand Tracking (MediaPipe)
// -----------------------
let handLandmarker = null;
let drawingUtils = null;
let runningMode = "VIDEO";
let lastVideoTime = -1;
let calibrated = false;
let stableFrames = 0;

let calibSumX = 0;
let calibSumY = 0;

let lastP = null;
let missingHandsFrames = 0;

const STABLE_N = 25;     // ~0.4 seconds
const STABLE_EPS = 0.015;



// Baseline calibration (so your “neutral” hand position is comfortable)
let calib = {
  centerX: 0.5,
  centerY: 0.5,
  rangeX: 0.22,   // smaller = more sensitive
  rangeY: 0.22
};

let control = {
  steer: 0,   // -1..1
  throttle: 0 // -1..1
};

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }


async function setupWebcam() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: "user" },
    audio: false
  });
  videoEl.srcObject = stream;
  await videoEl.play();
}

async function setupHandLandmarker() {
  // This setup pattern is documented by Google AI Edge for web usage. :contentReference[oaicite:3]{index=3}
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  // Model URL used in MediaPipe’s own demo codepen (hosted on Google storage). :contentReference[oaicite:4]{index=4}
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU"
    },
    runningMode,
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  drawingUtils = new DrawingUtils(debugCtx);
}

// Pick one “primary” hand point to drive with: wrist (landmark 0)
function getPrimaryHandPoint(result) {
  const hands = result?.landmarks;
  if (!hands || hands.length === 0) return null;

  // If 2 hands: average both wrists for smoother driving
  if (hands.length >= 2) {
    const w0 = hands[0][0];
    const w1 = hands[1][0];
    return {
      x: (w0.x + w1.x) * 0.5,
      y: (w0.y + w1.y) * 0.5
    };
  }

  const w = hands[0][0];
  return { x: w.x, y: w.y };
}

function updateControlFromHands(result) {
  const p = getPrimaryHandPoint(result);
  lastHandPoint = p;
  if (!p) {

    missingHandsFrames++;

    if (missingHandsFrames > 10) {
      calibrated = false;
      stableFrames = 0;
      calibSumX = 0;
      calibSumY = 0;
      lastP = null;

      statusEl.textContent = "Show hands to begin";
    }

    control.steer = lerp(control.steer, 0, 0.08);
    control.throttle = lerp(control.throttle, 0, 0.08);
    return;
  }

  missingHandsFrames = 0;

  // Convert webcam normalized coords (0..1) into steer/throttle -1..1 around calibrated center
  const rawSteer = (p.x - calib.centerX) / calib.rangeX;
  const rawThrottle = (calib.centerY - p.y) / calib.rangeY; // up = faster

  const targetSteer = clamp(rawSteer, -1, 1);
  const targetThrottle = clamp(rawThrottle, -1, 1);

  const dead = 0.08;
    const dz = (v) => (Math.abs(v) < dead ? 0 : v);

    const targetSteerDZ = dz(targetSteer);
    const targetThrottleDZ = dz(targetThrottle);

     // Auto calibration: hold hands steady
if (!calibrated) {

  if (lastP) {

    const dx = Math.abs(p.x - lastP.x);
    const dy = Math.abs(p.y - lastP.y);

    if (dx < STABLE_EPS && dy < STABLE_EPS) {

      stableFrames++;
      calibSumX += p.x;
      calibSumY += p.y;

    } else {

      stableFrames = 0;
      calibSumX = 0;
      calibSumY = 0;

    }

    const pct = Math.floor((stableFrames / STABLE_N) * 100);
    statusEl.textContent = `Hold hands steady… calibrating (${Math.min(pct,100)}%)`;

    if (stableFrames >= STABLE_N) {

      calib.centerX = calibSumX / stableFrames;
      calib.centerY = calibSumY / stableFrames;

      calibrated = true;

      statusEl.textContent = "Calibrated ✅ Press Start";
    }

  } else {

    statusEl.textContent = "Hold hands steady… calibrating";

  }

  lastP = { x: p.x, y: p.y };

} else {

  lastP = { x: p.x, y: p.y };

}

    control.steer = lerp(control.steer, targetSteerDZ, 0.18);
    control.throttle = lerp(control.throttle, targetThrottleDZ, 0.12);
}

function drawDebug(result) {
  if (!chkDebug.checked) return;

  debugCanvas.width = videoEl.videoWidth || 640;
  debugCanvas.height = videoEl.videoHeight || 480;

  debugCtx.save();
  // Mirror like a selfie
  debugCtx.scale(-1, 1);
  debugCtx.drawImage(videoEl, -debugCanvas.width, 0, debugCanvas.width, debugCanvas.height);
  debugCtx.restore();

  const hands = result?.landmarks || [];
  for (const lm of hands) {
    drawingUtils.drawLandmarks(lm, { radius: 3 });
    drawingUtils.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS);
  }

  // Show control values
  debugCtx.fillStyle = "rgba(0,0,0,0.55)";
  debugCtx.fillRect(10, 10, 200, 58);
  debugCtx.fillStyle = "white";
  debugCtx.font = "14px system-ui";
  debugCtx.fillText(`steer: ${control.steer.toFixed(2)}`, 18, 34);
  debugCtx.fillText(`throttle: ${control.throttle.toFixed(2)}`, 18, 54);
}

function maybeToggleDebugUI() {
  debugWrap.classList.toggle("hidden", !chkDebug.checked);
}

// -----------------------
// Three.js Game
// -----------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05060a, 0.018);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);
camera.position.set(0, 1.1, 0); // will be attached to rover cockpit

// Lights
scene.add(new THREE.AmbientLight(0x8aa1ff, 0.35));
const dir = new THREE.DirectionalLight(0xffffff, 0.9);
dir.position.set(10, 20, 10);
scene.add(dir);

// Starfield
(function makeStars() {
  const geo = new THREE.BufferGeometry();
  const count = 1800;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 220;
    const x = (Math.random() - 0.5) * r;
    const y = (Math.random() - 0.2) * r;
    const z = (Math.random() - 0.5) * r;
    positions[i * 3 + 0] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, sizeAttenuation: true });
  const stars = new THREE.Points(geo, mat);
  scene.add(stars);
})();

// Terrain (procedural “planet” surface)
const terrain = (() => {
  const size = 220;
  const segments = 180;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const noise = new ImprovedNoise();
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h =
      noise.noise(x * 0.03, z * 0.03, 0) * 1.4 +
      noise.noise(x * 0.09, z * 0.09, 2) * 0.4;
    pos.setY(i, h);
  }
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: 0x3b2a4a,
    roughness: 0.95,
    metalness: 0.0
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
})();

// Rover
const rover = new THREE.Group();
scene.add(rover);

// Body
const body = new THREE.Mesh(
  new THREE.BoxGeometry(1.2, 0.35, 1.6),
  new THREE.MeshStandardMaterial({ color: 0xb9c2ff, roughness: 0.6, metalness: 0.2 })
);
body.position.set(0, 0.5, 0);
rover.add(body);

// Cockpit frame (gives “inside rover” vibe)
const cockpit = new THREE.Mesh(
  new THREE.TorusGeometry(0.55, 0.06, 10, 24),
  new THREE.MeshStandardMaterial({ color: 0x1a1f3a, roughness: 0.4, metalness: 0.4 })
);
cockpit.rotation.y = Math.PI / 2;
cockpit.position.set(0, 0.95, 0.25);
rover.add(cockpit);

// “Dashboard” plane
const dash = new THREE.Mesh(
  new THREE.PlaneGeometry(0.8, 0.25),
  new THREE.MeshStandardMaterial({ color: 0x0a0e1f, roughness: 0.9, metalness: 0.1 })
);
dash.position.set(0, 0.82, 0.65);
dash.rotation.x = -0.45;
rover.add(dash);

// Attach camera inside cockpit (slightly back and up)
rover.add(camera);
camera.position.set(0, 1.05, 0.2);

// Rover state
let roverPos = new THREE.Vector3(0, 0, 0);
let roverYaw = 0;
let roverSpeed = 0;
let lastHandPoint = null;

// Simple “ray height” from terrain by sampling nearest vertex-ish via raycast
const raycaster = new THREE.Raycaster();
function terrainHeightAt(x, z) {
  raycaster.set(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));
  const hits = raycaster.intersectObject(terrain, false);
  return hits.length ? hits[0].point.y : 0;
}

// Checkpoints (5 rings) + finish
const checkpoints = [];
const checkpointCount = 5;
const path = [
  new THREE.Vector3(0, 0, -12),
  new THREE.Vector3(6, 0, -28),
  new THREE.Vector3(-10, 0, -42),
  new THREE.Vector3(10, 0, -60),
  new THREE.Vector3(-2, 0, -78),
  new THREE.Vector3(0, 0, -96) // finish
];

function makeGate(color) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.2, 0.12, 10, 34),
    new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.3, emissive: color, emissiveIntensity: 0.25 })
  );
  ring.rotation.x = Math.PI / 2;
  g.add(ring);

  const poleMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.14, 3.6, 10);
  const p1 = new THREE.Mesh(poleGeo, poleMat);
  const p2 = new THREE.Mesh(poleGeo, poleMat);
  p1.position.set(-2.2, -1.4, 0);
  p2.position.set( 2.2, -1.4, 0);
  g.add(p1, p2);

  return g;
}

let finishGate = null;
let nextCheckpointIdx = 0;
let navArrow = null;

function getNextTargetPos(){
  if (nextCheckpointIdx < checkpointCount) return checkpoints[nextCheckpointIdx].position;
  return finishGate.position;
}

let pathLine = null;

function buildPathLine() {
  const pts = path.map(p => new THREE.Vector3(p.x, terrainHeightAt(p.x,p.z)+0.05, p.z));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color: 0x7cffc8 });
  pathLine = new THREE.Line(geo, mat);
  scene.add(pathLine);
}

let beacon = null;

function makeBeacon() {
  const geo = new THREE.CylinderGeometry(0.15, 0.15, 12, 10);
  const mat = new THREE.MeshStandardMaterial({ color: 0x7cffc8, emissive: 0x7cffc8, emissiveIntensity: 0.25 });
  beacon = new THREE.Mesh(geo, mat);
  scene.add(beacon);
}

(function buildCourse() {
  for (let i = 0; i < checkpointCount; i++) {
    const gate = makeGate(0x7cffc8);
    const p = path[i + 1].clone();
    p.y = terrainHeightAt(p.x, p.z) + 1.6;
    gate.position.copy(p);

    // face roughly down the path
    const look = path[i + 2] ? path[i + 2] : path[i + 1];
    gate.lookAt(look.x, gate.position.y, look.z);

    scene.add(gate);
    checkpoints.push(gate);
  }

  buildPathLine();

  finishGate = makeGate(0xffd27c);
  const fp = path[path.length - 1].clone();
  fp.y = terrainHeightAt(fp.x, fp.z) + 1.6;
  finishGate.position.copy(fp);
  finishGate.lookAt(0, finishGate.position.y, fp.z - 10);
  scene.add(finishGate);

    navArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0,0,-1),
    new THREE.Vector3(0,2,0),
    6,
    0x7cffc8
    );
    scene.add(navArrow);
    

  // starting point
  roverPos.copy(path[0]);
  roverPos.y = terrainHeightAt(roverPos.x, roverPos.z) + 0.35;
  rover.position.copy(roverPos);
  makeBeacon();
})();

// Game loop/time
let gameRunning = false;
let startedAt = 0;
let timeLimitMs = 90_000;

function updateHUD() {
  if (!gameRunning) {
    hudEl.textContent = `Time: -- | Checkpoints: ${nextCheckpointIdx}/${checkpointCount}`;
    return;
  }
  const t = performance.now() - startedAt;
  const remain = Math.max(0, timeLimitMs - t);
  const sec = (remain / 1000).toFixed(1);
  hudEl.textContent = `Time: ${sec}s | Checkpoints: ${nextCheckpointIdx}/${checkpointCount}`;
}

function resetGame() {
  nextCheckpointIdx = 0;
  roverYaw = 0;
  roverSpeed = 0;
  roverPos.copy(path[0]);
  roverPos.y = terrainHeightAt(roverPos.x, roverPos.z) + 0.35;
  rover.position.copy(roverPos);
  rover.rotation.set(0, roverYaw, 0);


  updateHUD();
}

function winGame() {
  gameRunning = false;
  statusEl.textContent = "FINISHED ✅";
  statusEl.className = "pill";
}

function loseGame() {
  gameRunning = false;
  statusEl.textContent = "TIME UP ⏳";
  statusEl.className = "pill";
}

function checkGateHit(gate) {
  const d = rover.position.distanceTo(gate.position);
  return d < 2.4;
}

function setGateColor(gate, colorHex) {
  gate.traverse(obj => {
    if (obj.isMesh && obj.material) {
      obj.material.emissive?.setHex?.(colorHex);
      obj.material.color?.setHex?.(colorHex);
    }
  });
}

// Apply driving physics based on hand controls
function updateRover(dt) {
  // steer affects yaw
  const steerRate = 1.65; // rad/s at full steer
  roverYaw += control.steer * steerRate * dt;

  // throttle controls acceleration
  const accel = 4.2;     // units/s^2
  const drag = 1.9;      // slows down naturally
  roverSpeed += control.throttle * accel * dt;
  roverSpeed -= roverSpeed * drag * dt;

  if (Math.abs(control.throttle) > 0.08 && Math.abs(roverSpeed) < 0.4) {
  roverSpeed = 0.4 * Math.sign(control.throttle);
}

  roverSpeed = clamp(roverSpeed, -3.5, 7.2);

  const forward = new THREE.Vector3(Math.sin(roverYaw), 0, Math.cos(roverYaw));
  roverPos.addScaledVector(forward, roverSpeed * dt);

  // keep rover floating just above terrain
  roverPos.y = terrainHeightAt(roverPos.x, roverPos.z) + 0.35;

  rover.position.copy(roverPos);
  rover.rotation.set(0, roverYaw, 0);

  // slight camera bob
  camera.position.y = 1.05 + Math.sin(performance.now() * 0.004) * 0.01;
}

let lastT = performance.now();

async function handLoop() {
  if (!handLandmarker) return;

  const now = performance.now();
  if (videoEl.currentTime !== lastVideoTime) {
    // detectForVideo(video, timestamp) pattern is part of the web guide. :contentReference[oaicite:5]{index=5}
    const res = handLandmarker.detectForVideo(videoEl, now);
    updateControlFromHands(res);
    drawDebug(res);
    lastVideoTime = videoEl.currentTime;
  }

  requestAnimationFrame(handLoop);
}

function updateMeters(){
  if (!barSteer || !barThrot) return;

  // steer/throttle are -1..1; convert to 0..100%
  const s = (control.steer + 1) * 50;
  const t = (control.throttle + 1) * 50;

    const guide = document.getElementById("steerGuide");
    if (guide) {
    // tilt the wheel based on steer (purely visual)
    const wheel = guide.querySelector(".wheel");
    if (wheel) wheel.style.transform = `translate(-50%,-50%) rotate(${control.steer * 20}deg)`;
    }

  barSteer.style.width = `${clamp(s,0,100)}%`;
  barThrot.style.width = `${clamp(t,0,100)}%`;

  txtSteer.textContent = control.steer.toFixed(2);
  txtThrot.textContent = control.throttle.toFixed(2);
}

function renderLoop() {
  const now = performance.now();
  const dt = Math.min(0.033, (now - lastT) / 1000);
  lastT = now;

  if (gameRunning) {
    updateRover(dt);
    const target = getNextTargetPos();
    const from = rover.position.clone();
    from.y += 2.0;

    const dir = target.clone().sub(from);
    dir.y = 0;
    if (dir.length() > 0.001) dir.normalize();

    if (navArrow) {
    navArrow.position.copy(from);
    navArrow.setDirection(dir);
    }

    if (beacon) {
    beacon.position.copy(target);
    beacon.position.y = terrainHeightAt(target.x, target.z) + 6;
    }
    // gates logic
    if (nextCheckpointIdx < checkpointCount) {
      const gate = checkpoints[nextCheckpointIdx];
      if (checkGateHit(gate)) {
        setGateColor(gate, 0x4cff6e);
        nextCheckpointIdx++;
      }
    } else {
      if (checkGateHit(finishGate)) {
        winGame();
      }
    }

    // time limit
    if (now - startedAt > timeLimitMs) {
      loseGame();
    }
  }
  updateMeters();
  updateHUD();
  renderer.render(scene, camera);
  requestAnimationFrame(renderLoop);
}



// -----------------------
// UI Handlers
// -----------------------
btnStart.addEventListener("click", () => {
  if (!calibrated) {
    statusEl.textContent = "Hold hands steady first…";
    return;
  }
  resetGame();
  gameRunning = true;
  startedAt = performance.now();
  statusEl.textContent = "Go!";
});

btnCalibrate.addEventListener("click", () => {
  if (lastHandPoint) {
    calib.centerX = lastHandPoint.x;
    calib.centerY = lastHandPoint.y;
    statusEl.textContent = "Calibrated ✅ (hands centered)";
  } else {
    statusEl.textContent = "No hands detected 👋";
  }
});

chkDebug.addEventListener("change", maybeToggleDebugUI);

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// -----------------------
// Boot
// -----------------------
(async function boot() {
  try {
    statusEl.textContent = "Requesting webcam…";
    await setupWebcam();

    statusEl.textContent = "Loading hand tracker…";
    await setupHandLandmarker();

    statusEl.textContent = "Show hands to begin";
    maybeToggleDebugUI();
    resetGame();

    handLoop();
    renderLoop();
  } catch (e) {
    console.error(e);
    statusEl.textContent = "Error: webcam/permissions";
    hudEl.textContent = "If camera fails: use http://localhost (not file://) and allow permissions.";
  }
})();