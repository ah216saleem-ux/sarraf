import React from 'react';
import { OrderBookDepth, BtcFeedStatus } from './types';
import { Layers, Scale } from 'lucide-react';

interface OrderBookDepthCardProps {
  depth: OrderBookDepth;
  status: BtcFeedStatus;
}

export const OrderBookDepthCard: React.FC<OrderBookDepthCardProps> = React.memo(
  ({ depth, status }) => {
    const isStaleOrOffline = status === 'STALE' || status === 'OFFLINE';
    const { bids, asks, bidTotal, askTotal, imbalancePct, spread, spreadBps } = depth;

    const hasData = bids.length > 0 && asks.length > 0;
    const isBidHeavy = imbalancePct !== null && imbalancePct >= 0;

    return (
      <div className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-4 backdrop-blur-md flex flex-col justify-between shadow-[0_4px_24px_rgba(0,0,0,0.5)]">
        <div>
          {/* Card Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#FFD97A]" />
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
                ORDER BOOK DEPTH (TOP 8 LEVELS)
              </span>
            </div>
            <div className="flex items-center gap-3 font-mono text-[11px]">
              <span className="text-neutral-400">SPREAD:</span>
              <span
                className={`font-bold ${
                  isStaleOrOffline || spread === null ? 'text-neutral-500' : 'text-white'
                }`}
              >
                {spread !== null ? `$${spread.toFixed(2)}` : '--'}
              </span>
              {spreadBps !== null && !isStaleOrOffline && (
                <span className="text-neutral-400">({spreadBps.toFixed(2)} bps)</span>
              )}
            </div>
          </div>

          {/* Depth Imbalance % Gauge */}
          <div className="bg-black/40 border border-white/5 rounded-lg p-2.5 my-3 font-mono text-xs">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-teal-400 font-bold">
                BIDS: {hasData ? `${bidTotal.toFixed(3)} BTC` : '--'}
              </span>
              <div className="flex items-center gap-1.5 text-neutral-300 font-semibold text-[11px]">
                <Scale className="w-3.5 h-3.5 text-[#FFD97A]" />
                <span className={isBidHeavy ? 'text-teal-300' : 'text-rose-300'}>
                  {imbalancePct !== null
                    ? `${isBidHeavy ? '+' : ''}${imbalancePct.toFixed(1)}% ${
                        isBidHeavy ? 'BID HEAVY' : 'ASK HEAVY'
                      }`
                    : '--'}
                </span>
              </div>
              <span className="text-rose-400 font-bold">
                ASKS: {hasData ? `${askTotal.toFixed(3)} BTC` : '--'}
              </span>
            </div>

            <div className="h-2.5 bg-neutral-900 rounded-full overflow-hidden flex border border-white/10 p-0.5">
              <div
                className={`h-full rounded-l-full transition-all duration-200 ${
                  isStaleOrOffline || !hasData
                    ? 'bg-neutral-700'
                    : 'bg-teal-500'
                }`}
                style={{
                  width: `${
                    bidTotal + askTotal > 0
                      ? Math.max(5, Math.min(95, (bidTotal / (bidTotal + askTotal)) * 100))
                      : 50
                  }%`,
                }}
              />
              <div
                className={`h-full rounded-r-full transition-all duration-200 ${
                  isStaleOrOffline || !hasData
                    ? 'bg-neutral-800'
                    : 'bg-rose-500'
                }`}
                style={{
                  width: `${
                    bidTotal + askTotal > 0
                      ? Math.max(5, Math.min(95, (askTotal / (bidTotal + askTotal)) * 100))
                      : 50
                  }%`,
                }}
              />
            </div>
          </div>

          {/* Top 8 Levels Table */}
          <div className="grid grid-cols-2 gap-3 font-mono text-xs">
            {/* Top 8 Bids (Teal) */}
            <div>
              <div className="flex justify-between text-[10px] text-neutral-400 uppercase pb-1.5 border-b border-white/5">
                <span>BID ($)</span>
                <span>SIZE (BTC)</span>
              </div>
              <div className="space-y-1 mt-1.5">
                {bids.slice(0, 8).map((b, idx) => (
                  <div
                    key={idx}
                    className="relative flex justify-between py-0.5 px-1.5 rounded overflow-hidden"
                  >
                    <div
                      className={`absolute left-0 inset-y-0 transition-all ${
                        isStaleOrOffline ? 'bg-neutral-800/20' : 'bg-teal-500/15'
                      }`}
                      style={{ width: `${b.depthPct}%` }}
                    />
                    <span
                      className={`relative font-semibold text-[11px] ${
                        isStaleOrOffline ? 'text-neutral-500' : 'text-teal-400'
                      }`}
                    >
                      ${b.price.toFixed(2)}
                    </span>
                    <span className="relative text-neutral-300 text-[11px]">
                      {b.qty.toFixed(4)}
                    </span>
                  </div>
                ))}
                {bids.length === 0 && (
                  <div className="text-neutral-600 text-center py-6 text-xs">
                    collecting live depth...
                  </div>
                )}
              </div>
            </div>

            {/* Top 8 Asks (Rose) */}
            <div>
              <div className="flex justify-between text-[10px] text-neutral-400 uppercase pb-1.5 border-b border-white/5">
                <span>ASK ($)</span>
                <span>SIZE (BTC)</span>
              </div>
              <div className="space-y-1 mt-1.5">
                {asks.slice(0, 8).map((a, idx) => (
                  <div
                    key={idx}
                    className="relative flex justify-between py-0.5 px-1.5 rounded overflow-hidden"
                  >
                    <div
                      className={`absolute right-0 inset-y-0 transition-all ${
                        isStaleOrOffline ? 'bg-neutral-800/20' : 'bg-rose-500/15'
                      }`}
                      style={{ width: `${a.depthPct}%` }}
                    />
                    <span
                      className={`relative font-semibold text-[11px] ${
                        isStaleOrOffline ? 'text-neutral-500' : 'text-rose-400'
                      }`}
                    >
                      ${a.price.toFixed(2)}
                    </span>
                    <span className="relative text-neutral-300 text-[11px]">
                      {a.qty.toFixed(4)}
                    </span>
                  </div>
                ))}
                {asks.length === 0 && (
                  <div className="text-neutral-600 text-center py-6 text-xs">
                    collecting live depth...
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

OrderBookDepthCard.displayName = 'OrderBookDepthCard';
