"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// --- Configuration ---
const PARTICLE_DENSITY = 0.00015;
const BG_PARTICLE_DENSITY = 0.00005;
const MOUSE_RADIUS = 180;
const RETURN_SPEED = 0.08;
const DAMPING = 0.9;
const REPULSION_STRENGTH = 1.2;

const randomRange = (min, max) => Math.random() * (max - min) + min;

function AntiGravityCanvas({ className = "" }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [debugInfo, setDebugInfo] = useState({ count: 0, fps: 0 });

  const particlesRef = useRef([]);
  const backgroundParticlesRef = useRef([]);
  const mouseRef = useRef({ x: -1000, y: -1000, isActive: false });
  const frameIdRef = useRef(0);
  const lastTimeRef = useRef(0);

  const initParticles = useCallback((width, height) => {
    const particleCount = Math.floor(width * height * PARTICLE_DENSITY);
    const newParticles = [];

    for (let i = 0; i < particleCount; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;

      newParticles.push({
        x,
        y,
        originX: x,
        originY: y,
        vx: 0,
        vy: 0,
        size: randomRange(1, 2.5),
        color: Math.random() > 0.9 ? "#4285F4" : "#ffffff",
        angle: Math.random() * Math.PI * 2,
      });
    }
    particlesRef.current = newParticles;

    const bgCount = Math.floor(width * height * BG_PARTICLE_DENSITY);
    const newBgParticles = [];

    for (let i = 0; i < bgCount; i++) {
      newBgParticles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.2,
        size: randomRange(0.5, 1.5),
        alpha: randomRange(0.1, 0.4),
        phase: Math.random() * Math.PI * 2,
      });
    }
    backgroundParticlesRef.current = newBgParticles;

    setDebugInfo((prev) => ({ ...prev, count: particleCount + bgCount }));
  }, []);

  const animate = useCallback((time) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const delta = time - lastTimeRef.current;
    lastTimeRef.current = time;
    if (delta > 0) {
      setDebugInfo((prev) => ({ ...prev, fps: Math.round(1000 / delta) }));
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // --- Pulsating radial glow (faint Google Blue, as in the original) ---
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const pulseSpeed = 0.0008;
    const pulseOpacity = Math.sin(time * pulseSpeed) * 0.035 + 0.085;

    const gradient = ctx.createRadialGradient(
      centerX,
      centerY,
      0,
      centerX,
      centerY,
      Math.max(canvas.width, canvas.height) * 0.7
    );
    gradient.addColorStop(0, `rgba(66, 133, 244, ${pulseOpacity})`);
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // --- Background drifting dust ---
    const bgParticles = backgroundParticlesRef.current;
    ctx.fillStyle = "#ffffff";

    for (let i = 0; i < bgParticles.length; i++) {
      const p = bgParticles[i];
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height;
      if (p.y > canvas.height) p.y = 0;

      const twinkle = Math.sin(time * 0.002 + p.phase) * 0.5 + 0.5;
      ctx.globalAlpha = p.alpha * (0.3 + 0.7 * twinkle);

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // --- Foreground physics ---
    const particles = particlesRef.current;
    const mouse = mouseRef.current;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];

      const dx = mouse.x - p.x;
      const dy = mouse.y - p.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (mouse.isActive && distance < MOUSE_RADIUS) {
        const forceDirectionX = dx / distance;
        const forceDirectionY = dy / distance;
        const force = (MOUSE_RADIUS - distance) / MOUSE_RADIUS;

        const repulsion = force * REPULSION_STRENGTH;
        p.vx -= forceDirectionX * repulsion * 5;
        p.vy -= forceDirectionY * repulsion * 5;
      }

      const springDx = p.originX - p.x;
      const springDy = p.originY - p.y;

      p.vx += springDx * RETURN_SPEED;
      p.vy += springDy * RETURN_SPEED;
    }

    // Elastic collisions
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const p1 = particles[i];
        const p2 = particles[j];

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const distSq = dx * dx + dy * dy;
        const minDist = p1.size + p2.size;

        if (distSq < minDist * minDist) {
          const dist = Math.sqrt(distSq);

          if (dist > 0.01) {
            const nx = dx / dist;
            const ny = dy / dist;

            const overlap = minDist - dist;
            const pushX = nx * overlap * 0.5;
            const pushY = ny * overlap * 0.5;

            p1.x -= pushX;
            p1.y -= pushY;
            p2.x += pushX;
            p2.y += pushY;

            const dvx = p1.vx - p2.vx;
            const dvy = p1.vy - p2.vy;
            const velocityAlongNormal = dvx * nx + dvy * ny;

            if (velocityAlongNormal > 0) {
              const m1 = p1.size;
              const m2 = p2.size;
              const restitution = 0.85;

              const impulseMagnitude =
                (-(1 + restitution) * velocityAlongNormal) / (1 / m1 + 1 / m2);

              const impulseX = impulseMagnitude * nx;
              const impulseY = impulseMagnitude * ny;

              p1.vx += impulseX / m1;
              p1.vy += impulseY / m1;
              p2.vx -= impulseX / m2;
              p2.vy -= impulseY / m2;
            }
          }
        }
      }
    }

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];

      p.vx *= DAMPING;
      p.vy *= DAMPING;

      p.x += p.vx;
      p.y += p.vy;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);

      const velocity = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      const opacity = Math.min(0.3 + velocity * 0.1, 1);

      ctx.fillStyle =
        p.color === "#ffffff" ? `rgba(255, 255, 255, ${opacity})` : p.color;

      ctx.fill();
    }

    frameIdRef.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        canvasRef.current.width = width * dpr;
        canvasRef.current.height = height * dpr;

        canvasRef.current.style.width = `${width}px`;
        canvasRef.current.style.height = `${height}px`;

        const ctx = canvasRef.current.getContext("2d");
        if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        initParticles(width, height);
      }
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    return () => window.removeEventListener("resize", handleResize);
  }, [initParticles]);

  useEffect(() => {
    frameIdRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameIdRef.current);
  }, [animate]);

  // Mouse tracking on the whole window so particles also react
  // when the cursor is over the form card above the canvas.
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        isActive: true,
      };
    };
    const handleMouseLeave = () => {
      mouseRef.current.isActive = false;
    };

    window.addEventListener("mousemove", handleMouseMove);
    document.documentElement.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      document.documentElement.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  const handleMouseMove = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    mouseRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      isActive: true,
    };
  };

  const handleMouseLeave = () => {
    mouseRef.current.isActive = false;
  };

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 z-0 overflow-hidden bg-black cursor-crosshair ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />

      {/* Debug info overlay */}
      <div className="pointer-events-none absolute right-4 bottom-4 text-right font-mono text-xs text-white/20">
        <p>{debugInfo.count} entities</p>
        <p>{debugInfo.fps} FPS</p>
      </div>
    </div>
  );
}

export { AntiGravityCanvas };

export default AntiGravityCanvas;
