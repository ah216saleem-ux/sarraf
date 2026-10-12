// src/command/vortex/NeuralCoreEngine.ts
// SARRAF NEURAL CORE - pure Canvas2D engine (no WebGL, no three.js, no shaders).
// Every coloured node / halo / label value is caused by a real event pushed in by the host.
// Decorative only (always neutral blue-grey, never green/red): dim scaffold lattice + ambient drifting dots + slow heartbeat ring,
// so the core keeps moving between ticks. Green/red only ever come from real ticks.

export type Tone = 'bull' | 'bear' | 'neutral' | 'na';
export type CoreMode = 'live' | 'replay' | 'reconnecting' | 'closed';
export interface CoreLabel { key: string; title: string; value: string; tone: Tone; detail?: string }
export interface CoreSignal { side: 'BUY' | 'SELL'; entry: number; sl: number; tp1: number; tp2: number; tp3: number }
export interface CoreTick { ts: number; price: number; delta: number }
export interface CoreOptions { variant?: 'command' | 'hero'; lite?: boolean; reducedMotion?: boolean }

interface Pill { text: string; col: string; x: number; y: number; w: number; h: number; lineY: number }
interface Node { x: number; y: number; z: number; kind: number; size: number; halo: number; born: number; life: number; alive: boolean }
interface Link { a: number; b: number; born: number; alive: boolean }

const GREEN = '#4be39a';
const RED = '#ff4f78';
const NEUTRAL = '#8fa6c8';
const GOLD = '#f5c451';
const BG = '#03050a';
const MAX_NODES = 300;
const MAX_LINKS = 760;
const LABEL_ORDER = ['momentum', 'sentiment', 'tickData', 'poc', 'absorption', 'fvgob', 'regime', 'structure', 'tickImpact'];
const LABEL_ANGLE: Record<string, number> = {
  momentum: -42, sentiment: -112, poc: -2, absorption: 36, tickData: 72,
  tickImpact: 108, structure: 146, fvgob: 182, regime: -152,
};

function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeHalo(color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, color + 'cc');
  gr.addColorStop(0.35, color + '55');
  gr.addColorStop(1, color + '00');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return c;
}

export class NeuralCoreEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private opts: CoreOptions;
  private W = 300; private H = 300; private dpr = 1;
  private cx = 150; private cy = 150; private R = 100;
  private nodes: Node[] = [];
  private links: Link[] = [];
  private nodeHead = 0; private linkHead = 0;
  private scaffold: { x: number; y: number; z: number }[] = [];
  private scaffoldLinks: [number, number][] = [];
  private halos: Record<string, HTMLCanvasElement> = {};
  private rnd = mulberry32(20261011);
  private spawnCount = 0;
  private lastFlatSpawn = 0;
  private maxDelta = 0.3;
  private tickTimes: number[] = [];
  private mode: CoreMode = 'closed';
  private livePrice: number | null = null;
  private buyPct: number | null = null;
  private sellPct: number | null = null;
  private labels: CoreLabel[] = [];
  private rings: { t0: number; color: string }[] = [];
  private bursts: { t0: number; vx: number; vy: number }[] = [];
  private tintUntil = 0; private tintColor = GREEN;
  private glitchUntil = 0;
  private cooldown = 0; private cooldownTotal = 0;
  private flashUntil = 0; private flashColor = GREEN;
  private raf = 0; private running = false; private destroyed = false;
  private t0 = 0;
  private ro: ResizeObserver | null = null;
  private replayTimer: number | null = null;
  private seedTimers: number[] = [];
  private amb: { l: number; t: number; sp: number }[] = [];
  private lastFrame = 0;
  private signal: CoreSignal | null = null;
  private lastBoxes: { key: string; x: number; y: number; w: number; h: number; mx: number; my: number }[] = [];
  private selected: { key: string; until: number } | null = null;
  private onPointer = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    let hit: string | null = null;
    for (const b of this.lastBoxes) {
      const inBox = px >= b.x - 4 && px <= b.x + b.w + 4 && py >= b.y - 4 && py <= b.y + b.h + 4;
      const inMarker = Math.hypot(px - b.mx, py - b.my) <= 14;
      if (inBox || inMarker) { hit = b.key; break; }
    }
    const now = performance.now();
    if (hit && !(this.selected && this.selected.key === hit && now < this.selected.until)) this.selected = { key: hit, until: now + 7000 };
    else this.selected = null;
  };
  private onVis = () => { if (document.hidden) this.stopLoop(); else this.startLoop(); };

  constructor(canvas: HTMLCanvasElement, opts: CoreOptions = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.opts = opts;
    this.halos = { g: makeHalo(GREEN), r: makeHalo(RED), n: makeHalo(NEUTRAL), y: makeHalo(GOLD) };
    for (let i = 0; i < MAX_NODES; i++) this.nodes.push({ x: 0, y: 0, z: 0, kind: 0, size: 0, halo: 0, born: 0, life: 0, alive: false });
    for (let i = 0; i < MAX_LINKS; i++) this.links.push({ a: 0, b: 0, born: 0, alive: false });
    this.buildScaffold(opts.lite ? 70 : 140);
    this.t0 = performance.now();
    this.resize();
    const parent = canvas.parentElement;
    if (parent && typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(parent);
    }
    document.addEventListener('visibilitychange', this.onVis);
    canvas.style.touchAction = 'manipulation';
    canvas.addEventListener('pointerdown', this.onPointer);
    this.startLoop();
  }

  // ---------- public API ----------
  setMode(m: CoreMode) { this.mode = m; if (m === 'live') this.stopReplay(); }
  setLivePrice(p: number | null) { this.livePrice = p; }
  setFlow(buy: number | null, sell: number | null) { this.buyPct = buy; this.sellPct = sell; }
  setLabels(l: CoreLabel[]) { this.labels = l; }
  setLite(v: boolean) { this.opts.lite = v; }
  setSignal(s: CoreSignal | null) { this.signal = s; }
  setCooldown(sec: number) { if (sec > this.cooldownTotal || sec <= 0) this.cooldownTotal = Math.max(sec, 0); this.cooldown = Math.max(0, sec); }

  /** One real tick -> one node. delta = price change vs previous tick (0 = flat). */
  pushTick(t: CoreTick) { this.addTick(t, performance.now(), true, true); }

  /** Fast boot fill from recent REAL ticks (spawned over spanMs). Does not touch price chip or ticks/min. */
  seed(ticks: CoreTick[], spanMs = 2200) {
    this.clearSeed();
    const src = ticks.slice(-150);
    const n = src.length;
    if (!n) return;
    let flats = 0;
    src.forEach((t, i) => {
      if (t.delta === 0 && (flats++ % 4) !== 0) return;
      const id = window.setTimeout(() => { if (!this.destroyed) this.addTick(t, performance.now(), false, false); }, (i / n) * spanMs);
      this.seedTimers.push(id);
    });
  }
  private clearSeed() { for (const id of this.seedTimers) clearTimeout(id); this.seedTimers = []; }

  private addTick(t: CoreTick, now: number, count: boolean, throttleFlat: boolean) {
    if (count) {
      this.tickTimes.push(now);
      while (this.tickTimes.length && now - this.tickTimes[0] > 60000) this.tickTimes.shift();
    }
    const ad = Math.abs(t.delta);
    this.maxDelta = Math.max(this.maxDelta * 0.999, ad, 0.05);
    if (count) {
      if (t.price > 0 && this.mode === 'live') this.livePrice = t.price;
      if (ad > 0) { this.flashUntil = now + 450; this.flashColor = t.delta > 0 ? GREEN : RED; }
    }
    const kind = t.delta > 0 ? 1 : t.delta < 0 ? -1 : 0;
    if (kind === 0 && throttleFlat) {
      if (now - this.lastFlatSpawn < 250) return;
      this.lastFlatSpawn = now;
    }
    this.spawn(kind, ad / this.maxDelta, now);
  }

  /** Visual-only replay of stored REAL ticks (never touches the signal engine). */
  startReplay(ticks: CoreTick[], msPerTick = 150) {
    this.stopReplay();
    if (!ticks.length) return;
    this.seed(ticks);
    let i = 0;
    const step = () => {
      const t = ticks[i % ticks.length]; i++;
      const prev = this.mode;
      this.mode = 'replay';
      this.livePrice = t.price;
      this.pushTick({ ts: t.ts, price: t.price, delta: t.delta });
      this.mode = prev === 'live' ? 'replay' : prev;
      this.replayTimer = window.setTimeout(step, msPerTick);
    };
    this.mode = 'replay';
    this.replayTimer = window.setTimeout(step, 2300);   // start stepping after the boot fill
  }
  stopReplay() { if (this.replayTimer !== null) { clearTimeout(this.replayTimer); this.replayTimer = null; } }

  triggerSignal(side: 'BUY' | 'SELL') {
    const now = performance.now();
    this.rings.push({ t0: now, color: side === 'BUY' ? GREEN : RED });
    this.tintColor = side === 'BUY' ? GREEN : RED;
    this.tintUntil = now + 3000;
  }
  triggerResult(r: 'TP' | 'SL') {
    const now = performance.now();
    if (r === 'TP') {
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2 + this.rnd() * 0.3;
        const v = 0.5 + this.rnd() * 0.7;
        this.bursts.push({ t0: now, vx: Math.cos(a) * v, vy: Math.sin(a) * v });
      }
      this.rings.push({ t0: now, color: GOLD });
    } else if (!this.reduced()) {
      this.glitchUntil = now + 300;
    }
  }

  destroy() {
    this.destroyed = true;
    this.stopReplay();
    this.clearSeed();
    this.stopLoop();
    document.removeEventListener('visibilitychange', this.onVis);
    this.canvas.removeEventListener('pointerdown', this.onPointer);
    if (this.ro) this.ro.disconnect();
  }

  // ---------- internals ----------
  private reduced() {
    if (this.opts.reducedMotion !== undefined) return this.opts.reducedMotion;
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  private hero() { return this.opts.variant === 'hero'; }

  private buildScaffold(n: number) {
    this.scaffold = []; this.scaffoldLinks = [];
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = ga * i;
      this.scaffold.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r });
    }
    for (let i = 0; i < n; i++) {
      const a = this.scaffold[i];
      const d: [number, number][] = [];
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const b = this.scaffold[j];
        d.push([(a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2, j]);
      }
      d.sort((p, q) => p[0] - q[0]);
      for (let k = 0; k < 3; k++) if (i < d[k][1]) this.scaffoldLinks.push([i, d[k][1]]);
    }
    // ambient drifting dots along scaffold links (decorative, neutral colour)
    this.amb = [];
    const na = this.opts.lite ? 12 : 30;
    for (let i = 0; i < na; i++) this.amb.push({ l: Math.floor(this.rnd() * this.scaffoldLinks.length), t: this.rnd(), sp: 0.35 + this.rnd() * 0.55 });
  }

  resize() {
    const p = this.canvas.parentElement;
    const w = Math.max(160, Math.floor(p ? p.clientWidth : 300));
    const h = Math.max(160, Math.floor(p ? p.clientHeight : 300));
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.W = w; this.H = h;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    const top = this.hero() ? 14 : 64;
    const availH = h - top - 14;
    this.R = Math.max(40, Math.min(((w - 24) / 2) * 0.86, (availH / 2) * 0.92));
    this.cx = w / 2;
    this.cy = top + availH / 2;
  }

  private gauss() {
    const u = Math.max(1e-9, this.rnd()), v = this.rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  private spawn(kind: number, bigness: number, now: number) {
    let x = this.gauss(), y = this.gauss(), z = this.gauss();
    const len = Math.hypot(x, y, z) || 1;
    x /= len; y /= len; z /= len;
    if (kind === 1 && x > 0) x = -x;      // up tick   -> green (left) hemisphere
    if (kind === -1 && x < 0) x = -x;     // down tick -> red (right) hemisphere
    const rr = this.rnd() < 0.72 ? 0.95 + this.rnd() * 0.07 : 0.35 + this.rnd() * 0.55;
    const idx = this.nodeHead; this.nodeHead = (this.nodeHead + 1) % MAX_NODES;
    const n = this.nodes[idx];
    const sc = this.R / 150;
    const b = Math.min(1, Math.max(0, bigness));
    n.x = x * rr; n.y = y * rr; n.z = z * rr; n.kind = kind;
    n.size = (kind === 0 ? 1.8 : 3.2 + b * 7.5) * Math.max(0.7, sc);
    n.halo = kind === 0 ? 0 : (0.25 + b * 0.75);
    n.born = now; n.life = kind === 0 ? 45000 : 150000; n.alive = true;
    this.spawnCount++;
    // links to the 2-3 nearest alive nodes (kills links that point at the recycled slot)
    for (const l of this.links) if (l.alive && (l.a === idx || l.b === idx)) l.alive = false;
    const cands: [number, number][] = [];
    for (let i = 0; i < MAX_NODES; i++) {
      if (i === idx || !this.nodes[i].alive) continue;
      const o = this.nodes[i];
      cands.push([(o.x - n.x) ** 2 + (o.y - n.y) ** 2 + (o.z - n.z) ** 2, i]);
    }
    cands.sort((p, q) => p[0] - q[0]);
    const want = this.opts.lite ? 2 : 3;
    for (let k = 0; k < Math.min(want, cands.length); k++) {
      const li = this.linkHead; this.linkHead = (this.linkHead + 1) % MAX_LINKS;
      const l = this.links[li]; l.a = idx; l.b = cands[k][1]; l.born = now; l.alive = true;
    }
  }

  private startLoop() {
    if (this.running || this.destroyed) return;
    this.running = true;
    const loop = (ts: number) => {
      if (!this.running) return;
      this.draw(ts);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  private stopLoop() { this.running = false; cancelAnimationFrame(this.raf); }

  private ticksPerMin() {
    const now = performance.now();
    let c = 0;
    for (const t of this.tickTimes) if (now - t <= 60000) c++;
    return c;
  }

  private draw(nowTs: number) {
    const ctx = this.ctx;
    const now = performance.now();
    const t = (now - this.t0) / 1000;
    const W = this.W, H = this.H, cx = this.cx, cy = this.cy, R = this.R;
    const energy = Math.min(1, this.ticksPerMin() / 40);
    const dt = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 0.016; this.lastFrame = now;
    const red = this.reduced();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);

    const glitch = now < this.glitchUntil;
    if (glitch) ctx.translate((this.rnd() - 0.5) * 6, (this.rnd() - 0.5) * 3);

    // colour washes: green left / red right, strength follows the real buy/sell share
    const hasFlow = this.buyPct !== null && this.sellPct !== null;
    const gs = hasFlow ? this.buyPct! / 100 : 0.5;
    const washG = hasFlow ? 0.09 + 0.2 * gs : 0.05;
    const washR = hasFlow ? 0.09 + 0.2 * (1 - gs) : 0.05;
    this.wash(ctx, cx - R * 0.42, cy, R * 0.95, hasFlow ? GREEN : NEUTRAL, washG);
    this.wash(ctx, cx + R * 0.42, cy, R * 0.95, hasFlow ? RED : NEUTRAL, washR);
    if (now < this.tintUntil) {
      const p = Math.min(1, (this.tintUntil - now) / 3000);
      this.wash(ctx, cx, cy, R * 1.1, this.tintColor, 0.18 * p);
    }

    // rotation: slow sway so green stays left and red stays right
    const speed = 0.65 + 0.55 * energy;   // always moving, faster with more real ticks
    const yaw = red ? 0 : Math.sin(t * speed) * 0.5;
    const pitch = -0.22 + (red ? 0 : Math.sin(t * speed * 0.7 + 1) * 0.06);
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const proj = (x: number, y: number, z: number, out: number[]) => {
      const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;
      const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      const s = 1 / (1 - 0.2 * z2);
      out[0] = cx + x1 * R * s; out[1] = cy + y2 * R * s; out[2] = z2;
    };
    const o = [0, 0, 0];

    // sphere outline + inner ring
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#7fa0d0'; ctx.globalAlpha = 0.14;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.08;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.62, 0, Math.PI * 2); ctx.stroke();

    // scaffold (dim, decorative, no meaning)
    const sp2: number[][] = [];
    for (let i = 0; i < this.scaffold.length; i++) {
      const s = this.scaffold[i]; proj(s.x, s.y, s.z, o); sp2.push([o[0], o[1], o[2]]);
    }
    ctx.strokeStyle = '#6f8fbf'; ctx.lineWidth = 0.6;
    for (const [a, b] of this.scaffoldLinks) {
      const pa = sp2[a], pb = sp2[b];
      ctx.globalAlpha = 0.05 + 0.07 * ((pa[2] + pb[2] + 2) / 4);
      ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
    }
    ctx.fillStyle = '#8fa6c8';
    for (let si = 0; si < sp2.length; si++) {
      const p = sp2[si];
      const tw = red ? 1 : 0.7 + 0.3 * Math.sin(t * 1.8 + si * 1.7);
      ctx.globalAlpha = (0.16 + 0.22 * ((p[2] + 1) / 2)) * tw;
      ctx.beginPath(); ctx.arc(p[0], p[1], 1.1, 0, Math.PI * 2); ctx.fill();
    }
    if (!red) {
      // heartbeat ring (neutral, very faint) + ambient dots drifting along the lattice
      const bp = ((now - this.t0) % 3200) / 3200;
      ctx.lineWidth = 1.2; ctx.strokeStyle = NEUTRAL; ctx.globalAlpha = (1 - bp) * 0.10;
      ctx.beginPath(); ctx.arc(cx, cy, R * (0.12 + 0.9 * bp), 0, Math.PI * 2); ctx.stroke();
      for (let k = 0; k < 2; k++) {
        const rot = (k ? 0.6 : -0.5) + t * (k ? 0.07 : -0.05);
        ctx.globalAlpha = 0.09; ctx.lineWidth = 1; ctx.strokeStyle = NEUTRAL;
        ctx.beginPath(); ctx.ellipse(cx, cy, R * 1.04, R * 0.36, rot, 0, Math.PI * 2); ctx.stroke();
        const ang = t * (k ? 0.9 : 1.25) + k * Math.PI, lx = R * 1.04 * Math.cos(ang), ly = R * 0.36 * Math.sin(ang);
        const ox = cx + lx * Math.cos(rot) - ly * Math.sin(rot), oy = cy + lx * Math.sin(rot) + ly * Math.cos(rot);
        ctx.globalAlpha = 0.18; ctx.drawImage(this.halos.n, ox - 9, oy - 9, 18, 18);
        ctx.globalAlpha = 0.8; ctx.fillStyle = '#cfe0ff'; ctx.beginPath(); ctx.arc(ox, oy, 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#a9c4f0';
      for (const a of this.amb) {
        a.t += dt * a.sp * 1.4;
        if (a.t >= 1) { a.t -= 1; a.l = Math.floor(this.rnd() * this.scaffoldLinks.length); a.sp = 0.35 + this.rnd() * 0.55; }
        const [ia, ib] = this.scaffoldLinks[a.l]; const pa = sp2[ia], pb = sp2[ib];
        const depth = (pa[2] + pb[2] + 2) / 4;
        ctx.globalAlpha = Math.sin(a.t * Math.PI) * (0.25 + 0.5 * depth);
        ctx.beginPath(); ctx.arc(pa[0] + (pb[0] - pa[0]) * a.t, pa[1] + (pb[1] - pa[1]) * a.t, 1.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    // node screen positions + alpha
    const pos: number[][] = new Array(MAX_NODES);
    const al: number[] = new Array(MAX_NODES);
    for (let i = 0; i < MAX_NODES; i++) {
      const n = this.nodes[i];
      if (!n.alive) { al[i] = 0; continue; }
      const age = now - n.born;
      if (age > n.life) { n.alive = false; al[i] = 0; continue; }
      let a = 1;
      if (age < 250) a = age / 250;
      else if (age > n.life - 6000) a = (n.life - age) / 6000;
      al[i] = a;
      proj(n.x, n.y, n.z, o); pos[i] = [o[0], o[1], o[2]];
    }

    // links
    for (const l of this.links) {
      if (!l.alive) continue;
      const na = this.nodes[l.a], nb = this.nodes[l.b];
      if (!na.alive || !nb.alive || !pos[l.a] || !pos[l.b]) { l.alive = false; continue; }
      const pa = pos[l.a], pb = pos[l.b];
      const fresh = Math.max(0, 1 - (now - l.born) / 1500);
      const depth = (pa[2] + pb[2] + 2) / 4;
      ctx.globalAlpha = Math.min(al[l.a], al[l.b]) * (0.22 + 0.34 * depth + 0.4 * fresh);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = nb.kind === 1 ? GREEN : nb.kind === -1 ? RED : NEUTRAL;
      if (na.kind !== nb.kind && na.kind !== 0 && nb.kind !== 0) ctx.strokeStyle = '#b9a0c8';
      ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
      if (fresh > 0.15 && nb.kind !== 0) {   // soft glow on freshly created links
        const ga = ctx.globalAlpha; ctx.globalAlpha = Math.min(al[l.a], al[l.b]) * 0.16 * fresh; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke(); ctx.globalAlpha = ga; ctx.lineWidth = 1.2;
      }
      if (!red && nb.kind !== 0) {
        // a bright dot keeps travelling along every live link (same colour as the link)
        const u = (((now - l.born) / 1000) * 0.7) % 1;
        ctx.globalAlpha = Math.min(al[l.a], al[l.b]) * Math.sin(u * Math.PI) * 0.9;
        ctx.fillStyle = ctx.strokeStyle as string;
        ctx.beginPath(); ctx.arc(pa[0] + (pb[0] - pa[0]) * u, pa[1] + (pb[1] - pa[1]) * u, 1.9, 0, Math.PI * 2); ctx.fill();
        const u2 = (u + 0.5) % 1;
        ctx.globalAlpha = Math.min(al[l.a], al[l.b]) * Math.sin(u2 * Math.PI) * 0.7;
        ctx.beginPath(); ctx.arc(pa[0] + (pb[0] - pa[0]) * u2, pa[1] + (pb[1] - pa[1]) * u2, 1.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    // halos then nodes, back to front
    const order: number[] = [];
    for (let i = 0; i < MAX_NODES; i++) if (al[i] > 0.01) order.push(i);
    order.sort((a, b) => pos[a][2] - pos[b][2]);
    const maxHalo = R * 0.32;
    for (const i of order) {
      const n = this.nodes[i];
      if (n.halo <= 0) continue;
      const age = now - n.born;
      const pop = age < 250 ? 0.4 + 0.6 * (age / 250) : 1;
      const hr = Math.min(maxHalo, n.size * (3.6 + n.halo * 3.8)) * pop;
      const sprite = this.halos[n.kind === 1 ? 'g' : n.kind === -1 ? 'r' : 'n'];
      ctx.globalAlpha = al[i] * (0.3 + 0.45 * n.halo) * (0.55 + 0.45 * (pos[i][2] + 1) / 2);
      ctx.drawImage(sprite, pos[i][0] - hr, pos[i][1] - hr, hr * 2, hr * 2);
      if (n.halo > 0.55 && !this.opts.lite) {   // translucent bubble with a thin rim for the strongest ticks
        const br2 = n.size * 2.3 * pop, col = n.kind === 1 ? GREEN : RED;
        ctx.globalAlpha = al[i] * 0.12; ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(pos[i][0], pos[i][1], br2, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = al[i] * 0.4; ctx.strokeStyle = col; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(pos[i][0], pos[i][1], br2, 0, Math.PI * 2); ctx.stroke();
      }
    }
    for (const i of order) {
      const n = this.nodes[i];
      const age = now - n.born;
      const pop = age < 250 ? (age / 250) * 1.15 : 1;
      const br = red || n.kind === 0 ? 1 : 1 + 0.12 * Math.sin(t * 2.4 + i * 0.9);   // live nodes breathe
      const r = Math.max(1.2, n.size * Math.min(1.1, pop) * (0.8 + 0.25 * (pos[i][2] + 1) / 2) * br);
      ctx.globalAlpha = al[i] * (0.65 + 0.35 * (pos[i][2] + 1) / 2);
      ctx.fillStyle = n.kind === 1 ? GREEN : n.kind === -1 ? RED : NEUTRAL;
      ctx.beginPath(); ctx.arc(pos[i][0], pos[i][1], r, 0, Math.PI * 2); ctx.fill();
      if (n.kind !== 0 && r > 3) {
        ctx.globalAlpha = al[i] * 0.55; ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(pos[i][0] - r * 0.25, pos[i][1] - r * 0.25, r * 0.35, 0, Math.PI * 2); ctx.fill();
      }
    }

    // shock rings + gold bursts
    ctx.lineWidth = 2;
    this.rings = this.rings.filter(r => now - r.t0 < 1200);
    for (const r of this.rings) {
      const p = (now - r.t0) / 1200;
      ctx.globalAlpha = (1 - p) * 0.55; ctx.strokeStyle = r.color;
      ctx.beginPath(); ctx.arc(cx, cy, R * (0.1 + 1.05 * p), 0, Math.PI * 2); ctx.stroke();
    }
    this.bursts = this.bursts.filter(b => now - b.t0 < 1300);
    ctx.fillStyle = GOLD;
    for (const b of this.bursts) {
      const p = (now - b.t0) / 1300;
      ctx.globalAlpha = (1 - p) * 0.9;
      ctx.beginPath(); ctx.arc(cx + b.vx * R * 1.0 * p, cy + b.vy * R * 1.0 * p, 2.2 * (1 - p) + 0.6, 0, Math.PI * 2); ctx.fill();
    }
    if (glitch) { ctx.globalAlpha = 0.14; ctx.fillStyle = RED; ctx.fillRect(0, 0, W, H); }
    ctx.globalAlpha = 1;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // overlays
    if (!this.hero()) {
      const pills = this.signalPills(ctx);
      this.drawSignalLines(ctx, pills);
      this.drawLabels(ctx, yaw, pitch, pills);
      this.drawSignalPills(ctx, pills);
      this.drawFlowBoxes(ctx); this.drawCooldown(ctx);
      this.drawDetail(ctx);
    } else { this.lastBoxes = []; }
    this.drawPriceChip(ctx, now);
  }

  private wash(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, a: number) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, color + '00');
    ctx.globalAlpha = a; ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  }

  private rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  private drawFlowBoxes(ctx: CanvasRenderingContext2D) {
    const W = this.W;
    const w = Math.min(122, W * 0.31), h = 46, m = 10;
    const draw = (x: number, title: string, pct: number | null, col: string) => {
      ctx.globalAlpha = 1;
      this.rrect(ctx, x, m, w, h, 10);
      ctx.fillStyle = 'rgba(3,5,10,0.78)'; ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = pct === null ? '#3a4558' : col; ctx.globalAlpha = 0.7; ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.font = '600 9px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = pct === null ? '#6b7689' : col;
      ctx.fillText(title.split('').join('\u200a'), x + 10, m + 16);
      ctx.font = '700 21px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText(pct === null ? '--' : pct.toFixed(1) + '%', x + 10, m + 38);
    };
    draw(m, 'BUY FLOW', this.buyPct, GREEN);
    draw(W - m - w, 'SELL FLOW', this.sellPct, RED);
  }

  private drawCooldown(ctx: CanvasRenderingContext2D) {
    if (this.cooldown <= 0) return;
    const s = Math.ceil(this.cooldown);
    const txt = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    const w = 60, h = 24, x = this.W / 2 - w / 2, y = 12;
    this.rrect(ctx, x, y, w, h, 12);
    ctx.fillStyle = 'rgba(3,5,10,0.8)'; ctx.fill();
    ctx.strokeStyle = GOLD; ctx.globalAlpha = 0.7; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.font = '600 12px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = GOLD; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, this.W / 2, y + h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  }

  private chipInfo(now: number) {
    const m = this.mode;
    let prefix = '', col = '#e8eefc';
    if (m === 'replay') { prefix = 'REPLAY '; col = GOLD; }
    else if (m === 'reconnecting') { prefix = 'RECONNECTING '; col = GOLD; }
    else if (m === 'closed') { prefix = 'CLOSED '; col = '#8a9ba8'; }
    else if (now < this.flashUntil) col = this.flashColor;
    const price = this.livePrice === null ? '--' : this.livePrice.toFixed(2);
    return { txt: prefix + (price === '--' ? '--' : '$' + price), col };
  }

  private drawPriceChip(ctx: CanvasRenderingContext2D, now: number) {
    const { txt, col } = this.chipInfo(now);
    ctx.font = '700 13px ui-monospace, Menlo, Consolas, monospace';
    const w = Math.min(this.W - 20, ctx.measureText(txt).width + 22), h = 26;
    const x = this.cx - w / 2, y = this.cy - h / 2;
    this.rrect(ctx, x, y, w, h, 8);
    ctx.fillStyle = 'rgba(3,5,10,0.82)'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = col; ctx.globalAlpha = 0.65; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, this.cx, y + h / 2 + 1);
    if (this.hero()) {
      ctx.font = '500 10px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = '#7b879b';
      ctx.fillText(this.ticksPerMin() + ' ticks/min', this.cx, y + h + 14);
    }
    ctx.textBaseline = 'alphabetic';
  }

  private drawLabels(ctx: CanvasRenderingContext2D, yaw: number, _pitch: number, pills: Pill[]) {
    const W = this.W, H = this.H, cx = this.cx, cy = this.cy, R = this.R;
    const maxN = W < 520 ? 6 : 9;
    const byKey: Record<string, CoreLabel> = {};
    for (const l of this.labels) byKey[l.key] = l;
    const shown: CoreLabel[] = [];
    for (const k of LABEL_ORDER) if (byKey[k] && shown.length < maxN) shown.push(byKey[k]);
    const f1 = W < 520 ? 10 : 11, f2 = W < 520 ? 9 : 10;
    type Box = { l: CoreLabel; mx: number; my: number; x: number; y: number; w: number; h: number; right: boolean };
    const boxes: Box[] = [];
    for (const l of shown) {
      const ang = ((LABEL_ANGLE[l.key] ?? 0) * Math.PI) / 180 + yaw * 0.15;
      const mx = cx + Math.cos(ang) * R * 0.97, my = cy + Math.sin(ang) * R * 0.97;
      ctx.font = `700 ${f1}px ui-monospace, Menlo, Consolas, monospace`;
      const w1 = ctx.measureText(l.title).width;
      ctx.font = `500 ${f2}px ui-monospace, Menlo, Consolas, monospace`;
      const w2 = ctx.measureText(l.value).width;
      const w = Math.min(W - 16, Math.max(w1, w2) + 10), h = f1 + f2 + 10;
      const right = Math.cos(ang) >= 0;
      let side = right;
      let x = side ? mx + 13 : mx - 13 - w;
      if (side && x + w > W - 8) { side = false; x = mx - 13 - w; }      // would be clipped -> flip to the other side of its marker
      else if (!side && x < 8) { side = true; x = mx + 13; }
      let y = my - h / 2;
      x = Math.min(Math.max(8, x), W - 8 - w);
      boxes.push({ l, mx, my, x, y, w, h, right: side });
    }
    // keep labels off the live-price chip in the centre
    ctx.font = '700 13px ui-monospace, Menlo, Consolas, monospace';
    const chipW = Math.min(W - 20, ctx.measureText(this.chipInfo(performance.now()).txt).width + 22);
    const cL = cx - chipW / 2 - 4, cR = cx + chipW / 2 + 4, cT = cy - 17, cB = cy + 17;
    const obstacles = [{ x: cL, y: cT, w: cR - cL, h: cB - cT }];
    // merge stacked signal pills into one obstacle per cluster so labels jump over the whole stack
    for (const p of pills) {
      const last = obstacles.length > 1 ? obstacles[obstacles.length - 1] : null;
      const px = p.x - 3, py = p.y - 2, pw = p.w + 6, ph = p.h + 4;
      if (last && py <= last.y + last.h + 4) {
        const nx = Math.min(last.x, px), nb = Math.max(last.y + last.h, py + ph);
        last.w = Math.max(last.x + last.w, px + pw) - nx; last.x = nx; last.h = nb - last.y;
      } else obstacles.push({ x: px, y: py, w: pw, h: ph });
    }
    for (const o of obstacles) {
      for (const b of boxes) {
        if (b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y) {
          if (b.y + b.h / 2 <= o.y + o.h / 2) b.y = o.y - b.h - 2; else b.y = o.y + o.h + 2;
        }
      }
    }
    boxes.sort((a, b) => a.y - b.y);
    const topLimit = 64 + 2, botLimit = H - 8;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      b.y = Math.max(topLimit, b.y);
      for (let j = 0; j < i; j++) {
        const a = boxes[j];
        const ox = b.x < a.x + a.w + 4 && b.x + b.w + 4 > a.x;
        if (ox && b.y < a.y + a.h + 3) b.y = a.y + a.h + 3;
      }
    }
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      if (b.y + b.h > botLimit) b.y = botLimit - b.h;
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[j];
        const ox = b.x < a.x + a.w + 4 && b.x + b.w + 4 > a.x;
        if (ox && b.y + b.h + 3 > a.y) b.y = a.y - b.h - 3;
      }
    }
    // last resort: a label still touching a signal pill slides left of the pill stack
    for (const b of boxes) {
      for (const p of pills) {
        if (b.x < p.x + p.w + 3 && b.x + b.w > p.x - 3 && b.y < p.y + p.h + 2 && b.y + b.h > p.y - 2) {
          b.x = Math.max(8, p.x - 6 - b.w);
        }
      }
    }
    this.lastBoxes = boxes.map(b => ({ key: b.l.key, x: b.x, y: b.y, w: b.w, h: b.h, mx: b.mx, my: b.my }));
    const selKey = this.selected && performance.now() < this.selected.until ? this.selected.key : null;
    for (const b of boxes) {
      const tone = b.l.tone;
      const col = tone === 'bull' ? GREEN : tone === 'bear' ? RED : tone === 'neutral' ? '#aab6cc' : '#667286';
      const mid = b.y + b.h / 2;
      if (Math.abs(mid - b.my) > 14) {
        ctx.globalAlpha = 0.35; ctx.strokeStyle = col; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(b.mx, b.my);
        ctx.lineTo(b.right ? b.x : b.x + b.w, mid); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      this.rrect(ctx, b.x, b.y, b.w, b.h, 5);
      ctx.fillStyle = 'rgba(3,5,10,0.62)'; ctx.fill();
      // marker: ring + dot
      ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.arc(b.mx, b.my, selKey === b.l.key ? 11 : 8, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(b.mx, b.my, 4, 0, Math.PI * 2); ctx.fill();
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.font = `700 ${f1}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.fillStyle = col;
      ctx.fillText(b.l.title, b.x + 5, b.y + 4 + f1);
      ctx.font = `500 ${f2}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.fillStyle = '#93a0b8';
      ctx.fillText(b.l.value, b.x + 5, b.y + 6 + f1 + f2);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- signal levels ----------
  private signalPills(ctx: CanvasRenderingContext2D): Pill[] {
    const s = this.signal;
    if (!s || this.livePrice === null) return [];
    const W = this.W, H = this.H, cy = this.cy, R = this.R;
    const scale = R * 0.045;                       // pixels per dollar
    const defs: [string, number, string][] = [
      ['ENTRY', s.entry, '#e8eefc'], ['SL', s.sl, RED], ['TP1', s.tp1, GREEN], ['TP2', s.tp2, GREEN], ['TP3', s.tp3, GREEN],
    ];
    ctx.font = '700 9px ui-monospace, Menlo, Consolas, monospace';
    const pills: Pill[] = defs.filter(d => isFinite(d[1])).map(d => {
      const text = d[0] + ' ' + d[1].toFixed(2);
      const w = ctx.measureText(text).width + 10, h = 15;
      const lineY = Math.min(cy + R * 0.95, Math.max(cy - R * 0.95, cy - (d[1] - this.livePrice!) * scale));
      return { text, col: d[2], x: W - 8 - w, y: lineY - h / 2, w, h, lineY };
    });
    pills.sort((a, b) => a.y - b.y);
    for (let i = 0; i < pills.length; i++) {
      pills[i].y = Math.max(66, pills[i].y);
      if (i > 0 && pills[i].y < pills[i - 1].y + 17) pills[i].y = pills[i - 1].y + 17;
    }
    for (let i = pills.length - 1; i >= 0; i--) {
      if (pills[i].y + pills[i].h > H - 10) pills[i].y = H - 10 - pills[i].h;
      if (i < pills.length - 1 && pills[i].y + 17 > pills[i + 1].y) pills[i].y = pills[i + 1].y - 17;
    }
    return pills;
  }

  private drawSignalLines(ctx: CanvasRenderingContext2D, pills: Pill[]) {
    if (!pills.length) return;
    ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    for (const p of pills) {
      ctx.globalAlpha = 0.35; ctx.strokeStyle = p.col;
      ctx.beginPath(); ctx.moveTo(this.cx - this.R * 0.95, p.lineY); ctx.lineTo(p.x, p.lineY); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  private drawSignalPills(ctx: CanvasRenderingContext2D, pills: Pill[]) {
    for (const p of pills) {
      this.rrect(ctx, p.x, p.y, p.w, p.h, 5);
      ctx.fillStyle = 'rgba(3,5,10,0.85)'; ctx.fill();
      ctx.strokeStyle = p.col; ctx.globalAlpha = 0.8; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.font = '700 9px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = p.col; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(p.text, p.x + 5, p.y + p.h / 2 + 0.5);
    }
    ctx.textBaseline = 'alphabetic';
  }

  // ---------- label detail card (tap a label) ----------
  private drawDetail(ctx: CanvasRenderingContext2D) {
    const sel = this.selected;
    if (!sel) return;
    const now = performance.now();
    if (now >= sel.until) { this.selected = null; return; }
    const l = this.labels.find(x => x.key === sel.key);
    if (!l) { this.selected = null; return; }
    const W = this.W, H = this.H;
    const col = l.tone === 'bull' ? GREEN : l.tone === 'bear' ? RED : l.tone === 'neutral' ? '#aab6cc' : '#667286';
    const fallback = l.tone === 'bull' ? 'Bullish reading.' : l.tone === 'bear' ? 'Bearish reading.' : l.tone === 'neutral' ? 'Neutral reading.' : 'No data yet. Waiting for the live feed.';
    const body = l.detail && l.detail.trim() ? l.detail : fallback;
    const w = Math.min(W - 24, 280), pad = 10;
    ctx.font = '500 10px ui-monospace, Menlo, Consolas, monospace';
    const lines: string[] = [];
    let cur = '';
    for (const word of body.split(/\s+/)) {
      const t = cur ? cur + ' ' + word : word;
      if (ctx.measureText(t).width > w - pad * 2 && cur) { lines.push(cur); cur = word; } else cur = t;
    }
    if (cur) lines.push(cur);
    const shown = lines.slice(0, 5);
    const h = pad * 2 + 14 + 14 + shown.length * 13 + 10;
    const x = (W - w) / 2, y = H - 8 - h;
    this.rrect(ctx, x, y, w, h, 8);
    ctx.fillStyle = 'rgba(5,8,14,0.94)'; ctx.fill();
    ctx.strokeStyle = col; ctx.globalAlpha = 0.8; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '700 12px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = col; ctx.fillText(l.title, x + pad, y + pad + 10);
    ctx.font = '600 11px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = '#e8eefc'; ctx.fillText(l.value, x + pad, y + pad + 26);
    ctx.font = '500 10px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = '#93a0b8';
    shown.forEach((t, i) => ctx.fillText(t, x + pad, y + pad + 42 + i * 13));
    ctx.font = '500 8px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = '#5b6577'; ctx.textAlign = 'right';
    ctx.fillText('tap to close', x + w - pad, y + h - 6);
    ctx.textAlign = 'left';
  }
}
