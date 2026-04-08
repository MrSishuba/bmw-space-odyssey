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

const steerGuideEl = document.getElementById("steerGuide");
const slotLeftEl = document.getElementById("slotLeft");
const slotRightEl = document.getElementById("slotRight");
const guideStatusEl = document.getElementById("guideStatus");
const leftHandVisualEl = document.getElementById("leftHandVisual");
const rightHandVisualEl = document.getElementById("rightHandVisual");
const leftHandShellEl = document.querySelector(".leftHandShell");
const rightHandShellEl = document.querySelector(".rightHandShell");

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
const speedScaleEl = document.querySelector(".speedScale");
const throttleHandleEl = document.getElementById("throttleHandle");
const speedReadoutEl = document.getElementById("speedReadout");
const modeReadoutEl = document.getElementById("modeReadout");

const missionOverlayEl = document.getElementById("missionOverlay");
const missionTitleEl = document.getElementById("missionTitle");
const missionSubtitleEl = document.getElementById("missionSubtitle");
const btnMissionRestart = document.getElementById("btnMissionRestart");
const checkpointDotEls = Array.from(document.querySelectorAll(".checkpointDot"));
const turboBtnEl = document.getElementById("btnTurbo");
const fireBtnEl = document.getElementById("btnFire");
const respawnBtnEl = document.getElementById("btnRespawn");
const navBlipEls = Array.from(document.querySelectorAll(".navBlip"));
const statusRadarBlipEls = Array.from(document.querySelectorAll(".statusRadarBlip"));
const statusBarEls = Array.from(document.querySelectorAll(".statusBars span"));


// -----------------------
// Helpers
// -----------------------
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function setAIPrompt(text) {
  if (aiPromptEl) aiPromptEl.textContent = text;
}

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function setCountdownVisible(show) {
  if (!countdownWrapEl) return;
  countdownWrapEl.classList.toggle("hidden", !show);
}

function maybeToggleDebugUI() {
  debugWrap?.classList.toggle("hidden", !chkDebug?.checked);
}

function setMissionOverlay(show, title = "", subtitle = "") {
  if (!missionOverlayEl) return;

  missionOverlayEl.classList.toggle("hidden", !show);

  if (title && missionTitleEl) missionTitleEl.textContent = title;
  if (subtitle && missionSubtitleEl) missionSubtitleEl.textContent = subtitle;
}

function updateModeReadout() {
  if (!modeReadoutEl) return;
  modeReadoutEl.textContent = String(controlMode || "hands").toUpperCase();
}

function updateSpeedReadout() {
  if (!speedReadoutEl) return;
  speedReadoutEl.textContent = `${Math.round(clamp(selectedSpeed, 0, 1) * 100)}%`;
}

function setButtonPulse(btn, active) {
  if (!btn) return;
  btn.style.filter = active ? "brightness(1.18)" : "";
  btn.style.boxShadow = active
    ? "0 0 18px rgba(124,236,255,0.24), inset 0 0 12px rgba(255,255,255,0.06)"
    : "";
}

function updateCheckpointStrip() {
  if (!checkpointDotEls.length) return;

  checkpointDotEls.forEach((dot, idx) => {
    const passed = idx < nextCheckpointIdx;
    const current = idx === nextCheckpointIdx && nextCheckpointIdx < checkpointCount;

    dot.style.background = passed
      ? "rgba(110,255,150,0.95)"
      : current
      ? "rgba(124,236,255,0.95)"
      : "rgba(140,230,255,0.28)";

    dot.style.boxShadow = passed
      ? "0 0 10px rgba(110,255,150,0.28)"
      : current
      ? "0 0 12px rgba(124,236,255,0.28)"
      : "0 0 8px rgba(124,236,255,0.08)";
  });
}

function updateHazardPanels() {
  const activeHazards = hazards.filter(h => h.userData.alive);
  const frontHazards = activeHazards
    .slice()
    .sort((a, b) => rover.position.distanceTo(a.position) - rover.position.distanceTo(b.position))
    .slice(0, 3);

  navBlipEls.forEach((el, idx) => {
    const hazard = frontHazards[idx];
    if (!hazard) {
      el.style.opacity = "0.22";
      el.style.transform = "scale(0.7)";
      return;
    }

    const toHazard = hazard.position.clone().sub(rover.position);
    const dx = clamp(toHazard.x / 28, -1, 1);
    const dz = clamp(toHazard.z / 42, -1, 1);

    const left = 50 + dx * 28;
    const top = 50 + dz * 18;

    el.style.left = `${left}%`;
    el.style.top = `${top}%`;
    el.style.opacity = hazard === lockedTarget ? "1" : "0.78";
    el.style.transform = hazard === lockedTarget ? "scale(1.35)" : "scale(1)";
    el.style.background = hazard.userData.kind === "enemy" ? "#ff8ea3" : "#76ffb4";
    el.style.boxShadow = hazard.userData.kind === "enemy"
      ? "0 0 14px rgba(255,110,140,0.35)"
      : "0 0 14px rgba(118,255,180,0.28)";
  });

  statusRadarBlipEls.forEach((el, idx) => {
    const hazard = frontHazards[idx];
    if (!hazard) {
      el.style.opacity = "0.2";
      return;
    }

    const toHazard = hazard.position.clone().sub(rover.position);
    const left = 50 + clamp(toHazard.x / 30, -1, 1) * 26;
    const top = 50 + clamp(toHazard.z / 38, -1, 1) * 26;

    el.style.left = `${left}%`;
    el.style.top = `${top}%`;
    el.style.opacity = "0.95";
    el.style.background = hazard.userData.kind === "enemy" ? "#ff8ea3" : "#76ffb4";
  });

  const dangerLevel = clamp(activeHazards.length / 6, 0, 1);
  statusBarEls.forEach((bar, idx) => {
    const level = clamp(dangerLevel * 1.2 - idx * 0.22, 0.12, 1);
    bar.style.height = `${18 + level * 64}%`;
    bar.style.background = dangerLevel > 0.65
      ? "linear-gradient(180deg, rgba(255,120,140,0.95), rgba(190,20,50,0.88))"
      : "linear-gradient(180deg, rgba(100,255,160,0.98), rgba(20,170,80,0.86))";
  });
}

function triggerTurboFX() {
  const now = performance.now();

  if (now < turboCooldownUntil) {
    setStatus("Turbo cooling down");
    setAIPrompt("TURBO RECHARGING");
    return false;
  }

  turboActive = true;
  turboUntil = now + 2400;
  turboCooldownUntil = now + 5200;
  hyperspaceStrength = 1;
  hazardSpawnUntil = now + 2600;
  setAIPrompt("TURBO BOOST");
  setStatus("Turbo boost");
  setButtonPulse(turboBtnEl, true);
  return true;
}

function triggerAutoFire() {
  autoFireActive = true;
  autoFireUntil = performance.now() + 1400;
  firePulseUntil = performance.now() + 300;

  const target = getClosestHazardInFront();
  if (target) {
    lockedTarget = target;
    setAIPrompt(target.userData.kind === "enemy" ? "HOSTILE LOCKED" : "TARGET LOCKED");
    setStatus(`Auto-fire engaged • ${target.userData.kind}`);
  } else {
    setAIPrompt("SCANNING FOR TARGETS");
    setStatus("No target in range");
  }

  setButtonPulse(fireBtnEl, true);
}

function spawnBurstFX(position, color = 0xffd27a, count = 12) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = position.x;
    positions[i * 3 + 1] = position.y;
    positions[i * 3 + 2] = position.z;
  }

  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color,
    size: 0.22,
    transparent: true,
    opacity: 0.95,
    depthWrite: false
  });

  const points = new THREE.Points(geo, mat);

  const velocities = Array.from({ length: count }, () =>
    new THREE.Vector3(
      (Math.random() - 0.5) * 3.8,
      (Math.random() - 0.2) * 2.4,
      (Math.random() - 0.5) * 3.8
    )
  );

  scene.add(points);

  fxBursts.push({
    points,
    velocities,
    bornAt: performance.now(),
    life: 520
  });
}

function updateBurstFX(now, dt) {
  const remaining = [];

  for (const burst of fxBursts) {
    const age = now - burst.bornAt;
    const t = clamp(age / burst.life, 0, 1);

    const attr = burst.points.geometry.attributes.position;

    for (let i = 0; i < burst.velocities.length; i++) {
      const v = burst.velocities[i];
      attr.setXYZ(
        i,
        attr.getX(i) + v.x * dt,
        attr.getY(i) + v.y * dt,
        attr.getZ(i) + v.z * dt
      );

      v.multiplyScalar(0.985);
    }

    attr.needsUpdate = true;
    burst.points.material.opacity = 1 - t;
    burst.points.material.size = lerp(0.22, 0.04, t);

    if (t >= 1) {
      scene.remove(burst.points);
    } else {
      remaining.push(burst);
    }
  }

  fxBursts = remaining;
}

function makeHazard(kind = "asteroid") {
  const group = new THREE.Group();

  let mesh;

  if (kind === "enemy") {
    mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.75, 0),
      new THREE.MeshStandardMaterial({
        color: 0xff6a7a,
        emissive: 0x66111f,
        emissiveIntensity: 0.55,
        roughness: 0.45,
        metalness: 0.35
      })
    );
  } else {
    mesh = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.9, 0),
      new THREE.MeshStandardMaterial({
        color: 0x756b84,
        emissive: 0x151226,
        emissiveIntensity: 0.25,
        roughness: 0.92,
        metalness: 0.08
      })
    );
  }

  group.add(mesh);

  if (kind === "enemy") {
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 10),
      new THREE.MeshBasicMaterial({
        color: 0xffd27a
      })
    );
    group.add(core);
  }

  group.userData.kind = kind;
  group.userData.alive = true;
  group.userData.radius = kind === "enemy" ? 1.15 : 1.05;
  group.userData.spin = new THREE.Vector3(
    (Math.random() - 0.5) * 1.6,
    (Math.random() - 0.5) * 1.6,
    (Math.random() - 0.5) * 1.6
  );
  group.userData.velocity = new THREE.Vector3();
  group.userData.hitUntil = 0;

  scene.add(group);
  hazards.push(group);

  return group;
}

function spawnHazardAhead(kind = Math.random() < 0.28 ? "enemy" : "asteroid") {
  const forward = new THREE.Vector3(0, 0, 1);
  rover.getWorldDirection(forward);
  forward.negate();

  const side = new THREE.Vector3(forward.z, 0, -forward.x).normalize();

  const distance = 28 + Math.random() * 34;
  const lateral = (Math.random() - 0.5) * 18;
  const height = 1.4 + Math.random() * 3.2;

  const pos = rover.position.clone()
    .addScaledVector(forward, distance)
    .addScaledVector(side, lateral);

  pos.y = terrainHeightAt(pos.x, pos.z) + height;

  const hazard = makeHazard(kind);
  hazard.position.copy(pos);

  const driftToward = rover.position.clone().sub(pos).setY(0).normalize();
  const sideDrift = side.clone().multiplyScalar((Math.random() - 0.5) * (kind === "enemy" ? 0.9 : 0.45));
  const baseVelocity = driftToward.multiplyScalar(kind === "enemy" ? 1.4 + Math.random() * 1.1 : 0.8 + Math.random() * 0.9);

  hazard.userData.velocity.copy(baseVelocity.add(sideDrift));
  hazard.userData.velocity.y = (Math.random() - 0.5) * (kind === "enemy" ? 0.09 : 0.04);
  hazard.userData.wobbleSeed = Math.random() * 1000;
  hazard.userData.spawnedAt = performance.now();

  return hazard;
}

function maybeSpawnHazards(now) {
  if (!gameRunning) return;
  if (roverMode !== "engaged") return;
  if (hazards.length >= HAZARD_MAX_COUNT) return;

  const movingEnough = Math.abs(roverSpeed) > 0.65;
  if (!movingEnough) return;

  const speedFactor = clamp(Math.abs(roverSpeed) / 5.6, 0.2, 1);
  const spawnGap = turboActive
    ? lerp(900, 520, speedFactor)
    : lerp(1450, 820, speedFactor);

  if (now - lastHazardSpawnAt < spawnGap) return;

  lastHazardSpawnAt = now;

  const enemyChance = turboActive ? 0.34 : 0.20;
  const kind = Math.random() < enemyChance ? "enemy" : "asteroid";

  spawnHazardAhead(kind);
}

function updateHazards(now, dt) {
  const removal = [];

  for (const hazard of hazards) {
    if (!hazard.userData.alive) {
      removal.push(hazard);
      continue;
    }

    const age = now - (hazard.userData.spawnedAt || now);
    const wobble = Math.sin(now * 0.0024 + hazard.userData.wobbleSeed) * (hazard.userData.kind === "enemy" ? 0.012 : 0.005);

    hazard.position.addScaledVector(hazard.userData.velocity, dt * 5.4);
    hazard.position.x += wobble;

    if (hazard.userData.kind === "enemy") {
      const towardRover = rover.position.clone().sub(hazard.position).setY(0).normalize();
      hazard.userData.velocity.lerp(towardRover.multiplyScalar(1.45), 0.012);
    }

    hazard.rotation.x += hazard.userData.spin.x * dt;
    hazard.rotation.y += hazard.userData.spin.y * dt;
    hazard.rotation.z += hazard.userData.spin.z * dt;

    if (hazard.userData.hitUntil > now) {
      hazard.scale.lerp(new THREE.Vector3(1.35, 1.35, 1.35), 0.18);
    } else {
      hazard.scale.lerp(new THREE.Vector3(1, 1, 1), 0.08);
    }

    const distToRover = hazard.position.distanceTo(rover.position);

    if (distToRover < 1.65 && now > collisionCooldownUntil) {
      collisionCooldownUntil = now + COLLISION_IMPACT_COOLDOWN_MS;
      spawnBurstFX(hazard.position.clone(), 0xff8a7a, 14);
      hazard.userData.alive = false;
      removal.push(hazard);
      setAIPrompt("IMPACT WARNING");
      setStatus("Hazard collision");
      roverSpeed *= 0.54;
      control.throttle *= 0.72;
      selectedSpeed = clamp(selectedSpeed - 0.08, 0, 1);
      updateSpeedCursorUI();
    }

    const tooFar =
      hazard.position.distanceTo(rover.position) > 95 ||
      hazard.position.y < -8 ||
      age > 14000;

    if (tooFar) {
      hazard.userData.alive = false;
      removal.push(hazard);
    }
  }

  for (const h of removal) {
    scene.remove(h);
  }

  hazards = hazards.filter(h => h.userData.alive);
}

function getClosestHazardInFront() {
  if (!hazards.length) return null;

  const forward = new THREE.Vector3(0, 0, 1);
  rover.getWorldDirection(forward);
  forward.negate().normalize();

  let best = null;
  let bestScore = Infinity;

  for (const hazard of hazards) {
    if (!hazard.userData.alive) continue;

    const toHazard = hazard.position.clone().sub(rover.position);
    const distance = toHazard.length();
    const dir = toHazard.clone().normalize();
    const forwardDot = dir.dot(forward);

    if (forwardDot < HAZARD_FRONT_ARC_DOT) continue;
    if (distance > 42) continue;

    const lockBias = hazard.userData.kind === "enemy" ? -2.8 : 0;
    const score = distance - forwardDot * 10 + lockBias;

    if (score < bestScore) {
      bestScore = score;
      best = hazard;
    }
  }

  return best;
}

function updateTargetLock(now) {
  if (!hazards.length) {
    lockedTarget = null;
    return;
  }

  const previous = lockedTarget;
  lockedTarget = getClosestHazardInFront();

  if (lockedTarget && lockedTarget !== previous) {
    if (now - lastLockToneAt > 260) {
      setAIPrompt("TARGET LOCKED");
      setStatus(`Locked: ${lockedTarget.userData.kind.toUpperCase()}`);
      lastLockToneAt = now;
    }
  }

  if (autoFireActive && lockedTarget) {
    lockedTarget.userData.hitUntil = now + 90;
  }
}

function destroyLockedTarget() {
  if (!lockedTarget || !lockedTarget.userData.alive) return false;

  const destroyed = lockedTarget;
  const burstColor = destroyed.userData.kind === "enemy" ? 0xff7a8e : 0xffd27a;

  spawnBurstFX(destroyed.position.clone(), burstColor, destroyed.userData.kind === "enemy" ? 16 : 11);

  destroyed.userData.alive = false;
  scene.remove(destroyed);

  hazards = hazards.filter(h => h !== destroyed);

  firePulseUntil = performance.now() + 180;
  setAIPrompt("TARGET DESTROYED");
  setStatus(`Destroyed: ${destroyed.userData.kind}`);

  lockedTarget = null;
  return true;
}

function updateEffectState(now, dt) {
  if (turboActive && now > turboUntil) {
    turboActive = false;
    setButtonPulse(turboBtnEl, false);
  }

  if (autoFireActive && now > autoFireUntil) {
    autoFireActive = false;
    setButtonPulse(fireBtnEl, false);
  }

  if (firePulseUntil > 0 && now > firePulseUntil) {
    firePulseUntil = 0;
  }

  hyperspaceStrength = lerp(
    hyperspaceStrength,
    turboActive ? 1 : 0,
    turboActive ? 0.18 : 0.08
  );

    if (autoFireActive && lockedTarget && lockedTarget.userData.alive) {
    const hitChance = lockedTarget.userData.kind === "enemy"
      ? AUTO_FIRE_HIT_CHANCE + 0.06
      : AUTO_FIRE_HIT_CHANCE;

    if (Math.random() < hitChance) {
      destroyLockedTarget();
    }
  }
}

// ======================
// CORE STATE (COCKPIT)
// ======================
const state = {
  speed: 0,           // 0 → 100
  targetSpeed: 0,     // where throttle is trying to go
  maxSpeed: 100,

  steering: 0,        // -1 (left) → 1 (right)
  isCalibrated: false,

  throttleHeld: false,

  // smoothing
  speedLerp: 0.08,
  steeringLerp: 0.15
};

// ======================
// UI REFERENCES
// ======================
const ui = {
  speedValue: document.querySelector('.readoutValue'),
  speedCursor: document.getElementById('speedCursor'),

  throttle: document.querySelector('.throttleHandle'),

  instruction: document.querySelector('.consoleInstruction')
};

// ======================
// UI UPDATE FUNCTIONS
// ======================
function updateSpeedUI() {
  if (!ui.speedValue) return;

  ui.speedValue.textContent = Math.round(state.speed);

  // move cursor visually (if exists)
  if (ui.speedCursor) {
    const percent = state.speed / state.maxSpeed;
    const maxHeight = 180; // adjust later to match your rail
    ui.speedCursor.style.transform = `translateY(${-percent * maxHeight}px)`;
  }
}

// ======================
// STATE UPDATE LOOP
// ======================
function updateState() {
  // Smooth speed toward target
  state.speed += (state.targetSpeed - state.speed) * state.speedLerp;

  // Clamp
  state.speed = Math.max(0, Math.min(state.speed, state.maxSpeed));
}



// -----------------------
// Control state
// -----------------------
let controlMode = "hands"; // hands | voice | keyboard
let speechRecognizer = null;
let keysPressed = {};

let control = {
  steer: 0,
  throttle: 0
};

let roverMode = "idle"; // idle | engaging | engaged | shutdown
let reverseEnabled = false;
let turboActive = false;
let turboUntil = 0;
let turboCooldownUntil = 0;
let lastCheckpointIndex = 0;
let selectedSpeed = 0.35;

let firePulseUntil = 0;
let hyperspaceStrength = 0;
let autoFireActive = false;
let autoFireUntil = 0;

let hazards = [];
let hazardSpawnUntil = 0;
let lastHazardSpawnAt = 0;
let lockedTarget = null;
let fxBursts = [];
let lastLockToneAt = 0;

const HAZARD_MAX_COUNT = 9;
const HAZARD_FRONT_ARC_DOT = 0.72;
const AUTO_FIRE_HIT_CHANCE = 0.22;
const COLLISION_IMPACT_COOLDOWN_MS = 700;
let collisionCooldownUntil = 0;


function setControlMode(mode) {
  controlMode = mode;
  updateModeReadout();
}

function setReverseUI() {
  if (!btnToggleReverse) return;
  btnToggleReverse.textContent = reverseEnabled ? "ON" : "OFF";
}

function updateSpeedCursorUI() {
  if (!speedCursorEl || !speedScaleEl) return;

  const pct = clamp(selectedSpeed, 0, 1);
  const usableHeight = speedScaleEl.clientHeight - 64;
  const bottomPx = 24 + pct * usableHeight;

  speedCursorEl.style.bottom = `${bottomPx}px`;

  if (throttleHandleEl) {
    const angle = lerp(-18, 34, pct);
    const handleY = lerp(18, -16, pct);
    throttleHandleEl.style.transform = `translateY(${handleY}px) rotate(${angle}deg)`;
  }

  updateSpeedReadout();
}

function setSelectedSpeed(value, prompt = true) {
  selectedSpeed = clamp(value, 0, 1);
  updateSpeedCursorUI();

  if (!prompt) return;

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

function getSpeedFromScreenY(clientY) {
  if (!speedScaleEl) return selectedSpeed;

  const rect = speedScaleEl.getBoundingClientRect();
  const y = clamp(clientY, rect.top, rect.bottom);
  const pctFromBottom = 1 - ((y - rect.top) / rect.height);

  return clamp(pctFromBottom, 0, 1);
}

function setSelectedSpeedFromPointer(clientY) {
  setSelectedSpeed(getSpeedFromScreenY(clientY), true);
  roverMode = roverMode === "shutdown" ? "idle" : roverMode;
}

function shutdownRover() {
  roverMode = "shutdown";
  gameRunning = false;
  control.throttle = 0;
  roverSpeed = 0;
  autoFireActive = false;
  turboActive = false;
  hyperspaceStrength = 0;
  lockedTarget = null;
  setButtonPulse(turboBtnEl, false);
  setButtonPulse(fireBtnEl, false);
  setSelectedSpeed(0, false);
  setAIPrompt("ROVER SHUTDOWN");
  setStatus("Rover shutdown");
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
    await new Promise(r => setTimeout(r, 650));
  }

  setCountdownVisible(false);
  roverMode = "engaged";
  gameRunning = true;
  startedAt = performance.now();
  setAIPrompt("ROVER ENGAGED");
  setStatus(`Engaged • ${controlMode.toUpperCase()} CONTROL`);
}

async function startRun() {
  if (!calibrated) {
    setStatus("Hold hands steady first…");
    return;
  }

  if (selectedSpeed <= 0.02) {
    setStatus("Set speed first");
    setAIPrompt("SET SPEED ON RIGHT PANEL");
    return;
  }

  resetGame();
  setAIPrompt("ENGAGING ROVER...");
  await engageCountdown();
}

function respawnLastCheckpoint() {
  const idx = Math.max(0, Math.min(lastCheckpointIndex, path.length - 2));
  const p = path[idx].clone();

  roverPos.copy(p);
  roverPos.y = terrainHeightAt(roverPos.x, roverPos.z) + 0.35;
  rover.position.copy(roverPos);
  roverSpeed = 0;
  roverYaw = 0;
  rover.rotation.set(0, roverYaw, 0);

  hazards = hazards.filter(h => {
    const keep = h.position.distanceTo(rover.position) > 12;
    if (!keep) scene.remove(h);
    return keep;
  });

  lockedTarget = null;
  setAIPrompt("RESPAWNED AT CHECKPOINT");
}


// --------------------
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
let lastHandPoint = null;

const STABLE_N = 25;
const STABLE_EPS = 0.015;
const GRIP_LOCK_DIST = 0.15;
const STEER_MAX_ANGLE = 0.34;
const STEER_SMOOTH = 0.28;
const HAND_MISSING_RESET_FRAMES = 42;
const HAND_SOFT_LOSS_FRAMES = 10;

let calib = {
  centerX: 0.5,
  centerY: 0.5,
  rangeX: 0.22,
  rangeY: 0.22
};

async function setupWebcam() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: "user" },
    audio: false
  });
  videoEl.srcObject = stream;
  await videoEl.play();
}

async function setupHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

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

function updateControlFromHands(result) {
  const handState = getHandState(result);
  lastHandState = handState;

  const p = handState.center;
  lastHandPoint = p;

    if (!p) {
    missingHandsFrames++;

    if (missingHandsFrames > HAND_SOFT_LOSS_FRAMES) {
      control.steer = lerp(control.steer, 0, 0.12);
      setStatus("Hands lost — reacquire steering");
    }

    if (missingHandsFrames > HAND_MISSING_RESET_FRAMES) {
      calibrated = false;
      stableFrames = 0;
      calibSumX = 0;
      calibSumY = 0;
      lastP = null;
      gripCalib.left = null;
      gripCalib.right = null;
      setStatus("Show both hands to recalibrate");
    }

    updateSteeringGuideUI();
    return;
  }

  missingHandsFrames = 0;

    if (handState.left || handState.right) {
    setControlMode("hands");
  }

  let targetSteer = 0;
  gripState = getGripLockState();
  const currentWheelAngle = getWheelAngle(handState);

  if (calibrated && gripState.bothOn && currentWheelAngle !== null) {
    const angleDelta = normalizeAngle(currentWheelAngle - steerBaseAngle);
    targetSteer = clamp(angleDelta / STEER_MAX_ANGLE, -1, 1);
  }

  const dead = 0.035;
  const dz = (v) => (Math.abs(v) < dead ? 0 : v);
  const targetSteerDZ = dz(targetSteer);

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
      setStatus(`Hold hands steady… calibrating (${Math.min(pct, 100)}%)`);

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
        setStatus("Calibrated ✅ Press Start");
      }
    } else {
      setStatus("Hold hands steady… calibrating");
    }

    lastP = { x: p.x, y: p.y };
  } else {
    lastP = { x: p.x, y: p.y };
  }

  const steerLerp = gripState.bothOn ? STEER_SMOOTH : 0.18;
  control.steer = lerp(control.steer, targetSteerDZ, steerLerp);
}

function drawDebug(result) {
  if (!chkDebug.checked) return;

  debugCanvas.width = videoEl.videoWidth || 640;
  debugCanvas.height = videoEl.videoHeight || 480;

  debugCtx.save();
  debugCtx.scale(-1, 1);
  debugCtx.drawImage(videoEl, -debugCanvas.width, 0, debugCanvas.width, debugCanvas.height);
  debugCtx.restore();

  const hands = result?.landmarks || [];
  for (const lm of hands) {
    drawingUtils.drawLandmarks(lm, { radius: 3 });
    drawingUtils.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS);
  }

  debugCtx.fillStyle = "rgba(0,0,0,0.55)";
  debugCtx.fillRect(10, 10, 220, 58);
  debugCtx.fillStyle = "white";
  debugCtx.font = "14px system-ui";
  debugCtx.fillText(`steer: ${control.steer.toFixed(2)}`, 18, 34);
  debugCtx.fillText(`throttle: ${control.throttle.toFixed(2)}`, 18, 54);
}

async function handLoop() {
  if (!handLandmarker) return;

  const now = performance.now();
  if (videoEl.currentTime !== lastVideoTime) {
    const res = handLandmarker.detectForVideo(videoEl, now);
    updateControlFromHands(res);
    drawDebug(res);
    lastVideoTime = videoEl.currentTime;
  }

  requestAnimationFrame(handLoop);
}

// -----------------------
// Voice + keyboard support
// -----------------------
function setupVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn("Speech Recognition API not supported.");
    return;
  }

  speechRecognizer = new SpeechRecognition();
  speechRecognizer.continuous = true;
  speechRecognizer.interimResults = false;
  speechRecognizer.lang = "en-US";

  speechRecognizer.onstart = () => {
    setStatus("Voice ready: drive / stop / faster / slower / reverse / forward");
  };

  speechRecognizer.onresult = async (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript.trim().toLowerCase();
      console.log("Voice heard:", text);

      if (text.includes("drive") || text.includes("start")) {
        setControlMode("voice");
        if (selectedSpeed < 0.15) setSelectedSpeed(0.2, false);

        if (roverMode !== "engaged" && roverMode !== "engaging") {
          await startRun();
        } else {
          setAIPrompt("VOICE DRIVE");
          setStatus("Voice drive");
        }
      }

      if (text.includes("stop") || text.includes("halt")) {
        setControlMode("voice");
        gameRunning = false;
        roverMode = "idle";
        control.throttle = 0;
        roverSpeed = 0;
        setAIPrompt("VOICE STOP");
        setStatus("Voice stop");
      }

      if (text.includes("faster")) {
        setControlMode("voice");
        setSelectedSpeed(selectedSpeed + 0.12, true);
        setStatus(`Voice faster • ${selectedSpeed.toFixed(2)}`);
      }

      if (text.includes("slower")) {
        setControlMode("voice");
        setSelectedSpeed(selectedSpeed - 0.12, true);
        setStatus(`Voice slower • ${selectedSpeed.toFixed(2)}`);
      }

      if (text.includes("reverse")) {
        setControlMode("voice");
        reverseEnabled = true;
        setReverseUI();
        setAIPrompt("REVERSE ENABLED");
        setStatus("Reverse enabled");
      }

      if (text.includes("forward")) {
        setControlMode("voice");
        reverseEnabled = false;
        setReverseUI();
        setAIPrompt("FORWARD DRIVE");
        setStatus("Forward drive");
      }

      if (text.includes("boost") || text.includes("turbo")) {
        setControlMode("voice");
        triggerTurboFX();
      }

           if (
        text.includes("fire") ||
        text.includes("shoot") ||
        text.includes("attack") ||
        text.includes("engage targets")
      ) {
        setControlMode("voice");
        triggerAutoFire();
      }

      if (text.includes("reset")) {
        shutdownRover();
        resetGame();
        nextCheckpointIdx = 0;
        lastCheckpointIndex = 0;
        setSelectedSpeed(0.35, false);
        updateCheckpointStrip();
        setAIPrompt("SYSTEM RESET");
        setStatus("Reset complete");
      }
    }
  };

  speechRecognizer.onerror = (e) => {
    console.warn("Speech recognition error", e);
  };

  speechRecognizer.onend = () => {
    setTimeout(() => {
      try {
        speechRecognizer?.start();
      } catch {}
    }, 500);
  };

  try {
    speechRecognizer.start();
  } catch {}
}

function updateControlFromKeyboard() {
  const steerTarget =
    (keysPressed.ArrowRight ? 1 : 0) +
    (keysPressed.ArrowLeft ? -1 : 0);

  control.steer = lerp(control.steer, steerTarget, 0.16);

  if (keysPressed.ArrowUp) {
    setSelectedSpeed(selectedSpeed + 0.009, false);
  }
  if (keysPressed.ArrowDown) {
    setSelectedSpeed(selectedSpeed - 0.009, false);
  }
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
camera.position.set(0, 1.1, 0);

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
    positions[i * 3 + 0] = (Math.random() - 0.5) * r;
    positions[i * 3 + 1] = (Math.random() - 0.2) * r;
    positions[i * 3 + 2] = (Math.random() - 0.5) * r;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, sizeAttenuation: true });
  scene.add(new THREE.Points(geo, mat));
})();

// Terrain
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

const body = new THREE.Mesh(
  new THREE.BoxGeometry(1.2, 0.35, 1.6),
  new THREE.MeshStandardMaterial({ color: 0xb9c2ff, roughness: 0.6, metalness: 0.2 })
);
body.position.set(0, 0.5, 0);
rover.add(body);

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

rover.add(camera);
camera.position.set(0, 1.15, -0.25);

let roverPos = new THREE.Vector3(0, 0, 0);
let roverYaw = 0;
let roverSpeed = 0;

const raycaster = new THREE.Raycaster();
function terrainHeightAt(x, z) {
  raycaster.set(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));
  const hits = raycaster.intersectObject(terrain, false);
  return hits.length ? hits[0].point.y : 0;
}

// Checkpoints
const checkpoints = [];
const checkpointCount = 5;
const path = [
  new THREE.Vector3(0, 0, -12),
  new THREE.Vector3(6, 0, -28),
  new THREE.Vector3(-10, 0, -42),
  new THREE.Vector3(10, 0, -60),
  new THREE.Vector3(-2, 0, -78),
  new THREE.Vector3(0, 0, -96)
];

function makeGate(color) {
  const g = new THREE.Group();

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.2, 0.12, 10, 34),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.35,
      metalness: 0.3,
      emissive: color,
      emissiveIntensity: 0.25
    })
  );
  ring.rotation.x = Math.PI / 2;
  g.add(ring);

  const poleMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.14, 3.6, 10);
  const p1 = new THREE.Mesh(poleGeo, poleMat);
  const p2 = new THREE.Mesh(poleGeo, poleMat);
  p1.position.set(-2.2, -1.4, 0);
  p2.position.set(2.2, -1.4, 0);
  g.add(p1, p2);

  return g;
}

let finishGate = null;
let nextCheckpointIdx = 0;
let navArrow = null;
let pathLine = null;
let gameRunning = false;
let startedAt = 0;
let timeLimitMs = 90_000;

function getNextTargetPos() {
  if (nextCheckpointIdx < checkpointCount) return checkpoints[nextCheckpointIdx].position;
  return finishGate.position;
}

function buildPathLine() {
  const pts = path.map(p => new THREE.Vector3(p.x, terrainHeightAt(p.x, p.z) + 0.05, p.z));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color: 0x7cffc8 });
  pathLine = new THREE.Line(geo, mat);
  scene.add(pathLine);
}

(function buildCourse() {
  for (let i = 0; i < checkpointCount; i++) {
    const gate = makeGate(0x7cffc8);
    const p = path[i + 1].clone();
    p.y = terrainHeightAt(p.x, p.z) + 1.6;
    gate.position.copy(p);

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
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, 2, 0),
    6,
    0x7cffc8
  );
  scene.add(navArrow);

  roverPos.copy(path[0]);
  roverPos.y = terrainHeightAt(roverPos.x, roverPos.z) + 0.35;
  rover.position.copy(roverPos);
})();

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

  for (const hazard of hazards) {
    scene.remove(hazard);
  }

  for (const burst of fxBursts) {
    scene.remove(burst.points);
  }

  hazards = [];
  fxBursts = [];
  lockedTarget = null;
  autoFireActive = false;
  hyperspaceStrength = 0;
  firePulseUntil = 0;

  roverPos.copy(path[0]);
  roverPos.y = terrainHeightAt(roverPos.x, roverPos.z) + 0.35;
  rover.position.copy(roverPos);
  rover.rotation.set(0, roverYaw, 0);

  updateHUD();
  updateCheckpointStrip();
  updateHazardPanels();
  setMissionOverlay(false);
}

function winGame() {
  gameRunning = false;
  roverMode = "idle";
  roverSpeed = 0;
  control.throttle = 0;
  autoFireActive = false;
  turboActive = false;
  lockedTarget = null;
  setButtonPulse(turboBtnEl, false);
  setButtonPulse(fireBtnEl, false);
  setStatus("FINISHED ✅");
  setAIPrompt("MISSION COMPLETE");
  setMissionOverlay(true, "MISSION COMPLETE", "All checkpoints cleared. Rover route completed successfully.");
}

function loseGame() {
  gameRunning = false;
  roverMode = "idle";
  roverSpeed = 0;
  control.throttle = 0;
  autoFireActive = false;
  turboActive = false;
  lockedTarget = null;
  setButtonPulse(turboBtnEl, false);
  setButtonPulse(fireBtnEl, false);
  setStatus("TIME UP ⏳");
  setAIPrompt("MISSION FAILED");
  setMissionOverlay(true, "MISSION FAILED", "Time limit exceeded. Recalibrate, re-engage, and try again.");
}

function checkGateHit(gate) {
  return rover.position.distanceTo(gate.position) < 2.4;
}

function setGateColor(gate, colorHex) {
  gate.traverse(obj => {
    if (obj.isMesh && obj.material) {
      obj.material.emissive?.setHex?.(colorHex);
      obj.material.color?.setHex?.(colorHex);
    }
  });
}

// -----------------------
// Driving physics
// -----------------------
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
      desiredThrottle *= 1.55;
    } else {
      turboActive = false;
    }
  }

  if (controlMode === "keyboard") {
    updateControlFromKeyboard();
  }

  control.throttle = lerp(control.throttle, desiredThrottle, 0.055);

  const speedFactor = clamp(Math.abs(roverSpeed) / 5.5, 0.35, 1.15);
  const steerRate = 0.88 * speedFactor;
  roverYaw += control.steer * steerRate * dt;

  const accel = 5.2;
  const drag = 0.9;
  const rollingResistance = 0.55;

  roverSpeed += control.throttle * accel * dt;
  roverSpeed -= roverSpeed * drag * dt;

  if (Math.abs(control.throttle) < 0.03) {
    roverSpeed -= roverSpeed * rollingResistance * dt;
  }

  if (Math.abs(control.throttle) > 0.08 && Math.abs(roverSpeed) < 0.08) {
    roverSpeed = 0.08 * Math.sign(control.throttle);
  }

  roverSpeed = clamp(roverSpeed, -6.4, 6.4);

  const forward = new THREE.Vector3(0, 0, 1);
  rover.getWorldDirection(forward);
  forward.negate();

  roverPos.addScaledVector(forward, roverSpeed * dt);
  roverPos.y = terrainHeightAt(roverPos.x, roverPos.z) + 0.35;

  rover.position.copy(roverPos);
  rover.rotation.set(0, roverYaw, 0);

  camera.position.y = 1.05 + Math.sin(performance.now() * 0.004) * Math.min(0.018, Math.abs(roverSpeed) * 0.0022);
}


function updateTurboVisuals(now) {
  const turboFactor = clamp(hyperspaceStrength, 0, 1);

  scene.fog.density = lerp(0.012, 0.026, turboFactor);
  glowLight.intensity = lerp(2, 4.8, turboFactor);
  horizonGlow.material.opacity = lerp(0.08, 0.20, turboFactor);

  const stars = scene.children.find(obj => obj.isPoints);
  const starPositions = stars?.geometry?.attributes?.position;

  if (starPositions) {
    const starSpeed = lerp(0.06, 1.15, turboFactor);
    for (let i = 0; i < starPositions.count; i++) {
      const z = starPositions.getZ(i) + starSpeed;
      starPositions.setZ(i, z > 110 ? -110 : z);
    }
    starPositions.needsUpdate = true;
  }

  if (turboFactor > 0.05) {
    const pulse = 1 + Math.sin(now * 0.03) * 0.02 * turboFactor;
    camera.fov = lerp(camera.fov, 75 * pulse + turboFactor * 10, 0.10);
  } else {
    camera.fov = lerp(camera.fov, 75, 0.08);
  }

  if (lockedTarget?.userData?.alive) {
    glowLight.color.setHex(lockedTarget.userData.kind === "enemy" ? 0xff7d98 : 0x8dffd2);
  } else {
    glowLight.color.setHex(0x44ccff);
  }

  camera.updateProjectionMatrix();
}

function updateMeters() {
  const s = (control.steer + 1) * 50;
  const t = clamp(Math.abs(control.throttle), 0, 1) * 100;

  updateSteeringGuideUI();

  if (barSteer) barSteer.style.width = `${clamp(s, 0, 100)}%`;
  if (barThrot) barThrot.style.width = `${clamp(t, 0, 100)}%`;

  if (txtSteer) txtSteer.textContent = control.steer.toFixed(2);
  if (txtThrot) txtThrot.textContent = control.throttle.toFixed(2);

  updateSpeedCursorUI();
}

let lastT = performance.now();

function renderLoop() {
  const now = performance.now();
  const dt = Math.min(0.033, (now - lastT) / 1000);
  lastT = now;

  updateEffectState(now, dt);
  updateTurboVisuals(now);
  maybeSpawnHazards(now);
  updateHazards(now, dt);
  updateTargetLock(now);
  updateBurstFX(now, dt);
  updateHazardPanels();

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

    if (nextCheckpointIdx < checkpointCount) {
      const gate = checkpoints[nextCheckpointIdx];
          if (checkGateHit(gate)) {
        setGateColor(gate, 0x4cff6e);
        nextCheckpointIdx++;
        lastCheckpointIndex = Math.min(nextCheckpointIdx, path.length - 2);
        updateCheckpointStrip();
        setAIPrompt(nextCheckpointIdx < checkpointCount ? "CHECKPOINT LOCKED" : "FINAL GATE AHEAD");
      }
    } else if (checkGateHit(finishGate)) {
      winGame();
    }

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
btnStart?.addEventListener("click", async () => {
  await startRun();
});

btnCalibrate?.addEventListener("click", () => {
  if (!lastHandPoint) {
    setStatus("No hands detected 👋");
    return;
  }

  calib.centerX = lastHandPoint.x;
  calib.centerY = lastHandPoint.y;

  if (lastHandState.left && lastHandState.right) {
    gripCalib.left = { ...lastHandState.left };
    gripCalib.right = { ...lastHandState.right };

    const angle = getWheelAngle(lastHandState);
    if (angle !== null) steerBaseAngle = angle;

    calibrated = true;
    setStatus("Calibrated ✅ Press Start");
  } else {
    setStatus("Show both hands to calibrate grips");
  }
});

btnResetGame?.addEventListener("click", () => {
  shutdownRover();
  resetGame();
  nextCheckpointIdx = 0;
  lastCheckpointIndex = 0;
  setSelectedSpeed(0.35, false);
  setAIPrompt("SYSTEM RESET");
  setStatus("Reset complete");
});

btnToggleReverse?.addEventListener("click", () => {
  reverseEnabled = !reverseEnabled;
  setReverseUI();
});

btnShutdown?.addEventListener("click", () => {
  shutdownRover();
});

btnTurbo?.addEventListener("click", () => {
  triggerTurboFX();
});

btnFire?.addEventListener("click", () => {
  triggerAutoFire();
});

btnFire?.addEventListener("click", () => {
  setAIPrompt("TARGET SYSTEMS ONLINE");
  setStatus("Target systems online");
});

btnRespawn?.addEventListener("click", () => {
  respawnLastCheckpoint();
  setButtonPulse(respawnBtnEl, true);
  setTimeout(() => setButtonPulse(respawnBtnEl, false), 220);
});


btnMissionRestart?.addEventListener("click", async () => {
  setMissionOverlay(false);
  shutdownRover();
  resetGame();
  nextCheckpointIdx = 0;
  lastCheckpointIndex = 0;
  setSelectedSpeed(0.35, false);
  roverMode = "idle";
  setAIPrompt("PRESS TO ENGAGE SPEED…");
  setStatus("Mission reset");
});

speedScaleEl?.addEventListener("pointerdown", (e) => {
  setSelectedSpeedFromPointer(e.clientY);
});

speedScaleEl?.addEventListener("pointermove", (e) => {
  if (e.buttons === 1) {
    setSelectedSpeedFromPointer(e.clientY);
  }
});

chkDebug?.addEventListener("change", maybeToggleDebugUI);

// Keyboard fallback for testing
window.addEventListener("keydown", async (e) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
    e.preventDefault();
    keysPressed[e.key] = true;
    setControlMode("keyboard");
  }

  if (e.key === "Enter") {
    await startRun();
  }

  if (e.key === " ") {
    e.preventDefault();
    gameRunning = false;
    roverMode = "idle";
    roverSpeed = 0;
    control.throttle = 0;
    autoFireActive = false;
    turboActive = false;
    lockedTarget = null;
    setButtonPulse(turboBtnEl, false);
    setButtonPulse(fireBtnEl, false);
    setStatus("Stopped");
    setAIPrompt("STOPPED");
  }

  if (e.key.toLowerCase() === "r") {
    reverseEnabled = !reverseEnabled;
    setReverseUI();
  }

  if (e.key.toLowerCase() === "f") {
    triggerAutoFire();
  }

  if (e.key.toLowerCase() === "t") {
    triggerTurboFX();
  }
});

window.addEventListener("keyup", (e) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
    keysPressed[e.key] = false;
  }
});

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
    setStatus("Requesting webcam…");
    await setupWebcam();

    maybeToggleDebugUI();
    renderLoop();

    try {
      setStatus("Loading hand tracker…");
      await setupHandLandmarker();
      setStatus("Show hands to begin");
      handLoop();
    } catch (trackerError) {
      console.error("Hand tracker failed:", trackerError);
      setStatus("Hand tracker failed");
      hudEl.textContent = "Check webcam permissions, use http://localhost:8000, and try Chrome if Firefox acts up.";
    }

    setupVoiceRecognition();
    setReverseUI();
    updateSpeedCursorUI();
    setCountdownVisible(false);
    setAIPrompt("PRESS TO ENGAGE SPEED…");
    roverMode = "idle";
    updateModeReadout();
    updateSpeedReadout();
    updateCheckpointStrip();
    updateHazardPanels();
    setMissionOverlay(false);
  } catch (e) {
    console.error(e);
    setStatus("Error: webcam/permissions");
    hudEl.textContent = "If camera fails: use http://localhost:8000 (not file://) and allow permissions.";
    renderLoop();
  }
})();