import { Suspense, useCallback, useEffect, useState } from 'react';

import { lazyRetry as lazyLoader } from '@/lib/lazyRetry';
import { cn } from '@/lib/utils';
import { IconExpand, IconShrink } from './icons.jsx';

/**
 * DemoStage — shows the demo dashboard "packed" into a window, with a control
 * that takes it over the whole screen.
 *
 * Packing: the dashboard is laid out at a fixed DESIGN_WIDTH (a real laptop
 * width) and then `transform: scale()`d down to whatever the window is.
 * Because only a transform is applied — not a font-size or a container width —
 * every measurement inside the demo stays identical to the real dashboard, so
 * the demo keeps matching production exactly.
 *
 * This runs on EVERY viewport, phones included. Falling back to the demo's own
 * responsive layout below some width would leave every element at its natural
 * size — the opposite of a preview. On a 390px phone the desktop layout renders
 * at ~0.27 and every part of it shrinks with it.
 *
 * The control lives OUTSIDE the scaled panel, in its own bar. Inside the
 * window it would scale down with everything else and become untappable.
 *
 * Full screen: the same dashboard, unscaled, in a fixed overlay with the rest
 * of the page locked behind it. Narrow screens scroll horizontally rather than
 * re-flowing to a mobile layout.
 */

const DemoDashboard = lazyLoader(() => import('./demo/DemoDashboard.jsx'));

/* The width the demo is laid out at while packed — and the minimum width it
   gets in full screen, so phones get the desktop layout, just scrolled. */
const DESIGN_WIDTH = 1280;

const PACKED_HEIGHT = 'clamp(560px, 76vh, 860px)';

/* Widest the packed window may get; past this it just uses the column. */
const PACKED_WIDTH = 1060;

/* What the full-screen overlay has to fit inside: the control bar, the panel
   and the caption below it, plus their padding. */
const FULL_HEIGHT_CHROME = 168;
const fullHeight = `clamp(560px, calc(100vh - ${FULL_HEIGHT_CHROME}px), 1200px)`;

/* Slack below the packed panel. The panel is scaled to land exactly on the
   wrapper's edge, so anything pinned to that edge — its 1px border and the
   white bloom behind it — gets clipped. A few spare pixels keep both. */
const GLOW_SLACK = 12;

/** Approximates the real panel so the swap causes only a small shift. */
function DemoSkeleton({ height = PACKED_HEIGHT }) {
    return (
        <div
            aria-hidden="true"
            style={{ height }}
            className="overflow-hidden rounded-2xl border border-white/25 bg-card shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_50px_120px_-40px_rgba(255,255,255,0.25),0_24px_60px_-30px_rgba(0,0,0,0.9)]"
        >
            <div className="h-[46px] border-b border-hairline bg-card" />
            <div className="flex items-start">
                <div className="hidden w-60 shrink-0 self-stretch border-r border-hairline lg:block" />
                <div className="flex-1 p-6">
                    <div className="animate-pulse space-y-4">
                        <div className="h-24 rounded-2xl bg-white/[0.04]" />
                        <div className="h-24 rounded-2xl bg-white/[0.04]" />
                        <div className="grid grid-cols-4 gap-4">
                            {[0, 1, 2, 3].map((i) => (
                                <div key={i} className="h-32 rounded-2xl bg-white/[0.04]" />
                            ))}
                        </div>
                        <div className="h-32 rounded-2xl bg-white/[0.04]" />
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * The control bar. Sits above the panel at its own natural size in both modes,
 * so the button is always readable and always a usable hit target.
 */
function Controls({ fullScreen, onToggle }) {
    return (
        <div className="mb-3 flex items-center justify-between gap-3 max-[480px]:mb-2.5">
            <p className="flex min-w-0 items-center gap-2 text-[0.78rem] font-semibold text-ink-secondary">
                <span className="size-2 shrink-0 animate-beat rounded-full bg-white/70" />
                <span className="truncate">
                    {fullScreen ? 'Full view' : 'Preview — scaled to fit'}
                </span>
            </p>

            <button
                type="button"
                onClick={onToggle}
                aria-expanded={fullScreen}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/20 bg-white/[0.06] px-3 py-1.5 text-[0.78rem] font-bold text-foreground transition hover:border-white/60 hover:bg-white/15"
            >
                {fullScreen ? <IconShrink /> : <IconExpand />}
                {fullScreen ? 'Close' : 'Full screen'}
            </button>
        </div>
    );
}

export default function DemoStage() {
    const [fullScreen, setFullScreen] = useState(false);

    /* Owned here, not in the dashboard: the packed window and the full-screen
       copy are two separate mounts, and without this the section the visitor
       picked would reset every time they toggle. */
    const [tab, setTab] = useState('overview');

    const [availW, setAvailW] = useState(0);
    const [naturalH, setNaturalH] = useState(0);
    const [fullAvailW, setFullAvailW] = useState(0);

    /* Measured with callback refs, not `useEffect(…, [])`.
       The window unmounts when full screen opens, and a ResizeObserver still
       reports `0 × 0` for a node that has just left the DOM — that dropped
       `availW` to 0 and the layout never recovered. An effect with empty deps
       never re-attaches after that. A callback ref re-observes on every mount,
       and React 19 runs its cleanup on unmount, so the observer is torn down
       before a stale 0 can land. The `isConnected` guard covers a queued one. */
    const slotRef = useCallback((node) => {
        if (!node) return undefined;
        const ro = new ResizeObserver(([entry]) => {
            if (node.isConnected) setAvailW(entry.contentRect.width);
        });
        ro.observe(node);
        return () => ro.disconnect();
    }, []);

    const packedInnerRef = useCallback((node) => {
        if (!node) return undefined;
        const ro = new ResizeObserver(([entry]) => {
            if (node.isConnected) setNaturalH(entry.contentRect.height);
        });
        ro.observe(node);
        return () => ro.disconnect();
    }, []);

    /* Full screen must be sized from the overlay's own box, never from
       `availW` — that one is the page column (1200px inside a `max-w-*`
       wrapper), so reusing it left the panel 160px short of the viewport with
       black gutters down both sides. */
    const fullSlotRef = useCallback((node) => {
        if (!node) return undefined;
        const ro = new ResizeObserver(([entry]) => {
            if (node.isConnected) setFullAvailW(entry.contentRect.width);
        });
        ro.observe(node);
        return () => ro.disconnect();
    }, []);

    /* ---- full screen behaviour ---- */

    const close = useCallback(() => setFullScreen(false), []);
    const open = useCallback(() => setFullScreen(true), []);

    useEffect(() => {
        if (!fullScreen) return undefined;

        const onKey = (e) => {
            if (e.key === 'Escape') close();
        };
        document.addEventListener('keydown', onKey);

        const { body } = document;
        const prevOverflow = body.style.overflow;
        const prevPad = body.style.paddingRight;
        // Compensate for the disappearing scrollbar so the page doesn't jump.
        const gap = window.innerWidth - document.documentElement.clientWidth;
        body.style.overflow = 'hidden';
        if (gap > 0) body.style.paddingRight = `${gap}px`;

        return () => {
            document.removeEventListener('keydown', onKey);
            body.style.overflow = prevOverflow;
            body.style.paddingRight = prevPad;
        };
    }, [fullScreen, close]);

    const packed = !fullScreen;

    /* Packed: lay out at DESIGN_WIDTH and scale down to the window.
       No minimum scale — clamping it would make the panel wider than the
       window it is supposed to fit inside, and `overflow-hidden` would crop it. */
    const windowW = packed ? Math.min(availW || PACKED_WIDTH, PACKED_WIDTH) : availW;
    const packedLayoutW = DESIGN_WIDTH;
    const scale = packed ? windowW / packedLayoutW : 1;
    const boxH = naturalH ? naturalH * scale + GLOW_SLACK : undefined;

    /* Full screen: fill the overlay's width on anything wide enough, otherwise
       keep the desktop layout and let it scroll sideways — re-flowing to the
       demo's mobile layout would change what the visitor is looking at. */
    const fullLayoutW = Math.max(fullAvailW || availW, DESIGN_WIDTH);

    const dashboard = (panelHeight) => (
        <Suspense fallback={<DemoSkeleton height={panelHeight} />}>
            <DemoDashboard tab={tab} onTabChange={setTab} panelHeight={panelHeight} />
        </Suspense>
    );

    return (
        <>
            {/* Exactly ONE dashboard is mounted at a time. Rendering both would
                leave a second copy running its timers and focusable behind the
                overlay; `tab` is lifted above so the swap costs nothing. */}
            {!fullScreen && (
                <div ref={slotRef} className="w-full">
                    <Controls fullScreen={false} onToggle={open} />

                    <div
                        // `overflow-hidden` is required, not cosmetic: the inner element is laid out
                        // at DESIGN_WIDTH (1280px) and only scaled down visually, so
                        // without clipping it spills 480px sideways.
                        className="relative mx-auto overflow-hidden rounded-2xl transition-[width,height] duration-[450ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
                        style={{ width: windowW, height: boxH }}
                    >
                        <div
                            ref={packedInnerRef}
                            className="absolute top-0 left-0 transition-transform duration-[450ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
                            style={{
                                width: packedLayoutW,
                                transform: `scale(${scale})`,
                                transformOrigin: 'top left',
                            }}
                        >
                            {dashboard(PACKED_HEIGHT)}
                        </div>
                    </div>
                </div>
            )}

            {/* ---- full screen: the demo and nothing else ---- */}
            {fullScreen && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Troxe dashboard demo"
                    className="fixed inset-0 z-[2000] flex flex-col bg-black/97 backdrop-blur-md"
                >
                    <div className="shrink-0 px-4 pt-5 md:px-8">
                        <div className="mx-auto w-full max-w-[1400px]">
                            <Controls fullScreen onToggle={close} />
                        </div>
                    </div>

                    <div
                        ref={fullSlotRef}
                        className="min-h-0 flex-1 overflow-auto px-4 pb-6 md:px-8"
                    >
                        <div className="mx-auto w-fit" style={{ width: fullLayoutW }}>
                            {dashboard(fullHeight)}
                        </div>

                        <p className="mx-auto mt-5 max-w-[720px] text-center text-[0.8rem] leading-relaxed text-ink-muted">
                            Demo environment — sample data running in your browser. Press Esc or
                            click Close to go back to the page.
                        </p>
                    </div>
                </div>
            )}
        </>
    );
}