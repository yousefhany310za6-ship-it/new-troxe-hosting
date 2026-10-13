import { useState } from 'react';
import {
    ArrowDown,
    ArrowUp,
    Check,
    ChevronRight,
    Copy,
    Cpu,
    Database,
    Folder,
    HardDrive,
    LifeBuoy,
    MemoryStick,
    Network,
    Play,
    RotateCcw,
    Server as ServerIcon,
    Settings as SettingsIcon,
    Square,
    Terminal,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/useToast.jsx';
import { fmtBytes, fmtPct, fmtRate, fmtUptime } from '@/data/demoData.js';
import {
    Bar,
    COLORS,
    LimitRow,
    Panel,
    Row,
    SimulatedPill,
    Sparkline,
    StatusHero,
    Tile,
    dotFor,
} from './primitives.jsx';

/** Copy button — identical treatment to ServerOverview.jsx `CopyButton`. */
function CopyButton({ onCopy, label, done }) {
    return (
        <button
            type="button"
            disabled={done}
            aria-label={done ? `${label} copied` : `Copy ${label}`}
            title={done ? 'Copied' : `Copy ${label}`}
            onClick={onCopy}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition hover:bg-white/10 hover:text-foreground"
        >
            {done ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
        </button>
    );
}

export default function DemoOverview({ server, metrics, series, onNavigate, onAction, busy, reduced }) {
    const toast = useToast();
    const [copied, setCopied] = useState(null);

    const online = server.status === 'online';
    const address = `http://${server.address}:${server.port}`;

    const copy = async (value, label) => {
        try {
            await navigator.clipboard?.writeText(value);
            setCopied(label);
            toast.success(`${label} copied to clipboard`);
        } catch {
            // Clipboard can be blocked (insecure origin, permissions). The
            // demo must not look broken when that happens.
            toast.info(label);
        }
    };

    const sub = (() => {
        if (online) return `Running for ${fmtUptime(metrics.uptime)}`;
        if (server.status === 'restarting') return 'Restarting — this takes a few seconds';
        return 'Stopped — start it from the controls above';
    })();

    const chips = [
        server.runtimeLabel,
        `${server.nodeId} · ${server.region}`,
        `${server.planId} plan`,
        `Port ${server.port}`,
    ];

    return (
        <div className="flex flex-col gap-4">
            {/* ---- server header (ServerDetail.jsx) ---- */}
            <div className="relative overflow-hidden rounded-xl border border-hairline bg-card p-5 sm:p-6">
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -top-10 -right-10 size-52 rounded-full opacity-[0.06]"
                    style={{ background: `radial-gradient(circle, ${COLORS.cpu}, transparent 70%)` }}
                />
                <div className="relative flex flex-wrap items-center gap-3">
                    <span className={cn('size-3 shrink-0 rounded-full', dotFor(server.status))} />
                    <h3 className="font-mono text-[1.25rem] font-extrabold sm:text-[1.4rem]">{server.name}</h3>
                    <span className="rounded-full border border-hairline bg-veil px-2.5 py-0.5 text-[0.75rem] font-semibold text-ink-secondary">
                        {server.runtimeLabel}
                    </span>
                    <span className="font-mono text-[0.75rem] text-ink-muted capitalize">{server.status}</span>

                    <div className="ml-auto flex flex-wrap items-center gap-2">
                        {/* Not hidden on phones: it is the only way back from
                            "Offline" once the demo server has been stopped. */}
                        <button
                            type="button"
                            disabled={busy || online || server.status === 'restarting'}
                            onClick={() => onAction('start')}
                            className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-veil px-3 py-1.5 text-[0.8rem] font-semibold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <Play className="size-3.5" />
                            Start
                        </button>
                        <button
                            type="button"
                            disabled={busy || !online}
                            onClick={() => onAction('restart')}
                            className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-veil px-3 py-1.5 text-[0.8rem] font-semibold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <RotateCcw className={cn('size-3.5', busy && 'animate-spin')} />
                            Restart
                        </button>
                        <button
                            type="button"
                            disabled={busy || !online}
                            onClick={() => onAction('stop')}
                            className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-veil px-3 py-1.5 text-[0.8rem] font-semibold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <Square className="size-3.5" />
                            Stop
                        </button>
                    </div>
                </div>
            </div>

            {/* ---- status hero (ServerOverview.jsx) ---- */}
            <StatusHero status={server.status} sub={sub} chips={chips} />

            {/* ---- connection address (ServerPorts.jsx) ---- */}
            <section className="rounded-2xl border border-hairline bg-card p-5" aria-label="Connection address">
                <header className="flex flex-wrap items-center gap-2">
                    <Network className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                    <h3 className="flex-1 text-[0.92rem] font-semibold">Connection address</h3>
                    <span className="shrink-0 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[0.68rem] font-semibold text-amber-300">
                        Demo address
                    </span>
                </header>

                <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-4">
                    <div className="min-w-0">
                        <span className="text-[0.78rem] font-semibold text-ink-secondary">Address</span>
                        <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[1.05rem] leading-none font-extrabold break-all text-foreground sm:text-[1.35rem]">
                            <span className="text-ink-muted">http://</span>
                            <span className="break-all">{server.address}</span>
                            <CopyButton label="Address" done={copied === 'Address'} onCopy={() => copy(address, 'Address')} />
                        </p>
                        <p className="mt-2 text-[0.75rem] text-ink-muted">
                            Reserved <code className="font-mono">.example</code> domain — nothing resolves here.
                        </p>
                    </div>
                    <div className="min-w-0">
                        <span className="text-[0.78rem] font-semibold text-ink-secondary">Port</span>
                        <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[1.05rem] leading-none font-extrabold text-foreground sm:text-[1.35rem]">
                            {server.port}
                            <CopyButton label="Port" done={copied === 'Port'} onCopy={() => copy(String(server.port), 'Port')} />
                        </p>
                    </div>
                </div>

                <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-hairline pt-4 text-[0.8rem] sm:grid-cols-4">
                    <div>
                        <dt className="text-ink-muted">Node</dt>
                        <dd className="mt-0.5 font-bold text-foreground">{server.nodeId}</dd>
                    </div>
                    <div>
                        <dt className="text-ink-muted">Region</dt>
                        <dd className="mt-0.5 font-bold text-foreground uppercase">{server.region}</dd>
                    </div>
                    <div>
                        <dt className="text-ink-muted">Pool</dt>
                        <dd className="mt-0.5 font-bold text-foreground">shared-cpu</dd>
                    </div>
                    <div>
                        <dt className="text-ink-muted">Allowed range</dt>
                        <dd className="mt-0.5 font-mono font-bold text-foreground tabular-nums">
                            3000–3999
                        </dd>
                    </div>
                </dl>
            </section>

            {/* ---- contact id (ServerOverview.jsx) ---- */}
            <section className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-hairline bg-card p-5">
                <div className="min-w-0">
                    <span className="flex items-center gap-2 text-[0.82rem] font-semibold text-ink-secondary">
                        <LifeBuoy className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                        Server contact ID
                    </span>
                    <p className="mt-1.5 font-mono text-[1.35rem] leading-none font-extrabold tracking-[0.22em] text-foreground tabular-nums sm:text-[1.6rem]">
                        {server.contactCode}
                    </p>
                    <p className="mt-2 max-w-md text-[0.78rem] text-ink-secondary">
                        Quote this in a support ticket and an agent can find the server without your account.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => copy(server.contactCode, 'Contact ID')}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-hairline px-3.5 py-1.5 text-[0.78rem] font-bold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground"
                >
                    Copy ID
                </button>
            </section>

            {/* ---- resource tiles (ServerOverview.jsx) ---- */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-[0.95rem] font-semibold">Live metrics</h3>
                <SimulatedPill />
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
                <Tile
                    icon={Cpu}
                    label="CPU"
                    color={COLORS.cpu}
                    value={fmtPct(metrics.cpu)}
                    sub={`of ${(server.cpuMilli / 1000).toFixed(1)} vCPU limit`}
                >
                    <Sparkline values={series.cpu} color={COLORS.cpu} max={100} />
                </Tile>

                <Tile
                    icon={MemoryStick}
                    label="Memory"
                    color={COLORS.mem}
                    value={fmtBytes(metrics.memUsed)}
                    sub={`${fmtPct(metrics.memPct)} of ${fmtBytes(metrics.memLimit)}`}
                >
                    <Bar pct={metrics.memPct} color={COLORS.mem} />
                </Tile>

                <Tile
                    icon={HardDrive}
                    label="Disk"
                    color={COLORS.disk}
                    value={fmtBytes(metrics.diskUsed)}
                    sub={`${fmtPct(metrics.diskPct)} of ${fmtBytes(metrics.diskLimit)}`}
                >
                    <Bar pct={metrics.diskPct} color={COLORS.disk} />
                </Tile>

                <Tile
                    icon={Network}
                    label="Network"
                    color={COLORS.rx}
                    value={fmtRate(metrics.rx + metrics.tx)}
                    sub={
                        <span className="inline-flex items-center gap-2.5">
                            <span className="inline-flex items-center gap-0.5">
                                <ArrowDown className="size-3" style={{ color: COLORS.rx }} />
                                {fmtRate(metrics.rx)}
                            </span>
                            <span className="inline-flex items-center gap-0.5">
                                <ArrowUp className="size-3" style={{ color: COLORS.tx }} />
                                {fmtRate(metrics.tx)}
                            </span>
                        </span>
                    }
                >
                    <Sparkline values={series.net} color={COLORS.rx} />
                </Tile>
            </div>

            {/* ---- limits + quick actions ---- */}
            {/* `items-start` keeps the two panels at their natural height —
                "Resource limits" has 3 rows and "Configuration" 5, so without
                it the grid stretches the short one and leaves dead space.
                ServerOverview.jsx carries the identical rule; keep them in sync. */}
            <div className="grid items-start gap-4 lg:grid-cols-2">
                <Panel title="Resource limits" icon={Cpu}>
                    <div className="flex flex-col gap-5">
                        <LimitRow
                            icon={Cpu}
                            color={COLORS.cpu}
                            label="CPU"
                            used={fmtPct(metrics.cpu)}
                            limit={`${(server.cpuMilli / 1000).toFixed(1)} vCPU`}
                            pct={metrics.cpu}
                        />
                        <LimitRow
                            icon={MemoryStick}
                            color={COLORS.mem}
                            label="Memory"
                            used={fmtBytes(metrics.memUsed)}
                            limit={fmtBytes(metrics.memLimit)}
                            pct={metrics.memPct}
                        />
                        <LimitRow
                            icon={HardDrive}
                            color={COLORS.disk}
                            label="Storage"
                            used={fmtBytes(metrics.diskUsed)}
                            limit={fmtBytes(metrics.diskLimit)}
                            pct={metrics.diskPct}
                        />
                    </div>
                </Panel>

                <Panel title="Configuration" icon={ServerIcon}>
                    <div className="divide-y divide-hairline">
                        <Row label="Startup command">
                            <code className="min-w-0 truncate rounded-md bg-white/[0.05] px-2 py-1 font-mono text-[0.78rem]">
                                {server.startup}
                            </code>
                        </Row>
                        <Row label="Runtime">{server.runtimeLabel}</Row>
                        <Row label="Main file">
                            <code className="font-mono text-[0.8rem]">{server.mainFile}</code>
                        </Row>
                        <Row label="Auto-restart">{server.autoRestart ? 'On' : 'Off'}</Row>
                        <Row label="Server ID">
                            <code className="min-w-0 truncate font-mono text-[0.76rem] text-ink-secondary">
                                {server.id}
                            </code>
                        </Row>
                    </div>
                </Panel>
            </div>

            {/* ---- quick actions (ServerOverview.jsx) ---- */}
            <div className="grid grid-cols-2 gap-2.5">
                {[
                    ['console', 'Console', Terminal, COLORS.cpu],
                    ['files', 'Files', Folder, COLORS.disk],
                    ['backups', 'Backups', Database, COLORS.mem],
                    ['settings', 'Settings', SettingsIcon, COLORS.neutral],
                ].map(([tab, label, Icon, color]) => (
                    <button
                        key={tab}
                        type="button"
                        onClick={() => onNavigate(tab)}
                        className="group flex items-center gap-2.5 rounded-xl border border-hairline bg-white/[0.02] px-3 py-3 text-left transition hover:border-hairline-hover hover:bg-white/[0.06]"
                    >
                        <Icon className="size-4 shrink-0" style={{ color }} aria-hidden="true" />
                        <span className="flex-1 text-[0.85rem] font-semibold">{label}</span>
                        <ChevronRight
                            className="size-3.5 shrink-0 text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-foreground"
                            aria-hidden="true"
                        />
                    </button>
                ))}
            </div>

            {reduced && (
                <p className="text-[0.72rem] text-ink-muted">
                    Charts are frozen because your system asks for reduced motion.
                </p>
            )}
        </div>
    );
}