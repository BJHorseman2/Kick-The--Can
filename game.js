/* game.js — Kick the Can · Night Edition (Three.js) */
import * as THREE from 'three';

// ── constants ───────────────────────────────────────────────────────
const ARENA_W = 40, ARENA_H = 30;
const IT_SPEED = 12, HIDER_SPEED = 3;
const FLASH_RADIUS = 8;
const CAPTURE_DIST = 1.8;
const JAIL_X = ARENA_W / 2 - 4, JAIL_Z = -ARENA_H / 2 + 5;
const JAIL_W = 6, JAIL_H = 8;
const NUM_HIDERS = 3;
const COUNTDOWN_SEC = 3;

// ── renderer ────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;
document.body.appendChild(renderer.domElement);

// ── scene ───────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050e08);
scene.fog = new THREE.FogExp2(0x050e08, 0.04);

// ── camera (top-down with slight tilt) ──────────────────────────────
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 28, 16);
camera.lookAt(0, 0, 0);

// ── lights ──────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0x112211, 0.3));

// flashlight (SpotLight following "It")
const flashlight = new THREE.SpotLight(0xffffff, 40, 30, Math.PI / 5, 0.5, 1.5);
flashlight.position.set(0, 12, 0);
flashlight.castShadow = true;
flashlight.shadow.mapSize.set(1024, 1024);
scene.add(flashlight);
scene.add(flashlight.target);

// soft moonlight from above
const moon = new THREE.DirectionalLight(0x334466, 0.15);
moon.position.set(-10, 20, -10);
scene.add(moon);

// ── ground ──────────────────────────────────────────────────────────
const groundGeo = new THREE.PlaneGeometry(ARENA_W + 4, ARENA_H + 4);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a2e1a, roughness: 0.9 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// arena border
const borderGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(ARENA_W, ARENA_H));
const borderMat = new THREE.LineBasicMaterial({ color: 0x335533 });
const border = new THREE.LineSegments(borderGeo, borderMat);
border.rotation.x = -Math.PI / 2;
border.position.y = 0.01;
scene.add(border);

// ── can (center) ────────────────────────────────────────────────────
const canGroup = new THREE.Group();
const canBody = new THREE.Mesh(
  new THREE.CylinderGeometry(0.5, 0.5, 1.4, 16),
  new THREE.MeshStandardMaterial({ color: 0xcc3333, metalness: 0.7, roughness: 0.3 })
);
canBody.position.y = 0.7;
canBody.castShadow = true;
canGroup.add(canBody);
// lid
const lid = new THREE.Mesh(
  new THREE.CylinderGeometry(0.52, 0.52, 0.1, 16),
  new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.8, roughness: 0.2 })
);
lid.position.y = 1.45;
canGroup.add(lid);
// glow ring
const glowRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.9, 0.05, 8, 32),
  new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.4 })
);
glowRing.rotation.x = -Math.PI / 2;
glowRing.position.y = 0.05;
canGroup.add(glowRing);
scene.add(canGroup);

// ── jail zone ───────────────────────────────────────────────────────
const jailFloor = new THREE.Mesh(
  new THREE.PlaneGeometry(JAIL_W, JAIL_H),
  new THREE.MeshStandardMaterial({ color: 0x888822, transparent: true, opacity: 0.15 })
);
jailFloor.rotation.x = -Math.PI / 2;
jailFloor.position.set(JAIL_X, 0.02, JAIL_Z);
scene.add(jailFloor);
// jail border posts
const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 2, 6);
const postMat = new THREE.MeshStandardMaterial({ color: 0xaaaa44 });
for (const dx of [-JAIL_W / 2, JAIL_W / 2]) {
  for (const dz of [-JAIL_H / 2, JAIL_H / 2]) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(JAIL_X + dx, 1, JAIL_Z + dz);
    scene.add(post);
  }
}
// jail label
const jailLabel = makeTextSprite('JAIL', 0xffff66);
jailLabel.position.set(JAIL_X, 2.8, JAIL_Z);
scene.add(jailLabel);

// ── "It" (seeker) ───────────────────────────────────────────────────
const itMat = new THREE.MeshStandardMaterial({ color: 0x2196f3, emissive: 0x0d47a1, emissiveIntensity: 0.3 });
const itMesh = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 16), itMat);
itMesh.position.set(0, 0.6, 4);
itMesh.castShadow = true;
scene.add(itMesh);
// "It" ring indicator
const itRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.8, 0.04, 8, 32),
  new THREE.MeshBasicMaterial({ color: 0x64b5f6, transparent: true, opacity: 0.5 })
);
itRing.rotation.x = -Math.PI / 2;
itRing.position.y = 0.05;
itMesh.add(itRing);

// ── hiders ──────────────────────────────────────────────────────────
const hiderColors = [0xffeb3b, 0xff9800, 0x8bc34a];
const hiderNames = ['Player 1', 'Player 2', 'Player 3'];
const hiders = [];
for (let i = 0; i < NUM_HIDERS; i++) {
  const mat = new THREE.MeshStandardMaterial({
    color: hiderColors[i], emissive: hiderColors[i], emissiveIntensity: 0.1,
    transparent: true, opacity: 1
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 12), mat);
  mesh.castShadow = true;
  const x = (Math.random() - 0.5) * (ARENA_W - 4);
  const z = (Math.random() - 0.5) * (ARENA_H - 4);
  mesh.position.set(x, 0.5, z);
  scene.add(mesh);

  const label = makeTextSprite(hiderNames[i], hiderColors[i]);
  label.position.set(0, 1.6, 0);
  mesh.add(label);

  hiders.push({ mesh, mat, label, state: 'hiding', name: hiderNames[i] });
}

// ── game state ──────────────────────────────────────────────────────
let gameState = 'countdown';
let countdown = COUNTDOWN_SEC;
const input = { x: 0, z: 0 };       // normalized direction
const keys = {};                      // keyboard state
const clock = new THREE.Clock();

// ── HUD helpers ─────────────────────────────────────────────────────
const hudEl = document.getElementById('hud');
const msgEl = document.getElementById('message');
let msgTimer = 0;

function showMessage(text, duration = 1.5) {
  msgEl.textContent = text;
  msgEl.classList.add('show');
  msgTimer = duration;
}

// ── text sprite factory ─────────────────────────────────────────────
function makeTextSprite(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 32px Arial';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#' + new THREE.Color(color).getHexString();
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3, 0.75, 1);
  return sprite;
}

// ── keyboard input ──────────────────────────────────────────────────
window.addEventListener('keydown', e => { keys[e.code] = true; });
window.addEventListener('keyup', e => { keys[e.code] = false; });

// ── touch joystick ──────────────────────────────────────────────────
const joystickZone = document.getElementById('joystick-zone');
const joystickBase = document.getElementById('joystick-base');
const joystickThumb = document.getElementById('joystick-thumb');
let touchId = null, touchOrigin = null;

joystickZone.addEventListener('touchstart', e => {
  e.preventDefault();
  const t = e.changedTouches[0];
  touchId = t.identifier;
  touchOrigin = { x: t.clientX, y: t.clientY };
  joystickBase.style.display = 'block';
  joystickBase.style.left = (t.clientX - 60) + 'px';
  joystickBase.style.bottom = (window.innerHeight - t.clientY - 60) + 'px';
  joystickThumb.style.transform = 'translate(-50%,-50%)';
}, { passive: false });

joystickZone.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier !== touchId) continue;
    const dx = t.clientX - touchOrigin.x;
    const dy = t.clientY - touchOrigin.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxR = 50;
    const clamp = Math.min(dist, maxR);
    const angle = Math.atan2(dy, dx);
    const cx = Math.cos(angle) * clamp;
    const cy = Math.sin(angle) * clamp;
    joystickThumb.style.transform = `translate(calc(-50% + ${cx}px), calc(-50% + ${cy}px))`;
    const norm = Math.min(dist / maxR, 1);
    input.x = Math.cos(angle) * norm;
    input.z = Math.sin(angle) * norm;
  }
}, { passive: false });

const endTouch = e => {
  for (const t of e.changedTouches) {
    if (t.identifier !== touchId) continue;
    touchId = null; touchOrigin = null;
    input.x = 0; input.z = 0;
    joystickBase.style.display = 'none';
    joystickThumb.style.transform = 'translate(-50%,-50%)';
  }
};
joystickZone.addEventListener('touchend', endTouch);
joystickZone.addEventListener('touchcancel', endTouch);

// ── resize ──────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── clamp helper ────────────────────────────────────────────────────
function clampToArena(pos) {
  pos.x = Math.max(-ARENA_W / 2 + 0.6, Math.min(ARENA_W / 2 - 0.6, pos.x));
  pos.z = Math.max(-ARENA_H / 2 + 0.6, Math.min(ARENA_H / 2 - 0.6, pos.z));
}

// ── main loop ───────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  // ── message fade ──
  if (msgTimer > 0) {
    msgTimer -= dt;
    if (msgTimer <= 0) msgEl.classList.remove('show');
  }

  // ── countdown ──
  if (gameState === 'countdown') {
    countdown -= dt;
    hudEl.textContent = 'Hide! ' + Math.ceil(countdown);
    if (countdown <= 0) {
      gameState = 'play';
      hudEl.textContent = 'Catch hiders in your flashlight!';
    }
    // hiders scatter during countdown
    for (const h of hiders) {
      moveToward(h.mesh.position, randomScatterTarget(h), HIDER_SPEED * 1.5, dt);
      clampToArena(h.mesh.position);
    }
    updateFlashlight();
    renderer.render(scene, camera);
    return;
  }

  // ── "It" movement (keyboard + joystick) ──
  let dx = input.x, dz = input.z;
  if (keys['ArrowLeft'] || keys['KeyA']) dx -= 1;
  if (keys['ArrowRight'] || keys['KeyD']) dx += 1;
  if (keys['ArrowUp'] || keys['KeyW']) dz -= 1;
  if (keys['ArrowDown'] || keys['KeyS']) dz += 1;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len > 0) {
    dx /= len; dz /= len;
    itMesh.position.x += dx * IT_SPEED * dt;
    itMesh.position.z += dz * IT_SPEED * dt;
    clampToArena(itMesh.position);
  }

  updateFlashlight();

  // ── rotate can glow ──
  glowRing.rotation.z += dt * 0.5;

  // ── hider AI ──
  for (const h of hiders) {
    if (h.state === 'hiding') {
      moveToward(h.mesh.position, new THREE.Vector3(0, 0.5, 0), HIDER_SPEED, dt);
      clampToArena(h.mesh.position);

      // check capture
      const dist = distXZ(itMesh.position, h.mesh.position);
      if (dist < CAPTURE_DIST && dist < FLASH_RADIUS) {
        h.state = 'jailed';
        showMessage('Got ' + h.name + '!');
      }

      // check jailbreak
      const canDist = distXZ(h.mesh.position, canGroup.position);
      if (canDist < 1.2) {
        tryJailbreak(h);
      }
    } else if (h.state === 'jailed') {
      // sit in jail
      const jx = JAIL_X + (Math.random() - 0.5) * (JAIL_W - 1);
      const jz = JAIL_Z + (Math.random() - 0.5) * (JAIL_H - 1);
      h.mesh.position.lerp(new THREE.Vector3(jx, 0.5, jz), 0.05);
    }

    // visibility based on flashlight distance
    const dist = distXZ(itMesh.position, h.mesh.position);
    const inLight = dist < FLASH_RADIUS;
    h.mat.opacity = inLight ? 1.0 : 0.15;
    h.label.material.opacity = inLight ? 1.0 : 0.0;
  }

  // ── win check ──
  const jailedCount = hiders.filter(h => h.state === 'jailed').length;
  if (jailedCount === NUM_HIDERS) {
    hudEl.textContent = 'You win! All hiders captured!';
    gameState = 'won';
    showMessage('YOU WIN!', 999);
  }

  renderer.render(scene, camera);
}

function updateFlashlight() {
  flashlight.position.set(itMesh.position.x, 12, itMesh.position.z);
  flashlight.target.position.set(itMesh.position.x, 0, itMesh.position.z);
}

function moveToward(pos, target, speed, dt) {
  const dx = target.x - pos.x;
  const dz = target.z - pos.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < 0.1) return;
  pos.x += (dx / dist) * speed * dt;
  pos.z += (dz / dist) * speed * dt;
}

function distXZ(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

// give each hider a random scatter target during countdown
const scatterTargets = new Map();
function randomScatterTarget(h) {
  if (!scatterTargets.has(h)) {
    scatterTargets.set(h, new THREE.Vector3(
      (Math.random() - 0.5) * (ARENA_W - 4),
      0.5,
      (Math.random() - 0.5) * (ARENA_H - 4)
    ));
  }
  return scatterTargets.get(h);
}

function tryJailbreak(trigger) {
  if (trigger.state !== 'hiding') return;
  trigger.state = 'freeing';
  showMessage('JAILBREAK!', 2);
  setTimeout(() => {
    for (const h of hiders) h.state = 'hiding';
  }, 100);
}

animate();
