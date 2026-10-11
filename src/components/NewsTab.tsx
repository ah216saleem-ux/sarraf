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
  Info,
  Calendar,
  AlertTriangle,
  Zap,
} from 'lucide-react';

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

interface NewsEventItem {
  id: string;
  title: string;
  country: string;
  impact: 'High' | 'Medium' | 'Low' | 'Holiday';
  tier: 'TIER_1' | 'TIER_2' | 'NONE';
  ahmedTier: 1 | 2 | 3;
  isSpeech: boolean;
  scenarios: GoldScenario;
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

export const NewsTab: React.FC<NewsTabProps> = ({ currentPrice }) => {
  const [feedStatus, setFeedStatus] = useState<any>(null);
  const [events, setEvents] = useState<NewsEventItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  // Lazy Brief Fetching Cache in React state
  const [briefs, setBriefs] = useState<Record<string, BriefData>>({});
  const [loadingBriefId, setLoadingBriefId] = useState<string | null>(null);

  // Collapsed speeches state (by day string key)
  const [expandedSpeechesDays, setExpandedSpeechesDays] = useState<Record<string, boolean>>({});

  // Admin Actual Entry State
  const [editingActualId, setEditingActualId] = useState<string | null>(null);
  const [manualActualInput, setManualActualInput] = useState('');
  const [isSavingActual, setIsSavingActual] = useState(false);
  const [isLookingUpAi, setIsLookingUpAi] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const fetchNews = useCallback(async () => {
    try {
      const res = await fetch('/api/news');
      if (res.ok) {
        const json = await res.json();
        setFeedStatus(json.feed);
        setEvents(json.events || []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchNews();
    const timer = setInterval(fetchNews, 6000);
    return () => clearInterval(timer);
  }, [fetchNews]);

  // Request or lazily generate AHMED AI brief
  const fetchBriefForEvent = useCallback(
    async (eventId: string) => {
      if (briefs[eventId] || loadingBriefId === eventId) return;
      setLoadingBriefId(eventId);
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
        // fallback handled gracefully
      } finally {
        setLoadingBriefId((curr) => (curr === eventId ? null : curr));
      }
    },
    [briefs, loadingBriefId]
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
        setActionNotice(`Manual actual value recorded for ${eventId}.`);
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
      return `${hrs}h ${pastMins % 60}m ago`;
    }
    if (mins === 0) return 'DUE NOW';
    if (mins < 60) return `in ${mins}m`;
    const hrs = Math.floor(mins / 60);
    return `in ${hrs}h ${mins % 60}m`;
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
        sentence: `Heavy institutional volatility expected with ${tier1Count} Tier 1 release${tier1Count > 1 ? 's' : ''} scheduled within 24 hours.`,
      };
    }
    if (tier1Count === 1 || tier2Count >= 2) {
      return {
        level: 'MEDIUM',
        color: 'text-amber-400',
        bg: 'bg-amber-950/40 border-amber-500/40',
        badge: 'bg-amber-500/20 text-amber-300 border-amber-500/50',
        sentence: `Moderate macro catalyst exposure ahead (${tier1Count > 0 ? `${tier1Count} Tier 1, ` : ''}${tier2Count} Tier 2). Expect localized spikes around releases.`,
      };
    }
    return {
      level: 'LOW',
      color: 'text-emerald-400',
      bg: 'bg-emerald-950/30 border-emerald-500/30',
      badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50',
      sentence: 'No major tier-one catalysts due in the next 24 hours. Price action driven primarily by technical order flow.',
    };
  }, [events]);

  // 2. Compute NEXT KEY CATALYST: next tier 1 or 2 event (not a speech unless nothing else exists)
  const nextKeyCatalyst = useMemo(() => {
    const upcoming = events.filter((e) => e.minutesUntil > -90 && !e.isCancelledOrRemoved);
    // Prefer non-speech Tier 1 or Tier 2
    const nonSpeechTier1or2 = upcoming
      .filter((e) => (e.ahmedTier === 1 || e.ahmedTier === 2) && !e.isSpeech)
      .sort((a, b) => a.minutesUntil - b.minutesUntil);

    if (nonSpeechTier1or2.length > 0) return nonSpeechTier1or2[0];

    // Fallback to any upcoming Tier 1 or 2
    const anyTier1or2 = upcoming
      .filter((e) => e.ahmedTier === 1 || e.ahmedTier === 2)
      .sort((a, b) => a.minutesUntil - b.minutesUntil);

    if (anyTier1or2.length > 0) return anyTier1or2[0];

    // Fallback to nextEvent from feed
    return feedStatus?.nextEvent || null;
  }, [events, feedStatus?.nextEvent]);

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
      // Speeches in Tier 3 collapsed
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

  const toggleDaySpeeches = (dayKey: string) => {
    setExpandedSpeechesDays((prev) => ({
      ...prev,
      [dayKey]: !prev[dayKey],
    }));
  };

  // Render Brief Section
  const renderBriefCard = (evt: NewsEventItem) => {
    const brief = briefs[evt.id] || evt.brief;
    const isBriefLoading = loadingBriefId === evt.id;

    return (
      <div className="mt-3 p-3.5 sm:p-4 rounded-xl bg-black/60 border border-white/10 space-y-3 font-mono">
        {/* Brief Header with AHMED AI or RULES Tag */}
        <div className="flex items-center justify-between border-b border-white/10 pb-2">
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

          {isBriefLoading && (
            <div className="flex items-center gap-1.5 text-[9px] text-[#FFD97A]">
              <Sparkles className="w-3 h-3 animate-spin" />
              <span>Generating brief...</span>
            </div>
          )}
        </div>

        {/* 3-line AHMED AI brief content */}
        <div className="space-y-2 text-xs">
          {brief ? (
            <>
              <div>
                <span className="text-[10px] text-neutral-400 uppercase font-bold block">
                  HEADLINE
                </span>
                <span className="text-white font-semibold">{brief.headline}</span>
              </div>
              <div>
                <span className="text-[10px] text-neutral-400 uppercase font-bold block">
                  WHAT IT IS
                </span>
                <span className="text-neutral-300">{brief.what_it_is}</span>
              </div>
              <div>
                <span className="text-[10px] text-neutral-400 uppercase font-bold block">
                  WHY GOLD CARES
                </span>
                <span className="text-neutral-300">{brief.why_gold_cares}</span>
              </div>
              <div>
                <span className="text-[10px] text-neutral-400 uppercase font-bold block">
                  WATCH FOR
                </span>
                <span className="text-[#FFD97A]">{brief.watch_for}</span>
              </div>
            </>
          ) : (
            <div className="py-2 text-neutral-400 text-xs italic flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-[#FFD97A] animate-pulse" />
              <span>Preparing institutional gold brief...</span>
            </div>
          )}
        </div>

        {/* Admin Actual Entry Component */}
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

        {/* Footer line */}
        <div className="pt-2 border-t border-white/5 text-[9px] text-neutral-500 flex items-center justify-between">
          <span>AHMED AI explains the news. It does not place or change signals.</span>
          <span>Lock: -30m / +15m</span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4 sm:space-y-6 font-mono select-none">
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

          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${riskAssessment.badge}`}>
              ● {riskAssessment.level} RISK
            </span>
          </div>
        </div>

        <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <p className="text-xs sm:text-sm text-neutral-200">
            {riskAssessment.sentence}
          </p>
          <div className="flex items-center gap-2 text-[10px] text-neutral-400 shrink-0">
            <Radio className="w-3 h-3 text-[#FFD97A]" />
            <span>Forex Factory USD Feed</span>
          </div>
        </div>
      </div>

      {/* 2. NEXT KEY CATALYST CARD */}
      {nextKeyCatalyst && (
        <div className="p-4 sm:p-5 rounded-2xl border border-[#E8B84A]/40 bg-gradient-to-r from-black/85 via-[#E8B84A]/5 to-black/85 shadow-[0_0_20px_rgba(232,184,74,0.12)] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-[#E8B84A]/20 border border-[#E8B84A]/40 text-[#FFD97A] text-[10px] font-bold">
                NEXT KEY CATALYST
              </span>
              <span className="text-[10px] text-neutral-400">
                TIER {nextKeyCatalyst.ahmedTier || 1} • {nextKeyCatalyst.country}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-[#FFD97A]" />
              <span className="text-base sm:text-lg font-bold text-[#FFD97A]">
                {formatCountdown(nextKeyCatalyst.minutesUntil)}
              </span>
            </div>
          </div>

          {/* Event Title & Metadata */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white tracking-wide">
                {nextKeyCatalyst.title}
              </h3>
              <p className="text-[11px] text-neutral-400 mt-0.5">
                Release: <span className="text-white">{new Date(nextKeyCatalyst.timeUtc).toUTCString()}</span>
              </p>
            </div>

            {/* Lock chip: Signals paused: -30m to +15m */}
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[10px] font-bold text-amber-300">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              <span>Signals paused: -30m to +15m</span>
            </div>
          </div>

          {/* Forecast / Previous / Actual Grid */}
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="p-2 sm:p-2.5 rounded-xl bg-black/60 border border-white/10">
              <span className="text-[9px] text-neutral-500 block uppercase">FORECAST</span>
              <span className="text-xs sm:text-sm font-bold text-white">
                {nextKeyCatalyst.forecastStr || 'No Forecast'}
              </span>
            </div>
            <div className="p-2 sm:p-2.5 rounded-xl bg-black/60 border border-white/10">
              <span className="text-[9px] text-neutral-500 block uppercase">PREVIOUS</span>
              <span className="text-xs sm:text-sm font-bold text-neutral-300">
                {nextKeyCatalyst.previousStr || '-'}
              </span>
            </div>
            <div className="p-2 sm:p-2.5 rounded-xl bg-black/60 border border-white/10">
              <span className="text-[9px] text-neutral-500 block uppercase">ACTUAL</span>
              <span className="text-xs sm:text-sm font-bold text-[#FFD97A]">
                {nextKeyCatalyst.actualStr || 'Pending'}
              </span>
            </div>
          </div>

          {/* Coloured Scenario Chips or Surprise Result Chip */}
          <div className="space-y-1.5">
            {nextKeyCatalyst.scenarios?.surpriseChip ? (
              <div className="p-2.5 rounded-xl bg-black/60 border border-white/15 flex items-center justify-between">
                <span className="text-xs font-bold text-neutral-300">RELEASE SURPRISE:</span>
                <span
                  className={`px-2.5 py-0.5 rounded text-xs font-bold border ${
                    nextKeyCatalyst.scenarios.surpriseChip.sentiment === 'BULLISH'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                      : nextKeyCatalyst.scenarios.surpriseChip.sentiment === 'BEARISH'
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/50'
                      : 'bg-neutral-800 text-neutral-300 border-neutral-600'
                  }`}
                >
                  {nextKeyCatalyst.scenarios.surpriseChip.sentiment} (
                  {nextKeyCatalyst.scenarios.surpriseChip.size} • Δ
                  {nextKeyCatalyst.scenarios.surpriseChip.diffPct}%)
                </span>
              </div>
            ) : nextKeyCatalyst.scenarios?.type === 'NO_FORECAST' ? (
              <div className="p-2 rounded-xl bg-neutral-900/60 border border-neutral-800 text-center text-xs text-neutral-400">
                Forecast not available yet
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                <div className="p-2 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300 flex items-center gap-2">
                  <TrendingDown className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span>{nextKeyCatalyst.scenarios.higher}</span>
                </div>
                <div className="p-2 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>{nextKeyCatalyst.scenarios.lower}</span>
                </div>
              </div>
            )}
          </div>

          {/* 3-Line AHMED AI Brief Card */}
          {renderBriefCard(nextKeyCatalyst)}
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
                  const tierBadge =
                    evt.ahmedTier === 1
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                      : evt.ahmedTier === 2
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-neutral-800 text-neutral-400 border-neutral-700';

                  return (
                    <div
                      key={evt.id}
                      className="rounded-xl border border-white/10 bg-black/40 hover:bg-black/60 transition-colors overflow-hidden"
                    >
                      {/* Clickable Header Row */}
                      <div
                        onClick={() => toggleEventExpand(evt)}
                        className="p-3 sm:p-3.5 flex flex-wrap items-center justify-between gap-2 cursor-pointer select-none"
                      >
                        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                          {/* Tier Badge */}
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold border shrink-0 ${tierBadge}`}
                          >
                            T{evt.ahmedTier || 3}
                          </span>

                          <div className="min-w-0">
                            <span className="text-xs sm:text-sm font-bold text-white block truncate">
                              {evt.title}
                            </span>
                            <span className="text-[10px] text-neutral-400">
                              {new Date(evt.timeUtc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • F: {evt.forecastStr || '--'} | P: {evt.previousStr || '--'} | A: {evt.actualStr || '--'}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5 shrink-0">
                          <span className="text-[11px] font-bold text-neutral-300">
                            {formatCountdown(evt.minutesUntil)}
                          </span>
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-neutral-400" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-neutral-400" />
                          )}
                        </div>
                      </div>

                      {/* Expanded Section with Scenarios and Brief */}
                      {isExpanded && (
                        <div className="p-3 sm:p-3.5 pt-0 border-t border-white/5 space-y-3">
                          {/* Scenarios */}
                          {evt.scenarios?.surpriseChip ? (
                            <div className="p-2 rounded-lg bg-black/60 border border-white/10 flex items-center justify-between text-xs">
                              <span className="text-neutral-400 font-bold">OUTCOME:</span>
                              <span
                                className={`px-2 py-0.5 rounded font-bold border ${
                                  evt.scenarios.surpriseChip.sentiment === 'BULLISH'
                                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                                    : evt.scenarios.surpriseChip.sentiment === 'BEARISH'
                                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/50'
                                    : 'bg-neutral-800 text-neutral-300 border-neutral-600'
                                }`}
                              >
                                {evt.scenarios.surpriseChip.sentiment} (Δ
                                {evt.scenarios.surpriseChip.diffPct}%)
                              </span>
                            </div>
                          ) : evt.scenarios?.type === 'NO_FORECAST' ? (
                            <div className="p-2 rounded-lg bg-neutral-900/60 border border-neutral-800 text-center text-[11px] text-neutral-400">
                              Forecast not available yet
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                              <div className="p-2 rounded-lg bg-rose-950/30 border border-rose-500/30 text-rose-300">
                                {evt.scenarios.higher}
                              </div>
                              <div className="p-2 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-emerald-300">
                                {evt.scenarios.lower}
                              </div>
                            </div>
                          )}

                          {/* AHMED AI Brief Card */}
                          {renderBriefCard(evt)}
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
                            className="rounded-lg border border-white/5 bg-black/30 p-2.5 text-xs text-neutral-300"
                          >
                            <div
                              onClick={() => toggleEventExpand(sp)}
                              className="flex items-center justify-between cursor-pointer"
                            >
                              <div>
                                <span className="font-semibold text-white block">
                                  {sp.title}
                                </span>
                                <span className="text-[10px] text-neutral-500">
                                  {new Date(sp.timeUtc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • Tone-dependent, low reliability
                                </span>
                              </div>
                              <span className="text-[10px] text-neutral-400">
                                {formatCountdown(sp.minutesUntil)}
                              </span>
                            </div>

                            {isExpanded && renderBriefCard(sp)}
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
};
