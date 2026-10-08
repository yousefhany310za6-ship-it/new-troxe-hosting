import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  Download,
  Eraser,
  Maximize2,
  Minimize2,
  Play,
  RefreshCw,
  Terminal as TerminalIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useSocket } from '@/hooks/useWebSocket.jsx';

const b64d = (b) =>
  new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));

// A rejected-while-ghost slot clears server-side within one ping cycle, so a
// handful of spaced retries is enough; beyond that something is really wrong
// (a second tab genuinely holds the shell) and we stop hammering.
const BUSY_RETRIES = 8;
const BUSY_DELAY_MS = 3000;
// Transport drops (mobile blips, sleep/wake): bounded backoff, then a button.
// After the container stops (restart), wait this long for it to come back.
const RESTART_WAIT_TRIES = 15;
const RESTART_WAIT_MS = 2000;
const DROP_RETRIES = 5;
const dropDelay = (n) => Math.min(2000 * 2 ** n, 16000);

// ---- look & feel ---------------------------------------------------------------

const TERM_BG = '#07070a';
// Latin first (JetBrains Mono), then Arabic-capable system fonts so RTL logs render properly.
const FONT_STACK =
  "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Noto Sans Arabic', 'Segoe UI', Tahoma, monospace";

// 16-colour palette (ANSI 0-15), tuned for the dark console background
const PALETTE = [
  '#18181b', '#f87171', '#4ade80', '#fbbf24', '#60a5fa', '#c084fc', '#22d3ee', '#e4e4e7',
  '#71717a', '#fca5a5', '#86efac', '#fde68a', '#93c5fd', '#d8b4fe', '#67e8f9', '#fafafa',
];

// ANSI helpers used for our own status messages (256-colour)
const ansi = {
  reset: '\x1b[0m',
  dim: '\x1b[38;5;245m',
  red: '\x1b[38;5;203m',
  yellow: '\x1b[38;5;221m',
  green: '\x1b[38;5;78m',
  cyan: '\x1b[38;5;110m',
};

const LEVELS = [
  ['error', /(\berror\b|\berr!|\bfatal\b|exception|\bfailed\b|❌|EACCES|ENOENT|ENOTFOUND|ECONNREFUSED)/i],
  ['warn', /(\bwarn(ing)?\b|⚠|deprecated)/i],
  ['ok', /(✅|\bsuccess|\bready\b|\bstarted\b|\blistening\b)/i],
  ['sys', /^\[troxe\]/i],
];

/** Severity of a plain-text log line (null = neutral). */
function levelOf(line) {
  for (const [name, re] of LEVELS) if (re.test(line)) return name;
  return null;
}

function color256(n) {
  if (n < 16) return PALETTE[n];
  if (n < 232) {
    const k = n - 16;
    const v = (x) => (x ? 55 + x * 40 : 0);
    return `rgb(${v(Math.floor(k / 36))},${v(Math.floor(k / 6) % 6)},${v(k % 6)})`;
  }
  const g = 8 + (n - 232) * 10;
  return `rgb(${g},${g},${g})`;
}

/**
 * Minimal read-only log renderer (replaces a terminal emulator): HTML lines, so
 * Arabic/RTL text is shaped and ordered by the browser, selection/copy work
 * natively, and ANSI colours + carriage-return progress lines still behave.
 * Cursor movement sequences are ignored (this is an output viewer).
 */
class LogView {
  constructor(el, { max = 5000, onStick, onLines } = {}) {
    this.el = el;
    this.max = max;
    this.onStick = onStick;
    this.onLines = onLines;
    this.stick = true;
    this.line = null;
    this.span = null;
    this.overwrite = false;
    this.carry = '';
    this.queue = [];
    this.timer = null;
    this.sgr = {};
    this.disposed = false;
    this.onScroll = () => {
      const s = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      if (s !== this.stick) {
        this.stick = s;
        this.onStick?.(s);
      }
    };
    el.addEventListener('scroll', this.onScroll, { passive: true });
  }

  /** Queue raw output; parsing/DOM work is batched so bursts cost one reflow. */
  write(chunk) {
    if (this.disposed || !chunk) return;
    this.queue.push(chunk);
    if (!this.timer) this.timer = setTimeout(() => this._drain(), 16);
  }

  writeln(text = '') {
    this.write(`${text}\n`);
  }

  _drain() {
    this.timer = null;
    if (this.disposed) return;
    const data = this.queue.join('');
    this.queue = [];
    this._parse(data);
    if (this.stick) this.el.scrollTop = this.el.scrollHeight;
    this.onLines?.(this.el.childElementCount);
  }

  _parse(input) {
    const s = this.carry + input;
    this.carry = '';
    let text = '';
    const flush = () => {
      if (text) {
        this._text(text);
        text = '';
      }
    };
    for (let i = 0; i < s.length; ) {
      const ch = s[i];
      if (ch === '\x1b') {
        flush();
        const rest = s.slice(i, i + 256);
        let m = /^\x1b\[([0-9;:?]*)[ -/]*([@-~])/.exec(rest);
        if (m) {
          this._csi(m[1], m[2]);
          i += m[0].length;
          continue;
        }
        m = /^\x1b\][^\x07\x1b]*(\x07|\x1b\\)/.exec(rest) || /^\x1b[()][0-9A-Za-z]/.exec(rest) || /^\x1b[=>78MDEHc]/.exec(rest);
        if (m) {
          i += m[0].length;
          continue;
        }
        if (s.length - i < 64 && /^\x1b[[\]()]?[0-9;:?]*[ -/]*$/.test(rest)) {
          this.carry = s.slice(i); // sequence split across chunks
          break;
        }
        i += 1; // stray ESC
      } else if (ch === '\n') {
        flush();
        this._newline();
        i += 1;
      } else if (ch === '\r') {
        flush();
        this.overwrite = true;
        i += 1;
      } else if (ch === '\t' || ch >= ' ') {
        text += ch;
        i += 1;
      } else {
        i += 1; // other control chars
      }
    }
    flush();
  }

  _style() {
    const { fg, bg, bold, dim, italic, underline } = this.sgr;
    const out = [];
    if (fg) out.push(`color:${fg}`);
    if (bg) out.push(`background-color:${bg}`);
    if (bold) out.push('font-weight:700');
    if (dim) out.push('opacity:.7');
    if (italic) out.push('font-style:italic');
    if (underline) out.push('text-decoration:underline');
    return out.join(';');
  }

  _ensureLine() {
    if (this.line) return;
    const d = document.createElement('div');
    d.dir = 'auto';
    d.className = 'troxe-log-line';
    this.el.appendChild(d);
    this.line = d;
    this.span = null;
    while (this.el.childElementCount > this.max) this.el.removeChild(this.el.firstChild);
  }

  _text(t) {
    this._ensureLine();
    if (this.overwrite) {
      this._clearLine();
      this.overwrite = false;
    }
    const css = this._style();
    if (!this.span || this.span.dataset.css !== css) {
      const sp = document.createElement('span');
      sp.dataset.css = css;
      if (css) {
        sp.style.cssText = css;
        this.line.dataset.sgr = '1';
      }
      this.line.appendChild(sp);
      this.span = sp;
    }
    this.span.appendChild(document.createTextNode(t));
  }

  _clearLine() {
    if (!this.line) return;
    this.line.textContent = '';
    this.span = null;
    delete this.line.dataset.sgr;
  }

  _newline() {
    this._ensureLine();
    const l = this.line;
    if (!l.dataset.sgr) {
      const lvl = levelOf(l.textContent);
      if (lvl) l.classList.add(`lvl-${lvl}`);
    }
    this.line = null;
    this.span = null;
    this.overwrite = false;
  }

  _csi(params, cmd) {
    if (cmd === 'm') {
      const p = params.split(/[;:]/).map((x) => (x === '' ? 0 : Number(x)));
      for (let i = 0; i < p.length; i++) {
        const c = p[i];
        if (c === 0) this.sgr = {};
        else if (c === 1) this.sgr.bold = true;
        else if (c === 2) this.sgr.dim = true;
        else if (c === 3) this.sgr.italic = true;
        else if (c === 4) this.sgr.underline = true;
        else if (c === 22) { this.sgr.bold = false; this.sgr.dim = false; }
        else if (c === 23) this.sgr.italic = false;
        else if (c === 24) this.sgr.underline = false;
        else if (c >= 30 && c <= 37) this.sgr.fg = PALETTE[c - 30];
        else if (c >= 90 && c <= 97) this.sgr.fg = PALETTE[c - 90 + 8];
        else if (c === 39) this.sgr.fg = undefined;
        else if (c >= 40 && c <= 47) this.sgr.bg = PALETTE[c - 40];
        else if (c >= 100 && c <= 107) this.sgr.bg = PALETTE[c - 100 + 8];
        else if (c === 49) this.sgr.bg = undefined;
        else if (c === 38 || c === 48) {
          const key = c === 38 ? 'fg' : 'bg';
          if (p[i + 1] === 5) {
            this.sgr[key] = color256(p[i + 2] ?? 0);
            i += 2;
          } else if (p[i + 1] === 2) {
            this.sgr[key] = `rgb(${p[i + 2] ?? 0},${p[i + 3] ?? 0},${p[i + 4] ?? 0})`;
            i += 4;
          }
        }
      }
    } else if (cmd === 'K') {
      this._clearLine();
    } else if (cmd === 'J' && (params === '2' || params === '3')) {
      this.clear();
    }
    // every other CSI (cursor movement, modes) is irrelevant for a viewer
  }

  clear() {
    this.queue = [];
    this.carry = '';
    this.el.replaceChildren();
    this.line = null;
    this.span = null;
    this.overwrite = false;
    this.stick = true;
    this.onStick?.(true);
    this.onLines?.(0);
  }

  jumpToLatest() {
    this.stick = true;
    this.onStick?.(true);
    this.el.scrollTop = this.el.scrollHeight;
  }

  /** Plain text of everything shown (pending output included). */
  text() {
    if (this.timer) {
      clearTimeout(this.timer);
      this._drain();
    }
    return Array.from(this.el.children, (n) => n.textContent).join('\n');
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.el.removeEventListener('scroll', this.onScroll);
  }
}

const iconBtn =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary transition hover:bg-white/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-35';

const TONES = {
  live: { dot: 'animate-beat bg-emerald-500', text: 'text-emerald-300', ring: 'border-emerald-500/25 bg-emerald-500/10' },
  wait: { dot: 'animate-beat bg-amber-500', text: 'text-amber-300', ring: 'border-amber-500/25 bg-amber-500/10' },
  dead: { dot: 'bg-red-500', text: 'text-red-300', ring: 'border-red-500/25 bg-red-500/10' },
  idle: { dot: 'bg-zinc-500', text: 'text-ink-secondary', ring: 'border-hairline bg-veil' },
};

function StatusPill({ tone, label }) {
  const t = TONES[tone] ?? TONES.idle;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.72rem] font-semibold', t.ring, t.text)}>
      <span className={cn('size-1.5 rounded-full', t.dot)} />
      {label}
    </span>
  );
}

function IconButton({ label, onClick, disabled, children }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} className={iconBtn}>
      {children}
    </button>
  );
}

/** Shared window chrome for the live terminal and the offline view. */
function ConsoleFrame({ fullscreen, pill, actions, banner, footer, children }) {
  return (
    <section
      className={cn(
        'flex flex-col overflow-hidden border border-hairline shadow-[0_8px_40px_-12px_rgba(0,0,0,0.8)]',
        fullscreen ? 'fixed inset-0 z-[70] rounded-none' : 'rounded-xl',
      )}
      style={{ backgroundColor: TERM_BG }}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline bg-card px-4 py-2.5">
        <div className="flex items-center gap-2">
          <TerminalIcon className="size-4 text-ink-muted" />
          <h2 className="text-[0.85rem] font-semibold">Console</h2>
        </div>
        {pill}
        <div className="ml-auto flex items-center gap-0.5">{actions}</div>
      </header>
      {banner}
      <div className={cn('relative min-h-0', fullscreen ? 'flex-1' : 'h-[min(62vh,620px)] min-h-[320px]')}>{children}</div>
      {footer && (
        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline bg-card px-4 py-2 font-mono text-[0.7rem] text-ink-muted">
          {footer}
        </footer>
      )}
    </section>
  );
}

function downloadText(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function useFullscreen() {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [fullscreen]);
  return [fullscreen, setFullscreen];
}

/**
 * Console of a stopped server: last captured output in the same window, or a
 * clear empty state with a Start button.
 */
export function ConsoleOffline({ server, status, logs, onStart }) {
  const [fullscreen, setFullscreen] = useFullscreen();
  const ref = useRef(null);
  const lines = String(logs ?? '').split('\n').filter(Boolean);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs, fullscreen]);

  const tone = status === 'error' ? 'dead' : status === 'offline' ? 'idle' : 'wait';
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Offline';

  return (
    <ConsoleFrame
      fullscreen={fullscreen}
      pill={<StatusPill tone={tone} label={label} />}
      actions={
        <>
          <IconButton
            label="Download output"
            onClick={() => downloadText(`${server.name}-console.txt`, lines.join('\n'))}
            disabled={!lines.length}
          >
            <Download className="size-4" />
          </IconButton>
          <IconButton label={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'} onClick={() => setFullscreen((v) => !v)}>
            {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </IconButton>
        </>
      }
      footer={
        <>
          <span>/data@{server.name}</span>
          {lines.length > 0 && <span>{lines.length} lines</span>}
        </>
      }
    >
      {lines.length ? (
        <div ref={ref} className="troxe-log absolute inset-0 overflow-y-auto px-4 py-3 text-[0.78rem] leading-[1.5] sm:text-[0.8rem]" style={{ fontFamily: FONT_STACK }}>
          {lines.map((line, i) => {
            const lvl = levelOf(line);
            return (
              <div key={i} dir="auto" className={cn('troxe-log-line', lvl && `lvl-${lvl}`)}>
                {line}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="flex size-12 items-center justify-center rounded-full border border-hairline bg-veil">
            <TerminalIcon className="size-5 text-ink-muted" />
          </div>
          <div>
            <p className="text-[0.95rem] font-semibold">
              {status === 'offline' ? 'Server is offline' : 'Waiting for the server…'}
            </p>
            <p className="mt-1 text-[0.8rem] text-ink-muted">
              {status === 'offline' ? 'Start it to stream live console output.' : 'Console output will appear here once it is ready.'}
            </p>
          </div>
          {status === 'offline' && onStart && (
            <button
              type="button"
              onClick={onStart}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[0.8rem] font-bold text-black transition hover:bg-gray-200"
            >
              <Play className="size-3.5" /> Start server
            </button>
          )}
        </div>
      )}
    </ConsoleFrame>
  );
}

/**
 * Live console inside the server's sandbox.
 * Connects to /ws/exec (ticket auth), prints recent logs as scrollback,
 * then attaches live. The gateway is read-only: this is an output viewer.
 *
 * Reconnect policy is explicit and visible (the socket itself never
 * auto-reconnects): EXEC_BUSY is retried (stale slot drains server-side),
 * transport drops are retried with backoff, everything else stops with a
 * message and a Retry button. A fresh ticket is minted per attempt.
 */
export default function ExecTerminal({ server, apiBase = '/servers', grant }) {
  const wrapRef = useRef(null);
  const viewRef = useRef(null);
  const stateRef = useRef(null);
  const [phase, setPhase] = useState('connecting'); // connecting | live | retrying | dead
  const [deadReason, setDeadReason] = useState('');
  const [lineCount, setLineCount] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [fullscreen, setFullscreen] = useFullscreen();
  const { connected, lastError, connect, disconnect } = useSocket('/ws/exec', false);

  useEffect(() => {
    if (!server?.id || !wrapRef.current) return undefined;
    const view = new LogView(wrapRef.current, { onStick: setAtBottom, onLines: setLineCount });
    viewRef.current = view;
    const st = {
      alive: true,
      socket: null,
      timer: null,
      attempts: 0,
      waits: 0,
      expectRestart: false,
      ended: false, // terminal exit / fatal error: never auto-retry
      phase: 'connecting',
      gen: 0, // connection generation: handlers from a superseded socket are ignored
    };
    stateRef.current = st;
    const setPh = (p) => {
      if (!st.alive) return;
      st.phase = p;
      setPhase(p);
    };

    const clearTimer = () => {
      if (st.timer) {
        clearTimeout(st.timer);
        st.timer = null;
      }
    };

    const note = (text, color = ansi.dim) => view.writeln(`${color}${text}${ansi.reset}`);

    const fail = (message, hint) => {
      st.ended = true;
      setDeadReason(hint || message || '');
      if (message) note(message, ansi.red);
      setPh('dead');
    };

    const schedule = (ms, message, g) => {
      if (!st.alive || st.ended) return;
      setPh('retrying');
      if (message) note(message);
      clearTimer();
      st.timer = setTimeout(() => {
        st.timer = null;
        if (st.alive && !st.ended && g === st.gen) void openSocket();
      }, ms);
    };

    const attach = (socket, g) => {
      st.socket = socket;
      socket.on('ready', () => {
        if (!st.alive || g !== st.gen) return;
        st.attempts = 0;
        // every (re)connection replays the CURRENT run's tail: start from a clean view
        // so a restarted server never shows its previous run's output
        view.clear();
        st.waits = 0;
        st.expectRestart = false;
        setDeadReason('');
        setPh('live');
      });
      socket.on('output', ({ data }) => {
        if (g !== st.gen) return;
        try { view.write(b64d(data)); } catch { /* ignore malformed frame */ }
      });
      socket.on('exit', ({ code, reason }) => {
        if (!st.alive || g !== st.gen) return;
        // the container stopped (restart / stop): wait for the next run instead of
        // dying — the new run's logs replace this view as soon as it connects
        if (reason === 'exit') {
          st.waits = 0;
          st.expectRestart = true;
          schedule(2000, 'Server stopped — waiting for it to start…', g);
          return;
        }
        // long-lived session expired server-side: just open a new one
        if (reason === 'idle-timeout' || reason === 'max-time') {
          schedule(800, 'Session expired — reconnecting…', g);
          return;
        }
        st.ended = true;
        if (reason === 'replaced') {
          setDeadReason('The console was opened in another tab.');
        } else {
          setDeadReason('Session ended.');
        }
        note(`Session ended (${reason ?? 'closed'}${code !== null && code !== undefined ? `, code ${code}` : ''}).`);
        setPh('dead');
      });
      socket.on('exec-error', ({ code }) => {
        if (!st.alive || st.ended || g !== st.gen) return;
        // right after a stop the container is briefly not running: keep waiting
        if (code === 'EXEC_OFFLINE' && st.expectRestart && st.waits < RESTART_WAIT_TRIES) {
          st.waits += 1;
          schedule(RESTART_WAIT_MS, 'Waiting for the server to start…', g);
          return;
        }
        if (code === 'EXEC_BUSY' && st.attempts < BUSY_RETRIES) {
          st.attempts += 1;
          schedule(BUSY_DELAY_MS, `Console busy — retrying (${st.attempts}/${BUSY_RETRIES})…`, g);
          return;
        }
        const hints = {
          EXEC_BUSY: 'Another console is already open for this server (a second tab may hold it).',
          EXEC_OFFLINE: 'Server is offline — start it first.',
          EXEC_NO_CONTAINER: 'Server has no container yet.',
          EXEC_NO_ACCESS: 'Access denied.',
          EXEC_SUSPENDED: 'This server is suspended — console access is blocked.',
          EXEC_LIMIT: 'Too many open consoles — close one first.',
        };
        fail(hints[code] ?? 'Console unavailable.');
      });
      socket.on('disconnect', () => {
        if (!st.alive || st.ended || g !== st.gen) return;
        // transport drop (not a policy close): bounded explicit retries
        const n = st.attempts;
        if (n < DROP_RETRIES) {
          st.attempts = n + 1;
          schedule(dropDelay(n), `Connection lost — retrying (${n + 1}/${DROP_RETRIES})…`, g);
        } else {
          fail('Connection lost. The network dropped the console session.');
        }
      });
    };

    const openSocket = async () => {
      if (!st.alive || st.ended) return;
      const g = st.gen + 1;
      st.gen = g;
      setPh(st.attempts > 0 ? 'retrying' : 'connecting');
      const socket = await connect({ serverId: server.id, ...(grant ? { grant } : {}) });
      if (!st.alive || st.ended || g !== st.gen) return;
      if (!socket) {
        // ticket fetch / auth failure (e.g. expired session): do not spin
        fail('Could not open a console session — try signing in again.');
        return;
      }
      attach(socket, g);
    };

    // Manual Retry button: fresh ticket, fresh socket, same view (keeps
    // scrollback). The backend hands the slot to the new connection even if
    // the old transport is still half-open (same-owner takeover).
    st.reopen = async () => {
      if (!st.alive) return;
      st.ended = false;
      st.attempts = 0;
      setDeadReason('');
      note('Reconnecting…');
      await openSocket();
    };

    (async () => {
      if (!st.alive) return;
      await openSocket();
    })();

    return () => {
      st.alive = false;
      st.ended = true;
      clearTimer();
      view.dispose();
      disconnect();
      viewRef.current = null;
      stateRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server?.id]);

  const retryNow = () => {
    const st = stateRef.current;
    if (!st || !st.reopen) return;
    void st.reopen();
  };

  const clearView = () => viewRef.current?.clear();
  const jump = () => viewRef.current?.jumpToLatest();
  const download = () => {
    const v = viewRef.current;
    if (v) downloadText(`${server.name}-console.txt`, v.text());
  };

  const tone = connected ? 'live' : phase === 'dead' ? 'dead' : phase === 'retrying' || phase === 'connecting' ? 'wait' : 'idle';
  const label = connected
    ? 'Live'
    : phase === 'retrying'
      ? 'Reconnecting…'
      : phase === 'dead'
        ? 'Disconnected'
        : lastError
          ? 'Disconnected'
          : 'Connecting…';

  return (
    <ConsoleFrame
      fullscreen={fullscreen}
      pill={<StatusPill tone={tone} label={label} />}
      actions={
        <>
          <IconButton label="Reconnect" onClick={retryNow} disabled={phase !== 'dead'}>
            <RefreshCw className="size-4" />
          </IconButton>
          <IconButton label="Clear view" onClick={clearView}>
            <Eraser className="size-4" />
          </IconButton>
          <IconButton label="Download output" onClick={download}>
            <Download className="size-4" />
          </IconButton>
          <IconButton label={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'} onClick={() => setFullscreen((v) => !v)}>
            {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </IconButton>
        </>
      }
      banner={
        phase === 'dead' ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-red-500/20 bg-red-500/[0.07] px-4 py-2 text-[0.78rem] text-red-300">
            <span className="min-w-0 flex-1 basis-48">{deadReason || 'The console connection closed.'}</span>
            <button
              type="button"
              onClick={retryNow}
              className="inline-flex items-center gap-1.5 rounded-full border border-red-400/30 px-3 py-1 text-[0.74rem] font-bold text-red-200 transition hover:bg-red-500/15"
            >
              <RefreshCw className="size-3" /> Retry
            </button>
          </div>
        ) : null
      }
      footer={
        <>
          <span>/data@{server.name}</span>
          {lineCount > 0 && <span>{lineCount.toLocaleString()} lines</span>}
        </>
      }
    >
      <div
        ref={wrapRef}
        className="troxe-log absolute inset-0 overflow-y-auto px-4 py-3 text-[0.78rem] leading-[1.5] sm:text-[0.8rem]"
        style={{ fontFamily: FONT_STACK }}
      />
      {lineCount === 0 && phase === 'live' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-[0.8rem] text-ink-muted">
          No output yet — new lines will appear here.
        </div>
      )}
      {!atBottom && (
        <button
          type="button"
          onClick={jump}
          className="absolute right-5 bottom-4 inline-flex items-center gap-1.5 rounded-full border border-hairline-hover bg-card/90 px-3 py-1.5 text-[0.74rem] font-semibold text-foreground shadow-lg backdrop-blur transition hover:bg-white/10"
        >
          <ArrowDown className="size-3.5" /> Latest
        </button>
      )}
    </ConsoleFrame>
  );
}
