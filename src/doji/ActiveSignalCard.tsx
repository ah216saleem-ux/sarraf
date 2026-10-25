// src/doji/ActiveSignalCard.tsx
import React from 'react';
import {
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  Target,
} from 'lucide-react';
import { DojiTrade, computeLivePnl } from './dojiSignalEngine';
import {
  DojiTimeframe,
  DojiZone,
  formatSignedDollar,
  formatOpenedTime,
} from './dojiEngine';

interface ActiveSignalCardProps {
  trade: DojiTrade | null;
  timeframe: DojiTimeframe;
  livePrice: number;
  zones: DojiZone[];
  isMarketClosed?: boolean;
}

export const ActiveSignalCard: React.FC<ActiveSignalCardProps> = ({
  trade,
  timeframe,
  livePrice,
  zones,
  isMarketClosed = false,
}) => {
  if (!trade || trade.status !== 'OPEN') {
    const nearestZone =
      zones.find((z) => z.timeframe === timeframe && !z.isUsed) ||
      zones.find((z) => z.timeframe === timeframe) ||
      zones[0];
    return (
      <div className="p-4 rounded-[12px] bg-[#12100c] border border-[#2b261b] font-['DM_Sans',sans-serif]">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#2b261b]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#9d947e]" />
            <h2 className="text-base font-bold text-[#f0eadb] font-['Bricolage_Grotesque',sans-serif]">
              Active signal
            </h2>
            <span className="px-2 py-0.5 rounded bg-[#1a1711] border border-[#2b261b] text-[#9d947e] text-[11px] font-['JetBrains_Mono',monospace] tabular-nums">
              {timeframe}
            </span>
          </div>
          <span className="text-xs text-[#9d947e]">
            {isMarketClosed ? 'Market closed · last price' : 'Watching closed candles'}
          </span>
        </div>

        <div className="py-5 text-center space-y-1.5">
          <Target className="w-5 h-5 text-[#d9b25a] mx-auto" />
          <div className="text-sm font-medium text-[#f0eadb]">
            No active signal on <span className="font-['JetBrains_Mono',monospace]">{timeframe}</span>
          </div>
          {nearestZone ? (
            <p className="text-xs text-[#9d947e] font-['JetBrains_Mono',monospace] tabular-nums">
              Nearest zone: {nearestZone.low.toFixed(2)} – {nearestZone.high.toFixed(2)} ({nearestZone.strength.toFixed(1)}/10)
            </p>
          ) : (
            <p className="text-xs text-[#9d947e]">
              Scanning for valid zones
            </p>
          )}
        </div>
      </div>
    );
  }

  const isBuy = trade.side === 'BUY';
  const effectivePrice = livePrice > 0 ? livePrice : trade.entryPrice;
  const livePnl = computeLivePnl(trade, effectivePrice);
  const isPnlPositive = livePnl >= 0;
  const openedText = trade.openedDisplay || formatOpenedTime(trade.entryTime);

  const slVal = trade.initialSl;
  const tp3Val = trade.tp3;
  let progressPct = 0;

  if (isBuy) {
    const range = tp3Val - slVal || 1;
    progressPct = ((effectivePrice - slVal) / range) * 100;
  } else {
    const range = slVal - tp3Val || 1;
    progressPct = ((slVal - effectivePrice) / range) * 100;
  }
  const clampedProgress = Math.min(100, Math.max(0, progressPct));

  const entryPct = isBuy
    ? ((trade.entryPrice - slVal) / (tp3Val - slVal || 1)) * 100
    : ((slVal - trade.entryPrice) / (slVal - tp3Val || 1)) * 100;

  const tp1Pct = isBuy
    ? ((trade.tp1 - slVal) / (tp3Val - slVal || 1)) * 100
    : ((slVal - trade.tp1) / (slVal - tp3Val || 1)) * 100;

  const tp2Pct = isBuy
    ? ((trade.tp2 - slVal) / (tp3Val - slVal || 1)) * 100
    : ((slVal - trade.tp2) / (slVal - tp3Val || 1)) * 100;

  const slDistance = isBuy
    ? trade.currentSl - trade.entryPrice
    : trade.entryPrice - trade.currentSl;

  const levels = [
    {
      label: 'Entry',
      price: trade.entryPrice,
      distance: '$0.00',
      tone: 'text-[#f2d78f]',
      hit: false,
      extra: trade.entryTimeDisplay,
    },
    {
      label: 'Stop loss',
      price: trade.currentSl,
      distance: formatSignedDollar(slDistance),
      tone: 'text-[#e5584f]',
      hit: false,
      extra: trade.isBreakeven ? 'BE' : '',
    },
    {
      label: 'TP1',
      price: trade.tp1,
      distance: formatSignedDollar(6),
      tone: 'text-[#3fbf8f]',
      hit: trade.tp1Hit,
      extra: '',
    },
    {
      label: 'TP2',
      price: trade.tp2,
      distance: formatSignedDollar(11),
      tone: 'text-[#3fbf8f]',
      hit: trade.tp2Hit,
      extra: '',
    },
    {
      label: 'TP3',
      price: trade.tp3,
      distance: formatSignedDollar(15),
      tone: 'text-[#3fbf8f]',
      hit: trade.tp3Hit,
      extra: '',
    },
  ];

  return (
    <div className="p-4 rounded-[12px] bg-[#12100c] border border-[#2b261b] space-y-3.5 font-['DM_Sans',sans-serif]">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#2b261b]">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`w-2 h-2 rounded-full ${
              isMarketClosed ? 'bg-[#d9b25a]' : 'bg-[#3fbf8f]'
            }`}
          />
          <h2 className="text-base font-bold text-[#f0eadb] font-['Bricolage_Grotesque',sans-serif]">
            Active signal
          </h2>

          {/* BUY / SELL badge */}
          <span
            className={`px-2 py-0.5 rounded text-xs font-bold border flex items-center gap-1 font-['JetBrains_Mono',monospace] ${
              isBuy
                ? 'bg-[#3fbf8f]/15 text-[#3fbf8f] border-[#3fbf8f]/40'
                : 'bg-[#e5584f]/15 text-[#e5584f] border-[#e5584f]/40'
            }`}
          >
            {isBuy ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            <span>{trade.side} · {timeframe}</span>
          </span>

          {/* Running at breakeven chip */}
          {trade.isBreakeven && (
            <span className="px-2 py-0.5 rounded bg-[#1a1711] border border-[#d9b25a]/50 text-[#f2d78f] text-[11px] font-medium flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-[#d9b25a]" />
              Running at breakeven
            </span>
          )}

          {/* Zone Strength chip */}
          <span
            className="px-2 py-0.5 rounded text-[11px] font-bold border font-['JetBrains_Mono',monospace] tabular-nums"
            style={{
              backgroundColor: '#1a1711',
              color: trade.zoneStrengthColor,
              borderColor: '#2b261b',
            }}
          >
            {trade.zoneStrength.toFixed(1)}/10
          </span>

          {/* Opened timestamp ("Opened Fri 23 Oct 19:00") */}
          <span className="text-xs text-[#9d947e] font-['JetBrains_Mono',monospace] tabular-nums">
            {openedText}
          </span>
        </div>

        {/* Live P/L or "Market closed, P/L at last price" */}
        <div className="flex items-center gap-2 bg-[#1a1711] px-2.5 py-1 rounded-[8px] border border-[#2b261b]">
          <span className="text-[11px] text-[#9d947e]">
            {isMarketClosed ? 'Market closed, P/L at last price' : 'Live P/L'}
          </span>
          <span
            className={`text-sm font-bold font-['JetBrains_Mono',monospace] tabular-nums ${
              isPnlPositive ? 'text-[#3fbf8f]' : 'text-[#e5584f]'
            }`}
          >
            {formatSignedDollar(livePnl)}
          </span>
        </div>
      </div>

      {/* SL to TP3 price position bar */}
      <div className="p-3 rounded-[8px] bg-[#1a1711] border border-[#2b261b] space-y-2 font-['JetBrains_Mono',monospace] tabular-nums">
        <div className="flex items-center justify-between text-[11px] text-[#9d947e]">
          <span className="text-[#e5584f] font-semibold">
            SL {trade.currentSl.toFixed(2)}
          </span>
          <span className="text-[#f0eadb]">
            Price <strong className="text-[#f2d78f]">{effectivePrice.toFixed(2)}</strong>
          </span>
          <span className="text-[#3fbf8f] font-semibold">
            TP3 {trade.tp3.toFixed(2)}
          </span>
        </div>

        <div className="relative h-2.5 w-full bg-[#0a0907] rounded-full border border-[#2b261b] overflow-visible my-2">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              isPnlPositive ? 'bg-[#3fbf8f]' : 'bg-[#e5584f]'
            }`}
            style={{ width: `${clampedProgress}%` }}
          />

          <div
            className="absolute top-0 bottom-0 w-0.5 bg-[#d9b25a]"
            style={{ left: `${entryPct}%` }}
            title="Entry"
          />
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-[#3fbf8f]/70"
            style={{ left: `${tp1Pct}%` }}
            title="TP1"
          />
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-[#3fbf8f]/70"
            style={{ left: `${tp2Pct}%` }}
            title="TP2"
          />

          <div
            className="absolute -top-1 w-3.5 h-3.5 rounded-full bg-[#f2d78f] border-2 border-[#0a0907] -ml-1.5 transition-all duration-300"
            style={{ left: `${clampedProgress}%` }}
          />
        </div>

        <div className="flex justify-between text-[10px] text-[#9d947e]">
          <span>SL</span>
          <span>Entry</span>
          <span>TP1</span>
          <span>TP2</span>
          <span>TP3</span>
        </div>
      </div>

      {/* Compact Table: Entry, Stop loss, TP1, TP2, TP3 */}
      <div className="rounded-[8px] bg-[#1a1711] border border-[#2b261b] overflow-hidden">
        <table className="w-full text-xs border-collapse">
          <tbody className="divide-y divide-[#2b261b]">
            {levels.map((row) => (
              <tr key={row.label} className="hover:bg-[#12100c]/60">
                <td className="py-2 px-3 text-[#9d947e] font-medium">
                  {row.label}
                </td>
                <td className={`py-2 px-3 font-['JetBrains_Mono',monospace] tabular-nums font-bold ${row.tone}`}>
                  ${row.price.toFixed(2)}
                </td>
                <td className="py-2 px-3 font-['JetBrains_Mono',monospace] tabular-nums text-[#9d947e]">
                  {row.distance}
                </td>
                <td className="py-2 px-3 text-right font-['JetBrains_Mono',monospace] tabular-nums">
                  {row.hit ? (
                    <span className="inline-block px-1.5 py-0.5 rounded bg-[#3fbf8f]/15 border border-[#3fbf8f]/40 text-[#3fbf8f] text-[10px] font-bold">
                      Hit
                    </span>
                  ) : row.extra ? (
                    <span className="text-[11px] text-[#9d947e]">{row.extra}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
