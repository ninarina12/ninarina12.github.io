/* Header art: a live Gray–Scott reaction–diffusion simulation in the
   labyrinthine regime (the same maze-like domains as in the BLEND and
   DynamiCXS figures), colored with Fabio Crameri's "lapaz" colormap.

   - Pointer movement over the header seeds new growth.
   - Pauses whenever the header is off screen or the tab is hidden.
   - With prefers-reduced-motion, a single still frame is computed instead. */
(() => {
  'use strict';

  const canvas = document.getElementById('labyrinth');
  if (!canvas || !canvas.getContext) return;
  const hero = canvas.closest('.hero') || canvas.parentElement;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---- Model parameters (5-point Laplacian, dt = 1) ---- */
  const DU = 0.21;
  const DV = 0.105;
  const F0 = 0.029;   // feed
  const K = 0.057;    // kill
  const V_SCALE = 1 / 0.34;   // maps V (~0..0.34) onto the color table

  /* ---- Grid sizing ---- */
  const MAX_CELLS = 120000;
  const MAX_CELLS_SMALL = 45000;   // phones: coarser grid, and the pattern is mostly masked anyway
  const MIN_CELL_PX = 2.5;

  /* ---- Colors: hero ink, then lapaz from its dark end up to warm sand ----
     lapaz sampled every 16th of 256 entries (Crameri, Scientific colour maps). */
  const INK = [18, 15, 56];
  const LAPAZ = [
    '#1a0c64', '#202071', '#24327e', '#284289', '#2d5393', '#33629b', '#3d71a0',
    '#4b80a3', '#5c8ca3', '#7097a0', '#869e9b', '#9ca596', '#b5ad96', '#d2bba2', '#ebcfbb',
  ];
  const LUT = buildLut();

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function buildLut() {
    // Control points: t = 0 -> ink, t = 0.12 -> lapaz[0], ... t = 1 -> lapaz[last]
    const pts = [{ t: 0, c: INK }];
    LAPAZ.forEach((hex, i) => pts.push({ t: 0.12 + (0.88 * i) / (LAPAZ.length - 1), c: hexToRgb(hex) }));
    const lut = new Uint32Array(256);
    const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
    let j = 0;
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      while (j < pts.length - 2 && t > pts[j + 1].t) j++;
      const a = pts[j];
      const b = pts[j + 1];
      const f = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
      const r = Math.round(a.c[0] + (b.c[0] - a.c[0]) * f);
      const g = Math.round(a.c[1] + (b.c[1] - a.c[1]) * f);
      const bl = Math.round(a.c[2] + (b.c[2] - a.c[2]) * f);
      lut[i] = littleEndian
        ? ((255 << 24) | (bl << 16) | (g << 8) | r) >>> 0
        : ((r << 24) | (g << 16) | (bl << 8) | 255) >>> 0;
    }
    return lut;
  }

  /* ---- State ---- */
  let W = 0, H = 0;
  let U, V, U2, V2;
  let off, offCtx, image, pixels;
  let cssW = 0, cssH = 0;
  let stepsPerFrame = 12;
  let totalSteps = 0;
  let running = false;
  let visible = true;
  let rafId = 0;
  let pendingSeed = null;
  let seed = 1;

  const rand = () => {
    // Small deterministic PRNG, so each init looks a little different but is cheap.
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  function init() {
    const rect = hero.getBoundingClientRect();
    cssW = Math.max(1, Math.round(rect.width));
    cssH = Math.max(1, Math.round(rect.height));
    const maxCells = cssW < 820 ? MAX_CELLS_SMALL : MAX_CELLS;
    const cell = Math.max(MIN_CELL_PX, Math.sqrt((cssW * cssH) / maxCells));
    W = Math.max(8, Math.ceil(cssW / cell));
    H = Math.max(8, Math.ceil(cssH / cell));

    const n = W * H;
    U = new Float32Array(n).fill(1);
    V = new Float32Array(n);
    U2 = new Float32Array(n);
    V2 = new Float32Array(n);

    off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    offCtx = off.getContext('2d');
    image = offCtx.createImageData(W, H);
    pixels = new Uint32Array(image.data.buffer);

    canvas.width = cssW;
    canvas.height = cssH;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Scatter seeds everywhere so the labyrinth crystallizes across the whole field at once.
    seed = (Date.now() % 100000) + 1;
    const seeds = Math.round(n / 260);
    for (let s = 0; s < seeds; s++) {
      inject(rand() * W, rand() * H, 1 + rand() * 2.5);
    }
    totalSteps = 0;
    stepsPerFrame = 12;
  }

  function inject(cx, cy, r) {
    const r2 = r * r;
    const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r);
    const y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        const i = ((y + H) % H) * W + ((x + W) % W);
        U[i] = 0.5;
        V[i] = 0.25 + rand() * 0.05;
      }
    }
  }

  function step(F) {
    const fk = F + K;
    for (let y = 0; y < H; y++) {
      const yc = y * W;
      const yu = (y === 0 ? H - 1 : y - 1) * W;
      const yd = (y === H - 1 ? 0 : y + 1) * W;
      for (let x = 0; x < W; x++) {
        const xl = x === 0 ? W - 1 : x - 1;
        const xr = x === W - 1 ? 0 : x + 1;
        const i = yc + x;
        const u = U[i];
        const v = V[i];
        const uvv = u * v * v;
        U2[i] = u + DU * (U[yc + xl] + U[yc + xr] + U[yu + x] + U[yd + x] - 4 * u) - uvv + F * (1 - u);
        V2[i] = v + DV * (V[yc + xl] + V[yc + xr] + V[yu + x] + V[yd + x] - 4 * v) + uvv - fk * v;
      }
    }
    let t = U; U = U2; U2 = t;
    t = V; V = V2; V2 = t;
    totalSteps++;
  }

  function render() {
    const n = W * H;
    for (let i = 0; i < n; i++) {
      let c = (V[i] * V_SCALE * 255) | 0;
      if (c > 255) c = 255; else if (c < 0) c = 0;
      pixels[i] = LUT[c];
    }
    offCtx.putImageData(image, 0, 0);
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }

  // Feed rate drifts very slowly inside the labyrinth regime, so the pattern keeps reorganizing.
  const feedAt = (time) => F0 + 0.0009 * Math.sin(time / 47000);

  function frame(time) {
    rafId = 0;
    if (!running || !visible) return;

    if (pendingSeed) {
      inject(pendingSeed.x, pendingSeed.y, pendingSeed.r);
      pendingSeed = null;
    }

    // Fast "development" phase first, then a calm drift. Adapt to the device's speed.
    const warm = totalSteps < 1800;
    const budget = warm ? 9 : 3.5;   // ms of simulation per frame
    const F = feedAt(time);
    const t0 = performance.now();
    for (let s = 0; s < stepsPerFrame; s++) step(F);
    const dt = performance.now() - t0;
    const perStep = dt / stepsPerFrame;
    const target = Math.max(1, Math.min(warm ? 28 : 8, Math.floor(budget / Math.max(perStep, 0.01))));
    stepsPerFrame += Math.sign(target - stepsPerFrame);

    // Occasional raindrop keeps the field alive even without interaction.
    if (!warm && Math.random() < 0.004) inject(Math.random() * W, Math.random() * H, 2);

    render();
    if (!canvas.classList.contains('is-ready') && totalSteps > 60) {
      canvas.classList.add('is-ready');
    }
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    running = true;
    hero.classList.add('has-labyrinth');
    if (!rafId && visible) rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  // Reduced motion: compute a mature pattern in small chunks, then draw it once.
  let stillJob = 0;
  function drawStill() {
    stop();
    const job = ++stillJob;
    const target = 2600;
    const chunk = () => {
      if (job !== stillJob) return;
      const t0 = performance.now();
      while (totalSteps < target && performance.now() - t0 < 12) step(F0);
      if (totalSteps < target) {
        setTimeout(chunk, 0);
      } else {
        render();
        canvas.classList.add('is-ready');
        hero.classList.add('has-labyrinth');
      }
    };
    chunk();
  }

  function boot() {
    init();
    if (motionQuery.matches) drawStill();
    else start();
  }

  /* ---- Interaction ---- */
  let lastSeedAt = 0;
  hero.addEventListener('pointermove', (e) => {
    if (!running || motionQuery.matches) return;
    const now = performance.now();
    if (now - lastSeedAt < 30) return;
    lastSeedAt = now;
    const rect = canvas.getBoundingClientRect();
    pendingSeed = {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
      r: e.pointerType === 'touch' ? 4 : 2.6,
    };
    hero.classList.add('was-touched');
  }, { passive: true });

  /* ---- Lifecycle ---- */
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && running && !rafId) rafId = requestAnimationFrame(frame);
    }).observe(hero);
  }

  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    if (visible && running && !rafId) rafId = requestAnimationFrame(frame);
  });

  motionQuery.addEventListener?.('change', () => {
    if (motionQuery.matches) drawStill();
    else { stillJob++; start(); }
  });

  // Re-seed only on meaningful size changes (ignores mobile URL-bar jitter).
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const rect = hero.getBoundingClientRect();
      const dw = Math.abs(rect.width - cssW) / cssW;
      const dh = Math.abs(rect.height - cssH) / cssH;
      if (dw > 0.06 || dh > 0.25) {
        stillJob++;
        boot();
      }
    }, 250);
  });

  boot();
})();
