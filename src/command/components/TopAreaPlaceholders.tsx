import React from 'react';
import { QuantumVortex } from '../vortex/QuantumVortex';
import { useCommandFeed } from '../data/useCommandFeed';
import { useCommandSignal } from '../signal/useCommandSignal';
import { AhmedDecisionCard } from '../signal/AhmedDecisionCard';
import { AhmedSniperChainCard } from '../signal/AhmedSniperChainCard';
import { SignalLogCard } from '../signal/SignalLogCard';
import { TelegramControlBar } from '../signal/TelegramControlBar';

interface TopAreaPlaceholdersProps {
  buyRatio: number;
  sellRatio: number;
  isDimmed: boolean;
  freshness: string;
}

export const TopAreaPlaceholders: React.FC<TopAreaPlaceholdersProps> = ({
  buyRatio,
  sellRatio,
  isDimmed,
}) => {
  const feed = useCommandFeed();
  const signalEngine = useCommandSignal();

  return (
    <div className={`space-y-2 transition-opacity duration-300 ${isDimmed ? 'opacity-40' : 'opacity-100'}`}>
      {/* Flow Rivers 3D Core with Live HUD & Phase 4 Trigger Hooks */}
      <QuantumVortex
        onRegisterHooks={signalEngine.registerVortexHooks}
        signalEngine={signalEngine}
        buyRatio={buyRatio}
        sellRatio={sellRatio}
      />

      {/* 2-Column Responsive Row: DECISION & AHMED SNIPER CHAIN */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
        {/* DECISION Card & Telegram Control Bar */}
        <div className="lg:col-span-5 flex flex-col space-y-2">
          <AhmedDecisionCard
            state={signalEngine.state}
            livePnL={signalEngine.livePnL}
            currentPrice={feed.currentPrice}
            isFeedDimmed={isDimmed}
            isMarketClosed={feed.connection.status === 'MARKET_CLOSED' || !feed.connection.isLive}
            watchingCandidate={feed.watchingCandidate}
            onManualClose={signalEngine.manualClose}
            onTriggerTest={signalEngine.triggerTestSignal}
            isLoading={signalEngine.isLoading}
          />

          {/* Phase 5 Telegram Control Bar */}
          <TelegramControlBar
            status={signalEngine.telegramStatus}
            onToggleMaster={signalEngine.toggleTelegramMaster}
            onSendTest={signalEngine.sendTelegramTest}
            onStartSignals={signalEngine.startSignals}
            onStopSignals={signalEngine.stopSignals}
            httpError={signalEngine.telegramError}
            onClearHttpError={signalEngine.clearTelegramError}
            isLoading={signalEngine.telegramLoading}
          />
        </div>

        {/* AHMED SNIPER CHAIN Card (8 Gates) */}
        <div className="lg:col-span-7 flex flex-col">
          <AhmedSniperChainCard
            gates={signalEngine.state.gates}
            confidence={signalEngine.state.confidence}
            pathClearR={signalEngine.state.pathClearR}
            isFeedDimmed={isDimmed}
          />
        </div>
      </div>

      {/* SIGNAL LOG Card (Last 20 exits & live verified stats) */}
      <SignalLogCard
        history={signalEngine.state.history}
        stats={signalEngine.state.stats}
        telegramStatus={signalEngine.telegramStatus}
      />
    </div>
  );
};
