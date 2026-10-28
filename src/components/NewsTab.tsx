import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Sun, Moon, RotateCcw, Radio, RefreshCw, Check } from 'lucide-react';
import { NewsGlobeCanvas } from './news/NewsGlobeCanvas';
import { DecisionCard } from './news/DecisionCard';
import { computeUnifiedDecision, LiveMacroInput } from './news/unifiedDecisionEngine';
import { NewsVerdict, UnifiedNewsDecision } from './news/decisionTypes';

interface BriefData {
  headline: string;
  what_it_is: string;
  why_gold_cares: string;
  watch_for: string;
  source: 'AHMED_AI' | 'RULES';
}

interface EventPlaybook {
  what_it_is: string;
  why_gold_cares: string;
  watch_for: string;
}

interface NewsEventItem {
  id: string;
  title: string;
  country: string;
  impact: 'High' | 'Medium' | 'Low' | 'Holiday';
  tier: 'TIER_1' | 'TIER_2' | 'NONE';
  ahmedTier: 1 | 2 | 3;
  isSpeech: boolean;
  playbook?: EventPlaybook;
  brief?: BriefData;
  timeUtc: string;
  displayTime: string;
  rawDate: string;
  forecastStr: string;
  previousStr: string;
  actualStr: string | null;
  forecastNum: number | null;
  previousNum: number | null;
  actualNum: number | null;
  actualSource: 'FEED' | 'MANUAL' | 'UNVERIFIED' | null;
  actualSourceDisplay?: 'manual' | 'FRED' | null;
  actualSavedAt?: string | null;
  goldImpact: string;
  isHighImpactUsd: boolean;
  isTentative: boolean;
  isAllDay: boolean;
  isCancelledOrRemoved: boolean;
  minutesUntil: number;
  isReleased: boolean;
  isInsideLockWindow: boolean;
  calendarOrigin?: 'FEED' | 'STATIC CALENDAR';
  newsDecision?: {
    word: 'BULLISH' | 'BEARISH' | 'WAIT' | 'SKIP' | 'RELEASED';
    confidence: number;
    confidenceDisplay?: string;
    confidenceLean?: string;
    confidenceStatus?: 'calibrated' | 'calibrating';
    rawConfidence?: number;
    score: number | null;
    scoreDisplay?: string;
    reason: string;
    inputs: Array<{
      id: string;
      name: string;
      label: string;
      rawWeight: number;
      normalizedWeight: number;
      direction: 1 | -1 | 0;
      rawScore: number;
      weightedScore: number;
      value: string;
    }>;
    phase: 'preview' | 'forming' | 'pre' | 'provisional' | 'confirmed' | 'mixed';
    lockedAt: string | null;
    resultStatus?: 'HIT' | 'MISS' | 'WAIT' | 'PENDING';
    goldMove15m?: number | null;
    calibrationBucket?: string | null;
  } | null;
}

interface ReleaseLoggerSummary {
  storagePath: string;
  loggedReleasesCount: number;
  completedReleasesCount: number;
  incompleteReleasesCount: number;
  pendingReleasesCount: number;
  minRequiredForHitRate: number;
  hitRatePct: number | null;
  hitRateStatus: string;
  entries: any[];
}

export interface NewsTabProps {
  currentPrice: number | null;
}

type NewsListTab = 'TODAY' | 'THIS_WEEK' | 'RELEASED';

// Existing sign table: Unemployment Rate / Jobless Claims / Initial Claims -> higher is BULLISH for gold
function isReversedGoldIndicator(title: string): boolean {
  const t = title.toLowerCase();
  return (
    t.includes('unemployment claims') ||
    t.includes('jobless claims') ||
    t.includes('initial claims') ||
    t.includes('continuing claims') ||
    t.includes('unemployment rate') ||
    (t.includes('unemployment') && !t.includes('change'))
  );
}

// Compute Forecast Lean (separate from the engine decision) using the existing sign table
function getEventForecastLean(evt: NewsEventItem): {
  hasForecast: boolean;
  lean: 'BULLISH' | 'BEARISH' | 'FLAT' | null;
} {
  const fStr = evt.forecastStr?.trim() || '';
  const pStr = evt.previousStr?.trim() || '';
  const hasForecast = Boolean(
    evt.forecastNum !== null &&
      evt.forecastNum !== undefined &&
      fStr !== '' &&
      fStr !== '--' &&
      fStr !== 'N/A'
  );
  const hasPrevious = Boolean(
    evt.previousNum !== null &&
      evt.previousNum !== undefined &&
      pStr !== '' &&
      pStr !== '--' &&
      pStr !== 'N/A'
  );

  if (!hasForecast) {
    return { hasForecast: false, lean: null };
  }
  if (!hasPrevious) {
    return { hasForecast: true, lean: null };
  }

  const diff = (evt.forecastNum as number) - (evt.previousNum as number);
  const tol = Math.max(Math.abs(evt.previousNum as number) * 0.0001, 1e-6);
  if (Math.abs(diff) <= tol) {
    return { hasForecast: true, lean: 'FLAT' };
  }

  const reversed = isReversedGoldIndicator(evt.title);
  if (reversed) {
    return { hasForecast: true, lean: diff > 0 ? 'BULLISH' : 'BEARISH' };
  }
  return { hasForecast: true, lean: diff < 0 ? 'BULLISH' : 'BEARISH' };
}

function hasValidActual(evt: NewsEventItem): boolean {
  const aStr = evt.actualStr?.trim() || '';
  return Boolean(
    aStr !== '' &&
      aStr !== '--' &&
      aStr !== 'PENDING' &&
      aStr !== 'N/A' &&
      evt.actualSource !== 'UNVERIFIED' &&
      evt.actualNum !== null &&
      evt.actualNum !== undefined
  );
}

function extractUnitFromValueStr(valStr?: string | null): string {
  if (!valStr) return '';
  const cleaned = valStr.trim();
  const match = cleaned.match(/[+-]?\d+(?:\.\d+)?\s*([%KMBTkmbt]+)$/);
  return match ? match[1].toUpperCase() : '';
}

// Compute Result Reading when an actual exists using the existing gold impact function logic
// Item 3: Replace BEAT / MISS with ABOVE FORECAST / BELOW FORECAST / IN LINE and show gold reading separately
function getActualResultReading(evt: NewsEventItem): {
  outcomeTag: 'ABOVE FORECAST' | 'BELOW FORECAST' | 'IN LINE';
  goldDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  goldReading: string;
  combinedLabel: string;
  goldArrow: '↑' | '↓' | '→';
  readingLine: string;
} | null {
  if (!hasValidActual(evt)) return null;

  const actualStr = evt.actualStr!.trim();
  const forecastStr = evt.forecastStr?.trim() || '--';
  const actualNum = evt.actualNum as number;
  const forecastNum = evt.forecastNum;

  if (forecastNum === null || forecastNum === undefined || forecastStr === '' || forecastStr === '--') {
    return {
      outcomeTag: 'IN LINE',
      goldDirection: 'NEUTRAL',
      goldReading: 'textbook gold NEUTRAL',
      combinedLabel: 'IN LINE · textbook gold NEUTRAL',
      goldArrow: '→',
      readingLine: `Actual ${actualStr} (no forecast benchmark): IN LINE · textbook gold NEUTRAL`,
    };
  }

  const diff = actualNum - forecastNum;
  const tol = Math.max(Math.abs(forecastNum) * 0.0001, 1e-6);

  if (Math.abs(diff) <= tol) {
    return {
      outcomeTag: 'IN LINE',
      goldDirection: 'NEUTRAL',
      goldReading: 'textbook gold NEUTRAL',
      combinedLabel: 'IN LINE · textbook gold NEUTRAL',
      goldArrow: '→',
      readingLine: `Actual ${actualStr} vs Forecast ${forecastStr}: IN LINE · textbook gold NEUTRAL`,
    };
  }

  const outcomeTag: 'ABOVE FORECAST' | 'BELOW FORECAST' =
    diff > 0 ? 'ABOVE FORECAST' : 'BELOW FORECAST';
  const reversed = isReversedGoldIndicator(evt.title);
  // Existing computeGoldImpact sign rule
  const computedGoldDir: 'BULLISH' | 'BEARISH' =
    evt.goldImpact === 'BULLISH' || evt.goldImpact === 'BEARISH'
      ? (evt.goldImpact as 'BULLISH' | 'BEARISH')
      : diff > 0
      ? reversed
        ? 'BULLISH'
        : 'BEARISH'
      : reversed
      ? 'BEARISH'
      : 'BULLISH';

  const goldReading = `textbook gold ${computedGoldDir}`;
  const combinedLabel = `${outcomeTag} · ${goldReading}`;
  const goldArrow: '↑' | '↓' = computedGoldDir === 'BULLISH' ? '↑' : '↓';

  return {
    outcomeTag,
    goldDirection: computedGoldDir,
    goldReading,
    combinedLabel,
    goldArrow,
    readingLine: `Actual ${actualStr} vs Forecast ${forecastStr}: ${combinedLabel}`,
  };
}

// Format Dubai time (UTC+4) and UTC time deterministically
function formatDubaiAndUtcTime(timeUtc: string): {
  dubaiTime: string;
  dubaiDayShort: string;
  utcTime: string;
  dubaiDateKey: string;
} {
  const d = new Date(timeUtc);
  if (isNaN(d.getTime())) {
    return {
      dubaiTime: '--:--',
      dubaiDayShort: '---',
      utcTime: '--:-- UTC',
      dubaiDateKey: '',
    };
  }

  // UTC+4 shift for deterministic Dubai wall clock
  const dubaiMs = d.getTime() + 4 * 3600 * 1000;
  const dubaiDate = new Date(dubaiMs);

  const dHours = String(dubaiDate.getUTCHours()).padStart(2, '0');
  const dMins = String(dubaiDate.getUTCMinutes()).padStart(2, '0');
  const uHours = String(d.getUTCHours()).padStart(2, '0');
  const uMins = String(d.getUTCMinutes()).padStart(2, '0');

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dubaiDayShort = weekdays[dubaiDate.getUTCDay()];
  const dubaiDateKey = dubaiDate.toISOString().slice(0, 10);

  return {
    dubaiTime: `${dHours}:${dMins}`,
    dubaiDayShort,
    utcTime: `${uHours}:${uMins} UTC`,
    dubaiDateKey,
  };
}

function formatSavedTimeDubai(isoUtc?: string | null): string {
  if (!isoUtc) return '';
  const t = formatDubaiAndUtcTime(isoUtc);
  if (t.dubaiTime === '--:--') return '';
  return `${t.dubaiTime} DXB`;
}

function getCurrentDubaiDateKey(): string {
  const dubaiNow = new Date(Date.now() + 4 * 3600 * 1000);
  return dubaiNow.toISOString().slice(0, 10);
}

function formatCountdownCompact(mins: number, isReleased: boolean): string {
  if (isReleased || mins <= 0) {
    const pastMins = Math.abs(Math.round(mins));
    if (pastMins === 0) return 'released just now';
    if (pastMins < 60) return `released ${pastMins}m ago`;
    const hrs = Math.floor(pastMins / 60);
    if (hrs < 24) return `released ${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `released ${days}d ago`;
  }
  if (mins < 60) return `in ${Math.round(mins)}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = Math.round(mins % 60);
  if (hrs < 24) return `in ${hrs}h ${remMins}m`;
  const days = Math.floor(hrs / 24);
  return `in ${days}d ${hrs % 24}h`;
}

// Compute position [0..100] along Timeline Strip: T-60m (lock) -> News -> +5m (confirm) -> +15m (result)
function computeTimelineProgress(minutesUntil: number): {
  percent: number;
  activeStageIndex: number;
  markerLabel: string;
} {
  if (minutesUntil > 60) {
    return {
      percent: 0,
      activeStageIndex: 0,
      markerLabel: `Pre-lock (${formatCountdownCompact(minutesUntil, false)})`,
    };
  }
  if (minutesUntil >= 0) {
    const frac = (60 - minutesUntil) / 60;
    return {
      percent: Math.min(33.33, Math.max(0, frac * 33.33)),
      activeStageIndex: minutesUntil === 0 ? 1 : 0,
      markerLabel: minutesUntil === 0 ? 'Release Now' : `Locked · T-${Math.round(minutesUntil)}m`,
    };
  }
  if (minutesUntil >= -5) {
    const elapsed = Math.abs(minutesUntil);
    const frac = elapsed / 5;
    return {
      percent: 33.33 + frac * 33.34,
      activeStageIndex: 1,
      markerLabel: `Reaction · +${Math.round(elapsed)}m`,
    };
  }
  if (minutesUntil > -15) {
    const elapsed = Math.abs(minutesUntil);
    const frac = (elapsed - 5) / 10;
    return {
      percent: 66.67 + frac * 33.33,
      activeStageIndex: 2,
      markerLabel: `Confirming · +${Math.round(elapsed)}m`,
    };
  }
  return {
    percent: 100,
    activeStageIndex: 3,
    markerLabel: 'Completed (+15m)',
  };
}

export const NewsTab: React.FC<NewsTabProps> = React.memo(() => {
  // Theme state: dark first (#07090c), light mode supported (#f3f5f7)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      const qTheme = new URLSearchParams(window.location.search).get('newsTheme');
      if (qTheme === 'light' || qTheme === 'dark') return qTheme;
    }
    return 'dark';
  });

  const [feedStatus, setFeedStatus] = useState<any>(null);
  const [feedNetworkError, setFeedNetworkError] = useState(false);
  const [events, setEvents] = useState<NewsEventItem[]>([]);
  const [macroData, setMacroData] = useState<LiveMacroInput | null>(null);
  const [releaseLogger, setReleaseLogger] = useState<ReleaseLoggerSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [activeListTab, setActiveListTab] = useState<NewsListTab>('THIS_WEEK');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [pulseSignal, setPulseSignal] = useState<number>(0);
  const [showRawLoggerAdmin, setShowRawLoggerAdmin] = useState(false);

  // Admin "Enter actual" form state (number + unit) for released events
  const [actualNumInput, setActualNumInput] = useState<string>('');
  const [actualUnitInput, setActualUnitInput] = useState<string>('');
  const [isSavingActual, setIsSavingActual] = useState<boolean>(false);
  const [actualSaveMessage, setActualSaveMessage] = useState<string | null>(null);

  // Lazy brief cache for selected event focus card
  const [briefs, setBriefs] = useState<Record<string, BriefData>>({});

  const fetchNews = useCallback(async () => {
    try {
      const res = await fetch('/api/news');
      if (!res.ok) {
        setFeedNetworkError(true);
        return;
      }
      const json = await res.json();
      setFeedNetworkError(false);
      setFeedStatus(json.feed || null);
      setEvents(json.events || []);
      if (json.macro) setMacroData(json.macro);
      if (json.releaseLogger) setReleaseLogger(json.releaseLogger);
    } catch {
      setFeedNetworkError(true);
    }
  }, []);

  useEffect(() => {
    fetchNews();
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchNews();
    }, 60000);
    return () => clearInterval(timer);
  }, [fetchNews]);

  // Fetch brief lazily for selected event
  const fetchBriefForEvent = useCallback(
    async (eventId: string) => {
      if (!eventId || briefs[eventId]) return;
      try {
        const res = await fetch('/api/news/brief', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId }),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.brief) {
            setBriefs((prev) => ({ ...prev, [eventId]: json.brief }));
          }
        }
      } catch {
        // Fallback to deterministic playbook on event object
      }
    },
    [briefs]
  );

  // Next upcoming catalyst from live feed
  const nextUpcomingEvent = useMemo<NewsEventItem | null>(() => {
    const upcoming = events
      .filter((e) => !e.isCancelledOrRemoved && !e.isReleased && e.minutesUntil > 0)
      .sort((a, b) => new Date(a.timeUtc).getTime() - new Date(b.timeUtc).getTime());

    const tier1Or2 = upcoming.filter((e) => (e.ahmedTier === 1 || e.ahmedTier === 2) && !e.isSpeech);
    if (tier1Or2.length > 0) return tier1Or2[0];
    if (upcoming.length > 0) return upcoming[0];
    return events[0] || null;
  }, [events]);

  // Active selected event from real feed
  const activeSelectedEvent = useMemo<NewsEventItem | null>(() => {
    if (selectedEventId) {
      const found = events.find((e) => e.id === selectedEventId);
      if (found) return found;
    }
    return nextUpcomingEvent;
  }, [selectedEventId, events, nextUpcomingEvent]);

  // Sync admin actual inputs when switching selected event
  useEffect(() => {
    setActualSaveMessage(null);
    if (!activeSelectedEvent) {
      setActualNumInput('');
      setActualUnitInput('');
      return;
    }
    const defaultUnit =
      extractUnitFromValueStr(activeSelectedEvent.actualStr) ||
      extractUnitFromValueStr(activeSelectedEvent.forecastStr) ||
      extractUnitFromValueStr(activeSelectedEvent.previousStr);

    if (hasValidActual(activeSelectedEvent) && activeSelectedEvent.actualNum !== null) {
      setActualNumInput(String(activeSelectedEvent.actualNum));
      setActualUnitInput(defaultUnit);
    } else {
      setActualNumInput('');
      setActualUnitInput(defaultUnit);
    }
  }, [activeSelectedEvent?.id]);

  useEffect(() => {
    if (activeSelectedEvent?.id) {
      fetchBriefForEvent(activeSelectedEvent.id);
    }
  }, [activeSelectedEvent?.id, fetchBriefForEvent]);

  // Single Unified Decision from existing newsDecision() engine
  const activeDecision = useMemo<UnifiedNewsDecision | null>(() => {
    if (!activeSelectedEvent) return null;
    return computeUnifiedDecision(activeSelectedEvent, macroData);
  }, [activeSelectedEvent, macroData]);

  const activeForecastLeanInfo = useMemo(() => {
    if (!activeSelectedEvent) return { hasForecast: false, lean: null };
    return getEventForecastLean(activeSelectedEvent);
  }, [activeSelectedEvent]);

  const activeHasActual = useMemo(() => {
    if (!activeSelectedEvent) return false;
    return hasValidActual(activeSelectedEvent);
  }, [activeSelectedEvent]);

  const activeActualMetaLine = useMemo(() => {
    if (!activeSelectedEvent || !hasValidActual(activeSelectedEvent)) return null;
    const src =
      activeSelectedEvent.actualSourceDisplay ||
      (activeSelectedEvent.actualSource === 'MANUAL' ? 'manual' : 'FRED');
    const savedTime = formatSavedTimeDubai(
      activeSelectedEvent.actualSavedAt || activeSelectedEvent.timeUtc
    );
    return `Actual: ${activeSelectedEvent.actualStr?.trim()} (${src}${savedTime ? ` · ${savedTime}` : ''})`;
  }, [activeSelectedEvent]);

  const activeResultReading = useMemo(() => {
    if (!activeSelectedEvent) return null;
    return getActualResultReading(activeSelectedEvent);
  }, [activeSelectedEvent]);

  const handleSaveManualActual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSelectedEvent) return;
    const trimmedNum = actualNumInput.trim();
    if (!/^[+-]?\d+(\.\d+)?$/.test(trimmedNum)) {
      setActualSaveMessage('Invalid number: enter digits only.');
      return;
    }

    setIsSavingActual(true);
    setActualSaveMessage(null);
    try {
      const res = await fetch('/api/news/manual-actual', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          eventId: activeSelectedEvent.id,
          eventTitle: activeSelectedEvent.title,
          action: activeHasActual ? 'correct' : 'set',
          numberValue: trimmedNum,
          unit: actualUnitInput.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActualSaveMessage(json.error || `Error (${res.status}) saving actual.`);
        return;
      }
      if (Array.isArray(json.events)) {
        setEvents(json.events);
      } else {
        await fetchNews();
      }
      setActualSaveMessage(activeHasActual ? 'Corrected (manual)' : 'Saved (manual)');
    } catch {
      setActualSaveMessage('Network error saving actual.');
    } finally {
      setIsSavingActual(false);
    }
  };

  const handleDeleteManualActual = async () => {
    if (!activeSelectedEvent) return;
    setIsSavingActual(true);
    setActualSaveMessage(null);
    try {
      const res = await fetch('/api/news/manual-actual', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          eventId: activeSelectedEvent.id,
          eventTitle: activeSelectedEvent.title,
          action: 'delete',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActualSaveMessage(json.error || `Error (${res.status}) deleting actual.`);
        return;
      }
      if (Array.isArray(json.events)) {
        setEvents(json.events);
      } else {
        await fetchNews();
      }
      setActualNumInput('');
      setActualSaveMessage('Deleted actual');
    } catch {
      setActualSaveMessage('Network error deleting actual.');
    } finally {
      setIsSavingActual(false);
    }
  };

  // Filter events for the 3 Tabs: Today (in Dubai UTC+4), This week, Released
  const dubaiTodayKey = useMemo(() => getCurrentDubaiDateKey(), []);

  const tabEvents = useMemo<NewsEventItem[]>(() => {
    const valid = events.filter((e) => !e.isCancelledOrRemoved);

    if (activeListTab === 'TODAY') {
      return valid
        .filter((e) => formatDubaiAndUtcTime(e.timeUtc).dubaiDateKey === dubaiTodayKey)
        .sort((a, b) => new Date(a.timeUtc).getTime() - new Date(b.timeUtc).getTime());
    }

    if (activeListTab === 'RELEASED') {
      return valid
        .filter((e) => e.isReleased || e.minutesUntil <= 0 || e.newsDecision?.word === 'RELEASED')
        .sort((a, b) => new Date(b.timeUtc).getTime() - new Date(a.timeUtc).getTime());
    }

    // THIS_WEEK
    return valid
      .slice()
      .sort((a, b) => new Date(a.timeUtc).getTime() - new Date(b.timeUtc).getTime());
  }, [events, activeListTab, dubaiTodayKey]);

  const isFeedOffline =
    feedNetworkError || !feedStatus || feedStatus.status === 'OFFLINE';

  const isDark = theme === 'dark';

  // Exact theme palette per specification
  const palette = isDark
    ? {
        bg: '#07090c',
        surface: '#0e1218',
        line: '#1a212b',
        text: '#e9eef4',
        muted: '#7d8996',
        gold: '#e6b84a',
        up: '#34d399',
        down: '#f4727c',
      }
    : {
        bg: '#f3f5f7',
        surface: '#ffffff',
        line: '#dfe4ea',
        text: '#11171e',
        muted: '#5d6874',
        gold: '#9a6a00',
        up: '#0c8a5d',
        down: '#c23a46',
      };

  const getImpactDotColor = (evt: NewsEventItem): string => {
    if (evt.impact === 'High' || evt.ahmedTier === 1) return palette.down;
    if (evt.impact === 'Medium' || evt.ahmedTier === 2) return palette.gold;
    return palette.muted;
  };

  const getImpactLabel = (evt: NewsEventItem): string => {
    if (evt.impact === 'High' || evt.ahmedTier === 1) return 'HIGH';
    if (evt.impact === 'Medium' || evt.ahmedTier === 2) return 'MED';
    return 'LOW';
  };

  const getVerdictColor = (verdict: NewsVerdict): string => {
    if (verdict === 'BULLISH') return palette.up;
    if (verdict === 'BEARISH') return palette.down;
    if (verdict === 'WAIT') return palette.gold;
    return palette.muted;
  };

  const handleSelectRow = (evt: NewsEventItem) => {
    setSelectedEventId(evt.id);
    setPulseSignal((c) => c + 1);
  };

  const handleReturnToNextNews = () => {
    if (nextUpcomingEvent) {
      setSelectedEventId(nextUpcomingEvent.id);
      setPulseSignal((c) => c + 1);
    }
  };

  const handleShowOnGlobe = () => {
    setPulseSignal((c) => c + 1);
  };

  const selectedBrief = activeSelectedEvent ? briefs[activeSelectedEvent.id] || activeSelectedEvent.brief : null;
  const whatItIsLine =
    selectedBrief?.what_it_is ||
    activeSelectedEvent?.playbook?.what_it_is ||
    'Scheduled US macroeconomic indicator tracked for dollar and bullion order flow.';
  const whyGoldCaresLine =
    selectedBrief?.why_gold_cares ||
    activeSelectedEvent?.playbook?.why_gold_cares ||
    'Gold reacts inversely to shifts in real US Treasury yields and dollar rate expectations.';

  const timelineProgress = useMemo(() => {
    if (!activeSelectedEvent) {
      return { percent: 0, activeStageIndex: 0, markerLabel: 'Awaiting Event' };
    }
    return computeTimelineProgress(activeSelectedEvent.minutesUntil);
  }, [activeSelectedEvent]);

  const timelineStages = [
    { id: 'lock', label: 'T-60m (lock)' },
    { id: 'news', label: 'News' },
    { id: 'confirm', label: '+5m (confirm)' },
    { id: 'result', label: '+15m (result)' },
  ];

  const isSelectedEventReleased = Boolean(
    activeSelectedEvent &&
      (activeSelectedEvent.isReleased ||
        activeSelectedEvent.minutesUntil <= 0 ||
        activeDecision?.verdict === 'RELEASED')
  );

  const isSelectedNextUpcoming = Boolean(
    activeSelectedEvent &&
      nextUpcomingEvent &&
      activeSelectedEvent.id === nextUpcomingEvent.id &&
      !isSelectedEventReleased
  );

  return (
    <div
      id="sarraf-news-tab-root"
      className="w-full max-w-3xl mx-auto px-4 py-5 sm:py-6 rounded-2xl transition-colors font-['Sora'] overflow-x-hidden"
      style={{
        backgroundColor: palette.bg,
        color: palette.text,
      }}
    >
      <div className="space-y-5">
        {/* 1. HEADER: "NEWS" eyebrow, title, small "LIVE" chip (shows OFFLINE if feed is down) */}
        <header className="flex items-center justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div
              className="font-mono text-[10px] uppercase tracking-[0.14em]"
              style={{ color: palette.muted }}
            >
              NEWS
            </div>
            <h1
              className="text-lg sm:text-xl font-semibold tracking-tight font-['Sora'] truncate"
              style={{ color: palette.text }}
            >
              Global Macro Catalyst Desk
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* LIVE / OFFLINE chip */}
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-mono text-[10px] uppercase tracking-[0.14em] font-semibold"
              style={{
                backgroundColor: palette.surface,
                borderColor: isFeedOffline ? palette.down : palette.line,
                color: isFeedOffline ? palette.down : palette.up,
              }}
              aria-live="polite"
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: isFeedOffline ? palette.down : palette.up }}
              />
              <span>{isFeedOffline ? 'OFFLINE' : 'LIVE'}</span>
            </div>

            {/* Theme toggle (Dark / Light) */}
            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-mono text-[10px] uppercase tracking-[0.14em] cursor-pointer transition-colors"
              style={{
                backgroundColor: palette.surface,
                borderColor: palette.line,
                color: palette.muted,
              }}
              aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
              title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
            >
              {isDark ? <Sun className="w-3 h-3" /> : <Moon className="w-3 h-3" />}
              <span>{isDark ? 'LIGHT' : 'DARK'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsLoading(true);
                fetchNews().finally(() => setIsLoading(false));
              }}
              disabled={isLoading}
              className="p-1.5 rounded-md border cursor-pointer transition-colors"
              style={{
                backgroundColor: palette.surface,
                borderColor: palette.line,
                color: palette.muted,
              }}
              aria-label="Refresh live news feed"
              title="Refresh live news feed"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </header>

        {/* 2. GLOBE STAGE: 3D rotating Fibonacci dot-lattice globe on 2D canvas */}
        <NewsGlobeCanvas
          theme={theme}
          nextNewsTitle={nextUpcomingEvent?.title || activeSelectedEvent?.title || 'USD Economic Feed'}
          nextNewsTimeUtc={nextUpcomingEvent?.timeUtc || activeSelectedEvent?.timeUtc || null}
          minutesUntilNext={
            nextUpcomingEvent?.minutesUntil ?? activeSelectedEvent?.minutesUntil ?? null
          }
          selectedEventTitle={activeSelectedEvent?.title || null}
          selectedEventTimeUtc={activeSelectedEvent?.timeUtc || null}
          selectedEventMinutesUntil={activeSelectedEvent?.minutesUntil ?? null}
          isSelectedEventReleased={isSelectedEventReleased}
          isSelectedNextUpcoming={isSelectedNextUpcoming}
          selectedVerdict={activeDecision?.verdict}
          pulseSignal={pulseSignal}
          isOffline={isFeedOffline}
        />

        {/* 3. UNDER THE GLOBE: ONE COMPACT DECISION CARD (Dial ~124px wide) */}
        {activeDecision ? (
          <DecisionCard
            decision={activeDecision}
            theme={theme}
            completedReleasesCount={releaseLogger?.completedReleasesCount ?? 0}
            backtestLabel={
              (releaseLogger?.completedReleasesCount ?? 0) >= 30
                ? `Backtest: ${releaseLogger?.hitRatePct ?? 0}% (${releaseLogger?.completedReleasesCount} rel)`
                : 'Backtest: unverified'
            }
            hasForecast={activeForecastLeanInfo.hasForecast}
            forecastLean={activeForecastLeanInfo.lean}
            hasActual={activeHasActual}
            actualDisplayLine={activeActualMetaLine}
          />
        ) : (
          <div
            className="w-full rounded-2xl border p-4 font-mono text-xs text-center"
            style={{
              backgroundColor: palette.surface,
              borderColor: palette.line,
              color: palette.muted,
            }}
          >
            {isFeedOffline ? 'Feed offline — awaiting live macro stream' : 'Loading decision engine...'}
          </div>
        )}

        {/* 4. FOCUS CARD FOR THE SELECTED NEWS */}
        {activeSelectedEvent && (
          <section
            id="news-focus-card"
            className="w-full rounded-2xl border p-4 sm:p-5 space-y-4 transition-colors"
            style={{
              backgroundColor: palette.surface,
              borderColor: palette.line,
            }}
            aria-label="Selected News Focus Card"
          >
            {/* Header block: full width for title so long titles wrap cleanly by words on 360px/390px */}
            <div className="space-y-3 min-w-0">
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: getImpactDotColor(activeSelectedEvent) }}
                      title={`${getImpactLabel(activeSelectedEvent)} impact`}
                    />
                    <span
                      className="font-mono text-[10px] uppercase tracking-[0.14em] truncate"
                      style={{ color: palette.muted }}
                    >
                      {isSelectedNextUpcoming ? 'NEXT CATALYST' : 'SELECTED CATALYST'} ·{' '}
                      {getImpactLabel(activeSelectedEvent)} IMPACT
                    </span>
                  </div>

                  <span
                    className="shrink-0 px-2.5 py-0.5 rounded-md border font-mono text-xs font-medium"
                    style={{
                      backgroundColor: palette.bg,
                      borderColor: palette.line,
                      color: isSelectedEventReleased ? palette.muted : palette.gold,
                    }}
                  >
                    {formatCountdownCompact(
                      activeSelectedEvent.minutesUntil,
                      isSelectedEventReleased
                    )}
                  </span>
                </div>

                {/* Item 4: Focus card title must wrap by words (min-width: 0, overflow-wrap: anywhere, no break-all) */}
                <h2
                  id="focus-card-title"
                  className="text-base sm:text-lg font-semibold tracking-tight font-['Sora'] min-w-0 leading-snug"
                  style={{
                    color: palette.text,
                    minWidth: 0,
                    overflowWrap: 'anywhere',
                    wordBreak: 'normal',
                  }}
                >
                  {activeSelectedEvent.title}
                </h2>

                {(() => {
                  const tInfo = formatDubaiAndUtcTime(activeSelectedEvent.timeUtc);
                  return (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <div className="flex items-center gap-2 font-mono text-xs">
                        <span style={{ color: palette.text }}>
                          {tInfo.dubaiDayShort} {tInfo.dubaiTime} Dubai (UTC+4)
                        </span>
                        <span className="text-[11px]" style={{ color: palette.muted }}>
                          · {tInfo.utcTime}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleShowOnGlobe}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-mono text-[10px] uppercase tracking-[0.14em] cursor-pointer transition-colors"
                          style={{
                            backgroundColor: palette.bg,
                            borderColor: palette.line,
                            color: palette.text,
                          }}
                        >
                          <Radio className="w-3 h-3" style={{ color: palette.gold }} />
                          <span>SHOW ON GLOBE</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleReturnToNextNews}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-mono text-[10px] uppercase tracking-[0.14em] cursor-pointer transition-colors"
                          style={{
                            backgroundColor: palette.bg,
                            borderColor: palette.line,
                            color: palette.gold,
                          }}
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>NEXT NEWS</span>
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Forecast / Previous / Actual */}
            <div className="grid grid-cols-3 gap-2.5">
              <div
                className="p-3 rounded-xl border min-w-0"
                style={{ backgroundColor: palette.bg, borderColor: palette.line }}
              >
                <span
                  className="block font-mono text-[10px] uppercase tracking-[0.14em]"
                  style={{ color: palette.muted }}
                >
                  FORECAST
                </span>
                <span
                  className="mt-1 block font-mono text-sm sm:text-base font-semibold"
                  style={{ color: palette.text }}
                >
                  {activeSelectedEvent.forecastStr?.trim() || '--'}
                </span>
              </div>

              <div
                className="p-3 rounded-xl border min-w-0"
                style={{ backgroundColor: palette.bg, borderColor: palette.line }}
              >
                <span
                  className="block font-mono text-[10px] uppercase tracking-[0.14em]"
                  style={{ color: palette.muted }}
                >
                  PREVIOUS
                </span>
                <span
                  className="mt-1 block font-mono text-sm sm:text-base font-semibold"
                  style={{ color: palette.text }}
                >
                  {activeSelectedEvent.previousStr?.trim() || '--'}
                </span>
              </div>

              <div
                className="p-3 rounded-xl border min-w-0"
                style={{ backgroundColor: palette.bg, borderColor: palette.line }}
              >
                <span
                  className="block font-mono text-[10px] uppercase tracking-[0.14em]"
                  style={{ color: palette.muted }}
                >
                  ACTUAL
                </span>
                {activeHasActual ? (
                  <div className="mt-1 space-y-0.5">
                    <span
                      id="focus-actual-value"
                      className="block font-mono text-sm sm:text-base font-semibold"
                      style={{ color: palette.gold }}
                    >
                      {activeSelectedEvent.actualStr?.trim()}
                    </span>
                    <span
                      id="focus-actual-meta"
                      className="block font-mono text-[10px]"
                      style={{ color: palette.muted }}
                    >
                      {activeSelectedEvent.actualSourceDisplay ||
                        (activeSelectedEvent.actualSource === 'MANUAL' ? 'manual' : 'FRED')}
                      {' · '}
                      {formatSavedTimeDubai(
                        activeSelectedEvent.actualSavedAt || activeSelectedEvent.timeUtc
                      )}
                    </span>
                  </div>
                ) : (
                  <span
                    id="focus-actual-empty"
                    className="mt-1 block font-mono text-xs font-medium leading-snug"
                    style={{ color: palette.muted }}
                  >
                    {isSelectedEventReleased ? 'Actual not available' : '--'}
                  </span>
                )}
              </div>
            </div>

            {/* Item 2c & Item 3: When an actual exists on a released event, show ABOVE/BELOW/IN LINE + Gold reading separately */}
            {isSelectedEventReleased && activeResultReading && (
              <div
                id="focus-reaction-reading"
                className="p-3.5 rounded-xl border space-y-1.5"
                style={{
                  backgroundColor: palette.bg,
                  borderColor: palette.line,
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded border font-mono text-[10px] uppercase tracking-[0.14em] font-semibold"
                      style={{
                        borderColor: palette.gold,
                        color: palette.text,
                        backgroundColor: palette.surface,
                      }}
                    >
                      <span style={{ color: palette.gold }}>{activeResultReading.goldArrow}</span>
                      <span>{activeResultReading.outcomeTag}</span>
                    </span>

                    <span
                      className="font-mono text-xs font-semibold"
                      style={{
                        color:
                          activeResultReading.goldDirection === 'BULLISH'
                            ? palette.up
                            : activeResultReading.goldDirection === 'BEARISH'
                            ? palette.down
                            : palette.muted,
                      }}
                    >
                      {activeResultReading.combinedLabel}
                    </span>
                  </div>

                  <span
                    className="font-mono text-[10px] uppercase tracking-[0.14em]"
                    style={{ color: palette.muted }}
                  >
                    Reaction reading, not a trade signal
                  </span>
                </div>

                <div className="font-mono text-[11px]" style={{ color: palette.muted }}>
                  {activeResultReading.readingLine}
                </div>
              </div>
            )}

            {/* Directional Radar & Roadmap (Gold vs USD) */}
            <div
              id="focus-directional-roadmap"
              className="p-3.5 rounded-xl border space-y-2.5 transition-colors"
              style={{
                backgroundColor: palette.bg,
                borderColor:
                  activeDecision?.verdict === 'BULLISH'
                    ? `${palette.up}40`
                    : activeDecision?.verdict === 'BEARISH'
                    ? `${palette.down}40`
                    : palette.line,
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="px-2.5 py-1 rounded-md font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 border"
                    style={{
                      backgroundColor:
                        activeDecision?.verdict === 'BULLISH'
                          ? `${palette.up}20`
                          : activeDecision?.verdict === 'BEARISH'
                          ? `${palette.down}20`
                          : `${palette.gold}20`,
                      color:
                        activeDecision?.verdict === 'BULLISH'
                          ? palette.up
                          : activeDecision?.verdict === 'BEARISH'
                          ? palette.down
                          : palette.gold,
                      borderColor:
                        activeDecision?.verdict === 'BULLISH'
                          ? `${palette.up}60`
                          : activeDecision?.verdict === 'BEARISH'
                          ? `${palette.down}60`
                          : `${palette.gold}60`,
                    }}
                  >
                    <span>
                      {activeDecision?.verdict === 'BULLISH'
                        ? '🟢 GOLD BULLISH'
                        : activeDecision?.verdict === 'BEARISH'
                        ? '🔴 GOLD BEARISH'
                        : '⚪ NEUTRAL / WAIT'}
                    </span>
                    <span className="text-[10px] opacity-80">
                      ({activeDecision?.verdict === 'BULLISH' ? 'BUY BIAS' : activeDecision?.verdict === 'BEARISH' ? 'SELL BIAS' : 'WATCH'})
                    </span>
                  </span>

                  <span
                    className="font-mono text-[11px] font-semibold"
                    style={{ color: palette.muted }}
                  >
                    USD IMPACT:{' '}
                    <span
                      style={{
                        color:
                          activeDecision?.verdict === 'BULLISH'
                            ? palette.down
                            : activeDecision?.verdict === 'BEARISH'
                            ? palette.up
                            : palette.text,
                      }}
                    >
                      {activeDecision?.verdict === 'BULLISH'
                        ? 'BEARISH 📉 (Kamzor Dollar)'
                        : activeDecision?.verdict === 'BEARISH'
                        ? 'BULLISH 📈 (Mazboot Dollar)'
                        : 'NEUTRAL ➡️'}
                    </span>
                  </span>
                </div>

                <span
                  className="font-mono text-[10px] uppercase tracking-[0.14em]"
                  style={{ color: palette.muted }}
                >
                  XAU/USD INVERSE DYNAMICS
                </span>
              </div>

              {/* Clear Scenarios (Urdu & English) */}
              <div
                className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t text-[11px] font-mono"
                style={{ borderColor: palette.line }}
              >
                <div
                  className="p-2.5 rounded-lg border flex flex-col gap-0.5"
                  style={{
                    backgroundColor: palette.surface,
                    borderColor: `${palette.down}30`,
                  }}
                >
                  <span className="text-rose-400 font-bold flex items-center gap-1">
                    <span>🔴 BEARISH GOLD SCENARIO:</span>
                  </span>
                  <span style={{ color: palette.text }}>
                    {isReversedGoldIndicator(activeSelectedEvent.title)
                      ? 'Actual < Forecast aya to USD Mazboot -> Gold Girega (Sell).'
                      : 'Actual > Forecast aya to USD Mazboot -> Gold Girega (Sell).'}
                  </span>
                  <span className="text-[10px]" style={{ color: palette.muted }}>
                    Hotter US data triggers higher real yields & strengthens dollar.
                  </span>
                </div>

                <div
                  className="p-2.5 rounded-lg border flex flex-col gap-0.5"
                  style={{
                    backgroundColor: palette.surface,
                    borderColor: `${palette.up}30`,
                  }}
                >
                  <span className="text-emerald-400 font-bold flex items-center gap-1">
                    <span>🟢 BULLISH GOLD SCENARIO:</span>
                  </span>
                  <span style={{ color: palette.text }}>
                    {isReversedGoldIndicator(activeSelectedEvent.title)
                      ? 'Actual > Forecast aya to USD Kamzor -> Gold Barhega (Buy).'
                      : 'Actual < Forecast aya to USD Kamzor -> Gold Barhega (Buy).'}
                  </span>
                  <span className="text-[10px]" style={{ color: palette.muted }}>
                    Cooler US data weakens dollar and boosts gold safe-haven flow.
                  </span>
                </div>
              </div>
            </div>

            {/* Item 2a & Round 14 Item 2: Admin "Enter / Correct / Delete actual" field (admin session required, whitelisted units) */}
            {isSelectedEventReleased && (
              <form
                id="admin-enter-actual-form"
                onSubmit={handleSaveManualActual}
                className="p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2.5"
                style={{
                  backgroundColor: palette.bg,
                  borderColor: palette.line,
                }}
              >
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.14em]"
                  style={{ color: palette.muted }}
                >
                  ADMIN · {activeHasActual ? 'CORRECT / DELETE ACTUAL' : 'ENTER ACTUAL'}
                </span>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="admin-actual-number-input"
                    type="text"
                    inputMode="decimal"
                    value={actualNumInput}
                    onChange={(e) => setActualNumInput(e.target.value)}
                    placeholder="Number"
                    aria-label="Enter actual number"
                    className="w-28 px-2.5 py-1 rounded-md border font-mono text-xs focus:outline-none"
                    style={{
                      backgroundColor: palette.surface,
                      borderColor: palette.line,
                      color: palette.text,
                    }}
                  />

                  <select
                    id="admin-actual-unit-input"
                    value={actualUnitInput}
                    onChange={(e) => setActualUnitInput(e.target.value)}
                    aria-label="Select actual unit"
                    className="w-20 px-2 py-1 rounded-md border font-mono text-xs focus:outline-none"
                    style={{
                      backgroundColor: palette.surface,
                      borderColor: palette.line,
                      color: palette.text,
                    }}
                  >
                    <option value="">(no unit)</option>
                    <option value="%">%</option>
                    <option value="K">K</option>
                    <option value="M">M</option>
                    <option value="B">B</option>
                    <option value="T">T</option>
                  </select>

                  <button
                    id="admin-actual-save-btn"
                    type="submit"
                    disabled={isSavingActual}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border font-mono text-[10px] uppercase tracking-[0.14em] font-semibold cursor-pointer transition-colors"
                    style={{
                      backgroundColor: palette.surface,
                      borderColor: palette.gold,
                      color: palette.gold,
                    }}
                  >
                    <Check className="w-3 h-3" />
                    <span>
                      {isSavingActual
                        ? 'SAVING...'
                        : activeHasActual
                        ? 'CORRECT ACTUAL'
                        : 'SAVE ACTUAL'}
                    </span>
                  </button>

                  {activeHasActual && (
                    <button
                      id="admin-actual-delete-btn"
                      type="button"
                      disabled={isSavingActual}
                      onClick={handleDeleteManualActual}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border font-mono text-[10px] uppercase tracking-[0.14em] font-semibold cursor-pointer transition-colors"
                      style={{
                        backgroundColor: palette.surface,
                        borderColor: palette.down,
                        color: palette.down,
                      }}
                    >
                      <span>DELETE ACTUAL</span>
                    </button>
                  )}

                  {actualSaveMessage && (
                    <span
                      className="font-mono text-[10px]"
                      style={{ color: palette.muted }}
                    >
                      {actualSaveMessage}
                    </span>
                  )}
                </div>
              </form>
            )}

            {/* One-line "what it is" and "why gold cares" */}
            <div
              className="pt-3 border-t space-y-2 text-xs font-['Sora']"
              style={{ borderColor: palette.line }}
            >
              <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-2">
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.14em] shrink-0"
                  style={{ color: palette.muted }}
                >
                  WHAT IT IS
                </span>
                <p className="line-clamp-1" style={{ color: palette.text }}>
                  {whatItIsLine}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-2">
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.14em] shrink-0"
                  style={{ color: palette.muted }}
                >
                  WHY GOLD CARES
                </span>
                <p className="line-clamp-1" style={{ color: palette.text }}>
                  {whyGoldCaresLine}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* 5. TABS: Today, This week, Released + List Rows */}
        <section
          className="w-full rounded-2xl border p-4 sm:p-5 space-y-3.5 transition-colors"
          style={{
            backgroundColor: palette.surface,
            borderColor: palette.line,
          }}
          aria-label="Economic Releases Schedule"
        >
          <div
            className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b"
            style={{ borderColor: palette.line }}
          >
            {/* Tabs: Today, This week, Released */}
            <div className="flex items-center gap-1" role="tablist" aria-label="Release filter tabs">
              {(
                [
                  { id: 'TODAY', label: 'Today' },
                  { id: 'THIS_WEEK', label: 'This week' },
                  { id: 'RELEASED', label: 'Released' },
                ] as const
              ).map((tab) => {
                const isActive = activeListTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveListTab(tab.id)}
                    className="px-3 py-1.5 rounded-lg font-mono text-[11px] uppercase tracking-[0.14em] cursor-pointer transition-colors border"
                    style={{
                      backgroundColor: isActive ? palette.bg : 'transparent',
                      borderColor: isActive ? palette.gold : 'transparent',
                      color: isActive ? palette.text : palette.muted,
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <span
              className="font-mono text-[10px] uppercase tracking-[0.14em]"
              style={{ color: palette.muted }}
            >
              DUBAI TIME (UTC+4) · {tabEvents.length} EVENTS
            </span>
          </div>

          {/* Event Rows */}
          {tabEvents.length === 0 ? (
            <div
              className="py-8 text-center font-mono text-xs"
              style={{ color: palette.muted }}
            >
              {isFeedOffline
                ? 'Feed is currently OFFLINE.'
                : `No USD releases in "${
                    activeListTab === 'TODAY'
                      ? 'Today'
                      : activeListTab === 'RELEASED'
                      ? 'Released'
                      : 'This week'
                  }".`}
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: palette.line }}>
              {tabEvents.map((evt) => {
                const rowDecision = computeUnifiedDecision(evt, macroData);
                const tInfo = formatDubaiAndUtcTime(evt.timeUtc);
                const isSelected = activeSelectedEvent?.id === evt.id;
                const rowIsReleased = Boolean(
                  evt.isReleased || evt.minutesUntil <= 0 || rowDecision.verdict === 'RELEASED'
                );
                const rowHasActual = hasValidActual(evt);
                const rowResult = rowIsReleased ? getActualResultReading(evt) : null;
                const rowLean = !rowIsReleased ? getEventForecastLean(evt) : null;
                const vColor = getVerdictColor(rowDecision.verdict);

                const actualSrcLabel =
                  evt.actualSourceDisplay || (evt.actualSource === 'MANUAL' ? 'manual' : 'FRED');
                const actualTimeLabel = formatSavedTimeDubai(evt.actualSavedAt || evt.timeUtc);

                return (
                  <div
                    key={evt.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => handleSelectRow(evt)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelectRow(evt);
                      }
                    }}
                    className="py-3 px-2.5 -mx-2.5 rounded-xl flex items-center justify-between gap-2.5 cursor-pointer transition-colors focus:outline-none focus:ring-2"
                    style={{
                      backgroundColor: isSelected ? palette.bg : 'transparent',
                      borderColor: palette.line,
                      boxShadow: isSelected ? `inset 2px 0 0 0 ${palette.gold}` : 'none',
                    }}
                  >
                    {/* Left: Time (Dubai UTC+4 + small UTC) + Impact Dot + Name */}
                    <div className="flex items-center gap-2.5 min-w-0 flex-1 overflow-hidden">
                      <div className="w-[72px] shrink-0 font-mono">
                        <div
                          className="text-xs font-semibold leading-tight"
                          style={{ color: palette.text }}
                        >
                          {tInfo.dubaiDayShort} {tInfo.dubaiTime}
                        </div>
                        <div
                          className="text-[10px] leading-tight"
                          style={{ color: palette.muted }}
                        >
                          {tInfo.utcTime}
                        </div>
                      </div>

                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: getImpactDotColor(evt) }}
                        title={`${getImpactLabel(evt)} impact`}
                      />

                      <div className="min-w-0 flex-1 overflow-hidden">
                        {/* Item 4: Long names in list rows truncate with an ellipsis on one line */}
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="text-xs sm:text-sm font-medium truncate whitespace-nowrap font-['Sora'] min-w-0"
                            style={{ color: palette.text }}
                          >
                            {evt.title}
                          </span>
                          {evt.calendarOrigin === 'STATIC CALENDAR' && (
                            <span
                              className="shrink-0 text-[8px] font-mono uppercase px-1.5 py-0.2 rounded border tracking-wider font-semibold"
                              style={{
                                color: palette.gold,
                                borderColor: `${palette.gold}66`,
                                backgroundColor: `${palette.gold}15`,
                              }}
                              title="Static calendar entry (not from live feed)"
                            >
                              STATIC CALENDAR
                            </span>
                          )}
                        </div>
                        <div
                          className="font-mono text-[10px] truncate whitespace-nowrap"
                          style={{ color: palette.muted }}
                        >
                          F: {evt.forecastStr?.trim() || '--'} · P:{' '}
                          {evt.previousStr?.trim() || '--'}
                          {rowIsReleased
                            ? rowHasActual
                              ? ` · A: ${evt.actualStr?.trim()} (${actualSrcLabel}${
                                  actualTimeLabel ? ` · ${actualTimeLabel}` : ''
                                })`
                              : ' · Actual not available'
                            : ''}
                        </div>
                      </div>
                    </div>

                    {/* Right: Row Tag showing clear BULLISH or BEARISH for Gold */}
                    {rowIsReleased ? (
                      rowResult ? (
                        <span
                          className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-mono text-[10px] uppercase tracking-[0.14em] font-bold"
                          style={{
                            color:
                              rowResult.goldDirection === 'BULLISH'
                                ? palette.up
                                : rowResult.goldDirection === 'BEARISH'
                                ? palette.down
                                : palette.muted,
                            borderColor:
                              rowResult.goldDirection === 'BULLISH'
                                ? `${palette.up}40`
                                : rowResult.goldDirection === 'BEARISH'
                                ? `${palette.down}40`
                                : palette.line,
                            backgroundColor:
                              rowResult.goldDirection === 'BULLISH'
                                ? `${palette.up}15`
                                : rowResult.goldDirection === 'BEARISH'
                                ? `${palette.down}15`
                                : palette.bg,
                          }}
                        >
                          <span>{rowResult.goldDirection === 'BULLISH' ? '🟢' : rowResult.goldDirection === 'BEARISH' ? '🔴' : '⚪'}</span>
                          <span>{rowResult.goldDirection}</span>
                        </span>
                      ) : rowDecision.verdict === 'BULLISH' || rowDecision.verdict === 'BEARISH' ? (
                        <span
                          className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-mono text-[10px] uppercase tracking-[0.14em] font-bold"
                          style={{
                            color: rowDecision.verdict === 'BULLISH' ? palette.up : palette.down,
                            borderColor: rowDecision.verdict === 'BULLISH' ? `${palette.up}40` : `${palette.down}40`,
                            backgroundColor: rowDecision.verdict === 'BULLISH' ? `${palette.up}15` : `${palette.down}15`,
                          }}
                        >
                          <span>{rowDecision.verdict === 'BULLISH' ? '🟢' : '🔴'}</span>
                          <span>{rowDecision.verdict}</span>
                        </span>
                      ) : (
                        <span
                          className="shrink-0 px-2.5 py-1 rounded-md border font-mono text-[10px] uppercase tracking-[0.14em] font-medium"
                          style={{
                            color: palette.muted,
                            borderColor: palette.line,
                            backgroundColor: palette.bg,
                          }}
                        >
                          RELEASED
                        </span>
                      )
                    ) : (
                      <div className="shrink-0 inline-flex items-center gap-1.5">
                        {rowDecision.verdict === 'BULLISH' || rowDecision.verdict === 'BEARISH' ? (
                          <span
                            className="px-2.5 py-1 rounded-md border font-mono text-[10px] uppercase tracking-[0.14em] font-bold inline-flex items-center gap-1"
                            style={{
                              color: rowDecision.verdict === 'BULLISH' ? palette.up : palette.down,
                              borderColor: rowDecision.verdict === 'BULLISH' ? `${palette.up}40` : `${palette.down}40`,
                              backgroundColor: rowDecision.verdict === 'BULLISH' ? `${palette.up}15` : `${palette.down}15`,
                            }}
                          >
                            <span>{rowDecision.verdict === 'BULLISH' ? '🟢' : '🔴'}</span>
                            <span>{rowDecision.verdict}</span>
                          </span>
                        ) : rowLean?.lean === 'BULLISH' || rowLean?.lean === 'BEARISH' ? (
                          <span
                            className="px-2.5 py-1 rounded-md border font-mono text-[10px] uppercase tracking-[0.14em] font-bold inline-flex items-center gap-1"
                            style={{
                              color: rowLean.lean === 'BULLISH' ? palette.up : palette.down,
                              borderColor: rowLean.lean === 'BULLISH' ? `${palette.up}40` : `${palette.down}40`,
                              backgroundColor: rowLean.lean === 'BULLISH' ? `${palette.up}15` : `${palette.down}15`,
                            }}
                          >
                            <span>{rowLean.lean === 'BULLISH' ? '🟢' : '🔴'}</span>
                            <span>LEAN {rowLean.lean}</span>
                          </span>
                        ) : (
                          <span
                            className="px-2.5 py-1 rounded-md border font-mono text-[10px] uppercase tracking-[0.14em] font-medium"
                            style={{
                              color: palette.muted,
                              borderColor: palette.line,
                              backgroundColor: palette.bg,
                            }}
                          >
                            {rowDecision.verdict}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 6. TIMELINE STRIP FOR THE SELECTED EVENT: T-60m (lock), News, +5m (confirm), +15m (result) */}
        <section
          className="w-full rounded-2xl border p-4 sm:p-5 space-y-3 transition-colors"
          style={{
            backgroundColor: palette.surface,
            borderColor: palette.line,
          }}
          aria-label="Event Release Timeline Strip"
        >
          <div className="flex items-center justify-between gap-2">
            <span
              className="font-mono text-[10px] uppercase tracking-[0.14em] min-w-0 truncate"
              style={{ color: palette.muted }}
            >
              RELEASE TIMELINE · {activeSelectedEvent?.calendarOrigin === 'STATIC CALENDAR' ? '[STATIC CALENDAR] ' : ''}{activeSelectedEvent?.title || 'EVENT'}
            </span>
            <span
              className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em]"
              style={{ color: palette.gold }}
            >
              {timelineProgress.markerLabel}
            </span>
          </div>

          {/* Track with moving marker */}
          <div className="relative pt-2 pb-1">
            <div
              className="w-full h-1.5 rounded-full overflow-hidden"
              style={{ backgroundColor: palette.line }}
            >
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${timelineProgress.percent}%`,
                  backgroundColor: palette.gold,
                }}
              />
            </div>

            {/* Moving Marker Dot */}
            <div
              className="absolute top-0.5 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 transition-all duration-500"
              style={{
                left: `${timelineProgress.percent}%`,
                backgroundColor: palette.gold,
                borderColor: palette.surface,
              }}
              title={`Current stage: ${timelineProgress.markerLabel}`}
            />
          </div>

          {/* 4 Stage Labels */}
          <div className="grid grid-cols-4 gap-1 pt-1 font-mono text-[10px] uppercase tracking-[0.14em]">
            {timelineStages.map((st, idx) => {
              const isReached = idx <= timelineProgress.activeStageIndex;
              return (
                <div
                  key={st.id}
                  className={
                    idx === 0
                      ? 'text-left'
                      : idx === 3
                      ? 'text-right'
                      : 'text-center'
                  }
                  style={{ color: isReached ? palette.text : palette.muted }}
                >
                  {st.label}
                </div>
              );
            })}
          </div>
        </section>

        {/* Read-only Admin Logger Line (preserves Round 10 Item 5 live logger visibility) */}
        <footer
          className="pt-1 px-1 flex flex-col gap-2 font-mono text-[10px]"
          style={{ color: palette.muted }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              LOGGER: {releaseLogger?.completedReleasesCount ?? 0}/30 COMPLETED ·{' '}
              {releaseLogger?.loggedReleasesCount ?? 0} TRACKED (T-60m, T-5m, T, +5m, +15m)
            </span>
            <button
              type="button"
              onClick={() => setShowRawLoggerAdmin((v) => !v)}
              className="underline cursor-pointer uppercase tracking-[0.14em]"
              style={{ color: palette.muted }}
            >
              {showRawLoggerAdmin ? 'HIDE RAW LOGGER' : 'RAW LOGGER ENTRIES'}
            </button>
          </div>

          {showRawLoggerAdmin && (
            <pre
              className="p-3 rounded-xl border overflow-x-auto text-[10px] max-h-48"
              style={{
                backgroundColor: palette.surface,
                borderColor: palette.line,
                color: palette.text,
              }}
            >
              {JSON.stringify(releaseLogger?.entries ?? [], null, 2)}
            </pre>
          )}
        </footer>
      </div>
    </div>
  );
});
