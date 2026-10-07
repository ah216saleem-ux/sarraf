/**
 * SARRAF Telegram Dispatch Bot Configuration & Utilities
 * Never expose bot tokens or sensitive channel/chat IDs to the client.
 */

export const SARRAF_BOT_USERNAME = 'Sarraftelegrambot';
export const TELEGRAM_BOT_USERNAME = SARRAF_BOT_USERNAME;
export const TELEGRAM_WEB_URL = `https://t.me/${SARRAF_BOT_USERNAME}?start=web`;
export const TELEGRAM_APP_URL = `tg://resolve?domain=${SARRAF_BOT_USERNAME}&start=web`;

/**
 * Open the SARRAF Telegram bot with mobile-first deep linking and desktop web fallback
 */
export function openTelegram(): void {
  if (typeof window === 'undefined') return;

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );

  if (isMobile) {
    // Attempt native Telegram app first, fallback to web
    const start = Date.now();
    const fallbackTimer = window.setTimeout(() => {
      // If user hasn't switched away from the browser within 1.2s, fallback to web
      if (Date.now() - start < 2000) {
        window.open(TELEGRAM_WEB_URL, '_blank', 'noopener,noreferrer');
      }
    }, 1200);

    // Trigger deep link
    window.location.href = TELEGRAM_APP_URL;

    // Clear timeout if window loses focus (app opened)
    window.addEventListener(
      'pagehide',
      () => {
        window.clearTimeout(fallbackTimer);
      },
      { once: true }
    );
  } else {
    // Desktop: open web interface in new tab
    window.open(TELEGRAM_WEB_URL, '_blank', 'noopener,noreferrer');
  }
}
