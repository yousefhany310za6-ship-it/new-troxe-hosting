import { useEffect, useRef, useState } from 'react';

import { AnnouncementBanner } from '@/components/AnnouncementBanner.jsx';
import { keys, useAckAnnouncement, useAnnouncements, useDismissAnnouncement, useReportAnnouncementShown } from '@/hooks/useQueries.jsx';
import { useQueryClient } from '@tanstack/react-query';

/**
 * User-dashboard announcement stack. Mounted once in DashboardLayout so
 * banners (critical first — the server orders them) appear across dashboard
 * pages without ever covering the screen like a modal.
 *
 * Anti-double-report: each id is reported exactly once per component mount
 * (React StrictMode/query refetches never inflate stats — the server counts
 * distinct users, not calls).
 */
export function DashboardAnnouncements() {
    const { data } = useAnnouncements();
    const ack = useAckAnnouncement();
    const dismiss = useDismissAnnouncement();
    const shown = useReportAnnouncementShown();
    const qc = useQueryClient();
    const reported = useRef(new Set());
    const [hidden, setHidden] = useState({});

    const list = (data ?? []).filter((a) => !hidden[a.id]);

    useEffect(() => {
        for (const a of list) {
            if (reported.current.has(a.id)) continue;
            reported.current.add(a.id);
            shown.mutate(a.id);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [list.map((a) => a.id).join(',')]);

    if (!list.length) return null;

    const hideLocal = (id) => setHidden((h) => ({ ...h, [id]: true }));

    return (
        <div className="mb-5 flex flex-col gap-3" aria-label="Announcements">
            {list.map((a) => (
                <AnnouncementBanner
                    key={`${a.id}@${a.contentVersion}`}
                    announcement={a}
                    interaction={a.interaction}
                    ackBusy={ack.isPending}
                    dismissBusy={dismiss.isPending}
                    onAck={() => ack.mutate(a.id, {
                        onSuccess: () => qc.invalidateQueries({ queryKey: keys.announcements() }),
                    })}
                    onDismiss={() => {
                        // every_visit banners resurface next visit by design —
                        // hide locally now, let the server confirm.
                        if (a.policy === 'every_visit' && !a.requireAck) hideLocal(a.id);
                        dismiss.mutate(a.id, {
                            onSuccess: () => qc.invalidateQueries({ queryKey: keys.announcements() }),
                        });
                    }}
                />
            ))}
        </div>
    );
}
