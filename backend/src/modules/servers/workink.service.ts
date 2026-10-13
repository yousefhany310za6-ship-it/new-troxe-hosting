import { Injectable, Logger } from '@nestjs/common';

import { config } from '../../config/env';
import { type ProviderVerdict } from './renewal-policy';
import {
  applyOverride,
  overrideUrl,
  parseOverride,
  parseTokenVerdict,
  parseWorkinkBaseUrl,
  plainLink,
  tokenCheckUrl,
  workinkConfigFrom,
  workinkReadiness,
  type WorkinkConfig,
} from './workink-client';

/** Every outbound call is bounded; a hung provider must not hold a request. */
const REQUEST_TIMEOUT_MS = 8000;

/**
 * The ONLY place that performs network I/O against Work.ink.
 *
 * All parsing, URL construction and policy live in `workink-client.ts` (pure,
 * unit-tested); if Work.ink changes either documented endpoint, the change is
 * contained in that file plus the two `fetchJson` calls here.
 */
@Injectable()
export class WorkinkService {
  private readonly log = new Logger(WorkinkService.name);

  cfg(): WorkinkConfig {
    return workinkConfigFrom({
      enabled: config.WORKINK_ENABLED,
      apiBaseUrl: config.WORKINK_API_BASE_URL,
      linkUrl: config.WORKINK_LINK_URL,
      linkId: config.WORKINK_LINK_ID,
      returnUrlTemplate: config.WORKINK_RETURN_URL,
      deleteToken: config.WORKINK_DELETE_TOKEN,
    });
  }

  ready(): { ready: boolean; missing: string[] } {
    return workinkReadiness(this.cfg());
  }

  /** The dashboard link, optionally signed for a session-specific return. */
  async redirectFor(returnUrl: string): Promise<string> {
    const cfg = this.cfg();
    if (!cfg.enabled) return plainLink(cfg);
    try {
      const body = await this.fetchJson(overrideUrl(cfg, returnUrl));
      const sr = parseOverride(body);
      return sr ? applyOverride(plainLink(cfg), sr) : plainLink(cfg);
    } catch (e) {
      // A missing override degrades convenience, never security: the session is
      // still enforced server-side, so the user simply returns to a generic page.
      this.log.warn(`work.ink override unavailable: ${(e as Error).message}`);
      return plainLink(cfg);
    }
  }

  /**
   * Validate a key against Work.ink.
   *
   * `consume` adds `?deleteToken=1` so the key is single-use at the provider.
   * Our unique index on the token hash is the real replay guard — this is a
   * second layer whose failure is tolerated.
   */
  async validateToken(token: string, opts: { consume: boolean }): Promise<ProviderVerdict> {
    const cfg = this.cfg();
    if (!cfg.enabled) return { kind: 'unavailable' };
    try {
      const body = await this.fetchJson(tokenCheckUrl(cfg, token, opts));
      return parseTokenVerdict(body);
    } catch (e) {
      const message = (e as Error).message;
      // connection-level failures are "unavailable" (the user may retry);
      // anything else is an unexpected shape (also never a success)
      return /abort|timeout|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|socket/i.test(message)
        ? { kind: 'unavailable' }
        : { kind: 'error' };
    }
  }

  /**
   * Timeout-bound JSON GET. The URL is re-parsed against the allowlist on every
   * call, so a future code change cannot turn this into an SSRF primitive. The
   * URL is never logged — it carries the key.
   */
  private async fetchJson(url: string): Promise<unknown> {
    const parsed = parseWorkinkBaseUrl(url); // throws unless https://work.ink...
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(parsed, { signal: ac.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) {
        // 5xx / 429 = the provider is unwell (retryable); 4xx = an ordinary "no"
        if (res.status >= 500 || res.status === 429) throw new Error(`http ${res.status}`);
        return null;
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}