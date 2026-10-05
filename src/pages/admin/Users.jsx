import { useState } from 'react';
import { Link } from 'react-router-dom';

import { cn } from '@/lib/utils';
import { useAdminUsers } from '@/hooks/useAdminQueries.jsx';
import { Select } from '@/components/ui/select.jsx';
import { Skeleton } from '@/components/ui/field.jsx';
import { AvatarBadge } from '@/components/AvatarBadge.jsx';
import { Flag } from '@/components/ui/flag.jsx';

export default function AdminUsers() {
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [q, setQ] = useState('');
    const [role, setRole] = useState('');

    const { data, isLoading, error } = useAdminUsers({ page, limit: 20, search: q || undefined, role: role || undefined });

    const submitSearch = (e) => { e.preventDefault(); setPage(1); setQ(search.trim()); };

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-[1.6rem] font-extrabold tracking-tight">Users</h1>
                <p className="mt-1 text-[0.92rem] text-ink-secondary">{data?.pagination.total ?? '—'} accounts</p>
            </div>

            <form onSubmit={submitSearch} className="flex flex-wrap items-center gap-2">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email…" className="input-field w-64" />
                <Select
                    ariaLabel="Filter by role"
                    value={role}
                    onChange={(v) => { setRole(v); setPage(1); }}
                    options={[
                        { value: '', label: 'All roles' },
                        { value: 'user', label: 'user' },
                        { value: 'admin', label: 'admin' },
                    ]}
                    className="w-40"
                />
                <button type="submit" className="rounded-full bg-white px-5 py-2 text-sm font-bold text-black transition hover:bg-gray-200">
                    Search
                </button>
            </form>

            {isLoading && (
                <div className="flex flex-col gap-2">
                    {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
                </div>
            )}
            {error && <p className="text-red-400">Failed to load: {error.message}</p>}

            {data && (
                <>
                    <div className="overflow-hidden rounded-xl border border-hairline bg-card">
                        <div className="hidden grid-cols-[1.4fr_1.4fr_80px_80px_70px_1fr_110px] gap-4 border-b border-hairline px-6 py-3 font-mono text-[0.7rem] uppercase tracking-wider text-ink-muted lg:grid">
                            <span>Name</span><span>Email</span><span>Role</span><span>Plan</span><span>Servers</span><span>Country</span><span>Joined</span>
                        </div>
                        <div className="flex flex-col divide-y divide-hairline">
                            {data.data.map((u) => (
                                <Link key={u.id} to={`/admin/users/${u.id}`} className="grid grid-cols-1 gap-1 px-6 py-3.5 transition hover:bg-veil lg:grid-cols-[1.4fr_1.4fr_80px_80px_70px_1fr_110px] lg:items-center lg:gap-4">
                                    <span className="flex min-w-0 items-center gap-2.5 font-semibold">
                                        <AvatarBadge url={u.avatarUrl} name={u.name} size="size-7" text="text-[0.7rem]" />
                                        <span className="truncate">{u.name}</span>
                                    </span>
                                    <span className="truncate font-mono text-[0.82rem] text-ink-secondary">{u.email}</span>
                                    <span>
                                        <span className={cn(
                                            'rounded-full px-2 py-0.5 text-[0.7rem] font-bold',
                                            u.role === 'admin' ? 'bg-red-500/15 text-red-400' : 'bg-white/10 text-ink-secondary'
                                        )}>{u.role}</span>
                                    </span>
                                    <span className="font-mono text-[0.8rem] text-ink-secondary">{u.planId}</span>
                                    <span className="font-mono text-[0.8rem] text-ink-secondary">{u.serverCount}</span>
                                    <span className="truncate text-[0.8rem] text-ink-secondary">
                                        {u.country ? (
                                            <span className="inline-flex items-center gap-1.5">
                                                <Flag code={u.country.countryCode} name={u.country.location} className="w-4" />
                                                <span className="truncate">{u.country.location}</span>
                                            </span>
                                        ) : <span className="inline-flex items-center gap-1.5 text-ink-muted"><Flag name="Unknown" className="w-4" /> Unknown</span>}
                                    </span>
                                    <span className="font-mono text-[0.75rem] text-ink-muted">{new Date(u.createdAt).toLocaleDateString()}</span>
                                </Link>
                            ))}
                            {data.data.length === 0 && <p className="px-6 py-8 text-center text-ink-muted">No users found.</p>}
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-full border border-hairline px-5 py-2 text-sm font-bold text-ink-secondary transition hover:text-foreground disabled:opacity-40">
                            Prev
                        </button>
                        <span className="font-mono text-[0.8rem] text-ink-muted">Page {data.pagination.page} / {Math.max(1, data.pagination.pages)}</span>
                        <button type="button" disabled={page >= data.pagination.pages} onClick={() => setPage((p) => p + 1)} className="rounded-full border border-hairline px-5 py-2 text-sm font-bold text-ink-secondary transition hover:text-foreground disabled:opacity-40">
                            Next
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}