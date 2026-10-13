import { useEffect, useMemo, useState } from 'react';
import { Loader2, Save, SlidersHorizontal } from 'lucide-react';

import { apiPatch } from '@/lib/api.js';
import { useServerResourceLimits } from '@/hooks/useQueries.jsx';
import { useToast } from '@/hooks/useToast.jsx';
import { cn } from '@/lib/utils';
import ResourcePicker, { formatResource } from '@/components/dashboard/ResourcePicker.jsx';

/**
 * Resize an existing server.
 *
 * The limits come from `/servers/:id/resource-limits`, which excludes the
 * server's OWN allocation — so the numbers shown are exactly what the user may
 * still take. Storage applies immediately; CPU and memory are Docker limits,
 * so the backend rebuilds the container once (the volume is never touched).
 */
export default function ResourceEditor({ server, onSaved }) {
    const toast = useToast();
    const { data: limits, isLoading } = useServerResourceLimits(server?.id);
    const [value, setValue] = useState(null);
    const [busy, setBusy] = useState(false);

    const current = useMemo(
        () => (server ? { cpuMilli: server.cpuMilli, ramMb: server.ramMb, storageGb: server.storageGb } : null),
        [server?.id, server?.cpuMilli, server?.ramMb, server?.storageGb],
    );

    useEffect(() => {
        if (current) setValue(current);
    }, [current]);

    if (!server || !value) return null;

    const dirty =
        value.cpuMilli !== current.cpuMilli || value.ramMb !== current.ramMb || value.storageGb !== current.storageGb;
    const computeChanged = value.cpuMilli !== current.cpuMilli || value.ramMb !== current.ramMb;

    const save = async () => {
        setBusy(true);
        try {
            const res = await apiPatch(`/servers/${server.id}/resources`, value);
            toast.success(
                res?.needsRebuild
                    ? 'Resources updated — the server is restarting with the new limits.'
                    : 'Resources updated.',
            );
            onSaved?.();
        } catch (err) {
            toast.error(err.message);
            setValue(current);
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="console-card flex flex-col gap-4 p-5 sm:p-6">
            <header className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2.5 text-lead font-semibold">
                    <SlidersHorizontal className="size-4 text-ink-muted" aria-hidden="true" />
                    Resources
                </h2>
                {limits?.plan && (
                    <p className="text-tiny text-ink-secondary">
                        <span className="font-bold text-foreground">{limits.plan.name}</span> plan · your other servers hold{' '}
                        <span className="font-mono">{formatResource('cpuMilli', limits.resources.cpuMilli.used)}</span> CPU,{' '}
                        <span className="font-mono">{formatResource('ramMb', limits.resources.ramMb.used)}</span>,{' '}
                        <span className="font-mono">{formatResource('storageGb', limits.resources.storageGb.used)}</span>
                    </p>
                )}
            </header>

            {isLoading ? (
                <p className="flex items-center gap-2 text-small text-ink-muted">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading the limits of your plan…
                </p>
            ) : (
                <ResourcePicker limits={limits?.resources} value={value} onChange={setValue} disabled={busy} />
            )}

            <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
                <button type="button" onClick={save} disabled={busy || !dirty || isLoading} className="btn btn-primary">
                    {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
                    {busy ? 'Applying…' : 'Apply resources'}
                </button>
                <button
                    type="button"
                    onClick={() => setValue(current)}
                    disabled={busy || !dirty}
                    className="btn btn-secondary"
                >
                    Reset
                </button>
                <p className={cn('text-tiny', dirty ? 'text-ink-secondary' : 'text-ink-muted')}>
                    {computeChanged
                        ? 'CPU / memory changes restart the container — your files and settings are kept.'
                        : 'Storage changes apply immediately; only the upload quota moves.'}
                </p>
            </div>
        </section>
    );
}