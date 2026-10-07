import React, { useState, useEffect, useCallback } from 'react';
import {
  Radio,
  Clock,
  Flame,
  AlertTriangle,
  Sparkles,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  Edit3,
  CheckCircle2,
  HelpCircle,
  ShieldAlert,
  Info,
} from 'lucide-react';

interface NewsTabProps {
  currentPrice: number | null;
}

export const NewsTab: React.FC<NewsTabProps> = ({ currentPrice }) => {
  const [feedStatus, setFeedStatus] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [showMediumImpact, setShowMediumImpact] = useState(false);

  // Manual Actual Entry State
  const [editingActualId, setEditingActualId] = useState<string | null>(null);
  const [manualActualInput, setManualActualInput] = useState('');
  const [isSavingActual, setIsSavingActual] = useState(false);
  const [isLookingUpGemini, setIsLookingUpGemini] = useState(false);
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
    const timer = setInterval(fetchNews, 4000);
    return () => clearInterval(timer);
  }, [fetchNews]);

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

  const handleGeminiLookup = async (eventId: string) => {
    setIsLookingUpGemini(true);
    try {
      const res = await fetch('/api/news/lookup-actual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }),
      });
      if (res.ok) {
        const json = await res.json();
        setManualActualInput(json.lookup.actual || '');
        setActionNotice(`Gemini retrieved: ${json.lookup.actual} (Marked UNVERIFIED until confirmed)`);
      }
    } finally {
      setIsLookingUpGemini(false);
    }
  };

  const nextEvent = feedStatus?.nextEvent;
  const highImpactUsd = events.filter((e) => e.isHighImpactUsd);
  const mediumImpactEvents = events.filter((e) => e.impact === 'Medium' && !e.isHighImpactUsd);

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

  return (
    <div className="space-y-6">
      {/* Top Action Notification */}
      {actionNotice && (
        <div className="bg-[#E8B84A]/10 border border-[#E8B84A]/30 rounded-xl p-3 flex items-center justify-between font-mono text-xs text-[#FFD97A]">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#E8B84A]" />
            <span>{actionNotice}</span>
          </div>
          <button onClick={() => setActionNotice(null)} className="text-neutral-400 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* Header Feed Banner */}
      <div className="glass-panel p-5 sm:p-6 rounded-2xl border border-[#E8B84A]/25 relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-[#E8B84A]/10 border border-[#E8B84A]/30 text-[#FFD97A]">
                <Radio className="w-5 h-5 animate-pulse" />
              </span>
              <div>
                <h2 className="font-mono text-base font-bold text-white tracking-wide flex items-center gap-2">
                  FOREX FACTORY REAL-TIME USD RADAR
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-mono border ${
                      feedStatus?.status === 'LIVE'
                        ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-400'
                        : feedStatus?.status === 'STALE'
                        ? 'bg-amber-950/60 border-amber-500/50 text-amber-300'
                        : 'bg-rose-950/60 border-rose-500/50 text-rose-400'
                    }`}
                  >
                    ● {feedStatus?.status || 'INITIALIZING'}
                  </span>
                </h2>
                <p className="text-xs text-neutral-400 font-mono">
                  Live institutional macro calendar with automated pre/post news locks & Gold impact classification.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 font-mono text-xs">
            <div className="text-right">
              <span className="text-[10px] text-neutral-500 block uppercase">LAST FEED SYNC</span>
              <span className="text-white font-bold">
                {feedStatus?.lastSuccessfulFetchAt
                  ? new Date(feedStatus.lastSuccessfulFetchAt).toLocaleTimeString()
                  : 'Pending'}
              </span>
            </div>
            <button
              onClick={() => {
                setIsLoading(true);
                fetchNews().finally(() => setIsLoading(false));
              }}
              disabled={isLoading}
              className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-neutral-300 hover:text-white transition-colors cursor-pointer"
              title="Refresh News Feed"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* News Lock Active Banner */}
        {feedStatus?.isLockActive && (
          <div className="mt-4 p-3 rounded-xl bg-amber-950/50 border border-amber-700/60 flex items-center gap-3 font-mono text-xs text-amber-300">
            <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <strong>NEWS LOCK ACTIVE: </strong>
              <span>
                "{feedStatus.activeLockEvent?.title}" ({formatCountdown(feedStatus.activeLockEvent?.minutesUntil ?? 0)}). New signal entries are locked to prevent spread slippage. Active trades remain protected.
              </span>
            </div>
          </div>
        )}
      </div>

      {/* NEXT EVENT HERO CARD */}
      {nextEvent ? (
        <div className="glass-panel p-5 sm:p-6 rounded-2xl border border-[#E8B84A]/40 bg-gradient-to-r from-black/80 via-[#E8B84A]/5 to-black/80 shadow-[0_0_20px_rgba(232,184,74,0.15)] relative overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-[#E8B84A]/20 border border-[#E8B84A]/40 text-[#FFD97A] font-mono text-xs font-bold">
                NEXT KEY CATALYST
              </span>
              <span className="text-xs font-mono text-neutral-400">
                {nextEvent.country} • {nextEvent.impact.toUpperCase()} IMPACT
              </span>
            </div>

            <div className="flex items-center gap-2 font-mono">
              <Clock className="w-4 h-4 text-[#FFD97A]" />
              <span className="text-lg font-bold text-[#FFD97A] tracking-wider">
                {formatCountdown(nextEvent.minutesUntil)}
              </span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center font-mono">
            <div className="lg:col-span-6 space-y-1">
              <h3 className="text-lg sm:text-xl font-bold text-white tracking-wide">
                {nextEvent.title}
              </h3>
              <p className="text-xs text-neutral-400">
                Release Time: <strong className="text-white">{new Date(nextEvent.timeUtc).toUTCString()}</strong>
              </p>
            </div>

            <div className="lg:col-span-6 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="p-3 rounded-xl bg-black/50 border border-white/10">
                <span className="text-[10px] text-neutral-500 block uppercase">FORECAST</span>
                <span className="text-sm font-bold text-white">
                  {nextEvent.forecastStr || 'No Forecast'}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-black/50 border border-white/10">
                <span className="text-[10px] text-neutral-500 block uppercase">PREVIOUS</span>
                <span className="text-sm font-bold text-neutral-300">
                  {nextEvent.previousStr || '-'}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-black/50 border border-white/10">
                <span className="text-[10px] text-neutral-500 block uppercase">GOLD BIAS</span>
                <span
                  className={`text-xs font-bold block ${
                    nextEvent.goldImpact === 'BULLISH'
                      ? 'text-emerald-400'
                      : nextEvent.goldImpact === 'BEARISH'
                      ? 'text-rose-400'
                      : 'text-[#FFD97A]'
                  }`}
                >
                  {nextEvent.goldImpact}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[11px] font-mono text-neutral-400">
            <div className="flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-[#E8B84A]" />
              <span>Gold reaction is not guaranteed. Directional probability based on real rates correlation.</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="glass-panel p-6 rounded-2xl border border-white/10 text-center font-mono text-xs text-neutral-400">
          No upcoming USD high-impact events scheduled for the rest of this session.
        </div>
      )}

      {/* 3D FLOATING GLASS TIMELINE */}
      <div className="glass-panel p-5 sm:p-6 rounded-2xl border border-white/10 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-[#FFD97A]" />
            <h3 className="font-mono text-sm font-bold text-white tracking-wider">
              HIGH-IMPACT USD TIMELINE ({highImpactUsd.length} EVENTS)
            </h3>
          </div>
          <span className="text-[11px] font-mono text-neutral-400">
            Forex Factory Live Feed
          </span>
        </div>

        <div className="space-y-3">
          {highImpactUsd.map((evt) => {
            const isExpanded = expandedEventId === evt.id;
            const isPast = evt.minutesUntil < 0;
            const isBullish = evt.goldImpact === 'BULLISH';
            const isBearish = evt.goldImpact === 'BEARISH';

            return (
              <div
                key={evt.id}
                className={`p-4 rounded-xl border transition-all font-mono ${
                  evt.isInsideLockWindow
                    ? 'bg-amber-950/20 border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                    : isBullish
                    ? 'bg-emerald-950/15 border-emerald-800/40'
                    : isBearish
                    ? 'bg-rose-950/15 border-rose-800/40'
                    : 'bg-black/40 border-white/10 hover:border-white/20'
                }`}
              >
                <div
                  onClick={() => setExpandedEventId(isExpanded ? null : evt.id)}
                  className="flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none"
                >
                  <div className="flex items-center gap-3">
                    {/* Glowing Node Indicator */}
                    <div
                      className={`w-3.5 h-3.5 rounded-full ${
                        evt.isInsideLockWindow
                          ? 'bg-amber-400 shadow-[0_0_10px_#f59e0b] animate-ping'
                          : isBullish
                          ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                          : isBearish
                          ? 'bg-rose-400 shadow-[0_0_8px_#f43f5e]'
                          : 'bg-[#E8B84A] shadow-[0_0_8px_#E8B84A]'
                      }`}
                    />

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">{evt.title}</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/5 text-neutral-400 border border-white/10">
                          {evt.country}
                        </span>
                        {evt.isInsideLockWindow && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-950 border border-amber-700/60 text-amber-300 font-bold">
                            LOCK ACTIVE
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-neutral-400">
                        {new Date(evt.timeUtc).toUTCString()} ({formatCountdown(evt.minutesUntil)})
                      </span>
                    </div>
                  </div>

                  {/* Right Metric Highlights */}
                  <div className="flex items-center gap-4 text-xs">
                    <div className="hidden sm:block text-right">
                      <span className="text-[10px] text-neutral-500 block">FCAST / PREV</span>
                      <span className="text-neutral-300">
                        {evt.forecastStr || '-'} / {evt.previousStr || '-'}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] text-neutral-500 block">GOLD IMPACT</span>
                      <span
                        className={`font-bold ${
                          isBullish
                            ? 'text-emerald-400'
                            : isBearish
                            ? 'text-rose-400'
                            : 'text-[#FFD97A]'
                        }`}
                      >
                        {evt.goldImpact}
                      </span>
                    </div>

                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-neutral-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-neutral-400" />
                    )}
                  </div>
                </div>

                {/* Expanded Card Details */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-white/10 space-y-4 text-xs">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-black/60 p-3 rounded-xl border border-white/5">
                      <div>
                        <span className="text-neutral-500 block text-[10px]">EVENT ID</span>
                        <span className="text-white font-mono">{evt.id}</span>
                      </div>
                      <div>
                        <span className="text-neutral-500 block text-[10px]">REPORTED ACTUAL</span>
                        <span className="text-[#FFD97A] font-bold">
                          {evt.actualStr ? `${evt.actualStr} (${evt.actualSource})` : 'Not yet entered'}
                        </span>
                      </div>
                      <div>
                        <span className="text-neutral-500 block text-[10px]">GOLD DIRECTION</span>
                        <span className="text-white font-medium">
                          {isBullish ? '🟢 Bullish for XAU/USD' : isBearish ? '🔴 Bearish for XAU/USD' : '⚪ Neutral / Pending'}
                        </span>
                      </div>
                      <div>
                        <span className="text-neutral-500 block text-[10px]">LOCK WINDOW</span>
                        <span className="text-white">-30m to +15m</span>
                      </div>
                    </div>

                    {/* Manual Actual Input Portal */}
                    <div className="p-3 rounded-xl bg-white/5 border border-white/10 space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-neutral-300">
                        <span className="font-bold text-white flex items-center gap-1.5">
                          <Edit3 className="w-3.5 h-3.5 text-[#FFD97A]" />
                          <span>Admin Actual Value Entry:</span>
                        </span>
                        <button
                          onClick={() => handleGeminiLookup(evt.id)}
                          disabled={isLookingUpGemini}
                          className="px-2 py-0.5 bg-[#E8B84A]/10 hover:bg-[#E8B84A]/20 border border-[#E8B84A]/30 text-[#FFD97A] rounded text-[10px] cursor-pointer flex items-center gap-1"
                        >
                          <Sparkles className="w-3 h-3" />
                          <span>Gemini AI Lookup</span>
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
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Collapsible Medium Impact List */}
        <div className="pt-2 border-t border-white/10">
          <button
            onClick={() => setShowMediumImpact(!showMediumImpact)}
            className="w-full py-2.5 bg-black/40 hover:bg-black/60 border border-white/5 rounded-xl font-mono text-xs text-neutral-400 hover:text-white flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <span>{showMediumImpact ? 'Hide' : 'Show'} Medium Impact Events ({mediumImpactEvents.length})</span>
            {showMediumImpact ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showMediumImpact && (
            <div className="mt-3 space-y-2 font-mono text-xs max-h-[300px] overflow-y-auto pr-1">
              {mediumImpactEvents.map((m) => (
                <div
                  key={m.id}
                  className="p-3 rounded-lg bg-black/40 border border-white/5 flex items-center justify-between text-neutral-300"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500/70" />
                    <span>{m.title}</span>
                    <span className="text-[10px] text-neutral-500">{m.country}</span>
                  </div>
                  <span className="text-[11px] text-neutral-400">
                    {formatCountdown(m.minutesUntil)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
