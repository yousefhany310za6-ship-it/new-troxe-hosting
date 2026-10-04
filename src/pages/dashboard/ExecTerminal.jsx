import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import { useSocket } from '@/hooks/useWebSocket.jsx';
import { apiGet } from '@/lib/api.js';

const b64e = (s) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const b64d = (b) =>
  new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));

// A rejected-while-ghost slot clears server-side within one ping cycle, so a
// handful of spaced retries is enough; beyond that something is really wrong
// (a second tab genuinely holds the shell) and we stop hammering.
const BUSY_RETRIES = 8;
const BUSY_DELAY_MS = 3000;
// Transport drops (mobile blips, sleep/wake): bounded backoff, then a button.
const DROP_RETRIES = 5;
const dropDelay = (n) => Math.min(2000 * 2 ** n, 16000);

/**
 * Interactive pty terminal inside the server's sandbox.
 * Connects to /ws/exec (ticket auth), prints recent logs as scrollback,
 * then attaches live. Read-only when the server is offline.
 *
 * Reconnect policy is explicit and visible (the socket itself never
 * auto-reconnects): EXEC_BUSY is retried (stale slot drains server-side),
 * transport drops are retried with backoff, everything else stops with a
 * message and a Retry button. A fresh ticket is minted per attempt.
 */
export default function ExecTerminal({ server }) {
  const wrapRef = useRef(null);
  const termRef = useRef(null);
  const stateRef = useRef(null);
  const [phase, setPhase] = useState('connecting'); // connecting | live | retrying | dead
  const [deadReason, setDeadReason] = useState('');
  const { socketRef, connected, lastError, connect, disconnect } = useSocket('/ws/exec', false);

  useEffect(() => {
    if (!server?.id) return;
    const st = {
      alive: true,
      term: null,
      fit: null,
      socket: null,
      timer: null,
      attempts: 0,
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

    const fail = (message, hint) => {
      st.ended = true;
      setDeadReason(hint || '');
      if (message) st.term?.writeln(`\r\n\x1b[31m${message}\x1b[0m`);
      setPh('dead');
    };

    const schedule = (ms, message, g) => {
      if (!st.alive || st.ended) return;
      setPh('retrying');
      if (message) st.term?.writeln(`\r\n\x1b[90m${message}\x1b[0m`);
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
        st.term?.clear();
        st.term?.writeln(`\x1b[90mConnected — /data@${server.name} (type "exit" to close)\x1b[0m`);
        setPh('live');
      });
      socket.on('output', ({ data }) => {
        if (g !== st.gen) return;
        try { st.term?.write(b64d(data)); } catch { /* ignore malformed frame */ }
      });
      socket.on('exit', ({ code, reason }) => {
        if (!st.alive || g !== st.gen) return;
        st.ended = true;
        st.term?.writeln(`\r\n\x1b[90mSession ended (${reason ?? 'closed'}${code !== null && code !== undefined ? `, code ${code}` : ''}).\x1b[0m`);
        setPh('dead');
      });
      socket.on('exec-error', ({ code }) => {
        if (!st.alive || st.ended || g !== st.gen) return;
        if (code === 'EXEC_BUSY' && st.attempts < BUSY_RETRIES) {
          st.attempts += 1;
          schedule(BUSY_DELAY_MS, `Shell busy — retrying (${st.attempts}/${BUSY_RETRIES})…`, g);
          return;
        }
        const hints = {
          EXEC_BUSY: 'Another shell is already open for this server (a second tab may hold it).',
          EXEC_OFFLINE: 'Server is offline — start it first.',
          EXEC_NO_CONTAINER: 'Server has no container yet.',
          EXEC_NO_ACCESS: 'Access denied.',
          EXEC_LIMIT: 'Too many open shells — close one first.',
        };
        fail(hints[code] ?? 'Shell unavailable.');
      });
      socket.on('disconnect', () => {
        if (!st.alive || st.ended || g !== st.gen) return;
        // transport drop (not a policy close): bounded explicit retries
        const n = st.attempts;
        if (n < DROP_RETRIES) {
          st.attempts = n + 1;
          schedule(dropDelay(n), `Connection lost — retrying (${n + 1}/${DROP_RETRIES})…`, g);
        } else {
          fail('Connection lost. The network dropped the shell session.');
        }
      });
      // NOTE: input + window-resize are wired once (below, in the init
      // block) against st.socket — never here, or retries would stack
      // duplicate handlers on the same terminal.
      // send initial size once the pty is ready
      socket.on('ready', () => {
        try {
          st.fit?.fit();
          if (st.term) socket.emit('resize', { cols: st.term.cols, rows: st.term.rows });
        } catch { /* ignore */ }
      });
    };

    const openSocket = async () => {
      if (!st.alive || st.ended) return;
      const g = st.gen + 1;
      st.gen = g;
      setPh(st.attempts > 0 ? 'retrying' : 'connecting');
      const socket = await connect({ serverId: server.id });
      if (!st.alive || st.ended || g !== st.gen) return;
      if (!socket) {
        // ticket fetch / auth failure (e.g. expired session): do not spin
        fail('Could not open a shell session — try signing in again.');
        return;
      }
      attach(socket, g);
    };

    // Manual Retry button: fresh ticket, fresh socket, same terminal (keeps
    // scrollback). The backend hands the slot to the new connection even if
    // the old transport is still half-open (same-owner takeover).
    st.reopen = async () => {
      if (!st.alive) return;
      st.ended = false;
      st.attempts = 0;
      setDeadReason('');
      st.term?.writeln('\r\n\x1b[90mRetrying…\x1b[0m');
      await openSocket();
    };

    (async () => {
      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        theme: { background: '#00000000' },
        scrollback: 2000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(wrapRef.current);
      fit.fit();
      st.term = term;
      termRef.current = term;
      term.writeln('\x1b[90mConnecting to server shell…\x1b[0m');

      // wired once for the terminal's lifetime: every socket below is a fresh
      // object (retries re-attach), so handlers here always read st.socket
      term.onData((d) => {
        const s = st.socket;
        if (s && s.connected) s.emit('input', { data: b64e(d) });
      });
      const onResize = () => {
        try {
          const s = st.socket;
          st.fit?.fit();
          if (s && s.connected && st.term) s.emit('resize', { cols: st.term.cols, rows: st.term.rows });
        } catch { /* ignore */ }
      };
      window.addEventListener('resize', onResize);
      st.cleanupResize = () => window.removeEventListener('resize', onResize);

      // recent logs as scrollback so the terminal never opens empty
      try {
        const logs = await apiGet(`/servers/${server.id}/logs?tail=100`);
        if (!st.alive) return;
        for (const line of String(logs?.logs ?? '').split('\n').filter(Boolean).slice(-100)) {
          term.writeln(`\x1b[90m${line.slice(0, 500)}\x1b[0m`);
        }
      } catch { /* offline or no logs — the shell will say why */ }

      if (!st.alive) return;
      await openSocket();
    })();

    return () => {
      st.alive = false;
      st.ended = true;
      clearTimer();
      if (st.cleanupResize) st.cleanupResize();
      disconnect();
      try { st.term?.dispose(); } catch { /* ignore */ }
      termRef.current = null;
      stateRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server?.id]);

  const retryNow = () => {
    const st = stateRef.current;
    if (!st || !st.reopen) return;
    void st.reopen();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${connected ? 'animate-beat bg-emerald-500' : phase === 'retrying' ? 'animate-beat bg-amber-500' : 'bg-zinc-600'}`} />
        <span className="font-mono text-[0.78rem] text-ink-muted">
          {connected ? 'live shell' : phase === 'retrying' ? 'reconnecting…' : phase === 'dead' ? `disconnected${deadReason ? ` (${deadReason})` : ''}` : lastError ? `disconnected (${lastError})` : 'connecting…'}
        </span>
        {phase === 'dead' && (
          <button
            type="button"
            onClick={retryNow}
            className="rounded-full border border-hairline px-3 py-1 font-mono text-[0.72rem] font-bold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground"
          >
            Retry
          </button>
        )}
      </div>
      <div ref={wrapRef} className="h-[380px] overflow-hidden rounded-lg bg-black/60 p-3 [&_.xterm]:h-full" />
    </div>
  );
}
