import { Link } from 'react-router-dom';

import { cn } from '@/lib/utils';
import { IconDiscordSm, IconTelegramSm, IconTwitter, IconGithub } from './icons.jsx';
import Logo from './Logo.jsx';
import { FOOTER_LINKS } from '@/data/landing.js';

const COLUMNS = [
    { title: 'Product', links: FOOTER_LINKS.product },
    { title: 'Company', links: FOOTER_LINKS.company },
    { title: 'Account', links: FOOTER_LINKS.account },
    { title: 'Legal', links: FOOTER_LINKS.legal },
];

/* Brand colours are kept on hover only — the resting state stays monochrome */
const SOCIALS = [
    { Icon: IconDiscordSm, label: 'Discord', hover: 'hover:border-[#5865F2] hover:bg-[#5865F2] hover:text-white' },
    { Icon: IconTelegramSm, label: 'Telegram', hover: 'hover:border-[#0088cc] hover:bg-[#0088cc] hover:text-white' },
    { Icon: IconTwitter, label: 'Twitter' },
    { Icon: IconGithub, label: 'GitHub' },
];

/**
 * Every link here points at a route that exists in App.jsx. The support column
 * links to the in-dashboard ticket system for signed-in users (the dashboard
 * route) and to the public FAQ/contact pages for everyone else.
 */
export default function Footer({ className }) {
    return (
        <footer className={cn('border-t border-hairline bg-[color:var(--surface-0)] pt-16', className)}>
            <div className="container-page">
                <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-12 pb-12 max-lg:grid-cols-2 max-lg:gap-9 max-md:grid-cols-1 max-md:gap-8">
                    <div>
                        <Logo />
                        <p className="mt-4 max-w-[280px] text-[0.92rem] leading-[1.7] text-ink-secondary">
                            Bot and app hosting with its own container per project, live metrics, console, logs, files and
                            backups — managed from one dashboard.
                        </p>
                    </div>

                    {COLUMNS.map((column) => (
                        <div key={column.title}>
                            <h4 className="mb-[18px] text-[0.95rem] font-bold text-foreground">
                                {column.title}
                            </h4>
                            <ul className="flex flex-col gap-3">
                                {column.links.map((link) => (
                                    <li key={link.label}>
                                        <Link
                                            to={link.to}
                                            className="text-[0.9rem] text-ink-secondary transition hover:text-foreground"
                                        >
                                            {link.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-5 border-t border-hairline py-7">
                    <p className="text-[0.84rem] text-ink-muted">
                        © {new Date().getFullYear()} Troxe Hosting. All rights reserved.
                    </p>
                    <div className="flex items-center gap-2.5">
                        {SOCIALS.map(({ Icon, label, hover }) => (
                            <a
                                key={label}
                                href="#"
                                aria-label={label}
                                onClick={(e) => e.preventDefault()}
                                className={cn(
                                    'flex size-9 items-center justify-center rounded-md border border-hairline text-ink-secondary transition',
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
