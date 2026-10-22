// Unified Decision Types for News Tab

export type NewsVerdict = 'BULLISH' | 'BEARISH' | 'WAIT' | 'SKIP' | 'RELEASED';
export type NewsDecisionStage = 'PREVIEW' | 'FORMING' | 'PRE-NEWS LEAN' | 'PROVISIONAL' | 'CONFIRMED' | 'MIXED' | 'RELEASED';

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
  verdict: NewsVerdict;          // EXACTLY ONE: BULLISH | BEARISH | WAIT | SKIP | RELEASED
  confidence: number;            // 0 - 100 integer confidence (single consistent value everywhere)
  confidenceDisplay?: string;    // "no call" for WAIT, or "Lean: unproven", or e.g. "65%"
  confidenceLean?: string;       // "Lean: unproven (weak)" | "Lean: unproven (moderate)" | "-"
  confidenceStatus?: 'calibrated' | 'calibrating';
  rawConfidence?: number;        // 0 - 100 uncalibrated confidence
  stage: NewsDecisionStage;      // PREVIEW | FORMING | PRE-NEWS LEAN | PROVISIONAL | CONFIRMED | MIXED | RELEASED
  phase?: 'preview' | 'forming' | 'pre' | 'provisional' | 'confirmed' | 'mixed';
  dialScore: number | null;      // -100 to +100, or null ("no call") when < 2 event inputs or WAIT
  scoreDisplay?: string;         // "no call" when score is null, or "+24.5" / "-24.5"
  headlineReason: string;        // One short sentence
  chips: ReasonChipItem[];       // Active reason chips from newsDecision(event).inputs
  lockedAt?: string | null;
  resultStatus?: 'HIT' | 'MISS' | 'WAIT' | 'PENDING';
  goldMove15m?: number | null;
  calibrationBucket?: string | null;
}
