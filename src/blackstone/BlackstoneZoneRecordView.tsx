import React from 'react';
import type { ZoneSummaryRow } from '../server/blackstoneEngine';

interface BlackstoneZoneRecordViewProps {
  records: ZoneSummaryRow[] | null | undefined;
}

const cardStyle: React.CSSProperties = {
  backgroundColor: '#0b0b0e',
  border: '1px solid #1f1d18',
  fontFamily: "'DM Sans', sans-serif",
};

const monoStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

export const BlackstoneZoneRecordView: React.FC<BlackstoneZoneRecordViewProps> = ({
  records,
}) => {
  const rows = (records || []).filter(
    (r) => r.zoneName && !r.zoneName.includes('Reaction Zone')
  );

  const formatPeriod = (
    stats: { tests: number; held: number; broken: number; holdRatePct: number | null },
    totalStoredTests: number
  ) => {
    if (totalStoredTests < 10 || stats.tests < 10 || stats.holdRatePct === null) {
      return (
        <span className="text-[#8e8779] font-semibold" style={monoStyle}>
          —
        </span>
      );
    }
    return (
      <div className="flex flex-col tabular-nums" style={monoStyle}>
        <span className="font-bold text-[#f4efe6]">
          {stats.holdRatePct.toFixed(0)}%{' '}
          <span className="text-[11px] font-normal text-[#3fbf8f]">
            ({stats.held})
          </span>
        </span>
        <span className="text-[10px] text-[#8e8779]">
          {stats.tests}t · {stats.broken}b
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-3.5" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <div className="rounded-[12px] p-4 space-y-3.5" style={cardStyle}>
        <div
          className="flex flex-wrap items-center justify-between gap-2 pb-2.5"
          style={{ borderBottom: '1px solid #1f1d18' }}
        >
          <h2
            className="text-xs font-bold uppercase tracking-wider text-[#d9b25a]"
            style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
          >
            ZONE RECORD
          </h2>
          <span className="text-xs text-[#8e8779]" style={monoStyle}>
            Today · 30d · 60d · 90d
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="py-6 text-center text-xs text-[#8e8779]">
            No zone test records yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr
                  className="text-[#8e8779] uppercase text-[11px]"
                  style={{ borderBottom: '1px solid #1f1d18' }}
                >
                  <th className="py-2 px-2.5 font-semibold">Zone</th>
                  <th className="py-2 px-2.5 font-semibold">Today</th>
                  <th className="py-2 px-2.5 font-semibold">30d</th>
                  <th className="py-2 px-2.5 font-semibold">60d</th>
                  <th className="py-2 px-2.5 font-semibold">90d</th>
                  <th className="py-2 px-2.5 font-semibold text-center">Tests</th>
                  <th className="py-2 px-2.5 font-semibold text-right">Rating</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#181612]">
                {rows.map((r) => {
                  const hasRating = r.rating !== null;
                  return (
                    <tr key={r.zoneId}>
                      <td className="py-2.5 px-2.5">
                        <span className="font-bold text-[#f4efe6] text-xs sm:text-sm">
                          {r.zoneName}
                        </span>
                      </td>

                      <td className="py-2.5 px-2.5">
                        {formatPeriod(r.today, r.totalStoredTests)}
                      </td>
                      <td className="py-2.5 px-2.5">
                        {formatPeriod(r.d30, r.totalStoredTests)}
                      </td>
                      <td className="py-2.5 px-2.5">
                        {formatPeriod(r.d60, r.totalStoredTests)}
                      </td>
                      <td className="py-2.5 px-2.5">
                        {formatPeriod(r.d90, r.totalStoredTests)}
                      </td>

                      <td
                        className="py-2.5 px-2.5 text-center tabular-nums text-[#f4efe6] font-bold"
                        style={monoStyle}
                      >
                        {r.totalStoredTests >= 10 ? (
                          r.totalStoredTests
                        ) : (
                          <span className="text-[#8e8779] font-semibold">—</span>
                        )}
                      </td>

                      <td className="py-2.5 px-2.5 text-right">
                        {r.totalStoredTests >= 10 && hasRating ? (
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded-[5px] text-[11px] font-bold"
                            style={{
                              backgroundColor: 'rgba(217, 178, 90, 0.14)',
                              border: '1px solid #d9b25a',
                              color: '#f2d78f',
                              ...monoStyle,
                            }}
                          >
                            {r.rating}
                          </span>
                        ) : (
                          <span
                            className="text-xs text-[#8e8779] font-semibold"
                            style={monoStyle}
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
