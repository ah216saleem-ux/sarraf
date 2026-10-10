export interface QuantumVortexHooks {
  triggerSignal: (side: 'BUY' | 'SELL') => void;
  triggerResult: (result: 'TP' | 'SL') => void;
  setCooldown: (secondsLeft: number) => void;
}

export interface GateArcState {
  id: string;
  name: string;
  shortName: string;
  timeframe: string;
  status: 'PASS' | 'LOCKED' | 'FAIL';
  reason: string;
}

export interface ConvergenceNodeState {
  id: string;
  label: string;
  value: string;
  subValue: string;
  category: 'PRICE' | 'FLOW' | 'CANDLES' | 'NEWS' | 'LEVELS' | 'SESSIONS' | 'SPREAD' | 'VOLUME';
  status: 'LIVE' | 'STALE' | 'OFFLINE';
  lastUpdated: number;
}

export interface HubTerminalLogItem {
  id: string;
  timestamp: string; // HH:MM:SS
  text: string;
  type: 'TICK' | 'CANDLE' | 'GATE' | 'SIGNAL' | 'RESULT' | 'NEWS' | 'FEED' | 'MARKET';
  color?: string;
}

export interface QuantumVortexProps {
  className?: string;
  onRegisterHooks?: (hooks: QuantumVortexHooks) => void;
  variant?: 'command' | 'hero';
  signalEngine?: {
    state: {
      lifecycle: 'WAIT' | 'SIGNAL' | 'ACTIVE' | 'RESULT' | 'COOLDOWN' | string;
      gates: Array<{
        id: string;
        name: string;
        shortName: string;
        timeframe: string;
        status: 'PASS' | 'LOCKED' | 'FAIL';
        reason: string;
      }>;
      activeSignal?: {
        id?: string;
        side: 'BUY' | 'SELL';
        entry?: number;
        entryPrice?: number;
        sl?: number;
        stopLoss?: number;
        tp1?: number;
        takeProfit1?: number;
        tp2?: number;
        takeProfit2?: number;
        tp3?: number;
        takeProfit3?: number;
        [key: string]: any;
      } | null;
      waitReason?: string;
      cooldownRemainingSeconds?: number;
    };
    livePnL: number;
    [key: string]: any;
  };
}

export interface Phase4State {
  shockwaveActive: boolean;
  shockwaveTime: number;
  shockwaveSide: 'BUY' | 'SELL';
  resultActive: boolean;
  resultTime: number;
  resultType: 'TP' | 'SL';
  cooldownSeconds: number;
}
