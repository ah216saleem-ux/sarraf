import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Settings } from 'lucide-react';
import {
  REQUIRED_MIN_BARS_BY_TF,
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
  computeEquilibriumLevel,
  computeOpenTradeFloatingPnl,
  computePerformanceMetrics,
  computePowerCalibration,
  computeZoneProximityScore,
  createInitialReplaySession,
  DEFAULT_RED_SNIPER_SETTINGS,
  detectRuntimeZoneEvents,
  formatSeparatedBotLogForClipboard,
  formatReplayWindowLabel,
  formatZoneChartLabel,
  getZoneDistancePts,
  isZoneNear,
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
  saveSeparatedBotLogsToLocalStorage,
  saveDemoState,
  saveRedSniperSettings,
  stepAutoTraderOnTick,
  stepReplayM1Bar,
  TfBias,
} from './engine';
import { RedSniperChart } from './RedSniperChart';
import { RedSniperDebugPanel, RedSniperHealthData } from './RedSniperDebugPanel';

const UI_TIMEFRAMES: RedSniperTimeframe[] = ['5m', '15m', '30m', '1h', '4h', '1d'];

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
  return tf.toUpperCase();
}

function formatSessionDisplayName(rawName: string): string {
  const up = (rawName || '').toUpperCase();
  if (up.includes('LDN+NY') || (up.includes('LONDON') && up.includes('NEW YORK'))) {
    return 'LDN+NY';
  }
  if (up.includes('NEW YORK') || up === 'NY') return 'New York';
  if (up.includes('LONDON') || up === 'LDN') return 'London';
  if (up.includes('TOKYO') || up.includes('ASIA')) return 'Tokyo';
  return rawName || 'Off-Hours';
}

function resolveVerdictHeadline(tone: TfBias): string {
  if (tone === 'BULL') return 'BULLISH · BUY DIPS AT ZONES';
  if (tone === 'BEAR') return 'BEARISH · SELL THE RALLY';
  return 'RANGE · WAIT FOR ZONE REACTION';
}

function biasTileStyles(bias: TfBias): {
  text: string;
  border: string;
  bg: string;
} {
  if (bias === 'BULL') {
    return {
      text: '#7ff0c0',
      border: 'rgba(47, 208, 143, 0.5)',
      bg: 'rgba(20, 120, 80, 0.32)',
    };
  }
  if (bias === 'BEAR') {
    return {
      text: '#ff8a96',
      border: 'rgba(216, 58, 76, 0.55)',
      bg: 'rgba(139, 0, 0, 0.42)',
    };
  }
  return {
    text: '#d9ac4a',
    border: 'rgba(217, 172, 74, 0.45)',
    bg: 'rgba(217, 172, 74, 0.12)',
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
  } = useRedSniperFeed();

  const [selectedTf, setSelectedTf] = useState<RedSniperTimeframe>('15m');
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

  const knownZoneIdsRef = useRef<Set<string>>(new Set());
  const nearLoggedZoneIdsRef = useRef<Set<string>>(new Set());
  const deadLoggedZoneIdsRef = useRef<Set<string>>(new Set());
  const isInitialZoneLoadRef = useRef<boolean>(true);

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
        const serverEntries = Array.isArray(data.entries)
          ? data.entries
          : Array.isArray(data.tradeLogs)
          ? [...data.tradeLogs, ...(data.zoneLogs || [])]
          : [];
        if (serverEntries.length === 0) return;
        const separated = mergeSeparatedBotLogEntries(
          tradeLogs,
          zoneLogs,
          serverEntries,
          1000,
          100
        );
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

  const appendTradeLogs = useCallback(
    (entries: BotLogEntry[]) => {
      if (!entries || entries.length === 0) return;
      setTradeLogs((prev) => {
        const separated = mergeSeparatedBotLogEntries(
          prev,
          zoneLogs,
          entries,
          1000,
          100
        );
        saveSeparatedBotLogsToLocalStorage(separated.tradeLogs, separated.zoneLogs);
        return separated.tradeLogs;
      });
      fetch('/api/redsniper/bot-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ entries }),
      }).catch(() => {});
    },
    [zoneLogs]
  );

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
    fetch('/api/redsniper/bot-log', {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => {});
  }, []);

  const handleHighlightZone = useCallback((zoneId: string) => {
    setHighlightedZoneId((prev) => (prev === zoneId ? null : zoneId));
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

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

  // Run Red Sniper zone pipeline across all timeframes on closed candles + livePrice
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
    const deadZones =
      currentTfAnalysis?.debugAliveZones?.filter(
        (z) => z.reasonDropped === 'dead:closeBeyond'
      ) || [];
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

  // Step auto-trader on every live tick
  useEffect(() => {
    if (!hasLiveFeed || livePrice === null) return;
    if (replaySession?.isRunning) return;
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
      setReplaySession((prev) =>
        prev ? { ...prev, isRunning: false, isFinished: true } : null
      );
      return;
    }
    const timer = setInterval(() => {
      setReplaySession((prev) => {
        if (!prev || !prev.isRunning) return prev;
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

  const activeDisplayState =
    replaySession && (replaySession.isRunning || replaySession.isFinished)
      ? replaySession.demoState
      : demoState;
  const activeDisplayPrice =
    replaySession && replaySession.isRunning && replaySession.currentPrice !== null
      ? replaySession.currentPrice
      : livePrice;

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

  // Filter zones within farAtr * ATR14 (non-FAR) and respect hideConsumed
  const nearZones = useMemo(() => {
    const base = allZones.filter(
      (z) =>
        !z.isFar &&
        (!settings.hideConsumed || (!z.consumed && z.pctLeft >= 10 && z.retests < 4))
    );
    if (!hasLiveFeed || livePrice === null) return base;
    return base.filter((z) => isZoneNear(z, livePrice, settings.farAtr));
  }, [
    allZones,
    hasLiveFeed,
    livePrice,
    settings.farAtr,
    settings.hideConsumed,
  ]);

  // Top 6 Strong Zones by PWR across timeframes (uses the same newest zonesPerSide alive list)
  const topStrongZones = useMemo(() => {
    const source = !settings.hideConsumed
      ? mergedZones
      : mergedZones.filter((z) => !z.consumed && z.pctLeft >= 10 && z.retests < 4);
    const filteredFar = settings.showFarZones
      ? source
      : source.filter((z) => !z.isFar);
    const pool = filteredFar.length > 0 ? filteredFar : source;
    return [...pool]
      .sort(
        (a, b) =>
          b.power - a.power ||
          Number(Boolean(a.minor)) - Number(Boolean(b.minor)) ||
          a.distancePts - b.distancePts
      )
      .slice(0, 6);
  }, [mergedZones, settings.hideConsumed, settings.showFarZones]);

  // Selected or nearest zone Trade Plan (Phase 3)
  const pendingPlan = useMemo(() => {
    if (!hasLiveFeed || livePrice === null) return null;

    // 1) If user selected a zone on chart / chips / strong zones, use it
    const explicitSelected = highlightedZoneId
      ? allZones.find((z) => z.id === highlightedZoneId) || null
      : null;

    let targetZone = explicitSelected;

    // 2) Otherwise prefer nearest qualifying zone on selected timeframe, then across nearZones
    if (!targetZone) {
      const tfActiveZones = (byTf[selectedTf]?.chartZones || []).filter(
        (z) => !z.consumed && (z.status === 'FRESH' || z.status === 'TESTED')
      );
      const tfQualifying = tfActiveZones.filter(
        (z) => z.power >= settings.minPowerToTrade
      );
      const candidatePool =
        tfQualifying.length > 0
          ? tfQualifying
          : tfActiveZones.length > 0
          ? tfActiveZones
          : nearZones.filter(
              (z) =>
                (z.status === 'FRESH' || z.status === 'TESTED') &&
                z.power >= settings.minPowerToTrade
            );
      const fallbackPool =
        candidatePool.length > 0
          ? candidatePool
          : nearZones.filter((z) => z.status === 'FRESH' || z.status === 'TESTED');

      if (fallbackPool.length > 0) {
        const sortedByDist = [...fallbackPool].sort(
          (a, b) =>
            getZoneDistancePts(a, livePrice) - getZoneDistancePts(b, livePrice) ||
            computeZoneProximityScore(b, livePrice) -
              computeZoneProximityScore(a, livePrice)
        );
        targetZone = sortedByDist[0] || null;
      }
    }

    if (!targetZone) return null;

    const tfBars = bars[targetZone.tf] || [];
    const eqRange = computeEquilibriumLevel(tfBars, targetZone.tf);
    const rangeExtreme =
      targetZone.side === 'BUY' ? eqRange?.rangeHigh : eqRange?.rangeLow;

    return buildZoneTradeParameters(
      targetZone,
      livePrice,
      demoState.balance,
      allZones,
      verdict.bias1h,
      verdict.bias4h,
      settings,
      rangeExtreme
    );
  }, [
    hasLiveFeed,
    livePrice,
    highlightedZoneId,
    selectedTf,
    byTf,
    bars,
    nearZones,
    allZones,
    demoState.balance,
    verdict.bias1h,
    verdict.bias4h,
    settings,
  ]);

  const m1WindowInfo = useMemo(
    () => formatReplayWindowLabel(bars['1m'] || []),
    [bars]
  );

  const perf = useMemo(
    () =>
      computePerformanceMetrics(
        activeDisplayState.closedTrades,
        m1WindowInfo.windowSeconds
      ),
    [activeDisplayState.closedTrades, m1WindowInfo.windowSeconds]
  );

  const powerCalibration = useMemo(
    () => computePowerCalibration(bars, settings),
    [bars, settings]
  );

  const currentTfAnalysis = byTf[selectedTf];
  const currentTfCandles = bars[selectedTf] || [];
  const currentTfZones = !settings.hideConsumed
    ? currentTfAnalysis?.zones || []
    : currentTfAnalysis?.chartZones || [];
  const currentTfBuyCount = currentTfZones.filter((z) => z.side === 'BUY').length;
  const currentTfSellCount = currentTfZones.filter((z) => z.side === 'SELL').length;

  const activeRetestModeForTf: RetestMode = settings.retestModeOverride
    ? settings.retestMode
    : resolveDefaultRetestModeForTf(selectedTf);

  // Build Zone Events feed (NEW / BROKEN): combines live runtime zoneLogs with current detected NEW and BROKEN zones
  const zoneEventsFeed = useMemo(() => {
    const runtimeItems = zoneLogs
      .filter((e) => e.type === 'ZONE_NEW' || e.type === 'ZONE_DEAD')
      .map((e) => ({
        id: e.id,
        kind: e.type === 'ZONE_DEAD' ? ('BROKEN' as const) : ('NEW' as const),
        tf: e.tf ? formatTfLabel(e.tf) : 'MTF',
        side: e.side || ('BUY' as const),
        timeLabel: e.isoTime.replace('T', ' ').slice(11, 19) + ' UTC',
        message: e.message,
        ts: e.ts,
      }));

    if (runtimeItems.length >= 6) {
      return runtimeItems.slice(0, 12);
    }

    const snapshotItems: Array<{
      id: string;
      kind: 'NEW' | 'BROKEN';
      tf: string;
      side: 'BUY' | 'SELL';
      timeLabel: string;
      message: string;
      ts: number;
    }> = [...runtimeItems];

    const seenIds = new Set(snapshotItems.map((i) => i.id));

    for (const tf of UI_TIMEFRAMES) {
      const analysis = byTf[tf];
      if (!analysis) continue;
      for (const z of analysis.chartZones.slice(0, 2)) {
        const sid = `snap-new-${z.id}`;
        if (seenIds.has(sid)) continue;
        seenIds.add(sid);
        snapshotItems.push({
          id: sid,
          kind: 'NEW',
          tf: formatTfLabel(z.tf),
          side: z.side,
          timeLabel: new Date(z.time * 1000).toISOString().slice(11, 16) + ' UTC',
          message: `${formatTfLabel(z.tf)} ${z.side} zone ${z.bottom.toFixed(2)}–${z.top.toFixed(2)} · ${z.status} · PWR ${z.power}`,
          ts: z.time * 1000,
        });
      }
      const brokenDebug = (analysis.debugAliveZones || [])
        .filter((d) => d.reasonDropped === 'dead:closeBeyond')
        .slice(0, 2);
      for (const b of brokenDebug) {
        const sid = `snap-broken-${tf}-${b.side}-${b.time}-${b.bottom.toFixed(2)}`;
        if (seenIds.has(sid)) continue;
        seenIds.add(sid);
        snapshotItems.push({
          id: sid,
          kind: 'BROKEN',
          tf: formatTfLabel(tf),
          side: b.side,
          timeLabel: new Date(b.time * 1000).toISOString().slice(11, 16) + ' UTC',
          message: `${formatTfLabel(tf)} ${b.side} zone ${b.bottom.toFixed(2)}–${b.top.toFixed(2)} invalidated (candle closed beyond boundary)`,
          ts: b.time * 1000,
        });
      }
    }

    return snapshotItems.sort((a, b) => b.ts - a.ts).slice(0, 10);
  }, [zoneLogs, byTf]);

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
      zonesPerSide: settings.zonesPerSide,
      hideConsumed: settings.hideConsumed,
      showConsumedZones: settings.showConsumedZones,
      debugCounts: currentTfAnalysis?.debugCounts ?? null,
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
    powerCalibration,
  ]);

  const donutRadius = 32;
  const donutCircumference = 2 * Math.PI * donutRadius;
  const winStroke = (perf.tp2WinRatePct / 100) * donutCircumference;

  const isSmallSample = perf.totalTrades < 30;
  const formattedSessionName = formatSessionDisplayName(session.name);
  const verdictHeadline = resolveVerdictHeadline(verdict.tone);

  return (
    <div className="rs-shell min-h-screen w-full select-none pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] pt-[max(0.5rem,env(safe-area-inset-top,0px))]">
      {/* Background 40px Grid + Soft Dark-Red Radial Top Glow + Slow Scanline */}
      <div className="rs-bg-backdrop" aria-hidden="true" />
      <div className="rs-scanline" aria-hidden="true" />

      <div className="relative z-10 mx-auto w-full max-w-[820px] space-y-3 px-3 sm:px-4">
        {/* ===================================================================
            1. HEADER: SRF round badge, "SARRAF // TERMINAL // XAU", LIVE pill, live price on right
           =================================================================== */}
        <header className="rs-card flex items-center justify-between gap-2 px-3.5 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#d9ac4a]/60 bg-[#7a1422]/45 text-[11px] font-bold tracking-wider text-[#d9ac4a]">
              SRF
            </div>
            <span className="rs-heading truncate text-xs font-bold sm:text-sm">
              SARRAF // TERMINAL // XAU
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            <span
              className="rs-label inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold"
              style={{
                background:
                  isFeedReady && !isMarketClosed
                    ? 'rgba(20, 120, 80, 0.32)'
                    : 'rgba(139, 0, 0, 0.42)',
                border: `1px solid ${
                  isFeedReady && !isMarketClosed ? '#2fd08f' : '#d83a4c'
                }`,
                color:
                  isFeedReady && !isMarketClosed ? '#7ff0c0' : '#ff8a96',
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor:
                    isFeedReady && !isMarketClosed ? '#2fd08f' : '#d83a4c',
                }}
              />
              {isMarketClosed ? 'CLOSED' : isFeedReady ? 'LIVE' : 'WAIT'}
            </span>

            <span className="rs-mono text-sm font-bold text-[#f3f4f6] sm:text-base">
              {hasLiveFeed && livePrice !== null
                ? `$${livePrice.toFixed(2)}`
                : '--'}
            </span>
          </div>
        </header>

        {/* Active Replay Banner when running/finished */}
        {replaySession && (
          <div className="rs-card border-[#d83a4c] p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="rs-heading text-xs font-bold text-[#ff8a96]">
                {replaySession.isRunning
                  ? 'REPLAY MODE ACTIVE (20X)'
                  : 'REPLAY SUMMARY (ISOLATED)'}
              </span>
              <div className="flex items-center gap-1.5">
                {replaySession.isRunning ? (
                  <button
                    type="button"
                    onClick={handleStopReplay}
                    className="rs-label cursor-pointer rounded-md border border-[#d83a4c] bg-[#7a1422] px-2.5 py-1 text-[10px] font-bold text-white"
                  >
                    STOP
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleClearReplay}
                    className="rs-label cursor-pointer rounded-md border border-[#d9ac4a]/50 bg-black/60 px-2.5 py-1 text-[10px] font-bold text-[#d9ac4a]"
                  >
                    EXIT REPLAY
                  </button>
                )}
              </div>
            </div>
            <div className="rs-mono mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#9ca3af]">
              <span>
                Bar {replaySession.currentIndex} / {replaySession.totalBars}
                {replaySession.currentPrice
                  ? ` · $${replaySession.currentPrice.toFixed(2)}`
                  : ''}
              </span>
              <span className="text-[#5ad7ff]">
                Replay Bal: ${replaySession.demoState.balance.toFixed(2)} · Max DD: $
                {replaySession.maxDrawdownDollars.toFixed(2)} (
                {replaySession.maxDrawdownPct.toFixed(1)}%)
              </span>
            </div>
          </div>
        )}

        {/* ===================================================================
            2. RED SNIPER HERO CARD: date + session, big live price, MTF bias tiles, verdict bar + SCORE
           =================================================================== */}
        <section className="rs-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[rgba(139,20,32,0.35)] pb-3">
            <div>
              <div className="rs-heading text-sm font-bold sm:text-base">
                RED SNIPER // TACTICAL MATRIX
              </div>
              <div className="rs-mono mt-1 flex flex-wrap items-center gap-2 text-xs text-[#9ca3af]">
                <span>{formatHudDate(nowDate)}</span>
                <span aria-hidden="true">·</span>
                <span className="text-[#5ad7ff]">
                  Session: {formattedSessionName}
                </span>
                <span aria-hidden="true">·</span>
                <span className="text-[11px] text-[#9ca3af]">
                  Tokyo {session.tokyo ? 'OPEN' : 'OFF'} / London{' '}
                  {session.london ? 'OPEN' : 'OFF'} / New York{' '}
                  {session.newYork ? 'OPEN' : 'OFF'}
                </span>
              </div>
            </div>

            <div className="text-right">
              <div className="rs-mono text-2xl font-extrabold tracking-tight text-[#f3f4f6] sm:text-3xl">
                {hasLiveFeed && livePrice !== null
                  ? `$${livePrice.toFixed(2)}`
                  : 'WAITING FOR FEED'}
              </div>
              <div className="rs-mono mt-0.5 text-[11px] text-[#5ad7ff]">
                {isMarketClosed
                  ? 'MARKET CLOSED'
                  : spread !== null
                  ? `SPR ${spread.toFixed(2)} · BID ${bid?.toFixed(2) ?? '--'} / ASK ${ask?.toFixed(2) ?? '--'}`
                  : connectionStatus}
              </div>
            </div>
          </div>

          {/* MTF Bias Tiles: M30 / H1 / H4 / D1 */}
          <div className="mt-3">
            <div className="rs-label mb-1.5 text-[10px] font-semibold text-[#9ca3af]">
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
                const st = biasTileStyles(item.bias);
                return (
                  <div
                    key={item.label}
                    className="flex flex-col items-center justify-center rounded-[10px] py-2 text-center"
                    style={{
                      background: st.bg,
                      border: `1px solid ${st.border}`,
                    }}
                  >
                    <span className="rs-label text-[10px] font-bold text-[#f3f4f6]/80">
                      {item.label}
                    </span>
                    <span
                      className="rs-mono mt-0.5 text-xs font-bold"
                      style={{ color: st.text }}
                    >
                      {isFeedReady ? item.bias : 'WAIT'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Verdict Bar */}
          <div
            className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[10px] px-3.5 py-2.5"
            style={{
              background:
                verdict.tone === 'BULL'
                  ? 'rgba(20, 120, 80, 0.32)'
                  : verdict.tone === 'BEAR'
                  ? 'rgba(139, 0, 0, 0.42)'
                  : 'rgba(217, 172, 74, 0.14)',
              border: `1px solid ${
                verdict.tone === 'BULL'
                  ? '#2fd08f'
                  : verdict.tone === 'BEAR'
                  ? '#d83a4c'
                  : '#d9ac4a'
              }`,
            }}
          >
            <span
              className="rs-label text-xs font-bold tracking-[0.14em]"
              style={{
                color:
                  verdict.tone === 'BULL'
                    ? '#7ff0c0'
                    : verdict.tone === 'BEAR'
                    ? '#ff8a96'
                    : '#d9ac4a',
              }}
            >
              {isFeedReady ? verdictHeadline : 'WAITING FOR LIVE FEED'}
            </span>
            <span className="rs-mono text-xs font-bold text-[#d9ac4a]">
              SCORE {verdict.score > 0 ? `+${verdict.score}` : verdict.score}
            </span>
          </div>
        </section>

        {/* ===================================================================
            3. ACCOUNT TILES: Balance, Equity, Open P&L, Session
           =================================================================== */}
        <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div className="rs-card p-3">
            <div className="rs-label text-[10px] font-semibold text-[#9ca3af]">
              BALANCE
            </div>
            <div className="rs-mono mt-1 text-base font-bold text-[#f3f4f6]">
              ${activeDisplayState.balance.toFixed(2)}
            </div>
          </div>

          <div className="rs-card p-3">
            <div className="rs-label text-[10px] font-semibold text-[#9ca3af]">
              EQUITY
            </div>
            <div className="rs-mono mt-1 text-base font-bold text-[#f3f4f6]">
              ${equity.toFixed(2)}
            </div>
          </div>

          <div className="rs-card p-3">
            <div className="rs-label text-[10px] font-semibold text-[#9ca3af]">
              OPEN P&amp;L
            </div>
            <div
              className="rs-mono mt-1 text-base font-bold"
              style={{
                color:
                  openPnl > 0
                    ? '#7ff0c0'
                    : openPnl < 0
                    ? '#ff8a96'
                    : '#f3f4f6',
              }}
            >
              {openPnl >= 0
                ? `+$${openPnl.toFixed(2)}`
                : `-$${Math.abs(openPnl).toFixed(2)}`}
            </div>
          </div>

          <div className="rs-card p-3">
            <div className="rs-label text-[10px] font-semibold text-[#9ca3af]">
              SESSION
            </div>
            <div className="rs-mono mt-1 truncate text-sm font-bold text-[#5ad7ff]">
              {formattedSessionName}
            </div>
          </div>
        </section>

        {/* ===================================================================
            4. TIMEFRAME SELECTOR: 5M, 15M, 30M, 1H, 4H, 1D (1m and 3m removed)
           =================================================================== */}
        <section className="grid grid-cols-6 gap-2">
          {UI_TIMEFRAMES.map((tf) => {
            const active = selectedTf === tf;
            const tfBarCount = bars[tf]?.length ?? 0;
            const tfMinBars = REQUIRED_MIN_BARS_BY_TF[tf] ?? 1000;
            const isHistoryShort = tfBarCount < tfMinBars;
            return (
              <button
                key={tf}
                type="button"
                onClick={() => setSelectedTf(tf)}
                className="rs-label flex min-h-[42px] cursor-pointer flex-col items-center justify-center rounded-[10px] px-1 py-1.5 text-center text-xs font-bold transition-colors"
                style={{
                  backgroundColor: active ? '#7a1422' : 'rgba(11, 8, 10, 0.76)',
                  border: active
                    ? '1px solid #d83a4c'
                    : '1px solid rgba(139, 20, 32, 0.45)',
                  color: active ? '#ffffff' : '#d1d5db',
                  boxShadow: active
                    ? '0 0 16px rgba(216, 58, 76, 0.35)'
                    : 'none',
                }}
              >
                <span>{formatTfLabel(tf)}</span>
                {isHistoryShort && (
                  <span
                    className="rs-mono mt-0.5 rounded bg-amber-500/20 px-1 py-0.2 text-[7.5px] font-bold tracking-normal text-amber-300"
                    title={`Loaded ${tfBarCount} bars (minimum required: ${tfMinBars})`}
                  >
                    HISTORY SHORT ({tfBarCount} bars)
                  </span>
                )}
              </button>
            );
          })}
        </section>

        {/* ===================================================================
            5. TACTICAL CHART CARD, with zone chips under it
           =================================================================== */}
        <section className="rs-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[rgba(139,20,32,0.45)] px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <h2 className="rs-heading text-xs font-bold sm:text-sm">
                TACTICAL CHART // {formatTfLabel(selectedTf)}
              </h2>
              {isLoading && (
                <span className="rs-mono text-[10px] text-[#5ad7ff]">
                  SYNCING...
                </span>
              )}
            </div>

            <div className="rs-mono flex flex-wrap items-center gap-2 text-[11px] font-semibold">
              <span style={{ color: '#7ff0c0' }}>BUY {currentTfBuyCount}</span>
              <span className="text-[#6b7280]">·</span>
              <span style={{ color: '#ff8a96' }}>SELL {currentTfSellCount}</span>
              <span className="text-[#6b7280]">·</span>
              <span style={{ color: '#5ad7ff' }}>
                ATR {currentTfAnalysis ? currentTfAnalysis.atr14.toFixed(2) : '--'}
              </span>

              <button
                type="button"
                onClick={handleCopyZoneDebug}
                title="Copy JSON zone diagnostics"
                className="rs-label cursor-pointer rounded-md border border-[rgba(139,20,32,0.55)] bg-black/50 px-2 py-1 text-[9.5px] font-bold text-[#d9ac4a] hover:border-[#d9ac4a]"
              >
                {copiedDebug ? 'COPIED' : 'DEBUG JSON'}
              </button>

              <button
                type="button"
                onClick={() => setShowDebugPanel((v) => !v)}
                className="rs-label cursor-pointer rounded-md border px-2 py-1 text-[9.5px] font-bold"
                style={{
                  borderColor: showDebugPanel
                    ? '#d9ac4a'
                    : 'rgba(139, 20, 32, 0.55)',
                  backgroundColor: showDebugPanel ? '#7a1422' : 'rgba(0,0,0,0.5)',
                  color: showDebugPanel ? '#ffffff' : '#9ca3af',
                }}
              >
                DIAGNOSTICS
              </button>

              <button
                type="button"
                onClick={() => setSettingsOpen((v) => !v)}
                aria-label="Open Red Sniper Settings"
                title="Red Sniper Settings"
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border transition-colors"
                style={{
                  borderColor: settingsOpen
                    ? '#d9ac4a'
                    : 'rgba(139, 20, 32, 0.55)',
                  backgroundColor: settingsOpen ? '#7a1422' : 'rgba(0,0,0,0.5)',
                  color: settingsOpen ? '#d9ac4a' : '#d1d5db',
                }}
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {showDebugPanel && (
            <div className="border-b border-[rgba(139,20,32,0.45)] p-3">
              <RedSniperDebugPanel
                byTf={byTf}
                settings={settings}
                selectedTf={selectedTf}
                onUpdateSettings={updateSettings}
              />
            </div>
          )}

          {settingsOpen && (
            <div className="rs-mono border-b border-[rgba(139,20,32,0.45)] bg-black/80 p-3.5 text-xs">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="rs-heading text-xs font-bold">
                  ENGINE PARAMETERS &amp; REPLAY
                </span>
                <button
                  type="button"
                  onClick={handleResetSettings}
                  className="rs-label cursor-pointer rounded border border-[rgba(139,20,32,0.55)] bg-black px-2.5 py-1 text-[10px] font-bold text-[#d9ac4a]"
                >
                  RESET DEFAULTS
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                <label className="rs-subcard flex flex-col gap-1 p-2">
                  <span className="text-[10px] text-[#9ca3af]">
                    ZONES / SIDE ({settings.zonesPerSide ?? 5})
                  </span>
                  <input
                    type="range"
                    min={3}
                    max={5}
                    step={1}
                    value={settings.zonesPerSide ?? 5}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      updateSettings({
                        zonesPerSide: val,
                        maxZonesPerTf: val,
                      });
                    }}
                    className="accent-[#d83a4c]"
                  />
                </label>

                <div className="rs-subcard flex flex-col gap-1 p-2">
                  <span className="text-[10px] text-[#9ca3af]">ZONE MODE</span>
                  <div className="grid grid-cols-2 gap-1">
                    {(['WICK', 'BODY'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => updateSettings({ zoneMode: m })}
                        className="cursor-pointer rounded py-1 text-[10px] font-bold"
                        style={{
                          backgroundColor:
                            settings.zoneMode === m ? '#7a1422' : '#030303',
                          color:
                            settings.zoneMode === m ? '#ffffff' : '#9ca3af',
                          border: '1px solid rgba(139, 20, 32, 0.45)',
                        }}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rs-subcard flex flex-col gap-1 p-2">
                  <div className="flex items-center justify-between text-[10px] text-[#9ca3af]">
                    <span>RETEST MODE</span>
                    {settings.retestModeOverride && (
                      <button
                        type="button"
                        onClick={() =>
                          updateSettings({ retestModeOverride: false })
                        }
                        className="cursor-pointer text-[9px] text-[#d9ac4a] underline"
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
                          updateSettings({
                            retestMode: m,
                            retestModeOverride: true,
                          })
                        }
                        className="cursor-pointer rounded py-1 text-[9px] font-bold"
                        style={{
                          backgroundColor:
                            activeRetestModeForTf === m ? '#7a1422' : '#030303',
                          color:
                            activeRetestModeForTf === m ? '#ffffff' : '#9ca3af',
                          border: '1px solid rgba(139, 20, 32, 0.45)',
                        }}
                      >
                        {m === 'TOUCH_CANDLES' ? 'TOUCH' : m}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="rs-subcard flex flex-col gap-1 p-2">
                  <span className="text-[10px] text-[#9ca3af]">
                    HEIGHT CAP ({settings.heightCapAtr.toFixed(1)}x ATR)
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
                    className="accent-[#d83a4c]"
                  />
                </label>

                <label className="rs-subcard flex flex-col gap-1 p-2">
                  <span className="text-[10px] text-[#9ca3af]">
                    DEAD ATR ({settings.deadAtr.toFixed(2)}x ATR)
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
                    className="accent-[#d83a4c]"
                  />
                </label>

                <label className="rs-subcard flex flex-col gap-1 p-2">
                  <span className="text-[10px] text-[#9ca3af]">
                    FAR ATR ({settings.farAtr}x ATR)
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
                    className="accent-[#d83a4c]"
                  />
                </label>

                <div className="rs-subcard flex items-center justify-between p-2">
                  <span className="text-[10px] text-[#9ca3af]">BOS / CHoCH</span>
                  <button
                    type="button"
                    onClick={() =>
                      updateSettings({ showBosChoch: !settings.showBosChoch })
                    }
                    className="cursor-pointer rounded px-2.5 py-0.5 text-[10px] font-bold"
                    style={{
                      backgroundColor: settings.showBosChoch
                        ? 'rgba(20, 120, 80, 0.32)'
                        : '#030303',
                      color: settings.showBosChoch ? '#7ff0c0' : '#9ca3af',
                      border: `1px solid ${
                        settings.showBosChoch
                          ? '#2fd08f'
                          : 'rgba(139, 20, 32, 0.45)'
                      }`,
                    }}
                  >
                    {settings.showBosChoch ? 'ON' : 'OFF'}
                  </button>
                </div>

                <div className="rs-subcard flex items-center justify-between p-2">
                  <span className="text-[10px] text-[#9ca3af]">
                    HIDE CONSUMED
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const nextHide = !settings.hideConsumed;
                      updateSettings({
                        hideConsumed: nextHide,
                        showConsumedZones: !nextHide,
                      });
                    }}
                    className="cursor-pointer rounded px-2.5 py-0.5 text-[10px] font-bold"
                    style={{
                      backgroundColor: settings.hideConsumed
                        ? '#7a1422'
                        : '#030303',
                      color: settings.hideConsumed ? '#ffffff' : '#9ca3af',
                      border: '1px solid rgba(139, 20, 32, 0.45)',
                    }}
                  >
                    {settings.hideConsumed ? 'ON' : 'OFF'}
                  </button>
                </div>

                <div className="rs-subcard flex items-center justify-between p-2">
                  <span className="text-[10px] text-[#9ca3af]">20X REPLAY</span>
                  {replaySession?.isRunning ? (
                    <button
                      type="button"
                      onClick={handleStopReplay}
                      className="cursor-pointer rounded bg-[#d83a4c] px-2.5 py-0.5 text-[10px] font-bold text-black"
                    >
                      STOP
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleStartReplay}
                      disabled={(bars['1m']?.length ?? 0) < 30}
                      className="cursor-pointer rounded border border-[#d9ac4a]/50 bg-[#7a1422] px-2.5 py-0.5 text-[10px] font-bold text-[#d9ac4a] disabled:opacity-40"
                    >
                      START
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <RedSniperChart
            tf={selectedTf}
            candles={currentTfCandles}
            m5Candles={bars['5m'] || []}
            atr14={currentTfAnalysis?.atr14 ?? 2.5}
            zones={currentTfZones}
            structures={currentTfAnalysis?.structures || []}
            showBosChoch={settings.showBosChoch}
            onToggleStructure={() =>
              updateSettings({ showBosChoch: !settings.showBosChoch })
            }
            onSelectZone={handleHighlightZone}
            showFarZones={settings.showFarZones}
            showConsumedZones={settings.showConsumedZones}
            hideConsumed={settings.hideConsumed}
            zonesPerSide={settings.zonesPerSide}
            maxZones={settings.maxZonesPerTf}
            highlightedZoneId={highlightedZoneId}
            openTrades={activeDisplayState.openTrades}
            pendingPlan={pendingPlan}
            livePrice={activeDisplayPrice}
            isConnected={isFeedReady}
          />

          {/* Zone Chips under the chart */}
          <div className="border-t border-[rgba(139,20,32,0.45)] px-3.5 py-2.5">
            {currentTfZones.length === 0 ? (
              <div className="rs-mono text-center text-[11px] text-[#9ca3af]">
                No active zones on {formatTfLabel(selectedTf)} timeframe
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                {currentTfZones.map((z) => {
                  const isSell = z.side === 'SELL';
                  const isHigh = highlightedZoneId === z.id;
                  const stroke = isSell ? '#d83a4c' : '#2fd08f';
                  const textCol = isSell ? '#ff8a96' : '#7ff0c0';
                  const fillCol = isSell
                    ? 'rgba(139, 0, 0, 0.42)'
                    : 'rgba(20, 120, 80, 0.32)';
                  return (
                    <button
                      key={z.id}
                      type="button"
                      onClick={() => handleHighlightZone(z.id)}
                      title="Tap to select zone for Trade Plan"
                      className="rs-mono cursor-pointer rounded-lg px-2.5 py-1 text-[10.5px] font-bold transition-all"
                      style={{
                        color: isHigh ? '#d9ac4a' : textCol,
                        backgroundColor: fillCol,
                        border: `1px solid ${isHigh ? '#d9ac4a' : stroke}`,
                      }}
                    >
                      {formatZoneChartLabel(z)} · ${z.bottom.toFixed(2)}–$
                      {z.top.toFixed(2)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* ===================================================================
            6. TRADE PLAN CARD directly under the chart (for selected zone)
           =================================================================== */}
        <section className="rs-card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[rgba(139,20,32,0.35)] pb-2.5">
            <div className="flex items-center gap-2">
              <h2 className="rs-heading text-xs font-bold sm:text-sm">
                TRADE PLAN
              </h2>
              {pendingPlan && (
                <span className="rs-mono text-[10.5px] text-[#9ca3af]">
                  // {formatTfLabel(pendingPlan.zone.tf)}{' '}
                  {highlightedZoneId === pendingPlan.zone.id
                    ? '(SELECTED ZONE)'
                    : '(NEAREST ZONE)'}
                </span>
              )}
            </div>

            {pendingPlan && (
              <div className="flex flex-wrap items-center gap-1.5">
                {/* Structure chip: CHoCH or BOS */}
                <span
                  className="rs-mono rounded px-2 py-0.5 text-[10px] font-bold"
                  style={{
                    backgroundColor: pendingPlan.zone.choch
                      ? 'rgba(217, 172, 74, 0.18)'
                      : 'rgba(90, 215, 255, 0.14)',
                    border: `1px solid ${
                      pendingPlan.zone.choch ? '#d9ac4a' : '#5ad7ff'
                    }`,
                    color: pendingPlan.zone.choch ? '#d9ac4a' : '#5ad7ff',
                  }}
                >
                  {pendingPlan.structureChip}
                </span>

                {/* Score chip: score x/6 */}
                <span
                  className="rs-mono rounded px-2 py-0.5 text-[10px] font-bold"
                  style={{
                    backgroundColor:
                      pendingPlan.scoreCount >= 4
                        ? 'rgba(20, 120, 80, 0.32)'
                        : 'rgba(139, 0, 0, 0.42)',
                    border: `1px solid ${
                      pendingPlan.scoreCount >= 4 ? '#2fd08f' : '#d83a4c'
                    }`,
                    color:
                      pendingPlan.scoreCount >= 4 ? '#7ff0c0' : '#ff8a96',
                  }}
                >
                  {pendingPlan.scoreChip}
                </span>

                <span className="rs-mono text-xs font-bold text-[#d9ac4a]">
                  PWR {pendingPlan.zone.power}
                </span>
              </div>
            )}
          </div>

          {!isFeedReady ? (
            <div className="rs-label py-4 text-center text-xs font-bold text-[#d9ac4a]">
              WAITING FOR LIVE FEED
            </div>
          ) : pendingPlan && livePrice !== null ? (
            <div className="space-y-3">
              <div className="rs-subcard p-3.5">
                {/* Status badge + Lot + Zone bounds */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className="rs-mono rounded px-2.5 py-1 text-xs font-bold"
                    style={{
                      background: pendingPlan.insideZone
                        ? 'rgba(217, 172, 74, 0.2)'
                        : pendingPlan.side === 'BUY'
                        ? 'rgba(20, 120, 80, 0.32)'
                        : 'rgba(139, 0, 0, 0.42)',
                      border: `1px solid ${
                        pendingPlan.insideZone
                          ? '#d9ac4a'
                          : pendingPlan.side === 'BUY'
                          ? '#2fd08f'
                          : '#d83a4c'
                      }`,
                      color: pendingPlan.insideZone
                        ? '#d9ac4a'
                        : pendingPlan.side === 'BUY'
                        ? '#7ff0c0'
                        : '#ff8a96',
                    }}
                  >
                    {pendingPlan.statusBadge}
                  </span>

                  <span className="rs-mono text-xs font-bold text-[#f3f4f6]">
                    ZONE ${pendingPlan.zone.bottom.toFixed(2)} – $
                    {pendingPlan.zone.top.toFixed(2)}
                  </span>
                </div>

                {/* Warning if score < 4 ("not A+, use caution") */}
                {pendingPlan.cautionWarning && (
                  <div
                    className="rs-mono mt-2.5 rounded-lg px-3 py-1.5 text-xs font-bold"
                    style={{
                      backgroundColor: 'rgba(139, 0, 0, 0.38)',
                      border: '1px solid #d83a4c',
                      color: '#ff8a96',
                    }}
                  >
                    ⚠ {pendingPlan.cautionWarning} (score{' '}
                    {pendingPlan.scoreCount}/6)
                  </div>
                )}

                {pendingPlan.htfBlocked && (
                  <div className="rs-mono mt-2 text-[11px] font-semibold text-[#ff8a96]">
                    HTF BLOCKED: 1H + 4H oppose {pendingPlan.side}
                  </div>
                )}

                {/* Entry, Stop Loss, Lot, TP1 = 1R, TP2 = 2R, TP3 */}
                <div className="rs-mono mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-6">
                  <div className="rounded-lg border border-[rgba(139,20,32,0.35)] bg-black/50 p-2">
                    <div className="rs-label text-[9px] text-[#9ca3af]">
                      ENTRY (NEAR EDGE)
                    </div>
                    <div className="mt-0.5 font-bold text-[#5ad7ff]">
                      ${pendingPlan.entry.toFixed(2)}
                    </div>
                  </div>

                  <div className="rounded-lg border border-[rgba(139,20,32,0.35)] bg-black/50 p-2">
                    <div className="rs-label text-[9px] text-[#9ca3af]">
                      STOP LOSS (0.1 ATR)
                    </div>
                    <div className="mt-0.5 font-bold text-[#ff8a96]">
                      ${pendingPlan.sl.toFixed(2)}
                    </div>
                  </div>

                  <div className="rounded-lg border border-[rgba(139,20,32,0.35)] bg-black/50 p-2">
                    <div className="rs-label text-[9px] text-[#9ca3af]">
                      LOT ({settings.riskPct.toFixed(2)}% RISK)
                    </div>
                    <div className="mt-0.5 font-bold text-[#f3f4f6]">
                      {pendingPlan.lots.toFixed(2)} LOT
                    </div>
                  </div>

                  <div className="rounded-lg border border-[rgba(139,20,32,0.35)] bg-black/50 p-2">
                    <div className="rs-label text-[9px] text-[#9ca3af]">
                      TP1 (1R · 50%)
                    </div>
                    <div className="mt-0.5 font-bold text-[#7ff0c0]">
                      ${pendingPlan.tp1.toFixed(2)}
                    </div>
                  </div>

                  <div className="rounded-lg border border-[rgba(139,20,32,0.35)] bg-black/50 p-2">
                    <div className="rs-label text-[9px] text-[#9ca3af]">
                      TP2 (2R · 30%)
                    </div>
                    <div className="mt-0.5 font-bold text-[#7ff0c0]">
                      ${pendingPlan.tp2.toFixed(2)}
                    </div>
                  </div>

                  <div className="rounded-lg border border-[rgba(139,20,32,0.35)] bg-black/50 p-2">
                    <div className="rs-label text-[9px] text-[#9ca3af]">
                      TP3 ({pendingPlan.tp3IsLiquidity ? 'LIQ' : '3R'} · 20%)
                    </div>
                    <div className="mt-0.5 font-bold text-[#d9ac4a]">
                      ${pendingPlan.tp3.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Active Open Sniper Positions (if any) */}
              {activeDisplayState.openTrades.length > 0 && (
                <div className="space-y-2 pt-1">
                  <div className="rs-label text-[10px] font-bold text-[#5ad7ff]">
                    OPEN SNIPER POSITIONS ({activeDisplayState.openTrades.length}
                    /3)
                  </div>
                  {activeDisplayState.openTrades.map((tr: OpenSniperTrade) => {
                    const { totalPnl, currentR } = computeOpenTradeFloatingPnl(
                      tr,
                      activeDisplayPrice
                    );
                    const isBuy = tr.side === 'BUY';
                    return (
                      <div key={tr.id} className="rs-subcard p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span
                              className="rs-label rounded px-2 py-0.5 text-[10px] font-bold"
                              style={{
                                background: isBuy
                                  ? 'rgba(20, 120, 80, 0.32)'
                                  : 'rgba(139, 0, 0, 0.42)',
                                border: `1px solid ${
                                  isBuy ? '#2fd08f' : '#d83a4c'
                                }`,
                                color: isBuy ? '#7ff0c0' : '#ff8a96',
                              }}
                            >
                              {tr.side} {formatTfLabel(tr.tf)}
                            </span>
                            <span className="rs-mono text-xs font-bold text-[#f3f4f6]">
                              {tr.initialLots.toFixed(2)} LOT (
                              {Math.round(tr.remPct * 100)}% OPEN)
                            </span>
                            <span className="rs-mono text-[11px] font-bold text-[#d9ac4a]">
                              PWR {tr.power}
                            </span>
                          </div>

                          {!replaySession && (
                            <button
                              type="button"
                              onClick={() => handleManualCloseTrade(tr.id)}
                              className="rs-label cursor-pointer rounded border border-[#d83a4c] bg-[#7a1422] px-2.5 py-0.5 text-[10px] font-bold text-[#ff8a96] hover:bg-[#d83a4c] hover:text-black"
                            >
                              CLOSE
                            </button>
                          )}
                        </div>

                        <div className="rs-mono mt-2 grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <span className="rs-label text-[9px] text-[#9ca3af]">
                              ENTRY
                            </span>
                            <div className="font-bold text-[#5ad7ff]">
                              ${tr.entry.toFixed(2)}
                            </div>
                          </div>
                          <div>
                            <span className="rs-label text-[9px] text-[#9ca3af]">
                              STOP LOSS
                            </span>
                            <div
                              className="font-bold"
                              style={{
                                color: tr.isTrailing
                                  ? '#7ff0c0'
                                  : tr.beMoved
                                  ? '#5ad7ff'
                                  : '#ff8a96',
                              }}
                            >
                              {tr.isTrailing
                                ? `TRAIL ($${tr.sl.toFixed(2)})`
                                : tr.beMoved
                                ? `BE ($${tr.entry.toFixed(2)})`
                                : `$${tr.sl.toFixed(2)}`}
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="rs-label text-[9px] text-[#9ca3af]">
                              LIVE P&amp;L
                            </span>
                            <div
                              className="font-bold"
                              style={{
                                color: totalPnl >= 0 ? '#7ff0c0' : '#ff8a96',
                              }}
                            >
                              {totalPnl >= 0
                                ? `+$${totalPnl.toFixed(2)}`
                                : `-$${Math.abs(totalPnl).toFixed(2)}`}{' '}
                              (
                              {currentR >= 0
                                ? `+${currentR.toFixed(2)}R`
                                : `${currentR.toFixed(2)}R`}
                              )
                            </div>
                          </div>
                        </div>

                        <div className="rs-mono mt-2 grid grid-cols-3 gap-2 border-t border-[rgba(139,20,32,0.3)] pt-2 text-[11px]">
                          <div
                            style={{ color: tr.tp1Hit ? '#7ff0c0' : '#d1d5db' }}
                          >
                            TP1 (50%): ${tr.tp1.toFixed(2)} {tr.tp1Hit ? '✓' : ''}
                          </div>
                          <div
                            style={{ color: tr.tp2Hit ? '#7ff0c0' : '#d1d5db' }}
                          >
                            TP2 (30%): ${tr.tp2.toFixed(2)} {tr.tp2Hit ? '✓' : ''}
                          </div>
                          <div className="text-right text-[#d9ac4a]">
                            TP3 (20%): ${tr.tp3.toFixed(2)}{' '}
                            {tr.tp3IsLiquidity ? '[LIQ]' : '[3R]'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="rs-mono py-4 text-center text-xs text-[#9ca3af]">
              NO QUALIFYING ZONES DETECTED
            </div>
          )}
        </section>

        {/* ===================================================================
            7. STRONG ZONES // ALL TIMEFRAMES (top 6 by PWR across timeframes)
           =================================================================== */}
        <section className="rs-card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[rgba(139,20,32,0.35)] pb-2.5">
            <div>
              <h2 className="rs-heading text-xs font-bold sm:text-sm">
                STRONG ZONES // ALL TIMEFRAMES
              </h2>
              <div className="rs-mono mt-0.5 text-[10px] text-[#9ca3af]">
                TOP 6 BY POWER SCORE ACROSS TIMEFRAMES
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  updateSettings({
                    showFarZones: !settings.showFarZones,
                  })
                }
                className="rs-label cursor-pointer rounded-md border px-2.5 py-1 text-[10px] font-bold transition-colors"
                style={{
                  borderColor: settings.showFarZones
                    ? '#d9ac4a'
                    : 'rgba(139, 20, 32, 0.45)',
                  backgroundColor: settings.showFarZones
                    ? '#7a1422'
                    : 'rgba(0,0,0,0.45)',
                  color: settings.showFarZones ? '#ffffff' : '#9ca3af',
                }}
              >
                FAR ZONES: {settings.showFarZones ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          {!isFeedReady ? (
            <div className="rs-label py-4 text-center text-xs font-bold text-[#d9ac4a]">
              WAITING FOR LIVE FEED
            </div>
          ) : topStrongZones.length === 0 ? (
            <div className="rs-mono py-4 text-center text-xs text-[#9ca3af]">
              NO ACTIVE ZONES DETECTED
            </div>
          ) : (
            <div className="space-y-2">
              {topStrongZones.map((z, idx) => {
                const isBuy = z.side === 'BUY';
                const targetTf: RedSniperTimeframe = UI_TIMEFRAMES.includes(z.tf)
                  ? z.tf
                  : '5m';
                const isSelectedTf = z.mergedTfs.includes(selectedTf);
                const distPts =
                  livePrice !== null
                    ? getZoneDistancePts(z, livePrice)
                    : z.distancePts;
                const distLabel =
                  distPts === 0
                    ? '0.0 pts (INSIDE)'
                    : `${distPts.toFixed(1)} pts`;
                const tfBadgesLabel = z.mergedTfs.map(formatTfLabel).join(' · ');
                const stateLabel =
                  z.status === 'FRESH'
                    ? 'FRESH · 100%'
                    : `${z.status} ${z.retests}x · ${z.pctLeft}%`;

                return (
                  <button
                    key={z.id}
                    type="button"
                    onClick={() => {
                      setSelectedTf(targetTf);
                      handleHighlightZone(z.id);
                    }}
                    className="rs-subcard w-full cursor-pointer p-3 text-left transition-all"
                    style={{
                      borderColor: isSelectedTf
                        ? '#d9ac4a'
                        : 'rgba(139, 20, 32, 0.35)',
                    }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rs-mono text-[10px] font-bold text-[#9ca3af]">
                          #{idx + 1}
                        </span>
                        <span
                          className="rs-label rounded px-2 py-0.5 text-[10px] font-bold"
                          style={{
                            background: isBuy
                              ? 'rgba(20, 120, 80, 0.32)'
                              : 'rgba(139, 0, 0, 0.42)',
                            border: `1px solid ${isBuy ? '#2fd08f' : '#d83a4c'}`,
                            color: isBuy ? '#7ff0c0' : '#ff8a96',
                          }}
                        >
                          {tfBadgesLabel} · {z.side}
                        </span>
                        <span className="rs-mono text-xs font-bold text-[#f3f4f6]">
                          ${z.bottom.toFixed(2)} – ${z.top.toFixed(2)}
                        </span>
                        <span className="rs-mono text-[11px] font-semibold text-[#5ad7ff]">
                          {distLabel}
                        </span>
                        <span className="rs-mono text-[10.5px] text-[#9ca3af]">
                          {stateLabel}
                        </span>
                        {z.isAPlus && (
                          <span className="rs-label rounded border border-[#d9ac4a] bg-[#d9ac4a]/15 px-1.5 py-0.2 text-[9px] font-bold text-[#d9ac4a]">
                            A+
                          </span>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full"
                            style={{
                              width: `${Math.min(100, z.power)}%`,
                              background: isBuy ? '#2fd08f' : '#d83a4c',
                            }}
                          />
                        </div>
                        <span
                          className="rs-mono text-xs font-extrabold"
                          style={{ color: isBuy ? '#7ff0c0' : '#ff8a96' }}
                        >
                          PWR {z.power}
                        </span>
                      </div>
                    </div>
                    <div className="rs-mono mt-1 text-[10px] text-[#9ca3af]">
                      {z.breakdown}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* ===================================================================
            8. ZONE EVENTS FEED (zone NEW / BROKEN)
           =================================================================== */}
        <section className="rs-card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[rgba(139,20,32,0.35)] pb-2.5">
            <div>
              <h2 className="rs-heading text-xs font-bold sm:text-sm">
                ZONE EVENTS
              </h2>
              <div className="rs-mono mt-0.5 text-[10px] text-[#9ca3af]">
                LIVE STRUCTURAL FEED · NEW &amp; BROKEN ZONES
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {(tradeLogs.length > 0 || zoneLogs.length > 0) && (
                <button
                  type="button"
                  onClick={handleClearBotLog}
                  className="rs-label cursor-pointer rounded-md border border-[rgba(139,20,32,0.45)] bg-black/50 px-2 py-1 text-[9.5px] font-bold text-[#9ca3af] hover:text-white"
                >
                  CLEAR
                </button>
              )}
              <button
                type="button"
                onClick={handleCopyBotLog}
                className="rs-label cursor-pointer rounded-md border border-[#d9ac4a]/50 bg-[#7a1422] px-2.5 py-1 text-[9.5px] font-bold text-[#d9ac4a]"
              >
                {copiedBotLog ? 'COPIED' : 'COPY FEED'}
              </button>
            </div>
          </div>

          {zoneEventsFeed.length === 0 ? (
            <div className="rs-mono py-4 text-center text-xs text-[#9ca3af]">
              WAITING FOR ZONE FORMATION EVENTS
            </div>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {zoneEventsFeed.map((evt) => {
                const isNew = evt.kind === 'NEW';
                return (
                  <div
                    key={evt.id}
                    className="rs-subcard flex flex-col gap-1 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="rs-label rounded px-2 py-0.5 text-[9.5px] font-bold"
                          style={{
                            background: isNew
                              ? 'rgba(20, 120, 80, 0.32)'
                              : 'rgba(139, 0, 0, 0.42)',
                            border: `1px solid ${isNew ? '#2fd08f' : '#d83a4c'}`,
                            color: isNew ? '#7ff0c0' : '#ff8a96',
                          }}
                        >
                          {evt.kind}
                        </span>
                        <span className="rs-label text-[10px] font-bold text-[#d9ac4a]">
                          {evt.tf} · {evt.side}
                        </span>
                      </div>
                      <span className="rs-mono text-[10px] text-[#5ad7ff]">
                        {evt.timeLabel}
                      </span>
                    </div>
                    <div className="rs-mono text-[11px] text-[#d1d5db]">
                      {evt.message}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ===================================================================
            9. PERFORMANCE CARD (win-rate ring, trades, W/L, expectancy, SMALL SAMPLE · NOT RELIABLE when n < 30)
           =================================================================== */}
        <section className="rs-card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[rgba(139,20,32,0.35)] pb-2.5">
            <div>
              <h2 className="rs-heading text-xs font-bold sm:text-sm">
                PERFORMANCE
              </h2>
              <div className="rs-mono mt-0.5 text-[10px] text-[#9ca3af]">
                {replaySession
                  ? replaySession.windowLabel
                  : m1WindowInfo.windowLabel}
              </div>
            </div>
            <span className="rs-mono text-[11px] font-bold text-[#5ad7ff]">
              CONFIDENCE: {perf.confidenceLabel}
            </span>
          </div>

          {isSmallSample && (
            <div
              className="rs-label mb-3 rounded-[10px] px-3 py-2 text-center text-[11px] font-bold"
              style={{
                background: 'rgba(139, 0, 0, 0.42)',
                border: '1px solid #d83a4c',
                color: '#ff8a96',
              }}
            >
              SMALL SAMPLE · NOT RELIABLE (N = {perf.totalTrades} / 30 TRADES)
            </div>
          )}

          <div className="flex flex-col items-center gap-4 sm:flex-row">
            {/* Win-Rate Ring */}
            <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
              <svg className="h-24 w-24 -rotate-90" viewBox="0 0 80 80">
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
                  stroke="#2fd08f"
                  strokeWidth="7"
                  strokeDasharray={`${winStroke} ${donutCircumference}`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="rs-mono absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-base font-extrabold text-[#f3f4f6]">
                  {perf.tp2WinRatePct}%
                </span>
                <span className="rs-label text-[8px] text-[#9ca3af]">
                  WIN RATE
                </span>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="rs-mono grid w-full flex-1 grid-cols-3 gap-2.5 text-xs">
              <div className="rs-subcard p-2.5">
                <div className="rs-label text-[9px] text-[#9ca3af]">TRADES</div>
                <div className="mt-1 text-sm font-bold text-[#f3f4f6]">
                  {perf.totalTrades}
                </div>
              </div>

              <div className="rs-subcard p-2.5">
                <div className="rs-label text-[9px] text-[#9ca3af]">
                  W / L / BE
                </div>
                <div className="mt-1 text-sm font-bold">
                  <span style={{ color: '#7ff0c0' }}>{perf.wins}</span>
                  <span className="text-[#6b7280]"> / </span>
                  <span style={{ color: '#ff8a96' }}>{perf.losses}</span>
                  <span className="text-[#6b7280]"> / </span>
                  <span style={{ color: '#d9ac4a' }}>{perf.beCount}</span>
                </div>
              </div>

              <div className="rs-subcard p-2.5">
                <div className="rs-label text-[9px] text-[#9ca3af]">
                  EXPECTANCY
                </div>
                <div
                  className="mt-1 text-sm font-bold"
                  style={{
                    color: perf.expectancyR >= 0 ? '#7ff0c0' : '#ff8a96',
                  }}
                >
                  {perf.expectancyR >= 0
                    ? `+${perf.expectancyR.toFixed(2)}R`
                    : `${perf.expectancyR.toFixed(2)}R`}
                </div>
              </div>
            </div>
          </div>

          {/* Per-Session Realized R */}
          <div className="rs-mono mt-3 grid grid-cols-4 gap-2 text-center text-xs">
            {(
              [
                { key: 'TOKYO', label: 'Tokyo' },
                { key: 'LONDON', label: 'London' },
                { key: 'NEW YORK', label: 'New York' },
                { key: 'LDN+NY', label: 'LDN+NY' },
              ] as const
            ).map((s) => {
              const rVal = perf.sessionR[s.key];
              return (
                <div key={s.key} className="rs-subcard py-2">
                  <div className="rs-label text-[9px] text-[#9ca3af]">
                    {s.label}
                  </div>
                  <div
                    className="mt-0.5 font-bold"
                    style={{
                      color:
                        rVal > 0
                          ? '#7ff0c0'
                          : rVal < 0
                          ? '#ff8a96'
                          : '#5ad7ff',
                    }}
                  >
                    {rVal > 0 ? `+${rVal.toFixed(2)}R` : `${rVal.toFixed(2)}R`}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ===================================================================
            10. AUTO SNIPER EXECUTION CARD at the very BOTTOM
                (AUTO ON/OFF, Min PWR, Risk %, Balance, bot status, max 3 open)
           =================================================================== */}
        <section className="rs-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(139,20,32,0.35)] pb-3">
            <div>
              <h2 className="rs-heading text-xs font-bold sm:text-sm">
                AUTO SNIPER EXECUTION
              </h2>
              <div className="rs-mono mt-0.5 text-[11px] text-[#5ad7ff]">
                MAX 3 OPEN ({activeDisplayState.openTrades.length}/3) · MTF GUARD
                ACTIVE
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetDemo}
                className="rs-label min-h-[40px] cursor-pointer rounded-[10px] border border-[rgba(139,20,32,0.55)] bg-black/60 px-3 py-1.5 text-[10px] font-bold text-[#9ca3af] hover:border-[#d9ac4a] hover:text-[#d9ac4a]"
              >
                RESET ACCOUNT
              </button>

              <button
                type="button"
                onClick={handleToggleAuto}
                className="rs-label min-h-[40px] cursor-pointer rounded-[10px] px-4 py-1.5 text-xs font-bold transition-all"
                style={{
                  backgroundColor: demoState.autoEnabled
                    ? 'rgba(20, 120, 80, 0.32)'
                    : 'rgba(139, 0, 0, 0.42)',
                  border: `1px solid ${
                    demoState.autoEnabled ? '#2fd08f' : '#d83a4c'
                  }`,
                  color: demoState.autoEnabled ? '#7ff0c0' : '#ff8a96',
                }}
              >
                {demoState.autoEnabled ? 'AUTO ON' : 'AUTO OFF'}
              </button>
            </div>
          </div>

          {/* Controls: Min PWR, Risk %, Balance, Max 3 Open */}
          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <label className="rs-subcard flex flex-col justify-between p-2.5">
              <div className="flex items-center justify-between">
                <span className="rs-label text-[9.5px] text-[#9ca3af]">
                  MIN PWR
                </span>
                <span className="rs-mono text-xs font-bold text-[#d9ac4a]">
                  {settings.minPowerToTrade}
                </span>
              </div>
              <input
                type="range"
                min={20}
                max={90}
                step={5}
                value={settings.minPowerToTrade}
                onChange={(e) =>
                  updateSettings({ minPowerToTrade: Number(e.target.value) })
                }
                className="mt-2 accent-[#d83a4c]"
              />
            </label>

            <label className="rs-subcard flex flex-col justify-between p-2.5">
              <div className="flex items-center justify-between">
                <span className="rs-label text-[9.5px] text-[#9ca3af]">
                  RISK %
                </span>
                <span className="rs-mono text-xs font-bold text-[#5ad7ff]">
                  {settings.riskPct.toFixed(2)}%
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={5.0}
                step={0.25}
                value={settings.riskPct}
                onChange={(e) =>
                  updateSettings({ riskPct: Number(e.target.value) })
                }
                className="mt-2 accent-[#d83a4c]"
              />
            </label>

            <div className="rs-subcard flex flex-col justify-between p-2.5">
              <span className="rs-label text-[9.5px] text-[#9ca3af]">
                BALANCE
              </span>
              <span className="rs-mono mt-1 text-sm font-bold text-[#f3f4f6]">
                ${activeDisplayState.balance.toFixed(2)}
              </span>
            </div>

            <div className="rs-subcard flex flex-col justify-between p-2.5">
              <span className="rs-label text-[9.5px] text-[#9ca3af]">
                MAX 3 OPEN
              </span>
              <span className="rs-mono mt-1 text-sm font-bold text-[#7ff0c0]">
                {activeDisplayState.openTrades.length} / 3 SLOTS
              </span>
            </div>
          </div>

          {/* Bot Status Line */}
          <div className="rs-subcard rs-mono mt-3 flex items-center justify-between gap-2 px-3 py-2 text-xs">
            <div>
              <span className="rs-label font-bold text-[#d9ac4a]">
                BOT STATUS:{' '}
              </span>
              <span className="text-[#f3f4f6]">
                {replaySession?.isRunning
                  ? `REPLAY @ $${(replaySession.currentPrice ?? 0).toFixed(2)} (Bar ${replaySession.currentIndex}/${replaySession.totalBars})`
                  : botStatusLine}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default RedSniperPage;
