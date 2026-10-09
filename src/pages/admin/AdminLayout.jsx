import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  LogOut,
  Mail,
  Megaphone,
  Menu,
  Network,
  Server,
  Database,
  ScrollText,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext.jsx';
import { AvatarBadge } from '@/components/AvatarBadge.jsx';

const GROUPS = [
  {
    label: 'General',
    items: [{ to: '/admin', label: 'Overview', Icon: LayoutDashboard, end: true }],
  },
  {
    label: 'Manage',
    items: [
      {
        to: '/admin/users',
        label: 'Users',
        Icon: Users,
        children: [
          { to: '/admin/users', label: 'All users', end: true },
          { to: '/admin/users?status=suspended', label: 'Suspended' },
        ],
      },
      {
        to: '/admin/servers',
        label: 'Servers',
        Icon: Server,
        children: [
          { to: '/admin/servers', label: 'All servers', end: true },
          { to: '/admin/servers?status=suspended', label: 'Suspended' },
        ],
      },
      { to: '/admin/nodes', label: 'Nodes', Icon: Network },
      { to: '/admin/plans', label: 'Plans', Icon: Database },
    ],
  },
  {
    label: 'Communication',
    items: [
      { to: '/admin/email', label: 'Email', Icon: Mail },
      { to: '/admin/announcements', label: 'Announcements', Icon: Megaphone },
    ],
  },
  {
    label: 'Security',
    items: [{ to: '/admin/audit', label: 'Audit log', Icon: ScrollText }],
  },
];

const CRUMBS = [
  [/^\/admin$/, 'Overview'],
  [/^\/admin\/users$/, 'Users'],
  [/^\/admin\/users\/.+/, 'User details'],
  [/^\/admin\/servers\/new$/, 'New server'],
  [/^\/admin\/servers\/.+/, 'Server details'],
  [/^\/admin\/servers$/, 'Servers'],
  [/^\/admin\/nodes$/, 'Nodes'],
  [/^\/admin\/plans$/, 'Plans'],
  [/^\/admin\/email$/, 'Email'],
  [/^\/admin\/announcements$/, 'Announcements'],
  [/^\/admin\/audit$/, 'Audit log'],
];

function useCrumbs() {
  const { pathname, search } = useLocation();
  const status = new URLSearchParams(search).get('status');
  const trail = [{ to: '/admin', label: 'Admin' }];
  for (const [re, label] of CRUMBS) {
    if (re.test(pathname)) {
      if (/users$|servers$/.test(pathname)) trail.push({ to: pathname, label });
      else trail.push({ label });
      break;
    }
  }
  if (status === 'suspended') trail.push({ label: 'Suspended' });
  return trail;
}

function NavItem({ to, label, Icon, end, collapsed, onNavigate, depth = 0 }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      aria-label={label}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-[0.86rem] font-semibold transition focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
          depth > 0 && 'py-1.5 text-[0.8rem]',
          isActive ? 'bg-veil text-foreground' : 'text-ink-secondary hover:bg-veil hover:text-foreground',
          collapsed && 'justify-center px-0',
        )
      }
    >
      {depth === 0 ? (
        <Icon className="size-[17px] shrink-0" />
      ) : (
        <span aria-hidden="true" className="w-[17px] shrink-0 text-center text-ink-muted">
          ·
        </span>
      )}
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  );
}

function SidebarContent({ collapsed, onNavigate }) {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [openGroups, setOpenGroups] = useState(() => new Set(GROUPS.map((g) => g.label)));

  if (collapsed) {
    const flat = GROUPS.flatMap((g) => g.items);
    return (
      <div className="flex h-full flex-col items-center py-5">
        <Link to="/admin" aria-label="Admin overview" className="flex size-9 items-center justify-center rounded-lg bg-red-600">
          <ShieldCheck className="size-5 text-white" />
        </Link>
        <nav aria-label="Admin" className="mt-6 flex flex-col gap-1">
          {flat.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onNavigate}
              title={label}
              aria-label={label}
              className={({ isActive }) =>
                cn(
                  'flex size-9 items-center justify-center rounded-lg transition focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                  isActive ? 'bg-veil text-foreground' : 'text-ink-secondary hover:bg-veil hover:text-foreground',
                )
              }
            >
              <Icon className="size-[17px]" />
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col items-center gap-2">
          <AvatarBadge url={user?.avatarUrl} name={user?.name ?? user?.email} size="size-8" text="text-xs" />
          <button
            type="button"
            onClick={async () => {
              onNavigate?.();
              await signOut();
              navigate('/');
            }}
            title="Sign out"
            aria-label="Sign out"
            className="flex size-9 items-center justify-center rounded-lg text-ink-secondary transition hover:bg-veil hover:text-foreground"
          >
            <LogOut className="size-[17px]" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Link to="/admin" className="flex items-center gap-2.5 px-5 pt-6 pb-6">
        <span className="flex size-8 items-center justify-center rounded-lg bg-red-600">
          <ShieldCheck className="size-[18px] text-white" />
        </span>
        <span className="text-[1.02rem] font-extrabold tracking-tight">
          Troxe <span className="font-semibold text-red-400">Admin</span>
        </span>
      </Link>

      <nav aria-label="Admin" className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 pb-4">
        {GROUPS.map((group) => {
          const open = openGroups.has(group.label);
          return (
            <div key={group.label}>
              <button
                type="button"
                onClick={() => setOpenGroups((prev) => {
                  const next = new Set(prev);
                  if (next.has(group.label)) next.delete(group.label);
                  else next.add(group.label);
                  return next;
                })}
                aria-expanded={open}
                className="mb-1 flex w-full items-center justify-between px-3 text-[0.68rem] font-bold tracking-[0.12em] text-ink-muted uppercase transition hover:text-ink-secondary"
              >
                {group.label}
                <ChevronDown size={13} className={cn('transition-transform', !open && '-rotate-90')} />
              </button>
              {open && (
                <div className="flex flex-col gap-0.5">
                  {group.items.map((item) =>
                    item.children ? (
                      <div key={item.to}>
                        <NavItem to={item.to} label={item.label} Icon={item.Icon} end={item.end} onNavigate={onNavigate} />
                        <div className="ml-4 flex flex-col gap-0.5 border-l border-hairline pl-2">
                          {item.children.map((c) => (
                            <NavItem key={c.to} to={c.to} label={c.label} Icon={c.Icon} end={c.end} onNavigate={onNavigate} depth={1} />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <NavItem key={item.to} to={item.to} label={item.label} Icon={item.Icon} end={item.end} onNavigate={onNavigate} />
                    ),
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-hairline p-3">
        <div className="mb-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5">
          <AvatarBadge url={user?.avatarUrl} name={user?.name ?? user?.email} size="size-8" text="text-xs" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[0.8rem] font-bold">{user?.name ?? 'Admin'}</p>
            <p className="truncate font-mono text-[0.68rem] text-ink-muted">{user?.email ?? ''}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            navigate('/dashboard');
          }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[0.86rem] font-semibold text-ink-secondary transition hover:bg-veil hover:text-foreground"
        >
          <ArrowLeft className="size-[17px]" />
          Back to dashboard
        </button>
        <button
          type="button"
          onClick={async () => {
            onNavigate?.();
            await signOut();
            navigate('/');
          }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[0.86rem] font-semibold text-ink-secondary transition hover:bg-veil hover:text-foreground"
        >
          <LogOut className="size-[17px]" />
          Sign out
        </button>
      </div>
    </div>
  );
}

export default function AdminLayout() {
    const [open, setOpen] = useState(false);
    const [collapsed, setCollapsed] = useState(() => {
        try {
            return localStorage.getItem('troxe:admin:nav') === 'collapsed';
        } catch {
            return false;
        }
    });
    const crumbs = useCrumbs();
    const { user } = useAuth();

    const toggleCollapsed = () => {
        setCollapsed((v) => {
            try {
                localStorage.setItem('troxe:admin:nav', v ? 'expanded' : 'collapsed');
            } catch { /* private mode */ }
            return !v;
        });
    };

    return (
        <div className="min-h-screen bg-black text-foreground">
            <aside
                className={cn(
                    'fixed inset-y-0 left-0 z-40 hidden border-r border-hairline bg-background transition-[width] lg:block',
                    collapsed ? 'w-[68px]' : 'w-60',
                )}
            >
                <SidebarContent collapsed={collapsed} />
            </aside>

            {open && (
                <div className="fixed inset-0 z-50 lg:hidden">
                    <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
                    <aside className="absolute inset-y-0 left-0 w-72 border-r border-hairline bg-background">
                        <button
                            type="button"
                            aria-label="Close menu"
                            onClick={() => setOpen(false)}
                            className="absolute top-5 right-4 z-10 rounded-md p-1.5 text-ink-secondary hover:bg-veil hover:text-foreground"
                        >
                            <X className="size-5" />
                        </button>
                        <SidebarContent onNavigate={() => setOpen(false)} />
                    </aside>
                </div>
            )}

            <div className={cn('transition-[padding] lg:pl-60', collapsed && 'lg:pl-[68px]')}>
                <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-hairline bg-black/85 px-4 py-2.5 backdrop-blur-xl sm:px-6">
                    <button
                        type="button"
                        aria-label="Open menu"
                        onClick={() => setOpen(true)}
                        className="rounded-md p-2 text-ink-secondary hover:bg-veil hover:text-foreground lg:hidden"
                    >
                        <Menu className="size-5" />
                    </button>
                    <button
                        type="button"
                        onClick={toggleCollapsed}
                        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        className="hidden rounded-md p-2 text-ink-secondary hover:bg-veil hover:text-foreground lg:block"
                    >
                        {collapsed ? <ChevronsRight className="size-5" /> : <ChevronsLeft className="size-5" />}
                    </button>
                    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[0.83rem]">
                        {crumbs.map((c, i) => (
                            <span key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
                                {i > 0 && (
                                    <span aria-hidden="true" className="text-ink-muted">
                                        /
                                    </span>
                                )}
                                {c.to && i < crumbs.length - 1 ? (
                                    <Link to={c.to} className="shrink-0 text-ink-secondary transition hover:text-foreground">
                                        {c.label}
                                    </Link>
                                ) : (
                                    <span className={cn('truncate', i === crumbs.length - 1 ? 'font-bold text-foreground' : 'text-ink-secondary')}>
                                        {c.label}
                                    </span>
                                )}
                            </span>
                        ))}
                    </nav>
                    <div className="ml-auto flex shrink-0 items-center gap-2">
                        <span className="hidden items-center gap-2 rounded-full border border-red-500/25 bg-red-500/[0.07] px-3 py-1 text-[0.72rem] font-bold text-red-300 sm:inline-flex">
                            <ShieldCheck size={13} /> Admin
                        </span>
                        <AvatarBadge url={user?.avatarUrl} name={user?.name ?? user?.email} size="size-8" text="text-xs" />
                    </div>
                </header>

                <main className="mx-auto w-full max-w-[1100px] p-4 sm:p-6 lg:p-8">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
