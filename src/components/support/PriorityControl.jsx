import { useState } from 'react';
import { Flag, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useSetPriority } from '@/hooks/useSupportDesk.js';
import { useAuth } from '@/context/AuthContext.jsx';

const OPTIONS = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Critical' },
];

/**
 * Priority picker. Only rendered for staff, and only the holder of the ticket
 * (or an admin) is authorised server-side — the button exists for the assignee
 * and the backend still enforces the rule for everybody else.
 */
export function PriorityControl({ ticket, onChanged, isStaff }) {
    const { user } = useAuth();
    const setPriority = useSetPriority(ticket.id);
    const [error, setError] = useState(null);
    if (!isStaff) return null;

    const isHolder = ticket.assigneeId && ticket.assigneeId === user?.id;
    const isAdmin = ticket.myRole === 'admin';
    if (!isHolder && !isAdmin) return null;

    return (
        <div className="inline-flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[0.76rem] font-bold text-ink-muted">
                <Flag className="size-3.5" aria-hidden="true" />
                Priority
            </span>
            <div className="inline-flex overflow-hidden rounded-full border border-hairline" role="group" aria-label="Ticket priority">
                {OPTIONS.map((o) => {
                    const active = (ticket.priority ?? 'medium') === o.value;
                    return (
                        <button
                            key={o.value}
                            type="button"
                            disabled={setPriority.isPending || active}
                            aria-pressed={active}
                            onClick={async () => {
                                setError(null);
                                try {
                                    await setPriority.mutateAsync(o.value);
                                    onChanged?.();
                                } catch (e) {
                                    setError(e?.message ?? 'Could not change the priority.');
                                }
                            }}
                            className={cn(
                                'px-2.5 py-1 text-[0.72rem] font-bold transition disabled:cursor-default',
                                active ? 'bg-white/10 text-foreground' : 'text-ink-secondary hover:bg-veil hover:text-foreground',
                            )}
                        >
                            {o.label}
                        </button>
                    );
                })}
            </div>
            {setPriority.isPending && <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-hidden="true" />}
            {error && <span className="text-[0.72rem] text-red-300">{error}</span>}
        </div>
    );
}
