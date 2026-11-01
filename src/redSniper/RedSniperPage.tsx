import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Settings } from 'lucide-react';
import {
  RED_SNIPER_TIMEFRAMES,
  RedSniperTimeframe,
  useRedSniperFeed,
} from './feed';
import {
  analyzeAllTimeframes,
  BotLogEntry,
  buildZoneTradeParameters,
  ClosedSniperTrade,
  computeBotStatusLine,
  computeDeadAtrComparison,
  computeOpenTradeFloatingPnl,
  computePerformanceMetrics,
  computePowerCalibration,
  computeZoneProximityScore,
  createInitialReplaySession,
  DEFAULT_RED_SNIPER_SETTINGS,
  detectNewZoneBotLogs,
  detectRuntimeZoneEvents,
  formatBotLogForClipboard,
  formatSeparatedBotLogForClipboard,
  formatReplayWindowLabel,
  getZoneDistancePts,
  isZoneNear,
  loadBotLogFromLocalStorage,
  loadSeparatedBotLogsFromLocalStorage,
  loadDemoState,
  loadRedSniperSettings,
  mergeBotLogEntries,
  mergeSeparatedBotLogEntries,
  OpenSniperTrade,
  RED_SNIPER_ZONE_ENGINE_VERSION,
  RedSniperDemoState,
  RedSniperSettings,
  ReplaySessionState,
  resolveDefaultRetestModeForTf,
  RetestMode,
  saveBotLogToLocalStorage,
  saveSeparatedBotLogsToLocalStorage,
  saveDemoState,
  saveRedSniperSettings,
  stepAutoTraderOnTick,
  stepReplayM1Bar,
  TfBias,
} from './engine';
import { RedSniperChart } from './RedSniperChart';
import { RedSniperDebugPanel, RedSniperHealthData } from './RedSniperDebugPanel';

const HUD_CLIP =
  'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px))';
const HUD_CLIP_SM =
  'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))';

function formatHudDate(d: Date): string {
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const months = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ];
  const dayName = days[d.getDay()];
  const dayNum = String(d.getDate()).padStart(2, '0');
  const monName = months[d.getMonth()];
  const year = d.getFullYear();
  return `${dayName}, ${dayNum} ${monName} ${year}`;
}

function formatTfLabel(tf: RedSniperTimeframe): string {
  if (tf === '1h') return '1H';
  if (tf === '4h') return '4H';
  if (tf === '1d') return '1D';
  return tf;
}

function biasBadgeColor(bias: TfBias): { text: string; border: string; bg: string } {
  if (bias === 'BULL') {
    return {
      text: '#00e676',
      border: 'rgba(0, 230, 118, 0.45)',
      bg: 'rgba(0, 230, 118, 0.08)',
    };
  }
  if (bias === 'BEAR') {
    return {
      text: '#ff2d45',
      border: 'rgba(255, 45, 69, 0.45)',
      bg: 'rgba(255, 45, 69, 0.1)',
    };
  }
  return {
    text: '#ffab00',
    border: 'rgba(255, 171, 0, 0.45)',
    bg: 'rgba(255, 171, 0, 0.08)',
  };
}

export const RedSniperPage: React.FC = () => {
  const {
    bars,
    historyDiagnostics,
    livePrice,
    bid,
    ask,
    spread,
    connectionStatus,
    isMarketClosed,
    isLoading,
    session,
    rolling60sFlow,
  } = useRedSniperFeed();

  const [selectedTf, setSelectedTf] = useState<RedSniperTimeframe>('1h');
  const [demoState, setDemoState] = useState<RedSniperDemoState>(() => loadDemoState());
  const [settings, setSettings] = useState<RedSniperSettings>(() =>
    loadRedSniperSettings()
  );
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [copiedDebug, setCopiedDebug] = useState<boolean>(false);
  const [copiedBotLog, setCopiedBotLog] = useState<boolean>(false);
  const [showDebugPanel, setShowDebugPanel] = useState<boolean>(false);
  const [serverHealth, setServerHealth] = useState<RedSniperHealthData | null>(null);
  const initialLogs = loadSeparatedBotLogsFromLocalStorage();
  const [tradeLogs, setTradeLogs] = useState<BotLogEntry[]>(initialLogs.tradeLogs);
  const [zoneLogs, setZoneLogs] = useState<BotLogEntry[]>(initialLogs.zoneLogs);
  const [activeBotLogTab, setActiveBotLogTab] = useState<'trade' | 'zone'>('trade');

  const knownZoneIdsRef = useRef<Set<string>>(new Set());
  const nearLoggedZoneIdsRef = useRef<Set<string>>(new Set());
  const deadLoggedZoneIdsRef = useRef<Set<string>>(new Set());
  const isInitialZoneLoadRef = useRef<boolean>(true);

  const seenZoneIdsRef = useRef<Set<string>>(new Set());
  const [lastEnteredDecision, setLastEnteredDecision] = useState<string | null>(null);
  const [nowDate, setNowDate] = useState<Date>(() => new Date());
  const [highlightedZoneId, setHighlightedZoneId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [replaySession, setReplaySession] = useState<ReplaySessionState | null>(null);

  // Sync persistent BOT LOG with server file on mount
  useEffect(() => {
    let cancelled = false;
    fetch('/api/redsniper/bot-log', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const serverEntries = Array.isArray(data.entries) ? data.entries : Array.isArray(data.tradeLogs) ? [...data.tradeLogs, ...(data.zoneLogs || [])] : [];
        if (serverEntries.length === 0) return;
        const separated = mergeSeparatedBotLogEntries(tradeLogs, zoneLogs, serverEntries, 1000, 100);
        setTradeLogs(separated.tradeLogs);
        setZoneLogs(separated.zoneLogs);
        saveSeparatedBotLogsToLocalStorage(separated.tradeLogs, separated.zoneLogs);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll /api/redsniper/health for live server SQLite store telemetry
  useEffect(() => {
    let cancelled = false;
    const fetchHealth = () => {
      fetch('/api/redsniper/health', { credentials: 'include' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!cancelled && data && data.ok) {
            setServerHealth(data);
          }
        })
        .catch(() => {});
    };
    fetchHealth();
    const interval = setInterval(fetchHealth, 12000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const appendTradeLogs = useCallback((entries: BotLogEntry[]) => {
    if (!entries || entries.length === 0) return;
    setTradeLogs((prev) => {
      const separated = mergeSeparatedBotLogEntries(prev, zoneLogs, entries, 1000, 100);
      saveSeparatedBotLogsToLocalStorage(separated.tradeLogs, separated.zoneLogs);
      return separated.tradeLogs;
    });
    fetch('/api/redsniper/bot-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ entries }),
    }).catch(() => {});
  }, [zoneLogs]);

  const handleCopyBotLog = useCallback(() => {
    const text = formatSeparatedBotLogForClipboard(tradeLogs, zoneLogs);
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedBotLog(true);
    setTimeout(() => setCopiedBotLog(false), 1800);
  }, [tradeLogs, zoneLogs]);

  const handleClearBotLog = useCallback(() => {
    setTradeLogs([]);
    setZoneLogs([]);
    saveSeparatedBotLogsToLocalStorage([], []);
    fetch('/api/redsniper/bot-log', { method: 'DELETE', credentials: 'include' }).catch(() => {});
  }, []);

  const handleHighlightZone = useCallback((zoneId: string) => {
    setHighlightedZoneId(zoneId);
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedZoneId(null);
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  // Clear highlight when switching timeframe
  useEffect(() => {
    setHighlightedZoneId(null);
  }, [selectedTf]);

  const updateSettings = useCallback((patch: Partial<RedSniperSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveRedSniperSettings(next);
      return next;
    });
  }, []);

  const handleResetSettings = useCallback(() => {
    const def = { ...DEFAULT_RED_SNIPER_SETTINGS };
    saveRedSniperSettings(def);
    setSettings(def);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNowDate(new Date()), 5_000);
    return () => clearInterval(t);
  }, []);

  const hasLiveFeed =
    livePrice !== null && Number.isFinite(livePrice) && livePrice > 0;
  const isFeedReady = connectionStatus === 'CONNECTED' || hasLiveFeed;

  // Run Red Sniper base zone pipeline across all 8 timeframes on closed candles + livePrice
  const { byTf, allZones, mergedZones, verdict } = useMemo(
    () => analyzeAllTimeframes(bars, livePrice, settings),
    [bars, livePrice, settings]
  );

  // Log runtime zone events (ZONE_NEW, ZONE_NEAR, ZONE_DEAD)
  useEffect(() => {
    if (allZones.length === 0) return;
    if (isInitialZoneLoadRef.current) {
      detectRuntimeZoneEvents({
        allZones,
        knownZoneIds: knownZoneIdsRef.current,
        nearLoggedZoneIds: nearLoggedZoneIdsRef.current,
        deadLoggedZoneIds: deadLoggedZoneIdsRef.current,
        livePrice,
        isInitialLoad: true,
      });
      isInitialZoneLoadRef.current = false;
      return;
    }
    const currentTfAnalysis = byTf[selectedTf];
    const deadZones = currentTfAnalysis?.debugAliveZones?.filter((z) => z.reasonDropped === 'dead:closeBeyond') || [];
    const zoneEvents = detectRuntimeZoneEvents({
      allZones,
      knownZoneIds: knownZoneIdsRef.current,
      nearLoggedZoneIds: nearLoggedZoneIdsRef.current,
      deadLoggedZoneIds: deadLoggedZoneIdsRef.current,
      livePrice,
      deadZones,
      nowMs: Date.now(),
      isInitialLoad: false,
    });
    if (zoneEvents.length > 0) {
      setZoneLogs((prev) => {
        const merged = mergeBotLogEntries(prev, zoneEvents, 100);
        saveSeparatedBotLogsToLocalStorage(tradeLogs, merged);
        return merged;
      });
    }
  }, [allZones, livePrice, selectedTf, byTf, tradeLogs]);

  // Step auto-trader on every live tick (blocks new entries when isMarketClosed is true; resumes automatically on first fresh tick)
  useEffect(() => {
    if (!hasLiveFeed || livePrice === null) return;
    if (replaySession?.isRunning) return; // Never mix live demo execution while replay is running
    let emittedLogs: BotLogEntry[] = [];
    setDemoState((prev) => {
      const { nextState, changed, enteredText, botLogs } = stepAutoTraderOnTick(
        prev,
        livePrice,
        allZones,
        verdict.bias1h,
        verdict.bias4h,
        session.name,
        Date.now(),
        settings,
        isMarketClosed
      );
      if (enteredText) {
        setLastEnteredDecision(enteredText);
      }
      if (botLogs.length > 0) {
        emittedLogs = botLogs;
      }
      if (changed) {
        saveDemoState(nextState);
        return nextState;
      }
      return prev;
    });
    if (emittedLogs.length > 0) {
      appendTradeLogs(emittedLogs);
    }
  }, [
    livePrice,
    hasLiveFeed,
    allZones,
    verdict.bias1h,
    verdict.bias4h,
    session.name,
    settings,
    isMarketClosed,
    replaySession?.isRunning,
    appendTradeLogs,
  ]);

  // Replay 24h M1 candles at 20x speed using isolated demo account & history
  useEffect(() => {
    if (!replaySession || !replaySession.isRunning) return;
    const m1Bars = bars['1m'] || [];
    if (m1Bars.length < 30) {
      setReplaySession((prev) => (prev ? { ...prev, isRunning: false, isFinished: true } : null));
      return;
    }
    const timer = setInterval(() => {
      setReplaySession((prev) => {
        if (!prev || !prev.isRunning) return prev;
        // Advance 4 M1 bars per 200ms tick (~20 bars/sec fast 20x replay)
        let cur = prev;
        for (let step = 0; step < 4; step++) {
          cur = stepReplayM1Bar(cur, bars, settings);
          if (!cur.isRunning || cur.isFinished) break;
        }
        return cur;
      });
    }, 200);
    return () => clearInterval(timer);
  }, [replaySession?.isRunning, bars, settings]);

  const handleStartReplay = useCallback(() => {
    const m1Bars = bars['1m'] || [];
    if (m1Bars.length < 30) return;
    setReplaySession(createInitialReplaySession(m1Bars));
  }, [bars]);

  const handleStopReplay = useCallback(() => {
    setReplaySession((prev) =>
      prev ? { ...prev, isRunning: false, isFinished: true } : null
    );
  }, []);

  const handleClearReplay = useCallback(() => {
    setReplaySession(null);
  }, []);

  // Active state shown in account/trades/history cards (isolated replay state when replay is active, else live demoState)
  const activeDisplayState =
    replaySession && (replaySession.isRunning || replaySession.isFinished)
      ? replaySession.demoState
      : demoState;
  const activeDisplayPrice =
    replaySession && replaySession.isRunning && replaySession.currentPrice !== null
      ? replaySession.currentPrice
      : livePrice;

  // Bot status decision line updated on every tick
  const botStatusLine = useMemo(
    () =>
      computeBotStatusLine(
        demoState,
        livePrice,
        allZones,
        verdict.bias1h,
        verdict.bias4h,
        lastEnteredDecision,
        settings,
        isMarketClosed
      ),
    [
      demoState,
      livePrice,
      allZones,
      verdict.bias1h,
      verdict.bias4h,
      lastEnteredDecision,
      settings,
      isMarketClosed,
    ]
  );

  const handleToggleAuto = useCallback(() => {
    setDemoState((prev) => {
      const next: RedSniperDemoState = {
        ...prev,
        autoEnabled: !prev.autoEnabled,
      };
      saveDemoState(next);
      return next;
    });
  }, []);

  const handleManualCloseTrade = useCallback(
    (tradeId: string) => {
      if (livePrice === null || !Number.isFinite(livePrice)) return;
      let manualExitLog: BotLogEntry | null = null;
      setDemoState((prev) => {
        const target = prev.openTrades.find((t) => t.id === tradeId);
        if (!target) return prev;
        const { totalPnl, currentR } = computeOpenTradeFloatingPnl(target, livePrice);
        const nowMs = Date.now();
        const closedItem: ClosedSniperTrade = {
          id: target.id,
          zoneId: target.zoneId,
          time: nowMs,
          tf: target.tf,
          side: target.side,
          entry: target.entry,
          exit: livePrice,
          pnl: totalPnl,
          r: currentR,
          result: 'MANUAL',
          session: target.session,
          power: target.power,
          class: target.tp2Hit ? 'win' : currentR >= 0 ? 'be' : 'loss',
        };
        manualExitLog = {
          id: `exit-manual-${target.id}-${nowMs}`,
          ts: nowMs,
          isoTime: new Date(nowMs).toISOString(),
          type: 'EXIT',
          tf: target.tf,
          side: target.side,
          zoneId: target.zoneId,
          tradeId: target.id,
          message: `Exit [MANUAL]: ${target.side} ${target.tf.toUpperCase()} @ $${livePrice.toFixed(2)} (PnL ${totalPnl >= 0 ? '+' : '-'}$${Math.abs(totalPnl).toFixed(2)}, ${currentR >= 0 ? '+' : ''}${currentR.toFixed(2)}R)`,
        };
        const next: RedSniperDemoState = {
          ...prev,
          balance: Number((prev.balance + totalPnl).toFixed(2)),
          openTrades: prev.openTrades.filter((t) => t.id !== tradeId),
          closedTrades: [closedItem, ...prev.closedTrades].slice(0, 200),
        };
        saveDemoState(next);
        return next;
      });
      if (manualExitLog) {
        appendTradeLogs([manualExitLog]);
      }
    },
    [livePrice, appendTradeLogs]
  );

  const handleResetDemo = useCallback(() => {
    const fresh: RedSniperDemoState = {
      balance: 1000,
      autoEnabled: demoState.autoEnabled,
      openTrades: [],
      closedTrades: [],
      usedZoneIds: [],
    };
    saveDemoState(fresh);
    setDemoState(fresh);
    setLastEnteredDecision(null);
  }, [demoState.autoEnabled]);

  // Compute Open P&L and Equity
  const openPnl = useMemo(() => {
    if (activeDisplayPrice === null || !Number.isFinite(activeDisplayPrice)) return 0;
    return Number(
      activeDisplayState.openTrades
        .reduce(
          (acc, t) => acc + computeOpenTradeFloatingPnl(t, activeDisplayPrice).totalPnl,
          0
        )
        .toFixed(2)
    );
  }, [activeDisplayState.openTrades, activeDisplayPrice]);

  const equity = Number((activeDisplayState.balance + openPnl).toFixed(2));

  // Compute LIVE TICK VOLUME metrics
  const m1VolumeStats = useMemo(() => {
    const m1 = bars['1m'] || [];
    if (m1.length === 0) {
      return {
        currentVol: null as number | null,
        lastClosedVol: null as number | null,
        projectedVol: null as number | null,
        projMult: null as number | null,
      };
    }

    const formingBar = m1[m1.length - 1];
    const lastClosedBar = m1.length >= 2 ? m1[m1.length - 2] : null;
    const closed30 = m1.slice(Math.max(0, m1.length - 31), m1.length - 1);

    const avg30Closed =
      closed30.length > 0
        ? closed30.reduce((s, b) => s + b.tickVolume, 0) / closed30.length
        : formingBar.tickVolume || 1;

    const nowSec = Math.floor(Date.now() / 1000);
    const elapsedInMinute = Math.max(5, Math.min(60, nowSec - formingBar.time));
    const projectedVol = Math.round((formingBar.tickVolume / elapsedInMinute) * 60);
    const projMult =
      avg30Closed > 0 ? Number((projectedVol / avg30Closed).toFixed(1)) : 1.0;

    return {
      currentVol: formingBar.tickVolume,
      lastClosedVol: lastClosedBar ? lastClosedBar.tickVolume : null,
      projectedVol,
      projMult,
    };
  }, [bars, livePrice, nowDate]);

  // Filter zones within farAtr * ATR14 (non-FAR) and non-consumed (unless showConsumedZones is enabled) by default
  const nearZones = useMemo(() => {
    const base = allZones.filter(
      (z) => !z.isFar && (settings.showConsumedZones || !z.consumed)
    );
    if (!hasLiveFeed || livePrice === null) return base;
    return base.filter((z) => isZoneNear(z, livePrice, settings.farAtr));
  }, [
    allZones,
    hasLiveFeed,
    livePrice,
    settings.farAtr,
    settings.showConsumedZones,
  ]);

  const sortedStrongZones = useMemo(() => {
    const source = settings.showFarZones
      ? mergedZones
      : mergedZones.filter((z) => !z.isFar);
    if (!hasLiveFeed || livePrice === null) {
      return [...source].sort((a, b) => b.power - a.power);
    }
    return [...source].sort(
      (a, b) =>
        computeZoneProximityScore(b, livePrice) -
        computeZoneProximityScore(a, livePrice)
    );
  }, [mergedZones, settings.showFarZones, hasLiveFeed, livePrice]);

  // Nearest pending trade plan (using near qualifying FRESH/TESTED zones ranked by proximity/power)
  const pendingPlan = useMemo(() => {
    if (!hasLiveFeed || livePrice === null || nearZones.length === 0) return null;
    const qualifying = nearZones.filter(
      (z) =>
        (z.status === 'FRESH' || z.status === 'TESTED') &&
        z.power >= settings.minPowerToTrade
    );
    const pool =
      qualifying.length > 0
        ? qualifying
        : nearZones.filter((z) => z.status === 'FRESH' || z.status === 'TESTED');
    if (pool.length === 0) return null;

    const sortedByDist = [...pool].sort(
      (a, b) =>
        getZoneDistancePts(a, livePrice) - getZoneDistancePts(b, livePrice) ||
        computeZoneProximityScore(b, livePrice) -
          computeZoneProximityScore(a, livePrice)
    );

    const nearest = sortedByDist[0];
    if (!nearest) return null;

    const insideNow = livePrice >= nearest.bottom && livePrice <= nearest.top;
    const refEntry = insideNow
      ? livePrice
      : nearest.side === 'BUY'
      ? nearest.top
      : nearest.bottom;

    const plan = buildZoneTradeParameters(
      nearest,
      refEntry,
      demoState.balance,
      allZones,
      verdict.bias1h,
      verdict.bias4h,
      settings
    );

    const liveDistPts = getZoneDistancePts(nearest, livePrice);
    return {
      ...plan,
      insideZone: insideNow,
      distance: liveDistPts,
    };
  }, [
    hasLiveFeed,
    livePrice,
    nearZones,
    allZones,
    demoState.balance,
    verdict.bias1h,
    verdict.bias4h,
    settings,
  ]);

  // Real M1 history window info ("Replay window: 4h58m of real M1, 301 candles")
  const m1WindowInfo = useMemo(
    () => formatReplayWindowLabel(bars['1m'] || []),
    [bars]
  );

  // Historical performance metrics (requires n >= 10 and >= 12h M1 window for confident summary)
  const perf = useMemo(
    () =>
      computePerformanceMetrics(
        activeDisplayState.closedTrades,
        m1WindowInfo.windowSeconds
      ),
    [activeDisplayState.closedTrades, m1WindowInfo.windowSeconds]
  );

  // Power Calibration across real loaded candles (D.1)
  const powerCalibration = useMemo(
    () => computePowerCalibration(bars, settings),
    [bars, settings]
  );

  const currentTfAnalysis = byTf[selectedTf];
  const currentTfCandles = bars[selectedTf] || [];
  const currentTfZones = currentTfAnalysis?.zones || [];
  const currentTfBuyCount = currentTfZones.filter((z) => z.side === 'BUY').length;
  const currentTfSellCount = currentTfZones.filter((z) => z.side === 'SELL').length;

  const activeRetestModeForTf: RetestMode = settings.retestModeOverride
    ? settings.retestMode
    : resolveDefaultRetestModeForTf(selectedTf);

  const handleCopyZoneDebug = useCallback(() => {
    const barsLoadedByTf: Record<
      RedSniperTimeframe,
      {
        barsLoaded: number;
        oldestCandleTime: number | null;
        oldestCandleIso: string | null;
        source: 'store' | 'broker';
        builtFromM1: boolean;
      }
    > = {
      '1m': {
        barsLoaded: bars['1m']?.length ?? 0,
        oldestCandleTime: bars['1m']?.[0]?.time ?? null,
        oldestCandleIso: bars['1m']?.[0]
          ? new Date(bars['1m'][0].time * 1000).toISOString()
          : null,
        source: historyDiagnostics['1m']?.source ?? 'broker',
        builtFromM1: historyDiagnostics['1m']?.builtFromM1 ?? false,
      },
      '3m': {
        barsLoaded: bars['3m']?.length ?? 0,
        oldestCandleTime: bars['3m']?.[0]?.time ?? null,
        oldestCandleIso: bars['3m']?.[0]
          ? new Date(bars['3m'][0].time * 1000).toISOString()
          : null,
        source: historyDiagnostics['3m']?.source ?? 'broker',
        builtFromM1: historyDiagnostics['3m']?.builtFromM1 ?? false,
      },
      '5m': {
        barsLoaded: bars['5m']?.length ?? 0,
        oldestCandleTime: bars['5m']?.[0]?.time ?? null,
        oldestCandleIso: bars['5m']?.[0]
          ? new Date(bars['5m'][0].time * 1000).toISOString()
          : null,
        source: historyDiagnostics['5m']?.source ?? 'broker',
        builtFromM1: historyDiagnostics['5m']?.builtFromM1 ?? false,
      },
      '15m': {
        barsLoaded: bars['15m']?.length ?? 0,
        oldestCandleTime: bars['15m']?.[0]?.time ?? null,
        oldestCandleIso: bars['15m']?.[0]
          ? new Date(bars['15m'][0].time * 1000).toISOString()
          : null,
        source: historyDiagnostics['15m']?.source ?? 'broker',
        builtFromM1: historyDiagnostics['15m']?.builtFromM1 ?? false,
      },
      '30m': {
        barsLoaded: bars['30m']?.length ?? 0,
        oldestCandleTime: bars['30m']?.[0]?.time ?? null,
        oldestCandleIso: bars['30m']?.[0]
          ? new Date(bars['30m'][0].time * 1000).toISOString()
          : null,
        source: historyDiagnostics['30m']?.source ?? 'broker',
        builtFromM1: historyDiagnostics['30m']?.builtFromM1 ?? false,
      },
      '1h': {
        barsLoaded: bars['1h']?.length ?? 0,
        oldestCandleTime: bars['1h']?.[0]?.time ?? null,
        oldestCandleIso: bars['1h']?.[0]
          ? new Date(bars['1h'][0].time * 1000).toISOString()
          : null,
        source: historyDiagnostics['1h']?.source ?? 'broker',
        builtFromM1: historyDiagnostics['1h']?.builtFromM1 ?? false,
      },
      '4h': {
        barsLoaded: bars['4h']?.length ?? 0,
        oldestCandleTime: bars['4h']?.[0]?.time ?? null,
        oldestCandleIso: bars['4h']?.[0]
          ? new Date(bars['4h'][0].time * 1000).toISOString()
          : null,
        source: historyDiagnostics['4h']?.source ?? 'broker',
        builtFromM1: historyDiagnostics['4h']?.builtFromM1 ?? false,
      },
      '1d': {
        barsLoaded: bars['1d']?.length ?? 0,
        oldestCandleTime: bars['1d']?.[0]?.time ?? null,
        oldestCandleIso: bars['1d']?.[0]
          ? new Date(bars['1d'][0].time * 1000).toISOString()
          : null,
        source: historyDiagnostics['1d']?.source ?? 'broker',
        builtFromM1: historyDiagnostics['1d']?.builtFromM1 ?? false,
      },
    };
    const deadAtrComparison = computeDeadAtrComparison(
      currentTfCandles,
      selectedTf,
      livePrice,
      settings
    );
    const payload = {
      zoneEngineVersion: RED_SNIPER_ZONE_ENGINE_VERSION,
      tf: selectedTf,
      barsLoaded: currentTfCandles.length,
      oldestCandleTime: currentTfCandles[0]?.time ?? null,
      oldestCandleIso: currentTfCandles[0]
        ? new Date(currentTfCandles[0].time * 1000).toISOString()
        : null,
      source: historyDiagnostics[selectedTf]?.source ?? 'broker',
      barsLoadedByTf,
      historyDiagnosticsForTf: historyDiagnostics[selectedTf] ?? null,
      historyDiagnosticsByTf: historyDiagnostics,
      atr14: currentTfAnalysis ? Number(currentTfAnalysis.atr14.toFixed(4)) : null,
      livePrice,
      retestModeUsed: currentTfAnalysis?.retestModeUsed ?? activeRetestModeForTf,
      deadAtr: settings.deadAtr,
      farAtr: settings.farAtr,
      heightCapAtr: settings.heightCapAtr,
      showConsumedZones: settings.showConsumedZones,
      deadAtrComparison,
      zonesBeforeSelection: currentTfAnalysis?.debugAliveZones ?? [],
      serverHealth: serverHealth || null,
      calibration: {
        totalResolved: powerCalibration.totalResolved,
        independentSamplesCount: powerCalibration.independentSamplesCount,
        sampleAudit: powerCalibration.sampleAudit,
      },
    };
    const jsonText = JSON.stringify(payload, null, 2);
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(jsonText).catch(() => {});
    }
    setCopiedDebug(true);
    setTimeout(() => setCopiedDebug(false), 1800);
  }, [
    selectedTf,
    bars,
    historyDiagnostics,
    currentTfCandles,
    currentTfAnalysis,
    livePrice,
    activeRetestModeForTf,
    settings,
    serverHealth,
  ]);

  // SVG Donut math for TP2 Win Rate
  const donutRadius = 32;
  const donutCircumference = 2 * Math.PI * donutRadius;
  const winStroke = (perf.tp2WinRatePct / 100) * donutCircumference;

  return (
    <div
      className="mx-auto w-full max-w-[540px] bg-black px-2.5 pb-12 pt-2 text-[#f2f4f8] select-none"
      style={{ fontFamily: "'Rajdhani', sans-serif" }}
    >
      {/* D.2) Red REPLAY Banner while running or finished */}
      {replaySession && (
        <div
          className="mb-2.5 border border-[#ff2d45] bg-[#1e0408] p-3 text-xs shadow-[0_0_20px_rgba(255,45,69,0.28)]"
          style={{ fontFamily: "'JetBrains Mono', monospace", clipPath: HUD_CLIP_SM }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 animate-pulse bg-[#ff2d45]" />
              <span
                className="text-xs font-extrabold tracking-[0.2em] text-[#ff2d45]"
                style={{ fontFamily: "'Orbitron', sans-serif" }}
              >
                {replaySession.isRunning
                  ? 'REPLAY — NOT LIVE (20x)'
                  : 'REPLAY SUMMARY — NOT LIVE'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {replaySession.isRunning ? (
                <button
                  type="button"
                  onClick={handleStopReplay}
                  className="cursor-pointer border border-[#ff2d45] bg-[#ff2d45] px-2.5 py-0.5 text-[10px] font-extrabold text-black"
                  style={{ fontFamily: "'Orbitron', sans-serif" }}
                >
                  STOP
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleClearReplay}
                  className="cursor-pointer border border-white/30 bg-black px-2.5 py-0.5 text-[10px] font-bold text-white hover:border-[#ff2d45] hover:text-[#ff2d45]"
                  style={{ fontFamily: "'Orbitron', sans-serif" }}
                >
                  EXIT REPLAY
                </button>
              )}
            </div>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-300">
            <span>
              Bar {replaySession.currentIndex} / {replaySession.totalBars}
              {replaySession.currentPrice
                ? ` · $${replaySession.currentPrice.toFixed(2)}`
                : ''}
            </span>
            <span>
              Isolated Bal: ${replaySession.demoState.balance.toFixed(2)} · Max DD: $
              {replaySession.maxDrawdownDollars.toFixed(2)} (
              {replaySession.maxDrawdownPct.toFixed(2)}%)
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-amber-300">
            <span>{replaySession.windowLabel}</span>
            {!replaySession.isReliableSample && (
              <span className="border border-amber-400/60 bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-extrabold text-amber-300">
                SMALL SAMPLE - NOT RELIABLE
              </span>
            )}
          </div>

          {replaySession.isFinished && (
            <div className="mt-2.5 border-t border-[#ff2d45]/30 pt-2">
              {(() => {
                const rPerf = computePerformanceMetrics(
                  replaySession.demoState.closedTrades,
                  replaySession.windowSeconds
                );
                return (
                  <div className="space-y-1.5">
                    {!rPerf.isReliableSample && (
                      <div className="border border-amber-400/60 bg-amber-500/15 px-2 py-1 text-center text-[10px] font-extrabold text-amber-300">
                        SMALL SAMPLE - NOT RELIABLE (requires n ≥ 10 trades &amp; ≥ 12h M1 history)
                      </div>
                    )}
                    <div className="grid grid-cols-4 gap-1.5 text-center text-[10px]">
                      <div className="border border-white/10 bg-black/70 p-1.5">
                        <div className="text-neutral-400">TRADES</div>
                        <div className="font-bold text-white">{rPerf.totalTrades}</div>
                      </div>
                      <div className="border border-white/10 bg-black/70 p-1.5">
                        <div className="text-neutral-400">W / BE / L</div>
                        <div className="font-bold text-white">
                          <span className="text-[#00e676]">{rPerf.wins}</span>/
                          <span className="text-amber-400">{rPerf.beCount}</span>/
                          <span className="text-[#ff2d45]">{rPerf.losses}</span>
                        </div>
                      </div>
                      <div className="border border-white/10 bg-black/70 p-1.5">
                        <div className="text-neutral-400">EXPECTANCY</div>
                        <div
                          className="font-bold"
                          style={{
                            color: rPerf.expectancyR >= 0 ? '#00e676' : '#ff2d45',
                          }}
                        >
                          {rPerf.expectancyR >= 0
                            ? `+${rPerf.expectancyR.toFixed(2)}R`
                            : `${rPerf.expectancyR.toFixed(2)}R`}
                        </div>
                      </div>
                      <div className="border border-white/10 bg-black/70 p-1.5">
                        <div className="text-neutral-400">MAX DD</div>
                        <div className="font-bold text-[#ff2d45]">
                          ${replaySession.maxDrawdownDollars.toFixed(2)} (
                          {replaySession.maxDrawdownPct.toFixed(1)}%)
                        </div>
                      </div>
                    </div>

                    <div className="border border-white/10 bg-black/70 p-2 text-[10px]">
                      <div className="font-bold text-[#ff2d45]">
                        TRAILING-STOP MOVES ({replaySession.trailingMoves.length})
                      </div>
                      {replaySession.trailingMoves.length === 0 ? (
                        <div className="mt-0.5 text-neutral-500">
                          No trailing-stop moves triggered during this 24h window.
                        </div>
                      ) : (
                        <div className="mt-1 max-h-24 space-y-0.5 overflow-y-auto text-neutral-300">
                          {replaySession.trailingMoves.map((tm, idx) => (
                            <div key={`${tm.tradeId}-${idx}`}>
                              [{new Date(tm.time).toISOString().slice(11, 19)}] {tm.side}{' '}
                              {formatTfLabel(tm.tf)}: SL {tm.fromSl.toFixed(2)} →{' '}
                              {tm.toSl.toFixed(2)} @ ${tm.price.toFixed(2)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Top Feed Status Banner if not connected */}
      {!isFeedReady && (
        <div
          className="mb-2.5 border border-[#ff2d45] bg-[#140407] px-3 py-2 text-center text-xs font-bold tracking-[0.2em] text-[#ff2d45]"
          style={{ fontFamily: "'Orbitron', sans-serif", clipPath: HUD_CLIP_SM }}
        >
          WAITING FOR LIVE FEED
        </div>
      )}

      {/* 1) DATE CARD + MULTI-TIMEFRAME BIAS TILES + VERDICT BANNER */}
      <section
        className="border border-[#ff2d45]/35 bg-[#07070b] p-3.5 shadow-[0_0_24px_rgba(255,45,69,0.08)]"
        style={{ clipPath: HUD_CLIP }}
      >
        <div className="flex items-center justify-between border-b border-[#ff2d45]/20 pb-2.5">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 bg-[#ff2d45] shadow-[0_0_8px_#ff2d45]" />
              <h1
                className="text-sm font-extrabold tracking-[0.22em] text-[#ff2d45]"
                style={{ fontFamily: "'Orbitron', sans-serif" }}
              >
                RED SNIPER
              </h1>
            </div>
            <div
              className="mt-1 text-[11px] font-semibold tracking-[0.12em] text-neutral-300"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {formatHudDate(nowDate)} &nbsp;Session: {session.name}
            </div>
          </div>

          <div className="text-right" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            <div className="text-lg font-bold tracking-tight text-white">
              {hasLiveFeed && livePrice !== null
                ? `$${livePrice.toFixed(2)}`
                : 'WAITING FOR LIVE FEED'}
            </div>
            <div className="text-[10px] text-neutral-400">
              {isMarketClosed
                ? 'MARKET CLOSED'
                : spread !== null
                ? `SPR ${spread.toFixed(2)} (${bid?.toFixed(2) ?? '-'} / ${ask?.toFixed(2) ?? '-'})`
                : connectionStatus}
            </div>
          </div>
        </div>

        {/* MULTI-TIMEFRAME BIAS TILES (M30 / H1 / H4 / D1) */}
        <div className="mt-3">
          <div
            className="mb-1.5 text-[10px] font-bold tracking-[0.22em] text-neutral-400"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            MULTI-TIMEFRAME BIAS
          </div>
          <div className="grid grid-cols-4 gap-2">
            {(
              [
                { label: 'M30', bias: verdict.bias30m },
                { label: 'H1', bias: verdict.bias1h },
                { label: 'H4', bias: verdict.bias4h },
                { label: 'D1', bias: verdict.bias1d },
              ] as const
            ).map((item) => {
              const c = biasBadgeColor(item.bias);
              return (
                <div
                  key={item.label}
                  className="flex flex-col items-center justify-center py-2 text-center"
                  style={{
                    background: c.bg,
                    border: `1px solid ${c.border}`,
                    clipPath: HUD_CLIP_SM,
                  }}
                >
                  <span
                    className="text-[10px] font-bold tracking-[0.18em] text-neutral-300"
                    style={{ fontFamily: "'Orbitron', sans-serif" }}
                  >
                    {item.label}
                  </span>
                  <span
                    className="mt-0.5 text-xs font-bold tracking-wider"
                    style={{
                      color: c.text,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {isFeedReady ? item.bias : 'WAIT'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* VERDICT BANNER */}
        <div
          className="mt-3 flex items-center justify-between px-3 py-2"
          style={{
            background:
              verdict.tone === 'BULL'
                ? 'rgba(0, 230, 118, 0.1)'
                : verdict.tone === 'BEAR'
                ? 'rgba(255, 45, 69, 0.14)'
                : 'rgba(255, 171, 0, 0.1)',
            border: `1px solid ${
              verdict.tone === 'BULL'
                ? 'rgba(0, 230, 118, 0.45)'
                : verdict.tone === 'BEAR'
                ? 'rgba(255, 45, 69, 0.5)'
                : 'rgba(255, 171, 0, 0.45)'
            }`,
            clipPath: HUD_CLIP_SM,
          }}
        >
          <span
            className="text-[11px] font-extrabold tracking-[0.14em]"
            style={{
              fontFamily: "'Orbitron', sans-serif",
              color:
                verdict.tone === 'BULL'
                  ? '#00e676'
                  : verdict.tone === 'BEAR'
                  ? '#ff2d45'
                  : '#ffab00',
            }}
          >
            {isFeedReady ? verdict.banner : 'WAITING FOR LIVE FEED'}
          </span>
          <span
            className="text-[11px] font-bold text-neutral-300"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            SCORE {verdict.score > 0 ? `+${verdict.score}` : verdict.score}
          </span>
        </div>
      </section>

      {/* 2) BALANCE / EQUITY / OPEN P&L / SESSION TILES */}
      <section className="mt-2.5 grid grid-cols-4 gap-2">
        <div
          className="border border-[#ff2d45]/25 bg-[#07070b] p-2.5"
          style={{ clipPath: HUD_CLIP_SM }}
        >
          <div
            className="text-[9px] font-bold tracking-[0.18em] text-neutral-400"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            {replaySession ? 'REPLAY BAL' : 'BALANCE'}
          </div>
          <div
            className="mt-1 text-sm font-bold text-white"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            ${activeDisplayState.balance.toFixed(2)}
          </div>
        </div>

        <div
          className="border border-[#ff2d45]/25 bg-[#07070b] p-2.5"
          style={{ clipPath: HUD_CLIP_SM }}
        >
          <div
            className="text-[9px] font-bold tracking-[0.18em] text-neutral-400"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            EQUITY
          </div>
          <div
            className="mt-1 text-sm font-bold text-white"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            ${equity.toFixed(2)}
          </div>
        </div>

        <div
          className="border border-[#ff2d45]/25 bg-[#07070b] p-2.5"
          style={{ clipPath: HUD_CLIP_SM }}
        >
          <div
            className="text-[9px] font-bold tracking-[0.18em] text-neutral-400"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            OPEN P&amp;L
          </div>
          <div
            className="mt-1 text-sm font-bold"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              color: openPnl > 0 ? '#00e676' : openPnl < 0 ? '#ff2d45' : '#e2e8f0',
            }}
          >
            {openPnl >= 0 ? `+$${openPnl.toFixed(2)}` : `-$${Math.abs(openPnl).toFixed(2)}`}
          </div>
        </div>

        <div
          className="border border-[#ff2d45]/25 bg-[#07070b] p-2.5"
          style={{ clipPath: HUD_CLIP_SM }}
        >
          <div
            className="text-[9px] font-bold tracking-[0.18em] text-neutral-400"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            SESSION
          </div>
          <div
            className="mt-1 truncate text-xs font-bold text-[#ff2d45]"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {session.name}
          </div>
        </div>
      </section>

      {/* 3) LIVE TICK VOLUME TILES (C: MARKET CLOSED - LAST SESSION + greyed values) */}
      <section
        className="mt-2.5 border border-[#ff2d45]/30 bg-[#07070b] p-3"
        style={{ clipPath: HUD_CLIP }}
      >
        <div className="mb-2 flex items-center justify-between">
          <div
            className="text-[10px] font-bold tracking-[0.22em] text-[#ff2d45]"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            LIVE TICK VOLUME
          </div>
          {isMarketClosed && (
            <span
              className="border border-neutral-600 bg-neutral-900/80 px-2 py-0.5 text-[9px] font-bold tracking-[0.14em] text-neutral-400"
              style={{ fontFamily: "'Orbitron', sans-serif" }}
            >
              MARKET CLOSED - LAST SESSION
            </span>
          )}
        </div>
        <div
          className={`grid grid-cols-2 gap-2 sm:grid-cols-4 ${
            isMarketClosed ? 'opacity-55' : ''
          }`}
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          <div className="border border-white/10 bg-black/70 p-2">
            <div className="text-[9px] text-neutral-400">
              {isMarketClosed ? 'M1 TICK VOL (LAST SESSION)' : 'M1 TICK VOL'}
            </div>
            <div
              className={`mt-0.5 text-sm font-bold ${
                isMarketClosed ? 'text-neutral-500' : 'text-white'
              }`}
            >
              {!isFeedReady
                ? 'WAITING'
                : m1VolumeStats.currentVol !== null
                ? m1VolumeStats.currentVol
                : 'NO DATA'}
            </div>
            <div className="mt-0.5 text-[9px] text-neutral-500">
              {isMarketClosed
                ? 'MARKET CLOSED - LAST SESSION'
                : `last closed M1: ${
                    m1VolumeStats.lastClosedVol !== null ? m1VolumeStats.lastClosedVol : '--'
                  }`}
            </div>
          </div>

          <div className="border border-white/10 bg-black/70 p-2">
            <div className="text-[9px] text-neutral-400">PROJ VS 30-BAR AVG</div>
            <div
              className="mt-0.5 text-sm font-bold"
              style={{
                color: isMarketClosed
                  ? '#737373'
                  : m1VolumeStats.projMult !== null && m1VolumeStats.projMult >= 1.5
                  ? '#00e676'
                  : '#f2f4f8',
              }}
            >
              {!isFeedReady
                ? 'WAITING'
                : m1VolumeStats.projMult !== null
                ? `${m1VolumeStats.projMult.toFixed(1)}x`
                : 'NO DATA'}
            </div>
            <div className="mt-0.5 text-[9px] text-neutral-500">
              {isMarketClosed
                ? 'MARKET CLOSED - LAST SESSION'
                : `proj: ${
                    m1VolumeStats.projectedVol !== null ? m1VolumeStats.projectedVol : '--'
                  }`}
            </div>
          </div>

          <div className="border border-white/10 bg-black/70 p-2">
            <div className="text-[9px] text-neutral-400">BUY/SELL est. (60s)</div>
            <div className="mt-0.5 text-xs font-bold">
              {!isFeedReady ? (
                <span className="text-neutral-400">WAITING</span>
              ) : isMarketClosed ? (
                <span className="text-neutral-500">
                  {rolling60sFlow.buyPct !== null && rolling60sFlow.sellPct !== null
                    ? `${rolling60sFlow.buyPct}%/${rolling60sFlow.sellPct}%`
                    : '--'}
                </span>
              ) : rolling60sFlow.buyPct !== null && rolling60sFlow.sellPct !== null ? (
                <span>
                  <span className="text-[#00e676]">{rolling60sFlow.buyPct}%</span>
                  <span className="text-neutral-500">/</span>
                  <span className="text-[#ff2d45]">{rolling60sFlow.sellPct}%</span>
                </span>
              ) : (
                <span className="text-neutral-400">--</span>
              )}
            </div>
            <div className="mt-0.5 text-[9px] text-neutral-500">
              {isMarketClosed
                ? 'MARKET CLOSED - LAST SESSION'
                : `${rolling60sFlow.tickCount}/20 ticks`}
            </div>
          </div>

          <div className="border border-white/10 bg-black/70 p-2">
            <div className="text-[9px] text-neutral-400">ZONES COUNT</div>
            <div
              className={`mt-0.5 text-sm font-bold ${
                isMarketClosed ? 'text-neutral-500' : 'text-[#ff2d45]'
              }`}
            >
              {isFeedReady ? nearZones.length : 'WAITING'}
            </div>
            <div className="mt-0.5 text-[9px] text-neutral-500">
              total all TFs: {isFeedReady ? allZones.length : '--'}
            </div>
          </div>
        </div>
      </section>

      {/* 4) TIMEFRAME BUTTONS: 1m 3m 5m 15m 30m 1H 4H 1D */}
      <section className="mt-2.5 grid grid-cols-8 gap-1.5">
        {RED_SNIPER_TIMEFRAMES.map((tf) => {
          const active = selectedTf === tf;
          return (
            <button
              key={tf}
              type="button"
              onClick={() => setSelectedTf(tf)}
              className={`cursor-pointer py-2 text-center text-xs font-bold transition-all ${
                active
                  ? 'border border-[#ff2d45] bg-[#ff2d45] text-black shadow-[0_0_14px_rgba(255,45,69,0.5)]'
                  : 'border border-[#ff2d45]/25 bg-[#09090f] text-neutral-300 hover:border-[#ff2d45]/60 hover:text-white'
              }`}
              style={{
                fontFamily: "'Orbitron', sans-serif",
                clipPath: HUD_CLIP_SM,
              }}
            >
              {formatTfLabel(tf)}
            </button>
          );
        })}
      </section>

      {/* 5) CHART CARD (Fire Zone chart renderer + Settings gear top-right) */}
      <section
        className="mt-2.5 overflow-hidden border border-[#ff2d45]/35 bg-[#050508]"
        style={{ clipPath: HUD_CLIP }}
      >
        <div className="flex items-center justify-between border-b border-[#ff2d45]/20 px-3 py-2">
          <div className="flex items-center gap-2">
            <span
              className="text-[11px] font-bold tracking-[0.18em] text-[#ff2d45]"
              style={{ fontFamily: "'Orbitron', sans-serif" }}
            >
              TACTICAL CHART // {formatTfLabel(selectedTf)}
            </span>
            {isLoading && (
              <span className="text-[10px] font-mono text-neutral-400">SYNCING...</span>
            )}
          </div>

          <div
            className="flex items-center gap-1.5 text-[10px] font-bold"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            <span className="text-[#2ee6a0]">BUY {currentTfBuyCount}</span>
            <span className="text-neutral-500">·</span>
            <span className="text-[#ff5d6c]">SELL {currentTfSellCount}</span>
            <span className="text-neutral-500">·</span>
            <span className="text-neutral-300">
              ATR {currentTfAnalysis ? currentTfAnalysis.atr14.toFixed(2) : '-'}
            </span>
            <button
              type="button"
              onClick={handleCopyZoneDebug}
              title="Copy JSON with all alive and dead:closeBeyond zones before selection for current timeframe"
              className="ml-1 cursor-pointer border border-white/20 bg-black px-1.5 py-0.5 text-[9px] font-bold text-neutral-300 transition-colors hover:border-[#ff2d45] hover:text-[#ff2d45]"
            >
              {copiedDebug ? 'COPIED JSON' : 'Copy zone debug'}
            </button>
            <button
              type="button"
              onClick={() => setShowDebugPanel((v) => !v)}
              title="Toggle Live Store Health & Diagnostics Debug Panel"
              className={`cursor-pointer border px-1.5 py-0.5 text-[9px] font-bold transition-colors ${
                showDebugPanel
                  ? 'border-[#ff2d45] bg-[#ff2d45] text-black'
                  : 'border-white/20 bg-black text-neutral-300 hover:border-[#ff2d45] hover:text-[#ff2d45]'
              }`}
            >
              DEBUG
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen((v) => !v)}
              aria-label="Open Red Sniper Settings"
              title="Red Sniper Settings"
              className={`flex h-6 w-6 cursor-pointer items-center justify-center border transition-colors ${
                settingsOpen
                  ? 'border-[#ff2d45] bg-[#ff2d45] text-black'
                  : 'border-white/20 bg-black text-neutral-300 hover:border-[#ff2d45] hover:text-[#ff2d45]'
              }`}
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Live SQLite Store Health & Telemetry Debug Panel */}
        {showDebugPanel && (
          <div className="border-b border-[#ff2d45]/30 p-2">
            <RedSniperDebugPanel />
          </div>
        )}

        {/* Compact Settings Sheet (persisted in localStorage 'redSniperSettings.v3') */}
        {settingsOpen && (
          <div
            className="border-b border-[#ff2d45]/30 bg-[#0b0b12] p-3 text-xs"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            <div className="mb-2 flex items-center justify-between">
              <span
                className="text-[10px] font-extrabold tracking-[0.18em] text-[#ff2d45]"
                style={{ fontFamily: "'Orbitron', sans-serif" }}
              >
                SNIPER ENGINE SETTINGS
              </span>
              <button
                type="button"
                onClick={handleResetSettings}
                className="cursor-pointer border border-white/15 bg-black px-2 py-0.5 text-[9px] text-neutral-400 hover:border-white/40 hover:text-white"
              >
                DEFAULTS
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {/* Zones per timeframe (3-8, default 6) */}
              <label className="flex flex-col gap-1 border border-white/10 bg-black/70 p-2">
                <span className="text-[9px] text-neutral-400">
                  ZONES / TF ({settings.maxZonesPerTf})
                </span>
                <input
                  type="range"
                  min={3}
                  max={8}
                  step={1}
                  value={settings.maxZonesPerTf}
                  onChange={(e) =>
                    updateSettings({ maxZonesPerTf: Number(e.target.value) })
                  }
                  className="accent-[#ff2d45]"
                />
              </label>

              {/* Zone mode (WICK | BODY) */}
              <div className="flex flex-col gap-1 border border-white/10 bg-black/70 p-2">
                <span className="text-[9px] text-neutral-400">ZONE MODE</span>
                <div className="grid grid-cols-2 gap-1">
                  {(['WICK', 'BODY'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => updateSettings({ zoneMode: m })}
                      className={`cursor-pointer py-1 text-[9.5px] font-bold ${
                        settings.zoneMode === m
                          ? 'bg-[#ff2d45] text-black'
                          : 'border border-white/15 bg-black text-neutral-400'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* A.4 & 5) Retest mode (CANDLE | ATR | TOUCH_CANDLES) */}
              <div className="flex flex-col gap-1 border border-white/10 bg-black/70 p-2">
                <div className="flex items-center justify-between text-[9px] text-neutral-400">
                  <span>RETEST MODE</span>
                  {settings.retestModeOverride && (
                    <button
                      type="button"
                      onClick={() => updateSettings({ retestModeOverride: false })}
                      className="cursor-pointer text-[8px] text-[#ff2d45] underline"
                    >
                      AUTO
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {(['CANDLE', 'ATR', 'TOUCH_CANDLES'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() =>
                        updateSettings({ retestMode: m, retestModeOverride: true })
                      }
                      className={`cursor-pointer py-1 text-[8.5px] font-bold ${
                        activeRetestModeForTf === m
                          ? 'bg-[#ff2d45] text-black'
                          : 'border border-white/15 bg-black text-neutral-400'
                      }`}
                    >
                      {m === 'TOUCH_CANDLES' ? 'TOUCHES' : m}
                    </button>
                  ))}
                </div>
              </div>

              {/* A.1) Height cap ATR (1.0 - 3.0, default 2.0) */}
              <label className="flex flex-col gap-1 border border-white/10 bg-black/70 p-2">
                <span className="text-[9px] text-neutral-400">
                  HEIGHT CAP ({settings.heightCapAtr.toFixed(1)}×ATR)
                </span>
                <input
                  type="range"
                  min={1.0}
                  max={3.0}
                  step={0.1}
                  value={settings.heightCapAtr}
                  onChange={(e) =>
                    updateSettings({ heightCapAtr: Number(e.target.value) })
                  }
                  className="accent-[#ff2d45]"
                />
              </label>

              {/* A.3) Dead rule setting deadAtr (default 0.25, range 0 - 1.0) */}
              <label className="flex flex-col gap-1 border border-white/10 bg-black/70 p-2">
                <span className="text-[9px] text-neutral-400">
                  DEAD ATR ({settings.deadAtr.toFixed(2)}×ATR)
                </span>
                <input
                  type="range"
                  min={0.0}
                  max={1.0}
                  step={0.05}
                  value={settings.deadAtr}
                  onChange={(e) =>
                    updateSettings({ deadAtr: Number(e.target.value) })
                  }
                  className="accent-[#ff2d45]"
                />
              </label>

              {/* 2) FAR rule setting farAtr (default 25, range 10 - 60) */}
              <label className="flex flex-col gap-1 border border-white/10 bg-black/70 p-2">
                <span className="text-[9px] text-neutral-400">
                  FAR ATR ({settings.farAtr}×ATR)
                </span>
                <input
                  type="range"
                  min={10}
                  max={60}
                  step={1}
                  value={settings.farAtr}
                  onChange={(e) =>
                    updateSettings({ farAtr: Number(e.target.value) })
                  }
                  className="accent-[#ff2d45]"
                />
              </label>

              {/* Retest gap ATR (0.1 - 0.75, default 0.25) */}
              <label className="flex flex-col gap-1 border border-white/10 bg-black/70 p-2">
                <span className="text-[9px] text-neutral-400">
                  RETEST GAP ({settings.retestGapAtr.toFixed(2)}×ATR)
                </span>
                <input
                  type="range"
                  min={0.1}
                  max={0.75}
                  step={0.05}
                  value={settings.retestGapAtr}
                  onChange={(e) =>
                    updateSettings({ retestGapAtr: Number(e.target.value) })
                  }
                  className="accent-[#ff2d45]"
                />
              </label>

              {/* Min power to trade (default 50) */}
              <label className="flex flex-col gap-1 border border-white/10 bg-black/70 p-2">
                <span className="text-[9px] text-neutral-400">
                  MIN POWER ({settings.minPowerToTrade})
                </span>
                <input
                  type="range"
                  min={20}
                  max={90}
                  step={5}
                  value={settings.minPowerToTrade}
                  onChange={(e) =>
                    updateSettings({ minPowerToTrade: Number(e.target.value) })
                  }
                  className="accent-[#ff2d45]"
                />
              </label>

              {/* SL buffer ($1-$3, default $1.5) */}
              <label className="flex flex-col gap-1 border border-white/10 bg-black/70 p-2">
                <span className="text-[9px] text-neutral-400">
                  SL BUFFER (${settings.slBuffer.toFixed(2)})
                </span>
                <input
                  type="range"
                  min={1.0}
                  max={3.0}
                  step={0.25}
                  value={settings.slBuffer}
                  onChange={(e) =>
                    updateSettings({ slBuffer: Number(e.target.value) })
                  }
                  className="accent-[#ff2d45]"
                />
              </label>

              {/* Max risk points (default $15, 0 = off) */}
              <label className="flex flex-col gap-1 border border-white/10 bg-black/70 p-2">
                <span className="text-[9px] text-neutral-400">
                  MAX RISK (
                  {settings.maxRiskPoints > 0
                    ? `$${settings.maxRiskPoints.toFixed(0)}`
                    : 'OFF'}
                  )
                </span>
                <input
                  type="range"
                  min={0}
                  max={40}
                  step={1}
                  value={settings.maxRiskPoints}
                  onChange={(e) =>
                    updateSettings({ maxRiskPoints: Number(e.target.value) })
                  }
                  className="accent-[#ff2d45]"
                />
              </label>

              {/* Risk % per trade (default 1.5%) */}
              <label className="flex flex-col gap-1 border border-white/10 bg-black/70 p-2">
                <span className="text-[9px] text-neutral-400">
                  RISK / TRADE ({settings.riskPct.toFixed(2)}%)
                </span>
                <input
                  type="range"
                  min={0.5}
                  max={5.0}
                  step={0.25}
                  value={settings.riskPct}
                  onChange={(e) =>
                    updateSettings({ riskPct: Number(e.target.value) })
                  }
                  className="accent-[#ff2d45]"
                />
              </label>

              {/* Trail trigger ($1-$2, default $2) */}
              <label className="flex flex-col gap-1 border border-white/10 bg-black/70 p-2">
                <span className="text-[9px] text-neutral-400">
                  TRAIL TRIGGER (${settings.trailTrigger.toFixed(2)})
                </span>
                <input
                  type="range"
                  min={1.0}
                  max={2.0}
                  step={0.25}
                  value={settings.trailTrigger}
                  onChange={(e) =>
                    updateSettings({ trailTrigger: Number(e.target.value) })
                  }
                  className="accent-[#ff2d45]"
                />
              </label>

              {/* Trail step ($1-$3, default $1.5) */}
              <label className="flex flex-col gap-1 border border-white/10 bg-black/70 p-2">
                <span className="text-[9px] text-neutral-400">
                  TRAIL STEP (${settings.trailStep.toFixed(2)})
                </span>
                <input
                  type="range"
                  min={1.0}
                  max={3.0}
                  step={0.25}
                  value={settings.trailStep}
                  onChange={(e) =>
                    updateSettings({ trailStep: Number(e.target.value) })
                  }
                  className="accent-[#ff2d45]"
                />
              </label>

              {/* Show BOS/CHoCH (default OFF) */}
              <div className="flex items-center justify-between border border-white/10 bg-black/70 p-2">
                <span className="text-[9px] text-neutral-400">BOS / CHoCH</span>
                <button
                  type="button"
                  onClick={() =>
                    updateSettings({ showBosChoch: !settings.showBosChoch })
                  }
                  className={`cursor-pointer px-2 py-0.5 text-[10px] font-bold ${
                    settings.showBosChoch
                      ? 'bg-[#00e676] text-black'
                      : 'border border-white/20 bg-black text-neutral-400'
                  }`}
                >
                  {settings.showBosChoch ? 'ON' : 'OFF'}
                </button>
              </div>

              {/* 3) Show consumed zones (pctLeft = 0) default OFF */}
              <div className="flex items-center justify-between border border-white/10 bg-black/70 p-2">
                <span className="text-[9px] text-neutral-400">SHOW CONSUMED</span>
                <button
                  type="button"
                  onClick={() =>
                    updateSettings({
                      showConsumedZones: !settings.showConsumedZones,
                    })
                  }
                  className={`cursor-pointer px-2 py-0.5 text-[10px] font-bold ${
                    settings.showConsumedZones
                      ? 'bg-[#ff2d45] text-black'
                      : 'border border-white/20 bg-black text-neutral-400'
                  }`}
                >
                  {settings.showConsumedZones ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>

            {/* D.1) Advanced Editable Power Weights (default 0.40 score / 0.25 volume / 0.20 freshness / 0.15 HTF, always re-normalized) */}
            <div className="mt-2.5 border border-white/10 bg-black/70 p-2">
              <div className="mb-1.5 flex items-center justify-between text-[9px] text-neutral-400">
                <span>POWER WEIGHTS (AUTO RE-NORMALIZED)</span>
                <span>
                  {(settings.weightScore * 100).toFixed(0)} /{' '}
                  {(settings.weightVolume * 100).toFixed(0)} /{' '}
                  {(settings.weightFreshness * 100).toFixed(0)} /{' '}
                  {(settings.weightHtf * 100).toFixed(0)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[8.5px] text-neutral-400">
                    SCORE ({settings.weightScore.toFixed(2)})
                  </span>
                  <input
                    type="range"
                    min={0.05}
                    max={0.8}
                    step={0.05}
                    value={settings.weightScore}
                    onChange={(e) =>
                      updateSettings({ weightScore: Number(e.target.value) })
                    }
                    className="accent-[#ff2d45]"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[8.5px] text-neutral-400">
                    VOLUME ({settings.weightVolume.toFixed(2)})
                  </span>
                  <input
                    type="range"
                    min={0.05}
                    max={0.8}
                    step={0.05}
                    value={settings.weightVolume}
                    onChange={(e) =>
                      updateSettings({ weightVolume: Number(e.target.value) })
                    }
                    className="accent-[#ff2d45]"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[8.5px] text-neutral-400">
                    FRESH ({settings.weightFreshness.toFixed(2)})
                  </span>
                  <input
                    type="range"
                    min={0.05}
                    max={0.8}
                    step={0.05}
                    value={settings.weightFreshness}
                    onChange={(e) =>
                      updateSettings({ weightFreshness: Number(e.target.value) })
                    }
                    className="accent-[#ff2d45]"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[8.5px] text-neutral-400">
                    HTF ({settings.weightHtf.toFixed(2)})
                  </span>
                  <input
                    type="range"
                    min={0.05}
                    max={0.8}
                    step={0.05}
                    value={settings.weightHtf}
                    onChange={(e) =>
                      updateSettings({ weightHtf: Number(e.target.value) })
                    }
                    className="accent-[#ff2d45]"
                  />
                </label>
              </div>
            </div>

            {/* D.2) REPLAY MODE (settings, label "REPLAY - NOT LIVE") */}
            <div className="mt-2.5 flex items-center justify-between border border-[#ff2d45]/40 bg-[#170408] p-2">
              <div>
                <div
                  className="text-[10px] font-extrabold tracking-[0.14em] text-[#ff2d45]"
                  style={{ fontFamily: "'Orbitron', sans-serif" }}
                >
                  REPLAY - NOT LIVE
                </div>
                <div className="text-[9px] text-neutral-400">
                  {m1WindowInfo.windowLabel} @ 20x (isolated demo account &amp; history)
                </div>
              </div>
              {replaySession?.isRunning ? (
                <button
                  type="button"
                  onClick={handleStopReplay}
                  className="cursor-pointer border border-[#ff2d45] bg-[#ff2d45] px-3 py-1 text-[10px] font-extrabold text-black"
                  style={{ fontFamily: "'Orbitron', sans-serif" }}
                >
                  STOP
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartReplay}
                  disabled={(bars['1m']?.length ?? 0) < 30}
                  className="cursor-pointer border border-[#ff2d45] bg-[#ff2d45]/20 px-3 py-1 text-[10px] font-extrabold text-[#ff2d45] hover:bg-[#ff2d45] hover:text-black disabled:opacity-40"
                  style={{ fontFamily: "'Orbitron', sans-serif" }}
                >
                  START REPLAY
                </button>
              )}
            </div>
          </div>
        )}

        <RedSniperChart
          tf={selectedTf}
          candles={currentTfCandles}
          atr14={currentTfAnalysis?.atr14 ?? 2.5}
          zones={currentTfZones}
          structures={currentTfAnalysis?.structures || []}
          showBosChoch={settings.showBosChoch}
          showFarZones={settings.showFarZones}
          showConsumedZones={settings.showConsumedZones}
          maxZones={settings.maxZonesPerTf}
          highlightedZoneId={highlightedZoneId}
          openTrades={activeDisplayState.openTrades}
          pendingPlan={pendingPlan}
          livePrice={activeDisplayPrice}
          isConnected={isFeedReady}
        />

        {/* Zone Chips under the chart (B.1: tap a chip to highlight that zone on the chart for 3s with a full label) */}
        {currentTfZones.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-white/10 px-3 py-2">
            {currentTfZones.map((z) => {
              const isSell = z.side === 'SELL';
              const isHigh = highlightedZoneId === z.id;
              const chipColor = isSell ? '#ff4d66' : '#2fe08a';
              const chipBg = isHigh
                ? isSell
                  ? 'rgba(255, 77, 102, 0.28)'
                  : 'rgba(47, 224, 138, 0.28)'
                : isSell
                ? 'rgba(255, 77, 102, 0.08)'
                : 'rgba(47, 224, 138, 0.08)';
              const statusText =
                z.status === 'FRESH'
                  ? 'FRESH'
                  : `${z.status} ${z.retests}x (${z.pctLeft}%)`;
              return (
                <button
                  key={z.id}
                  type="button"
                  onClick={() => handleHighlightZone(z.id)}
                  title="Tap to highlight zone on chart for 3 seconds"
                  className={`cursor-pointer rounded-[7px] px-2 py-1 text-[10px] font-bold transition-all ${
                    z.consumed && !settings.showConsumedZones ? 'opacity-55' : ''
                  }`}
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    color: isHigh ? '#ffffff' : chipColor,
                    backgroundColor: chipBg,
                    border: `1px solid ${isHigh ? '#ffffff' : chipColor}`,
                  }}
                >
                  {z.side} {z.bottom.toFixed(2)}–{z.top.toFixed(2)} · {statusText} · PWR{' '}
                  {z.power}
                  {z.consumed ? ' · consumed' : ''}
                  {z.trimmed ? ' · trim' : ''}
                  {z.weak ? ' · weak' : ''}
                  {z.sweep ? ' · sweep' : ''}
                  {z.isFar ? ' · FAR' : ''}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* 6) AUTO ON/OFF BAR + BOT STATUS LINE */}
      <section
        className="mt-2.5 border border-[#ff2d45]/35 bg-[#07070b] px-3.5 py-2.5"
        style={{ clipPath: HUD_CLIP_SM }}
      >
        <div className="flex items-center justify-between">
          <div>
            <div
              className="text-xs font-extrabold tracking-[0.18em] text-white"
              style={{ fontFamily: "'Orbitron', sans-serif" }}
            >
              AUTO SNIPER EXECUTION
            </div>
            <div
              className="text-[11px] text-neutral-400"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              PWR ≥ {settings.minPowerToTrade} · {settings.riskPct}% RISK · MAX 3 OPEN (
              {activeDisplayState.openTrades.length}/3)
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleResetDemo}
              className="cursor-pointer border border-white/15 bg-black px-2.5 py-1.5 text-[10px] font-bold tracking-wider text-neutral-400 hover:border-white/40 hover:text-white"
              style={{ fontFamily: "'Orbitron', sans-serif" }}
            >
              RESET
            </button>

            <button
              type="button"
              onClick={handleToggleAuto}
              className={`cursor-pointer px-4 py-1.5 text-xs font-extrabold tracking-[0.18em] transition-all ${
                demoState.autoEnabled
                  ? 'border border-[#00e676] bg-[#00e676]/15 text-[#00e676] shadow-[0_0_14px_rgba(0,230,118,0.3)]'
                  : 'border border-[#ff2d45] bg-[#ff2d45]/15 text-[#ff2d45]'
              }`}
              style={{
                fontFamily: "'Orbitron', sans-serif",
                clipPath: HUD_CLIP_SM,
              }}
            >
              {demoState.autoEnabled ? 'AUTO ON' : 'AUTO OFF'}
            </button>
          </div>
        </div>

        {/* One-line Bot Decision Status updated on every tick */}
        <div
          className="mt-2 border-t border-white/10 pt-1.5 text-[11px] font-semibold text-neutral-300"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          <span className="text-[#ff2d45]">BOT: </span>
          <span>
            {replaySession?.isRunning
              ? `REPLAY @ $${(replaySession.currentPrice ?? 0).toFixed(2)} (Bar ${replaySession.currentIndex}/${replaySession.totalBars})`
              : botStatusLine}
          </span>
        </div>
      </section>

      {/* 7) TRADE PLAN (open trades, or pending plan for nearest zone) */}
      <section
        className="mt-2.5 border border-[#ff2d45]/35 bg-[#07070b] p-3.5"
        style={{ clipPath: HUD_CLIP }}
      >
        <div className="mb-2.5 flex items-center justify-between border-b border-[#ff2d45]/20 pb-2">
          <span
            className="text-xs font-extrabold tracking-[0.2em] text-[#ff2d45]"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            TRADE PLAN
          </span>
          <span
            className="text-[11px] font-bold text-neutral-300"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {activeDisplayState.openTrades.length > 0
              ? `ACTIVE POSITIONS (${activeDisplayState.openTrades.length})`
              : 'PENDING NEAREST ZONE'}
          </span>
        </div>

        {!isFeedReady ? (
          <div
            className="py-4 text-center text-xs font-bold tracking-[0.18em] text-[#ff2d45]"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            WAITING FOR LIVE FEED
          </div>
        ) : activeDisplayState.openTrades.length > 0 ? (
          <div className="space-y-2.5">
            {activeDisplayState.openTrades.map((tr: OpenSniperTrade) => {
              const { totalPnl, currentR } = computeOpenTradeFloatingPnl(
                tr,
                activeDisplayPrice
              );
              const isBuy = tr.side === 'BUY';
              return (
                <div
                  key={tr.id}
                  className="border border-white/15 bg-black/80 p-3"
                  style={{
                    clipPath: HUD_CLIP_SM,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="px-2 py-0.5 text-xs font-extrabold text-black"
                        style={{ background: isBuy ? '#00e676' : '#ff2d45' }}
                      >
                        {tr.side} {formatTfLabel(tr.tf)}
                      </span>
                      <span className="text-xs font-bold text-neutral-300">
                        {tr.initialLots.toFixed(2)} LOT ({Math.round(tr.remPct * 100)}% OPEN)
                      </span>
                      <span className="text-[11px] text-[#ff2d45]">PWR {tr.power}</span>
                    </div>

                    {!replaySession && (
                      <button
                        type="button"
                        onClick={() => handleManualCloseTrade(tr.id)}
                        className="cursor-pointer border border-[#ff2d45]/50 bg-[#ff2d45]/10 px-2 py-0.5 text-[10px] font-bold text-[#ff2d45] hover:bg-[#ff2d45] hover:text-black"
                      >
                        CLOSE
                      </button>
                    )}
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] text-neutral-500">ENTRY</span>
                      <div className="font-bold text-white">{tr.entry.toFixed(2)}</div>
                    </div>
                    <div>
                      <span className="text-[10px] text-neutral-500">STOP LOSS</span>
                      <div
                        className="font-bold"
                        style={{
                          color: tr.isTrailing
                            ? '#00e676'
                            : tr.beMoved
                            ? '#00e5ff'
                            : '#ff2d45',
                        }}
                      >
                        {tr.isTrailing
                          ? `TRAIL (${tr.sl.toFixed(2)})`
                          : tr.beMoved
                          ? `BE (${tr.entry.toFixed(2)})`
                          : tr.sl.toFixed(2)}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-neutral-500">LIVE P&amp;L</span>
                      <div
                        className="font-bold"
                        style={{ color: totalPnl >= 0 ? '#00e676' : '#ff2d45' }}
                      >
                        {totalPnl >= 0
                          ? `+$${totalPnl.toFixed(2)}`
                          : `-$${Math.abs(totalPnl).toFixed(2)}`}{' '}
                        ({currentR >= 0 ? `+${currentR.toFixed(2)}R` : `${currentR.toFixed(2)}R`})
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-2 border-t border-white/10 pt-2 text-[11px]">
                    <div className={tr.tp1Hit ? 'text-[#00e676] font-bold' : 'text-neutral-300'}>
                      T1 (50%): {tr.tp1.toFixed(2)} {tr.tp1Hit ? '✓' : ''}
                    </div>
                    <div className={tr.tp2Hit ? 'text-[#00e676] font-bold' : 'text-neutral-300'}>
                      T2 (30%): {tr.tp2.toFixed(2)} {tr.tp2Hit ? '✓' : ''}
                    </div>
                    <div className="text-right text-amber-400">
                      T3 (20%): {tr.tp3.toFixed(2)} {tr.tp3IsLiquidity ? '[LIQ]' : '[3R]'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : pendingPlan && livePrice !== null ? (
          <div
            className="border border-white/15 bg-black/80 p-3"
            style={{
              clipPath: HUD_CLIP_SM,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="px-2 py-0.5 text-xs font-extrabold text-black"
                  style={{
                    background: pendingPlan.side === 'BUY' ? '#00e676' : '#ff2d45',
                  }}
                >
                  PENDING {pendingPlan.side} · {formatTfLabel(pendingPlan.zone.tf)}
                </span>
                <span className="text-xs font-bold text-white">
                  {pendingPlan.lots.toFixed(2)} LOT
                </span>
              </div>
              <span className="text-xs font-bold text-[#ff2d45]">
                PWR {pendingPlan.zone.power}
              </span>
            </div>

            <div className="mt-1.5 text-[11px] text-neutral-300">
              ZONE: {pendingPlan.zone.bottom.toFixed(2)} – {pendingPlan.zone.top.toFixed(2)}{' '}
              {livePrice >= pendingPlan.zone.bottom && livePrice <= pendingPlan.zone.top ? (
                <span className="font-bold text-[#00e676]">(INSIDE ZONE)</span>
              ) : livePrice < pendingPlan.zone.bottom ? (
                <span className="text-amber-400">
                  ({pendingPlan.distance.toFixed(1)} pts away — price must rally up into zone)
                </span>
              ) : (
                <span className="text-amber-400">
                  ({pendingPlan.distance.toFixed(1)} pts away — price must drop down into zone)
                </span>
              )}
              {pendingPlan.htfBlocked ? ' · HTF BLOCKED (1H+4H OPPOSE)' : ''}
              {pendingPlan.maxRiskSkipped
                ? ` · SKIPPED (RISK ${pendingPlan.riskPoints.toFixed(1)} > MAX $${settings.maxRiskPoints})`
                : ''}
            </div>

            <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
              <div className="border border-white/10 bg-[#07070c] p-2">
                <div className="text-[9px] text-neutral-500">ENTRY</div>
                <div className="font-bold text-white">{pendingPlan.entry.toFixed(2)}</div>
              </div>
              <div className="border border-white/10 bg-[#07070c] p-2">
                <div className="text-[9px] text-neutral-500">STOP LOSS</div>
                <div className="font-bold text-[#ff2d45]">{pendingPlan.sl.toFixed(2)}</div>
              </div>
              <div className="border border-white/10 bg-[#07070c] p-2">
                <div className="text-[9px] text-neutral-500">TP1 (1R · 50%)</div>
                <div className="font-bold text-[#00e676]">{pendingPlan.tp1.toFixed(2)}</div>
              </div>
              <div className="border border-white/10 bg-[#07070c] p-2">
                <div className="text-[9px] text-neutral-500">TP2 (2R · 30%)</div>
                <div className="font-bold text-[#00e676]">{pendingPlan.tp2.toFixed(2)}</div>
              </div>
              <div className="border border-white/10 bg-[#07070c] p-2">
                <div className="text-[9px] text-neutral-500">
                  TP3 ({pendingPlan.tp3IsLiquidity ? 'LIQ' : '3R'} · 20%)
                </div>
                <div className="font-bold text-amber-400">{pendingPlan.tp3.toFixed(2)}</div>
              </div>
            </div>
          </div>
        ) : (
          <div
            className="py-4 text-center text-xs text-neutral-400"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            NO QUALIFYING NEAR ZONES DETECTED
          </div>
        )}
      </section>

      {/* 8) STRONG ZONES ALL TIMEFRAMES (tap = switch TF, SHOW FAR ZONES toggle) */}
      <section
        className="mt-2.5 border border-[#ff2d45]/35 bg-[#07070b] p-3.5"
        style={{ clipPath: HUD_CLIP }}
      >
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-[#ff2d45]/20 pb-2">
          <span
            className="text-xs font-extrabold tracking-[0.2em] text-[#ff2d45]"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            STRONG ZONES // ALL TIMEFRAMES
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                updateSettings({
                  showConsumedZones: !settings.showConsumedZones,
                })
              }
              className={`cursor-pointer border px-2 py-0.5 text-[10px] font-bold tracking-wider transition-colors ${
                settings.showConsumedZones
                  ? 'border-[#ff2d45] bg-[#ff2d45]/20 text-[#ff2d45]'
                  : 'border-white/15 bg-black text-neutral-400 hover:border-white/35 hover:text-white'
              }`}
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              CONSUMED: {settings.showConsumedZones ? 'SHOWN' : 'HIDDEN'}
            </button>
            <button
              type="button"
              onClick={() => updateSettings({ showFarZones: !settings.showFarZones })}
              className={`cursor-pointer border px-2 py-0.5 text-[10px] font-bold tracking-wider transition-colors ${
                settings.showFarZones
                  ? 'border-[#ff2d45] bg-[#ff2d45]/20 text-[#ff2d45]'
                  : 'border-white/15 bg-black text-neutral-400 hover:border-white/35 hover:text-white'
              }`}
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              SHOW FAR ZONES: {settings.showFarZones ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        {!isFeedReady ? (
          <div
            className="py-4 text-center text-xs font-bold tracking-[0.18em] text-[#ff2d45]"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            WAITING FOR LIVE FEED
          </div>
        ) : sortedStrongZones.length === 0 ? (
          <div
            className="py-4 text-center text-xs text-neutral-400"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            NO NEAR ZONES WITHIN {settings.farAtr}×ATR
          </div>
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {sortedStrongZones.map((z) => {
              const isBuy = z.side === 'BUY';
              const isSelectedTf = z.mergedTfs.includes(selectedTf);
              const distPts =
                livePrice !== null ? getZoneDistancePts(z, livePrice) : z.distancePts;
              const distLabel =
                distPts === 0 ? '0.0 pts (INSIDE)' : `${distPts.toFixed(1)} pts`;
              const tfBadgesLabel = z.mergedTfs.map(formatTfLabel).join(' ');
              const stateLabel =
                z.status === 'FRESH'
                  ? 'FRESH · 100% left'
                  : `${z.status} ${z.retests}x · ${z.pctLeft}% left`;

              return (
                <button
                  key={z.id}
                  type="button"
                  onClick={() => setSelectedTf(z.tf)}
                  className={`w-full cursor-pointer border p-2.5 text-left transition-all ${
                    isSelectedTf
                      ? 'border-[#ff2d45] bg-[#14060a]'
                      : 'border-white/10 bg-black/80 hover:border-[#ff2d45]/50'
                  } ${z.consumed && !settings.showConsumedZones ? 'opacity-60' : ''}`}
                  style={{
                    clipPath: HUD_CLIP_SM,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className="px-1.5 py-0.5 text-[10px] font-extrabold text-black"
                        style={{ background: isBuy ? '#2fe08a' : '#ff4d66' }}
                      >
                        {tfBadgesLabel} {z.side}
                      </span>
                      <span className="text-xs font-bold text-white">
                        {z.bottom.toFixed(2)} – {z.top.toFixed(2)}
                      </span>
                      <span
                        className={`text-[10px] font-semibold ${
                          distPts === 0 ? 'text-[#2fe08a]' : 'text-cyan-400'
                        }`}
                      >
                        {distLabel}
                      </span>
                      <span className="text-[10px] text-neutral-400">
                        · {stateLabel}
                      </span>
                      {z.consumed && (
                        <span className="border border-rose-500/60 bg-rose-500/15 px-1 py-0.2 text-[9px] font-bold text-rose-300">
                          consumed
                        </span>
                      )}
                      {z.trimmed && (
                        <span className="border border-amber-400/50 bg-amber-400/10 px-1 py-0.2 text-[9px] font-bold text-amber-300">
                          trim
                        </span>
                      )}
                      {z.weak && (
                        <span className="border border-purple-400/50 bg-purple-400/10 px-1 py-0.2 text-[9px] font-bold text-purple-300">
                          weak
                        </span>
                      )}
                      {z.sweep && (
                        <span className="border border-cyan-400/50 bg-cyan-400/10 px-1 py-0.2 text-[9px] font-bold text-cyan-300">
                          sweep
                        </span>
                      )}
                      {z.isFar && (
                        <span className="border border-[#ff2d45]/60 bg-[#ff2d45]/15 px-1 py-0.2 text-[9px] font-bold text-[#ff2d45]">
                          FAR
                        </span>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <div className="h-1.5 w-10 bg-white/10">
                        <div
                          className="h-full"
                          style={{
                            width: `${z.power}%`,
                            background: isBuy ? '#2fe08a' : '#ff4d66',
                          }}
                        />
                      </div>
                      <span
                        className="text-xs font-extrabold"
                        style={{ color: isBuy ? '#2fe08a' : '#ff4d66' }}
                      >
                        PWR {z.power}
                      </span>
                    </div>
                  </div>

                  {/* Real inputs breakdown line: "score 9 · retests 0 · vol 1.8x · dep 2.4 ATR · HTF ok" */}
                  <div className="mt-1 text-[10px] text-neutral-400">{z.breakdown}</div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* 9) HISTORICAL PERFORMANCE + D.1 POWER CALIBRATION */}
      <section
        className="mt-2.5 border border-[#ff2d45]/35 bg-[#07070b] p-3.5"
        style={{ clipPath: HUD_CLIP }}
      >
        <div className="mb-2 flex items-center justify-between border-b border-[#ff2d45]/20 pb-2">
          <div>
            <span
              className="text-xs font-extrabold tracking-[0.2em] text-[#ff2d45]"
              style={{ fontFamily: "'Orbitron', sans-serif" }}
            >
              HISTORICAL PERFORMANCE
            </span>
            <div
              className="mt-0.5 text-[10px] text-neutral-400"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {replaySession ? replaySession.windowLabel : m1WindowInfo.windowLabel}
            </div>
          </div>
          <span
            className="text-[11px] font-bold text-neutral-300"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            TP2+ WIN RATE
          </span>
        </div>

        {!perf.isReliableSample && (
          <div
            className="mb-2.5 border border-amber-400/50 bg-amber-500/10 px-2.5 py-1 text-center text-[10px] font-extrabold tracking-wider text-amber-300"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            SMALL SAMPLE - NOT RELIABLE (n={perf.totalTrades} trades ·{' '}
            {replaySession ? replaySession.windowLabel : m1WindowInfo.windowLabel})
          </div>
        )}

        <div className="flex items-center gap-4">
          {/* Donut Chart */}
          <div className="relative flex h-20 w-20 shrink-0 items-center justify-center">
            <svg className="h-20 w-20 -rotate-90" viewBox="0 0 80 80">
              <circle
                cx="40"
                cy="40"
                r={donutRadius}
                fill="transparent"
                stroke="rgba(255, 255, 255, 0.1)"
                strokeWidth="7"
              />
              <circle
                cx="40"
                cy="40"
                r={donutRadius}
                fill="transparent"
                stroke="#00e676"
                strokeWidth="7"
                strokeDasharray={`${winStroke} ${donutCircumference}`}
                strokeLinecap="butt"
              />
            </svg>
            <div
              className="absolute inset-0 flex flex-col items-center justify-center text-center"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              <span className="text-sm font-extrabold text-white">
                {perf.tp2WinRatePct}%
              </span>
              <span className="text-[8px] text-neutral-400">TP2 WIN</span>
            </div>
          </div>

          {/* Core Stats Grid */}
          <div
            className="grid flex-1 grid-cols-3 gap-2 text-xs"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            <div className="border border-white/10 bg-black/70 p-2">
              <div className="text-[9px] text-neutral-500">TRADES</div>
              <div className="font-bold text-white">{perf.totalTrades}</div>
            </div>
            <div className="border border-white/10 bg-black/70 p-2">
              <div className="text-[9px] text-neutral-500">W / L / BE</div>
              <div className="font-bold text-white">
                <span className="text-[#00e676]">{perf.wins}</span>/
                <span className="text-[#ff2d45]">{perf.losses}</span>/
                <span className="text-amber-400">{perf.beCount}</span>
              </div>
            </div>
            <div className="border border-white/10 bg-black/70 p-2">
              <div className="text-[9px] text-neutral-500">EXPECTANCY</div>
              <div
                className="font-bold"
                style={{ color: perf.expectancyR >= 0 ? '#00e676' : '#ff2d45' }}
              >
                {perf.expectancyR >= 0
                  ? `+${perf.expectancyR.toFixed(2)}R`
                  : `${perf.expectancyR.toFixed(2)}R`}
              </div>
            </div>
            <div className="border border-white/10 bg-black/70 p-2">
              <div className="text-[9px] text-neutral-500">BE %</div>
              <div className="font-bold text-amber-400">{perf.bePct}%</div>
            </div>
            <div className="border border-white/10 bg-black/70 p-2">
              <div className="text-[9px] text-neutral-500">LOSS %</div>
              <div className="font-bold text-[#ff2d45]">{perf.lossPct}%</div>
            </div>
            <div className="border border-white/10 bg-black/70 p-2">
              <div className="text-[9px] text-neutral-500">CONFIDENCE</div>
              <div className="truncate font-bold text-[#ff2d45]">
                {perf.confidenceLabel}
              </div>
            </div>
          </div>
        </div>

        {/* Per-Session R */}
        <div
          className="mt-3 grid grid-cols-4 gap-2 text-center text-xs"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          {(['TOKYO', 'LONDON', 'NEW YORK', 'LDN+NY'] as const).map((sKey) => {
            const rVal = perf.sessionR[sKey];
            return (
              <div key={sKey} className="border border-white/10 bg-black/60 py-1.5">
                <div className="text-[9px] text-neutral-400">{sKey}</div>
                <div
                  className="font-bold"
                  style={{
                    color: rVal > 0 ? '#00e676' : rVal < 0 ? '#ff2d45' : '#94a3b8',
                  }}
                >
                  {rVal > 0 ? `+${rVal.toFixed(2)}R` : `${rVal.toFixed(2)}R`}
                </div>
              </div>
            );
          })}
        </div>

        {/* Confidence Bar */}
        <div className="mt-3">
          <div
            className="mb-1 flex items-center justify-between text-[10px]"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            <span className="text-neutral-400">SYSTEM CONFIDENCE</span>
            <span className="font-bold text-[#ff2d45]">{perf.confidenceLabel}</span>
          </div>
          <div className="h-2 w-full bg-white/10">
            <div
              className="h-full transition-all"
              style={{
                width: `${perf.confidencePct}%`,
                background:
                  perf.confidenceLabel === 'ELITE' || perf.confidenceLabel === 'STRONG'
                    ? '#00e676'
                    : perf.confidenceLabel === 'GOOD' || perf.confidenceLabel === 'NEUTRAL'
                    ? '#ffab00'
                    : '#ff2d45',
              }}
            />
          </div>
        </div>

        {/* D.1) POWER CALIBRATION SECTION */}
        <div
          className="mt-3.5 border-t border-[#ff2d45]/25 pt-3"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1">
            <span
              className="text-[10px] font-extrabold tracking-[0.18em] text-[#ff2d45]"
              style={{ fontFamily: "'Orbitron', sans-serif" }}
            >
              POWER CALIBRATION (HISTORICAL ZONES)
            </span>
            <span className="text-[9px] text-neutral-400">
              BOUNCE = +1R vs BREAK ({powerCalibration.totalResolved} resolved)
            </span>
          </div>

          <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5 text-[9.5px] text-neutral-400">
            <span>{powerCalibration.windowLabel}</span>
            {!powerCalibration.isReliableWindow && (
              <span className="border border-amber-400/50 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-extrabold text-amber-300">
                {powerCalibration.summaryLabel}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {powerCalibration.buckets.map((b) => (
              <div
                key={b.bucket}
                className="border border-white/10 bg-black/70 p-2 text-[10px]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-white">PWR {b.bucket}</span>
                  <span className="text-[9px] text-neutral-400">n={b.n}</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-neutral-400">Bounce:</span>
                  <span
                    className="font-bold"
                    style={{
                      color:
                        b.n === 0
                          ? '#94a3b8'
                          : b.bouncePct >= 55
                          ? '#00e676'
                          : b.bouncePct >= 45
                          ? '#ffab00'
                          : '#ff2d45',
                    }}
                  >
                    {b.n > 0 ? `${b.bouncePct}%` : '--'}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between">
                  <span className="text-neutral-400">Avg R:</span>
                  <span
                    className="font-bold"
                    style={{
                      color:
                        b.n === 0
                          ? '#94a3b8'
                          : b.avgR > 0
                          ? '#00e676'
                          : b.avgR < 0
                          ? '#ff2d45'
                          : '#94a3b8',
                    }}
                  >
                    {b.n > 0 ? `${b.avgR >= 0 ? '+' : ''}${b.avgR.toFixed(2)}R` : '--'}
                  </span>
                </div>
                {!b.reliable && (
                  <div className="mt-1 text-[8px] font-semibold text-amber-400">
                    SMALL SAMPLE - NOT RELIABLE
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 10) SESSIONS CARD (Tokyo/London/New York OPEN/CLOSED + window label) */}
      <section
        className="mt-2.5 border border-[#ff2d45]/35 bg-[#07070b] p-3.5"
        style={{ clipPath: HUD_CLIP }}
      >
        <div className="mb-2.5 flex items-center justify-between border-b border-[#ff2d45]/20 pb-2">
          <span
            className="text-xs font-extrabold tracking-[0.2em] text-[#ff2d45]"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            SESSIONS
          </span>
          <span
            className="text-[11px] font-bold text-amber-400"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {session.window}
          </span>
        </div>

        <div
          className="grid grid-cols-3 gap-2 text-center text-xs"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          {[
            { name: 'TOKYO', open: session.tokyo, hours: '09:00-18:00 JST' },
            { name: 'LONDON', open: session.london, hours: '08:00-16:30 LDN' },
            { name: 'NEW YORK', open: session.newYork, hours: '08:00-17:00 NY' },
          ].map((s) => (
            <div
              key={s.name}
              className="border p-2.5"
              style={{
                borderColor: s.open
                  ? 'rgba(0, 230, 118, 0.45)'
                  : 'rgba(255, 255, 255, 0.1)',
                background: s.open
                  ? 'rgba(0, 230, 118, 0.08)'
                  : 'rgba(0, 0, 0, 0.7)',
                clipPath: HUD_CLIP_SM,
              }}
            >
              <div
                className="text-[10px] font-bold text-white"
                style={{ fontFamily: "'Orbitron', sans-serif" }}
              >
                {s.name}
              </div>
              <div
                className="mt-1 text-xs font-extrabold"
                style={{ color: s.open ? '#00e676' : '#64748b' }}
              >
                {s.open ? 'OPEN' : 'CLOSED'}
              </div>
              <div className="mt-0.5 text-[9px] text-neutral-500">{s.hours}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 11) TRADE HISTORY */}
      <section
        className="mt-2.5 border border-[#ff2d45]/35 bg-[#07070b] p-3.5"
        style={{ clipPath: HUD_CLIP }}
      >
        <div className="mb-2.5 flex items-center justify-between border-b border-[#ff2d45]/20 pb-2">
          <span
            className="text-xs font-extrabold tracking-[0.2em] text-[#ff2d45]"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            {replaySession ? 'REPLAY TRADE HISTORY (ISOLATED)' : 'TRADE HISTORY'}
          </span>
          <span
            className="text-[11px] text-neutral-400"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {activeDisplayState.closedTrades.length} LOGGED
          </span>
        </div>

        {activeDisplayState.closedTrades.length === 0 ? (
          <div
            className="py-4 text-center text-xs text-neutral-400"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            NO CLOSED TRADES YET
          </div>
        ) : (
          <div
            className="max-h-72 space-y-2 overflow-y-auto pr-1 text-xs"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {activeDisplayState.closedTrades.map((t) => {
              const timeStr = new Date(t.time).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              });
              const badgeColor =
                t.class === 'win'
                  ? '#00e676'
                  : t.class === 'be'
                  ? '#ffab00'
                  : '#ff2d45';
              return (
                <div
                  key={t.id}
                  className="border border-white/10 bg-black/80 p-2.5"
                  style={{ clipPath: HUD_CLIP_SM }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-black"
                        style={{ background: badgeColor }}
                      >
                        {t.class.toUpperCase()} · {t.result}
                      </span>
                      <span className="font-bold text-white">
                        {t.side} {formatTfLabel(t.tf)}
                      </span>
                      <span className="text-[10px] text-neutral-400">
                        PWR {t.power} · {t.session}
                      </span>
                    </div>
                    <span className="text-[10px] text-neutral-500">{timeStr}</span>
                  </div>

                  <div className="mt-1.5 flex items-center justify-between text-[11px]">
                    <span className="text-neutral-300">
                      {t.entry.toFixed(2)} → {t.exit.toFixed(2)}
                    </span>
                    <span className="font-bold" style={{ color: badgeColor }}>
                      {t.pnl >= 0 ? `+$${t.pnl.toFixed(2)}` : `-$${Math.abs(t.pnl).toFixed(2)}`}{' '}
                      ({t.r >= 0 ? `+${t.r.toFixed(2)}R` : `${t.r.toFixed(2)}R`})
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 12) SEPARATED TRADE LOG & ZONE LOG */}
      <section
        className="mt-2.5 border border-[#ff2d45]/35 bg-[#07070b] p-3.5"
        style={{ clipPath: HUD_CLIP }}
      >
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-[#ff2d45]/20 pb-2">
          <div className="flex items-center gap-2">
            <span
              className="text-xs font-extrabold tracking-[0.2em] text-[#ff2d45]"
              style={{ fontFamily: "'Orbitron', sans-serif" }}
            >
              BOT LOGS
            </span>
            <div className="flex items-center gap-1" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              <button
                type="button"
                onClick={() => setActiveBotLogTab('trade')}
                className={`cursor-pointer px-2 py-0.5 text-[9.5px] font-bold transition-all ${
                  activeBotLogTab === 'trade'
                    ? 'border border-[#00e676] bg-[#00e676]/20 text-[#00e676]'
                    : 'border border-white/10 bg-black text-neutral-400 hover:text-white'
                }`}
              >
                TRADE LOG ({tradeLogs.length}/1000)
              </button>
              <button
                type="button"
                onClick={() => setActiveBotLogTab('zone')}
                className={`cursor-pointer px-2 py-0.5 text-[9.5px] font-bold transition-all ${
                  activeBotLogTab === 'zone'
                    ? 'border border-[#00e5ff] bg-[#00e5ff]/20 text-[#00e5ff]'
                    : 'border border-white/10 bg-black text-neutral-400 hover:text-white'
                }`}
              >
                ZONE LOG ({zoneLogs.length}/100)
              </button>
            </div>
          </div>

          <div
            className="flex items-center gap-1.5"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {(tradeLogs.length > 0 || zoneLogs.length > 0) && (
              <button
                type="button"
                onClick={handleClearBotLog}
                className="cursor-pointer border border-white/15 bg-black px-2 py-0.5 text-[9.5px] font-bold text-neutral-400 hover:border-white/40 hover:text-white"
              >
                CLEAR
              </button>
            )}
            <button
              type="button"
              onClick={handleCopyBotLog}
              className="cursor-pointer border border-[#ff2d45] bg-[#ff2d45]/15 px-2.5 py-0.5 text-[10px] font-bold text-[#ff2d45] transition-colors hover:bg-[#ff2d45] hover:text-black"
            >
              {copiedBotLog ? 'COPIED LOGS' : 'Copy bot log'}
            </button>
          </div>
        </div>

        {activeBotLogTab === 'trade' ? (
          tradeLogs.length === 0 ? (
            <div
              className="py-4 text-center text-xs text-neutral-400"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              NO TRADE EVENTS LOGGED YET
            </div>
          ) : (
            <div
              className="max-h-72 space-y-1.5 overflow-y-auto pr-1 text-[11px]"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {tradeLogs.map((entry) => {
                const badgeColor =
                  entry.type === 'ENTRY'
                    ? '#00e676'
                    : entry.type === 'TP1_BE' || entry.type === 'TP2' || entry.type === 'TP3'
                    ? '#00e5ff'
                    : entry.type === 'TRAIL_MOVE'
                    ? '#ffab00'
                    : entry.type === 'EXIT'
                    ? '#ff2d45'
                    : '#94a3b8';
                return (
                  <div
                    key={entry.id}
                    className="border border-white/10 bg-black/80 px-2.5 py-1.5"
                    style={{ clipPath: HUD_CLIP_SM }}
                  >
                    <div className="flex items-center justify-between gap-2 text-[9.5px]">
                      <span
                        className="px-1.5 py-0.2 font-extrabold text-black"
                        style={{ background: badgeColor }}
                      >
                        {entry.type}
                      </span>
                      <span className="text-neutral-500">
                        {entry.isoTime.replace('T', ' ').slice(0, 19)} UTC
                      </span>
                    </div>
                    <div className="mt-1 text-[10.5px] text-neutral-200">
                      {entry.message}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          zoneLogs.length === 0 ? (
            <div
              className="py-4 text-center text-xs text-neutral-400"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              NO ZONE EVENTS LOGGED YET
            </div>
          ) : (
            <div
              className="max-h-72 space-y-1.5 overflow-y-auto pr-1 text-[11px]"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {zoneLogs.map((entry) => {
                const badgeColor =
                  entry.type === 'ZONE_NEW'
                    ? '#2fe08a'
                    : entry.type === 'ZONE_NEAR'
                    ? '#00e5ff'
                    : entry.type === 'ZONE_DEAD'
                    ? '#ff2d45'
                    : '#94a3b8';
                return (
                  <div
                    key={entry.id}
                    className="border border-white/10 bg-black/80 px-2.5 py-1.5"
                    style={{ clipPath: HUD_CLIP_SM }}
                  >
                    <div className="flex items-center justify-between gap-2 text-[9.5px]">
                      <span
                        className="px-1.5 py-0.2 font-extrabold text-black"
                        style={{ background: badgeColor }}
                      >
                        {entry.type}
                      </span>
                      <span className="text-neutral-500">
                        {entry.isoTime.replace('T', ' ').slice(0, 19)} UTC
                      </span>
                    </div>
                    <div className="mt-1 text-[10.5px] text-neutral-200">
                      {entry.message}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </section>
    </div>
  );
};

export default RedSniperPage;
