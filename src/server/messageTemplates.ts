// Phase 4 - SARRAF Telegram Message Templates
// Single source of truth for all outbound Telegram message formatting

export interface SignalMessageData {
  direction: 'BUY' | 'SELL';
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp4: number;
}

export interface UpdateMessageData {
  type:
    | 'ENTRY_HIT'
    | 'TP1'
    | 'TP2'
    | 'TP3'
    | 'TP4'
    | 'SL'
    | 'BE_STOP'
    | 'EXPIRED'
    | 'MANUAL_CLOSE'
    | 'MARKET_CLOSE'
    | 'TIMEOUT';
  realizedDollars?: number;
  slippageDollars?: number;
  cooldownMinutesRemaining?: number;
}

// 1. New Signal Message Format (Strictly 8 lines, no clutter)
export function formatNewSignalMessage(data: SignalMessageData): string {
  const icon = data.direction === 'BUY' ? '🟢' : '🔴';
  return [
    `XAUUSD ${data.direction} ${icon}`,
    `Entry: ${data.entry.toFixed(2)}`,
    `SL: ${data.sl.toFixed(2)}`,
    `TP1: ${data.tp1.toFixed(2)}`,
    `TP2: ${data.tp2.toFixed(2)}`,
    `TP3: ${data.tp3.toFixed(2)}`,
    `TP4: ${data.tp4.toFixed(2)}`,
  ].join('\n');
}

// 2. Lifecycle Update Messages (Each is ONE concise line)
export function formatUpdateMessage(data: UpdateMessageData): string {
  const slippage = data.slippageDollars && data.slippageDollars > 0.05 ? data.slippageDollars : 0;
  const dollars = data.realizedDollars ?? 0;

  switch (data.type) {
    case 'ENTRY_HIT':
      return 'Entry active ✅';

    case 'TP1':
      return slippage > 0
        ? `TP1 hit ✅ +$${(5.0 - slippage).toFixed(2)} | SL moved to entry`
        : 'TP1 hit ✅ +$5 | SL moved to entry';

    case 'TP2':
      return slippage > 0 ? `TP2 hit ✅ +$${(8.0 - slippage).toFixed(2)}` : 'TP2 hit ✅ +$8';

    case 'TP3':
      return slippage > 0 ? `TP3 hit ✅ +$${(10.0 - slippage).toFixed(2)}` : 'TP3 hit ✅ +$10';

    case 'TP4':
      return slippage > 0
        ? `TP4 hit ✅ +$${(12.0 - slippage).toFixed(2)} | Trade closed`
        : 'TP4 hit ✅ +$12 | Trade closed';

    case 'SL':
      const slLoss = slippage > 0 ? (10.0 + slippage).toFixed(2) : '10';
      return `SL hit ❌ -$${slLoss}`;

    case 'BE_STOP':
      return 'Closed at entry ⚪ (breakeven)';

    case 'EXPIRED':
      return 'Not filled, signal cancelled ⌛';

    case 'TIMEOUT': {
      const sign = dollars >= 0 ? '+' : '-';
      return `Trade closed (time limit) ⏱ ${sign}$${Math.abs(dollars).toFixed(2)}`;
    }

    case 'MARKET_CLOSE': {
      const sign = dollars >= 0 ? '+' : '-';
      return `Trade closed (market close) ⏱ ${sign}$${Math.abs(dollars).toFixed(2)}`;
    }

    case 'MANUAL_CLOSE': {
      const sign = dollars >= 0 ? '+' : '-';
      return `Trade closed (desk manual) ⏱ ${sign}$${Math.abs(dollars).toFixed(2)}`;
    }

    default:
      return 'Signal status updated.';
  }
}

// 3. Post-Close Cooldown Line
export function formatCooldownLine(cooldownMins: number): string {
  // Round to nearest 5 minutes
  const roundedMins = Math.max(5, Math.round(cooldownMins / 5) * 5);
  return `Next setup in about ${roundedMins} min`;
}

// 4. Admin Alert Messages (Max once per 30m per type, with back to normal)
export type AdminAlertType =
  | 'FEED_OFFLINE'
  | 'FEED_BACK'
  | 'ENGINE_PAUSED'
  | 'ENGINE_RESUMED'
  | 'ENGINE_STALLED'
  | 'BOT_RESTARTED'
  | 'NEWS_FEED_DOWN'
  | 'TELEGRAM_FAILING'
  | 'TELEGRAM_RECOVERED';

export function formatAdminAlert(type: AdminAlertType): string {
  switch (type) {
    case 'FEED_OFFLINE':
      return '⚠️ Price feed stopped';
    case 'FEED_BACK':
      return '✅ Price feed back';
    case 'ENGINE_STALLED':
      return '⚠️ Analysis engine stalled';
    case 'BOT_RESTARTED':
      return '⚠️ Bot restarted';
    case 'NEWS_FEED_DOWN':
      return '⚠️ News feed down';
    case 'TELEGRAM_FAILING':
      return '⚠️ Telegram delivery failing';
    case 'TELEGRAM_RECOVERED':
      return '✅ Telegram delivery recovered';
    case 'ENGINE_PAUSED':
      return '⚠️ Engine paused';
    case 'ENGINE_RESUMED':
      return '✅ Engine restarted';
  }
}

// 4.1 Daily Summary Template
export interface DailySummaryData {
  signalsCount: number;
  tpCount: number;
  slCount: number;
  beCount: number;
  totalDollars: number;
  totalR: number;
  isTest?: boolean;
}

export function formatDailySummary(data: DailySummaryData): string {
  const prefix = data.isTest ? '⚡ [TEST] ' : '';
  if (data.signalsCount === 0) {
    return `${prefix}Daily Summary 📊 No signals today.`;
  }

  const dSign = data.totalDollars >= 0 ? '+' : '-';
  const dAbs = Math.abs(data.totalDollars);
  const dFormatted = dAbs % 1 === 0 ? dAbs.toString() : dAbs.toFixed(2);
  const rSign = data.totalR >= 0 ? '+' : '-';
  const rAbs = Math.abs(data.totalR).toFixed(1);

  return [
    `${prefix}Daily Summary 📊`,
    `Signals: ${data.signalsCount}`,
    `TP: ${data.tpCount} | SL: ${data.slCount} | BE: ${data.beCount}`,
    `Result: ${dSign}$${dFormatted} (${rSign}${rAbs}R)`,
  ].join('\n');
}

// 4.2 Weekly Report Template
export interface WeeklyReportData {
  signalsCount: number;
  tpCount: number;
  slCount: number;
  beCount: number;
  winRate: number; // Win rate = WIN / (WIN + LOSS), breakeven excluded
  totalDollars: number;
  totalR: number;
  bestDay: string; // e.g. "Tue"
  worstDay: string; // e.g. "Thu"
  isTest?: boolean;
}

export function formatWeeklyReport(data: WeeklyReportData): string {
  const prefix = data.isTest ? '⚡ [TEST] ' : '';
  if (data.signalsCount === 0) {
    return `${prefix}Weekly Report 📅 No signals this week.`;
  }

  const dSign = data.totalDollars >= 0 ? '+' : '-';
  const dAbs = Math.abs(data.totalDollars);
  const dFormatted = dAbs % 1 === 0 ? dAbs.toString() : dAbs.toFixed(2);
  const rSign = data.totalR >= 0 ? '+' : '-';
  const rAbs = Math.abs(data.totalR).toFixed(1);

  return [
    `${prefix}Weekly Report 📅`,
    `Signals: ${data.signalsCount}`,
    `TP: ${data.tpCount} | SL: ${data.slCount} | BE: ${data.beCount}`,
    `Win rate: ${Math.round(data.winRate)}%`,
    `Result: ${dSign}$${dFormatted} (${rSign}${rAbs}R)`,
    `Best day: ${data.bestDay} | Worst day: ${data.worstDay}`,
  ].join('\n');
}

// 5. Bot Command Responses (Max 4 lines, concise)
export function formatCommandResponse(
  command: string,
  context: {
    state?: string;
    todayCount?: number;
    cooldownMinutes?: number;
    lastSignalText?: string;
    wins?: number;
    losses?: number;
    breakevens?: number;
    totalR?: number;
  }
): string {
  switch (command) {
    case '/start':
      return [
        '🔱 SARRAF — Institutional Gold Intelligence',
        'Real-time XAUUSD algorithmic stream & signals.',
        '',
        'Available Commands:',
        '• /status — Scanner state, signals today & cooldown',
        '• /test — Dispatch immediate test trade signal',
        '• /stats — Win rate and net performance in R',
        '• /last — Most recent executed signal',
        '• /pause / /resume — Scanner desk toggle',
        '• /help — Show command reference',
      ].join('\n');

    case '/help':
      return [
        'SARRAF Gold Terminal Commands:',
        '/status - State, signals today, cooldown',
        '/test - Send realistic sample trade signal',
        '/last - Most recent signal outcome',
        '/stats - Win rate and net R performance',
        '/pause or /resume - Desk toggle',
      ].join('\n');

    case '/status': {
      const state = context.state || 'SCANNING';
      const count = context.todayCount ?? 0;
      const cd = context.cooldownMinutes ? `${context.cooldownMinutes}m remaining` : 'None';
      return [
        `SARRAF Terminal Status: ${state}`,
        `Signals Today: ${count}/3`,
        `Cooldown: ${cd}`,
      ].join('\n');
    }

    case '/last':
      return context.lastSignalText || 'No signals executed in current session.';

    case '/stats': {
      const wins = context.wins ?? 0;
      const losses = context.losses ?? 0;
      const be = context.breakevens ?? 0;
      const r = context.totalR ?? 0;
      const total = wins + losses + be;
      const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
      return [
        'SARRAF Execution Statistics:',
        `Record: ${wins}W / ${losses}L / ${be}BE (${winRate}% Win Rate)`,
        `Net Performance: ${r >= 0 ? '+' : ''}${r}R`,
      ].join('\n');
    }

    case '/pause':
      return '✅ Signal Manager paused by desk command.';

    case '/resume':
      return '✅ Signal Manager resumed by desk command.';

    default:
      return 'Unknown command. Use /help for available options.';
  }
}
