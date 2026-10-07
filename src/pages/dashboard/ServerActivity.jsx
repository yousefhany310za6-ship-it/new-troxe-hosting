import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Database,
  Globe,
  History,
  MonitorSmartphone,
  Play,
  Plus,
  RotateCcw,
  Settings as SettingsIcon,
  Square,
  Terminal,
  Trash2,
  Wrench,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { apiGet } from '@/lib/api.js';
import { AvatarBadge } from '@/components/AvatarBadge.jsx';
import { Flag } from '@/components/ui/flag.jsx';

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

const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// action -> icon, tone, English title
const ACTION_META = {
  'server.create': { Icon: Plus, tone: 'text-sky-300', title: 'Server created' },
  'server.update': { Icon: SettingsIcon, tone: 'text-violet-300', title: 'Settings updated' },
  'server.delete': { Icon: Trash2, tone: 'text-red-300', title: 'Server deleted' },
  'server.start': { Icon: Play, tone: 'text-emerald-300', title: 'Server started' },
  'server.stop': { Icon: Square, tone: 'text-zinc-300', title: 'Server stopped' },
  'server.restart': { Icon: RotateCcw, tone: 'text-sky-300', title: 'Server restarted' },
  'server.reinstall': { Icon: Wrench, tone: 'text-amber-300', title: 'Server reinstalled' },
  'server.backup.create': { Icon: Database, tone: 'text-emerald-300', title: 'Backup created' },
  'server.backup.delete': { Icon: Trash2, tone: 'text-red-300', title: 'Backup deleted' },
  'server.backup.restore': { Icon: History, tone: 'text-amber-300', title: 'Backup restored' },
  'server.exec.open': { Icon: Terminal, tone: 'text-sky-300', title: 'Console opened' },
  'server.exec.close': { Icon: Terminal, tone: 'text-ink-secondary', title: 'Console closed' },
};

function actionMeta(action) {
  if (ACTION_META[action]) return ACTION_META[action];
  return { Icon: Activity, tone: 'text-ink-secondary', title: String(action ?? 'Activity').replace(/[._]/g, ' ') };
}

function describe(ev) {
  const d = ev.detail ?? {};
  const bits = [];
  if (d.reason && d.reason !== 'exit') bits.push(`reason: ${d.reason}`);
  if (d.code !== undefined && d.code !== null) bits.push(`code ${d.code}`);
  if (d.sizeBytes) {
    const mb = Number(d.sizeBytes) / 1048576;
    bits.push(mb >= 1 ? `${mb.toFixed(mb < 10 ? 1 : 0)} MB` : `${Math.round(Number(d.sizeBytes) / 1024)} KB`);
  }
  if (d.status) bits.push(String(d.status));
  return bits.join(' · ');
}

/**
 * Server activity trail: every recorded action on this server — who did it
 * (avatar + name), from which IP and country, and when.
 */
export default function ServerActivity({ server }) {
  const [items, setItems] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await apiGet(`/servers/${server.id}/activity?limit=50`);
        if (alive) setItems(Array.isArray(res?.data) ? res.data : []);
      } catch {
        if (alive) setItems((prev) => prev ?? []);
      }
    };
    load();
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [server.id]);

  return (
    <section className="flex flex-col rounded-2xl border border-hairline bg-card">
      <header className="flex items-center gap-2.5 border-b border-hairline px-5 py-3.5">
        <Activity className="size-4 text-ink-muted" />
        <h3 className="flex-1 text-[0.92rem] font-semibold">Activity</h3>
        {items?.length ? <span className="text-[0.72rem] text-ink-muted">{items.length} latest</span> : null}
      </header>
      <div className="flex-1 p-3 sm:p-4">
        {items === null ? (
          <div className="flex flex-col gap-3 p-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="size-9 shrink-0 animate-pulse rounded-full bg-white/[0.06]" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/3 animate-pulse rounded bg-white/[0.06]" />
                  <div className="h-2.5 w-1/2 animate-pulse rounded bg-white/[0.04]" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <span className="flex size-11 items-center justify-center rounded-full border border-hairline bg-veil">
              <Activity className="size-5 text-ink-muted" />
            </span>
            <p className="text-[0.9rem] font-semibold">No activity yet</p>
            <p className="max-w-xs text-[0.8rem] text-ink-muted">
              Starts, backups, console sessions and setting changes will show up here with who did them.
            </p>
          </div>
        ) : (
          <ol className="relative flex flex-col">
            <span aria-hidden="true" className="absolute top-2 bottom-2 left-[29px] w-px bg-hairline sm:left-[31px]" />
            {items.map((ev) => {
              const meta = actionMeta(ev.action);
              const extra = describe(ev);
              const actorName = ev.actor?.name || 'System';
              return (
                <li key={ev.id} className="relative flex items-start gap-3 px-2 py-2.5">
                  <AvatarBadge
                    url={ev.actor?.avatarUrl}
                    name={actorName}
                    size="size-9"
                    text="text-sm"
                    className="relative z-10 ring-2 ring-card"
                  />
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.86rem]">
                      <span className="truncate font-semibold">{actorName}</span>
                      <span className={cn('inline-flex items-center gap-1 text-ink-secondary', meta.tone)}>
                        <meta.Icon size={13} />
                        {meta.title}
                      </span>
                    </p>
                    {extra && <p className="mt-0.5 truncate font-mono text-[0.72rem] text-ink-muted">{extra}</p>}
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.74rem] text-ink-muted">
                      {ev.ip ? (
                        <span className="inline-flex items-center gap-1.5">
                          <MonitorSmartphone size={12} className="shrink-0" />
                          <code className="font-mono tabular-nums" dir="ltr">{ev.ip}</code>
                          <Flag code={ev.countryCode} name={ev.country ?? 'Unknown location'} className="w-5" />
                          {ev.country ? <span className="max-w-40 truncate">{ev.country}</span> : <span>Unknown location</span>}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <Globe size={12} className="shrink-0" />
                          No IP recorded
                        </span>
                      )}
                      <span aria-hidden="true" className="text-hairline">·</span>
                      <time dateTime={ev.createdAt} title={fmtDateTime(ev.createdAt)} className="tabular-nums">
                        {timeAgo(ev.createdAt)}
                      </time>
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <footer className="flex items-center gap-2 border-t border-hairline px-5 py-2.5 text-[0.72rem] text-ink-muted">
        <AlertTriangle size={12} className="shrink-0" />
        Console sessions record open and close only — keystrokes are never logged.
      </footer>
    </section>
  );
}
