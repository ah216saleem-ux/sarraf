import React from 'react';
import type { BlackstoneTapeState } from '../server/blackstoneEngine';

interface BlackstoneTapeViewProps {
  tape: BlackstoneTapeState | null | undefined;
  livePrice: number | null;
  isFeedLive: boolean;
}

const cardStyle: React.CSSProperties = {
  backgroundColor: '#0b0b0e',
  border: '1px solid #1f1d18',
  fontFamily: "'DM Sans', sans-serif",
};

const monoStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

export const BlackstoneTapeView: React.FC<BlackstoneTapeViewProps> = ({
  tape,
  livePrice,
}) => {
  if (!tape) {
    return (
      <div
        className="rounded-[12px] p-5 text-xs text-[#8e8779] text-center"
        style={cardStyle}
      >
        Loading tick tape...
      </div>
    );
  }

  const { ticks, activity, pressure } = tape;
  const maxMinuteCount = Math.max(1, ...activity.minutes.map((m) => m.count));

  const stateBadges = {
    HIGH: {
      bg: 'rgba(217, 178, 90, 0.14)',
      border: '1px solid #d9b25a',
      color: '#d9b25a',
    },
    NORMAL: {
      bg: 'rgba(63, 191, 143, 0.14)',
      border: '1px solid #3fbf8f',
      color: '#3fbf8f',
    },
    LOW: {
      bg: '#12110e',
      border: '1px solid #26231c',
      color: '#8e8779',
    },
  };

  return (
    <div className="space-y-3.5" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {/* Metric Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Live Tick Quote */}
        <div className="rounded-[12px] p-4 space-y-1" style={cardStyle}>
          <div
            className="text-xs font-bold uppercase tracking-wider text-[#d9b25a]"
            style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
          >
            LIVE TICK
          </div>
          <div className="flex items-baseline gap-2.5">
            <span
              className="text-2xl font-bold text-[#f2d78f] tabular-nums"
              style={monoStyle}
            >
              {livePrice !== null ? livePrice.toFixed(2) : '—'}
            </span>
            {ticks.length > 0 && (
              <span
                className="text-xs font-bold px-2 py-0.5 rounded-[5px] border"
                style={
                  ticks[0].move === 'UP'
                    ? {
                        backgroundColor: 'rgba(63, 191, 143, 0.14)',
                        borderColor: 'rgba(63, 191, 143, 0.45)',
                        color: '#3fbf8f',
                        ...monoStyle,
                      }
                    : ticks[0].move === 'DOWN'
                      ? {
                          backgroundColor: 'rgba(229, 88, 79, 0.14)',
                          borderColor: 'rgba(229, 88, 79, 0.45)',
                          color: '#e5584f',
                          ...monoStyle,
                        }
                      : {
                          backgroundColor: '#12110e',
                          borderColor: '#26231c',
                          color: '#8e8779',
                          ...monoStyle,
                        }
                }
              >
                {ticks[0].move} ({ticks[0].delta > 0 ? '+' : ''}
                {ticks[0].delta.toFixed(2)})
              </span>
            )}
          </div>
          <div
            className="text-xs text-[#8e8779] tabular-nums flex flex-wrap items-center gap-2 pt-1"
            style={monoStyle}
          >
            <span>Bid: {ticks[0]?.bid?.toFixed(2) ?? '—'}</span>
            <span>·</span>
            <span>Ask: {ticks[0]?.ask?.toFixed(2) ?? '—'}</span>
            <span>·</span>
            <span>Spread: ${ticks[0]?.spread?.toFixed(2) ?? '—'}</span>
          </div>
        </div>

        {/* Tick Activity Rate */}
        <div className="rounded-[12px] p-4 space-y-1" style={cardStyle}>
          <div className="flex items-center justify-between">
            <span
              className="text-xs font-bold uppercase tracking-wider text-[#d9b25a]"
              style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
            >
              ACTIVITY (30M)
            </span>
            <span
              className="text-[10.5px] font-bold px-2 py-0.5 rounded-[5px]"
              style={{ ...stateBadges[activity.state], ...monoStyle }}
            >
              {activity.state}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span
              className="text-2xl font-bold text-[#f4efe6] tabular-nums"
              style={monoStyle}
            >
              {activity.avgTicksPerMinute}
            </span>
            <span className="text-xs text-[#8e8779]">ticks / min</span>
          </div>
          <div className="text-xs text-[#8e8779]">
            Current min:{' '}
            <strong className="text-[#f4efe6]" style={monoStyle}>
              {activity.currentMinuteTicks}
            </strong>
          </div>
        </div>

        {/* Tick Pressure */}
        <div className="rounded-[12px] p-4 space-y-2" style={cardStyle}>
          <div className="flex items-center justify-between">
            <span
              className="text-xs font-bold uppercase tracking-wider text-[#d9b25a]"
              style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
            >
              PRESSURE (60 TICKS)
            </span>
            <span className="text-[11px] text-[#8e8779]" style={monoStyle}>
              {pressure.last60TicksEvaluated}
            </span>
          </div>

          <div
            className="w-full h-2.5 rounded-[4px] overflow-hidden flex"
            style={{ backgroundColor: '#12110e' }}
          >
            <div
              className="h-full transition-all duration-300"
              style={{
                width: `${pressure.upRatioPct}%`,
                backgroundColor: '#3fbf8f',
              }}
            />
            <div
              className="h-full transition-all duration-300"
              style={{
                width: `${pressure.downRatioPct}%`,
                backgroundColor: '#e5584f',
              }}
            />
          </div>

          <div
            className="flex items-center justify-between text-xs tabular-nums"
            style={monoStyle}
          >
            <span className="text-[#3fbf8f] font-bold">
              ▲ {pressure.upRatioPct.toFixed(1)}% ({pressure.upTicks})
            </span>
            <span className="text-[#8e8779]">{pressure.flatTicks} flat</span>
            <span className="text-[#e5584f] font-bold">
              ▼ {pressure.downRatioPct.toFixed(1)}% ({pressure.downTicks})
            </span>
          </div>
        </div>
      </div>

      {/* Tick Activity Bar Chart */}
      <div className="rounded-[12px] p-4 space-y-3" style={cardStyle}>
        <div
          className="flex flex-wrap items-center justify-between gap-2 pb-2.5"
          style={{ borderBottom: '1px solid #1f1d18' }}
        >
          <h2
            className="text-xs font-bold uppercase tracking-wider text-[#d9b25a]"
            style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
          >
            TICK ACTIVITY (30M)
          </h2>
          <span className="text-xs text-[#8e8779]" style={monoStyle}>
            Avg {activity.avgTicksPerMinute}/min
          </span>
        </div>

        <div className="h-36 flex items-end gap-1 sm:gap-1.5 pt-3 pb-1 px-1">
          {activity.minutes.map((m, idx) => {
            const heightPct = Math.max(6, Math.min(100, (m.count / maxMinuteCount) * 100));
            const isCurrent = idx === activity.minutes.length - 1;
            const barColor = isCurrent ? '#d9b25a' : '#3fbf8f';

            return (
              <div
                key={m.minuteKey}
                className="flex-1 flex flex-col items-center h-full justify-end group relative"
              >
                <div
                  className="w-full rounded-t-[3px] transition-all duration-300"
                  style={{
                    height: `${heightPct}%`,
                    backgroundColor: barColor,
                    opacity: isCurrent ? 1 : 0.72,
                  }}
                />
                <span
                  className="text-[9px] text-[#8e8779] mt-1 tabular-nums hidden sm:block truncate"
                  style={monoStyle}
                >
                  {idx % 5 === 0 || isCurrent ? m.timeDubai : ''}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Live Tick Tape Table */}
      <div className="rounded-[12px] p-4 space-y-3" style={cardStyle}>
        <div
          className="flex flex-wrap items-center justify-between gap-2 pb-2.5"
          style={{ borderBottom: '1px solid #1f1d18' }}
        >
          <h2
            className="text-xs font-bold uppercase tracking-wider text-[#d9b25a]"
            style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
          >
            TICK TAPE
          </h2>
          <span className="text-xs text-[#8e8779]" style={monoStyle}>
            {ticks.length} ticks
          </span>
        </div>

        {ticks.length === 0 ? (
          <div className="py-6 text-center text-xs text-[#8e8779]">
            Waiting for ticks...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr
                  className="text-[#8e8779] uppercase text-[11px]"
                  style={{ borderBottom: '1px solid #1f1d18' }}
                >
                  <th className="py-2 px-2.5 font-semibold">Time</th>
                  <th className="py-2 px-2.5 font-semibold">Price</th>
                  <th className="py-2 px-2.5 font-semibold">Bid</th>
                  <th className="py-2 px-2.5 font-semibold">Ask</th>
                  <th className="py-2 px-2.5 font-semibold">Spread</th>
                  <th className="py-2 px-2.5 font-semibold">Move</th>
                  <th className="py-2 px-2.5 font-semibold text-right">Delta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#181612]">
                {ticks.map((t, index) => {
                  const isUp = t.move === 'UP';
                  const isDown = t.move === 'DOWN';

                  return (
                    <tr
                      key={t.id}
                      style={{
                        backgroundColor:
                          index === 0 ? 'rgba(217, 178, 90, 0.05)' : 'transparent',
                      }}
                    >
                      <td className="py-2 px-2.5 text-[#8e8779] tabular-nums" style={monoStyle}>
                        {t.timeDubai}
                      </td>
                      <td
                        className="py-2 px-2.5 font-bold text-[#f4efe6] tabular-nums"
                        style={monoStyle}
                      >
                        {t.price.toFixed(2)}
                      </td>
                      <td className="py-2 px-2.5 text-[#8e8779] tabular-nums" style={monoStyle}>
                        {t.bid.toFixed(2)}
                      </td>
                      <td className="py-2 px-2.5 text-[#8e8779] tabular-nums" style={monoStyle}>
                        {t.ask.toFixed(2)}
                      </td>
                      <td className="py-2 px-2.5 text-[#8e8779] tabular-nums" style={monoStyle}>
                        ${t.spread.toFixed(2)}
                      </td>
                      <td className="py-2 px-2.5">
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[10px] font-bold"
                          style={
                            isUp
                              ? {
                                  backgroundColor: 'rgba(63, 191, 143, 0.14)',
                                  color: '#3fbf8f',
                                  ...monoStyle,
                                }
                              : isDown
                                ? {
                                    backgroundColor: 'rgba(229, 88, 79, 0.14)',
                                    color: '#e5584f',
                                    ...monoStyle,
                                  }
                                : {
                                    backgroundColor: '#12110e',
                                    color: '#8e8779',
                                    ...monoStyle,
                                  }
                          }
                        >
                          {isUp ? '▲ UP' : isDown ? '▼ DOWN' : '—'}
                        </span>
                      </td>
                      <td
                        className={`py-2 px-2.5 text-right font-bold tabular-nums ${
                          isUp
                            ? 'text-[#3fbf8f]'
                            : isDown
                              ? 'text-[#e5584f]'
                              : 'text-[#8e8779]'
                        }`}
                        style={monoStyle}
                      >
                        {t.delta > 0 ? `+${t.delta.toFixed(2)}` : t.delta.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
