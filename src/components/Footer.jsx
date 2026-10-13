import { Link } from 'react-router-dom';

import { cn } from '@/lib/utils';
import { IconDiscordSm, IconTelegramSm, IconTwitter, IconGithub } from './icons.jsx';
import Logo from './Logo.jsx';

const COLUMNS = [
    {
        title: 'Services',
        links: [
            { label: 'Discord Bots', to: '/services' },
            { label: 'Telegram Bots', to: '/services' },
            { label: 'Node.js & Bun', to: '/services' },
            { label: 'Python', to: '/services' },
            { label: 'PHP', to: '/services' },
        ],
    },
    {
        title: 'Company',
        links: [
            { label: 'About Us', to: '/about' },
            { label: 'Pricing', to: '/pricing' },
            { label: 'Features', to: '/features' },
            'Blog',
            'Careers',
            { label: 'Contact Us', to: '/contact' },
        ],
    },
    {
        title: 'Support',
        links: ['Help Center', 'Documentation', { label: 'FAQ', to: '/faq' }, 'System Status'],
    },
];

/* Brand colours are kept on hover only — the resting state stays monochrome */
const SOCIALS = [
    { Icon: IconDiscordSm, label: 'Discord', hover: 'hover:border-white hover:bg-white hover:text-black' },
    { Icon: IconTelegramSm, label: 'Telegram', hover: 'hover:border-white hover:bg-white hover:text-black' },
    { Icon: IconTwitter, label: 'Twitter' },
    { Icon: IconGithub, label: 'GitHub' },
];

export default function Footer({ className }) {
    return (
        <footer className={cn('relative overflow-hidden border-t border-hairline bg-background pt-16', className)}>
            {/* Hairline that breathes along the top edge. */}
            <div
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.35)_30%,rgba(255,255,255,0.35)_70%,transparent)]"
            />

            <div className="container-page relative z-[1]">
                <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-12 pb-12 max-lg:grid-cols-2 max-lg:gap-9 max-md:grid-cols-1 max-md:gap-8">
                    <div>
                        <Logo />
                        <p className="mt-4 max-w-[280px] text-[0.92rem] leading-[1.7] text-ink-secondary">
                            The #1 platform for bot and app hosting. Speed, security, and
                            simplicity.
                        </p>

                        <div className="mt-7 flex items-center gap-3">
                            {SOCIALS.map(({ Icon, label, hover }) => (
                                <a
                                    key={label}
                                    href="#"
                                    aria-label={label}
                                    className={cn(
                                        'flex size-9 items-center justify-center rounded-sm border border-hairline bg-veil text-ink-secondary transition duration-300 hover:-translate-y-0.5 hover:border-white hover:bg-white hover:text-black',
                                        hover
                                    )}
                                >
                                    <Icon />
                                </a>
                            ))}
                        </div>
                    </div>

                    {COLUMNS.map((column) => (
                        <div key={column.title}>
                            <h4 className="mb-[18px] text-[0.78rem] font-bold tracking-[1.4px] text-ink-muted uppercase">
                                {column.title}
                            </h4>
                            <ul className="flex flex-col gap-3">
                                {column.links.map((link) => {
                                    const label = typeof link === 'string' ? link : link.label;
                                    const to = typeof link === 'string' ? null : link.to;
                                    return (
                                        <li key={label}>
                                            {to ? (
                                                <Link
                                                    to={to}
                                                    className="group inline-flex items-center gap-1.5 text-[0.9rem] text-ink-secondary transition hover:text-foreground"
                                                >
                                                    <span className="bg-[linear-gradient(90deg,currentColor,currentColor)] bg-[length:0%_1px] bg-left-bottom bg-no-repeat transition-[background-size] duration-300 group-hover:bg-[length:100%_1px]">
                                                        {label}
                                                    </span>
                                                </Link>
                                            ) : (
                                                <a
                                                    href="#"
                                                    className="group inline-flex items-center gap-1.5 text-[0.9rem] text-ink-secondary transition hover:text-foreground"
                                                >
                                                    <span className="bg-[linear-gradient(90deg,currentColor,currentColor)] bg-[length:0%_1px] bg-left-bottom bg-no-repeat transition-[background-size] duration-300 group-hover:bg-[length:100%_1px]">
                                                        {label}
                                                    </span>
                                                </a>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline py-6 max-md:flex-col max-md:text-center">
                    <p className="text-[0.85rem] text-ink-muted">
                        &copy; 2026 Troxe Hosting. All rights reserved.{' '}
                        <Link to="/terms" className="transition hover:text-foreground">
                            Terms
                        </Link>{' '}
                        &middot;{' '}
                        <Link to="/privacy" className="transition hover:text-foreground">
                            Privacy
                        </Link>
                    </p>
                    <p className="font-mono text-[0.75rem] text-ink-muted">
                        <span className="mr-2 inline-block size-1.5 animate-beat rounded-full bg-white/60 align-middle" />
                        All systems operational
                    </p>
                </div>
            </div>

            {/* Oversized wordmark that fades out — anchors the page visually. */}
            <div
                aria-hidden="true"
                className="pointer-events-none relative -mt-2 flex select-none justify-center overflow-hidden"
            >
                <span className="translate-y-[26%] bg-[linear-gradient(to_bottom,rgba(255,255,255,0.11),transparent_78%)] bg-clip-text text-[clamp(4rem,17vw,15rem)] leading-none font-black tracking-[-0.05em] text-transparent select-none">
                    TROXE
                </span>
            </div>
        </footer>
    );
}