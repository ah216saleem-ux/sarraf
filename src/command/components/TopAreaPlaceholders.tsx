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
  isDimmed,
}) => {
  const feed = useCommandFeed();
  const signalEngine = useCommandSignal();

  return (
    <div className={`space-y-2 transition-opacity duration-300 ${isDimmed ? 'opacity-40' : 'opacity-100'}`}>
      {/* Phase 2 Quantum Vortex 3D Core with Live HUD & Phase 4 Trigger Hooks */}
      <QuantumVortex onRegisterHooks={signalEngine.registerVortexHooks} />

      {/* 2-Column Responsive Row: DECISION & AHMED SNIPER CHAIN */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
        {/* DECISION Card & Telegram Control Bar */}
        <div className="lg:col-span-5 flex flex-col space-y-2">
          <AhmedDecisionCard
            state={signalEngine.state}
            livePnL={signalEngine.livePnL}
            currentPrice={feed.currentPrice}
            isFeedDimmed={isDimmed}
            onManualClose={signalEngine.manualClose}
            onTogglePaper={signalEngine.togglePaperMode}
            onTriggerTest={signalEngine.triggerTestSignal}
            isLoading={signalEngine.isLoading}
          />

          {/* Phase 5 Telegram Control Bar */}
          <TelegramControlBar
            status={signalEngine.telegramStatus}
            onToggleMaster={signalEngine.toggleTelegramMaster}
            onTogglePaper={signalEngine.toggleTelegramPaper}
            onSendTest={signalEngine.sendTelegramTest}
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
        paperMode={signalEngine.state.paperMode}
      />
    </div>
  );
};
