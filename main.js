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
const modeEl = document.getElementById("controlMode");
const voiceHintEl = document.getElementById("voiceHint");
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

let controlMode = "hands"; // hands, keyboard, voice
let voiceThrottle = 0;
let voiceSteer = 0;
let keysPressed = {};
let speechRecognizer = null;

function setControlMode(mode) {
  controlMode = mode;
  modeEl.textContent = `Mode: ${mode.toUpperCase()}`;
  statusEl.textContent = `Control mode: ${mode}`;
}

function setVoiceHint(text) {
  if (voiceHintEl) voiceHintEl.textContent = text;
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function updateControlFromKeyboard() {
  const steerTarget = (keysPressed.ArrowRight ? 1 : 0) + (keysPressed.ArrowLeft ? -1 : 0);
  const throttleTarget = keysPressed.ArrowUp ? 1 : keysPressed.ArrowDown ? -0.6 : 0;

  control.steer = lerp(control.steer, steerTarget, 0.22);
  control.throttle = lerp(control.throttle, throttleTarget, 0.18);
}

function updateControlFromVoice() {
  // Voice controls speed only (throttle). Steering is hand-based.
  control.throttle = lerp(control.throttle, voiceThrottle, 0.16);
}

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
    // Hand no longer controls throttle; voice does.
    return;
  }

  missingHandsFrames = 0;

  // Convert webcam normalized coords (0..1) into steer/throttle -1..1 around calibrated center
  const rawSteer = (p.x - calib.centerX) / calib.rangeX;
  const targetSteer = clamp(rawSteer, -1, 1);

  const dead = 0.08;
    const dz = (v) => (Math.abs(v) < dead ? 0 : v);

    const targetSteerDZ = dz(targetSteer);

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
    // throttle remains voice-managed; do not touch here.
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
scene.background = new THREE.Color(0x0b1426);
scene.fog = new THREE.FogExp2(0x0b1426, 0.008);

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
    color: 0x2a2f47,
    roughness: 0.86,
    metalness: 0.12,
    emissive: 0x001122,
    emissiveIntensity: 0.08
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
})();

function addEnhancedScenery() {
  const roadMaterial = new THREE.LineDashedMaterial({ color: 0x66c0ff, linewidth: 2, scale: 1, dashSize: 0.7, gapSize: 0.4 });
  const roadPoints = [
    new THREE.Vector3(0, 0.02, -2),
    new THREE.Vector3(0, 0.02, -25),
    new THREE.Vector3(0, 0.02, -48),
    new THREE.Vector3(0, 0.02, -70),
    new THREE.Vector3(0, 0.02, -92)
  ];
  const roadLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(roadPoints), roadMaterial);
  roadLine.computeLineDistances();
  scene.add(roadLine);

  for (let i = 0; i < 16; i++) {
    const b = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 1.5, 18),
      new THREE.MeshStandardMaterial({ color: 0x88b0ff, roughness: 0.25, metalness: 0.5 })
    );
    const z = -10 - i * 5;
    b.position.set((i % 2 ? 4 : -4), 0.75, z);
    b.rotation.x = Math.PI / 2;
    b.scale.setScalar(1 + Math.sin(i * 0.5) * 0.25);
    scene.add(b);
  }

  for (let i = 0; i < 14; i++) {
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.9 + Math.random() * 0.6),
      new THREE.MeshStandardMaterial({ color: 0x425275, roughness: 0.7, metalness: 0.2 })
    );
    const z = -4 - i * 6;
    rock.position.set((Math.random() - 0.5) * 16, 0.25 + Math.random() * 0.3, z);
    rock.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
    scene.add(rock);
  }
}

addEnhancedScenery();

// Rover
const rover = new THREE.Group();
scene.add(rover);

// Body
const body = new THREE.Mesh(
  new THREE.BoxGeometry(1.2, 0.35, 1.6),
  new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.28, metalness: 0.62 })
);
body.position.set(0, 0.5, 0);
rover.add(body);

// BMW style stripes
const stripe1 = new THREE.Mesh(
  new THREE.BoxGeometry(0.06, 0.36, 1.6),
  new THREE.MeshStandardMaterial({ color: 0x093774, roughness: 0.35, metalness: 0.8 })
);
stripe1.position.set(-0.34, 0, 0);
rover.add(stripe1);

const stripe2 = stripe1.clone();
stripe2.position.set(0.34, 0, 0);
rover.add(stripe2);

const stripe3 = new THREE.Mesh(
  new THREE.BoxGeometry(0.04, 0.36, 1.6),
  new THREE.MeshStandardMaterial({ color: 0x75b0d7, roughness: 0.35, metalness: 0.8 })
);
stripe3.position.set(0, 0, 0);
rover.add(stripe3);

// BMW circular logo badge
const logo = new THREE.Mesh(
  new THREE.CircleGeometry(0.12, 32),
  new THREE.MeshStandardMaterial({ color: 0x0b2e63, emissive: 0x1f5aac, emissiveIntensity: 0.5, roughness: 0.2, metalness: 0.7 })
);
logo.position.set(0, 0.77, 0.82);
logo.rotation.x = -Math.PI / 2;
rover.add(logo);

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
let roverYaw = 0; // face along -Z by default in forward vector logic
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
  roverYaw = 0; // face toward the track (forward vector points -Z)
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
  // steer affects yaw. positive steer/right rotates clockwise from top-down (turn right).
  const steerRate = 0.55; // rad/s at full steer (reduced for smooth cornering)
  roverYaw += control.steer * steerRate * dt;

  // throttle controls acceleration
  const accel = 4.2;     // units/s^2
  const drag = 0.3;      // reduced drag so car feels responsive
  roverSpeed += control.throttle * accel * dt;
  roverSpeed -= roverSpeed * drag * dt;

  if (Math.abs(control.throttle) > 0.08 && Math.abs(roverSpeed) < 0.4) {
  roverSpeed = 0.4 * Math.sign(control.throttle);
}

  roverSpeed = clamp(roverSpeed, -3.5, 7.2);

  // In voice mode with forward throttle, never let speed go negative
  if (controlMode === "voice" && voiceThrottle > 0) {
    roverSpeed = Math.max(roverSpeed, 0.1);
  }

  // Get the direction the rover is visually facing
  const forward = new THREE.Vector3(0, 0, 1);
  rover.getWorldDirection(forward);
  forward.negate(); // negate to match intended direction
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
    if (controlMode === "keyboard") {
      updateControlFromKeyboard();
    } else if (controlMode === "voice") {
      updateControlFromVoice();
    }
    // hand tracking still drives steering in all modes (but not throttle)
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

window.addEventListener("keydown", (e) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key)) {
    e.preventDefault();
    keysPressed[e.key] = true;
    setControlMode("keyboard");
  }
  if (e.key.toLowerCase() === "s") {
    // quick manual stop
    control.throttle = 0;
    control.steer = 0;
    setControlMode("keyboard");
  }
});

window.addEventListener("keyup", (e) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key)) {
    keysPressed[e.key] = false;
  }
});

function setupVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn("Speech Recognition API not supported");
    return;
  }

  speechRecognizer = new SpeechRecognition();
  speechRecognizer.continuous = true;
  speechRecognizer.interimResults = false;
  speechRecognizer.lang = "en-US";

  speechRecognizer.onstart = () => {
    statusEl.textContent = "Voice control ready (say 'drive'/'stop'/'faster'/'slower')";
    setVoiceHint("Say 'drive', 'stop', 'faster', 'slower', 'left', 'right'");
  };

  speechRecognizer.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript.trim().toLowerCase();
      let changed = false;

      if (text.includes("drive")) {
        setControlMode("voice");
        voiceThrottle = 0.2;
        voiceSteer = 0;
        roverSpeed = 0; // reset speed on new drive command
        if (!gameRunning) {
          resetGame();
          gameRunning = true;
          startedAt = performance.now();
        }
        statusEl.textContent = "Voice: DRIVE";
        changed = true;
      } else if (text.includes("stop")) {
        setControlMode("voice");
        voiceThrottle = 0;
        voiceSteer = 0;
        gameRunning = false;
        statusEl.textContent = "Voice: STOP";
        changed = true;
      }
      if (text.includes("faster")) {
        setControlMode("voice");
        voiceThrottle = clamp(voiceThrottle + 0.2, 0, 1);
        statusEl.textContent = `Voice: FASTER (${voiceThrottle.toFixed(2)})`;
        changed = true;
      } else if (text.includes("slower")) {
        setControlMode("voice");
        voiceThrottle = clamp(voiceThrottle - 0.2, 0, 1);
        statusEl.textContent = `Voice: SLOWER (${voiceThrottle.toFixed(2)})`;
        changed = true;
      }
      if (text.includes("left")) {
        setControlMode("voice");
        voiceSteer = -0.7;
        statusEl.textContent = "Voice: LEFT";
        changed = true;
      }
      if (text.includes("right")) {
        setControlMode("voice");
        voiceSteer = 0.7;
        statusEl.textContent = "Voice: RIGHT";
        changed = true;
      }

      if (changed) {
        gameRunning = true;
      }
    }
  };

  speechRecognizer.onerror = (e) => {
    console.warn("Speech recognition error", e);
    statusEl.textContent = "Voice recognition error";
    setVoiceHint("");
  };

  speechRecognizer.onend = () => {
    // restart automatically
    setTimeout(() => {
      if (speechRecognizer) speechRecognizer.start();
    }, 500);
  };

  speechRecognizer.start();
}

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

    setControlMode("hands");
    setVoiceHint("Voice: say 'drive'/'stop'/'faster'/'slower'/'left'/'right' (if supported)");

    setupVoiceRecognition();
    handLoop();
    renderLoop();
  } catch (e) {
    console.error(e);
    statusEl.textContent = "Error: webcam/permissions";
    hudEl.textContent = "If camera fails: use http://localhost (not file://) and allow permissions.";
  }
})();