import { useEffect, useRef } from "react";

/**
 * One-shot canvas confetti burst — brand palette, fires once on mount and
 * removes itself. Skips entirely under prefers-reduced-motion.
 */

const CONFETTI_COLORS = ["#2e5252", "#ae633f", "#d1c06f", "#ba9268", "#955f27"];

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
  age: number;
  lifeMs: number;
};

function pickColor(): string {
  const idx = Math.floor(Math.random() * CONFETTI_COLORS.length);
  return CONFETTI_COLORS[idx] ?? "#2e5252";
}

function makeBurst(
  originX: number,
  originY: number,
  count: number,
  angleRange: [number, number],
  speedRange: [number, number],
): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = angleRange[0] + Math.random() * (angleRange[1] - angleRange[0]);
    const speed = speedRange[0] + Math.random() * (speedRange[1] - speedRange[0]);
    particles.push({
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 5 + Math.random() * 5,
      color: pickColor(),
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 12,
      age: 0,
      lifeMs: 2200 + Math.random() * 900,
    });
  }
  return particles;
}

export function Confetti() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    // Top-center rain (90) + two bottom-corner cannons (40 + 40).
    const particles: Particle[] = [
      ...makeBurst(width / 2, -10, 90, [Math.PI / 2 - 0.9, Math.PI / 2 + 0.9], [2, 6]),
      ...makeBurst(-10, height + 10, 40, [-Math.PI / 2 - 0.55, -Math.PI / 2 + 0.15], [8, 15]),
      ...makeBurst(width + 10, height + 10, 40, [-Math.PI / 2 - 0.15, -Math.PI / 2 + 0.55], [8, 15]),
    ];

    const gravity = 0.12;
    const drag = 0.995;
    let lastTs: number | null = null;
    let frameId: number;

    function frame(ts: number) {
      if (lastTs === null) lastTs = ts;
      const dt = Math.min(ts - lastTs, 48);
      lastTs = ts;
      if (!ctx) return;

      ctx.clearRect(0, 0, width, height);

      let alive = 0;
      for (const p of particles) {
        p.age += dt;
        if (p.age >= p.lifeMs) continue;
        alive++;

        p.vx *= drag;
        p.vy = p.vy * drag + gravity * (dt / 16.7);
        p.x += p.vx * (dt / 16.7);
        p.y += p.vy * (dt / 16.7);
        p.rotation += p.rotationSpeed;

        const lifeFraction = p.age / p.lifeMs;
        const alpha = lifeFraction < 0.75 ? 1 : 1 - (lifeFraction - 0.75) / 0.25;

        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }

      if (alive > 0) {
        frameId = requestAnimationFrame(frame);
      } else if (ctx) {
        ctx.clearRect(0, 0, width, height);
      }
    }

    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 z-50 pointer-events-none"
    />
  );
}
