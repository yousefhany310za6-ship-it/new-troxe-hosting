/**
 * Interactive entry: mounts the real ServerDetail page in the jsdom window the
 * runner prepares, drives it with a fetch stub shaped like production, and
 * returns one result per user-visible behaviour. Kept as data (not asserts
 * inside the component tree) so a failure names the behaviour that broke.
 */
import { createElement as h, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AuthProvider } from '../src/context/AuthContext.jsx';
import ServerDetail from '../src/pages/dashboard/ServerDetail.jsx';

// Production-shaped fixtures: root has folders AND files (the split sections),
// one nested folder with a binary (tree + preview), one quota with 1 of 2
// slots used, one ready snapshot (hero stats).
const FILES_ROOT = {
  entries: [
    { name: 'assets', type: 'dir', size: 0, mtime: 1760000000 },
    { name: 'app.js', type: 'file', size: 120, mtime: 1760000000 },
    { name: 'index.html', type: 'file', size: 2048, mtime: 1760000000 },
    { name: 'package.json', type: 'file', size: 330, mtime: 1760000000 },
  ],
};
const FILES_SUB = { entries: [{ name: 'logo.png', type: 'file', size: 70, mtime: 1760000000 }] };

const SERVER = {
  id: 'srv-1',
  name: 'interactive',
  runtime: 'Node.js',
  runtimeLabel: 'Node.js 20',
  status: 'online',
  cpuMilli: 500,
  ramMb: 512,
  storageGb: 5,
  env: [],
  envCount: 0,
  mainFile: 'index.js',
  port: 3000,
  autoBackup: true,
  autoBackupRetain: 7,
};

const BACKUPS = [
  { id: 'b-1', name: 'snap-1', status: 'ready', type: 'manual', sizeBytes: 12345678, createdAt: new Date(Date.now() - 3600_000).toISOString() },
  { id: 'b-2', name: 'snap-2', status: 'ready', type: 'auto', sizeBytes: 87654321, createdAt: new Date(Date.now() - 86400_000).toISOString() },
];

export async function run({ window }) {
  const results = [];
  const consoleErrors = [];
  const origError = console.error;
  console.error = (...a) => {
    const t = a.map(String).join(' ');
    if (!/act\(|not wrapped in act/.test(t)) consoleErrors.push(t.slice(0, 400));
    origError(...a);
  };
  window.addEventListener('error', (e) => consoleErrors.push('window.onerror: ' + String(e.error?.stack || e.message).slice(0, 400)));

  const subusers = [];
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = init?.method || 'GET';
    requests.push(`${method} ${url}`);
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/users/me')) return json({ id: 'u-1', email: 'lv@example.com', name: 'LV', role: 'user', status: 'active', planId: 'starter' });
    if (url.includes('/servers/srv-1/grant')) return json({ isOwner: true, permissions: ['server.view', 'console.access', 'files.read', 'files.write', 'backup.read', 'backup.write', 'packages.write', 'control.power', 'settings.update', 'schedule.manage'] });
    if (url.includes('/servers/srv-1/schedules')) return json([]);
    if (url.includes('/servers/srv-1/users')) {
      if (method === 'POST') {
        const body = JSON.parse(init?.body || '{}');
        const perms = (body.permissions ?? []).includes('server.view') ? body.permissions : ['server.view', ...(body.permissions ?? [])];
        subusers.push({ userId: 'u-2', email: body.email, permissions: perms, status: 'active', name: 'Friend', avatarUrl: null, createdAt: new Date().toISOString() });
        return json({ userId: 'u-2', permissions: perms }, 201);
      }
      if (method === 'DELETE') {
        const idx = subusers.findIndex((s) => `${s.userId}` && url.endsWith(s.userId));
        if (idx >= 0) subusers.splice(idx, 1);
        return json({ ok: true });
      }
      return json(subusers);
    }
    if (url.includes('/servers/srv-1/files?')) {
      const p = new URL(url, 'http://x').searchParams.get('path') || '';
      return json(p === 'assets' ? FILES_SUB : FILES_ROOT);
    }
    if (url.includes('/servers/srv-1/files/content')) return json({ content: 'console.log(1)' });
    if (url.includes('/servers/srv-1/backups/quota')) return json({ slots: 2, used: 1, planName: 'starter' });
    if (url.includes('/servers/srv-1/backups')) return json(BACKUPS);
    if (url.includes('/servers/srv-1')) return json(SERVER);
    if (url.includes('/servers')) return json([SERVER]);
    return json({});
  };

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const click = async (el) => {
    if (!el) return false;
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(250);
    return true;
  };
  const btn = (pred) => [...window.document.querySelectorAll('button')].find(pred);
  const text = () => window.document.body.textContent;
  const record = async (name, fn) => {
    try {
      const err = await fn();
      return { name, ok: !err, error: err ?? '' };
    } catch (e) {
      return { name, ok: false, error: String(e?.message || e).slice(0, 300) };
    }
  };

  const host = window.document.createElement('div');
  window.document.body.appendChild(host);
  createRoot(host).render(
    h(StrictMode, null,
      h(MemoryRouter, { initialEntries: ['/dashboard/servers/srv-1'] },
        h(QueryClientProvider, { client: qc },
          h(AuthProvider, null,
            h(Routes, null, h(Route, { path: '/dashboard/servers/:id', element: h(ServerDetail, null) }))))),
    ),
  );
  await sleep(2500);
  console.error('[step] page mounted');

  // ---------------------------------------------------------------- files tab
  await click(btn((b) => b.textContent?.trim() === 'Files'));
  await sleep(2000);
  console.error('[step] files tab clicked');
  const filesBody = text();
  results.push(await record('files: sections split folders from files', async () =>
    (filesBody.includes('Folders') && filesBody.includes('Files') ? '' : 'missing section headings')));
  results.push(await record('files: rows render from the API', async () =>
    (filesBody.includes('app.js') && filesBody.includes('assets') ? '' : 'no entries rendered')));
  results.push(await record('files: no error panel', async () =>
    (/Unable to load files/.test(filesBody) ? 'error panel visible' : '')));

  // tree: expanding fetches the nested folder (regression: the icon/component
  // mix-up crashed the whole tab here)
  const expand = btn((b) => (b.getAttribute('aria-label') || '').includes('Expand assets'));
  if (expand) {
    await click(expand);
    await sleep(900);
  }
  results.push(
    await record('files: folder tree expands (the crash regression)', async () =>
      (requests.some((r) => r.includes('path=assets')) ? '' : 'no nested folder request')),
  );

  // navigate into the folder, then open a file in the editor
  const folderRow = btn((b) => (b.getAttribute('title') || '') === 'assets' || (b.getAttribute('title') || '').includes('Open folder'));
  await click(folderRow ?? btn((b) => b.textContent?.trim() === 'assets'));
  await sleep(1200);
  results.push(
    await record('files: navigating into a folder works', async () =>
      (requests.some((r) => r.includes('path=assets')) ? '' : 'no request for the folder')),
  );
  const fileRow = btn((b) => b.textContent?.includes('app.js'));
  await click(fileRow);
  await sleep(1500);
  results.push(
    await record('files: opening a file loads the editor', async () => {
      const t = text();
      return t.includes('saved') || t.includes('unsaved') || !!window.document.querySelector('.cm-editor') ? '' : 'editor did not open';
    }),
  );
  await click(btn((b) => (b.getAttribute('aria-label') || '').includes('Back to files')));
  await sleep(1000);

  // ---------------------------------------------------------------- users tab
  await click(btn((b) => b.textContent?.trim() === 'Users'));
  await sleep(2000);
  const usersBody = text();
  results.push(
    await record('users: panel renders for the owner', async () =>
      (usersBody.includes('Share this server') && usersBody.includes('Their account email') ? '' : 'panel missing')),
  );
  const input = window.document.querySelector('input[dir="ltr"]');
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'friend@example.com');
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await sleep(250);
  }
  await click(btn((b) => b.textContent?.includes('Share server')));
  await sleep(1800);
  results.push(
    await record('users: sharing adds the person to the list', async () =>
      (text().includes('friend@example.com') ? '' : 'subuser row missing')),
  );
  const removeBtn = btn((b) => (b.getAttribute('aria-label') || '').startsWith('Remove '));
  await click(removeBtn);
  await sleep(400);
  await click(btn((b) => b.textContent?.trim() === 'Remove access'));
  await sleep(1500);
  results.push(
    await record('users: removing revokes the row', async () => (!text().includes('friend@example.com') ? '' : 'still listed')),
  );

  // -------------------------------------------------------------- schedules tab
  await click(btn((b) => b.textContent?.trim() === 'Schedules'));
  await sleep(1800);
  const schedBody = text();
  results.push(
    await record('schedules: panel renders', async () => (schedBody.includes('Scheduled tasks') ? '' : 'panel missing')),
  );
  results.push(
    await record('schedules: the owner sees the create button', async () => {
      const b = btn((x) => x.textContent?.includes('New schedule'));
      return b ? '' : 'owner cannot create schedules (grant returns [] for owners)';
    }),
  );

  // ---------------------------------------------------------------- backups tab
  await click(btn((b) => b.textContent?.trim() === 'Backups'));
  await sleep(1800);
  const backBody = text();
  results.push(
    await record('backups: hero stats render from real data', async () => {
      const ok = backBody.includes('Slots') || backBody.includes('slots') || /2\/2/.test(backBody) || backBody.includes('Protected');
      return ok ? '' : 'hero did not render';
    }),
  );
  results.push(
    await record('backups: snapshot rows render with size and time', async () =>
      (backBody.includes('snap-1') && backBody.includes('snap-2') ? '' : 'snapshots missing')),
  );

  console.error('[step] run complete');
  return { results, consoleErrors };
}
