import { getSignalHistory, SignalRecord } from './signalManager.ts';
import { runBacktestReplay } from './sarrafEngine.ts';
import { load30DayArchive } from './newsEngine.ts';

export interface BreakdownBucket {
  signals: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  rTotal: number;
}

export interface PerformanceMetrics {
  totalSignals: number;
  wins: number;
  losses: number;
  breakevens: number;
  expiredOrTimeout: number;
  winRatePercent: number;
  profitFactor: number;
  totalRDollars: number;
  totalRMultiples: number;
  averageR: number; // Expectancy in R per trade
  maxDrawdownR: number; // Max peak-to-trough drawdown in R
  longestLosingStreak: number;
  averageDurationMinutes: number;
  bestDayR: number;
  worstDayR: number;
  historyDaysCount: number;
  isHistoryReliable: boolean; // false if < 14 days or < 30 closed signals
  equityCurve: Array<{ index: number; timestamp: string; rCumulative: number; signalId: string }>;
  sessionBreakdown: {
    ASIAN: BreakdownBucket;
    LONDON: BreakdownBucket;
    NEW_YORK: BreakdownBucket;
  };
  scoreBreakdown: {
    '80_84': BreakdownBucket;
    '85_89': BreakdownBucket;
    '90_PLUS': BreakdownBucket;
  };
  newsDayBreakdown: {
    NEWS_DAYS: BreakdownBucket;
    NORMAL_DAYS: BreakdownBucket;
  };
  backtestComparison: {
    withHTF: any;
    withoutHTF: any;
  };
}

export function computePerformanceMetrics(): PerformanceMetrics {
  const history = getSignalHistory();
  const closedSignals = history.filter((s) => s.status === 'CLOSED');

  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let expiredOrTimeout = 0;
  let totalGrossWinR = 0;
  let totalGrossLossR = 0;
  let totalRMultiples = 0;
  let totalRDollars = 0;
  let totalDurationMinutes = 0;

  // Max Drawdown & Losing Streak Calculation
  let peakR = 0;
  let maxDrawdownR = 0;
  let currentLosingStreak = 0;
  let longestLosingStreak = 0;

  const dailyRMap: Record<string, number> = {};
  let currentCumR = 0;
  const equityCurve: Array<{ index: number; timestamp: string; rCumulative: number; signalId: string }> = [];

  const sessions: Record<'ASIAN' | 'LONDON' | 'NEW_YORK', BreakdownBucket> = {
    ASIAN: { signals: 0, wins: 0, losses: 0, breakevens: 0, winRate: 0, rTotal: 0 },
    LONDON: { signals: 0, wins: 0, losses: 0, breakevens: 0, winRate: 0, rTotal: 0 },
    NEW_YORK: { signals: 0, wins: 0, losses: 0, breakevens: 0, winRate: 0, rTotal: 0 },
  };

  const scores: Record<'80_84' | '85_89' | '90_PLUS', BreakdownBucket> = {
    '80_84': { signals: 0, wins: 0, losses: 0, breakevens: 0, winRate: 0, rTotal: 0 },
    '85_89': { signals: 0, wins: 0, losses: 0, breakevens: 0, winRate: 0, rTotal: 0 },
    '90_PLUS': { signals: 0, wins: 0, losses: 0, breakevens: 0, winRate: 0, rTotal: 0 },
  };

  const newsDayBuckets: Record<'NEWS_DAYS' | 'NORMAL_DAYS', BreakdownBucket> = {
    NEWS_DAYS: { signals: 0, wins: 0, losses: 0, breakevens: 0, winRate: 0, rTotal: 0 },
    NORMAL_DAYS: { signals: 0, wins: 0, losses: 0, breakevens: 0, winRate: 0, rTotal: 0 },
  };

  // Pre-load news dates to identify news days
  const newsEvents = load30DayArchive();
  const newsDaysSet = new Set<string>();
  newsEvents.forEach((evt) => {
    if (evt.isHighImpactUsd && evt.timeUtc) {
      newsDaysSet.add(evt.timeUtc.slice(0, 10));
    }
  });

  let firstTimeMs = Date.now();
  let lastTimeMs = 0;

  // Process signals chronologically for equity curve
  const chronological = [...closedSignals].reverse();

  chronological.forEach((s, idx) => {
    const createdMs = new Date(s.createdAt).getTime();
    if (createdMs < firstTimeMs) firstTimeMs = createdMs;
    if (createdMs > lastTimeMs) lastTimeMs = createdMs;

    const rRealized = s.realizedR || 0;
    const dollarsRealized = s.realizedDollars || 0;
    const dayKey = s.createdAt.slice(0, 10);

    dailyRMap[dayKey] = (dailyRMap[dayKey] || 0) + rRealized;
    currentCumR += rRealized;

    // Peak to trough drawdown
    if (currentCumR > peakR) {
      peakR = currentCumR;
    }
    const dd = peakR - currentCumR;
    if (dd > maxDrawdownR) {
      maxDrawdownR = dd;
    }

    equityCurve.push({
      index: idx + 1,
      timestamp: s.closedAt || s.createdAt,
      rCumulative: Number(currentCumR.toFixed(2)),
      signalId: s.id,
    });

    totalRMultiples += rRealized;
    totalRDollars += dollarsRealized;

    if (s.activatedAt && s.closedAt) {
      const dur = (new Date(s.closedAt).getTime() - new Date(s.activatedAt).getTime()) / 60000;
      totalDurationMinutes += Math.max(0, dur);
    }

    if (s.resultClass === 'WIN') {
      wins++;
      totalGrossWinR += rRealized;
      currentLosingStreak = 0;
    } else if (s.resultClass === 'LOSS') {
      losses++;
      totalGrossLossR += Math.abs(rRealized);
      currentLosingStreak += 1;
      if (currentLosingStreak > longestLosingStreak) {
        longestLosingStreak = currentLosingStreak;
      }
    } else if (s.resultClass === 'BREAKEVEN') {
      breakevens++;
      currentLosingStreak = 0;
    } else {
      expiredOrTimeout++;
    }

    // Session categorization (UTC hours)
    const hour = new Date(s.createdAt).getUTCHours();
    let sessionKey: 'ASIAN' | 'LONDON' | 'NEW_YORK' = 'NEW_YORK';
    if (hour >= 0 && hour < 7) sessionKey = 'ASIAN';
    else if (hour >= 7 && hour < 13) sessionKey = 'LONDON';

    sessions[sessionKey].signals++;
    sessions[sessionKey].rTotal += rRealized;
    if (s.resultClass === 'WIN') sessions[sessionKey].wins++;
    if (s.resultClass === 'LOSS') sessions[sessionKey].losses++;
    if (s.resultClass === 'BREAKEVEN') sessions[sessionKey].breakevens++;

    // Score categorization
    let scoreKey: '80_84' | '85_89' | '90_PLUS' = '80_84';
    if (s.score >= 90) scoreKey = '90_PLUS';
    else if (s.score >= 85) scoreKey = '85_89';

    scores[scoreKey].signals++;
    scores[scoreKey].rTotal += rRealized;
    if (s.resultClass === 'WIN') scores[scoreKey].wins++;
    if (s.resultClass === 'LOSS') scores[scoreKey].losses++;
    if (s.resultClass === 'BREAKEVEN') scores[scoreKey].breakevens++;

    // News Day categorization
    const isNewsDay = newsDaysSet.has(dayKey) || s.newsLockActive;
    const newsKey = isNewsDay ? 'NEWS_DAYS' : 'NORMAL_DAYS';

    newsDayBuckets[newsKey].signals++;
    newsDayBuckets[newsKey].rTotal += rRealized;
    if (s.resultClass === 'WIN') newsDayBuckets[newsKey].wins++;
    if (s.resultClass === 'LOSS') newsDayBuckets[newsKey].losses++;
    if (s.resultClass === 'BREAKEVEN') newsDayBuckets[newsKey].breakevens++;
  });

  // Calculate Win Rates for Breakdown Buckets
  (['ASIAN', 'LONDON', 'NEW_YORK'] as const).forEach((k) => {
    const dec = sessions[k].wins + sessions[k].losses;
    sessions[k].winRate = dec > 0 ? Number(((sessions[k].wins / dec) * 100).toFixed(1)) : 0;
    sessions[k].rTotal = Number(sessions[k].rTotal.toFixed(2));
  });

  (['80_84', '85_89', '90_PLUS'] as const).forEach((k) => {
    const dec = scores[k].wins + scores[k].losses;
    scores[k].winRate = dec > 0 ? Number(((scores[k].wins / dec) * 100).toFixed(1)) : 0;
    scores[k].rTotal = Number(scores[k].rTotal.toFixed(2));
  });

  (['NEWS_DAYS', 'NORMAL_DAYS'] as const).forEach((k) => {
    const dec = newsDayBuckets[k].wins + newsDayBuckets[k].losses;
    newsDayBuckets[k].winRate = dec > 0 ? Number(((newsDayBuckets[k].wins / dec) * 100).toFixed(1)) : 0;
    newsDayBuckets[k].rTotal = Number(newsDayBuckets[k].rTotal.toFixed(2));
  });

  const decisiveTrades = wins + losses;
  const winRatePercent = decisiveTrades > 0 ? Number(((wins / decisiveTrades) * 100).toFixed(1)) : 0;
  const profitFactor =
    totalGrossLossR > 0
      ? Number((totalGrossWinR / totalGrossLossR).toFixed(2))
      : totalGrossWinR > 0
      ? 99.9
      : 1.0;

  const averageR = closedSignals.length > 0 ? Number((totalRMultiples / closedSignals.length).toFixed(2)) : 0;
  const averageDurationMinutes =
    closedSignals.length > 0 ? Math.round(totalDurationMinutes / closedSignals.length) : 0;

  const dailyRValues = Object.values(dailyRMap);
  const bestDayR = dailyRValues.length > 0 ? Number(Math.max(...dailyRValues).toFixed(2)) : 0;
  const worstDayR = dailyRValues.length > 0 ? Number(Math.min(...dailyRValues).toFixed(2)) : 0;

  const historyDaysCount =
    lastTimeMs > firstTimeMs
      ? Math.ceil((lastTimeMs - firstTimeMs) / (1000 * 60 * 60 * 24))
      : closedSignals.length > 0
      ? 1
      : 0;

  const isHistoryReliable = historyDaysCount >= 14 && closedSignals.length >= 30;

  // Run backtests for side-by-side comparison
  let withHTF: any = null;
  let withoutHTF: any = null;
  try {
    withHTF = runBacktestReplay(true);
    withoutHTF = runBacktestReplay(false);
  } catch {}

  return {
    totalSignals: closedSignals.length,
    wins,
    losses,
    breakevens,
    expiredOrTimeout,
    winRatePercent,
    profitFactor,
    totalRDollars: Number(totalRDollars.toFixed(2)),
    totalRMultiples: Number(totalRMultiples.toFixed(2)),
    averageR,
    maxDrawdownR: Number(maxDrawdownR.toFixed(2)),
    longestLosingStreak,
    averageDurationMinutes,
    bestDayR,
    worstDayR,
    historyDaysCount,
    isHistoryReliable,
    equityCurve,
    sessionBreakdown: sessions,
    scoreBreakdown: scores,
    newsDayBreakdown: newsDayBuckets,
    backtestComparison: {
      withHTF,
      withoutHTF,
    },
  };
}

export function generateSignalsCsv(): string {
  const history = getSignalHistory();

  const headers = [
    'Signal_ID',
    'Direction',
    'Status',
    'Result_Class',
    'Entry_Target',
    'Entry_Fill',
    'Stop_Loss',
    'TP1',
    'TP2',
    'TP3',
    'TP4',
    'Highest_TP_Reached',
    'Score',
    'Realized_R',
    'Realized_USD',
    'Duration_Seconds',
    'Created_At_UTC',
    'Closed_At_UTC',
    'News_Lock_Active',
  ];

  const rows = history.map((s) => [
    s.id,
    s.direction,
    s.status,
    s.resultClass || 'N/A',
    s.entryTarget.toFixed(2),
    s.entryFillPrice ? s.entryFillPrice.toFixed(2) : 'N/A',
    s.slTarget.toFixed(2),
    s.tp1Target.toFixed(2),
    s.tp2Target.toFixed(2),
    s.tp3Target.toFixed(2),
    s.tp4Target.toFixed(2),
    s.highestTPReached,
    s.score,
    s.realizedR ? s.realizedR.toFixed(2) : '0.00',
    s.realizedDollars ? s.realizedDollars.toFixed(2) : '0.00',
    s.durationSeconds || 0,
    s.createdAt,
    s.closedAt || 'N/A',
    s.newsLockActive ? 'YES' : 'NO',
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}
