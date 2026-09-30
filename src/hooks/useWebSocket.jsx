import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext.jsx';
import { apiPost } from '@/lib/api.js';

const WS_URL = (import.meta.env.VITE_API_URL || '').replace(/\/api\/v1$/, '').replace(/\/+$/, '') || window.location.origin;
const WS_PATH = '/api/v1/ws';

export function useWebSocket() {
  const { status, reloadUser } = useAuth();
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState(null);
  const subscriptionsRef = useRef(new Set());
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);

  const connect = useCallback(async () => {
    if (status !== 'authed') return;
    
    try {
      const { ticket } = await apiPost('/auth/ws/token');
      const url = `${WS_URL}${WS_PATH}?ticket=${encodeURIComponent(ticket)}`;
      
      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = () => {
        setConnected(true);
        setLastError(null);
        reconnectAttempts.current = 0;
        // Re-subscribe to previous channels
        subscriptionsRef.current.forEach(ch => socket.send(JSON.stringify({ type: 'subscribe', channels: [ch] })));
      };

      socket.onclose = (e) => {
        setConnected(false);
        if (status === 'authed' && !e.wasClean) {
          // Exponential backoff reconnect
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          reconnectAttempts.current += 1;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };

      socket.onerror = (err) => {
        setLastError('WebSocket connection error');
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          // Emit custom event for subscribers
          window.dispatchEvent(new CustomEvent('ws:message', { detail: msg }));
        } catch { /* ignore */ }
      };
    } catch (err) {
      setLastError(err.message);
    }
  }, [status]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    if (socketRef.current) {
      socketRef.current.close(1000, 'Client disconnect');
      socketRef.current = null;
    }
    setConnected(false);
    subscriptionsRef.current.clear();
  }, []);

  const subscribe = useCallback((channels) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    const arr = Array.isArray(channels) ? channels : [channels];
    const newChannels = arr.filter(c => !subscriptionsRef.current.has(c));
    if (newChannels.length === 0) return true;
    socket.send(JSON.stringify({ type: 'subscribe', channels: newChannels }));
    newChannels.forEach(c => subscriptionsRef.current.add(c));
    return true;
  }, []);

  const unsubscribe = useCallback((channels) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const arr = Array.isArray(channels) ? channels : [channels];
    socket.send(JSON.stringify({ type: 'unsubscribe', channels: arr }));
    arr.forEach(c => subscriptionsRef.current.delete(c));
  }, []);

  // Auto-connect on auth status change
  useEffect(() => {
    if (status === 'authed') connect();
    else disconnect();
    return () => disconnect();
  }, [status, connect, disconnect]);

  return { connected, lastError, subscribe, unsubscribe, disconnect, connect };
}

// Hook for subscribing to a specific channel and getting latest data
export function useWSChannel(channel, onMessage) {
  const { subscribe, unsubscribe, connected } = useWebSocket();
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    if (!connected || !channel) return;
    const handler = (e) => {
      if (e.detail?.channel === channel || e.detail?.type === channel) {
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
    if (msg.type === 'server:stats') setStats(msg.data);
  });
  return stats;
}

export function useServerStatus(serverId) {
  const [status, setStatus] = useState(null);
  useWSChannel(`server:status:${serverId}`, (msg) => {
    if (msg.type === 'server:status') setStatus(msg.data);
  });
  return status;
}

export function useServerLogs(serverId) {
  const [logs, setLogs] = useState([]);
  useWSChannel(`server:logs:${serverId}`, (msg) => {
    if (msg.type === 'server:log') setLogs(prev => [...prev.slice(-199), msg.data]);
  });
  return logs;
}

export function useUserAudit() {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  useWSChannel(`user:audit:${user?.id}`, (msg) => {
    if (msg.type === 'user:audit') setEvents(prev => [msg.data, ...prev.slice(-99)]);
  });
  return events;
}