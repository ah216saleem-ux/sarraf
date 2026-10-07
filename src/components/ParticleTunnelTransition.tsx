import React, { useEffect, useRef } from 'react';

export const ParticleTunnelTransition: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    const numStars = 600;
    const stars = Array.from({ length: numStars }).map(() => ({
      x: (Math.random() - 0.5) * width * 2,
      y: (Math.random() - 0.5) * height * 2,
      z: Math.random() * width,
      pz: Math.random() * width,
      color: Math.random() > 0.3 ? '#FFD97A' : '#E8B84A',
    }));

    let speed = 6;
    let startTime = Date.now();

    const render = () => {
      const elapsed = Date.now() - startTime;
      // Exponential warp speed up to 65
      speed = Math.min(speed + 1.2, 70);

      ctx.fillStyle = 'rgba(5, 5, 5, 0.25)';
      ctx.fillRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;

      stars.forEach((star) => {
        star.z -= speed;
        if (star.z <= 0) {
          star.z = width;
          star.pz = width;
          star.x = (Math.random() - 0.5) * width * 2;
          star.y = (Math.random() - 0.5) * height * 2;
        }

        const k = 250 / star.z;
        const px = star.x * k + cx;
        const py = star.y * k + cy;

        const pk = 250 / star.pz;
        const prevX = star.x * pk + cx;
        const prevY = star.y * pk + cy;
        star.pz = star.z;

        if (px >= 0 && px <= width && py >= 0 && py <= height) {
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(px, py);
          ctx.strokeStyle = star.color;
          ctx.lineWidth = Math.min(k * 1.5, 4);
          ctx.stroke();
        }
      });

      // Flashing flash near the transition end
      if (elapsed > 1800) {
        const flashAlpha = Math.min((elapsed - 1800) / 500, 1);
        ctx.fillStyle = `rgba(255, 230, 163, ${flashAlpha * 0.85})`;
        ctx.fillRect(0, 0, width, height);
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 pointer-events-none flex flex-col items-center justify-center bg-black">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      <div className="relative z-10 flex flex-col items-center space-y-3">
        <span className="font-mono text-xs tracking-[0.4em] text-[#FFD97A] uppercase animate-pulse">
          AUTHENTICATED · ENTERING VAULT MATRIX
        </span>
        <div className="w-48 h-[1px] bg-gradient-to-r from-transparent via-[#FFD97A] to-transparent shadow-[0_0_20px_#FFD97A]" />
      </div>
    </div>
  );
};
