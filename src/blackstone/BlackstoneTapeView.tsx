import React from 'react';
import type { BlackstoneTapeState } from '../server/blackstoneEngine';

interface BlackstoneTapeViewProps {
  tape: BlackstoneTapeState | null | undefined;
  livePrice: number | null;
  isFeedLive: boolean;
}

const novaCardStyle: React.CSSProperties = {
  backgroundColor: 'rgba(18, 22, 34, 0.72)',
  border: '1px solid rgba(140, 160, 255, 0.14)',
  fontFamily: "'Sora', sans-serif",
};

const monoStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

export const BlackstoneTapeView: React.FC<BlackstoneTapeViewProps> = ({
  tape,
  livePrice,
  isFeedLive,
}) => {
  if (!tape) {
    return (
      <div
        className="rounded-[18px] p-6 text-sm text-[#8d97b8] text-center backdrop-blur-md"
        style={novaCardStyle}
      >
        Loading live tick tape from Ahmad server...
      </div>
    );
  }

  const { ticks, activity, pressure, sourceInfo, disclaimer } = tape;
  const maxMinuteCount = Math.max(1, ...activity.minutes.map((m) => m.count));

  const stateBadges = {
    HIGH: {
      bg: 'rgba(82, 227, 255, 0.18)',
      border: '1px solid #52e3ff',
      color: '#52e3ff',
    },
    NORMAL: {
      bg: 'rgba(77, 240, 180, 0.18)',
      border: '1px solid #4df0b4',
      color: '#4df0b4',
    },
    LOW: {
      bg: 'rgba(140, 160, 255, 0.12)',
      border: '1px solid rgba(140, 160, 255, 0.25)',
      color: '#8d97b8',
    },
  };

  return (
    <div className="space-y-4" style={{ fontFamily: "'Sora', sans-serif" }}>
      {/* Disclaimer & Source Row */}
      <div
        className="rounded-[18px] p-4 flex flex-wrap items-center justify-between gap-3 backdrop-blur-md"
        style={novaCardStyle}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              isFeedLive ? 'bg-[#4df0b4] animate-pulse' : 'bg-[#52e3ff]'
            }`}
          />
          <div className="flex flex-col">
            <span className="text-xs font-bold uppercase tracking-wider text-[#52e3ff]">
              SOURCE: {sourceInfo.source}
            </span>
            <span className="text-xs text-[#8d97b8]">
              Last tick:{' '}
              <strong className="text-[#e9edff]" style={monoStyle}>
                {sourceInfo.lastTickTimeDubai || '—'}
              </strong>{' '}
              ({sourceInfo.lastTickAgeSeconds}s ago)
            </span>
          </div>
        </div>

        <div
          className="rounded-[10px] px-3.5 py-1.5 max-w-xl text-right sm:text-left text-xs"
          style={{
            backgroundColor: 'rgba(7, 9, 15, 0.55)',
            border: '1px solid rgba(140, 160, 255, 0.14)',
            color: '#8d97b8',
          }}
        >
          <span>ℹ️ {disclaimer}</span>
        </div>
      </div>

      {/* Metric Cards Row: Live Quote, Activity State, 60-Tick Pressure */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Live Tick Quote */}
        <div
          className="rounded-[18px] p-4 space-y-1 backdrop-blur-md"
          style={novaCardStyle}
        >
          <div className="text-xs font-bold uppercase tracking-wider text-[#52e3ff]">
            CURRENT LIVE TICK
          </div>
          <div className="flex items-baseline gap-3">
            <span
              className="text-2xl font-bold text-[#52e3ff] tabular-nums"
              style={monoStyle}
            >
              {livePrice !== null ? livePrice.toFixed(2) : '—'}
            </span>
            {ticks.length > 0 && (
              <span
                className="text-xs font-bold px-2 py-0.5 rounded-[6px] border"
                style={
                  ticks[0].move === 'UP'
                    ? {
                        backgroundColor: 'rgba(77, 240, 180, 0.18)',
                        borderColor: 'rgba(77, 240, 180, 0.5)',
                        color: '#4df0b4',
                      }
                    : ticks[0].move === 'DOWN'
                      ? {
                          backgroundColor: 'rgba(255, 107, 127, 0.18)',
                          borderColor: 'rgba(255, 107, 127, 0.5)',
                          color: '#ff6b7f',
                        }
                      : {
                          backgroundColor: 'rgba(140, 160, 255, 0.10)',
                          borderColor: 'rgba(140, 160, 255, 0.20)',
                          color: '#8d97b8',
                        }
                }
              >
                {ticks[0].move} ({ticks[0].delta > 0 ? '+' : ''}
                {ticks[0].delta.toFixed(2)})
              </span>
            )}
          </div>
          <div
            className="text-xs text-[#8d97b8] tabular-nums flex flex-wrap items-center gap-2 pt-1"
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
        <div
          className="rounded-[18px] p-4 space-y-1 backdrop-blur-md"
          style={novaCardStyle}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#52e3ff]">
              ACTIVITY (30M AVG)
            </span>
            <span
              className="text-[11px] font-bold px-2 py-0.5 rounded-[6px]"
              style={stateBadges[activity.state]}
            >
              {activity.state}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span
              className="text-2xl font-bold text-[#e9edff] tabular-nums"
              style={monoStyle}
            >
              {activity.avgTicksPerMinute}
            </span>
            <span className="text-xs text-[#8d97b8]">ticks / min avg</span>
          </div>
          <div className="text-xs text-[#8d97b8]">
            Current minute velocity:{' '}
            <strong className="text-[#e9edff]" style={monoStyle}>
              {activity.currentMinuteTicks} ticks
            </strong>
          </div>
        </div>

        {/* Tick Pressure (Last 60 Ticks) */}
        <div
          className="rounded-[18px] p-4 space-y-2 backdrop-blur-md"
          style={novaCardStyle}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#52e3ff]">
              PRESSURE (60 TICKS)
            </span>
            <span className="text-[11px] text-[#8d97b8]">
              {pressure.last60TicksEvaluated} ticks
            </span>
          </div>

          <div
            className="w-full h-3 rounded-[6px] overflow-hidden flex"
            style={{ backgroundColor: 'rgba(7, 9, 15, 0.75)' }}
          >
            <div
              className="h-full transition-all duration-300"
              style={{
                width: `${pressure.upRatioPct}%`,
                backgroundColor: '#4df0b4',
              }}
            />
            <div
              className="h-full transition-all duration-300"
              style={{
                width: `${pressure.downRatioPct}%`,
                backgroundColor: '#ff6b7f',
              }}
            />
          </div>

          <div
            className="flex items-center justify-between text-xs tabular-nums"
            style={monoStyle}
          >
            <span className="text-[#4df0b4] font-bold">
              ▲ {pressure.upRatioPct.toFixed(1)}% UP ({pressure.upTicks})
            </span>
            <span className="text-[#8d97b8]">{pressure.flatTicks} flat</span>
            <span className="text-[#ff6b7f] font-bold">
              ▼ {pressure.downRatioPct.toFixed(1)}% DOWN ({pressure.downTicks})
            </span>
          </div>
        </div>
      </div>

      {/* Tick Activity Bar Chart (Last 30 Minutes) */}
      <div
        className="rounded-[18px] p-5 space-y-3 backdrop-blur-md"
        style={novaCardStyle}
      >
        <div
          className="flex flex-wrap items-center justify-between gap-2 pb-3"
          style={{ borderBottom: '1px solid rgba(140, 160, 255, 0.14)' }}
        >
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#52e3ff]">
              TICK ACTIVITY (TICKS / MIN · LAST 30 MINUTES)
            </h2>
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-[5px]"
              style={stateBadges[activity.state]}
            >
              STATE: {activity.state}
            </span>
          </div>
          <span className="text-xs text-[#8d97b8]">
            Average:{' '}
            <strong className="text-[#e9edff]" style={monoStyle}>
              {activity.avgTicksPerMinute}
            </strong>{' '}
            ticks/min
          </span>
        </div>

        <div className="h-40 flex items-end gap-1 sm:gap-1.5 pt-4 pb-2 px-1">
          {activity.minutes.map((m, idx) => {
            const heightPct = Math.max(6, Math.min(100, (m.count / maxMinuteCount) * 100));
            const isCurrent = idx === activity.minutes.length - 1;

            const barColor = isCurrent ? '#52e3ff' : '#4df0b4';

            return (
              <div
                key={m.minuteKey}
                className="flex-1 flex flex-col items-center h-full justify-end group relative"
              >
                <div
                  className="absolute -top-9 opacity-0 group-hover:opacity-100 transition-opacity rounded px-2 py-0.5 text-[10px] font-semibold text-[#e9edff] whitespace-nowrap pointer-events-none z-10"
                  style={{
                    backgroundColor: 'rgba(7, 9, 15, 0.95)',
                    border: '1px solid rgba(140, 160, 255, 0.25)',
                  }}
                >
                  {m.timeDubai}: {m.count} ticks
                </div>

                <div
                  className="w-full rounded-t-[4px] transition-all duration-300"
                  style={{
                    height: `${heightPct}%`,
                    backgroundColor: barColor,
                    opacity: isCurrent ? 1 : 0.75,
                  }}
                />
                <span
                  className="text-[9px] text-[#8d97b8] mt-1 tabular-nums hidden sm:block truncate"
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
      <div
        className="rounded-[18px] p-5 space-y-3 backdrop-blur-md"
        style={novaCardStyle}
      >
        <div
          className="flex flex-wrap items-center justify-between gap-2 pb-3"
          style={{ borderBottom: '1px solid rgba(140, 160, 255, 0.14)' }}
        >
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#52e3ff]">
            LIVE TICK TAPE
          </h2>
          <span className="text-xs text-[#8d97b8]">
            Showing last {ticks.length} incoming ticks
          </span>
        </div>

        {ticks.length === 0 ? (
          <div className="py-8 text-center text-sm text-[#8d97b8]">
            Waiting for ticks from Ahmad server...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr
                  className="text-[#8d97b8] uppercase text-[11px]"
                  style={{ borderBottom: '1px solid rgba(140, 160, 255, 0.14)' }}
                >
                  <th className="py-2.5 px-3 font-semibold">Time (Dubai)</th>
                  <th className="py-2.5 px-3 font-semibold">Price</th>
                  <th className="py-2.5 px-3 font-semibold">Bid</th>
                  <th className="py-2.5 px-3 font-semibold">Ask</th>
                  <th className="py-2.5 px-3 font-semibold">Spread</th>
                  <th className="py-2.5 px-3 font-semibold">Move</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Delta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(140,160,255,0.08)]">
                {ticks.map((t, index) => {
                  const isUp = t.move === 'UP';
                  const isDown = t.move === 'DOWN';

                  return (
                    <tr
                      key={t.id}
                      style={{
                        backgroundColor:
                          index === 0 ? 'rgba(82, 227, 255, 0.06)' : 'transparent',
                      }}
                    >
                      <td className="py-2.5 px-3 text-[#8d97b8] tabular-nums" style={monoStyle}>
                        {t.timeDubai}
                      </td>
                      <td className="py-2.5 px-3 font-bold text-[#e9edff] tabular-nums" style={monoStyle}>
                        {t.price.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-[#8d97b8] tabular-nums" style={monoStyle}>
                        {t.bid.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-[#8d97b8] tabular-nums" style={monoStyle}>
                        {t.ask.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-[#8d97b8] tabular-nums" style={monoStyle}>
                        ${t.spread.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-[5px] text-[10px] font-bold"
                          style={
                            isUp
                              ? {
                                  backgroundColor: 'rgba(77, 240, 180, 0.16)',
                                  color: '#4df0b4',
                                }
                              : isDown
                                ? {
                                    backgroundColor: 'rgba(255, 107, 127, 0.16)',
                                    color: '#ff6b7f',
                                  }
                                : {
                                    backgroundColor: 'rgba(140, 160, 255, 0.12)',
                                    color: '#8d97b8',
                                  }
                          }
                        >
                          {isUp ? '▲ UP' : isDown ? '▼ DOWN' : '— FLAT'}
                        </span>
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-bold tabular-nums ${
                          isUp
                            ? 'text-[#4df0b4]'
                            : isDown
                              ? 'text-[#ff6b7f]'
                              : 'text-[#8d97b8]'
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
