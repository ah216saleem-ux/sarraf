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
    title: '1. Fixed $4.00 Zones & H1 Pivot Origins',
    body: 'Har Fire Zone fixed $4.00 wide hota hai (anchor ± $2.00, LO = anchor - $2, HI = anchor + $2). Origins pichle 150 closed H1 candles ke confirmed swing highs (SELL) aur swing lows (BUY) se aate hain: L=5 (weight 1), L=20 (weight 3), aur L=50 (weight 5). Agle 12 candles ki departure move se +2/+3/+4 points milte hain, aur $3 ke andar same-side candidates merge ho kar prev-24h high/low (+2) aur $100/$50 round number (+2/+1) bonus lete hain. Score >= 11 CRITICAL, >= 8 STRONG, warna MODERATE hota hai.',
  },
  {
    id: 'freshness-rule',
    title: '2. Fresh Zones Are Stronger (Each Retest Weakens a Zone)',
    body: 'Purane system ke baraks jahan touches points barhate thay, 007 engine mein FRESH zones sab se mazboot hotay hain: 0 retests = +4 points (fresh). Har retest zone ko kamzor karta hai (1 retest = +2 points, 2 retests = 0 points), aur 3rd retest ke baad zone retire / discard ho jata hai kyunke wahan ke resting orders absorb ho chuke hotay hain.',
  },
  {
    id: 'break-buffer-rule',
    title: '3. Break Rules (Close + 0.25×ATR Buffer & Live 0.5×ATR)',
    body: 'Wicks kabhi bhi zone ko break nahi kartin. Closed H1 candle par zone tabhi BROKEN maana jata hai jab candle far edge se 0.25 × ATR se zyada bahar close ho (SELL: close > HI + 0.25×ATR, BUY: close < LO - 0.25×ATR). Live tick par agar live price far edge se 0.5 × ATR se zyada nikal jaye toh zone foran BROKEN mark ho kar agle valid zone se replace ho jata hai.',
  },
  {
    id: 'flip-arm-retest',
    title: '4. Flip Rule (Needs Arm + Retest)',
    body: 'Jab koi zone break hota hai toh woh foran flip zone nahi banta balki Flip Watch (F<price>) mein jata hai. Flip ko pehle ARM hona parta hai (price broken anchor se break direction mein kam az kam 1 × ATR door jaye) aur phir RETEST hona parta hai (price wapas anchor ke 0.5 × ATR ke andar aaye bina far side par $1 se zyada close kiye). Jab tak arm + retest dono mukammal na hon, flip zone kabhi dikhaya nahi jata.',
  },
  {
    id: 'near-and-deep-selection',
    title: '5. NEAR & DEEP Selection (Max 4 Zones)',
    body: 'Chart, cards aur ladder par waqt mein zyada se zyada 4 zones (2 SELL + 2 BUY) hotay hain. NEAR sab se qareebi valid zone (score >= 6, 8×ATR ke andar) hota hai, aur DEEP NEAR se kam az kam $12 door (25×ATR ke andar) sab se highest score wala zone hota hai. Koi bhi SELL zone kabhi live price ke neeche nahi hota aur koi BUY zone kabhi live price ke oopar nahi hota.',
  },
  {
    id: 'sl-and-tp-snapping',
    title: '6. Trade Plan: SL & Snapped TP1 / TP2 / TP3',
    body: 'Entry price BUY ke liye HI aur SELL ke liye LO hoti hai. Stop Loss zone ke far edge se max($12.00, 1.2 × ATR) bahar rakha jata hai. TP1, TP2 aur TP3 trade direction mein pehle teen distinct levels par snap hotay hain jo entry se kam az kam $9, $13 aur $18 door hon. R:R(TP1) = |TP1 - anchor| / |anchor - SL|.',
  },
  {
    id: 'single-source-truth',
    title: '7. Single Source of Truth & Timeframe Lock',
    body: 'Zones, setup cards, Zone Ladder, chart boxes aur zone chips sab aik hi H1 engine selection se aate hain. Chart par 15m, 30m, 1H, 4H ya 1D button dabane se sirf candles badalti hain — zones, plans aur ladder hamesha fixed H1 basis par lock rehte hain.',
  },
  {
    id: 'confluence-gates',
    title: '8. 7 Execution Safety Gates',
    body: 'Entry se pehle 7 gates check hotay hain: Structure aligned, Discount/Premium side, Zone proximity (<= $6.00), Rejection candle, Fresh BOS / CHoCH (40 candles), R:R minimum (>= 1.0), aur Level not broken. Jab kam az kam 5/7 gates pass hon tabhi setup READY hota hai.',
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
