export type GateId = 'g1' | 'g2' | 'g3' | 'g4' | 'g5' | 'g6' | 'g7' | 'g8';

export type GateStatus = 'PASS' | 'FAIL' | 'LOCKED';

export type GateDirection = 'BUY' | 'SELL' | 'NEUTRAL';

export interface SniperGateResult {
  id: GateId;
  name: string;
  shortName: string;
  timeframe: string;
  status: GateStatus;
  direction: GateDirection;
  reason: string;
  details?: string;
  isEstimated?: boolean;
}

export type SignalLifecycle = 'WAIT' | 'SIGNAL' | 'ACTIVE' | 'RESULT' | 'COOLDOWN';

export type SignalSide = 'BUY' | 'SELL';

export type SignalCloseReason = 'TP1' | 'TP2' | 'TP3' | 'SL' | 'MANUAL';

export interface SentMessageFlags {
  issued?: boolean;
  tp1?: boolean;
  tp2?: boolean;
  tp3?: boolean;
  sl?: boolean;
  manual?: boolean;
  cooldown?: boolean;
}

export interface CommandSignal {
  id: string;
  side: SignalSide;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp1Hit: boolean;
  tp2Hit: boolean;
  tp3Hit: boolean;
  slHit: boolean;
  hitTargets: ('TP1' | 'TP2' | 'TP3' | 'SL')[];
  createdAt: number;
  closedAt?: number;
  closePrice?: number;
  closeReason?: SignalCloseReason;
  livePnL: number;
  realizedPnL?: number;
  isPaper: boolean;
  confidence: number;
  gatesPassedCount: number;
  entryReason: string;
  sentMessageFlags?: SentMessageFlags;
}

export interface CommandSignalLogEntry {
  id: string;
  timestamp: number;
  timeStr: string;
  side: SignalSide;
  entry: number;
  closePrice: number;
  result: SignalCloseReason;
  pnlDollars: number;
  isPaper: boolean;
}

export interface SignalEngineStats {
  totalSignals: number;
  winRate: number; // 0 - 100 percentage
  avgResultDollars: number;
  totalPnLDollars: number;
  winsCount: number;
  lossesCount: number;
  tp1Hits: number;
  tp2Hits: number;
  tp3Hits: number;
  slHits: number;
  manualCloses: number;
}

export interface SignalEnginePublicState {
  lifecycle: SignalLifecycle;
  activeSignal: CommandSignal | null;
  cooldownRemainingSeconds: number;
  cooldownEndsAt: number | null;
  paperMode: boolean;
  gates: SniperGateResult[];
  gatesAllPassed: boolean;
  alignedDirection: SignalSide | null;
  waitReason: string;
  stats: SignalEngineStats;
  history: CommandSignalLogEntry[];
  lastEvaluatedAt: number;
  feedStatus: 'LIVE' | 'RECONNECTING' | 'OFFLINE';
  pathClearR: number; // distance in $ to opposing zone
  confidence: number;
}

export type TelegramConnectionState = 'CONNECTED' | 'NOT_CONFIGURED' | 'FAILED' | 'DISABLED';

export type TelegramReasonCode =
  | 'OK'
  | 'MISSING_TOKEN'
  | 'MISSING_CHAT_ID'
  | 'NOT_ADMIN'
  | 'BOT_NOT_IN_CHAT'
  | 'CHAT_NOT_FOUND'
  | 'SEND_FAILED';

export interface TelegramCommandStatus {
  configured: boolean;
  enabled: boolean;
  sendPaperSignals: boolean;
  status: TelegramConnectionState;
  lastMessageTime: number | null;
  lastMessageTimeStr: string | null;
  lastError: string | null;
  hasFailed: boolean;
  isAdmin: boolean;
  reasonCode: TelegramReasonCode;
  reasonMessage: string;
}

