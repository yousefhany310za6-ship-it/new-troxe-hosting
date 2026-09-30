import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import { useSocket } from '@/hooks/useWebSocket.jsx';
import { apiGet } from '@/lib/api.js';

const b64e = (s) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const b64d = (b) =>
  new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));

/**
 * Interactive pty terminal inside the server's sandbox.
 * Connects to /ws/exec (ticket auth), prints recent logs as scrollback,
 * then attaches live. Read-only when the server is offline.
 */
export default function ExecTerminal({ server }) {
  const wrapRef = useRef(null);
  const termRef = useRef(null);
  const { socketRef, connected, lastError, connect, disconnect } = useSocket('/ws/exec', false);

  useEffect(() => {
    if (!server?.id) return;
    let alive = true;
    let term = null;
    let fit = null;
    let socket = null;

    (async () => {
      term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        theme: { background: '#00000000' },
        scrollback: 2000,
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      term.open(wrapRef.current);
      fit.fit();
      termRef.current = term;
      term.writeln('\x1b[90mConnecting to server shell…\x1b[0m');

      // recent logs as scrollback so the terminal never opens empty
      try {
        const logs = await apiGet(`/servers/${server.id}/logs?tail=100`);
        if (!alive) return;
        for (const line of String(logs?.logs ?? '').split('\n').filter(Boolean).slice(-100)) {
          term.writeln(`\x1b[90m${line.slice(0, 500)}\x1b[0m`);
        }
      } catch { /* offline or no logs — the shell will say why */ }

      if (!alive) return;
      socket = await connect({ serverId: server.id });
      if (!alive) return;
      if (!socket) {
        term.writeln('\r\n\x1b[31mCould not open a shell session.\x1b[0m');
        return;
      }

      socket.on('ready', () => {
        term.clear();
        term.writeln(`\x1b[90mConnected — /data@${server.name} (type "exit" to close)\x1b[0m`);
      });
      socket.on('output', ({ data }) => {
        try { term.write(b64d(data)); } catch { /* ignore malformed frame */ }
      });
      socket.on('exit', ({ code, reason }) => {
        term.writeln(`\r\n\x1b[90mSession ended (${reason ?? 'closed'}${code !== null && code !== undefined ? `, code ${code}` : ''}).\x1b[0m`);
      });
      socket.on('exec-error', ({ code }) => {
        const hints = {
          EXEC_BUSY: 'Another shell is already open for this server.',
          EXEC_OFFLINE: 'Server is offline — start it first.',
          EXEC_NO_CONTAINER: 'Server has no container yet.',
          EXEC_NO_ACCESS: 'Access denied.',
          EXEC_LIMIT: 'Too many open shells — close one first.',
        };
        term.writeln(`\r\n\x1b[31m${hints[code] ?? 'Shell unavailable.'}\x1b[0m`);
      });

      term.onData((d) => {
        if (socket.connected) socket.emit('input', { data: b64e(d) });
      });
      const onResize = () => {
        try {
          fit.fit();
          if (socket.connected) socket.emit('resize', { cols: term.cols, rows: term.rows });
        } catch { /* ignore */ }
      };
      window.addEventListener('resize', onResize);
      // send initial size once the pty is ready
      socket.on('ready', () => {
        try { fit.fit(); socket.emit('resize', { cols: term.cols, rows: term.rows }); } catch { /* ignore */ }
      });
      socket._troxeResizeListener = onResize;
    })();

    return () => {
      alive = false;
      const s = socketRef.current;
      if (s?._troxeResizeListener) window.removeEventListener('resize', s._troxeResizeListener);
      disconnect();
      try { term?.dispose(); } catch { /* ignore */ }
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server?.id]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${connected ? 'animate-beat bg-emerald-500' : 'bg-zinc-600'}`} />
        <span className="font-mono text-[0.78rem] text-ink-muted">
          {connected ? 'live shell' : lastError ? `disconnected (${lastError})` : 'connecting…'}
        </span>
      </div>
      <div ref={wrapRef} className="h-[380px] overflow-hidden rounded-lg bg-black/60 p-3 [&_.xterm]:h-full" />
    </div>
  );
}
