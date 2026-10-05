import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Circular avatar with initial fallback.
 * Falls back to the first letter when there is no avatar, or when the image
 * fails to load (stale/removed upload, blocked third-party OAuth CDN).
 */
export function AvatarBadge({ url, name, size = 'size-16', text = 'text-xl', className }) {
    const [broken, setBroken] = useState(false);
    useEffect(() => setBroken(false), [url]);
    return (
        <div
            className={cn(
                'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 font-bold text-white',
                size,
                text,
                className,
            )}
        >
            {url && !broken ? (
                <img src={url} alt="" className="size-full object-cover" onError={() => setBroken(true)} />
            ) : (
                ((name || 'U').charAt(0) || 'U').toUpperCase()
            )}
        </div>
    );
}