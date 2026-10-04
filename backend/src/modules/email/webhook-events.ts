/**
 * Resend event → our delivery column. Pure mapping, unit-tested; the
 * controller only calls `deliveryFor` after a verified signature.
 * Unknown future event types resolve to undefined (ignored with 200).
 */
const DELIVERY: Record<string, string> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
};

export function deliveryFor(type: unknown): string | undefined {
  if (typeof type !== 'string') return undefined;
  const v = DELIVERY[type];
  return typeof v === 'string' ? v : undefined;
}

export function extractEmailId(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const id = (data as Record<string, unknown>).email_id;
  if (typeof id !== 'string' || !id || id.length > 128) return null;
  return id;
}
