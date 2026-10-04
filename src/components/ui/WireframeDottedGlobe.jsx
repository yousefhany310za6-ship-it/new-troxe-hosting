import { useEffect, useRef, useState } from 'react';
import { geoOrthographic, geoPath, geoGraticule, timer } from 'd3';
import { getLandData } from '@/lib/globeDots.js';

import { cn } from '@/lib/utils';

/**
 * Dotted wireframe globe rendered to a canvas.
 *
 * It rotates the way Earth does: east to west relative to space, carried by a
 * spin about an axis tilted by Earth's real obliquity (23.44 deg). The rotation
 * is driven by elapsed time rather than frame count, so it runs at the same
 * speed on a 60 Hz and a 120 Hz display and stays smooth when frames are
 * dropped.
 *
 * Decorative by default: it draws only, takes no pointer input and never
 * prevents page scrolling, so it is safe to sit behind page content.
 */
export default function WireframeDottedGlobe({
    className = '',
    rotationSpeed = 6,
    tiltDegrees = 23.44,
    dotSpacing = 16,
    oceanFill = 'rgba(0, 0, 0, 0.5)',
    strokeColor = '#ffffff',
    dotColor = '#ffffff',
    dotAlpha = 0.75,
    graticuleAlpha = 0.18,
    landAlpha = 0.85,
    startRotation = [0, -20],
}) {
    const wrapRef = useRef(null);
    const canvasRef = useRef(null);
    // Read once on mount: this is the *initial* rotation, not a live setting.
    const startRotationRef = useRef(startRotation);
    // Land dots are expensive (a full-world point-in-polygon grid, seconds on
    // a phone CPU), so they load AFTER first paint via an idle callback while
    // the sphere + graticule paint immediately. A ref mirror feeds the rAF
    // loop without re-subscribing it.
    const [land, setLand] = useState(null);
    const landRef = useRef(null);

    useEffect(() => {
        let cancelled = false;
        const load = () => {
            if (cancelled) return;
            const data = getLandData(dotSpacing);
            if (cancelled) return;
            landRef.current = data;
            setLand(data);
        };
        if (typeof window.requestIdleCallback === 'function') {
            const id = window.requestIdleCallback(load, { timeout: 1500 });
            return () => {
                cancelled = true;
                window.cancelIdleCallback(id);
            };
        }
        const t = setTimeout(load, 60);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [dotSpacing]);

    useEffect(() => {
        const wrap = wrapRef.current;
        const canvas = canvasRef.current;
        if (!wrap || !canvas) return undefined;

        const context = canvas.getContext('2d');
        if (!context) return undefined;

        // Full devicePixelRatio on a 3x phone quadruples fill cost for pixels
        // nobody can see on a faded backdrop — cap at 2x.
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const startLambda = startRotationRef.current[0];
        const startPhi = startRotationRef.current[1];

        let lambda = startLambda;
        let lastTick = null;
        landRef.current = land;
        let onScreen = true;
        let ticking = null;
        let vw = 0;
        let vh = 0;
        let size = 0;

        const projection = geoOrthographic().clipAngle(90);
        const path = geoPath(projection, context);

        // Spin about the polar axis; the obliquity and viewpoint are fixed, so
        // the tilted axis stays put on screen instead of wobbling.
        const applyRotation = () => projection.rotate([lambda, startPhi, tiltDegrees]);

        const render = () => {
            if (vw === 0 || vh === 0) return;

            context.clearRect(0, 0, vw, vh);

            const cx = vw / 2;
            const cy = vh / 2;
            const r = size / 2;
            const hairline = Math.max(0.5, r / 320);

            // Ocean disc gives the sphere a readable silhouette.
            context.beginPath();
            context.arc(cx, cy, r, 0, Math.PI * 2);
            context.fillStyle = oceanFill;
            context.fill();
            context.strokeStyle = strokeColor;
            context.lineWidth = hairline;
            context.stroke();

            // Graticule needs no land data, so the wireframe sphere shows even
            // before (or without) the continents — never a bare circle.
            context.beginPath();
            path(geoGraticule());
            context.strokeStyle = strokeColor;
            context.lineWidth = hairline * 0.7;
            context.globalAlpha = graticuleAlpha;
            context.stroke();
            context.globalAlpha = 1;

            if (!landRef.current) return;

            // Land outlines.
            context.beginPath();
            for (const feature of landRef.current.land.features) path(feature);
            context.strokeStyle = strokeColor;
            context.lineWidth = hairline;
            context.globalAlpha = landAlpha;
            context.stroke();
            context.globalAlpha = 1;

            // Halftone dots.
            context.fillStyle = dotColor;
            context.globalAlpha = dotAlpha;
            const dotRadius = Math.max(0.5, r / 460);
            const dots = landRef.current.dots;
            for (let i = 0; i < dots.length; i += 2) {
                const projected = projection([dots[i], dots[i + 1]]);
                if (!projected) continue;
                if (projected[0] < 0 || projected[0] > vw) continue;
                if (projected[1] < 0 || projected[1] > vh) continue;

                context.beginPath();
                context.arc(projected[0], projected[1], dotRadius, 0, Math.PI * 2);
                context.fill();
            }
            context.globalAlpha = 1;
        };

        const resize = () => {
            const rect = wrap.getBoundingClientRect();
            vw = Math.max(1, Math.round(rect.width));
            vh = Math.max(1, Math.round(rect.height));
            size = Math.min(vw, vh);

            canvas.width = Math.round(vw * dpr);
            canvas.height = Math.round(vh * dpr);
            context.setTransform(dpr, 0, 0, dpr, 0, 0);

            projection.scale(size / 2.1).translate([vw / 2, vh / 2]);
            // Set the rotation here too, so a non-animating globe (reduced
            // motion, off-screen, or before the first tick) still shows the
            // tilt and the intended starting longitude.
            applyRotation();
            render();
        };

        // `elapsed` is milliseconds since this timer started, so the spin rate
        // is independent of the display's refresh rate.
        const spin = (elapsed) => {
            if (lastTick === null) lastTick = elapsed;
            lambda += ((elapsed - lastTick) / 1000) * rotationSpeed;
            lastTick = elapsed;

            if (lambda > 180) lambda -= 360;
            else if (lambda < -180) lambda += 360;

            applyRotation();
            render();
        };

        // Animate while the globe is on screen and the page is the active one.
        //
        // `prefers-reduced-motion` is deliberately *not* a stop gate: this is a
        // slow ambient spin behind the hero that never tracks scroll, pans,
        // zooms or flashes, so freezing it leaves the sphere looking broken
        // rather than protecting anyone. Motion still stops the moment the
        // section leaves the viewport or the tab is hidden.
        const syncTimer = () => {
            const shouldRun = onScreen && !document.hidden;
            if (shouldRun && !ticking) {
                // A fresh timer restarts `elapsed` at zero, so the delta must
                // restart with it or the first frame would jump.
                lastTick = null;
                ticking = timer(spin);
            } else if (!shouldRun && ticking) {
                ticking.stop();
                ticking = null;
            }
        };

        const observer = new IntersectionObserver(
            ([entry]) => {
                onScreen = entry.isIntersecting;
                syncTimer();
            },
            { threshold: 0 }
        );
        observer.observe(wrap);

        // Without this, a page opened in a background tab would stay frozen
        // for good once the user switches to it.
        const onVisibilityChange = () => syncTimer();
        document.addEventListener('visibilitychange', onVisibilityChange);

        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(wrap);

        resize();
        syncTimer();

        return () => {
            observer.disconnect();
            resizeObserver.disconnect();
            document.removeEventListener('visibilitychange', onVisibilityChange);
            if (ticking) ticking.stop();
        };
    }, [rotationSpeed, tiltDegrees, dotSpacing, oceanFill, strokeColor, dotColor, dotAlpha, graticuleAlpha, landAlpha]);

    return (
        <div ref={wrapRef} className={cn('relative h-full w-full', className)} aria-hidden="true">
            <canvas ref={canvasRef} className="block h-full w-full" />
        </div>
    );
}
