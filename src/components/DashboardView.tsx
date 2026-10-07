import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useMarket } from '../context/MarketContext';
import {
  TrendingUp,
  TrendingDown,
  LogOut,
  Radio,
  ArrowUpRight,
  ArrowDownRight,
  Send,
  Zap,
  Clock,
  Play,
  Pause,
  XCircle,
  FastForward,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  BarChart2,
  MessageSquare,
  Bot,
  Terminal,
  ShieldCheck,
  RotateCcw,
  Sparkles,
  Sliders,
} from 'lucide-react';
import {
  formatNewSignalMessage,
  formatUpdateMessage,
} from '../server/messageTemplates';
import { GoogleChatHub } from './GoogleChatHub';
import { NewsTab } from './NewsTab';
import { SettingsTab } from './SettingsTab';
import { PerformanceTab } from './PerformanceTab';
import { GoLiveChecklistTab } from './GoLiveChecklistTab';

export const DashboardView: React.FC = () => {
  const { priceData, user, logout, macroEvents } = useMarket();
  const [activeMainTab, setActiveMainTab] = useState<
    | 'OVERVIEW'
    | 'TELEGRAM'
    | 'NEWS'
    | 'GOOGLE_CHAT'
    | 'AI_CHAT'
    | 'SETTINGS'
    | 'PERFORMANCE'
    | 'CHECKLIST'
    | 'TESTS'
  >('OVERVIEW');
  const [activeChartTab, setActiveChartTab] = useState<'15M' | '1H' | '4H' | '1D'>('15M');
  const [chartPoints, setChartPoints] = useState<number[]>([]);

  // Signal Manager States
  const [signalState, setSignalState] = useState<any>(null);
  const [signalHistory, setSignalHistory] = useState<any[]>([]);
  const [signalStats, setSignalStats] = useState<any>(null);

  // Telegram & Gemini States
  const [telegramStatus, setTelegramStatus] = useState<any>(null);
  const [validations, setValidations] = useState<any[]>([]);
  const [isDryRunModalOpen, setIsDryRunModalOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Test Reports
  const [phase3TestReport, setPhase3TestReport] = useState<any>(null);
  const [phase4TestReport, setPhase4TestReport] = useState<any>(null);
  const [phase5TestReport, setPhase5TestReport] = useState<any>(null);
  const [phase5bTestReport, setPhase5bTestReport] = useState<any>(null);
  const [isRunningTests, setIsRunningTests] = useState(false);

  // AI Chat States
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'model'; text: string; time: string }>>([
    {
      role: 'model',
      text: 'SARRAF Institutional Intelligence ready. Live XAU/USD telemetry, macro order flow, and liquidity structures are synchronized. How can I assist your desk today?',
      time: new Date().toLocaleTimeString(),
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const [actionLoading, setActionLoading] = useState(false);

  // Poll real-time data
  const fetchAllData = useCallback(async () => {
    try {
      const [curRes, histRes, statsRes, tgRes, valRes] = await Promise.all([
        fetch('/api/signal/current'),
        fetch('/api/signal/history'),
        fetch('/api/signal/stats'),
        fetch('/api/telegram/status'),
        fetch('/api/telegram/validations'),
      ]);

      if (curRes.ok) {
        const curJson = await curRes.json();
        setSignalState(curJson.data);
      }
      if (histRes.ok) {
        const histJson = await histRes.json();
        setSignalHistory(histJson.history || []);
      }
      if (statsRes.ok) {
        const statsJson = await statsRes.json();
        setSignalStats(statsJson.stats);
      }
      if (tgRes.ok) {
        const tgJson = await tgRes.json();
        setTelegramStatus(tgJson.data);
      }
      if (valRes.ok) {
        const valJson = await valRes.json();
        setValidations(valJson.validations || []);
      }
    } catch {
      // Background poll error
    }
  }, []);

  useEffect(() => {
    fetchAllData();
    const interval = setInterval(fetchAllData, 1500);
    return () => clearInterval(interval);
  }, [fetchAllData]);

  // Seed chart points
  useEffect(() => {
    if (priceData.status === 'LIVE' && priceData.price !== null) {
      setChartPoints((prev) => {
        if (prev.length === 0) {
          const current = priceData.price as number;
          return [
            current - 12.4,
            current - 8.2,
            current - 10.5,
            current - 6.1,
            current - 3.4,
            current - 5.0,
            current - 1.6,
            current - 2.8,
            current - 0.5,
            current,
          ];
        }
        return [...prev.slice(-24), priceData.price as number];
      });
    }
  }, [priceData.price, priceData.status]);

  const currentPrice = priceData.price;
  const minPrice = chartPoints.length > 0 ? Math.min(...chartPoints, (currentPrice ?? 4150) - 4) : 4150;
  const maxPrice = chartPoints.length > 0 ? Math.max(...chartPoints, (currentPrice ?? 4180) + 4) : 4180;
  const range = maxPrice - minPrice || 1;

  // Signal Actions
  const handleTogglePause = async () => {
    if (!signalState) return;
    setActionLoading(true);
    const endpoint = signalState.isPaused ? '/api/signal/resume' : '/api/signal/pause';
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      const json = await res.json();
      setActionMessage(json.message);
      await fetchAllData();
    } finally {
      setActionLoading(false);
    }
  };

  const handleManualClose = async () => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/signal/close', { method: 'POST' });
      const json = await res.json();
      setActionMessage(json.message);
      await fetchAllData();
    } finally {
      setActionLoading(false);
    }
  };

  const handleSkipCooldown = async () => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/signal/skip-cooldown', { method: 'POST' });
      const json = await res.json();
      setActionMessage(json.message);
      await fetchAllData();
    } finally {
      setActionLoading(false);
    }
  };

  // Telegram Actions
  const handleSendTestMessage = async () => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/telegram/test-message', { method: 'POST' });
      const json = await res.json();
      setActionMessage(json.message);
      await fetchAllData();
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleDryRun = async (targetDryRun: boolean) => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/telegram/toggle-dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: targetDryRun }),
      });
      const json = await res.json();
      setActionMessage(json.message);
      setIsDryRunModalOpen(false);
      await fetchAllData();
    } finally {
      setActionLoading(false);
    }
  };

  const handleRetryEvent = async (eventId: string) => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/telegram/retry-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }),
      });
      const json = await res.json();
      setActionMessage(json.message);
      await fetchAllData();
    } finally {
      setActionLoading(false);
    }
  };

  // Run Test Suites
  const handleRunAllTests = async () => {
    setIsRunningTests(true);
    try {
      const [p3Res, p4Res, p5Res, p5bRes] = await Promise.all([
        fetch('/api/signal/tests'),
        fetch('/api/phase4/tests'),
        fetch('/api/phase5/tests'),
        fetch('/api/phase5b/tests'),
      ]);
      if (p3Res.ok) {
        const p3Json = await p3Res.json();
        setPhase3TestReport(p3Json.report);
      }
      if (p4Res.ok) {
        const p4Json = await p4Res.json();
        setPhase4TestReport(p4Json.report);
      }
      if (p5Res.ok) {
        const p5Json = await p5Res.json();
        setPhase5TestReport(p5Json.report);
      }
      if (p5bRes.ok) {
        const p5bJson = await p5bRes.json();
        setPhase5bTestReport(p5bJson.report);
      }
    } finally {
      setIsRunningTests(false);
    }
  };

  // AI Chat Submit
  const handleSendChatMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;

    const userPrompt = chatInput.trim();
    setChatInput('');
    const newHistory = [...chatMessages, { role: 'user' as const, text: userPrompt, time: new Date().toLocaleTimeString() }];
    setChatMessages(newHistory);
    setIsChatLoading(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: userPrompt,
          history: newHistory.map((h) => ({ role: h.role, text: h.text })),
        }),
      });

      if (res.ok) {
        const json = await res.json();
        setChatMessages((prev) => [
          ...prev,
          {
            role: 'model',
            text: json.reply,
            time: new Date().toLocaleTimeString(),
          },
        ]);
      }
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          role: 'model',
          text: 'Network error communicating with AI Strategist.',
          time: new Date().toLocaleTimeString(),
        },
      ]);
    } finally {
      setIsChatLoading(false);
      setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  };

  const activeSig = signalState?.activeSignal;
  const managerStatus = signalState?.state || 'SCANNING';
  const isDryRun = telegramStatus?.dryRun ?? true;

  // Next Message Live Preview Text
  const previewText = activeSig
    ? activeSig.status === 'ACTIVE'
      ? formatUpdateMessage({ type: 'TP1' })
      : formatNewSignalMessage({
          direction: activeSig.direction,
          entry: activeSig.entry,
          sl: activeSig.sl,
          tp1: activeSig.tp1,
          tp2: activeSig.tp2,
          tp3: activeSig.tp3,
          tp4: activeSig.tp4,
        })
    : formatNewSignalMessage({
        direction: 'BUY',
        entry: currentPrice ? Number((currentPrice - 2.0).toFixed(2)) : 4160.0,
        sl: currentPrice ? Number((currentPrice - 12.0).toFixed(2)) : 4150.0,
        tp1: currentPrice ? Number((currentPrice + 3.0).toFixed(2)) : 4165.0,
        tp2: currentPrice ? Number((currentPrice + 6.0).toFixed(2)) : 4168.0,
        tp3: currentPrice ? Number((currentPrice + 8.0).toFixed(2)) : 4170.0,
        tp4: currentPrice ? Number((currentPrice + 10.0).toFixed(2)) : 4172.0,
      });

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col font-sans selection:bg-[#E8B84A]/30 selection:text-[#FFD97A] overflow-x-hidden">
      {/* Top Terminal Navigation Bar */}
      <header className="sticky top-0 z-30 bg-[#08080a]/95 backdrop-blur-md border-b border-[#E8B84A]/20 px-4 sm:px-6 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-gradient-to-tr from-[#B88628] to-[#FFD97A] rotate-45 shadow-[0_0_12px_#E8B84A]" />
            <span className="font-mono text-base font-bold tracking-[0.2em] text-white">
              SARRAF
            </span>
            <span className="font-mono text-[10px] text-[#FFD97A] px-2 py-0.5 rounded bg-[#E8B84A]/10 border border-[#E8B84A]/25">
              TERMINAL // {user?.terminalId || 'SRF-8891-XAU'}
            </span>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1 bg-black/60 p-1 rounded-xl border border-white/10 font-mono text-xs overflow-x-auto max-w-full">
            <button
              onClick={() => setActiveMainTab('OVERVIEW')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                activeMainTab === 'OVERVIEW'
                  ? 'bg-[#E8B84A] text-black font-bold shadow-[0_0_10px_rgba(232,184,74,0.3)]'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              OVERVIEW
            </button>
            <button
              onClick={() => setActiveMainTab('TELEGRAM')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                activeMainTab === 'TELEGRAM'
                  ? 'bg-[#E8B84A] text-black font-bold shadow-[0_0_10px_rgba(232,184,74,0.3)]'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              <span>TELEGRAM</span>
            </button>
            <button
              onClick={() => setActiveMainTab('NEWS')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                activeMainTab === 'NEWS'
                  ? 'bg-[#E8B84A] text-black font-bold shadow-[0_0_10px_rgba(232,184,74,0.3)]'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Radio className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              <span>NEWS</span>
            </button>
            <button
              onClick={() => setActiveMainTab('GOOGLE_CHAT')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                activeMainTab === 'GOOGLE_CHAT'
                  ? 'bg-[#E8B84A] text-black font-bold shadow-[0_0_10px_rgba(232,184,74,0.3)]'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
              <span>GOOGLE CHAT</span>
            </button>
            <button
              onClick={() => setActiveMainTab('AI_CHAT')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                activeMainTab === 'AI_CHAT'
                  ? 'bg-[#E8B84A] text-black font-bold shadow-[0_0_10px_rgba(232,184,74,0.3)]'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              <span>AI</span>
            </button>
            <button
              onClick={() => setActiveMainTab('SETTINGS')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                activeMainTab === 'SETTINGS'
                  ? 'bg-[#E8B84A] text-black font-bold shadow-[0_0_10px_rgba(232,184,74,0.3)]'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Sliders className="w-3.5 h-3.5 text-[#FFD97A]" />
              <span>SETTINGS</span>
            </button>
            <button
              onClick={() => setActiveMainTab('PERFORMANCE')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                activeMainTab === 'PERFORMANCE'
                  ? 'bg-[#E8B84A] text-black font-bold shadow-[0_0_10px_rgba(232,184,74,0.3)]'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>PERF</span>
            </button>
            <button
              onClick={() => setActiveMainTab('CHECKLIST')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                activeMainTab === 'CHECKLIST'
                  ? 'bg-[#E8B84A] text-black font-bold shadow-[0_0_10px_rgba(232,184,74,0.3)]'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>GO-LIVE</span>
            </button>
            <button
              onClick={() => {
                setActiveMainTab('TESTS');
                handleRunAllTests();
              }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                activeMainTab === 'TESTS'
                  ? 'bg-[#E8B84A] text-black font-bold shadow-[0_0_10px_rgba(232,184,74,0.3)]'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>TESTS</span>
            </button>
          </div>

          {/* Right Live Ticker & Logout */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 font-mono text-xs">
              <span className="text-neutral-400">XAU/USD:</span>
              {priceData.status === 'LIVE' && currentPrice !== null ? (
                <span className="text-base font-bold text-[#FFD97A]">
                  ${currentPrice.toFixed(2)}
                </span>
              ) : (
                <span className="text-sm font-bold text-neutral-400">OFFLINE</span>
              )}
            </div>

            <button
              onClick={logout}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-300 hover:text-white text-xs font-mono tracking-wider transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>EXIT</span>
            </button>
          </div>
        </div>
      </header>

      {/* Global Action Banner Notification */}
      {actionMessage && (
        <div className="bg-[#E8B84A]/15 border-b border-[#E8B84A]/30 py-2 px-4 text-center font-mono text-xs text-[#FFD97A] flex items-center justify-center gap-2">
          <span>{actionMessage}</span>
          <button
            onClick={() => setActionMessage(null)}
            className="text-neutral-400 hover:text-white ml-2 text-[11px]"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Terminal View Switcher */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6">
        {/* TAB 1: OVERVIEW (Main Trading Deck) */}
        {activeMainTab === 'OVERVIEW' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column (8 cols): Interactive Chart & Live Signals */}
            <section className="lg:col-span-8 space-y-6">
              {/* Chart Card */}
              <div className="glass-panel p-4 sm:p-5 rounded-2xl border border-[#E8B84A]/25">
                <div className="flex flex-wrap items-center justify-between pb-4 border-b border-white/10 gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-mono text-sm font-bold text-white tracking-wider">
                        XAUUSD SPOT INSTITUTIONAL STREAM
                      </h3>
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                          priceData.status === 'LIVE'
                            ? 'text-emerald-400 bg-emerald-950/40 border-emerald-800/40'
                            : priceData.status === 'STALE'
                            ? 'text-amber-400 bg-amber-950/40 border-amber-800/40'
                            : 'text-neutral-400 bg-neutral-900 border-neutral-700'
                        }`}
                      >
                        {priceData.status === 'LIVE'
                          ? 'BIQUOTE.IO LIVE'
                          : priceData.status === 'STALE'
                          ? 'FEED STALE (>5s)'
                          : 'FEED OFFLINE'}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-neutral-400 mt-0.5">
                      {priceData.status === 'LIVE'
                        ? `Connected to biquote.io COMEX Gold Feed (Tick age: ${priceData.quoteAgeSeconds}s)`
                        : priceData.status === 'STALE'
                        ? `Feed latency high: latest tick is ${priceData.quoteAgeSeconds}s old`
                        : 'Real-time feed unavailable. Waiting for server reconnection.'}
                    </p>
                  </div>

                  {/* Timeframe toggles */}
                  <div className="flex items-center gap-1 bg-black/60 p-1 rounded-lg border border-white/10 font-mono text-xs">
                    {(['15M', '1H', '4H', '1D'] as const).map((tf) => (
                      <button
                        key={tf}
                        onClick={() => setActiveChartTab(tf)}
                        className={`px-3 py-1 rounded transition-colors cursor-pointer ${
                          activeChartTab === tf
                            ? 'bg-[#E8B84A] text-black font-bold'
                            : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        {tf}
                      </button>
                    ))}
                  </div>
                </div>

                {/* SVG Interactive Chart */}
                <div className="relative h-60 sm:h-68 w-full mt-4">
                  {priceData.status === 'LIVE' && chartPoints.length > 0 ? (
                    <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 100">
                      <defs>
                        <linearGradient id="goldGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#E8B84A" stopOpacity="0.4" />
                          <stop offset="100%" stopColor="#E8B84A" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>

                      {[20, 40, 60, 80].map((y) => (
                        <line
                          key={y}
                          x1="0"
                          y1={y}
                          x2="100"
                          y2={y}
                          stroke="rgba(255,255,255,0.06)"
                          strokeDasharray="2 3"
                          strokeWidth="0.5"
                        />
                      ))}

                      {chartPoints.length > 1 && (
                        <path
                          d={`M 0 100 ${chartPoints
                            .map((val, idx) => {
                              const x = (idx / (chartPoints.length - 1)) * 100;
                              const y = 90 - ((val - minPrice) / range) * 80;
                              return `L ${x} ${y}`;
                            })
                            .join(' ')} L 100 100 Z`}
                          fill="url(#goldGradient)"
                        />
                      )}

                      {chartPoints.length > 1 && (
                        <path
                          d={chartPoints
                            .map((val, idx) => {
                              const x = (idx / (chartPoints.length - 1)) * 100;
                              const y = 90 - ((val - minPrice) / range) * 80;
                              return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
                            })
                            .join(' ')}
                          fill="none"
                          stroke="#FFD97A"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      )}

                      {currentPrice !== null && (
                        <circle
                          cx="100"
                          cy={90 - ((currentPrice - minPrice) / range) * 80}
                          r="2.5"
                          fill="#FFD97A"
                          className="animate-pulse"
                        />
                      )}
                    </svg>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center border border-white/5 rounded-xl bg-black/40 text-neutral-400 font-mono text-xs">
                      <span className="text-[#FFD97A] font-bold text-sm mb-1">FEED OFFLINE</span>
                      <span>Awaiting data stream from biquote.io</span>
                    </div>
                  )}

                  {priceData.status === 'LIVE' && (
                    <>
                      <div className="absolute right-2 top-2 font-mono text-[10px] text-neutral-400 bg-black/60 px-1.5 py-0.5 rounded border border-white/10">
                        ${maxPrice.toFixed(2)}
                      </div>
                      <div className="absolute right-2 bottom-2 font-mono text-[10px] text-neutral-400 bg-black/60 px-1.5 py-0.5 rounded border border-white/10">
                        ${minPrice.toFixed(2)}
                      </div>
                    </>
                  )}
                </div>

                {/* Microstructure Metrics Footer */}
                <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-4 font-mono text-xs">
                  <div>
                    <span className="text-[10px] text-neutral-500 uppercase block">24H HIGH</span>
                    <span className="font-bold text-white">
                      {priceData.high24h !== null ? `$${priceData.high24h.toFixed(2)}` : 'OFFLINE'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-neutral-500 uppercase block">24H LOW</span>
                    <span className="font-bold text-white">
                      {priceData.low24h !== null ? `$${priceData.low24h.toFixed(2)}` : 'OFFLINE'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-neutral-500 uppercase block">SPREAD</span>
                    <span className="font-bold text-emerald-400">
                      {priceData.spread !== null ? `${priceData.spread.toFixed(2)} PIPS` : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-neutral-500 uppercase block">FEED SOURCE</span>
                    <span className="font-bold text-[#FFD97A]">
                      {priceData.source || 'biquote.io'}
                    </span>
                  </div>
                </div>

                {/* Candle Buffer & Usable Counts */}
                <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs">
                  <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 space-y-1">
                    <span className="text-[10px] text-neutral-500 uppercase block">FEED & LAST TICK</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        {priceData.status}
                      </span>
                      <span className="text-neutral-500 text-[10px]">({priceData.quoteAgeSeconds}s age)</span>
                    </div>
                    <div className="text-[11px] text-neutral-300 truncate">
                      {priceData.timestamp ? new Date(priceData.timestamp).toUTCString() : 'Awaiting tick...'}
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 space-y-1 sm:col-span-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-neutral-500 uppercase">
                        CANDLE BUFFER & USABLE BARS (M15 / M30 / H1 / H4 / D1)
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border text-emerald-400 bg-emerald-950/40 border-emerald-800/40">
                        {priceData.engineState}
                      </span>
                    </div>
                    <div className="grid grid-cols-5 gap-1.5 pt-0.5 text-center">
                      <div className="bg-black/40 p-1 rounded border border-white/5">
                        <span className="text-[9px] text-neutral-400 block">H1</span>
                        <span className="text-xs font-bold text-white">{priceData.usable?.h1 ?? priceData.h1Count}</span>
                        <span className="text-[8px] text-[#E8B84A] block">usable</span>
                      </div>
                      <div className="bg-black/40 p-1 rounded border border-white/5">
                        <span className="text-[9px] text-neutral-400 block">M30</span>
                        <span className="text-xs font-bold text-white">{priceData.usable?.m30 ?? priceData.m30Count}</span>
                        <span className="text-[8px] text-neutral-400 block">usable</span>
                      </div>
                      <div className="bg-black/40 p-1 rounded border border-white/5">
                        <span className="text-[9px] text-neutral-400 block">M15</span>
                        <span className="text-xs font-bold text-white">{priceData.usable?.m15 ?? priceData.m15Count}</span>
                        <span className="text-[8px] text-neutral-400 block">usable</span>
                      </div>
                      <div className="bg-black/40 p-1 rounded border border-white/5">
                        <span className="text-[9px] text-neutral-400 block">H4</span>
                        <span className="text-xs font-bold text-white">{priceData.usable?.h4 ?? priceData.h4Count}</span>
                        <span className="text-[8px] text-[#FFD97A] block">usable</span>
                      </div>
                      <div className="bg-black/40 p-1 rounded border border-white/5">
                        <span className="text-[9px] text-neutral-400 block">D1</span>
                        <span className="text-xs font-bold text-white">{priceData.usable?.d1 ?? priceData.d1Count}</span>
                        <span className="text-[8px] text-[#FFD97A] block">usable</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* LIVE SIGNAL MANAGER (PHASE 3 & 4) */}
              <div className="glass-panel p-4 sm:p-5 rounded-2xl border border-[#E8B84A]/30">
                <div className="flex flex-wrap items-center justify-between pb-4 border-b border-white/10 gap-3">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-[#FFD97A]" />
                    <h3 className="font-mono text-sm font-bold text-white tracking-wider">
                      SIGNAL MANAGER
                    </h3>
                    <span
                      className={`text-[10px] font-mono font-bold tracking-widest px-2.5 py-0.5 rounded-full border ${
                        managerStatus === 'ACTIVE'
                          ? 'text-emerald-400 bg-emerald-950/60 border-emerald-500/50 animate-pulse'
                          : managerStatus === 'PENDING'
                          ? 'text-sky-400 bg-sky-950/60 border-sky-500/50'
                          : managerStatus === 'COOLDOWN'
                          ? 'text-purple-400 bg-purple-950/60 border-purple-500/50'
                          : managerStatus === 'PAUSED'
                          ? 'text-amber-400 bg-amber-950/60 border-amber-500/50'
                          : managerStatus === 'HALTED_FEED'
                          ? 'text-rose-400 bg-rose-950/60 border-rose-500/50'
                          : 'text-neutral-300 bg-neutral-900/60 border-neutral-700'
                      }`}
                    >
                      ● {managerStatus}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className="text-neutral-400 text-[11px]">
                      TODAY: <strong className="text-white">{signalState?.todaySignalsCount ?? 0}/3</strong>
                    </span>

                    <button
                      onClick={handleTogglePause}
                      disabled={actionLoading}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-300 hover:text-white transition-colors cursor-pointer text-xs"
                    >
                      {signalState?.isPaused ? (
                        <>
                          <Play className="w-3 h-3 text-emerald-400" />
                          <span>RESUME</span>
                        </>
                      ) : (
                        <>
                          <Pause className="w-3 h-3 text-amber-400" />
                          <span>PAUSE</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Active Signal Display */}
                {activeSig ? (
                  <div className="mt-4 space-y-4 font-mono">
                    <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-black/60 border border-[#E8B84A]/30">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm ${
                            activeSig.direction === 'BUY'
                              ? 'bg-emerald-950/80 border border-emerald-500/50 text-emerald-400'
                              : 'bg-rose-950/80 border border-rose-500/50 text-rose-400'
                          }`}
                        >
                          {activeSig.direction === 'BUY' ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white text-sm tracking-wider">
                              {activeSig.id}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                                activeSig.direction === 'BUY' ? 'text-emerald-400 bg-emerald-950' : 'text-rose-400 bg-rose-950'
                              }`}
                            >
                              {activeSig.direction}
                            </span>
                            {activeSig.newsLockActive && (
                              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded text-amber-300 bg-amber-950 border border-amber-800/40">
                                ⚡ NEWS LOCK
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-neutral-400">
                            Institutional Score: <strong className="text-[#FFD97A]">{activeSig.score}/100</strong>
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        {activeSig.status === 'ACTIVE' ? (
                          <div className="text-right">
                            <span className="text-[10px] text-neutral-500 block uppercase">LIVE P/L</span>
                            <span
                              className={`text-base font-bold ${
                                activeSig.livePnLDollars >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {activeSig.livePnLDollars >= 0 ? '+' : ''}
                              ${activeSig.livePnLDollars.toFixed(2)}{' '}
                              <span className="text-xs font-normal">
                                ({activeSig.livePnLR >= 0 ? '+' : ''}{activeSig.livePnLR}R)
                              </span>
                            </span>
                          </div>
                        ) : (
                          <div className="text-right">
                            <span className="text-[10px] text-sky-400 block uppercase">PENDING FILL</span>
                            <span className="text-xs text-neutral-300">
                              Expires: {new Date(activeSig.pendingExpiresAt).toLocaleTimeString()}
                            </span>
                          </div>
                        )}

                        <button
                          onClick={() => setActiveMainTab('GOOGLE_CHAT')}
                          className="px-2.5 py-1.5 rounded-lg bg-blue-950/40 hover:bg-blue-900/50 border border-blue-800/40 text-blue-300 text-xs transition-colors cursor-pointer flex items-center gap-1"
                        >
                          <MessageSquare className="w-3 h-3" />
                          <span>WAR ROOM</span>
                        </button>

                        <button
                          onClick={handleManualClose}
                          disabled={actionLoading}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/50 border border-rose-800/40 text-rose-300 text-xs transition-colors cursor-pointer"
                        >
                          CLOSE
                        </button>
                      </div>
                    </div>

                    {/* Levels Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-3 rounded-xl bg-black/40 border border-white/5">
                        <span className="text-[10px] text-neutral-400 block uppercase">ENTRY LIMIT</span>
                        <span className="text-sm font-bold text-white">${activeSig.entry.toFixed(2)}</span>
                      </div>
                      <div className="p-3 rounded-xl bg-black/40 border border-white/5">
                        <span className="text-[10px] text-neutral-400 block uppercase">STOP LOSS</span>
                        <span className="text-sm font-bold text-rose-400">${activeSig.sl.toFixed(2)}</span>
                      </div>
                      <div className="p-3 rounded-xl bg-black/40 border border-white/5">
                        <span className="text-[10px] text-neutral-400 block uppercase">NEXT TARGET</span>
                        <span className="text-sm font-bold text-[#FFD97A]">${activeSig.nextTarget.toFixed(2)}</span>
                      </div>
                      <div className="p-3 rounded-xl bg-black/40 border border-white/5">
                        <span className="text-[10px] text-neutral-400 block uppercase">FINAL TARGET (TP4)</span>
                        <span className="text-sm font-bold text-emerald-400">${activeSig.tp4.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                ) : managerStatus === 'COOLDOWN' ? (
                  <div className="py-6 px-3 text-center space-y-2 font-mono">
                    <Clock className="w-6 h-6 text-purple-400 mx-auto animate-pulse" />
                    <div className="text-purple-300 font-bold text-sm">
                      COOLDOWN PERIOD ACTIVE
                    </div>
                    <p className="text-xs text-neutral-400 max-w-sm mx-auto">
                      Discipline cooldown active. Next scan begins in{' '}
                      <strong className="text-white">
                        {Math.floor((signalState?.cooldownRemainingSeconds ?? 0) / 60)}m{' '}
                        {(signalState?.cooldownRemainingSeconds ?? 0) % 60}s
                      </strong>.
                    </p>
                    <div className="pt-2">
                      <button
                        onClick={handleSkipCooldown}
                        disabled={actionLoading}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-950/40 hover:bg-purple-900/50 border border-purple-800/40 text-purple-300 text-xs transition-colors cursor-pointer"
                      >
                        <FastForward className="w-3.5 h-3.5" />
                        <span>SKIP COOLDOWN</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="py-6 px-3 text-center space-y-2 font-mono">
                    <Zap className="w-6 h-6 text-[#FFD97A] mx-auto animate-pulse" />
                    <div className="text-white font-bold text-sm">
                      ACTIVE SCANNING FOR INSTITUTIONAL CONVICTION
                    </div>
                    <p className="text-xs text-neutral-400 max-w-md mx-auto">
                      Engine evaluating M15/M30/H1 structure, sweeps, and HTF confluence.
                    </p>
                  </div>
                )}
              </div>
            </section>

            {/* Right Column (4 cols): Macro Radar & Quick Telegram Status */}
            <section className="lg:col-span-4 space-y-6">
              {/* Macro Radar Widget (DEMO TAGGED) */}
              <div className="glass-panel p-4 sm:p-5 rounded-2xl border border-[#E8B84A]/25">
                <div className="flex items-center justify-between pb-3 border-b border-white/10">
                  <div className="flex items-center gap-2">
                    <Radio className="w-4 h-4 text-[#FFD97A] animate-pulse" />
                    <h4 className="font-mono text-xs font-bold text-white tracking-wider">
                      MACRO RADAR
                    </h4>
                    <span className="text-[9px] font-mono font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-700/50">
                      FOREX FACTORY
                    </span>
                  </div>
                  <button
                    onClick={() => setActiveMainTab('NEWS')}
                    className="text-[10px] font-mono text-[#E8B84A] hover:underline cursor-pointer"
                  >
                    VIEW CALENDAR &rarr;
                  </button>
                </div>

                <div className="mt-3 space-y-2.5">
                  {macroEvents.map((evt) => (
                    <div
                      key={evt.id}
                      className="p-2.5 rounded-xl bg-black/40 border border-white/5 space-y-1 font-mono"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-white truncate max-w-[170px]">
                          {evt.title}
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                            evt.bias === 'BULLISH'
                              ? 'text-emerald-400 bg-emerald-950/40'
                              : evt.bias === 'BEARISH'
                              ? 'text-rose-400 bg-rose-950/40'
                              : 'text-[#FFD97A] bg-amber-950/40'
                          }`}
                        >
                          {evt.bias}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-neutral-400">
                        <span>Forecast: {evt.forecast}</span>
                        <span className="text-[#FFD97A]">{evt.timeRemaining}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Telegram Dispatch Summary Card */}
              <div className="glass-panel p-4 sm:p-5 rounded-2xl border border-[#E8B84A]/25">
                <div className="flex items-center justify-between pb-3 border-b border-white/10">
                  <div className="flex items-center gap-2">
                    <Send className="w-4 h-4 text-[#29B6F6]" />
                    <h4 className="font-mono text-xs font-bold text-white tracking-wider">
                      TELEGRAM RELAY
                    </h4>
                    <span
                      className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                        isDryRun
                          ? 'bg-amber-950/40 text-amber-300 border-amber-800/40'
                          : 'bg-emerald-950/40 text-emerald-400 border-emerald-800/40'
                      }`}
                    >
                      {isDryRun ? 'DRY RUN' : 'LIVE DISPATCH'}
                    </span>
                  </div>
                </div>

                <div className="mt-3 space-y-2 font-mono text-xs text-neutral-300">
                  <div className="flex justify-between items-center py-1 border-b border-white/5">
                    <span className="text-neutral-400">Target Chat:</span>
                    <span className="text-white">{telegramStatus?.targetChatIdMasked || '****'}</span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-white/5">
                    <span className="text-neutral-400">Outbox Status:</span>
                    <span className="text-emerald-400">
                      {telegramStatus?.pendingCount ?? 0} Pending / {telegramStatus?.sentCount ?? 0} Sent
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-1">
                    <span className="text-neutral-400">Gemini AI Gating:</span>
                    <span className="text-[#FFD97A]">Active (Threshold $\ge 70\%$)</span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-white/10">
                  <button
                    onClick={() => setActiveMainTab('TELEGRAM')}
                    className="w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-center text-xs font-mono text-white flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Terminal className="w-3.5 h-3.5 text-[#E8B84A]" />
                    <span>OPEN TELEGRAM COMMAND CENTER</span>
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* TAB 2: TELEGRAM COMMAND CENTER (Phase 4 Centerpiece) */}
        {activeMainTab === 'TELEGRAM' && (
          <div className="space-y-6">
            {/* Command Center Header Controls */}
            <div className="glass-panel p-5 rounded-2xl border border-[#E8B84A]/30 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#0088cc]/20 border border-[#0088cc]/40 flex items-center justify-center">
                  <Send className="w-5 h-5 text-[#29B6F6]" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-mono text-base font-bold text-white tracking-wider">
                      TELEGRAM SIGNAL COMMAND CENTER
                    </h3>
                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                        telegramStatus?.botConnected
                          ? isDryRun
                            ? 'text-amber-300 bg-amber-950/60 border-amber-600/50'
                            : 'text-emerald-400 bg-emerald-950/60 border-emerald-500/50'
                          : 'text-rose-400 bg-rose-950/60 border-rose-600/50'
                      }`}
                    >
                      {telegramStatus?.botConnected
                        ? isDryRun
                          ? '● DRY RUN ACTIVE'
                          : '● LIVE DISPATCH ACTIVE'
                        : '● TOKEN NOT CONFIGURED'}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-neutral-400">
                    Target Private Chat: <strong className="text-white">{telegramStatus?.targetChatIdMasked || '****'}</strong> (Only authorized chat processed)
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 font-mono text-xs">
                <button
                  onClick={handleSendTestMessage}
                  disabled={actionLoading}
                  className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 text-neutral-200 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5 text-[#29B6F6]" />
                  <span>SEND TEST MESSAGE</span>
                </button>

                <button
                  onClick={() => setIsDryRunModalOpen(true)}
                  className={`px-3 py-2 rounded-lg font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                    isDryRun
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-black'
                      : 'bg-amber-600 hover:bg-amber-500 text-black'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{isDryRun ? 'SWITCH TO LIVE DISPATCH' : 'SWITCH TO DRY RUN'}</span>
                </button>
              </div>
            </div>

            {/* Grid: Live Message Preview & Delivery Queue */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left (5 cols): Live Preview Card */}
              <div className="lg:col-span-5 space-y-6">
                <div className="glass-panel p-5 rounded-2xl border border-[#E8B84A]/25 space-y-3">
                  <div className="flex items-center justify-between pb-3 border-b border-white/10">
                    <span className="font-mono text-xs font-bold text-white tracking-wider flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-[#FFD97A]" />
                      LIVE MESSAGE PREVIEW
                    </span>
                    <span className="text-[10px] font-mono text-neutral-400">TELEGRAM FORMAT</span>
                  </div>

                  <p className="font-mono text-[11px] text-neutral-400">
                    Exact phone rendering of next signal dispatch (prices formatted to 2 decimals, zero emojis clutter):
                  </p>

                  <div className="bg-[#182533] border border-[#2b5278] p-4 rounded-xl font-mono text-xs text-white space-y-1 shadow-inner select-all">
                    <pre className="whitespace-pre-wrap font-mono text-xs text-[#e1eaf2]">
                      {previewText}
                    </pre>
                  </div>

                  <div className="pt-2 font-mono text-[11px] text-neutral-400 space-y-1">
                    <div className="flex justify-between">
                      <span>Thread Linking:</span>
                      <span className="text-emerald-400">Enabled (reply_to_message_id)</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Post-Close Cooldown Line:</span>
                      <span className="text-[#FFD97A]">"Next setup in about 35 min"</span>
                    </div>
                  </div>
                </div>

                {/* Gemini Validation Logs Card */}
                <div className="glass-panel p-5 rounded-2xl border border-[#E8B84A]/25 space-y-3">
                  <div className="flex items-center justify-between pb-3 border-b border-white/10">
                    <span className="font-mono text-xs font-bold text-white tracking-wider flex items-center gap-2">
                      <Bot className="w-4 h-4 text-[#FFD97A]" />
                      GEMINI VALIDATION LOGS
                    </span>
                    <span className="text-[10px] font-mono text-emerald-400">FREE TIER ACTIVE</span>
                  </div>

                  <div className="space-y-2 max-h-64 overflow-y-auto font-mono text-xs">
                    {validations.length > 0 ? (
                      validations.map((val) => (
                        <div key={val.id} className="p-2.5 rounded-xl bg-black/40 border border-white/5 space-y-1">
                          <div className="flex justify-between items-center">
                            <span className="text-white font-bold">{val.signalId}</span>
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                                val.verdict === 'APPROVE'
                                  ? 'text-emerald-400 bg-emerald-950/60'
                                  : 'text-rose-400 bg-rose-950/60'
                              }`}
                            >
                              {val.verdict} ({val.confidence}%)
                            </span>
                          </div>
                          <p className="text-[11px] text-neutral-300">{val.reason}</p>
                          <span className="text-[9px] text-neutral-500 block">
                            Latency: {val.latencyMs}ms · {new Date(val.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="py-6 text-center text-neutral-500 font-mono text-xs">
                        No AI validations logged in current session.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right (7 cols): Outbox Delivery Queue */}
              <div className="lg:col-span-7 space-y-6">
                <div className="glass-panel p-5 rounded-2xl border border-[#E8B84A]/25 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-white/10">
                    <span className="font-mono text-xs font-bold text-white tracking-wider flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-[#FFD97A]" />
                      OUTBOX EVENT QUEUE (./data/outbox.json)
                    </span>
                    <div className="flex items-center gap-3 text-xs font-mono">
                      <span className="text-sky-400">
                        {telegramStatus?.pendingCount ?? 0} Pending
                      </span>
                      <span className="text-emerald-400">
                        {telegramStatus?.sentCount ?? 0} Sent
                      </span>
                      <span className="text-rose-400">
                        {telegramStatus?.failedCount ?? 0} Failed
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2.5 font-mono text-xs">
                    {telegramStatus?.recentMessages && telegramStatus.recentMessages.length > 0 ? (
                      telegramStatus.recentMessages.map((msg: any) => (
                        <div
                          key={msg.eventId}
                          className="p-3 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between gap-3 hover:bg-white/[0.02]"
                        >
                          <div className="space-y-0.5 truncate">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white">{msg.type}</span>
                              <span className="text-[10px] text-neutral-400">({msg.signalId})</span>
                              <span
                                className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${
                                  msg.status === 'SENT'
                                    ? 'text-emerald-400 bg-emerald-950/60'
                                    : msg.status === 'PENDING_DELIVERY'
                                    ? 'text-sky-400 bg-sky-950/60'
                                    : 'text-rose-400 bg-rose-950/60'
                                }`}
                              >
                                {msg.status}
                              </span>
                            </div>
                            <p className="text-[11px] text-neutral-300 truncate max-w-md">
                              {msg.messageText || JSON.stringify(msg.payload)}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0">
                            {msg.status === 'FAILED' && (
                              <button
                                onClick={() => handleRetryEvent(msg.eventId)}
                                className="px-2 py-1 rounded bg-rose-950/50 hover:bg-rose-900 border border-rose-800 text-rose-300 text-[10px] cursor-pointer"
                              >
                                RETRY
                              </button>
                            )}
                            <span className="text-[10px] text-neutral-500">
                              {new Date(msg.createdAt).toLocaleTimeString()}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="py-8 text-center text-neutral-500 font-mono text-xs">
                        Outbox queue is empty. Lifecycle events will appear here.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: REAL FOREX FACTORY NEWS RADAR */}
        {activeMainTab === 'NEWS' && <NewsTab currentPrice={currentPrice} />}

        {/* TAB 4: GOOGLE CHAT COLLABORATION & CONTINUOUS LEARNING */}
        {activeMainTab === 'GOOGLE_CHAT' && (
          <GoogleChatHub currentPrice={currentPrice} activeSignal={activeSig} />
        )}

        {/* TAB 5: AI STRATEGIST CHAT (Section 6) */}
        {activeMainTab === 'AI_CHAT' && (
          <div className="glass-panel p-5 rounded-2xl border border-[#E8B84A]/30 max-w-4xl mx-auto flex flex-col h-[75vh]">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <Bot className="w-5 h-5 text-[#FFD97A]" />
                <div>
                  <h3 className="font-mono text-sm font-bold text-white tracking-wider">
                    SARRAF INSTITUTIONAL AI STRATEGIST
                  </h3>
                  <span className="font-mono text-[10px] text-neutral-400 block">
                    Real-time market context synchronized with XAU/USD live order flow
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-mono text-neutral-400 bg-black/40 px-2 py-1 rounded border border-white/10">
                Model: {process.env.GEMINI_MODEL || 'gemini-2.5-flash'}
              </span>
            </div>

            {/* Chat message stream */}
            <div className="flex-1 overflow-y-auto py-4 space-y-3 font-mono text-xs">
              {chatMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] p-3.5 rounded-2xl ${
                      msg.role === 'user'
                        ? 'bg-[#E8B84A]/20 border border-[#E8B84A]/40 text-white rounded-br-none'
                        : 'bg-black/60 border border-white/10 text-neutral-200 rounded-bl-none'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4 mb-1 text-[10px] text-neutral-400">
                      <span>{msg.role === 'user' ? 'DESK TRADER' : 'SARRAF AI'}</span>
                      <span>{msg.time}</span>
                    </div>
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                  </div>
                </div>
              ))}
              {isChatLoading && (
                <div className="flex justify-start font-mono text-xs">
                  <div className="bg-black/60 border border-white/10 p-3 rounded-2xl rounded-bl-none text-[#FFD97A] flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Analyzing macro structure & order flow...</span>
                  </div>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Pre-seeded suggestion pills */}
            <div className="py-2 border-t border-white/5 flex flex-wrap gap-2 font-mono text-[11px]">
              <button
                onClick={() => setChatInput('Analyze current gold trend, HTF bias and key swing points.')}
                className="px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-300 hover:text-white cursor-pointer"
              >
                Analyze Gold HTF Structure
              </button>
              <button
                onClick={() => setChatInput('What are the upcoming USD high-impact events on the radar?')}
                className="px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-300 hover:text-white cursor-pointer"
              >
                Upcoming USD Releases
              </button>
              <button
                onClick={() => setChatInput('Explain the current dealing range equilibrium and discount zones.')}
                className="px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-300 hover:text-white cursor-pointer"
              >
                Dealing Range & Discount Zones
              </button>
            </div>

            {/* Chat Input Bar */}
            <form onSubmit={handleSendChatMessage} className="pt-2 flex gap-2 font-mono text-xs">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask SARRAF AI about macro bullion structure, liquidity, or key levels..."
                className="flex-1 bg-black/60 border border-white/15 rounded-xl px-4 py-2.5 text-white placeholder-neutral-500 focus:outline-none focus:border-[#E8B84A]"
              />
              <button
                type="submit"
                disabled={isChatLoading || !chatInput.trim()}
                className="px-4 py-2.5 rounded-xl bg-[#E8B84A] text-black font-bold hover:bg-[#FFD97A] transition-colors cursor-pointer disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>

            <div className="pt-2 text-center text-[10px] font-mono text-neutral-500">
              Not financial advice. Read-only terminal intelligence.
            </div>
          </div>
        )}

        {/* TAB 6: SETTINGS (Admin Only) */}
        {activeMainTab === 'SETTINGS' && <SettingsTab />}

        {/* TAB 7: PERFORMANCE DESK (Admin Only) */}
        {activeMainTab === 'PERFORMANCE' && <PerformanceTab />}

        {/* TAB 8: GO-LIVE READINESS CHECKLIST (Admin Only) */}
        {activeMainTab === 'CHECKLIST' && (
          <GoLiveChecklistTab
            onSwitchLive={() => setIsDryRunModalOpen(true)}
            telegramStatus={telegramStatus}
            engineState={priceData.engineState}
            priceStatus={priceData.status}
          />
        )}

        {/* TAB 9: VERIFICATION TEST SUITES (Phases 3, 4, and 5) */}
        {activeMainTab === 'TESTS' && (
          <div className="glass-panel p-5 rounded-2xl border border-[#E8B84A]/30 space-y-6">
            <div className="flex flex-wrap items-center justify-between pb-3 border-b border-white/10 gap-3">
              <div>
                <h3 className="font-mono text-sm font-bold text-white tracking-wider flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#FFD97A]" />
                  SARRAF AUTOMATED VERIFICATION TEST RUNNER
                </h3>
                <span className="font-mono text-xs text-neutral-400">
                  Comprehensive deterministic test suites for Phase 3 (Signal Manager), Phase 4 (Telegram & AI), and Phase 5 (News, Risk & Safety)
                </span>
              </div>

              <button
                onClick={handleRunAllTests}
                disabled={isRunningTests}
                className="px-4 py-2 rounded-lg bg-[#E8B84A] hover:bg-[#FFD97A] text-black font-mono font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {isRunningTests ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                <span>RERUN ALL TEST SUITES</span>
              </button>
            </div>

            {/* Phase 5B Test Table */}
            <div className="space-y-3 font-mono text-xs pb-4 border-b border-white/10">
              <div className="flex items-center justify-between pb-1 border-b border-white/10">
                <span className="font-bold text-white">PHASE 5B: GO-LIVE READINESS, BACKUPS, LEASE & CLOCK DRIFT (11 TESTS)</span>
                {phase5bTestReport && (
                  <span
                    className={`font-bold px-2 py-0.5 rounded text-[10px] ${
                      phase5bTestReport.allPassed
                        ? 'text-emerald-400 bg-emerald-950/60 border border-emerald-700/50'
                        : 'text-rose-400 bg-rose-950/60 border border-rose-700/50'
                    }`}
                  >
                    {phase5bTestReport.passedCount} / {phase5bTestReport.totalTests} PASSED
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {phase5bTestReport?.results?.map((t: any) => (
                  <div
                    key={t.id}
                    className={`p-3 rounded-xl border ${
                      t.passed ? 'bg-emerald-950/20 border-emerald-800/30' : 'bg-rose-950/20 border-rose-800/30'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[#FFD97A]">[{t.id.toUpperCase()}]</span>
                        <span className="font-bold text-white">{t.name}</span>
                      </div>
                      <span
                        className={`font-bold px-2 py-0.5 rounded text-[10px] ${
                          t.passed ? 'text-emerald-400 bg-emerald-950/60' : 'text-rose-400 bg-rose-950/60'
                        }`}
                      >
                        {t.passed ? 'PASS' : 'FAIL'}
                      </span>
                    </div>
                    <div className="text-[11px] text-neutral-400">
                      <span className="text-neutral-500">Expected: </span>
                      {t.expected}
                    </div>
                    <div className="text-[11px] text-neutral-300 mt-0.5">
                      <span className="text-neutral-500">Result: </span>
                      {t.actual}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Phase 5 Test Table */}
            <div className="space-y-3 font-mono text-xs">
              <div className="flex items-center justify-between pb-1 border-b border-white/10">
                <span className="font-bold text-white">PHASE 5: REAL NEWS, VALIDATED SETTINGS & DEPLOYMENT SAFETY (12 TESTS)</span>
                {phase5TestReport && (
                  <span
                    className={`font-bold px-2 py-0.5 rounded text-[10px] ${
                      phase5TestReport.allPassed
                        ? 'text-emerald-400 bg-emerald-950/60 border border-emerald-700/50'
                        : 'text-rose-400 bg-rose-950/60 border border-rose-700/50'
                    }`}
                  >
                    {phase5TestReport.passedCount} / {phase5TestReport.totalTests} PASSED
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {phase5TestReport?.results?.map((t: any) => (
                  <div
                    key={t.id}
                    className={`p-3 rounded-xl border ${
                      t.passed ? 'bg-emerald-950/20 border-emerald-800/30' : 'bg-rose-950/20 border-rose-800/30'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[#FFD97A]">[{t.id.toUpperCase()}]</span>
                        <span className="font-bold text-white">{t.name}</span>
                      </div>
                      <span
                        className={`font-bold px-2 py-0.5 rounded text-[10px] ${
                          t.passed ? 'text-emerald-400 bg-emerald-950/60' : 'text-rose-400 bg-rose-950/60'
                        }`}
                      >
                        {t.passed ? 'PASS' : 'FAIL'}
                      </span>
                    </div>
                    <div className="text-[11px] text-neutral-400">
                      <span className="text-neutral-500">Expected: </span>
                      {t.expected}
                    </div>
                    <div className="text-[11px] text-neutral-300 mt-0.5">
                      <span className="text-neutral-500">Result: </span>
                      {t.actual}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Phase 4 Test Table */}
            <div className="space-y-3 font-mono text-xs pt-4 border-t border-white/10">
              <div className="flex items-center justify-between pb-1 border-b border-white/10">
                <span className="font-bold text-white">PHASE 4: TELEGRAM SENDER & GEMINI VALIDATOR (10 TESTS)</span>
                {phase4TestReport && (
                  <span
                    className={`font-bold px-2 py-0.5 rounded text-[10px] ${
                      phase4TestReport.allPassed
                        ? 'text-emerald-400 bg-emerald-950/60 border border-emerald-700/50'
                        : 'text-rose-400 bg-rose-950/60 border border-rose-700/50'
                    }`}
                  >
                    {phase4TestReport.passedCount} / {phase4TestReport.totalTests} PASSED
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {phase4TestReport?.results?.map((t: any) => (
                  <div
                    key={t.id}
                    className={`p-3 rounded-xl border ${
                      t.passed ? 'bg-emerald-950/20 border-emerald-800/30' : 'bg-rose-950/20 border-rose-800/30'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[#FFD97A]">[{t.id.toUpperCase()}]</span>
                        <span className="font-bold text-white">{t.name}</span>
                      </div>
                      <span
                        className={`font-bold px-2 py-0.5 rounded text-[10px] ${
                          t.passed ? 'text-emerald-400 bg-emerald-950/60' : 'text-rose-400 bg-rose-950/60'
                        }`}
                      >
                        {t.passed ? 'PASS' : 'FAIL'}
                      </span>
                    </div>
                    <div className="text-[11px] text-neutral-400">
                      <span className="text-neutral-500">Expected: </span>
                      {t.expected}
                    </div>
                    <div className="text-[11px] text-neutral-300 mt-0.5">
                      <span className="text-neutral-500">Result: </span>
                      {t.actual}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Phase 3 Test Table */}
            <div className="space-y-3 font-mono text-xs pt-4 border-t border-white/10">
              <div className="flex items-center justify-between pb-1 border-b border-white/10">
                <span className="font-bold text-white">PHASE 3: SIGNAL MANAGER STATE MACHINE & GAPS (11 TESTS)</span>
                {phase3TestReport && (
                  <span
                    className={`font-bold px-2 py-0.5 rounded text-[10px] ${
                      phase3TestReport.allPassed
                        ? 'text-emerald-400 bg-emerald-950/60 border border-emerald-700/50'
                        : 'text-rose-400 bg-rose-950/60 border border-rose-700/50'
                    }`}
                  >
                    {phase3TestReport.passedCount} / {phase3TestReport.totalTests} PASSED
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {phase3TestReport?.results?.map((t: any) => (
                  <div
                    key={t.id}
                    className={`p-3 rounded-xl border ${
                      t.passed ? 'bg-emerald-950/20 border-emerald-800/30' : 'bg-rose-950/20 border-rose-800/30'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[#FFD97A]">[{t.id.toUpperCase()}]</span>
                        <span className="font-bold text-white">{t.name}</span>
                      </div>
                      <span
                        className={`font-bold px-2 py-0.5 rounded text-[10px] ${
                          t.passed ? 'text-emerald-400 bg-emerald-950/60' : 'text-rose-400 bg-rose-950/60'
                        }`}
                      >
                        {t.passed ? 'PASS' : 'FAIL'}
                      </span>
                    </div>
                    <div className="text-[11px] text-neutral-400">
                      <span className="text-neutral-500">Expected: </span>
                      {t.expected}
                    </div>
                    <div className="text-[11px] text-neutral-300 mt-0.5">
                      <span className="text-neutral-500">Result: </span>
                      {t.actual}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Institutional Risk Disclaimer Footer */}
      <footer className="border-t border-white/5 py-4 px-6 text-center font-mono text-[11px] text-neutral-500 bg-black/60">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <span>SARRAF Institutional Gold Terminal v5.0.0</span>
          <span>Trading involves risk. Signals are not financial advice. Past results do not guarantee future results.</span>
          <span>COMEX / Spot XAUUSD</span>
        </div>
      </footer>

      {/* DRY RUN Confirmation Dialog Modal */}
      {isDryRunModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="glass-panel w-full max-w-md rounded-2xl border border-[#E8B84A]/30 p-6 space-y-4 font-mono text-xs shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-amber-300" />
              </div>
              <div>
                <h4 className="font-bold text-white text-sm">
                  {isDryRun ? 'CONFIRM LIVE TELEGRAM DISPATCH' : 'SWITCH BACK TO DRY RUN'}
                </h4>
                <span className="text-[11px] text-neutral-400">
                  {isDryRun ? 'Production Telegram Broadcast' : 'Simulated Console Mode'}
                </span>
              </div>
            </div>

            <p className="text-neutral-300 leading-relaxed">
              {isDryRun
                ? 'Switching to LIVE DISPATCH will broadcast all confirmed signals and lifecycle updates directly to your private Telegram channel. Ensure your bot has admin privileges in the destination chat.'
                : 'Switching to DRY RUN mode will log all formatted messages to the internal console and outbox without sending external network requests.'}
            </p>

            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => setIsDryRunModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white cursor-pointer"
              >
                CANCEL
              </button>
              <button
                onClick={() => handleToggleDryRun(!isDryRun)}
                disabled={actionLoading}
                className={`px-4 py-2 rounded-lg font-bold text-black cursor-pointer ${
                  isDryRun ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-amber-500 hover:bg-amber-400'
                }`}
              >
                CONFIRM SWITCH
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
