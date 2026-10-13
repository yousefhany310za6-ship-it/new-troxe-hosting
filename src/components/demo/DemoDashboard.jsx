import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    Database,
    Folder,
    Info,
    LayoutDashboard,
    Settings as SettingsIcon,
    ShieldCheck,
    Terminal,
    X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/useToast.jsx';
import { DEMO_SERIES, DEMO_SERVER, metricsAt } from '@/data/demoData.js';
import useReducedMotion from './useReducedMotion.js';

import DemoOverview from './DemoOverview.jsx';
import DemoConsole from './DemoConsole.jsx';
import DemoFiles from './DemoFiles.jsx';
import DemoBackups from './DemoBackups.jsx';
import DemoSettings from './DemoSettings.jsx';

/* Section registry — mirrors the production ServerDetail tab set, reduced to
 * the five sections that carry real value in a 10-second demo. */
const SECTIONS = [
    { id: 'overview', label: 'Overview', Icon: LayoutDashboard },
    { id: 'console', label: 'Console', Icon: Terminal },
    { id: 'files', label: 'Files', Icon: Folder },
    { id: 'backups', label: 'Backups', Icon: Database },
    { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

/* Sidebar nav item — copied from DashboardLayout.jsx `linkCls`. */
const linkCls = (isActive) =>
    cn(
        'relative flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-[0.92rem] font-semibold transition',
        isActive
            ? 'bg-white/[0.07] text-foreground shadow-[inset_2px_0_0_0_#fff]'
            : 'text-ink-secondary hover:bg-veil hover:text-foreground'
    );

/* Resting delays, matched to how long each action "takes" in the console. */
const ACTION_DELAY = { start: 900, stop: 700, restart: 1400 };
const ACTION_LABEL = { start: 'Demo server started', stop: 'Demo server stopped', restart: 'Demo server restarted' };

export default function DemoDashboard({
    tab: tabProp,
    onTabChange,
    /* DemoStage measures this panel, so the height has to be a plain value it
       can read back. Packed it is a comfortable window; full screen it grows
       to take whatever the viewport has left under the control bar. */
    panelHeight = 'clamp(560px, 76vh, 860px)',
}) {
    const toast = useToast();
    const reduced = useReducedMotion();

    const [internalTab, setInternalTab] = useState('overview');
    const [hint, setHint] = useState(true);
    const [status, setStatus] = useState('online');
    const [busy, setBusy] = useState(false);
    const [tick, setTick] = useState(0);
    const [onScreen, setOnScreen] = useState(true);

    /* The open section is controlled by DemoStage so it survives switching
       between the packed window and the full-screen copy: those are two
       separate mounts, and losing the visitor's place on every toggle would
       feel broken. Left uncontrolled it falls back to local state. */
    const controlled = tabProp !== undefined;
    const tab = controlled ? tabProp : internalTab;
    const setTab = controlled ? onTabChange : setInternalTab;

    const [settings, setSettings] = useState(() => ({
        ...DEMO_SERVER,
        runtimeVersion: 'v22.11.0',
    }));

    /* Fixed reference time for relative timestamps so the demo reads
     * consistently instead of drifting on every render. */
    const now = useMemo(() => new Date(), []);

    const rootRef = useRef(null);
    const timerRef = useRef(null);
    const tickRef = useRef(null);

    /* ---- cleanup: every timer this component owns is cleared on unmount ---- */
    useEffect(
        () => () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            if (tickRef.current) clearInterval(tickRef.current);
        },
        []
    );

    /* ---- pause the metric ticker when the demo scrolls out of view ---- */
    useEffect(() => {
        const el = rootRef.current;
        if (!el || typeof IntersectionObserver === 'undefined') return undefined;

        const io = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), {
            threshold: 0,
        });
        io.observe(el);
        return () => io.disconnect();
    }, []);

    /* ---- one ticker, only while the Overview is on screen ---- */
    useEffect(() => {
        if (reduced || !onScreen || tab !== 'overview') return undefined;

        tickRef.current = setInterval(() => setTick((t) => t + 1), 2600);
        return () => clearInterval(tickRef.current);
    }, [onScreen, reduced, tab]);

    const metrics = useMemo(() => metricsAt(tick), [tick]);

    const series = useMemo(() => {
        // Guarantees a drawn line on the very first paint, before any tick.
        if (tick === 0) return { cpu: DEMO_SERIES.cpu, net: DEMO_SERIES.net };

        const cpu = [];
        const net = [];
        for (let i = tick - 39; i <= tick; i++) {
            const m = metricsAt(i);
            cpu.push(Number(m.cpu.toFixed(1)));
            net.push(Math.round(m.rx + m.tx));
        }
        return { cpu, net };
    }, [tick]);

    /* ---- start / stop / restart, shared by the header and the console ---- */
    const onStatusAction = useCallback(
        (action) => {
            if (timerRef.current) clearTimeout(timerRef.current);
            setBusy(true);

            if (action === 'stop') {
                setStatus('offline');
            } else if (action === 'start') {
                setStatus('online');
            } else {
                setStatus('restarting');
            }

            const finish = () => {
                setStatus((s) => (s === 'restarting' ? 'online' : s));
                setBusy(false);
                toast.success(ACTION_LABEL[action]);
            };

            if (reduced) finish();
            else timerRef.current = setTimeout(finish, ACTION_DELAY[action]);
        },
        [reduced, toast]
    );

    const saveSettings = useCallback((next) => {
        setSettings((s) => ({ ...s, ...next }));
    }, []);

    /* Switching section is instant and never scrolls the page. */
    const navigate = useCallback((next) => setTab(next), []);

    const server = { ...settings, status };
    const statusLabel = status === 'online' ? 'online' : status;

    return (
        // The panel used to carry the site-wide `border-hairline`, which on a
        // pure-black page is almost invisible — the dashboard dissolved into
        // the background. It now gets a deliberate white frame: a visible
        // 1px border, a hairline of light across the top edge, and a soft
        // white bloom behind it so it reads as a window floating on the page.
        <div
            ref={rootRef}
            data-demo-panel="true"
            style={{ height: panelHeight }}
            className="relative flex flex-col overflow-hidden rounded-2xl border border-white/25 bg-background text-foreground shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_50px_120px_-40px_rgba(255,255,255,0.25),0_24px_60px_-30px_rgba(0,0,0,0.9)]"
        >
            {/* Light bleeding along the top edge — reads as a glass rim. */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 z-30 h-px rounded-t-2xl bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.95)_25%,rgba(255,255,255,0.95)_75%,transparent)]"
            />
            {/* ============ app frame ============ */}
            <div className="flex shrink-0 items-center gap-3 rounded-t-2xl border-b border-hairline bg-card px-3 py-2.5 sm:px-4">
                <div className="hidden items-center gap-1.5 sm:flex" aria-hidden="true">
                    <span className="size-2.5 rounded-full bg-hairline-hover" />
                    <span className="size-2.5 rounded-full bg-hairline-hover" />
                    <span className="size-2.5 rounded-full bg-hairline-hover" />
                </div>

                <div className="flex min-w-0 items-center gap-2 rounded-lg border border-hairline bg-veil/40 px-2.5 py-1">
                    <span className="truncate font-mono text-[0.72rem] text-ink-muted">
                        dashboard<span className="text-ink-muted/60">/</span>
                        <span className="font-semibold text-foreground">{server.name}</span>
                    </span>
                </div>

                <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[0.68rem] font-bold text-amber-300">
                    <Info size={11} aria-hidden="true" />
                    Interactive Demo
                </span>
            </div>

            <div className="flex min-h-0 flex-1 items-stretch">
                {/* ============ sidebar (desktop) ============
                     Fills the fixed-height panel and scrolls its own contents,
                     so the divider runs the full window and the rail stays
                     reachable whatever section is open. */}
                <aside className="hidden w-60 shrink-0 flex-col overflow-y-auto rounded-bl-2xl border-r border-hairline bg-background lg:block">
                    <div className="px-5 pt-5 pb-6">
                        <div className="flex items-center gap-2.5">
                            <div className="flex size-[34px] items-center justify-center overflow-hidden rounded-sm bg-black p-1">
                                <img src="./favicon.png" alt="" className="size-full object-contain" />
                            </div>
                            <span className="text-lg font-extrabold text-foreground">
                                Troxe <span className="font-semibold text-ink-muted">Host</span>
                            </span>
                        </div>
                    </div>

                    <p className="px-3.5 pt-1 pb-2 font-mono text-[0.66rem] font-semibold tracking-[0.18em] text-ink-muted uppercase">
                        Demo server
                    </p>
                    <nav className="flex flex-col gap-1 px-3">
                        {SECTIONS.map(({ id, label, Icon }) => (
                            <button
                                key={id}
                                type="button"
                                onClick={() => navigate(id)}
                                aria-current={tab === id ? 'page' : undefined}
                                className={linkCls(tab === id)}
                            >
                                <Icon className="size-[18px] shrink-0" />
                                {label}
                            </button>
                        ))}
                    </nav>

                    <div className="flex flex-col gap-2 p-3 pt-6">
                        <div className="rounded-xl border border-hairline bg-card p-3.5">
                            <div className="flex items-center gap-2.5">
                                <span
                                    className={cn(
                                        'flex size-9 items-center justify-center rounded-lg border border-hairline bg-veil text-[0.7rem] font-bold text-ink-secondary'
                                    )}
                                >
                                    DH
                                </span>
                                <div className="min-w-0 flex-1 leading-tight">
                                    <p className="truncate text-[0.85rem] font-bold text-foreground">Demo visitor</p>
                                    <p className="truncate font-mono text-[0.68rem] text-ink-muted">
                                        <span className="capitalize">{settings.planId}</span> plan
                                    </p>
                                </div>
                            </div>
                            <Link
                                to="/signup"
                                className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-hairline bg-veil px-3 py-1.5 text-[0.76rem] font-bold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground"
                            >
                                Create free account
                            </Link>
                        </div>

                        <p className="flex items-start gap-2 px-1 text-[0.7rem] leading-relaxed text-ink-muted">
                            <ShieldCheck size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                            <span>No account needed. Nothing you do here touches a real server.</span>
                        </p>
                    </div>
                </aside>

                {/* ============ main column ============ */}
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    {/* topbar */}
                    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline bg-black/85 px-4 py-3 sm:px-6">
                        <div
                            className="flex items-center gap-2 rounded-lg border border-hairline bg-card px-3 py-1.5 text-[0.8rem] text-ink-muted"
                            aria-label="Breadcrumb"
                        >
                            <span className="font-mono">/</span>
                            <span>dashboard</span>
                            <span className="text-ink-muted/60">/</span>
                            <span className="font-semibold text-foreground">
                                {SECTIONS.find((s) => s.id === tab)?.label}
                            </span>
                        </div>

                        <div className="ml-auto flex items-center gap-2">
                            <span
                                className={cn(
                                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.72rem] font-semibold',
                                    status === 'online'
                                        ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                                        : status === 'restarting'
                                          ? 'border-amber-500/25 bg-amber-500/10 text-amber-300'
                                          : 'border-hairline bg-veil text-ink-secondary'
                                )}
                            >
                                <span
                                    className={cn(
                                        'size-1.5 rounded-full',
                                        status === 'online'
                                            ? 'animate-beat bg-emerald-500'
                                            : status === 'restarting'
                                              ? 'animate-beat bg-amber-500'
                                              : 'bg-zinc-500'
                                    )}
                                />
                                <span className="capitalize">{statusLabel}</span>
                            </span>
                        </div>
                    </header>

                    {/* Section tabs. Always shown now (they used to be mobile-only). They sit
                     outside the scrolling body, so they stay put no matter how
                     long the open section is. */}
                    <nav
                        aria-label="Demo sections"
                        className="z-20 flex shrink-0 gap-1 overflow-x-auto border-b border-hairline bg-background"
                    >
                        {SECTIONS.map(({ id, label, Icon }) => (
                            <button
                                key={id}
                                type="button"
                                onClick={() => navigate(id)}
                                aria-current={tab === id ? 'page' : undefined}
                                className={cn(
                                    'flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-[0.88rem] font-semibold transition',
                                    tab === id
                                        ? 'border-white text-foreground'
                                        : 'border-transparent text-ink-secondary hover:text-foreground'
                                )}
                            >
                                <Icon className="size-4" />
                                {label}
                            </button>
                        ))}
                    </nav>

                    {/* first-visit hint */}
                    {hint && (
                        <div className="flex shrink-0 items-start gap-2.5 border-b border-hairline bg-veil/25 px-4 py-2.5 sm:px-6">
                            <Info size={14} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
                            <p className="min-w-0 flex-1 text-[0.78rem] leading-relaxed text-ink-secondary">
                                Try it — switch sections with the sidebar or the tabs, then send a command like{' '}
                                <code className="font-mono text-foreground">status</code> in the Console.
                            </p>
                            <button
                                type="button"
                                onClick={() => setHint(false)}
                                aria-label="Dismiss hint"
                                className="shrink-0 rounded-md p-1 text-ink-muted transition hover:bg-veil hover:text-foreground"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    )}

                    {/* Content — the only part that scrolls. The panel has a fixed height, so
                     every section renders at the exact same window size and
                     switching tabs never resizes anything on the page. */}
                    <div className="min-h-0 flex-1 overflow-y-auto rounded-br-2xl p-4 sm:p-6">
                        {tab === 'overview' && (
                            <DemoOverview
                                server={server}
                                metrics={metrics}
                                series={series}
                                onNavigate={navigate}
                                onAction={onStatusAction}
                                busy={busy}
                                reduced={reduced}
                            />
                        )}
                        {tab === 'console' && (
                            <DemoConsole
                                server={server}
                                metrics={metrics}
                                onStatusAction={onStatusAction}
                                reduced={reduced}
                            />
                        )}
                        {tab === 'files' && <DemoFiles now={now} />}
                        {tab === 'backups' && <DemoBackups now={now} reduced={reduced} />}
                        {tab === 'settings' && <DemoSettings settings={settings} onSave={saveSettings} />}
                    </div>
                </div>
            </div>
        </div>
    );
}