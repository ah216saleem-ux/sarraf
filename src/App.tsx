/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { MarketProvider, useMarket } from './context/MarketContext';
import { LandingPage } from './landing/LandingPage';
import { LoginModal } from './components/LoginModal';
import { ParticleTunnelTransition } from './components/ParticleTunnelTransition';
import { DashboardView } from './components/DashboardView';
import { NewsTab } from './components/NewsTab';
import { DojiBacktestPage } from './doji/DojiBacktestPage';

const MainApp: React.FC = () => {
  const { isLoggedIn, isTunnelActive, priceData } = useMarket();
  const isDojiBacktestPage =
    typeof window !== 'undefined' &&
    window.location.pathname.replace(/\/+$/, '') === '/doji-backtest';
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
      {isTunnelActive && <ParticleTunnelTransition />}
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
