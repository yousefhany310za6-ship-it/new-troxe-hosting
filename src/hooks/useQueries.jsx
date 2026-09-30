import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api.js';

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

// Auth sessions
export function useAuthSessions() {
  return useQuery({ queryKey: keys.authSessions(), queryFn: () => apiGet('/auth/sessions') });
}

export function useActiveSessions() {
  return useQuery({ queryKey: keys.activeSessions(), queryFn: () => apiGet('/auth/active-sessions') });
}