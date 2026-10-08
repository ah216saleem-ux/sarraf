import React, { useMemo } from 'react';
import { Candle, Timeframe } from '../data/commandTypes';

interface CandlestickChartPanelProps {
  candles: Candle[];
  timeframe: Timeframe;
  currentPrice: number;
  supportLevel: number;
  resistanceLevel: number;
  isDimmed: boolean;
  freshness: string;
}

export const CandlestickChartPanel: React.FC<CandlestickChartPanelProps> = ({
  candles,
  timeframe,
  currentPrice,
  supportLevel,
  resistanceLevel,
  isDimmed,
  freshness,
}) => {
  const visibleCandles = useMemo(() => {
    return candles.slice(-40);
  }, [candles]);

  const chartData = useMemo(() => {
    if (visibleCandles.length === 0) return null;

    let minPrice = Infinity;
    let maxPrice = -Infinity;

    for (const c of visibleCandles) {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
    }

    minPrice = Math.min(minPrice, currentPrice > 0 ? currentPrice : minPrice, supportLevel - 0.5);
    maxPrice = Math.max(maxPrice, currentPrice > 0 ? currentPrice : maxPrice, resistanceLevel + 0.5);

    const padding = (maxPrice - minPrice) * 0.08 || 1.5;
    minPrice -= padding;
    maxPrice += padding;
    const priceRange = maxPrice - minPrice || 1;

    return { minPrice, maxPrice, priceRange };
  }, [visibleCandles, currentPrice, supportLevel, resistanceLevel]);

  const svgWidth = 600;
  const svgHeight = 220; // taller about 220px
  const paddingLeft = 8;
  const paddingRight = 62;
  const paddingTop = 12;
  const paddingBottom = 20;
  const chartWidth = svgWidth - paddingLeft - paddingRight;
  const chartHeight = svgHeight - paddingTop - paddingBottom;

  if (!chartData || visibleCandles.length === 0) {
    return (
      <div className="relative rounded-lg bg-[#070b14] border border-[#38bdf8]/20 px-3 py-2.5 h-[220px] flex items-center justify-center font-mono text-[11px] text-[#8a96a8]">
        collecting data...
      </div>
    );
  }

  const { minPrice, maxPrice, priceRange } = chartData;

  const getY = (val: number) => {
    return paddingTop + chartHeight - ((val - minPrice) / priceRange) * chartHeight;
  };

  const candleSpacing = chartWidth / visibleCandles.length;
  const candleBodyWidth = Math.max(2, candleSpacing * 0.62);

  const currentPriceY = getY(currentPrice);
  const supportY = getY(supportLevel);
  const resistanceY = getY(resistanceLevel);

  return (
    <div
      className={`relative rounded-lg bg-[#070b14] border border-[#38bdf8]/20 px-3 py-2.5 transition-opacity duration-300 overflow-hidden ${
        isDimmed ? 'opacity-40' : 'opacity-100'
      }`}
    >
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#38bdf8]/40 to-transparent" />

      {/* Header */}
      <div className="flex items-center justify-between font-mono mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-[#38bdf8] uppercase tracking-[0.12em]">
            6. XAUUSD CHART ({timeframe})
          </span>
          <div className="flex items-center gap-1.5 text-[9px] text-[#8a96a8]">
            <span className="px-1 py-0.2 rounded bg-white/5 uppercase">BIQUOTE CANDLES</span>
            <span>·</span>
            <span>{freshness}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[9px] tabular-nums">
          <span className="text-[#ff3b6b]">RES ${resistanceLevel.toFixed(1)}</span>
          <span className="text-[#8a96a8]">·</span>
          <span className="text-[#22e08a]">SUP ${supportLevel.toFixed(1)}</span>
        </div>
      </div>

      {/* SVG Canvas (about 220px high) */}
      <div className="w-full select-none">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-[220px] overflow-visible"
        >
          {/* Subtle horizontal grid lines */}
          {[0.25, 0.5, 0.75].map((ratio) => {
            const y = paddingTop + chartHeight * ratio;
            const priceVal = maxPrice - ratio * priceRange;
            return (
              <g key={ratio}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={svgWidth - paddingRight}
                  y2={y}
                  stroke="rgba(255,255,255,0.05)"
                  strokeDasharray="2 2"
                />
                <text
                  x={svgWidth - paddingRight + 4}
                  y={y + 3}
                  fill="#8a96a8"
                  fontSize="8"
                  fontFamily="monospace"
                >
                  ${priceVal.toFixed(1)}
                </text>
              </g>
            );
          })}

          {/* Support Dashed Line */}
          {supportY >= paddingTop && supportY <= paddingTop + chartHeight && (
            <g>
              <line
                x1={paddingLeft}
                y1={supportY}
                x2={svgWidth - paddingRight}
                y2={supportY}
                stroke="#22e08a"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.8"
              />
              <text
                x={svgWidth - paddingRight + 4}
                y={supportY + 3}
                fill="#22e08a"
                fontSize="8"
                fontFamily="monospace"
              >
                SUP ${supportLevel.toFixed(1)}
              </text>
            </g>
          )}

          {/* Resistance Dashed Line */}
          {resistanceY >= paddingTop && resistanceY <= paddingTop + chartHeight && (
            <g>
              <line
                x1={paddingLeft}
                y1={resistanceY}
                x2={svgWidth - paddingRight}
                y2={resistanceY}
                stroke="#ff3b6b"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.8"
              />
              <text
                x={svgWidth - paddingRight + 4}
                y={resistanceY + 3}
                fill="#ff3b6b"
                fontSize="8"
                fontFamily="monospace"
              >
                RES ${resistanceLevel.toFixed(1)}
              </text>
            </g>
          )}

          {/* Thin Wicks & Candle Bodies */}
          {visibleCandles.map((c, i) => {
            const x = paddingLeft + i * candleSpacing + candleSpacing / 2;
            const isBull = c.close >= c.open;
            const color = isBull ? '#22e08a' : '#ff3b6b';
            const openY = getY(c.open);
            const closeY = getY(c.close);
            const highY = getY(c.high);
            const lowY = getY(c.low);
            const topBody = Math.min(openY, closeY);
            const bodyHeight = Math.max(1.2, Math.abs(openY - closeY));

            return (
              <g key={`candle-${i}`}>
                {/* Thin wick */}
                <line
                  x1={x}
                  y1={highY}
                  x2={x}
                  y2={lowY}
                  stroke={color}
                  strokeWidth="0.8"
                />
                {/* Body */}
                <rect
                  x={x - candleBodyWidth / 2}
                  y={topBody}
                  width={candleBodyWidth}
                  height={bodyHeight}
                  fill={color}
                />
              </g>
            );
          })}

          {/* Last-Price Line & Tag on Right Edge */}
          {currentPriceY >= paddingTop && currentPriceY <= paddingTop + chartHeight && (
            <g>
              <line
                x1={paddingLeft}
                y1={currentPriceY}
                x2={svgWidth - paddingRight}
                y2={currentPriceY}
                stroke="#38bdf8"
                strokeWidth="1"
                strokeDasharray="3 2"
              />
              <rect
                x={svgWidth - paddingRight + 2}
                y={currentPriceY - 7}
                width="56"
                height="14"
                fill="#38bdf8"
                rx="2"
              />
              <text
                x={svgWidth - paddingRight + 30}
                y={currentPriceY + 3}
                fill="#04060b"
                fontSize="8"
                fontFamily="monospace"
                fontWeight="bold"
                textAnchor="middle"
              >
                ${currentPrice.toFixed(2)}
              </text>
            </g>
          )}

          {/* Time axis stamps */}
          {visibleCandles.filter((_, idx) => idx % 8 === 0).map((c, idx) => {
            const realIdx = idx * 8;
            const x = paddingLeft + realIdx * candleSpacing + candleSpacing / 2;
            const timeLabel = new Date(c.time).toTimeString().slice(0, 5);
            return (
              <text
                key={`time-${idx}`}
                x={x}
                y={svgHeight - 4}
                fill="#8a96a8"
                fontSize="8"
                fontFamily="monospace"
                textAnchor="middle"
              >
                {timeLabel}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
