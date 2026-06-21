// aircraft.js
// Procedural Boeing 747-400 model for Three.js.
// Coordinate system:  +Z = forward (nose),  -Z = aft (tail)
//                     +X = right wing,  -X = left wing
//                     +Y = up.  Wheels touch ground at y = 0.
//
// Real 747-400 reference dimensions (metres), 1 unit = 1 metre:
//   Length 70.6, Wingspan 64.4, Tail height 19.4, Fuselage dia ~6.5.

import * as THREE from 'three';

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------
//  Generic lofted surface from a stack of rings (each ring = array of Vec3).
//  uGen(i) -> texture u for station i ; vGen(j,M) -> texture v around ring.
// ---------------------------------------------------------------------------
function loft(rings, { closed = true, uOf, vOf, capStart = false, capEnd = false } = {}) {
  const stations = rings.length;
  const M = rings[0].length;
  const pos = [];
  const uv = [];
  for (let i = 0; i < stations; i++) {
    for (let j = 0; j < M; j++) {
      const p = rings[i][j];
      pos.push(p.x, p.y, p.z);
      uv.push(uOf ? uOf(i, stations) : i / (stations - 1),
              vOf ? vOf(j, M) : j / (M - (closed ? 0 : 1)));
    }
  }
  const idx = [];
  const wrap = closed ? M : M - 1;
  for (let i = 0; i < stations - 1; i++) {
    for (let j = 0; j < wrap; j++) {
      const a = i * M + j;
      const b = i * M + ((j + 1) % M);
      const c = (i + 1) * M + j;
      const d = (i + 1) * M + ((j + 1) % M);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
//  Procedural livery texture: white over grey, cheatline, cabin windows,
//  cockpit windows, doors.  Canvas X = length (nose left), Y = circumference.
// ---------------------------------------------------------------------------
function makeLiveryTexture() {
  const W = 4096, H = 1024;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');

  // v (canvas Y) meaning:  0 = right side, .25 = top crown, .5 = left side,
  //                        .75 = belly.   (matches a = vCoord*2PI)
  // Vertical paint scheme: white upper, light-grey belly.
  const grad = c.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0.00, '#f7f8fa'); // right side upper
  grad.addColorStop(0.22, '#fbfcfd'); // crown
  grad.addColorStop(0.28, '#fdfdfe');
  grad.addColorStop(0.50, '#f6f7f9'); // left side upper
  grad.addColorStop(0.62, '#eceef1');
  grad.addColorStop(0.75, '#d7dbe0'); // belly grey
  grad.addColorStop(0.88, '#e6e9ed');
  grad.addColorStop(1.00, '#f7f8fa');
  c.fillStyle = grad;
  c.fillRect(0, 0, W, H);

  // subtle panel lines along the length (every ~2.5 m)
  c.strokeStyle = 'rgba(120,130,140,0.10)';
  c.lineWidth = 1;
  for (let x = 0; x < W; x += W / 30) {
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
  }
  // circumferential panel lines
  for (let y = 0; y < H; y += H / 18) {
    c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
  }

  // Cheatline (navy) running along both window rows.
  const rows = [0.045 * H, 0.545 * H];      // just above right & left window rows
  c.fillStyle = '#15315e';
  rows.forEach(y => c.fillRect(W * 0.10, y + 22, W * 0.86, 14));
  c.fillStyle = '#3a78c8';
  rows.forEach(y => c.fillRect(W * 0.10, y + 36, W * 0.86, 6));

  // Cabin windows: dark rounded squares along the two side rows.
  const winY = [0.02 * H, 0.52 * H];
  c.fillStyle = '#10171f';
  const startX = W * 0.135, endX = W * 0.93, n = 95;
  for (const wy of winY) {
    for (let k = 0; k < n; k++) {
      const x = lerp(startX, endX, k / (n - 1));
      c.beginPath();
      c.roundRect(x - 7, wy - 9, 14, 18, 5);
      c.fill();
    }
  }

  // Upper-deck windows (short row on the hump shoulders).
  // NB: CanvasTexture flipY -> fuselage top maps to canvas Y ≈ 0.75*H.
  const deckY = [0.70 * H, 0.80 * H];
  for (const wy of deckY) {
    for (let k = 0; k < 18; k++) {
      const x = lerp(W * 0.125, W * 0.305, k / 17);
      c.beginPath();
      c.roundRect(x - 6, wy - 8, 12, 16, 4);
      c.fill();
    }
  }

  // Cockpit windows (wrap-around, near the nose top).
  c.fillStyle = '#0b1119';
  const cx0 = W * 0.083, cyTop = 0.75 * H;
  for (const sgn of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const yy = cyTop + sgn * (0.028 + k * 0.045) * H;
      const xx = cx0 + k * 30;
      const sz = k < 2 ? 1.0 : 0.82;
      c.save();
      c.translate(xx, yy);
      c.rotate(sgn * 0.22);
      c.beginPath();
      c.roundRect(-16 * sz, -17 * sz, 32 * sz, 34 * sz, 6);
      c.fill();
      c.restore();
    }
  }

  // Doors (4 per side) – slightly lighter outline rectangles.
  c.strokeStyle = 'rgba(90,100,110,0.5)';
  c.lineWidth = 3;
  const doorXs = [0.20, 0.40, 0.66, 0.86];
  for (const wy of winY) {
    for (const dx of doorXs) {
      const x = W * dx;
      c.strokeRect(x - 14, wy - 30, 28, 70);
    }
  }

  // Belly anti-glare / grey wing-root shadow hint near centre bottom.
  c.fillStyle = 'rgba(90,100,110,0.10)';
  c.fillRect(W * 0.40, 0.70 * H, W * 0.25, 0.18 * H);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---------------------------------------------------------------------------
//  Fuselage with blended forward upper-deck hump.
// ---------------------------------------------------------------------------
function buildFuselage(materials) {
  const zNose = 38.5, zTail = -34.5;
  const NS = 240, M = 64;
  const baseY = 5.0;
  const R = 3.25;                       // main fuselage radius

  // circular cross-section; blunt short radome, tapered upswept tail.
  const widthAt = (z) => {
    let w = R * Math.sqrt(smoothstep(38.5, 33.0, z));   // blunt radome, full by z=33
    w *= 1 - 0.97 * smoothstep(-12, -34.0, z);          // aft taper
    return Math.max(0.05, w);
  };
  const keelAt = (z) => widthAt(z) * 0.96;              // very slight belly flatten
  const centerYAt = (z) => {
    let y = baseY;
    y += 3.0 * smoothstep(-12, -33, z);                 // tail upsweep
    y -= 0.35 * smoothstep(34.5, 38.5, z);              // very slight nose droop
    return y;
  };
  const radiusAt = (z) => widthAt(z);

  // Forward upper-deck hump, integrated as a localized rounded crown bump so it
  // blends seamlessly into the circular fuselage (no floating-pod seam).
  const zF = 31.5, zB = 6.0;                 // cockpit front .. fair-out aft
  const HUMP_W = 2.55;                        // half-width of the bump
  const humpHeight = (z) => {
    const back = smoothstep(zB - 1.0, zB + 7.0, z);
    const front = 1 - smoothstep(zF - 1.5, zF + 1.5, z);
    return 2.45 * Math.max(0, Math.min(back, front));
  };
  const crownAt = (z) => centerYAt(z) + widthAt(z) + humpHeight(z);

  const rings = [];
  const tOf = [];
  for (let i = 0; i < NS; i++) {
    const t = i / (NS - 1);
    const z = lerp(zNose, zTail, t);
    tOf.push(t);
    const hw = widthAt(z), botR = keelAt(z), cy = centerYAt(z);
    const hh = humpHeight(z);
    const ring = [];
    for (let j = 0; j < M; j++) {
      const a = (j / M) * Math.PI * 2;          // 0=right, PI/2 top, PI left, 3PI/2 bottom
      const s = Math.sin(a);
      const vr = s >= 0 ? hw : botR;
      const x = hw * Math.cos(a);
      let y = cy + vr * s;
      if (s > 0 && hh > 0.001) {                 // lift crown region only
        const q = Math.min(1, Math.abs(x) / HUMP_W);
        const shape = Math.pow(Math.cos(q * Math.PI / 2), 1.3);
        y += hh * shape;
      }
      ring.push(new THREE.Vector3(x, y, z));
    }
    rings.push(ring);
  }
  const g = loft(rings, { closed: true, uOf: (i) => tOf[i], vOf: (j, m) => j / m });
  const mesh = new THREE.Mesh(g, materials.fuselage);
  mesh.castShadow = true; mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.add(mesh);

  return { group, zNose, zTail, baseY, radiusAt, centerYAt, crownAt, keelAt, humpHeight };
}

// ---------------------------------------------------------------------------
//  Airfoil (symmetric NACA-ish) half-thickness at chord fraction c in [0,1].
// ---------------------------------------------------------------------------
function naca(c, tc) {
  return 5 * tc * (0.2969 * Math.sqrt(c) - 0.1260 * c - 0.3516 * c * c +
                   0.2843 * c * c * c - 0.1015 * c * c * c * c);
}

// Build a lofted lifting surface (wing / stabiliser).
function buildSurface({
  side = 1, rootChord, tipChord, span, sweep, dihedral, tc,
  rootZ, rootY, rootX, vertical = false, mat,
}) {
  const NSPAN = 26, NC = 34;
  const rings = [];
  for (let s = 0; s <= NSPAN; s++) {
    const f = s / NSPAN;
    const chord = lerp(rootChord, tipChord, Math.pow(f, 0.85));
    const offset = f * span;
    const zLE = rootZ - offset * Math.tan(sweep);
    const ring = [];
    for (let k = 0; k < NC; k++) {
      // go around airfoil: top LE->TE then bottom TE->LE
      let cc, sign;
      if (k < NC / 2) { cc = k / (NC / 2 - 1); sign = 1; }
      else { cc = 1 - (k - NC / 2) / (NC / 2 - 1); sign = -1; }
      cc = Math.max(0, Math.min(1, cc));
      const th = naca(cc, tc) * chord * sign;
      const zc = zLE - cc * chord;
      if (vertical) {
        // span goes up in Y, thickness in X, chord in Z
        const x = rootX + th;
        const y = rootY + offset;            // dihedral n/a
        const zz = zc + offset * 0.0;
        ring.push(new THREE.Vector3(x, y, zz));
      } else {
        const x = rootX + side * offset;
        const y = rootY + offset * Math.tan(dihedral) + th;
        ring.push(new THREE.Vector3(x, y, zc));
      }
    }
    rings.push(ring);
  }
  const g = loft(rings, { closed: true });
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

// Triangular prism (used for the dorsal fin fillet). pts = 3 × [z, y].
function buildPrism(mat, pts, half) {
  const v = [];
  for (const sx of [half, -half]) for (const p of pts) v.push(sx, p[1], p[0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex([0, 1, 2, 3, 5, 4,
              0, 1, 4, 0, 4, 3,
              1, 2, 5, 1, 5, 4,
              2, 0, 3, 2, 3, 5]);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// Canted winglet at a wing tip.  tip = {x,y,zLE,chord}
function buildWinglet(side, tip, mat) {
  const surf = buildSurface({
    side: 1, rootChord: tip.chord * 0.95, tipChord: tip.chord * 0.38, span: 3.4,
    sweep: THREE.MathUtils.degToRad(48), dihedral: 0, tc: 0.10,
    rootZ: 0, rootY: 0, rootX: 0, vertical: true, mat,
  });
  const g = new THREE.Group();
  g.add(surf);
  g.position.set(tip.x, tip.y, tip.zLE - tip.chord * 0.5);
  // cant the winglet outboard ~22° from vertical
  g.rotation.z = side * THREE.MathUtils.degToRad(-22);
  return g;
}

// ---------------------------------------------------------------------------
//  Turbofan nacelle + pylon.
// ---------------------------------------------------------------------------
function buildEngine(materials, { x, y, z, scale = 1 }) {
  const g = new THREE.Group();
  const L = 6.8 * scale, R = 1.5 * scale;
  const front = L / 2;

  // Cowl: mostly cylindrical, rounded inlet lip, tapered exhaust nozzle.
  const pts = [
    [0.80, 0.00], [0.93, 0.03], [1.00, 0.08], [1.00, 0.45],
    [0.98, 0.62], [0.90, 0.80], [0.80, 0.92], [0.74, 1.00],
  ].map(([r, t]) => new THREE.Vector2(r * R, t * L));
  const cowlGeo = new THREE.LatheGeometry(pts, 56);
  cowlGeo.rotateX(-Math.PI / 2);           // axis along Z, front at +Z
  cowlGeo.translate(0, 0, -L / 2);
  const cowl = new THREE.Mesh(cowlGeo, materials.engine);
  cowl.castShadow = true; cowl.receiveShadow = true;
  g.add(cowl);

  // Dark intake interior (deep, so inlet reads black).
  const intake = new THREE.Mesh(
    new THREE.CylinderGeometry(0.78 * R, 0.62 * R, 1.6 * scale, 48, 1, true), materials.intake);
  intake.rotation.x = Math.PI / 2;
  intake.position.z = front - 0.8 * scale;
  g.add(intake);
  const back = new THREE.Mesh(new THREE.CircleGeometry(0.62 * R, 48), materials.fan);
  back.position.z = front - 1.55 * scale;
  back.rotation.y = Math.PI;
  g.add(back);

  // Chrome inlet lip ring.
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.80 * R, 0.06 * R, 16, 56), materials.chrome);
  lip.position.z = front - 0.02 * scale;
  g.add(lip);

  // Fan + spinner.
  const fan = new THREE.Mesh(new THREE.CircleGeometry(0.6 * R, 48), materials.fan);
  fan.position.z = front - 1.0 * scale; fan.rotation.y = Math.PI;
  g.add(fan);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.14 * R, 0.55 * scale, 24), materials.chrome);
  spinner.rotation.x = Math.PI / 2;
  spinner.position.z = front - 0.75 * scale;
  g.add(spinner);

  // Exhaust plug (hot core, dark).
  const plug = new THREE.Mesh(new THREE.ConeGeometry(0.45 * R, 1.4 * scale, 32), materials.intake);
  plug.rotation.x = -Math.PI / 2;
  plug.position.z = -front + 0.3 * scale;
  g.add(plug);

  g.position.set(x, y, z);
  return g;
}

function buildPylon(materials, fromX, fromY, fromZ, toX, toY, toZ) {
  const dir = new THREE.Vector3(toX - fromX, toY - fromY, toZ - fromZ);
  const len = dir.length();
  const geo = new THREE.BoxGeometry(0.35, len, 1.9);
  const m = new THREE.Mesh(geo, materials.engine);
  m.castShadow = true;
  m.position.set((fromX + toX) / 2, (fromY + toY) / 2, (fromZ + toZ) / 2 + 0.3);
  // orient along dir (mostly vertical)
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
  m.quaternion.copy(q);
  return m;
}

// ---------------------------------------------------------------------------
//  Landing gear (simplified): strut + wheel set.
// ---------------------------------------------------------------------------
function buildGearLeg(materials, { x, z, top, nWheels = 4, wheelR = 0.62, axleSpan = 1.5, twin = true }) {
  const g = new THREE.Group();
  const strutLen = top;                 // from y=top down to wheels
  const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, strutLen, 16), materials.gear);
  strut.position.y = top / 2 + wheelR;
  strut.castShadow = true;
  g.add(strut);

  // bogie beam
  const beam = new THREE.Mesh(new THREE.BoxGeometry(twin ? 1.1 : 0.5, 0.22, axleSpan + 0.6), materials.gear);
  beam.position.y = wheelR + 0.1;
  g.add(beam);

  const rows = nWheels / (twin ? 2 : 1);
  const wheelMat = materials.tire;
  for (let r = 0; r < rows; r++) {
    const zz = lerp(-axleSpan / 2, axleSpan / 2, rows === 1 ? 0.5 : r / (rows - 1));
    const xs = twin ? [-0.55, 0.55] : [0];
    for (const wx of xs) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, 0.36, 28), wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, wheelR, zz);
      w.castShadow = true;
      g.add(w);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.38, 16), materials.chrome);
      hub.rotation.z = Math.PI / 2;
      hub.position.set(wx, wheelR, zz);
      g.add(hub);
    }
  }
  g.position.set(x, 0, z);
  return g;
}

// Cockpit windscreen + side windows (dark angled panels on the nose top).
function buildCockpit(materials) {
  const g = new THREE.Group();
  const mk = (w, h, px, py, pz, rx, ry) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), materials.glass);
    m.position.set(px, py, pz);
    m.rotation.set(rx, ry, 0);
    g.add(m);
  };
  // Two-piece windscreen (V), angled back and outward.
  mk(1.45, 1.0, -0.82, 8.55, 31.6, -0.7, 0.28);
  mk(1.45, 1.0, 0.82, 8.55, 31.6, -0.7, -0.28);
  // Side / eyebrow windows stepping down and forward.
  mk(1.25, 0.85, -1.75, 8.0, 30.9, -0.55, 0.8);
  mk(1.25, 0.85, 1.75, 8.0, 30.9, -0.55, -0.8);
  mk(1.0, 0.75, -2.15, 7.5, 30.0, -0.45, 1.0);
  mk(1.0, 0.75, 2.15, 7.5, 30.0, -0.45, -1.0);
  return g;
}

// ---------------------------------------------------------------------------
//  Materials
// ---------------------------------------------------------------------------
function makeMaterials() {
  const livery = makeLiveryTexture();
  return {
    fuselage: new THREE.MeshStandardMaterial({ map: livery, color: 0xffffff, metalness: 0.18, roughness: 0.34 }),
    fuselage2: new THREE.MeshStandardMaterial({ color: 0xf2f4f6, metalness: 0.18, roughness: 0.34 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0a0f16, metalness: 0.6, roughness: 0.12 }),
    wing: new THREE.MeshStandardMaterial({ color: 0xeef0f2, metalness: 0.30, roughness: 0.30 }),
    tail: new THREE.MeshStandardMaterial({ color: 0xc0392b, metalness: 0.20, roughness: 0.40, side: THREE.DoubleSide }),
    engine: new THREE.MeshStandardMaterial({ color: 0xf2f3f5, metalness: 0.25, roughness: 0.30 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 1.0, roughness: 0.18 }),
    intake: new THREE.MeshStandardMaterial({ color: 0x1c2026, metalness: 0.5, roughness: 0.5, side: THREE.DoubleSide }),
    fan: new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.8, roughness: 0.35 }),
    gear: new THREE.MeshStandardMaterial({ color: 0x6b7178, metalness: 0.8, roughness: 0.4 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x14161a, metalness: 0.0, roughness: 0.85 }),
  };
}

// ---------------------------------------------------------------------------
//  Assemble the whole aircraft.
// ---------------------------------------------------------------------------
export function createBoeing747() {
  const root = new THREE.Group();
  const M = makeMaterials();

  const fus = buildFuselage(M);
  root.add(fus.group);
  const cY = fus.centerYAt;

  // ---- Wing-body belly fairing (signature 747 lower bulge) ----
  const fairing = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), M.fuselage2);
  fairing.scale.set(3.85, 2.45, 12.5);
  fairing.position.set(0, cY(-3) - 1.7, -3.5);
  fairing.castShadow = true; fairing.receiveShadow = true;
  root.add(fairing);

  // ---- Wings (low-mounted, swept 37.5°, dihedral ~6°) ----
  const wingRootZ = -2.0;
  const wingRootY = cY(wingRootZ) - 2.6;   // low on fuselage
  const wingRootX = 2.6;
  const sweep = THREE.MathUtils.degToRad(37.5);
  const dih = THREE.MathUtils.degToRad(6);
  const wingSpan = 29.5;
  const wingTipChord = 3.8;
  for (const side of [1, -1]) {
    root.add(buildSurface({
      side, rootChord: 14.5, tipChord: wingTipChord, span: wingSpan, sweep, dihedral: dih,
      tc: 0.12, rootZ: wingRootZ, rootY: wingRootY, rootX: side * wingRootX, mat: M.wing,
    }));
    // winglet at tip
    const tip = {
      x: side * (wingRootX + wingSpan),
      y: wingRootY + wingSpan * Math.tan(dih),
      zLE: wingRootZ - wingSpan * Math.tan(sweep),
      chord: wingTipChord,
    };
    root.add(buildWinglet(side, tip, M.wing));
  }

  // ---- Engines (4) hung below/forward of wing ----
  const engStations = [
    { f: 0.26, scale: 0.95 },   // inboard
    { f: 0.53, scale: 0.92 },   // outboard
  ];
  for (const side of [1, -1]) {
    for (const es of engStations) {
      const offset = es.f * wingSpan;
      const wx = side * (wingRootX + offset);
      const zLE = wingRootZ - offset * Math.tan(sweep);
      const wy = wingRootY + offset * Math.tan(dih);
      const ex = wx;
      const ey = wy - 1.75;
      const ez = zLE + 3.4;     // forward of LE
      root.add(buildEngine(M, { x: ex, y: ey, z: ez, scale: es.scale }));
      root.add(buildPylon(M, ex, ey + 1.25, ez - 1.6, wx, wy - 0.3, zLE - 0.6));
    }
  }

  // ---- Vertical tail ----
  const tailRootZ = -27;
  const finRootY = cY(tailRootZ) + 0.5;
  const fin = buildSurface({
    side: 1, rootChord: 11, tipChord: 4.2, span: 11, sweep: THREE.MathUtils.degToRad(42),
    dihedral: 0, tc: 0.11, rootZ: tailRootZ, rootY: finRootY, rootX: 0, vertical: true, mat: M.tail,
  });
  root.add(fin);
  // dorsal fin fillet sweeping forward from the fin base into the LE
  root.add(buildPrism(M.tail, [[-13.5, 7.85], [-27.2, 8.5], [-28.8, 10.6]], 0.14));

  // ---- Horizontal stabilisers ----
  const hRootZ = -30;
  const hRootY = cY(hRootZ) + 0.4;
  for (const side of [1, -1]) {
    root.add(buildSurface({
      side, rootChord: 9.5, tipChord: 2.8, span: 13, sweep: THREE.MathUtils.degToRad(34),
      dihedral: THREE.MathUtils.degToRad(8), tc: 0.10, rootZ: hRootZ, rootY: hRootY,
      rootX: side * 1.6, mat: M.wing,
    }));
  }

  // ---- Landing gear ----
  const bellyY = (z) => cY(z) - fus.radiusAt(z);
  // nose gear
  root.add(buildGearLeg(M, { x: 0, z: 23, top: bellyY(23) - 0.5, nWheels: 2, wheelR: 0.6, axleSpan: 0.0, twin: true }));
  // wing main gear (2)
  for (const side of [1, -1]) {
    root.add(buildGearLeg(M, { x: side * 3.6, z: -4.5, top: bellyY(-4.5) - 0.4, nWheels: 4, wheelR: 0.62, axleSpan: 1.6, twin: true }));
  }
  // body main gear (2)
  for (const side of [1, -1]) {
    root.add(buildGearLeg(M, { x: side * 1.5, z: -8.5, top: bellyY(-8.5) - 0.4, nWheels: 4, wheelR: 0.62, axleSpan: 1.6, twin: true }));
  }

  root.userData.dimensions = { length: 70.6, span: 64.4, height: 19.4 };
  return root;
}
