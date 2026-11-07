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
  computeCandleAlignmentCheck,
  computeZoneHeightReport,
  getBackfillBannerViewState,
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

export interface RedSniperBackfillStatusData {
  running: boolean;
  status: 'idle' | 'running' | 'completed' | 'error';
  provider: string;
  progressPct: number;
  completedChunks: number;
  totalChunks: number;
  calibratedOffsetPts: number | null;
  offsetWarning: string | null;
  m1HistBars: number;
  d1HistBars: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface RedSniperHealthData {
  ok: boolean;
  backend?: 'firestore' | 'sqlite';
  persistent?: boolean;
  isKService?: boolean;
  instanceUptimeSeconds?: number;
  dataDirPath?: string;
  dataDirFreeBytes?: number | null;
  dataDirFreeFormatted?: string;
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
  backfill?: RedSniperBackfillStatusData;
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

  // Local diagnostic overrides (synced with settings when onUpdateSettings is provided)
  const [localMaxZoneHeightAtr, setLocalMaxZoneHeightAtr] = useState<number>(
    settings.maxZoneHeightAtr ?? 2.0
  );
  const [localH4Offset, setLocalH4Offset] = useState<number>(
    settings.h4AlignmentOffsetHours ?? 0
  );
  const [localD1UtcHour, setLocalD1UtcHour] = useState<number>(
    settings.dailyAlignmentUtcHour ?? 0
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

  // Phase 6 Item 2: Zone height report tool state
  const [heightReportOpen, setHeightReportOpen] = useState<boolean>(true);
  const [heightReportTf, setHeightReportTf] =
    useState<RedSniperTimeframe>(selectedTf);

  // Phase 6 Item 3: Alignment check tool state
  const [alignmentOpen, setAlignmentOpen] = useState<boolean>(true);

  useEffect(() => {
    setCompareTf(selectedTf);
    setHeightReportTf(selectedTf);
  }, [selectedTf]);

  useEffect(() => {
    if (typeof settings.maxZoneHeightAtr === 'number') {
      setLocalMaxZoneHeightAtr(settings.maxZoneHeightAtr);
    }
    if (typeof settings.h4AlignmentOffsetHours === 'number') {
      setLocalH4Offset(settings.h4AlignmentOffsetHours);
    }
    if (typeof settings.dailyAlignmentUtcHour === 'number') {
      setLocalD1UtcHour(settings.dailyAlignmentUtcHour);
    }
  }, [
    settings.maxZoneHeightAtr,
    settings.h4AlignmentOffsetHours,
    settings.dailyAlignmentUtcHour,
  ]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const [backfillTriggering, setBackfillTriggering] = useState<boolean>(false);
  const [backfillUiError, setBackfillUiError] = useState<string | null>(null);

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
    const interval = setInterval(fetchHealth, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const handleTriggerBackfill = async () => {
    if (backfillTriggering || health?.backfill?.running) return;
    setBackfillTriggering(true);
    setBackfillUiError(null);
    try {
      const res = await fetch('/api/redsniper/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ forceReset: false }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json?.backfill) {
          setHealth((prev) =>
            prev ? { ...prev, backfill: json.backfill } : prev
          );
        }
      } else {
        setBackfillUiError(`HTTP ${res.status} (${res.statusText || 'failed'})`);
      }
    } catch (err: any) {
      setBackfillUiError(err?.message || 'network blocked');
    } finally {
      setBackfillTriggering(false);
    }
  };

  const effectiveSettings = useMemo<RedSniperSettings>(
    () => ({
      ...settings,
      maxZoneHeightAtr: localMaxZoneHeightAtr,
      h4AlignmentOffsetHours: localH4Offset,
      dailyAlignmentUtcHour: localD1UtcHour,
    }),
    [settings, localMaxZoneHeightAtr, localH4Offset, localD1UtcHour]
  );

  const computedByTf = useMemo(() => {
    if (
      propByTf &&
      localMaxZoneHeightAtr === (settings.maxZoneHeightAtr ?? 2.0) &&
      localH4Offset === (settings.h4AlignmentOffsetHours ?? 0) &&
      localD1UtcHour === (settings.dailyAlignmentUtcHour ?? 0)
    ) {
      return propByTf;
    }
    return analyzeAllTimeframes(bars, livePrice, effectiveSettings).byTf;
  }, [
    propByTf,
    bars,
    livePrice,
    settings,
    effectiveSettings,
    parityShiftState,
    localMaxZoneHeightAtr,
    localH4Offset,
    localD1UtcHour,
  ]);

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

  const zoneHeightReport = useMemo(() => {
    const tfBars = bars[heightReportTf] || [];
    return computeZoneHeightReport(
      tfBars,
      heightReportTf,
      effectiveSettings,
      parityShiftState
    );
  }, [bars, heightReportTf, effectiveSettings, parityShiftState]);

  const alignmentReport = useMemo(() => {
    return computeCandleAlignmentCheck(
      bars,
      {
        h4AlignmentOffsetHours: localH4Offset,
        dailyAlignmentUtcHour: localD1UtcHour,
      },
      5
    );
  }, [bars, localH4Offset, localD1UtcHour]);

  const backfillBanner = useMemo(() => {
    const bf = health?.backfill
      ? {
          ...health.backfill,
          error: health.backfill.error || backfillUiError,
        }
      : backfillUiError
      ? { status: 'error' as const, error: backfillUiError, progressPct: 0 }
      : null;
    return getBackfillBannerViewState(bf);
  }, [health?.backfill, backfillUiError]);

  const handleToggleParityShift = () => {
    const next = !parityShiftState;
    setIndicatorParityShift(next);
    setParityShiftState(next);
    if (onUpdateSettings) {
      onUpdateSettings({});
    }
  };

  const handleSelectParityShift = (val: boolean) => {
    setIndicatorParityShift(val);
    setParityShiftState(val);
    if (onUpdateSettings) {
      onUpdateSettings({});
    }
  };

  const handleUpdateMaxZoneHeightAtr = (val: number) => {
    const clamped = Math.max(0, Math.min(10, Number(val.toFixed(2))));
    setLocalMaxZoneHeightAtr(clamped);
    if (onUpdateSettings) {
      onUpdateSettings({ maxZoneHeightAtr: clamped });
    }
  };

  const handleUpdateH4Offset = (val: number) => {
    const clamped = Math.max(-12, Math.min(12, Math.round(val)));
    setLocalH4Offset(clamped);
    if (onUpdateSettings) {
      onUpdateSettings({ h4AlignmentOffsetHours: clamped });
    }
  };

  const handleUpdateD1UtcHour = (val: number) => {
    const clamped = Math.max(-12, Math.min(23, Math.round(val)));
    setLocalD1UtcHour(clamped);
    if (onUpdateSettings) {
      onUpdateSettings({ dailyAlignmentUtcHour: clamped });
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
      {/* PHASE 6 ITEM 1: BACKFILL VISIBILITY BANNER WHEN NOT COMPLETED */}
      {backfillBanner.showBanner && (
        <div
          className={`mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 font-bold shadow-sm ${
            backfillBanner.state === 'FAILED'
              ? 'border-rose-500 bg-rose-950/60 text-rose-200'
              : backfillBanner.state === 'RUNNING'
              ? 'border-amber-500 bg-amber-950/50 text-amber-200 animate-pulse'
              : 'border-cyan-500/60 bg-cyan-950/40 text-cyan-200'
          }`}
        >
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2 text-[11px]">
              <span>
                {backfillBanner.state === 'FAILED'
                  ? '⚠️'
                  : backfillBanner.state === 'RUNNING'
                  ? '⏳'
                  : 'ℹ️'}
              </span>
              <span>{backfillBanner.bannerText}</span>
              {health?.backfill && (
                <span className="text-[10px] font-normal text-neutral-300">
                  ({health.backfill.provider.toUpperCase()} · chunks{' '}
                  {health.backfill.completedChunks}/{health.backfill.totalChunks})
                </span>
              )}
            </div>
            {backfillBanner.providerError && (
              <div className="text-[10px] font-normal text-rose-300">
                PROVIDER ERROR: {backfillBanner.providerError}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handleTriggerBackfill}
            disabled={backfillTriggering || backfillBanner.state === 'RUNNING'}
            className="cursor-pointer rounded border border-cyan-400/70 bg-cyan-900/50 px-2.5 py-1 text-[10px] font-extrabold text-cyan-100 hover:bg-cyan-800/60 disabled:opacity-50"
          >
            {backfillBanner.state === 'RUNNING'
              ? `RUNNING ${backfillBanner.progressPct}%`
              : 'RUN BACKFILL'}
          </button>
        </div>
      )}

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
        <div className="flex flex-wrap items-center gap-2">
          {health?.backfill && (
            <span
              className={`rounded border px-2 py-0.5 text-[10px] font-bold ${
                health.backfill.running
                  ? 'border-amber-500/60 bg-amber-950/40 text-amber-300 animate-pulse'
                  : health.backfill.status === 'completed'
                  ? 'border-emerald-500/50 bg-emerald-950/30 text-emerald-300'
                  : health.backfill.status === 'error'
                  ? 'border-rose-500/60 bg-rose-950/40 text-rose-300'
                  : 'border-white/20 bg-white/5 text-neutral-300'
              }`}
              title={`Provider: ${health.backfill.provider.toUpperCase()} | Chunks: ${health.backfill.completedChunks}/${health.backfill.totalChunks}${
                health.backfill.calibratedOffsetPts !== null
                  ? ` | Calibrated Offset: ${
                      health.backfill.calibratedOffsetPts >= 0 ? '+' : ''
                    }${health.backfill.calibratedOffsetPts.toFixed(2)} pts`
                  : ''
              }`}
            >
              {health.backfill.running
                ? `BACKFILL ${health.backfill.progressPct}%`
                : health.backfill.status === 'completed'
                ? `BACKFILL 100%${
                    health.backfill.calibratedOffsetPts !== null
                      ? ` · Δ ${
                          health.backfill.calibratedOffsetPts >= 0 ? '+' : ''
                        }${health.backfill.calibratedOffsetPts.toFixed(2)}pt`
                      : ''
                  }`
                : `BACKFILL ${health.backfill.progressPct}%`}
            </span>
          )}
          <button
            type="button"
            onClick={handleTriggerBackfill}
            disabled={backfillTriggering || Boolean(health?.backfill?.running)}
            className="cursor-pointer rounded border border-cyan-500/50 bg-cyan-950/30 px-2 py-0.5 text-[10px] font-bold text-cyan-300 disabled:opacity-50"
            title="POST /api/redsniper/backfill (resumable 260d M1 + 1000d D1 backfill)"
          >
            {health?.backfill?.running
              ? `BACKFILL ${health.backfill.progressPct}%`
              : 'RUN BACKFILL'}
          </button>
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

      {/* Live Feed Status & Persistent DATA_DIR Info */}
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
        <div className="col-span-2 sm:col-span-2">
          <span className="text-slate-500">DATA_DIR PATH: </span>
          <span className="font-semibold text-cyan-300">
            {health?.dataDirPath || '/app/data'}
          </span>
        </div>
        <div>
          <span className="text-slate-500">DATA_DIR FREE: </span>
          <span className="font-semibold text-emerald-300">
            {health?.dataDirFreeFormatted || 'N/A'}
          </span>
        </div>
      </div>

      {/* Phase 4 Item 1: HISTORY DEPTH (barsLoaded per TF vs Required Minimums) + BUY/SELL zone counts */}
      <div className="mt-3 border-t border-white/10 pt-2.5">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <span className="font-bold text-amber-400 uppercase">
            BARS LOADED PER TIMEFRAME (REQUIRED DEPTH &amp; ACTIVE ZONES)
          </span>
          <span className="text-[10px] text-neutral-400">
            ZONES/SIDE:{' '}
            <strong className="text-white">{settings.zonesPerSide ?? 5}</strong> ·
            MAX H:{' '}
            <strong className="text-white">
              {localMaxZoneHeightAtr.toFixed(2)}x ATR
            </strong>{' '}
            · HIDE CONSUMED:{' '}
            <strong className="text-white">
              {settings.hideConsumed ? 'TRUE' : 'FALSE'}
            </strong>
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

      {/* PHASE 6 ITEM 2: ZONE HEIGHT REPORT TOOL */}
      <div className="mt-3 border-t border-white/10 pt-2.5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setHeightReportOpen((v) => !v)}
              className="cursor-pointer rounded border border-[#d9ac4a]/60 bg-[#7a1422]/60 px-2.5 py-1 text-[10px] font-bold text-[#d9ac4a]"
            >
              {heightReportOpen
                ? '▼ ZONE HEIGHT REPORT'
                : '▶ ZONE HEIGHT REPORT'}
            </button>
            <span className="text-[10px] text-neutral-400">
              {zoneHeightReport.referenceTargetHint} · ATR14:{' '}
              <strong className="text-white">
                {zoneHeightReport.atr14.toFixed(2)}
              </strong>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {DIAG_TFS.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setHeightReportTf(tf)}
                className={`cursor-pointer rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                  heightReportTf === tf
                    ? 'border border-[#d83a4c] bg-[#7a1422] text-white'
                    : 'border border-white/15 bg-black text-neutral-400'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        {heightReportOpen && (
          <div className="space-y-2 rounded border border-white/15 bg-black/75 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-2 text-[10px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-neutral-400">
                  INDICATOR_PARITY_SHIFT:
                </span>
                <button
                  type="button"
                  onClick={() => handleSelectParityShift(true)}
                  className={`cursor-pointer rounded px-2 py-0.5 font-bold ${
                    parityShiftState
                      ? 'border border-emerald-500/60 bg-emerald-950/40 text-emerald-300'
                      : 'border border-white/15 bg-black text-neutral-400'
                  }`}
                >
                  TRUE (E = extreme - 1)
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectParityShift(false)}
                  className={`cursor-pointer rounded px-2 py-0.5 font-bold ${
                    !parityShiftState
                      ? 'border border-emerald-500/60 bg-emerald-950/40 text-emerald-300'
                      : 'border border-white/15 bg-black text-neutral-400'
                  }`}
                >
                  FALSE (E = extreme)
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5">
                  <span className="text-neutral-400">maxZoneHeightAtr:</span>
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    max="10"
                    value={localMaxZoneHeightAtr}
                    onChange={(e) =>
                      handleUpdateMaxZoneHeightAtr(
                        Number(e.target.value) || 0
                      )
                    }
                    className="w-16 rounded border border-white/25 bg-black px-1.5 py-0.5 text-right text-[10px] font-bold text-amber-300 outline-none focus:border-amber-400"
                  />
                </label>
                <span className="text-neutral-400">
                  AVG SHIFT=TRUE:{' '}
                  <strong className="text-white">
                    {zoneHeightReport.avgHeightShiftTruePts.toFixed(2)} pts
                  </strong>{' '}
                  · AVG SHIFT=FALSE:{' '}
                  <strong className="text-white">
                    {zoneHeightReport.avgHeightShiftFalsePts.toFixed(2)} pts
                  </strong>
                </span>
              </div>
            </div>

            {zoneHeightReport.rows.length === 0 ? (
              <div className="py-2 text-center text-[10px] text-neutral-500">
                No alive zones on {heightReportTf.toUpperCase()}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-[10px]">
                  <thead>
                    <tr className="border-b border-white/15 text-neutral-400">
                      <th className="py-1 pr-2">SIDE</th>
                      <th className="py-1 pr-2">TOP</th>
                      <th className="py-1 pr-2">BOTTOM</th>
                      <th className="py-1 pr-2">HEIGHT (PTS)</th>
                      <th className="py-1 pr-2">HEIGHT (ATR)</th>
                      <th className="py-1 pr-2">SHIFT USED</th>
                      <th className="py-1 pr-2">SHIFT = TRUE (PTS / ATR)</th>
                      <th className="py-1 pr-2">SHIFT = FALSE (PTS / ATR)</th>
                      <th className="py-1">DEBUG</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zoneHeightReport.rows.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b border-white/5 hover:bg-white/5"
                      >
                        <td
                          className={`py-1 pr-2 font-bold ${
                            r.side === 'BUY'
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {r.side}
                        </td>
                        <td className="py-1 pr-2 font-semibold text-white">
                          {r.top.toFixed(2)}
                        </td>
                        <td className="py-1 pr-2 font-semibold text-white">
                          {r.bottom.toFixed(2)}
                        </td>
                        <td className="py-1 pr-2 font-bold text-amber-300">
                          {r.heightPts.toFixed(2)} pts
                        </td>
                        <td className="py-1 pr-2 text-cyan-300">
                          {r.heightAtr.toFixed(2)}x ATR
                        </td>
                        <td className="py-1 pr-2 text-neutral-300">
                          {r.parityShiftUsed ? 'true' : 'false'}
                        </td>
                        <td className="py-1 pr-2 text-neutral-200">
                          {r.shiftTrue.bottom.toFixed(2)}–
                          {r.shiftTrue.top.toFixed(2)} (
                          <strong>{r.shiftTrue.heightPts.toFixed(2)}pt</strong> /{' '}
                          {r.shiftTrue.heightAtr.toFixed(2)}x
                          {r.shiftTrue.clipped
                            ? `, raw ${r.shiftTrue.unclippedHeightPts.toFixed(1)}pt`
                            : ''}
                          )
                        </td>
                        <td className="py-1 pr-2 text-neutral-200">
                          {r.shiftFalse.bottom.toFixed(2)}–
                          {r.shiftFalse.top.toFixed(2)} (
                          <strong>{r.shiftFalse.heightPts.toFixed(2)}pt</strong> /{' '}
                          {r.shiftFalse.heightAtr.toFixed(2)}x
                          {r.shiftFalse.clipped
                            ? `, raw ${r.shiftFalse.unclippedHeightPts.toFixed(1)}pt`
                            : ''}
                          )
                        </td>
                        <td className="py-1">
                          {r.clipped ? (
                            <span className="rounded border border-amber-500/50 bg-amber-950/40 px-1.5 py-0.2 text-[9px] font-bold text-amber-300">
                              clipped
                            </span>
                          ) : (
                            <span className="text-neutral-500">raw</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* PHASE 6 ITEM 3: CANDLE ALIGNMENT CHECK (4H & 1D) */}
      <div className="mt-3 border-t border-white/10 pt-2.5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAlignmentOpen((v) => !v)}
              className="cursor-pointer rounded border border-[#d9ac4a]/60 bg-[#7a1422]/60 px-2.5 py-1 text-[10px] font-bold text-[#d9ac4a]"
            >
              {alignmentOpen ? '▼ ALIGNMENT CHECK' : '▶ ALIGNMENT CHECK'}
            </button>
            <span className="text-[10px] text-neutral-400">
              Last 5 candles for 4H and 1D (UTC open time + OHLC)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[10px]">
            <label className="flex items-center gap-1">
              <span className="text-neutral-400">h4AlignmentOffsetHours:</span>
              <input
                type="number"
                step="1"
                min="-12"
                max="12"
                value={localH4Offset}
                onChange={(e) =>
                  handleUpdateH4Offset(Number(e.target.value) || 0)
                }
                className="w-14 rounded border border-white/25 bg-black px-1.5 py-0.5 text-right text-[10px] font-bold text-cyan-300 outline-none focus:border-cyan-400"
              />
            </label>
            <label className="flex items-center gap-1">
              <span className="text-neutral-400">dailyAlignmentUtcHour:</span>
              <input
                type="number"
                step="1"
                min="-12"
                max="23"
                value={localD1UtcHour}
                onChange={(e) =>
                  handleUpdateD1UtcHour(Number(e.target.value) || 0)
                }
                className="w-14 rounded border border-white/25 bg-black px-1.5 py-0.5 text-right text-[10px] font-bold text-cyan-300 outline-none focus:border-cyan-400"
              />
            </label>
          </div>
        </div>

        {alignmentOpen && (
          <div className="grid grid-cols-1 gap-2 rounded border border-white/15 bg-black/75 p-2.5 sm:grid-cols-2">
            {/* 4H Last 5 Candles */}
            <div className="rounded border border-white/10 bg-black/60 p-2">
              <div className="mb-1 flex items-center justify-between text-[10px] font-bold text-amber-300">
                <span>
                  4H LAST 5 CANDLES (offset {alignmentReport.h4AlignmentOffsetHours}h)
                </span>
                <span className="text-[9px] text-neutral-400">
                  {alignmentReport.rebuiltFromM1['4h'] ? 'M1 REBUILT' : 'STORE/FEED'}
                </span>
              </div>
              <table className="w-full border-collapse text-left text-[10px]">
                <thead>
                  <tr className="border-b border-white/10 text-neutral-400">
                    <th className="py-0.5 pr-2">OPEN TIME UTC</th>
                    <th className="py-0.5 pr-1">OPEN</th>
                    <th className="py-0.5 pr-1">HIGH</th>
                    <th className="py-0.5 pr-1">LOW</th>
                    <th className="py-0.5">CLOSE</th>
                  </tr>
                </thead>
                <tbody>
                  {alignmentReport.last5H4.map((c) => (
                    <tr key={c.time} className="border-b border-white/5">
                      <td className="py-0.5 pr-2 text-neutral-300">
                        {c.openTimeUtc}
                      </td>
                      <td className="py-0.5 pr-1 text-white">
                        {c.open.toFixed(2)}
                      </td>
                      <td className="py-0.5 pr-1 text-emerald-300">
                        {c.high.toFixed(2)}
                      </td>
                      <td className="py-0.5 pr-1 text-rose-300">
                        {c.low.toFixed(2)}
                      </td>
                      <td className="py-0.5 font-semibold text-amber-300">
                        {c.close.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 1D Last 5 Candles */}
            <div className="rounded border border-white/10 bg-black/60 p-2">
              <div className="mb-1 flex items-center justify-between text-[10px] font-bold text-amber-300">
                <span>
                  1D LAST 5 CANDLES (UTC hour {alignmentReport.dailyAlignmentUtcHour}h)
                </span>
                <span className="text-[9px] text-neutral-400">
                  {alignmentReport.rebuiltFromM1['1d'] ? 'M1 REBUILT' : 'STORE/FEED'}
                </span>
              </div>
              <table className="w-full border-collapse text-left text-[10px]">
                <thead>
                  <tr className="border-b border-white/10 text-neutral-400">
                    <th className="py-0.5 pr-2">OPEN TIME UTC</th>
                    <th className="py-0.5 pr-1">OPEN</th>
                    <th className="py-0.5 pr-1">HIGH</th>
                    <th className="py-0.5 pr-1">LOW</th>
                    <th className="py-0.5">CLOSE</th>
                  </tr>
                </thead>
                <tbody>
                  {alignmentReport.last5D1.map((c) => (
                    <tr key={c.time} className="border-b border-white/5">
                      <td className="py-0.5 pr-2 text-neutral-300">
                        {c.openTimeUtc}
                      </td>
                      <td className="py-0.5 pr-1 text-white">
                        {c.open.toFixed(2)}
                      </td>
                      <td className="py-0.5 pr-1 text-emerald-300">
                        {c.high.toFixed(2)}
                      </td>
                      <td className="py-0.5 pr-1 text-rose-300">
                        {c.low.toFixed(2)}
                      </td>
                      <td className="py-0.5 font-semibold text-amber-300">
                        {c.close.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
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
              <div className="flex flex-wrap items-center gap-2">
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
                <button
                  type="button"
                  onClick={() => {
                    setCompareTf('4h');
                    setExpectedSellInput('4350, 4300, 4290, 4270, 4235');
                    setExpectedBuyInput('4055, 4030, 3930, 3891');
                    setCompareTolerance(3);
                  }}
                  className="cursor-pointer rounded border border-white/20 bg-white/5 px-2 py-0.5 text-[9.5px] font-semibold text-neutral-300 hover:text-white"
                >
                  LOAD 4H PRESET
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
