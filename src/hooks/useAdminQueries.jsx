import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api.js';

export const adminKeys = {
  stats: () => ['admin', 'stats'],
  users: (params) => ['admin', 'users', params],
  user: (id) => ['admin', 'users', id],
  servers: (params) => ['admin', 'servers', params],
  server: (id) => ['admin', 'servers', id],
  plans: () => ['admin', 'plans'],
  audit: (params) => ['admin', 'audit', params],
};

const qs = (params = {}) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
};

// ---- stats ----
export function useAdminStats() {
  return useQuery({ queryKey: adminKeys.stats(), queryFn: () => apiGet('/admin/system/stats') });
}

// ---- users ----
export function useAdminUsers(params) {
  return useQuery({ queryKey: adminKeys.users(params), queryFn: () => apiGet(`/admin/users${qs(params)}`), keepPreviousData: true });
}

export function useAdminUser(id) {
  return useQuery({ queryKey: adminKeys.user(id), queryFn: () => apiGet(`/admin/users/${id}`), enabled: !!id });
}

export function useAdminUpdateRole(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (role) => apiPatch(`/admin/users/${id}/role`, { role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: adminKeys.user(id) }); qc.invalidateQueries({ queryKey: ['admin', 'users'] }); },
  });
}

export function useAdminUpdatePlan(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (planId) => apiPatch(`/admin/users/${id}/plan`, { planId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: adminKeys.user(id) }); qc.invalidateQueries({ queryKey: ['admin', 'users'] }); },
  });
}

export function useAdminResetLogins(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost(`/admin/users/${id}/reset-failed-logins`),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.user(id) }),
  });
}

export function useAdminDeleteUser(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiDelete(`/admin/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

export function useAdminSetPassword(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password) => apiPost(`/admin/users/${id}/password`, { password }),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.user(id) }),
  });
}

export function useAdminSuspendUser(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason) => apiPost(`/admin/users/${id}/suspend`, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: adminKeys.user(id) }); qc.invalidateQueries({ queryKey: ['admin', 'users'] }); },
  });
}

export function useAdminUnsuspendUser(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost(`/admin/users/${id}/unsuspend`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: adminKeys.user(id) }); qc.invalidateQueries({ queryKey: ['admin', 'users'] }); },
  });
}

export function useAdminRestoreUser(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost(`/admin/users/${id}/restore`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: adminKeys.user(id) }); qc.invalidateQueries({ queryKey: ['admin', 'users'] }); },
  });
}

export function useAdminImpersonateUser(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost(`/admin/users/${id}/impersonate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

// ---- servers ----
export function useAdminServers(params) {
  return useQuery({ queryKey: adminKeys.servers(params), queryFn: () => apiGet(`/admin/servers${qs(params)}`), keepPreviousData: true });
}

export function useAdminServer(id) {
  return useQuery({ queryKey: adminKeys.server(id), queryFn: () => apiGet(`/admin/servers/${id}`), enabled: !!id });
}

export function useAdminCreateServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => apiPost('/admin/servers', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'servers'] }),
  });
}

export function useAdminUpdateServer(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => apiPatch(`/admin/servers/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: adminKeys.server(id) }); qc.invalidateQueries({ queryKey: ['admin', 'servers'] }); },
  });
}

export function useAdminLifecycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }) => apiPost(`/admin/servers/${id}/${action}`),
    onSuccess: (_d, { id }) => { qc.invalidateQueries({ queryKey: adminKeys.server(id) }); qc.invalidateQueries({ queryKey: ['admin', 'servers'] }); },
  });
}

export function useAdminDeleteServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => apiDelete(`/admin/servers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'servers'] }),
  });
}

export function useAdminSuspendServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }) => apiPost(`/admin/servers/${id}/suspend`, { reason }),
    onSuccess: (_d, { id }) => { qc.invalidateQueries({ queryKey: adminKeys.server(id) }); qc.invalidateQueries({ queryKey: ['admin', 'servers'] }); },
  });
}

export function useAdminUnsuspendServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => apiPost(`/admin/servers/${id}/unsuspend`),
    onSuccess: (d, id) => { qc.invalidateQueries({ queryKey: adminKeys.server(typeof id === 'string' ? id : id.id) }); qc.invalidateQueries({ queryKey: ['admin', 'servers'] }); },
  });
}

export function useAdminServerAccess(id) {
  return useMutation({
    mutationFn: () => apiPost(`/admin/servers/${id}/access`),
  });
}

export function useAdminServerStats(id, enabled = true) {
  return useQuery({ queryKey: [...adminKeys.server(id), 'stats'], queryFn: () => apiGet(`/admin/servers/${id}/stats`), enabled: !!id && enabled, refetchInterval: 8000 });
}

export function useAdminServerUsage(id, enabled = true) {
  return useQuery({ queryKey: [...adminKeys.server(id), 'usage'], queryFn: () => apiGet(`/admin/servers/${id}/usage`), enabled: !!id && enabled, refetchInterval: 10000 });
}

export function useAdminServerLogs(id, enabled = true) {
  return useQuery({ queryKey: [...adminKeys.server(id), 'logs'], queryFn: () => apiGet(`/admin/servers/${id}/logs?tail=200`), enabled: !!id && enabled, refetchInterval: 5000 });
}

export function useAdminServerBackups(id) {
  return useQuery({ queryKey: [...adminKeys.server(id), 'backups'], queryFn: () => apiGet(`/admin/servers/${id}/backups`), enabled: !!id });
}

export function useAdminServerQuota(id) {
  return useQuery({ queryKey: [...adminKeys.server(id), 'quota'], queryFn: () => apiGet(`/admin/servers/${id}/backups/quota`), enabled: !!id });
}

export function useAdminServerEvents(id) {
  return useQuery({ queryKey: [...adminKeys.server(id), 'events'], queryFn: () => apiGet(`/admin/servers/${id}/events?limit=20`), enabled: !!id });
}

export function useAdminServerActivity(id) {
  return useQuery({ queryKey: [...adminKeys.server(id), 'activity'], queryFn: () => apiGet(`/admin/servers/${id}/activity?limit=30`), enabled: !!id });
}

export function useAdminServerFiles(id, path) {
  return useQuery({ queryKey: [...adminKeys.server(id), 'files', path || ''], queryFn: () => apiGet(`/admin/servers/${id}/files?path=${encodeURIComponent(path || '')}`), enabled: !!id });
}

export function useAdminServerFileContent(id, path) {
  return useQuery({ queryKey: [...adminKeys.server(id), 'files', path || '', 'content'], queryFn: () => apiGet(`/admin/servers/${id}/files/content?path=${encodeURIComponent(path)}`), enabled: !!id && !!path });
}

// ---- nodes ----
export function useAdminNodes() {
  return useQuery({ queryKey: ['admin', 'nodes'], queryFn: () => apiGet('/admin/nodes') });
}

export function useAdminNode(id) {
  return useQuery({ queryKey: ['admin', 'nodes', id], queryFn: () => apiGet(`/admin/nodes/${id}`), enabled: !!id });
}

export function useAdminCreateNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => apiPost('/admin/nodes', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'nodes'] }),
  });
}

export function useAdminUpdateNode(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => apiPatch(`/admin/nodes/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'nodes'] });
      qc.invalidateQueries({ queryKey: ['admin', 'nodes', id] });
    },
  });
}

export function useAdminDeleteNode(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiDelete(`/admin/nodes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'nodes'] }),
  });
}

export function useAdminCheckNode(id) {
  return useMutation({ mutationFn: () => apiPost(`/admin/nodes/${id}/check`) });
}

// ---- plans ----
export function useAdminPlans() {
  return useQuery({ queryKey: adminKeys.plans(), queryFn: () => apiGet('/admin/plans') });
}

export function useAdminCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => apiPost('/admin/plans', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.plans() }),
  });
}

export function useAdminPlanUpdate(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => apiPatch(`/admin/plans/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.plans() }),
  });
}

export function useAdminPlanDelete(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiDelete(`/admin/plans/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.plans() }),
  });
}

// ---- audit ----
export function useAdminAudit(params) {
  return useQuery({ queryKey: adminKeys.audit(params), queryFn: () => apiGet(`/admin/audit${qs(params)}`), keepPreviousData: true });
}

// ---- email ----
export function useAdminEmailStatus() {
  return useQuery({ queryKey: ['admin', 'email', 'status'], queryFn: () => apiGet('/admin/email/status') });
}

export function useAdminEmailSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => apiPatch('/admin/email/settings', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'email', 'status'] }),
  });
}

export function useAdminCampaigns() {
  return useQuery({ queryKey: ['admin', 'email', 'campaigns'], queryFn: () => apiGet('/admin/email/campaigns') });
}

export function useAdminCampaign(id) {
  return useQuery({ queryKey: ['admin', 'email', 'campaigns', id], queryFn: () => apiGet(`/admin/email/campaigns/${id}`), enabled: !!id });
}

export function useAdminCampaignCreate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => apiPost('/admin/email/campaigns', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'email', 'campaigns'] }),
  });
}

export function useAdminCampaignUpdate(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => apiPatch(`/admin/email/campaigns/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'email', 'campaigns'] });
      qc.invalidateQueries({ queryKey: ['admin', 'email', 'campaigns', id] });
    },
  });
}

export function useAdminCampaignPreview(id) {
  return useMutation({ mutationFn: (filters) => apiPost(`/admin/email/campaigns/${id}/recipients/preview`, filters || {}) });
}

export function useAdminCampaignSend(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (filters) => apiPost(`/admin/email/campaigns/${id}/send`, filters || {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'email', 'campaigns'] });
      qc.invalidateQueries({ queryKey: ['admin', 'email', 'campaigns', id] });
    },
  });
}

export function useAdminCampaignCancel(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost(`/admin/email/campaigns/${id}/cancel`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'email', 'campaigns'] });
      qc.invalidateQueries({ queryKey: ['admin', 'email', 'campaigns', id] });
    },
  });
}

export function useAdminCampaignRecipients(id, params) {
  return useQuery({
    queryKey: ['admin', 'email', 'campaigns', id, 'recipients', params],
    queryFn: () => apiGet(`/admin/email/campaigns/${id}/recipients${qs(params)}`),
    enabled: !!id,
    keepPreviousData: true,
  });
}