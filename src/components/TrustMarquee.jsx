import Marquee from './effects/Marquee.jsx';

const ITEMS = [
    'Zero-downtime deploys',
    'Auto-restart on crash',
    'Live CPU & RAM metrics',
    'Built-in file manager',
    'Scheduled backups',
    'DDoS protection',
    'Git & zip deploys',
    'Real-time logs',
    'One-click rollback',
    '24/7 engineer support',
];

/**
 * A thin trust band between the hero and the first content section.
 *
 * Scrolling value props read as movement even when the page is static, and
 * they fill the gap that the old page had between the demo and the runtimes.
 */
export default function TrustMarquee() {
    return (
        <div className="relative border-y border-hairline bg-background py-6">
            {/* Light bleeding in from the top edge ties it to the hero. */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 -top-24 h-24 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.05),transparent)]"
            />

            <Marquee speed={46} pauseOnHover>
                {ITEMS.map((item) => (
                    <span
                        key={item}
                        className="mx-6 flex items-center gap-6 text-[0.85rem] font-semibold tracking-[0.02em] whitespace-nowrap text-ink-muted"
                    >
                        <span className="size-1 rounded-full bg-white/30" />
                        {item}
                    </span>
                ))}
            </Marquee>
        </div>
    );
}