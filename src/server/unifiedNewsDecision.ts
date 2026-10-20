import { MacroSnapshot } from './macroIndicators.ts';

export type DecisionVerdict = 'BULLISH' | 'BEARISH' | 'WAIT' | 'SKIP';
export type DecisionStage = 'PRE_NEWS' | 'PROVISIONAL' | 'CONFIRMED' | 'MIXED';

export interface DecisionReasonChip {
  id: 'forecast' | 'gold4h' | 'dollar' | 'us10y' | 'history' | 'prediction' | 'ahmed_ai';
  label: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  valueText?: string;
}

export interface UnifiedDecision {
  verdict: DecisionVerdict;
  confidence: number; // 0-100 (capped at 70% during PRE_NEWS)
  stage: DecisionStage;
  stageLabel: string; // "pre-news lean" | "PROVISIONAL" | "CONFIRMED" | "MIXED"
  reasonSentence: string;
  chips: DecisionReasonChip[];
  dialAngle: number; // -90 (Bearish 100%) to 0 (Wait/Neutral) to +90 (Bullish 100%)
  tagDisplay: string; // e.g. "BEARISH 66%", "BULLISH 70%", "WAIT 50%", "SKIP"
}

export interface EventDecisionInput {
  id: string;
  title: string;
  country: string;
  impact: string;
  ahmedTier?: number;
  isSpeech?: boolean;
  timeUtc: string;
  forecastStr?: string;
  previousStr?: string;
  actualStr?: string | null;
  forecastNum?: number | null;
  previousNum?: number | null;
  actualNum?: number | null;
  actualSource?: string | null;
  isReleased?: boolean;
  decision?: any;
  goldMove15m?: number;
}

const isReversedEvent = (title: string): boolean => {
  const t = title.toLowerCase();
  return (
    t.includes('unemploy') ||
    t.includes('claim') ||
    t.includes('jobless') ||
    t.includes('layoff')
  );
};

export function computeUnifiedDecision(
  evt: EventDecisionInput,
  macro: MacroSnapshot | null
): UnifiedDecision {
  const isLowImpact =
    evt.impact === 'Low' ||
    (evt.ahmedTier !== undefined && evt.ahmedTier >= 3 && evt.impact !== 'High' && evt.impact !== 'Medium');

  // Low impact rule: "Show exactly ONE verdict: BULLISH, BEARISH or WAIT (SKIP for low-impact news)"
  if (isLowImpact) {
    return {
      verdict: 'SKIP',
      confidence: 0,
      stage: 'PRE_NEWS',
      stageLabel: 'LOW IMPACT',
      reasonSentence: 'Low volatility event; skipped by macro volatility filter to avoid overtrading.',
      chips: [],
      dialAngle: 0,
      tagDisplay: 'SKIP',
    };
  }

  const now = Date.now();
  const eventTimeMs = new Date(evt.timeUtc).getTime();
  const diffMs = now - eventTimeMs;
  const isPostRelease = evt.isReleased || diffMs >= 0;
  const isPost5Min = diffMs >= 5 * 60 * 1000;

  const reversed = isReversedEvent(evt.title);
  const chips: DecisionReasonChip[] = [];

  // 1. Forecast Chip
  let forecastSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  const hasForecast =
    evt.forecastNum !== null &&
    evt.forecastStr &&
    evt.forecastStr !== '--' &&
    evt.forecastStr !== 'N/A' &&
    evt.forecastStr !== 'Tentative';

  if (!isPostRelease) {
    if (hasForecast && evt.previousNum !== null) {
      const diff = evt.forecastNum! - evt.previousNum;
      if (reversed) {
        // Higher claims = cooler labor market = dovish = Bullish for gold
        if (diff > 0.0001) forecastSentiment = 'BULLISH';
        else if (diff < -0.0001) forecastSentiment = 'BEARISH';
        else forecastSentiment = 'NEUTRAL';
      } else {
        // Lower inflation/growth = dovish = Bullish for gold
        if (diff < -0.0001) forecastSentiment = 'BULLISH';
        else if (diff > 0.0001) forecastSentiment = 'BEARISH';
        else forecastSentiment = 'NEUTRAL';
      }

      chips.push({
        id: 'forecast',
        label: `Forecast: ${evt.forecastStr} vs ${evt.previousStr || '--'}${forecastSentiment === 'BULLISH' ? ' (Cooling)' : forecastSentiment === 'BEARISH' ? ' (Hotter)' : ' (Inline)'}`,
        sentiment: forecastSentiment,
      });
    } else if (hasForecast) {
      chips.push({
        id: 'forecast',
        label: `Forecast: ${evt.forecastStr}`,
        sentiment: 'NEUTRAL',
      });
    }
  } else {
    // Post-release: evaluate Actual vs Forecast
    const hasActual =
      evt.actualNum !== null &&
      evt.actualStr &&
      evt.actualStr !== 'PENDING' &&
      evt.actualSource !== 'UNVERIFIED';

    if (hasActual && hasForecast) {
      const diff = evt.actualNum! - evt.forecastNum!;
      if (reversed) {
        if (diff > 0.0001) forecastSentiment = 'BULLISH';
        else if (diff < -0.0001) forecastSentiment = 'BEARISH';
        else forecastSentiment = 'NEUTRAL';
      } else {
        if (diff < -0.0001) forecastSentiment = 'BULLISH';
        else if (diff > 0.0001) forecastSentiment = 'BEARISH';
        else forecastSentiment = 'NEUTRAL';
      }

      chips.push({
        id: 'forecast',
        label: `Actual: ${evt.actualStr} vs ${evt.forecastStr} (${forecastSentiment === 'BULLISH' ? 'Dovish Beat' : forecastSentiment === 'BEARISH' ? 'Hawkish Beat' : 'Inline'})`,
        sentiment: forecastSentiment,
      });
    } else {
      chips.push({
        id: 'forecast',
        label: 'Actual: Awaiting Print',
        sentiment: 'NEUTRAL',
      });
    }
  }

  // 2. Gold 4h Structure Chip (Real technical state)
  if (macro?.gold4h) {
    const sentiment = macro.gold4h.bias === 'BULLISH' ? 'BULLISH' : macro.gold4h.bias === 'BEARISH' ? 'BEARISH' : 'NEUTRAL';
    chips.push({
      id: 'gold4h',
      label: `Gold 4h: ${macro.gold4h.bias === 'BULLISH' ? 'Bullish Trend' : macro.gold4h.bias === 'BEARISH' ? 'Bearish Trend' : 'Range Structure'}`,
      sentiment,
    });
  }

  // 3. Dollar (DXY) Chip (Real live quote)
  if (macro?.dxy) {
    const isBull = macro.dxy.change < -0.01;
    const isBear = macro.dxy.change > 0.01;
    const sentiment = isBull ? 'BULLISH' : isBear ? 'BEARISH' : 'NEUTRAL';
    const sign = macro.dxy.changePct > 0 ? '+' : '';
    chips.push({
      id: 'dollar',
      label: `Dollar (DXY): ${macro.dxy.price} (${sign}${macro.dxy.changePct}%)`,
      sentiment,
    });
  }

  // 4. US10Y Yield Chip (Real live Treasury quote)
  if (macro?.us10y) {
    const isBull = macro.us10y.change < -0.01;
    const isBear = macro.us10y.change > 0.01;
    const sentiment = isBull ? 'BULLISH' : isBear ? 'BEARISH' : 'NEUTRAL';
    const sign = macro.us10y.changePct > 0 ? '+' : '';
    chips.push({
      id: 'us10y',
      label: `US10Y: ${macro.us10y.price}% (${sign}${macro.us10y.changePct}%)`,
      sentiment,
    });
  }

  // 5. AHMED AI Vote Chip (RULE: "AHMED AI vote appears only as a chip, never as its own verdict")
  if (evt.decision?.aiVote && evt.decision.aiVote !== 'UNAVAILABLE') {
    const aiSentiment =
      evt.decision.aiVote === 'BULLISH'
        ? 'BULLISH'
        : evt.decision.aiVote === 'BEARISH'
        ? 'BEARISH'
        : 'NEUTRAL';
    chips.push({
      id: 'ahmed_ai',
      label: `AHMED AI: ${evt.decision.aiVote} (${evt.decision.aiConfidence || 65}%)`,
      sentiment: aiSentiment,
    });
  }

  // Determine Stage, Verdict & Confidence
  let stage: DecisionStage = 'PRE_NEWS';
  let stageLabel = 'pre-news lean';
  let verdict: DecisionVerdict = 'WAIT';
  let confidence = 50;
  let reasonSentence = '';

  if (!isPostRelease) {
    // Stage: BEFORE RELEASE
    stage = 'PRE_NEWS';
    stageLabel = 'pre-news lean';

    let bullScore = 0;
    let bearScore = 0;

    // Weight 1: Forecast
    if (forecastSentiment === 'BULLISH') bullScore += 35;
    else if (forecastSentiment === 'BEARISH') bearScore += 35;

    // Weight 2: AI Chip
    if (evt.decision?.aiVote === 'BULLISH') bullScore += 25;
    else if (evt.decision?.aiVote === 'BEARISH') bearScore += 25;

    // Weight 3: Gold 4h Trend
    if (macro?.gold4h?.bias === 'BULLISH') bullScore += 20;
    else if (macro?.gold4h?.bias === 'BEARISH') bearScore += 20;

    // Weight 4: Dollar
    if (macro?.dxy?.change && macro.dxy.change < -0.01) bullScore += 10;
    else if (macro?.dxy?.change && macro.dxy.change > 0.01) bearScore += 10;

    // Weight 5: US10Y
    if (macro?.us10y?.change && macro.us10y.change < -0.01) bullScore += 10;
    else if (macro?.us10y?.change && macro.us10y.change > 0.01) bearScore += 10;

    const net = bullScore - bearScore;
    if (net >= 20) {
      verdict = 'BULLISH';
      confidence = Math.min(70, Math.round(55 + (net / 100) * 25));
      reasonSentence = 'Cooling macro expectations and supportive technical alignment provide pre-news bullish asymmetry for gold.';
    } else if (net <= -20) {
      verdict = 'BEARISH';
      confidence = Math.min(70, Math.round(55 + (Math.abs(net) / 100) * 25));
      reasonSentence = 'Hotter projected release and yields pressure bullion safe-haven demand prior to the print.';
    } else {
      verdict = 'WAIT';
      confidence = Math.min(70, Math.max(50, Math.round(50 + Math.abs(net) * 0.2)));
      reasonSentence = 'Conflicting macro signals between forecast consensus and market indicators; awaiting release.';
    }
  } else if (!isPost5Min) {
    // Stage: POST-RELEASE 0 to 5 minutes -> PROVISIONAL
    stage = 'PROVISIONAL';
    stageLabel = 'PROVISIONAL';

    if (forecastSentiment === 'BULLISH') {
      verdict = 'BULLISH';
      confidence = 74;
      reasonSentence = 'Dovish release print verified; initial momentum favours immediate gold upside.';
    } else if (forecastSentiment === 'BEARISH') {
      verdict = 'BEARISH';
      confidence = 74;
      reasonSentence = 'Hawkish release print verified; initial impulse favours dollar strength and gold pullback.';
    } else {
      verdict = 'WAIT';
      confidence = 50;
      reasonSentence = 'Print arrived inline with forecast or pending verification; monitoring 5-minute reaction window.';
    }
  } else {
    // Stage: BEYOND 5 MINUTES -> CONFIRMED or MIXED (MIXED means WAIT)
    const goldMovedUp = typeof evt.goldMove15m === 'number' ? evt.goldMove15m > 0.5 : null;
    const goldMovedDown = typeof evt.goldMove15m === 'number' ? evt.goldMove15m < -0.5 : null;

    if (forecastSentiment === 'BULLISH' && goldMovedUp !== false) {
      stage = 'CONFIRMED';
      stageLabel = 'CONFIRMED';
      verdict = 'BULLISH';
      confidence = 85;
      reasonSentence = 'Post-release 5m price reaction confirms dovish print with sustained institutional upside flow.';
    } else if (forecastSentiment === 'BEARISH' && goldMovedDown !== false) {
      stage = 'CONFIRMED';
      stageLabel = 'CONFIRMED';
      verdict = 'BEARISH';
      confidence = 85;
      reasonSentence = 'Post-release price action confirms hawkish momentum with decisive downward displacement.';
    } else {
      // Divergence or conflicting post-window move: MIXED means WAIT
      stage = 'MIXED';
      stageLabel = 'MIXED';
      verdict = 'WAIT';
      confidence = 50;
      reasonSentence = 'Post-release price reaction conflicted with print consensus; regime classified as MIXED (WAIT).';
    }
  }

  // Dial needle angle math:
  // -90° is Bearish 100%, 0° is Neutral/Wait, +90° is Bullish 100%
  let dialAngle = 0;
  if (verdict === 'BULLISH') {
    dialAngle = Math.round(25 + ((confidence - 50) / 50) * 60);
  } else if (verdict === 'BEARISH') {
    dialAngle = Math.round(-25 - ((confidence - 50) / 50) * 60);
  } else {
    dialAngle = 0;
  }

  const tagDisplay = `${verdict} ${confidence}%`;

  return {
    verdict,
    confidence,
    stage,
    stageLabel,
    reasonSentence,
    chips,
    dialAngle,
    tagDisplay,
  };
}
