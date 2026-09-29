import { useEffect, useRef } from 'react';
import { geoOrthographic, geoPath, geoBounds, geoGraticule, timer } from 'd3';
import { feature } from 'topojson-client';
import land110m from 'world-atlas/land-110m.json';

import { cn } from '@/lib/utils';

// Land polygons bundled locally (55 kB TopoJSON) so the globe paints on the
// very first frame: no network wait, no empty-circle placeholder, and the
// rotation is visible immediately instead of spinning an invisible blank disc.

// Cache the parsed land data so remounts (e.g. StrictMode double-invoke) reuse it.
let landCache = null;

function pointInPolygon([x, y], ring) {
    let inside = false;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];

        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }

    return inside;
}

function pointInFeature([x, y], geometry) {
    if (geometry.type === 'Polygon') {
        const rings = geometry.coordinates;
        if (!pointInPolygon([x, y], rings[0])) return false;

        for (let i = 1; i < rings.length; i++) {
            if (pointInPolygon([x, y], rings[i])) return false;
        }
        return true;
    }

    if (geometry.type === 'MultiPolygon') {
        for (const polygon of geometry.coordinates) {
            if (!pointInPolygon([x, y], polygon[0])) continue;

            let inHole = false;
            for (let i = 1; i < polygon.length; i++) {
                if (pointInPolygon([x, y], polygon[i])) {
                    inHole = true;
                    break;
                }
            }
            if (!inHole) return true;
        }
    }

    return false;
}

function buildDotField(land, dotSpacing = 16) {
    const dots = [];
    const step = dotSpacing * 0.08;

    for (const feature of land.features) {
        const [[minLng, minLat], [maxLng, maxLat]] = geoBounds(feature);

        for (let lng = minLng; lng <= maxLng; lng += step) {
            for (let lat = minLat; lat <= maxLat; lat += step) {
                if (pointInFeature([lng, lat], feature.geometry)) {
                    dots.push(lng, lat);
                }
            }
        }
    }

    return new Float32Array(dots);
}

function getLandData(dotSpacing) {
    if (!landCache || landCache.spacing !== dotSpacing) {
        // `land` is a GeometryCollection, so this yields a FeatureCollection.
        const land = feature(land110m, land110m.objects.land);
        landCache = { land, dots: buildDotField(land, dotSpacing), spacing: dotSpacing };
    }

    return landCache;
}

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

    useEffect(() => {
        const wrap = wrapRef.current;
        const canvas = canvasRef.current;
        if (!wrap || !canvas) return undefined;

        const context = canvas.getContext('2d');
        if (!context) return undefined;

        const dpr = window.devicePixelRatio || 1;
        const startLambda = startRotationRef.current[0];
        const startPhi = startRotationRef.current[1];

        let lambda = startLambda;
        let lastTick = null;
        // Synchronous: bundled with the app, so the first frame already shows land.
        const data = getLandData(dotSpacing);
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

            if (!data) return;

            // Land outlines.
            context.beginPath();
            for (const feature of data.land.features) path(feature);
            context.strokeStyle = strokeColor;
            context.lineWidth = hairline;
            context.globalAlpha = landAlpha;
            context.stroke();
            context.globalAlpha = 1;

            // Halftone dots.
            context.fillStyle = dotColor;
            context.globalAlpha = dotAlpha;
            const dotRadius = Math.max(0.5, r / 460);
            for (let i = 0; i < data.dots.length; i += 2) {
                const projected = projection([data.dots[i], data.dots[i + 1]]);
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
