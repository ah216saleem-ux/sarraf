/**
 * Market status formatters and helpers for SARRAF XAUUSD price stream
 * Requirements (A1):
 * - LIVE: green pulse badge, digits flash green/red on ticks
 * - MARKET CLOSED: amber badge, no tick flashing, label "Last price",
 *   last tick time (DISPLAY_TZ + UTC), countdown "Reopens in 1d 4h 12m"
 * - FEED STALE / OFFLINE: red-amber badge, last price kept, label "Last update 2m ago"
 */

export function formatReopenCountdown(nextOpenTime: string | null | undefined): string {
  if (!nextOpenTime) return 'Reopening scheduled soon';

  const target = new Date(nextOpenTime).getTime();
  const now = Date.now();
  const diffMs = target - now;

  if (diffMs <= 0) return 'Market opening now';

  const totalMinutes = Math.floor(diffMs / (60 * 1000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `Reopens in ${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `Reopens in ${hours}h ${minutes}m`;
  }
  return `Reopens in ${minutes}m`;
}

export function formatQuoteAge(ageSeconds: number): string {
  const safeAge = Math.max(0, Math.floor(ageSeconds));
  if (safeAge < 60) {
    return `Last update ${safeAge}s ago`;
  }
  const mins = Math.floor(safeAge / 60);
  return `Last update ${mins}m ago`;
}

export function formatLastTickTime(isoString: string): {
  utcStr: string;
  localStr: string;
  combined: string;
} {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) {
      return { utcStr: 'UTC', localStr: 'LOCAL', combined: 'Synchronizing...' };
    }

    const utcHours = String(d.getUTCHours()).padStart(2, '0');
    const utcMins = String(d.getUTCMinutes()).padStart(2, '0');
    const utcSecs = String(d.getUTCSeconds()).padStart(2, '0');
    const utcStr = `${utcHours}:${utcMins}:${utcSecs} UTC`;

    // Local Display TZ
    const localStr = d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    return {
      utcStr,
      localStr,
      combined: `${utcStr} (${localStr} Local)`,
    };
  } catch {
    return { utcStr: 'UTC', localStr: 'LOCAL', combined: 'Synchronizing...' };
  }
}
