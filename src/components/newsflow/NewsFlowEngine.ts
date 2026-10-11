// src/components/newsflow/NewsFlowEngine.ts
// NEWS FLOW: upcoming gold news streams (left) -> gold hub (centre) -> bullish / bearish outcome (right).
// Canvas2D only. No fake data: draws exactly the events it is given.
export type NFLean = 'bull' | 'bear' | 'wait';
export interface NFEvent {
  id: string;
  title: string;        // short headline, e.g. "CPI m/m"
  tier: 1 | 2 | 3;      // HIGH / MED / LOW
  lean: NFLean;         // from deterministic rules; 'wait' when no forecast yet
  ts: number;           // event time, epoch ms
}
export interface NFOpts { lite?: boolean; onSelect?: (id: string) => void; }

const GREEN = '52,211,153', RED = '248,113,113', GREY = '148,163,184', GOLD = '245,192,66', AMBER = '251,146,60';
const rgb = (c: string, a: number) => `rgba(${c},${a})`;
const colOf = (l: NFLean) => (l === 'bull' ? GREEN : l === 'bear' ? RED : GREY);

function fmtLeft(ms: number): string {
  if (ms <= 0) return 'LIVE';
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mm}m`;
  return `${mm}m`;
}

interface P { t: number; sp: number; k: number; off: number; }

export class NewsFlowEngine {
  private c: HTMLCanvasElement; private g: CanvasRenderingContext2D;
  private W = 0; private H = 0; private dpr = 1;
  private ev: NFEvent[] = []; private parts: P[][] = [];
  private raf = 0; private ro: ResizeObserver; private last = 0; private t0 = performance.now();
  private lite: boolean; private onSelect?: (id: string) => void;
  private rows: { id: string; y: number }[] = [];
  private branch: P[] = [];
  private lockedOverride: boolean | null = null;
  private vis = true;
  private hubX = 0; private hubY = 0;
  private nextId: string | null = null;
  private countdownText: string | null = null;

  constructor(canvas: HTMLCanvasElement, o: NFOpts = {}) {
    this.c = canvas; this.g = canvas.getContext('2d')!; this.lite = !!o.lite; this.onSelect = o.onSelect;
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(canvas.parentElement || canvas);
    this.resize();
    canvas.addEventListener('pointerdown', this.tap);
    document.addEventListener('visibilitychange', this.vc);
    this.last = performance.now(); this.raf = requestAnimationFrame(this.loop);
    for (let i = 0; i < (this.lite ? 10 : 22); i++) this.branch.push({ t: Math.random(), sp: 0.18 + Math.random() * 0.2, k: i % 2, off: Math.random() });
  }
  setLite(v: boolean) { this.lite = v; }
  setLocked(v: boolean | null) { this.lockedOverride = v; }
  setNext(id?: string, countdownText?: string) {
    this.nextId = id || null;
    this.countdownText = countdownText || null;
  }
  setEvents(list: NFEvent[]) {
    const e = [...list].sort((a, b) => a.ts - b.ts).slice(0, 6);
    this.ev = e;
    this.parts = e.map((x) => {
      const n = this.lite ? 4 : x.tier === 1 ? 14 : x.tier === 2 ? 9 : 6;
      return Array.from({ length: n }, (_, i) => ({ t: Math.random(), sp: 0.1 + Math.random() * 0.12, k: i % 3, off: Math.random() }));
    });
    this.layout();
  }
  destroy() {
    cancelAnimationFrame(this.raf); this.ro.disconnect();
    this.c.removeEventListener('pointerdown', this.tap);
    document.removeEventListener('visibilitychange', this.vc);
  }
  private vc = () => { this.vis = !document.hidden; this.last = performance.now(); };
  private tap = (e: PointerEvent) => {
    if (!this.onSelect) return;
    const r = this.c.getBoundingClientRect(); const y = e.clientY - r.top; const x = e.clientX - r.left;
    if (x > this.W * 0.5) return;
    let best: { id: string; d: number } | null = null;
    for (const row of this.rows) { const d = Math.abs(row.y - y); if (d < 28 && (!best || d < best.d)) best = { id: row.id, d }; }
    if (best) this.onSelect(best.id);
  };
  private resize() {
    const p = this.c.parentElement || this.c; const r = p.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = Math.max(280, r.width); this.H = Math.max(200, r.height);
    this.c.width = Math.round(this.W * this.dpr); this.c.height = Math.round(this.H * this.dpr);
    this.c.style.width = this.W + 'px'; this.c.style.height = this.H + 'px';
    this.layout();
  }
  private layout() {
    const n = this.ev.length; const top = this.H * 0.13, bot = this.H * 0.87;
    this.rows = this.ev.map((e, i) => ({ id: e.id, y: n === 1 ? this.H / 2 : top + ((bot - top) * i) / (n - 1) }));
    this.hubX = this.W * 0.62; this.hubY = this.H / 2;
  }
  private bez(x0: number, y0: number, x1: number, y1: number, t: number, off = 0): [number, number] {
    const cx = x0 + (x1 - x0) * 0.55;
    const u = 1 - t; const yy0 = y0 + off, yy1 = y1 + off * 0.15;
    const x = u * u * u * x0 + 3 * u * u * t * cx + 3 * u * t * t * cx + t * t * t * x1;
    const y = u * u * u * yy0 + 3 * u * u * t * yy0 + 3 * u * t * t * yy1 + t * t * t * yy1;
    return [x, y];
  }
  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.vis) return;
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    this.draw(now, dt);
  };
  private draw(now: number, dt: number) {
    const g = this.g, W = this.W, H = this.H, wall = Date.now();
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#03050a'; g.fillRect(0, 0, W, H);
    const tt = (now - this.t0) / 1000;
    const nodeX = W * 0.40, hx = this.hubX, hy = this.hubY;
    const next = this.nextId
      ? this.ev.find((e) => e.id === this.nextId) || null
      : this.ev.find((e) => e.ts + 15 * 60000 > wall) || null;
    const msLeft = next ? next.ts - wall : 0;
    const locked = this.lockedOverride !== null ? this.lockedOverride : !!next && msLeft <= 30 * 60000 && msLeft >= -15 * 60000;
    const hubC = locked ? AMBER : GOLD;

    // streams: 3 strands per event, like a ribbon bundle
    this.ev.forEach((e, i) => {
      const y = this.rows[i].y; const c = colOf(e.lean);
      const isNext = !!next && e.id === next.id;
      const urg = Math.max(0.15, Math.min(1, 1 - (e.ts - wall) / (36 * 3600e3)));   // closer in time = brighter/faster
      const base = (e.tier === 1 ? 0.5 : e.tier === 2 ? 0.34 : 0.22) * (0.45 + urg * 0.75) * (isNext ? 1.3 : 1);
      for (let s = -1; s <= 1; s++) {
        g.beginPath();
        for (let k = 0; k <= 24; k++) { const [x, yy] = this.bez(nodeX, y, hx, hy, k / 24, s * 2.2); k ? g.lineTo(x, yy) : g.moveTo(x, yy); }
        g.strokeStyle = rgb(c, Math.min(0.9, base * (s === 0 ? 1 : 0.6)));
        g.lineWidth = e.tier === 1 ? 1.5 : 1; g.stroke();
      }
      // particles
      const arr = this.parts[i] || [];
      for (const p of arr) {
        p.t += dt * p.sp * (0.5 + urg * 1.6) * (isNext ? 1.4 : 1); if (p.t > 1) { p.t -= 1; p.off = Math.random(); }
        const [x, yy] = this.bez(nodeX, y, hx, hy, p.t, (p.k - 1) * 2.2);
        const a = Math.sin(p.t * Math.PI) * (0.5 + urg * 0.5);
        g.fillStyle = rgb(c, a); g.beginPath(); g.arc(x, yy, e.tier === 1 ? 2 : 1.5, 0, 6.283); g.fill();
      }
      // node
      const pulse = isNext ? 1 + 0.25 * Math.sin(tt * 3.2) : 1;
      g.fillStyle = rgb(c, 0.95); g.beginPath(); g.arc(nodeX, y, (e.tier === 1 ? 4.2 : 3.2) * pulse, 0, 6.283); g.fill();
      if (isNext) { g.strokeStyle = rgb(c, 0.4); g.lineWidth = 1; g.beginPath(); g.arc(nodeX, y, 8 + 2 * Math.sin(tt * 3.2), 0, 6.283); g.stroke(); }
      // headline (left): 1 short line + countdown
      const fs = W < 420 ? 10.5 : 12;
      g.textAlign = 'right'; g.textBaseline = 'middle';
      let title = e.title; const maxW = nodeX - 18;
      g.font = `600 ${fs}px ui-monospace,Menlo,monospace`;
      while (title.length > 3 && g.measureText(title).width > maxW) title = title.slice(0, -2);
      if (title !== e.title) title += '…';
      g.fillStyle = isNext ? '#f8fafc' : 'rgba(226,232,240,0.82)';
      g.fillText(title, nodeX - 12, y - fs * 0.55);
      g.font = `500 ${fs - 1.5}px ui-monospace,Menlo,monospace`;
      g.fillStyle = rgb(e.tier === 1 ? RED : e.tier === 2 ? GOLD : GREY, 0.9);
      const tierTxt = e.tier === 1 ? 'HIGH' : e.tier === 2 ? 'MED' : 'LOW';
      g.fillText(`${tierTxt} · ${fmtLeft(e.ts - wall)}`, nodeX - 12, y + fs * 0.7);
    });

    // hub
    const hp = 1 + 0.08 * Math.sin(tt * (locked ? 5 : 2));
    const gr = g.createRadialGradient(hx, hy, 0, hx, hy, 46 * hp);
    gr.addColorStop(0, rgb(hubC, 0.35)); gr.addColorStop(1, rgb(hubC, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(hx, hy, 46 * hp, 0, 6.283); g.fill();
    g.strokeStyle = rgb(hubC, 0.9); g.lineWidth = 1.5; g.beginPath(); g.arc(hx, hy, 15 * hp, 0, 6.283); g.stroke();
    g.fillStyle = rgb(hubC, 0.95); g.beginPath(); g.arc(hx, hy, 5, 0, 6.283); g.fill();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 9.5px ui-monospace,Menlo,monospace'; g.fillStyle = rgb(hubC, 0.95);
    const hasNextTarget = !!this.nextId || !!next;
    g.fillText(locked ? 'SIGNALS PAUSED' : hasNextTarget ? 'NEXT NEWS' : 'NO NEWS', hx, hy - 30);
    g.font = '700 13px ui-monospace,Menlo,monospace'; g.fillStyle = '#f8fafc';
    const displayedCountdown = this.countdownText || (next ? fmtLeft(msLeft) : '—');
    g.fillText(hasNextTarget ? displayedCountdown : '—', hx, hy + 30);

    // outcome branches (right): upper = BULLISH, lower = BEARISH
    const ex = W * 0.93, upY = H * 0.26, dnY = H * 0.74;
    const lean = next ? next.lean : 'wait';
    const bullA = lean === 'bull' ? 0.9 : 0.18;
    const bearA = lean === 'bear' ? 0.9 : 0.18;
    const fan = 6;
    for (let side = 0; side < 2; side++) {
      const ty = side === 0 ? upY : dnY; const c = side === 0 ? GREEN : RED; const a = side === 0 ? bullA : bearA;
      for (let f = 0; f < fan; f++) {
        const spread = (f - (fan - 1) / 2) * (H * 0.045);
        g.beginPath();
        for (let k = 0; k <= 20; k++) {
          const t = k / 20, x = hx + 16 + (ex - hx - 16) * t;
          const mid = hy + (ty - hy) * Math.pow(t, 0.8); const y = mid + spread * Math.pow(t, 1.4);
          k ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.strokeStyle = rgb(c, a * 0.55); g.lineWidth = 1; g.stroke();
        g.fillStyle = rgb(c, a); g.beginPath(); g.arc(ex, ty + spread, 1.8, 0, 6.283); g.fill();
      }
    }
    for (const p of this.branch) {
      p.t += dt * p.sp; if (p.t > 1) { p.t -= 1; p.off = Math.random(); }
      const side = p.k, ty = side === 0 ? upY : dnY, a = side === 0 ? bullA : bearA, c = side === 0 ? GREEN : RED;
      const spread = (Math.floor(p.off * fan) - (fan - 1) / 2) * (H * 0.045);
      const t = p.t, x = hx + 16 + (ex - hx - 16) * t, mid = hy + (ty - hy) * Math.pow(t, 0.8), y = mid + spread * Math.pow(t, 1.4);
      g.fillStyle = rgb(c, Math.sin(t * Math.PI) * a); g.beginPath(); g.arc(x, y, 1.8, 0, 6.283); g.fill();
    }
    g.textAlign = 'right'; g.font = '700 10.5px ui-monospace,Menlo,monospace';
    g.fillStyle = rgb(GREEN, Math.max(0.5, bullA)); g.fillText('BULLISH', W - 8, upY - H * 0.15);
    g.fillStyle = rgb(RED, Math.max(0.5, bearA)); g.fillText('BEARISH', W - 8, dnY + H * 0.15);
    g.font = '500 9px ui-monospace,Menlo,monospace';
    g.fillStyle = 'rgba(148,163,184,0.85)';
    g.fillText(lean === 'bull' ? 'leans bullish if as forecast' : lean === 'bear' ? 'leans bearish if as forecast' : 'waiting for forecast', W - 8, H - 8);

    if (!this.ev.length) {
      g.textAlign = 'center'; g.fillStyle = 'rgba(148,163,184,0.8)'; g.font = '600 12px ui-monospace,Menlo,monospace';
      g.fillText('No upcoming gold news', W / 2, H / 2 + 60);
    }
  }
}
