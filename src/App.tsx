/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback } from 'react';
import { MarketProvider, useMarket } from './context/MarketContext';
import { LandingPage } from './landing/LandingPage';
import { LoginModal } from './components/LoginModal';
import { IntroDiamond } from './components/IntroDiamond';
import { DashboardView } from './components/DashboardView';
import { NewsTab } from './components/NewsTab';
import { DojiBacktestPage } from './doji/DojiBacktestPage';
import { LegalPage, LegalSlug } from './components/LegalPage';

function normalizePath(p: string): string {
  const trimmed = p.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

const MainApp: React.FC = () => {
  const { isLoggedIn, isTunnelActive, priceData } = useMarket();

  const [currentPath, setCurrentPath] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return normalizePath(window.location.pathname);
    }
    return '/';
  });

  useEffect(() => {
    const onPopState = () => {
      setCurrentPath(normalizePath(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleNavigate = useCallback((path: string) => {
    if (typeof window === 'undefined') return;
    window.history.pushState({}, '', path);
    setCurrentPath(normalizePath(path));
  }, []);

  const isDojiBacktestPage = currentPath === '/doji-backtest';
  const isLegalRoute =
    currentPath === '/terms' ||
    currentPath === '/privacy' ||
    currentPath === '/risk-disclosure';

  const isDevNewsPreview =
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('devTab') === 'NEWS';
  const devTheme =
    import.meta.env.DEV && typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('newsTheme')
      : null;

  if (isDojiBacktestPage) {
    return <DojiBacktestPage />;
  }

  if (isLegalRoute) {
    return (
      <LegalPage
        slug={currentPath as LegalSlug}
        onNavigate={handleNavigate}
      />
    );
  }

  if (isDevNewsPreview) {
    return (
      <div
        className="min-h-screen w-full py-2 sm:py-6"
        style={{ backgroundColor: devTheme === 'light' ? '#f3f5f7' : '#07090c' }}
      >
        <NewsTab currentPrice={priceData.price} />
      </div>
    );
  }

  return (
    <>
      {isLoggedIn ? <DashboardView /> : <LandingPage />}
      <LoginModal />
      {isTunnelActive && <IntroDiamond />}
    </>
  );
};

export default function App() {
  return (
    <MarketProvider>
      <MainApp />
    </MarketProvider>
  );
}
