import React, { useState, useEffect } from 'react';
import {
  X,
  RefreshCw,
  Server,
  Globe,
  Radio,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Database,
  ShieldCheck,
  Layers,
} from 'lucide-react';

export interface UpstreamItem {
  id: string;
  name: string;
  type: 'WEBSOCKET' | 'REST';
  category?: 'TRADES' | 'BOOK' | 'PERPS' | 'VENUES';
  thresholdMs?: number;
  endpoint: string;
  status: 'ONLINE' | 'ERROR' | 'DISCONNECTED' | 'CONNECTING';
  wsClosed?: boolean;
  lastHttpStatusOrWsCloseCode: number | null;
  lastSuccessTime: number | null;
  lastSuccessIso: string | null;
  lastMessageAgeMs?: number | null;
  lastErrorTime: number | null;
  lastErrorText: string | null;
  latencyMs: number | null;
}

export interface ReconcileData {
  timestamp: number;
  isoTime: string;
  spotExchange: string;
  wsSpotPrice: number | null;
  restSpotPrice: number | null;
  spotDiffPct: number | null;
  spotMismatch: boolean;
  bookExchange: string;
  wsBookMid: number | null;
  restBookMid: number | null;
  bookDiffPct: number | null;
  bookMismatch: boolean;
  status: 'PASS' | 'FAIL' | 'PENDING';
  detail: string;
}

export interface FieldDiagnosticItem {
  section: 'ORDER_BOOK' | 'PERPS' | 'VENUES';
  field: string;
  activeSource: string;
  status: 'OK' | 'BUILDING' | 'UNAVAILABLE';
  reason: string | null;
}

export interface ServerRegionData {
  ip: string;
  country: string;
  countryCode: string;
  region: string;
  city: string;
  org: string;
  timezone: string;
  detectedAt: number;
}

export interface HealthReport {
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  activeSource: string;
  feedStatus: string;
  messageAgeMs: number;
  currentPrice: number | null;
  serverRegion: ServerRegionData;
  geoBlockedNotice?: string | null;
  feedAges?: { spot: number; book: number; perps: number; venues: number };
  feedSources?: { spot: string; book: string; perps: string; venues: string };
  feedStale?: { spot: boolean; book: boolean; perps: boolean; venues: boolean };
  reconcile?: ReconcileData;
  fieldDiagnostics?: FieldDiagnosticItem[];
  upstreams: UpstreamItem[];
  sqliteStats: {
    totalClosed: number;
    winsCount: number;
    lossesCount: number;
    winRate: number | null;
    avgR: number | null;
  };
  ticksSeen: number;
  uptimeSeconds: number;
  memoryMb: {
    rss: number;
    heapUsed: number;
  };
  timestamp: number;
}

interface BtcTideDebugDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BtcTideDebugDrawer: React.FC<BtcTideDebugDrawerProps> = ({ isOpen, onClose }) => {
  const [data, setData] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastFetchTime, setLastFetchTime] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchHealth = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/btc-tide/health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: HealthReport = await res.json();
      setData(json);
      setLastFetchTime(Date.now());
      setFetchError(null);
    } catch (err: any) {
      setFetchError(err.message || 'Failed to fetch telemetry');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    fetchHealth();
    const interval = setInterval(fetchHealth, 2500);
    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  const formatAgo = (timestampMs: number | null) => {
    if (!timestampMs) return '--';
    const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
    if (diffSec < 60) return `${diffSec}s ago`;
    const mm = Math.floor(diffSec / 60);
    return `${mm}m ${diffSec % 60}s ago`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-[#0b0c10] border border-[#E8B84A]/40 rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.85)] font-mono text-xs overflow-hidden">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#12131a] border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-teal-500/10 border border-teal-500/30 flex items-center justify-center text-teal-400">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white text-sm tracking-wider">
                  BTC TIDE · UPSTREAM TELEMETRY &amp; HEALTH
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-[#E8B84A]/20 border border-[#E8B84A]/40 text-[#FFD97A] font-semibold">
                  DEBUG DRAWER
                </span>
              </div>
              <div className="text-[10px] text-neutral-400">
                Live upstream connectivity, last-message age, 30s REST reconciliation &amp; field diagnostics
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchHealth}
              disabled={loading}
              className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-neutral-300 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-1 cursor-pointer"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#FFD97A]' : ''}`} />
              <span className="text-[10px]">Refresh</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-neutral-400 hover:text-white hover:bg-rose-950/40 hover:border-rose-500/40 transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {fetchError && (
            <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-500/50 text-rose-300 flex items-center gap-2 text-xs">
              <XCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>Failed to load health telemetry: {fetchError}</span>
            </div>
          )}

          {data?.geoBlockedNotice && (
            <div className="p-3.5 rounded-xl bg-amber-950/80 border border-amber-500/60 text-amber-200 flex items-start gap-3 text-xs font-mono shadow-[0_0_20px_rgba(245,158,11,0.2)]">
              <AlertTriangle className="w-5 h-5 shrink-0 text-amber-400 mt-0.5" />
              <div>
                <div className="font-bold text-amber-300 text-sm tracking-wide">
                  BINANCE REGION RESTRICTION DETECTED (HTTP 451 / 403)
                </div>
                <div className="text-[11px] text-amber-200/90 mt-1 leading-relaxed">
                  {data.geoBlockedNotice}
                </div>
              </div>
            </div>
          )}

          {/* 1. Server Region & Environment Banner */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {/* IP & Location */}
            <div className="p-3 rounded-xl bg-black/50 border border-white/10 space-y-1">
              <div className="text-[10px] text-neutral-400 uppercase flex items-center gap-1.5">
                <Globe className="w-3 h-3 text-teal-400" />
                SERVER REGION &amp; IP
              </div>
              <div className="font-bold text-white text-sm flex items-center gap-1.5">
                <span>{data?.serverRegion?.country || '--'}</span>
                {data?.serverRegion?.countryCode && (
                  <span className="text-[10px] px-1 py-0.2 rounded bg-white/10 text-neutral-300">
                    {data.serverRegion.countryCode}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-neutral-300 font-semibold">
                IP: <span className="text-teal-300">{data?.serverRegion?.ip || '--'}</span>
              </div>
              <div className="text-[10px] text-neutral-400">
                {data?.serverRegion?.city ? `${data.serverRegion.city}, ` : ''}
                {data?.serverRegion?.region || ''} · {data?.serverRegion?.org || ''}
              </div>
            </div>

            {/* Overall Feed State */}
            <div className="p-3 rounded-xl bg-black/50 border border-white/10 space-y-1">
              <div className="text-[10px] text-neutral-400 uppercase flex items-center gap-1.5">
                <Radio className="w-3 h-3 text-[#FFD97A]" />
                FEED STATUS &amp; SOURCE
              </div>
              <div className="font-bold text-sm flex items-center gap-2">
                <span
                  className={
                    data?.status === 'HEALTHY'
                      ? 'text-emerald-400'
                      : data?.status === 'DEGRADED'
                      ? 'text-amber-400'
                      : 'text-rose-400'
                  }
                >
                  {data?.status || 'CONNECTING'}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-neutral-200 font-normal">
                  Source: {data?.activeSource || 'BINANCE'}
                </span>
              </div>
              <div className="text-[10px] text-neutral-400">
                Message Age: {data?.messageAgeMs ? `${(data.messageAgeMs / 1000).toFixed(1)}s` : '--'}
              </div>
              <div className="text-[10px] text-neutral-400">
                Live BTC: {data?.currentPrice ? `$${data.currentPrice.toFixed(2)}` : '--'}
              </div>
            </div>

            {/* Database & Signal Guard Status */}
            <div className="p-3 rounded-xl bg-black/50 border border-white/10 space-y-1">
              <div className="text-[10px] text-neutral-400 uppercase flex items-center gap-1.5">
                <Database className="w-3 h-3 text-teal-400" />
                DATABASE &amp; SAFETY GUARD
              </div>
              <div className="font-bold text-white text-sm">SQLite btc_tide.db</div>
              <div className="text-[11px] text-neutral-300">
                Closed Trades:{' '}
                <span className="font-bold text-white">{data?.sqliteStats?.totalClosed ?? 0}</span>
              </div>
              <div className="text-[10px] text-neutral-400">
                Win Rate:{' '}
                {data?.sqliteStats?.winRate !== null
                  ? `${data?.sqliteStats?.winRate}%`
                  : '-- (needs ≥ 10)'}
              </div>
              <div className="text-[10px] text-emerald-400 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> Real Trade Hygiene Active
              </div>
            </div>

            {/* System Resources */}
            <div className="p-3 rounded-xl bg-black/50 border border-white/10 space-y-1">
              <div className="text-[10px] text-neutral-400 uppercase flex items-center gap-1.5">
                <Server className="w-3 h-3 text-[#FFD97A]" />
                RUNTIME TELEMETRY
              </div>
              <div className="font-bold text-white text-sm">
                Uptime:{' '}
                {data?.uptimeSeconds
                  ? `${Math.floor(data.uptimeSeconds / 60)}m ${data.uptimeSeconds % 60}s`
                  : '--'}
              </div>
              <div className="text-[11px] text-neutral-300">
                Memory: RSS {data?.memoryMb?.rss ?? '--'}MB / Heap{' '}
                {data?.memoryMb?.heapUsed ?? '--'}MB
              </div>
              <div className="text-[10px] text-neutral-400">
                Ticks Processed: {data?.ticksSeen?.toLocaleString() ?? 0}
              </div>
            </div>
          </div>

          {/* 1B. 30-Second Exchange REST Reconciliation Audit */}
          {data?.reconcile && (
            <div
              className={`rounded-xl p-3 border space-y-2 ${
                data.reconcile.status === 'FAIL'
                  ? 'bg-rose-950/40 border-rose-500/50'
                  : 'bg-black/50 border-white/10'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/5">
                <span className="font-bold text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#FFD97A]" />
                  30S EXCHANGE REST RECONCILIATION (SPOT &amp; BOOK THRESHOLD &le; 0.1%)
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                      data.reconcile.status === 'PASS'
                        ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-400'
                        : data.reconcile.status === 'FAIL'
                        ? 'bg-rose-950/70 border-rose-500/50 text-rose-300'
                        : 'bg-amber-950/60 border-amber-500/40 text-amber-300'
                    }`}
                  >
                    {data.reconcile.status}
                  </span>
                  <span className="text-[10px] text-neutral-400">
                    Checked {data.reconcile.timestamp ? formatAgo(data.reconcile.timestamp) : '--'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
                <div className="bg-black/40 border border-white/5 rounded-lg p-2.5 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] text-neutral-400 uppercase">
                      SPOT RECONCILE ({data.reconcile.spotExchange})
                    </div>
                    <div className="text-white font-semibold mt-0.5">
                      WS: {data.reconcile.wsSpotPrice !== null ? `$${data.reconcile.wsSpotPrice.toFixed(2)}` : '--'}{' '}
                      vs REST:{' '}
                      {data.reconcile.restSpotPrice !== null ? `$${data.reconcile.restSpotPrice.toFixed(2)}` : '--'}
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`font-bold ${
                        data.reconcile.spotMismatch ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {data.reconcile.spotDiffPct !== null ? `${data.reconcile.spotDiffPct}%` : '--'}
                    </span>
                    <div className="text-[9px] text-neutral-500">max 0.1%</div>
                  </div>
                </div>

                <div className="bg-black/40 border border-white/5 rounded-lg p-2.5 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] text-neutral-400 uppercase">
                      BOOK MID RECONCILE ({data.reconcile.bookExchange})
                    </div>
                    <div className="text-white font-semibold mt-0.5">
                      WS Mid: {data.reconcile.wsBookMid !== null ? `$${data.reconcile.wsBookMid.toFixed(2)}` : '--'}{' '}
                      vs REST Mid:{' '}
                      {data.reconcile.restBookMid !== null ? `$${data.reconcile.restBookMid.toFixed(2)}` : '--'}
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`font-bold ${
                        data.reconcile.bookMismatch ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {data.reconcile.bookDiffPct !== null ? `${data.reconcile.bookDiffPct}%` : '--'}
                    </span>
                    <div className="text-[9px] text-neutral-500">max 0.1%</div>
                  </div>
                </div>
              </div>
              <div className="text-[10px] text-neutral-400">{data.reconcile.detail}</div>
            </div>
          )}

          {/* 2. Field-Level Diagnostics Matrix (Sources & Reasons for any "--" or building fields) */}
          {data?.fieldDiagnostics && data.fieldDiagnostics.length > 0 && (
            <div className="bg-black/50 border border-white/10 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between pb-2 border-b border-white/5">
                <span className="font-bold text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-[#FFD97A]" />
                  FIELD SOURCE &amp; DIAGNOSTICS AUDIT (ORDER BOOK · PERPS · VENUES)
                </span>
                <span className="text-[10px] text-neutral-400">
                  Explains any &quot;--&quot; or building fields
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-[11px]">
                  <thead>
                    <tr className="text-[10px] text-neutral-400 uppercase border-b border-white/5">
                      <th className="py-1.5 px-2">SECTION</th>
                      <th className="py-1.5 px-2">FIELD</th>
                      <th className="py-1.5 px-2">ACTIVE SOURCE</th>
                      <th className="py-1.5 px-2">STATUS</th>
                      <th className="py-1.5 px-2">DIAGNOSTIC / REASON</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {data.fieldDiagnostics.map((f, idx) => (
                      <tr key={`${f.section}_${f.field}_${idx}`} className="hover:bg-white/[0.03]">
                        <td className="py-1.5 px-2 text-[10px] text-neutral-400">{f.section}</td>
                        <td className="py-1.5 px-2 font-bold text-white">{f.field}</td>
                        <td className="py-1.5 px-2">
                          <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-neutral-300 text-[10px]">
                            {f.activeSource}
                          </span>
                        </td>
                        <td className="py-1.5 px-2 font-bold">
                          {f.status === 'OK' ? (
                            <span className="text-emerald-400 text-[10px]">OK</span>
                          ) : f.status === 'BUILDING' ? (
                            <span className="text-amber-300 text-[10px]">BUILDING</span>
                          ) : (
                            <span className="text-rose-400 text-[10px]">UNAVAILABLE (--)</span>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-[10px]">
                          {f.reason ? (
                            <span className="text-amber-200">{f.reason}</span>
                          ) : (
                            <span className="text-neutral-500">Live &amp; populated</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 3. Upstream Matrix Table */}
          <div className="bg-black/50 border border-white/10 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between pb-2 border-b border-white/5">
              <span className="font-bold text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-[#FFD97A]" />
                UPSTREAM CONNECTIVITY AUDIT MATRIX ({data?.upstreams?.length || 0} MONITORED)
              </span>
              <span className="text-[10px] text-neutral-400">
                Polled {formatAgo(lastFetchTime)}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-[11px]">
                <thead>
                  <tr className="text-[10px] text-neutral-400 uppercase border-b border-white/5">
                    <th className="py-2 px-2">UPSTREAM</th>
                    <th className="py-2 px-2">TYPE</th>
                    <th className="py-2 px-2">STATUS</th>
                    <th className="py-2 px-2 text-right">LAST MSG AGE / MAX</th>
                    <th className="py-2 px-2 text-right">HTTP / WS CODE</th>
                    <th className="py-2 px-2 text-right">LATENCY</th>
                    <th className="py-2 px-2">LAST ERROR TEXT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {!data?.upstreams || data.upstreams.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-neutral-500">
                        Loading upstream telemetry...
                      </td>
                    </tr>
                  ) : (
                    data.upstreams.map((u) => {
                      const isOnline = u.status === 'ONLINE';
                      const isError = u.status === 'ERROR';
                      const ageMs =
                        u.lastMessageAgeMs !== undefined && u.lastMessageAgeMs !== null
                          ? u.lastMessageAgeMs
                          : u.lastSuccessTime
                          ? Math.max(0, Date.now() - u.lastSuccessTime)
                          : null;
                      const thresholdSec = u.thresholdMs ? u.thresholdMs / 1000 : 10;
                      const ageExceeded =
                        ageMs !== null && u.thresholdMs ? ageMs > u.thresholdMs : false;

                      return (
                        <tr key={u.id} className="hover:bg-white/[0.03] transition-colors">
                          <td className="py-2.5 px-2 font-bold text-white">
                            <div>{u.name}</div>
                            <div className="text-[9px] text-neutral-500 font-normal truncate max-w-[200px]">
                              {u.endpoint}
                            </div>
                          </td>

                          <td className="py-2.5 px-2">
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-neutral-300 border border-white/10">
                              {u.type}
                            </span>
                          </td>

                          <td className="py-2.5 px-2 font-bold">
                            {isOnline ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/40 text-emerald-400 text-[10px]">
                                <CheckCircle2 className="w-3 h-3" /> ONLINE
                              </span>
                            ) : isError ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-950/60 border border-rose-500/40 text-rose-400 text-[10px]">
                                <XCircle className="w-3 h-3" /> ERROR
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-950/60 border border-amber-500/40 text-amber-300 text-[10px]">
                                <AlertTriangle className="w-3 h-3" /> {u.status}
                              </span>
                            )}
                          </td>

                          <td className="py-2.5 px-2 text-right font-mono text-[10px]">
                            {ageMs !== null ? (
                              <span
                                className={
                                  ageExceeded || !isOnline
                                    ? 'text-amber-300 font-bold'
                                    : 'text-emerald-300 font-semibold'
                                }
                              >
                                {(ageMs / 1000).toFixed(1)}s / {thresholdSec}s
                              </span>
                            ) : (
                              <span className="text-neutral-500">-- / {thresholdSec}s</span>
                            )}
                          </td>

                          <td className="py-2.5 px-2 text-right font-mono font-bold">
                            {u.lastHttpStatusOrWsCloseCode !== null ? (
                              <span
                                className={
                                  u.type === 'REST' &&
                                  u.lastHttpStatusOrWsCloseCode >= 200 &&
                                  u.lastHttpStatusOrWsCloseCode < 300
                                    ? 'text-emerald-400'
                                    : 'text-rose-400 font-bold'
                                }
                              >
                                {u.type === 'WEBSOCKET'
                                  ? `WS ${u.lastHttpStatusOrWsCloseCode} (CLOSED)`
                                  : `HTTP ${u.lastHttpStatusOrWsCloseCode}`}
                              </span>
                            ) : u.type === 'WEBSOCKET' && isOnline ? (
                              <span className="text-emerald-400 text-[10px]">WS OPEN</span>
                            ) : (
                              <span className="text-neutral-500">--</span>
                            )}
                          </td>

                          <td className="py-2.5 px-2 text-right text-neutral-300 text-[10px]">
                            {u.latencyMs !== null ? `${u.latencyMs}ms` : '--'}
                          </td>

                          <td className="py-2.5 px-2">
                            {u.lastErrorText ? (
                              <span className="text-rose-400 font-semibold text-[10px] bg-rose-950/40 px-1.5 py-0.5 rounded border border-rose-500/30">
                                {u.lastErrorText}
                              </span>
                            ) : (
                              <span className="text-neutral-500 text-[10px]">None (Nominal)</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#0e0f14] border-t border-white/10 text-neutral-400 text-[10px]">
          <span>BTC Tide Production Telemetry · Auto-refreshes every 2.5s</span>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded-md bg-white/10 hover:bg-white/15 text-white font-semibold transition-colors cursor-pointer"
          >
            Close Drawer
          </button>
        </div>
      </div>
    </div>
  );
};
