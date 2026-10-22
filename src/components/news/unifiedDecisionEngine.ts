import { UnifiedNewsDecision, ReasonChipItem, NewsVerdict, NewsDecisionStage, ChipSentiment } from './decisionTypes';

export interface DecisionEngineEventInput {
  id: string;
  title: string;
  country?: string;
  impact?: 'High' | 'Medium' | 'Low' | 'Holiday' | string;
  tier?: string;
  ahmedTier?: number;
  isSpeech?: boolean;
  minutesUntil: number;
  isReleased?: boolean;
  forecastNum?: number | null;
  previousNum?: number | null;
  actualNum?: number | null;
  forecastStr?: string;
  previousStr?: string;
  actualStr?: string | null;
  actualSource?: string | null;
  history?: {
    label: string;
    sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    sampleSize: number;
  } | null;
  decision?: {
    systemVote?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    aiVote?: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNAVAILABLE';
    aiConfidence?: number;
    aiReason?: string;
    final?: string;
    resultStatus?: 'HIT' | 'MISS' | 'NEUTRAL' | 'PENDING';
    goldMove15m?: number;
    isLocked?: boolean;
  } | null;
  newsDecision?: {
    word: 'BULLISH' | 'BEARISH' | 'WAIT' | 'SKIP' | 'RELEASED';
    confidence: number;
    confidenceDisplay?: string;
    confidenceLean?: string;
    confidenceStatus?: 'calibrated' | 'calibrating';
    rawConfidence?: number;
    score: number | null;
    scoreDisplay?: string;
    reason: string;
    inputs: Array<{
      id: string;
      name: string;
      label: string;
      rawWeight: number;
      normalizedWeight: number;
      direction: 1 | -1 | 0;
      rawScore: number;
      weightedScore: number;
      value: string;
    }>;
    phase: 'preview' | 'forming' | 'pre' | 'provisional' | 'confirmed' | 'mixed';
    lockedAt: string | null;
    resultStatus?: 'HIT' | 'MISS' | 'WAIT' | 'PENDING';
    goldMove15m?: number | null;
    calibrationBucket?: string | null;
  } | null;
}

export interface LiveMacroInput {
  dxy?: { price: number; change: number; changePct: number; direction: 'UP' | 'DOWN' | 'FLAT'; isStale?: boolean } | null;
  us10y?: { yield: number; change: number; changeBp: number; direction: 'UP' | 'DOWN' | 'FLAT'; isStale?: boolean } | null;
  gold4h?: { open: number; close: number; changePct: number; bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' } | null;
  predictionMarket?: { question: string; holdProb?: number; cutProb?: number; sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; label: string } | null;
}

export function computeUnifiedDecision(
  evt: DecisionEngineEventInput,
  macro?: LiveMacroInput | null
): UnifiedNewsDecision {
  // Primary Source of Truth: Server-side newsDecision(event) object
  if (evt.newsDecision && evt.newsDecision.word) {
    const nd = evt.newsDecision;
    const stageMap: Record<'preview' | 'forming' | 'pre' | 'provisional' | 'confirmed' | 'mixed', NewsDecisionStage> = {
      preview: 'PREVIEW',
      forming: 'FORMING',
      pre: 'PRE-NEWS LEAN',
      provisional: 'PROVISIONAL',
      confirmed: 'CONFIRMED',
      mixed: 'MIXED',
    };
    const mappedChips: ReasonChipItem[] = (nd.inputs || []).map((inp) => ({
      id: (inp.id as ReasonChipItem['id']) || 'forecast',
      label: `${inp.label} weight ${Math.round(inp.normalizedWeight)}%`,
      sentiment: inp.direction === 1 ? 'BULLISH' : inp.direction === -1 ? 'BEARISH' : 'NEUTRAL',
      weight: inp.weightedScore,
      value: inp.value,
      isMissingOrStale: false,
    }));

    return {
      eventId: evt.id,
      eventTitle: evt.title,
      verdict: nd.word,
      confidence: nd.confidence,
      confidenceDisplay:
        nd.word === 'WAIT' || nd.word === 'SKIP' || nd.word === 'RELEASED'
          ? 'no call'
          : nd.confidenceDisplay || nd.confidenceLean || `${nd.confidence}%`,
      confidenceLean: nd.confidenceLean,
      confidenceStatus: nd.confidenceStatus || 'calibrating',
      rawConfidence: nd.rawConfidence,
      stage: nd.word === 'RELEASED' ? 'RELEASED' : stageMap[nd.phase] || 'PRE-NEWS LEAN',
      phase: nd.phase,
      dialScore: nd.score,
      scoreDisplay:
        nd.score === null || nd.word === 'WAIT' || nd.word === 'SKIP' || nd.word === 'RELEASED'
          ? 'no call'
          : nd.scoreDisplay || `${nd.score >= 0 ? '+' : ''}${nd.score}`,
      headlineReason: nd.reason,
      chips: mappedChips,
      lockedAt: nd.lockedAt,
      resultStatus: nd.resultStatus,
      goldMove15m: nd.goldMove15m,
      calibrationBucket: nd.calibrationBucket,
    };
  }

  const isTier1Or2 = evt.ahmedTier === 1 || evt.ahmedTier === 2 || evt.impact === 'High' || evt.impact === 'Medium';
  const isLowImpact =
    !isTier1Or2 &&
    (evt.impact === 'Holiday' ||
      ((evt.ahmedTier === 3 || evt.impact === 'Low') &&
        !evt.isSpeech &&
        !evt.title.toLowerCase().includes('fed')));

  // 1. Low Impact Rule: Return SKIP
  if (isLowImpact) {
    return {
      eventId: evt.id,
      eventTitle: evt.title,
      verdict: 'SKIP',
      confidence: 0,
      stage: 'PRE-NEWS LEAN',
      dialScore: 0,
      headlineReason: 'Low-impact event; market volatility expected to remain muted.',
      chips: [],
    };
  }

  const minutesUntil = evt.minutesUntil;
  const isReleased = Boolean(evt.isReleased || minutesUntil <= 0);

  // 2. Determine Stage
  let stage: NewsDecisionStage = 'PRE-NEWS LEAN';
  if (isReleased) {
    if (minutesUntil >= -5) {
      stage = 'PROVISIONAL';
    } else {
      // After 5-minute confirm window
      const hasActual = Boolean(evt.actualStr && evt.actualStr !== 'PENDING' && evt.actualStr !== '--');
      const resultStatus = evt.decision?.resultStatus;
      const goldMove = evt.decision?.goldMove15m;

      if (resultStatus === 'MISS' || (goldMove !== undefined && Math.abs(goldMove) < 0.5)) {
        stage = 'MIXED';
      } else if (hasActual) {
        stage = 'CONFIRMED';
      } else {
        stage = 'MIXED';
      }
    }
  }

  // 3. Build Real Reason Chips
  const chips: ReasonChipItem[] = [];

  // Chip 1: Forecast
  const t = evt.title.toLowerCase();
  const isReversed =
    t.includes('unemployment') ||
    t.includes('jobless claims') ||
    t.includes('initial claims');
  const isSpeech = Boolean(evt.isSpeech || t.includes('speaks') || t.includes('speech'));

  if (isSpeech) {
    chips.push({
      id: 'forecast',
      label: 'Forecast: Tone-Dependent',
      sentiment: 'NEUTRAL',
      weight: 0,
    });
  } else if (
    evt.forecastNum !== null &&
    evt.previousNum !== null &&
    evt.forecastStr &&
    evt.forecastStr !== '--' &&
    evt.forecastStr !== 'N/A'
  ) {
    const diff = evt.forecastNum - evt.previousNum;
    const tolerance = Math.abs(evt.previousNum) * 0.0001 || 0.0001;

    if (Math.abs(diff) <= tolerance) {
      chips.push({
        id: 'forecast',
        label: `Forecast: Flat (${evt.forecastStr})`,
        sentiment: 'NEUTRAL',
        weight: 0,
      });
    } else if (isReversed) {
      // Higher claims = cooler labor = Bullish for gold
      const isBull = diff > 0;
      chips.push({
        id: 'forecast',
        label: isBull
          ? `Forecast: Cooler (+${evt.forecastStr} vs ${evt.previousStr})`
          : `Forecast: Tighter (${evt.forecastStr} vs ${evt.previousStr})`,
        sentiment: isBull ? 'BULLISH' : 'BEARISH',
        weight: isBull ? 25 : -25,
      });
    } else {
      // Inflation / Growth: lower forecast = cooling = Bullish for gold
      const isBull = diff < 0;
      chips.push({
        id: 'forecast',
        label: isBull
          ? `Forecast: Cooling (${evt.forecastStr} vs ${evt.previousStr})`
          : `Forecast: Hotter (${evt.forecastStr} vs ${evt.previousStr})`,
        sentiment: isBull ? 'BULLISH' : 'BEARISH',
        weight: isBull ? 25 : -25,
      });
    }
  } else {
    chips.push({
      id: 'forecast',
      label: 'Forecast: no data',
      sentiment: 'NO_DATA',
      weight: 0,
      isMissingOrStale: true,
    });
  }

  // Chip 2: Gold 4h Trend
  if (macro?.gold4h) {
    const g4 = macro.gold4h;
    const isBull = g4.changePct > 0.05;
    const isBear = g4.changePct < -0.05;
    chips.push({
      id: 'gold4h',
      label: isBull
        ? `Gold 4h: Bullish (+${g4.changePct}%)`
        : isBear
        ? `Gold 4h: Bearish (${g4.changePct}%)`
        : `Gold 4h: Neutral (${g4.changePct}%)`,
      sentiment: isBull ? 'BULLISH' : isBear ? 'BEARISH' : 'NEUTRAL',
      weight: isBull ? 15 : isBear ? -15 : 0,
    });
  } else {
    chips.push({
      id: 'gold4h',
      label: 'Gold 4h: no data',
      sentiment: 'NO_DATA',
      weight: 0,
      isMissingOrStale: true,
    });
  }

  // Chip 3: Dollar proxy
  if (macro?.dxy && !macro.dxy.isStale && typeof macro.dxy.price === 'number') {
    const d = macro.dxy;
    // Dollar inversely related to Gold: Dollar down = Gold Bullish
    const isBull = d.change < -0.02;
    const isBear = d.change > 0.02;
    chips.push({
      id: 'dollar',
      label: `Dollar proxy: ${d.changePct > 0 ? '+' : ''}${d.changePct.toFixed(2)}%`,
      sentiment: isBull ? 'BULLISH' : isBear ? 'BEARISH' : 'NEUTRAL',
      weight: isBull ? 15 : isBear ? -15 : 0,
    });
  } else {
    chips.push({
      id: 'dollar',
      label: 'Dollar proxy: no data',
      sentiment: 'NO_DATA',
      weight: 0,
      isMissingOrStale: true,
    });
  }

  // Chip 4: US10Y (10-Yr Treasury Yield)
  if (macro?.us10y && !macro.us10y.isStale && typeof macro.us10y.yield === 'number') {
    const y = macro.us10y;
    // Yields inversely related to Gold: US10Y falling = Gold Bullish
    const isBull = y.change < -0.01;
    const isBear = y.change > 0.01;
    chips.push({
      id: 'us10y',
      label: `US10Y: ${y.yield.toFixed(3)}% (${y.changeBp > 0 ? '+' : ''}${y.changeBp}bp)`,
      sentiment: isBull ? 'BULLISH' : isBear ? 'BEARISH' : 'NEUTRAL',
      weight: isBull ? 15 : isBear ? -15 : 0,
    });
  } else {
    chips.push({
      id: 'us10y',
      label: 'US10Y: no data',
      sentiment: 'NO_DATA',
      weight: 0,
      isMissingOrStale: true,
    });
  }

  // Chip 5: History (Historical release performance for same event type)
  if (evt.history && evt.history.sampleSize > 0) {
    chips.push({
      id: 'history',
      label: evt.history.label,
      sentiment: evt.history.sentiment,
      weight: evt.history.sentiment === 'BULLISH' ? 12 : evt.history.sentiment === 'BEARISH' ? -12 : 0,
    });
  }

  // Chip 6: Prediction Market / Polymarket
  if (macro?.predictionMarket?.label) {
    const pm = macro.predictionMarket;
    chips.push({
      id: 'prediction',
      label: `Prediction: ${pm.label}`,
      sentiment: pm.sentiment,
      weight: pm.sentiment === 'BULLISH' ? 10 : pm.sentiment === 'BEARISH' ? -10 : 0,
    });
  }

  // Chip 7: AHMED AI Vote (ONLY AS A CHIP, NEVER AS A SEPARATE VERDICT)
  if (evt.decision?.aiVote && evt.decision.aiVote !== 'UNAVAILABLE') {
    const aiVote = evt.decision.aiVote;
    const conf = evt.decision.aiConfidence || 65;
    chips.push({
      id: 'ahmed_ai',
      label: `AHMED AI: ${aiVote === 'BULLISH' ? 'Bullish' : aiVote === 'BEARISH' ? 'Bearish' : 'Neutral'} (${conf}%)`,
      sentiment: aiVote === 'BULLISH' ? 'BULLISH' : aiVote === 'BEARISH' ? 'BEARISH' : 'NEUTRAL',
      weight: aiVote === 'BULLISH' ? 20 : aiVote === 'BEARISH' ? -20 : 0,
    });
  }

  // Ensure exactly 4-5 small reason chips: prioritize active real inputs over "no data"
  let trimmedChips = chips.slice();
  if (trimmedChips.length > 5) {
    const activeOnes = trimmedChips.filter((c) => !c.isMissingOrStale);
    const missingOnes = trimmedChips.filter((c) => c.isMissingOrStale);
    trimmedChips = [...activeOnes, ...missingOnes].slice(0, 5);
  }

  // 4. Compute Net Score and Agreement
  let totalWeight = 0;
  let activeInputs = 0;
  let bullCount = 0;
  let bearCount = 0;

  for (const c of chips) {
    if (c.sentiment === 'BULLISH') {
      totalWeight += c.weight;
      activeInputs++;
      bullCount++;
    } else if (c.sentiment === 'BEARISH') {
      totalWeight += c.weight;
      activeInputs++;
      bearCount++;
    } else if (c.sentiment === 'NEUTRAL') {
      activeInputs++;
    }
  }

  // Determine Raw Verdict
  let verdict: NewsVerdict = 'WAIT';

  if (stage === 'MIXED') {
    // Explicit rule: MIXED means WAIT
    verdict = 'WAIT';
  } else if (isReleased && evt.actualNum !== null && evt.forecastNum !== null) {
    // Post-release: actual vs forecast is primary
    const actualDiff = evt.actualNum - evt.forecastNum;
    const tol = Math.abs(evt.forecastNum) * 0.0001 || 0.0001;
    if (Math.abs(actualDiff) <= tol) {
      verdict = 'WAIT';
    } else if (isReversed) {
      verdict = actualDiff > 0 ? 'BULLISH' : 'BEARISH';
    } else {
      verdict = actualDiff < 0 ? 'BULLISH' : 'BEARISH';
    }
  } else {
    // Pre-release: consensus of aligned chips
    if (totalWeight >= 15) {
      verdict = 'BULLISH';
    } else if (totalWeight <= -15) {
      verdict = 'BEARISH';
    } else {
      verdict = 'WAIT';
    }
  }

  // If server had a locked decision prior to release, align final direction
  if (evt.decision?.final && evt.decision.final !== 'WAIT' && evt.decision.final !== 'WAITING' && !isReleased) {
    if (evt.decision.final === 'BULLISH') verdict = 'BULLISH';
    else if (evt.decision.final === 'BEARISH') verdict = 'BEARISH';
  }

  // 5. Compute Confidence
  let computedConfidence = 50;
  const agreementDenominator = Math.max(1, bullCount + bearCount);
  const agreementRatio = verdict === 'BULLISH'
    ? bullCount / agreementDenominator
    : verdict === 'BEARISH'
    ? bearCount / agreementDenominator
    : 0.5;

  if (verdict === 'WAIT') {
    computedConfidence = 50;
  } else {
    computedConfidence = Math.round(50 + agreementRatio * 35);
  }

  // Rule: Before release show "pre-news lean" with confidence capped at 70%.
  let finalConfidence = computedConfidence;
  if (stage === 'PRE-NEWS LEAN') {
    finalConfidence = Math.min(70, Math.max(50, computedConfidence));
  } else if (stage === 'PROVISIONAL') {
    finalConfidence = Math.min(85, Math.max(65, computedConfidence + 12));
  } else if (stage === 'CONFIRMED') {
    finalConfidence = Math.min(96, Math.max(82, computedConfidence + 24));
  } else if (stage === 'MIXED') {
    finalConfidence = 50;
  }

  // 6. Compute Dial Score (-100 to +100)
  // Red (left) = -100 to -20, Grey (center) = -15 to +15, Green (right) = +20 to +100
  let dialScore = 0;
  if (verdict === 'BULLISH') {
    dialScore = Math.min(90, Math.max(35, Math.round(totalWeight * 1.2 + (finalConfidence - 50) * 1.5)));
  } else if (verdict === 'BEARISH') {
    dialScore = Math.max(-90, Math.min(-35, Math.round(totalWeight * 1.2 - (finalConfidence - 50) * 1.5)));
  } else {
    dialScore = Math.max(-10, Math.min(10, Math.round(totalWeight * 0.2)));
  }

  // 7. Headline Reason: One Short Sentence
  let headlineReason = '';
  if (stage === 'MIXED') {
    headlineReason = 'Post-release price action conflicted with published figures; order flow indicates waiting for price stabilization.';
  } else if (stage === 'CONFIRMED') {
    if (verdict === 'BULLISH') {
      headlineReason = 'Actual print confirmed weaker dollar impulse, driving sustained upside momentum on XAU/USD.';
    } else {
      headlineReason = 'Actual print confirmed resilient economic strength, sustaining downward pressure on real gold prices.';
    }
  } else if (stage === 'PROVISIONAL') {
    headlineReason = `Initial release printed ${evt.actualStr || 'figure'}; provisional momentum favors ${verdict} pending full confirmation.`;
  } else {
    // PRE-NEWS LEAN
    if (verdict === 'BULLISH') {
      if (isReversed) {
        headlineReason = 'Elevated claims forecast signals softening US labor conditions, providing an upside catalyst for gold.';
      } else {
        headlineReason = 'Cooling macroeconomic consensus and declining Treasury yields support bullish gold positioning.';
      }
    } else if (verdict === 'BEARISH') {
      if (isReversed) {
        headlineReason = 'Lower jobless claims forecast indicates tight labor market conditions, favoring the US dollar over gold.';
      } else {
        headlineReason = 'Hotter inflation and growth projections lift real yields, exerting downside pressure on gold prices.';
      }
    } else {
      if (isSpeech) {
        headlineReason = 'Central bank speech reaction is guidance-dependent; remaining on the sidelines until clear delivery.';
      } else {
        headlineReason = 'Balanced consensus and mixed macro indicators suggest waiting on the sidelines ahead of the release.';
      }
    }
  }

  return {
    eventId: evt.id,
    eventTitle: evt.title,
    verdict,
    confidence: finalConfidence,
    stage,
    dialScore,
    headlineReason,
    chips: trimmedChips,
  };
}
