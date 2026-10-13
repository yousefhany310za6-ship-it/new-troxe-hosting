import { cn } from '@/lib/utils';

/**
 * Aurora — slow drifting light blobs behind a section.
 *
 * Strictly monochrome: the blobs are white with a low alpha over black, so
 * they read as *brightness*, not colour. Each one is transform-only, so the
 * whole thing animates on the compositor and never touches layout.
 */
const BLOBS = [
    { className: 'animate-aurora', style: { top: '-22%', left: '-12%', width: '52vw', height: '52vw', opacity: 0.16 } },
    { className: 'animate-aurora-slow', style: { top: '8%', right: '-18%', width: '46vw', height: '46vw', opacity: 0.11 } },
    { className: 'animate-aurora-reverse', style: { bottom: '-30%', left: '18%', width: '58vw', height: '58vw', opacity: 0.09 } },
];

export default function Aurora({ className, blobs = BLOBS }) {
    return (
        <div
            aria-hidden="true"
            className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
        >
            {blobs.map((blob, i) => (
                <div
                    key={i}
                    className={cn('aurora-blob bg-white', blob.className)}
                    style={blob.style}
                />
            ))}
        </div>
    );
}