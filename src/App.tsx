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

const MainApp: React.FC = () => {
  const { isLoggedIn, isTunnelActive } = useMarket();

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
