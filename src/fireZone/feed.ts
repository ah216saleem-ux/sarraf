// src/fireZone/feed.ts
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  FireZoneCandle,
  FireZoneEngineResult,
  runFireZoneEngine,
  getClosedH1Signature,
  resetFireZoneEngineStore,
} from './engine';

import { FireZoneBacktestSummary, runFireZoneBacktest } from './backtest';
import { commandStore } from '../command/data/commandFeedStore';

export type FireZoneConnectionStatus = 'LIVE' | 'OFFLINE' | 'CONNECTING';

interface RawOhlcItem {
  openTime?: string | number;
  time?: string | number;
  open?: number | string;
  high?: number | string;
  low?: number | string;
  close?: number | string;
  volume?: number | string;
  tickVolume?: number | string;
}

export function normalizeCandle(item: RawOhlcItem): FireZoneCandle | null {
  if (!item) return null;
  let timeSec = 0;
  const rawT = item.time ?? item.openTime;
  if (typeof rawT === 'number') {
    timeSec = rawT > 10000000000 ? Math.floor(rawT / 1000) : rawT;
  } else if (typeof rawT === 'string') {
    const parsed = Date.parse(rawT);
    if (!isNaN(parsed)) timeSec = Math.floor(parsed / 1000);
  }
  if (!timeSec || isNaN(timeSec)) return null;

  const open = Number(item.open);
  const high = Number(item.high);
  const low = Number(item.low);
  const close = Number(item.close);
  const volume = Number(item.tickVolume ?? item.volume ?? 0);
  if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) return null;

  return { time: timeSec, open, high, low, close, volume: isNaN(volume) ? 0 : volume };
}

export function processRawCandles(rawBars: RawOhlcItem[], isNewestFirst = true): FireZoneCandle[] {
  if (!Array.isArray(rawBars) || rawBars.length === 0) return [];
  const list = isNewestFirst ? [...rawBars].reverse() : [...rawBars];
  const normalized: FireZoneCandle[] = [];
  const seenTimes = new Set<number>();

  for (const item of list) {
    const c = normalizeCandle(item);
    if (c && !seenTimes.has(c.time)) {
      seenTimes.add(c.time);
      normalized.push(c);
    }
  }
  normalized.sort((a, b) => a.time - b.time);
  return normalized;
}

export type ChartTimeframe = '15m' | '30m' | '1h' | '4h' | '1d';

async function fetchBiquoteCandles(
  interval: ChartTimeframe,
  limit: number
): Promise<RawOhlcItem[]> {
  const query = `interval=${interval}&limit=${limit}`;
  for (const url of [`https://biquote.io/api/XAUUSD/ohlc?${query}`, `/api/doji/ohlc?${query}`]) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const json = await res.json();
        const rawBars = json?.data?.bars || json?.bars || json?.candles || json?.data?.candles;
        if (Array.isArray(rawBars) && rawBars.length > 0) return rawBars;
      }
    } catch {
      // try next
    }
  }
  return [];
}

/**
 * Fetches and normalizes candles (newest-first reversed to chronological order)
 * strictly for the chart display timeframe (15m, 30m, 1h, 4h, 1d).
 * Never mutates the fixed H1 engine snapshot.
 */
export async function fetchChartCandlesByTimeframe(
  interval: ChartTimeframe,
  limit = 400
): Promise<FireZoneCandle[]> {
  const raw = await fetchBiquoteCandles(interval, limit);
  if (!raw || raw.length === 0) return [];
  return processRawCandles(raw, true);
}

async function fetchBiquoteQuote(): Promise<{ price: number; marketOpen?: boolean } | null> {
  for (const url of ['https://biquote.io/api/XAUUSD', '/api/xauusd']) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        const mid =
          typeof data.mid === 'number'
            ? data.mid
            : typeof data.price === 'number'
            ? data.price
            : typeof data.bid === 'number' && typeof data.ask === 'number'
            ? (data.bid + data.ask) / 2
            : null;
        if (mid && mid > 0) {
          const marketOpen =
            typeof data.marketOpen === 'boolean'
              ? data.marketOpen
              : data.status === 'open' || data.marketState === 'REGULAR';
          return { price: Number(mid.toFixed(2)), marketOpen };
        }
      }
    } catch {
      // try next
    }
  }
  return null;
}

interface ClosedSnapshotState {
  h1: FireZoneCandle[];
  h4: FireZoneCandle[];
  d1: FireZoneCandle[];
  signature: string;
}

/**
 * Fixed-basis Fire Zone Feed:
 * - Main basis: H1 candles (limit 400)
 * - Level ranking inputs: H4 (limit 300) and D1 (limit 300)
 * - Stability Rule: Zones and levels recompute ONLY when a new H1 candle CLOSES (or on first load),
 *   never on a live tick or UI change.
 */
export function useFireZoneFeed() {
  const [candles, setCandles] = useState<FireZoneCandle[]>([]);
  const [closedSnapshot, setClosedSnapshot] = useState<ClosedSnapshotState>({
    h1: [],
    h4: [],
    d1: [],
    signature: '',
  });
  const [dataReloadSeq, setDataReloadSeq] = useState<number>(0);
  const [currentPrice, setCurrentPrice] = useState<number>(() =>
    commandStore.currentPrice > 0 ? commandStore.currentPrice : 0
  );
  const [isMarketOpen, setIsMarketOpen] = useState<boolean>(() => commandStore.marketOpen ?? true);
  const [connectionStatus, setConnectionStatus] = useState<FireZoneConnectionStatus>('CONNECTING');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const candlesRef = useRef<FireZoneCandle[]>([]);
  candlesRef.current = candles;
  const currentPriceRef = useRef<number>(currentPrice);
  currentPriceRef.current = currentPrice;
  const h4Ref = useRef<FireZoneCandle[]>([]);
  const d1Ref = useRef<FireZoneCandle[]>([]);

  const loadCandles = useCallback(async () => {
    try {
      const [rawH1, rawH4, rawD1] = await Promise.all([
        fetchBiquoteCandles('1h', 400),
        fetchBiquoteCandles('4h', 300),
        fetchBiquoteCandles('1d', 300),
      ]);

      if (!rawH1 || rawH1.length === 0) {
        if (candlesRef.current.length === 0) setConnectionStatus('OFFLINE');
        return;
      }

      const h1Bars = processRawCandles(rawH1, true);
      const h4Bars = rawH4.length > 0 ? processRawCandles(rawH4, true) : h4Ref.current;
      const d1Bars = rawD1.length > 0 ? processRawCandles(rawD1, true) : d1Ref.current;

      if (h4Bars.length > 0) h4Ref.current = h4Bars;
      if (d1Bars.length > 0) d1Ref.current = d1Bars;

      if (h1Bars.length > 0) {
        setCandles(h1Bars);
        setConnectionStatus('LIVE');
        setLastUpdated(new Date());
        if (currentPriceRef.current <= 0) {
          setCurrentPrice(h1Bars[h1Bars.length - 1].close);
        }

        // Only update the closed-candle snapshot when a new H1 candle CLOSES (or on first load)
        const { signature } = getClosedH1Signature(h1Bars, h4Bars, d1Bars);
        setClosedSnapshot((prev) => {
          if (prev.signature === signature && prev.h1.length > 0) {
            return prev;
          }
          setDataReloadSeq((s) => s + 1);
          return {
            h1: h1Bars,
            h4: h4Bars,
            d1: d1Bars,
            signature,
          };
        });
      }
    } catch {
      if (candlesRef.current.length === 0) setConnectionStatus('OFFLINE');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    loadCandles();
  }, [loadCandles]);

  useEffect(() => {
    const timer = setInterval(() => loadCandles(), 45000);
    return () => clearInterval(timer);
  }, [loadCandles]);

  useEffect(() => {
    let isMounted = true;
    const updateLastCandleWithTick = (tickPrice: number) => {
      setCandles((prev) => {
        if (!prev || prev.length === 0) return prev;
        const lastIdx = prev.length - 1;
        const last = prev[lastIdx];
        if (last.close === tickPrice && last.high >= tickPrice && last.low <= tickPrice) return prev;
        const next = [...prev];
        next[lastIdx] = {
          ...last,
          close: tickPrice,
          high: Math.max(last.high, tickPrice),
          low: Math.min(last.low, tickPrice),
        };
        return next;
      });
    };

    const pollTick = async () => {
      if (commandStore.currentPrice > 0) {
        const p = Number(commandStore.currentPrice.toFixed(2));
        if (isMounted) {
          setCurrentPrice(p);
          setIsMarketOpen(commandStore.marketOpen ?? true);
          setConnectionStatus('LIVE');
          updateLastCandleWithTick(p);
        }
        return;
      }
      const quote = await fetchBiquoteQuote();
      if (!isMounted) return;
      if (quote && quote.price > 0) {
        setCurrentPrice(quote.price);
        if (typeof quote.marketOpen === 'boolean') setIsMarketOpen(quote.marketOpen);
        setConnectionStatus('LIVE');
        updateLastCandleWithTick(quote.price);
      } else if (candlesRef.current.length === 0 && currentPriceRef.current <= 0) {
        setConnectionStatus('OFFLINE');
      }
    };

    pollTick();
    const interval = setInterval(pollTick, 2000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const [simulatedPrice, setSimulatedPrice] = useState<number | null>(null);
  const [lifecycleSeq, setLifecycleSeq] = useState<number>(0);

  const effectiveCurrentPrice = simulatedPrice !== null ? simulatedPrice : currentPrice;

  const resetLifecycleDev = useCallback(() => {
    resetFireZoneEngineStore();
    setSimulatedPrice(null);
    setLifecycleSeq((s) => s + 1);
  }, []);

  const engineResult: FireZoneEngineResult = useMemo(() => {
    void lifecycleSeq;
    return runFireZoneEngine(
      closedSnapshot.h1,
      closedSnapshot.h4,
      closedSnapshot.d1,
      effectiveCurrentPrice > 0 ? effectiveCurrentPrice : undefined
    );
  }, [closedSnapshot, effectiveCurrentPrice, lifecycleSeq]);

  const backtestResult: FireZoneBacktestSummary = useMemo(
    () => runFireZoneBacktest(closedSnapshot.h1),
    [closedSnapshot]
  );

  return {
    candles,
    dataReloadSeq,
    currentPrice: effectiveCurrentPrice,
    simulatedPrice,
    setSimulatedPrice,
    resetLifecycleDev,
    isMarketOpen,
    connectionStatus,
    isLoading,
    lastUpdated,
    engineResult,
    backtestResult,
    refetch: loadCandles,
  };
}

