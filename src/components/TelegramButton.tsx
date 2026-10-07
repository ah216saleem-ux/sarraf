import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { Send, QrCode as QrIcon, X } from 'lucide-react';
import { TELEGRAM_WEB_URL, openTelegram, SARRAF_BOT_USERNAME } from '../lib/telegramConfig';

interface TelegramButtonProps {
  variant?: 'nav' | 'hero' | 'scene' | 'footer' | 'stickyBar' | 'inline';
  className?: string;
  showQrDesktop?: boolean;
  label?: string;
}

export const TelegramButton: React.FC<TelegramButtonProps> = ({
  variant = 'hero',
  className = '',
  showQrDesktop = true,
  label = 'Open Telegram',
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);

  useEffect(() => {
    if (showQrDesktop) {
      QRCode.toDataURL(TELEGRAM_WEB_URL, {
        width: 200,
        margin: 1.5,
        color: {
          dark: '#E8B84A',
          light: '#0a0a0c',
        },
      })
        .then((url) => setQrDataUrl(url))
        .catch((err) => console.error('Error generating QR code:', err));
    }
  }, [showQrDesktop]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    openTelegram();
  };

  if (variant === 'nav') {
    return (
      <div className="relative inline-flex items-center gap-1.5">
        <button
          onClick={handleClick}
          title="Open SARRAF Telegram Bot"
          className={`group inline-flex items-center gap-2 px-3 sm:px-3.5 py-1.5 rounded-full bg-[#0088cc]/15 hover:bg-[#0088cc]/25 border border-[#0088cc]/40 hover:border-[#29B6F6] text-xs font-mono text-neutral-200 hover:text-white transition-all duration-300 shadow-[0_0_15px_rgba(0,136,204,0.15)] cursor-pointer ${className}`}
        >
          <Send className="w-3.5 h-3.5 text-[#29B6F6] group-hover:translate-x-0.5 transition-transform" />
          <span className="font-medium tracking-wider">{label}</span>
        </button>

        {showQrDesktop && qrDataUrl && (
          <button
            onClick={() => setShowQrModal(true)}
            className="hidden lg:inline-flex p-1.5 rounded-full bg-white/5 hover:bg-[#E8B84A]/20 border border-white/10 hover:border-[#E8B84A]/40 text-[#FFD97A] transition-colors cursor-pointer"
            title="Scan Telegram QR Code"
          >
            <QrIcon className="w-3.5 h-3.5" />
          </button>
        )}

        {showQrModal && (
          <QrModal qrUrl={qrDataUrl} onClose={() => setShowQrModal(false)} />
        )}
      </div>
    );
  }

  if (variant === 'stickyBar') {
    return (
      <div className="relative inline-flex items-center gap-2">
        <button
          onClick={handleClick}
          className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-[#B88628] to-[#E8B84A] text-black font-mono font-bold text-xs tracking-wider uppercase hover:brightness-110 active:scale-95 transition-all shadow-[0_0_15px_rgba(232,184,74,0.3)] cursor-pointer ${className}`}
        >
          <Send className="w-3.5 h-3.5" />
          <span>{label}</span>
        </button>
        {showQrDesktop && qrDataUrl && (
          <button
            onClick={() => setShowQrModal(true)}
            className="hidden md:inline-flex p-1.5 rounded-full bg-black/60 border border-[#E8B84A]/30 text-[#FFD97A] hover:bg-[#E8B84A]/10 transition-colors cursor-pointer"
            title="Scan Telegram QR Code"
          >
            <QrIcon className="w-3.5 h-3.5" />
          </button>
        )}
        {showQrModal && (
          <QrModal qrUrl={qrDataUrl} onClose={() => setShowQrModal(false)} />
        )}
      </div>
    );
  }

  if (variant === 'footer') {
    return (
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <button
          onClick={handleClick}
          className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#0088cc]/20 hover:bg-[#0088cc]/30 border border-[#0088cc]/40 hover:border-[#29B6F6] text-white text-xs font-mono tracking-widest uppercase transition-all shadow-[0_0_15px_rgba(0,136,204,0.2)] cursor-pointer ${className}`}
        >
          <Send className="w-3.5 h-3.5 text-[#29B6F6]" />
          <span>{label}</span>
        </button>
        {showQrDesktop && qrDataUrl && (
          <button
            onClick={() => setShowQrModal(true)}
            className="hidden sm:inline-flex items-center gap-1.5 text-xs font-mono text-[#FFD97A]/80 hover:text-[#FFD97A] transition-colors cursor-pointer"
          >
            <QrIcon className="w-3.5 h-3.5" />
            <span>Scan QR</span>
          </button>
        )}
        {showQrModal && (
          <QrModal qrUrl={qrDataUrl} onClose={() => setShowQrModal(false)} />
        )}
      </div>
    );
  }

  // Default / Hero / Scene
  return (
    <div className="relative inline-flex items-center gap-3">
      <button
        onClick={handleClick}
        className={`group relative inline-flex items-center justify-center gap-2.5 px-6 sm:px-7 py-3 sm:py-3.5 rounded-full bg-[#0088cc]/20 hover:bg-[#0088cc]/35 border border-[#0088cc]/50 hover:border-[#29B6F6] text-white text-xs font-mono tracking-widest uppercase transition-all duration-300 shadow-[0_0_25px_rgba(0,136,204,0.25)] hover:shadow-[0_0_35px_rgba(0,136,204,0.4)] cursor-pointer active:scale-95 ${className}`}
      >
        <Send className="w-4 h-4 text-[#29B6F6] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
        <span className="font-medium">{label}</span>
      </button>

      {showQrDesktop && qrDataUrl && (
        <button
          onClick={() => setShowQrModal(true)}
          className="hidden md:inline-flex items-center justify-center w-11 h-11 rounded-full bg-black/60 border border-[#E8B84A]/30 hover:border-[#FFD97A] text-[#FFD97A] hover:bg-[#E8B84A]/10 transition-all duration-300 shadow-[0_0_15px_rgba(232,184,74,0.15)] cursor-pointer"
          title="Show Desktop QR Code"
        >
          <QrIcon className="w-4 h-4" />
        </button>
      )}

      {showQrModal && (
        <QrModal qrUrl={qrDataUrl} onClose={() => setShowQrModal(false)} />
      )}
    </div>
  );
};

const QrModal: React.FC<{ qrUrl: string; onClose: () => void }> = ({
  qrUrl,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-sm rounded-2xl bg-[#09090b] border border-[#E8B84A]/40 p-6 flex flex-col items-center shadow-[0_0_50px_rgba(232,184,74,0.25)]">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <div className="w-2.5 h-2.5 bg-[#E8B84A] rotate-45" />
          <span className="font-mono text-sm tracking-[0.2em] font-bold text-white">
            SARRAF TELEGRAM BOT
          </span>
        </div>

        <div className="p-3 bg-[#0a0a0c] rounded-xl border border-[#E8B84A]/30 mb-4 shadow-inner">
          <img
            src={qrUrl}
            alt="Scan to open SARRAF Telegram Bot"
            className="w-48 h-48 rounded"
          />
        </div>

        <p className="text-xs font-mono text-center text-neutral-300 mb-2">
          Scan with your phone camera or Telegram app to connect directly.
        </p>

        <a
          href={TELEGRAM_WEB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-mono text-[#29B6F6] hover:underline"
        >
          @{SARRAF_BOT_USERNAME}
        </a>
      </div>
    </div>
  );
};
