/**
 * Pure support-ticket policy (no Nest/Drizzle imports — unit-testable).
 * The service enforces these; any rule change MUST update the tests.
 *
 * Status machine (documented transitions, enforced by canTransition):
 *   open          → in_progress | waiting_user | waiting_admin | resolved
 *   in_progress   → waiting_user | waiting_admin | resolved
 *   waiting_user  → in_progress | resolved
 *   waiting_admin → in_progress (admin) | resolved
 *   resolved      → in_progress (staff rework) | closed (staff) | open (admin reopen)
 *   closed        → open (admin only)
 *
 * The ticket OWNER never changes the status: no closing, no resolving, no
 * reopening. Their only lifecycle powers are creating, replying (which may
 * move the ticket back to in_progress) and rating once it is resolved/closed.
 * Deleted tickets accept no transitions at all.
 *
 * Rating fairness (documented):
 * - one rating per ticket (UNIQUE(ticket_id), 23505 → 409);
 * - only the ticket OWNER rates, only when resolved/closed AND a staffer
 *   actually engaged (assignment or staff/admin message exists);
 * - the ratee is resolved server-side (current assignee, else most recent
 *   staff/admin author) — never from client input;
 * - one-shot: no edits. Admins can view, never silently rewrite values.
 */

export type TicketStatus = 'open' | 'in_progress' | 'waiting_user' | 'waiting_admin' | 'resolved' | 'closed';
export type StaffRole = 'owner' | 'support' | 'admin';

const TRANSITIONS: Record<TicketStatus, Array<{ to: TicketStatus; by: StaffRole[] }>> = {
  open: [
    { to: 'in_progress', by: ['support', 'admin'] },
    { to: 'waiting_user', by: ['support', 'admin'] },
    { to: 'waiting_admin', by: ['support', 'admin'] },
    { to: 'resolved', by: ['support', 'admin'] },
  ],
  in_progress: [
    { to: 'waiting_user', by: ['support', 'admin'] },
    { to: 'waiting_admin', by: ['support', 'admin'] },
    { to: 'resolved', by: ['support', 'admin'] },
    { to: 'closed', by: ['support', 'admin'] },
  ],
  waiting_user: [
    { to: 'in_progress', by: ['support', 'admin'] },
    { to: 'resolved', by: ['support', 'admin'] },
    { to: 'closed', by: ['support', 'admin'] },
  ],
  waiting_admin: [
    { to: 'in_progress', by: ['admin'] },
    { to: 'resolved', by: ['support', 'admin'] },
    { to: 'closed', by: ['support', 'admin'] },
  ],
  resolved: [
    { to: 'in_progress', by: ['support', 'admin'] },
    { to: 'closed', by: ['support', 'admin'] },
    { to: 'open', by: ['admin'] },
  ],
  closed: [{ to: 'open', by: ['admin'] }],
};

export function canTransition(from: TicketStatus, to: TicketStatus, role: StaffRole): boolean {
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).some((t) => t.to === to && t.by.includes(role));
}

/**
 * Who may post into a ticket.
 *  - owner: whenever the ticket is not closed;
 *  - support: ONLY the current assignee (claiming is what grants write access);
 *  - admin: always (they join with an explicit admin identity).
 */
export function canPost(input: {
  role: StaffRole;
  status: TicketStatus;
  assigneeId: string | null;
  authorId: string;
}): boolean {
  if (input.status === 'closed') return false;
  if (input.role === 'admin') return true;
  if (input.role === 'owner') return true;
  return input.assigneeId !== null && input.assigneeId === input.authorId;
}

/**
 * Priority is a staff decision: the assignee who holds the ticket, or an admin.
 * An unassigned ticket keeps its priority until somebody claims it.
 */
export function canSetPriority(input: { role: StaffRole; isAssignee: boolean }): boolean {
  if (input.role === 'admin') return true;
  return input.role === 'support' && input.isAssignee;
}

/** Priority tiers. Users never pick one: tickets open at MEDIUM by default. */
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const DEFAULT_PRIORITY = 'medium';

/** Owner may delete only a fresh, untouched, non-escalated open ticket. */
export function ownerCanDelete(status: TicketStatus, staffReplied: boolean, pendingEscalation: boolean): boolean {
  return status === 'open' && !staffReplied && !pendingEscalation;
}

export function ratingAllowed(input: {
  isOwner: boolean;
  status: TicketStatus;
  staffEngaged: boolean;
  alreadyRated: boolean;
}): { ok: boolean; reason?: string } {
  if (!input.isOwner) return { ok: false, reason: 'Only the ticket owner can rate.' };
  if (input.alreadyRated) return { ok: false, reason: 'This ticket already has a rating.' };
  if (input.status !== 'resolved' && input.status !== 'closed') {
    return { ok: false, reason: 'Only resolved or closed tickets can be rated.' };
  }
  if (!input.staffEngaged) return { ok: false, reason: 'No staff interaction to rate yet.' };
  return { ok: true };
}

/** 8 cryptographically-random digits (leading zeros kept). Format only — uniqueness is enforced by the DB constraint + retry. */
export const CONTACT_CODE_RE = /^\d{8}$/;
export function isValidContactCode(code: string): boolean {
  return typeof code === 'string' && CONTACT_CODE_RE.test(code);
}

/**
 * Redact credential-shaped fragments from server log lines before a support
 * agent ever sees them. Deliberately conservative (it only masks, never drops
 * lines) so debugging context survives while secrets do not.
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(bearer)\s+[A-Za-z0-9._~+\/-]{8,}=*/gi, '$1 ***REDACTED***'],
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|authorization)\b\s*[:=]\s*["']?[^\s"',;)]+/gi, '$1=***REDACTED***'],
  [/\b(postgres(?:ql)?:\/\/[^\s:]+:)[^\s@]+@/gi, '$1***REDACTED***@'],
  [/\b(sk|re|rk|pk)_(live|test)?_[A-Za-z0-9]{10,}/g, '***REDACTED***'],
];

export function redactSecrets(line: string): string {
  let out = line;
  for (const [re, replacement] of SECRET_PATTERNS) out = out.replace(re, replacement);
  return out.slice(0, 2000);
}

export const MESSAGE_MAX = 4000;
export const SUBJECT_MAX = 140;
export const DESCRIPTION_MAX = 5000;
export const RATING_COMMENT_MAX = 1000;
export const ESCALATION_REASON_MAX = 500;

export const TICKET_CATEGORIES = [
  'server_issue',
  'server_crash',
  'performance',
  'billing',
  'account',
  'technical',
  'other',
] as const;

/** Which statuses each role may list without extra filters. */
export function visibleToRole(role: 'user' | 'support' | 'admin'): 'own' | 'queue' | 'all' {
  if (role === 'admin') return 'all';
  if (role === 'support') return 'queue';
  return 'own';
}
