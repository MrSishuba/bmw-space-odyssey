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
const leftHandShellEl = document.querySelector(".leftHandShell");
const rightHandShellEl = document.querySelector(".rightHandShell");

const steerGuideEl = document.getElementById("steerGuide");
const slotLeftEl = document.getElementById("slotLeft");
const slotRightEl = document.getElementById("slotRight");
const guideStatusEl = document.getElementById("guideStatus");
const leftHandVisualEl = document.getElementById("leftHandVisual");
const rightHandVisualEl = document.getElementById("rightHandVisual");

const btnResetGame = document.getElementById("btnResetGame");
const btnToggleReverse = document.getElementById("btnToggleReverse");
const btnShutdown = document.getElementById("btnShutdown");
const btnTurbo = document.getElementById("btnTurbo");
const btnFire = document.getElementById("btnFire");
const btnRespawn = document.getElementById("btnRespawn");

const aiPromptEl = document.getElementById("aiPrompt");
const countdownWrapEl = document.getElementById("countdownWrap");
const countdownTextEl = document.getElementById("countdownText");
const speedCursorEl = document.getElementById("speedCursor");

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

let lastHandState = { left: null, right: null, center: null };
let gripCalib = { left: null, right: null };
let gripState = { leftOn: false, rightOn: false, bothOn: false };

let steerBaseAngle = 0;

const STABLE_N = 25;     // ~0.4 seconds
const STABLE_EPS = 0.015;


const GRIP_LOCK_DIST = 0.14;
const STEER_MAX_ANGLE = 0.38;   // smaller = more responsive steering
const STEER_SMOOTH = 0.42;      // bigger = reacts faster



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

let roverMode = "idle"; // idle | calibrated | speed_select | engaged | shutdown
let reverseEnabled = false;
let turboActive = false;
let turboUntil = 0;
let lastCheckpointIndex = 0;
let selectedSpeed = 0.35;

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function setAIPrompt(text) {
  if (aiPromptEl) aiPromptEl.textContent = text;
}

function setCountdownVisible(show) {
  if (!countdownWrapEl) return;
  countdownWrapEl.classList.toggle("hidden", !show);
}

function updateSpeedCursorUI() {
  if (!speedCursorEl) return;

  const scaleEl = document.querySelector(".speedScale");
  if (!scaleEl) return;

  const pct = clamp(selectedSpeed, 0, 1);
  const usableHeight = scaleEl.clientHeight - 64; // padding for top/bottom
  const bottomPx = 24 + pct * usableHeight;

  speedCursorEl.style.bottom = `${bottomPx}px`;
}

function setReverseUI() {
  if (!btnToggleReverse) return;
  btnToggleReverse.textContent = reverseEnabled ? "ON" : "OFF";
}

function shutdownRover() {
  roverMode = "shutdown";
  gameRunning = false;
  control.throttle = 0;
  roverSpeed = 0;
  selectedSpeed = 0;
  updateSpeedCursorUI();
  setAIPrompt("ROVER SHUTDOWN");
  setCountdownVisible(false);
}

async function engageCountdown() {
  setCountdownVisible(true);
  roverMode = "engaging";

  const dots = Array.from(document.querySelectorAll(".countDot"));
  const steps = [3, 2, 1];

  for (let i = 0; i < steps.length; i++) {
    if (countdownTextEl) countdownTextEl.textContent = `Engaging rover in… ${steps[i]}`;
    dots.forEach((d, idx) => d.classList.toggle("active", idx === i));
    await new Promise(r => setTimeout(r, 700));
  }

  setCountdownVisible(false);
  roverMode = "engaged";
  gameRunning = true;
  startedAt = performance.now();
  setAIPrompt("ROVER ENGAGED");
}

function respawnLastCheckpoint() {
  const idx = Math.max(0, Math.min(lastCheckpointIndex, path.length - 1));
  const p = path[idx].clone();
  roverPos.copy(p);
  roverPos.y = terrainHeightAt(roverPos.x, roverPos.z) + 0.35;
  rover.position.copy(roverPos);
  roverSpeed = 0;
  roverYaw = 0;
}

function getSpeedFromScreenY(clientY) {
  const scaleEl = document.querySelector(".speedScale");
  if (!scaleEl) return selectedSpeed;

  const rect = scaleEl.getBoundingClientRect();
  const y = clamp(clientY, rect.top, rect.bottom);
  const pctFromBottom = 1 - ((y - rect.top) / rect.height);

  return clamp(pctFromBottom, 0, 1);
}

function setSelectedSpeedFromPointer(clientY) {
  selectedSpeed = getSpeedFromScreenY(clientY);
  updateSpeedCursorUI();

  if (selectedSpeed < 0.12) {
    setAIPrompt("ROVER SPEED: LOW");
  } else if (selectedSpeed < 0.45) {
    setAIPrompt("ROVER SPEED: CRUISE");
  } else if (selectedSpeed < 0.75) {
    setAIPrompt("ROVER SPEED: FAST");
  } else {
    setAIPrompt("ROVER SPEED: MAX");
  }
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

function distNorm(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function paintGrip(el, state) {
  if (!el) return;
  el.classList.remove("idle", "active", "missing");
  el.classList.add(state);
}

function updateSteeringGuideUI() {
  if (!steerGuideEl) return;

  const wheelEl = steerGuideEl.querySelector(".wheel");
  if (wheelEl) {
    wheelEl.style.transform = `translate(-50%,-50%) rotate(${control.steer * 22}deg)`;
  }

 if (leftHandShellEl) {
  leftHandShellEl.style.transform = `rotate(${20 + control.steer * 10}deg) translateY(${Math.abs(control.steer) * -4}px)`;
}

if (rightHandShellEl) {
  rightHandShellEl.style.transform = `rotate(${-20 + control.steer * 10}deg) translateY(${Math.abs(control.steer) * -4}px)`;
}

  steerGuideEl.classList.remove("locked");
  leftHandShellEl?.classList.remove("active");
  rightHandShellEl?.classList.remove("active");

  if (!calibrated) {
    paintGrip(slotLeftEl, "idle");
    paintGrip(slotRightEl, "idle");
    leftHandVisualEl?.classList.remove("active");
    rightHandVisualEl?.classList.remove("active");
    if (guideStatusEl) guideStatusEl.textContent = "Show both hands";
    return;
  }

  if (!gripCalib.left || !gripCalib.right) {
  paintGrip(slotLeftEl, "missing");
  paintGrip(slotRightEl, "missing");
  leftHandVisualEl?.classList.remove("active");
  rightHandVisualEl?.classList.remove("active");
  if (guideStatusEl) guideStatusEl.textContent = "Use both hands + recalibrate";
  return;
}

  gripState = getGripLockState();

  paintGrip(slotLeftEl, gripState.leftOn ? "active" : "missing");
  paintGrip(slotRightEl, gripState.rightOn ? "active" : "missing");

  leftHandVisualEl?.classList.toggle("active", gripState.leftOn);
  rightHandVisualEl?.classList.toggle("active", gripState.rightOn);

  if (gripState.leftOn) leftHandShellEl?.classList.add("active");
  if (gripState.rightOn) rightHandShellEl?.classList.add("active");

  if (gripState.bothOn) {
    steerGuideEl.classList.add("locked");
    if (guideStatusEl) guideStatusEl.textContent = "Steering locked";
  } else if (lastHandState.left || lastHandState.right) {
    if (guideStatusEl) guideStatusEl.textContent = "Adjust hand position";
  } else {
    if (guideStatusEl) guideStatusEl.textContent = "Show both hands";
  }
}

function getHandState(result) {
  const hands = result?.landmarks || [];
  const handednesses = result?.handednesses || [];
  const state = { left: null, right: null, center: null };
  const loose = [];

  for (let i = 0; i < hands.length; i++) {
    const wrist = hands[i][0];
    const point = { x: wrist.x, y: wrist.y };

    const label =
      handednesses?.[i]?.[0]?.categoryName?.toLowerCase?.() ||
      handednesses?.[i]?.[0]?.displayName?.toLowerCase?.() ||
      "";

    if (label.includes("left")) {
      state.left = point;
    } else if (label.includes("right")) {
      state.right = point;
    } else {
      loose.push(point);
    }
  }

  if (!state.left || !state.right) {
    const all = [state.left, state.right, ...loose]
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);

    if (all.length === 1) {
      state.left = all[0];
    } else if (all.length >= 2) {
      state.left = all[0];
      state.right = all[all.length - 1];
    }
  }

  const pts = [state.left, state.right].filter(Boolean);
  if (pts.length) {
    state.center = {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
  }

  return state;
}

function normalizeAngle(rad) {
  while (rad > Math.PI) rad -= Math.PI * 2;
  while (rad < -Math.PI) rad += Math.PI * 2;
  return rad;
}

function getWheelAngle(state) {
  if (!state?.left || !state?.right) return null;
  return Math.atan2(
    state.right.y - state.left.y,
    state.right.x - state.left.x
  );
}

function getGripLockState() {
  if (!gripCalib.left || !gripCalib.right) {
    return { leftOn: false, rightOn: false, bothOn: false };
  }

  const leftOn = distNorm(lastHandState.left, gripCalib.left) < GRIP_LOCK_DIST;
  const rightOn = distNorm(lastHandState.right, gripCalib.right) < GRIP_LOCK_DIST;

  return {
    leftOn,
    rightOn,
    bothOn: leftOn && rightOn
  };
}

// Pick one “primary” hand point to drive with: wrist (landmark 0)
function getPrimaryHandPoint(result) {
  return getHandState(result).center;
}

function updateControlFromHands(result) {
  const handState = getHandState(result);
  lastHandState = handState;

  const p = handState.center;
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
    updateSteeringGuideUI();

    return;
  }

  missingHandsFrames = 0;

 

    // Steering now comes from wheel rotation between left/right hands
    let targetSteer = 0;

gripState = getGripLockState();

const currentWheelAngle = getWheelAngle(handState);

  if (calibrated && gripState.bothOn && currentWheelAngle !== null) {
    const angleDelta = normalizeAngle(currentWheelAngle - steerBaseAngle);
    targetSteer = clamp(angleDelta / STEER_MAX_ANGLE, -1, 1);
  } else {
    targetSteer = 0;
  }

  const dead = 0.035;
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

    if (handState.left && handState.right) {
      gripCalib.left = { ...handState.left };
      gripCalib.right = { ...handState.right };

      const angle = getWheelAngle(handState);
      if (angle !== null) steerBaseAngle = angle;
    }

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

   const steerLerp = gripState.bothOn ? STEER_SMOOTH : 0.55;
   control.steer = lerp(control.steer, targetSteerDZ, steerLerp);
   // throttle is handled by updateRover() from selectedSpeed
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
scene.fog = new THREE.FogExp2(0x0a1020, 0.012);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);
camera.position.set(0, 1.1, 0); // will be attached to rover cockpit

// Lights
scene.add(new THREE.AmbientLight(0x5a78ff, 0.25));
const dir = new THREE.DirectionalLight(0xaad4ff, 1.2);
dir.position.set(6, 14, 8);
scene.add(dir);

const glowLight = new THREE.PointLight(0x44ccff, 2, 20);
glowLight.position.set(0, 2, 2);
scene.add(glowLight);

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
    color: 0x2a1f3a,
    roughness: 0.85,
    metalness: 0.1,
    emissive: 0x0a0f2a,
    emissiveIntensity: 0.25
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
})();

const horizonGlow = new THREE.Mesh(
  new THREE.SphereGeometry(180, 32, 32),
  new THREE.MeshBasicMaterial({
    color: 0x3a6cff,
    transparent: true,
    opacity: 0.08,
    side: THREE.BackSide
  })
);
scene.add(horizonGlow);

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


// “Dashboard” plane
const dash = new THREE.Mesh(
  new THREE.BoxGeometry(1.8, 0.18, 0.6),
  new THREE.MeshStandardMaterial({
    color: 0x0b1222,
    roughness: 0.6,
    metalness: 0.3
  })
);
dash.position.set(0, 0.65, 0.7);
rover.add(dash);

// Attach camera inside cockpit (slightly back and up)
rover.add(camera);
camera.position.set(0, 1.15, -0.25);

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
  // makeBeacon();
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
  let desiredThrottle = 0;

  if (roverMode === "engaged") {
    desiredThrottle = selectedSpeed;
  }

  if (reverseEnabled) {
    desiredThrottle *= -1;
  }

  if (turboActive) {
    if (performance.now() < turboUntil) {
      desiredThrottle *= 1.75;
    } else {
      turboActive = false;
    }
  }

  control.throttle = lerp(control.throttle, desiredThrottle, 0.08);

  const steerRate = 1.15;
  roverYaw += control.steer * steerRate * dt;

  const accel = 6.5;
  const drag = 2.4;

  roverSpeed += control.throttle * accel * dt;
  roverSpeed -= roverSpeed * drag * dt;

  if (Math.abs(control.throttle) > 0.08 && Math.abs(roverSpeed) < 0.9) {
    roverSpeed = 0.9 * Math.sign(control.throttle);
  }

  roverSpeed = clamp(roverSpeed, -8.5, 8.5);

  const forward = new THREE.Vector3(Math.sin(roverYaw), 0, Math.cos(roverYaw));
  roverPos.addScaledVector(forward, roverSpeed * dt);

  roverPos.y = terrainHeightAt(roverPos.x, roverPos.z) + 0.35;

  rover.position.copy(roverPos);
  rover.rotation.set(0, roverYaw, 0);

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

function updateMeters() {
  if (!barSteer || !barThrot) return;

  const s = (control.steer + 1) * 50;
  const t = clamp(control.throttle, 0, 1) * 100;

  updateSteeringGuideUI();

  barSteer.style.width = `${clamp(s, 0, 100)}%`;
  barThrot.style.width = `${clamp(t, 0, 100)}%`;

  txtSteer.textContent = control.steer.toFixed(2);
  txtThrot.textContent = control.throttle.toFixed(2);

  updateSpeedCursorUI();
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

  
    // gates logic
    if (nextCheckpointIdx < checkpointCount) {
    const gate = checkpoints[nextCheckpointIdx];
    if (checkGateHit(gate)) {
        setGateColor(gate, 0x4cff6e);
        nextCheckpointIdx++;
        lastCheckpointIndex = Math.min(nextCheckpointIdx, path.length - 2);
      }
    }
    else {
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
btnStart.addEventListener("click", async () => {
  if (!calibrated) {
    statusEl.textContent = "Hold hands steady first…";
    return;
  }

  if (selectedSpeed <= 0.02) {
    roverMode = "speed_select";
    setAIPrompt("SET SPEED ON RIGHT PANEL");
    statusEl.textContent = "Set speed first";
    return;
  }

  resetGame();
  roverMode = "speed_select";
  setAIPrompt("ENGAGING ROVER...");
  await engageCountdown();
  statusEl.textContent = "Go!";
});

btnCalibrate.addEventListener("click", () => {
  if (lastHandPoint) {
    calib.centerX = lastHandPoint.x;
    calib.centerY = lastHandPoint.y;

    if (lastHandState.left && lastHandState.right) {
      gripCalib.left = { ...lastHandState.left };
      gripCalib.right = { ...lastHandState.right };

      const angle = getWheelAngle(lastHandState);
      if (angle !== null) steerBaseAngle = angle;

      calibrated = true;
      statusEl.textContent = "Calibrated ✅ Press Start";
    } else {
      statusEl.textContent = "Show both hands to calibrate grips";
    }
  } else {
    statusEl.textContent = "No hands detected 👋";
  }
});

btnResetGame?.addEventListener("click", () => {
  shutdownRover();
  resetGame();
  nextCheckpointIdx = 0;
  lastCheckpointIndex = 0;
  selectedSpeed = 0.35;
  updateSpeedCursorUI();
  setAIPrompt("SYSTEM RESET");
});

btnToggleReverse?.addEventListener("click", () => {
  reverseEnabled = !reverseEnabled;
  setReverseUI();
});

btnShutdown?.addEventListener("click", () => {
  shutdownRover();
});

btnTurbo?.addEventListener("click", () => {
  turboActive = true;
  turboUntil = performance.now() + 2500;
  setAIPrompt("TURBO BOOST");
});

btnFire?.addEventListener("click", () => {
  setAIPrompt("TARGET SYSTEMS ONLINE");
});



btnRespawn?.addEventListener("click", () => {
  respawnLastCheckpoint();
  setAIPrompt("RESPAWNED AT CHECKPOINT");
});

const speedScaleEl = document.querySelector(".speedScale");

speedScaleEl?.addEventListener("pointerdown", (e) => {
  setSelectedSpeedFromPointer(e.clientY);
});

speedScaleEl?.addEventListener("pointermove", (e) => {
  if (e.buttons === 1) {
    setSelectedSpeedFromPointer(e.clientY);
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

    maybeToggleDebugUI();
    renderLoop(); // start rendering the 3D scene no matter what

    try {
      statusEl.textContent = "Loading hand tracker…";
      await setupHandLandmarker();

      statusEl.textContent = "Show hands to begin";
      handLoop();
    } catch (trackerError) {
      console.error("Hand tracker failed:", trackerError);
      statusEl.textContent = "Hand tracker failed";
      hudEl.textContent = "Check webcam permissions, use http://localhost:8000, and try Chrome if Firefox acts up.";
    }

    setReverseUI();
    updateSpeedCursorUI();
    setCountdownVisible(false);
    setAIPrompt("PRESS TO ENGAGE SPEED…");
    roverMode = "idle";

  } catch (e) {
    console.error(e);
    statusEl.textContent = "Error: webcam/permissions";
    hudEl.textContent = "If camera fails: use http://localhost:8000 (not file://) and allow permissions.";
    renderLoop(); // still render the scene even if webcam fails
  }
})();
