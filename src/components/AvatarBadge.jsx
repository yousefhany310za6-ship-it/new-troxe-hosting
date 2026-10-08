import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { apiBase } from '@/lib/api.js';

/**
 * Resolve an avatar URL to something the browser can actually load.
 * Custom uploads are stored as site-relative paths (/api/v1/users/avatars/…),
 * but API calls (and the avatar files themselves) live on the API origin —
 * the site domain has no /api proxy, so a relative <img src> only ever gets
 * the SPA fallback page. Absolute provider (OAuth) URLs pass through.
 */
function resolveAvatarSrc(url) {
    if (!url || !url.startsWith('/')) return url || null;
    try {
        return new URL(url, apiBase()).href;
    } catch {
        return url;
    }
}

/**
 * Circular avatar with initial fallback.
 * Falls back to the first letter when there is no avatar, or when the image
 * fails to load (stale/removed upload, blocked third-party OAuth CDN).
 */
export function AvatarBadge({ url, name, size = 'size-16', text = 'text-xl', className }) {
    const [broken, setBroken] = useState(false);
    const src = resolveAvatarSrc(url);
    useEffect(() => setBroken(false), [src]);
    return (
        <div
            className={cn(
                'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 font-bold text-white',
                size,
                text,
                className,
            )}
        >
            {src && !broken ? (
                <img src={src} alt="" className="size-full object-cover" onError={() => setBroken(true)} />
            ) : (
                ((name || 'U').charAt(0) || 'U').toUpperCase()
            )}
        </div>
    );
}