import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export interface PriceTick {
  price: number | null;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  change24h: number | null;
  changePercent24h: number | null;
  high24h: number | null;
  low24h: number | null;
  direction: 'up' | 'down' | 'flat';
  lastTickTime: number;
  tickPulse: number;
  status: 'LIVE' | 'STALE' | 'OFFLINE';
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
  price: null,
  bid: null,
  ask: null,
  spread: null,
  change24h: null,
  changePercent24h: null,
  high24h: null,
  low24h: null,
  direction: 'flat',
  lastTickTime: 0,
  tickPulse: 0,
  status: 'OFFLINE',
  source: 'biquote.io',
  timestamp: '',
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
              status: 'OFFLINE',
              price: null,
              bid: null,
              ask: null,
            }));
          }
          return;
        }

        const data = await res.json();
        if (!isMounted) return;

        if ((data.status === 'LIVE' || data.status === 'STALE') && typeof data.price === 'number') {
          setPriceData((prev) => {
            const direction =
              prev.price === null
                ? 'flat'
                : data.price > prev.price
                ? 'up'
                : data.price < prev.price
                ? 'down'
                : 'flat';
            const hasTicked = prev.price !== data.price;

            return {
              price: data.price,
              bid: data.bid,
              ask: data.ask,
              spread: data.spread ?? null,
              high24h: data.high ?? null,
              low24h: data.low ?? null,
              change24h: Number((data.price * (data.dayDiffPercent / 100)).toFixed(2)),
              changePercent24h: data.dayDiffPercent,
              direction,
              lastTickTime: Date.now(),
              tickPulse: hasTicked ? prev.tickPulse + 1 : prev.tickPulse,
              status: data.status,
              source: data.source || 'biquote.io',
              timestamp: data.timestamp || '',
              quoteAgeSeconds: data.quoteAgeSeconds || 0,
              engineState: data.engine?.engineState || 'WARMING UP',
              h1Count: data.engine?.h1Count || 0,
              m30Count: data.engine?.m30Count || 0,
              m15Count: data.engine?.m15Count || 0,
              h4Count: data.engine?.h4Count || 0,
              d1Count: data.engine?.d1Count || 0,
              h1GapsCount: data.engine?.gaps?.h1 || data.engine?.h1GapsCount || 0,
              usable: data.engine?.usable || { m15: 0, m30: 0, h1: 0, h4: 0, d1: 0 },
              signalsActive: data.engine?.signalsActive ?? false,
            };
          });
        } else {
          setPriceData((prev) => ({
            ...prev,
            status: 'OFFLINE',
            price: null,
            engineState: data.engine?.engineState || 'WARMING UP',
            h1Count: data.engine?.h1Count || 0,
            m30Count: data.engine?.m30Count || 0,
            m15Count: data.engine?.m15Count || 0,
            h4Count: data.engine?.h4Count || 0,
            d1Count: data.engine?.d1Count || 0,
            h1GapsCount: data.engine?.gaps?.h1 || data.engine?.h1GapsCount || 0,
            usable: data.engine?.usable || { m15: 0, m30: 0, h1: 0, h4: 0, d1: 0 },
            signalsActive: false,
          }));
        }
      } catch {
        if (isMounted) {
          setPriceData((prev) => ({
            ...prev,
            status: 'OFFLINE',
            price: null,
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
