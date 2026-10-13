import { cn } from '@/lib/utils';

/**
 * SectionBackdrop — the repeating depth layer behind a section.
 *
 * Three stacked, non-interactive layers:
 *   1. a fine dot matrix that fades toward the edges,
 *   2. a slow sweeping light bar,
 *   3. film grain, which stops the pure-black background from banding.
 *
 * Everything is `pointer-events-none` and absolutely positioned, so it never
 * affects layout or blocks the UI underneath.
 */
export default function SectionBackdrop({
    className,
    variant = 'dots', // 'dots' | 'grid' | 'none'
    sweep = true,
    grain = true,
    fade = true,
}) {
    return (
        <div aria-hidden="true" className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
            {variant !== 'none' && (
                <div
                    className={cn(
                        'absolute inset-0',
                        variant === 'dots' ? 'dot-grid' : 'grid-pattern'
                    )}
                    style={{
                        WebkitMaskImage: fade
                            ? 'radial-gradient(ellipse 85% 65% at 50% 0%, #000 25%, transparent 78%)'
                            : 'none',
                        maskImage: fade
                            ? 'radial-gradient(ellipse 85% 65% at 50% 0%, #000 25%, transparent 78%)'
                            : 'none',
                    }}
                />
            )}

            {sweep && (
                <div className="absolute inset-x-0 top-0 h-[420px] overflow-hidden">
                    <div className="animate-scan absolute inset-x-0 h-[180px] bg-[linear-gradient(to_bottom,transparent,rgba(255,255,255,0.055)_45%,rgba(255,255,255,0.09)_50%,rgba(255,255,255,0.055)_55%,transparent)]" />
                </div>
            )}

            {grain && <div className="noise-overlay absolute inset-0 opacity-[0.035] mix-blend-overlay" />}
        </div>
    );
}