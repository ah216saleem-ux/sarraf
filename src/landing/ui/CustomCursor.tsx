import React, { useEffect, useState, useRef } from 'react';

interface DustParticle {
  id: number;
  x: number;
  y: number;
  size: number;
  opacity: number;
}

export const CustomCursor: React.FC = () => {
  const [pos, setPos] = useState({ x: -100, y: -100 });
  const [isHovered, setIsHovered] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [touchDust, setTouchDust] = useState<DustParticle[]>([]);
  const nextDustId = useRef(0);
  const lastTouchTime = useRef(0);

  useEffect(() => {
    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;

    // Desktop Mouse Cursor
    if (!isTouchDevice) {
      const handleMouseMove = (e: MouseEvent) => {
        setPos({ x: e.clientX, y: e.clientY });
        if (!isVisible) setIsVisible(true);

        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'BUTTON' ||
            target.tagName === 'A' ||
            target.closest('button') ||
            target.closest('a') ||
            target.getAttribute('role') === 'button')
        ) {
          setIsHovered(true);
        } else {
          setIsHovered(false);
        }
      };

      const handleMouseLeave = () => {
        setIsVisible(false);
      };

      window.addEventListener('mousemove', handleMouseMove, { passive: true });
      document.addEventListener('mouseleave', handleMouseLeave);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseleave', handleMouseLeave);
      };
    } else {
      // Mobile Touch: create faint gold dust trail on mobile touchmove
      const handleTouchMove = (e: TouchEvent) => {
        const now = performance.now();
        if (now - lastTouchTime.current < 45) return; // throttle to ~22fps for high efficiency
        lastTouchTime.current = now;

        const touch = e.touches[0];
        if (!touch) return;

        const newId = nextDustId.current++;
        const particle: DustParticle = {
          id: newId,
          x: touch.clientX,
          y: touch.clientY,
          size: 3 + Math.random() * 4,
          opacity: 0.65,
        };

        setTouchDust((prev) => [...prev.slice(-12), particle]);

        // Auto remove after fade out
        setTimeout(() => {
          setTouchDust((prev) => prev.filter((p) => p.id !== newId));
        }, 550);
      };

      window.addEventListener('touchmove', handleTouchMove, { passive: true });
      return () => {
        window.removeEventListener('touchmove', handleTouchMove);
      };
    }
  }, [isVisible]);

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {/* Mobile touch dust trail */}
      {touchDust.map((p) => (
        <div
          key={p.id}
          className="absolute rounded-full pointer-events-none animate-ping"
          style={{
            left: `${p.x}px`,
            top: `${p.y}px`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            backgroundColor: '#FFD97A',
            boxShadow: '0 0 10px #E8B84A',
            opacity: p.opacity,
            transform: 'translate(-50%, -50%)',
            transition: 'opacity 0.55s cubic-bezier(0.22, 1, 0.36, 1), transform 0.55s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />
      ))}

      {/* Desktop Custom Cursor */}
      {isVisible && (
        <>
          {/* Outer soft ambient amber aura */}
          <div
            className="absolute rounded-full transition-transform duration-100 ease-[cubic-bezier(0.22,1,0.36,1)] -translate-x-1/2 -translate-y-1/2 will-change-transform"
            style={{
              left: `${pos.x}px`,
              top: `${pos.y}px`,
              width: isHovered ? '56px' : '32px',
              height: isHovered ? '56px' : '32px',
              background: isHovered
                ? 'radial-gradient(circle, rgba(232, 184, 74, 0.45) 0%, rgba(232, 184, 74, 0) 70%)'
                : 'radial-gradient(circle, rgba(232, 184, 74, 0.22) 0%, rgba(232, 184, 74, 0) 70%)',
              filter: 'blur(2px)',
            }}
          />
          {/* Precision center dot */}
          <div
            className="absolute w-1.5 h-1.5 bg-[#FFD97A] rounded-full -translate-x-1/2 -translate-y-1/2 shadow-[0_0_8px_#FFD97A]"
            style={{
              left: `${pos.x}px`,
              top: `${pos.y}px`,
              transform: `translate(-50%, -50%) scale(${isHovered ? 1.5 : 1})`,
              transition: 'transform 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          />
        </>
      )}
    </div>
  );
};
