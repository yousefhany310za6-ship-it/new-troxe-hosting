import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../../config/env';

interface AdminGrant {
  adminId: string;
  serverId: string;
  exp: number;
}

/**
 * Short-lived, single-server access grants for admins.
 *
 * An admin opens another user's server through `POST /admin/servers/:id/access`
 * (audited there). The returned grant is a signed token the admin's browser
 * presents to the /ws gateways, which otherwise only serve owners. Properties:
 *
 * - HMAC-SHA256 with a domain-separated key derived from the access secret
 *   (same construction as the WS tickets — never a raw JWT).
 * - 5-minute TTL: long enough to connect, short enough that a leaked grant
 *   is useless quickly. The UI mints a fresh one per page open.
 * - Bound to (adminId, serverId): unusable for any other server, and only
 *   together with a ticket for the same admin.
 * - Suspension-proof by design: grants authorize MANAGEMENT view of a
 *   suspended server, which owners themselves cannot access.
 */
@Injectable()
export class AdminGrantService {
  private static readonly TTL_MS = 5 * 60 * 1000;

  private key(): Buffer {
    return createHmac('sha256', config.JWT_ACCESS_SECRET).update('troxe/admin-server-grant/v1').digest();
  }

  mint(adminId: string, serverId: string): string {
    const body = Buffer.from(
      JSON.stringify({ adminId, serverId, exp: Date.now() + AdminGrantService.TTL_MS }),
    ).toString('base64url');
    const sig = createHmac('sha256', this.key()).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  verify(token: string): AdminGrant {
    const fail = () => {
      throw new Error('bad grant');
    };
    if (typeof token !== 'string' || token.length > 2048) fail();
    const [body, sig] = token.split('.');
    if (!body || !sig) fail();
    const good = createHmac('sha256', this.key()).update(body!).digest();
    const given = Buffer.from(sig!, 'base64url');
    if (given.length !== good.length || !timingSafeEqual(given, good)) fail();
    let payload: AdminGrant;
    try {
      payload = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8'));
    } catch {
      fail();
    }
    if (
      typeof payload!.adminId !== 'string' ||
      typeof payload!.serverId !== 'string' ||
      typeof payload!.exp !== 'number' ||
      payload!.exp <= Date.now()
    ) {
      fail();
    }
    return payload!;
  }
}
