import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { requestSectionScroll } from '@/lib/scrollRequest';
import { useScrolled } from '../hooks/useSiteEffects.js';
import { Button } from './ui/button.jsx';
import Logo from './Logo.jsx';

/* Only ids that exist on the landing page (landing components). */
const LINKS = [
    { href: '#capabilities', label: 'Features' },
    { href: '#runtimes', label: 'Runtimes' },
    { href: '#pricing', label: 'Pricing' },
    { href: '#faq', label: 'FAQ' },
];

const LINK_CLASS =
    'relative text-[0.95rem] font-semibold text-ink-secondary transition after:absolute after:-bottom-1 after:left-0 after:h-0.5 after:w-0 after:bg-[color:var(--lime)] after:content-[""] after:transition-all hover:text-foreground hover:after:w-full';

export default function Navbar() {
    const scrolled = useScrolled(50);
    const [open, setOpen] = useState(false);
    // Off the landing page the sections don't exist yet, so the links go home
    // first and hand the section id over to the landing page.
    const onHome = useLocation().pathname === '/';

    return (
        <nav
            id="navbar"
            className={cn(
                'fixed inset-x-0 top-0 z-[1000] py-4 transition',
                scrolled && 'border-b border-hairline bg-black/85 py-3 backdrop-blur-xl'
            )}
        >
            <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-6 px-6">
                <Logo />

                <ul
                    className={cn(
                        'hidden items-center gap-8 md:flex',
                        open &&
                            'max-md:absolute max-md:top-full max-md:left-0 max-md:right-0 max-md:flex max-md:flex-col max-md:gap-5 max-md:border-b max-md:border-hairline max-md:bg-[rgba(0,0,0,0.98)] max-md:p-6 max-md:backdrop-blur-xl'
                    )}
                >
                    {LINKS.map((link) => (
                        <li key={link.href}>
                            {onHome ? (
                                <a
                                    href={link.href}
                                    onClick={() => setOpen(false)}
                                    className={LINK_CLASS}
                                >
                                    {link.label}
                                </a>
                            ) : (
                                <Link
                                    to="/"
                                    onClick={() => {
                                        setOpen(false);
                                        requestSectionScroll(link.href.slice(1));
                                    }}
                                    className={LINK_CLASS}
                                >
                                    {link.label}
                                </Link>
                            )}
                        </li>
                    ))}

                    {/* mobile-only actions so the menu is usable on a phone */}
                    <li className="md:hidden">
                        <div className="flex flex-col gap-3 border-t border-hairline pt-5">
                            <Button asChild variant="outline" onClick={() => setOpen(false)}>
                                <Link to="/signin">Sign in</Link>
                            </Button>
                            <Button asChild className="accent-cta border-0 hover:bg-[color:var(--lime-strong)]" onClick={() => setOpen(false)}>
                                <Link to="/signup">Start free</Link>
                            </Button>
                        </div>
                    </li>
                </ul>

                <div className="hidden items-center gap-3 md:flex">
                    <Button asChild variant="ghost" size="sm">
                        <Link to="/signin">Sign in</Link>
                    </Button>
                    <Button asChild size="sm" className="accent-cta border-0 hover:bg-[color:var(--lime-strong)]">
                        <Link to="/signup">Start free</Link>
                    </Button>
                </div>

                <button
                    type="button"
                    aria-label={open ? 'Close menu' : 'Open menu'}
                    aria-expanded={open}
                    onClick={() => setOpen((v) => !v)}
                    className="rounded-md p-2 text-ink-secondary transition hover:bg-veil hover:text-foreground md:hidden"
                >
                    {open ? <X className="size-5" /> : <Menu className="size-5" />}
                </button>
            </div>
        </nav>
    );
}
