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
    { Icon: IconDiscordSm, label: 'Discord', hover: 'hover:border-[#5865F2] hover:bg-[#5865F2] hover:text-white' },
    { Icon: IconTelegramSm, label: 'Telegram', hover: 'hover:border-[#0088cc] hover:bg-[#0088cc] hover:text-white' },
    { Icon: IconTwitter, label: 'Twitter' },
    { Icon: IconGithub, label: 'GitHub' },
];

export default function Footer({ className }) {
    return (
        <footer className={cn('border-t border-hairline bg-background pt-16', className)}>
            <div className="container-page">
                <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-12 pb-12 max-lg:grid-cols-2 max-lg:gap-9 max-md:grid-cols-1 max-md:gap-8">
                    <div>
                        <Logo />
                        <p className="mt-4 max-w-[280px] text-[0.92rem] leading-[1.7] text-ink-secondary">
                            The #1 platform for bot and app hosting. Speed, security, and
                            simplicity.
                        </p>
                    </div>

                    {COLUMNS.map((column) => (
                        <div key={column.title}>
                            <h4 className="mb-[18px] text-[0.95rem] font-bold text-foreground">
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
                                                    className="text-[0.9rem] text-ink-secondary transition hover:text-foreground"
                                                >
                                                    {label}
                                                </Link>
                                            ) : (
                                                <a
                                                    href="#"
                                                    className="text-[0.9rem] text-ink-secondary transition hover:text-foreground"
                                                >
                                                    {label}
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
                    <div className="flex items-center gap-3">
                        {SOCIALS.map(({ Icon, label, hover }) => (
                            <a
                                key={label}
                                href="#"
                                aria-label={label}
                                className={cn(
                                    'flex size-9 items-center justify-center rounded-sm border border-hairline bg-veil text-ink-secondary transition hover:-translate-y-0.5 hover:border-primary hover:bg-primary hover:text-primary-foreground',
                                    hover
                                )}
                            >
                                <Icon />
                            </a>
                        ))}
                    </div>
                </div>
            </div>
        </footer>
    );
}
