import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Radio,
  Clock,
  Sparkles,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  Edit3,
  ShieldAlert,
  Calendar,
  Zap,
  Globe,
  RotateCcw,
} from 'lucide-react';
import { useMarketAuth } from '../context/MarketContext';
import { NewsFlow, NFEvent } from './newsflow/NewsFlow';

interface BriefData {
  headline: string;
  what_it_is: string;
  why_gold_cares: string;
  watch_for: string;
  source: 'AHMED_AI' | 'RULES';
}

interface GoldScenario {
  higher: string;
  lower: string;
  type: 'STANDARD' | 'REVERSED' | 'TONE_DEPENDENT' | 'SPEECH' | 'NO_FORECAST';
  surpriseChip?: {
    sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    size: 'SMALL' | 'MODERATE' | 'LARGE';
    diffPct: number;
  };
}

interface PreNewsLean {
  lean: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'TONE-DEPENDENT' | 'WAITING' | 'WAITING_FORECAST' | 'NO_CONSENSUS';
  label: string;
  explanation: string;
}

const isNoConsensusEvent = (title: string, isSpeech?: boolean): boolean => {
  if (isSpeech) return true;
  const t = title.toLowerCase();
  return (
    t.includes('adp weekly') ||
    t.includes('api ') ||
    t.includes('eia') ||
    t.includes('inventor') ||
    t.includes('beige book') ||
    t.includes('speaks') ||
    t.includes('speech') ||
    t.includes('testifies') ||
    t.includes('fomc press conference') ||
    t.includes('fomc minutes')
  );
};

interface EventPlaybook {
  what_it_is: string;
  why_gold_cares: string;
  watch_for: string;
}

interface LockedDecision {
  eventId: string;
  systemVote: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  aiVote: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNAVAILABLE';
  aiConfidence: number;
  aiReason?: string;
  final: 'BULLISH' | 'BEARISH' | 'WAIT' | 'WAITING';
  label: 'CONFIRMED' | 'RULES ONLY' | 'CONFLICT' | 'WAITING';
  lockedAt: string;
  isLocked: boolean;
  resultStatus?: 'HIT' | 'MISS' | 'NEUTRAL' | 'PENDING';
  goldMove15m?: number;
}

interface NewsEventItem {
  id: string;
  title: string;
  country: string;
  impact: 'High' | 'Medium' | 'Low' | 'Holiday';
  tier: 'TIER_1' | 'TIER_2' | 'NONE';
  ahmedTier: 1 | 2 | 3;
  isSpeech: boolean;
  scenarios: GoldScenario;
  preNewsLean?: PreNewsLean;
  playbook?: EventPlaybook;
  brief?: BriefData;
  decision?: LockedDecision | null;
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
  goldImpact: string;
  goldImpactExplanation?: string;
  isHighImpactUsd: boolean;
  isTentative: boolean;
  isAllDay: boolean;
  isCancelledOrRemoved: boolean;
  changeNote?: string;
  minutesUntil: number;
  isReleased: boolean;
  isInsideLockWindow: boolean;
}

interface NewsTabProps {
  currentPrice: number | null;
}

// Client-side fallback computation for Pre-News Lean if not present in payload
function getPreNewsLean(evt: NewsEventItem): PreNewsLean {
  // If an event has no forecast, show WAITING not a lean
  if (
    evt.forecastNum === null ||
    !evt.forecastStr ||
    evt.forecastStr.trim() === '' ||
    evt.forecastStr === '--' ||
    evt.forecastStr === 'N/A' ||
    evt.forecastStr === 'Tentative'
  ) {
    return {
      lean: 'WAITING',
      label: 'WAITING',
      explanation: 'Forecast not available yet',
    };
  }

  if (evt.preNewsLean) return evt.preNewsLean;

  const t = evt.title.toLowerCase();
  const isPowell = t.includes('powell') || t.includes('fed chair');
  const isFomcTone =
    isPowell ||
    t.includes('fomc') ||
    t.includes('rate decision') ||
    t.includes('minutes') ||
    evt.isSpeech;

  if (isFomcTone) {
    return {
      lean: 'TONE-DEPENDENT',
      label: 'TONE-DEPENDENT',
      explanation: 'Tone-dependent, low reliability',
    };
  }

  if (evt.previousNum === null) {
    return {
      lean: 'WAITING',
      label: 'WAITING',
      explanation: 'Previous not available yet',
    };
  }

  const isReversed =
    t.includes('unemployment rate') ||
    t.includes('jobless claims') ||
    t.includes('unemployment claims') ||
    t.includes('initial claims');

  const diff = evt.forecastNum - evt.previousNum;
  const tolerance = Math.abs(evt.previousNum) * 0.0001 || 0.0001;

  if (Math.abs(diff) <= tolerance) {
    return {
      lean: 'NEUTRAL',
      label: 'LEAN (if as forecast)',
      explanation: 'Forecast equals previous release',
    };
  }

  if (isReversed) {
    return {
      lean: diff > 0 ? 'BULLISH' : 'BEARISH',
      label: 'LEAN (if as forecast)',
      explanation: diff > 0 ? 'Labor cooling' : 'Labor tightening',
    };
  } else {
    // CPI, Core CPI, PPI, Retail Sales, GDP, ISM, etc:
    // Forecast lower than previous -> inflation cooling -> mild BULLISH
    // Forecast higher than previous -> inflation hotter -> mild BEARISH
    return {
      lean: diff < 0 ? 'BULLISH' : 'BEARISH',
      label: 'LEAN (if as forecast)',
      explanation: diff < 0 ? 'Data cooling' : 'Data hotter',
    };
  }
}

// Format UTC and Local device times: "16:30 GMT · 20:30 your time"
function formatEventTimes(timeUtc: string): string {
  const d = new Date(timeUtc);
  if (isNaN(d.getTime())) return timeUtc;
  const gmtHours = String(d.getUTCHours()).padStart(2, '0');
  const gmtMinutes = String(d.getUTCMinutes()).padStart(2, '0');
  const localHours = String(d.getHours()).padStart(2, '0');
  const localMinutes = String(d.getMinutes()).padStart(2, '0');
  return `${gmtHours}:${gmtMinutes} GMT · ${localHours}:${localMinutes} your time`;
}

// Format local day and time for cards: "Wed 14:30"
function formatDayTimeShort(timeUtc: string): string {
  const d = new Date(timeUtc);
  if (isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString(undefined, { weekday: 'short' });
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${time}`;
}

export const NewsTab: React.FC<NewsTabProps> = React.memo(() => {
  const { isLoggedIn, user } = useMarketAuth();
  const isAdmin = Boolean(isLoggedIn && (user?.accountType === 'ADMIN' || !user?.accountType));

  const [feedStatus, setFeedStatus] = useState<any>(null);
  const [events, setEvents] = useState<NewsEventItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  // AHMED AI status from server: 'ON' | 'RETRYING' | 'OFF_RULES_MODE'
  const [ahmedAiStatus, setAhmedAiStatus] = useState<'ON' | 'RETRYING' | 'OFF_RULES_MODE'>('ON');

  // Lazy Brief Fetching Cache
  const [briefs, setBriefs] = useState<Record<string, BriefData>>({});
  const [loadingBriefId, setLoadingBriefId] = useState<string | null>(null);
  const [briefErrorIds, setBriefErrorIds] = useState<Record<string, boolean>>({});

  // Collapsed speeches state (by day key)
  const [expandedSpeechesDays, setExpandedSpeechesDays] = useState<Record<string, boolean>>({});

  // Admin Actual Entry State
  const [editingActualId, setEditingActualId] = useState<string | null>(null);
  const [manualActualInput, setManualActualInput] = useState('');
  const [isSavingActual, setIsSavingActual] = useState(false);
  const [isLookingUpAi, setIsLookingUpAi] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const [decisionAccuracy, setDecisionAccuracy] = useState<{ hits: number; total: number; accuracyPct: number; display: string } | null>(null);

  const fetchNews = useCallback(async () => {
    try {
      const res = await fetch('/api/news');
      if (res.ok) {
        const json = await res.json();
        setFeedStatus(json.feed);
        setEvents(json.events || []);
        if (json.accuracy) {
          setDecisionAccuracy(json.accuracy);
        }
        if (json.ahmedAiStatus) {
          setAhmedAiStatus(json.ahmedAiStatus);
        } else if (typeof json.ahmedAiOnline === 'boolean') {
          setAhmedAiStatus(json.ahmedAiOnline ? 'ON' : 'OFF_RULES_MODE');
        }
      }
    } catch {
      // ignore network errors
    }
  }, []);

  // Periodic poll
  useEffect(() => {
    fetchNews();
    const timer = setInterval(fetchNews, 60000);
    return () => clearInterval(timer);
  }, [fetchNews]);

  // Section 4: Auto-refresh every 30s for up to 10 minutes from release while waiting for result
  useEffect(() => {
    const hasWaitingEvents = events.some(
      (e) => e.isReleased && !e.actualStr && e.minutesUntil >= -10 && e.minutesUntil <= 0
    );
    if (!hasWaitingEvents) return;

    const timer = setInterval(() => {
      fetchNews();
    }, 30000);

    return () => clearInterval(timer);
  }, [events, fetchNews]);

  // Request or lazily generate AHMED AI brief with strict 12s timeout
  const fetchBriefForEvent = useCallback(
    async (eventId: string, isManualRetry = false) => {
      if ((briefs[eventId] && !isManualRetry) || loadingBriefId === eventId) return;
      setLoadingBriefId(eventId);
      setBriefErrorIds((prev) => ({ ...prev, [eventId]: false }));

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 12000);

      try {
        const res = await fetch('/api/news/brief', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const json = await res.json();
          if (json.brief) {
            setBriefs((prev) => ({ ...prev, [eventId]: json.brief }));
            return;
          }
        }
        throw new Error('Brief response unsuccessful');
      } catch {
        clearTimeout(timeoutId);
        // Fallback to deterministic rule-based brief immediately with RULES tag
        const targetEvt = events.find((e) => e.id === eventId);
        const fallbackBrief: BriefData = {
          headline: `${(targetEvt?.title || 'Release').slice(0, 40)} Playbook`,
          what_it_is:
            targetEvt?.playbook?.what_it_is || 'Key macroeconomic indicator measuring US economic health.',
          why_gold_cares:
            targetEvt?.playbook?.why_gold_cares ||
            'Gold correlates inversely with the US Dollar and real Treasury yields.',
          watch_for:
            targetEvt?.playbook?.watch_for ||
            'Higher prints favour the dollar and pressure gold; lower prints support gold.',
          source: 'RULES',
        };
        setBriefs((prev) => ({ ...prev, [eventId]: fallbackBrief }));
        setBriefErrorIds((prev) => ({ ...prev, [eventId]: true }));
      } finally {
        setLoadingBriefId((curr) => (curr === eventId ? null : curr));
      }
    },
    [briefs, loadingBriefId, events]
  );

  const handleManualActualSubmit = async (eventId: string) => {
    if (!manualActualInput.trim()) return;
    setIsSavingActual(true);
    try {
      const res = await fetch('/api/news/manual-actual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          actualValue: manualActualInput.trim(),
        }),
      });
      if (res.ok) {
        setActionNotice(`Actual value recorded for ${eventId}. Result recomputed.`);
        setEditingActualId(null);
        setManualActualInput('');
        fetchNews();
      }
    } finally {
      setIsSavingActual(false);
    }
  };

  const handleAiLookup = async (eventId: string) => {
    setIsLookingUpAi(true);
    try {
      const res = await fetch('/api/news/lookup-actual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }),
      });
      if (res.ok) {
        const json = await res.json();
        setManualActualInput(json.lookup.actual || '');
        setActionNotice(`AHMED AI retrieved: ${json.lookup.actual} (Marked UNVERIFIED until confirmed)`);
      }
    } finally {
      setIsLookingUpAi(false);
    }
  };

  // Format countdown string
  const formatCountdown = (mins: number) => {
    if (mins < 0) {
      const pastMins = Math.abs(mins);
      if (pastMins < 60) return `${pastMins}m ago`;
      const hrs = Math.floor(pastMins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      const days = Math.floor(hrs / 24);
      return `${days}d ago`;
    }
    if (mins === 0) return 'DUE NOW';
    if (mins < 60) return `in ${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `in ${hrs}h ${mins % 60}m`;
    const days = Math.floor(hrs / 24);
    const remHrs = hrs % 24;
    return `in ${days}d ${remHrs}h`;
  };

  // 1. Compute 24h Risk level: LOW / MEDIUM / HIGH
  const riskAssessment = useMemo(() => {
    const next24hEvents = events.filter((e) => {
      return e.minutesUntil >= 0 && e.minutesUntil <= 1440;
    });
    const tier1Count = next24hEvents.filter((e) => e.ahmedTier === 1).length;
    const tier2Count = next24hEvents.filter((e) => e.ahmedTier === 2).length;

    if (tier1Count >= 2 || (tier1Count >= 1 && tier2Count >= 2)) {
      return {
        level: 'HIGH',
        color: 'text-rose-400',
        bg: 'bg-rose-950/40 border-rose-500/40',
        badge: 'bg-rose-500/20 text-rose-300 border-rose-500/50',
        sentence: `Heavy institutional volatility expected with ${tier1Count} high-impact release${
          tier1Count > 1 ? 's' : ''
        } scheduled within 24 hours.`,
      };
    }
    if (tier1Count === 1 || tier2Count >= 2) {
      return {
        level: 'MEDIUM',
        color: 'text-amber-400',
        bg: 'bg-amber-950/40 border-amber-500/40',
        badge: 'bg-amber-500/20 text-amber-300 border-amber-500/50',
        sentence: `Moderate macro catalyst exposure ahead (${
          tier1Count > 0 ? `${tier1Count} High, ` : ''
        }${tier2Count} Medium). Expect localized volatility.`,
      };
    }
    return {
      level: 'LOW',
      color: 'text-emerald-400',
      bg: 'bg-emerald-950/30 border-emerald-500/30',
      badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50',
      sentence: 'No major high-impact catalysts due in the next 24 hours. Price action driven primarily by technical order flow.',
    };
  }, [events]);

  // Section 1: Week Ahead Events (Tier 1 & 2 in the next 7 days)
  const weekAheadEvents = useMemo(() => {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    return events
      .filter((e) => {
        const t = new Date(e.timeUtc).getTime();
        return (
          (e.ahmedTier === 1 || e.ahmedTier === 2) &&
          !e.isCancelledOrRemoved &&
          t >= now - 60 * 60 * 1000 &&
          t <= now + sevenDaysMs
        );
      })
      .sort((a, b) => new Date(a.timeUtc).getTime() - new Date(b.timeUtc).getTime());
  }, [events]);

  // 2. Compute NEXT KEY CATALYST: next tier 1 or 2 event (not a speech unless nothing else exists)
  const nextKeyCatalyst = useMemo(() => {
    const upcoming = events.filter((e) => e.minutesUntil > -90 && !e.isCancelledOrRemoved);
    const nonSpeechTier1or2 = upcoming
      .filter((e) => (e.ahmedTier === 1 || e.ahmedTier === 2) && !e.isSpeech)
      .sort((a, b) => a.minutesUntil - b.minutesUntil);

    if (nonSpeechTier1or2.length > 0) return nonSpeechTier1or2[0];

    const anyTier1or2 = upcoming
      .filter((e) => e.ahmedTier === 1 || e.ahmedTier === 2)
      .sort((a, b) => a.minutesUntil - b.minutesUntil);

    if (anyTier1or2.length > 0) return anyTier1or2[0];

    return feedStatus?.nextEvent || null;
  }, [events, feedStatus?.nextEvent]);

  // Respect prefers-reduced-motion for NewsFlow Lite mode
  const prefersReducedMotion = useMemo(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return false;
  }, []);

  // NEWS FLOW events: only upcoming USD events (or within 15 min after their time), max 6, sorted by time
  const newsFlowEvents = useMemo<NFEvent[]>(() => {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    const shortenTitle = (title: string): string => {
      const t = title.trim();
      const lower = t.toLowerCase();

      // Explicit mappings per specification
      if (t === 'ADP Weekly Employment Change' || t === 'ADP Non-Farm Employment Change') return 'ADP Employment';
      if (t === 'Unemployment Claims' || lower.includes('jobless claims')) return 'Jobless Claims';
      if (t === 'FOMC Meeting Minutes' || lower.includes('fomc minutes')) return 'FOMC Minutes';
      if (t === 'Non-Farm Employment Change' || lower.includes('non-farm employment')) return 'NFP';
      if (t === 'Federal Funds Rate') return 'Fed Rate';
      if (t === 'Core CPI m/m') return 'Core CPI';
      if (t === 'CPI m/m') return 'CPI m/m';
      if (t === 'CPI y/y') return 'CPI y/y';
      if (t === 'NFIB Small Business Index' || lower.includes('nfib')) return 'NFIB';
      if (t === 'Existing Home Sales' || lower.includes('existing home sales')) return 'Home Sales';
      if (t === 'Capacity Utilization Rate' || lower.includes('capacity utilization')) return 'Capacity Util.';
      if (t === 'Core Retail Sales m/m' || lower.includes('core retail sales')) return 'Core Retail';
      if (t === 'Retail Sales m/m' || lower.includes('retail sales')) return 'Retail Sales';
      if (t === 'Core PPI m/m' || lower.includes('core ppi')) return 'Core PPI';
      if (t === 'Import Prices m/m' || lower.includes('import prices')) return 'Import Prices';
      if (lower.includes('fed chairman warsh') || lower.includes('fed chair') || lower.includes('powell') && lower.includes('speaks')) return 'Fed Chair Speaks';
      if (lower.includes('fomc member') && lower.includes('speaks')) return 'FOMC Speech';
      if (lower.includes('fomc') && lower.includes('speaks')) return 'FOMC Speech';

      // Fallback: max 14 characters, clean whole words, no mid-word cut-offs
      const words = t.split(/\s+/);
      let res = '';
      for (const w of words) {
        const next = res ? `${res} ${w}` : w;
        if (next.length <= 14) {
          res = next;
        } else {
          break;
        }
      }
      return res || t.slice(0, 14);
    };

    const isFedChairOrFomcPress = (e: NewsEventItem): boolean => {
      const t = e.title.toLowerCase();
      return (
        t.includes('fed chair') ||
        t.includes('powell') ||
        t.includes('warsh') ||
        t.includes('fomc press conference')
      );
    };

    // Helper to test if event is excluded
    const isExcluded = (e: NewsEventItem): boolean => {
      if (e.isCancelledOrRemoved) return true;
      if (e.country !== 'USD') return true;
      const t = e.title.toLowerCase();
      if (t.includes('holiday') || e.impact === 'Holiday') return true;
      // Exclude speeches unless Fed Chair or FOMC press conference
      if (e.isSpeech && !isFedChairOrFomcPress(e)) return true;
      return false;
    };

    const isUpcomingInWindow = (e: NewsEventItem): boolean => {
      const eventTs = new Date(e.timeUtc).getTime();
      return eventTs + 15 * 60000 >= now && eventTs <= now + sevenDaysMs;
    };

    // Pool of valid upcoming USD events within 7 days
    const validEvents = events
      .filter((e) => isUpcomingInWindow(e) && !isExcluded(e))
      .sort((a, b) => new Date(a.timeUtc).getTime() - new Date(b.timeUtc).getTime());

    // 1. Primary candidates: Tier 1 (HIGH) or Tier 2 (MED), or Fed Chair / FOMC press conf
    let selected = validEvents.filter((e) => {
      return e.ahmedTier === 1 || e.ahmedTier === 2 || isFedChairOrFomcPress(e);
    });

    // Ensure Fed Chair speeches / FOMC press confs in window are always included
    const fedChairEvents = validEvents.filter(isFedChairOrFomcPress);
    if (fedChairEvents.length > 0) {
      const fedIds = new Set(fedChairEvents.map((f) => f.id));
      const nonFed = selected.filter((s) => !fedIds.has(s.id));
      selected = [...fedChairEvents, ...nonFed].sort(
        (a, b) => new Date(a.timeUtc).getTime() - new Date(b.timeUtc).getTime()
      );
    }

    // If fewer than 3 events qualify, fill with low fillers or any valid events from pool
    if (selected.length < 3) {
      const selectedIds = new Set(selected.map((s) => s.id));
      const lowFillers = validEvents.filter((e) => !selectedIds.has(e.id) && !e.isSpeech);
      selected = [...selected, ...lowFillers].sort(
        (a, b) => new Date(a.timeUtc).getTime() - new Date(b.timeUtc).getTime()
      );
    }

    if (selected.length < 3) {
      const selectedIds = new Set(selected.map((s) => s.id));
      const fallbackPool = events.filter((e) => !selectedIds.has(e.id) && !isExcluded(e)).sort((a, b) => new Date(a.timeUtc).getTime() - new Date(b.timeUtc).getTime());
      selected = [...selected, ...fallbackPool].sort(
        (a, b) => new Date(a.timeUtc).getTime() - new Date(b.timeUtc).getTime()
      );
    }

    const finalEvents = selected.slice(0, 6);

    return finalEvents.map((e) => {
      // Single deterministic source from final decision if present, else deterministic preNewsLean
      let lean: 'bull' | 'bear' | 'wait' = 'wait';
      if (e.decision && e.decision.final) {
        if (e.decision.final === 'BULLISH') lean = 'bull';
        else if (e.decision.final === 'BEARISH') lean = 'bear';
        else lean = 'wait';
      } else {
        const hasNoForecast =
          e.forecastNum === null ||
          !e.forecastStr ||
          e.forecastStr.trim() === '' ||
          e.forecastStr === '--' ||
          e.forecastStr === 'N/A' ||
          e.forecastStr === 'Tentative';

        if (!hasNoForecast) {
          const preLean = getPreNewsLean(e);
          if (preLean.lean === 'BULLISH') lean = 'bull';
          else if (preLean.lean === 'BEARISH') lean = 'bear';
          else lean = 'wait';
        }
      }

      const lowerTitle = e.title.toLowerCase();
      const isReversed = lowerTitle.includes('claim') || lowerTitle.includes('unemploy');
      const isSpeech = e.isSpeech || lowerTitle.includes('speaks') || lowerTitle.includes('speech') || lowerTitle.includes('testifies');

      let footerNote: string;
      if (lean === 'bull') {
        footerNote = 'leans bullish if as forecast';
      } else if (lean === 'bear') {
        footerNote = 'leans bearish if as forecast';
      } else if (isSpeech) {
        footerNote = 'guidance & market tone steer reaction';
      } else if (isReversed) {
        footerNote = 'Higher -> BULLISH · Lower -> BEARISH';
      } else {
        footerNote = 'Higher -> BEARISH · Lower -> BULLISH';
      }

      return {
        id: e.id,
        title: shortenTitle(e.title),
        tier: (e.ahmedTier === 1 ? 1 : e.ahmedTier === 2 ? 2 : 3) as 1 | 2 | 3,
        lean,
        ts: new Date(e.timeUtc).getTime(),
        footerNote,
      };
    });
  }, [events]);

  // Handle selection from NewsFlow canvas: scroll smoothly and expand
  const handleNewsFlowSelect = useCallback((id: string) => {
    setExpandedEventId(id);
    if (!briefs[id]) {
      fetchBriefForEvent(id);
    }
    const el = document.getElementById(`news-event-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [briefs, fetchBriefForEvent]);

  // Auto-fetch brief for next key catalyst
  useEffect(() => {
    if (nextKeyCatalyst?.id && !briefs[nextKeyCatalyst.id]) {
      fetchBriefForEvent(nextKeyCatalyst.id);
    }
  }, [nextKeyCatalyst?.id, briefs, fetchBriefForEvent]);

  // 3. Group events by day for Timeline
  const timelineGroups = useMemo(() => {
    const groups: {
      dayKey: string;
      dayLabel: string;
      standardEvents: NewsEventItem[];
      speechEvents: NewsEventItem[];
    }[] = [];

    const map = new Map<string, { standard: NewsEventItem[]; speeches: NewsEventItem[]; label: string }>();

    for (const evt of events) {
      const d = new Date(evt.timeUtc);
      const dayKey = isNaN(d.getTime()) ? 'unknown' : d.toISOString().slice(0, 10);
      const dayLabel = isNaN(d.getTime())
        ? 'Upcoming Releases'
        : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

      if (!map.has(dayKey)) {
        map.set(dayKey, { standard: [], speeches: [], label: dayLabel });
      }

      const grp = map.get(dayKey)!;
      if (evt.ahmedTier === 3 && evt.isSpeech) {
        grp.speeches.push(evt);
      } else {
        grp.standard.push(evt);
      }
    }

    for (const [dayKey, val] of map.entries()) {
      groups.push({
        dayKey,
        dayLabel: val.label,
        standardEvents: val.standard,
        speechEvents: val.speeches,
      });
    }

    return groups;
  }, [events]);

  const toggleEventExpand = (evt: NewsEventItem) => {
    if (expandedEventId === evt.id) {
      setExpandedEventId(null);
    } else {
      setExpandedEventId(evt.id);
      if (!briefs[evt.id]) {
        fetchBriefForEvent(evt.id);
      }
    }
  };

  const handleSelectWeekCard = (evt: NewsEventItem) => {
    setExpandedEventId(evt.id);
    if (!briefs[evt.id]) {
      fetchBriefForEvent(evt.id);
    }
    const el = document.getElementById(`news-event-${evt.id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const toggleDaySpeeches = (dayKey: string) => {
    setExpandedSpeechesDays((prev) => ({
      ...prev,
      [dayKey]: !prev[dayKey],
    }));
  };

  // Section 2: Render Tier Badge (HIGH / MED / LOW with colour dot + word)
  const renderTierBadge = (ahmedTier: number) => {
    if (ahmedTier === 1) {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-500/15 border border-rose-500/40 text-rose-300 shrink-0 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
          HIGH
        </span>
      );
    }
    if (ahmedTier === 2) {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 border border-amber-500/40 text-amber-300 shrink-0 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          MED
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-neutral-800 border border-neutral-700 text-neutral-400 shrink-0 whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-neutral-400" />
        LOW
      </span>
    );
  };

  // Section 2: SINGLE DETERMINISTIC SOURCE FOR THE LEAN CHIP
  // Identical in all 3 places: Week Ahead strip, Next Key Catalyst card, and Timeline rows
  const renderLeanOrResultChip = (evt: NewsEventItem) => {
    // 1. Post-release with actual value: show real result chip
    if (evt.isReleased && evt.actualStr && evt.scenarios?.surpriseChip) {
      const { sentiment, size, diffPct } = evt.scenarios.surpriseChip;
      const isBull = sentiment === 'BULLISH';
      const isBear = sentiment === 'BEARISH';
      const badgeStyle = isBull
        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
        : isBear
        ? 'bg-rose-500/20 text-rose-300 border-rose-500/50'
        : 'bg-neutral-800 text-neutral-300 border-neutral-600';

      return (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${badgeStyle} shrink-0 whitespace-nowrap`}
          title={`Actual release surprise: ${sentiment} (${size} · Δ${diffPct}%)`}
        >
          {isBull ? <TrendingUp className="w-3 h-3 shrink-0" /> : isBear ? <TrendingDown className="w-3 h-3 shrink-0" /> : null}
          <span>
            {sentiment} {size ? `(${size})` : ''}
          </span>
        </span>
      );
    }

    // 2. Post-release within 10 min awaiting actual
    if (evt.isReleased && !evt.actualStr && evt.minutesUntil >= -10 && evt.minutesUntil <= 0) {
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border bg-amber-500/10 border-amber-500/30 text-amber-300 shrink-0 whitespace-nowrap"
          title="Release time reached. Auto-checking feed for reported actual value."
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping shrink-0" />
          <span>Waiting for result…</span>
        </span>
      );
    }

    // 3. Before release: check if forecast is missing
    const hasNoForecast =
      evt.forecastNum === null ||
      !evt.forecastStr ||
      evt.forecastStr.trim() === '' ||
      evt.forecastStr === '--' ||
      evt.forecastStr === 'N/A' ||
      evt.forecastStr === 'Tentative';

    const noConsensus = isNoConsensusEvent(evt.title, evt.isSpeech);

    if (hasNoForecast || noConsensus) {
      if (noConsensus) {
        return (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border bg-neutral-800/80 border-neutral-700 text-neutral-300 shrink-0 whitespace-nowrap"
            title="No consensus forecast for this event"
          >
            <span>NO LEAN · see playbook</span>
          </span>
        );
      }

      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border bg-neutral-800/80 border-neutral-700 text-neutral-400 shrink-0 whitespace-nowrap"
          title="Forecast due ~24h before"
        >
          <span>WAITING FORECAST</span>
        </span>
      );
    }

    // 4. Pre-News Decision (System + AHMED AI vote combined)
    if (evt.decision) {
      const { final, label } = evt.decision;

      if (label === 'CONFLICT') {
        return (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border bg-purple-500/15 border-purple-500/35 text-purple-300 shrink-0 whitespace-nowrap"
            title="System & AI votes disagree: WAIT (no lean enforced)"
          >
            <span>WAIT · CONFLICT</span>
          </span>
        );
      }

      if (final === 'BULLISH') {
        return (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border bg-emerald-500/15 border-emerald-500/35 text-emerald-300 shrink-0 whitespace-nowrap"
            title={`Pre-News Decision: BULLISH · ${label}`}
          >
            <TrendingUp className="w-2.5 h-2.5 shrink-0" />
            <span>LEAN: BULLISH · {label}</span>
          </span>
        );
      }

      if (final === 'BEARISH') {
        return (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border bg-rose-500/15 border-rose-500/35 text-rose-300 shrink-0 whitespace-nowrap"
            title={`Pre-News Decision: BEARISH · ${label}`}
          >
            <TrendingDown className="w-2.5 h-2.5 shrink-0" />
            <span>LEAN: BEARISH · {label}</span>
          </span>
        );
      }

      if (final === 'WAIT' || final === 'WAITING') {
        return (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border bg-neutral-800 border-neutral-700 text-neutral-400 shrink-0 whitespace-nowrap"
            title={`Pre-News Decision: ${label}`}
          >
            <span>WAIT · {label}</span>
          </span>
        );
      }
    }

    // Fallback to rules-only preLean if decision not yet attached
    const preLean = getPreNewsLean(evt);

    if (preLean.lean === 'NO_CONSENSUS') {
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border bg-neutral-800/80 border-neutral-700 text-neutral-300 shrink-0 whitespace-nowrap"
          title="No consensus for this event"
        >
          <span>NO LEAN · see playbook</span>
        </span>
      );
    }

    if (preLean.lean === 'WAITING_FORECAST' || preLean.lean === 'WAITING') {
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border bg-neutral-800/80 border-neutral-700 text-neutral-400 shrink-0 whitespace-nowrap"
          title="Forecast due ~24h before"
        >
          <span>WAITING FORECAST</span>
        </span>
      );
    }

    if (preLean.lean === 'TONE-DEPENDENT') {
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border bg-purple-500/15 border-purple-500/30 text-purple-300 shrink-0 whitespace-nowrap"
          title="Tone-dependent: forward guidance and market tone steer reaction."
        >
          <span>TONE-DEPENDENT</span>
        </span>
      );
    }

    if (preLean.lean === 'BULLISH') {
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border bg-emerald-500/15 border-emerald-500/35 text-emerald-300 shrink-0 whitespace-nowrap"
          title="Pre-News Lean: cooling data points to mild bullish bias for gold if printed as forecast"
        >
          <TrendingUp className="w-2.5 h-2.5 shrink-0" />
          <span>LEAN: BULLISH · RULES ONLY</span>
        </span>
      );
    }

    if (preLean.lean === 'BEARISH') {
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border bg-rose-500/15 border-rose-500/35 text-rose-300 shrink-0 whitespace-nowrap"
          title="Pre-News Lean: hotter data points to mild bearish bias for gold if printed as forecast"
        >
          <TrendingDown className="w-2.5 h-2.5 shrink-0" />
          <span>LEAN: BEARISH · RULES ONLY</span>
        </span>
      );
    }

    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border bg-neutral-800 border-neutral-700 text-neutral-300 shrink-0 whitespace-nowrap"
        title="Pre-News Lean: Forecast equals previous release"
      >
        <span>LEAN: NEUTRAL</span>
      </span>
    );
  };

  // Section 3: AHMED AI Status Chip (ON, RETRYING, OFF rules mode)
  const renderAhmedAiStatusChip = () => {
    if (ahmedAiStatus === 'ON') {
      return (
        <div
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-colors select-none bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
          title="Institutional AI active and verified"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
          <span>AHMED AI: ON</span>
        </div>
      );
    }
    if (ahmedAiStatus === 'RETRYING') {
      return (
        <div
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-colors select-none bg-amber-500/10 border-amber-500/30 text-amber-300"
          title="AI call retrying - deterministic rules active"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span>AHMED AI: RETRYING</span>
        </div>
      );
    }
    return (
      <div
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-colors select-none bg-neutral-800/90 border-neutral-700 text-neutral-400"
        title="Server AI key not configured - deterministic rules active"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-neutral-500" />
        <span>AHMED AI: OFF</span>
      </div>
    );
  };

  // Section 3: Render Expanded Event Short Playbook Card
  const renderBriefPlaybookCard = (evt: NewsEventItem) => {
    const brief = briefs[evt.id] || evt.brief;
    const isBriefLoading = loadingBriefId === evt.id;
    const hasError = !!briefErrorIds[evt.id];
    const playbook = evt.playbook;

    return (
      <div className="mt-3 p-3.5 sm:p-4 rounded-xl bg-black/75 border border-white/10 space-y-3 font-mono">
        {/* Playbook Metadata: WHEN & SIGNALS PAUSED */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div className="p-2 sm:p-2.5 rounded-lg bg-white/[0.03] border border-white/10 flex items-center justify-between">
            <span className="text-[10px] text-neutral-400 font-bold uppercase tracking-wider flex items-center gap-1">
              <Clock className="w-3 h-3 text-[#FFD97A]" />
              WHEN
            </span>
            <span className="text-white font-mono text-[11px] font-semibold">
              {formatEventTimes(evt.timeUtc)}
            </span>
          </div>

          <div className="p-2 sm:p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-amber-300">
            <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider flex items-center gap-1">
              <ShieldAlert className="w-3 h-3" />
              SIGNALS
            </span>
            <span className="font-mono text-[11px] font-bold">Paused from -30m to +15m</span>
          </div>
        </div>

        {/* Playbook Scenarios: IF HIGHER & IF LOWER chips */}
        <div className="space-y-1.5">
          {evt.scenarios?.surpriseChip ? (
            <div className="p-2.5 rounded-xl bg-black/60 border border-white/15 flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-300">RELEASE SURPRISE:</span>
              <span
                className={`px-2.5 py-0.5 rounded text-xs font-bold border ${
                  evt.scenarios.surpriseChip.sentiment === 'BULLISH'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                    : evt.scenarios.surpriseChip.sentiment === 'BEARISH'
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/50'
                    : 'bg-neutral-800 text-neutral-300 border-neutral-600'
                }`}
              >
                {evt.scenarios.surpriseChip.sentiment} ({evt.scenarios.surpriseChip.size} • Δ
                {evt.scenarios.surpriseChip.diffPct}%)
              </span>
            </div>
          ) : evt.scenarios?.type === 'NO_FORECAST' ? (
            <div className="p-2 rounded-xl bg-neutral-900/60 border border-neutral-800 text-center text-xs text-neutral-400">
              {isNoConsensusEvent(evt.title, evt.isSpeech)
                ? 'No consensus for this event'
                : 'Forecast due ~24h before'}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              <div className="p-2 rounded-lg bg-rose-950/40 border border-rose-500/40 text-rose-300 flex items-start gap-2">
                <TrendingDown className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <span className="text-[9px] font-bold text-rose-400 uppercase block">IF HIGHER</span>
                  <span>{evt.scenarios.higher}</span>
                </div>
              </div>
              <div className="p-2 rounded-lg bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 flex items-start gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <span className="text-[9px] font-bold text-emerald-400 uppercase block">IF LOWER</span>
                  <span>{evt.scenarios.lower}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Brief Header with AHMED AI or RULES Tag */}
        <div className="flex items-center justify-between border-t border-white/10 pt-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold tracking-wider text-[#FFD97A] uppercase">
              AHMED AI NEWS BRIEF
            </span>
            {brief?.source === 'AHMED_AI' ? (
              <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#E8B84A]/20 border border-[#E8B84A]/40 text-[#FFD97A]">
                AHMED AI
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-neutral-800 border border-neutral-600 text-neutral-400">
                RULES
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isBriefLoading ? (
              <div className="flex items-center gap-1.5 text-[9px] text-[#FFD97A]">
                <Sparkles className="w-3 h-3 animate-spin" />
                <span>Generating brief...</span>
              </div>
            ) : hasError || brief?.source === 'RULES' ? (
              <button
                onClick={() => fetchBriefForEvent(evt.id, true)}
                className="text-[9px] text-[#FFD97A] hover:underline flex items-center gap-1 cursor-pointer"
                title="Retry AI brief generation"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                <span>Retry AI</span>
              </button>
            ) : null}
          </div>
        </div>

        {/* 3-line Institutional Content */}
        <div className="space-y-2 text-xs">
          {brief ? (
            <>
              <div>
                <span className="text-[10px] text-neutral-400 uppercase font-bold block">
                  WHAT IT IS
                </span>
                <span className="text-white font-medium">
                  {brief.what_it_is || playbook?.what_it_is}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-neutral-400 uppercase font-bold block">
                  WHY GOLD CARES
                </span>
                <span className="text-neutral-300">
                  {brief.why_gold_cares || playbook?.why_gold_cares}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-neutral-400 uppercase font-bold block">
                  WATCH FOR
                </span>
                <span className="text-[#FFD97A]">
                  {brief.watch_for || playbook?.watch_for}
                </span>
              </div>
            </>
          ) : isBriefLoading ? (
            <div className="py-2 text-neutral-400 text-xs italic flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-[#FFD97A] animate-pulse" />
              <span>Synthesizing institutional gold brief...</span>
            </div>
          ) : (
            <>
              <div>
                <span className="text-[10px] text-neutral-400 uppercase font-bold block">
                  WHAT IT IS
                </span>
                <span className="text-white font-medium">
                  {playbook?.what_it_is || 'Key macroeconomic indicator measuring US economic health.'}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-neutral-400 uppercase font-bold block">
                  WHY GOLD CARES
                </span>
                <span className="text-neutral-300">
                  {playbook?.why_gold_cares ||
                    'Hotter inflation raises rate-hike fears, which lifts the US dollar and usually pushes gold down.'}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-neutral-400 uppercase font-bold block">
                  WATCH FOR
                </span>
                <span className="text-[#FFD97A]">
                  {playbook?.watch_for ||
                    'Higher prints favour the dollar and pressure gold; lower prints support gold.'}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Admin Actual Entry Component */}
        {isAdmin && (
          <div className="pt-2 border-t border-white/10 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-neutral-300">
              <span className="font-bold text-white flex items-center gap-1.5">
                <Edit3 className="w-3.5 h-3.5 text-[#FFD97A]" />
                <span>Admin Actual Value Entry:</span>
              </span>
              <button
                onClick={() => handleAiLookup(evt.id)}
                disabled={isLookingUpAi}
                className="px-2 py-0.5 bg-[#E8B84A]/10 hover:bg-[#E8B84A]/20 border border-[#E8B84A]/30 text-[#FFD97A] rounded text-[10px] cursor-pointer flex items-center gap-1"
              >
                <Sparkles className="w-3 h-3" />
                <span>AHMED AI Lookup</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder='e.g. "3.2%" or "215K"'
                value={editingActualId === evt.id ? manualActualInput : evt.actualStr || ''}
                onFocus={() => {
                  setEditingActualId(evt.id);
                  setManualActualInput(evt.actualStr || '');
                }}
                onChange={(e) => {
                  setEditingActualId(evt.id);
                  setManualActualInput(e.target.value);
                }}
                className="flex-1 bg-black/60 border border-white/15 rounded-lg px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-[#E8B84A]"
              />
              <button
                onClick={() => handleManualActualSubmit(evt.id)}
                disabled={isSavingActual || !manualActualInput.trim()}
                className="px-3 py-1.5 bg-[#E8B84A] text-black font-bold text-xs rounded-lg hover:bg-[#FFD97A] cursor-pointer disabled:opacity-50"
              >
                Save Actual
              </button>
            </div>
          </div>
        )}

        {/* Footer line */}
        <div className="pt-2 border-t border-white/5 text-[9px] text-neutral-500 flex items-center justify-between">
          <span>AHMED AI explains the news. It does not place or change signals.</span>
          <span>Lock: -30m / +15m</span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4 sm:space-y-6 font-mono select-none max-w-full overflow-hidden">
      {/* Top Action Notification */}
      {actionNotice && (
        <div className="bg-[#E8B84A]/10 border border-[#E8B84A]/30 rounded-xl p-3 flex items-center justify-between text-xs text-[#FFD97A]">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#E8B84A]" />
            <span>{actionNotice}</span>
          </div>
          <button onClick={() => setActionNotice(null)} className="text-neutral-400 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* 1. TOP CARD: TODAY'S GOLD NEWS RISK */}
      <div className={`p-4 sm:p-5 rounded-2xl border ${riskAssessment.bg} relative overflow-hidden shadow-lg`}>
        <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Zap className={`w-4 h-4 ${riskAssessment.color}`} />
            <h2 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-white">
              TODAY'S GOLD NEWS RISK
            </h2>
          </div>

          <div className="flex items-center gap-2.5">
            {/* AHMED AI Status Chip */}
            {renderAhmedAiStatusChip()}

            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${riskAssessment.badge}`}>
              ● {riskAssessment.level} RISK
            </span>
          </div>
        </div>

        <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <p className="text-xs sm:text-sm text-neutral-200">{riskAssessment.sentence}</p>
          <div className="flex items-center gap-2 text-[10px] text-neutral-400 shrink-0">
            <Radio className="w-3 h-3 text-[#FFD97A]" />
            <span>Forex Factory USD Feed</span>
          </div>
        </div>
      </div>

      {/* NEWS FLOW ANIMATION CANVAS */}
      <NewsFlow
        events={newsFlowEvents}
        lite={prefersReducedMotion}
        locked={feedStatus?.isLockActive !== undefined ? feedStatus.isLockActive : null}
        nextId={nextKeyCatalyst?.id}
        countdownText={nextKeyCatalyst ? formatCountdown(nextKeyCatalyst.minutesUntil) : undefined}
        onSelect={handleNewsFlowSelect}
      />

      {/* Section 1: WEEK AHEAD STRIP (Horizontal scroll strip of all tier 1 and tier 2 events in next 7 days) */}
      {weekAheadEvents.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-[#FFD97A]" />
              WEEK AHEAD CATALYSTS ({weekAheadEvents.length})
            </span>
            <span className="text-[10px] text-neutral-500">Tap to inspect playbook</span>
          </div>

          <div className="flex overflow-x-auto gap-2.5 pb-2 pt-0.5 no-scrollbar scroll-smooth">
            {weekAheadEvents.map((wEvt) => {
              const isSelected = expandedEventId === wEvt.id;
              return (
                <div
                  key={wEvt.id}
                  onClick={() => handleSelectWeekCard(wEvt)}
                  className={`min-w-[190px] sm:min-w-[210px] max-w-[240px] p-3 rounded-xl border transition-all cursor-pointer select-none flex flex-col justify-between shrink-0 ${
                    isSelected
                      ? 'bg-[#E8B84A]/10 border-[#E8B84A]/60 shadow-[0_0_12px_rgba(232,184,74,0.2)]'
                      : 'bg-black/50 hover:bg-black/75 border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-1 text-[10px]">
                      <span className="text-neutral-400 font-semibold truncate font-mono">
                        {formatDayTimeShort(wEvt.timeUtc)}
                      </span>
                      {renderTierBadge(wEvt.ahmedTier)}
                    </div>

                    <h4 className="text-xs font-bold text-white line-clamp-1" title={wEvt.title}>
                      {wEvt.title}
                    </h4>
                  </div>

                  <div className="mt-2.5 pt-2 border-t border-white/10 flex items-center justify-between gap-1">
                    {renderLeanOrResultChip(wEvt)}
                    <span className="text-[10px] font-bold text-[#FFD97A] shrink-0 font-mono">
                      {formatCountdown(wEvt.minutesUntil)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. NEXT KEY CATALYST CARD */}
      {nextKeyCatalyst && (
        <div
          id={`news-event-${nextKeyCatalyst.id}`}
          className="p-4 sm:p-5 rounded-2xl border border-[#E8B84A]/40 bg-gradient-to-r from-black/85 via-[#E8B84A]/5 to-black/85 shadow-[0_0_20px_rgba(232,184,74,0.12)] space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-[#E8B84A]/20 border border-[#E8B84A]/40 text-[#FFD97A] text-[10px] font-bold">
                NEXT KEY CATALYST
              </span>
              {renderTierBadge(nextKeyCatalyst.ahmedTier || 1)}
              <span className="text-[10px] text-neutral-400">• {nextKeyCatalyst.country}</span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Exact identical lean chip on Next Key Catalyst Card */}
              {renderLeanOrResultChip(nextKeyCatalyst)}
              <div className="flex items-center gap-1 text-[#FFD97A]">
                <Clock className="w-3.5 h-3.5" />
                <span className="text-base sm:text-lg font-bold font-mono">
                  {formatCountdown(nextKeyCatalyst.minutesUntil)}
                </span>
              </div>
            </div>
          </div>

          {/* Event Title & Metadata */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white tracking-wide">
                {nextKeyCatalyst.title}
              </h3>
              <p className="text-[11px] text-neutral-400 mt-0.5 flex items-center gap-1.5">
                <Globe className="w-3 h-3 text-neutral-500" />
                <span>{formatEventTimes(nextKeyCatalyst.timeUtc)}</span>
              </p>
            </div>

            {/* Lock chip: Signals paused: -30m to +15m */}
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[10px] font-bold text-amber-300 shrink-0">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              <span>Signals paused: -30m to +15m</span>
            </div>
          </div>

          {/* Forecast / Previous / Actual Grid */}
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="p-2 sm:p-2.5 rounded-xl bg-black/60 border border-white/10">
              <span className="text-[9px] text-neutral-500 block uppercase">FORECAST</span>
              <span className="text-xs sm:text-sm font-bold text-white font-mono">
                {nextKeyCatalyst.forecastStr || '--'}
              </span>
            </div>
            <div className="p-2 sm:p-2.5 rounded-xl bg-black/60 border border-white/10">
              <span className="text-[9px] text-neutral-500 block uppercase">PREVIOUS</span>
              <span className="text-xs sm:text-sm font-bold text-neutral-300 font-mono">
                {nextKeyCatalyst.previousStr || '--'}
              </span>
            </div>
            <div className="p-2 sm:p-2.5 rounded-xl bg-black/60 border border-white/10">
              <span className="text-[9px] text-neutral-500 block uppercase">ACTUAL</span>
              <span className="text-xs sm:text-sm font-bold text-[#FFD97A] font-mono">
                {nextKeyCatalyst.actualStr || '--'}
              </span>
            </div>
          </div>

          {/* PRE-NEWS DECISION LOCK BOX */}
          {nextKeyCatalyst.decision && (
            <div className="p-3 rounded-xl bg-black/60 border border-[#E8B84A]/30 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-[#FFD97A] flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#E8B84A] animate-pulse" />
                  PRE-NEWS DECISION: {nextKeyCatalyst.decision.final} · {nextKeyCatalyst.decision.label}
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                    nextKeyCatalyst.decision.isLocked
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                      : 'bg-neutral-800 border-neutral-700 text-neutral-400'
                  }`}
                >
                  {nextKeyCatalyst.decision.isLocked
                    ? `LOCKED (${formatEventTimes(nextKeyCatalyst.decision.lockedAt)})`
                    : 'PREVIEW (Locks at T-60m)'}
                </span>
              </div>

              <div className="text-[11px] text-neutral-300 flex flex-wrap items-center justify-between gap-1 pt-1 border-t border-white/5">
                <span>
                  System: <strong className="text-white">{nextKeyCatalyst.decision.systemVote}</strong> · AHMED AI:{' '}
                  <strong className="text-white">
                    {nextKeyCatalyst.decision.aiVote}
                    {nextKeyCatalyst.decision.aiVote !== 'UNAVAILABLE'
                      ? ` (${nextKeyCatalyst.decision.aiConfidence}%)`
                      : ''}
                  </strong>
                </span>
                {nextKeyCatalyst.decision.resultStatus && nextKeyCatalyst.decision.resultStatus !== 'PENDING' && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      nextKeyCatalyst.decision.resultStatus === 'HIT'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : nextKeyCatalyst.decision.resultStatus === 'MISS'
                        ? 'bg-rose-500/20 text-rose-300'
                        : 'bg-neutral-800 text-neutral-400'
                    }`}
                  >
                    RESULT: {nextKeyCatalyst.decision.resultStatus}
                    {nextKeyCatalyst.decision.goldMove15m !== undefined
                      ? ` (${nextKeyCatalyst.decision.goldMove15m > 0 ? '+' : ''}${nextKeyCatalyst.decision.goldMove15m} 15m)`
                      : ''}
                  </span>
                )}
              </div>

              {nextKeyCatalyst.decision.aiReason && (
                <p className="text-[10px] text-neutral-400 italic">
                  "{nextKeyCatalyst.decision.aiReason}"
                </p>
              )}
            </div>
          )}

          {/* Short Playbook with Scenarios and AHMED AI Brief */}
          {renderBriefPlaybookCard(nextKeyCatalyst)}
        </div>
      )}

      {/* 3. TIMELINE: GROUPED BY DAY */}
      <div className="space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#FFD97A]" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              ECONOMIC TIMELINE
            </h3>
          </div>
          <button
            onClick={() => {
              setIsLoading(true);
              fetchNews().finally(() => setIsLoading(false));
            }}
            disabled={isLoading}
            className="p-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-neutral-300 hover:text-white transition-colors cursor-pointer"
            title="Refresh News Feed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Accuracy line */}
        {decisionAccuracy && (
          <div className="px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/10 flex items-center justify-between text-[11px] text-neutral-300">
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#FFD97A]" />
              <span className="font-semibold text-white">{decisionAccuracy.display}</span>
            </span>
            <span className="text-[10px] text-neutral-500 font-mono">30-day verified results</span>
          </div>
        )}

        {timelineGroups.map((group) => {
          const isSpeechesExpanded = !!expandedSpeechesDays[group.dayKey];

          return (
            <div key={group.dayKey} className="space-y-2">
              {/* Day Header Badge */}
              <div className="flex items-center gap-2 pt-2">
                <span className="text-[11px] font-bold text-[#FFD97A] uppercase tracking-wider">
                  {group.dayLabel}
                </span>
                <div className="flex-1 h-[1px] bg-white/10" />
              </div>

              {/* Standard Tier 1, Tier 2, and Non-Speech Tier 3 events */}
              <div className="space-y-2">
                {group.standardEvents.map((evt) => {
                  const isExpanded = expandedEventId === evt.id;

                  return (
                    <div
                      key={evt.id}
                      id={`news-event-${evt.id}`}
                      className="rounded-xl border border-white/10 bg-black/40 hover:bg-black/60 transition-colors overflow-hidden"
                    >
                      {/* Clickable Header Row: 2-LINE MOBILE-OPTIMIZED LAYOUT (360-430px) */}
                      <div
                        onClick={() => toggleEventExpand(evt)}
                        className="p-3 sm:p-3.5 flex flex-col gap-1.5 cursor-pointer select-none"
                      >
                        {/* LINE 1: [tier badge] [event title, full, wraps to 2 lines max, flex:1, min-width:0] [countdown "in 1d 19h" right aligned, no-wrap] [chevron] */}
                        <div className="flex items-start justify-between gap-2 w-full">
                          <div className="flex items-start gap-2 flex-1 min-w-0" style={{ minWidth: '50%' }}>
                            {renderTierBadge(evt.ahmedTier || 3)}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline gap-1.5 flex-wrap">
                                <span className="text-[10px] text-neutral-400 font-mono shrink-0">
                                  {new Date(evt.timeUtc).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    hour12: false,
                                  })}
                                </span>
                                <h4 className="text-xs sm:text-sm font-bold text-white leading-snug line-clamp-2 break-words">
                                  {evt.title}
                                </h4>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 whitespace-nowrap pl-1 pt-0.5">
                            <span className="text-[11px] font-bold text-neutral-300 font-mono">
                              {formatCountdown(evt.minutesUntil)}
                            </span>
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-neutral-400 shrink-0" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-neutral-400 shrink-0" />
                            )}
                          </div>
                        </div>

                        {/* LINE 2: small muted row "F: x · P: y · A: z" in ONE line (inline, separated by dots; "--" when empty), and the lean chip below or beside it (wrap allowed) */}
                        <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5 w-full">
                          <span className="text-[10px] text-neutral-400 font-mono whitespace-nowrap">
                            F: {evt.forecastStr?.trim() || '--'} · P: {evt.previousStr?.trim() || '--'} · A: {evt.actualStr?.trim() || '--'}
                          </span>

                          <div className="shrink-0">
                            {renderLeanOrResultChip(evt)}
                          </div>
                        </div>
                      </div>

                      {/* Expanded Section with Short Playbook */}
                      {isExpanded && (
                        <div className="p-3 sm:p-3.5 pt-0 border-t border-white/5 space-y-3">
                          {renderBriefPlaybookCard(evt)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Tier 3 Speeches Collapsible Section */}
              {group.speechEvents.length > 0 && (
                <div className="pt-1">
                  <button
                    onClick={() => toggleDaySpeeches(group.dayKey)}
                    className="w-full py-2 px-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-between text-[11px] text-neutral-400 hover:text-white transition-colors cursor-pointer"
                  >
                    <span>Speeches ({group.speechEvents.length})</span>
                    {isSpeechesExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>

                  {isSpeechesExpanded && (
                    <div className="mt-2 space-y-1.5 pl-2 border-l border-white/10">
                      {group.speechEvents.map((sp) => {
                        const isExpanded = expandedEventId === sp.id;
                        return (
                          <div
                            key={sp.id}
                            id={`news-event-${sp.id}`}
                            className="rounded-lg border border-white/5 bg-black/30 p-2.5 text-xs text-neutral-300"
                          >
                            <div
                              onClick={() => toggleEventExpand(sp)}
                              className="flex flex-col gap-1.5 cursor-pointer"
                            >
                              {/* Line 1: Badge + Time + Title + Countdown + Chevron */}
                              <div className="flex items-start justify-between gap-2 w-full">
                                <div className="flex items-start gap-2 flex-1 min-w-0" style={{ minWidth: '50%' }}>
                                  {renderTierBadge(3)}
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-baseline gap-1.5 flex-wrap">
                                      <span className="text-[10px] text-neutral-400 font-mono shrink-0">
                                        {new Date(sp.timeUtc).toLocaleTimeString([], {
                                          hour: '2-digit',
                                          minute: '2-digit',
                                          hour12: false,
                                        })}
                                      </span>
                                      <span className="font-semibold text-white leading-snug line-clamp-2 break-words text-xs">
                                        {sp.title}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0 whitespace-nowrap pl-1 pt-0.5">
                                  <span className="text-[10px] text-neutral-400 font-mono">
                                    {formatCountdown(sp.minutesUntil)}
                                  </span>
                                  {isExpanded ? (
                                    <ChevronUp className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                                  ) : (
                                    <ChevronDown className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                                  )}
                                </div>
                              </div>

                              {/* Line 2: Tone note + Lean Chip */}
                              <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5 w-full">
                                <span className="text-[10px] text-neutral-500 whitespace-nowrap">
                                  Tone-dependent, low reliability
                                </span>
                                <div className="shrink-0">
                                  {renderLeanOrResultChip(sp)}
                                </div>
                              </div>
                            </div>

                            {isExpanded && renderBriefPlaybookCard(sp)}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 4. FOOTER NOTE */}
      <div className="p-3 rounded-xl bg-black/40 border border-white/5 text-center text-[10px] text-neutral-500">
        Gold reaction is not guaranteed. Directional probability based on real rates correlation.
      </div>
    </div>
  );
});
