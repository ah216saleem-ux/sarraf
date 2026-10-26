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
  formatRoundedSignedDollar,
  formatOpenedTime,
  getNearestValidZone,
} from './dojiEngine';

const ALL_TIMEFRAMES: DojiTimeframe[] = ['15m', '30m', '1h', '4h'];

interface ActiveSignalCardProps {
  trade: DojiTrade | null;
  activeTradesMap?: Record<DojiTimeframe, DojiTrade | null>;
  onSelectTimeframe?: (tf: DojiTimeframe) => void;
  timeframe: DojiTimeframe;
  livePrice: number;
  zones: DojiZone[];
  allValidZones?: DojiZone[];
  isMarketClosed?: boolean;
}

export const ActiveSignalCard: React.FC<ActiveSignalCardProps> = ({
  trade,
  activeTradesMap,
  onSelectTimeframe,
  timeframe,
  livePrice,
  zones,
  allValidZones = [],
  isMarketClosed = false,
}) => {
  const openTradesList: DojiTrade[] = ALL_TIMEFRAMES.map((tf) => activeTradesMap?.[tf] || null).filter(
    (t): t is DojiTrade => Boolean(t && t.status === 'OPEN')
  );

  const liveRetestZones = [
    ...zones.filter((z) => z.isRetestLive && z.retestLiveText),
    ...allValidZones.filter(
      (z) => z.timeframe !== timeframe && z.isRetestLive && z.retestLiveText
    ),
  ];
  const primaryLiveRetest = liveRetestZones[0] || null;

  const renderOpenTradesBar = () => (
    <div className="px-3 py-2 rounded-[8px] bg-[#1a1711] border border-[#2b261b] flex flex-wrap items-center justify-between gap-2 text-xs font-['JetBrains_Mono',monospace] tabular-nums">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[#9d947e] font-['DM_Sans',sans-serif] font-medium">
          Open trades:
        </span>
        {openTradesList.length > 0 ? (
          openTradesList.map((ot) => {
            const refP = livePrice > 0 ? livePrice : ot.entryPrice;
            const pnl = computeLivePnl(ot, refP);
            const isPos = pnl >= 0;
            return (
              <button
                key={ot.id}
                type="button"
                onClick={() => onSelectTimeframe?.(ot.timeframe)}
                className="px-2 py-0.5 rounded bg-[#12100c] border border-[#d9b25a]/60 hover:border-[#d9b25a] text-[#f0eadb] font-semibold cursor-pointer flex items-center gap-1.5 transition-colors"
              >
                <span className="text-[#f2d78f]">{ot.timeframe}</span>
                <span className={ot.side === 'BUY' ? 'text-[#3fbf8f]' : 'text-[#e5584f]'}>
                  {ot.side}
                </span>
                <span className={isPos ? 'text-[#3fbf8f]' : 'text-[#e5584f]'}>
                  {formatSignedDollar(pnl)}
                </span>
              </button>
            );
          })
        ) : (
          <span className="text-[#9d947e]">0</span>
        )}
      </div>

      <div className="flex items-center gap-1.5 text-[11px]">
        {ALL_TIMEFRAMES.map((tf) => {
          const count = activeTradesMap?.[tf]?.status === 'OPEN' ? 1 : 0;
          const isCurrent = tf === timeframe;
          return (
            <button
              key={tf}
              type="button"
              onClick={() => onSelectTimeframe?.(tf)}
              className={`px-1.5 py-0.5 rounded border cursor-pointer transition-colors ${
                count > 0
                  ? 'bg-[#12100c] border-[#d9b25a] text-[#f2d78f] font-bold'
                  : isCurrent
                  ? 'bg-[#12100c] border-[#2b261b] text-[#f0eadb]'
                  : 'bg-[#12100c]/60 border-[#2b261b] text-[#9d947e] hover:text-[#f0eadb]'
              }`}
            >
              {tf}: {count}
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderLiveRetestBanner = () => {
    if (!primaryLiveRetest || !primaryLiveRetest.retestLiveText) return null;
    return (
      <div
        onClick={() => onSelectTimeframe?.(primaryLiveRetest.timeframe)}
        className="px-3 py-2 rounded-[8px] bg-[#1a1711] border border-[#d9b25a] text-[#f2d78f] text-xs font-['JetBrains_Mono',monospace] tabular-nums flex flex-wrap items-center justify-between gap-2 cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#d9b25a] shrink-0" />
          <span className="font-bold">{primaryLiveRetest.retestLiveText}</span>
        </div>
        <span className="text-[11px] text-[#f0eadb]">
          {primaryLiveRetest.timeframe} · {primaryLiveRetest.high.toFixed(2)} / {primaryLiveRetest.low.toFixed(2)}
        </span>
      </div>
    );
  };

  if (!trade || trade.status !== 'OPEN') {
    // Requirement 6: "Nearest zone" must always be chosen from ALL valid zones (used and unused combined) closest to current price
    const nearestZone = getNearestValidZone(zones, timeframe, livePrice);

    return (
      <div className="p-4 rounded-[12px] bg-[#12100c] border border-[#2b261b] space-y-3 font-['DM_Sans',sans-serif]">
        {renderOpenTradesBar()}
        {renderLiveRetestBanner()}

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

        <div className="py-4 text-center space-y-1.5">
          <Target className="w-5 h-5 text-[#d9b25a] mx-auto" />
          <div className="text-sm font-medium text-[#f0eadb]">
            No active signal on <span className="font-['JetBrains_Mono',monospace]">{timeframe}</span>
          </div>
          {nearestZone ? (
            <div className="space-y-1">
              <p className="text-xs text-[#9d947e] font-['JetBrains_Mono',monospace] tabular-nums">
                Nearest zone: {nearestZone.low.toFixed(2)} – {nearestZone.high.toFixed(2)} ({nearestZone.strength.toFixed(1)}/10 ·{' '}
                {nearestZone.zoneState === 'used'
                  ? 'used'
                  : nearestZone.zoneState === 'armed'
                  ? `armed ${nearestZone.breakDirection === 'UP' ? '▲' : '▼'} since ${nearestZone.breakTimeDisplay}`
                  : 'waiting'}
                )
              </p>
              {nearestZone.zoneState === 'armed' && nearestZone.retestLevel !== null && (
                <p className="text-xs text-[#f2d78f] font-['JetBrains_Mono',monospace] tabular-nums">
                  Waiting for retest to {nearestZone.retestLevel.toFixed(2)} ({formatRoundedSignedDollar(nearestZone.retestDistancePts)})
                </p>
              )}
            </div>
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
      {renderOpenTradesBar()}
      {renderLiveRetestBanner()}

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
