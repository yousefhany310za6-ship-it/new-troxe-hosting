import { useState } from 'react';
import { Loader2, Star } from 'lucide-react';

import { cn } from '@/lib/utils';
import { AvatarBadge } from '@/components/AvatarBadge.jsx';
import { RoleBadge } from '@/components/support/Badges.jsx';
import { useRateTicket } from '@/hooks/useSupportQueries.js';

const RESOLUTIONS = [
    { value: 'yes', label: 'Yes — solved' },
    { value: 'partial', label: 'Partly' },
    { value: 'no', label: 'No — still broken' },
];

/**
 * Post-resolution rating. The person being rated is chosen by the server from
 * the assignment/interaction history and displayed here for transparency —
 * the client never sends a "who" field, and each ticket can be rated once.
 */
export function RatingForm({ ticket, ratee, onDone }) {
    const rate = useRateTicket(ticket.id);
    const [stars, setStars] = useState(0);
    const [hover, setHover] = useState(0);
    const [resolved, setResolved] = useState('');
    const [comment, setComment] = useState('');
    const [error, setError] = useState(null);

    const submit = async (e) => {
        e.preventDefault();
        setError(null);
        if (!stars || !resolved) {
            setError('Pick a star rating and tell us whether the problem was solved.');
            return;
        }
        try {
            await rate.mutateAsync({ stars, resolved, comment: comment.trim() || undefined });
            onDone?.();
        } catch (e2) {
            setError(e2?.message ?? 'Could not save your rating.');
        }
    };

    return (
        <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border border-hairline bg-card p-4 sm:p-5" aria-label="Rate the support you received">
            <div>
                <h2 className="text-[1rem] font-extrabold text-foreground">How did we do?</h2>
                <p className="mt-1 text-[0.84rem] text-ink-secondary">
                    Rate the specialist who handled this ticket. One rating per ticket, and it cannot be edited afterwards.
                </p>
            </div>

            {ratee && (
                <p className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-veil px-3 py-2 text-[0.82rem]">
                    <AvatarBadge url={ratee.avatarUrl} name={ratee.name} size="size-7" text="text-[0.66rem]" />
                    <span className="text-ink-secondary">Rating</span>
                    <span className="font-bold text-foreground">{ratee.name}</span>
                    <RoleBadge role={ratee.role ?? 'support'} size="xs" />
                </p>
            )}

            <fieldset className="flex flex-col gap-2">
                <legend className="text-[0.78rem] font-bold text-ink-secondary">Stars</legend>
                <div className="flex items-center gap-1.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                        <button
                            key={n}
                            type="button"
                            onClick={() => setStars(n)}
                            onMouseEnter={() => setHover(n)}
                            onMouseLeave={() => setHover(0)}
                            aria-label={`${n} star${n > 1 ? 's' : ''}`}
                            aria-pressed={stars === n}
                            className="rounded-md p-1 transition hover:bg-white/5"
                        >
                            <Star
                                className={cn(
                                    'size-6 transition',
                                    (hover || stars) >= n ? 'fill-amber-300 text-amber-300' : 'text-ink-muted'
                                )}
                                aria-hidden="true"
                            />
                        </button>
                    ))}
                    <span className="ml-2 text-[0.78rem] text-ink-muted">
                        {stars ? `${stars}/5` : 'not rated'}
                    </span>
                </div>
            </fieldset>

            <fieldset className="flex flex-col gap-2">
                <legend className="text-[0.78rem] font-bold text-ink-secondary">Was your problem solved?</legend>
                <div className="flex flex-wrap gap-2">
                    {RESOLUTIONS.map((r) => (
                        <button
                            key={r.value}
                            type="button"
                            onClick={() => setResolved(r.value)}
                            aria-pressed={resolved === r.value}
                            className={cn(
                                'rounded-full border px-3.5 py-1.5 text-[0.78rem] font-bold transition',
                                resolved === r.value
                                    ? 'border-white/25 bg-white/10 text-foreground'
                                    : 'border-hairline text-ink-secondary hover:border-hairline-hover hover:text-foreground'
                            )}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
            </fieldset>

            <div className="flex flex-col gap-1.5">
                <label htmlFor="rating-comment" className="text-[0.78rem] font-bold text-ink-secondary">Comment (optional)</label>
                <textarea
                    id="rating-comment"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                    maxLength={1000}
                    placeholder="Anything the team should know?"
                    className="input-field resize-y"
                />
            </div>

            {error && <p className="text-[0.78rem] text-red-300" role="alert">{error}</p>}

            <div className="flex justify-end">
                <button
                    type="submit"
                    disabled={rate.isPending}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[0.84rem] font-bold text-black transition hover:bg-white/90 disabled:opacity-60"
                >
                    {rate.isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                    Submit rating
                </button>
            </div>
        </form>
    );
}
