import React, { useEffect, useState } from 'react';

export const CustomCursor: React.FC = () => {
  const [pos, setPos] = useState({ x: -100, y: -100 });
  const [isHovered, setIsHovered] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Only on desktop devices with fine pointer
    if (window.matchMedia('(pointer: coarse)').matches) {
      return;
    }

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

    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {/* Outer soft ambient amber aura */}
      <div
        className="absolute rounded-full transition-transform duration-100 ease-out -translate-x-1/2 -translate-y-1/2 will-change-transform"
        style={{
          left: `${pos.x}px`,
          top: `${pos.y}px`,
          width: isHovered ? '64px' : '36px',
          height: isHovered ? '64px' : '36px',
          background: isHovered
            ? 'radial-gradient(circle, rgba(232, 184, 74, 0.4) 0%, rgba(232, 184, 74, 0) 70%)'
            : 'radial-gradient(circle, rgba(232, 184, 74, 0.25) 0%, rgba(232, 184, 74, 0) 70%)',
          filter: 'blur(2px)',
        }}
      />
      {/* Precision center dot */}
      <div
        className="absolute w-1.5 h-1.5 bg-[#FFD97A] rounded-full -translate-x-1/2 -translate-y-1/2 shadow-[0_0_8px_#FFD97A]"
        style={{
          left: `${pos.x}px`,
          top: `${pos.y}px`,
          transform: `translate(-50%, -50%) scale(${isHovered ? 1.6 : 1})`,
          transition: 'transform 0.15s ease-out',
        }}
      />
    </div>
  );
};
