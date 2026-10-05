/**
 * Country flag for an ISO-3166-1 alpha-2 code.
 *
 * Uses the bundled `flag-icons` SVG sprite (offline, no CDN) — the old
 * flagcdn <img> showed broken images whenever the CDN was blocked or slow.
 * Unknown / private-IP codes fall back to a neutral globe glyph.
 */
export function Flag({ code, name, className = 'w-6' }) {
    const cc = (code ?? '').toLowerCase();
    if (!/^[a-z]{2}$/.test(cc) || cc === 'xx') {
        return (
            <span role="img" aria-label={name || 'Unknown location'} title={name || 'Unknown location'} className={`${className} inline-block text-center text-base leading-none`}>
                🌐
            </span>
        );
    }
    return (
        <span
            title={name || cc.toUpperCase()}
            aria-label={name || cc.toUpperCase()}
            role="img"
            className={`fi fi-${cc} ${className} inline-block overflow-hidden rounded-[3px] leading-none`}
        />
    );
}