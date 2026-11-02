// src/doji/useDojiFeed.ts
import { useState, useEffect, useRef, useCallback } from 'react';
import * as signalR from '@microsoft/signalr';
import { commandStore } from '../command/data/commandFeedStore';
import {
  DojiTimeframe,
  ALL_DOJI_TIMEFRAMES,
  DOJI_TF_CONFIG,
  DojiZoneState,
  DojiMode,
  DojiZoneLifetime,
  RawBar,
  DojiZone,
  DojiTimeframeStats,
  ActiveDojiSignal,
  extractValidDojiZonesWithStats,
  calculateZoneStrength,
  evaluateZoneLiveRetest,
  computeActiveSignal,
  computeAtr14,
  computeEma,
  deduplicateBars,
} from './dojiEngine';
import {
  DojiTrade,
  simulateTradesForTimeframe,
  computeLivePnl,
  saveTradesToStorage,
} from './dojiSignalEngine';

const TIMEFRAMES: DojiTimeframe[] = ALL_DOJI_TIMEFRAMES;

function createTfRecord<T>(factory: (tf: DojiTimeframe) => T): Record<DojiTimeframe, T> {
  const record = {} as Record<DojiTimeframe, T>;
  for (const tf of TIMEFRAMES) {
    record[tf] = factory(tf);
  }
  return record;
}

function getIntervalMs(tf: DojiTimeframe): number {
  return DOJI_TF_CONFIG[tf].intervalMs;
}

function aggregate1mBarsTo3mClient(m1Bars: RawBar[]): RawBar[] {
  const unique = deduplicateBars(m1Bars);
  if (unique.length === 0) return [];
  const periodMs = 3 * 60 * 1000;
  const buckets = new Map<number, RawBar[]>();
  for (const b of unique) {
    const ms = new Date(b.openTime).getTime();
    if (!Number.isFinite(ms)) continue;
    const bucketMs = Math.floor(ms / periodMs) * periodMs;
    const list = buckets.get(bucketMs);
    if (list) list.push(b);
    else buckets.set(bucketMs, [b]);
  }
  const keys = Array.from(buckets.keys()).sort((a, b) => a - b);
  return keys.map((bucketMs, idx) => {
    const group = buckets.get(bucketMs)!;
    const isLast = idx === keys.length - 1;
    let high = group[0].high;
    let low = group[0].low;
    let vol = 0;
    for (const g of group) {
      if (g.high > high) high = g.high;
      if (g.low < low) low = g.low;
      vol += g.tickVolume ?? g.volume ?? 0;
    }
    return {
      openTime: new Date(bucketMs).toISOString(),
      open: group[0].open,
      high,
      low,
      close: group[group.length - 1].close,
      volume: vol,
      tickVolume: vol,
      isOpen: isLast && (group.some((g) => g.isOpen) || group.length < 3),
    };
  });
}

export function useDojiFeed(
  selectedTf: DojiTimeframe,
  initialMode: DojiMode = 'indicator',
  bodyPctParam?: number,
  wickDiffPctParam: number = 0.15,
  minRangeAtrParam?: number,
  maxZonesPerTfParam: number = 50,
  maxDistanceAtrParam: number = 0,
  initialMinZoneStrength: number = 5,
  slAtrMultiplierParam: number = 0.25,
  initialZoneLifetime: DojiZoneLifetime = 'untilBroken'
) {
  const [barsMap, setBarsMap] = useState<Record<DojiTimeframe, RawBar[]>>(() =>
    createTfRecord(() => [])
  );

  const [livePrice, setLivePrice] = useState<number>(() =>
    commandStore.currentPrice > 0 ? commandStore.currentPrice : 0
  );
  const [dayChange, setDayChange] = useState<number>(() => commandStore.change24h || 0);
  const [dayChangePercent, setDayChangePercent] = useState<number>(
    () => commandStore.changePercent24h || 0
  );
  const [isMarketClosed, setIsMarketClosed] = useState<boolean>(
    () => !commandStore.marketOpen
  );
  const [connectionStatus, setConnectionStatus] = useState<
    'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING'
  >('CONNECTING');
  const [lastTickTime, setLastTickTime] = useState<number>(0);
  const [isLoadingCandles, setIsLoadingCandles] = useState<boolean>(true);
  const [redOnly, setRedOnly] = useState<boolean>(true);
  const [dojiMode, setDojiMode] = useState<DojiMode>(initialMode);
  const [zoneLifetime, setZoneLifetime] = useState<DojiZoneLifetime>(initialZoneLifetime);
  const [minZoneStrength, setMinZoneStrength] = useState<number>(initialMinZoneStrength);
  const [trendFilter, setTrendFilter] = useState<boolean>(true);
  const [zoneMerge, setZoneMerge] = useState<boolean>(true);
  const [retestConfirm, setRetestConfirm] = useState<boolean>(true);
  const [tp1R, setTp1R] = useState<number>(1.0);
  const [tp2R, setTp2R] = useState<number>(2.0);
  const [tp3R, setTp3R] = useState<number>(3.0);
  const [showAllZones, setShowAllZones] = useState<boolean>(false);
  const [maxZonesPerTf, setMaxZonesPerTf] = useState<number>(maxZonesPerTfParam);
  const [maxDistanceAtr, setMaxDistanceAtr] = useState<number>(maxDistanceAtrParam);

  const effectiveBodyPct = bodyPctParam ?? (dojiMode === 'loose' ? 0.10 : 0.20);
  const effectiveWickDiffPct = wickDiffPctParam ?? 0.15;
  const effectiveMinRangeAtr = minRangeAtrParam ?? (dojiMode === 'strict' ? 0.5 : 0.2);
  const effectiveMaxZonesPerTf = maxZonesPerTf;
  const effectiveMaxDistanceAtr = maxDistanceAtr;
  const effectiveSlAtrMultiplier = slAtrMultiplierParam ?? 0.25;

  const [zonesMap, setZonesMap] = useState<Record<DojiTimeframe, DojiZone[]>>(() =>
    createTfRecord(() => [])
  );
  const [tfStatsMap, setTfStatsMap] = useState<Record<DojiTimeframe, DojiTimeframeStats>>(() =>
    createTfRecord((tf) => ({
      timeframe: tf,
      barsCount: 0,
      requestedBars: 1000,
      dojisCount: 0,
      validCount: 0,
    }))
  );
  const [allValidZones, setAllValidZones] = useState<DojiZone[]>([]);
  const [activeSignal, setActiveSignal] = useState<ActiveDojiSignal | null>(null);

  // Always rebuild trades freshly from loaded candles on page load (never trust stale localStorage)
  const [allTrades, setAllTrades] = useState<DojiTrade[]>([]);
  const [activeTradesMap, setActiveTradesMap] = useState<Record<DojiTimeframe, DojiTrade | null>>(
    () => createTfRecord(() => null)
  );

  const barsRef = useRef<Record<DojiTimeframe, RawBar[]>>(createTfRecord(() => []));
  const livePriceRef = useRef<number>(
    commandStore.currentPrice > 0 ? commandStore.currentPrice : 0
  );
  const isMarketClosedRef = useRef<boolean>(!commandStore.marketOpen);
  isMarketClosedRef.current = isMarketClosed;
  const connectionStatusRef = useRef(connectionStatus);
  connectionStatusRef.current = connectionStatus;
  const selectedTfRef = useRef<DojiTimeframe>(selectedTf);
  selectedTfRef.current = selectedTf;
  const redOnlyRef = useRef<boolean>(redOnly);
  redOnlyRef.current = redOnly;
  const dojiModeRef = useRef<DojiMode>(dojiMode);
  dojiModeRef.current = dojiMode;
  const zoneLifetimeRef = useRef<DojiZoneLifetime>(zoneLifetime);
  zoneLifetimeRef.current = zoneLifetime;
  const trendFilterRef = useRef<boolean>(trendFilter);
  trendFilterRef.current = trendFilter;
  const zoneMergeRef = useRef<boolean>(zoneMerge);
  zoneMergeRef.current = zoneMerge;
  const retestConfirmRef = useRef<boolean>(retestConfirm);
  retestConfirmRef.current = retestConfirm;
  const bodyPctRef = useRef<number>(effectiveBodyPct);
  bodyPctRef.current = effectiveBodyPct;
  const wickDiffPctRef = useRef<number>(effectiveWickDiffPct);
  wickDiffPctRef.current = effectiveWickDiffPct;
  const minRangeAtrRef = useRef<number>(effectiveMinRangeAtr);
  minRangeAtrRef.current = effectiveMinRangeAtr;
  const maxZonesPerTfRef = useRef<number>(effectiveMaxZonesPerTf);
  maxZonesPerTfRef.current = effectiveMaxZonesPerTf;
  const maxDistanceAtrRef = useRef<number>(effectiveMaxDistanceAtr);
  maxDistanceAtrRef.current = effectiveMaxDistanceAtr;
  const minZoneStrengthRef = useRef<number>(minZoneStrength);
  minZoneStrengthRef.current = minZoneStrength;
  const tp1RRef = useRef<number>(tp1R);
  tp1RRef.current = tp1R;
  const tp2RRef = useRef<number>(tp2R);
  tp2RRef.current = tp2R;
  const tp3RRef = useRef<number>(tp3R);
  tp3RRef.current = tp3R;
  const slAtrMultiplierRef = useRef<number>(effectiveSlAtrMultiplier);
  slAtrMultiplierRef.current = effectiveSlAtrMultiplier;
  const tfStatsMapRef = useRef<Record<DojiTimeframe, DojiTimeframeStats>>(tfStatsMap);
  tfStatsMapRef.current = tfStatsMap;
  const zonesMapRef = useRef<Record<DojiTimeframe, DojiZone[]>>(createTfRecord(() => []));
  const activeTradesMapRef = useRef<Record<DojiTimeframe, DojiTrade | null>>(
    createTfRecord(() => null)
  );
  const tradesByTfRef = useRef<Record<DojiTimeframe, DojiTrade[]>>(createTfRecord(() => []));
  const tfClosedMetricsRef = useRef<
    Record<DojiTimeframe, { atr: number; ema9: number; closedBarsCount: number }>
  >(createTfRecord(() => ({ atr: 3.5, ema9: 0, closedBarsCount: 0 })));
  const isSyncingToCommandStoreRef = useRef<boolean>(false);

  // Re-extract zones and run trade simulation from closed bars across timeframes
  const reExtractAllZones = useCallback(
    (
      currentP: number,
      redOnlyOverride?: boolean,
      modeOverride?: DojiMode,
      bodyPctOverride?: number,
      wickDiffPctOverride?: number,
      minRangeAtrOverride?: number,
      maxZonesPerTfOverride?: number,
      maxDistanceAtrOverride?: number,
      minZoneStrengthOverride?: number,
      slAtrMultiplierOverride?: number,
      zoneLifetimeOverride?: DojiZoneLifetime,
      trendFilterOverride?: boolean,
      zoneMergeOverride?: boolean,
      retestConfirmOverride?: boolean,
      onlyTimeframes?: DojiTimeframe[]
    ) => {
      const useRedOnly = typeof redOnlyOverride === 'boolean' ? redOnlyOverride : redOnlyRef.current;
      const useMode = modeOverride ?? dojiModeRef.current;
      const useZoneLifetime = zoneLifetimeOverride ?? zoneLifetimeRef.current;
      const useTrendFilter =
        typeof trendFilterOverride === 'boolean' ? trendFilterOverride : trendFilterRef.current;
      const useZoneMerge =
        typeof zoneMergeOverride === 'boolean' ? zoneMergeOverride : zoneMergeRef.current;
      const useRetestConfirm =
        typeof retestConfirmOverride === 'boolean'
          ? retestConfirmOverride
          : retestConfirmRef.current;
      const useBodyPct =
        typeof bodyPctOverride === 'number'
          ? bodyPctOverride
          : bodyPctParam ?? (useMode === 'loose' ? 0.10 : 0.20);
      const useWickDiffPct =
        typeof wickDiffPctOverride === 'number' ? wickDiffPctOverride : wickDiffPctRef.current;
      const useMinRangeAtr =
        typeof minRangeAtrOverride === 'number'
          ? minRangeAtrOverride
          : minRangeAtrParam ?? (useMode === 'strict' ? 0.5 : 0.2);
      const useMaxZonesPerTf =
        typeof maxZonesPerTfOverride === 'number'
          ? maxZonesPerTfOverride
          : maxZonesPerTfRef.current;
      const useMaxDistanceAtr =
        typeof maxDistanceAtrOverride === 'number'
          ? maxDistanceAtrOverride
          : maxDistanceAtrRef.current;
      const useMinZoneStrength =
        typeof minZoneStrengthOverride === 'number'
          ? minZoneStrengthOverride
          : minZoneStrengthRef.current;
      const useSlAtrMultiplier =
        typeof slAtrMultiplierOverride === 'number'
          ? slAtrMultiplierOverride
          : slAtrMultiplierRef.current;

      // Determine which timeframes need recalculation (if onlyTimeframes is passed, include any timeframe whose HTF is in onlyTimeframes)
      const targetTfSet = new Set<DojiTimeframe>(onlyTimeframes ?? TIMEFRAMES);
      if (onlyTimeframes) {
        for (const tf of TIMEFRAMES) {
          const htf = DOJI_TF_CONFIG[tf].htf;
          if (htf && targetTfSet.has(htf)) {
            targetTfSet.add(tf);
          }
        }
      }

      const currentBars = barsRef.current;
      const newZonesMap: Record<DojiTimeframe, DojiZone[]> = createTfRecord(
        (tf) => zonesMapRef.current[tf] || []
      );
      const newStatsMap: Record<DojiTimeframe, DojiTimeframeStats> = createTfRecord(
        (tf) =>
          tfStatsMapRef.current[tf] || {
            timeframe: tf,
            barsCount: 0,
            requestedBars: 1000,
            dojisCount: 0,
            validCount: 0,
          }
      );
      const newActiveTrades: Record<DojiTimeframe, DojiTrade | null> = createTfRecord(
        (tf) => activeTradesMapRef.current[tf] ?? null
      );
      const newTradesByTf: Record<DojiTimeframe, DojiTrade[]> = createTfRecord(
        (tf) => tradesByTfRef.current[tf] || []
      );

      for (const tf of TIMEFRAMES) {
        if (!targetTfSet.has(tf)) continue;

        const tfBars = currentBars[tf];
        if (tfBars && tfBars.length > 0) {
          const refPrice = currentP > 0 ? currentP : tfBars[tfBars.length - 1].close;
          const htf = DOJI_TF_CONFIG[tf].htf;
          const htfBars = htf ? currentBars[htf] : undefined;

          const closedBars = tfBars.filter((b) => !b.isOpen);
          const cachedAtr = computeAtr14(closedBars);
          const emaList = computeEma(closedBars, 9);
          const cachedEma9 = emaList.length > 0 ? emaList[emaList.length - 1].value : refPrice;
          tfClosedMetricsRef.current[tf] = {
            atr: cachedAtr,
            ema9: cachedEma9,
            closedBarsCount: closedBars.length,
          };

          // 1. Run deterministic signal engine per timeframe (strictly separate break and retest bars)
          const { trades, activeTrade, consumedOpenTimes, filterStats } =
            simulateTradesForTimeframe(
              tfBars,
              tf,
              useRedOnly,
              refPrice,
              useMode,
              useBodyPct,
              useWickDiffPct,
              useMinRangeAtr,
              useMinZoneStrength,
              useSlAtrMultiplier,
              useTrendFilter,
              useZoneMerge,
              useRetestConfirm,
              htfBars,
              tp1RRef.current,
              tp2RRef.current,
              tp3RRef.current
            );
          newActiveTrades[tf] = activeTrade;
          newTradesByTf[tf] = activeTrade ? [...trades, activeTrade] : trades;

          // 2. Extract up to useMaxZonesPerTf valid zones per timeframe (default 50, maxDistanceAtr default 0)
          const { zones: tfZones, stats } = extractValidDojiZonesWithStats(
            tfBars,
            tf,
            refPrice,
            useRedOnly,
            consumedOpenTimes,
            useMode,
            useBodyPct,
            useWickDiffPct,
            useMinRangeAtr,
            useMaxZonesPerTf,
            useMaxDistanceAtr,
            useZoneLifetime,
            useZoneMerge
          );

          // 3. Enforce strict check: a zone is marked "used" if and only if an actual retest trade opened on it
          const tfTradeZoneTimes = new Set<string>(trades.map((t) => t.zoneOpenTime));
          if (activeTrade) {
            tfTradeZoneTimes.add(activeTrade.zoneOpenTime);
          }

          const verifiedTfZones = tfZones.map((z) => {
            const openTimes = z.mergedOpenTimes ?? [z.openTime];
            const hasTradeInLog = openTimes.some((ot) => tfTradeZoneTimes.has(ot));
            const zoneState: DojiZoneState = hasTradeInLog
              ? 'used'
              : z.isBroken
              ? 'armed'
              : 'waiting';
            const canTrade = z.strength >= useMinZoneStrength;
            const liveRetest = canTrade
              ? evaluateZoneLiveRetest(
                  {
                    barIndex: z.barIndex,
                    high: z.high,
                    low: z.low,
                    isBroken: z.isBroken,
                    breakDirection: z.breakDirection,
                    breakBarIndex: z.breakBarIndex,
                    isUsed: hasTradeInLog,
                  },
                  tfBars,
                  tf,
                  refPrice
                )
              : {
                  isRetestLive: false,
                  retestLiveCloseTime: null,
                  retestLiveText: null,
                };
            return {
              ...z,
              zoneState,
              isUsed: hasTradeInLog,
              hasSignalFormed: hasTradeInLog,
              ...liveRetest,
            };
          });

          newZonesMap[tf] = verifiedTfZones;
          newStatsMap[tf] = {
            ...stats,
            blockedByTrend: filterStats.blockedByTrend,
            blockedByConfirm: filterStats.blockedByConfirm,
            mergedDojisCount: stats.mergedDojisCount ?? filterStats.mergedDojis,
            trendFilter: useTrendFilter,
            zoneMerge: useZoneMerge,
            retestConfirm: useRetestConfirm,
          };
        } else {
          newZonesMap[tf] = [];
          newTradesByTf[tf] = [];
          newActiveTrades[tf] = null;
        }
      }

      const combinedZones: DojiZone[] = [];
      const combinedTrades: DojiTrade[] = [];
      for (const tf of TIMEFRAMES) {
        if (newZonesMap[tf]?.length) {
          combinedZones.push(...newZonesMap[tf]);
        }
        if (newTradesByTf[tf]?.length) {
          combinedTrades.push(...newTradesByTf[tf]);
        }
      }

      combinedTrades.sort((a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime());

      zonesMapRef.current = newZonesMap;
      tfStatsMapRef.current = newStatsMap;
      tradesByTfRef.current = newTradesByTf;
      setZonesMap(newZonesMap);
      setTfStatsMap(newStatsMap);
      setAllValidZones(combinedZones);

      activeTradesMapRef.current = newActiveTrades;
      setActiveTradesMap(newActiveTrades);
      setAllTrades(combinedTrades);
      saveTradesToStorage(combinedTrades);

      const selTf = selectedTfRef.current;
      const selAtr = newStatsMap[selTf]?.atr || 3.5;
      const sig = computeActiveSignal(
        currentP,
        selTf,
        combinedZones,
        selAtr,
        useSlAtrMultiplier,
        useMinZoneStrength,
        newActiveTrades[selTf],
        tp1RRef.current,
        tp2RRef.current,
        tp3RRef.current
      );
      setActiveSignal(sig);
    },
    [bodyPctParam, minRangeAtrParam]
  );

  // Live strength, live retest heads-up & open trade P/L update on each tick
  // Uses cached closed-bar metrics (atr, ema9, closedBarsCount) so it never loops over 1000 bars per timeframe on live ticks
  const updateLiveStrengths = useCallback((currentP: number) => {
    if (currentP <= 0) return;

    const currentZones = zonesMapRef.current;
    const currentBars = barsRef.current;
    let hasChanges = false;
    const updatedMap: Record<DojiTimeframe, DojiZone[]> = { ...currentZones };
    const combinedZones: DojiZone[] = [];

    for (const tf of TIMEFRAMES) {
      const zones = currentZones[tf];
      const bars = currentBars[tf];
      if (!zones || zones.length === 0 || !bars || bars.length === 0) continue;

      const cachedMetrics = tfClosedMetricsRef.current[tf];
      const atr = cachedMetrics?.atr || tfStatsMapRef.current[tf]?.atr || 3.5;
      const ema9 = cachedMetrics?.ema9 > 0 ? cachedMetrics.ema9 : currentP;
      const closedBarsCount =
        cachedMetrics?.closedBarsCount > 0 ? cachedMetrics.closedBarsCount : Math.max(0, bars.length - 1);

      const updatedZones = zones.map((z) => {
        const s = calculateZoneStrength(
          {
            high: z.high,
            low: z.low,
            range: z.range,
            body: z.body,
            wickDiff: z.wickDiff,
            barIndex: z.barIndex,
            isBroken: z.isBroken,
            breakDirection: z.breakDirection,
            mergedCount: z.mergedCount,
          },
          currentP,
          ema9,
          atr,
          closedBarsCount
        );

        const distPts = Number((((z.high + z.low) / 2) - currentP).toFixed(2));
        const side: 'SELL' | 'BUY' = distPts >= 0 ? 'SELL' : 'BUY';
        const retestDistancePts =
          z.retestLevel !== null
            ? Number((z.retestLevel - currentP).toFixed(2))
            : distPts;
        const distFromLevel =
          currentP >= z.low && currentP <= z.high
            ? 0
            : Math.min(Math.abs(currentP - z.high), Math.abs(currentP - z.low));
        const isWithin5Atr = distFromLevel <= 5 * atr;

        const canTrade = s.strength >= minZoneStrengthRef.current;
        const liveRetest = canTrade
          ? evaluateZoneLiveRetest(
              {
                barIndex: z.barIndex,
                high: z.high,
                low: z.low,
                isBroken: z.isBroken,
                breakDirection: z.breakDirection,
                breakBarIndex: z.breakBarIndex,
                isUsed: z.isUsed,
              },
              bars,
              tf,
              currentP
            )
          : {
              isRetestLive: false,
              retestLiveCloseTime: null,
              retestLiveText: null,
            };

        return {
          ...z,
          ...s,
          distancePts: distPts,
          side,
          retestDistancePts,
          isWithin5Atr,
          ...liveRetest,
        };
      });

      updatedMap[tf] = updatedZones;
      combinedZones.push(...updatedZones);
      hasChanges = true;
    }

    if (hasChanges) {
      zonesMapRef.current = updatedMap;
      setZonesMap(updatedMap);
      setAllValidZones(combinedZones);
      const selTf = selectedTfRef.current;
      const selAtr = tfStatsMapRef.current[selTf]?.atr || 3.5;
      const sig = computeActiveSignal(
        currentP,
        selTf,
        combinedZones,
        selAtr,
        slAtrMultiplierRef.current,
        minZoneStrengthRef.current,
        activeTradesMapRef.current[selTf]
      );
      setActiveSignal(sig);
    }

    // Update live P/L for active trades
    const currentActives = { ...activeTradesMapRef.current };
    let hasActivePnlChange = false;
    for (const tf of TIMEFRAMES) {
      const active = currentActives[tf];
      if (active && active.status === 'OPEN') {
        const pnl = computeLivePnl(active, currentP);
        currentActives[tf] = {
          ...active,
          livePnlDollars: pnl,
          pnlDollars: pnl,
        };
        hasActivePnlChange = true;
      }
    }
    if (hasActivePnlChange) {
      activeTradesMapRef.current = currentActives;
      setActiveTradesMap(currentActives);
      setAllTrades((prev) =>
        prev.map((t) => {
          if (t.status === 'OPEN') {
            const pnl = computeLivePnl(t, currentP);
            return { ...t, livePnlDollars: pnl, pnlDollars: pnl };
          }
          return t;
        })
      );
    }
  }, []);

  const fetchOhlcPage = useCallback(async (query: string): Promise<RawBar[]> => {
    const is3m = /(?:^|&)interval=3m(?:&|$)/.test(query);
    const urls = is3m
      ? [`/api/doji/ohlc?${query}`]
      : [
          `/api/doji/ohlc?${query}`,
          `https://biquote.io/api/XAUUSD/ohlc?${query}`,
        ];

    for (const url of urls) {
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (res.ok) {
          const data = await res.json();
          const rawBars = data?.data?.bars || data?.bars;
          if (Array.isArray(rawBars) && rawBars.length > 0) {
            return [...rawBars].reverse();
          }
        }
      } catch {}
    }

    // Fallback for 3m if /api/doji/ohlc was unreachable: fetch 1m from biquote.io and aggregate into 3m
    if (is3m) {
      try {
        const m1Query = query.replace('interval=3m', 'interval=1m');
        const res = await fetch(`https://biquote.io/api/XAUUSD/ohlc?${m1Query}`, {
          headers: { Accept: 'application/json' },
        });
        if (res.ok) {
          const data = await res.json();
          const rawBars = data?.data?.bars || data?.bars;
          if (Array.isArray(rawBars) && rawBars.length > 0) {
            return aggregate1mBarsTo3mClient([...rawBars].reverse());
          }
        }
      } catch {}
    }
    return [];
  }, []);

  const refetchClosedTimeframe = useCallback(
    async (tf: DojiTimeframe) => {
      try {
        const officialBars = await fetchOhlcPage(`interval=${tf}&limit=1000&nocache=1`);
        if (!officialBars || officialBars.length === 0) return;

        const existingBars = barsRef.current[tf] || [];
        // Merge existing bars with officialBars last so official server candles replace locally tick-built candles
        let merged = deduplicateBars([...existingBars, ...officialBars]);
        if (merged.length > 1000) {
          merged = merged.slice(-1000);
        }

        // Ensure the currently forming bar reflects the latest live tick price if open
        const currentLive = livePriceRef.current;
        if (merged.length > 0 && currentLive > 0 && !isMarketClosedRef.current) {
          const lastIdx = merged.length - 1;
          const lastBar = { ...merged[lastIdx] };
          if (lastBar.isOpen) {
            lastBar.close = currentLive;
            lastBar.high = Math.max(lastBar.high, currentLive);
            lastBar.low = Math.min(lastBar.low, currentLive);
            merged[lastIdx] = lastBar;
          }
        }

        const updatedMap = {
          ...barsRef.current,
          [tf]: merged,
        };
        barsRef.current = updatedMap;
        setBarsMap(updatedMap);
        reExtractAllZones(
          livePriceRef.current,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          [tf]
        );
      } catch {}
    },
    [fetchOhlcPage, reExtractAllZones]
  );

  // Unified handler for incoming price & marketState updates (used by SignalR, fallback polling, and commandStore)
  const applyIncomingQuote = useCallback(
    (
      quote: {
        mid?: number;
        price?: number;
        bid?: number;
        ask?: number;
        marketState?: string;
        status?: string;
        marketOpen?: boolean;
        dayDiffPercent?: number;
        previousClose?: number;
        close?: number;
        timestamp?: string | number;
      },
      fromCommandStore: boolean = false
    ) => {
      if (!quote) return;

      const stateStr = (quote.marketState || quote.status || '').toLowerCase();
      const closed =
        quote.marketOpen === false
          ? true
          : quote.marketOpen === true
          ? false
          : stateStr === 'closed' ||
            stateStr === 'offline' ||
            stateStr === 'market_closed';
      setIsMarketClosed(closed);
      isMarketClosedRef.current = closed;

      const rawMid =
        typeof quote.mid === 'number'
          ? quote.mid
          : typeof quote.price === 'number'
          ? quote.price
          : typeof quote.bid === 'number' && typeof quote.ask === 'number'
          ? (quote.bid + quote.ask) / 2
          : null;

      if (rawMid === null || rawMid <= 0) return;

      const p = Number(rawMid.toFixed(2));
      livePriceRef.current = p;
      setLivePrice(p);
      setLastTickTime(Date.now());

      if (typeof quote.dayDiffPercent === 'number') {
        setDayChangePercent(quote.dayDiffPercent);
        const closeP = quote.previousClose ?? quote.close;
        if (typeof closeP === 'number' && closeP > 0) {
          setDayChange(Number((p - closeP).toFixed(2)));
        } else {
          const approxChange = p * (quote.dayDiffPercent / 100);
          setDayChange(Number(approxChange.toFixed(2)));
        }
      } else if (commandStore.change24h !== 0 || commandStore.changePercent24h !== 0) {
        setDayChange(commandStore.change24h);
        setDayChangePercent(commandStore.changePercent24h);
      }

      // Synchronize top Sarraf bar (commandStore) with this exact price update
      if (!fromCommandStore && !isSyncingToCommandStoreRef.current) {
        try {
          isSyncingToCommandStoreRef.current = true;
          commandStore.processIncomingFeedQuote({
            price: p,
            bid: quote.bid,
            ask: quote.ask,
            previousClose: quote.previousClose ?? quote.close ?? (commandStore.previousClose || undefined),
            dayDiffPercent: quote.dayDiffPercent,
            marketOpen: !closed,
            timestamp: quote.timestamp ? new Date(quote.timestamp).toISOString() : new Date().toISOString(),
          });
        } finally {
          isSyncingToCommandStoreRef.current = false;
        }
      }

      if (closed) {
        updateLiveStrengths(p);
        return;
      }

      // Market is open: update active bar across all 4 timeframes
      const closedTimeframes: DojiTimeframe[] = [];
      const currentMap = barsRef.current;
      const updatedMap = { ...currentMap };

      for (const tf of TIMEFRAMES) {
        const bars = updatedMap[tf] ? [...updatedMap[tf]] : [];
        if (bars.length === 0) continue;

        const lastIndex = bars.length - 1;
        const currentBar = { ...bars[lastIndex] };
        const barIntervalMs = getIntervalMs(tf);
        const barOpenMs = new Date(currentBar.openTime).getTime();
        const tickTimeMs = quote.timestamp ? new Date(quote.timestamp).getTime() : Date.now();

        if (tickTimeMs >= barOpenMs + barIntervalMs) {
          currentBar.isOpen = false;
          bars[lastIndex] = currentBar;

          const newBarOpenMs = barOpenMs + barIntervalMs;
          const newBar: RawBar = {
            openTime: new Date(newBarOpenMs).toISOString(),
            open: p,
            high: p,
            low: p,
            close: p,
            isOpen: true,
            tickVolume: 1,
          };
          bars.push(newBar);
          updatedMap[tf] = bars;
          closedTimeframes.push(tf);
        } else {
          currentBar.close = p;
          currentBar.high = Math.max(currentBar.high, p);
          currentBar.low = Math.min(currentBar.low, p);
          currentBar.tickVolume = (currentBar.tickVolume || 0) + 1;
          bars[lastIndex] = currentBar;
          updatedMap[tf] = bars;
        }
      }

      barsRef.current = updatedMap;
      setBarsMap(updatedMap);

      if (closedTimeframes.length > 0) {
        reExtractAllZones(
          p,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          closedTimeframes
        );
        for (const tf of closedTimeframes) {
          void refetchClosedTimeframe(tf);
        }
      } else {
        updateLiveStrengths(p);
      }
    },
    [reExtractAllZones, refetchClosedTimeframe, updateLiveStrengths]
  );

  // Subscribe to commandStore so top Sarraf bar and DOJI tab always share the exact same live price and update together
  useEffect(() => {
    const syncFromStore = () => {
      if (isSyncingToCommandStoreRef.current) return;
      const storePrice = commandStore.currentPrice;
      if (storePrice > 0 && storePrice !== livePriceRef.current) {
        applyIncomingQuote(
          {
            price: storePrice,
            bid: commandStore.bid || undefined,
            ask: commandStore.ask || undefined,
            previousClose: commandStore.previousClose || undefined,
            dayDiffPercent: commandStore.changePercent24h || undefined,
            marketOpen: commandStore.marketOpen,
            timestamp: commandStore.lastTickAt || Date.now(),
          },
          true
        );
      }
    };

    const unsubscribe = commandStore.subscribe(syncFromStore);
    syncFromStore();
    return () => {
      unsubscribe();
    };
  }, [applyIncomingQuote]);

  // Silent GET https://biquote.io/api/latest?symbols=XAUUSD fetcher
  const pollBiquoteLatest = useCallback(async () => {
    const urls = [
      'https://biquote.io/api/latest?symbols=XAUUSD',
      'https://biquote.io/api/XAUUSD',
      '/api/price/xauusd',
    ];

    for (const url of urls) {
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) continue;
        const json = await res.json();

        let item: any = null;
        if (Array.isArray(json)) {
          item = json.find((q) => q?.symbol === 'XAUUSD') || json[0];
        } else if (Array.isArray(json?.data)) {
          item = json.data.find((q: any) => q?.symbol === 'XAUUSD') || json.data[0];
        } else if (Array.isArray(json?.quotes)) {
          item = json.quotes.find((q: any) => q?.symbol === 'XAUUSD') || json.quotes[0];
        } else if (json?.XAUUSD && typeof json.XAUUSD === 'object') {
          item = json.XAUUSD;
        } else if (json?.data && typeof json.data === 'object') {
          item = json.data.XAUUSD || json.data;
        } else {
          item = json;
        }

        if (item && (typeof item.mid === 'number' || typeof item.price === 'number' || typeof item.bid === 'number')) {
          applyIncomingQuote(item);
          return;
        }
      } catch {}
    }
  }, [applyIncomingQuote]);

  // 1. Initial Load: Fetch candles for all 8 timeframes and rebuild trades from candles
  useEffect(() => {
    let isCancelled = false;

    async function fetchTimeframeCandles(tf: DojiTimeframe): Promise<RawBar[]> {
      let collected = deduplicateBars(await fetchOhlcPage(`interval=${tf}&limit=1000`));
      if (collected.length === 0) return [];

      // If fewer than 1000 candles returned, request older candles using from= until 1000 or data ends
      let pageAttempt = 0;
      const intervalMs = getIntervalMs(tf);
      const maxAttempts = DOJI_TF_CONFIG[tf].minutes <= 5 ? 10 : 5;
      while (collected.length < 1000 && pageAttempt < maxAttempts) {
        pageAttempt += 1;
        const oldestOpenTime = collected[0]?.openTime;
        if (!oldestOpenTime) break;
        const oldestMs = new Date(oldestOpenTime).getTime();
        if (!Number.isFinite(oldestMs)) break;

        const needed = Math.max(200, 1000 - collected.length + 50);
        const fromIso = new Date(oldestMs - needed * intervalMs).toISOString();
        const olderBatch = await fetchOhlcPage(
          `interval=${tf}&limit=1000&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(oldestOpenTime)}`
        );

        const strictlyOlder = olderBatch.filter(
          (b) => b?.openTime && new Date(b.openTime).getTime() < oldestMs
        );
        if (strictlyOlder.length === 0) {
          break; // Historical data exhausted
        }

        collected = deduplicateBars([...strictlyOlder, ...collected]);
        if (collected.length >= 1000) {
          collected = collected.slice(-1000);
          break;
        }
      }

      return collected.slice(-1000);
    }

    async function loadAllTimeframes() {
      setIsLoadingCandles(true);
      const results = await Promise.all(TIMEFRAMES.map((tf) => fetchTimeframeCandles(tf)));

      if (isCancelled) return;

      const newBarsMap: Record<DojiTimeframe, RawBar[]> = createTfRecord(
        (tf) => results[TIMEFRAMES.indexOf(tf)] || []
      );

      barsRef.current = newBarsMap;
      setBarsMap(newBarsMap);

      const refTfBars = newBarsMap['15m']?.length ? newBarsMap['15m'] : newBarsMap[selectedTfRef.current] || [];
      const latest15m = refTfBars[refTfBars.length - 1];
      const prev15m = refTfBars.length > 1 ? refTfBars[0] : latest15m;
      const storeP = commandStore.currentPrice;
      const initialP = storeP > 0 ? storeP : latest15m ? latest15m.close : 0;

      if (initialP > 0) {
        livePriceRef.current = initialP;
        setLivePrice(initialP);
        if (prev15m && prev15m.open > 0) {
          const diff = Number((initialP - prev15m.open).toFixed(2));
          const pct = Number(((diff / prev15m.open) * 100).toFixed(2));
          setDayChange((prev) => (prev !== 0 ? prev : diff));
          setDayChangePercent((prev) => (prev !== 0 ? prev : pct));
        }
        if (storeP <= 0) {
          try {
            isSyncingToCommandStoreRef.current = true;
            commandStore.processIncomingFeedQuote({
              price: initialP,
              previousClose: prev15m?.open || initialP,
              marketOpen: !isMarketClosedRef.current,
              timestamp: new Date().toISOString(),
            });
          } finally {
            isSyncingToCommandStoreRef.current = false;
          }
        }
      }

      reExtractAllZones(initialP);
      setIsLoadingCandles(false);

      // Check latest quote and marketState immediately
      await pollBiquoteLatest();
    }

    loadAllTimeframes();

    return () => {
      isCancelled = true;
    };
  }, [fetchOhlcPage, reExtractAllZones, pollBiquoteLatest]);

  // When redOnly, dojiMode, zoneLifetime, trendFilter, zoneMerge, retestConfirm, minZoneStrength, or configurable threshold parameters change, re-extract zones and trades across all 4 timeframes
  useEffect(() => {
    redOnlyRef.current = redOnly;
    dojiModeRef.current = dojiMode;
    zoneLifetimeRef.current = zoneLifetime;
    trendFilterRef.current = trendFilter;
    zoneMergeRef.current = zoneMerge;
    retestConfirmRef.current = retestConfirm;
    bodyPctRef.current = effectiveBodyPct;
    wickDiffPctRef.current = effectiveWickDiffPct;
    minRangeAtrRef.current = effectiveMinRangeAtr;
    maxZonesPerTfRef.current = effectiveMaxZonesPerTf;
    maxDistanceAtrRef.current = effectiveMaxDistanceAtr;
    minZoneStrengthRef.current = minZoneStrength;
    slAtrMultiplierRef.current = effectiveSlAtrMultiplier;
    tp1RRef.current = tp1R;
    tp2RRef.current = tp2R;
    tp3RRef.current = tp3R;
    reExtractAllZones(
      livePriceRef.current,
      redOnly,
      dojiMode,
      effectiveBodyPct,
      effectiveWickDiffPct,
      effectiveMinRangeAtr,
      effectiveMaxZonesPerTf,
      effectiveMaxDistanceAtr,
      minZoneStrength,
      effectiveSlAtrMultiplier,
      zoneLifetime,
      trendFilter,
      zoneMerge,
      retestConfirm
    );
  }, [
    redOnly,
    dojiMode,
    zoneLifetime,
    trendFilter,
    zoneMerge,
    retestConfirm,
    effectiveBodyPct,
    effectiveWickDiffPct,
    effectiveMinRangeAtr,
    effectiveMaxZonesPerTf,
    effectiveMaxDistanceAtr,
    minZoneStrength,
    effectiveSlAtrMultiplier,
    tp1R,
    tp2R,
    tp3R,
    reExtractAllZones,
  ]);

  // When selected timeframe changes, update active signal
  useEffect(() => {
    const selAtr = tfStatsMapRef.current[selectedTf]?.atr || 3.5;
    const sig = computeActiveSignal(
      livePriceRef.current,
      selectedTf,
      allValidZones,
      selAtr,
      effectiveSlAtrMultiplier,
      minZoneStrength,
      activeTradesMap[selectedTf],
      tp1RRef.current,
      tp2RRef.current,
      tp3RRef.current
    );
    setActiveSignal(sig);
  }, [selectedTf, allValidZones, activeTradesMap, minZoneStrength, effectiveSlAtrMultiplier, tp1R, tp2R, tp3R]);

  // 2. Real-time SignalR Connection to https://biquote.io/hubs/tick
  useEffect(() => {
    let hubConnection: signalR.HubConnection | null = null;
    let isMounted = true;

    async function startSignalR() {
      try {
        hubConnection = new signalR.HubConnectionBuilder()
          .withUrl('https://biquote.io/hubs/tick', {
            skipNegotiation: false,
            transport: signalR.HttpTransportType.WebSockets | signalR.HttpTransportType.ServerSentEvents,
          })
          .withAutomaticReconnect([0, 1500, 3000, 5000, 10000])
          .configureLogging(signalR.LogLevel.None)
          .build();

        hubConnection.onreconnecting(() => {
          if (isMounted) setConnectionStatus('RECONNECTING');
        });

        hubConnection.onreconnected(async () => {
          if (isMounted) setConnectionStatus('CONNECTED');
          try {
            await hubConnection?.invoke('Subscribe', ['XAUUSD']);
          } catch {}
        });

        hubConnection.onclose(() => {
          if (isMounted) setConnectionStatus('DISCONNECTED');
        });

        hubConnection.on('ReceiveTick', (tick: any) => {
          if (!isMounted || !tick) return;
          applyIncomingQuote(tick);
        });

        await hubConnection.start();
        if (isMounted) {
          setConnectionStatus('CONNECTED');
          await hubConnection.invoke('Subscribe', ['XAUUSD']);
        }
      } catch {
        if (isMounted) setConnectionStatus('DISCONNECTED');
      }
    }

    startSignalR();

    return () => {
      isMounted = false;
      if (hubConnection) {
        hubConnection.stop().catch(() => {});
      }
    };
  }, [applyIncomingQuote]);

  // 3. Fallback polling & Market Closed status check:
  // - If market is CLOSED: check status every 60 seconds only.
  // - If market is OPEN and SignalR is not connected: silently poll GET https://biquote.io/api/latest?symbols=XAUUSD every 3 seconds.
  useEffect(() => {
    if (isMarketClosed) {
      const closedTimer = setInterval(() => {
        pollBiquoteLatest();
      }, 60_000);
      return () => clearInterval(closedTimer);
    }

    if (connectionStatus !== 'CONNECTED') {
      const openFallbackTimer = setInterval(() => {
        if (!isMarketClosedRef.current && connectionStatusRef.current !== 'CONNECTED') {
          pollBiquoteLatest();
        }
      }, 3_000);
      return () => clearInterval(openFallbackTimer);
    }
  }, [isMarketClosed, connectionStatus, pollBiquoteLatest]);

  return {
    barsMap,
    currentTfBars: barsMap[selectedTf] || [],
    livePrice,
    dayChange,
    dayChangePercent,
    isMarketClosed,
    connectionStatus,
    lastTickTime,
    isLoadingCandles,
    redOnly,
    setRedOnly,
    dojiMode,
    setDojiMode,
    zoneLifetime,
    setZoneLifetime,
    trendFilter,
    setTrendFilter,
    zoneMerge,
    setZoneMerge,
    retestConfirm,
    setRetestConfirm,
    minZoneStrength,
    setMinZoneStrength,
    tp1R,
    setTp1R,
    tp2R,
    setTp2R,
    tp3R,
    setTp3R,
    showAllZones,
    setShowAllZones,
    setMaxZonesPerTf,
    setMaxDistanceAtr,
    bodyPct: effectiveBodyPct,
    wickDiffPct: effectiveWickDiffPct,
    minRangeAtr: effectiveMinRangeAtr,
    maxZonesPerTf: effectiveMaxZonesPerTf,
    maxDistanceAtr: effectiveMaxDistanceAtr,
    slAtrMultiplier: effectiveSlAtrMultiplier,
    zonesMap,
    tfStatsMap,
    allValidZones,
    currentTfZones: zonesMap[selectedTf] || [],
    activeSignal,
    allTrades,
    activeTradesMap,
    activeTrade: activeTradesMap[selectedTf] || null,
  };
}
