// src/doji/useDojiFeed.ts
import { useState, useEffect, useRef, useCallback } from 'react';
import * as signalR from '@microsoft/signalr';
import { commandStore } from '../command/data/commandFeedStore';
import {
  DojiTimeframe,
  DojiZoneState,
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

const TIMEFRAMES: DojiTimeframe[] = ['15m', '30m', '1h', '4h'];

function getIntervalMs(tf: DojiTimeframe): number {
  switch (tf) {
    case '15m':
      return 15 * 60 * 1000;
    case '30m':
      return 30 * 60 * 1000;
    case '1h':
      return 60 * 60 * 1000;
    case '4h':
      return 4 * 60 * 60 * 1000;
  }
}

export function useDojiFeed(selectedTf: DojiTimeframe) {
  const [barsMap, setBarsMap] = useState<Record<DojiTimeframe, RawBar[]>>({
    '15m': [],
    '30m': [],
    '1h': [],
    '4h': [],
  });

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

  const [zonesMap, setZonesMap] = useState<Record<DojiTimeframe, DojiZone[]>>({
    '15m': [],
    '30m': [],
    '1h': [],
    '4h': [],
  });
  const [tfStatsMap, setTfStatsMap] = useState<Record<DojiTimeframe, DojiTimeframeStats>>({
    '15m': { timeframe: '15m', barsCount: 0, requestedBars: 1000, dojisCount: 0, validCount: 0 },
    '30m': { timeframe: '30m', barsCount: 0, requestedBars: 1000, dojisCount: 0, validCount: 0 },
    '1h': { timeframe: '1h', barsCount: 0, requestedBars: 1000, dojisCount: 0, validCount: 0 },
    '4h': { timeframe: '4h', barsCount: 0, requestedBars: 1000, dojisCount: 0, validCount: 0 },
  });
  const [allValidZones, setAllValidZones] = useState<DojiZone[]>([]);
  const [activeSignal, setActiveSignal] = useState<ActiveDojiSignal | null>(null);

  // Always rebuild trades freshly from loaded candles on page load (never trust stale localStorage)
  const [allTrades, setAllTrades] = useState<DojiTrade[]>([]);
  const [activeTradesMap, setActiveTradesMap] = useState<Record<DojiTimeframe, DojiTrade | null>>({
    '15m': null,
    '30m': null,
    '1h': null,
    '4h': null,
  });

  const barsRef = useRef<Record<DojiTimeframe, RawBar[]>>({
    '15m': [],
    '30m': [],
    '1h': [],
    '4h': [],
  });
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
  const zonesMapRef = useRef<Record<DojiTimeframe, DojiZone[]>>({
    '15m': [],
    '30m': [],
    '1h': [],
    '4h': [],
  });
  const activeTradesMapRef = useRef<Record<DojiTimeframe, DojiTrade | null>>({
    '15m': null,
    '30m': null,
    '1h': null,
    '4h': null,
  });
  const isSyncingToCommandStoreRef = useRef<boolean>(false);

  // Re-extract zones and run trade simulation from closed bars across all 4 timeframes
  const reExtractAllZones = useCallback((currentP: number, redOnlyOverride?: boolean) => {
    const useRedOnly = typeof redOnlyOverride === 'boolean' ? redOnlyOverride : redOnlyRef.current;
    const currentBars = barsRef.current;
    const newZonesMap: Record<DojiTimeframe, DojiZone[]> = {
      '15m': [],
      '30m': [],
      '1h': [],
      '4h': [],
    };
    const newStatsMap: Record<DojiTimeframe, DojiTimeframeStats> = {
      '15m': { timeframe: '15m', barsCount: 0, requestedBars: 1000, dojisCount: 0, validCount: 0 },
      '30m': { timeframe: '30m', barsCount: 0, requestedBars: 1000, dojisCount: 0, validCount: 0 },
      '1h': { timeframe: '1h', barsCount: 0, requestedBars: 1000, dojisCount: 0, validCount: 0 },
      '4h': { timeframe: '4h', barsCount: 0, requestedBars: 1000, dojisCount: 0, validCount: 0 },
    };
    const combinedZones: DojiZone[] = [];
    const newActiveTrades: Record<DojiTimeframe, DojiTrade | null> = {
      '15m': null,
      '30m': null,
      '1h': null,
      '4h': null,
    };
    const combinedTrades: DojiTrade[] = [];

    for (const tf of TIMEFRAMES) {
      const tfBars = currentBars[tf];
      if (tfBars && tfBars.length > 0) {
        const refPrice = currentP > 0 ? currentP : tfBars[tfBars.length - 1].close;

        // 1. Run deterministic signal engine per timeframe (strictly separate break and retest bars)
        const { trades, activeTrade, consumedOpenTimes } = simulateTradesForTimeframe(
          tfBars,
          tf,
          useRedOnly,
          refPrice
        );
        newActiveTrades[tf] = activeTrade;
        combinedTrades.push(...trades);
        if (activeTrade) {
          combinedTrades.push(activeTrade);
        }

        // 2. Extract up to 5 valid zones per timeframe (including "used" zones where a retest trade was taken)
        const { zones: tfZones, stats } = extractValidDojiZonesWithStats(
          tfBars,
          tf,
          refPrice,
          useRedOnly,
          consumedOpenTimes
        );

        // 3. Enforce strict check: a zone is marked "used" if and only if an actual retest trade opened on it
        const tfTradeZoneTimes = new Set<string>(trades.map((t) => t.zoneOpenTime));
        if (activeTrade) {
          tfTradeZoneTimes.add(activeTrade.zoneOpenTime);
        }

        const verifiedTfZones = tfZones.map((z) => {
          const hasTradeInLog = tfTradeZoneTimes.has(z.openTime);
          const zoneState: DojiZoneState = hasTradeInLog
            ? 'used'
            : z.isBroken
            ? 'armed'
            : 'waiting';
          const liveRetest = evaluateZoneLiveRetest(
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
          );
          return {
            ...z,
            zoneState,
            isUsed: hasTradeInLog,
            hasSignalFormed: hasTradeInLog,
            ...liveRetest,
          };
        });

        newZonesMap[tf] = verifiedTfZones;
        newStatsMap[tf] = stats;
        combinedZones.push(...verifiedTfZones);
      }
    }

    combinedTrades.sort((a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime());

    zonesMapRef.current = newZonesMap;
    setZonesMap(newZonesMap);
    setTfStatsMap(newStatsMap);
    setAllValidZones(combinedZones);

    activeTradesMapRef.current = newActiveTrades;
    setActiveTradesMap(newActiveTrades);
    setAllTrades(combinedTrades);
    saveTradesToStorage(combinedTrades);

    const sig = computeActiveSignal(currentP, selectedTfRef.current, combinedZones);
    setActiveSignal(sig);
  }, []);

  // Live strength, live retest heads-up & open trade P/L update on each tick
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

      const closedBars = bars.filter((b) => !b.isOpen);
      const atr = computeAtr14(closedBars);
      const emaList = computeEma(closedBars, 9);
      const ema9 = emaList.length > 0 ? emaList[emaList.length - 1].value : currentP;

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
          },
          currentP,
          ema9,
          atr,
          closedBars.length
        );

        const distPts = Number((((z.high + z.low) / 2) - currentP).toFixed(2));
        const retestDistancePts =
          z.retestLevel !== null
            ? Number((z.retestLevel - currentP).toFixed(2))
            : distPts;
        const distFromLevel =
          currentP >= z.low && currentP <= z.high
            ? 0
            : Math.min(Math.abs(currentP - z.high), Math.abs(currentP - z.low));
        const isWithin5Atr = distFromLevel <= 5 * atr;

        const liveRetest = evaluateZoneLiveRetest(
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
        );

        return {
          ...z,
          ...s,
          distancePts: distPts,
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
      const sig = computeActiveSignal(currentP, selectedTfRef.current, combinedZones);
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
      let anyBarClosed = false;
      const currentMap = barsRef.current;
      const updatedMap = { ...currentMap };

      for (const tf of TIMEFRAMES) {
        const bars = updatedMap[tf];
        if (!bars || bars.length === 0) continue;

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
          anyBarClosed = true;
        } else {
          currentBar.close = p;
          currentBar.high = Math.max(currentBar.high, p);
          currentBar.low = Math.min(currentBar.low, p);
          currentBar.tickVolume = (currentBar.tickVolume || 0) + 1;
          bars[lastIndex] = currentBar;
        }
      }

      barsRef.current = updatedMap;
      setBarsMap(updatedMap);

      if (anyBarClosed) {
        reExtractAllZones(p);
      } else {
        updateLiveStrengths(p);
      }
    },
    [reExtractAllZones, updateLiveStrengths]
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

  // 1. Initial Load: Fetch candles for all 4 timeframes and rebuild trades from candles
  useEffect(() => {
    let isCancelled = false;

    async function fetchOhlcPage(query: string): Promise<RawBar[]> {
      const urls = [
        `https://biquote.io/api/XAUUSD/ohlc?${query}`,
        `/api/doji/ohlc?${query}`,
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
      return [];
    }

    async function fetchTimeframeCandles(tf: DojiTimeframe): Promise<RawBar[]> {
      let collected = deduplicateBars(await fetchOhlcPage(`interval=${tf}&limit=1000`));
      if (collected.length === 0) return [];

      // If fewer than 1000 candles returned, request older candles using from= until 1000 or data ends
      let pageAttempt = 0;
      const intervalMs = getIntervalMs(tf);
      while (collected.length < 1000 && pageAttempt < 5) {
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
      const results = await Promise.all([
        fetchTimeframeCandles('15m'),
        fetchTimeframeCandles('30m'),
        fetchTimeframeCandles('1h'),
        fetchTimeframeCandles('4h'),
      ]);

      if (isCancelled) return;

      const newBarsMap: Record<DojiTimeframe, RawBar[]> = {
        '15m': results[0],
        '30m': results[1],
        '1h': results[2],
        '4h': results[3],
      };

      barsRef.current = newBarsMap;
      setBarsMap(newBarsMap);

      const latest15m = results[0][results[0].length - 1];
      const prev15m = results[0].length > 1 ? results[0][0] : latest15m;
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
  }, [reExtractAllZones, pollBiquoteLatest]);

  // When redOnly setting changes, re-extract zones and trades across all 4 timeframes
  useEffect(() => {
    redOnlyRef.current = redOnly;
    reExtractAllZones(livePriceRef.current, redOnly);
  }, [redOnly, reExtractAllZones]);

  // When selected timeframe changes, update active signal
  useEffect(() => {
    if (livePriceRef.current > 0 && allValidZones.length > 0) {
      const sig = computeActiveSignal(livePriceRef.current, selectedTf, allValidZones);
      setActiveSignal(sig);
    }
  }, [selectedTf, allValidZones]);

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
