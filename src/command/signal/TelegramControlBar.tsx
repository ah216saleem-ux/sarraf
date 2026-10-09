import React, { useState } from 'react';
import { TelegramCommandStatus } from './types';
import { Send, CheckCircle2, AlertTriangle, XCircle, Power, FileText, Clock, RefreshCw } from 'lucide-react';

interface TelegramControlBarProps {
  status: TelegramCommandStatus;
  onToggleMaster: (enabled?: boolean) => Promise<void>;
  onTogglePaper: (sendPaper?: boolean) => Promise<void>;
  onSendTest: () => Promise<{ success: boolean; message: string }>;
  isLoading: boolean;
}

export const TelegramControlBar: React.FC<TelegramControlBarProps> = ({
  status,
  onToggleMaster,
  onTogglePaper,
  onSendTest,
  isLoading,
}) => {
  const [testResult, setTestResult] = useState<{ text: string; isError: boolean } | null>(null);
  const [isSendingTest, setIsSendingTest] = useState(false);

  const handleTestClick = async () => {
    setIsSendingTest(true);
    setTestResult(null);
    try {
      const res = await onSendTest();
      setTestResult({
        text: res.message,
        isError: !res.success,
      });
      setTimeout(() => setTestResult(null), 5000);
    } catch {
      setTestResult({ text: 'Dispatch failed', isError: true });
      setTimeout(() => setTestResult(null), 5000);
    } finally {
      setIsSendingTest(false);
    }
  };

  // Determine status display tokens
  let statusBadgeText = 'Disabled';
  let statusBadgeStyle = 'bg-white/5 text-[#8a96a8] border-white/5';
  let StatusIcon = Power;

  if (!status.configured) {
    statusBadgeText = 'Not configured';
    statusBadgeStyle = 'bg-[#f5a524]/10 text-[#f5a524] border-[#f5a524]/30';
    StatusIcon = AlertTriangle;
  } else if (status.hasFailed || status.status === 'FAILED') {
    statusBadgeText = 'Failed';
    statusBadgeStyle = 'bg-[#ff3b6b]/10 text-[#ff3b6b] border-[#ff3b6b]/30';
    StatusIcon = XCircle;
  } else if (status.enabled) {
    statusBadgeText = 'Connected';
    statusBadgeStyle = 'bg-[#22e08a]/10 text-[#22e08a] border-[#22e08a]/30';
    StatusIcon = CheckCircle2;
  } else {
    statusBadgeText = 'Disabled';
    statusBadgeStyle = 'bg-white/5 text-[#8a96a8] border-white/5';
    StatusIcon = Power;
  }

  return (
    <div className="relative rounded-lg bg-[#070b14] border border-[#38bdf8]/20 px-3.5 py-2.5 flex flex-col justify-between overflow-hidden shadow-md select-none font-mono">
      {/* Top subtle glow bar */}
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#38bdf8]/30 to-transparent" />

      {/* Row 1: Header, Status Badge & Last Message */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold tracking-[0.14em] text-[#38bdf8] uppercase flex items-center gap-1.5">
            <Send className="w-3 h-3 text-[#38bdf8]" />
            TELEGRAM DISPATCH
          </span>

          {/* Status Badge */}
          <div className={`inline-flex items-center gap-1 text-[8.5px] font-bold px-2 py-0.5 rounded border ${statusBadgeStyle}`}>
            <StatusIcon className="w-2.5 h-2.5" />
            <span>{statusBadgeText}</span>
          </div>

          {/* Failed badge if last message failed */}
          {(status.hasFailed || status.status === 'FAILED') && (
            <span
              className="inline-flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#ff3b6b]/15 text-[#ff3b6b] border border-[#ff3b6b]/30"
              title={status.lastError || 'Last delivery attempt failed'}
            >
              Telegram failed
            </span>
          )}
        </div>

        {/* Status Line: Last Message Time */}
        <div className="flex items-center gap-1.5 text-[8.5px] text-[#8a96a8]">
          <Clock className="w-2.5 h-2.5 text-[#8a96a8]" />
          <span>
            {status.lastMessageTimeStr ? `Last sent: ${status.lastMessageTimeStr}` : 'Last sent: None'}
          </span>
        </div>
      </div>

      {/* Row 2: Controls & Test Button */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Master Telegram Toggle (Default OFF) */}
          <button
            onClick={() => onToggleMaster()}
            disabled={isLoading || !status.configured}
            title={!status.configured ? 'Telegram credentials missing in environment' : 'Toggle Telegram dispatch'}
            className={`inline-flex items-center gap-1.5 text-[9px] font-bold px-2.5 py-1 rounded border transition-colors cursor-pointer ${
              !status.configured
                ? 'opacity-40 cursor-not-allowed bg-white/5 text-[#8a96a8] border-white/5'
                : status.enabled
                ? 'bg-[#22e08a]/10 text-[#22e08a] border-[#22e08a]/30 hover:bg-[#22e08a]/20'
                : 'bg-white/5 text-[#8a96a8] border-white/10 hover:bg-white/10'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${status.enabled ? 'bg-[#22e08a]' : 'bg-[#8a96a8]'}`} />
            <span>TELEGRAM: {status.enabled ? 'ON' : 'OFF'}</span>
          </button>

          {/* Send Paper Signals Toggle (Default OFF) */}
          <button
            onClick={() => onTogglePaper()}
            disabled={isLoading || !status.configured}
            title={
              !status.configured
                ? 'Telegram not configured'
                : 'Send PAPER signals to Telegram (default OFF)'
            }
            className={`inline-flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded border transition-colors cursor-pointer ${
              !status.configured
                ? 'opacity-40 cursor-not-allowed bg-white/5 text-[#8a96a8] border-white/5'
                : status.sendPaperSignals
                ? 'bg-[#E8B84A]/10 text-[#E8B84A] border-[#E8B84A]/30 hover:bg-[#E8B84A]/20'
                : 'bg-white/5 text-[#8a96a8] border-white/10 hover:bg-white/10'
            }`}
          >
            <FileText className="w-2.5 h-2.5" />
            <span>PAPER SIGNALS: {status.sendPaperSignals ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        {/* Send Test Message Button */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleTestClick}
            disabled={isSendingTest || !status.configured}
            title={!status.configured ? 'Telegram not configured' : 'Dispatch test message to verified Telegram chat'}
            className={`inline-flex items-center gap-1.5 text-[9px] font-bold px-2.5 py-1 rounded border transition-all cursor-pointer ${
              !status.configured
                ? 'opacity-40 cursor-not-allowed bg-white/5 text-[#8a96a8] border-white/5'
                : 'bg-[#38bdf8]/10 text-[#38bdf8] border-[#38bdf8]/30 hover:bg-[#38bdf8]/20'
            }`}
          >
            {isSendingTest ? (
              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
            ) : (
              <Send className="w-2.5 h-2.5" />
            )}
            <span>SEND TEST MESSAGE</span>
          </button>
        </div>
      </div>

      {/* Test Feedback Notice */}
      {testResult && (
        <div className={`mt-2 px-2 py-1 rounded text-[8.5px] border ${
          testResult.isError ? 'bg-[#ff3b6b]/10 text-[#ff3b6b] border-[#ff3b6b]/30' : 'bg-[#22e08a]/10 text-[#22e08a] border-[#22e08a]/30'
        }`}>
          {testResult.text}
        </div>
      )}

      {/* Not Configured Notice */}
      {!status.configured && (
        <div className="mt-2 px-2 py-1 rounded bg-[#f5a524]/5 border border-[#f5a524]/20 text-[8.5px] text-[#f5a524]">
          Telegram not configured. Set <code className="bg-black/30 px-1 py-0.5 rounded">TELEGRAM_BOT_TOKEN</code> and <code className="bg-black/30 px-1 py-0.5 rounded">TELEGRAM_CHAT_ID</code> in Railway environment variables.
        </div>
      )}
    </div>
  );
};
