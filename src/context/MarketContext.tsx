import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export interface PriceTick {
  price: number;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  open24h: number | null;
  previousClose: number | null;
  change24h: number | null;
  changePercent24h: number | null;
  high24h: number | null;
  low24h: number | null;
  direction: 'up' | 'down' | 'flat';
  lastTickTime: number;
  lastTickTimeString: string;
  nextOpenTime: string | null;
  nextCloseTime: string | null;
  tickPulse: number;
  status: 'LIVE' | 'MARKET_CLOSED' | 'FEED_STALE' | 'FEED_OFFLINE';
  isLive: boolean;
  source: string;
  timestamp: string;
  quoteAgeSeconds: number;
  engineState: 'READY' | 'HTF LIMITED' | 'WARMING UP';
  h1Count: number;
  m30Count: number;
  m15Count: number;
  h4Count: number;
  d1Count: number;
  h1GapsCount: number;
  usable?: { m15: number; m30: number; h1: number; h4: number; d1: number };
  signalsActive: boolean;
}

export interface MacroNewsEvent {
  id: string;
  title: string;
  impact: 'HIGH' | 'CRITICAL' | 'MEDIUM';
  bias: 'BULLISH' | 'BEARISH' | 'VOLATILITY';
  timeRemaining: string;
  forecast: string;
  previous: string;
  currency: string;
  coordinates: [number, number, number];
  isDemo: boolean;
}

export interface UserSession {
  email: string;
  accountType: string;
  terminalId: string;
}

interface MarketContextType {
  priceData: PriceTick;
  macroEvents: MacroNewsEvent[];
  isLoggedIn: boolean;
  user: UserSession | null;
  isLoginModalOpen: boolean;
  isTunnelActive: boolean;
  openLoginModal: () => void;
  closeLoginModal: () => void;
  login: (email: string, pass: string) => Promise<boolean>;
  logout: () => Promise<void>;
  scrollToScene: (sceneIndex: number) => void;
}

const INITIAL_PRICE_STATE: PriceTick = {
  price: 4165.5,
  bid: 4165.35,
  ask: 4165.65,
  spread: 0.3,
  open24h: 4158.0,
  previousClose: 4155.0,
  change24h: 10.5,
  changePercent24h: 0.25,
  high24h: 4182.2,
  low24h: 4148.8,
  direction: 'flat',
  lastTickTime: Date.now(),
  lastTickTimeString: new Date().toISOString(),
  nextOpenTime: null,
  nextCloseTime: null,
  tickPulse: 0,
  status: 'LIVE',
  isLive: true,
  source: 'biquote.io (MetaTrader 5)',
  timestamp: new Date().toISOString(),
  quoteAgeSeconds: 0,
  engineState: 'WARMING UP',
  h1Count: 0,
  m30Count: 0,
  m15Count: 0,
  h4Count: 0,
  d1Count: 0,
  h1GapsCount: 0,
  usable: { m15: 0, m30: 0, h1: 0, h4: 0, d1: 0 },
  signalsActive: false,
};

const MACRO_EVENTS: MacroNewsEvent[] = [
  {
    id: 'cpi-us',
    title: 'US Core CPI (MoM)',
    impact: 'CRITICAL',
    bias: 'BULLISH',
    timeRemaining: '02h : 18m',
    forecast: '0.2%',
    previous: '0.3%',
    currency: 'USD',
    coordinates: [1.8, 0.4, 0.9],
    isDemo: true,
  },
  {
    id: 'fomc-minutes',
    title: 'FOMC Rate Decision & Presser',
    impact: 'CRITICAL',
    bias: 'VOLATILITY',
    timeRemaining: '14h : 45m',
    forecast: '4.25%',
    previous: '4.50%',
    currency: 'USD',
    coordinates: [-1.4, 1.2, 1.1],
    isDemo: true,
  },
  {
    id: 'nfp-us',
    title: 'Non-Farm Employment Change',
    impact: 'HIGH',
    bias: 'BEARISH',
    timeRemaining: '1d : 08h',
    forecast: '165K',
    previous: '142K',
    currency: 'USD',
    coordinates: [0.6, -1.5, 1.4],
    isDemo: true,
  },
  {
    id: 'gold-etf-flows',
    title: 'Central Bank Gold Inflow (Q3)',
    impact: 'HIGH',
    bias: 'BULLISH',
    timeRemaining: '2d : 11h',
    forecast: '+42.5T',
    previous: '+38.2T',
    currency: 'XAU',
    coordinates: [-1.2, -0.8, -1.5],
    isDemo: true,
  },
];

const MarketContext = createContext<MarketContextType | undefined>(undefined);

export const MarketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [priceData, setPriceData] = useState<PriceTick>(INITIAL_PRICE_STATE);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<UserSession | null>(null);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isTunnelActive, setIsTunnelActive] = useState(false);

  // Requirement 1: Verify persistent httpOnly cookie session on mount (survives page refresh)
  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          if (data.authenticated && data.user) {
            setUser(data.user);
            setIsLoggedIn(true);
          }
        }
      } catch {
        // Not authenticated
      }
    };
    checkSession();
  }, []);

  // Poll real biquote.io feed via server proxy
  useEffect(() => {
    let isMounted = true;

    const fetchRealPrice = async () => {
      try {
        const res = await fetch('/api/price/xauusd');
        if (!res.ok) {
          if (isMounted) {
            setPriceData((prev) => ({
              ...prev,
              status: prev.status === 'MARKET_CLOSED' ? 'MARKET_CLOSED' : 'FEED_OFFLINE',
              isLive: false,
            }));
          }
          return;
        }

        const data = await res.json();
        if (!isMounted) return;

        const effectivePrice = typeof data.price === 'number' ? data.price : undefined;

        setPriceData((prev) => {
          const newPrice = effectivePrice ?? prev.price;
          const direction =
            newPrice > prev.price
              ? 'up'
              : newPrice < prev.price
              ? 'down'
              : 'flat';
          const hasTicked = prev.price !== newPrice;

          const rawStatus = (data.status || 'FEED_OFFLINE') as PriceTick['status'];
          const isLive = Boolean(data.isLive ?? (rawStatus === 'LIVE'));

          return {
            price: newPrice,
            bid: typeof data.bid === 'number' ? data.bid : prev.bid,
            ask: typeof data.ask === 'number' ? data.ask : prev.ask,
            spread: typeof data.spread === 'number' ? data.spread : prev.spread,
            open24h: typeof data.open === 'number' ? data.open : prev.open24h,
            previousClose: typeof data.previousClose === 'number' ? data.previousClose : prev.previousClose,
            high24h: typeof data.high === 'number' ? data.high : prev.high24h,
            low24h: typeof data.low === 'number' ? data.low : prev.low24h,
            change24h: typeof data.dayDiffPercent === 'number'
              ? Number((newPrice * (data.dayDiffPercent / 100)).toFixed(2))
              : prev.change24h,
            changePercent24h: typeof data.dayDiffPercent === 'number' ? data.dayDiffPercent : prev.changePercent24h,
            direction,
            lastTickTime: typeof data.lastTickTimestamp === 'number' ? data.lastTickTimestamp : Date.now(),
            lastTickTimeString: data.lastTickTime || data.timestamp || prev.lastTickTimeString,
            nextOpenTime: data.nextOpenTime ?? prev.nextOpenTime ?? null,
            nextCloseTime: data.nextCloseTime ?? prev.nextCloseTime ?? null,
            tickPulse: hasTicked ? prev.tickPulse + 1 : prev.tickPulse,
            status: rawStatus,
            isLive,
            source: data.source || 'biquote.io (MetaTrader 5)',
            timestamp: data.timestamp || new Date().toISOString(),
            quoteAgeSeconds: typeof data.quoteAgeSeconds === 'number' ? data.quoteAgeSeconds : 0,
            engineState: data.engine?.engineState || prev.engineState,
            h1Count: data.engine?.h1Count || prev.h1Count,
            m30Count: data.engine?.m30Count || prev.m30Count,
            m15Count: data.engine?.m15Count || prev.m15Count,
            h4Count: data.engine?.h4Count || prev.h4Count,
            d1Count: data.engine?.d1Count || prev.d1Count,
            h1GapsCount: data.engine?.gaps?.h1 || data.engine?.h1GapsCount || prev.h1GapsCount,
            usable: data.engine?.usable || prev.usable,
            signalsActive: data.engine?.signalsActive ?? prev.signalsActive,
          };
        });
      } catch {
        if (isMounted) {
          setPriceData((prev) => ({
            ...prev,
            status: prev.status === 'MARKET_CLOSED' ? 'MARKET_CLOSED' : 'FEED_OFFLINE',
            isLive: false,
          }));
        }
      }
    };

    fetchRealPrice();
    const interval = setInterval(fetchRealPrice, 1500);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const openLoginModal = useCallback(() => {
    setIsLoginModalOpen(true);
  }, []);

  const closeLoginModal = useCallback(() => {
    setIsLoginModalOpen(false);
  }, []);

  // Strict server-side login with httpOnly cookie storage
  const login = useCallback(async (email: string, pass: string): Promise<boolean> => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Authentication failed');
    }

    const data = await res.json();

    setIsLoginModalOpen(false);
    setIsTunnelActive(true);
    setUser(data.user);

    await new Promise((resolve) => setTimeout(resolve, 2400));
    setIsLoggedIn(true);
    setIsTunnelActive(false);
    return true;
  }, []);

  // Logout clears httpOnly cookie on server
  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors on logout
    }
    setIsLoggedIn(false);
    setUser(null);
  }, []);

  const scrollToScene = useCallback((sceneIndex: number) => {
    const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
    const targetY = (sceneIndex / 5) * totalHeight;
    window.scrollTo({
      top: targetY,
      behavior: 'smooth',
    });
  }, []);

  return (
    <MarketContext.Provider
      value={{
        priceData,
        macroEvents: MACRO_EVENTS,
        isLoggedIn,
        user,
        isLoginModalOpen,
        isTunnelActive,
        openLoginModal,
        closeLoginModal,
        login,
        logout,
        scrollToScene,
      }}
    >
      {children}
    </MarketContext.Provider>
  );
};

export const useMarket = () => {
  const context = useContext(MarketContext);
  if (!context) {
    throw new Error('useMarket must be used within a MarketProvider');
  }
  return context;
};
