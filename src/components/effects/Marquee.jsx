import { cn } from '@/lib/utils';

/**
 * Marquee — an infinite horizontal scroller.
 *
 * The children are rendered twice and the track is translated by exactly
 * -50%, which makes the loop seamless for any content width. The second copy
 * is hidden from assistive tech so the list isn't announced twice.
 *
 * `pauseOnHover` freezes the scroll on hover, which is what you want for a
 * strip of links or chips.
 */
export default function Marquee({
    children,
    className,
    speed = 38,
    reverse = false,
    pauseOnHover = false,
    fade = true,
    gap = null,
}) {
    const track = cn(
        'flex w-max',
        reverse ? 'animate-marquee-reverse' : 'animate-marquee',
        pauseOnHover && 'hover:[animation-play-state:paused]'
    );

    // Gap lives on the copies, not the track: a track gap would add trailing
    // space to the end of the loop and leave a seam where copy B starts.
    const copy = cn('flex shrink-0 items-center', gap);

    return (
        <div
            className={cn(
                'relative flex w-full overflow-hidden',
                fade && 'fade-x-mask',
                className
            )}
        >
            {/* Inline `animationDuration` beats the duration baked into the
                `animate-marquee-*` shorthand, so `speed` stays a prop. */}
            <div className={track} style={{ animationDuration: `${speed}s` }}>
                <div className={copy}>{children}</div>
                <div className={copy} aria-hidden="true">
                    {children}
                </div>
            </div>
        </div>
    );
}