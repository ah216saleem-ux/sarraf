import { useState, useEffect, useRef, useCallback } from 'react';
import { SignalEnginePublicState, SignalSide, TelegramCommandStatus } from './types';
import { useCommandFeed } from '../data/useCommandFeed';
import { QuantumVortexHooks } from '../vortex/types';

const INITIAL_STATE: SignalEnginePublicState = {
  lifecycle: 'WAIT',
  activeSignal: null,
  cooldownRemainingSeconds: 0,
  cooldownEndsAt: null,
  paperMode: true,
  gates: [
    { id: 'g1', name: 'W1/D1 Context', shortName: 'D1 Context', timeframe: 'D1', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Scanning multi-timeframe context...' },
    { id: 'g2', name: 'H4 Bias', shortName: 'H4 Bias', timeframe: 'H4', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Scanning multi-timeframe context...' },
    { id: 'g3', name: 'H1 Confirmation', shortName: 'H1 Confirm', timeframe: 'H1', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Scanning multi-timeframe context...' },
    { id: 'g4', name: 'M30 Refinement', shortName: 'M30 Refine', timeframe: 'M30', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Scanning multi-timeframe context...' },
    { id: 'g5', name: 'M15 Body Close', shortName: 'M15 Close', timeframe: 'M15', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Scanning multi-timeframe context...' },
    { id: 'g6', name: 'M5 Retest', shortName: 'M5 Retest', timeframe: 'M5', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Scanning multi-timeframe context...', isEstimated: true },
    { id: 'g7', name: 'M5 Confirmation', shortName: 'M5 Confirm', timeframe: 'M5', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Scanning multi-timeframe context...', isEstimated: true },
    { id: 'g8', name: 'Entry Trigger', shortName: 'Tick Trigger', timeframe: 'TICK', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Scanning multi-timeframe context...' },
  ],
  gatesAllPassed: false,
  alignedDirection: null,
  waitReason: 'Scanning Ahmed Sniper Chain multi-timeframe convergence...',
  stats: {
    totalSignals: 0,
    winRate: 0,
    avgResultDollars: 0,
    totalPnLDollars: 0,
    winsCount: 0,
    lossesCount: 0,
    tp1Hits: 0,
    tp2Hits: 0,
    tp3Hits: 0,
    slHits: 0,
    manualCloses: 0,
  },
  history: [],
  lastEvaluatedAt: 0,
  feedStatus: 'LIVE',
  pathClearR: 0,
  confidence: 0,
};

const INITIAL_TELEGRAM_STATUS: TelegramCommandStatus = {
  configured: false,
  enabled: false,
  sendPaperSignals: false,
  status: 'DISABLED',
  lastMessageTime: null,
  lastMessageTimeStr: null,
  lastError: null,
  hasFailed: false,
  isAdmin: true,
};

export interface UseCommandSignalReturn {
  state: SignalEnginePublicState;
  telegramStatus: TelegramCommandStatus;
  livePnL: number;
  manualClose: () => Promise<void>;
  togglePaperMode: () => Promise<void>;
  resetCooldown: () => Promise<void>;
  triggerTestSignal: (side?: SignalSide) => Promise<void>;
  toggleTelegramMaster: (enabled?: boolean) => Promise<void>;
  toggleTelegramPaper: (sendPaper?: boolean) => Promise<void>;
  sendTelegramTest: () => Promise<{ success: boolean; message: string }>;
  registerVortexHooks: (hooks: QuantumVortexHooks) => void;
  isLoading: boolean;
  telegramLoading: boolean;
}

export function useCommandSignal(): UseCommandSignalReturn {
  const feed = useCommandFeed();
  const [state, setState] = useState<SignalEnginePublicState>(INITIAL_STATE);
  const [telegramStatus, setTelegramStatus] = useState<TelegramCommandStatus>(INITIAL_TELEGRAM_STATUS);
  const [isLoading, setIsLoading] = useState(false);
  const [telegramLoading, setTelegramLoading] = useState(false);

  // Vortex Hooks reference
  const vortexHooksRef = useRef<QuantumVortexHooks | null>(null);

  // Tracking previous lifecycle & signal for hook triggering
  const prevLifecycleRef = useRef<string>('WAIT');
  const prevSignalIdRef = useRef<string | null>(null);
  const prevHistoryLenRef = useRef<number>(0);

  const registerVortexHooks = useCallback((hooks: QuantumVortexHooks) => {
    vortexHooksRef.current = hooks;
  }, []);

  // Fetch signal state from server
  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/command/signal/state');
      if (!res.ok) return;
      const data: SignalEnginePublicState = await res.json();
      setState(data);

      // Check for vortex triggers
      const hooks = vortexHooksRef.current;
      if (hooks) {
        // Trigger Signal hook when entering ACTIVE with a new signal
        if (data.lifecycle === 'ACTIVE' && data.activeSignal) {
          if (data.activeSignal.id !== prevSignalIdRef.current) {
            prevSignalIdRef.current = data.activeSignal.id;
            hooks.triggerSignal(data.activeSignal.side);
          }
        }

        // Trigger Result hook when a signal just closed
        if (prevLifecycleRef.current === 'ACTIVE' && data.lifecycle !== 'ACTIVE') {
          if (data.history.length > 0 && data.history.length > prevHistoryLenRef.current) {
            const latestClosed = data.history[0];
            const isSL = latestClosed.result === 'SL' || latestClosed.pnlDollars < 0;
            hooks.triggerResult(isSL ? 'SL' : 'TP');
          }
        }

        // Trigger Cooldown hook
        if (data.lifecycle === 'COOLDOWN') {
          hooks.setCooldown(data.cooldownRemainingSeconds);
        }
      }

      prevLifecycleRef.current = data.lifecycle;
      prevHistoryLenRef.current = data.history.length;
    } catch {
      // Graceful fallback on network glitch
    }
  }, []);

  // Fetch Telegram status from server
  const fetchTelegramStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/command/telegram/status');
      if (!res.ok) return;
      const data: TelegramCommandStatus = await res.json();
      setTelegramStatus(data);
    } catch {
      // Ignore network errors
    }
  }, []);

  // Regular server poll every 1000ms
  useEffect(() => {
    fetchState();
    fetchTelegramStatus();
    const interval = setInterval(() => {
      fetchState();
      fetchTelegramStatus();
    }, 1000);
    return () => clearInterval(interval);
  }, [fetchState, fetchTelegramStatus]);

  // Compute sub-second live PnL smoothly from feed.currentPrice
  const livePnL = state.activeSignal && feed.currentPrice > 0
    ? (state.activeSignal.side === 'BUY'
        ? Number((feed.currentPrice - state.activeSignal.entry).toFixed(2))
        : Number((state.activeSignal.entry - feed.currentPrice).toFixed(2)))
    : 0;

  // Signal Actions
  const manualClose = useCallback(async () => {
    try {
      setIsLoading(true);
      await fetch('/api/command/signal/close', { method: 'POST' });
      await fetchState();
    } finally {
      setIsLoading(false);
    }
  }, [fetchState]);

  const togglePaperMode = useCallback(async () => {
    try {
      setIsLoading(true);
      await fetch('/api/command/signal/toggle-paper', { method: 'POST' });
      await fetchState();
    } finally {
      setIsLoading(false);
    }
  }, [fetchState]);

  const resetCooldown = useCallback(async () => {
    try {
      setIsLoading(true);
      await fetch('/api/command/signal/reset-cooldown', { method: 'POST' });
      await fetchState();
    } finally {
      setIsLoading(false);
    }
  }, [fetchState]);

  const triggerTestSignal = useCallback(async (side: SignalSide = 'BUY') => {
    try {
      setIsLoading(true);
      await fetch('/api/command/signal/test-trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ side }),
      });
      await fetchState();
    } finally {
      setIsLoading(false);
    }
  }, [fetchState]);

  // Telegram Actions
  const toggleTelegramMaster = useCallback(async (enabled?: boolean) => {
    try {
      setTelegramLoading(true);
      const res = await fetch('/api/command/telegram/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(typeof enabled === 'boolean' ? { enabled } : {}),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.settings) setTelegramStatus(data.settings);
      }
    } finally {
      setTelegramLoading(false);
      fetchTelegramStatus();
    }
  }, [fetchTelegramStatus]);

  const toggleTelegramPaper = useCallback(async (sendPaper?: boolean) => {
    try {
      setTelegramLoading(true);
      const res = await fetch('/api/command/telegram/toggle-paper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(typeof sendPaper === 'boolean' ? { sendPaperSignals: sendPaper } : {}),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.settings) setTelegramStatus(data.settings);
      }
    } finally {
      setTelegramLoading(false);
      fetchTelegramStatus();
    }
  }, [fetchTelegramStatus]);

  const sendTelegramTest = useCallback(async (): Promise<{ success: boolean; message: string }> => {
    try {
      setTelegramLoading(true);
      const res = await fetch('/api/command/telegram/test', { method: 'POST' });
      const data = await res.json();
      await fetchTelegramStatus();
      return {
        success: Boolean(data.success),
        message: data.message || (data.success ? 'Message sent' : 'Dispatch failed'),
      };
    } catch (err: any) {
      await fetchTelegramStatus();
      return { success: false, message: err.message || 'Network error' };
    } finally {
      setTelegramLoading(false);
    }
  }, [fetchTelegramStatus]);

  return {
    state,
    telegramStatus,
    livePnL,
    manualClose,
    togglePaperMode,
    resetCooldown,
    triggerTestSignal,
    toggleTelegramMaster,
    toggleTelegramPaper,
    sendTelegramTest,
    registerVortexHooks,
    isLoading,
    telegramLoading,
  };
}
