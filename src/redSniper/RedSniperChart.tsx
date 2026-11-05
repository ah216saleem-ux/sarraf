import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  ColorType,
  CrosshairMode,
  UTCTimestamp,
} from 'lightweight-charts';
import { Candle, RedSniperTimeframe } from './feed';
import {
  ChartZoneBoxLayout,
  MIN_ZONE_BOX_HEIGHT_PX,
  OpenSniperTrade,
  PendingTradePlan,
  RedSniperZone,
  StructureEvent,
  computeAuctionProfileFromM5,
  computeEquilibriumLevel,
  formatZoneChartLabel,
  getVisibleStructureLineSpecs,
  layoutChartZoneBoxes,
} from './engine';

interface RedSniperChartProps {
  tf: RedSniperTimeframe;
  candles: Candle[];
  m5Candles?: Candle[];
  atr14: number;
  zones: RedSniperZone[];
  structures: StructureEvent[];
  showBosChoch: boolean;
  onToggleStructure?: () => void;
  onSelectZone?: (zoneId: string) => void;
  showFarZones?: boolean;
  showConsumedZones?: boolean;
  hideConsumed?: boolean;
  zonesPerSide?: number;
  maxZones?: number;
  highlightedZoneId?: string | null;
  openTrades: OpenSniperTrade[];
  pendingPlan: PendingTradePlan | null;
  livePrice: number | null;
  isConnected: boolean;
}

const CHART_HEIGHT = 420;

const COLOR_SELL_STROKE = '#d83a4c';
const COLOR_SELL_TEXT = '#ff8a96';
const COLOR_SELL_FILL = 'rgba(139, 0, 0, 0.42)';
const COLOR_SELL_FILL_HIGH = 'rgba(216, 58, 76, 0.52)';

const COLOR_BUY_STROKE = '#2fd08f';
const COLOR_BUY_TEXT = '#7ff0c0';
const COLOR_BUY_FILL = 'rgba(20, 120, 80, 0.32)';
const COLOR_BUY_FILL_HIGH = 'rgba(47, 208, 143, 0.46)';

const COLOR_GOLD = '#d9ac4a';
const COLOR_CYAN = '#5ad7ff';

function resolveTimeToX(
  chart: IChartApi,
  candles: Candle[],
  targetTime: number,
  plotWidth: number
): number {
  const timeScale = chart.timeScale();
  const direct = timeScale.timeToCoordinate(targetTime as UTCTimestamp);
  if (direct !== null && Number.isFinite(direct)) {
    return Math.max(0, Math.min(plotWidth - 28, direct));
  }
  if (!candles || candles.length === 0) return 0;
  if (targetTime <= candles[0].time) return 0;
  if (targetTime >= candles[candles.length - 1].time) {
    const lastCoord = timeScale.logicalToCoordinate(
      (candles.length - 1) as unknown as import('lightweight-charts').Logical
    );
    return lastCoord !== null && Number.isFinite(lastCoord)
      ? Math.max(0, Math.min(plotWidth - 28, lastCoord))
      : Math.max(0, plotWidth - 40);
  }
  let lo = 0;
  let hi = candles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time < targetTime) lo = mid + 1;
    else hi = mid;
  }
  const logCoord = timeScale.logicalToCoordinate(
    lo as unknown as import('lightweight-charts').Logical
  );
  if (logCoord !== null && Number.isFinite(logCoord)) {
    return Math.max(0, Math.min(plotWidth - 28, logCoord));
  }
  return 0;
}

export const RedSniperChart: React.FC<RedSniperChartProps> = ({
  tf,
  candles,
  m5Candles = [],
  atr14,
  zones,
  structures,
  showBosChoch,
  onToggleStructure,
  onSelectZone,
  showFarZones = false,
  showConsumedZones = true,
  hideConsumed = false,
  zonesPerSide = 5,
  maxZones = 5,
  highlightedZoneId = null,
  openTrades,
  pendingPlan,
  livePrice,
  isConnected,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const loadedBarCountRef = useRef<number>(0);
  const prevTfRef = useRef<RedSniperTimeframe>(tf);
  const lastTapMsRef = useRef<number>(0);
  const renderedZoneBoxesRef = useRef<ChartZoneBoxLayout[]>([]);

  const [showAuction, setShowAuction] = useState<boolean>(false);
  const [showAPlusOnly, setShowAPlusOnly] = useState<boolean>(false);

  const propsRef = useRef({
    tf,
    candles,
    m5Candles,
    atr14,
    zones,
    structures,
    showBosChoch,
    showAuction,
    showAPlusOnly,
    showFarZones,
    showConsumedZones,
    hideConsumed,
    zonesPerSide,
    maxZones,
    highlightedZoneId,
    openTrades,
    pendingPlan,
    livePrice,
  });
  propsRef.current = {
    tf,
    candles,
    m5Candles,
    atr14,
    zones,
    structures,
    showBosChoch,
    showAuction,
    showAPlusOnly,
    showFarZones,
    showConsumedZones,
    hideConsumed,
    zonesPerSide,
    maxZones,
    highlightedZoneId,
    openTrades,
    pendingPlan,
    livePrice,
  };

  const clearOverlayCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const redrawOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!canvas || !chart || !series) return;

    const {
      tf: curTf,
      candles: curCandles,
      m5Candles: curM5Candles,
      atr14: curAtr,
      zones: curZones,
      structures: curStructures,
      showBosChoch: curShowBosChoch,
      showAuction: curShowAuction,
      showAPlusOnly: curShowAPlusOnly,
      hideConsumed: curHideConsumed,
      zonesPerSide: curZonesPerSide,
      highlightedZoneId: curHighlightedId,
      openTrades: curOpenTrades,
      livePrice: curLivePrice,
    } = propsRef.current;

    const parent = canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;
    const fullW = parent.clientWidth || 340;
    const fullH = parent.clientHeight || CHART_HEIGHT;
    if (
      canvas.width !== Math.floor(fullW * dpr) ||
      canvas.height !== Math.floor(fullH * dpr)
    ) {
      canvas.width = Math.floor(fullW * dpr);
      canvas.height = Math.floor(fullH * dpr);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, fullW, fullH);

    const priceScaleWidth = chart.priceScale('right').width() || 58;
    const timeScaleHeight = chart.timeScale().height() || 26;
    const plotWidth = Math.max(60, fullW - priceScaleWidth);
    const plotHeight = Math.max(60, fullH - timeScaleHeight);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, plotWidth, plotHeight);
    ctx.clip();

    const effectiveLivePrice =
      typeof curLivePrice === 'number' && curLivePrice > 0
        ? curLivePrice
        : curCandles.length > 0
        ? curCandles[curCandles.length - 1].close
        : 0;

    // 1) EQ (Equilibrium) dashed line
    const eqInfo = computeEquilibriumLevel(curCandles, curTf);
    if (eqInfo) {
      const yEq = series.priceToCoordinate(eqInfo.eq);
      if (yEq !== null && yEq >= 4 && yEq <= plotHeight - 4) {
        ctx.save();
        ctx.strokeStyle = 'rgba(217, 172, 74, 0.38)';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(0, yEq);
        ctx.lineTo(plotWidth, yEq);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.font = "700 8.5px 'JetBrains Mono', monospace";
        const eqTag = `EQ ${eqInfo.eq.toFixed(2)}`;
        const eqW = ctx.measureText(eqTag).width + 8;
        ctx.fillStyle = 'rgba(3, 3, 3, 0.85)';
        ctx.fillRect(6, Math.max(2, yEq - 7), eqW, 13);
        ctx.fillStyle = COLOR_GOLD;
        ctx.fillText(eqTag, 10, Math.max(11, yEq + 2.5));
        ctx.restore();
      }
    }

    // 2) Optional Auction toggle: VAH / POC / VAL lines computed from last 288 M5 candles
    if (curShowAuction) {
      const auctionSource =
        curM5Candles && curM5Candles.length > 0 ? curM5Candles : curCandles;
      const auction = computeAuctionProfileFromM5(auctionSource, 288);
      if (auction) {
        const auctionLines: Array<{
          label: 'VAH' | 'POC' | 'VAL';
          price: number;
          color: string;
          dashed: boolean;
        }> = [
          { label: 'VAH', price: auction.vah, color: COLOR_CYAN, dashed: true },
          { label: 'POC', price: auction.poc, color: COLOR_GOLD, dashed: false },
          { label: 'VAL', price: auction.val, color: COLOR_CYAN, dashed: true },
        ];
        for (const al of auctionLines) {
          const yA = series.priceToCoordinate(al.price);
          if (yA === null || yA < 2 || yA > plotHeight - 2) continue;
          ctx.save();
          ctx.strokeStyle = al.color;
          ctx.globalAlpha = al.label === 'POC' ? 0.78 : 0.62;
          ctx.lineWidth = al.label === 'POC' ? 1.15 : 0.95;
          ctx.setLineDash(al.dashed ? [3, 3] : []);
          ctx.beginPath();
          ctx.moveTo(0, yA);
          ctx.lineTo(plotWidth, yA);
          ctx.stroke();

          ctx.setLineDash([]);
          ctx.globalAlpha = 0.95;
          ctx.font = "700 8.5px 'JetBrains Mono', monospace";
          const txt = `${al.label} ${al.price.toFixed(0)}`;
          const tw = ctx.measureText(txt).width + 8;
          ctx.fillStyle = 'rgba(3, 3, 3, 0.86)';
          ctx.fillRect(6, Math.max(2, yA - 7), tw, 13);
          ctx.fillStyle = al.color;
          ctx.fillText(txt, 10, Math.max(11, yA + 2.5));
          ctx.restore();
        }
      }
    }

    // 3) Structure lines: for the last 8 breaks draw a dashed horizontal line from broken pivot
    //    to break candle, with "CHoCH" or "BOS" centered on the line (above for bullish, below for bearish;
    //    green = bullish, dark red = bearish, CHoCH brighter than BOS)
    if (curShowBosChoch && curStructures.length > 0) {
      const visibleSpecs = getVisibleStructureLineSpecs(curStructures, 8);
      ctx.save();
      ctx.font = "700 9px 'JetBrains Mono', monospace";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (const spec of visibleSpecs) {
        const y = series.priceToCoordinate(spec.level);
        if (y === null || y < 6 || y > plotHeight - 6) continue;
        const x1 = resolveTimeToX(chart, curCandles, spec.pivotTime, plotWidth);
        const x2 = resolveTimeToX(chart, curCandles, spec.breakTime, plotWidth);
        if (x2 <= x1 + 6) continue;

        ctx.strokeStyle = spec.strokeColor;
        ctx.lineWidth = spec.lineWidth;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();

        ctx.setLineDash([]);
        const midX = (x1 + x2) / 2;
        const textY = spec.labelPlacement === 'ABOVE' ? y - 7 : y + 8;
        const tw = ctx.measureText(spec.text).width + 6;
        ctx.fillStyle = 'rgba(3, 3, 3, 0.82)';
        ctx.fillRect(midX - tw / 2, textY - 5.5, tw, 11);
        ctx.fillStyle = spec.textColor;
        ctx.fillText(spec.text, midX, textY);
      }
      ctx.restore();
    }

    // 4) Open trade lines (drawn before zone boxes so they never cross zone label text)
    for (const tr of curOpenTrades) {
      if (tr.tf !== curTf) continue;
      const lines: Array<{
        price: number;
        label: string;
        color: string;
        dashed: boolean;
      }> = [
        {
          price: tr.entry,
          label: tr.beMoved ? `${tr.side} ENTRY (BE)` : `${tr.side} ENTRY`,
          color: COLOR_CYAN,
          dashed: false,
        },
      ];

      if (!tr.beMoved) {
        lines.push({
          price: tr.sl,
          label: 'STOP',
          color: COLOR_SELL_STROKE,
          dashed: true,
        });
      } else if (tr.isTrailing) {
        lines.push({
          price: tr.sl,
          label: 'TRAIL',
          color: COLOR_BUY_STROKE,
          dashed: true,
        });
      }

      if (!tr.tp1Hit) {
        lines.push({
          price: tr.tp1,
          label: 'T1 (1R)',
          color: COLOR_BUY_STROKE,
          dashed: true,
        });
      }
      if (!tr.tp2Hit) {
        lines.push({
          price: tr.tp2,
          label: 'T2 (2R)',
          color: COLOR_BUY_STROKE,
          dashed: true,
        });
      }
      lines.push({
        price: tr.tp3,
        label: tr.tp3IsLiquidity ? 'T3 (LIQ)' : 'T3 (3R)',
        color: COLOR_GOLD,
        dashed: false,
      });

      for (const ln of lines) {
        const y = series.priceToCoordinate(ln.price);
        if (y === null || y < 0 || y > plotHeight) continue;
        ctx.save();
        ctx.strokeStyle = ln.color;
        ctx.lineWidth = 1;
        ctx.setLineDash(ln.dashed ? [4, 4] : []);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(plotWidth, y);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.font = "700 9px 'JetBrains Mono', monospace";
        ctx.fillStyle = ln.color;
        ctx.shadowColor = '#030303';
        ctx.shadowBlur = 3;
        ctx.fillText(
          `${ln.label} ${ln.price.toFixed(2)}`,
          8,
          Math.max(10, y - 3)
        );
        ctx.restore();
      }
    }

    // 5) Order Block Zone Boxes (starts at extreme OB candle and extends to right edge;
    //    TRUE price height with minimum 14px, no stacking shift;
    //    label INSIDE the box, vertically centered, ONE line, font 9px, NO line crossing the text;
    //    if two labels collide vertically (|a.labelY - b.labelY| < 12), hide the lower-PWR label)
    const tfOnlyZones = curZones.filter((z) => z.tf === curTf);
    const filteredByAPlus = curShowAPlusOnly
      ? tfOnlyZones.filter((z) => z.isAPlus || z.id === curHighlightedId)
      : tfOnlyZones;
    const nonConsumedZones = filteredByAPlus.filter(
      (z) =>
        !curHideConsumed ||
        (!z.consumed && z.pctLeft >= 10 && z.retests < 4) ||
        z.id === curHighlightedId
    );

    const perSideCap = Math.max(3, Math.min(5, Math.round(curZonesPerSide || 5)));
    const byCreationNewest = (a: RedSniperZone, b: RedSniperZone) =>
      b.originIndex - a.originIndex || b.time - a.time;

    const eligibleSells = nonConsumedZones
      .filter((z) => z.side === 'SELL')
      .sort(byCreationNewest)
      .slice(0, perSideCap);
    const eligibleBuys = nonConsumedZones
      .filter((z) => z.side === 'BUY')
      .sort(byCreationNewest)
      .slice(0, perSideCap);
    const eligibleForBox = [...eligibleSells, ...eligibleBuys];
    const boxIds = new Set(eligibleForBox.map((z) => z.id));
    if (curHighlightedId) {
      boxIds.add(curHighlightedId);
    }

    const extraClippedTop: RedSniperZone[] = [];
    const extraClippedBot: RedSniperZone[] = [];
    const candidateZonesForLayout: RedSniperZone[] = [];

    for (const z of nonConsumedZones) {
      if (!boxIds.has(z.id)) {
        if (z.bottom >= effectiveLivePrice) {
          extraClippedTop.push(z);
        } else {
          extraClippedBot.push(z);
        }
        continue;
      }
      candidateZonesForLayout.push(z);
    }

    const layoutRes = layoutChartZoneBoxes({
      zones: candidateZonesForLayout,
      priceToY: (price) => series.priceToCoordinate(price),
      timeToX: (time) => resolveTimeToX(chart, curCandles, time, plotWidth),
      plotWidth,
      plotHeight,
      highlightedZoneId: curHighlightedId,
      defaultAtr: curAtr,
      minBoxHeightPx: MIN_ZONE_BOX_HEIGHT_PX,
    });
    const stackedBoxes = layoutRes.boxes;
    const clippedTopZones = [...extraClippedTop, ...layoutRes.clippedTopZones];
    const clippedBottomZones = [
      ...extraClippedBot,
      ...layoutRes.clippedBottomZones,
    ];
    renderedZoneBoxesRef.current = stackedBoxes;

    const labelProtectedRects: Array<{
      left: number;
      right: number;
      top: number;
      bottom: number;
    }> = [];

    for (const zb of stackedBoxes) {
      const {
        zone: z,
        xStart,
        boxTop,
        boxH,
        boxW,
        labelText,
        labelX,
        labelY,
        showLabel,
        pwrBarX,
        pwrBarY,
        pwrBarW,
        pwrBarMaxW,
        pwrBarH,
        isHighlighted,
        isDimmed,
        isAPlus,
      } = zb;

      const isSell = z.side === 'SELL';
      const strokeColor = isSell ? COLOR_SELL_STROKE : COLOR_BUY_STROKE;
      const textColor = isSell ? COLOR_SELL_TEXT : COLOR_BUY_TEXT;
      const fillColor = isHighlighted
        ? isSell
          ? COLOR_SELL_FILL_HIGH
          : COLOR_BUY_FILL_HIGH
        : isSell
        ? COLOR_SELL_FILL
        : COLOR_BUY_FILL;

      ctx.save();
      ctx.globalAlpha = isDimmed && !isHighlighted ? 0.55 : 1.0;

      // Soft glow on A+ zones
      if (isAPlus || isHighlighted) {
        ctx.shadowColor = isHighlighted
          ? 'rgba(217, 172, 74, 0.65)'
          : isSell
          ? 'rgba(216, 58, 76, 0.65)'
          : 'rgba(47, 208, 143, 0.65)';
        ctx.shadowBlur = 12;
      }

      ctx.fillStyle = fillColor;
      ctx.fillRect(xStart, boxTop, boxW, boxH);

      ctx.strokeStyle = isHighlighted
        ? COLOR_GOLD
        : isAPlus
        ? isSell
          ? '#ff5c6f'
          : '#49ebb0'
        : strokeColor;
      ctx.lineWidth = isHighlighted ? 2.0 : isAPlus ? 1.5 : 1.2;
      ctx.setLineDash([]);
      ctx.strokeRect(
        xStart + 0.5,
        boxTop + 0.5,
        Math.max(1, boxW - 1),
        Math.max(1, boxH - 1)
      );

      // Reset shadow before drawing inner PWR bar and label
      ctx.shadowBlur = 0;

      // Small PWR bar on the bottom edge of the box
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(pwrBarX, pwrBarY, pwrBarMaxW, pwrBarH);
      ctx.fillStyle = isAPlus ? COLOR_GOLD : strokeColor;
      ctx.fillRect(pwrBarX, pwrBarY, pwrBarW, pwrBarH);

      // Single-line 9px label INSIDE the box, vertically centered, with dark backdrop so NO line crosses the text
      if (showLabel !== false) {
        const text = labelText || formatZoneChartLabel(z);
        ctx.font = "700 9px 'JetBrains Mono', monospace";
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';

        const maxAvailTextW = Math.max(40, plotWidth - labelX - 8);
        const measuredW = Math.min(maxAvailTextW, ctx.measureText(text).width);
        const pillPadX = 4;
        const pillH = Math.min(13, Math.max(10, boxH - 2));
        const pillLeft = Math.max(xStart + 2, labelX - pillPadX);
        const pillTop = Math.max(boxTop + 1, labelY - pillH / 2);
        const pillW = Math.min(
          Math.max(12, boxW - 4),
          measuredW + pillPadX * 2
        );

        ctx.fillStyle = 'rgba(3, 3, 3, 0.88)';
        ctx.fillRect(pillLeft, pillTop, pillW, pillH);

        labelProtectedRects.push({
          left: pillLeft - 2,
          right: pillLeft + pillW + 2,
          top: pillTop - 1,
          bottom: pillTop + pillH + 1,
        });

        ctx.fillStyle = isHighlighted
          ? COLOR_GOLD
          : z.isAPlus
          ? COLOR_GOLD
          : textColor;
        ctx.fillText(text, labelX, labelY, maxAvailTextW);
      }

      ctx.restore();
    }

    // 6) Off-screen clipped zone edge markers at top / bottom of plot
    if (clippedTopZones.length > 0) {
      const topZ = [...clippedTopZones].sort((a, b) => a.bottom - b.bottom)[0];
      const tag = `▲ ${formatZoneChartLabel(topZ)}`;
      ctx.save();
      ctx.font = "700 9px 'JetBrains Mono', monospace";
      const tw = ctx.measureText(tag).width + 12;
      const tx = Math.max(4, plotWidth - tw - 8);
      ctx.fillStyle = 'rgba(3, 3, 3, 0.92)';
      ctx.fillRect(tx, 4, tw, 16);
      ctx.strokeStyle =
        topZ.side === 'SELL' ? COLOR_SELL_STROKE : COLOR_BUY_STROKE;
      ctx.lineWidth = 1;
      ctx.strokeRect(tx, 4, tw, 16);
      ctx.fillStyle = topZ.side === 'SELL' ? COLOR_SELL_TEXT : COLOR_BUY_TEXT;
      ctx.fillText(tag, tx + 6, 15);
      ctx.restore();
    }

    if (clippedBottomZones.length > 0) {
      const botZ = [...clippedBottomZones].sort((a, b) => b.top - a.top)[0];
      const tag = `▼ ${formatZoneChartLabel(botZ)}`;
      ctx.save();
      ctx.font = "700 9px 'JetBrains Mono', monospace";
      const tw = ctx.measureText(tag).width + 12;
      const tx = Math.max(4, plotWidth - tw - 8);
      const ty = plotHeight - 20;
      ctx.fillStyle = 'rgba(3, 3, 3, 0.92)';
      ctx.fillRect(tx, ty, tw, 16);
      ctx.strokeStyle =
        botZ.side === 'SELL' ? COLOR_SELL_STROKE : COLOR_BUY_STROKE;
      ctx.lineWidth = 1;
      ctx.strokeRect(tx, ty, tw, 16);
      ctx.fillStyle = botZ.side === 'SELL' ? COLOR_SELL_TEXT : COLOR_BUY_TEXT;
      ctx.fillText(tag, tx + 6, ty + 11);
      ctx.restore();
    }

    // 7) NOW line across plot — breaks around any zone label rect so NO line ever crosses label text
    let yNowCoord: number | null = null;
    if (effectiveLivePrice > 0) {
      const yNow = series.priceToCoordinate(effectiveLivePrice);
      if (yNow !== null && yNow >= 0 && yNow <= plotHeight) {
        yNowCoord = yNow;
        ctx.save();
        ctx.strokeStyle = COLOR_GOLD;
        ctx.lineWidth = 1.25;
        ctx.setLineDash([4, 3]);

        // Collect horizontal intervals blocked by zone label text at yNow
        const blockedSpans = labelProtectedRects
          .filter((r) => yNow >= r.top && yNow <= r.bottom)
          .sort((a, b) => a.left - b.left);

        let curX = 0;
        ctx.beginPath();
        for (const span of blockedSpans) {
          if (span.left > curX) {
            ctx.moveTo(curX, yNow);
            ctx.lineTo(span.left, yNow);
          }
          curX = Math.max(curX, span.right);
        }
        if (curX < plotWidth) {
          ctx.moveTo(curX, yNow);
          ctx.lineTo(plotWidth, yNow);
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    // End plot-area clip so the gold NOW price tag can render directly on the right price axis
    ctx.restore();

    // 8) Gold NOW price tag on the right price axis (plus fallback badge at right plot edge)
    if (effectiveLivePrice > 0 && yNowCoord !== null) {
      ctx.save();
      const priceText = effectiveLivePrice.toFixed(2);
      ctx.font = "700 9.5px 'JetBrains Mono', monospace";
      const tagH = 16;
      const tagY = Math.max(2, Math.min(plotHeight - tagH - 2, yNowCoord - tagH / 2));
      const axisW = Math.max(48, fullW - plotWidth - 2);

      // Gold price tag on the right axis
      ctx.fillStyle = COLOR_GOLD;
      ctx.fillRect(plotWidth + 1, tagY, axisW, tagH);
      ctx.fillStyle = '#030303';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(priceText, plotWidth + 5, tagY + tagH / 2);

      // Small "NOW" pill just left of the axis
      const nowPillW = 30;
      ctx.fillStyle = 'rgba(3, 3, 3, 0.9)';
      ctx.fillRect(plotWidth - nowPillW - 2, tagY, nowPillW, tagH);
      ctx.strokeStyle = COLOR_GOLD;
      ctx.lineWidth = 1;
      ctx.strokeRect(plotWidth - nowPillW - 2, tagY, nowPillW, tagH);
      ctx.fillStyle = COLOR_GOLD;
      ctx.textAlign = 'center';
      ctx.fillText('NOW', plotWidth - nowPillW / 2 - 2, tagY + tagH / 2);
      ctx.restore();
    }

    ctx.restore();
  }, []);

  const handleResetView = useCallback(() => {
    const chart = chartRef.current;
    const curCandles = propsRef.current.candles;
    if (!chart || !curCandles || curCandles.length === 0) return;
    const len = curCandles.length;
    chart.priceScale('right').applyOptions({ autoScale: true });
    chart.timeScale().applyOptions({ rightOffset: 6, barSpacing: 8 });
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, len - 100),
      to: len - 1 + 6,
    });
    requestAnimationFrame(redrawOverlay);
  }, [redrawOverlay]);

  const handleContainerTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (e.touches.length > 0) return;
      const now = Date.now();
      if (now - lastTapMsRef.current < 300) {
        handleResetView();
        lastTapMsRef.current = 0;
      } else {
        lastTapMsRef.current = now;
      }
    },
    [handleResetView]
  );

  const handleContainerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onSelectZone || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      for (const zb of renderedZoneBoxesRef.current) {
        if (
          x >= zb.xStart &&
          x <= zb.xStart + zb.boxW &&
          y >= zb.boxTop &&
          y <= zb.boxBot
        ) {
          onSelectZone(zb.zone.id);
          break;
        }
      }
    },
    [onSelectZone]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth || 340,
      height: CHART_HEIGHT,
      layout: {
        background: { type: ColorType.Solid, color: '#030303' },
        textColor: '#9ca3af',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.028)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.028)' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: { time: true, price: false },
        axisDoubleClickReset: true,
      },
      rightPriceScale: {
        borderColor: 'rgba(139, 20, 32, 0.35)',
        autoScale: true,
        scaleMargins: { top: 0.04, bottom: 0.14 },
      },
      timeScale: {
        borderColor: 'rgba(139, 20, 32, 0.35)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 8,
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: COLOR_BUY_STROKE,
      downColor: COLOR_SELL_STROKE,
      borderUpColor: COLOR_BUY_STROKE,
      borderDownColor: COLOR_SELL_STROKE,
      wickUpColor: COLOR_BUY_STROKE,
      wickDownColor: COLOR_SELL_STROKE,
      priceLineVisible: false,
      lastValueVisible: false,
      autoscaleInfoProvider: () => {
        const {
          tf: curTf,
          candles: bars,
          atr14: curAtr,
          zones: curZones,
          openTrades: curOpenTrades,
          pendingPlan: curPending,
          livePrice: curLive,
        } = propsRef.current;

        if (!bars || bars.length === 0) return null;
        const range = chart.timeScale().getVisibleLogicalRange();
        const rawStart = Math.floor(range ? range.from : bars.length - 100);
        const rawEnd = Math.ceil(range ? range.to : bars.length - 1);
        const startIdx = Math.max(0, Math.min(bars.length - 1, rawStart));
        const endIdx = Math.max(startIdx, Math.min(bars.length - 1, rawEnd));

        let minPrice = Infinity;
        let maxPrice = -Infinity;
        for (let i = startIdx; i <= endIdx; i++) {
          const b = bars[i];
          if (!b) continue;
          if (b.low < minPrice) minPrice = b.low;
          if (b.high > maxPrice) maxPrice = b.high;
        }

        if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice)) {
          const lastBar = bars[bars.length - 1];
          if (!lastBar) return null;
          minPrice = lastBar.low;
          maxPrice = lastBar.high;
        }

        const candleMin = minPrice;
        const candleMax = maxPrice;
        const refPrice =
          typeof curLive === 'number' && curLive > 0
            ? curLive
            : bars[bars.length - 1].close;
        const safeAtr = Math.max(0.5, curAtr || 2.5);

        // Phase 4 Autoscale rule: visible candles plus ONLY the zones that overlap
        // the visible price range expanded by 1 ATR, so far zones never squash the candles.
        const expandMin = candleMin - safeAtr;
        const expandMax = candleMax + safeAtr;
        for (const z of curZones) {
          if (z.tf !== curTf) continue;
          if (z.bottom <= expandMax && z.top >= expandMin) {
            minPrice = Math.min(minPrice, z.bottom);
            maxPrice = Math.max(maxPrice, z.top);
          }
        }

        for (const tr of curOpenTrades) {
          if (tr.tf !== curTf) continue;
          const pts = [tr.entry, tr.tp3];
          if (!tr.beMoved || tr.isTrailing) pts.push(tr.sl);
          if (!tr.tp1Hit) pts.push(tr.tp1);
          if (!tr.tp2Hit) pts.push(tr.tp2);
          for (const p of pts) {
            if (Number.isFinite(p) && p > 0) {
              minPrice = Math.min(minPrice, p);
              maxPrice = Math.max(maxPrice, p);
            }
          }
        }

        if (
          curPending &&
          refPrice > 0 &&
          Math.abs(curPending.entry - refPrice) <= 1.5 * safeAtr
        ) {
          minPrice = Math.min(minPrice, curPending.entry);
          maxPrice = Math.max(maxPrice, curPending.entry);
        }

        const pad = Math.max(0.3, (maxPrice - minPrice) * 0.06);
        return {
          priceRange: {
            minValue: minPrice - pad,
            maxValue: maxPrice + pad,
          },
        };
      },
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volScale',
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale('volScale').applyOptions({
      scaleMargins: { top: 0.86, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    loadedBarCountRef.current = 0;

    const onRangeOrCrosshair = () => requestAnimationFrame(redrawOverlay);
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeOrCrosshair);
    chart.subscribeCrosshairMove(onRangeOrCrosshair);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        if (w > 0 && chartRef.current) {
          chartRef.current.applyOptions({ width: w });
          requestAnimationFrame(redrawOverlay);
        }
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeOrCrosshair);
      chart.unsubscribeCrosshairMove(onRangeOrCrosshair);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      loadedBarCountRef.current = 0;
    };
  }, [redrawOverlay]);

  useEffect(() => {
    const cs = candleSeriesRef.current;
    const vs = volumeSeriesRef.current;
    const chart = chartRef.current;
    if (!cs || !vs || !chart) return;

    const tfChanged = prevTfRef.current !== tf;
    if (tfChanged) {
      clearOverlayCanvas();
      cs.setData([]);
      vs.setData([]);
    }

    if (!candles || candles.length === 0) {
      cs.setData([]);
      vs.setData([]);
      requestAnimationFrame(redrawOverlay);
      return;
    }

    const validBars = candles.filter(
      (c) =>
        Number.isFinite(c.time) &&
        c.time > 0 &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close)
    );
    if (validBars.length === 0) return;

    const barCountChanged = loadedBarCountRef.current !== validBars.length;

    if (tfChanged || barCountChanged || loadedBarCountRef.current === 0) {
      cs.setData(
        validBars.map((c) => ({
          time: c.time as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      );

      vs.setData(
        validBars.map((c) => {
          const isBuyDominant =
            c.buyVol + c.sellVol > 0 ? c.buyVol > c.sellVol : c.close >= c.open;
          return {
            time: c.time as UTCTimestamp,
            value: Number.isFinite(c.tickVolume) ? c.tickVolume : 0,
            color: isBuyDominant
              ? 'rgba(47, 208, 143, 0.32)'
              : 'rgba(216, 58, 76, 0.32)',
          };
        })
      );

      loadedBarCountRef.current = validBars.length;

      if (tfChanged || loadedBarCountRef.current > 0) {
        prevTfRef.current = tf;
        const len = validBars.length;
        chart.priceScale('right').applyOptions({ autoScale: true });
        chart.timeScale().applyOptions({ rightOffset: 6 });
        chart.timeScale().setVisibleLogicalRange({
          from: Math.max(0, len - 100),
          to: len - 1 + 6,
        });
      }

      if (tfChanged) {
        const raf1 = requestAnimationFrame(() => {
          requestAnimationFrame(redrawOverlay);
        });
        return () => cancelAnimationFrame(raf1);
      }
    } else {
      const last = validBars[validBars.length - 1];
      try {
        cs.update({
          time: last.time as UTCTimestamp,
          open: last.open,
          high: last.high,
          low: last.low,
          close: last.close,
        });
        const isBuyDominant =
          last.buyVol + last.sellVol > 0
            ? last.buyVol > last.sellVol
            : last.close >= last.open;
        vs.update({
          time: last.time as UTCTimestamp,
          value: Number.isFinite(last.tickVolume) ? last.tickVolume : 0,
          color: isBuyDominant
            ? 'rgba(47, 208, 143, 0.32)'
            : 'rgba(216, 58, 76, 0.32)',
        });
      } catch {
        // ignore transient ordering edge case
      }
    }

    requestAnimationFrame(redrawOverlay);
  }, [
    candles,
    m5Candles,
    tf,
    atr14,
    zones,
    structures,
    showBosChoch,
    showAuction,
    showAPlusOnly,
    showFarZones,
    showConsumedZones,
    hideConsumed,
    zonesPerSide,
    maxZones,
    highlightedZoneId,
    openTrades,
    pendingPlan,
    livePrice,
    clearOverlayCanvas,
    redrawOverlay,
  ]);

  return (
    <div className="relative w-full h-[420px] overflow-hidden bg-[#030303]">
      {/* Phase 3 Chart Toggle Buttons: Structure, Auction, A+ only, Reset */}
      <div className="absolute top-2.5 left-2.5 z-20 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onToggleStructure?.()}
          className="rs-label cursor-pointer rounded-md px-2.5 py-1 text-[10px] font-bold transition-colors"
          style={{
            backgroundColor: showBosChoch
              ? 'rgba(20, 120, 80, 0.36)'
              : 'rgba(3, 3, 3, 0.85)',
            border: `1px solid ${
              showBosChoch ? '#2fd08f' : 'rgba(139, 20, 32, 0.55)'
            }`,
            color: showBosChoch ? '#7ff0c0' : '#9ca3af',
          }}
        >
          Structure
        </button>

        <button
          type="button"
          onClick={() => setShowAuction((v) => !v)}
          className="rs-label cursor-pointer rounded-md px-2.5 py-1 text-[10px] font-bold transition-colors"
          style={{
            backgroundColor: showAuction
              ? 'rgba(90, 215, 255, 0.18)'
              : 'rgba(3, 3, 3, 0.85)',
            border: `1px solid ${
              showAuction ? '#5ad7ff' : 'rgba(139, 20, 32, 0.55)'
            }`,
            color: showAuction ? '#5ad7ff' : '#9ca3af',
          }}
        >
          Auction
        </button>

        <button
          type="button"
          onClick={() => setShowAPlusOnly((v) => !v)}
          className="rs-label cursor-pointer rounded-md px-2.5 py-1 text-[10px] font-bold transition-colors"
          style={{
            backgroundColor: showAPlusOnly
              ? 'rgba(217, 172, 74, 0.22)'
              : 'rgba(3, 3, 3, 0.85)',
            border: `1px solid ${
              showAPlusOnly ? '#d9ac4a' : 'rgba(139, 20, 32, 0.55)'
            }`,
            color: showAPlusOnly ? '#d9ac4a' : '#9ca3af',
          }}
        >
          A+ only
        </button>

        <button
          type="button"
          onClick={handleResetView}
          title="Reset chart zoom and pan (or double-tap chart)"
          className="rs-label cursor-pointer rounded-md border border-[rgba(139,20,32,0.55)] bg-[#030303]/85 px-2.5 py-1 text-[10px] font-bold text-[#d1d5db] hover:border-[#d9ac4a] hover:text-[#d9ac4a]"
        >
          Reset
        </button>
      </div>

      <div
        ref={containerRef}
        onDoubleClick={handleResetView}
        onTouchEnd={handleContainerTouchEnd}
        onClick={handleContainerClick}
        className="w-full h-full"
      />
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 w-full h-full z-10"
        style={{ zIndex: 10 }}
      />
      {(!candles || candles.length === 0) && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[#030303]/85">
          <span className="rs-heading text-xs font-bold tracking-[0.2em] text-[#d9ac4a]">
            {isConnected ? 'NO DATA' : 'WAITING FOR LIVE FEED'}
          </span>
        </div>
      )}
    </div>
  );
};
