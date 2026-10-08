import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings,
  Shield,
  Save,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Clock,
  Zap,
  Sliders,
  Sparkles,
  History,
  Activity,
  Send,
} from 'lucide-react';

export const SettingsTab: React.FC = () => {
  const [settings, setSettings] = useState<any>({
    slDollars: 10.0,
    tp1Dollars: 5.0,
    tp2Dollars: 8.0,
    tp3Dollars: 10.0,
    tp4Dollars: 12.0,
    cooldownMinMinutes: 30,
    cooldownMaxMinutes: 45,
    minScore: 80,
    maxSignalsPerDay: 3,
    newsLockPreMinutes: 30,
    newsLockPostMinutes: 15,
    spreadLimit: 0.6,
    dryRun: false,
    displayTz: 'UTC',
    geminiValidatorEnabled: true,
    newsHeadsUpTelegram: false,
    oneSignalAtATime: true,
  });

  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [formState, setFormState] = useState<any>({ ...settings });
  const [isSaving, setIsSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [isDryRunModalOpen, setIsDryRunModalOpen] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState<any>(null);
  const [customChatId, setCustomChatId] = useState('');
  const [isUpdatingChat, setIsUpdatingChat] = useState(false);

  const fetchTelegramStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/telegram/status');
      if (res.ok) {
        const json = await res.json();
        setTelegramStatus(json.data);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleSaveChatId = async () => {
    if (!customChatId.trim()) return;
    setIsUpdatingChat(true);
    try {
      const res = await fetch('/api/telegram/set-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: customChatId.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setActionNotice(data.message || 'Chat ID registered successfully!');
        setCustomChatId('');
        fetchTelegramStatus();
      } else {
        setValidationErrors([data.error || 'Failed to update Chat ID']);
      }
    } catch (err: any) {
      setValidationErrors([err.message || 'Error updating Chat ID']);
    } finally {
      setIsUpdatingChat(false);
    }
  };

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const json = await res.json();
        setSettings(json.settings);
        setFormState(json.settings);
        setAuditLog(json.audit || []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchTelegramStatus();
  }, [fetchSettings, fetchTelegramStatus]);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    setValidationErrors([]);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formState),
      });

      const json = await res.json();
      if (!res.ok) {
        setValidationErrors(json.errors || [json.error || 'Validation error']);
      } else {
        setSettings(json.settings);
        setFormState(json.settings);
        setActionNotice('Settings validated & applied to new signals.');
        fetchSettings();
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    const confirmed = window.confirm(
      'Reset all engine risk parameters and thresholds to institutional defaults?'
    );
    if (!confirmed) return;

    try {
      const res = await fetch('/api/settings/reset', { method: 'POST' });
      if (res.ok) {
        const json = await res.json();
        setSettings(json.settings);
        setFormState(json.settings);
        setActionNotice('Settings reset to institutional defaults.');
        fetchSettings();
      }
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Notice */}
      {actionNotice && (
        <div className="bg-[#E8B84A]/10 border border-[#E8B84A]/30 rounded-xl p-3 flex items-center justify-between font-mono text-xs text-[#FFD97A]">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#E8B84A]" />
            <span>{actionNotice}</span>
          </div>
          <button onClick={() => setActionNotice(null)} className="text-neutral-400 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* Validation Errors Box */}
      {validationErrors.length > 0 && (
        <div className="bg-rose-950/40 border border-rose-800/60 rounded-xl p-4 font-mono text-xs text-rose-300 space-y-1.5">
          <div className="font-bold flex items-center gap-2 text-rose-200">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            <span>SETTINGS VALIDATION REJECTED:</span>
          </div>
          <ul className="list-disc list-inside space-y-0.5 text-rose-300">
            {validationErrors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Header */}
      <div className="glass-panel p-5 sm:p-6 rounded-2xl border border-[#E8B84A]/25 relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-[#E8B84A]/10 border border-[#E8B84A]/30 text-[#FFD97A]">
              <Sliders className="w-5 h-5" />
            </span>
            <div>
              <h2 className="font-mono text-base font-bold text-white tracking-wide flex items-center gap-2">
                SARRAF ENGINE RISK & EXECUTION PARAMETERS
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-700/50 text-emerald-400 font-mono">
                  ADMIN ONLY
                </span>
              </h2>
              <p className="text-xs text-neutral-400 font-mono">
                Persistent runtime configurations stored in DATA_DIR. Changes apply exclusively to upcoming setups.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-mono text-xs text-neutral-300 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Defaults</span>
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 bg-[#E8B84A] hover:bg-[#FFD97A] text-black font-mono font-bold text-xs rounded-xl shadow-[0_0_12px_rgba(232,184,74,0.3)] flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'Validating...' : 'Save Changes'}</span>
            </button>
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-12 gap-6 font-mono text-xs">
        {/* Left Column (7 cols): Core Risk & TP/SL Sliders */}
        <div className="lg:col-span-7 space-y-6">
          {/* Target Objectives Section */}
          <div className="glass-panel p-5 rounded-2xl border border-white/10 space-y-4">
            <h3 className="text-sm font-bold text-white tracking-wider flex items-center gap-2 pb-3 border-b border-white/10">
              <Zap className="w-4 h-4 text-[#FFD97A]" />
              <span>TARGET LEVELS & FIXED STOP LOSS</span>
            </h3>

            {/* Stop Loss Input */}
            <div className="space-y-1.5 bg-black/40 p-3 rounded-xl border border-white/5">
              <div className="flex justify-between items-center">
                <label className="text-neutral-300 font-bold">Fixed Stop Loss ($5.00 - $20.00):</label>
                <span className="text-rose-400 font-bold">${Number(formState.slDollars).toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={5}
                max={20}
                step={0.5}
                value={formState.slDollars}
                onChange={(e) => setFormState({ ...formState, slDollars: parseFloat(e.target.value) })}
                className="w-full accent-[#E8B84A] cursor-pointer"
              />
              <p className="text-[10px] text-neutral-500">
                Determines maximum dollar risk per ounce from entry level before invalidation.
              </p>
            </div>

            {/* Take Profit Targets (TP1 - TP4) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div className="bg-black/40 p-3 rounded-xl border border-white/5 space-y-1">
                <span className="text-[10px] text-neutral-400 block uppercase">TP1 (+$)</span>
                <input
                  type="number"
                  step={0.5}
                  value={formState.tp1Dollars}
                  onChange={(e) => setFormState({ ...formState, tp1Dollars: parseFloat(e.target.value) })}
                  className="w-full bg-black border border-white/15 rounded-lg px-2.5 py-1.5 text-emerald-400 font-bold text-center focus:border-[#E8B84A] focus:outline-none"
                />
                <span className="text-[9px] text-neutral-500 block text-center">SL to Breakeven</span>
              </div>

              <div className="bg-black/40 p-3 rounded-xl border border-white/5 space-y-1">
                <span className="text-[10px] text-neutral-400 block uppercase">TP2 (+$)</span>
                <input
                  type="number"
                  step={0.5}
                  value={formState.tp2Dollars}
                  onChange={(e) => setFormState({ ...formState, tp2Dollars: parseFloat(e.target.value) })}
                  className="w-full bg-black border border-white/15 rounded-lg px-2.5 py-1.5 text-emerald-400 font-bold text-center focus:border-[#E8B84A] focus:outline-none"
                />
                <span className="text-[9px] text-neutral-500 block text-center">Scale 2</span>
              </div>

              <div className="bg-black/40 p-3 rounded-xl border border-white/5 space-y-1">
                <span className="text-[10px] text-neutral-400 block uppercase">TP3 (+$)</span>
                <input
                  type="number"
                  step={0.5}
                  value={formState.tp3Dollars}
                  onChange={(e) => setFormState({ ...formState, tp3Dollars: parseFloat(e.target.value) })}
                  className="w-full bg-black border border-white/15 rounded-lg px-2.5 py-1.5 text-emerald-400 font-bold text-center focus:border-[#E8B84A] focus:outline-none"
                />
                <span className="text-[9px] text-neutral-500 block text-center">Scale 3</span>
              </div>

              <div className="bg-black/40 p-3 rounded-xl border border-white/5 space-y-1">
                <span className="text-[10px] text-neutral-400 block uppercase">TP4 (+$)</span>
                <input
                  type="number"
                  step={0.5}
                  value={formState.tp4Dollars}
                  onChange={(e) => setFormState({ ...formState, tp4Dollars: parseFloat(e.target.value) })}
                  className="w-full bg-black border border-white/15 rounded-lg px-2.5 py-1.5 text-emerald-400 font-bold text-center focus:border-[#E8B84A] focus:outline-none"
                />
                <span className="text-[9px] text-neutral-500 block text-center">Final Close</span>
              </div>
            </div>
          </div>

          {/* Timing & Cooldown Rules */}
          <div className="glass-panel p-5 rounded-2xl border border-white/10 space-y-4">
            <h3 className="text-sm font-bold text-white tracking-wider flex items-center gap-2 pb-3 border-b border-white/10">
              <Clock className="w-4 h-4 text-[#FFD97A]" />
              <span>COOLDOWN & FREQUENCY GATES</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 bg-black/40 p-3 rounded-xl border border-white/5">
                <label className="text-neutral-300 font-bold block">Cooldown Min (≥ 20 min):</label>
                <input
                  type="number"
                  min={20}
                  max={120}
                  value={formState.cooldownMinMinutes}
                  onChange={(e) => setFormState({ ...formState, cooldownMinMinutes: parseInt(e.target.value) })}
                  className="w-full bg-black border border-white/15 rounded-lg px-3 py-1.5 text-white focus:border-[#E8B84A] focus:outline-none"
                />
              </div>

              <div className="space-y-1.5 bg-black/40 p-3 rounded-xl border border-white/5">
                <label className="text-neutral-300 font-bold block">Cooldown Max (min):</label>
                <input
                  type="number"
                  min={formState.cooldownMinMinutes}
                  max={180}
                  value={formState.cooldownMaxMinutes}
                  onChange={(e) => setFormState({ ...formState, cooldownMaxMinutes: parseInt(e.target.value) })}
                  className="w-full bg-black border border-white/15 rounded-lg px-3 py-1.5 text-white focus:border-[#E8B84A] focus:outline-none"
                />
              </div>

              <div className="space-y-1.5 bg-black/40 p-3 rounded-xl border border-white/5 opacity-75">
                <label className="text-neutral-300 font-bold block">Daily Signal Limit:</label>
                <input
                  type="text"
                  disabled
                  value="Unlimited (No Daily Cap)"
                  className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-1.5 text-neutral-400 focus:outline-none cursor-not-allowed font-medium text-xs"
                />
              </div>

              <div className="space-y-1.5 bg-black/40 p-3 rounded-xl border border-white/5">
                <label className="text-neutral-300 font-bold block">Min Engine Score (80 - 100):</label>
                <input
                  type="number"
                  min={80}
                  max={100}
                  value={formState.minScore}
                  onChange={(e) => setFormState({ ...formState, minScore: parseInt(e.target.value) })}
                  className="w-full bg-black border border-white/15 rounded-lg px-3 py-1.5 text-white focus:border-[#E8B84A] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Telegram Target Chat Binding & Alerts */}
          <div className="glass-panel p-5 rounded-2xl border border-white/10 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="text-sm font-bold text-white tracking-wider flex items-center gap-2">
                <Send className="w-4 h-4 text-[#29B6F6]" />
                <span>TELEGRAM SIGNAL DISPATCH BINDING</span>
              </h3>
              <span className="text-[10px] font-mono text-[#FFD97A]">
                {telegramStatus?.targetChatIdMasked || 'NOT REGISTERED'}
              </span>
            </div>

            <p className="text-xs text-neutral-300">
              Live automatic gold trades receive krne k liye apna Telegram Chat ID register karein. Agar aapko Chat ID nahi maloom to simply Telegram me <strong>@Sarraftelegrambot</strong> open kar k <strong>START</strong> tap karein (bot automatically apka Chat ID bind kar lega).
            </p>

            <div className="flex items-center gap-3 flex-wrap">
              <input
                type="text"
                placeholder="Enter Chat ID (e.g. 123456789 or @channel)"
                value={customChatId}
                onChange={(e) => setCustomChatId(e.target.value)}
                className="bg-black border border-white/15 rounded-lg px-3 py-1.5 text-white focus:border-[#E8B84A] focus:outline-none font-mono text-xs w-64"
              />
              <button
                type="button"
                onClick={handleSaveChatId}
                disabled={isUpdatingChat || !customChatId.trim()}
                className="px-3.5 py-1.5 rounded-lg bg-[#E8B84A] hover:bg-[#FFD97A] text-black font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                SAVE CHAT ID
              </button>
              <a
                href="https://t.me/Sarraftelegrambot?start=web"
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Send className="w-3 h-3" />
                <span>OPEN @Sarraftelegrambot</span>
              </a>
            </div>
          </div>

          {/* Automated Telegram Summaries & Reports */}
          <div className="glass-panel p-5 rounded-2xl border border-white/10 space-y-4">
            <h3 className="text-sm font-bold text-white tracking-wider flex items-center gap-2 pb-3 border-b border-white/10">
              <Zap className="w-4 h-4 text-[#FFD97A]" />
              <span>AUTOMATED TELEGRAM SUMMARIES & REPORTS</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2 bg-black/40 p-3.5 rounded-xl border border-white/5">
                <div className="flex items-center justify-between">
                  <label className="text-neutral-200 font-bold">Daily Summary:</label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={formState.dailySummaryEnabled ?? true}
                      onChange={(e) => setFormState({ ...formState, dailySummaryEnabled: e.target.checked })}
                      className="accent-[#E8B84A]"
                    />
                    <span className={formState.dailySummaryEnabled ? 'text-emerald-400 font-bold' : 'text-neutral-500'}>
                      {formState.dailySummaryEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </label>
                </div>
                <div className="space-y-1">
                  <span className="text-[11px] text-neutral-400 block">Scheduled UTC Time (HH:MM):</span>
                  <input
                    type="text"
                    placeholder="22:30"
                    value={formState.dailySummaryTimeUtc || '22:30'}
                    onChange={(e) => setFormState({ ...formState, dailySummaryTimeUtc: e.target.value })}
                    className="w-full bg-black border border-white/15 rounded-lg px-3 py-1.5 text-white focus:border-[#E8B84A] focus:outline-none font-mono text-xs"
                  />
                  <span className="text-[10px] text-neutral-500 block">
                    Displays in <strong>{formState.displayTz || 'UTC'}</strong> timezone. Counts closed trades of that UTC day.
                  </span>
                </div>
              </div>

              <div className="space-y-2 bg-black/40 p-3.5 rounded-xl border border-white/5">
                <div className="flex items-center justify-between">
                  <label className="text-neutral-200 font-bold">Weekly Report (Friday):</label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={formState.weeklyReportEnabled ?? true}
                      onChange={(e) => setFormState({ ...formState, weeklyReportEnabled: e.target.checked })}
                      className="accent-[#E8B84A]"
                    />
                    <span className={formState.weeklyReportEnabled ? 'text-emerald-400 font-bold' : 'text-neutral-500'}>
                      {formState.weeklyReportEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </label>
                </div>
                <div className="space-y-1">
                  <span className="text-[11px] text-neutral-400 block">Friday UTC Time (HH:MM):</span>
                  <input
                    type="text"
                    placeholder="23:00"
                    value={formState.weeklyReportTimeUtc || '23:00'}
                    onChange={(e) => setFormState({ ...formState, weeklyReportTimeUtc: e.target.value })}
                    className="w-full bg-black border border-white/15 rounded-lg px-3 py-1.5 text-white focus:border-[#E8B84A] focus:outline-none font-mono text-xs"
                  />
                  <span className="text-[10px] text-neutral-500 block">
                    Note: Win rate counts <strong>WIN / (WIN + LOSS)</strong> (breakeven excluded).
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (5 cols): Invariant Rules & Audit History */}
        <div className="lg:col-span-5 space-y-6">
          {/* Institutional Immutable Safety Invariants */}
          <div className="glass-panel p-5 rounded-2xl border border-[#E8B84A]/30 space-y-3 bg-[#E8B84A]/5">
            <h3 className="text-sm font-bold text-white tracking-wider flex items-center gap-2 pb-2 border-b border-white/10">
              <Lock className="w-4 h-4 text-[#FFD97A]" />
              <span>SAFETY INVARIANTS</span>
            </h3>

            <div className="space-y-2 text-[11px] text-neutral-300">
              <div className="flex items-center justify-between p-2 rounded-lg bg-black/50 border border-white/5">
                <span>One Signal At A Time:</span>
                <span className="text-emerald-400 font-bold">IMMUTABLE (ENABLED)</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-black/50 border border-white/5">
                <span>Spread Filter Ceiling:</span>
                <span className="text-[#FFD97A] font-bold">&le; ${formState.spreadLimit.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-black/50 border border-white/5">
                <span>Gemini Validator Gate:</span>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formState.geminiValidatorEnabled}
                    onChange={(e) => setFormState({ ...formState, geminiValidatorEnabled: e.target.checked })}
                    className="accent-[#E8B84A]"
                  />
                  <span className="text-white">{formState.geminiValidatorEnabled ? 'Active' : 'Bypassed'}</span>
                </label>
              </div>
            </div>
          </div>

          {/* Audit History Log */}
          <div className="glass-panel p-5 rounded-2xl border border-white/10 space-y-3">
            <h3 className="text-sm font-bold text-white tracking-wider flex items-center gap-2 pb-2 border-b border-white/10">
              <History className="w-4 h-4 text-neutral-400" />
              <span>AUDIT TRAIL (LAST CHANGES)</span>
            </h3>

            {auditLog.length === 0 ? (
              <p className="text-neutral-500 text-center py-4">No settings changes recorded yet.</p>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {auditLog.slice(0, 10).map((a) => (
                  <div key={a.id} className="p-2.5 rounded-lg bg-black/40 border border-white/5 space-y-1">
                    <div className="flex justify-between items-center text-[10px] text-neutral-400">
                      <span className="font-bold text-[#FFD97A]">{a.field}</span>
                      <span>{new Date(a.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="text-[11px] text-neutral-300">
                      <span className="text-neutral-500">{String(a.oldValue)}</span> &rarr;{' '}
                      <strong className="text-white">{String(a.newValue)}</strong>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </form>
    </div>
  );
};
