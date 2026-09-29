import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Play, Plus, RotateCcw, Square } from 'lucide-react';

import { cn } from '@/lib/utils';
import { SERVERS } from '@/data/dashboard.js';
import { STATUS_STYLE } from './Overview.jsx';
import { IconBun, IconNode, IconPhp, IconPython } from '../../components/icons.jsx';

export const RUNTIME_ICONS = {
    'Node.js': IconNode,
    Bun: IconBun,
    Python: IconPython,
    PHP: IconPhp,
};

function Meter({ label, value }) {
    return (
        <div className="flex items-center gap-2">
            <span className="w-10 font-mono text-[0.72rem] text-ink-muted uppercase">{label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                <div
                    className="h-full rounded-full bg-white transition-[width]"
                    style={{ width: `${Math.min(100, value)}%` }}
                />
            </div>
            <span className="w-10 text-right font-mono text-[0.72rem] text-ink-secondary">
                {value}%
            </span>
        </div>
    );
}

export default function Servers() {
    const navigate = useNavigate();
    const [servers, setServers] = useState(SERVERS);

    const patch = (id, data) =>
        setServers((list) => list.map((s) => (s.id === id ? { ...s, ...data } : s)));

    const start = (id) => patch(id, { status: 'online', uptime: 'just now' });
    const stop = (id) => patch(id, { status: 'offline', cpu: 0, ram: 0, uptime: '—' });
    const restart = (id) => {
        patch(id, { status: 'restarting' });
        setTimeout(() => patch(id, { status: 'online', uptime: 'just now' }), 2000);
    };

    const actionBtn =
        'inline-flex items-center gap-1.5 rounded-md border border-hairline bg-veil px-3 py-1.5 text-[0.8rem] font-semibold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40';

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-[1.6rem] font-extrabold tracking-tight">Servers</h1>
                    <p className="mt-1 text-[0.92rem] text-ink-secondary">
                        {servers.filter((s) => s.status === 'online').length} of {servers.length}{' '}
                        online
                    </p>
                </div>
                <button type="button" className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:bg-gray-200">
                    <Plus className="size-4" /> New server
                </button>
            </div>

            <div className="flex flex-col gap-3">
                {servers.map((server) => {
                    const RuntimeIcon = RUNTIME_ICONS[server.runtime];
                    return (
                    <div
                        key={server.id}
                        onClick={() => navigate(`/dashboard/servers/${server.id}`)}
                        className="relative cursor-pointer overflow-hidden rounded-xl border border-hairline bg-card p-5 transition hover:border-hairline-hover"
                    >
                        {/* Runtime logo watermark */}
                        {RuntimeIcon && (
                            <div
                                aria-hidden="true"
                                className="pointer-events-none absolute top-1/2 left-1/2 size-56 -translate-x-1/2 -translate-y-1/2 opacity-[0.07]"
                            >
                                <RuntimeIcon className="size-full" />
                            </div>
                        )}
                        <div className="relative">
                        <div className="flex flex-wrap items-center gap-3">
                            <span
                                className={cn(
                                    'size-2.5 shrink-0 animate-beat rounded-full',
                                    STATUS_STYLE[server.status]
                                )}
                            />
                            <span className="font-mono text-[0.95rem] font-bold">
                                <Link
                                    to={`/dashboard/servers/${server.id}`}
                                    className="transition hover:text-white hover:underline hover:underline-offset-4"
                                >
                                    {server.name}
                                </Link>
                            </span>
                            <span className="rounded-full border border-hairline bg-veil px-2 py-0.5 text-[0.72rem] font-semibold text-ink-secondary">
                                {server.runtime}
                            </span>
                            <span className="font-mono text-[0.75rem] text-ink-muted capitalize">
                                {server.status}
                            </span>
                            <div className="ml-auto flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                <button
                                    type="button"
                                    aria-label={`Start ${server.name}`}
                                    disabled={server.status !== 'offline'}
                                    onClick={() => start(server.id)}
                                    className={actionBtn}
                                >
                                    <Play className="size-3.5" /> Start
                                </button>
                                <button
                                    type="button"
                                    aria-label={`Restart ${server.name}`}
                                    disabled={server.status !== 'online'}
                                    onClick={() => restart(server.id)}
                                    className={actionBtn}
                                >
                                    <RotateCcw className="size-3.5" /> Restart
                                </button>
                                <button
                                    type="button"
                                    aria-label={`Stop ${server.name}`}
                                    disabled={server.status !== 'online'}
                                    onClick={() => stop(server.id)}
                                    className={actionBtn}
                                >
                                    <Square className="size-3.5" /> Stop
                                </button>
                            </div>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3 max-md:grid-cols-1">
                            <Meter label="CPU" value={server.cpu} />
                            <Meter label="RAM" value={server.ram} />
                        </div>
                        </div>
                    </div>
                    );
                })}
            </div>
        </div>
    );
}
