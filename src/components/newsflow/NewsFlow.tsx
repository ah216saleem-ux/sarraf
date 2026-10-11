import React, { useEffect, useRef } from 'react';
import { NewsFlowEngine, NFEvent } from './NewsFlowEngine';
export type { NFEvent };

interface NewsFlowProps {
  events: NFEvent[];
  lite?: boolean;
  locked?: boolean | null;
  nextId?: string;
  countdownText?: string;
  onSelect?: (id: string) => void;
  className?: string;
}

export const NewsFlow: React.FC<NewsFlowProps> = ({
  events,
  lite = false,
  locked = null,
  nextId,
  countdownText,
  onSelect,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<NewsFlowEngine | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new NewsFlowEngine(canvasRef.current, { lite, onSelect });
    engineRef.current = engine;
    engine.setEvents(events);
    engine.setNext(nextId, countdownText);
    if (locked !== undefined) {
      engine.setLocked(locked);
    }

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.setEvents(events);
    }
  }, [events]);

  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.setNext(nextId, countdownText);
    }
  }, [nextId, countdownText]);

  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.setLite(lite);
    }
  }, [lite]);

  useEffect(() => {
    if (engineRef.current && locked !== undefined) {
      engineRef.current.setLocked(locked);
    }
  }, [locked]);

  return (
    <div
      className={`w-full relative overflow-hidden rounded-2xl border border-white/10 bg-[#03050a] shadow-lg ${className}`}
      style={{ minHeight: '220px', height: '240px' }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block cursor-pointer select-none"
        style={{ touchAction: 'manipulation' }}
      />
    </div>
  );
};

export default NewsFlow;
