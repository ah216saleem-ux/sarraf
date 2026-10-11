// src/command/vortex/NeuralCore.tsx
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { NeuralCoreEngine, CoreLabel, CoreMode, CoreSignal, CoreTick } from './NeuralCoreEngine';

export interface NeuralCoreHandle {
  triggerSignal: (side: 'BUY' | 'SELL') => void;
  triggerResult: (r: 'TP' | 'SL') => void;
  setCooldown: (secondsLeft: number) => void;
}

interface Props {
  variant?: 'command' | 'hero';
  lite?: boolean;
  mode: CoreMode;                 // 'live' | 'replay' | 'reconnecting' | 'closed'
  livePrice: number | null;       // real current price (same as header price)
  buyPct: number | null;          // real buy share %, null if not enough ticks
  sellPct: number | null;         // real sell share %, null if not enough ticks
  labels: CoreLabel[];            // real values (+ optional detail text shown when the label is tapped)
  signal?: CoreSignal | null;     // the ONE active real signal (entry/SL/TP1-3), null when none
  ticks: CoreTick[];              // real ticks, oldest -> newest (already in the feed)
  replayTicks?: CoreTick[];       // stored REAL ticks, used only when mode !== 'live'
  height?: number | string;
}

const NeuralCore = forwardRef<NeuralCoreHandle, Props>(function NeuralCore(props, ref) {
  const { variant = 'command', lite = false, mode, livePrice, buyPct, sellPct, labels, signal = null, ticks, replayTicks, height } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engRef = useRef<NeuralCoreEngine | null>(null);
  const lastKey = useRef<string>('');
  const replayRef = useRef<CoreTick[] | undefined>(replayTicks);
  replayRef.current = replayTicks;
  const replayKey = replayTicks && replayTicks.length ? replayTicks.length + '|' + replayTicks[replayTicks.length - 1].ts : '';

  useEffect(() => {
    if (!canvasRef.current) return;
    const eng = new NeuralCoreEngine(canvasRef.current, { variant, lite });
    engRef.current = eng;
    lastKey.current = '';
    return () => { eng.destroy(); engRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  useImperativeHandle(ref, () => ({
    triggerSignal: (s) => engRef.current?.triggerSignal(s),
    triggerResult: (r) => engRef.current?.triggerResult(r),
    setCooldown: (n) => engRef.current?.setCooldown(n),
  }), []);

  useEffect(() => { engRef.current?.setLite(lite); }, [lite]);
  useEffect(() => { engRef.current?.setLivePrice(livePrice); }, [livePrice]);
  useEffect(() => { engRef.current?.setFlow(buyPct, sellPct); }, [buyPct, sellPct]);
  useEffect(() => { engRef.current?.setLabels(labels); }, [labels]);
  useEffect(() => { engRef.current?.setSignal(signal); }, [signal]);

  // mode + replay (visual only, never feeds the signal engine or Telegram)
  useEffect(() => {
    const eng = engRef.current; if (!eng) return;
    eng.setMode(mode);
    if (mode === 'live') eng.stopReplay();
    else if (replayRef.current && replayRef.current.length) eng.startReplay(replayRef.current);
    else eng.stopReplay();
    return () => eng.stopReplay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, replayKey]);

  // real ticks -> nodes. First time in live mode: fast boot fill from the recent real ticks.
  useEffect(() => {
    const eng = engRef.current; if (!eng || mode !== 'live' || !ticks.length) return;
    const key = (t: CoreTick) => t.ts + '|' + t.price;
    if (!lastKey.current) {
      eng.seed(ticks);
      lastKey.current = key(ticks[ticks.length - 1]);
      return;
    }
    let i = ticks.length - 1;
    while (i >= 0 && key(ticks[i]) !== lastKey.current) i--;
    const start = i >= 0 ? i + 1 : ticks.length - 1;      // unknown last tick: push only the newest
    for (let k = start; k < ticks.length; k++) eng.pushTick(ticks[k]);
    lastKey.current = key(ticks[ticks.length - 1]);
  }, [ticks, mode]);

  return (
    <div style={{ position: 'relative', width: '100%', height: height ?? 'clamp(380px, 62vw, 520px)', background: '#03050a', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
});

export default NeuralCore;
