import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocket } from '@/hooks/useWebSocket.jsx';

/**
 * Live connection to the support gateway (`/ws-support`).
 *
 * Everything about who may read/write a ticket is decided by the server on
 * every event, so this hook only has to: connect, (re)subscribe after every
 * reconnect, and forward events. A dropped socket re-syncs through the REST
 * history endpoint on reconnect — nothing is trusted from the socket layer.
 */
export function useSupportSocket({ ticketId, listenOnly, onEvent } = {}) {
    const enabled = !!ticketId || !!listenOnly;
    const { socketRef, connected, lastError, connect, disconnect } = useSocket('/ws-support', enabled);
    const handler = useRef(onEvent);
    handler.current = onEvent;

    useEffect(() => {
        if (!enabled) return undefined;
        let alive = true;
        (async () => {
            if (alive) await connect();
        })();
        return () => {
            alive = false;
            disconnect();
        };
    }, [enabled, connect, disconnect]);

    useEffect(() => {
        const socket = socketRef.current;
        if (!socket || !connected || !ticketId) return undefined;

        const events = ['ticket:message', 'ticket:read', 'ticket:typing', 'ticket:refresh', 'ticket:subscribed', 'presence', 'notification', 'admin:notification', 'error'];
        const onAny = (type) => (payload) => handler.current?.(type, payload);
        const listeners = events.map((ev) => {
            const fn = onAny(ev);
            socket.on(ev, fn);
            return [ev, fn];
        });

        // subscribe now AND after every reconnect (rooms are per-socket)
        const subscribeNow = () => socket.emit('subscribe', { ticketId });
        socket.on('connect', subscribeNow);
        subscribeNow();

        return () => {
            for (const [ev, fn] of listeners) socket.off(ev, fn);
            socket.off('connect', subscribeNow);
            socket.emit('unsubscribe', { ticketId });
        };
    }, [connected, socketRef, ticketId]);

    const emit = useCallback(
        (event, payload) => {
            const socket = socketRef.current;
            if (!socket || !socket.connected) return false;
            socket.emit(event, payload);
            return true;
        },
        [socketRef],
    );

    return { connected, lastError, emit };
}

/** True while the tab is visible — used to pause background work honestly. */
export function usePageVisible() {
    const [visible, setVisible] = useState(() => (typeof document === 'undefined' ? true : !document.hidden));
    useEffect(() => {
        const onVis = () => setVisible(!document.hidden);
        document.addEventListener('visibilitychange', onVis);
        return () => document.removeEventListener('visibilitychange', onVis);
    }, []);
    return visible;
}
