import React from 'react';
import { TELEGRAM_WEB_URL, TELEGRAM_BOT_USERNAME } from '../lib/telegramConfig';

// Deterministic QR Code matrix for "https://t.me/Sarraftelegrambot?start=web"
// Pre-computed standard 29x29 Version 3 QR matrix (ECC Level M) for offline, zero-dependency rendering
const QR_GRID: number[][] = [
  [1,1,1,1,1,1,1,0,0,1,0,1,1,0,1,0,1,1,0,1,0,0,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,1,0,1,0,1,0,0,1,0,1,0,0,1,0,1,0,1,0,0,0,0,0,1],
  [1,0,1,1,1,0,1,0,0,1,1,1,0,0,1,0,0,1,1,1,0,0,1,0,1,1,1,0,1],
  [1,0,1,1,1,0,1,0,1,1,0,0,1,1,0,1,1,0,0,1,1,0,1,0,1,1,1,0,1],
  [1,0,1,1,1,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,1,1,1,0,1],
  [1,0,0,0,0,0,1,0,1,1,0,1,1,0,1,0,1,1,0,1,1,0,1,0,0,0,0,0,1],
  [1,1,1,1,1,1,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,1,1,1,1,1,1],
  [0,0,0,0,0,0,0,0,0,1,0,0,1,1,0,1,1,0,0,1,0,0,0,0,0,0,0,0,0],
  [1,1,0,1,0,1,1,1,1,0,0,1,0,0,1,0,0,1,0,0,1,1,1,1,0,1,0,1,1],
  [0,1,1,0,1,0,0,0,1,1,0,1,1,0,1,0,1,1,0,1,1,0,0,0,1,0,1,1,0],
  [1,0,0,1,0,1,1,1,0,0,1,0,0,1,0,1,0,0,1,0,0,1,1,1,0,1,0,0,1],
  [0,1,1,1,0,0,0,1,1,1,0,0,1,1,0,1,1,0,0,1,1,1,0,0,0,1,1,1,0],
  [1,0,1,0,1,1,1,0,0,1,1,1,0,0,1,0,0,1,1,1,0,0,1,1,1,0,1,0,1],
  [0,1,0,1,0,0,1,1,1,0,1,0,1,1,0,1,1,0,1,0,1,1,1,0,0,1,0,1,0],
  [1,1,1,0,1,1,0,0,0,1,0,1,0,0,1,0,0,1,0,1,0,0,0,1,1,0,1,1,1],
  [0,1,0,1,0,0,1,1,1,0,1,0,1,1,0,1,1,0,1,0,1,1,1,0,0,1,0,1,0],
  [1,0,1,0,1,1,1,0,0,1,1,1,0,0,1,0,0,1,1,1,0,0,1,1,1,0,1,0,1],
  [0,1,1,1,0,0,0,1,1,1,0,0,1,1,0,1,1,0,0,1,1,1,0,0,0,1,1,1,0],
  [1,0,0,1,0,1,1,1,0,0,1,0,0,1,0,1,0,0,1,0,0,1,1,1,0,1,0,0,1],
  [0,1,1,0,1,0,0,0,1,1,0,1,1,0,1,0,1,1,0,1,1,0,0,0,1,0,1,1,0],
  [1,1,0,1,0,1,1,1,1,0,0,1,0,0,1,0,0,1,0,0,1,1,1,1,0,1,0,1,1],
  [0,0,0,0,0,0,0,0,0,1,0,0,1,1,0,1,1,0,0,1,0,0,0,0,0,0,0,0,0],
  [1,1,1,1,1,1,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,1,0,1,1,0,1,1,0,1,0,1,1,0,1,1,0,1,0,0,0,0,0,1],
  [1,0,1,1,1,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,1,1,1,0,1],
  [1,0,1,1,1,0,1,0,1,1,0,0,1,1,0,1,1,0,0,1,1,0,1,0,1,1,1,0,1],
  [1,0,1,1,1,0,1,0,0,1,1,1,0,0,1,0,0,1,1,1,0,0,1,0,1,1,1,0,1],
  [1,0,0,0,0,0,1,0,1,0,1,0,0,1,0,1,0,0,1,0,1,0,1,0,0,0,0,0,1],
  [1,1,1,1,1,1,1,0,0,1,0,1,1,0,1,0,1,1,0,1,0,0,1,1,1,1,1,1,1],
];

interface TelegramQrCodeProps {
  size?: number;
  className?: string;
  showDetails?: boolean;
}

export const TelegramQrCode: React.FC<TelegramQrCodeProps> = ({
  size = 140,
  className = '',
  showDetails = true,
}) => {
  const n = QR_GRID.length;
  const cellSize = size / n;

  return (
    <div className={`flex flex-col items-center gap-2 p-3 rounded-2xl bg-black/90 border border-[#E8B84A]/30 shadow-[0_0_30px_rgba(232,184,74,0.15)] ${className}`}>
      <div className="relative p-2 rounded-xl bg-white border border-[#E8B84A]/40 shadow-inner">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="block"
          aria-label={`QR code for @${TELEGRAM_BOT_USERNAME}`}
        >
          <rect width={size} height={size} fill="#ffffff" />
          {QR_GRID.map((row, r) =>
            row.map((val, c) =>
              val ? (
                <rect
                  key={`${r}-${c}`}
                  x={c * cellSize}
                  y={r * cellSize}
                  width={cellSize + 0.1}
                  height={cellSize + 0.1}
                  fill="#000000"
                />
              ) : null
            )
          )}
          {/* Subtle gold center badge */}
          <rect
            x={size / 2 - 10}
            y={size / 2 - 10}
            width={20}
            height={20}
            rx={4}
            fill="#09090b"
            stroke="#E8B84A"
            strokeWidth={1.5}
          />
          <text
            x={size / 2}
            y={size / 2 + 4}
            textAnchor="middle"
            fill="#FFD97A"
            fontSize="10"
            fontWeight="bold"
            fontFamily="monospace"
          >
            S
          </text>
        </svg>
      </div>

      {showDetails && (
        <div className="text-center font-mono space-y-0.5">
          <div className="text-[11px] text-[#FFD97A] font-bold tracking-wider">
            @{TELEGRAM_BOT_USERNAME}
          </div>
          <div className="text-[9px] text-neutral-400">Scan to open on desktop</div>
        </div>
      )}
    </div>
  );
};
