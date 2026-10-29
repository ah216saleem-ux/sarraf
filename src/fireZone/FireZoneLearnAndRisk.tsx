// src/fireZone/FireZoneLearnAndRisk.tsx
import React, { useState } from 'react';
import { ChevronDown, BookOpen, Calculator } from 'lucide-react';
import { TradePlan } from './types';

const glassCardStyle: React.CSSProperties = {
  background: 'var(--card, #0d1117)',
  border: '1px solid var(--bd, #1a212b)',
  borderRadius: '14px',
  padding: '15px',
  marginTop: '11px',
  fontFamily: "'Manrope', sans-serif",
};

const monoStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

interface LearnItem {
  id: string;
  title: string;
  body: string;
}

const LEARN_TOPICS: LearnItem[] = [
  {
    id: 'fixed-width-zones',
    title: '1. Zones are fixed $4 bands on ranked levels',
    body: 'Har Fire Zone bilkul 007 system ke mutabiq fixed $4.00 wide hota hai (anchor ± $2.00). Levels swing pivots, Previous Day High/Low (PDH/PDL), Previous Week High/Low (PWH/PWL), Equal Highs/Lows (EQH/EQL), aur $50/$100 round numbers ko cluster kar ke rank hote hain. Anchor point level ka mid price hota hai aur kabhi drift nahi hota.',
  },
  {
    id: 'how-tp-snaps',
    title: '2. How TP snaps to levels',
    body: 'Take Profit targets (TP1, TP2, TP3) hawa mein nahi bante balki chart ke actual ranked levels par snap hote hain. TP1 entry se kam az kam $9 door agle level par baithta hai, TP2 kam az kam $13 door, aur TP3 kam az kam $18 door. Agar kisi slot par koi level na mile toh standard minimum spacing fallback use hoti hai.',
  },
  {
    id: 'how-level-plays',
    title: '3. How a level "plays" (PLAYED_HELD)',
    body: 'Jab market zone ke andar wick maarti hai aur phir price wahan se kam az kam 1×ATR door close ho jati hai (ya lagataar 3 candle closes zone ke sahi rukh par milti hain), toh level "PLAYED_HELD" kehlaata hai. Yeh proof hai ke level ne react kar diya aur liquidity absorb ho chuki hai.',
  },
  {
    id: 'retire-and-flip',
    title: '4. Retire and Flip Rules',
    body: 'Jab koi zone PLAYED_HELD, BROKEN, ya EXPIRED (150 candles se purana) ho jata hai toh woh chart aur ladder se RETIRE ho jata hai aur engine foran usi slot ke liye naya best level muntakhib karta hai. Agar koi BUY zone toot-ta hai (close < LO - $1), toh uska anchor opposite side par candidate SELL level ban jata hai (+2 rank bonus ke sath) — aur SELL zone tootne par BUY candidate banta hai.',
  },
  {
    id: 'sl-logic',
    title: '5. Stop Loss (SL) Logic',
    body: 'Stop Loss zone ke outer edge se door safe distance par rakha jata hai: SL = max($12.00, 1.2 × ATR). Is se market ki aam volatility aur liquidity wick sweeps se account bach jata hai jabke risk strictly predefined rehta hai.',
  },
  {
    id: 'single-source-truth',
    title: '6. Single Source of Truth (Ladder, Chart, Cards)',
    body: 'Poora Fire Zone tab aik single selector buildChartModel(engineResult) par chalta hai. Jo zones, levels aur targets Zone Ladder par dikhte hain, theek wahi chart overlay aur cards par drawn hotay hain. Koi price mismatch ya drifting mumkiin nahi.',
  },
  {
    id: 'confluence-gates',
    title: '7. 7 Confluence Gates & Trade Allowed',
    body: 'Entry se pehle 7 gates evaluate hotay hain: Structure Aligned, Discount/Premium Side, Zone Proximity (<= $6.00), Rejection Candle, Fresh BOS/CHoCH (40 candles), R:R (TP1) >= 1.00, aur Level Not Broken. Jab kam az kam 5 gates pass hon toh TRADE ALLOWED: YES ka signal milta hai.',
  },
  {
    id: 'ladder-priority',
    title: '8. Zone Ladder Hierarchy',
    body: 'Zone Ladder sab se oopar (highest price) se sab se neeche (lowest price) tak ordered hota hai. Is mein SELL SL, Entry HI/LO ($4 wide), Retest anchors, Buy/Sell TP1..3, ranked LEVEL 1..n walls, aur gold NOW row aati hain. NOW row load par scroll container ke center mein rehti hai.',
  },
  {
    id: 'risk-management',
    title: '9. Position Sizing & Layered Execution',
    body: 'Apne account balance ka 1% se zyada risk na karein. Smart 007 execution mein 60% position size NEAREST zone entry par aur 40% deep rejection par allocate kiya jata hai, jis se overall average entry price behtar ho jati hai.',
  },
  {
    id: 'when-to-wait',
    title: '10. When to WAIT',
    body: 'Agar TRADE ALLOWED: NO ho ya price zone se $6 se zyada door ho, toh trade zabardasti enter na karein. Rejection candle aur zone proximity ka intezar karein.',
  },
];

export const FireZoneLearnTab: React.FC = () => {
  const [openId, setOpenId] = useState<string>(LEARN_TOPICS[0].id);

  return (
    <section className="space-y-3 fz-fade-up" style={glassCardStyle}>
      <div className="flex items-center gap-2 pb-1">
        <BookOpen className="w-4 h-4 text-[#f5b842]" />
        <span className="text-[10.5px] font-bold uppercase tracking-[0.26em] text-white/50">
          LEARN FIRE ZONE (007 RULES)
        </span>
      </div>

      <div className="space-y-2">
        {LEARN_TOPICS.map((item) => {
          const isOpen = openId === item.id;
          return (
            <div
              key={item.id}
              className="rounded-xl overflow-hidden transition-colors"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.025)',
                border: isOpen
                  ? '1px solid rgba(245, 184, 66, 0.45)'
                  : '1px solid rgba(255, 255, 255, 0.07)',
              }}
            >
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? '' : item.id)}
                className="w-full px-3.5 py-3 text-left flex items-center justify-between gap-2 cursor-pointer"
              >
                <span className="text-xs sm:text-sm font-bold text-[#f4efe6]">
                  {item.title}
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-[#f5b842] shrink-0 transition-transform duration-200 ${
                    isOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {isOpen && (
                <div className="px-3.5 pb-3.5 pt-1 text-xs sm:text-sm leading-relaxed text-white/75 border-t border-white/5">
                  {item.body}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

export const FireZoneRiskTab: React.FC<{
  activePlan: TradePlan | null;
}> = ({ activePlan }) => {
  const [balanceStr, setBalanceStr] = useState<string>('10000');
  const [riskPctStr, setRiskPctStr] = useState<string>('1.0');

  const balance = Math.max(0, Number(balanceStr) || 0);
  const riskPct = Math.max(0, Math.min(100, Number(riskPctStr) || 0));
  const riskDollars = balance * (riskPct / 100);

  const slDistance = activePlan ? Math.max(0.1, activePlan.risk) : 5.0;
  const rawLots = riskDollars / (slDistance * 100);
  const lots = Math.max(0, Math.floor(rawLots * 100) / 100);

  const tp1Dist = activePlan ? Math.abs(activePlan.tp1 - activePlan.entryPrice) : 9.0;
  const tp2Dist = activePlan ? Math.abs(activePlan.tp2 - activePlan.entryPrice) : 13.0;
  const tp3Dist = activePlan ? Math.abs(activePlan.tp3 - activePlan.entryPrice) : 18.0;

  const profitTp1 = lots * 100 * tp1Dist;
  const profitTp2 = lots * 100 * tp2Dist;
  const profitTp3 = lots * 100 * tp3Dist;

  const nearestLots = Math.floor(lots * 0.6 * 100) / 100;
  const deepLots = Math.max(0, Number((lots - nearestLots).toFixed(2)));

  return (
    <section className="space-y-4 fz-fade-up" style={glassCardStyle}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Calculator className="w-4 h-4 text-[#f2b94b]" />
          <span
            style={{
              fontSize: '10px',
              letterSpacing: '0.2em',
              fontWeight: 800,
              color: 'var(--mu, #7e8794)',
              textTransform: 'uppercase',
            }}
          >
            GOLD (XAUUSD) POSITION SIZE &amp; RISK CALCULATOR
          </span>
        </div>

        <span className="text-[10px] text-white/45" style={monoStyle}>
          1 Lot = 100 oz
        </span>
      </div>

      {/* Inputs: Account Balance & Risk % */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block space-y-1.5">
          <span className="text-xs text-white/60 block">Account Balance ($)</span>
          <input
            type="number"
            min="0"
            step="100"
            value={balanceStr}
            onChange={(e) => setBalanceStr(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.03] border border-white/10 focus:border-[#f5b842] text-sm font-bold text-[#f4efe6] outline-none"
            style={monoStyle}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-white/60 block">Risk per Trade (%)</span>
          <input
            type="number"
            min="0.1"
            max="20"
            step="0.1"
            value={riskPctStr}
            onChange={(e) => setRiskPctStr(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.03] border border-white/10 focus:border-[#f5b842] text-sm font-bold text-[#f4efe6] outline-none"
            style={monoStyle}
          />
        </label>
      </div>

      {/* Calculated Lot Size & Risk Summary */}
      <div
        className="p-4 rounded-xl grid grid-cols-2 sm:grid-cols-4 gap-3"
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <div>
          <span className="text-[10px] uppercase text-white/45 block">Risk Cash</span>
          <span className="text-base font-extrabold text-[#ff5d6c]" style={monoStyle}>
            ${riskDollars.toFixed(2)}
          </span>
        </div>
        <div>
          <span className="text-[10px] uppercase text-white/45 block">SL Distance</span>
          <span className="text-base font-extrabold text-[#f4efe6]" style={monoStyle}>
            ${slDistance.toFixed(2)}
          </span>
        </div>
        <div>
          <span className="text-[10px] uppercase text-white/45 block">Lot Size (Floored)</span>
          <span className="text-lg font-extrabold text-[#f5b842]" style={monoStyle}>
            {lots.toFixed(2)} lots
          </span>
        </div>
        <div>
          <span className="text-[10px] uppercase text-white/45 block">60/40 Split</span>
          <span className="text-xs font-bold text-white/80" style={monoStyle}>
            {nearestLots.toFixed(2)} / {deepLots.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Money Profit at TP1, TP2, TP3 */}
      <div className="space-y-2">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.26em] text-white/45 block">
          PROJECTED PROFIT AT TARGETS ({activePlan ? `${activePlan.side} PLAN` : 'DEFAULT'})
        </span>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5" style={monoStyle}>
          <div
            className="p-3.5 rounded-xl flex items-center justify-between"
            style={{
              backgroundColor: 'rgba(46, 230, 160, 0.07)',
              border: '1px solid rgba(46, 230, 160, 0.25)',
            }}
          >
            <div>
              <span className="text-[10px] text-[#2ee6a0] block">
                TP1 (+${tp1Dist.toFixed(2)})
              </span>
              <span className="text-xs text-white/55">
                {activePlan ? `$${activePlan.tp1.toFixed(2)}` : 'Target 1'}
              </span>
            </div>
            <span className="text-base font-extrabold text-[#2ee6a0]">
              +${profitTp1.toFixed(2)}
            </span>
          </div>

          <div
            className="p-3.5 rounded-xl flex items-center justify-between"
            style={{
              backgroundColor: 'rgba(46, 230, 160, 0.07)',
              border: '1px solid rgba(46, 230, 160, 0.25)',
            }}
          >
            <div>
              <span className="text-[10px] text-[#2ee6a0] block">
                TP2 (+${tp2Dist.toFixed(2)})
              </span>
              <span className="text-xs text-white/55">
                {activePlan ? `$${activePlan.tp2.toFixed(2)}` : 'Target 2'}
              </span>
            </div>
            <span className="text-base font-extrabold text-[#2ee6a0]">
              +${profitTp2.toFixed(2)}
            </span>
          </div>

          <div
            className="p-3.5 rounded-xl flex items-center justify-between"
            style={{
              backgroundColor: 'rgba(46, 230, 160, 0.07)',
              border: '1px solid rgba(46, 230, 160, 0.25)',
            }}
          >
            <div>
              <span className="text-[10px] text-[#2ee6a0] block">
                TP3 (+${tp3Dist.toFixed(2)})
              </span>
              <span className="text-xs text-white/55">
                {activePlan ? `$${activePlan.tp3.toFixed(2)}` : 'Target 3'}
              </span>
            </div>
            <span className="text-base font-extrabold text-[#2ee6a0]">
              +${profitTp3.toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};
