/* ============================================================================
   SEAS OF SPARK — "The King's Hold"
   A self-contained HTML5 Canvas fishing/salvage game.
   No external assets: sky, ocean, boat, flotsam and FX are all procedural,
   so the graphics render anywhere, offline, on any screen size.

   Loop: cast your line at drifting flotsam, reel it into the hold (x/20),
   bank gold (Gp) before the tide-timer runs out. BRACE to ride a swell and
   pull the nearest catch in fast.
   ========================================================================== */
'use strict';

(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // --- Display / DPR handling ----------------------------------------------
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width  = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    layout();
  }
  window.addEventListener('resize', resize);

  // --- Helpers --------------------------------------------------------------
  const rand  = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp  = (a, b, t) => a + (b - a) * t;
  const TAU   = Math.PI * 2;

  function rrect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // --- World layout ---------------------------------------------------------
  // The horizon sits a bit above the vertical centre; sea fills the rest.
  let horizon = 0, seaTop = 0;
  function layout() {
    horizon = Math.round(H * 0.40);
    seaTop  = horizon;
    boat.x  = W * 0.5;
    boat.baseY = horizon + (H - horizon) * 0.30;
    buildButtons();
  }

  // --- Game state -----------------------------------------------------------
  const HOLD_MAX = 20;
  const ROUND_TIME = 60;          // seconds on the tide-clock
  const game = {
    gold: 1000093,
    hold: 0,
    time: ROUND_TIME,
    ring: 1,
    tide: 'LOW',
    running: true,
    over: false,
    shake: 0,
  };

  // --- The boat -------------------------------------------------------------
  const boat = { x: 0, baseY: 0, y: 0, rot: 0, bob: 0 };

  // --- The fishing line / hook ---------------------------------------------
  // states: idle -> casting (flying out) -> sunk (in water) -> reeling (back)
  const hook = {
    state: 'idle',
    x: 0, y: 0, vx: 0, vy: 0,
    tipX: 0, tipY: 0,     // rod tip anchor
    caught: null,
    power: 0,
  };

  // --- Flotsam (the catchable things) --------------------------------------
  const KINDS = [
    { name: 'crate',   col: '#b07a43', col2: '#7d5326', r: 16, gold: [40, 90],   spark: '#ffd76a' },
    { name: 'barrel',  col: '#8a5a33', col2: '#5e3b1f', r: 15, gold: [60, 120],  spark: '#ffce5a' },
    { name: 'bottle',  col: '#3fa7a0', col2: '#247b76', r: 10, gold: [20, 50],   spark: '#bdfff8' },
    { name: 'chest',   col: '#caa24a', col2: '#8a6a23', r: 18, gold: [180, 360], spark: '#fff1b0' },
    { name: 'lantern', col: '#f0b84a', col2: '#c98a25', r: 11, gold: [80, 150],  spark: '#ffe79a' },
  ];
  const flotsam = [];
  function spawnFlotsam(initial) {
    const k = KINDS[(Math.random() * KINDS.length) | 0];
    const fromLeft = Math.random() < 0.5;
    const x = initial ? rand(W * 0.1, W * 0.9) : (fromLeft ? -30 : W + 30);
    const depth = rand(0.18, 0.92);            // 0 = horizon, 1 = bottom
    flotsam.push({
      kind: k,
      x,
      depth,
      drift: (fromLeft ? 1 : -1) * rand(8, 22),
      phase: rand(0, TAU),
      bobAmp: rand(2, 5),
      caught: false,
      scale: lerp(0.6, 1.15, depth),
      wobble: rand(0.6, 1.4),
    });
  }
  function flotsamY(f) {
    const y = lerp(seaTop + 12, H - 36, f.depth);
    return y + Math.sin(f.phase) * f.bobAmp;
  }

  // --- Particles (the "spark") ---------------------------------------------
  const sparks = [];
  function burst(x, y, color, n, spread) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(0.4, 1) * (spread || 3);
      sparks.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.2,
        life: 1, decay: rand(0.012, 0.03), col: color, size: rand(1.5, 3.6),
      });
    }
  }
  const ripples = [];
  function ripple(x, y) { ripples.push({ x, y, r: 4, life: 1 }); }

  // --- Floating gold popups -------------------------------------------------
  const popups = [];
  function popup(x, y, text, col) {
    popups.push({ x, y, text, col: col || '#ffd76a', life: 1 });
  }

  // --- Stars (sky) ----------------------------------------------------------
  const stars = [];
  for (let i = 0; i < 90; i++) {
    stars.push({ x: Math.random(), y: Math.random(), s: rand(0.4, 1.6), tw: rand(0, TAU), sp: rand(1, 3) });
  }

  // --- Buttons --------------------------------------------------------------
  let btnCast = null, btnBrace = null;
  function buildButtons() {
    const bw = clamp(W * 0.30, 150, 260);
    const bh = 64, pad = 18, by = H - bh - 22;
    btnBrace = { x: pad, y: by, w: bw * 0.62, h: bh, label: 'BRACE', sub: 'ride the swell', held: false };
    btnCast  = { x: W - bw - pad, y: by, w: bw, h: bh, label: 'CAST THE LINE', sub: 'scoop the flotsam', held: false };
  }
  function inBtn(b, px, py) { return b && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h; }

  // ==========================================================================
  //  INPUT
  // ==========================================================================
  let braceActive = false, braceCooldown = 0;

  function tryCast() {
    if (!game.running) { restart(); return; }
    if (hook.state !== 'idle') return;
    hook.state = 'casting';
    const tip = rodTip();
    hook.x = tip.x; hook.y = tip.y;
    // aim toward the pointer, or straight out if none
    const tx = pointer.x || W * 0.5;
    const ty = pointer.y || (seaTop + (H - seaTop) * 0.5);
    const ang = Math.atan2(ty - tip.y, tx - tip.x);
    const sp = 13;
    hook.vx = Math.cos(ang) * sp;
    hook.vy = Math.sin(ang) * sp;
  }

  function doBrace() {
    if (braceCooldown > 0 || !game.running) return;
    braceActive = true;
    braceCooldown = 2.2;
    game.shake = Math.min(game.shake + 10, 16);
    burst(boat.x, boat.y, '#bfe8ff', 26, 4);
    // yank the nearest uncaught flotsam toward the boat
    let best = null, bd = 1e9;
    for (const f of flotsam) {
      if (f.caught) continue;
      const d = Math.hypot(f.x - boat.x, flotsamY(f) - boat.y);
      if (d < bd) { bd = d; best = f; }
    }
    if (best && bd < W * 0.55) {
      best.caught = true; hook.caught = best; hook.state = 'reeling';
      hook.x = best.x; hook.y = flotsamY(best);
      popup(best.x, flotsamY(best) - 20, 'BRACE!', '#bfe8ff');
    }
  }

  const pointer = { x: 0, y: 0, down: false };
  function evtPos(e) {
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX, y: t.clientY };
  }
  function onDown(e) {
    e.preventDefault();
    const p = evtPos(e); pointer.x = p.x; pointer.y = p.y; pointer.down = true;
    if (inBtn(btnBrace, p.x, p.y)) { btnBrace.held = true; doBrace(); return; }
    if (inBtn(btnCast,  p.x, p.y)) { btnCast.held  = true; tryCast(); return; }
    tryCast();
  }
  function onMove(e) {
    const p = evtPos(e); pointer.x = p.x; pointer.y = p.y;
  }
  function onUp(e) {
    pointer.down = false;
    if (btnBrace) btnBrace.held = false;
    if (btnCast)  btnCast.held = false;
    // releasing while the hook is in the water begins the reel-in
    if (hook.state === 'sunk') hook.state = 'reeling';
  }
  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('touchstart', onDown, { passive: false });
  canvas.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('touchend', onUp);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); tryCast(); }
    if (e.key === 'b' || e.key === 'B') doBrace();
    if (e.key === 'r' || e.key === 'R') restart();
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && hook.state === 'sunk') hook.state = 'reeling';
  });

  // ==========================================================================
  //  UPDATE
  // ==========================================================================
  let last = performance.now();
  let tAccum = 0;

  function rodTip() {
    // tip of the rod, ahead of and above the boat
    return { x: boat.x + 46, y: boat.y - 54 };
  }

  function update(dt, now) {
    tAccum += dt;

    // boat bob + gentle roll
    boat.bob = Math.sin(now * 0.0016) * 8 + Math.sin(now * 0.0031) * 4;
    let braceLift = braceActive ? -14 * Math.sin(Math.min((2.2 - braceCooldown) / 2.2, 1) * Math.PI) : 0;
    boat.y = boat.baseY + boat.bob + braceLift;
    boat.rot = Math.sin(now * 0.0016) * 0.05 + Math.sin(now * 0.0031) * 0.02;

    if (braceCooldown > 0) { braceCooldown -= dt; if (braceCooldown <= 0) braceActive = false; }

    // timer
    if (game.running) {
      game.time -= dt;
      if (game.time <= 0) { game.time = 0; endRound(); }
    }
    game.shake = Math.max(0, game.shake - dt * 22);

    // keep the sea populated
    const target = 7 + game.ring;
    while (flotsam.length < target) spawnFlotsam(tAccum < 0.1);

    // flotsam drift
    for (let i = flotsam.length - 1; i >= 0; i--) {
      const f = flotsam[i];
      f.phase += dt * f.wobble;
      if (!f.caught && hook.caught !== f) {
        f.x += f.drift * dt;
        if (f.x < -60 || f.x > W + 60) { flotsam.splice(i, 1); continue; }
      }
    }

    // hook physics
    const tip = rodTip();
    hook.tipX = tip.x; hook.tipY = tip.y;
    if (hook.state === 'casting') {
      hook.x += hook.vx; hook.y += hook.vy;
      hook.vy += 0.35;                        // gravity arc
      if (hook.y >= lerp(seaTop + 8, H - 30, 0.5) || hook.x < 0 || hook.x > W) {
        hook.state = 'sunk';
        ripple(hook.x, hook.y);
        burst(hook.x, hook.y, '#bfe8ff', 10, 2.4);
      }
    } else if (hook.state === 'sunk') {
      // drift down slowly and check for a catch
      hook.y += 18 * dt;
      hook.x += Math.sin(now * 0.004) * 0.4;
      for (const f of flotsam) {
        if (f.caught) continue;
        const d = Math.hypot(f.x - hook.x, flotsamY(f) - hook.y);
        if (d < f.kind.r * f.scale + 14) {
          f.caught = true; hook.caught = f; hook.state = 'reeling';
          burst(hook.x, hook.y, f.kind.spark, 18, 3.2);
          break;
        }
      }
      // auto-reel if it sinks too far
      if (hook.y > H - 24) hook.state = 'reeling';
    } else if (hook.state === 'reeling') {
      const tx = tip.x, ty = tip.y;
      const a = Math.atan2(ty - hook.y, tx - hook.x);
      const sp = 6 + (braceActive ? 7 : 0);
      hook.x += Math.cos(a) * sp; hook.y += Math.sin(a) * sp;
      if (hook.caught) { hook.caught.x = hook.x; hook.caught.y = hook.y; }
      if (Math.hypot(tx - hook.x, ty - hook.y) < 18) land();
    }

    // particles
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx; s.y += s.vy; s.vy += 0.05; s.vx *= 0.99;
      s.life -= s.decay;
      if (s.life <= 0) sparks.splice(i, 1);
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i]; r.r += 34 * dt; r.life -= dt * 1.4;
      if (r.life <= 0) ripples.splice(i, 1);
    }
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i]; p.y -= 26 * dt; p.life -= dt * 0.8;
      if (p.life <= 0) popups.splice(i, 1);
    }

    // idle sparkle on the sea for atmosphere
    if (Math.random() < 0.25) {
      const sx = rand(0, W), sy = rand(seaTop + 6, H - 20);
      sparks.push({ x: sx, y: sy, vx: 0, vy: -0.2, life: 1, decay: 0.04, col: '#ffe9a8', size: rand(1, 2.2) });
    }
  }

  function land() {
    const f = hook.caught;
    if (f) {
      const idx = flotsam.indexOf(f);
      if (idx >= 0) flotsam.splice(idx, 1);
      const g = Math.round(rand(f.kind.gold[0], f.kind.gold[1]));
      game.gold += g;
      game.hold = Math.min(HOLD_MAX, game.hold + 1);
      popup(boat.x, boat.y - 70, '+' + g + ' Gp', f.kind.spark);
      burst(boat.x, boat.y - 50, f.kind.spark, 22, 3.4);
      if (game.hold >= HOLD_MAX) { popup(boat.x, boat.y - 96, 'HOLD FULL!', '#fff1b0'); endRound(); }
      // every 6 catches, the tide turns and the ring climbs
      if (game.hold % 6 === 0) {
        game.ring++; game.tide = game.tide === 'LOW' ? 'HIGH' : 'LOW';
      }
    }
    hook.caught = null;
    hook.state = 'idle';
  }

  function endRound() { game.running = false; game.over = true; }
  function restart() {
    game.gold += 0; game.hold = 0; game.time = ROUND_TIME; game.ring = 1; game.tide = 'LOW';
    game.running = true; game.over = false;
    flotsam.length = 0; sparks.length = 0; popups.length = 0;
    hook.state = 'idle'; hook.caught = null;
  }

  // ==========================================================================
  //  RENDER
  // ==========================================================================
  function draw(now) {
    ctx.save();
    if (game.shake > 0.2) {
      ctx.translate(rand(-game.shake, game.shake) * 0.5, rand(-game.shake, game.shake) * 0.5);
    }

    drawSky(now);
    drawSea(now);
    drawRipples();
    drawFlotsam(now);
    drawBoat(now);
    drawLine();
    drawSparks();
    drawPopups();

    ctx.restore();

    drawHUD(now);
    if (game.over) drawGameOver();
  }

  function drawSky(now) {
    const g = ctx.createLinearGradient(0, 0, 0, horizon);
    g.addColorStop(0.00, '#10183a');
    g.addColorStop(0.45, '#2a2b62');
    g.addColorStop(0.80, '#7c4a7d');
    g.addColorStop(1.00, '#e8915c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, horizon + 2);

    // stars
    for (const st of stars) {
      const x = st.x * W, y = st.y * horizon * 0.85;
      const a = (0.4 + 0.6 * Math.abs(Math.sin(now * 0.001 * st.sp + st.tw))) * (1 - st.y);
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.fillStyle = '#fff7e6';
      ctx.fillRect(x, y, st.s, st.s);
    }
    ctx.globalAlpha = 1;

    // moon glow
    const mx = W * 0.78, my = horizon * 0.34, mr = Math.max(W, H) * 0.05;
    const mg = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 4);
    mg.addColorStop(0, 'rgba(255,236,190,0.9)');
    mg.addColorStop(0.2, 'rgba(255,221,160,0.35)');
    mg.addColorStop(1, 'rgba(255,221,160,0)');
    ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, mr * 4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff4d8'; ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();

    // sun-line on the horizon
    const hg = ctx.createLinearGradient(0, horizon - 26, 0, horizon + 4);
    hg.addColorStop(0, 'rgba(255,180,110,0)');
    hg.addColorStop(1, 'rgba(255,205,150,0.7)');
    ctx.fillStyle = hg; ctx.fillRect(0, horizon - 26, W, 30);
  }

  function seaColorTop()  { return '#1d6f8e'; }
  function drawSea(now) {
    const g = ctx.createLinearGradient(0, seaTop, 0, H);
    g.addColorStop(0.00, '#2a7d97');
    g.addColorStop(0.35, '#155b78');
    g.addColorStop(0.75, '#0c3a52');
    g.addColorStop(1.00, '#06212f');
    ctx.fillStyle = g;
    ctx.fillRect(0, seaTop, W, H - seaTop);

    // moon reflection shimmer column
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const rx = W * 0.78;
    for (let i = 0; i < 26; i++) {
      const t = i / 26;
      const y = seaTop + t * (H - seaTop);
      const wob = Math.sin(now * 0.004 + i * 0.7) * (8 + t * 60);
      const w = (10 + t * 90);
      ctx.globalAlpha = 0.10 * (1 - t);
      ctx.fillStyle = '#ffe6ad';
      ctx.fillRect(rx - w / 2 + wob, y, w, 3);
    }
    ctx.restore();

    // layered wave bands
    ctx.save();
    for (let layer = 0; layer < 5; layer++) {
      const t = layer / 5;
      const baseY = seaTop + 18 + t * (H - seaTop) * 0.92;
      const amp = 4 + t * 10;
      const len = 120 + t * 220;
      const speed = now * (0.0006 + t * 0.0012);
      ctx.beginPath();
      ctx.moveTo(0, baseY + 30);
      for (let x = 0; x <= W; x += 12) {
        const y = baseY + Math.sin(x / len + speed + layer) * amp
                        + Math.sin(x / (len * 0.5) - speed * 1.4) * amp * 0.4;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, baseY + 40); ctx.lineTo(0, baseY + 40); ctx.closePath();
      ctx.fillStyle = `rgba(255,255,255,${0.03 + t * 0.05})`;
      ctx.fill();
      // crest highlights
      ctx.beginPath();
      for (let x = 0; x <= W; x += 12) {
        const y = baseY + Math.sin(x / len + speed + layer) * amp;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(190,232,255,${0.10 + t * 0.10})`;
      ctx.lineWidth = 1.4; ctx.stroke();
    }
    ctx.restore();
  }

  function drawRipples() {
    ctx.save();
    for (const r of ripples) {
      ctx.globalAlpha = clamp(r.life, 0, 1) * 0.6;
      ctx.strokeStyle = '#bfe8ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(r.x, r.y, r.r, r.r * 0.4, 0, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  function drawFlotsam(now) {
    // sort by depth so nearer items overlap farther ones
    const list = flotsam.slice().sort((a, b) => a.depth - b.depth);
    for (const f of list) {
      const y = (hook.caught === f) ? f.y : flotsamY(f);
      const x = f.x, s = f.scale, k = f.kind;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(f.phase) * 0.18);
      ctx.scale(s, s);

      // wet shadow on the water
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.ellipse(0, k.r * 0.7, k.r * 1.1, k.r * 0.4, 0, 0, TAU); ctx.fill();

      drawCargo(k);

      // little glint
      ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(now * 0.003 + f.phase));
      ctx.fillStyle = k.spark;
      ctx.beginPath(); ctx.arc(-k.r * 0.35, -k.r * 0.4, 1.8, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  function drawCargo(k) {
    const r = k.r;
    if (k.name === 'bottle') {
      ctx.fillStyle = k.col;
      rrect(-r * 0.4, -r, r * 0.8, r * 2, r * 0.4); ctx.fill();
      ctx.fillStyle = k.col2; rrect(-r * 0.25, -r * 1.3, r * 0.5, r * 0.5, 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; rrect(-r * 0.25, -r * 0.6, r * 0.18, r * 1.2, 2); ctx.fill();
    } else if (k.name === 'barrel') {
      ctx.fillStyle = k.col; rrect(-r, -r * 0.9, r * 2, r * 1.8, r * 0.5); ctx.fill();
      ctx.strokeStyle = k.col2; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-r, -r * 0.3); ctx.lineTo(r, -r * 0.3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-r, r * 0.3); ctx.lineTo(r, r * 0.3); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; rrect(-r * 0.7, -r * 0.8, r * 0.4, r * 1.6, 2); ctx.fill();
    } else if (k.name === 'lantern') {
      ctx.fillStyle = '#3a2c18'; rrect(-r * 0.7, -r, r * 1.4, r * 2, 3); ctx.fill();
      const gg = ctx.createRadialGradient(0, 0, 1, 0, 0, r);
      gg.addColorStop(0, '#fff2c0'); gg.addColorStop(1, k.col);
      ctx.fillStyle = gg; rrect(-r * 0.5, -r * 0.7, r, r * 1.4, 3); ctx.fill();
    } else if (k.name === 'chest') {
      ctx.fillStyle = k.col2; rrect(-r, -r * 0.4, r * 2, r * 1.2, 3); ctx.fill();
      ctx.fillStyle = k.col; rrect(-r, -r * 0.9, r * 2, r * 0.7, 4); ctx.fill();
      ctx.fillStyle = '#ffe28a'; ctx.fillRect(-2, -r * 0.5, 4, r * 0.7);
      ctx.fillStyle = '#fff1b0'; ctx.beginPath(); ctx.arc(0, -r * 0.1, 2.4, 0, TAU); ctx.fill();
    } else { // crate
      ctx.fillStyle = k.col; rrect(-r, -r, r * 2, r * 2, 3); ctx.fill();
      ctx.strokeStyle = k.col2; ctx.lineWidth = 3;
      ctx.strokeRect(-r + 1.5, -r + 1.5, r * 2 - 3, r * 2 - 3);
      ctx.beginPath(); ctx.moveTo(-r, -r); ctx.lineTo(r, r);
      ctx.moveTo(r, -r); ctx.lineTo(-r, r); ctx.stroke();
    }
  }

  function drawBoat(now) {
    ctx.save();
    ctx.translate(boat.x, boat.y);
    ctx.rotate(boat.rot);

    // reflection under the hull
    ctx.save();
    ctx.globalAlpha = 0.18; ctx.scale(1, -0.5); ctx.translate(0, -10);
    drawHull(); ctx.restore();

    // hull
    drawHull();

    // mast + sail
    ctx.strokeStyle = '#5a3b22'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(-6, -10); ctx.lineTo(-6, -96); ctx.stroke();
    const sg = ctx.createLinearGradient(-6, -90, 60, -30);
    sg.addColorStop(0, '#f6efe0'); sg.addColorStop(1, '#d9c7a3');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(-3, -92);
    ctx.quadraticCurveTo(52, -78, 46, -28);
    ctx.quadraticCurveTo(18, -34, -3, -22);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(120,90,50,0.4)'; ctx.lineWidth = 1; ctx.stroke();
    // sail emblem
    ctx.fillStyle = 'rgba(180,60,60,0.55)';
    ctx.beginPath(); ctx.arc(20, -54, 7, 0, TAU); ctx.fill();

    // fishing rod
    ctx.strokeStyle = '#2c1c10'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(20, -14); ctx.quadraticCurveTo(40, -40, 46, -54); ctx.stroke();

    // little lantern on the bow that flickers (the "spark")
    const fl = 0.6 + 0.4 * Math.sin(now * 0.02);
    const lx = -44, ly = -30;
    const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, 26);
    lg.addColorStop(0, `rgba(255,228,150,${0.7 * fl})`);
    lg.addColorStop(1, 'rgba(255,228,150,0)');
    ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(lx, ly, 26, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffe28a'; ctx.beginPath(); ctx.arc(lx, ly, 3.4, 0, TAU); ctx.fill();

    ctx.restore();
  }

  function drawHull() {
    // wooden hull
    const w = 120, h = 40;
    const g = ctx.createLinearGradient(0, -h * 0.4, 0, h);
    g.addColorStop(0, '#7a4a26'); g.addColorStop(1, '#3f2613');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-w * 0.5, -8);
    ctx.lineTo(w * 0.5, -8);
    ctx.quadraticCurveTo(w * 0.62, -6, w * 0.46, h * 0.6);
    ctx.quadraticCurveTo(0, h, -w * 0.42, h * 0.6);
    ctx.quadraticCurveTo(-w * 0.6, -6, -w * 0.5, -8);
    ctx.closePath(); ctx.fill();
    // gold trim plank
    ctx.fillStyle = '#caa24a';
    ctx.beginPath();
    ctx.moveTo(-w * 0.5, -8); ctx.lineTo(w * 0.5, -8);
    ctx.lineTo(w * 0.46, 0); ctx.lineTo(-w * 0.46, 0); ctx.closePath(); ctx.fill();
    // plank lines
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-w * 0.46 + i * 4, i * 9); ctx.lineTo(w * 0.46 - i * 4, i * 9); ctx.stroke();
    }
  }

  function drawLine() {
    if (hook.state === 'idle') return;
    const tip = rodTip();
    ctx.strokeStyle = 'rgba(240,245,255,0.75)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    // a slight sag in the line
    const midx = (tip.x + hook.x) / 2;
    const midy = (tip.y + hook.y) / 2 + 14;
    ctx.quadraticCurveTo(midx, midy, hook.x, hook.y);
    ctx.stroke();
    // hook / bob
    ctx.fillStyle = '#ffe28a';
    ctx.beginPath(); ctx.arc(hook.x, hook.y, 4, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#cfd6e0'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(hook.x, hook.y + 4, 3, Math.PI * 0.1, Math.PI * 0.95); ctx.stroke();
  }

  function drawSparks() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of sparks) {
      ctx.globalAlpha = clamp(s.life, 0, 1);
      ctx.fillStyle = s.col;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.size * s.life, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawPopups() {
    ctx.save();
    ctx.textAlign = 'center';
    for (const p of popups) {
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.font = '700 22px "Trebuchet MS", sans-serif';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.col; ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }

  // ==========================================================================
  //  HUD  (matches the reference: title, Gp, ring/tide, hold, timer, buttons)
  // ==========================================================================
  function fmt(n) { return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function drawHUD(now) {
    ctx.save();
    ctx.textBaseline = 'alphabetic';

    const compact = W < 640;
    const pad = compact ? 8 : 14;
    const m = Math.floor(game.time / 60), s = Math.floor(game.time % 60);
    const timeStr = `${m}:${s.toString().padStart(2, '0')}`;
    const tcol = game.time <= 10 ? (Math.sin(now * 0.012) > 0 ? '#ff6a6a' : '#ffb3b3') : '#f3f6fb';

    // --- top-right: hold + timer (sized first so the left panel can fill the rest) ---
    const rw = compact ? Math.min(W * 0.40, 150) : 168;
    const rx = W - rw - pad;
    const topH = compact ? 64 : 78;
    panel(rx, pad, rw, topH);
    ctx.fillStyle = '#9fb2c4';
    ctx.font = '700 12px "Trebuchet MS", sans-serif';
    ctx.fillText('HOLD', rx + 14, pad + 20);
    ctx.fillStyle = '#f3f6fb';
    ctx.font = `700 ${compact ? 17 : 20}px "Trebuchet MS", sans-serif`;
    ctx.fillText(`${game.hold}/${HOLD_MAX}`, rx + 54, pad + 21);
    const bx = rx + 14, bw = rw - 28, by = pad + 30;
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; rrect(bx, by, bw, 7, 4); ctx.fill();
    ctx.fillStyle = '#ffd76a'; rrect(bx, by, bw * (game.hold / HOLD_MAX), 7, 4); ctx.fill();
    ctx.fillStyle = tcol;
    ctx.font = `700 ${compact ? 19 : 22}px "Trebuchet MS", sans-serif`;
    ctx.fillText(timeStr, rx + 14, pad + topH - 12);
    ctx.fillStyle = '#ffd76a'; ctx.font = '700 14px "Trebuchet MS", sans-serif';
    ctx.fillText('★', rx + 14 + ctx.measureText('  ').width + (compact ? 44 : 52), pad + topH - 12);

    // --- top-left: location + gold ---
    const lw = compact ? (rx - pad * 2) : 250;
    panel(pad, pad, lw, topH);
    ctx.fillStyle = '#ffe9a8';
    ctx.font = `700 ${compact ? 15 : 20}px "Trebuchet MS", sans-serif`;
    ctx.fillText(compact ? '⚓ KING’S HOLD' : '⚓ THE KING’S HOLD', pad + 14, pad + (compact ? 26 : 28));
    ctx.fillStyle = '#9fb2c4';
    ctx.font = '700 12px "Trebuchet MS", sans-serif';
    ctx.fillText('Gp', pad + 14, pad + topH - 12);
    ctx.fillStyle = '#ffd76a';
    ctx.font = `700 ${compact ? 18 : 22}px "Trebuchet MS", sans-serif`;
    ctx.fillText(fmt(game.gold), pad + 36, pad + topH - 11);

    // --- ring + tide: top-centre on wide screens, a pill below the row on narrow ---
    const cw = compact ? 150 : 200;
    const cx = W / 2 - cw / 2;
    const cy = compact ? pad + topH + 6 : pad;
    panel(cx, cy, cw, 36);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe9a8';
    ctx.font = '700 15px "Trebuchet MS", sans-serif';
    ctx.fillText(`RING ${game.ring}`, W / 2 - 30, cy + 23);
    ctx.fillStyle = '#9fb2c4'; ctx.fillText('•', W / 2 + 6, cy + 23);
    ctx.fillStyle = game.tide === 'LOW' ? '#7fe0ff' : '#ff9f6a';
    ctx.fillText(game.tide, W / 2 + 42, cy + 23);
    ctx.textAlign = 'left';

    // --- bottom: salvage-bag label (hidden on very short screens to clear buttons) ---
    if (H > 520) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = `700 ${compact ? 11 : 12}px "Trebuchet MS", sans-serif`;
      ctx.fillText(compact ? 'SCOOP THE FLOTSAM' : 'SALVAGE BAG — scoop flotsam on the water',
                   W / 2, (btnCast ? btnCast.y : H - 86) - 14);
      ctx.textAlign = 'left';
    }

    // --- buttons ---
    drawButton(btnBrace, '#3a5d74', '#7fc7ff', braceCooldown > 0);
    drawButton(btnCast, '#b5832f', '#ffe9a8', false, hook.state !== 'idle');

    ctx.restore();
  }

  function panel(x, y, w, h) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
    ctx.fillStyle = 'rgba(10,22,34,0.62)';
    rrect(x, y, w, h, 12); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(255,215,106,0.25)'; ctx.lineWidth = 1;
    rrect(x + 0.5, y + 0.5, w - 1, h - 1, 12); ctx.stroke();
    ctx.restore();
  }

  function drawButton(b, base, accent, cooling, dim) {
    if (!b) return;
    ctx.save();
    const press = b.held ? 2 : 0;
    const y = b.y + press;
    ctx.globalAlpha = (cooling || dim) ? 0.55 : 1;
    // body
    const g = ctx.createLinearGradient(0, y, 0, y + b.h);
    g.addColorStop(0, base);
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = b.held ? 4 : 10; ctx.shadowOffsetY = b.held ? 1 : 5;
    ctx.fillStyle = g; rrect(b.x, y, b.w, b.h, 14); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.globalAlpha *= 0.8;
    rrect(b.x + 1, y + 1, b.w - 2, b.h - 2, 13); ctx.stroke();
    ctx.globalAlpha = (cooling || dim) ? 0.55 : 1;
    // labels
    ctx.textAlign = 'center';
    ctx.fillStyle = accent;
    ctx.font = '700 20px "Trebuchet MS", sans-serif';
    ctx.fillText(b.label, b.x + b.w / 2, y + b.h / 2 + 2);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '700 11px "Trebuchet MS", sans-serif';
    ctx.fillText(b.sub.toUpperCase(), b.x + b.w / 2, y + b.h - 12);
    ctx.restore();
  }

  function drawGameOver() {
    ctx.save();
    ctx.fillStyle = 'rgba(4,10,18,0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe9a8';
    ctx.font = '700 44px "Trebuchet MS", sans-serif';
    ctx.fillText('TIDE’S OUT', W / 2, H / 2 - 40);
    ctx.fillStyle = '#f3f6fb';
    ctx.font = '700 22px "Trebuchet MS", sans-serif';
    ctx.fillText(`Hauled ${game.hold} pieces of salvage`, W / 2, H / 2 + 4);
    ctx.fillStyle = '#ffd76a';
    ctx.font = '700 28px "Trebuchet MS", sans-serif';
    ctx.fillText(`Gp ${fmt(game.gold)}`, W / 2, H / 2 + 44);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '700 16px "Trebuchet MS", sans-serif';
    ctx.fillText('Click / tap or press R to set sail again', W / 2, H / 2 + 92);
    ctx.restore();
  }

  // ==========================================================================
  //  MAIN LOOP
  // ==========================================================================
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;        // clamp big stalls
    update(dt, now);
    draw(now);
    requestAnimationFrame(frame);
  }

  resize();
  for (let i = 0; i < 8; i++) spawnFlotsam(true);
  requestAnimationFrame((t) => { last = t; frame(t); });
})();
