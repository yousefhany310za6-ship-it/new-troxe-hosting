import { config } from '../config/env';

export interface ReqCtx {
  ip: string;
  device: string;
  /** Optional 2FA code for sensitive-action verification. */
  twoFactorCode?: string;
}

/**
 * Request metadata used for audit/login history.
 *
 * `x-forwarded-for` is only trusted when TRUST_PROXY=true — otherwise a client
 * could forge its own IP/location and poison session history or rate limits.
 */
export function ctxOf(req: {
  ip?: string;
  headers?: Record<string, unknown>;
}): ReqCtx {
  let ip = 'unknown';
  if (config.TRUST_PROXY) {
    const xff = req.headers?.['x-forwarded-for'];
    const first = Array.isArray(xff) ? xff[0] : xff;
    if (typeof first === 'string' && first.trim()) ip = first.split(',')[0].trim();
  }
  if (ip === 'unknown') ip = req.ip ?? 'unknown';
  return {
    ip: String(ip).slice(0, 45),
    device: String(req.headers?.['user-agent'] ?? 'unknown').slice(0, 255),
  };
}
