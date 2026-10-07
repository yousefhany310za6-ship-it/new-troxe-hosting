import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Cpu,
  Crown,
  HardDrive,
  MemoryStick,
  Network,
  Server as ServerIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useLiveStats } from '@/hooks/useLiveStats.js';

const COLORS = {
  cpu: '#38bdf8',
  mem: '#a78bfa',
  rx: '#4ade80',
  tx: '#fb923c',
  disk: '#fbbf24',
};

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

// ---- building blocks ------------------------------------------------------------

function Card({ icon: Icon, title, accent, right, children, className }) {
  return (
    <section className={cn('flex flex-col gap-4 rounded-2xl border border-hairline bg-card p-5', className)}>
      <header className="flex items-center gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-hairline bg-veil"
          style={{ color: accent }}
        >
          <Icon className="size-[18px]" />
        </span>
        <h3 className="min-w-0 flex-1 truncate text-[1rem] font-semibold">{title}</h3>
        {right}
      </header>
      {children}
    </section>
  );
}

/** Circular progress with the value in the middle. */
function Ring({ pct, color, text }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-14 shrink-0">
      <svg viewBox="0 0 56 56" className="size-full -rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="4" />
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${(c * p) / 100} ${c}`}
          style={{ transition: 'stroke-dasharray .6s ease' }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[0.72rem] font-bold tabular-nums">{text}</span>
    </div>
  );
}

function Trio({ items }) {
  return (
    <dl className="grid grid-cols-3 gap-2 text-center">
      {items.map(([label, value, color]) => (
        <div key={label} className="min-w-0">
          <dt className="flex items-center justify-center gap-1.5 text-[0.68rem] font-semibold tracking-[0.12em] text-ink-muted uppercase">
            {color && <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />}
            {label}
          </dt>
          <dd className="mt-1 truncate text-[0.88rem] font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Responsive multi-series area/line chart (SVG, no dependencies). */
function LineChart({ series, max, empty }) {
  const W = 300;
  const H = 100;
  // spread the samples over the full width as soon as there are a few of them
  // (a fixed 60-slot axis would squeeze early data against the right edge)
  const span = (values) => Math.max(values.length - 1, 7);
  const build = (values) => {
    const sp = span(values);
    const pts = values.map((v, i) => [(i / sp) * W, H - 2 - Math.min(1, Math.max(0, v / max)) * (H - 6)]);
    if (!pts.length) return null;
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${H} L${pts[0][0].toFixed(1)} ${H} Z`;
    return { line, area };
  };
  const hasData = series.some((s) => s.values.length > 1);
  return (
    <div className="relative h-32 w-full overflow-hidden rounded-xl bg-white/[0.02]">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full">
        <defs>
          {series.map((s) => (
            <linearGradient key={s.id} id={`g-${s.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {[25, 50, 75].map((y) => (
          <line key={y} x1="0" x2={W} y1={y} y2={y} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
        ))}
        {series.map((s) => {
          const p = build(s.values);
          if (!p || s.values.length < 2) return null;
          return (
            <g key={s.id}>
              <path d={p.area} fill={`url(#g-${s.id})`} />
              <path d={p.line} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
        {!hasData && <line x1="0" x2={W} y1={H - 2} y2={H - 2} stroke="rgba(255,255,255,0.12)" vectorEffect="non-scaling-stroke" />}
      </svg>
      {!hasData && (
        <span className="absolute inset-0 flex items-center justify-center text-[0.75rem] text-ink-muted">{empty}</span>
      )}
    </div>
  );
}

/** Horizontal bar with quarter ticks. */
function SegmentedBar({ pct, color }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <div className="relative h-3 w-full overflow-hidden rounded-full bg-white/[0.07]">
      <div
        className="h-full rounded-full"
        style={{ width: `${p}%`, background: `linear-gradient(90deg, ${color}99, ${color})`, transition: 'width .6s ease' }}
      />
      {[25, 50, 75].map((t) => (
        <span key={t} className="absolute top-0 h-full w-px bg-black/70" style={{ left: `${t}%` }} />
      ))}
    </div>
  );
}

/** Semicircle gauge with the used value in the middle. */
function Gauge({ pct, color, value, caption }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const R = 80;
  const len = Math.PI * R;
  const theta = Math.PI * (1 - p / 100);
  const dx = 100 + R * Math.cos(theta);
  const dy = 100 - R * Math.sin(theta);
  return (
    <div className="relative mx-auto w-full max-w-[260px]">
      <svg viewBox="0 0 200 112" className="w-full">
        <path d={`M ${100 - R} 100 A ${R} ${R} 0 0 1 ${100 + R} 100`} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="12" strokeLinecap="round" />
        <path
          d={`M ${100 - R} 100 A ${R} ${R} 0 0 1 ${100 + R} 100`}
          fill="none"
          stroke={color}
          strokeOpacity="0.9"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${(len * p) / 100} ${len}`}
          style={{ transition: 'stroke-dasharray .6s ease' }}
        />
        <circle cx={dx} cy={dy} r="7" fill={color} />
        <circle cx={dx} cy={dy} r="12" fill={color} opacity="0.18" />
      </svg>
      <div className="absolute inset-x-0 bottom-1 flex flex-col items-center">
        <span className="text-[1.6rem] leading-none font-bold tabular-nums">{value}</span>
        <span className="mt-1 text-[0.7rem] font-semibold tracking-[0.12em] text-ink-muted uppercase">{caption}</span>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono, children }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-hairline bg-white/[0.02] px-4 py-3">
      <span className="text-[0.82rem] text-ink-muted">{label}</span>
      {children ?? (
        <span className={cn('min-w-0 truncate text-[0.86rem] font-semibold', mono && 'font-mono')} title={typeof value === 'string' ? value : undefined}>
          {value}
        </span>
      )}
    </div>
  );
}

// ---- main -----------------------------------------------------------------------

/**
 * Live resource cards for a server: CPU, memory, network I/O and disk (with
 * short client-side history), plus a compact "server information" card.
 * Samples reset whenever the server leaves the online state, so a restart
 * starts clean — same as the console output next to it.
 */
export default function ResourceMonitor({ server, status, usage }) {
  const online = status === 'online';
  const { samples, mode } = useLiveStats(server, online);

  const last = samples[samples.length - 1];
  const cpuSeries = useMemo(() => samples.map((s) => s.cpu), [samples]);
  const cpuStats = useMemo(() => {
    if (!cpuSeries.length) return { min: 0, max: 0, avg: 0 };
    return {
      min: Math.min(...cpuSeries),
      max: Math.max(...cpuSeries),
      avg: cpuSeries.reduce((a, b) => a + b, 0) / cpuSeries.length,
    };
  }, [cpuSeries]);
  const cpuMax = Math.max(10, Math.min(100, cpuStats.max * 1.4));

  const rxSeries = useMemo(() => samples.map((s) => s.rxRate), [samples]);
  const txSeries = useMemo(() => samples.map((s) => s.txRate), [samples]);
  const netMax = Math.max(1024, ...rxSeries, ...txSeries) * 1.3;

  const memLimit = last?.memLimit || (server.ramMb ?? 0) * 1048576;
  const memUsed = last?.mem ?? 0;
  const memPct = memLimit ? Math.min(100, (memUsed / memLimit) * 100) : 0;

  const diskLimit = usage?.limitBytes ?? (server.storageGb ?? 0) * 1024 ** 3;
  const diskUsed = usage?.usedBytes ?? 0;
  const diskPct = diskLimit ? Math.min(100, (diskUsed / diskLimit) * 100) : 0;

  const emptyHint = online ? 'Collecting data…' : 'Server is offline';
  const rxNow = last?.rxRate ?? 0;
  const txNow = last?.txRate ?? 0;

  const MODES = {
    live: { dot: 'animate-beat bg-emerald-500', text: 'text-emerald-300', ring: 'border-emerald-500/25 bg-emerald-500/10', label: 'Live · updates every second' },
    poll: { dot: 'animate-beat bg-amber-500', text: 'text-amber-300', ring: 'border-amber-500/25 bg-amber-500/10', label: 'Reconnecting · refreshing every 4s' },
    idle: { dot: 'bg-zinc-500', text: 'text-ink-secondary', ring: 'border-hairline bg-veil', label: 'Server offline' },
  };
  const m = MODES[mode];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="flex items-center justify-between gap-3 md:col-span-2">
        <h2 className="text-[0.95rem] font-semibold">Resources</h2>
        <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.72rem] font-semibold', m.ring, m.text)}>
          <span className={cn('size-1.5 rounded-full', m.dot)} />
          {m.label}
        </span>
      </div>
      <Card
        icon={Cpu}
        title="CPU Usage"
        accent={COLORS.cpu}
        right={<Ring pct={last?.cpu ?? 0} color={COLORS.cpu} text={fmtPct(last?.cpu ?? 0)} />}
      >
        <LineChart series={[{ id: 'cpu', color: COLORS.cpu, values: cpuSeries }]} max={cpuMax} empty={emptyHint} />
        <Trio items={[['Min', fmtPct(cpuStats.min)], ['Max', fmtPct(cpuStats.max)], ['Avg', fmtPct(cpuStats.avg)]]} />
      </Card>

      <Card
        icon={MemoryStick}
        title="Memory Usage"
        accent={COLORS.mem}
        right={<Ring pct={memPct} color={COLORS.mem} text={fmtPct(memPct)} />}
      >
        <div className="flex flex-1 flex-col justify-center gap-3 py-6">
          <SegmentedBar pct={memPct} color={COLORS.mem} />
          <div className="flex justify-between text-[0.68rem] text-ink-muted tabular-nums">
            <span>0</span>
            <span>{fmtBytes(memLimit / 2)}</span>
            <span>{fmtBytes(memLimit)}</span>
          </div>
        </div>
        <Trio items={[['Used', fmtBytes(memUsed)], ['Free', fmtBytes(Math.max(0, memLimit - memUsed))], ['Total', fmtBytes(memLimit)]]} />
      </Card>

      <Card
        icon={Network}
        title="Network I/O"
        accent={COLORS.rx}
        right={<span className="text-[1.15rem] font-bold tabular-nums">{fmtRate(rxNow + txNow)}</span>}
      >
        <LineChart
          series={[
            { id: 'rx', color: COLORS.rx, values: rxSeries },
            { id: 'tx', color: COLORS.tx, values: txSeries },
          ]}
          max={netMax}
          empty={emptyHint}
        />
        <div className="flex items-center justify-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-veil px-3.5 py-1.5 text-[0.8rem] font-semibold tabular-nums">
            <ArrowDown className="size-3.5" style={{ color: COLORS.rx }} /> {fmtBytes(last?.rx ?? 0)}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-veil px-3.5 py-1.5 text-[0.8rem] font-semibold tabular-nums">
            <ArrowUp className="size-3.5" style={{ color: COLORS.tx }} /> {fmtBytes(last?.tx ?? 0)}
          </span>
        </div>
        <Trio
          items={[
            ['In', fmtRate(rxNow), COLORS.rx],
            ['Out', fmtRate(txNow), COLORS.tx],
            ['Total', fmtRate(rxNow + txNow)],
          ]}
        />
      </Card>

      <Card
        icon={HardDrive}
        title="Disk Usage"
        accent={COLORS.disk}
        right={<Ring pct={diskPct} color={COLORS.disk} text={fmtPct(diskPct)} />}
      >
        <div className="flex flex-1 items-center py-2">
          <Gauge pct={diskPct} color={COLORS.disk} value={fmtBytes(diskUsed).split(' ')[0]} caption={`${fmtBytes(diskUsed).split(' ')[1]} used`} />
        </div>
        <Trio items={[['Used', fmtBytes(diskUsed)], ['Free', fmtBytes(Math.max(0, diskLimit - diskUsed))], ['Total', fmtBytes(diskLimit)]]} />
      </Card>

      <Card icon={ServerIcon} title="Server Information" accent="#94a3b8" className="md:col-span-2">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <InfoRow label="Name" value={server.name} mono />
          <InfoRow label="Runtime" value={server.runtimeLabel ?? server.runtime} />
          <InfoRow label="Node" value={`${server.nodeId ?? 'local'}${server.region ? ` · ${server.region}` : ''}`} />
          <InfoRow label="Limits" value={`${(server.cpuMilli ?? 0) / 1000} vCPU · ${server.ramMb} MB · ${server.storageGb} GB`} />
          <InfoRow label="Startup" value={server.startup || '—'} mono />
          <InfoRow label="Auto-restart" value={server.autoRestart ? 'On' : 'Off'} />
        </div>
        <Link
          to="/pricing"
          className="group flex items-center gap-3 rounded-xl border border-hairline bg-white/[0.02] px-4 py-3 transition hover:border-hairline-hover hover:bg-white/[0.05]"
        >
          <span className="flex size-9 items-center justify-center rounded-lg border border-hairline bg-veil text-amber-300">
            <Crown className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[0.9rem] font-semibold">Upgrade your plan</span>
            <span className="block truncate text-[0.76rem] text-ink-muted">
              Current plan: <span className="capitalize">{server.planId ?? 'free'}</span> — more CPU, RAM and storage
            </span>
          </span>
          <ChevronRight className="size-4 text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-foreground" />
        </Link>
      </Card>
    </div>
  );
}
