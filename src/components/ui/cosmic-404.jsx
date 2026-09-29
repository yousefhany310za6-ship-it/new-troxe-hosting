import createGlobe from 'cobe';
import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

const GLOBE_CONFIG = {
    width: 600,
    height: 600,
    devicePixelRatio: 2,
    phi: 0,
    theta: 0.3,
    dark: 0,
    diffuse: 0.4,
    mapSamples: 16000,
    mapBrightness: 1.2,
    baseColor: [1, 1, 1],
    markerColor: [251 / 255, 100 / 255, 21 / 255],
    glowColor: [1, 1, 1],
    markers: [
        { location: [41.0082, 28.9784], size: 0.06 },
        { location: [40.7128, -74.006], size: 0.1 },
        { location: [34.6937, 135.5022], size: 0.05 },
        { location: [-23.5505, -46.6333], size: 0.1 },
    ],
};

const TWO_PI = Math.PI * 2;

/**
 * COBE v2 dropped its internal render loop: the caller owns the animation and
 * pushes a new rotation with `globe.update()`. `phi` is the azimuth in radians,
 * so one full turn is 2π. Driven by elapsed time (not frame count) so the spin
 * looks the same on a 60 Hz and a 120 Hz display, and it pauses while the tab is
 * hidden or the visitor asked for reduced motion.
 */
export function Globe({
    className,
    config = GLOBE_CONFIG,
    rotationSpeed = 0.4, // radians per second
    respectReducedMotion = true,
}) {
    const canvasRef = useRef(null);
    const phiRef = useRef(config.phi ?? 0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return undefined;

        const pixelRatio = config.devicePixelRatio ?? 2;
        const pixelSize = () =>
            Math.max(2, Math.round(canvas.offsetWidth * pixelRatio));

        const state = {
            phi: phiRef.current,
            theta: config.theta ?? 0,
        };

        const globe = createGlobe(canvas, {
            ...config,
            width: pixelSize(),
            height: pixelSize(),
            phi: state.phi,
            theta: state.theta,
        });

        const draw = () =>
            globe.update({ ...state, width: pixelSize(), height: pixelSize() });

        const reducedMotion =
            respectReducedMotion &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        let frame = 0;
        let lastTick = null;

        const tick = (now) => {
            if (lastTick === null) lastTick = now;
            state.phi += ((now - lastTick) / 1000) * rotationSpeed;
            lastTick = now;

            // Wrap instead of letting phi grow: sin/cos of a huge float lose
            // precision and the globe starts to jitter.
            if (state.phi > TWO_PI) state.phi -= TWO_PI;

            // Keep the v1 `onRender` hook working for custom configs.
            config.onRender?.(state);
            phiRef.current = state.phi;

            draw();
            frame = requestAnimationFrame(tick);
        };

        const sync = () => {
            if (reducedMotion || document.hidden) {
                cancelAnimationFrame(frame);
                frame = 0;
                lastTick = null;
                draw();
                return;
            }
            if (!frame) frame = requestAnimationFrame(tick);
        };

        const onVisibilityChange = () => sync();
        document.addEventListener('visibilitychange', onVisibilityChange);

        const observer = new ResizeObserver(draw);
        observer.observe(canvas);

        sync();

        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            document.removeEventListener('visibilitychange', onVisibilityChange);
            globe.destroy();
        };
    }, [config, rotationSpeed, respectReducedMotion]);

    return (
        <div className={cn('relative aspect-square w-full max-w-md', className)}>
            <canvas ref={canvasRef} className="size-full [contain:layout_paint_size]" />
        </div>
    );
}

export default Globe;
