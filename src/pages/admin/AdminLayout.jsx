import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Activity, ArrowLeft, Database, LayoutDashboard, Menu, Server, ShieldCheck, Users, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext.jsx';

const NAV = [
    { to: '/admin', label: 'Overview', Icon: LayoutDashboard, end: true },
    { to: '/admin/users', label: 'Users', Icon: Users },
    { to: '/admin/servers', label: 'Servers', Icon: Server },
    { to: '/admin/plans', label: 'Plans', Icon: Database },
    { to: '/admin/audit', label: 'Audit log', Icon: Activity },
];

function SidebarContent({ onNavigate }) {
    const navigate = useNavigate();
    const { user, signOut } = useAuth();

    return (
        <div className="flex h-full flex-col">
            <Link to="/admin" className="flex items-center gap-2.5 px-5 pt-6 pb-8">
                <div className="flex size-[34px] items-center justify-center overflow-hidden rounded-sm bg-red-600 p-1">
                    <ShieldCheck className="size-5 text-white" />
                </div>
                <span className="text-lg font-extrabold text-foreground">
                    Troxe <span className="font-semibold text-red-400">Admin</span>
                </span>
            </Link>

            <nav className="flex flex-col gap-1 px-3">
                {NAV.map(({ to, label, Icon, end }) => (
                    <NavLink
                        key={to}
                        to={to}
                        end={end}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                            cn(
                                'flex items-center gap-3 rounded-md px-3.5 py-2.5 text-[0.92rem] font-semibold transition',
                                isActive
                                    ? 'bg-veil text-foreground'
                                    : 'text-ink-secondary hover:bg-veil hover:text-foreground'
                            )
                        }
                    >
                        <Icon className="size-[18px]" />
                        {label}
                    </NavLink>
                ))}
            </nav>

            <div className="mt-auto flex flex-col gap-1 p-3">
                <div className="mb-2 rounded-md border border-red-500/30 bg-card px-3.5 py-3">
                    <p className="text-[0.8rem] text-ink-muted">Signed in as</p>
                    <p className="truncate text-[0.9rem] font-bold text-foreground">{user?.email ?? 'admin'}</p>
                </div>
                <button
                    type="button"
                    onClick={() => { onNavigate?.(); navigate('/dashboard'); }}
                    className="flex items-center gap-3 rounded-md px-3.5 py-2.5 text-[0.92rem] font-semibold text-ink-secondary transition hover:bg-veil hover:text-foreground"
                >
                    <ArrowLeft className="size-[18px]" />
                    Back to dashboard
                </button>
                <button
                    type="button"
                    onClick={async () => { await signOut(); navigate('/'); }}
                    className="flex items-center gap-3 rounded-md px-3.5 py-2.5 text-[0.92rem] font-semibold text-ink-secondary transition hover:bg-veil hover:text-foreground"
                >
                    <X className="size-[18px]" />
                    Sign out
                </button>
            </div>
        </div>
    );
}

export default function AdminLayout() {
    const [open, setOpen] = useState(false);

    return (
        <div className="min-h-screen bg-black text-foreground">
            <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-hairline bg-background lg:block">
                <SidebarContent />
            </aside>

            {open && (
                <div className="fixed inset-0 z-50 lg:hidden">
                    <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
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
                <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-hairline bg-black/85 px-4 py-3 backdrop-blur-xl sm:px-6">
                    <button
                        type="button"
                        aria-label="Open menu"
                        onClick={() => setOpen(true)}
                        className="rounded-md p-2 text-ink-secondary hover:bg-veil hover:text-foreground lg:hidden"
                    >
                        <Menu className="size-5" />
                    </button>
                    <div className="hidden items-center gap-2 rounded-md border border-red-500/30 bg-card px-3 py-1.5 text-sm text-red-400 sm:flex">
                        <span className="font-mono">/admin</span>
                    </div>
                </header>

                <main className="mx-auto w-full max-w-[1100px] p-4 sm:p-6 lg:p-8">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}