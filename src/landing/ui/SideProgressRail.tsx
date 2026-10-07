import React from 'react';

interface SideProgressRailProps {
  progress: number;
  onScrollTo: (sceneIndex: number) => void;
}

const SCENES = [
  { name: 'Live', index: 0, range: [0, 0.2] },
  { name: 'Precision', index: 1, range: [0.2, 0.42] },
  { name: 'News', index: 2, range: [0.42, 0.65] },
  { name: 'Telegram', index: 3, range: [0.65, 0.85] },
  { name: 'Vault', index: 4, range: [0.85, 1.0] },
];

export const SideProgressRail: React.FC<SideProgressRailProps> = ({
  progress,
  onScrollTo,
}) => {
  return (
    <div className="fixed right-4 sm:right-6 top-1/2 -translate-y-1/2 z-30 hidden md:flex flex-col items-end gap-5 pointer-events-auto">
      {/* Background vertical track */}
      <div className="relative flex flex-col items-center gap-6 py-2">
        <div className="absolute top-0 bottom-0 right-[5px] w-[1px] bg-white/10" />
        <div
          className="absolute top-0 right-[5px] w-[1px] bg-gradient-to-b from-[#B88628] to-[#FFD97A] shadow-[0_0_8px_#E8B84A] transition-all duration-150 ease-out"
          style={{ height: `${Math.min(100, Math.max(0, progress * 100))}%` }}
        />

        {SCENES.map((scene) => {
          const isActive =
            progress >= scene.range[0] && progress <= scene.range[1];

          return (
            <button
              key={scene.name}
              onClick={() => onScrollTo(scene.index)}
              className="group flex items-center gap-3 cursor-pointer py-1"
              title={`Jump to ${scene.name}`}
            >
              <span
                className={`text-[10px] font-mono tracking-widest uppercase transition-all duration-300 ${
                  isActive
                    ? 'text-[#FFD97A] font-bold translate-x-0 opacity-100 drop-shadow-[0_0_8px_rgba(255,217,122,0.5)]'
                    : 'text-neutral-500 opacity-60 group-hover:opacity-100 group-hover:text-neutral-300 translate-x-1'
                }`}
              >
                {scene.name}
              </span>

              <div className="relative flex items-center justify-center w-3 h-3">
                {isActive && (
                  <span className="absolute w-3 h-3 rounded-full bg-[#E8B84A]/30 animate-ping" />
                )}
                <div
                  className={`w-2 h-2 rounded-full transition-all duration-300 ${
                    isActive
                      ? 'bg-[#FFD97A] shadow-[0_0_10px_#E8B84A] scale-125'
                      : 'bg-neutral-700 group-hover:bg-[#E8B84A]/60'
                  }`}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
