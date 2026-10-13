import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';
import { useReducedMotion } from '../demo/useReducedMotion.js';

/**
 * ParticleField — an interactive constellation canvas.
 *
 * Dots drift slowly and join with a hairline when they get close, so the
 * background reads as a living network instead of a static texture. The
 * cursor pushes them away gently, which is the only interactive part.
 *
 * Cost control:
 *  - particle count scales with area and is hard-capped;
 *  - the rAF loop stops entirely when the section scrolls out of view or the
 *    tab is hidden, and restarts when it comes back;
 *  - `prefers-reduced-motion` renders a single static frame instead.
 */
const AREA_PER_PARTICLE = 13000; // ~1 particle per 13000 px²
const MAX_PARTICLES = 110;
const LINK_DISTANCE = 132;
const CURSOR_RADIUS = 150;
const CURSOR_PUSH = 14;

const rand = (min, max) => Math.random() * (max - min) + min;

export default function ParticleField({
    className,
    density = 1,
    linkColor = 'rgba(255,255,255,0.14)',
    dotColor = 'rgba(255,255,255,0.55)',
}) {
    const wrapRef = useRef(null);
    const canvasRef = useRef(null);
    const reduced = useReducedMotion();

    useEffect(() => {
        const wrap = wrapRef.current;
        const canvas = canvasRef.current;
        if (!wrap || !canvas) return undefined;

        const ctx = canvas.getContext('2d');
        if (!ctx) return undefined;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        let width = 0;
        let height = 0;
        let points = [];
        let raf = 0;
        let onScreen = true;
        const pointer = { x: -9999, y: -9999, active: false };

        const build = () => {
            const rect = wrap.getBoundingClientRect();
            width = Math.max(1, Math.round(rect.width));
            height = Math.max(1, Math.round(rect.height));

            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const count = Math.min(
                MAX_PARTICLES,
                Math.round((width * height * density) / AREA_PER_PARTICLE)
            );

            points = Array.from({ length: count }, () => ({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: rand(-0.22, 0.22),
                vy: rand(-0.22, 0.22),
                r: rand(0.7, 1.9),
            }));
        };

        const draw = () => {
            ctx.clearRect(0, 0, width, height);

            // Links first so the dots sit on top of them.
            ctx.lineWidth = 1;
            ctx.strokeStyle = linkColor;
            ctx.beginPath();
            for (let i = 0; i < points.length; i++) {
                const a = points[i];
                for (let j = i + 1; j < points.length; j++) {
                    const b = points[j];
                    const dx = a.x - b.x;
                    const dy = a.y - b.y;
                    if (dx * dx + dy * dy > LINK_DISTANCE * LINK_DISTANCE) continue;
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                }
            }
            ctx.stroke();

            ctx.fillStyle = dotColor;
            for (const p of points) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fill();
            }
        };

        const step = () => {
            for (const p of points) {
                p.x += p.vx;
                p.y += p.vy;

                // Wrap around the edges so the field never drains.
                if (p.x < -10) p.x = width + 10;
                else if (p.x > width + 10) p.x = -10;
                if (p.y < -10) p.y = height + 10;
                else if (p.y > height + 10) p.y = -10;

                if (pointer.active) {
                    const dx = p.x - pointer.x;
                    const dy = p.y - pointer.y;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < CURSOR_RADIUS * CURSOR_RADIUS && distSq > 0.01) {
                        const dist = Math.sqrt(distSq);
                        const force = (1 - dist / CURSOR_RADIUS) * CURSOR_PUSH;
                        p.x += (dx / dist) * force;
                        p.y += (dy / dist) * force;
                    }
                }
            }
            draw();
            raf = requestAnimationFrame(step);
        };

        const syncLoop = () => {
            const shouldRun = onScreen && !document.hidden && !reduced;
            if (shouldRun && !raf) raf = requestAnimationFrame(step);
            else if (!shouldRun && raf) {
                cancelAnimationFrame(raf);
                raf = 0;
            }
        };

        const onPointerMove = (e) => {
            const rect = wrap.getBoundingClientRect();
            pointer.x = e.clientX - rect.left;
            pointer.y = e.clientY - rect.top;
            pointer.active =
                pointer.x > -CURSOR_RADIUS &&
                pointer.y > -CURSOR_RADIUS &&
                pointer.x < width + CURSOR_RADIUS &&
                pointer.y < height + CURSOR_RADIUS;
        };
        const onPointerLeave = () => {
            pointer.active = false;
        };

        const observer = new IntersectionObserver(
            ([entry]) => {
                onScreen = entry.isIntersecting;
                syncLoop();
            },
            { threshold: 0 }
        );
        observer.observe(wrap);

        const resizeObserver = new ResizeObserver(() => {
            build();
            if (reduced) draw();
        });
        resizeObserver.observe(wrap);

        document.addEventListener('visibilitychange', syncLoop);
        window.addEventListener('pointermove', onPointerMove, { passive: true });
        wrap.addEventListener('pointerleave', onPointerLeave);

        build();
        draw();
        syncLoop();

        return () => {
            observer.disconnect();
            resizeObserver.disconnect();
            document.removeEventListener('visibilitychange', syncLoop);
            window.removeEventListener('pointermove', onPointerMove);
            wrap.removeEventListener('pointerleave', onPointerLeave);
            if (raf) cancelAnimationFrame(raf);
        };
    }, [density, linkColor, dotColor, reduced]);

    return (
        <div ref={wrapRef} aria-hidden="true" className={cn('pointer-events-none absolute inset-0', className)}>
            <canvas ref={canvasRef} className="block h-full w-full" />
        </div>
    );
}