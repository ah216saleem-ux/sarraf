import React, { useEffect, useState } from 'react';

interface PreloaderProps {
  onLoaded: () => void;
}

export const Preloader: React.FC<PreloaderProps> = ({ onLoaded }) => {
  const [progress, setProgress] = useState(0);
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => {
            setIsFading(true);
            setTimeout(onLoaded, 600);
          }, 200);
          return 100;
        }
        const inc = Math.floor(Math.random() * 22) + 8;
        return Math.min(prev + inc, 100);
      });
    }, 70);

    return () => clearInterval(interval);
  }, [onLoaded]);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#050505] transition-opacity duration-700 ${
        isFading ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      <div className="w-full max-w-xs px-6 flex flex-col items-center">
        {/* Brand Monogram */}
        <div className="mb-8 flex items-center gap-2">
          <span className="font-mono text-xs tracking-[0.3em] text-[#E8B84A] uppercase">
            SARRAF
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#E8B84A] animate-pulse" />
          <span className="font-mono text-[10px] tracking-wider text-neutral-500 uppercase">
            XAU/USD
          </span>
        </div>

        {/* Gold progress line */}
        <div className="relative w-full h-[1px] bg-neutral-800 overflow-hidden">
          <div
            className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-[#B88628] via-[#FFD97A] to-[#E8B84A] transition-all duration-150 ease-out shadow-[0_0_12px_#E8B84A]"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Progress readout */}
        <div className="w-full mt-3 flex justify-between items-center text-[11px] font-mono text-neutral-400">
          <span className="tracking-widest">INITIALIZING VAULT</span>
          <span className="text-[#FFD97A]">{progress}%</span>
        </div>
      </div>
    </div>
  );
};
