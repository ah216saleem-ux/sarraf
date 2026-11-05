import React, { useEffect, useMemo, useState } from 'react';
import {
  REQUIRED_MIN_BARS_BY_TF,
  RedSniperTimeframe,
  useRedSniperFeed,
} from './feed';
import {
  DEFAULT_RED_SNIPER_SETTINGS,
  INDICATOR_PARITY_SHIFT,
  RedSniperSettings,
  TimeframeAnalysis,
  ZoneComparisonReport,
  analyzeAllTimeframes,
  compareZonesWithReference,
  setIndicatorParityShift,
} from './engine';

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

export interface RedSniperDebugPanelProps {
  byTf?: Record<RedSniperTimeframe, TimeframeAnalysis>;
  settings?: RedSniperSettings;
  selectedTf?: RedSniperTimeframe;
  onUpdateSettings?: (patch: Partial<RedSniperSettings>) => void;
}

const DIAG_TFS: RedSniperTimeframe[] = ['5m', '15m', '30m', '1h', '4h', '1d'];

function parsePriceList(raw: string): number[] {
  if (!raw || !raw.trim()) return [];
  const matches = raw.match(/-?\d+(?:\.\d+)?/g);
  if (!matches) return [];
  return matches
    .map((m) => Number(m))
    .filter((n) => Number.isFinite(n) && n > 100);
}

export const RedSniperDebugPanel: React.FC<RedSniperDebugPanelProps> = ({
  byTf: propByTf,
  settings = DEFAULT_RED_SNIPER_SETTINGS,
  selectedTf = '15m',
  onUpdateSettings,
}) => {
  const {
    bars,
    historyDiagnostics,
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
  const [parityShiftState, setParityShiftState] = useState<boolean>(
    INDICATOR_PARITY_SHIFT
  );

  // Compare Zones tool state
  const [compareOpen, setCompareOpen] = useState<boolean>(true);
  const [compareTf, setCompareTf] = useState<RedSniperTimeframe>(selectedTf);
  const [expectedSellInput, setExpectedSellInput] = useState<string>(
    '4312, 4294, 4210, 4188, 4133'
  );
  const [expectedBuyInput, setExpectedBuyInput] = useState<string>(
    '4055, 4030, 3930, 3891'
  );
  const [compareTolerance, setCompareTolerance] = useState<number>(3);

  useEffect(() => {
    setCompareTf(selectedTf);
  }, [selectedTf]);

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

  const computedByTf = useMemo(() => {
    if (propByTf) return propByTf;
    return analyzeAllTimeframes(bars, livePrice, settings).byTf;
  }, [propByTf, bars, livePrice, settings, parityShiftState]);

  const compareReport = useMemo((): {
    sellReport: ZoneComparisonReport;
    buyReport: ZoneComparisonReport;
  } => {
    const tfZones = computedByTf[compareTf]?.zones || [];
    const sellPrices = parsePriceList(expectedSellInput);
    const buyPrices = parsePriceList(expectedBuyInput);
    const sellReport = compareZonesWithReference(
      tfZones,
      sellPrices,
      'SELL',
      compareTolerance,
      compareTf
    );
    const buyReport = compareZonesWithReference(
      tfZones,
      buyPrices,
      'BUY',
      compareTolerance,
      compareTf
    );
    return { sellReport, buyReport };
  }, [
    computedByTf,
    compareTf,
    expectedSellInput,
    expectedBuyInput,
    compareTolerance,
  ]);

  const handleToggleParityShift = () => {
    const next = !parityShiftState;
    setIndicatorParityShift(next);
    setParityShiftState(next);
    if (onUpdateSettings) {
      onUpdateSettings({});
    }
  };

  const m1Bars = bars['1m'];
  const currentM1 =
    m1Bars && m1Bars.length > 0 ? m1Bars[m1Bars.length - 1] : null;

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
      ? `${spread.toFixed(2)} (${bid?.toFixed(2) ?? 'NO DATA'} / ${
          ask?.toFixed(2) ?? 'NO DATA'
        })`
      : 'NO DATA';

  return (
    <div className="rounded-lg border border-red-500/30 bg-black/95 p-3.5 font-mono text-xs text-slate-200 shadow-xl">
      {/* STORAGE PERSISTENCE WARNING */}
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
            FIRESTORE READ LIMIT EXCEEDED (
            {health.firestoreOps?.readsToday || 0}/
            {health.firestoreOps?.maxReadsPerDay || 20000}) - Serving strictly
            from in-memory cache
          </span>
        </div>
      )}

      <div className="mb-2.5 flex flex-wrap items-center justify-between border-b border-red-500/20 pb-2">
        <div className="flex items-center gap-2">
          <span className="font-extrabold tracking-wider text-[#ff2d45]">
            RED SNIPER DIAGNOSTICS &amp; HISTORY DEPTH
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleParityShift}
            className="cursor-pointer rounded border border-amber-500/50 bg-amber-950/30 px-2 py-0.5 text-[10px] font-bold text-amber-300"
            title="Toggle INDICATOR_PARITY_SHIFT (candle E = extremeIdx - 1 vs extremeIdx)"
          >
            PARITY SHIFT: {parityShiftState ? 'ON (E-1)' : 'OFF (E)'}
          </button>
          <span className="text-[11px] text-slate-400">
            {session.name} · {session.window}
          </span>
        </div>
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
          <span className="font-semibold text-emerald-400">
            {buySellPctText}
          </span>
        </div>
        <div>
          <span className="text-slate-500">SPREAD: </span>
          <span className="font-semibold text-slate-300">{spreadText}</span>
        </div>
      </div>

      {/* Phase 4 Item 1: HISTORY DEPTH (barsLoaded per TF vs Required Minimums) + BUY/SELL zone counts */}
      <div className="mt-3 border-t border-white/10 pt-2.5">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <span className="font-bold text-amber-400 uppercase">
            BARS LOADED PER TIMEFRAME (REQUIRED DEPTH &amp; ACTIVE ZONES)
          </span>
          <span className="text-[10px] text-neutral-400">
            ZONES/SIDE: <strong className="text-white">{settings.zonesPerSide ?? 5}</strong> · HIDE CONSUMED:{' '}
            <strong className="text-white">{settings.hideConsumed ? 'TRUE' : 'FALSE'}</strong>
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1.5 text-[10px] sm:grid-cols-3">
          {DIAG_TFS.map((tf) => {
            const loaded = bars[tf]?.length ?? 0;
            const reqMin = REQUIRED_MIN_BARS_BY_TF[tf];
            const isShort = loaded < reqMin;
            const diag = historyDiagnostics[tf];
            const tfAnal = computedByTf[tf];
            const buyCount =
              tfAnal?.zones.filter((z) => z.side === 'BUY').length ?? 0;
            const sellCount =
              tfAnal?.zones.filter((z) => z.side === 'SELL').length ?? 0;

            return (
              <div
                key={tf}
                className={`rounded border px-2.5 py-1.5 ${
                  isShort
                    ? 'border-amber-500/50 bg-amber-950/20'
                    : 'border-emerald-500/35 bg-black/70'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white uppercase">{tf}</span>
                  <span
                    className={`rounded px-1.5 py-0.2 text-[9px] font-bold ${
                      isShort
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {isShort ? `HISTORY SHORT (${loaded} bars)` : 'DEPTH OK'}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px]">
                  <span className="text-neutral-400">
                    barsLoaded:{' '}
                    <strong className="text-white">{loaded}</strong> / {reqMin}
                  </span>
                  <span className="text-neutral-400">
                    {diag?.builtFromM1 ? 'M1-FALLBACK' : diag?.source || 'store'}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between text-[10px]">
                  <span>
                    <span className="text-emerald-400 font-bold">
                      BUY {buyCount}
                    </span>{' '}
                    ·{' '}
                    <span className="text-rose-400 font-bold">
                      SELL {sellCount}
                    </span>
                  </span>
                  <span className="text-neutral-500">
                    {bars[tf]?.[0]
                      ? new Date(bars[tf][0].time * 1000)
                          .toISOString()
                          .slice(0, 10)
                      : '--'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Phase 4 Item 9: COMPARE ZONES DEBUG TOOL */}
      <div className="mt-3 border-t border-white/10 pt-2.5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCompareOpen((v) => !v)}
              className="cursor-pointer rounded border border-[#d9ac4a]/60 bg-[#7a1422]/60 px-2.5 py-1 text-[10px] font-bold text-[#d9ac4a]"
            >
              {compareOpen ? '▼ COMPARE ZONES' : '▶ COMPARE ZONES'}
            </button>
            <span className="text-[10px] text-neutral-400">
              Match detected zones within ±{compareTolerance} pts
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {DIAG_TFS.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setCompareTf(tf)}
                className={`cursor-pointer rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                  compareTf === tf
                    ? 'border border-[#d83a4c] bg-[#7a1422] text-white'
                    : 'border border-white/15 bg-black text-neutral-400'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        {compareOpen && (
          <div className="space-y-2 rounded border border-white/15 bg-black/75 p-2.5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold text-rose-400">
                  EXPECTED {compareTf.toUpperCase()} SELL ZONES (comma/space separated):
                </span>
                <input
                  type="text"
                  value={expectedSellInput}
                  onChange={(e) => setExpectedSellInput(e.target.value)}
                  placeholder="e.g. 4312, 4294, 4210, 4188, 4133"
                  className="rounded border border-rose-500/40 bg-black px-2 py-1 text-[11px] text-white outline-none focus:border-rose-400"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold text-emerald-400">
                  EXPECTED {compareTf.toUpperCase()} BUY ZONES (comma/space separated):
                </span>
                <input
                  type="text"
                  value={expectedBuyInput}
                  onChange={(e) => setExpectedBuyInput(e.target.value)}
                  placeholder="e.g. 4055, 4030, 3930, 3891"
                  className="rounded border border-emerald-500/40 bg-black px-2 py-1 text-[11px] text-white outline-none focus:border-emerald-400"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCompareTf('15m');
                    setExpectedSellInput('4312, 4294, 4210, 4188, 4133');
                    setExpectedBuyInput('4055, 4030, 3930, 3891');
                    setCompareTolerance(3);
                  }}
                  className="cursor-pointer rounded border border-white/20 bg-white/5 px-2 py-0.5 text-[9.5px] font-semibold text-neutral-300 hover:text-white"
                >
                  LOAD 15M PRESET
                </button>
                <span className="text-neutral-400">
                  Active {compareTf.toUpperCase()} zones:{' '}
                  <strong className="text-white">
                    {(computedByTf[compareTf]?.zones || [])
                      .map(
                        (z) =>
                          `${z.side} ${z.bottom.toFixed(1)}–${z.top.toFixed(1)}`
                      )
                      .join(' | ') || 'none'}
                  </strong>
                </span>
              </div>
            </div>

            {/* Comparison Results */}
            <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
              {/* SELL Report */}
              <div className="rounded border border-rose-500/30 bg-rose-950/15 p-2">
                <div className="flex items-center justify-between text-[10.5px] font-bold text-rose-300">
                  <span>SELL MATCH REPORT ({compareTf.toUpperCase()})</span>
                  <span>
                    MATCHED {compareReport.sellReport.matchedCount} /{' '}
                    {compareReport.sellReport.expectedCount} (MISSING{' '}
                    {compareReport.sellReport.missingCount})
                  </span>
                </div>
                <div className="mt-1.5 space-y-1 text-[10px]">
                  {compareReport.sellReport.matches.map((m, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-2"
                    >
                      <span
                        className={
                          m.matched ? 'text-emerald-300' : 'text-rose-400'
                        }
                      >
                        {m.matched ? '✓' : '✗'} Exp {m.expectedPrice.toFixed(1)}
                      </span>
                      <span className="text-neutral-300">
                        {m.matchedZone
                          ? `${m.matchedZone.bottom.toFixed(
                              2
                            )}–${m.matchedZone.top.toFixed(2)} (Δ ${
                              m.distancePts?.toFixed(2) ?? '0'
                            } pts · ${
                              m.matchedZone.choch ? 'CHoCH' : 'BOS'
                            })`
                          : m.distancePts !== null
                          ? `MISSING (nearest Δ ${m.distancePts.toFixed(1)} pts)`
                          : 'MISSING (no SELL zones)'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* BUY Report */}
              <div className="rounded border border-emerald-500/30 bg-emerald-950/15 p-2">
                <div className="flex items-center justify-between text-[10.5px] font-bold text-emerald-300">
                  <span>BUY MATCH REPORT ({compareTf.toUpperCase()})</span>
                  <span>
                    MATCHED {compareReport.buyReport.matchedCount} /{' '}
                    {compareReport.buyReport.expectedCount} (MISSING{' '}
                    {compareReport.buyReport.missingCount})
                  </span>
                </div>
                <div className="mt-1.5 space-y-1 text-[10px]">
                  {compareReport.buyReport.matches.map((m, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-2"
                    >
                      <span
                        className={
                          m.matched ? 'text-emerald-300' : 'text-rose-400'
                        }
                      >
                        {m.matched ? '✓' : '✗'} Exp {m.expectedPrice.toFixed(1)}
                      </span>
                      <span className="text-neutral-300">
                        {m.matchedZone
                          ? `${m.matchedZone.bottom.toFixed(
                              2
                            )}–${m.matchedZone.top.toFixed(2)} (Δ ${
                              m.distancePts?.toFixed(2) ?? '0'
                            } pts · ${
                              m.matchedZone.choch ? 'CHoCH' : 'BOS'
                            })`
                          : m.distancePts !== null
                          ? `MISSING (nearest Δ ${m.distancePts.toFixed(1)} pts)`
                          : 'MISSING (no BUY zones)'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Stored Candles & Health Telemetry */}
      {health && (
        <div className="mt-3 border-t border-white/10 pt-2.5">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="font-bold text-neutral-300 uppercase">
              STORED CANDLES ({health.backend || 'STORE'})
            </span>
            <span className="text-neutral-400">
              TOTAL: <strong className="text-white">{health.totalRows}</strong>{' '}
              ROWS · BOT LOG:{' '}
              <strong className="text-white">{health.botLogCount}</strong>
              {health.instanceUptimeSeconds !== undefined && (
                <span>
                  {' '}
                  · UPTIME:{' '}
                  <strong className="text-white">
                    {health.instanceUptimeSeconds}s
                  </strong>
                </span>
              )}
            </span>
          </div>

          {health.firestoreOps && (
            <div className="mb-2 flex flex-wrap items-center justify-between rounded border border-emerald-500/20 bg-emerald-950/20 px-2 py-1 text-[10px] text-emerald-300">
              <span className="font-bold">FIRESTORE OPS:</span>
              <span>
                R:{' '}
                <strong className="text-white">
                  {health.firestoreOps.readsToday}
                </strong>
                /{health.firestoreOps.maxReadsPerDay} · W:{' '}
                <strong className="text-white">
                  {health.firestoreOps.writesToday}
                </strong>{' '}
                · CACHE HITS:{' '}
                <strong className="text-white">
                  {health.firestoreOps.cacheHits}
                </strong>
              </span>
            </div>
          )}

          <div className="grid grid-cols-4 gap-1.5 text-[10px] sm:grid-cols-8">
            {Object.entries(health.storedRowsPerTf || {}).map(
              ([tfKey, count]) => (
                <div
                  key={tfKey}
                  className="border border-white/10 bg-black/60 px-2 py-1 text-center"
                >
                  <div className="text-neutral-500 uppercase">{tfKey}</div>
                  <div className="font-bold text-neutral-200">{count}</div>
                </div>
              )
            )}
          </div>

          {health.gaps && health.gaps.length > 0 && (
            <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] text-amber-300">
              <div className="font-semibold text-amber-200">DETECTED GAPS:</div>
              <ul className="mt-0.5 list-inside list-disc space-y-0.5">
                {health.gaps.map((g, idx) => (
                  <li key={idx} className="font-mono">
                    {g.formatted} ({g.fromIso.slice(11, 16)} →{' '}
                    {g.toIso.slice(11, 16)} UTC)
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-neutral-400">
            <div>
              <span>OLDEST: </span>
              <span className="font-semibold text-neutral-200">
                {health.oldestCandleIso
                  ? health.oldestCandleIso.replace('T', ' ').slice(0, 19) +
                    ' UTC'
                  : 'none'}
              </span>
            </div>
            <div>
              <span>NEWEST: </span>
              <span className="font-semibold text-neutral-200">
                {health.newestCandleIso
                  ? health.newestCandleIso.replace('T', ' ').slice(0, 19) +
                    ' UTC'
                  : 'none'}
              </span>
            </div>
            <div>
              <span>LAST WRITE: </span>
              <span className="font-semibold text-neutral-200">
                {health.lastWriteIso
                  ? health.lastWriteIso.replace('T', ' ').slice(11, 19) + ' UTC'
                  : 'none'}
              </span>
            </div>
            <div
              className="truncate text-[9.5px] text-neutral-500"
              title={health.dbSource}
            >
              SOURCE: {health.dbSource}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RedSniperDebugPanel;

