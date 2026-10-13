import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * GlassSolid — one slowly turning glass icosahedron, drawn on a canvas.
 *
 * Replaces the isometric container rack. Like the old dotted globe this is pure
 * geometry: no d3, no land data, no world-atlas. An icosahedron is 12 vertices
 * and 20 faces, so a full turn is a few dozen flops per frame — nothing like
 * the point-in-polygon pass the globe ran over every landmass on the planet.
 *
 * The "glass" is three passes over the same faces: a dark translucent fill so
 * nearer faces occlude, a lambert-shaded white wash for volume, and a glowing
 * edge stroke. Faces are depth-sorted back-to-front so the solid actually
 * occludes itself while turning — without that, every back edge shines through
 * the front and it reads as a scribble rather than a solid.
 */

/* Icosahedron: 12 vertices on a unit sphere, 20 triangular faces. */
const PHI = (1 + Math.sqrt(5)) / 2;

const VERTS = [
    [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
    [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
    [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
].map((v) => {
    const len = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / len, v[1] / len, v[2] / len];
});

const FACES = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

/* Key light, upper-right and slightly in front. */
const LIGHT = (() => {
    const v = [0.42, 0.68, 0.6];
    const len = Math.hypot(v[0], v[1], v[2]);
    return v.map((n) => n / len);
})();

/** Eye distance. Larger = flatter projection, smaller = more dramatic depth. */
const FOCAL = 2.7;

function rotate([x, y, z], yaw, pitch) {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const x1 = x * cy + z * sy;
    const z1 = -x * sy + z * cy;

    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);

    return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
}

/** Pre-computed unit normals, so each frame is a dot product and not a cross. */
const NORMALS = FACES.map(([a, b, c]) => {
    const [ax, ay, az] = VERTS[a];
    const [bx, by, bz] = VERTS[b];
    const [cx, cy2, cz] = VERTS[c];

    const u = [bx - ax, by - ay, bz - az];
    const v = [cx - ax, cy2 - ay, cz - az];

    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(n[0], n[1], n[2]);

    return [n[0] / len, n[1] / len, n[2] / len];
});

function draw(ctx, w, h, yaw, pitch) {
    const cx = w / 2;
    const cy = h / 2;
    const scale = Math.min(w, h) * 0.38;

    ctx.clearRect(0, 0, w, h);

    /* Rotating once up front turns the per-frame work into 12 rotations
       instead of 20 × 3 (one per face corner). */
    const rv = VERTS.map((v) => rotate(v, yaw, pitch));
    const rn = NORMALS.map((n) => rotate(n, yaw, pitch));

    const project = (p) => {
        const s = FOCAL / (FOCAL - p[2]);
        return [cx + p[0] * scale * s, cy + p[1] * scale * s, p[2]];
    };

    const pts = rv.map(project);

    /* Back to front, so nearer faces cover the ones behind them. */
    const order = FACES.map((f, i) => ({ i, z: (pts[f[0]][2] + pts[f[1]][2] + pts[f[2]][2]) / 3 })).sort(
        (a, b) => a.z - b.z
    );

    ctx.lineJoin = 'round';

    /* Pass 1 — the glass body.
       The page behind the hero is near-black, so a dark fill would make the
       solid vanish and leave only its wireframe. Glass reads as glass when its
       faces sit ABOVE the background in luminance: the more square-on a face is
       to the camera the more light passes through it, and the better it catches
       the key light the brighter it gets. Faces turned away go nearly clear,
       which is what gives the solid its depth. */
    for (const { i } of order) {
        const f = FACES[i];
        const n = rn[i];
        const facing = Math.abs(n[2]);
        const lit = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);

        ctx.beginPath();
        ctx.moveTo(pts[f[0]][0], pts[f[0]][1]);
        ctx.lineTo(pts[f[1]][0], pts[f[1]][1]);
        ctx.lineTo(pts[f[2]][0], pts[f[2]][1]);
        ctx.closePath();

        ctx.fillStyle = `rgba(255,255,255,${0.022 + facing * 0.05 + lit * 0.09 * facing})`;
        ctx.fill();
    }

    /* Pass 2 — edges, with a glow. Two strokes: a fat faint one for the bloom,
       a thin bright one for the actual edge. */
    /* Pass 2 — edges.
       Measured, not assumed: `ctx.shadowBlur` was the single most expensive
       thing on this page. A drop shadow in canvas 2D is a real gaussian blur
       of the path's bounding box, applied once per stroke call — twenty times
       per frame here. Removing it took the hero from 13 fps to 56.

       Three plain strokes at descending width and ascending alpha stack into
       a convincing glow for free: the outer one is the halo, the middle the
       falloff, the inner the edge itself. */
    for (const [width, alphaScale] of [
        [7, 0.05],
        [3, 0.13],
        [1.15, 1],
    ]) {
        ctx.lineWidth = width;

        for (const { i } of order) {
            const f = FACES[i];
            const n = rn[i];
            const facing = Math.abs(n[2]);
            const lit = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);

            /* Edges on faces turned away from us stay very faint, so the solid
               has depth instead of looking like a flat net. */
            const alpha = (0.05 + lit * 0.34 + facing * 0.16) * alphaScale;

            ctx.beginPath();
            ctx.moveTo(pts[f[0]][0], pts[f[0]][1]);
            ctx.lineTo(pts[f[1]][0], pts[f[1]][1]);
            ctx.lineTo(pts[f[2]][0], pts[f[2]][1]);
            ctx.closePath();
            ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
            ctx.stroke();
        }
    }

    /* Pass 3 — vertices catching the light. */
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p[2] < -0.35) continue;

        const lit = Math.max(0, rv[i][0] * LIGHT[0] + rv[i][1] * LIGHT[1] + rv[i][2] * LIGHT[2]);

        ctx.beginPath();
        ctx.arc(p[0], p[1], 1.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${0.1 + lit * 0.55})`;
        ctx.fill();
    }
}

export default function GlassSolid({ className }) {
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        let w = 0;
        let h = 0;

        function resize() {
            const rect = canvas.getBoundingClientRect();
            /* Cap DPR: this fills a ~560px column and a retina 3× buffer there is
               pixels nobody will ever look at. */
            const dpr = Math.min(window.devicePixelRatio || 1, 2);

            w = rect.width;
            h = rect.height;
            canvas.width = Math.max(1, Math.round(w * dpr));
            canvas.height = Math.max(1, Math.round(h * dpr));
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        resize();

        const ro = new ResizeObserver(resize);
        ro.observe(canvas);

        /* Pointer parallax. Eased toward the target every frame so the solid
           drifts after the cursor instead of snapping to it. */
        const target = { yaw: 0, pitch: 0 };
        const eased = { yaw: 0, pitch: 0 };

        function onMove(e) {
            target.yaw = ((e.clientX / window.innerWidth) * 2 - 1) * 0.42;
            target.pitch = -((e.clientY / window.innerHeight) * 2 - 1) * 0.3;
        }

        function onLeave() {
            target.yaw = 0;
            target.pitch = 0;
        }

        if (!reduce) {
            window.addEventListener('pointermove', onMove, { passive: true });
            document.addEventListener('pointerleave', onLeave);
        }

        let spin = 0;
        let raf = 0;
        let visible = true;

        /* This solid turns at 0.24 rad/s — one full revolution takes 26
           seconds. Redrawing it at 60fps buys nothing visible, but it competes
           with the shader behind it for the same frame budget: measured on the
           landing page, holding this to 60fps alongside the shader cost more
           than 4x the whole page's frame rate. 30fps halves that, and a slow
           polyhedron at 30fps is indistinguishable from 60.

           The elapsed time is accumulated rather than taken from the frame
           timestamp, so the rotation speed does not change with the cap. */
        const FRAME_MS = 1000 / 30;
        let last = 0;

        /* A hero element scrolls out of view quickly. The observer keeps a
           spinning canvas from burning frames on a background tab's worth of
           invisible pixels. */
        const io = new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (visible && !raf && !reduce) {
                last = 0;
                raf = requestAnimationFrame(frame);
            }
        });
        io.observe(canvas);

        function frame(now) {
            raf = 0;
            if (!visible || reduce) return;

            raf = requestAnimationFrame(frame);

            if (last && now - last < FRAME_MS) return;
            const delta = last ? now - last : FRAME_MS;
            last = now;

            spin += delta * 0.00024;

            eased.yaw += (target.yaw - eased.yaw) * 0.045;
            eased.pitch += (target.pitch - eased.pitch) * 0.045;

            draw(ctx, w, h, spin + eased.yaw, 0.28 + eased.pitch);
        }

        if (reduce) {
            draw(ctx, w, h, 0.6, 0.28);
        } else {
            raf = requestAnimationFrame(frame);
        }

        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            io.disconnect();
            window.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerleave', onLeave);
        };
    }, []);

    return <canvas ref={canvasRef} aria-hidden="true" className={cn('h-full w-full', className)} />;
}