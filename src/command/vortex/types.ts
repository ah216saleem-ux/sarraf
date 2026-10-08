export interface QuantumVortexHooks {
  triggerSignal: (side: 'BUY' | 'SELL') => void;
  triggerResult: (result: 'TP' | 'SL') => void;
  setCooldown: (secondsLeft: number) => void;
}

export interface QuantumVortexProps {
  className?: string;
  onRegisterHooks?: (hooks: QuantumVortexHooks) => void;
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
