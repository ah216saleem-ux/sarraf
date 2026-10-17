// src/atlas/components/AtlasAlertLogCard.tsx
import React, { useState } from 'react';
import { AtlasAlertLogItem } from '../atlasTypes';
import { Bell, BellOff, Send, CheckCircle2, AlertTriangle, XCircle, Shield, Clock, RefreshCw } from 'lucide-react';

interface AtlasAlertLogCardProps {
  alertsEnabled: boolean;
  alertLogs: AtlasAlertLogItem[];
  isAdmin: boolean;
  onToggleAlerts: () => Promise<void>;
  onSendTestAlert: () => Promise<{ success: boolean; error?: string }>;
}

export const AtlasAlertLogCard: React.FC<AtlasAlertLogCardProps> = ({
  alertsEnabled,
  alertLogs = [],
  isAdmin,
  onToggleAlerts,
  onSendTestAlert,
}) => {
  const [isToggling, setIsToggling] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success?: boolean; message?: string } | null>(null);

  const handleToggle = async () => {
    if (!isAdmin) return;
    setIsToggling(true);
    try {
      await onToggleAlerts();
    } finally {
      setIsToggling(false);
    }
  };

  const handleTest = async () => {
    if (!isAdmin) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await onSendTestAlert();
      if (res.success) {
        setTestResult({ success: true, message: 'Test alert sent to Telegram chat!' });
      } else {
        setTestResult({ success: false, message: res.error || 'Failed to dispatch test alert' });
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || 'Dispatch error' });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="bg-[#0b101b] border border-neutral-800 rounded-lg p-4 sm:p-5 shadow-lg">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-neutral-800/80 gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              alertsEnabled
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                : 'bg-neutral-800 border border-neutral-700 text-neutral-400'
            }`}
          >
            {alertsEnabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-neutral-100 tracking-wider uppercase font-mono">
                ZONE ALERTS &amp; DISPATCH LOG
              </h3>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider ${
                  alertsEnabled
                    ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                    : 'bg-neutral-800 border border-neutral-700 text-neutral-400'
                }`}
              >
                {alertsEnabled ? 'DISPATCH ON' : 'DISPATCH OFF'}
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              Real-time Telegram notifications for Approach (5 pts), Zone Touch, Break &amp; Daily Publish
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {isAdmin ? (
            <>
              <button
                onClick={handleTest}
                disabled={isTesting}
                className="px-2.5 py-1.5 rounded text-xs font-mono font-semibold bg-neutral-900 border border-neutral-700 hover:border-neutral-500 text-neutral-200 hover:text-white transition flex items-center gap-1.5 disabled:opacity-50"
                title="Send a sample Sarraf Atlas alert to the Telegram group to verify credentials"
              >
                {isTesting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3 text-sky-400" />}
                <span>TEST DISPATCH</span>
              </button>

              <button
                onClick={handleToggle}
                disabled={isToggling}
                className={`px-3 py-1.5 rounded text-xs font-mono font-bold tracking-wider transition flex items-center gap-1.5 border disabled:opacity-50 ${
                  alertsEnabled
                    ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/50'
                    : 'bg-neutral-900 border-neutral-700 text-neutral-300 hover:border-neutral-500'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    alertsEnabled ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-neutral-500'
                  }`}
                />
                <span>ATLAS ALERTS {alertsEnabled ? 'ON' : 'OFF'}</span>
              </button>
            </>
          ) : (
            <div className="text-[11px] font-mono text-neutral-500 flex items-center gap-1">
              <Shield className="w-3 h-3 text-neutral-600" />
              <span>Admin login required to toggle alerts</span>
            </div>
          )}
        </div>
      </div>

      {/* Test Result Toast/Banner */}
      {testResult && (
        <div
          className={`mt-3 p-2.5 rounded text-xs font-mono flex items-center justify-between border ${
            testResult.success
              ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-950/30 border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {testResult.success ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            <span>{testResult.message}</span>
          </div>
          <button
            onClick={() => setTestResult(null)}
            className="text-neutral-400 hover:text-neutral-200 text-xs px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Dispatch Policy Banner */}
      <div className="mt-3 bg-neutral-950/60 border border-neutral-850 rounded p-2.5 text-[11px] font-mono text-neutral-400 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-neutral-300 font-semibold">Rules:</span>
          <span className="px-1.5 py-0.5 rounded bg-neutral-900 text-neutral-300 border border-neutral-800">
            Dedupe: 1 event / zone / day
          </span>
          <span className="px-1.5 py-0.5 rounded bg-neutral-900 text-neutral-300 border border-neutral-800">
            Rate Limit: max 1 alert / zone / 30m
          </span>
          <span className="px-1.5 py-0.5 rounded bg-neutral-900 text-neutral-300 border border-neutral-800">
            Events: APPROACH (5 pts) · TOUCH · BROKEN · PUBLISH
          </span>
        </div>
        <div className="text-neutral-500 text-[10px]">
          Persisted to atlas_history.json
        </div>
      </div>

      {/* Alert Log Mini-Table */}
      <div className="mt-4">
        <div className="flex items-center justify-between pb-2">
          <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-400 font-semibold">
            RECENT SENT ALERTS (LAST 10)
          </span>
          <span className="text-[10px] font-mono text-neutral-500">
            {alertLogs.length} logged
          </span>
        </div>

        {alertLogs.length === 0 ? (
          <div className="py-6 text-center text-xs font-mono text-neutral-500 border border-neutral-850 rounded bg-neutral-950/30">
            NO ALERTS LOGGED YET TODAY. (Turn alerts ON and wait for market triggers or send a Test Dispatch).
          </div>
        ) : (
          <div className="overflow-x-auto border border-neutral-800 rounded">
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="border-b border-neutral-800 text-neutral-400 text-[10px] uppercase tracking-wider bg-neutral-950/70">
                  <th className="py-2 px-3">Time</th>
                  <th className="py-2 px-3">Event</th>
                  <th className="py-2 px-3">Zone / Tier</th>
                  <th className="py-2 px-3">Price</th>
                  <th className="py-2 px-3">Message</th>
                  <th className="py-2 px-3">Delivery</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-850">
                {alertLogs.slice(0, 10).map((log) => {
                  const eventColor =
                    log.eventType === 'APPROACH'
                      ? 'text-amber-400 bg-amber-500/10 border-amber-500/30'
                      : log.eventType === 'TOUCH'
                      ? 'text-sky-400 bg-sky-500/10 border-sky-500/30'
                      : log.eventType === 'BROKEN'
                      ? 'text-rose-400 bg-rose-500/10 border-rose-500/30'
                      : 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';

                  const statusColor =
                    log.status === 'SENT'
                      ? 'text-emerald-400'
                      : log.status === 'SKIPPED'
                      ? 'text-neutral-500'
                      : 'text-rose-400';

                  const timeStr = log.timestamp
                    ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    : '—';

                  return (
                    <tr key={log.id} className="hover:bg-neutral-900/40 transition">
                      <td className="py-2 px-3 text-neutral-400 whitespace-nowrap text-[11px] flex items-center gap-1">
                        <Clock className="w-3 h-3 text-neutral-500" />
                        {timeStr}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${eventColor}`}>
                          {log.eventType}
                        </span>
                      </td>
                      <td className="py-2 px-3 font-semibold text-neutral-200 whitespace-nowrap">
                        {log.tier || log.zoneId ? `${log.tier || ''} ${log.zoneName ? `(${log.zoneName})` : ''}` : 'DAILY PUBLISH'}
                      </td>
                      <td className="py-2 px-3 text-neutral-300 whitespace-nowrap">
                        ${log.price?.toFixed(2) || '—'}
                      </td>
                      <td className="py-2 px-3 text-neutral-300 text-[11px] max-w-xs truncate" title={log.message}>
                        {log.message}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span className={`text-[10px] font-bold ${statusColor}`}>
                          {log.status === 'SENT' ? '✓ SENT' : log.status === 'SKIPPED' ? '○ SKIPPED' : '✕ FAILED'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-3 text-[10px] text-neutral-500 font-mono italic">
        Analysis, not a signal · Sent with SARRAF ATLAS institutional branding
      </div>
    </div>
  );
};
