import React, { useEffect, useState } from 'react';
import { useRedSniperFeed } from './feed';

export const RedSniperDebugPanel: React.FC = () => {
  const {
    bars,
    livePrice,
    bid,
    ask,
    spread,
    lastTickTime,
    connectionStatus,
    isMarketClosed,
    session,
  } = useRedSniperFeed();

  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const m1Bars = bars['1m'];
  const currentM1 = m1Bars && m1Bars.length > 0 ? m1Bars[m1Bars.length - 1] : null;

  const statusText = isMarketClosed
    ? `${connectionStatus} (MARKET CLOSED)`
    : connectionStatus || 'NO DATA';

  const priceText =
    typeof livePrice === 'number' && Number.isFinite(livePrice) && livePrice > 0
      ? livePrice.toFixed(2)
      : 'NO DATA';

  const tickAgeText =
    typeof lastTickTime === 'number' && lastTickTime > 0
      ? `${Math.max(0, (nowMs - lastTickTime) / 1000).toFixed(1)}s`
      : 'NO DATA';

  const m1TickVolText =
    currentM1 && typeof currentM1.tickVolume === 'number'
      ? String(currentM1.tickVolume)
      : 'NO DATA';

  const totalFlow = currentM1 ? currentM1.buyVol + currentM1.sellVol : 0;
  const buySellPctText =
    currentM1 && totalFlow > 0
      ? `${Math.round((currentM1.buyVol / totalFlow) * 100)}% / ${Math.round(
          (currentM1.sellVol / totalFlow) * 100
        )}% (est.)`
      : 'NO DATA';

  const spreadText =
    typeof spread === 'number' && Number.isFinite(spread)
      ? `${spread.toFixed(2)} (${bid?.toFixed(2) ?? 'NO DATA'} / ${ask?.toFixed(2) ?? 'NO DATA'})`
      : 'NO DATA';

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/95 p-3 font-mono text-xs text-slate-200 shadow-lg">
      <div className="mb-2 flex items-center justify-between border-b border-slate-800 pb-1.5">
        <span className="font-bold tracking-wider text-red-400">
          RED SNIPER FEED [DEV DEBUG]
        </span>
        <span className="text-[11px] text-slate-400">
          {session.name} · {session.window}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        <div>
          <span className="text-slate-500">STATUS: </span>
          <span className="font-semibold text-slate-100">{statusText}</span>
        </div>
        <div>
          <span className="text-slate-500">PRICE: </span>
          <span className="font-semibold text-amber-400">{priceText}</span>
        </div>
        <div>
          <span className="text-slate-500">LAST TICK AGE: </span>
          <span className="font-semibold text-slate-100">{tickAgeText}</span>
        </div>
        <div>
          <span className="text-slate-500">M1 TICK VOL: </span>
          <span className="font-semibold text-cyan-400">{m1TickVolText}</span>
        </div>
        <div>
          <span className="text-slate-500">BUY%/SELL% (est.): </span>
          <span className="font-semibold text-emerald-400">{buySellPctText}</span>
        </div>
        <div>
          <span className="text-slate-500">SPREAD: </span>
          <span className="font-semibold text-slate-300">{spreadText}</span>
        </div>
      </div>
    </div>
  );
};

export default RedSniperDebugPanel;
