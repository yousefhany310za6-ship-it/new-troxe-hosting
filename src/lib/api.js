/**
 * Minimal API client for the Troxe Hosting backend.
 *
 * - The refresh token lives in an httpOnly cookie (set by the API); this
 *   module only ever holds the short-lived access token IN MEMORY — never
 *   localStorage (XSS would otherwise read a long-lived credential).
 * - A 401 triggers ONE single-flight refresh + retry per request.
 */
const BASE = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/+$/, '');

let accessToken = null;
export const setAccessToken = (t) => { accessToken = t || null; };
export const getAccessToken = () => accessToken;

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

let refreshing = null;
export async function refreshAccess() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      accessToken = null;
      throw await toError(res);
    }
    const data = await res.json();
    accessToken = data.accessToken;
    return data;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function toError(res) {
  let body = null;
  try { body = await res.json(); } catch { /* empty body (204) */ }
  const msg = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
  return new ApiError(res.status, body?.code || 'ERROR', msg || `Request failed (${res.status})`);
}

async function apiFetch(path, { method = 'GET', body, auth = true, retry = true, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(BASE + path, {
    method,
    credentials: 'include',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  if (res.status === 401 && auth && retry && !path.startsWith('/auth/')) {
    try {
      await refreshAccess();
    } catch {
      // Refresh failed — surface as session expired
      throw new ApiError(401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
    }
    // Retry once with the new token
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const retryRes = await fetch(BASE + path, {
      method,
      credentials: 'include',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    if (retryRes.status === 204) return null;
    if (!retryRes.ok) throw await toError(retryRes);
    return retryRes.json();
  }

  if (res.status === 204) return null;
  if (!res.ok) throw await toError(res);
  return res.json();
}

export const apiGet = (path, options) => apiFetch(path, { ...options, method: 'GET' });
export const apiPost = (path, body, options) => apiFetch(path, { ...options, method: 'POST', body });
export const apiPatch = (path, body, options) => apiFetch(path, { ...options, method: 'PATCH', body });
export const apiPut = (path, body, options) => apiFetch(path, { ...options, method: 'PUT', body });
export const apiDelete = (path, options) => apiFetch(path, { ...options, method: 'DELETE' });

// Convenience helpers for auth endpoints (no auth header, no retry)
export const authPost = (path, body) => apiFetch(path, { method: 'POST', body, auth: false, retry: false });

// Raw binary download (blob) with the same 401→refresh→retry behavior.
export async function apiDownload(path) {
  const headers = {};
  if (getAccessToken()) headers.Authorization = `Bearer ${getAccessToken()}`;
  let res = await fetch(BASE + path, { credentials: 'include', headers });
  if (res.status === 401 && !path.startsWith('/auth/')) {
    try { await refreshAccess(); } catch {
      throw new ApiError(401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
    }
    if (getAccessToken()) headers.Authorization = `Bearer ${getAccessToken()}`;
    res = await fetch(BASE + path, { credentials: 'include', headers });
  }
  if (!res.ok) throw await toError(res);
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename="([^"]+)"/);
  return { blob, filename: m ? m[1] : 'download' };
}