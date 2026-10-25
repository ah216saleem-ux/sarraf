export interface BlackstoneTapeTick {
  id: string;
  timestamp: number; // epoch ms
  timeDubai: string; // HH:MM:SS Dubai
  price: number;
  bid: number;
  ask: number;
  spread: number;
  move: 'UP' | 'DOWN' | 'FLAT';
  delta: number; // price - previous price
}

export interface BlackstoneMinuteActivity {
  minuteKey: string; // YYYY-MM-DDTHH:mm
  timeDubai: string; // HH:mm
  timestamp: number;
  count: number;
}

export interface BlackstoneTapeState {
  ticks: BlackstoneTapeTick[];
  activity: {
    minutes: BlackstoneMinuteActivity[];
    avgTicksPerMinute: number;
    currentMinuteTicks: number;
    state: 'LOW' | 'NORMAL' | 'HIGH';
  };
  pressure: {
    last60TicksEvaluated: number;
    upTicks: number;
    downTicks: number;
    flatTicks: number;
    upRatioPct: number;
    downRatioPct: number;
  };
  sourceInfo: {
    source: 'Ahmad server';
    lastTickTimeDubai: string | null;
    lastTickAgeSeconds: number;
    lastReceivedAt: number | null;
  };
  disclaimer: 'Spot gold has no central traded volume. This shows price activity, not contracts.';
}

const MAX_TICKS_STORED = 200;
const tapeTicks: BlackstoneTapeTick[] = [];
const minuteCounts = new Map<string, { count: number; timestamp: number; timeDubai: string }>();

let lastTickTime: number = 0;
let lastTickPrice: number = 0;

function formatDubaiMinute(dateMs: number): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dubai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(dateMs));
  } catch {
    const dubaiMs = dateMs + 4 * 60 * 60 * 1000;
    const d = new Date(dubaiMs);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
}

function formatDubaiFull(dateMs: number): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dubai',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(dateMs));
  } catch {
    const dubaiMs = dateMs + 4 * 60 * 60 * 1000;
    const d = new Date(dubaiMs);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
}

export function recordBlackstoneTapeTick(tick: {
  price: number;
  bid?: number;
  ask?: number;
  spread?: number;
  timestamp?: string | number;
  lastReceivedAt?: number;
}): BlackstoneTapeTick {
  const nowMs = tick.lastReceivedAt ?? (typeof tick.timestamp === 'number' ? tick.timestamp : Date.now());
  const price = Number(tick.price.toFixed(2));
  const bid = Number((tick.bid ?? (price - 0.15)).toFixed(2));
  const ask = Number((tick.ask ?? (price + 0.15)).toFixed(2));
  const spread = Number((tick.spread ?? (ask - bid)).toFixed(2));

  let move: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
  let delta = 0;

  if (lastTickPrice > 0) {
    delta = Number((price - lastTickPrice).toFixed(2));
    if (delta > 0) move = 'UP';
    else if (delta < 0) move = 'DOWN';
    else move = 'FLAT';
  }

  lastTickPrice = price;
  lastTickTime = nowMs;

  const tapeItem: BlackstoneTapeTick = {
    id: `tick_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: nowMs,
    timeDubai: formatDubaiFull(nowMs),
    price,
    bid,
    ask,
    spread,
    move,
    delta,
  };

  tapeTicks.unshift(tapeItem);
  if (tapeTicks.length > MAX_TICKS_STORED) {
    tapeTicks.pop();
  }

  // Update minute buckets
  const minuteFloorMs = Math.floor(nowMs / 60000) * 60000;
  const minuteKey = new Date(minuteFloorMs).toISOString().slice(0, 16);
  const existing = minuteCounts.get(minuteKey);
  if (existing) {
    existing.count += 1;
  } else {
    minuteCounts.set(minuteKey, {
      count: 1,
      timestamp: minuteFloorMs,
      timeDubai: formatDubaiMinute(minuteFloorMs),
    });
  }

  // Prune buckets older than 45 minutes
  const cutoffMs = nowMs - 45 * 60 * 1000;
  for (const [key, data] of minuteCounts.entries()) {
    if (data.timestamp < cutoffMs) {
      minuteCounts.delete(key);
    }
  }

  return tapeItem;
}

export function getBlackstoneTapeState(): BlackstoneTapeState {
  const nowMs = Date.now();
  const ageSeconds = lastTickTime > 0 ? Math.max(0, Math.round((nowMs - lastTickTime) / 1000)) : 999;
  const lastTickTimeDubai = lastTickTime > 0 ? formatDubaiFull(lastTickTime) : null;

  // Build chronological last 30 minutes
  const minutes: BlackstoneMinuteActivity[] = [];
  let totalCount = 0;

  for (let i = 29; i >= 0; i--) {
    const bucketMs = Math.floor((nowMs - i * 60000) / 60000) * 60000;
    const bucketKey = new Date(bucketMs).toISOString().slice(0, 16);
    const stored = minuteCounts.get(bucketKey);
    const count = stored ? stored.count : 0;
    totalCount += count;
    minutes.push({
      minuteKey: bucketKey,
      timeDubai: formatDubaiMinute(bucketMs),
      timestamp: bucketMs,
      count,
    });
  }

  const avgTicksPerMinute = Number((totalCount / 30).toFixed(1));
  const currentMinuteTicks = minutes[minutes.length - 1]?.count || 0;

  let state: 'LOW' | 'NORMAL' | 'HIGH' = 'NORMAL';
  if (avgTicksPerMinute >= 1) {
    if (currentMinuteTicks >= 1.35 * avgTicksPerMinute) {
      state = 'HIGH';
    } else if (currentMinuteTicks <= 0.65 * avgTicksPerMinute) {
      state = 'LOW';
    }
  }

  // Evaluate tick pressure over last 60 ticks
  const last60 = tapeTicks.slice(0, 60);
  let upTicks = 0;
  let downTicks = 0;
  let flatTicks = 0;

  for (const t of last60) {
    if (t.move === 'UP') upTicks++;
    else if (t.move === 'DOWN') downTicks++;
    else flatTicks++;
  }

  const directionalTotal = upTicks + downTicks;
  let upRatioPct = 50;
  let downRatioPct = 50;

  if (directionalTotal > 0) {
    upRatioPct = Number(((upTicks / directionalTotal) * 100).toFixed(1));
    downRatioPct = Number((100 - upRatioPct).toFixed(1));
  }

  return {
    ticks: tapeTicks.slice(0, 50),
    activity: {
      minutes,
      avgTicksPerMinute,
      currentMinuteTicks,
      state,
    },
    pressure: {
      last60TicksEvaluated: last60.length,
      upTicks,
      downTicks,
      flatTicks,
      upRatioPct,
      downRatioPct,
    },
    sourceInfo: {
      source: 'Ahmad server',
      lastTickTimeDubai,
      lastTickAgeSeconds: ageSeconds,
      lastReceivedAt: lastTickTime || null,
    },
    disclaimer: 'Spot gold has no central traded volume. This shows price activity, not contracts.',
  };
}
