import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiPut, apiDelete, apiDownload, apiUploadJson } from '@/lib/api.js';

// Query keys
export const keys = {
  user: () => ['user'],
  servers: () => ['servers'],
  server: (id) => ['servers', id],
  serverStats: (id) => ['servers', id, 'stats'],
  serverUsage: (id) => ['servers', id, 'usage'],
  serverLogs: (id) => ['servers', id, 'logs'],
  serverBackups: (id) => ['servers', id, 'backups'],
  authSessions: () => ['auth', 'sessions'],
  activeSessions: () => ['auth', 'active-sessions'],
};

// User
export function useUser() {
  return useQuery({ queryKey: keys.user(), queryFn: () => apiGet('/users/me') });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => apiPatch('/users/me', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.user() }),
  });
}

// ---- Avatar ---------------------------------------------------------------

/** Upload a (client-cropped) avatar image as multipart form data. */
export function useUploadAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (blob) => {
      const { getAccessToken, apiBase } = await import('@/lib/api.js');
      const form = new FormData();
      form.append('avatar', blob, 'avatar.png');
      const res = await fetch(`${apiBase()}/users/me/avatar`, {
        method: 'POST',
        credentials: 'include',
        headers: getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {},
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const { ApiError } = await import('@/lib/api.js');
        throw new ApiError(res.status, data?.code || 'ERROR', data?.message || `Upload failed (${res.status})`);
      }
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.user() }),
  });
}

export function useRemoveAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiDelete('/users/me/avatar'),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.user() }),
  });
}

export function useChangePassword() {
  return useMutation({ mutationFn: (data) => apiPost('/users/me/password', data) });
}

export function useUpdateNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => apiPatch('/users/me/notifications', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.user() }),
  });
}

export function useDeleteAccount() {
  return useMutation({ mutationFn: (data) => apiPost('/users/me', data) });
}

export function useSetPassword() {
  return useMutation({ mutationFn: (data) => apiPost('/users/me/password-set', data) });
}

// OAuth linked accounts (Settings → Linked accounts)
export function useOAuthStatus() {
  return useQuery({ queryKey: ['auth', 'oauth'], queryFn: () => apiGet('/auth/oauth/status') });
}

export function useOAuthLinkStart() {
  return useMutation({ mutationFn: (provider) => apiPost('/auth/oauth/link/start', { provider }) });
}

export function useOAuthLinkConfirm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkToken) => apiPost('/auth/oauth/link/confirm', { linkToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth', 'oauth'] });
      qc.invalidateQueries({ queryKey: keys.user() });
    },
  });
}

export function useOAuthUnlink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider) => apiDelete(`/auth/oauth/${provider}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth', 'oauth'] });
      qc.invalidateQueries({ queryKey: keys.user() });
    },
  });
}

// Servers
export function useServers() {
  return useQuery({ queryKey: keys.servers(), queryFn: () => apiGet('/servers') });
}

export function useServer(id) {
  return useQuery({
    queryKey: keys.server(id),
    queryFn: () => apiGet(`/servers/${id}`),
    enabled: !!id,
  });
}

export function useServerStats(id) {
  return useQuery({
    queryKey: keys.serverStats(id),
    queryFn: () => apiGet(`/servers/${id}/stats`),
    enabled: !!id,
    refetchInterval: 8000,
  });
}

export function useServerUsage(id) {
  return useQuery({
    queryKey: keys.serverUsage(id),
    queryFn: () => apiGet(`/servers/${id}/usage`),
    enabled: !!id,
    refetchInterval: 10000,
  });
}

export function useServerLogs(id, tail = 200) {
  return useQuery({
    queryKey: keys.serverLogs(id),
    queryFn: () => apiGet(`/servers/${id}/logs?tail=${tail}`),
    enabled: !!id,
    refetchInterval: 3000,
  });
}

export function useServerBackups(id) {
  return useQuery({
    queryKey: keys.serverBackups(id),
    queryFn: () => apiGet(`/servers/${id}/backups`),
    enabled: !!id,
  });
}

export function useCreateServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => apiPost('/servers', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.servers() }),
  });
}

export function useUpdateServer(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => apiPatch(`/servers/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.server(id) });
      qc.invalidateQueries({ queryKey: keys.servers() });
    },
  });
}

export function useDeleteServer(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiDelete(`/servers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.servers() });
    },
  });
}

export function useServerLifecycle(id) {
  return useMutation({
    mutationFn: (action) => apiPost(`/servers/${id}/${action}`),
  });
}

export function useReinstallServer(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost(`/servers/${id}/reinstall`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.server(id) });
      qc.invalidateQueries({ queryKey: keys.servers() });
    },
  });
}

// Backups
export function useCreateBackup(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost(`/servers/${id}/backups`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.serverBackups(id) }),
  });
}

export function useDeleteBackup(serverId, backupId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiDelete(`/servers/${serverId}/backups/${backupId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.serverBackups(serverId) }),
  });
}

export function useRestoreBackup(serverId, backupId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost(`/servers/${serverId}/backups/${backupId}/restore`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.serverBackups(serverId) });
      qc.invalidateQueries({ queryKey: keys.server(serverId) });
    },
  });
}

// Runtime egg catalog (versions + variables, no digests)
export function useRuntimeCatalog() {
  return useQuery({ queryKey: ['runtimes', 'catalog'], queryFn: () => apiGet('/servers/runtimes/catalog'), staleTime: 60000 });
}

// Files
const fkey = (id, path) => ['servers', id, 'files', path || ''];export function useServerFiles(id, path) {
  return useQuery({
    queryKey: fkey(id, path),
    queryFn: () => apiGet(`/servers/${id}/files?path=${encodeURIComponent(path || '')}`),
    enabled: !!id,
  });
}
export function useFileContent(id, path, enabled) {
  return useQuery({
    queryKey: [...fkey(id, path), 'content'],
    queryFn: () => apiGet(`/servers/${id}/files/content?path=${encodeURIComponent(path)}`),
    enabled: !!id && !!path && enabled !== false,
  });
}
function useFilesMutation(id, fn) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['servers', id, 'files'] }),
  });
}
export function useWriteFile(id) {
  return useFilesMutation(id, ({ path, content, contentBase64 }) =>
    apiPut(`/servers/${id}/files/content`, { path, content, contentBase64 }));
}
export function useMkdir(id) {
  return useFilesMutation(id, (path) => apiPost(`/servers/${id}/files/mkdir`, { path }));
}
export function useDeleteFile(id) {
  return useFilesMutation(id, (path) => apiDelete(`/servers/${id}/files?path=${encodeURIComponent(path)}`));
}
export function useRenameFile(id) {
  return useFilesMutation(id, ({ from, to }) => apiPost(`/servers/${id}/files/rename`, { from, to }));
}
export function useArchiveFiles(id) {
  return useFilesMutation(id, ({ sources, dest }) => apiPost(`/servers/${id}/files/archive`, { sources, dest }));
}
export function useExtractFiles(id) {
  return useFilesMutation(id, ({ file, dest }) => apiPost(`/servers/${id}/files/extract`, { file, dest }));
}
export async function downloadServerFile(id, path, { onProgress, signal } = {}) {
  const { blob, filename } = await apiDownload(
    `/servers/${id}/files/download?path=${encodeURIComponent(path)}`,
    { onProgress, signal },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export function uploadServerFile(id, path, contentBase64, { onProgress, signal } = {}) {
  return apiUploadJson(`/servers/${id}/files/content`, { path, contentBase64 }, { onProgress, signal });
}
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// Auth sessions
export function useAuthSessions() {  return useQuery({ queryKey: keys.authSessions(), queryFn: () => apiGet('/auth/sessions') });
}

// Own audit trail (Activity page), paged with "load more"
export function useActivity(page = 1) {
  return useQuery({
    queryKey: ['activity', page],
    queryFn: () => apiGet(`/users/me/activity?page=${page}&limit=30`),
    keepPreviousData: true,
  });
}

export function useActiveSessions() {
  return useQuery({ queryKey: keys.activeSessions(), queryFn: () => apiGet('/auth/active-sessions') });
}