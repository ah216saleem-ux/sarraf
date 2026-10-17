// src/atlas/useAtlasData.ts
import { useState, useEffect, useRef, useCallback } from 'react';
import { AtlasState } from './atlasTypes';

export function useAtlasData() {
  const [state, setState] = useState<AtlasState | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [countdownText, setCountdownText] = useState<string>('NEW ZONES IN --:--:--');

  const sseRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);

  // Helper to format countdown
  const formatCountdown = (sec: number): string => {
    if (sec <= 0) return 'NEW ZONES IN 00:00:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const hh = h.toString().padStart(2, '0');
    const mm = m.toString().padStart(2, '0');
    const ss = s.toString().padStart(2, '0');
    return `NEW ZONES IN ${hh}:${mm}:${ss}`;
  };

  // Initial fetch via HTTP
  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/atlas/state');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: AtlasState = await res.json();
      setState(data);
      if (data.countdownText) {
        setCountdownText(data.countdownText);
      }
      setError(null);
    } catch (err: any) {
      console.warn('[ATLAS HOOK] Initial fetch error:', err.message);
      setError(err.message);
    }
  }, []);

  // Connect SSE
  const connectSse = useCallback(() => {
    if (sseRef.current) {
      try {
        sseRef.current.close();
      } catch {}
      sseRef.current = null;
    }

    try {
      const source = new EventSource('/api/atlas/stream');
      sseRef.current = source;

      source.onopen = () => {
        setIsConnected(true);
        setError(null);
      };

      source.onmessage = (event) => {
        try {
          const parsed: AtlasState = JSON.parse(event.data);
          setState(parsed);
          if (parsed.countdownText) {
            setCountdownText(parsed.countdownText);
          }
          setIsConnected(true);
          setError(null);
        } catch (e: any) {
          console.warn('[ATLAS SSE] Parse error:', e.message);
        }
      };

      source.onerror = () => {
        setIsConnected(false);
        try {
          source.close();
        } catch {}
        sseRef.current = null;

        // Auto-reconnect after 4s
        if (!reconnectTimeoutRef.current) {
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            connectSse();
          }, 4000);
        }
      };
    } catch (err: any) {
      setError(err.message);
      setIsConnected(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
    connectSse();

    // 1-second countdown decrement interval for smooth display
    const timer = setInterval(() => {
      setState((prev) => {
        if (!prev) return prev;
        const now = Date.now();
        const nextMs = new Date(prev.nextPublishAt).getTime();
        const diffSec = Math.max(0, Math.floor((nextMs - now) / 1000));
        const txt = formatCountdown(diffSec);
        setCountdownText(txt);
        return {
          ...prev,
          countdownSeconds: diffSec,
          countdownText: txt,
        };
      });
    }, 1000);

    return () => {
      clearInterval(timer);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (sseRef.current) {
        try {
          sseRef.current.close();
        } catch {}
        sseRef.current = null;
      }
    };
  }, [fetchState, connectSse]);

  return {
    state,
    isConnected,
    error,
    countdownText,
    refresh: fetchState,
  };
}
