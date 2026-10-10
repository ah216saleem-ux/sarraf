import React from 'react';
import { SpyExpiryOption, SpyExpiryStatus } from '../types';
import { Clock, Lock, ShieldAlert } from 'lucide-react';

interface SpyExpiryChipsProps {
  selectedExpiry: SpyExpiryOption;
  onSelectExpiry: (expiry: SpyExpiryOption) => void;
  options: SpyExpiryStatus[];
  disabledAll?: boolean;
}

export const SpyExpiryChips: React.FC<SpyExpiryChipsProps> = ({
  selectedExpiry,
  onSelectExpiry,
  options,
  disabledAll = false,
}) => {
  const defaultOptions: SpyExpiryStatus[] = [
    { expiry: '15m', label: '15 MIN', durationMinutes: 15, enabled: true },
    { expiry: '30m', label: '30 MIN', durationMinutes: 30, enabled: true },
    { expiry: '45m', label: '45 MIN', durationMinutes: 45, enabled: true },
    { expiry: '1H', label: '1 HOUR', durationMinutes: 60, enabled: true },
    { expiry: '4H', label: '4 HOURS', durationMinutes: 240, enabled: true },
    { expiry: 'CLOSE', label: 'MARKET CLOSE', durationMinutes: 390, enabled: true },
  ];

  const displayOptions = options.length > 0 ? options : defaultOptions;

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-xl bg-black/40 border border-white/5">
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-[#E8B84A]" />
        <span className="font-mono text-xs font-bold text-neutral-300 tracking-wider">
          EXPIRY TARGET HORIZON:
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {displayOptions.map((opt) => {
          const isSelected = selectedExpiry === opt.expiry;
          const isDisabled = disabledAll || !opt.enabled;

          return (
            <button
              key={opt.expiry}
              disabled={isDisabled}
              onClick={() => onSelectExpiry(opt.expiry)}
              title={opt.disabledReason || `Target ${opt.label} deterministic options setup`}
              className={`relative px-3.5 py-1.5 rounded-lg font-mono text-xs font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
                isSelected && !isDisabled
                  ? 'bg-[#E8B84A] text-black border-[#E8B84A] shadow-[0_0_12px_rgba(232,184,74,0.4)]'
                  : isDisabled
                  ? 'bg-neutral-900/50 text-neutral-600 border-neutral-800/60 cursor-not-allowed opacity-60'
                  : 'bg-white/5 text-neutral-300 border-white/10 hover:border-[#E8B84A]/40 hover:text-white'
              }`}
            >
              <span>{opt.label}</span>

              {opt.isLocked && (
                <span className="inline-flex items-center text-[9px] px-1 py-0.2 rounded bg-amber-950/60 text-amber-400 border border-amber-500/30">
                  <Lock className="w-2.5 h-2.5 mr-0.5" />
                  {opt.isCooldown ? 'COOLDOWN' : 'ACTIVE'}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
