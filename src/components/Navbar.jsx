import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { cn } from '@/lib/utils';
import { requestSectionScroll } from '@/lib/scrollRequest';
import { useScrolled } from '../hooks/useSiteEffects.js';
import { Button } from './ui/button.jsx';
import Logo from './Logo.jsx';

const LINKS = [
    { href: '#services', label: 'Services' },
    { href: '#pricing', label: 'Pricing' },
    { href: '#features', label: 'Features' },
    { href: '#faq', label: 'FAQ' },
];

const LINK_CLASS =
    'relative text-[0.95rem] font-semibold text-ink-secondary transition after:absolute after:-bottom-1 after:left-0 after:h-0.5 after:w-0 after:bg-primary after:content-[""] after:transition-all hover:text-foreground hover:after:w-full';

export default function Navbar() {
    const scrolled = useScrolled(50);
    const [open, setOpen] = useState(false);
    const navigate = useNavigate();
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
                                        requestSectionScroll(link.href.slice(1));
                                        setOpen(false);
                                    }}
                                    className={LINK_CLASS}
                                >
                                    {link.label}
                                </Link>
                            )}
                        </li>
                    ))}
                </ul>

                <div
                    className={cn(
                        'hidden items-center gap-2.5 md:flex',
                        open &&
                            'max-md:absolute max-md:top-full max-md:left-0 max-md:right-0 max-md:mt-[160px] max-md:flex max-md:flex-col max-md:bg-[rgba(0,0,0,0.98)] max-md:px-6 max-md:pb-6'
                    )}
                >
                    <Button variant="ghost" type="button" onClick={() => navigate('/signin')}>
                        Log in
                    </Button>
                    <Button type="button" onClick={() => navigate('/signup')}>Get Started</Button>
                </div>

                <button
                    id="hamburger"
                    type="button"
                    aria-label="Toggle menu"
                    aria-expanded={open}
                    onClick={() => setOpen((v) => !v)}
                    className="hidden max-md:flex max-md:flex-col max-md:gap-[5px] max-md:bg-transparent max-md:p-[5px]"
                >
                    <span className="block h-0.5 w-6 rounded-[2px] bg-foreground transition" />
                    <span className="block h-0.5 w-6 rounded-[2px] bg-foreground transition" />
                    <span className="block h-0.5 w-6 rounded-[2px] bg-foreground transition" />
                </button>
            </div>
        </nav>
    );
}
