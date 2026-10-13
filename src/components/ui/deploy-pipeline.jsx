import { useEffect, useId, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * DeployPipeline — a live diagram of what happens after `git push`.
 *
 * Adapted from a third-party "AI agent pipeline" panel. Two substantive changes:
 *
 * 1. Content. The original described an LLM doing semantic search and updating
 *    a CRM. This is a hosting product, so the same pipeline shape now carries
 *    the flow a visitor can actually verify against the product: push → build
 *    → container → the three things a container emits (logs, backups, metrics).
 *
 * 2. No framer-motion. The original imported it for four animations that are
 *    all expressible as CSS keyframes: an opacity pulse, a fade, a scale pop and
 *    a keyed message swap. Importing framer-motion here would have pulled ~40kB
 *    into the landing bundle for zero visual gain — and the hero was just
 *    profiled down from 3fps, so JS writing SVG attributes every frame was the
 *    last thing wanted. The travelling dots are SVG `animateMotion`, which is
 *    SMIL, not JavaScript.
 *
 * Fixed on the way in:
 *   - The SVG arrow marker had a hardcoded `id`. Duplicate ids in a document
 *     make every `url(#...)` bind to whichever copy the parser saw first, so it
 *     is generated now.
 *   - The two `setInterval`s ran forever, including while the panel was scrolled
 *     out of view. Both are now gated on an IntersectionObserver.
 *   - The panel was a fixed `w-[620px]`, which overflows any viewport under
 *     620px. The SVG scales with the container instead.
 */

/* The log tail. Reads as a real deploy stream rather than marketing copy. */
const LOG_LINES = [
    'Cloning repository · main@7f3c2a1 · 412 packages resolved',
    'Installing dependencies · node:20-alpine · 3.2s',
    'Build finished in 4.8s · bundle 284 kB',
    'Container troxe/discord-relay starting · 512 MB limit',
    'Health check passed in 612 ms · 0 retries',
    'Traffic swapped to new container · 0 dropped connections',
    'Deploy complete in 9.4s · live at bot.troxe.dev',
    'Idle. Watching main for the next push.',
];

const STATS = [
    { label: 'DEPLOYS', value: '18,412', live: true },
    { label: 'P95 COLD START', value: '4.8s' },
    { label: 'AVG BUILD', value: '6.2s' },
];

/* A dot riding a path. `animateMotion` is SMIL, so this costs no JS per frame. */
function Packet({ path, duration, delay, size, opacity }) {
    return (
        <circle r={size} fill="#0052FF" opacity={opacity}>
            <animateMotion dur={`${duration}s`} repeatCount="indefinite" begin={`${delay}s`} path={path} />
        </circle>
    );
}

const PATHS = {
    p1: 'M116,88 L158,88',
    p2: 'M268,88 L306,88',
    p3: 'M411,88 C425,88 435,50 448,50',
    p4: 'M411,88 L448,88',
    p5: 'M411,88 C425,88 435,126 448,126',
};

const PACKETS = [
    { path: PATHS.p1, duration: 1.05, delay: 0, size: 2.5, opacity: 1 },
    { path: PATHS.p1, duration: 1.05, delay: 0.35, size: 1.8, opacity: 0.65 },
    { path: PATHS.p1, duration: 1.05, delay: 0.7, size: 1.3, opacity: 0.35 },
    { path: PATHS.p2, duration: 0.88, delay: 0.18, size: 2.5, opacity: 1 },
    { path: PATHS.p2, duration: 0.88, delay: 0.62, size: 1.8, opacity: 0.65 },
    { path: PATHS.p3, duration: 1.3, delay: 0.08, size: 2.2, opacity: 0.9 },
    { path: PATHS.p3, duration: 1.3, delay: 0.65, size: 1.5, opacity: 0.55 },
    { path: PATHS.p4, duration: 1.15, delay: 0.28, size: 2.2, opacity: 0.9 },
    { path: PATHS.p4, duration: 1.15, delay: 0.85, size: 1.5, opacity: 0.55 },
    { path: PATHS.p5, duration: 1.4, delay: 0.45, size: 2.2, opacity: 0.9 },
    { path: PATHS.p5, duration: 1.4, delay: 1.0, size: 1.5, opacity: 0.55 },
];

/* `x`/`y`/`w`/`h` must arrive as numbers. JSX turns `x="16"` into the string
   "16", and then `x + w / 2` is string concatenation, not addition: the rect
   still lands correctly because it passes the string straight through, but
   every `<text>` positioned off it renders at x="1650" and never paints. The
   type of the prop is the whole bug, so the arithmetic is done once here
   instead of being re-derived at each call site. */
function Node({ x, y, w, h, kicker, title, meta, accent }) {
    const cx = Number(x) + Number(w) / 2;
    return (
        <>
            <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx="8"
                fill={accent ? '#050D1C' : '#141414'}
                stroke={accent ? '#0052FF' : 'rgba(255,255,255,0.09)'}
                strokeWidth={accent ? 1 : 0.5}
            />
            {accent && <rect x={Number(x) + 12} y={Number(y) + 0.5} width={Number(w) - 24} height="1" rx="0.5" fill="rgba(51,117,255,0.5)" />}
            <text
                x={cx}
                y={Number(y) + 17}
                textAnchor="middle"
                fontSize="9.5"
                fill={accent ? 'rgba(51,117,255,0.65)' : 'rgba(255,255,255,0.28)'}
                fontFamily="system-ui"
                letterSpacing=".07em"
            >
                {kicker}
            </text>
            <text
                x={cx}
                y={Number(y) + 34}
                textAnchor="middle"
                fontSize={accent ? 13 : 12}
                fill={accent ? '#fff' : 'rgba(255,255,255,0.82)'}
                fontFamily="system-ui"
                fontWeight={accent ? 500 : undefined}
            >
                {title}
            </text>
            <text
                x={cx}
                y={Number(y) + 56}
                textAnchor="middle"
                fontSize="8.5"
                fill={accent ? 'rgba(0,82,255,0.4)' : 'rgba(255,255,255,0.18)'}
                fontFamily="monospace"
            >
                {meta}
            </text>
        </>
    );
}

function Output({ y, label, color, pulsing, duration, delay }) {
    return (
        <>
            <rect x="448" y={y} width="116" height="30" rx="7" fill="#111" stroke="rgba(255,255,255,0.07)" strokeWidth="0.5" />
            <text x="490" y={Number(y) + 18.5} textAnchor="middle" fontSize="11" fill="rgba(255,255,255,0.62)" fontFamily="system-ui">
                {label}
            </text>
            {pulsing ? (
                /* `animate-pulse-node` already exists in the landing keyframes and
                   animates opacity plus a shadow — a pulsing dot for free. */
                <circle cx="550" cy={Number(y) + 8} r="3" fill={color} className="animate-pulse-node" style={{ animationDuration: `${duration}s`, animationDelay: `${delay}s` }} />
            ) : (
                <circle cx="550" cy={Number(y) + 8} r="3" fill={color} opacity="0.95" />
            )}
        </>
    );
}

export default function DeployPipeline({ className }) {
    const [line, setLine] = useState(0);
    const [deploys, setDeploys] = useState(18412);
    const [active, setActive] = useState(false);
    const hostRef = useRef(null);

    /* See the header: generated, because a fixed id duplicates when the panel
       is ever rendered more than once. */
    const arrowId = useId();

    useEffect(() => {
        const el = hostRef.current;
        if (!el) return undefined;

        const io = new IntersectionObserver(([entry]) => setActive(entry.isIntersecting), { threshold: 0.15 });
        io.observe(el);

        return () => io.disconnect();
    }, []);

    useEffect(() => {
        if (!active) return undefined;

        const logTimer = setInterval(() => setLine((i) => (i + 1) % LOG_LINES.length), 2700);
        const countTimer = setInterval(() => setDeploys((n) => n + 1), 7200);

        return () => {
            clearInterval(logTimer);
            clearInterval(countTimer);
        };
    }, [active]);

    /* `key` restarts the CSS animation on the new line, which is what the
       original got from AnimatePresence's exit/enter pair. */
    const messageKey = useId();

    return (
        <div
            ref={hostRef}
            className={cn(
                'overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#090909] font-sans',
                className
            )}
        >
            <div className="flex items-center justify-between border-b border-white/[0.06] px-[18px] py-[11px]">
                <div className="flex items-center gap-[7px]">
                    <span className="animate-beat inline-block size-[6px] rounded-full bg-green-500" />
                    <span className="font-mono text-[10px] tracking-[0.1em] text-white/30">DEPLOY PIPELINE · LIVE</span>
                </div>
                <span className="font-mono text-[10px] text-white/[0.18]">3 outputs · 0 errors</span>
            </div>

            <svg viewBox="0 0 580 172" className="block w-full" role="img" aria-label="Diagram of a deploy: push, build, container, then logs, backups and metrics">
                <defs>
                    <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                        <path
                            d="M2 1.5L7.5 5L2 8.5"
                            fill="none"
                            stroke="rgba(0,82,255,0.45)"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </marker>
                </defs>

                {[PATHS.p1, PATHS.p2].map((d) => (
                    <path
                        key={d}
                        d={d}
                        fill="none"
                        stroke="rgba(0,82,255,0.22)"
                        strokeWidth="1.5"
                        strokeDasharray="3 5"
                        markerEnd={`url(#${arrowId})`}
                    />
                ))}
                {[PATHS.p3, PATHS.p4, PATHS.p5].map((d) => (
                    <path key={d} d={d} fill="none" stroke="rgba(0,82,255,0.15)" strokeWidth="1.5" strokeDasharray="3 5" />
                ))}

                {PACKETS.map((p, i) => (
                    <Packet key={i} {...p} />
                ))}

                <Node x={16} y={66} w={100} h={44} kicker="TRIGGER" title="git push" meta="main" />
                <Node x={158} y={66} w={110} h={44} kicker="BUILD" title="npm ci · build" meta="node:20-alpine" />
                <Node x={306} y={53} w={105} h={70} kicker="CONTAINER" title="Running" meta="troxe/bot" accent />

                <Output y={35} label="Log stream" color="#22c55e" />
                <Output y={73} label="Backups" color="#f59e0b" pulsing duration={1.9} />
                <Output y={111} label="Metrics" color="#f59e0b" pulsing duration={2.2} delay={0.35} />
            </svg>

            <div className="h-[52px] border-t border-white/[0.06] px-[18px] py-[9px]">
                <div className="flex h-full items-start gap-2">
                    <span className="shrink-0 font-mono text-[13px] leading-[1.5] text-[#0052FF]/55">›</span>
                    <div className="relative h-full flex-1 overflow-hidden">
                        <p
                            key={`${messageKey}-${line}`}
                            className="absolute inset-0 animate-rise font-mono text-[11px] leading-[1.55] text-white/[0.42]"
                        >
                            {LOG_LINES[line]}
                        </p>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-[14px] border-t border-white/[0.06] px-[18px] py-[10px] sm:gap-[22px]">
                {STATS.map((s) => (
                    <div key={s.label} className="min-w-0">
                        <div className="mb-[3px] text-[9px] tracking-[0.09em] whitespace-nowrap text-white/20 max-[360px]:text-[8px]">
                            {s.label}
                        </div>
                        {/* `animate-glow-pulse` gives the tick a highlight without
                            a JS-driven scale like the original's motion.div. */}
                        <div className={cn('font-mono text-[16px] whitespace-nowrap text-white/[0.72]', s.live && 'animate-glow-pulse rounded px-1')}>
                            {s.live ? deploys.toLocaleString() : s.value}
                        </div>
                    </div>
                ))}
                {/* Dropped on the narrowest phones: four columns plus this one
                    overflow the panel and the last label wraps to two lines. */}
                <div className="ml-auto hidden text-right min-[380px]:block">
                    <div className="mb-[3px] text-[9px] tracking-[0.09em] whitespace-nowrap text-white/[0.18]">RUNTIME</div>
                    <div className="font-mono text-[10px] whitespace-nowrap text-[#0052FF]/55">Docker · K8s</div>
                </div>
            </div>
        </div>
    );
}