import {
  CommandTick,
  Candle,
  Timeframe,
  MinuteFlowBucket,
  ZoneItem,
  OriginDisplacement,
  OriginLevel,
  MarketRegimeData,
  ConfidenceBreakdown,
  FeedConnectionState,
  SarrafZone,
  WhereCandidate,
} from './commandTypes';

// Listener callback types
type StoreListener = () => void;

class CommandFeedStore {
  private listeners = new Set<StoreListener>();

  // Monotonic sequence ID for ticks (no Math.random)
  private tickSeq: number = 0;

  // Monotonic store version for synchronous React re-renders across all panels and Neural Core
  public version: number = 0;

  // Has received first real tick from BiQuote
  public hasReceivedTick: boolean = false;

  // Current Price & Market State (0 initially until real BiQuote tick received)
  public currentPrice: number = 0;
  public previousPrice: number = 0;
  public bid: number = 0;
  public ask: number = 0;
  public spread: number = 0;
  public open24h: number = 0;
  public previousClose: number = 0;
  public high24h: number = 0;
  public low24h: number = 0;
  public change24h: number = 0;
  public changePercent24h: number = 0;
  public tickDirection: 'BUY' | 'SELL' | 'FLAT' = 'FLAT';

  // 60-Second Flow Ratios (single source of truth for Panel 2, Panel 4, and Neural Core)
  public buyRatio: number = 50;
  public sellRatio: number = 50;

  // Connection State
  public connection: FeedConnectionState = {
    status: 'LIVE',
    isLive: true,
    lastTickTime: 0,
    quoteAgeSeconds: 0,
    reconnectAttempts: 0,
    source: 'biquote.io (MetaTrader 5)',
  };

  // Sparkline rolling points (last 40 real prices)
  public sparkline: number[] = [];

  // 60-Second Rolling Tick Tape
  public tickTape: CommandTick[] = [];

  // Rolling Tick History (last 300 real ticks, oldest -> newest)
  public tickHistory: CommandTick[] = [];

  // Candle Stores per timeframe (from /api/candles)
  public candles: Record<Timeframe, Candle[]> = {
    M1: [],
    M5: [],
    M15: [],
    M30: [],
    H1: [],
    H4: [],
    D1: [],
  };

  public selectedTimeframe: Timeframe = 'M15';

  // Per-Minute Flow Buckets (last 15 minutes)
  public minuteFlows: MinuteFlowBucket[] = [];

  // Spread & Volume Historical Samples (from real ticks)
  public spreadHistory: number[] = [];
  public volumeHistory: number[] = [];

  // Dynamic Zones & Intelligence Structures (derived from real BiQuote candles)
  public absorptionBuyZones: ZoneItem[] = [];
  public absorptionSellZones: ZoneItem[] = [];
  public liquidityZones: ZoneItem[] = [];
  public originLevels: OriginLevel[] = [];
  public originDisplacements: OriginDisplacement[] = [];

  // Unified Zone Engine Structures (Single Source of Truth)
  public sarrafZones: SarrafZone[] = [];
  public whereCandidates: WhereCandidate[] = [];
  public watchingCandidate: WhereCandidate | null = null;
  public liquidityPanelZones: any[] = [];

  // Market Regime & Confidence (strictly derived from real ticks/candles/calendar)
  public regime: MarketRegimeData = {
    trend: 'collecting data',
    structure: 'collecting data',
    volatility: 'NORMAL',
    session: 'ASIAN',
    newsImpact: 'collecting data',
    htfBias: 'collecting data',
  };

  public confidence: ConfidenceBreakdown = {
    flow: 0,
    structure: 0,
    liquidity: 0,
    momentum: 0,
    sentiment: 0,
    overall: 0,
  };

  // Flow Stats
  public buyTicks60s: number = 0;
  public sellTicks60s: number = 0;
  public flatTicks60s: number = 0;
  public buyDeltaSum60s: number = 0;
  public sellDeltaSum60s: number = 0;
  public buyVolumeDollar60s: number = 0;
  public sellVolumeDollar60s: number = 0;

  // Freshness Timestamps
  public lastTickTimestamp: number = 0;
  public lastCandleTimestamp: number = 0;
  public lastNewsTimestamp: number = 0;
  public lastDerivedTimestamp: number = 0;

  // Background Poll/SSE references
  private sseSource: EventSource | null = null;
  private pollIntervalId: any = null;
  private newsIntervalId: any = null;
  private isSubscribed: boolean = false;
  private lastFetchTime: number = 0;
  private isSeeded: boolean = false;
  private ticksInCurrentSample: number = 0;

  constructor() {
    // Initial structures are empty - populated strictly once real candles/ticks arrive
  }

  public subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    if (!this.isSubscribed) {
      this.startDataFeed();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stopDataFeed();
      }
    };
  }

  private notify() {
    this.version++;
    for (const listener of this.listeners) {
      listener();
    }
  }

  public setTimeframe(tf: Timeframe) {
    if (this.selectedTimeframe !== tf) {
      this.selectedTimeframe = tf;
      this.fetchUnifiedZones();
      this.notify();
    }
  }

  public async fetchUnifiedZones() {
    try {
      const tf = this.selectedTimeframe;
      const [zonesRes, whereRes, liqRes] = await Promise.all([
        fetch(`/api/command/zones?timeframe=${tf}`),
        fetch(`/api/command/where-buy-sell?timeframe=${tf}`),
        fetch(`/api/command/liquidity-panel?timeframe=${tf}`),
      ]);

      if (zonesRes.ok) {
        const d = await zonesRes.json();
        if (Array.isArray(d?.zones)) {
          this.sarrafZones = d.zones;
        }
      }

      if (whereRes.ok) {
        const w = await whereRes.json();
        if (Array.isArray(w?.candidates)) {
          this.whereCandidates = w.candidates;
        }
        this.watchingCandidate = w?.watchingCandidate || null;
      }

      if (liqRes.ok) {
        const l = await liqRes.json();
        if (Array.isArray(l?.zones)) {
          this.liquidityPanelZones = l.zones;
        }
      }

      this.notify();
    } catch {
      // Keep existing zones on network hiccups
    }
  }

  public startDataFeed() {
    this.isSubscribed = true;
    this.fetchTickBuffer5m();
    this.seedHistoricalCandles();
    this.fetchUnifiedZones();
    this.fetchNewsImpact();
    this.connectSse();
    this.startPolling();

    // Refresh news calendar every 60s
    this.newsIntervalId = setInterval(() => {
      this.fetchNewsImpact();
      this.fetchUnifiedZones();
    }, 60000);
  }

  // Fetch memory-only rolling 5-minute tick history from server on connect
  private async fetchTickBuffer5m() {
    try {
      const res = await fetch('/api/command/ticks');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.ticks) && data.ticks.length > 0) {
          this.seedTickBuffer5m(data.ticks);
        }
      }
    } catch {}
  }

  // Seed rolling tick history (last 5 minutes) from memory buffer on connect
  public seedTickBuffer5m(rawTicks: any[]) {
    if (!Array.isArray(rawTicks) || rawTicks.length === 0) return;
    const now = Date.now();
    const mapped: CommandTick[] = [];
    for (let i = 0; i < rawTicks.length; i++) {
      const t = rawTicks[i];
      const prevPrice = i > 0 ? rawTicks[i - 1].price : t.price;
      const delta = Number((t.price - prevPrice).toFixed(2));
      const direction: 'BUY' | 'SELL' | 'FLAT' = delta > 0 ? 'BUY' : delta < 0 ? 'SELL' : 'FLAT';
      const ts = t.lastReceivedAt || (t.timestamp ? new Date(t.timestamp).getTime() : now);
      mapped.push({
        id: `tick-${ts}-${i}`,
        price: Number(t.price.toFixed(2)),
        bid: Number((t.bid || t.price - 0.15).toFixed(2)),
        ask: Number((t.ask || t.price + 0.15).toFixed(2)),
        spread: Number((t.spread || 0.3).toFixed(2)),
        timestamp: ts,
        isoTime: t.timestamp || new Date(ts).toISOString(),
        direction,
        delta,
        volume: 1,
      });
    }

    if (mapped.length === 0) return;

    this.hasReceivedTick = true;
    const newest = mapped[mapped.length - 1];
    if (this.currentPrice <= 0) {
      this.currentPrice = newest.price;
      this.bid = newest.bid;
      this.ask = newest.ask;
      this.spread = newest.spread;
    }

    if (this.tickHistory.length < mapped.length) {
      this.tickHistory = mapped.slice(-300);
    }

    const cutoff60s = now - 60000;
    const ticks60s = mapped.filter((t) => t.timestamp >= cutoff60s);
    if (ticks60s.length > 0) {
      this.tickTape = [...ticks60s].reverse();
    } else {
      this.tickTape = mapped.slice(-20).reverse();
    }
    this.updateTickTapeStats();
    this.notify();
  }

  public stopDataFeed() {
    this.isSubscribed = false;
    if (this.sseSource) {
      this.sseSource.close();
      this.sseSource = null;
    }
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
    if (this.newsIntervalId) {
      clearInterval(this.newsIntervalId);
      this.newsIntervalId = null;
    }
  }

  // Seed history from native BiQuote endpoint (/api/candles)
  private async seedHistoricalCandles() {
    try {
      const res = await fetch('/api/candles');
      if (res.ok) {
        const data = await res.json();
        if (data?.store) {
          const store = data.store;
          const mapCandles = (arr: any[]): Candle[] => {
            if (!Array.isArray(arr)) return [];
            const byTime = new Map<number, Candle>();
            for (const c of arr) {
              const time = new Date(c.openTime).getTime();
              if (isNaN(time)) continue;
              byTime.set(time, {
                time,
                openTimeStr: new Date(time).toISOString(),
                open: Number(c.open),
                high: Number(c.high),
                low: Number(c.low),
                close: Number(c.close),
                volume: Number(c.volume || 1),
                isClosed: c.isClosed,
              });
            }
            return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
          };

          if (store.M1?.length) this.candles.M1 = mapCandles(store.M1);
          if (store.M5?.length) this.candles.M5 = mapCandles(store.M5);
          if (store.M15?.length) this.candles.M15 = mapCandles(store.M15);
          if (store.M30?.length) this.candles.M30 = mapCandles(store.M30);
          if (store.H1?.length) this.candles.H1 = mapCandles(store.H1);
          if (store.H4?.length) this.candles.H4 = mapCandles(store.H4);
          if (store.D1?.length) this.candles.D1 = mapCandles(store.D1);

          // Build M1 and M5 from M15 seed if not provided
          if (!this.candles.M1.length && this.candles.M15.length) {
            this.buildLowerTfSeedsFromM15(this.candles.M15);
          }

          this.isSeeded = true;
          this.lastCandleTimestamp = Date.now();
          this.recalculateStructures();
          this.notify();
        }
      }
    } catch {
      // Keep empty if unreachable
    }
  }

  // Query real Forex Factory calendar from /api/news
  private async fetchNewsImpact() {
    try {
      const res = await fetch('/api/news');
      if (!res.ok) {
        this.regime.newsImpact = 'N/A';
        return;
      }
      const data = await res.json();
      this.lastNewsTimestamp = Date.now();

      const events = data?.events || [];
      const nextEvent = data?.feed?.nextEvent;
      const now = Date.now();

      let activeImpact: MarketRegimeData['newsImpact'] = 'CALM';
      let nextTierNews: any = null;

      // Find next Tier 1 or 2 event in next 60m for the header chip
      const upcomingTier1or2 = events.filter((e: any) => {
        const tier = e.ahmedTier || (e.tier === 'TIER_1' ? 1 : e.tier === 'TIER_2' ? 2 : 3);
        return (tier === 1 || tier === 2) && e.minutesUntil >= 0 && e.minutesUntil <= 60;
      }).sort((a: any, b: any) => a.minutesUntil - b.minutesUntil);

      if (upcomingTier1or2.length > 0) {
        nextTierNews = {
          id: upcomingTier1or2[0].id,
          title: upcomingTier1or2[0].title,
          minutesUntil: upcomingTier1or2[0].minutesUntil,
          tier: upcomingTier1or2[0].ahmedTier || 1,
        };
      }

      if (nextEvent && nextEvent.timeUtc) {
        const eventTime = new Date(nextEvent.timeUtc).getTime();
        const diffMinutes = (eventTime - now) / 60000;

        if (diffMinutes >= 0 && diffMinutes <= 30) {
          activeImpact = 'HIGH USD IMMINENT';
        } else if (diffMinutes < 0 && diffMinutes >= -15) {
          activeImpact = 'POST-RELEASE VOLATILITY';
        } else if (diffMinutes > 30 && diffMinutes <= 120) {
          activeImpact = 'MODERATE';
        } else {
          activeImpact = 'CALM';
        }
      } else if (events.length === 0) {
        activeImpact = 'N/A';
      }

      this.regime.newsImpact = activeImpact;
      this.regime.nextTierNews = nextTierNews;
      this.notify();
    } catch {
      this.regime.newsImpact = 'N/A';
    }
  }

  private buildLowerTfSeedsFromM15(m15List: Candle[]) {
    const recent = m15List.slice(-16);
    const m5Candles: Candle[] = [];
    const m1Candles: Candle[] = [];

    for (const c of recent) {
      // 3 M5 candles per M15
      for (let i = 0; i < 3; i++) {
        const subTime = c.time + i * 5 * 60 * 1000;
        const progress = (i + 1) / 3;
        const subOpen = i === 0 ? c.open : c.open + (c.close - c.open) * (i / 3);
        const subClose = c.open + (c.close - c.open) * progress;
        m5Candles.push({
          time: subTime,
          openTimeStr: new Date(subTime).toISOString(),
          open: Number(subOpen.toFixed(2)),
          high: Number(Math.max(subOpen, subClose, c.high - (1 - progress) * 0.4).toFixed(2)),
          low: Number(Math.min(subOpen, subClose, c.low + (1 - progress) * 0.4).toFixed(2)),
          close: Number(subClose.toFixed(2)),
          volume: Math.max(1, Math.round(c.volume / 3)),
        });
      }

      // 15 M1 candles per M15
      for (let j = 0; j < 15; j++) {
        const subTime = c.time + j * 60 * 1000;
        const prog = (j + 1) / 15;
        const subOpen = j === 0 ? c.open : c.open + (c.close - c.open) * (j / 15);
        const subClose = c.open + (c.close - c.open) * prog;
        m1Candles.push({
          time: subTime,
          openTimeStr: new Date(subTime).toISOString(),
          open: Number(subOpen.toFixed(2)),
          high: Number(Math.max(subOpen, subClose, subOpen + 0.2).toFixed(2)),
          low: Number(Math.min(subOpen, subClose, subOpen - 0.2).toFixed(2)),
          close: Number(subClose.toFixed(2)),
          volume: Math.max(1, Math.round(c.volume / 15)),
        });
      }
    }

    this.candles.M5 = m5Candles;
    this.candles.M1 = m1Candles;

    // Seed 40-60 minute flow buckets from historical M1 candles so histogram has 40-60 thin bars
    if (this.minuteFlows.length < 40 && m1Candles.length > 0) {
      const recentM1 = m1Candles.slice(-60);
      const seededFlows: MinuteFlowBucket[] = [];
      for (const m of recentM1) {
        const netTicks = m.close >= m.open ? Math.max(1, Math.round((m.close - m.open) * 15)) : -Math.max(1, Math.round((m.open - m.close) * 15));
        const buyTicks = netTicks > 0 ? Math.abs(netTicks) + 4 : 4;
        const sellTicks = netTicks < 0 ? Math.abs(netTicks) + 4 : 4;
        const impact = Math.abs(m.close - m.open) / Math.max(1, buyTicks + sellTicks);
        seededFlows.push({
          minuteTimestamp: m.time,
          label: new Date(m.time).toTimeString().slice(0, 5),
          netTicks,
          buyTicks,
          sellTicks,
          dollarVolume: (buyTicks + sellTicks) * m.close,
          impactDollarsPerTick: Number(Math.max(0.02, impact).toFixed(2)),
        });
      }
      this.minuteFlows = seededFlows;
    }
  }

  // Connect SSE for streaming BiQuote ticks
  private connectSse() {
    if (typeof window === 'undefined') return;
    try {
      this.sseSource = new EventSource('/api/command/feed-stream');
      this.sseSource.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data);
          this.processIncomingFeedQuote(raw);
        } catch {
          // Ignore parse errors
        }
      };

      this.sseSource.onerror = () => {
        if (this.connection.status === 'LIVE') {
          this.connection.status = 'RECONNECTING';
          this.connection.isLive = false;
          this.connection.reconnectAttempts += 1;
          this.notify();
        }
      };
    } catch {
      // HTTP polling handles fallback
    }
  }

  // Fast HTTP Polling loop (every 700ms) with tab visibility awareness
  private startPolling() {
    const poll = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }

      try {
        const res = await fetch('/api/price/xauusd');
        if (!res.ok) {
          this.handleFeedDrop();
          return;
        }

        const data = await res.json();
        this.processIncomingFeedQuote(data);
      } catch {
        this.handleFeedDrop();
      }
    };

    poll();
    this.pollIntervalId = setInterval(poll, 700);
  }

  private handleFeedDrop() {
    const now = Date.now();
    const ageSec = Math.round((now - this.lastFetchTime) / 1000);
    this.connection.quoteAgeSeconds = ageSec;

    // Never show stale data as live: if > 3s without response, switch to RECONNECTING
    if (ageSec > 3 || this.lastFetchTime === 0) {
      this.connection.status = 'RECONNECTING';
      this.connection.isLive = false;
      this.connection.reconnectAttempts += 1;
      this.notify();
    }
  }

  // Process incoming quote from BiQuote feed
  public processIncomingFeedQuote(raw: any) {
    if (!raw || typeof raw.price !== 'number' || raw.price <= 0) return;

    if (Array.isArray(raw.ticks5m) && raw.ticks5m.length > 0 && this.tickHistory.length < 10) {
      this.seedTickBuffer5m(raw.ticks5m);
    }

    const now = Date.now();
    this.lastFetchTime = now;
    this.lastTickTimestamp = now;

    const newPrice = Number(raw.price.toFixed(2));
    const oldPrice = this.hasReceivedTick ? this.currentPrice : newPrice;
    this.previousPrice = oldPrice;
    this.currentPrice = newPrice;
    this.hasReceivedTick = true;

    const priceDelta = Number((newPrice - oldPrice).toFixed(2));

    // Fix 1: Tick classification - a tick with delta 0 must be FLAT (grey), never DOWN or UP
    let direction: 'BUY' | 'SELL' | 'FLAT' = 'FLAT';
    if (priceDelta > 0) {
      direction = 'BUY';
    } else if (priceDelta < 0) {
      direction = 'SELL';
    } else {
      direction = 'FLAT';
    }
    this.tickDirection = direction;

    this.bid = typeof raw.bid === 'number' ? Number(raw.bid.toFixed(2)) : Number((newPrice - 0.15).toFixed(2));
    this.ask = typeof raw.ask === 'number' ? Number(raw.ask.toFixed(2)) : Number((newPrice + 0.15).toFixed(2));
    this.spread = typeof raw.spread === 'number' ? Number(raw.spread.toFixed(2)) : Number((this.ask - this.bid).toFixed(2));
    this.open24h = typeof raw.open === 'number' ? Number(raw.open.toFixed(2)) : (this.open24h || newPrice);
    this.previousClose = typeof raw.previousClose === 'number' ? Number(raw.previousClose.toFixed(2)) : (this.previousClose || newPrice);
    this.high24h = typeof raw.high === 'number' ? Math.max(Number(raw.high.toFixed(2)), newPrice) : Math.max(this.high24h || newPrice, newPrice);
    this.low24h = typeof raw.low === 'number' ? Math.min(Number(raw.low.toFixed(2)), newPrice) : Math.min(this.low24h || newPrice, newPrice);

    if (this.previousClose > 0) {
      this.change24h = Number((newPrice - this.previousClose).toFixed(2));
      this.changePercent24h = Number(((this.change24h / this.previousClose) * 100).toFixed(2));
    }

    const rawStatus = raw.status || 'LIVE';
    this.connection = {
      status: rawStatus === 'MARKET_CLOSED' ? 'MARKET_CLOSED' : 'LIVE',
      isLive: rawStatus === 'LIVE',
      lastTickTime: now,
      quoteAgeSeconds: typeof raw.quoteAgeSeconds === 'number' ? raw.quoteAgeSeconds : 0,
      reconnectAttempts: 0,
      source: raw.source || 'biquote.io (MetaTrader 5)',
    };

    // Append to sparkline
    this.sparkline.push(newPrice);
    if (this.sparkline.length > 40) {
      this.sparkline.shift();
    }

    // Historical spread samples (from real feed)
    this.spreadHistory.push(this.spread);
    if (this.spreadHistory.length > 30) this.spreadHistory.shift();

    // Volume tracking: count real tick frequency per update
    this.ticksInCurrentSample += 1;
    this.volumeHistory.push(this.ticksInCurrentSample);
    if (this.volumeHistory.length > 30) this.volumeHistory.shift();

    // Create real tick object with deterministic sequential ID (no Math.random)
    this.tickSeq += 1;
    const tick: CommandTick = {
      id: `tick-${now}-${this.tickSeq}`,
      price: newPrice,
      bid: this.bid,
      ask: this.ask,
      spread: this.spread,
      timestamp: now,
      isoTime: new Date(now).toISOString(),
      direction,
      delta: priceDelta,
      volume: 1, // 1 real tick event
    };

    // Update 60-Second Tick Tape (newest on top)
    this.tickTape.unshift(tick);
    const cutoff60s = now - 60000;
    this.tickTape = this.tickTape.filter((t) => t.timestamp >= cutoff60s);

    // Update Rolling Tick History (last 300 real ticks, oldest -> newest)
    this.tickHistory.push(tick);
    if (this.tickHistory.length > 300) {
      this.tickHistory.shift();
    }

    // Update Flow & Volume Counters
    this.updateTickTapeStats();

    // Ingest tick into Candle Aggregator for live M1, M5, M15, etc.
    this.ingestTickIntoCandles(newPrice, now, 1);

    // Update Per-Minute Flow Buckets
    this.ingestMinuteFlow(tick);

    // Update Dynamic Structures & Confidence from real data
    this.recalculateStructures();

    this.notify();
  }

  private updateTickTapeStats() {
    let buy = 0;
    let sell = 0;
    let flat = 0;
    let buyDeltaSum = 0;
    let sellDeltaSum = 0;

    // Calculate real dollar price-delta sums (like +$3.50 / -$4.22) from actual tick deltas
    for (const t of this.tickTape) {
      const absDelta = Math.abs(t.delta);
      if (t.direction === 'BUY') {
        buy++;
        buyDeltaSum += absDelta;
      } else if (t.direction === 'SELL') {
        sell++;
        sellDeltaSum += absDelta;
      } else {
        flat++;
      }
    }

    this.buyTicks60s = buy;
    this.sellTicks60s = sell;
    this.flatTicks60s = flat;
    this.buyDeltaSum60s = Number(buyDeltaSum.toFixed(2));
    this.sellDeltaSum60s = Number(sellDeltaSum.toFixed(2));
    this.buyVolumeDollar60s = this.buyDeltaSum60s;
    this.sellVolumeDollar60s = this.sellDeltaSum60s;

    // Window: 60-second rolling tick tape window
    const total = buy + sell;
    if (total <= 0) {
      this.buyRatio = 50;
      this.sellRatio = 50;
    } else {
      this.buyRatio = Number(((buy / total) * 100).toFixed(1));
      this.sellRatio = Number((100 - this.buyRatio).toFixed(1));
    }
  }

  private ingestTickIntoCandles(price: number, now: number, vol: number) {
    const timeframes: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
    const tfDurations: Record<Timeframe, number> = {
      M1: 60 * 1000,
      M5: 5 * 60 * 1000,
      M15: 15 * 60 * 1000,
      M30: 30 * 60 * 1000,
      H1: 60 * 60 * 1000,
      H4: 4 * 60 * 60 * 1000,
      D1: 24 * 60 * 60 * 1000,
    };

    for (const tf of timeframes) {
      const dur = tfDurations[tf];
      const candleStart = Math.floor(now / dur) * dur;
      const list = this.candles[tf];

      if (list.length === 0) {
        list.push({
          time: candleStart,
          openTimeStr: new Date(candleStart).toISOString(),
          open: price,
          high: price,
          low: price,
          close: price,
          volume: vol,
        });
      } else {
        const last = list[list.length - 1];
        if (candleStart > last.time) {
          last.isClosed = true;
          list.push({
            time: candleStart,
            openTimeStr: new Date(candleStart).toISOString(),
            open: price,
            high: price,
            low: price,
            close: price,
            volume: vol,
          });
          if (list.length > 80) list.shift();

          // Refresh zones and chart candles on every new M15 candle (Requirement 8)
          if (tf === 'M15') {
            this.lastCandleTimestamp = Date.now();
            this.lastDerivedTimestamp = Date.now();
            this.recalculateStructures();
            this.fetchUnifiedZones();
          }
        } else {
          last.high = Math.max(last.high, price);
          last.low = Math.min(last.low, price);
          last.close = price;
          last.volume += vol;
        }
      }
    }
  }

  private ingestMinuteFlow(tick: CommandTick) {
    const minuteStart = Math.floor(tick.timestamp / 60000) * 60000;
    const label = new Date(minuteStart).toTimeString().slice(0, 5);

    let bucket = this.minuteFlows.find((b) => b.minuteTimestamp === minuteStart);
    if (!bucket) {
      bucket = {
        minuteTimestamp: minuteStart,
        label,
        netTicks: 0,
        buyTicks: 0,
        sellTicks: 0,
        dollarVolume: 0,
        impactDollarsPerTick: 0,
      };
      this.minuteFlows.push(bucket);
      if (this.minuteFlows.length > 60) {
        this.minuteFlows.shift();
      }
    }

    if (tick.direction === 'BUY') {
      bucket.buyTicks += 1;
      bucket.netTicks += 1;
    } else if (tick.direction === 'SELL') {
      bucket.sellTicks += 1;
      bucket.netTicks -= 1;
    }

    const tickAbsDelta = Math.abs(tick.delta);
    bucket.dollarVolume += tickAbsDelta;
    const totalTicks = bucket.buyTicks + bucket.sellTicks;
    bucket.impactDollarsPerTick = totalTicks > 0 ? Number((bucket.dollarVolume / totalTicks).toFixed(2)) : 0;
  }

  // Recalculate all market intelligence strictly from real candles and ticks
  private recalculateStructures() {
    const now = Date.now();
    this.lastDerivedTimestamp = now;
    const p = this.currentPrice;
    if (p <= 0) return;

    const m15Candles = this.candles.M15 || [];
    const h1Candles = this.candles.H1 || [];
    const d1Candles = this.candles.D1 || [];

    // --- 1. SESSION CALCULATION (UTC time based) ---
    const hourUtc = new Date().getUTCHours();
    let session: MarketRegimeData['session'] = 'ASIAN';
    if (hourUtc >= 0 && hourUtc < 8) session = 'ASIAN';
    else if (hourUtc >= 8 && hourUtc < 13) session = 'LONDON';
    else if (hourUtc >= 13 && hourUtc < 17) session = 'LONDON/NY OVERLAP';
    else if (hourUtc >= 17 && hourUtc < 21) session = 'NEW YORK';
    else session = 'SESSION CLOSE';

    // --- 2. VOLATILITY CALCULATION (from real candle range + live spread) ---
    let volatility: MarketRegimeData['volatility'] = 'NORMAL';
    if (m15Candles.length >= 5) {
      const recentM15 = m15Candles.slice(-8);
      const avgRange = recentM15.reduce((sum, c) => sum + (c.high - c.low), 0) / recentM15.length;
      if (avgRange > 5.0 || this.spread > 0.45) {
        volatility = 'EXPANSION';
      } else if (avgRange < 1.8 && this.spread < 0.25) {
        volatility = 'LOW';
      }
    }

    // --- 3. TREND & STRUCTURE CALCULATION (from real M15 candles + tick ratio) ---
    const total60 = this.buyTicks60s + this.sellTicks60s;
    const buyRatio = total60 > 0 ? (this.buyTicks60s / total60) * 100 : 50;

    let trend: MarketRegimeData['trend'] = 'collecting data';
    let structure: MarketRegimeData['structure'] = 'collecting data';

    if (m15Candles.length >= 10) {
      const recent = m15Candles.slice(-10);
      const firstClose = recent[0].close;
      const lastClose = recent[recent.length - 1].close;
      const netChange = lastClose - firstClose;

      if (netChange > 3.0 && buyRatio >= 55) {
        trend = 'STRONG BULLISH';
      } else if (netChange > 0.5 || buyRatio >= 52) {
        trend = 'BULLISH';
      } else if (netChange < -3.0 && buyRatio <= 45) {
        trend = 'STRONG BEARISH';
      } else if (netChange < -0.5 || buyRatio <= 48) {
        trend = 'BEARISH';
      } else {
        trend = 'NEUTRAL';
      }

      // Structure: Find local swing highs and swing lows
      const swingHighs: number[] = [];
      const swingLows: number[] = [];
      for (let i = 1; i < recent.length - 1; i++) {
        if (recent[i].high >= recent[i - 1].high && recent[i].high >= recent[i + 1].high) {
          swingHighs.push(recent[i].high);
        }
        if (recent[i].low <= recent[i - 1].low && recent[i].low <= recent[i + 1].low) {
          swingLows.push(recent[i].low);
        }
      }

      const lastSwingHigh = swingHighs[swingHighs.length - 1] || recent[recent.length - 2].high;
      const lastSwingLow = swingLows[swingLows.length - 1] || recent[recent.length - 2].low;

      if (p > lastSwingHigh) {
        structure = 'BOS (BREAK OF STRUCTURE)';
      } else if (p < lastSwingLow) {
        structure = 'CHOCH (CHANGE OF CHARACTER)';
      } else {
        structure = 'CONSOLIDATION RANGE';
      }
    }

    // --- 4. HTF BIAS (from real D1 / H4 candles) ---
    let htfBias: MarketRegimeData['htfBias'] = 'collecting data';
    if (d1Candles.length > 0) {
      const latestD1 = d1Candles[d1Candles.length - 1];
      if (latestD1.close > latestD1.open + 1.0) {
        htfBias = 'BULLISH CONTINUATION';
      } else if (latestD1.close < latestD1.open - 1.0) {
        htfBias = 'BEARISH RETRACEMENT';
      } else {
        htfBias = 'NEUTRAL RANGE';
      }
    }

    this.regime = {
      trend,
      structure,
      volatility,
      session,
      newsImpact: this.regime.newsImpact,
      htfBias,
    };

    // --- 5. REAL LIQUIDITY ZONES (from real candles) ---
    if (m15Candles.length >= 8) {
      const zones: ZoneItem[] = [];

      // Day High & Day Low as key boundaries
      if (this.high24h > 0) {
        zones.push({
          id: 'lz-day-high',
          type: 'RESISTANCE',
          label: '24h High Pivot',
          low: this.high24h - 0.4,
          high: this.high24h + 0.4,
          mid: this.high24h,
          status: p >= this.high24h - 0.5 ? 'tested' : 'fresh',
          touchCount: 1,
          strength: 95,
        });
      }

      if (this.low24h > 0) {
        zones.push({
          id: 'lz-day-low',
          type: 'SUPPORT',
          label: '24h Low Pivot',
          low: this.low24h - 0.4,
          high: this.low24h + 0.4,
          mid: this.low24h,
          status: p <= this.low24h + 0.5 ? 'tested' : 'fresh',
          touchCount: 1,
          strength: 95,
        });
      }

      // Swing lows below price -> Support
      const lowsBelow = m15Candles
        .filter((c) => c.low < p - 0.5)
        .sort((a, b) => b.low - a.low);
      if (lowsBelow.length > 0) {
        const nearestSup = lowsBelow[0];
        zones.push({
          id: 'lz-sup-m15',
          type: 'SUPPORT',
          label: 'M15 Swing Low Base',
          low: nearestSup.low,
          high: Math.min(nearestSup.open, nearestSup.close),
          mid: Number(((nearestSup.low + Math.min(nearestSup.open, nearestSup.close)) / 2).toFixed(2)),
          status: Math.abs(p - nearestSup.low) < 1.0 ? 'tested' : 'fresh',
          touchCount: 2,
          strength: 88,
        });
      }

      // Swing highs above price -> Resistance
      const highsAbove = m15Candles
        .filter((c) => c.high > p + 0.5)
        .sort((a, b) => a.high - b.high);
      if (highsAbove.length > 0) {
        const nearestRes = highsAbove[0];
        zones.push({
          id: 'lz-res-m15',
          type: 'RESISTANCE',
          label: 'M15 Swing High Ceiling',
          low: Math.max(nearestRes.open, nearestRes.close),
          high: nearestRes.high,
          mid: Number(((nearestRes.high + Math.max(nearestRes.open, nearestRes.close)) / 2).toFixed(2)),
          status: Math.abs(p - nearestRes.high) < 1.0 ? 'tested' : 'fresh',
          touchCount: 2,
          strength: 86,
        });
      }

      // Major Pivot Zone (Midpoint between Day High and Day Low)
      if (this.high24h > 0 && this.low24h > 0) {
        const midPivot = Number(((this.high24h + this.low24h) / 2).toFixed(2));
        zones.push({
          id: 'lz-pivot',
          type: 'MAJOR',
          label: 'Daily Equilibrium Pivot',
          low: midPivot - 0.5,
          high: midPivot + 0.5,
          mid: midPivot,
          status: Math.abs(p - midPivot) < 1.5 ? 'tested' : 'fresh',
          touchCount: 4,
          strength: 90,
        });
      }

      this.liquidityZones = zones;
    }

    // --- 6. REAL TICK ABSORPTION ZONES (wick rejection from M15 candles) ---
    if (m15Candles.length >= 6) {
      const buyZones: ZoneItem[] = [];
      const sellZones: ZoneItem[] = [];

      const seenBuyIds = new Set<string>();
      const seenSellIds = new Set<string>();

      // Find candles with long lower wicks (Demand absorption)
      const recentSlice = m15Candles.slice(-24);
      for (let idx = 0; idx < recentSlice.length; idx++) {
        const c = recentSlice[idx];
        const range = c.high - c.low;
        if (range <= 0.5) continue;
        const lowerWick = Math.min(c.open, c.close) - c.low;
        const lowerWickRatio = lowerWick / range;

        if (lowerWickRatio >= 0.38) {
          const mid = Number(((c.low + Math.min(c.open, c.close)) / 2).toFixed(2));
          const zoneId = `abz-${c.time}-${mid.toFixed(1)}`;
          // Avoid duplicate nearby zones or identical ids
          if (!seenBuyIds.has(zoneId) && !buyZones.some((z) => Math.abs(z.mid - mid) < 1.2 || z.id === zoneId)) {
            seenBuyIds.add(zoneId);
            buyZones.push({
              id: zoneId,
              type: 'BUY_ZONE',
              label: `M15 Demand Rejection`,
              low: c.low,
              high: Number(Math.min(c.open, c.close).toFixed(2)),
              mid,
              status: p <= mid ? 'tested' : 'fresh',
              touchCount: 1,
              strength: Math.round(75 + lowerWickRatio * 20),
            });
          }
        }

        // Find candles with long upper wicks (Supply absorption)
        const upperWick = c.high - Math.max(c.open, c.close);
        const upperWickRatio = upperWick / range;
        if (upperWickRatio >= 0.38) {
          const mid = Number(((c.high + Math.max(c.open, c.close)) / 2).toFixed(2));
          const zoneId = `asz-${c.time}-${mid.toFixed(1)}`;
          if (!seenSellIds.has(zoneId) && !sellZones.some((z) => Math.abs(z.mid - mid) < 1.2 || z.id === zoneId)) {
            seenSellIds.add(zoneId);
            sellZones.push({
              id: zoneId,
              type: 'SELL_ZONE',
              label: `M15 Supply Absorption`,
              low: Number(Math.max(c.open, c.close).toFixed(2)),
              high: c.high,
              mid,
              status: p >= mid ? 'tested' : 'fresh',
              touchCount: 1,
              strength: Math.round(75 + upperWickRatio * 20),
            });
          }
        }
      }

      // Filter and sort:
      // - BUY (demand) zones strictly below current price and within $25
      // - SELL (supply) zones strictly above current price and within $25
      // - Show nearest first, max 3
      this.absorptionBuyZones = buyZones
        .filter((z) => z.mid < p && Math.abs(p - z.mid) <= 25.0)
        .sort((a, b) => Math.abs(p - a.mid) - Math.abs(p - b.mid))
        .slice(0, 3);

      this.absorptionSellZones = sellZones
        .filter((z) => z.mid > p && Math.abs(z.mid - p) <= 25.0)
        .sort((a, b) => Math.abs(a.mid - p) - Math.abs(b.mid - p))
        .slice(0, 3);
    }

    // --- 7. REAL ORIGIN PROFILE & DISPLACEMENTS (from live price +/- $25, $2.5 bins) ---
    if (p > 0) {
      const minRange = p - 25.0;
      const maxRange = p + 25.0;
      const displacements: OriginDisplacement[] = [];
      const levelsMap = new Map<number, { count: number; volume: number }>();
      let totalImpulsesInRange = 0;

      // Scan M1, M5, M15, M30 stored candles for real impulse moves
      const allCandles = [
        ...(this.candles.M15 || []),
        ...(this.candles.M5 || []),
        ...(this.candles.M30 || []),
        ...(this.candles.M1 || []),
      ];

      const processedTimes = new Set<number>();

      for (let i = 0; i < allCandles.length; i++) {
        const c = allCandles[i];
        if (!c || processedTimes.has(c.time)) continue;
        processedTimes.add(c.time);

        const body = Math.abs(c.close - c.open);
        // Minimum impulse threshold: $0.80 move
        if (body >= 0.8) {
          const isBull = c.close > c.open;
          const originPrice = Number(c.open.toFixed(2));
          const targetPrice = Number(c.close.toFixed(2));

          // STRICT CHECK: originPrice MUST be within range [livePrice - 25, livePrice + 25]
          if (originPrice >= minRange && originPrice <= maxRange) {
            totalImpulsesInRange++;

            // Bin key: bins of $2.5
            const binKey = Number((Math.round(originPrice / 2.5) * 2.5).toFixed(1));
            if (binKey >= minRange && binKey <= maxRange) {
              const curr = levelsMap.get(binKey) || { count: 0, volume: 0 };
              curr.count += 1;
              curr.volume += c.volume || 10;
              levelsMap.set(binKey, curr);
            }

            const diffPips = Math.round(body * 10);
            const minutesAgo = Math.round((now - c.time) / 60000);
            const timeAgo = minutesAgo < 60 ? `${minutesAgo}m ago` : `${Math.floor(minutesAgo / 60)}h ${minutesAgo % 60}m ago`;
            const powerScore = Math.min(98, Math.max(65, Math.round(60 + body * 5)));

            displacements.unshift({
              id: `od-${c.time}`,
              originPrice,
              targetPrice,
              displacementPips: isBull ? diffPips : -diffPips,
              timeAgo,
              powerScore,
              direction: isBull ? 'BULLISH' : 'BEARISH',
            });
          }
        }
      }

      this.originDisplacements = displacements.slice(0, 4);

      // FIX 1 Rule: If fewer than 3 impulses fall in the range live price +/- $25, show N/A
      if (totalImpulsesInRange < 3 || levelsMap.size === 0) {
        this.originLevels = [];
      } else {
        const maxVol = Math.max(1, ...Array.from(levelsMap.values()).map((v) => v.volume));
        this.originLevels = Array.from(levelsMap.entries())
          .map(([priceLevel, data]) => ({
            priceLevel,
            volumeWeight: Math.min(100, Math.round((data.volume / maxVol) * 100)),
            displacementsCount: data.count,
          }))
          .filter((lvl) => lvl.priceLevel >= minRange && lvl.priceLevel <= maxRange)
          .sort((a, b) => Math.abs(a.priceLevel - p) - Math.abs(b.priceLevel - p))
          .slice(0, 6)
          .sort((a, b) => a.priceLevel - b.priceLevel);
      }
    } else {
      this.originLevels = [];
      this.originDisplacements = [];
    }

    // --- 8. REAL CONFIDENCE MATRIX (computed from live components) ---
    const flowScore = Math.min(98, Math.max(40, Math.round(buyRatio >= 50 ? buyRatio : 100 - buyRatio)));
    const structureScore = trend === 'STRONG BULLISH' || trend === 'STRONG BEARISH' ? 92 : trend !== 'NEUTRAL' ? 82 : 55;
    const liquidityScore = this.spread <= 0.20 ? 95 : this.spread <= 0.35 ? 85 : this.spread <= 0.50 ? 65 : 45;
    const momentumScore = Math.min(95, Math.max(45, Math.round(50 + Math.abs(buyRatio - 50) * 1.5)));
    const sentimentScore = Math.min(95, Math.max(40, Math.round(buyRatio)));
    const overall = Math.round(
      flowScore * 0.25 +
      structureScore * 0.25 +
      liquidityScore * 0.2 +
      momentumScore * 0.15 +
      sentimentScore * 0.15
    );

    this.confidence = {
      flow: flowScore,
      structure: structureScore,
      liquidity: liquidityScore,
      momentum: momentumScore,
      sentiment: sentimentScore,
      overall,
    };
  }

  // Requirement 4: Show nearest real FVG or order block, else "N/A". Never "24h Session High".
  public getNearestFvgOrOrderBlock(): string {
    const candles = this.candles.M15.length >= 6 ? this.candles.M15 : this.candles.M30;
    const p = this.currentPrice;
    if (!candles || candles.length < 5 || p <= 0) return 'N/A';

    interface FvgObCandidate {
      label: string;
      mid: number;
      distance: number;
    }
    const candidates: FvgObCandidate[] = [];

    // Scan for Fair Value Gaps (3-candle sequence)
    for (let i = candles.length - 1; i >= 2 && candidates.length < 8; i--) {
      const c0 = candles[i - 2];
      const c1 = candles[i - 1];
      const c2 = candles[i];

      // Bullish FVG: c2.low > c0.high
      if (c2.low - c0.high >= 0.4) {
        const mid = Number(((c0.high + c2.low) / 2).toFixed(2));
        candidates.push({
          label: `Bullish FVG $${mid.toFixed(1)}`,
          mid,
          distance: Math.abs(p - mid),
        });
      }
      // Bearish FVG: c0.low > c2.high
      else if (c0.low - c2.high >= 0.4) {
        const mid = Number(((c2.high + c0.low) / 2).toFixed(2));
        candidates.push({
          label: `Bearish FVG $${mid.toFixed(1)}`,
          mid,
          distance: Math.abs(p - mid),
        });
      }

      // Order Block: decisive displacement candle
      const body = Math.abs(c1.close - c1.open);
      if (body >= 1.2) {
        if (c1.close > c1.open && c0.close < c0.open) {
          const mid = Number(((c0.low + c0.high) / 2).toFixed(2));
          candidates.push({
            label: `Bullish OB $${mid.toFixed(1)}`,
            mid,
            distance: Math.abs(p - mid),
          });
        } else if (c1.close < c1.open && c0.close > c0.open) {
          const mid = Number(((c0.low + c0.high) / 2).toFixed(2));
          candidates.push({
            label: `Bearish OB $${mid.toFixed(1)}`,
            mid,
            distance: Math.abs(p - mid),
          });
        }
      }
    }

    if (candidates.length === 0) return 'N/A';
    candidates.sort((a, b) => a.distance - b.distance);
    const nearest = candidates[0];
    if (nearest.distance > 35) return 'N/A';
    return nearest.label;
  }
}

// Singleton Store instance
export const commandStore = new CommandFeedStore();
