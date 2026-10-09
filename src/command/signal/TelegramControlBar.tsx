import React, { useState } from 'react';
import { TelegramCommandStatus, TelegramReasonCode } from './types';
import { useMarket } from '../../context/MarketContext';
import {
  Send,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Power,
  FileText,
  Clock,
  RefreshCw,
  Zap,
  Square,
  Lock,
  X,
} from 'lucide-react';

interface TelegramControlBarProps {
  status: TelegramCommandStatus;
  onToggleMaster: (enabled?: boolean) => Promise<void>;
  onTogglePaper: (sendPaper?: boolean) => Promise<void>;
  onSendTest: () => Promise<{ success: boolean; message: string }>;
  onStartSignals: () => Promise<{ success: boolean; message: string; reasonCode?: TelegramReasonCode }>;
  onStopSignals: () => Promise<{ success: boolean; message: string }>;
  httpError?: string | null;
  onClearHttpError?: () => void;
  isLoading: boolean;
}

export const TelegramControlBar: React.FC<TelegramControlBarProps> = ({
  status,
  onToggleMaster,
  onTogglePaper,
  onSendTest,
  onStartSignals,
  onStopSignals,
  httpError,
  onClearHttpError,
  isLoading,
}) => {
  const { openLoginModal } = useMarket();
  const [feedback, setFeedback] = useState<{ text: string; isError: boolean } | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);

  // One-tap START SIGNALS handler
  const handleStartSignals = async () => {
    setIsStarting(true);
    setFeedback(null);
    if (onClearHttpError) onClearHttpError();
    try {
      const res = await onStartSignals();
      if (res.success) {
        setFeedback({ text: 'Telegram message delivered. SARRAF signals are LIVE.', isError: false });
      } else {
        setFeedback({ text: res.message || 'START SIGNALS failed', isError: true });
      }
    } catch (err: any) {
      setFeedback({ text: err.message || 'Dispatch failed', isError: true });
    } finally {
      setIsStarting(false);
    }
  };

  // STOP SIGNALS handler
  const handleStopSignals = async () => {
    setIsStopping(true);
    setFeedback(null);
    if (onClearHttpError) onClearHttpError();
    try {
      const res = await onStopSignals();
      setFeedback({ text: res.message || 'Telegram dispatch stopped.', isError: false });
      setTimeout(() => setFeedback(null), 4000);
    } catch (err: any) {
      setFeedback({ text: err.message || 'Failed to stop signals', isError: true });
    } finally {
      setIsStopping(false);
    }
  };

  // SEND TEST MESSAGE handler
  const handleTestClick = async () => {
    setIsSendingTest(true);
    setFeedback(null);
    if (onClearHttpError) onClearHttpError();
    try {
      const res = await onSendTest();
      setFeedback({
        text: res.message,
        isError: !res.success,
      });
      setTimeout(() => setFeedback(null), 5000);
    } catch {
      setFeedback({ text: 'Dispatch failed', isError: true });
      setTimeout(() => setFeedback(null), 5000);
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

  // Plain words explanation of current reason code
  const getReasonExplanation = (): { text: string; color: string } => {
    switch (status.reasonCode) {
      case 'OK':
        return {
          text: status.enabled ? 'Telegram signals active & verified.' : 'Bot verified & ready. Tap START SIGNALS to go live.',
          color: 'text-[#22e08a]',
        };
      case 'NOT_ADMIN':
        return {
          text: 'Admin privileges required. Please log in to control Telegram dispatch.',
          color: 'text-[#f5a524]',
        };
      case 'MISSING_TOKEN':
        return {
          text: 'TELEGRAM_BOT_TOKEN missing in server environment variables.',
          color: 'text-[#f5a524]',
        };
      case 'MISSING_CHAT_ID':
        return {
          text: 'TELEGRAM_CHAT_ID missing in server environment variables.',
          color: 'text-[#f5a524]',
        };
      case 'BOT_NOT_IN_CHAT':
        return {
          text: status.reasonMessage || 'Bot is not admin in the channel, or cannot message itself.',
          color: 'text-[#ff3b6b]',
        };
      case 'CHAT_NOT_FOUND':
        return {
          text: 'Telegram chat not found. Check channel username or chat ID.',
          color: 'text-[#ff3b6b]',
        };
      case 'SEND_FAILED':
        return {
          text: status.reasonMessage || 'Telegram message delivery failed.',
          color: 'text-[#ff3b6b]',
        };
      default:
        return { text: status.reasonMessage || 'Status verified.', color: 'text-[#8a96a8]' };
    }
  };

  const reasonInfo = getReasonExplanation();
  const isActionDisabled = isLoading || isStarting || isStopping || !status.configured || !status.isAdmin;

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
              Delivery failed
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

      {/* Row 2: One-Tap Launch Controls & Master Toggles */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* ONE TAP: START SIGNALS BUTTON */}
          {!status.enabled ? (
            <button
              onClick={handleStartSignals}
              disabled={isActionDisabled}
              title={!status.isAdmin ? 'Admin login required' : !status.configured ? 'Telegram not configured' : 'Verify bot, announce live, and turn on signals in one tap'}
              className={`inline-flex items-center gap-1.5 text-[9.5px] font-bold px-3 py-1 rounded border transition-all cursor-pointer shadow-sm ${
                isActionDisabled
                  ? 'opacity-40 cursor-not-allowed bg-white/5 text-[#8a96a8] border-white/10'
                  : 'bg-[#22e08a]/20 text-[#22e08a] border-[#22e08a]/50 hover:bg-[#22e08a]/30 hover:border-[#22e08a] animate-pulse'
              }`}
            >
              {isStarting ? (
                <RefreshCw className="w-3 h-3 animate-spin text-[#22e08a]" />
              ) : (
                <Zap className="w-3 h-3 text-[#22e08a]" />
              )}
              <span>{isStarting ? 'VERIFYING & LAUNCHING...' : 'START SIGNALS'}</span>
            </button>
          ) : (
            <button
              onClick={handleStopSignals}
              disabled={isLoading || isStopping || !status.isAdmin}
              title="Stop Telegram dispatch and turn all signals OFF"
              className="inline-flex items-center gap-1.5 text-[9.5px] font-bold px-3 py-1 rounded border transition-all cursor-pointer bg-[#ff3b6b]/20 text-[#ff3b6b] border-[#ff3b6b]/50 hover:bg-[#ff3b6b]/30 hover:border-[#ff3b6b]"
            >
              {isStopping ? (
                <RefreshCw className="w-3 h-3 animate-spin text-[#ff3b6b]" />
              ) : (
                <Square className="w-3 h-3 text-[#ff3b6b]" />
              )}
              <span>{isStopping ? 'STOPPING...' : 'STOP SIGNALS'}</span>
            </button>
          )}

          {/* Master Telegram Toggle (Default OFF) */}
          <button
            onClick={() => onToggleMaster()}
            disabled={isActionDisabled}
            title={!status.configured ? 'Telegram credentials missing in environment' : 'Toggle Telegram dispatch'}
            className={`inline-flex items-center gap-1.5 text-[9px] font-bold px-2 py-1 rounded border transition-colors cursor-pointer ${
              isActionDisabled
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
            disabled={isActionDisabled}
            title={
              !status.configured
                ? 'Telegram not configured'
                : 'Send PAPER signals to Telegram (default OFF)'
            }
            className={`inline-flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded border transition-colors cursor-pointer ${
              isActionDisabled
                ? 'opacity-40 cursor-not-allowed bg-white/5 text-[#8a96a8] border-white/5'
                : status.sendPaperSignals
                ? 'bg-[#E8B84A]/10 text-[#E8B84A] border-[#E8B84A]/30 hover:bg-[#E8B84A]/20'
                : 'bg-white/5 text-[#8a96a8] border-white/10 hover:bg-white/10'
            }`}
          >
            <FileText className="w-2.5 h-2.5" />
            <span>PAPER: {status.sendPaperSignals ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        {/* Send Test Message Button */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleTestClick}
            disabled={isSendingTest || isActionDisabled}
            title={!status.configured ? 'Telegram not configured' : 'Dispatch test message to verified Telegram chat'}
            className={`inline-flex items-center gap-1.5 text-[9px] font-bold px-2.5 py-1 rounded border transition-all cursor-pointer ${
              isActionDisabled
                ? 'opacity-40 cursor-not-allowed bg-white/5 text-[#8a96a8] border-white/5'
                : 'bg-[#38bdf8]/10 text-[#38bdf8] border-[#38bdf8]/30 hover:bg-[#38bdf8]/20'
            }`}
          >
            {isSendingTest ? (
              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
            ) : (
              <Send className="w-2.5 h-2.5" />
            )}
            <span>TEST MESSAGE</span>
          </button>
        </div>
      </div>

      {/* Row 3: Plain Words Reason & Status Explanation */}
      <div className="mt-2 pt-1.5 border-t border-white/5 flex flex-wrap items-center justify-between gap-1.5 text-[8.5px]">
        <div className="flex items-center gap-1.5">
          <span className="text-[#8a96a8] font-semibold">DIAGNOSTIC:</span>
          <span className={`font-medium ${reasonInfo.color}`}>
            {reasonInfo.text}
          </span>
        </div>

        {/* Quick Admin Login button if user is unauthenticated */}
        {!status.isAdmin && (
          <button
            onClick={openLoginModal}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#f5a524]/10 text-[#f5a524] border border-[#f5a524]/30 hover:bg-[#f5a524]/20 transition-colors cursor-pointer text-[8px] font-bold"
          >
            <Lock className="w-2.5 h-2.5" />
            <span>LOG IN AS ADMIN</span>
          </button>
        )}
      </div>

      {/* HTTP Error Banner if a network/auth request fails */}
      {httpError && (
        <div className="mt-2 px-2.5 py-1 rounded bg-[#ff3b6b]/15 border border-[#ff3b6b]/40 text-[#ff3b6b] text-[8.5px] flex items-center justify-between">
          <span>Request error: {httpError}</span>
          {onClearHttpError && (
            <button onClick={onClearHttpError} className="p-0.5 hover:text-white cursor-pointer">
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      )}

      {/* Action Feedback Notice (e.g. Success: Telegram message delivered) */}
      {feedback && (
        <div
          className={`mt-2 px-2.5 py-1 rounded text-[8.5px] border flex items-center justify-between ${
            feedback.isError
              ? 'bg-[#ff3b6b]/10 text-[#ff3b6b] border-[#ff3b6b]/30'
              : 'bg-[#22e08a]/15 text-[#22e08a] border-[#22e08a]/40 shadow-[0_0_10px_rgba(34,224,138,0.1)]'
          }`}
        >
          <div className="flex items-center gap-1.5">
            {feedback.isError ? (
              <XCircle className="w-3 h-3 text-[#ff3b6b]" />
            ) : (
              <CheckCircle2 className="w-3 h-3 text-[#22e08a]" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="p-0.5 hover:opacity-75 cursor-pointer">
            <X className="w-2.5 h-2.5" />
          </button>
        </div>
      )}

      {/* Not Configured Notice */}
      {!status.configured && (
        <div className="mt-2 px-2 py-1 rounded bg-[#f5a524]/5 border border-[#f5a524]/20 text-[8.5px] text-[#f5a524]">
          Telegram credentials missing. Set <code className="bg-black/30 px-1 py-0.5 rounded">TELEGRAM_BOT_TOKEN</code> and <code className="bg-black/30 px-1 py-0.5 rounded">TELEGRAM_CHAT_ID</code> in Railway environment variables.
        </div>
      )}
    </div>
  );
};
