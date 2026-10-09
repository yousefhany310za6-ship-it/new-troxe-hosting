import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api.js';

export const supportKeys = {
    mine: (params) => ['support', 'mine', params ?? {}],
    queue: (params) => ['support', 'queue', params ?? {}],
    ticket: (id) => ['support', 'ticket', id],
    messages: (id, page) => ['support', 'ticket', id, 'messages', page ?? 1],
    serverCard: (id) => ['support', 'ticket', id, 'server'],
    timeline: (id) => ['support', 'ticket', id, 'timeline'],
    rating: (id) => ['support', 'ticket', id, 'rating'],
    notifications: (page) => ['support', 'notifications', page ?? 1],
    team: () => ['support', 'team'],
    myPerformance: () => ['support', 'performance', 'me'],
    myRatings: (page) => ['support', 'ratings', 'me', page ?? 1],
    escalations: (status) => ['support', 'escalations', status ?? 'all'],
    adminRatings: (params) => ['support', 'ratings', 'admin', params ?? {}],
};

/* ------------------------------- user side ------------------------------- */

export function useMyTickets(params = {}) {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    if (params.page) q.set('page', params.page);
    if (params.limit) q.set('limit', params.limit);
    const qs = q.toString();
    return useQuery({
        queryKey: supportKeys.mine(params),
        queryFn: () => apiGet(`/support/tickets${qs ? `?${qs}` : ''}`),
        staleTime: 15_000,
    });
}

export function useCreateTicket() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body) => apiPost('/support/tickets', body),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['support', 'mine'] }),
    });
}

export function useTicket(id) {
    return useQuery({
        queryKey: supportKeys.ticket(id),
        queryFn: () => apiGet(`/support/tickets/${id}`),
        enabled: !!id,
        staleTime: 10_000,
    });
}

export function useTicketMessages(id, page = 1) {
    return useQuery({
        queryKey: supportKeys.messages(id, page),
        queryFn: () => apiGet(`/support/tickets/${id}/messages?page=${page}`),
        enabled: !!id,
        staleTime: 5_000,
    });
}

export function useSendMessage(id) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ body, clientMsgId }) => apiPost(`/support/tickets/${id}/messages`, { body, clientMsgId }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['support', 'ticket', id, 'messages'] }),
    });
}

export function useMarkRead(id) {
    return useMutation({
        mutationFn: (upToId) => apiPost(`/support/tickets/${id}/read`, { upToId }),
    });
}

export function useSetTicketStatus(id) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (status) => apiPatch(`/support/tickets/${id}/status`, { status }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['support'] }),
    });
}

export function useDeleteTicket(id) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => apiDelete(`/support/tickets/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['support'] }),
    });
}

export function useRatingEligibility(id) {
    return useQuery({
        queryKey: supportKeys.rating(id),
        queryFn: () => apiGet(`/support/tickets/${id}/rating`),
        enabled: !!id,
        staleTime: 30_000,
    });
}

export function useRateTicket(id) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body) => apiPost(`/support/tickets/${id}/rate`, body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: supportKeys.rating(id) });
            qc.invalidateQueries({ queryKey: supportKeys.ticket(id) });
        },
    });
}

/* ------------------------------- staff side ------------------------------ */

export function useQueue(params) {
    const q = new URLSearchParams({ view: params.view ?? 'available' });
    for (const k of ['status', 'category', 'priority', 'search', 'assigneeId', 'from', 'to']) {
        if (params[k]) q.set(k, params[k]);
    }
    if (params.page) q.set('page', params.page);
    if (params.limit) q.set('limit', params.limit);
    return useQuery({
        queryKey: supportKeys.queue(params),
        queryFn: () => apiGet(`/support/queue?${q.toString()}`),
        staleTime: 10_000,
    });
}

export function useClaimTicket(id) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => apiPost(`/support/tickets/${id}/claim`),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['support'] }),
    });
}

export function useReleaseTicket(id) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => apiPost(`/support/tickets/${id}/release`),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['support'] }),
    });
}

export function useRetitleTicket(id) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (subject) => apiPatch(`/support/tickets/${id}/subject`, { subject }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['support'] }),
    });
}

export function useEscalateTicket(id) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (reason) => apiPost(`/support/tickets/${id}/escalate`, { reason }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['support'] }),
    });
}

export function useServerCard(id) {
    return useQuery({
        queryKey: supportKeys.serverCard(id),
        queryFn: () => apiGet(`/support/tickets/${id}/server`),
        enabled: !!id,
        staleTime: 20_000,
        retry: false,
    });
}

export function useTimeline(id) {
    return useQuery({
        queryKey: supportKeys.timeline(id),
        queryFn: () => apiGet(`/support/tickets/${id}/timeline`),
        enabled: !!id,
        staleTime: 15_000,
    });
}

export function useSupportTeam() {
    return useQuery({
        queryKey: supportKeys.team(),
        queryFn: () => apiGet('/support/team'),
        staleTime: 30_000,
    });
}

export function useMyPerformance() {
    return useQuery({
        queryKey: supportKeys.myPerformance(),
        queryFn: () => apiGet('/support/performance/me'),
        staleTime: 60_000,
    });
}

export function useMyRatings(page = 1) {
    return useQuery({
        queryKey: supportKeys.myRatings(page),
        queryFn: () => apiGet(`/support/performance/ratings?page=${page}`),
        staleTime: 60_000,
    });
}

/* ------------------------------- admin side ------------------------------ */

export function useAdminQueue(params) {
    const q = new URLSearchParams({ view: params.view ?? 'all' });
    for (const k of ['status', 'category', 'priority', 'search', 'assigneeId', 'from', 'to']) {
        if (params[k]) q.set(k, params[k]);
    }
    if (params.page) q.set('page', params.page);
    return useQuery({
        queryKey: ['support', 'admin', 'queue', params],
        queryFn: () => apiGet(`/admin/support/tickets?${q.toString()}`),
        staleTime: 10_000,
    });
}

export function useEscalations(status) {
    return useQuery({
        queryKey: supportKeys.escalations(status),
        queryFn: () => apiGet(`/admin/support/escalations${status ? `?status=${status}` : ''}`),
        staleTime: 15_000,
    });
}

export function useAckEscalation() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => apiPost(`/admin/support/escalations/${id}/ack`),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['support', 'escalations'] }),
    });
}

export function useAssignTicket() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, supportId }) => apiPost(`/admin/support/tickets/${id}/assign`, { supportId }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['support'] }),
    });
}

export function useAdminRatings(params = {}) {
    const q = new URLSearchParams();
    if (params.supportId) q.set('supportId', params.supportId);
    if (params.page) q.set('page', params.page);
    return useQuery({
        queryKey: supportKeys.adminRatings(params),
        queryFn: () => apiGet(`/admin/support/ratings?${q.toString()}`),
        staleTime: 30_000,
    });
}

/* ---------------------------- notifications ----------------------------- */

export function useNotifications(page = 1) {
    return useQuery({
        queryKey: supportKeys.notifications(page),
        queryFn: () => apiGet(`/support/notifications?page=${page}`),
        staleTime: 10_000,
        refetchInterval: 60_000,
    });
}

export function useReadNotification() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => apiPost(`/support/notifications/${id}/read`),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['support', 'notifications'] }),
    });
}

export function useReadAllNotifications() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => apiPost('/support/notifications/read-all'),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['support', 'notifications'] }),
    });
}
