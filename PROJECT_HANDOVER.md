# BMW Space Odyssey – Project Handover

## Project Summary
This project is a browser-based motion-controlled driving game prototype. The player uses hand movements captured through a webcam to steer and control a rover driving across an alien planet. The game is intended to feel like a futuristic BMW off-world exploration experience.

The current prototype is built with:
- Three.js for 3D rendering
- MediaPipe Hand Landmarker for webcam-based hand tracking
- Vanilla JavaScript for game logic, UI updates, and rover control

---

## Current Concept
The player stands or sits in front of a webcam and uses their hands as the control input. Hand position is interpreted as steering and throttle. The rover moves through a 3D alien environment toward checkpoints and a finish gate.

The intended direction of the project is:
- motion-controlled BMW exploration rover
- alien planet / space odyssey theme
- accessible and intuitive enough for children
- potentially demo-worthy for leadership / CTO review

---

## What Has Been Done So Far

### Core Setup
- Local browser-based game runs through `http://localhost:8000`
- Three.js scene is rendering successfully
- Terrain is procedurally generated
- Rover object exists in scene
- Camera is attached to rover / cockpit area
- Starfield and basic environment exist

### Hand Tracking
- Webcam integration is working
- MediaPipe Hand Landmarker is integrated
- Hand debug overlay works
- Hand positions are being detected in real time
- Steering and throttle bars respond to hand movement

### Game Logic
- Checkpoints and finish gate exist
- Navigation arrow exists
- Beacon exists
- Basic HUD exists
- Reset/start logic exists
- Calibration system has been reworked toward hand-stillness calibration

---

## What Is Not Fully Working Yet

### 1. Calibration / Control Reliability
Although calibration logic has improved, it still needs proper testing and tuning.
Potential issues:
- calibration may still feel unclear to the player
- hand stillness thresholds may need tuning
- calibration messaging/UI is still basic
- hand loss can interrupt interaction flow

### 2. Rover Responsiveness
The rover may still feel:
- slow to start moving
- slightly unresponsive
- hard to control precisely
- unclear in terms of whether throttle or steer is active enough

Possible reasons:
- throttle and drag balancing may still need tuning
- steering deadzone may need refinement
- hand gesture mapping may not yet feel intuitive enough

### 3. Visual Guidance / Route Clarity
The route is still not obvious enough.
Current route guidance includes:
- path line
- beacon
- arrow
But the environment still feels too open and unclear.

### 4. User Experience
The game still needs a proper flow:
- show hands
- calibrating
- calibrated / ready
- start countdown
- go
- finish / score screen

Right now the functional pipeline exists, but the experience is not yet polished enough for a final demo.

---

## Likely Causes of Remaining Problems

### Calibration Issues
The biggest earlier issue was calibrating based on near-zero control values instead of hand stability. That has been changed, but the values may still need tuning:
- `STABLE_N`
- `STABLE_EPS`
- deadzone values
- control lerp values

### Movement Issues
The rover movement depends on:
- hand tracking confidence
- control smoothing
- throttle magnitude
- acceleration vs drag values

If controls feel weak, likely causes are:
- throttle values too small
- drag too aggressive
- hand movement range too small
- calibration center not matching real user posture

### Environment Issues
The terrain exists, but the game still lacks:
- stronger route boundaries
- track walls / canyon edges
- larger visual markers
- obstacle placement
- better alien surface styling

---

## Most Important Files

### `index.html`
Contains:
- UI structure
- buttons
- HUD containers
- debug overlay elements
- game canvas

### `style.css`
Contains:
- layout
- HUD styling
- debug panel styling
- steering guide styling

### `main.js`
Contains:
- hand tracking setup
- calibration logic
- rover control logic
- terrain generation
- checkpoint/gate setup
- render loop
- UI button behavior

This file currently holds most of the project logic and is the main place future contributors will work in.

---

## What Someone Picking Up This Project Should Know

1. This is currently a prototype, not a finished game.
2. The hand tracking itself works; the main challenge now is interaction design and tuning.
3. The highest priority is not graphics first — it is making the controls feel intuitive and reliable.
4. The game should be easy enough for a child to understand quickly.
5. The current code is mostly in one file (`main.js`), so modularization would help if the project grows.
6. The goal is to eventually make this feel like a polished BMW-branded off-world exploration demo.

---

## Recommended Immediate Priorities

### Priority 1: Stabilize Controls
- tune calibration thresholds
- tune steering sensitivity
- tune throttle responsiveness
- test with multiple users

### Priority 2: Improve Game Flow
Add a proper state sequence:
- waiting for hands
- calibrating
- ready
- countdown
- race
- finish

### Priority 3: Make the Route Obvious
- replace thin path line with a glowing road / lane
- add walls, canyon boundaries, or track rails
- enlarge markers and finish gate

### Priority 4: Improve Visual Theme
- stronger alien planet look
- rocks / crystals / obstacles
- dust particles
- better colors and lighting
- BMW identity / branding

---

## Suggested Task Split for Team Members (Does not have to be rather just try do everything)

---

### Notes for Future Improvement

Potential next steps:

add countdown before race starts

add mission complete screen

add obstacle collisions

add score/timer summary

add BMW rover model

convert path line into real road

modularize main.js

### Team Member 1 – Input / Interaction
Focus on:
- calibration
- gesture control tuning
- steering / throttle response
- testing hand tracking with multiple users

### Team Member 2 – Environment / Game Feel
Focus on:
- route clarity
- obstacles
- track boundaries
- visual improvements
- game flow polish

Optional future split:
- one person handles UI/screens/HUD
- one person handles 3D environment and assets
- one person handles gesture input / calibration

---

## Current Run Instructions

Open terminal in project folder and run:

```bash
python -m http.server 8000