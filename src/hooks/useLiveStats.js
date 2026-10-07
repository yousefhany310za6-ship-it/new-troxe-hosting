import { useCallback, useEffect, useRef, useState } from 'react';

import { apiGet } from '@/lib/api.js';
import { useSocket } from '@/hooks/useWebSocket.jsx';

// Live path: the API pushes one sample per second over the /ws socket.
// Fallback (socket down): poll the REST endpoint (15 req/min, route limit is 60/min).
const POLL_MS = 4000;
export const MAX_SAMPLES = 120; // 2 minutes of history at 1 sample/s

/**
 * Real-time resource samples of a server.
 *
 * Returns `{ samples, mode }`:
 *  - samples: [{ cpu (% of the plan limit), mem, memLimit, rx, tx (cumulative
 *    bytes), rxRate, txRate (bytes/s) }] — oldest first, capped at MAX_SAMPLES
 *  - mode: 'live' (socket, ~1/s) | 'poll' (REST fallback) | 'idle' (not online)
 *
 * Samples reset whenever the server leaves the online state, so a restart
 * starts clean — same as the console output.
 */
export function useLiveStats(server, online, opts = {}) {
  const [samples, setSamples] = useState([]);
  const prev = useRef(null);
  const { socketRef, connected } = useSocket('/ws');

  /** Turn one raw stats frame into a sample (rates from consecutive frames). */
  const pushSample = useCallback(
    (s, tsMs) => {
      const limitCores = Math.max(0.05, (s?.limits?.cpuMilli ?? server.cpuMilli ?? 1000) / 1000);
      const cpu = Math.min(100, ((Number(s.cpuPercent) || 0) / 100 / limitCores) * 100);
      const memLimit = Number(s.memLimitBytes) || (server.ramMb ?? 0) * 1048576;
      const rx = Number(s.netRxBytes) || 0;
      const tx = Number(s.netTxBytes) || 0;
      let rxRate = 0;
      let txRate = 0;
      const p = prev.current;
      if (p) {
        const dt = (tsMs - p.t) / 1000;
        // counters restart with the container: a negative delta is a reset, not traffic
        if (dt > 0.2) {
          rxRate = Math.max(0, (rx - p.rx) / dt);
          txRate = Math.max(0, (tx - p.tx) / dt);
        }
      }
      prev.current = { t: tsMs, rx, tx };
      setSamples((arr) =>
        [...arr, { cpu, mem: Number(s.memBytes) || 0, memLimit, rx, tx, rxRate, txRate }].slice(-MAX_SAMPLES),
      );
    },
    [server.cpuMilli, server.ramMb],
  );

  // a restart / stop starts the charts from scratch
  useEffect(() => {
    setSamples([]);
    prev.current = null;
  }, [server?.id, server?.containerId, online]);

  // LIVE: subscribe to the server's stats channel (≈1 sample/s, pushed by the API)
  useEffect(() => {
    const sock = socketRef.current;
    if (!connected || !sock || !online || !server?.id) return undefined;
    const channel = `server:stats:${server.id}`;
    const onStats = (msg) => {
      if (!msg || (msg.serverId && msg.serverId !== server.id)) return;
      pushSample(msg, Number(msg.ts) || Date.now());
    };
    sock.on('server:stats', onStats);
    sock.emit('subscribe', { channels: [channel], ...(opts.grant ? { grant: opts.grant } : {}) });
    return () => {
      sock.off('server:stats', onStats);
      sock.emit('unsubscribe', { channels: [channel] });
    };
  }, [connected, online, server?.id, pushSample, socketRef, opts.grant]);

  // FALLBACK: poll while the socket is down, so the numbers never freeze.
  // An explicit fetcher lets the admin view reuse this hook against the
  // admin mirror endpoints (same shape, no owner session needed). Stored in
  // a ref so passing an inline lambda doesn't restart the poll loop.
  const fetcherRef = useRef(null);
  fetcherRef.current = opts.fetcher ?? ((id) => apiGet(`/servers/${id}/stats`));
  useEffect(() => {
    if (connected || !online || !server?.id || !server?.containerId) return undefined;
    let alive = true;
    let timer = null;
    const tick = async () => {
      if (!document.hidden) {
        try {
          const s = await fetcherRef.current(server.id);
          if (alive) pushSample(s, Date.now());
        } catch {
          /* transient: keep the previous samples */
        }
      }
      if (alive) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [connected, online, server?.id, server?.containerId, pushSample]);

  return { samples, mode: !online ? 'idle' : connected ? 'live' : 'poll' };
}
