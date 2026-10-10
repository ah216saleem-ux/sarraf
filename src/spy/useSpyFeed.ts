/**
 * SPY Feed & Options Signal Hook
 * Subscribes to live SSE stream, provides market status, candles, analysis trigger, auto-scan, and history.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  SpyFeedState,
  SpyExpiryOption,
  SpyExpiryStatus,
  SpyAnalysisResult,
  SpyHistoryRecord,
  SpyHistoryStats,
  SpyCandle,
} from './types';

const INITIAL_FEED_STATE: SpyFeedState = {
  symbol: 'SPY',
  status: 'CONNECTING',
  currentPrice: null,
  changeDollar: null,
  changePercent: null,
  previousClose: null,
  dayHigh: null,
  dayLow: null,
  dayVolume: null,
  lastQuote: null,
  lastTrade: null,
  marketHours: {
    marketOpen: false,
    session: 'CLOSED',
    minutesToClose: 0,
    nextOpen: 'Checking schedule...',
    currentTimeET: '',
    isHoliday: false,
  },
  dataFreshnessMs: 0,
  isFresh: false,
  source: 'NONE',
  lastUpdated: new Date().toISOString(),
};

export function useSpyFeed() {
  const [feedState, setFeedState] = useState<SpyFeedState>(INITIAL_FEED_STATE);
  const [expiryOptions, setExpiryOptions] = useState<SpyExpiryStatus[]>([]);
  const [candles, setCandles] = useState<SpyCandle[]>([]);
  const [selectedTimeframe, setSelectedTimeframe] = useState<'1m' | '5m' | '15m' | '1h'>('15m');
  const [activeAnalysis, setActiveAnalysis] = useState<SpyAnalysisResult | null>(null);
  const [history, setHistory] = useState<SpyHistoryRecord[]>([]);
  const [stats, setStats] = useState<SpyHistoryStats | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const [priceFlash, setPriceFlash] = useState<'UP' | 'DOWN' | null>(null);

  // Poll status & stats
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/spy/status');
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setFeedState((prev) => {
            const nextPrice = json.data.currentPrice;
            if (nextPrice && prev.currentPrice && nextPrice !== prev.currentPrice) {
              setPriceFlash(nextPrice > prev.currentPrice ? 'UP' : 'DOWN');
              setTimeout(() => setPriceFlash(null), 800);
            }
            return json.data;
          });
        }
        if (Array.isArray(json.expiryOptions)) {
          setExpiryOptions(json.expiryOptions);
        }
        if (json.stats) {
          setStats(json.stats);
        }
      }
    } catch {
      // Background poll failure
    }
  }, []);

  // Fetch candle history
  const fetchCandles = useCallback(async (tf = selectedTimeframe) => {
    try {
      const res = await fetch(`/api/spy/candles?tf=${tf}`);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.candles)) {
          setCandles(json.candles);
        }
      }
    } catch {
      // Ignored
    }
  }, [selectedTimeframe]);

  // Fetch signal history & stats
  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/spy/history');
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.history)) {
          setHistory(json.history);
        }
        if (json.stats) {
          setStats(json.stats);
        }
      }
    } catch {
      // Ignored
    }
  }, []);

  // Connect SSE Stream
  useEffect(() => {
    fetchStatus();
    fetchCandles();
    fetchHistory();

    const connectSse = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const sse = new EventSource('/api/spy/feed');
      eventSourceRef.current = sse;

      sse.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.symbol === 'SPY') {
            setFeedState((prev) => {
              const newPrice = data.currentPrice;
              if (newPrice && prev.currentPrice && newPrice !== prev.currentPrice) {
                setPriceFlash(newPrice > prev.currentPrice ? 'UP' : 'DOWN');
                setTimeout(() => setPriceFlash(null), 800);
              }
              return data;
            });
          }
        } catch {
          // Ignore heartbeats
        }
      };

      sse.onerror = () => {
        sse.close();
        setTimeout(connectSse, 5000);
      };
    };

    connectSse();

    const interval = setInterval(() => {
      fetchStatus();
      fetchHistory();
    }, 4000);

    return () => {
      clearInterval(interval);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [fetchStatus, fetchCandles, fetchHistory]);

  // Re-fetch candles when timeframe changes
  useEffect(() => {
    fetchCandles(selectedTimeframe);
  }, [selectedTimeframe, fetchCandles]);

  // Trigger deterministic analysis for an expiry
  const runAnalysis = useCallback(
    async (expiry: SpyExpiryOption): Promise<SpyAnalysisResult | null> => {
      setIsAnalyzing(true);
      setAnalysisError(null);
      try {
        const res = await fetch('/api/spy/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiry }),
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
          const errMsg = json.error || 'Options analysis could not be completed.';
          setAnalysisError(errMsg);
          setIsAnalyzing(false);
          return null;
        }

        const result: SpyAnalysisResult = json.result;
        setActiveAnalysis(result);
        await fetchHistory();
        await fetchStatus();
        return result;
      } catch (err: any) {
        const errMsg = err.message || 'Network connection failed during analysis.';
        setAnalysisError(errMsg);
        return null;
      } finally {
        setIsAnalyzing(false);
      }
    },
    [fetchHistory, fetchStatus]
  );

  return {
    feedState,
    expiryOptions,
    candles,
    selectedTimeframe,
    setSelectedTimeframe,
    activeAnalysis,
    history,
    stats,
    isAnalyzing,
    analysisError,
    priceFlash,
    runAnalysis,
    refreshHistory: fetchHistory,
    refreshStatus: fetchStatus,
  };
}
