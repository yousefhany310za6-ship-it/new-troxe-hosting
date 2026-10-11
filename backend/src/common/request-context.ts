import { config } from '../config/env';

export interface ReqCtx {
  ip: string;
  device: string;
  /** Optional 2FA code for sensitive-action verification. */
  twoFactorCode?: string;
}

/**
 * Trusted-proxy client address.
 *
 * `x-forwarded-for` is only honoured when the operator explicitly set
 * TRUST_PROXY=true, i.e. when a reverse proxy we control (Caddy) is the only
 * thing that can reach the API. A client-supplied header is then foraged
 * input; without the flag the socket's own address is used, so a caller can
 * never write a fake IP into the audit log or the activity feed.
 *
 * The value is also sanitised: at most the first hop of the list (the real
 * client) and a bounded length, so a long chain cannot smuggle junk.
 */
function clientIp(req: {
  ip?: string;
  headers?: Record<string, unknown>;
  socket?: { remoteAddress?: string };
}): string {
  const own = req.socket?.remoteAddress ?? req.ip;
  if (!config.TRUST_PROXY) return String(own ?? 'unknown').slice(0, 45);
  const xff = req.headers?.['x-forwarded-for'];
  const first = Array.isArray(xff) ? xff[0] : xff;
  if (typeof first !== 'string' || !first.trim()) return String(own ?? 'unknown').slice(0, 45);
  const candidate = first.split(',')[0].trim();
  // reject anything that is not an IP literal (IPv4, IPv6, v4-mapped)
  const bare = candidate.replace(/^::ffff:/i, '');
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(bare) && !/^[0-9a-f:]+$/i.test(bare)) {
    return String(own ?? 'unknown').slice(0, 45);
  }
  return candidate.slice(0, 45);
}

/**
 * Request metadata used for audit/login history.
 */
export function ctxOf(req: {
  ip?: string;
  headers?: Record<string, unknown>;
  socket?: { remoteAddress?: string };
}): ReqCtx {
  return {
    ip: clientIp(req),
    device: String(req.headers?.['user-agent'] ?? 'unknown').slice(0, 255),
  };
}

/**
 * Same resolution for a WebSocket handshake: socket.io exposes the peer
 * address, and the forwarded chain arrives in the handshake headers. Behind
 * Caddy the peer is always loopback, so without the proxy flag every console
 * event would be recorded as 127.0.0.1.
 */
export function ctxOfHandshake(h: {
  address?: string;
  headers?: Record<string, unknown>;
}): ReqCtx {
  return {
    ip: clientIp({ ip: h.address, headers: h.headers }),
    device: String(h.headers?.['user-agent'] ?? 'unknown').slice(0, 255),
  };
}
