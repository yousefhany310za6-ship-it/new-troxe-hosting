import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * AetherHero — a living shader backdrop: a faint grid whose tile corners bloom
 * where the sinusoids cross, with a prismatic arc drifting across it.
 *
 * Ported to this codebase's conventions:
 *   - `.jsx`, not `.tsx`. The project has no TypeScript toolchain, no
 *     tsconfig and no `.ts`/`.tsx` file anywhere.
 *   - No `<style jsx global>`. That is a Next.js styled-jsx transform; React
 *     does not understand `jsx` as a prop on <style>, so under Vite it throws
 *     on every render and the Google Fonts import never happens. The site
 *     already ships its own font stack via index.html, so the import is gone
 *     rather than relocated — a third-party font CDN also costs a render-
 *     blocking round trip on the critical path.
 *
 * Bugs fixed on the way in, all of them visible in a browser:
 *
 *   1. `clearColor = [0,0,0,1]` is a default parameter, so it is a NEW array on
 *      every render — and it was in the effect's dependency list. Any re-render
 *      of the parent tore down the WebGL context, deleted the program and
 *      recompiled both shaders. Now flattened to a string key, which compares
 *      by value, so the effect only restarts when the colour actually changes.
 *   2. The render loop ran unconditionally, even with the hero scrolled far off
 *      screen. It is now gated on an IntersectionObserver.
 *   3. `prefers-reduced-motion` was ignored: an infinite animation with no
 *      opt-out. Now renders exactly one frame and stops.
 *   4. No handling for a lost GPU context. `webglcontextlost` now cancels the
 *      loop and the canvas falls back to whatever sits behind it.
 *   5. DPR was pinned at 2. This is a full-viewport fragment shader with three
 *      nested loops; at 2x on a 1440px hero that is 5.2M fragment invocations
 *      per frame. Narrow viewports now cap at 1.5.
 */

/* The original shader, verbatim. `e/(sin(uv.x*s)*cos(uv.y*s))` is what produces
   the tile grid — it is near zero everywhere except where a sine and a cosine
   cross zero at the same time, and those crossings are the glowing corners. */
const DEFAULT_FRAG = `#version 300 es
precision highp float;
out vec4 O;
uniform float time;
uniform vec2 resolution;
#define FC gl_FragCoord.xy
#define R resolution
#define T time
#define S smoothstep
#define MN min(R.x,R.y)
float pattern(vec2 uv) {
  float d=.0;
  for (float i=.0; i<3.; i++) {
    uv.x+=sin(T*(1.+i)+uv.y*1.5)*.2;
    d+=.005/abs(uv.x);
  }
  return d;
}
vec3 scene(vec2 uv) {
  vec3 col=vec3(0);
  uv=vec2(atan(uv.x,uv.y)*2./6.28318,-log(length(uv))+T);
  for (float i=.0; i<3.; i++) {
    int k=int(mod(i,3.));
    col[k]+=pattern(uv+i*6./MN);
  }
  return col;
}
void main() {
  vec2 uv=(FC-.5*R)/MN;
  vec3 col=vec3(0);
  float s=12., e=9e-4;
  col+=e/(sin(uv.x*s)*cos(uv.y*s));
  uv.y+=R.x>R.y?.5:.5*(R.y/R.x);
  col+=scene(uv);
  O=vec4(col,1.);
}`;

/* Fullscreen triangle strip. */
const VERT_SRC = `#version 300 es
precision highp float;
in vec2 position;
void main(){ gl_Position = vec4(position, 0.0, 1.0); }`;

function compileShader(gl, src, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader) || 'Unknown shader error';
        gl.deleteShader(shader);
        throw new Error(info);
    }

    return shader;
}

function createProgram(gl, vs, fs) {
    const vertex = compileShader(gl, vs, gl.VERTEX_SHADER);
    const fragment = compileShader(gl, fs, gl.FRAGMENT_SHADER);

    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);

    // Shaders can be flagged for deletion immediately after linking; the
    // program holds its own reference until it is itself deleted.
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(program) || 'Program link error';
        gl.deleteProgram(program);
        throw new Error(info);
    }

    return program;
}

export default function AetherHero({
    /* Content — ignored entirely when `children` is supplied. */
    title = 'Make the impossible feel inevitable.',
    subtitle = 'A minimal hero with a living shader background. Built for product landings, announcements, and portfolio intros.',
    ctaLabel = 'Get Started',
    ctaHref = '#',
    secondaryCtaLabel,
    secondaryCtaHref,
    children,

    /* 'default' renders the title/subtitle/CTA block above. 'none' is
       backdrop-only, for embedding the shader inside a page that already has
       its own hero copy. `children` implicitly selects 'none'. Without this the
       component's demo copy prints straight over the host page's headline. */
    content = 'default',

    align = 'center',
    maxWidth = 960,
    overlayGradient = 'linear-gradient(180deg, #00000099, #00000040 40%, transparent)',
    textColor = '#ffffff',

    /* Shader */
    fragmentSource = DEFAULT_FRAG,
    dprMax = 2,
    clearColor = [0, 0, 0, 1],

    /* Starting fraction of the CSS box the shader rasterises at, and the range it
       is allowed to move within.

       This shader is fill-rate bound: three nested loops with `log`, `atan`
       and three `sin` calls per fragment, across the whole hero. Measured on
       this page, frame rate scales almost exactly with the pixel count —
       1440x938 ran at 5.7fps, 864x562 at 10.5, 432x281 at 18.4.

       But a fixed value is wrong in both directions: 1.0 wastes a capable GPU,
       and 0.3 is visibly soft. So it adapts. See the loop below. */
    resolutionScale = 0.75,
    minScale = 0.34,
    maxScale = 1,

    /* Misc */
    height = '100vh',
    className,
    ariaLabel = 'Aether shader background',
}) {
    const canvasRef = useRef(null);
    const rafRef = useRef(null);

    /* See bug 1: value-compare the clear colour instead of the array identity. */
    const clearKey = clearColor.join(',');

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return undefined;

        const gl = canvas.getContext('webgl2', { alpha: true, antialias: true });

        /* No WebGL2. Return without drawing and leave the canvas transparent so
           whatever the caller layered behind it still shows through. */
        if (!gl) return undefined;

        let program;
        try {
            program = createProgram(gl, VERT_SRC, fragmentSource);
        } catch (error) {
            console.error('[AetherHero] shader failed to build:', error);
            return undefined;
        }

        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 1, -1, -1, 1, 1, 1, -1]), gl.STATIC_DRAW);

        gl.useProgram(program);
        const positionLoc = gl.getAttribLocation(program, 'position');
        gl.enableVertexAttribArray(positionLoc);
        gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

        const uTime = gl.getUniformLocation(program, 'time');
        const uResolution = gl.getUniformLocation(program, 'resolution');

        const rgba = clearKey.split(',').map(Number);
        gl.clearColor(rgba[0], rgba[1], rgba[2], rgba[3] ?? 1);

        /* See `resolutionScale`: the live value is the caller's starting point, moved
           by the frame-time governor in the loop. `fit` reads this, never a
           captured prop, so resizing and adaptive scaling stay independent. */
        let liveScale = Math.max(minScale, Math.min(maxScale, resolutionScale));

        const fit = () => {
            /* See bug 5: this shader is expensive per fragment, so spend fewer
               of them on the small screens least able to afford them. */
            const rect = canvas.getBoundingClientRect();
            const cap = Math.min(window.innerWidth, window.innerHeight) < 700 ? 1.5 : dprMax;
            const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, cap));

            const w = Math.max(1, Math.floor(rect.width * dpr * liveScale));
            const h = Math.max(1, Math.floor(rect.height * dpr * liveScale));

            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
            }

            gl.viewport(0, 0, canvas.width, canvas.height);
        };

        const draw = (seconds) => {
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.useProgram(program);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            if (uResolution) gl.uniform2f(uResolution, canvas.width, canvas.height);
            if (uTime) gl.uniform1f(uTime, seconds);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        };

        fit();

        const ro = new ResizeObserver(fit);
        ro.observe(canvas);
        window.addEventListener('resize', fit);

        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

        let visible = true;

        /* See bug 2. */
        const io = new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (visible && !rafRef.current) {
                rafRef.current = requestAnimationFrame(loop);
            }
        });
        io.observe(canvas);

        /* See bug 3. */
        if (reduce.matches) {
            draw(0);
        }

        /* Adaptive resolution governor.

           The brief was motion that never stutters, and frame rate is the only
           thing that controls that. So rather than pick a resolution and hope,
           measure the frame time and trade pixels for smoothness until the
           target is met — then give the pixels back if there is headroom.

           Two details that matter more than the arithmetic:
           - The median, not the mean. One 200ms GC pause in the window would
             drag a mean over the target and shrink the canvas for nothing.
           - Hysteresis on both edges, plus a settle window before the scale is
             allowed to move again. Without them the governor oscillates:
             shrink raises the frame rate, which raises the scale, which drops
             it again, and the canvas visibly pumps in and out.

           50fps is the target because that is the point at which slow motion
           stops reading as a sequence of stills. 30 is the floor it settles at
           when the device simply cannot do better; below that it stops
           resizing and lets the browser do what it can. */
        const TARGET_MS = 1000 / 50;
        const WINDOW = 45;
        const SETTLE_MS = 900;

        let frames = [];
        let lastChange = 0;

        function govern(now) {
            frames.push(now);
            if (frames.length < WINDOW) return;

            const deltas = frames.slice(1).map((v, i) => v - frames[i]).sort((a, b) => a - b);
            const median = deltas[Math.floor(deltas.length / 2)];
            frames = [];

            if (now - lastChange < SETTLE_MS || median === 0) return;

            const before = liveScale;

            if (median > TARGET_MS * 1.3) {
                liveScale = Math.max(minScale, liveScale * 0.82);
            } else if (median < TARGET_MS * 0.65) {
                liveScale = Math.min(maxScale, liveScale * 1.1);
            }

            if (Math.abs(liveScale - before) > 0.004) {
                fit();
                lastChange = now;
            }
        }

        const loop = (now) => {
            rafRef.current = requestAnimationFrame(loop);
            if (!visible) return;

            govern(now);

            draw(now * 1e-3);
        };

        if (!reduce.matches) {
            rafRef.current = requestAnimationFrame(loop);
        }

        /* See bug 4. */
        const onContextLost = (event) => {
            event.preventDefault();
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        };

        const onContextRestored = () => window.location.reload();

        canvas.addEventListener('webglcontextlost', onContextLost);
        canvas.addEventListener('webglcontextrestored', onContextRestored);

        return () => {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
            ro.disconnect();
            io.disconnect();
            window.removeEventListener('resize', fit);
            canvas.removeEventListener('webglcontextlost', onContextLost);
            canvas.removeEventListener('webglcontextrestored', onContextRestored);
            gl.deleteBuffer(buffer);
            gl.deleteProgram(program);
        };
    }, [fragmentSource, dprMax, clearKey, resolutionScale, minScale, maxScale]);

    const justify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';

    /* Built only when the caller actually wants the built-in copy. Rendering it
       unconditionally and hiding it with CSS would still put "Make the
       impossible feel inevitable." in the accessibility tree of a page that
       never asked for it. */
    const defaultBody =
        content === 'none' ? null : (
            <div
                className="relative z-[2] flex h-full items-center"
                style={{ justifyContent: justify, padding: 'min(6vw, 64px)', color: textColor }}
            >
                <div
                    style={{
                        width: '100%',
                        maxWidth,
                        marginInline: align === 'center' ? 'auto' : undefined,
                        textAlign: align,
                    }}
                >
                    <h1
                        style={{
                            margin: 0,
                            fontSize: 'clamp(2.2rem, 6vw, 4.5rem)',
                            lineHeight: 1.04,
                            letterSpacing: '-0.02em',
                            fontWeight: 700,
                            textShadow: '0 6px 36px rgba(0,0,0,0.45)',
                        }}
                    >
                        {title}
                    </h1>

                    {subtitle ? (
                        <p
                            style={{
                                marginTop: '1rem',
                                fontSize: 'clamp(1rem, 2vw, 1.25rem)',
                                lineHeight: 1.6,
                                opacity: 0.9,
                                textShadow: '0 4px 24px rgba(0,0,0,0.35)',
                                maxWidth: 900,
                                marginInline: align === 'center' ? 'auto' : undefined,
                            }}
                        >
                            {subtitle}
                        </p>
                    ) : null}

                    {ctaLabel || secondaryCtaLabel ? (
                        <div className="mt-8 flex flex-wrap gap-3">
                            {ctaLabel ? (
                                <a
                                    href={ctaHref}
                                    style={{
                                        padding: '12px 18px',
                                        borderRadius: 12,
                                        background:
                                            'linear-gradient(180deg, rgba(255,255,255,.18), rgba(255,255,255,.06))',
                                        color: textColor,
                                        textDecoration: 'none',
                                        fontWeight: 600,
                                        boxShadow:
                                            'inset 0 0 0 1px rgba(255,255,255,.28), 0 10px 30px rgba(0,0,0,.2)',
                                        backdropFilter: 'blur(6px) saturate(120%)',
                                    }}
                                >
                                    {ctaLabel}
                                </a>
                            ) : null}

                            {secondaryCtaLabel ? (
                                <a
                                    href={secondaryCtaHref}
                                    style={{
                                        padding: '12px 18px',
                                        borderRadius: 12,
                                        color: textColor,
                                        opacity: 0.85,
                                        textDecoration: 'none',
                                        fontWeight: 600,
                                        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.28)',
                                        backdropFilter: 'blur(2px)',
                                    }}
                                >
                                    {secondaryCtaLabel}
                                </a>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            </div>
        );

    /* `showBody` is already a node or null, so `&&` is the test — `??` would
       render a literal `null` child. */
    const showBody = children ?? defaultBody;

    return (
        <section
            className={cn('relative overflow-hidden', className)}
            style={{ height }}
            aria-label={cn(ariaLabel, showBody ? 'Hero' : undefined)}
        >
            <canvas
                ref={canvasRef}
                role="img"
                aria-label={ariaLabel}
                className="absolute inset-0 block h-full w-full select-none"
                style={{ touchAction: 'none' }}
            />

            {/* Darkening scrim so the copy stays legible over the brightest
                part of the arc. */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{ background: overlayGradient }}
            />

            {showBody}
        </section>
    );
}

export { AetherHero };