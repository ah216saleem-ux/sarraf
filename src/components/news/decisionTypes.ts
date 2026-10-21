// Unified Decision Types for News Tab

export type NewsVerdict = 'BULLISH' | 'BEARISH' | 'WAIT' | 'SKIP';
export type NewsDecisionStage = 'PREVIEW' | 'FORMING' | 'PRE-NEWS LEAN' | 'PROVISIONAL' | 'CONFIRMED' | 'MIXED';

export type ChipSentiment = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'NO_DATA';

export interface ReasonChipItem {
  id:
    | 'forecast'
    | 'gold4h'
    | 'dollar'
    | 'us10y'
    | 'history'
    | 'prediction'
    | 'ahmed_ai'
    | 'prediction_market'
    | 'gold_trend'
    | 'dollar_proxy'
    | 'surprise_streak'
    | 'actual_surprise'
    | 'gold_reaction';
  label: string;
  sentiment: ChipSentiment;
  weight: number; // positive = favors bull, negative = favors bear
  value?: string | number;
  isMissingOrStale?: boolean;
}

export interface UnifiedNewsDecision {
  eventId: string;
  eventTitle: string;
  verdict: NewsVerdict;          // EXACTLY ONE: BULLISH | BEARISH | WAIT | SKIP
  confidence: number;            // 0 - 100 integer confidence (capped at 40% in PREVIEW, 70% in FORMING)
  confidenceStatus?: 'calibrated' | 'calibrating';
  rawConfidence?: number;        // 0 - 100 uncalibrated confidence
  stage: NewsDecisionStage;      // PREVIEW | FORMING | PRE-NEWS LEAN | PROVISIONAL | CONFIRMED | MIXED
  phase?: 'preview' | 'forming' | 'pre' | 'provisional' | 'confirmed' | 'mixed';
  dialScore: number;             // -100 to +100 (-100 = full bear, 0 = wait/skip, +100 = full bull)
  headlineReason: string;        // One short sentence
  chips: ReasonChipItem[];       // Active reason chips from newsDecision(event).inputs
  lockedAt?: string | null;
  resultStatus?: 'HIT' | 'MISS' | 'WAIT' | 'PENDING';
  goldMove15m?: number | null;
  calibrationBucket?: string | null;
}
