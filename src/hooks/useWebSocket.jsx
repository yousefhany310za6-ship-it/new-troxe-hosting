import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '@/context/AuthContext.jsx';
import { apiPost } from '@/lib/api.js';

// Same-origin in dev (vite proxies /socket.io), VITE_API_URL origin in prod.
const SOCKET_ORIGIN = (() => {
  const api = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
  if (!api) return window.location.origin;
  return api.replace(/\/api\/v1$/, '') || window.location.origin;
})();

export function useSocket(namespace, enabled = true) {
  const { status } = useAuth();
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState(null);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.close();
      socketRef.current = null;
    }
    setConnected(false);
  }, []);

  const connect = useCallback(async (authExtra = {}) => {
    if (status !== 'authed') return null;
    disconnect();
    try {
      // fresh ticket per (re)connect — tickets live only 30s
      const { ticket } = await apiPost('/auth/ws/token');
      const socket = io(`${SOCKET_ORIGIN}${namespace}`, {
        auth: { ticket, ...authExtra },
        // /ws (dashboard live data) stays self-healing; /ws/exec must NOT
        // auto-reconnect: a rejected or policy-closed shell would otherwise
        // retry silently with a stale ticket into a dead slot (EXEC_BUSY
        // storm). ExecTerminal reconnects explicitly, with a fresh ticket
        // and visible state, a bounded number of times.
        reconnection: namespace !== '/ws/exec',
        reconnectionDelay: 1000,
        reconnectionDelayMax: 15000,
        timeout: 10000,
      });
      // refresh the ticket on every automatic reconnect
      socket.on('reconnect_attempt', async () => {
        try {
          const t = await apiPost('/auth/ws/token');
          socket.auth = { ticket: t.ticket, ...authExtra };
        } catch { /* reconnect will fail and retry */ }
      });
      socket.on('connect', () => { setConnected(true); setLastError(null); });
      socket.on('disconnect', () => setConnected(false));
      socket.on('connect_error', (err) => setLastError(err?.message ?? 'connection failed'));
      socketRef.current = socket;
      return socket;
    } catch (err) {
      setLastError(err.message);
      return null;
    }
  }, [status, namespace, disconnect]);

  useEffect(() => {
    if (status !== 'authed' || !enabled) { disconnect(); return; }
    // namespaces that need extra auth (exec) connect explicitly via connect()
    if (namespace === '/ws') connect();
    return () => disconnect();
  }, [status, enabled, namespace, connect, disconnect]);

  return { socketRef, connected, lastError, connect, disconnect };
}

export function useWebSocket() {
  const { socketRef, connected, lastError, disconnect } = useSocket('/ws');
  const subscriptionsRef = useRef(new Set());

  const emitSubs = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;
    for (const ch of subscriptionsRef.current) socket.emit('subscribe', { channels: [ch] });
  }, [socketRef]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !connected) return;
    const onMsg = (ev) => (msg) =>
      window.dispatchEvent(new CustomEvent('ws:message', { detail: { type: ev, ...(msg ?? {}) } }));
    const evs = ['server:stats', 'server:log', 'server:status', 'user:audit'];
    const handlers = evs.map((ev) => [ev, onMsg(ev)]);
    for (const [ev, h] of handlers) socket.on(ev, h);
    emitSubs();
    return () => {
      for (const [ev, h] of handlers) socket.off(ev, h);
    };
  }, [connected, socketRef, emitSubs]);

  const subscribe = useCallback((channels) => {
    const socket = socketRef.current;
    const arr = Array.isArray(channels) ? channels : [channels];
    const fresh = arr.filter((c) => !subscriptionsRef.current.has(c));
    fresh.forEach((c) => subscriptionsRef.current.add(c));
    if (socket?.connected) socket.emit('subscribe', { channels: fresh.length ? fresh : arr });
    return true;
  }, [socketRef]);

  const unsubscribe = useCallback((channels) => {
    const socket = socketRef.current;
    const arr = Array.isArray(channels) ? channels : [channels];
    arr.forEach((c) => subscriptionsRef.current.delete(c));
    if (socket?.connected) socket.emit('unsubscribe', { channels: arr });
  }, [socketRef]);

  return { connected, lastError, subscribe, unsubscribe, disconnect };
}

// Hook for subscribing to a specific channel and getting latest data.
// Channels look like `server:stats:<id>` while events arrive typed as
// `server:stats` — match on the prefix.
export function useWSChannel(channel, onMessage) {
  const { subscribe, unsubscribe, connected } = useWebSocket();
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    if (!connected || !channel) return;
    const handler = (e) => {
      const t = e.detail?.type;
      if (t && (channel === t || channel.startsWith(`${t}:`))) {
        handlerRef.current(e.detail);
      }
    };
    window.addEventListener('ws:message', handler);
    subscribe(channel);
    return () => {
      window.removeEventListener('ws:message', handler);
      unsubscribe(channel);
    };
  }, [channel, connected, subscribe, unsubscribe]);
}

// Specific channel hooks
export function useServerStats(serverId) {
  const [stats, setStats] = useState(null);
  useWSChannel(`server:stats:${serverId}`, (msg) => {
    if (msg.type === 'server:stats') setStats(msg);
  });
  return stats;
}

export function useServerStatus(serverId) {
  const [status, setStatus] = useState(null);
  useWSChannel(`server:status:${serverId}`, (msg) => {
    if (msg.type === 'server:status') setStatus(msg);
  });
  return status;
}

export function useServerLogs(serverId) {
  const [logs, setLogs] = useState([]);
  useWSChannel(`server:logs:${serverId}`, (msg) => {
    if (msg.type === 'server:log' && typeof msg.line === 'string') {
      setLogs((prev) => [...prev.slice(-199), msg.line]);
    }
  });
  return logs;
}

export function useUserAudit() {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  useWSChannel(`user:audit:${user?.id}`, (msg) => {
    if (msg.type === 'user:audit') setEvents((prev) => [msg, ...prev.slice(-99)]);
  });
  return events;
}
