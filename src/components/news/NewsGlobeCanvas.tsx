import React, { useEffect, useRef, useState } from 'react';
import { NewsVerdict } from './decisionTypes';

export interface NewsGlobeProps {
  theme: 'dark' | 'light';
  nextNewsTitle: string;
  nextNewsTimeUtc: string | null;
  minutesUntilNext: number | null;
  selectedEventTitle?: string | null;
  selectedEventTimeUtc?: string | null;
  selectedEventMinutesUntil?: number | null;
  isSelectedEventReleased?: boolean;
  isSelectedNextUpcoming?: boolean;
  selectedVerdict?: NewsVerdict;
  pulseSignal: number;
  isOffline?: boolean;
}

interface GlobeDot {
  lat: number;
  lon: number;
  x: number;
  y: number;
  z: number;
  isLand: boolean;
}

interface CityNode {
  id: string;
  name: string;
  lat: number;
  lon: number;
  isSource?: boolean;
  isUserHub?: boolean;
}

const SOURCE_CITY: CityNode = {
  id: 'washington',
  name: 'WASHINGTON',
  lat: 38.9072,
  lon: -77.0369,
  isSource: true,
};

const TARGET_CITIES: CityNode[] = [
  { id: 'london', name: 'LONDON', lat: 51.5074, lon: -0.1278 },
  { id: 'dubai', name: 'DUBAI', lat: 25.2048, lon: 55.2708, isUserHub: true },
  { id: 'mumbai', name: 'MUMBAI', lat: 19.076, lon: 72.8777 },
  { id: 'singapore', name: 'SINGAPORE', lat: 1.3521, lon: 103.8198 },
  { id: 'hongkong', name: 'HONG KONG', lat: 22.3193, lon: 114.1694 },
  { id: 'tokyo', name: 'TOKYO', lat: 35.6762, lon: 139.6503 },
  { id: 'sydney', name: 'SYDNEY', lat: -33.8688, lon: 151.2093 },
];

// Compact [lon, lat] continent polygons for fast point-in-polygon land classification
const LAND_POLYGONS: Array<Array<[number, number]>> = [
  // North America
  [
    [-168, 65], [-160, 71], [-130, 70], [-95, 72], [-78, 73], [-62, 66],
    [-53, 47], [-67, 45], [-75, 35], [-81, 25], [-90, 21], [-83, 9],
    [-78, 8], [-85, 11], [-97, 16], [-105, 20], [-117, 32], [-124, 48],
    [-138, 59], [-162, 58],
  ],
  // Greenland
  [
    [-55, 60], [-42, 60], [-20, 70], [-18, 81], [-50, 82], [-70, 76],
  ],
  // South America
  [
    [-79, 10], [-62, 10], [-50, 1], [-35, -6], [-39, -18], [-48, -28],
    [-58, -38], [-67, -55], [-75, -51], [-72, -35], [-71, -18], [-81, -5],
  ],
  // UK & Ireland
  [
    [-10, 51], [-6, 59], [2, 53], [-5, 50],
  ],
  // Europe & Scandinavia
  [
    [-9, 36], [-9, 43], [-2, 44], [-4, 48], [4, 53], [8, 55], [5, 61],
    [15, 69], [30, 71], [42, 67], [60, 68], [60, 50], [40, 46], [29, 41],
    [24, 37], [15, 38], [12, 44], [5, 43], [-2, 36],
  ],
  // Africa
  [
    [-17, 15], [-13, 28], [-6, 36], [10, 37], [33, 32], [43, 12],
    [51, 12], [41, -2], [40, -16], [33, -26], [20, -35], [14, -22],
    [9, -2], [4, 6], [-8, 4],
  ],
  // Madagascar
  [
    [43, -25], [47, -25], [50, -13], [44, -16],
  ],
  // Middle East & Arabian Peninsula
  [
    [34, 30], [36, 37], [48, 39], [56, 27], [60, 22], [44, 13], [35, 28],
  ],
  // Eurasia, Russia, India, China & SE Asia
  [
    [48, 40], [60, 50], [60, 70], [105, 75], [140, 72], [178, 66],
    [160, 53], [142, 50], [131, 42], [121, 39], [122, 30], [109, 20],
    [104, 1], [98, 8], [96, 16], [88, 22], [77, 8], [68, 23], [57, 25],
  ],
  // Japan
  [
    [130, 31], [136, 34], [141, 41], [145, 44], [141, 45], [137, 37], [130, 33],
  ],
  // Indonesia / Maritime SE Asia
  [
    [95, 5], [106, -6], [119, -8], [117, 4], [109, 2],
  ],
  [
    [120, -5], [141, -8], [141, -2], [122, 1],
  ],
  // Australia
  [
    [114, -22], [115, -34], [131, -32], [147, -39], [153, -28],
    [142, -11], [130, -12], [122, -18],
  ],
  // New Zealand
  [
    [166, -46], [178, -38], [174, -35], [167, -45],
  ],
];

function isPointInPolygon(lon: number, lat: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function classifyLand(latDeg: number, lonDeg: number): boolean {
  for (const poly of LAND_POLYGONS) {
    if (isPointInPolygon(lonDeg, latDeg, poly)) return true;
  }
  return false;
}

function latLonToVec3(latDeg: number, lonDeg: number): [number, number, number] {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const cosLat = Math.cos(lat);
  return [
    cosLat * Math.sin(lon),
    Math.sin(lat),
    cosLat * Math.cos(lon),
  ];
}

// Generate Fibonacci sphere lattice once (5,200 dots < 7,000 cap)
const DOT_COUNT = 5200;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
let cachedLattice: GlobeDot[] | null = null;

function getFibonacciLattice(): GlobeDot[] {
  if (cachedLattice) return cachedLattice;
  const dots: GlobeDot[] = [];
  for (let i = 0; i < DOT_COUNT; i++) {
    const y = 1 - (i / (DOT_COUNT - 1)) * 2; // +1 to -1
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN_ANGLE * i;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;

    const latDeg = (Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI;
    const lonDeg = (Math.atan2(x, z) * 180) / Math.PI;
    const isLand = classifyLand(latDeg, lonDeg);

    dots.push({ lat: latDeg, lon: lonDeg, x, y, z, isLand });
  }
  cachedLattice = dots;
  return dots;
}

// Project 3D point rotated by yaw (rotLon) and pitch (rotLat)
function rotateAndProject(
  vx: number,
  vy: number,
  vz: number,
  rotLon: number,
  rotLat: number
): { rx: number; ry: number; rz: number } {
  const cosLon = Math.cos(rotLon);
  const sinLon = Math.sin(rotLon);
  const x1 = vx * cosLon + vz * sinLon;
  const z1 = -vx * sinLon + vz * cosLon;
  const y1 = vy;

  const cosLat = Math.cos(rotLat);
  const sinLat = Math.sin(rotLat);
  const y2 = y1 * cosLat - z1 * sinLat;
  const z2 = y1 * sinLat + z1 * cosLat;

  return { rx: x1, ry: y2, rz: z2 };
}

function slerpVec3(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-4) {
    return [a[0], a[1], a[2]];
  }
  const sinOmega = Math.sin(omega);
  const wA = Math.sin((1 - t) * omega) / sinOmega;
  const wB = Math.sin(t * omega) / sinOmega;
  return [a[0] * wA + b[0] * wB, a[1] * wA + b[1] * wB, a[2] * wA + b[2] * wB];
}

function formatReleasedAgo(elapsedSeconds: number): string {
  const sec = Math.max(0, Math.floor(elapsedSeconds));
  if (sec < 60) return 'released just now';
  const mins = Math.floor(sec / 60);
  if (mins < 60) return `released ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `released ${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `released ${days}d ago`;
}

function formatHhMmSs(
  targetUtc: string | null,
  fallbackMinutes: number | null,
  isReleased?: boolean
): string {
  if (targetUtc) {
    const targetMs = new Date(targetUtc).getTime();
    if (Number.isFinite(targetMs)) {
      const diffSec = Math.floor((targetMs - Date.now()) / 1000);
      if (isReleased || diffSec <= 0) {
        return formatReleasedAgo(Math.abs(diffSec));
      }
      const hrs = Math.floor(diffSec / 3600);
      const mins = Math.floor((diffSec % 3600) / 60);
      const secs = diffSec % 60;
      return `in ${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
  }
  if (fallbackMinutes !== null) {
    if (isReleased || fallbackMinutes <= 0) {
      return formatReleasedAgo(Math.abs(fallbackMinutes) * 60);
    }
    const totalSec = Math.max(0, Math.round(fallbackMinutes * 60));
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return `in ${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return 'AWAITING SCHEDULE';
}

export const NewsGlobeCanvas: React.FC<NewsGlobeProps> = React.memo(
  ({
    theme,
    nextNewsTitle,
    nextNewsTimeUtc,
    minutesUntilNext,
    selectedEventTitle,
    selectedEventTimeUtc,
    selectedEventMinutesUntil,
    isSelectedEventReleased = false,
    isSelectedNextUpcoming = true,
    selectedVerdict,
    pulseSignal,
    isOffline = false,
  }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    // Ensure HUD name and its timer always belong to the exact same event
    const hasSelected = Boolean(selectedEventTitle);
    const hudEventTimeUtc = hasSelected ? (selectedEventTimeUtc ?? null) : nextNewsTimeUtc;
    const hudEventMinutesUntil = hasSelected
      ? (selectedEventMinutesUntil ?? null)
      : minutesUntilNext;
    const hudIsReleased = hasSelected ? Boolean(isSelectedEventReleased) : false;

    const [hudCountdown, setHudCountdown] = useState<string>(() =>
      formatHhMmSs(hudEventTimeUtc, hudEventMinutesUntil, hudIsReleased)
    );
    const [reducedMotion, setReducedMotion] = useState<boolean>(() => {
      if (typeof window !== 'undefined' && window.matchMedia) {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      }
      return false;
    });

    // Live 1s countdown ticker for HUD (strictly bound to the HUD event)
    useEffect(() => {
      setHudCountdown(formatHhMmSs(hudEventTimeUtc, hudEventMinutesUntil, hudIsReleased));
      const interval = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        setHudCountdown(formatHhMmSs(hudEventTimeUtc, hudEventMinutesUntil, hudIsReleased));
      }, 1000);
      return () => clearInterval(interval);
    }, [hudEventTimeUtc, hudEventMinutesUntil, hudIsReleased]);

    // Listen to prefers-reduced-motion changes
    useEffect(() => {
      if (typeof window === 'undefined' || !window.matchMedia) return;
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
      mq.addEventListener?.('change', handler);
      return () => mq.removeEventListener?.('change', handler);
    }, []);

    // Physics & animation state stored in ref for 60fps loop without re-renders
    const stateRef = useRef({
      rotLon: -0.35, // Initial view facing Atlantic / Europe / Dubai corridor
      rotLat: 0.28,
      velLon: 0,
      velLat: 0,
      isDragging: false,
      lastPointerX: 0,
      lastPointerY: 0,
      isVisibleOnScreen: true,
      isTabHidden: false,
      pulseBoostUntil: 0,
      phase: 0,
    });

    // Trigger burst when user clicks "SHOW ON GLOBE" or selects an event
    useEffect(() => {
      if (pulseSignal > 0) {
        stateRef.current.pulseBoostUntil = performance.now() + 4200;
      }
    }, [pulseSignal]);

    useEffect(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const dots = getFibonacciLattice();
      const sourceVec = latLonToVec3(SOURCE_CITY.lat, SOURCE_CITY.lon);
      const cityArcs = TARGET_CITIES.map((city, idx) => ({
        city,
        targetVec: latLonToVec3(city.lat, city.lon),
        speedOffset: idx * 0.14,
      }));

      let rafId = 0;

      const resizeCanvas = () => {
        const rect = container.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(260, Math.floor(rect.width));
        const h = Math.max(260, Math.floor(rect.height));
        if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
          canvas.width = w * dpr;
          canvas.height = h * dpr;
        }
      };

      resizeCanvas();
      const resizeObserver =
        typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resizeCanvas) : null;
      resizeObserver?.observe(container);

      const intersectionObserver =
        typeof IntersectionObserver !== 'undefined'
          ? new IntersectionObserver(
              (entries) => {
                for (const entry of entries) {
                  stateRef.current.isVisibleOnScreen = entry.isIntersecting;
                }
              },
              { threshold: 0.05 }
            )
          : null;
      intersectionObserver?.observe(container);

      const onVisibilityChange = () => {
        stateRef.current.isTabHidden = document.hidden;
      };
      document.addEventListener('visibilitychange', onVisibilityChange);

      const drawFrame = (nowMs: number) => {
        const st = stateRef.current;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = canvas.width / dpr;
        const height = canvas.height / dpr;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);

        const isDark = theme === 'dark';
        const cx = width * 0.5;
        const cy = height * 0.52;
        const globeRadius = Math.min(width * 0.41, height * 0.41, 148);

        // Update physics if motion is allowed
        if (!reducedMotion) {
          if (!st.isDragging) {
            st.rotLon += st.velLon + 0.0022;
            st.rotLat = Math.max(-0.78, Math.min(0.78, st.rotLat + st.velLat));
            st.velLon *= 0.93;
            st.velLat *= 0.93;
            if (Math.abs(st.velLon) < 0.00005) st.velLon = 0;
            if (Math.abs(st.velLat) < 0.00005) st.velLat = 0;
          }
          st.phase += 0.011;
        }

        // Subtle sphere silhouette & rim
        ctx.beginPath();
        ctx.arc(cx, cy, globeRadius, 0, Math.PI * 2);
        ctx.fillStyle = isDark ? '#0a0e14' : '#edf1f5';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = isDark ? '#1a212b' : '#dfe4ea';
        ctx.stroke();

        // Render Fibonacci dot lattice
        const rotLon = st.rotLon;
        const rotLat = st.rotLat;

        for (let i = 0; i < dots.length; i++) {
          const d = dots[i];
          const p = rotateAndProject(d.x, d.y, d.z, rotLon, rotLat);

          // Skip deep back-hemisphere dots for clarity and speed
          if (p.rz < -0.18) continue;

          const sx = cx + p.rx * globeRadius;
          const sy = cy - p.ry * globeRadius;

          if (p.rz >= 0) {
            // Front hemisphere: land dots distinctly brighter than ocean dots
            const depthAlpha = 0.25 + 0.75 * p.rz;
            if (d.isLand) {
              ctx.fillStyle = isDark
                ? `rgba(233, 238, 244, ${(0.72 * depthAlpha).toFixed(2)})`
                : `rgba(17, 23, 30, ${(0.68 * depthAlpha).toFixed(2)})`;
              ctx.fillRect(sx - 1.05, sy - 1.05, 2.1, 2.1);
            } else {
              ctx.fillStyle = isDark
                ? `rgba(125, 137, 150, ${(0.22 * depthAlpha).toFixed(2)})`
                : `rgba(93, 104, 116, ${(0.22 * depthAlpha).toFixed(2)})`;
              ctx.fillRect(sx - 0.65, sy - 0.65, 1.3, 1.3);
            }
          } else {
            // Subtle horizon wrap dots
            if (d.isLand) {
              ctx.fillStyle = isDark ? 'rgba(125, 137, 150, 0.11)' : 'rgba(93, 104, 116, 0.11)';
              ctx.fillRect(sx - 0.6, sy - 0.6, 1.2, 1.2);
            }
          }
        }

        // Accent color for arcs based on verdict or gold default
        const goldHex = isDark ? '#e6b84a' : '#9a6a00';
        const arcAccentRgb =
          selectedVerdict === 'BULLISH'
            ? isDark
              ? '52, 211, 153'
              : '12, 138, 93'
            : selectedVerdict === 'BEARISH'
            ? isDark
              ? '244, 114, 124'
              : '194, 58, 70'
            : isDark
            ? '230, 184, 74'
            : '154, 106, 0';

        const isNewsClose =
          (minutesUntilNext !== null && minutesUntilNext >= -5 && minutesUntilNext <= 90) ||
          nowMs < st.pulseBoostUntil;

        // Draw 3D elevated arcs from Washington to the 7 key cities
        const arcSegments = 28;
        for (let cIdx = 0; cIdx < cityArcs.length; cIdx++) {
          const { city, targetVec, speedOffset } = cityArcs[cIdx];
          const isDubai = Boolean(city.isUserHub);
          const pts: Array<{ x: number; y: number; z: number }> = [];

          for (let s = 0; s <= arcSegments; s++) {
            const t = s / arcSegments;
            const [ux, uy, uz] = slerpVec3(sourceVec, targetVec, t);
            // Parabolic altitude lift above sphere surface
            const lift = 1 + Math.sin(t * Math.PI) * (isDubai ? 0.24 : 0.19);
            const proj = rotateAndProject(ux * lift, uy * lift, uz * lift, rotLon, rotLat);
            pts.push({
              x: cx + proj.rx * globeRadius,
              y: cy - proj.ry * globeRadius,
              z: proj.rz,
            });
          }

          // Draw arc path segments that are above the horizon
          ctx.beginPath();
          let started = false;
          let visibleCount = 0;
          for (let s = 0; s < pts.length; s++) {
            const pt = pts[s];
            if (pt.z > -0.15) {
              visibleCount++;
              if (!started) {
                ctx.moveTo(pt.x, pt.y);
                started = true;
              } else {
                ctx.lineTo(pt.x, pt.y);
              }
            } else {
              started = false;
            }
          }

          if (visibleCount > 2) {
            ctx.lineWidth = isDubai ? 1.65 : 1.15;
            ctx.strokeStyle = `rgba(${arcAccentRgb}, ${isDubai ? 0.72 : 0.42})`;
            ctx.stroke();

            // Travelling pulse packet along the arc
            if (!reducedMotion && !isOffline) {
              const packetT = (st.phase + speedOffset) % 1;
              const pIdx = Math.min(arcSegments, Math.floor(packetT * arcSegments));
              const packetPt = pts[pIdx];
              if (packetPt && packetPt.z > -0.05) {
                ctx.beginPath();
                ctx.arc(packetPt.x, packetPt.y, isDubai ? 2.6 : 2.0, 0, Math.PI * 2);
                ctx.fillStyle = isDark ? '#e9eef4' : '#11171e';
                ctx.fill();
              }
            }
          }

          // Draw destination city marker if on front hemisphere
          const destProj = rotateAndProject(
            targetVec[0],
            targetVec[1],
            targetVec[2],
            rotLon,
            rotLat
          );
          if (destProj.rz > 0.02) {
            const dx = cx + destProj.rx * globeRadius;
            const dy = cy - destProj.ry * globeRadius;

            ctx.beginPath();
            ctx.arc(dx, dy, isDubai ? 3.2 : 2.2, 0, Math.PI * 2);
            ctx.fillStyle = isDubai ? goldHex : `rgba(${arcAccentRgb}, 0.9)`;
            ctx.fill();

            if (isDubai) {
              ctx.beginPath();
              ctx.arc(dx, dy, 6.2, 0, Math.PI * 2);
              ctx.lineWidth = 1;
              ctx.strokeStyle = `rgba(${arcAccentRgb}, 0.55)`;
              ctx.stroke();
            }

            if (destProj.rz > 0.18) {
              ctx.font = '600 9px "JetBrains Mono", monospace';
              ctx.fillStyle = isDubai
                ? goldHex
                : isDark
                ? 'rgba(233, 238, 244, 0.78)'
                : 'rgba(17, 23, 30, 0.78)';
              ctx.fillText(city.name, dx + 6, dy + 3);
            }
          }
        }

        // Draw Washington DC (news source) + pulse ripples when next news is close or boosted
        const srcProj = rotateAndProject(sourceVec[0], sourceVec[1], sourceVec[2], rotLon, rotLat);
        if (srcProj.rz > -0.05) {
          const sx = cx + srcProj.rx * globeRadius;
          const sy = cy - srcProj.ry * globeRadius;

          if (isNewsClose && !reducedMotion) {
            for (let r = 0; r < 3; r++) {
              const ripplePhase = (st.phase * 1.4 + r * 0.33) % 1;
              const radius = 4 + ripplePhase * 22;
              const alpha = (1 - ripplePhase) * (nowMs < st.pulseBoostUntil ? 0.85 : 0.55);
              ctx.beginPath();
              ctx.arc(sx, sy, radius, 0, Math.PI * 2);
              ctx.lineWidth = 1.25;
              ctx.strokeStyle = `rgba(${arcAccentRgb}, ${alpha.toFixed(2)})`;
              ctx.stroke();
            }
          } else {
            ctx.beginPath();
            ctx.arc(sx, sy, 6.5, 0, Math.PI * 2);
            ctx.lineWidth = 1;
            ctx.strokeStyle = `rgba(${arcAccentRgb}, 0.45)`;
            ctx.stroke();
          }

          ctx.beginPath();
          ctx.arc(sx, sy, 3.4, 0, Math.PI * 2);
          ctx.fillStyle = goldHex;
          ctx.fill();

          if (srcProj.rz > 0.12) {
            ctx.font = '700 9px "JetBrains Mono", monospace';
            ctx.fillStyle = goldHex;
            ctx.fillText('WASHINGTON · SOURCE', sx + 7, sy - 4);
          }
        }

        ctx.restore();
      };

      const loop = (nowMs: number) => {
        const st = stateRef.current;
        if (!st.isTabHidden && st.isVisibleOnScreen) {
          drawFrame(nowMs);
        }
        if (!reducedMotion) {
          rafId = requestAnimationFrame(loop);
        }
      };

      // Always draw initial frame immediately
      drawFrame(performance.now());
      if (!reducedMotion) {
        rafId = requestAnimationFrame(loop);
      }

      return () => {
        if (rafId) cancelAnimationFrame(rafId);
        resizeObserver?.disconnect();
        intersectionObserver?.disconnect();
        document.removeEventListener('visibilitychange', onVisibilityChange);
      };
    }, [theme, reducedMotion, minutesUntilNext, selectedVerdict, isOffline]);

    // Pointer drag handlers for interactive rotation with inertia
    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const st = stateRef.current;
      st.isDragging = true;
      st.lastPointerX = e.clientX;
      st.lastPointerY = e.clientY;
      st.velLon = 0;
      st.velLat = 0;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const st = stateRef.current;
      if (!st.isDragging) return;
      const dx = e.clientX - st.lastPointerX;
      const dy = e.clientY - st.lastPointerY;
      st.lastPointerX = e.clientX;
      st.lastPointerY = e.clientY;

      const dLon = dx * 0.0065;
      const dLat = dy * 0.0055;
      st.rotLon += dLon;
      st.rotLat = Math.max(-0.78, Math.min(0.78, st.rotLat + dLat));
      st.velLon = dLon * 0.45;
      st.velLat = dLat * 0.45;
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
      stateRef.current.isDragging = false;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    };

    const isDark = theme === 'dark';
    const hudTitle = selectedEventTitle || nextNewsTitle || 'USD Macro Feed';
    const showNextCatalystLabel = Boolean(isSelectedNextUpcoming && !hudIsReleased);
    const hudLabelPrefix = showNextCatalystLabel ? 'NEXT CATALYST' : 'SELECTED';

    return (
      <div
        ref={containerRef}
        className="relative w-full h-[300px] sm:h-[330px] rounded-2xl overflow-hidden select-none border transition-colors"
        style={{
          backgroundColor: isDark ? '#0e1218' : '#ffffff',
          borderColor: isDark ? '#1a212b' : '#dfe4ea',
        }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="w-full h-full block cursor-grab active:cursor-grabbing touch-none"
          aria-label={`3D rotating macro news globe showing arcs from Washington to London, Dubai, Mumbai, Singapore, Hong Kong, Tokyo, and Sydney. ${hudLabelPrefix}: ${hudTitle} ${hudCountdown}`}
        />

        {/* Top-left HUD: Event Name & Consistent Timer */}
        <div className="pointer-events-none absolute top-3.5 left-4 right-4 flex items-start justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <div
              className="font-mono text-[10px] uppercase tracking-[0.14em]"
              style={{ color: isDark ? '#7d8996' : '#5d6874' }}
            >
              {hudLabelPrefix} · WASHINGTON → DUBAI
            </div>
            <div
              className="text-xs sm:text-sm font-semibold truncate font-['Sora']"
              style={{ color: isDark ? '#e9eef4' : '#11171e' }}
            >
              {hudTitle}
            </div>
          </div>

          <div
            className="shrink-0 px-2.5 py-1 rounded-md border font-mono text-xs font-medium tracking-wider"
            style={{
              backgroundColor: isDark ? 'rgba(7, 9, 12, 0.78)' : 'rgba(243, 245, 247, 0.88)',
              borderColor: isDark ? '#1a212b' : '#dfe4ea',
              color: hudIsReleased
                ? isDark
                  ? '#7d8996'
                  : '#5d6874'
                : isDark
                ? '#e6b84a'
                : '#9a6a00',
            }}
          >
            {hudCountdown}
          </div>
        </div>

        {/* Bottom HUD subtle corridor legend */}
        <div className="pointer-events-none absolute bottom-3 left-4 right-4 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.14em]">
          <span style={{ color: isDark ? '#7d8996' : '#5d6874' }}>
            DRAG TO ROTATE · {DOT_COUNT} LATTICE NODES
          </span>
          <span style={{ color: isDark ? '#e6b84a' : '#9a6a00' }}>
            DUBAI HUB (UTC+4)
          </span>
        </div>
      </div>
    );
  }
);
