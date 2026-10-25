import React from 'react';
import type { ZoneSummaryRow } from '../server/blackstoneEngine';

interface BlackstoneZoneRecordViewProps {
  records: ZoneSummaryRow[] | null | undefined;
}

const novaCardStyle: React.CSSProperties = {
  backgroundColor: 'rgba(18, 22, 34, 0.72)',
  border: '1px solid rgba(140, 160, 255, 0.14)',
  fontFamily: "'Sora', sans-serif",
};

const monoStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

export const BlackstoneZoneRecordView: React.FC<BlackstoneZoneRecordViewProps> = ({
  records,
}) => {
  // Only show rows matching Level map names, excluding any generic/bogus entries
  const rows = (records || []).filter(
    (r) => r.zoneName && !r.zoneName.includes('Reaction Zone')
  );

  const formatPeriod = (
    stats: { tests: number; held: number; broken: number; holdRatePct: number | null },
    totalStoredTests: number
  ) => {
    // Show dashes unless a zone has at least 10 real stored tests
    if (totalStoredTests < 10 || stats.tests < 10 || stats.holdRatePct === null) {
      return (
        <span className="text-[#8d97b8] font-semibold" style={monoStyle}>
          —
        </span>
      );
    }
    return (
      <div className="flex flex-col tabular-nums" style={monoStyle}>
        <span className="font-bold text-[#e9edff]">
          {stats.holdRatePct.toFixed(0)}%{' '}
          <span className="text-[11px] font-normal text-[#4df0b4]">
            ({stats.held} held)
          </span>
        </span>
        <span className="text-[10px] text-[#8d97b8]">
          {stats.tests} tests · {stats.broken} broken
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-4" style={{ fontFamily: "'Sora', sans-serif" }}>
      {/* Banner / Explanation */}
      <div
        className="rounded-[18px] p-4 flex flex-wrap items-center justify-between gap-3 backdrop-blur-md"
        style={novaCardStyle}
      >
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-[#52e3ff]" />
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-[#52e3ff]">
              ZONE RECORD DATABASE
            </div>
            <div className="text-xs text-[#8d97b8]">
              Persisted server records of zone reactions, tests, and holds
            </div>
          </div>
        </div>

        <div
          className="rounded-[10px] px-3.5 py-1.5 text-xs text-[#8d97b8]"
          style={{
            backgroundColor: 'rgba(7, 9, 15, 0.55)',
            border: '1px solid rgba(140, 160, 255, 0.14)',
          }}
        >
          Rating criterion:{' '}
          <strong className="text-[#52e3ff]">
            Minimum 10 stored tests required
          </strong>{' '}
          before a rating is assigned. Shows dashes where no data exists.
        </div>
      </div>

      {/* Main Zone Record Table */}
      <div
        className="rounded-[18px] p-5 space-y-4 backdrop-blur-md"
        style={novaCardStyle}
      >
        <div
          className="flex flex-wrap items-center justify-between gap-2 pb-3"
          style={{ borderBottom: '1px solid rgba(140, 160, 255, 0.14)' }}
        >
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#52e3ff]">
            ZONE TEST PERFORMANCE (STORED HISTORY)
          </h2>
          <span className="text-xs text-[#8d97b8]">
            Today · 30d · 60d · 90d
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-[#8d97b8]">
            No zone test records stored on server yet. Real intraday touches and tests will record here automatically.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr
                  className="text-[#8d97b8] uppercase text-[11px]"
                  style={{ borderBottom: '1px solid rgba(140, 160, 255, 0.14)' }}
                >
                  <th className="py-2.5 px-3 font-semibold">Zone</th>
                  <th className="py-2.5 px-3 font-semibold">Today</th>
                  <th className="py-2.5 px-3 font-semibold">30 Days</th>
                  <th className="py-2.5 px-3 font-semibold">60 Days</th>
                  <th className="py-2.5 px-3 font-semibold">90 Days</th>
                  <th className="py-2.5 px-3 font-semibold text-center">Stored Tests</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Rating</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(140,160,255,0.08)]">
                {rows.map((r) => {
                  const hasRating = r.rating !== null;
                  return (
                    <tr key={r.zoneId}>
                      <td className="py-3 px-3">
                        <span className="font-bold text-[#e9edff] text-sm">
                          {r.zoneName}
                        </span>
                      </td>

                      <td className="py-3 px-3">{formatPeriod(r.today, r.totalStoredTests)}</td>
                      <td className="py-3 px-3">{formatPeriod(r.d30, r.totalStoredTests)}</td>
                      <td className="py-3 px-3">{formatPeriod(r.d60, r.totalStoredTests)}</td>
                      <td className="py-3 px-3">{formatPeriod(r.d90, r.totalStoredTests)}</td>

                      <td
                        className="py-3 px-3 text-center tabular-nums text-[#e9edff] font-bold"
                        style={monoStyle}
                      >
                        {r.totalStoredTests >= 10 ? (
                          r.totalStoredTests
                        ) : (
                          <span className="text-[#8d97b8] font-semibold">—</span>
                        )}
                      </td>

                      <td className="py-3 px-3 text-right">
                        {r.totalStoredTests >= 10 && hasRating ? (
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded-[6px] text-[11px] font-bold"
                            style={{
                              backgroundColor: 'rgba(82, 227, 255, 0.18)',
                              border: '1px solid #52e3ff',
                              color: '#52e3ff',
                            }}
                          >
                            {r.rating}
                          </span>
                        ) : (
                          <span
                            className="text-xs text-[#8d97b8] font-semibold"
                            style={monoStyle}
                            title="Minimum 10 stored tests required"
                          >
                            —
                          </span>
                        )}
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
