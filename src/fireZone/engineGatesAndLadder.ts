// src/fireZone/engineGatesAndLadder.ts
import {
  Candle,
  Pivot,
  FireZone,
  ZoneSide,
  LevelWall,
  TradePlan,
  StructureEvent,
  GateEvaluation,
  GateItem,
  LadderRow,
  FireZoneEngineResult,
} from './types';


export function evaluateGates(
  candles: Candle[],
  pivotsL15: Pivot[],
  structureEvents: StructureEvent[],
  trend: 1 | -1 | 0,
  swingTrend: 1 | -1 | 0,
  activeSide: ZoneSide,
  activePlan: TradePlan | null,
  zhOrZone: number | FireZone | ChartModelZone | null = 4.0,
  currentPrice = 0
): GateEvaluation {
  const isBuy = activeSide === 'BUY';
  const totalBars = candles.length;

  // Gate 1: Structure Aligned
  const structPass = isBuy ? trend > 0 : trend < 0;

  // Gate 2: Discount / Premium side vs L=15 swing range
  const highs15 = pivotsL15.filter((p) => p.type === 'HIGH').map((p) => p.price);
  const lows15 = pivotsL15.filter((p) => p.type === 'LOW').map((p) => p.price);
  const recentSample = candles.slice(-150);
  const swingHigh15 =
    highs15.length > 0
      ? highs15[highs15.length - 1]
      : recentSample.length > 0
      ? Math.max(...recentSample.map((c) => c.high))
      : currentPrice + 20;
  const swingLow15 =
    lows15.length > 0
      ? lows15[lows15.length - 1]
      : recentSample.length > 0
      ? Math.min(...recentSample.map((c) => c.low))
      : currentPrice - 20;
  const mid15 = (Math.max(swingHigh15, swingLow15) + Math.min(swingHigh15, swingLow15)) / 2;
  const discPremPass = isBuy ? currentPrice <= mid15 : currentPrice >= mid15;

  // Gate 3: Zone Proximity (<= $6.00)
  const dist = activePlan ? activePlan.distance : 999;
  const proxPass = activePlan !== null && dist <= 6.00;

  // Gate 4: Rejection Candle on last closed candle
  let rejPass = false;
  if (totalBars > 0) {
    const last = candles[totalBars - 1];
    const body = Math.abs(last.close - last.open);
    const lowerWick = Math.min(last.open, last.close) - last.low;
    const upperWick = last.high - Math.max(last.open, last.close);
    rejPass = isBuy
      ? last.close > last.open && lowerWick > 0.6 * body
      : last.close < last.open && upperWick > 0.6 * body;
  }

  // Gate 5: Fresh BOS/CHoCH within 40 candles in zone direction
  const targetDir = isBuy ? 1 : -1;
  const minBarIdx = Math.max(0, totalBars - 40);
  const freshBosPass = structureEvents.some(
    (ev) => ev.barIndex >= minBarIdx && ev.direction === targetDir
  );

  // Gate 6: R:R (TP1) >= 1.0
  const rrVal = activePlan ? activePlan.rrTp1 : 0;
  const rrPass = rrVal >= 1.0;

  // Gate 7: Level Not in BROKEN State
  let levelNotBrokenPass = activePlan !== null;
  if (typeof zhOrZone === 'object' && zhOrZone !== null) {
    const zState = ('state' in zhOrZone ? zhOrZone.state : (zhOrZone as FireZone).lifecycleState);
    const isDead = ('isDead' in zhOrZone ? (zhOrZone as FireZone).isDead : false);
    if (zState === 'BROKEN' || isDead) {
      levelNotBrokenPass = false;
    }
  }

  const swingHigh = Math.max(swingHigh15, swingLow15);
  const swingLow = Math.min(swingHigh15, swingLow15);
  const swingSpan = Math.max(0.01, swingHigh - swingLow);
  const swingPct = Math.max(0, Math.min(100, Math.round(((currentPrice - swingLow) / swingSpan) * 100)));
  const structStateWord = trend < 0 ? 'bearish' : trend > 0 ? 'bullish' : 'neutral';

  const gates: GateItem[] = [
    {
      id: 'structure',
      label: 'Structure aligned',
      passed: structPass,
      reasonIfFailed: `Structure is ${structStateWord}, not aligned with the ${activeSide} zone.`,
    },
    {
      id: 'disc_prem',
      label: 'Discount/Premium side',
      passed: discPremPass,
      reasonIfFailed: `Price sits at ${swingPct}% of the swing range (${
        isBuy ? 'buy needs the lower half' : 'sell needs the upper half'
      }).`,
    },
    {
      id: 'proximity',
      label: 'Zone proximity',
      passed: proxPass,
      reasonIfFailed: `Price is $${dist.toFixed(2)} away from the ${activeSide} zone (needs $6 or less). Wait for a pullback.`,
    },
    {
      id: 'rejection',
      label: 'Rejection candle',
      passed: rejPass,
      reasonIfFailed: 'Last closed candle is not a clear rejection.',
    },
    {
      id: 'fresh_bos',
      label: 'Fresh BOS / CHoCH',
      passed: freshBosPass,
      reasonIfFailed: 'No fresh BOS/CHoCH in the last 40 candles in this direction.',
    },
    {
      id: 'rr_tp1',
      label: 'R:R minimum',
      passed: rrPass,
      reasonIfFailed: `Risk:reward ${rrVal.toFixed(1)} is below 1.`,
    },
    {
      id: 'level_not_broken',
      label: 'Level not broken',
      passed: levelNotBrokenPass,
      reasonIfFailed: 'Level was broken on a closed candle.',
    },
  ];

  const passedCount = gates.filter((g) => g.passed).length;
  const tradeAllowed = passedCount >= 5;
  const signal: 'BUY' | 'SELL' | 'WAIT' = tradeAllowed ? activeSide : 'WAIT';
  const biasLabel: 'BUY' | 'SELL' | 'RANGE' = trend > 0 ? 'BUY' : trend < 0 ? 'SELL' : 'RANGE';
  const htfLabel: 'UP' | 'DOWN' =
    swingTrend > 0 ? 'UP' : swingTrend < 0 ? 'DOWN' : currentPrice >= mid15 ? 'UP' : 'DOWN';

  let buyPct = 20, waitPct = 60, sellPct = 20;
  if (tradeAllowed) {
    const activePct = Math.min(82, Math.round(45 + (passedCount / 7) * 38));
    const oppPct = Math.max(6, Math.round(((7 - passedCount) / 7) * 18));
    waitPct = Math.max(10, 100 - activePct - oppPct);
    buyPct = isBuy ? activePct : 100 - activePct - waitPct;
    sellPct = isBuy ? 100 - activePct - waitPct : activePct;
  } else {
    waitPct = Math.min(78, Math.max(46, Math.round(78 - (passedCount / 7) * 32)));
    const rem = 100 - waitPct;
    const activeShare = Math.round(rem * (0.55 + (passedCount / 7) * 0.25));
    buyPct = isBuy ? activeShare : rem - activeShare;
    sellPct = isBuy ? rem - activeShare : activeShare;
  }

  let whatToDoNow = 'Waiting for valid zone formation.';
  if (activePlan) {
    const rangeStr = `$${activePlan.entryRange[0].toFixed(2)} – $${activePlan.entryRange[1].toFixed(2)}`;
    whatToDoNow = tradeAllowed
      ? `${activeSide} setup active (${passedCount}/7 gates passed). Look for ${activeSide} execution inside ${rangeStr} (Entry $${activePlan.entryPrice.toFixed(2)}) with SL at $${activePlan.sl.toFixed(2)} and TP1 at $${activePlan.tp1.toFixed(2)}.`
      : `WAIT — only ${passedCount}/7 gates pass. Monitor the ${activeSide} NEAREST zone at ${rangeStr} (SL $${activePlan.sl.toFixed(2)}, TP1 $${activePlan.tp1.toFixed(2)}) and wait for price proximity (<= $6.00) and a clean rejection candle before acting.`;
  }

  return {
    gates, passedCount, totalGates: 7, tradeAllowed, signal, biasLabel, htfLabel,
    buyPct, waitPct, sellPct, whatToDoNow,
  };
}


export interface ChartModelZone {
  id: string;
  side: ZoneSide;
  anchor: number;
  HI: number;
  LO: number;
  top: number;
  bottom: number;
  strength: FireZone['label'];
  score: number;
  type: NonNullable<FireZone['type']>;
  state: 'FRESH' | 'TESTING';
  isStar: boolean;
  isActive: boolean;
  pivotTime: number;
  pivotIndex: number;
  distance: number;
  power?: number;
  statusLabel?: 'FRESH' | 'TESTED' | 'DEEP';
  pctLeft?: number;
  retests?: number;
  customLabel?: string;
}

export interface ChartModelPlanLine {
  id: string;
  kind: 'ENTRY' | 'SL' | 'TRAIL' | 'TP1' | 'TP2' | 'TP3';
  side: ZoneSide;
  label: string;
  price: number;
  color: string;
  dashed: boolean;
}

export interface SimpleLadderRow {
  label:
    | 'SELL STOP'
    | 'SELL ENTRY'
    | 'SELL TP1'
    | 'SELL TP2'
    | 'SELL TP3'
    | 'BUY STOP'
    | 'BUY ENTRY'
    | 'BUY TP1'
    | 'BUY TP2'
    | 'BUY TP3'
    | 'MARKET NOW';
  side: 'SELL' | 'BUY' | 'NOW';
  price: number;
  sortedIndex: number;
}

/**
 * Builds the 007-radar simple ladder rows from ONLY the two NEAREST plans + live price:
 * - SELL rows first (SELL STOP, SELL ENTRY, SELL TP1, SELL TP2, SELL TP3)
 * - BUY rows second (BUY STOP, BUY ENTRY, BUY TP1, BUY TP2, BUY TP3)
 * - ENTRY price = zone anchor
 * - Deduplicates plan rows within $0.05 (SELL rows have priority over BUY rows)
 * - Includes MARKET NOW row at currentPrice
 * - Strictly sorted high to low by price
 */
export function buildSimpleLadderRows(
  sellPlan: TradePlan | null,
  buyPlan: TradePlan | null,
  currentPrice: number
): SimpleLadderRow[] {
  const candidates: Array<{
    label: SimpleLadderRow['label'];
    side: 'SELL' | 'BUY';
    price: number;
  }> = [];

  if (sellPlan) {
    candidates.push(
      { label: 'SELL STOP', side: 'SELL', price: Number(sellPlan.sl.toFixed(2)) },
      { label: 'SELL ENTRY', side: 'SELL', price: Number(sellPlan.anchor.toFixed(2)) },
      { label: 'SELL TP1', side: 'SELL', price: Number(sellPlan.tp1.toFixed(2)) },
      { label: 'SELL TP2', side: 'SELL', price: Number(sellPlan.tp2.toFixed(2)) },
      { label: 'SELL TP3', side: 'SELL', price: Number(sellPlan.tp3.toFixed(2)) }
    );
  }

  if (buyPlan) {
    candidates.push(
      { label: 'BUY STOP', side: 'BUY', price: Number(buyPlan.sl.toFixed(2)) },
      { label: 'BUY ENTRY', side: 'BUY', price: Number(buyPlan.anchor.toFixed(2)) },
      { label: 'BUY TP1', side: 'BUY', price: Number(buyPlan.tp1.toFixed(2)) },
      { label: 'BUY TP2', side: 'BUY', price: Number(buyPlan.tp2.toFixed(2)) },
      { label: 'BUY TP3', side: 'BUY', price: Number(buyPlan.tp3.toFixed(2)) }
    );
  }

  // Deduplicate plan rows within $0.05 (SELL rows have priority over BUY rows)
  const deduplicated: Array<{
    label: SimpleLadderRow['label'];
    side: 'SELL' | 'BUY' | 'NOW';
    price: number;
  }> = [];

  for (const c of candidates) {
    if (!Number.isFinite(c.price) || c.price <= 0) continue;
    const duplicate = deduplicated.some((existing) => Math.abs(existing.price - c.price) <= 0.05);
    if (!duplicate) {
      deduplicated.push(c);
    }
  }

  if (Number.isFinite(currentPrice) && currentPrice > 0) {
    deduplicated.push({
      label: 'MARKET NOW',
      side: 'NOW',
      price: Number(currentPrice.toFixed(2)),
    });
  }

  // Sort strictly high to low by price
  const sorted = [...deduplicated].sort((a, b) => {
    if (b.price !== a.price) return b.price - a.price;
    if (a.side === 'NOW') return -1;
    if (b.side === 'NOW') return 1;
    if (a.side !== b.side) return a.side === 'SELL' ? -1 : 1;
    return a.label.localeCompare(b.label);
  });

  return sorted.map((item, idx) => ({
    ...item,
    sortedIndex: idx,
  }));
}

export interface FireZoneChartModel {
  currentPrice: number;
  atr: number;
  activeSide: ZoneSide;
  zones: ChartModelZone[];
  levels: LevelWall[];
  planLines: ChartModelPlanLine[];
  buyNearestPlan: TradePlan | null;
  sellNearestPlan: TradePlan | null;
  simpleLadder: SimpleLadderRow[];
  structureBreaks: {
    internal: FireZoneEngineResult['dualStructure']['internal']['breaks'];
    swing: FireZoneEngineResult['dualStructure']['swing']['breaks'];
    confirmedSwingPivots: FireZoneEngineResult['dualStructure']['swing']['confirmedPivots'];
  };
  ladder: LadderRow[];
}

export function buildZoneItemsForModel(
  buyZones: FireZone[],
  sellZones: FireZone[],
  currentPrice: number,
  activeSide: ZoneSide
): ChartModelZone[] {
  const combined = [...sellZones, ...buyZones];
  return combined.map((z) => {
    const zType = z.type || 'NEAREST';
    const hi = Number(z.top.toFixed(2));
    const lo = Number(z.bottom.toFixed(2));
    const state: 'FRESH' | 'TESTING' =
      currentPrice > 0 && currentPrice >= lo && currentPrice <= hi ? 'TESTING' : 'FRESH';
    return {
      id: z.id,
      side: z.side,
      anchor: Number(z.anchor.toFixed(2)),
      HI: hi,
      LO: lo,
      top: hi,
      bottom: lo,
      strength: z.label,
      score: z.score,
      type: zType,
      state,
      isStar: Boolean(z.isStar && zType === 'NEAREST'),
      isActive: z.side === activeSide && zType === 'NEAREST',
      pivotTime: z.pivotTime,
      pivotIndex: z.pivotIndex,
      distance: z.distance,
    };
  });
}

export function buildZoneLadder(
  buyZones: FireZone[],
  sellZones: FireZone[],
  buyNearestPlan: TradePlan | null,
  sellNearestPlan: TradePlan | null,
  levels: LevelWall[],
  currentPrice: number,
  activeSide: ZoneSide,
  _atr = 10
): LadderRow[] {
  const rows: LadderRow[] = [];
  const sharedZones = buildZoneItemsForModel(buyZones, sellZones, currentPrice, activeSide);

  for (const z of sharedZones) {
    const starPart = z.isStar ? ' ⭐' : '';
    rows.push({
      id: `retest-${z.id}`,
      kind: 'RETEST',
      label: `${z.side} retest${starPart} ${z.type} ${z.strength}`,
      price: z.anchor,
      distanceDiff: Number((z.anchor - currentPrice).toFixed(3)),
      side: z.side,
      zoneType: z.type,
      strengthLabel: z.strength,
      isStar: z.isStar,
    });
  }

  const nearestPairs: Array<{ zone: ChartModelZone | undefined; plan: TradePlan | null; side: ZoneSide }> = [
    { zone: sharedZones.find((z) => z.side === 'SELL' && z.type === 'NEAREST'), plan: sellNearestPlan, side: 'SELL' },
    { zone: sharedZones.find((z) => z.side === 'BUY' && z.type === 'NEAREST'), plan: buyNearestPlan, side: 'BUY' },
  ];

  for (const { zone, plan, side } of nearestPairs) {
    if (zone) {
      // Entry rows on the far side of NOW are dimmed (opacity: .45)
      const hiFar =
        (side === 'SELL' && zone.HI > currentPrice && zone.LO > currentPrice) ||
        side !== activeSide;
      const loFar =
        (side === 'BUY' && zone.LO < currentPrice && zone.HI < currentPrice) ||
        side !== activeSide;
      rows.push(
        {
          id: `entry-hi-${zone.id}`,
          kind: 'ENTRY_HI',
          label: `${side} entry HI`,
          price: zone.HI,
          distanceDiff: Number((zone.HI - currentPrice).toFixed(3)),
          side,
          isDimmed: hiFar,
        },
        {
          id: `entry-lo-${zone.id}`,
          kind: 'ENTRY_LO',
          label: `${side} entry LO`,
          price: zone.LO,
          distanceDiff: Number((zone.LO - currentPrice).toFixed(3)),
          side,
          isDimmed: loFar,
        }
      );
    }

    if (plan) {
      rows.push(
        { id: `sl-${side}-${plan.zoneId}`, kind: 'SL', label: `${side} SL`, price: plan.sl, distanceDiff: Number((plan.sl - currentPrice).toFixed(3)), side },
        { id: `tp1-${side}-${plan.zoneId}`, kind: 'TP1', label: `${side} TP1`, price: plan.tp1, distanceDiff: Number((plan.tp1 - currentPrice).toFixed(3)), side },
        { id: `tp2-${side}-${plan.zoneId}`, kind: 'TP2', label: `${side} TP2`, price: plan.tp2, distanceDiff: Number((plan.tp2 - currentPrice).toFixed(3)), side },
        { id: `tp3-${side}-${plan.zoneId}`, kind: 'TP3', label: `${side} TP3`, price: plan.tp3, distanceDiff: Number((plan.tp3 - currentPrice).toFixed(3)), side }
      );
    }
  }

  // Levels are already filtered to +/-12*ATR(H1) + zone anchors and ranked by score descending.
  // LEVEL numbers are importance ranks (lvl.rank), NOT vertical position.
  for (let idx = 0; idx < levels.length; idx++) {
    const lvl = levels[idx];
    const rankNum = lvl.rank > 0 ? lvl.rank : idx + 1;
    rows.push({
      id: `level-${rankNum}-${lvl.kind}-${lvl.price.toFixed(2)}`,
      kind: 'LEVEL',
      label: `LEVEL ${rankNum}`,
      subLabel: lvl.label,
      price: lvl.price,
      distanceDiff: Number((lvl.price - currentPrice).toFixed(3)),
      levelImportance: lvl.importance,
      levelNumber: rankNum,
    });
  }

  if (currentPrice > 0) {
    rows.push({
      id: 'now-live-price',
      kind: 'NOW',
      label: `NOW $${currentPrice.toFixed(2)}`,
      price: currentPrice,
      distanceDiff: 0,
    });
  }

  // Sort strictly descending by price; rows at the same price (within $0.05) stay separate rows
  rows.sort((a, b) => {
    if (b.price !== a.price) return b.price - a.price;
    if (a.kind === 'NOW') return -1;
    if (b.kind === 'NOW') return 1;
    return a.id.localeCompare(b.id);
  });

  return rows;
}

/**
 * Single Source of Truth selector used by BOTH FireZoneChart and FireZoneLadder.
 * Guarantees that every zone in the ladder has a drawn counterpart on the chart and vice versa.
 */
export function buildChartModel(engineResult: FireZoneEngineResult): FireZoneChartModel {
  const zones = buildZoneItemsForModel(
    engineResult.buyZones,
    engineResult.sellZones,
    engineResult.currentPrice,
    engineResult.activeSide
  );

  const plan = engineResult.activePlan;
  const planLines: ChartModelPlanLine[] = plan
    ? [
        {
          id: `plan-entry-${plan.zoneId}`,
          kind: 'ENTRY',
          side: plan.side,
          label: `ENTRY ${plan.entryPrice.toFixed(2)}`,
          price: plan.entryPrice,
          color: plan.side === 'BUY' ? '#2ee6a0' : '#ff5d6c',
          dashed: false,
        },
        {
          id: `plan-sl-${plan.zoneId}`,
          kind: 'SL',
          side: plan.side,
          label: `SL ${plan.sl.toFixed(2)}`,
          price: plan.sl,
          color: '#ef4444',
          dashed: false,
        },
        {
          id: `plan-tp1-${plan.zoneId}`,
          kind: 'TP1',
          side: plan.side,
          label: `TP1 ${plan.tp1.toFixed(2)}`,
          price: plan.tp1,
          color: '#22c55e',
          dashed: true,
        },
        {
          id: `plan-tp2-${plan.zoneId}`,
          kind: 'TP2',
          side: plan.side,
          label: `TP2 ${plan.tp2.toFixed(2)}`,
          price: plan.tp2,
          color: '#22c55e',
          dashed: true,
        },
        {
          id: `plan-tp3-${plan.zoneId}`,
          kind: 'TP3',
          side: plan.side,
          label: `TP3 ${plan.tp3.toFixed(2)}`,
          price: plan.tp3,
          color: '#22c55e',
          dashed: true,
        },
      ]
    : [];

  const simpleLadder = buildSimpleLadderRows(
    engineResult.sellNearestPlan,
    engineResult.buyNearestPlan,
    engineResult.currentPrice
  );

  return {
    currentPrice: engineResult.currentPrice,
    atr: engineResult.atr,
    activeSide: engineResult.activeSide,
    zones,
    levels: engineResult.levels,
    planLines,
    buyNearestPlan: engineResult.buyNearestPlan,
    sellNearestPlan: engineResult.sellNearestPlan,
    simpleLadder,
    structureBreaks: {
      internal: engineResult.dualStructure.internal.breaks,
      swing: engineResult.dualStructure.swing.breaks,
      confirmedSwingPivots: engineResult.dualStructure.swing.confirmedPivots,
    },
    ladder: engineResult.ladder,
  };
}


