/**
 * Pure announcement-visibility policy.
 *
 * Kept free of Nest/Drizzle imports so unit tests can exercise every rule
 * without a database. The service is a thin enforcement wrapper around these
 * functions — any behavior change here MUST come with a test update.
 *
 * Documented rules (single source of truth, mirrored in the final report):
 *
 * 1. `isActive`: status must be `published`, now must be >= publishAt (or
 *    publishAt unset) and < expiresAt (or unset). `scheduled` rows NEVER show
 *    before their time — a 60s promoter flips due rows to `published`.
 * 2. Interactions are keyed (announcement, user, contentVersion). A content
 *    edit that bumps the version resurfaces the banner per the SAME policy.
 *    Admin-only edits (name, audience, timing) never bump the version.
 * 3. `once`: visible until acked OR dismissed for the current version.
 * 4. `every_visit`: always visible while active; dismiss hides only the
 *    current view (client-side), ack suppresses only when requireAck.
 * 5. `interval`: visible when never shown for this version, or when
 *    now - lastShownAt >= intervalHours. Dismiss counts as a "shown"
 *    timestamp (snooze until next interval).
 * 6. `until_ack`: visible until acked for the current version; dismiss is
 *    allowed only when requireAck is false.
 * 7. Mandatory (`requireAck`): dismiss is BLOCKED until acked. Enabling
 *    requireAck clears prior dismissals (but never acks) so the mandate
 *    applies to everyone.
 */

export type AnnouncementKind = 'info' | 'success' | 'warning' | 'critical';
export type AnnouncementStatus = 'draft' | 'scheduled' | 'published' | 'paused' | 'archived';
export type DisplayPolicy = 'once' | 'every_visit' | 'interval' | 'until_ack';

export interface AnnouncementAudience {
  type: 'all' | 'plans' | 'users';
  plans?: string[];
  userIds?: string[];
}

export interface PolicyAnnouncement {
  status: AnnouncementStatus;
  publishAt: string | Date | null;
  expiresAt: string | Date | null;
  policy: DisplayPolicy;
  requireAck: boolean;
  intervalHours: number | null;
  contentVersion: number;
}

export interface InteractionState {
  version: number;
  lastShownAt: string | Date | null;
  ackedAt: string | Date | null;
  dismissedAt: string | Date | null;
}

export const MATERIAL_FIELDS = [
  'title',
  'body',
  'kind',
  'actionLabel',
  'actionUrl',
  'eventStart',
  'eventEnd',
] as const;

const toMs = (v: string | Date | null): number | null => {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

export function isActive(a: PolicyAnnouncement, now: number = Date.now()): boolean {
  if (a.status !== 'published') return false;
  const pub = toMs(a.publishAt);
  if (pub !== null && now < pub) return false;
  const exp = toMs(a.expiresAt);
  if (exp !== null && now >= exp) return false;
  return true;
}

export function shouldShow(
  a: PolicyAnnouncement,
  ix: InteractionState | null,
  now: number = Date.now(),
): boolean {
  if (!isActive(a, now)) return false;
  const mine = ix && ix.version === a.contentVersion ? ix : null;
  const acked = !!mine?.ackedAt;
  const dismissed = !!mine?.dismissedAt;

  switch (a.policy) {
    case 'once':
      return !(acked || dismissed);
    case 'every_visit':
      // Dismiss is view-local (client hides for this mount only); only an
      // explicit ack under a mandate suppresses future visits.
      return a.requireAck ? !acked : true;
    case 'interval': {
      if (a.requireAck && acked) return false;
      const last = mine ? toMs(mine.lastShownAt) : null;
      if (last === null) return true;
      const hours = a.intervalHours && a.intervalHours > 0 ? a.intervalHours : 24;
      return now - last >= hours * 3600 * 1000;
    }
    case 'until_ack':
      return !acked;
    default:
      return false;
  }
}

/** Dismiss is blocked for mandatory banners until the user acks. */
export function canDismiss(a: PolicyAnnouncement, ix: InteractionState | null): boolean {
  if (!a.requireAck) return true;
  const mine = ix && ix.version === a.contentVersion ? ix : null;
  return !!mine?.ackedAt;
}

export function audienceMatches(
  audience: AnnouncementAudience | null | undefined,
  user: { id: string; planId: string },
): boolean {
  if (!audience || audience.type === 'all') return true;
  if (audience.type === 'plans') return (audience.plans ?? []).includes(user.planId);
  if (audience.type === 'users') return (audience.userIds ?? []).includes(user.id);
  return false;
}

/**
 * Action-URL allowlist (defense in depth; DTOs enforce length, the client
 * never renders HTML). Allowed: site-relative paths (/x, never //evil) and
 * http(s) URLs. Rejected: javascript:, data:, vbscript:, file:, whitespace.
 */
export function isValidActionUrl(url: string): boolean {
  if (typeof url !== 'string' || !url || url.length > 500) return false;
  if (/[\s<>]/.test(url)) return false;
  if (url.startsWith('/')) return !url.startsWith('//');
  const lower = url.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:') || lower.startsWith('file:')) {
    return false;
  }
  return lower.startsWith('http://') || lower.startsWith('https://');
}
