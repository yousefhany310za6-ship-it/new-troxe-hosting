import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Activity, Bell, Crown, LayoutDashboard, LogOut, Menu, Server, Settings, ShieldCheck, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { AvatarBadge } from '@/components/AvatarBadge.jsx';
import { useAuth } from '@/context/AuthContext.jsx';

const NAV = [
    { to: '/dashboard', label: 'Overview', Icon: LayoutDashboard, end: true },
    { to: '/dashboard/servers', label: 'Servers', Icon: Server },
    { to: '/dashboard/activity', label: 'Activity', Icon: Activity },
    { to: '/dashboard/settings', label: 'Settings', Icon: Settings },
];

const CRUMBS = [
    [/^\/dashboard\/servers\/new$/, 'New server'],
    [/^\/dashboard\/servers\/[^/]+$/, 'Server'],
    [/^\/dashboard\/servers$/, 'Servers'],
    [/^\/dashboard\/activity$/, 'Activity'],
    [/^\/dashboard\/settings$/, 'Settings'],
    [/^\/dashboard\/?$/, 'Overview'],
];

function crumbFor(pathname) {
    for (const [re, label] of CRUMBS) {
        if (re.test(pathname)) return label;
    }
    return 'Dashboard';
}

const linkCls = ({ isActive }) =>
    cn(
        'relative flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-[0.92rem] font-semibold transition',
        isActive
            ? 'bg-white/[0.07] text-foreground shadow-[inset_2px_0_0_0_#fff]'
            : 'text-ink-secondary hover:bg-veil hover:text-foreground'
    );

function SidebarContent({ onNavigate }) {
    const navigate = useNavigate();
    const { user, signOut } = useAuth();

    return (
        <div className="flex h-full flex-col">
            <Link to="/" className="flex items-center gap-2.5 px-5 pt-6 pb-8">
                <div className="flex size-[34px] items-center justify-center overflow-hidden rounded-sm bg-black p-1">
                    <img src="./favicon.png" alt="" className="size-full object-contain" />
                </div>
                <span className="text-lg font-extrabold text-foreground">
                    Troxe <span className="font-semibold text-ink-muted">Host</span>
                </span>
            </Link>

            <p className="px-3.5 pt-1 pb-2 font-mono text-[0.66rem] font-semibold tracking-[0.18em] text-ink-muted uppercase">
                Workspace
            </p>
            <nav className="flex flex-col gap-1 px-3">
                {NAV.map(({ to, label, Icon, end }) => (
                    <NavLink
                        key={to}
                        to={to}
                        end={end}
                        onClick={onNavigate}
                        className={linkCls}
                    >
                        <Icon className="size-[18px]" />
                        {label}
                    </NavLink>
                ))}
                {user?.role === 'admin' && (
                    <NavLink
                        to="/admin"
                        onClick={onNavigate}
                        className={linkCls}
                    >
                        <ShieldCheck className="size-[18px]" />
                        Admin
                    </NavLink>
                )}
            </nav>

            <div className="mt-auto flex flex-col gap-2 p-3">
                <div className="rounded-xl border border-hairline bg-card p-3.5">
                    <div className="flex items-center gap-2.5">
                        <AvatarBadge url={user?.avatarUrl} name={user?.name ?? user?.email} size="size-9" text="text-sm" />
                        <div className="min-w-0 flex-1 leading-tight">
                            <p className="truncate text-[0.85rem] font-bold text-foreground">{user?.name ?? 'Account'}</p>
                            <p className="truncate font-mono text-[0.68rem] text-ink-muted">
                                <span className="capitalize">{user?.planId ?? 'free'}</span> plan
                            </p>
                        </div>
                    </div>
                    <Link
                        to="/pricing"
                        onClick={onNavigate}
                        className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-hairline bg-veil px-3 py-1.5 text-[0.76rem] font-bold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground"
                    >
                        <Crown size={13} /> Upgrade plan
                    </Link>
                </div>
                <button
                    type="button"
                    onClick={async () => { await signOut(); navigate('/'); }}
                    className="flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-[0.92rem] font-semibold text-ink-secondary transition hover:bg-red-500/10 hover:text-red-300"
                >
                    <LogOut className="size-[18px]" />
                    Sign out
                </button>
            </div>
        </div>
    );
}

export default function DashboardLayout() {
    const [open, setOpen] = useState(false);
    const { user, signOut } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const crumb = crumbFor(location.pathname);

    return (
        <div className="min-h-screen bg-black text-foreground">
            {/* Desktop sidebar */}
            <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-hairline bg-background lg:block">
                <SidebarContent />
            </aside>

            {/* Mobile sidebar */}
            {open && (
                <div className="fixed inset-0 z-50 lg:hidden">
                    <div
                        className="absolute inset-0 bg-black/70"
                        onClick={() => setOpen(false)}
                    />
                    <aside className="absolute inset-y-0 left-0 w-72 border-r border-hairline bg-background">
                        <button
                            type="button"
                            aria-label="Close menu"
                            onClick={() => setOpen(false)}
                            className="absolute top-5 right-4 rounded-md p-1.5 text-ink-secondary hover:bg-veil hover:text-foreground"
                        >
                            <X className="size-5" />
                        </button>
                        <SidebarContent onNavigate={() => setOpen(false)} />
                    </aside>
                </div>
            )}

            <div className="lg:pl-64">
                {/* Topbar */}
                <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-hairline bg-black/85 px-4 py-3 backdrop-blur-xl sm:px-6">
                    <button
                        type="button"
                        aria-label="Open menu"
                        onClick={() => setOpen(true)}
                        className="rounded-md p-2 text-ink-secondary hover:bg-veil hover:text-foreground lg:hidden"
                    >
                        <Menu className="size-5" />
                    </button>
                    <div className="hidden items-center gap-2 rounded-lg border border-hairline bg-card px-3 py-1.5 text-[0.8rem] text-ink-muted sm:flex" aria-label="Breadcrumb">
                        <span className="font-mono">/</span>
                        <span>dashboard</span>
                        <span className="text-ink-muted/60">/</span>
                        <span className="font-semibold text-foreground">{crumb}</span>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                        <AvatarBadge url={user?.avatarUrl} name={user?.name ?? user?.email} size="size-9" text="text-sm" />
                    </div>
                </header>

                {user?.impersonatedBy && (
                    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 sm:px-6" role="alert">
                        <div className="mx-auto flex w-full max-w-[1100px] flex-wrap items-center gap-x-3 gap-y-1 text-[0.83rem]">
                            <ShieldCheck className="size-4 shrink-0 text-amber-300" />
                            <p className="min-w-0 flex-1 basis-48 text-amber-200">
                                <span className="font-bold">Admin view</span> — you are viewing as{' '}
                                <span className="font-mono font-bold">{user?.name}</span>. Actions are logged.
                                This session expires automatically.
                            </p>
                            <button
                                type="button"
                                onClick={async () => { await signOut(); navigate('/signin', { replace: true }); }}
                                className="shrink-0 rounded-full border border-amber-500/40 px-3.5 py-1 text-[0.75rem] font-bold text-amber-200 transition hover:bg-amber-500/20"
                            >
                                End session
                            </button>
                        </div>
                    </div>
                )}
                <main className="mx-auto w-full max-w-[1100px] p-4 sm:p-6 lg:p-8">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
