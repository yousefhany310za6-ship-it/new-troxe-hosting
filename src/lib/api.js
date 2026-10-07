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
export const apiBase = () => BASE;

/**
 * Same-origin relative path only — mirrors the backend allowlist so a
 * tampered `next` can never bounce the user (or a token-bearing URL) off-site.
 */
export function sanitizeNextPath(v, fallback = '/dashboard') {
  if (typeof v !== 'string') return fallback;
  const s = v.trim();
  if (!s || s.length > 512) return fallback;
  if (!s.startsWith('/')) return fallback;
  if (s.startsWith('//')) return fallback;
  if (/[\\\r\n\t]/.test(s)) return fallback;
  return s;
}

/** Browser-navigation entry to an OAuth flow (the provider redirect needs a GET). */
export function oauthStartUrl(provider, next) {
  const n = sanitizeNextPath(next);
  return `${BASE}/auth/oauth/${provider}/start?next=${encodeURIComponent(n)}`;
}

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
// onProgress(ratio|null) streams progress; signal aborts.
export async function apiDownload(path, { onProgress, signal } = {}) {
  const headers = {};
  if (getAccessToken()) headers.Authorization = `Bearer ${getAccessToken()}`;
  const doFetch = () => fetch(BASE + path, { credentials: 'include', headers, signal });
  let res = await doFetch();
  if (res.status === 401 && !path.startsWith('/auth/')) {
    try { await refreshAccess(); } catch {
      throw new ApiError(401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
    }
    if (getAccessToken()) headers.Authorization = `Bearer ${getAccessToken()}`;
    res = await doFetch();
  }
  if (!res.ok) throw await toError(res);
  const total = Number(res.headers.get('Content-Length')) || null;
  if (!onProgress || !res.body) {
    const blob = await res.blob();
    return finishDownload(res, blob);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(total ? loaded / total : null);
  }
  return finishDownload(res, new Blob(chunks));
}

function finishDownload(res, blob) {
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename="([^"]+)"/);
  return { blob, filename: m ? m[1] : 'download' };
}

// JSON PUT over XHR — fetch has no upload-progress events. Used by the file
// manager (base64 payloads). Retries once after a refresh on 401.
export function apiUploadJson(path, body, opts = {}) {
  return xhrUpload(path, 'application/json', JSON.stringify(body), opts);
}

// Raw-body PUT of a File/Blob (streamed by the browser from disk — never read
// into memory, no base64). Used for large file-manager uploads.
export function apiUploadRaw(path, file, opts = {}) {
  return xhrUpload(path, 'application/octet-stream', file, opts);
}

function xhrUpload(path, contentType, payload, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    let retried = false;
    const send = async () => {
      if (signal?.aborted) return reject(new ApiError(0, 'ABORTED', 'Upload cancelled.'));
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', BASE + path);
      xhr.setRequestHeader('Content-Type', contentType);
      if (getAccessToken()) xhr.setRequestHeader('Authorization', `Bearer ${getAccessToken()}`);
      xhr.withCredentials = true;
      if (signal) signal.addEventListener('abort', () => xhr.abort(), { once: true });
      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(e.loaded / e.total);
        };
      }
      xhr.onload = async () => {
        if (xhr.status === 401 && !retried && !path.startsWith('/auth/')) {
          retried = true;
          try { await refreshAccess(); } catch {
            return reject(new ApiError(401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.'));
          }
          return send();
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText || 'null')); }
          catch { resolve(null); }
          return;
        }
        try {
          const b = JSON.parse(xhr.responseText);
          const msg = Array.isArray(b?.message) ? b.message.join(', ') : b?.message;
          reject(new ApiError(xhr.status, b?.code || 'ERROR', msg || `Request failed (${xhr.status})`));
        } catch {
          reject(new ApiError(xhr.status, 'ERROR', `Request failed (${xhr.status})`));
        }
      };
      xhr.onerror = () => reject(new ApiError(0, 'NETWORK', 'Upload failed — check your connection.'));
      xhr.onabort = () => reject(new ApiError(0, 'ABORTED', 'Upload cancelled.'));
      xhr.send(payload);
    };
    send();
  });
}