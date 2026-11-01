import React, { useEffect, useState } from 'react';
import { useRedSniperFeed } from './feed';

export interface FirestoreOpsReport {
  readsToday: number;
  writesToday: number;
  totalReads: number;
  totalWrites: number;
  maxReadsPerDay: number;
  readLimitExceeded: boolean;
  cacheHits: number;
  lastHourlyLogIso: string;
}

export interface RedSniperHealthData {
  ok: boolean;
  backend?: 'firestore' | 'sqlite';
  persistent?: boolean;
  isKService?: boolean;
  instanceUptimeSeconds?: number;
  gaps?: Array<{
    from: number;
    to: number;
    fromIso: string;
    toIso: string;
    durationMinutes: number;
    formatted: string;
    reason: string;
  }>;
  storedRowsPerTf: Record<string, number>;
  totalRows: number;
  oldestCandleTime: number | null;
  oldestCandleIso: string | null;
  newestCandleTime: number | null;
  newestCandleIso: string | null;
  lastWriteTime: number | null;
  lastWriteIso: string | null;
  dbSource: string;
  botLogCount: number;
  firestoreOps?: FirestoreOpsReport;
  readLimitExceeded?: boolean;
}

export const RedSniperDebugPanel: React.FC = () => {
  const {
    bars,
    livePrice,
    bid,
    ask,
    spread,
    lastTickTime,
    connectionStatus,
    isMarketClosed,
    session,
  } = useRedSniperFeed();

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [health, setHealth] = useState<RedSniperHealthData | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchHealth = () => {
      fetch('/api/redsniper/health', { credentials: 'include' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!cancelled && data && data.ok) {
            setHealth(data);
          }
        })
        .catch(() => {});
    };
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const m1Bars = bars['1m'];
  const currentM1 = m1Bars && m1Bars.length > 0 ? m1Bars[m1Bars.length - 1] : null;

  const statusText = isMarketClosed
    ? `${connectionStatus} (MARKET CLOSED)`
    : connectionStatus || 'NO DATA';

  const priceText =
    typeof livePrice === 'number' && Number.isFinite(livePrice) && livePrice > 0
      ? livePrice.toFixed(2)
      : 'NO DATA';

  const tickAgeText =
    typeof lastTickTime === 'number' && lastTickTime > 0
      ? `${Math.max(0, (nowMs - lastTickTime) / 1000).toFixed(1)}s`
      : 'NO DATA';

  const m1TickVolText =
    currentM1 && typeof currentM1.tickVolume === 'number'
      ? String(currentM1.tickVolume)
      : 'NO DATA';

  const totalFlow = currentM1 ? currentM1.buyVol + currentM1.sellVol : 0;
  const buySellPctText =
    currentM1 && totalFlow > 0
      ? `${Math.round((currentM1.buyVol / totalFlow) * 100)}% / ${Math.round(
          (currentM1.sellVol / totalFlow) * 100
        )}% (est.)`
      : 'NO DATA';

  const spreadText =
    typeof spread === 'number' && Number.isFinite(spread)
      ? `${spread.toFixed(2)} (${bid?.toFixed(2) ?? 'NO DATA'} / ${ask?.toFixed(2) ?? 'NO DATA'})`
      : 'NO DATA';

  return (
    <div className="rounded-lg border border-red-500/30 bg-black/95 p-3.5 font-mono text-xs text-slate-200 shadow-xl">
      {/* STORAGE PERSISTENCE WARNING (Firestore fallback or ephemeral container) */}
      {health && health.persistent === false && (
        <div className="mb-2.5 flex items-center gap-2 rounded border border-red-500 bg-red-600/30 px-3 py-1.5 font-bold text-red-200 shadow-sm animate-pulse">
          <span className="text-base">⚠️</span>
          <span>STORAGE NOT PERSISTENT - history will reset</span>
        </div>
      )}

      {/* FIRESTORE READ LIMIT EXCEEDED WARNING */}
      {health && health.readLimitExceeded && (
        <div className="mb-2.5 flex items-center gap-2 rounded border border-amber-500 bg-amber-600/30 px-3 py-1.5 font-bold text-amber-200 shadow-sm">
          <span className="text-base">⚠️</span>
          <span>
            FIRESTORE READ LIMIT EXCEEDED ({health.firestoreOps?.readsToday || 0}/{health.firestoreOps?.maxReadsPerDay || 20000}) - Serving strictly from in-memory cache
          </span>
        </div>
      )}

      <div className="mb-2.5 flex flex-wrap items-center justify-between border-b border-red-500/20 pb-2">
        <div className="flex items-center gap-2">
          <span className="font-extrabold tracking-wider text-[#ff2d45]">
            RED SNIPER STORE &amp; ENGINE TELEMETRY
          </span>
          {health?.ok && (
            <span
              className={`border px-1.5 py-0.2 text-[9px] font-bold ${
                health.backend === 'firestore'
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'
                  : health.persistent
                  ? 'border-blue-500/50 bg-blue-500/15 text-blue-400'
                  : 'border-amber-500/50 bg-amber-500/15 text-amber-400'
              }`}
            >
              {health.backend === 'firestore'
                ? 'FIRESTORE PERSISTENT'
                : `SQLITE (${health.persistent ? 'PERSISTENT' : 'EPHEMERAL'})`}
            </span>
          )}
        </div>
        <span className="text-[11px] text-slate-400">
          {session.name} · {session.window}
        </span>
      </div>

      {/* Live Feed Status */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        <div>
          <span className="text-slate-500">FEED: </span>
          <span className="font-semibold text-slate-100">{statusText}</span>
        </div>
        <div>
          <span className="text-slate-500">PRICE: </span>
          <span className="font-semibold text-amber-400">{priceText}</span>
        </div>
        <div>
          <span className="text-slate-500">LAST TICK AGE: </span>
          <span className="font-semibold text-slate-100">{tickAgeText}</span>
        </div>
        <div>
          <span className="text-slate-500">M1 TICK VOL: </span>
          <span className="font-semibold text-cyan-400">{m1TickVolText}</span>
        </div>
        <div>
          <span className="text-slate-500">BUY%/SELL% (est.): </span>
          <span className="font-semibold text-emerald-400">{buySellPctText}</span>
        </div>
        <div>
          <span className="text-slate-500">SPREAD: </span>
          <span className="font-semibold text-slate-300">{spreadText}</span>
        </div>
      </div>

      {/* Stored Candles & Health Telemetry */}
      {health && (
        <div className="mt-3 border-t border-white/10 pt-2.5">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="font-bold text-neutral-300 uppercase">
              STORED CANDLES ({health.backend || 'STORE'})
            </span>
            <span className="text-neutral-400">
              TOTAL: <strong className="text-white">{health.totalRows}</strong> ROWS · BOT LOG:{' '}
              <strong className="text-white">{health.botLogCount}</strong>
              {health.instanceUptimeSeconds !== undefined && (
                <span> · UPTIME: <strong className="text-white">{health.instanceUptimeSeconds}s</strong></span>
              )}
            </span>
          </div>

          {health.firestoreOps && (
            <div className="mb-2 flex flex-wrap items-center justify-between rounded border border-emerald-500/20 bg-emerald-950/20 px-2 py-1 text-[10px] text-emerald-300">
              <span className="font-bold">FIRESTORE OPS:</span>
              <span>
                R: <strong className="text-white">{health.firestoreOps.readsToday}</strong>/{health.firestoreOps.maxReadsPerDay} ·
                W: <strong className="text-white">{health.firestoreOps.writesToday}</strong> ·
                CACHE HITS: <strong className="text-white">{health.firestoreOps.cacheHits}</strong>
              </span>
            </div>
          )}

          <div className="grid grid-cols-4 gap-1.5 text-[10px] sm:grid-cols-8">
            {Object.entries(health.storedRowsPerTf || {}).map(([tfKey, count]) => (
              <div
                key={tfKey}
                className="border border-white/10 bg-black/60 px-2 py-1 text-center"
              >
                <div className="text-neutral-500 uppercase">{tfKey}</div>
                <div className="font-bold text-neutral-200">{count}</div>
              </div>
            ))}
          </div>

          {/* Detected Holes / Gaps */}
          {health.gaps && health.gaps.length > 0 && (
            <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] text-amber-300">
              <div className="font-semibold text-amber-200">DETECTED GAPS:</div>
              <ul className="mt-0.5 list-inside list-disc space-y-0.5">
                {health.gaps.map((g, idx) => (
                  <li key={idx} className="font-mono">
                    {g.formatted} ({g.fromIso.slice(11, 16)} → {g.toIso.slice(11, 16)} UTC)
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-neutral-400">
            <div>
              <span>OLDEST: </span>
              <span className="font-semibold text-neutral-200">
                {health.oldestCandleIso ? health.oldestCandleIso.replace('T', ' ').slice(0, 19) + ' UTC' : 'none'}
              </span>
            </div>
            <div>
              <span>NEWEST: </span>
              <span className="font-semibold text-neutral-200">
                {health.newestCandleIso ? health.newestCandleIso.replace('T', ' ').slice(0, 19) + ' UTC' : 'none'}
              </span>
            </div>
            <div>
              <span>LAST WRITE: </span>
              <span className="font-semibold text-neutral-200">
                {health.lastWriteIso ? health.lastWriteIso.replace('T', ' ').slice(11, 19) + ' UTC' : 'none'}
              </span>
            </div>
            <div className="truncate text-[9.5px] text-neutral-500" title={health.dbSource}>
              SOURCE: {health.dbSource}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RedSniperDebugPanel;
