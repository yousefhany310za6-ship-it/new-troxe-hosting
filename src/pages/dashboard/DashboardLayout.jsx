import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Activity, Bell, LayoutDashboard, LogOut, Menu, Server, Settings, ShieldCheck, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext.jsx';

const NAV = [
    { to: '/dashboard', label: 'Overview', Icon: LayoutDashboard, end: true },
    { to: '/dashboard/servers', label: 'Servers', Icon: Server },
    { to: '/dashboard/activity', label: 'Activity', Icon: Activity },
    { to: '/dashboard/settings', label: 'Settings', Icon: Settings },
];

const linkCls = ({ isActive }) =>
    cn(
        'flex items-center gap-3 rounded-md px-3.5 py-2.5 text-[0.92rem] font-semibold transition',
        isActive
            ? 'bg-veil text-foreground'
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

            <div className="mt-auto flex flex-col gap-1 p-3">
                <div className="mb-2 rounded-md border border-hairline bg-card px-3.5 py-3">
                    <p className="text-[0.8rem] text-ink-muted">Current plan</p>
                    <p className="text-[0.95rem] font-bold text-foreground">
                        {user?.planId ?? 'free'} plan
                    </p>
                    <Link
                        to="/pricing"
                        onClick={onNavigate}
                        className="mt-1 inline-block text-[0.8rem] font-semibold text-foreground underline-offset-4 hover:underline"
                    >
                        Upgrade
                    </Link>
                </div>
                <button
                    type="button"
                    onClick={async () => { await signOut(); navigate('/'); }}
                    className="flex items-center gap-3 rounded-md px-3.5 py-2.5 text-[0.92rem] font-semibold text-ink-secondary transition hover:bg-veil hover:text-foreground"
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
    const { user } = useAuth();

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
                    <div className="hidden items-center gap-2 rounded-md border border-hairline bg-card px-3 py-1.5 text-sm text-ink-muted sm:flex">
                        <span className="font-mono">/</span> dashboard
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                        <div className="flex size-9 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-white">
                            {user?.name?.charAt(0)?.toUpperCase() ?? 'U'}
                        </div>
                    </div>
                </header>

                <main className="mx-auto w-full max-w-[1100px] p-4 sm:p-6 lg:p-8">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
