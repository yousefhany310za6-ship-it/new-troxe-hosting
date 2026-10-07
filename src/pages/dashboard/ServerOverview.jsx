import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  Cpu,
  Crown,
  Database,
  Folder,
  HardDrive,
  MemoryStick,
  Network,
  Play,
  Plus,
  Power,
  RotateCcw,
  Settings as SettingsIcon,
  Square,
  Terminal,
  Wrench,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { apiGet } from '@/lib/api.js';
import { useLiveStats } from '@/hooks/useLiveStats.js';

// ---- formatting -----------------------------------------------------------------

function fmtBytes(n) {
  const v0 = Number(n) || 0;
  if (v0 <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = v0;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

function fmtRate(bps) {
  const v0 = Number(bps) || 0;
  if (v0 < 1) return '0 B/s';
  const u = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let v = v0;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 2 : v < 100 && i > 0 ? 1 : 0)} ${u[i]}`;
}

const fmtPct = (p) => `${(Number(p) || 0).toFixed(Number(p) > 0 && Number(p) < 10 ? 1 : 0)}%`;

function fmtUptime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function timeAgo(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// ---- status presentation --------------------------------------------------------

const STATUS = {
  online: { label: 'Online', glow: '16,185,129', dot: 'bg-emerald-500', text: 'text-emerald-300', ring: 'border-emerald-500/30 bg-emerald-500/10' },
  offline: { label: 'Offline', glow: '113,113,122', dot: 'bg-zinc-500', text: 'text-ink-secondary', ring: 'border-hairline bg-veil' },
  restarting: { label: 'Restarting', glow: '245,158,11', dot: 'bg-amber-500', text: 'text-amber-300', ring: 'border-amber-500/30 bg-amber-500/10' },
  provisioning: { label: 'Provisioning', glow: '59,130,246', dot: 'bg-blue-500', text: 'text-blue-300', ring: 'border-blue-500/30 bg-blue-500/10' },
  error: { label: 'Error', glow: '239,68,68', dot: 'bg-red-500', text: 'text-red-300', ring: 'border-red-500/30 bg-red-500/10' },
};

const COLORS = { cpu: '#38bdf8', mem: '#a78bfa', disk: '#fbbf24', rx: '#4ade80', tx: '#fb923c' };

// event type -> icon, tone, title
const EVENT_META = {
  create: { Icon: Plus, tone: 'text-sky-300', title: 'Server created' },
  start: { Icon: Play, tone: 'text-emerald-300', title: 'Server started' },
  stop: { Icon: Square, tone: 'text-zinc-300', title: 'Server stopped' },
  restart: { Icon: RotateCcw, tone: 'text-sky-300', title: 'Server restarted' },
  update: { Icon: SettingsIcon, tone: 'text-violet-300', title: 'Settings updated' },
  reinstall: { Icon: Wrench, tone: 'text-amber-300', title: 'Server reinstalled' },
  rebuild: { Icon: Wrench, tone: 'text-amber-300', title: 'Server rebuilt' },
  provision_error: { Icon: AlertTriangle, tone: 'text-red-300', title: 'Provisioning failed' },
};

function eventMeta(type) {
  if (EVENT_META[type]) return EVENT_META[type];
  if (type?.endsWith('_error')) {
    const verb = type.replace(/_error$/, '');
    return { Icon: AlertTriangle, tone: 'text-red-300', title: `${verb.charAt(0).toUpperCase()}${verb.slice(1)} failed` };
  }
  return { Icon: Activity, tone: 'text-ink-secondary', title: (type ?? 'Event').replace(/_/g, ' ') };
}

function eventDetail(e) {
  const d = e.detail ?? {};
  if (d.error) return String(d.error);
  const bits = [d.runtime, d.plan && `${d.plan} plan`, d.region].filter(Boolean);
  return bits.join(' · ');
}

// ---- small building blocks ------------------------------------------------------

function Sparkline({ values, color, max }) {
  const W = 100;
  const H = 32;
  const data = values.slice(-40);
  if (data.length < 2) return <div className="h-8 w-full rounded-md bg-white/[0.03]" />;
  const top = Math.max(max ?? 0, ...data, 0.0001);
  const span = Math.max(data.length - 1, 7);
  const pts = data.map((v, i) => [(i / span) * W, H - 1 - (Math.max(0, v) / top) * (H - 3)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${H} L0 ${H} Z`;
  const id = `sp-${color.slice(1)}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-8 w-full">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Bar({ pct, color }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
      <div
        className="h-full rounded-full"
        style={{ width: `${p}%`, background: `linear-gradient(90deg, ${color}99, ${color})`, transition: 'width .6s ease' }}
      />
    </div>
  );
}

function Tile({ icon: Icon, label, value, sub, color, children }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-hairline bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-hairline bg-veil" style={{ color }}>
          <Icon className="size-4" />
        </span>
        <span className="text-[0.8rem] font-semibold text-ink-secondary">{label}</span>
      </div>
      <div>
        <p className="truncate text-[1.45rem] leading-none font-bold tabular-nums">{value}</p>
        <p className="mt-1.5 truncate text-[0.74rem] text-ink-muted">{sub}</p>
      </div>
      {children}
    </div>
  );
}

function Panel({ title, icon: Icon, right, children, className }) {
  return (
    <section className={cn('flex flex-col rounded-2xl border border-hairline bg-card', className)}>
      <header className="flex items-center gap-2.5 border-b border-hairline px-5 py-3.5">
        {Icon && <Icon className="size-4 text-ink-muted" />}
        <h3 className="flex-1 text-[0.92rem] font-semibold">{title}</h3>
        {right}
      </header>
      <div className="flex-1 p-5">{children}</div>
    </section>
  );
}

function Pill({ on, children }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.72rem] font-semibold',
        on ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-hairline bg-veil text-ink-secondary',
      )}
    >
      <span className={cn('size-1.5 rounded-full', on ? 'bg-emerald-500' : 'bg-zinc-500')} />
      {children}
    </span>
  );
}

function CopyButton({ text, label }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement('textarea');
      t.value = text;
      document.body.appendChild(t);
      t.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      t.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      title={label}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition hover:bg-white/10 hover:text-foreground"
    >
      {done ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="shrink-0 text-[0.82rem] text-ink-muted">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5 text-[0.85rem] font-semibold">{children}</div>
    </div>
  );
}

function LimitRow({ label, used, limit, pct, color, icon: Icon }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-[0.82rem]">
        <span className="inline-flex items-center gap-2 text-ink-secondary">
          <Icon className="size-3.5" style={{ color }} /> {label}
        </span>
        <span className="font-semibold tabular-nums">
          {used} <span className="font-normal text-ink-muted">/ {limit}</span>
        </span>
      </div>
      <Bar pct={pct} color={color} />
    </div>
  );
}

// ---- main -----------------------------------------------------------------------

/**
 * Server overview: status hero with uptime, live metric tiles, recent
 * activity, quick actions, backups summary, limits and configuration.
 */
export default function ServerOverview({ server, status, stats, usage, backups, onTab, onCreateBackup }) {
  const online = status === 'online';
  const st = STATUS[status] ?? STATUS.offline;
  const { samples, mode } = useLiveStats(server, online);
  const last = samples[samples.length - 1];

  // ---- uptime (ticks once per second while running) ----
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!online) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [online]);
  const startedMs = stats?.startedAt ? new Date(stats.startedAt).getTime() : null;
  const uptime = online && startedMs ? fmtUptime(now - startedMs) : null;

  // ---- recent activity ----
  const [events, setEvents] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await apiGet(`/servers/${server.id}/events?limit=12`);
        if (alive) setEvents(Array.isArray(data) ? data : []);
      } catch {
        if (alive) setEvents((e) => e ?? []);
      }
    };
    load();
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [server.id, status]);

  // ---- derived metrics ----
  const cpuSeries = useMemo(() => samples.map((s) => s.cpu), [samples]);
  const netSeries = useMemo(() => samples.map((s) => s.rxRate + s.txRate), [samples]);
  const memLimit = last?.memLimit || (server.ramMb ?? 0) * 1048576;
  const memUsed = last?.mem ?? 0;
  const memPct = memLimit ? Math.min(100, (memUsed / memLimit) * 100) : 0;
  const diskLimit = usage?.limitBytes ?? (server.storageGb ?? 0) * 1024 ** 3;
  const diskUsed = usage?.usedBytes ?? 0;
  const diskPct = diskLimit ? Math.min(100, (diskUsed / diskLimit) * 100) : 0;
  const cpuNow = last?.cpu ?? 0;
  const rxNow = last?.rxRate ?? 0;
  const txNow = last?.txRate ?? 0;
  const dash = '—';

  const latestBackup = backups?.find((b) => b.status === 'ready') ?? backups?.[0];
  const backupCount = backups?.length ?? 0;
  const vcpu = (server.cpuMilli ?? 0) / 1000;

  const heroSub = online
    ? uptime
      ? `Running for ${uptime}`
      : 'Running'
    : status === 'restarting'
      ? 'Restarting — this takes a few seconds'
      : status === 'provisioning'
        ? 'Setting up your server…'
        : status === 'error'
          ? 'Something went wrong — see the details below'
          : 'Stopped — start it from the controls above';

  return (
    <div className="flex flex-col gap-5">
      {/* ---- hero ---- */}
      <section
        className="relative overflow-hidden rounded-2xl border border-hairline bg-card p-5 sm:p-6"
        style={{ backgroundImage: `radial-gradient(700px circle at 0% 0%, rgba(${st.glow},0.14), transparent 60%)` }}
      >
        <div className="relative flex flex-wrap items-center gap-x-6 gap-y-4">
          <div className="flex min-w-0 items-center gap-4">
            <span className={cn('relative flex size-14 shrink-0 items-center justify-center rounded-2xl border', st.ring, st.text)}>
              <Power className="size-6" />
              {online && <span className="absolute -top-1 -right-1 size-3 animate-beat rounded-full border-2 border-black bg-emerald-500" />}
            </span>
            <div className="min-w-0">
              <p className={cn('text-[1.5rem] leading-none font-extrabold', st.text)}>{st.label}</p>
              <p className="mt-1.5 text-[0.85rem] text-ink-secondary tabular-nums">{heroSub}</p>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {[
              server.runtimeLabel ?? server.runtime,
              `${server.nodeId ?? 'local'}${server.region ? ` · ${server.region}` : ''}`,
              `${server.planId ?? 'free'} plan`,
              server.port ? `Port ${server.port}` : null,
            ]
              .filter(Boolean)
              .map((c) => (
                <span key={c} className="rounded-full border border-hairline bg-black/30 px-3 py-1 text-[0.76rem] font-semibold text-ink-secondary capitalize backdrop-blur">
                  {c}
                </span>
              ))}
          </div>
        </div>
      </section>

      {/* ---- error ---- */}
      {(status === 'error' || server.lastError) && server.lastError && (
        <section className="flex flex-wrap items-start gap-4 rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 text-red-300">
            <AlertTriangle className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.9rem] font-semibold text-red-200">Last error</p>
            <p className="mt-1 font-mono text-[0.82rem] break-words text-red-300">{server.lastError}</p>
          </div>
          <button
            type="button"
            onClick={() => onTab('console')}
            className="inline-flex items-center gap-1.5 rounded-full border border-red-400/30 px-3.5 py-1.5 text-[0.78rem] font-bold text-red-200 transition hover:bg-red-500/15"
          >
            <Terminal className="size-3.5" /> View console
          </button>
        </section>
      )}

      {/* ---- live metric tiles ---- */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[0.95rem] font-semibold">Live metrics</h2>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.72rem] font-semibold',
              mode === 'live' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : mode === 'poll' ? 'border-amber-500/25 bg-amber-500/10 text-amber-300' : 'border-hairline bg-veil text-ink-secondary',
            )}
          >
            <span className={cn('size-1.5 rounded-full', mode === 'live' ? 'animate-beat bg-emerald-500' : mode === 'poll' ? 'animate-beat bg-amber-500' : 'bg-zinc-500')} />
            {mode === 'live' ? 'Live' : mode === 'poll' ? 'Refreshing' : 'Offline'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <Tile icon={Cpu} label="CPU" color={COLORS.cpu} value={online ? fmtPct(cpuNow) : dash} sub={`of ${vcpu} vCPU limit`}>
            <Sparkline values={online ? cpuSeries : []} color={COLORS.cpu} max={100} />
          </Tile>
          <Tile icon={MemoryStick} label="Memory" color={COLORS.mem} value={online ? fmtBytes(memUsed) : dash} sub={`${online ? fmtPct(memPct) : '0%'} of ${fmtBytes(memLimit)}`}>
            <Bar pct={online ? memPct : 0} color={COLORS.mem} />
          </Tile>
          <Tile icon={HardDrive} label="Disk" color={COLORS.disk} value={fmtBytes(diskUsed)} sub={`${fmtPct(diskPct)} of ${fmtBytes(diskLimit)}`}>
            <Bar pct={diskPct} color={COLORS.disk} />
          </Tile>
          <Tile
            icon={Network}
            label="Network"
            color={COLORS.rx}
            value={online ? fmtRate(rxNow + txNow) : dash}
            sub={
              online ? (
                <span className="inline-flex items-center gap-2.5">
                  <span className="inline-flex items-center gap-0.5"><ArrowDown className="size-3" style={{ color: COLORS.rx }} />{fmtRate(rxNow)}</span>
                  <span className="inline-flex items-center gap-0.5"><ArrowUp className="size-3" style={{ color: COLORS.tx }} />{fmtRate(txNow)}</span>
                </span>
              ) : (
                'No traffic'
              )
            }
          >
            <Sparkline values={online ? netSeries : []} color={COLORS.rx} />
          </Tile>
        </div>
      </div>

      {/* ---- activity + side column ---- */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Panel
          title="Recent activity"
          icon={Activity}
          className="lg:col-span-2"
          right={events?.length ? <span className="text-[0.72rem] text-ink-muted">{events.length} latest</span> : null}
        >
          {events === null ? (
            <div className="flex flex-col gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="size-9 animate-pulse rounded-xl bg-white/[0.06]" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-1/3 animate-pulse rounded bg-white/[0.06]" />
                    <div className="h-2.5 w-1/2 animate-pulse rounded bg-white/[0.04]" />
                  </div>
                </div>
              ))}
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <span className="flex size-11 items-center justify-center rounded-full border border-hairline bg-veil">
                <Activity className="size-5 text-ink-muted" />
              </span>
              <p className="text-[0.9rem] font-semibold">No activity yet</p>
              <p className="text-[0.8rem] text-ink-muted">Starts, restarts and setting changes will show up here.</p>
            </div>
          ) : (
            <ol className="relative flex flex-col">
              <span aria-hidden="true" className="absolute top-2 bottom-2 left-[17px] w-px bg-hairline" />
              {events.map((e) => {
                const meta = eventMeta(e.type);
                const detail = eventDetail(e);
                const isErr = e.type?.endsWith('_error');
                return (
                  <li key={e.id} className="relative flex items-start gap-3 py-2">
                    <span className={cn('relative z-10 flex size-9 shrink-0 items-center justify-center rounded-xl border border-hairline bg-card', meta.tone)}>
                      <meta.Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className="text-[0.88rem] font-semibold">{meta.title}</p>
                      {detail && (
                        <p className={cn('mt-0.5 text-[0.76rem] break-words', isErr ? 'font-mono text-red-300/90' : 'text-ink-muted capitalize')}>{detail}</p>
                      )}
                    </div>
                    <time dateTime={e.createdAt} title={fmtDate(e.createdAt)} className="shrink-0 pt-1 text-[0.74rem] text-ink-muted tabular-nums">
                      {timeAgo(e.createdAt)}
                    </time>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel title="Quick actions" icon={Activity}>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                ['console', 'Console', Terminal, COLORS.cpu],
                ['files', 'Files', Folder, COLORS.disk],
                ['backups', 'Backups', Database, COLORS.mem],
                ['settings', 'Settings', SettingsIcon, '#94a3b8'],
              ].map(([id, label, Icon, color]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onTab(id)}
                  className="group flex items-center gap-2.5 rounded-xl border border-hairline bg-white/[0.02] px-3 py-3 text-left transition hover:border-hairline-hover hover:bg-white/[0.06]"
                >
                  <Icon className="size-4 shrink-0" style={{ color }} />
                  <span className="flex-1 text-[0.85rem] font-semibold">{label}</span>
                  <ChevronRight className="size-3.5 text-ink-muted transition group-hover:translate-x-0.5" />
                </button>
              ))}
            </div>
          </Panel>

          <Panel
            title="Backups"
            icon={Database}
            right={
              <button type="button" onClick={() => onTab('backups')} className="text-[0.74rem] font-semibold text-ink-secondary transition hover:text-foreground">
                View all
              </button>
            }
          >
            <div className="flex flex-col gap-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[1.6rem] leading-none font-bold tabular-nums">{backupCount}</p>
                  <p className="mt-1 text-[0.76rem] text-ink-muted">{backupCount === 1 ? 'snapshot' : 'snapshots'}</p>
                </div>
                <Pill on={!!server.autoBackup}>{server.autoBackup ? 'Auto-backup on' : 'Auto-backup off'}</Pill>
              </div>
              <p className="rounded-lg border border-hairline bg-white/[0.02] px-3 py-2 text-[0.78rem] text-ink-secondary">
                {latestBackup
                  ? `Latest: ${timeAgo(latestBackup.createdAt)} · ${fmtBytes(latestBackup.sizeBytes)} · ${latestBackup.type === 'auto' ? 'automatic' : 'manual'}`
                  : 'No backups yet'}
              </p>
              <button
                type="button"
                onClick={onCreateBackup}
                className="inline-flex items-center justify-center gap-1.5 rounded-full bg-white px-4 py-2 text-[0.8rem] font-bold text-black transition hover:bg-gray-200"
              >
                <Plus className="size-3.5" /> Create backup now
              </button>
            </div>
          </Panel>
        </div>
      </div>

      {/* ---- limits + configuration ---- */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title="Resource limits" icon={Cpu}>
          <div className="flex flex-col gap-5">
            <LimitRow icon={Cpu} color={COLORS.cpu} label="CPU" used={online ? fmtPct(cpuNow) : '0%'} limit={`${vcpu} vCPU`} pct={online ? cpuNow : 0} />
            <LimitRow icon={MemoryStick} color={COLORS.mem} label="Memory" used={online ? fmtBytes(memUsed) : '0 B'} limit={fmtBytes(memLimit)} pct={online ? memPct : 0} />
            <LimitRow icon={HardDrive} color={COLORS.disk} label="Storage" used={fmtBytes(diskUsed)} limit={fmtBytes(diskLimit)} pct={diskPct} />
          </div>
          <Link
            to="/pricing"
            className="group mt-5 flex items-center gap-3 rounded-xl border border-hairline bg-white/[0.02] px-4 py-3 transition hover:border-hairline-hover hover:bg-white/[0.05]"
          >
            <span className="flex size-9 items-center justify-center rounded-lg border border-hairline bg-veil text-amber-300">
              <Crown className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.88rem] font-semibold">Need more resources?</span>
              <span className="block truncate text-[0.76rem] text-ink-muted">
                Current plan: <span className="capitalize">{server.planId ?? 'free'}</span> — compare plans
              </span>
            </span>
            <ChevronRight className="size-4 text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-foreground" />
          </Link>
        </Panel>

        <Panel title="Configuration" icon={SettingsIcon}>
          <div className="divide-y divide-hairline">
            <Row label="Startup command">
              <code className="min-w-0 truncate rounded-md bg-white/[0.05] px-2 py-1 font-mono text-[0.78rem]" title={server.startup}>
                {server.startup || '—'}
              </code>
              {server.startup && <CopyButton text={server.startup} label="Copy startup command" />}
            </Row>
            <Row label="Runtime">{server.runtimeLabel ?? server.runtime}</Row>
            <Row label="Environment variables">{server.envCount ?? server.env?.length ?? 0}</Row>
            <Row label="Auto-restart">
              <Pill on={!!server.autoRestart}>{server.autoRestart ? 'On' : 'Off'}</Pill>
            </Row>
            <Row label="Auto-backup">
              <Pill on={!!server.autoBackup}>{server.autoBackup ? `Keep ${server.autoBackupRetain ?? 7}` : 'Off'}</Pill>
            </Row>
            <Row label="Created">{fmtDate(server.createdAt)}</Row>
            <Row label="Server ID">
              <code className="min-w-0 truncate font-mono text-[0.76rem] text-ink-secondary" title={server.id}>
                {server.id}
              </code>
              <CopyButton text={server.id} label="Copy server ID" />
            </Row>
          </div>
        </Panel>
      </div>
    </div>
  );
}
