// src/atlas/SarrafAtlasView.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAtlasData } from './useAtlasData';
import { useMarket, useMarketAuth } from '../context/MarketContext';
import { AtlasZone } from './atlasTypes';
import { AtlasCandleChart } from './components/AtlasCandleChart';
import { AtlasVolumePanel, AtlasAtrPanel, AtlasEmaClusterPanel } from './components/AtlasIndicatorPanels';

export const SarrafAtlasView: React.FC = () => {
  const { state, error, countdownText, refresh } = useAtlasData();
  const { priceData } = useMarket();
  const { isLoggedIn, user } = useMarketAuth();
  const isAdmin = Boolean(isLoggedIn && (user?.accountType === 'ADMIN' || !user?.accountType));

  // Fallback H1 candles if not in snapshot
  const [fallbackCandles, setFallbackCandles] = useState<any[]>([]);

  useEffect(() => {
    let isCancelled = false;
    if (!state?.h1Candles || state.h1Candles.length < 20) {
      fetch('/api/atlas/candles?tf=H1')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!isCancelled && data?.candles && Array.isArray(data.candles)) {
            setFallbackCandles(data.candles);
          }
        })
        .catch(() => {});
    }
    return () => {
      isCancelled = true;
    };
  }, [state?.h1Candles]);

  const effectiveH1Candles = useMemo(() => {
    if (state?.h1Candles && state.h1Candles.length > 0) {
      return state.h1Candles;
    }
    return fallbackCandles;
  }, [state?.h1Candles, fallbackCandles]);

  // Accordions are CLOSED by default as required
  const [isLiquidityOpen, setIsLiquidityOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);

  // Live Price tick tracking: red on down-tick, green on up-tick
  const livePrice = priceData?.price && priceData.price > 0 ? priceData.price : (state?.livePrice ?? 0);
  const prevPriceRef = useRef<number>(livePrice);
  const [tickDirection, setTickDirection] = useState<'up' | 'down' | 'flat'>('flat');

  useEffect(() => {
    if (livePrice > 0 && prevPriceRef.current > 0) {
      if (livePrice > prevPriceRef.current) {
        setTickDirection('up');
      } else if (livePrice < prevPriceRef.current) {
        setTickDirection('down');
      }
    }
    if (livePrice > 0) {
      prevPriceRef.current = livePrice;
    }
  }, [livePrice]);

  const priceColor = tickDirection === 'up' ? '#2ee66b' : tickDirection === 'down' ? '#ff4d4f' : '#ff4d4f';

  // Toggle Atlas Telegram Alerts (Admin only)
  const handleToggleAlerts = async () => {
    try {
      const res = await fetch('/api/atlas/alerts/toggle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-role': 'admin',
        },
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        refresh();
      }
    } catch (e) {
      console.error('Failed to toggle Atlas alerts:', e);
    }
  };

  // Send Test Telegram Alert (Admin only)
  const handleSendTestAlert = async () => {
    try {
      const res = await fetch('/api/atlas/alerts/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-role': 'admin',
        },
        credentials: 'include',
      });
      await res.json();
      refresh();
    } catch (e) {
      console.error('Failed to send test alert:', e);
    }
  };

  // Date formatter for "SET dd MMM yyyy · HH:mm UTC"
  const formattedPublishTime = useMemo(() => {
    const raw = state?.publishedAt;
    if (raw) {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) {
        const day = d.getUTCDate().toString().padStart(2, '0');
        const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        const month = months[d.getUTCMonth()];
        const year = d.getUTCFullYear();
        const hh = d.getUTCHours().toString().padStart(2, '0');
        const mm = d.getUTCMinutes().toString().padStart(2, '0');
        return `SET ${day} ${month} ${year} · ${hh}:${mm} UTC`;
      }
    }
    if (state?.date) {
      const parts = state.date.split('-');
      if (parts.length === 3) {
        const year = parts[0];
        const monthIdx = parseInt(parts[1], 10) - 1;
        const day = parts[2].padStart(2, '0');
        const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        const month = months[monthIdx] || 'OCT';
        return `SET ${day} ${month} ${year} · 22:00 UTC`;
      }
    }
    return 'SET -- --- ---- · --:-- UTC';
  }, [state?.publishedAt, state?.date]);

  // Loading state
  if (!state && !error) {
    return (
      <div
        style={{
          width: '100%',
          maxWidth: '390px',
          margin: '0 auto',
          boxSizing: 'border-box',
          padding: '16px',
          background: '#05070a',
          color: '#e8eaed',
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: '12px',
        }}
      >
        <div
          style={{
            border: '1px solid rgba(255,255,255,.09)',
            borderRadius: '4px',
            padding: '24px 14px',
            background: '#07090d',
            textAlign: 'center',
          }}
        >
          <div style={{ color: '#f5a623', fontSize: '13px', fontWeight: 700 }}>SYNCHRONIZING ATLAS…</div>
          <div style={{ color: '#8a93a0', fontSize: '11px', marginTop: '6px' }}>Connecting to live BiQuote feed</div>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !state) {
    return (
      <div
        style={{
          width: '100%',
          maxWidth: '390px',
          margin: '0 auto',
          boxSizing: 'border-box',
          padding: '16px',
          background: '#05070a',
          color: '#e8eaed',
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: '12px',
        }}
      >
        <div
          style={{
            border: '1px solid rgba(255,77,79,.4)',
            borderRadius: '4px',
            padding: '20px 14px',
            background: '#07090d',
            textAlign: 'center',
          }}
        >
          <div style={{ color: '#ff4d4f', fontSize: '13px', fontWeight: 700 }}>ATLAS FEED OFFLINE</div>
          <div style={{ color: '#8a93a0', fontSize: '11px', marginTop: '4px' }}>{error}</div>
          <button
            onClick={refresh}
            style={{
              marginTop: '12px',
              padding: '6px 14px',
              background: '#f5a623',
              color: '#05070a',
              fontWeight: 700,
              fontSize: '11px',
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            RETRY
          </button>
        </div>
      </div>
    );
  }

  const {
    status,
    marketStatus,
    pivots,
    zones = [],
    bias,
    targets,
    invalidation,
    scenarios,
    summary,
    tradeState,
    liquidityLevels = [],
    yesterdayReportCard,
    historyList = [],
    alertLogs = [],
    alertsEnabled = false,
    countdownSeconds = 0,
  } = state!;

  const isAnalyzing = status === 'ANALYZING';
  const isMarketClosed = marketStatus === 'MARKET_CLOSED' || priceData?.status === 'MARKET_CLOSED';

  // PP calculations
  const ppLevel = pivots?.PP ?? 0;
  const distToPp = livePrice > 0 && ppLevel > 0 ? Math.abs(livePrice - ppLevel).toFixed(1) : '--';
  const isAbovePp = livePrice >= ppLevel;
  const ppChipColor = isAbovePp ? '#2ee66b' : '#ff4d4f';
  const ppChipBorder = isAbovePp ? 'rgba(46,230,107,.6)' : 'rgba(255,77,79,.6)';

  // Bias calculations
  const biasOverall = bias?.overall || 'NEUTRAL';
  const biasColor = biasOverall === 'BULLISH' ? '#2ee66b' : biasOverall === 'BEARISH' ? '#ff4d4f' : '#8a93a0';
  const biasArrow = biasOverall === 'BULLISH' ? '↗' : biasOverall === 'BEARISH' ? '↘' : '→';
  const biasPreference = bias?.strategyLabel || (biasOverall === 'BULLISH' ? 'Buy dip preferred' : biasOverall === 'BEARISH' ? 'Sell rally preferred' : 'Wait for structure');

  // Timeframe trends mapping
  const tfMap: Record<string, string> = {};
  if (bias?.timeframes) {
    for (const tf of bias.timeframes) {
      tfMap[tf.timeframe] = tf.trend;
    }
  }

  const renderTfTrend = (tf: string, defaultTrend: string) => {
    const raw = tfMap[tf] || defaultTrend;
    const color = raw === 'BULLISH' || raw === 'BULL TREND' ? '#2ee66b' : raw === 'BEARISH' || raw === 'BEAR TREND' ? '#ff4d4f' : '#8a93a0';
    const text = raw === 'BULLISH' ? 'BULL TREND' : raw === 'BEARISH' ? 'BEAR TREND' : raw;
    return <span style={{ color }}>{text}</span>;
  };

  // Separate zones
  const sellZones = zones.filter((z) => z.side === 'SELL');
  const buyZones = zones.filter((z) => z.side === 'BUY');

  // Helper for zone styling and descriptions
  const getZoneCardStyle = (side: 'SELL' | 'BUY', index: number) => {
    if (side === 'SELL') {
      if (index === 0) return { border: '1px solid rgba(255,77,79,.55)', background: 'rgba(255,77,79,.05)' };
      if (index === 1) return { border: '1px solid rgba(255,77,79,.4)', background: 'rgba(255,77,79,.04)' };
      return { border: '1px solid rgba(255,77,79,.3)', background: 'rgba(255,77,79,.03)' };
    } else {
      if (index === 0) return { border: '1px solid rgba(46,230,107,.55)', background: 'rgba(46,230,107,.05)' };
      if (index === 1) return { border: '1px solid rgba(46,230,107,.4)', background: 'rgba(46,230,107,.04)' };
      return { border: '1px solid rgba(46,230,107,.3)', background: 'rgba(46,230,107,.03)' };
    }
  };

  const getTierLabel = (side: 'SELL' | 'BUY', index: number, z: AtlasZone) => {
    if (z.tier) {
      if (side === 'SELL') {
        if (z.tier.includes('1') || z.id === 'R1') return 'TIER 1 PRIMARY SELL';
        if (z.tier.includes('2') || z.id === 'R2') return 'TIER 2 STRONG SELL';
        return 'TIER 3 EXTREME SELL';
      } else {
        if (z.tier.includes('1') || z.id === 'S1') return 'TIER 1 PRIMARY BUY';
        if (z.tier.includes('2') || z.id === 'S2') return 'TIER 2 STRONG BUY';
        return 'TIER 3 EXTREME BUY';
      }
    }
    const tierNum = index + 1;
    const name = tierNum === 1 ? 'PRIMARY' : tierNum === 2 ? 'STRONG' : 'EXTREME';
    return `TIER ${tierNum} ${name} ${side}`;
  };

  const getConfluenceSnippet = (z: AtlasZone) => {
    if (z.confluenceList && z.confluenceList.length > 0) {
      return z.confluenceList[0];
    }
    if (z.reason) {
      const parts = z.reason.split('·');
      return parts[0].trim();
    }
    return z.side === 'SELL' ? 'H4 supply' : 'H4 demand';
  };

  // Invalidation formatting
  const renderInvalidation = (raw: string | undefined, defaultPrefix: string, fallbackPrice?: number) => {
    if (raw) {
      const match = raw.match(/\d+(\.\d+)?/);
      if (match) {
        const priceStr = match[0];
        const prefix = raw.replace(priceStr, '').trim();
        return <span>{prefix} <b style={{ color: '#e8eaed' }}>{priceStr}</b></span>;
      }
      return <span>{raw}</span>;
    }
    if (fallbackPrice && fallbackPrice > 0) {
      return <span>{defaultPrefix} <b style={{ color: '#e8eaed' }}>{fallbackPrice.toFixed(2)}</b></span>;
    }
    return <span>{defaultPrefix} <b style={{ color: '#e8eaed' }}>--</b></span>;
  };

  // Remaining analyzing minutes & seconds
  const formatRemainingMinutesSeconds = (sec: number) => {
    if (sec <= 0) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '390px',
        margin: '0 auto',
        boxSizing: 'border-box',
        padding: '16px',
        background: '#05070a',
        color: '#e8eaed',
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <style>{`
        .atlas-pn { border:1px solid rgba(255,255,255,.09); border-radius:4px; padding:14px; background:#07090d; }
        .atlas-lb { font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:#8a93a0; }
        .atlas-dim { color:#8a93a0; }
      `}</style>

      {/* HEADER & LIVE PRICE */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '4px 2px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '.02em' }}>
              XAU<span style={{ color: '#f5a623' }}>USD</span>
            </div>
            <div className="atlas-lb" style={{ marginTop: '2px' }}>Gold / U.S. Dollar</div>
          </div>
          <div
            style={{
              width: '58px',
              height: '58px',
              borderRadius: '50%',
              border: '2px solid #f5a623',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#f5a623', letterSpacing: '.08em' }}>SRF</div>
            <div style={{ fontSize: '6px', color: '#8a93a0', letterSpacing: '.1em' }}>SARRAF</div>
          </div>
        </div>

        <div>
          <div className="atlas-lb">Live price</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
            <div
              style={{
                fontSize: '42px',
                fontWeight: 700,
                color: priceColor,
                letterSpacing: '.01em',
                lineHeight: 1.1,
              }}
            >
              {livePrice > 0 ? livePrice.toFixed(2) : '--'}
            </div>
            {isMarketClosed && (
              <div
                style={{
                  fontSize: '10px',
                  letterSpacing: '.08em',
                  color: '#ff4d4f',
                  border: '1px solid rgba(255,77,79,.6)',
                  padding: '3px 8px',
                  borderRadius: '3px',
                }}
              >
                MARKET CLOSED
              </div>
            )}
          </div>
          <div
            style={{
              display: 'inline-block',
              marginTop: '6px',
              fontSize: '10px',
              letterSpacing: '.08em',
              color: ppChipColor,
              border: `1px solid ${ppChipBorder}`,
              padding: '3px 8px',
              borderRadius: '3px',
            }}
          >
            NEAR PP · {distToPp}P
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '10px',
            letterSpacing: '.06em',
            borderTop: '1px solid rgba(255,255,255,.08)',
            paddingTop: '8px',
          }}
        >
          <span className="atlas-dim">{formattedPublishTime}</span>
          <span style={{ color: '#f5a623' }}>{countdownText}</span>
        </div>
      </div>

      {/* MARKET BIAS */}
      <div className="atlas-pn" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div className="atlas-lb">Market bias</div>
        <div style={{ fontSize: '28px', fontWeight: 700, color: biasColor, letterSpacing: '.02em' }}>
          {biasOverall} {biasArrow}
        </div>
        <div className="atlas-lb">{biasPreference}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px', marginTop: '2px' }}>
          <div style={{ border: '1px solid rgba(255,255,255,.1)', padding: '7px 0', textAlign: 'center', fontSize: '10px', letterSpacing: '.1em' }}>
            <b>MN</b> {renderTfTrend('MN', 'RANGE')}
          </div>
          <div style={{ border: '1px solid rgba(255,255,255,.1)', padding: '7px 0', textAlign: 'center', fontSize: '10px', letterSpacing: '.1em' }}>
            <b>W1</b> {renderTfTrend('W1', 'BEAR TREND')}
          </div>
          <div style={{ border: '1px solid rgba(255,255,255,.1)', padding: '7px 0', textAlign: 'center', fontSize: '10px', letterSpacing: '.1em' }}>
            <b>D1</b> {renderTfTrend('D1', 'BEAR TREND')}
          </div>
          <div style={{ border: '1px solid rgba(255,255,255,.1)', padding: '7px 0', textAlign: 'center', fontSize: '10px', letterSpacing: '.1em' }}>
            <b>H4</b> {renderTfTrend('H4', 'BULL TREND')}
          </div>
          <div style={{ gridColumn: 'span 2', border: '1px solid rgba(255,255,255,.1)', padding: '7px 0', textAlign: 'center', fontSize: '10px', letterSpacing: '.1em' }}>
            <b>H1</b> {renderTfTrend('H1', 'BULL TREND')}
          </div>
        </div>
      </div>

      {/* SARRAF ZONE */}
      <div
        style={{
          border: '1px solid rgba(245,166,35,.6)',
          background: 'rgba(245,166,35,.05)',
          borderRadius: '4px',
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="atlas-lb">Sarraf zone</span>
          <span style={{ fontSize: '28px', fontWeight: 700, color: '#f5a623' }}>
            {ppLevel > 0 ? ppLevel.toFixed(2) : '--'}
          </span>
        </div>
        <div className="atlas-dim" style={{ fontSize: '11px', lineHeight: 1.5 }}>
          ABOVE → <b style={{ color: '#2ee66b' }}>BUY</b> (aim R1/R2/R3) · BELOW → <b style={{ color: '#ff4d4f' }}>SELL</b> (aim S1/S2/S3)
        </div>
        <div
          style={{
            alignSelf: 'flex-end',
            fontSize: '10px',
            letterSpacing: '.08em',
            color: ppChipColor,
            border: `1px solid ${ppChipBorder}`,
            padding: '5px 10px',
            borderRadius: '3px',
          }}
        >
          NOW {livePrice > 0 ? livePrice.toFixed(2) : '--'} · {isAbovePp ? 'ABOVE' : 'BELOW'} SARRAF ZONE
        </div>
      </div>

      {/* LIVE TRADE */}
      <div className="atlas-pn" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div className="atlas-lb">Live trade</div>
        {tradeState?.status === 'IN_ZONE' && tradeState.activeZone ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
            <span style={{ color: '#2ee66b', fontWeight: 700 }}>
              IN {tradeState.activeZone.tier} ({tradeState.entrySide})
            </span>
            <span
              style={{
                color: tradeState.livePnLPoints >= 0 ? '#2ee66b' : '#ff4d4f',
                fontWeight: 700,
              }}
            >
              {tradeState.livePnLPoints >= 0 ? '+' : ''}
              {tradeState.livePnLPoints.toFixed(1)} PTS
            </span>
          </div>
        ) : (
          <div className="atlas-dim" style={{ fontSize: '11px' }}>
            STANDBY — waiting for price to enter a zone
          </div>
        )}
      </div>

      {/* CHART PANEL */}
      <AtlasCandleChart
        candles={effectiveH1Candles}
        livePrice={livePrice}
        zones={zones}
        pivots={pivots}
        liquidityLevels={liquidityLevels}
        lastTickTime={state?.lastTickTime}
        marketStatus={state?.marketStatus}
        tickDirection={tickDirection}
      />

      {/* 1. VOLUME / PARTICIPATION PANEL */}
      <AtlasVolumePanel candles={effectiveH1Candles} />

      {/* 2. ATR(14) PANEL */}
      <AtlasAtrPanel candles={effectiveH1Candles} fallbackAtr={state?.indicators?.atr14} />

      {/* 3. TREND · EMA CLUSTER PANEL */}
      <AtlasEmaClusterPanel candles={effectiveH1Candles} livePrice={livePrice} />

      {/* ZONE MAP HEADER */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          padding: '8px 2px 0',
          borderTop: '1px solid rgba(255,255,255,.08)',
        }}
      >
        <span className="atlas-lb" style={{ color: '#e8eaed' }}>Zone map</span>
        <span style={{ fontSize: '10px', color: '#f5a623' }}>{countdownText}</span>
      </div>

      {/* SKELETON WHILE ANALYZING OR ZONE CARDS */}
      {isAnalyzing ? (
        <div
          className="atlas-pn"
          style={{
            border: '1px dashed rgba(245,166,35,.5)',
            padding: '28px 14px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#f5a623', letterSpacing: '.08em' }}>
            ANALYZING MARKET…
          </div>
          <div className="atlas-dim" style={{ fontSize: '11px' }}>
            {formatRemainingMinutesSeconds(countdownSeconds)} remaining
          </div>
        </div>
      ) : (
        <>
          {/* SELL ZONES (SUPPLY) */}
          <div className="atlas-lb" style={{ color: '#ff4d4f', padding: '0 2px' }}>
            ▲ Sell zones (supply)
          </div>
          {sellZones.map((z, idx) => {
            const cardStyle = getZoneCardStyle('SELL', idx);
            const tierLabel = getTierLabel('SELL', idx, z);
            const confluenceText = getConfluenceSnippet(z);
            const distPts = livePrice > 0 ? Math.abs(Math.round(livePrice - z.level)) : '--';
            const statusColor = z.status === 'FRESH' ? '#2ee66b' : z.status === 'BROKEN' ? '#ff4d4f' : '#f5a623';
            const statusLabel = z.status === 'FRESH' ? 'FRESH' : z.status === 'BROKEN' ? 'BROKEN' : `TESTED ${z.touchesToday || 1}`;

            return (
              <div
                key={z.id}
                style={{
                  ...cardStyle,
                  borderRadius: '4px',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '3px',
                }}
              >
                <div style={{ fontSize: '10px', letterSpacing: '.12em', color: '#ff4d4f', fontWeight: 700 }}>
                  {tierLabel}
                </div>
                <div style={{ fontSize: '20px', fontWeight: 700 }}>
                  {Math.round(z.bottom)} – {Math.round(z.top)}
                </div>
                <div className="atlas-dim" style={{ fontSize: '11px' }}>
                  Daily Pivot {z.id} · {confluenceText} · {z.touchesCount}tch · {z.grade}
                </div>
                <div style={{ fontSize: '11px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: statusColor }}>
                    {statusLabel}
                    {z.status === 'BROKEN' && z.breakInfo?.reason ? ` · ${z.breakInfo.reason}` : ''}
                  </span>
                  <span className="atlas-dim">{distPts} pts away</span>
                </div>
              </div>
            );
          })}

          {/* BUY ZONES (DEMAND) */}
          <div className="atlas-lb" style={{ color: '#2ee66b', padding: '0 2px', marginTop: '4px' }}>
            ▼ Buy zones (demand)
          </div>
          {buyZones.map((z, idx) => {
            const cardStyle = getZoneCardStyle('BUY', idx);
            const tierLabel = getTierLabel('BUY', idx, z);
            const confluenceText = getConfluenceSnippet(z);
            const distPts = livePrice > 0 ? Math.abs(Math.round(livePrice - z.level)) : '--';
            const statusColor = z.status === 'FRESH' ? '#2ee66b' : z.status === 'BROKEN' ? '#ff4d4f' : '#f5a623';
            const statusLabel = z.status === 'FRESH' ? 'FRESH' : z.status === 'BROKEN' ? 'BROKEN' : `TESTED ${z.touchesToday || 1}`;

            return (
              <div
                key={z.id}
                style={{
                  ...cardStyle,
                  borderRadius: '4px',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '3px',
                }}
              >
                <div style={{ fontSize: '10px', letterSpacing: '.12em', color: '#2ee66b', fontWeight: 700 }}>
                  {tierLabel}
                </div>
                <div style={{ fontSize: '20px', fontWeight: 700 }}>
                  {Math.round(z.bottom)} – {Math.round(z.top)}
                </div>
                <div className="atlas-dim" style={{ fontSize: '11px' }}>
                  Daily Pivot {z.id} · {confluenceText} · {z.touchesCount}tch · {z.grade}
                </div>
                <div style={{ fontSize: '11px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: statusColor }}>
                    {statusLabel}
                    {z.status === 'BROKEN' && z.breakInfo?.reason ? ` · ${z.breakInfo.reason}` : ''}
                  </span>
                  <span className="atlas-dim">{distPts} pts away</span>
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* INVALIDATION LEVELS */}
      <div className="atlas-pn" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div className="atlas-lb">Invalidation levels</div>
        <div style={{ fontSize: '10px', color: '#ff4d4f', letterSpacing: '.1em' }}>SELL INVALIDATION</div>
        <div style={{ fontSize: '11px' }} className="atlas-dim">
          {renderInvalidation(invalidation?.sell, 'H1 close above', sellZones[0]?.top)}
        </div>
        <div style={{ fontSize: '10px', color: '#2ee66b', letterSpacing: '.1em', marginTop: '4px' }}>
          BUY INVALIDATION
        </div>
        <div style={{ fontSize: '11px' }} className="atlas-dim">
          {renderInvalidation(invalidation?.buy, 'H1 close below', buyZones[0]?.bottom)}
        </div>
      </div>

      {/* TARGETS SUMMARY */}
      <div className="atlas-pn" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ fontSize: '14px', fontWeight: 700 }}>Targets summary</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '18px', fontSize: '11px' }}>
          {/* Sell Targets */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={{ fontSize: '9px', letterSpacing: '.1em', color: '#ff4d4f', fontWeight: 700 }}>
              ◆ SELL TARGETS
            </div>
            {targets?.sell && targets.sell.length > 0 ? (
              targets.sell.map((t, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="atlas-dim">TP{idx + 1}</span>
                  <span>{t.price.toFixed(2)}</span>
                </div>
              ))
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="atlas-dim">TP1</span>
                  <span>{ppLevel > 0 ? ppLevel.toFixed(2) : '--'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="atlas-dim">TP2</span>
                  <span>{buyZones[0]?.level ? buyZones[0].level.toFixed(2) : '--'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="atlas-dim">TP3</span>
                  <span>{buyZones[1]?.level ? buyZones[1].level.toFixed(2) : '--'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="atlas-dim">TP4</span>
                  <span>{buyZones[2]?.level ? buyZones[2].level.toFixed(2) : '--'}</span>
                </div>
              </>
            )}
          </div>

          {/* Buy Targets */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={{ fontSize: '9px', letterSpacing: '.1em', color: '#2ee66b', fontWeight: 700 }}>
              ◆ BUY TARGETS
            </div>
            {targets?.buy && targets.buy.length > 0 ? (
              <>
                {targets.buy.map((t, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="atlas-dim">TP{idx + 1}</span>
                    <span>{t.price.toFixed(2)}</span>
                  </div>
                ))}
                {targets.buy.length < 4 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="atlas-dim">TP4</span>
                    <span className="atlas-dim">—</span>
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="atlas-dim">TP1</span>
                  <span>{sellZones[0]?.level ? sellZones[0].level.toFixed(2) : '--'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="atlas-dim">TP2</span>
                  <span>{sellZones[1]?.level ? sellZones[1].level.toFixed(2) : '--'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="atlas-dim">TP3</span>
                  <span>{sellZones[2]?.level ? sellZones[2].level.toFixed(2) : '--'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="atlas-dim">TP4</span>
                  <span className="atlas-dim">—</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* MARKET SUMMARY */}
      <div className="atlas-pn" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div className="atlas-lb">Market summary</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '14px 6px', textAlign: 'center' }}>
          {/* TREND */}
          <div>
            <div className="atlas-dim" style={{ fontSize: '9px', letterSpacing: '.1em' }}>TREND</div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: summary?.trend === 'BULLISH' ? '#2ee66b' : summary?.trend === 'BEARISH' ? '#ff4d4f' : '#8a93a0',
                marginTop: '3px',
              }}
            >
              {summary?.trend || biasOverall}
            </div>
            <div className="atlas-dim" style={{ fontSize: '8px', marginTop: '2px' }}>
              {summary?.trend === 'BULLISH' ? 'Above EMA cluster' : summary?.trend === 'BEARISH' ? 'Below EMA cluster' : 'Within EMAs'}
            </div>
          </div>

          {/* MOMENTUM */}
          <div>
            <div className="atlas-dim" style={{ fontSize: '9px', letterSpacing: '.1em' }}>MOMENTUM</div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: summary?.momentum?.includes('OVERBOUGHT') ? '#ff4d4f' : summary?.momentum?.includes('OVERSOLD') ? '#2ee66b' : '#8a93a0',
                marginTop: '3px',
              }}
            >
              {summary?.momentum?.includes('OVERBOUGHT') ? 'OVERBOUGHT' : summary?.momentum?.includes('OVERSOLD') ? 'OVERSOLD' : 'NEUTRAL'}
            </div>
            <div className="atlas-dim" style={{ fontSize: '8px', marginTop: '2px' }}>
              {summary?.momentum?.split('·')[0]?.trim() || 'H1 RSI(14)'}
            </div>
          </div>

          {/* PRICE ACTION */}
          <div>
            <div className="atlas-dim" style={{ fontSize: '9px', letterSpacing: '.1em' }}>PRICE ACTION</div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: summary?.priceAction === 'AT SUPPLY' ? '#ff4d4f' : summary?.priceAction === 'AT DEMAND' ? '#2ee66b' : '#8a93a0',
                marginTop: '3px',
              }}
            >
              {summary?.priceAction || 'MID-RANGE'}
            </div>
            <div className="atlas-dim" style={{ fontSize: '8px', marginTop: '2px' }}>
              {summary?.priceAction === 'AT SUPPLY' ? 'Near key supply' : summary?.priceAction === 'AT DEMAND' ? 'Near key demand' : 'Between key zones'}
            </div>
          </div>

          {/* VOLUME */}
          <div>
            <div className="atlas-dim" style={{ fontSize: '9px', letterSpacing: '.1em' }}>VOLUME</div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: summary?.volume?.includes('HIGH') ? '#2ee66b' : summary?.volume?.includes('LOW') ? '#ff4d4f' : '#8a93a0',
                marginTop: '3px',
              }}
            >
              {summary?.volume?.includes('HIGH') ? 'HIGH' : summary?.volume?.includes('LOW') ? 'LOW' : 'NORMAL'}
            </div>
            <div className="atlas-dim" style={{ fontSize: '8px', marginTop: '2px' }}>
              {summary?.volume?.split('·')[0]?.trim() || '20-bar avg'}
            </div>
          </div>

          {/* VOLATILITY */}
          <div>
            <div className="atlas-dim" style={{ fontSize: '9px', letterSpacing: '.1em' }}>VOLATILITY</div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: summary?.volatility?.includes('EXPANDING') ? '#f5a623' : '#8a93a0',
                marginTop: '3px',
              }}
            >
              {summary?.volatility?.includes('EXPANDING') ? 'EXPANDING' : summary?.volatility?.includes('COMPRESSING') ? 'COMPRESSING' : 'STABLE'}
            </div>
            <div className="atlas-dim" style={{ fontSize: '8px', marginTop: '2px' }}>
              {summary?.volatility?.split('·')[0]?.trim() || 'ATR(14)'}
            </div>
          </div>

          {/* RISK */}
          <div>
            <div className="atlas-dim" style={{ fontSize: '9px', letterSpacing: '.1em' }}>RISK</div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: summary?.risk === 'HIGH' ? '#ff4d4f' : summary?.risk === 'MODERATE' ? '#f5a623' : '#2ee66b',
                marginTop: '3px',
              }}
            >
              {summary?.risk || 'MODERATE'}
            </div>
            <div className="atlas-dim" style={{ fontSize: '8px', marginTop: '2px' }}>
              {summary?.risk === 'HIGH' ? 'Elevated exposure' : summary?.risk === 'LOW' ? 'High conviction' : 'Standard risk'}
            </div>
          </div>
        </div>
      </div>

      {/* SCENARIOS */}
      <div className="atlas-pn" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div className="atlas-lb">Scenarios</div>

        {/* Main Scenario */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <div
            style={{
              width: '20px',
              height: '20px',
              borderRadius: '50%',
              background: '#ff4d4f',
              color: '#fff',
              fontSize: '10px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 'none',
            }}
          >
            1
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#ff4d4f' }}>
              MAIN SCENARIO ({scenarios?.main?.bias?.toUpperCase() || biasOverall})
            </div>
            <div className="atlas-dim" style={{ fontSize: '11px', lineHeight: 1.5 }}>
              {scenarios?.main?.description || 'Rally into sell zone → rejection → continuation down'}
            </div>
            <div className="atlas-dim" style={{ fontSize: '11px' }}>
              TARGETS {scenarios?.main?.targets ? scenarios.main.targets.map((t) => Math.round(t.price)).join(' / ') : '--'}
            </div>
          </div>
        </div>

        {/* Alternate Scenario */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <div
            style={{
              width: '20px',
              height: '20px',
              borderRadius: '50%',
              background: '#2ee66b',
              color: '#000',
              fontSize: '10px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 'none',
            }}
          >
            2
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#2ee66b' }}>
              ALTERNATE ({scenarios?.alternate?.bias?.toUpperCase() || (biasOverall === 'BEARISH' ? 'BULLISH' : 'BEARISH')})
            </div>
            <div className="atlas-dim" style={{ fontSize: '11px', lineHeight: 1.5 }}>
              {scenarios?.alternate?.description || 'Dip into demand zone → absorption → continuation up'}
            </div>
            <div className="atlas-dim" style={{ fontSize: '11px' }}>
              TARGETS {scenarios?.alternate?.targets ? scenarios.alternate.targets.map((t) => Math.round(t.price)).join(' / ') : '--'}
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM ACCORDIONS (CLOSED BY DEFAULT, STACKED 2-LINE ROWS, NO TABLES, NO HORIZONTAL SCROLL) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {/* LIQUIDITY MAP */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div
            onClick={() => setIsLiquidityOpen((prev) => !prev)}
            style={{
              border: '1px solid rgba(255,255,255,.09)',
              borderRadius: '4px',
              padding: '13px 14px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '11px',
              letterSpacing: '.1em',
              background: '#07090d',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <span>LIQUIDITY MAP</span>
            <span className="atlas-dim">{isLiquidityOpen ? '−' : '+'}</span>
          </div>

          {isLiquidityOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {liquidityLevels.length > 0 ? (
                liquidityLevels.map((lvl) => {
                  const dist = livePrice > 0 ? Math.abs(livePrice - lvl.price).toFixed(1) : '--';
                  const isIntact = lvl.status === 'INTACT';
                  return (
                    <div
                      key={lvl.id}
                      style={{
                        border: '1px solid rgba(255,255,255,.06)',
                        borderRadius: '4px',
                        padding: '10px 12px',
                        background: '#07090d',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '3px',
                      }}
                    >
                      {/* Line 1 */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span>
                          <b style={{ color: '#e8eaed' }}>{lvl.label || lvl.id}</b>
                          <span style={{ color: '#f5a623', marginLeft: '6px' }}>{lvl.price.toFixed(2)}</span>
                        </span>
                        <span
                          style={{
                            color: isIntact ? '#2ee66b' : '#8a93a0',
                            fontSize: '10px',
                            fontWeight: 700,
                            letterSpacing: '.08em',
                          }}
                        >
                          {lvl.status}
                        </span>
                      </div>
                      {/* Line 2 */}
                      <div className="atlas-dim" style={{ fontSize: '11px' }}>
                        {lvl.sessionTime ? `${lvl.sessionTime} · ` : ''}{dist} pts away · {lvl.nearestZoneId ? `${lvl.nearestZoneId} carries confluence [LIQUIDITY]` : 'No zone confluence'}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ border: '1px solid rgba(255,255,255,.06)', borderRadius: '4px', padding: '10px 12px', background: '#07090d' }}>
                  <div className="atlas-dim" style={{ fontSize: '11px', textAlign: 'center' }}>
                    NO LIQUIDITY LEVELS LOADED
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* YESTERDAY REPORT CARD */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div
            onClick={() => setIsReportOpen((prev) => !prev)}
            style={{
              border: '1px solid rgba(255,255,255,.09)',
              borderRadius: '4px',
              padding: '13px 14px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '11px',
              letterSpacing: '.1em',
              background: '#07090d',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <span>YESTERDAY REPORT CARD</span>
            <span className="atlas-dim">{isReportOpen ? '−' : '+'}</span>
          </div>

          {isReportOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {/* Summary row */}
              <div
                style={{
                  border: '1px solid rgba(255,255,255,.06)',
                  borderRadius: '4px',
                  padding: '10px 12px',
                  background: '#07090d',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '3px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span>
                    <b>VERIFICATION SET</b>{' '}
                    <span className="atlas-dim">{yesterdayReportCard?.date || 'PREVIOUS SESSION'}</span>
                  </span>
                  <span
                    style={{
                      color: (yesterdayReportCard?.totalEvaluated ?? 0) < 5 ? '#f5a623' : '#2ee66b',
                      fontSize: '11px',
                      fontWeight: 700,
                    }}
                  >
                    {(yesterdayReportCard?.totalEvaluated ?? 0) < 5
                      ? 'LOW SAMPLE'
                      : `${yesterdayReportCard?.accuracyPercent ?? 0}% ACCURACY (n=${yesterdayReportCard?.totalEvaluated ?? 0})`}
                  </span>
                </div>
                <div className="atlas-dim" style={{ fontSize: '11px' }}>
                  Threshold: &gt;= 0.5×ATR reversal · Tested: {yesterdayReportCard?.totalEvaluated ?? 0} zones · Respected: {yesterdayReportCard?.respectedCount ?? 0}
                </div>
              </div>

              {/* Stacked rows for each zone */}
              {yesterdayReportCard?.zones && yesterdayReportCard.zones.length > 0 ? (
                yesterdayReportCard.zones.map((item, idx) => {
                  const outcomeColor = item.outcome === 'RESPECTED' ? '#2ee66b' : item.outcome === 'BROKEN' ? '#ff4d4f' : '#8a93a0';
                  return (
                    <div
                      key={idx}
                      style={{
                        border: '1px solid rgba(255,255,255,.06)',
                        borderRadius: '4px',
                        padding: '10px 12px',
                        background: '#07090d',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '3px',
                      }}
                    >
                      {/* Line 1 */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span>
                          <b style={{ color: '#e8eaed' }}>{item.name || item.zoneId}</b>{' '}
                          <span className="atlas-dim">({item.side})</span>
                        </span>
                        <span style={{ color: outcomeColor, fontSize: '11px', fontWeight: 700 }}>
                          {item.outcome}
                        </span>
                      </div>
                      {/* Line 2 */}
                      <div className="atlas-dim" style={{ fontSize: '11px' }}>
                        {item.reversalPoints && item.reversalPoints > 0 ? `Reversal: ${item.reversalPoints.toFixed(1)} pts · ` : ''}{item.notes || (item.outcome === 'RESPECTED' ? 'Zone boundary respected' : item.outcome === 'BROKEN' ? 'H1 closed through zone' : 'Untested within session')}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ border: '1px solid rgba(255,255,255,.06)', borderRadius: '4px', padding: '10px 12px', background: '#07090d' }}>
                  <div className="atlas-dim" style={{ fontSize: '11px', textAlign: 'center' }}>
                    COLLECTING REPORT CARD HISTORY
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* HISTORY · LAST 5 SETS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div
            onClick={() => setIsHistoryOpen((prev) => !prev)}
            style={{
              border: '1px solid rgba(255,255,255,.09)',
              borderRadius: '4px',
              padding: '13px 14px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '11px',
              letterSpacing: '.1em',
              background: '#07090d',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <span>HISTORY · LAST 5 SETS</span>
            <span className="atlas-dim">{isHistoryOpen ? '−' : '+'}</span>
          </div>

          {isHistoryOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {historyList.length > 0 ? (
                historyList.slice(0, 5).map((h) => {
                  const biasCol = h.bias?.overall === 'BULLISH' ? '#2ee66b' : h.bias?.overall === 'BEARISH' ? '#ff4d4f' : '#8a93a0';
                  return (
                    <div
                      key={h.date}
                      style={{
                        border: '1px solid rgba(255,255,255,.06)',
                        borderRadius: '4px',
                        padding: '10px 12px',
                        background: '#07090d',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '3px',
                      }}
                    >
                      {/* Line 1 */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span>
                          <b style={{ color: '#f5a623' }}>SET {h.date}</b>{' '}
                          <span className="atlas-dim">· PP {h.pivots.PP.toFixed(2)}</span>
                        </span>
                        <span style={{ color: biasCol, fontSize: '11px', fontWeight: 700 }}>
                          {h.bias?.overall || 'NEUTRAL'}
                        </span>
                      </div>
                      {/* Line 2 */}
                      <div className="atlas-dim" style={{ fontSize: '11px' }}>
                        {h.reportCard
                          ? `Respected: ${h.reportCard.respectedCount} · Broken: ${h.reportCard.brokenCount} · Ignored: ${h.reportCard.ignoredCount} · Acc: ${h.reportCard.accuracyPercent}%`
                          : `Respected: ${h.zones.filter((z) => z.status === 'TESTED').length} · Broken: ${h.zones.filter((z) => z.status === 'BROKEN').length} · Ignored: ${h.zones.filter((z) => z.status === 'FRESH').length}`}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ border: '1px solid rgba(255,255,255,.06)', borderRadius: '4px', padding: '10px 12px', background: '#07090d' }}>
                  <div className="atlas-dim" style={{ fontSize: '11px', textAlign: 'center' }}>
                    ARCHIVING PREVIOUS SESSIONS
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ZONE ALERTS · LOG */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div
            onClick={() => setIsAlertsOpen((prev) => !prev)}
            style={{
              border: '1px solid rgba(255,255,255,.09)',
              borderRadius: '4px',
              padding: '13px 14px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '11px',
              letterSpacing: '.1em',
              background: '#07090d',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <span>ZONE ALERTS · LOG</span>
            <span className="atlas-dim">{isAlertsOpen ? '−' : '+'}</span>
          </div>

          {isAlertsOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {/* Control Header Row */}
              <div
                style={{
                  border: '1px solid rgba(255,255,255,.06)',
                  borderRadius: '4px',
                  padding: '10px 12px',
                  background: '#07090d',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>
                    <b>ATLAS ALERTS:</b>{' '}
                    <span style={{ color: alertsEnabled ? '#2ee66b' : '#8a93a0', fontWeight: 700 }}>
                      {alertsEnabled ? 'ON' : 'OFF'}
                    </span>
                  </span>
                  {isAdmin && (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={handleToggleAlerts}
                        style={{
                          background: alertsEnabled ? 'rgba(255,77,79,.2)' : 'rgba(46,230,107,.2)',
                          color: alertsEnabled ? '#ff4d4f' : '#2ee66b',
                          border: alertsEnabled ? '1px solid #ff4d4f' : '1px solid #2ee66b',
                          borderRadius: '3px',
                          padding: '3px 8px',
                          fontSize: '9px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        {alertsEnabled ? 'TURN OFF' : 'TURN ON'}
                      </button>
                      <button
                        onClick={handleSendTestAlert}
                        style={{
                          background: 'rgba(245,166,35,.2)',
                          color: '#f5a623',
                          border: '1px solid #f5a623',
                          borderRadius: '3px',
                          padding: '3px 8px',
                          fontSize: '9px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        TEST ALERT
                      </button>
                    </div>
                  )}
                </div>
                <div className="atlas-dim" style={{ fontSize: '10px' }}>
                  Max 1 alert / zone / 30m · Deduplicated daily · Analysis, not a signal
                </div>
              </div>

              {/* Stacked 2-line rows for last 10 alerts */}
              {alertLogs && alertLogs.length > 0 ? (
                alertLogs.slice(0, 10).map((log, idx) => {
                  const typeColor = log.eventType === 'BROKEN' ? '#ff4d4f' : log.eventType === 'TOUCH' ? '#f5a623' : '#2ee66b';
                  const timeStr = log.timestamp
                    ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
                    : '--:--';

                  return (
                    <div
                      key={idx}
                      style={{
                        border: '1px solid rgba(255,255,255,.06)',
                        borderRadius: '4px',
                        padding: '10px 12px',
                        background: '#07090d',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '3px',
                      }}
                    >
                      {/* Line 1 */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span>
                          <b style={{ color: typeColor }}>[{log.eventType}]</b>{' '}
                          <span style={{ color: '#e8eaed', marginLeft: '4px' }}>{log.tier || log.zoneName || log.zoneId}</span>
                        </span>
                        <span className="atlas-dim" style={{ fontSize: '10px' }}>
                          {timeStr} UTC
                        </span>
                      </div>
                      {/* Line 2 */}
                      <div className="atlas-dim" style={{ fontSize: '11px' }}>
                        {log.message || `Price: ${log.price?.toFixed(2) ?? '--'}`}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ border: '1px solid rgba(255,255,255,.06)', borderRadius: '4px', padding: '10px 12px', background: '#07090d' }}>
                  <div className="atlas-dim" style={{ fontSize: '10px', textAlign: 'center' }}>
                    NO RECENT ALERTS RECORDED
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* FOOTER */}
      <div className="atlas-dim" style={{ fontSize: '10px', lineHeight: 1.6, textAlign: 'center', padding: '10px 6px 0' }}>
        Zone = area of interest, not an entry. Entry only after structure, price action and volume confirm.
        <br />
        Analysis hai, signal nahi. Not financial advice.
      </div>
    </div>
  );
};
