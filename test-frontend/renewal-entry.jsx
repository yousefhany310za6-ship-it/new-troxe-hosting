/**
 * Interactive entry for the Work.ink return page.
 *
 * Separate from the ServerDetail harness because this page is reached by a
 * REDIRECT on a phone: the thing most likely to break is the copy button doing
 * nothing silently when `navigator.clipboard` is unavailable, which no
 * render-only smoke test can catch. So this mounts the real component, stubs
 * the clipboard, clicks the button and asserts the exact key landed in it —
 * twice: once with the async clipboard API, and once WITHOUT it, to prove the
 * mobile fallback path works too.
 */
import { createElement as h, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import RenewalReturn from '../src/pages/dashboard/RenewalReturn.jsx';

const KEY = '971c0450-6df6-4e8f-8a7e-a162dcc21bd9';

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

  globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const click = async (el) => {
    if (!el) return false;
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(250);
    return true;
  };
  const btn = (pred) => [...window.document.querySelectorAll('button')].find(pred);
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

  // ---------------------------------------------------------------- case 1
  // Modern path: navigator.clipboard present.
  const clipboard = { text: null };
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: async (t) => { clipboard.text = t; } },
    configurable: true,
    writable: true,
  });

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const mount = (target) =>
    createRoot(target).render(
      h(StrictMode, null,
        h(MemoryRouter, { initialEntries: [`/dashboard/renew/return?session=s-1&key=${KEY}`] },
          h(QueryClientProvider, { client: qc },
            h(Routes, null, h(Route, { path: '/dashboard/renew/return', element: h(RenewalReturn, null) }))))),
    );

  mount(host);
  await sleep(1200);

  const body = window.document.body.textContent;
  results.push(await record('renewal: the key is shown to the user', async () =>
    (body.includes(KEY) ? '' : 'key not rendered')));

  // The label is checked BEFORE the click: once copied, the accessible label
  // becomes "Key copied", so a post-click probe for /key/ matches nothing and
  // would report a failure that is purely an artifact of the check's own order.
  const copyBtn = btn((x) => (x.getAttribute('aria-label') || '').toLowerCase().includes('key'));
  results.push(await record('renewal: a copy control is offered', async () =>
    (copyBtn ? '' : 'no copy button found')));

  results.push(await record('renewal: the button is labelled for screen readers', async () =>
    (copyBtn?.getAttribute('aria-label') && copyBtn?.getAttribute('title') ? '' : 'missing accessible label/title')));

  await click(copyBtn);
  results.push(await record('renewal: clicking copies the exact key', async () =>
    (clipboard.text === KEY ? '' : `clipboard got ${JSON.stringify(clipboard.text)}`)));

  results.push(await record('renewal: the button confirms the copy', async () => {
    const b = btn((x) => (x.getAttribute('aria-label') || '') === 'Key copied');
    return b ? '' : 'no confirmation state after copy';
  }));

  host.remove();

  // ---------------------------------------------------------------- case 2
  // Mobile path: no navigator.clipboard at all. This is the regression that
  // matters — a silent no-op copy on a phone, with no error shown anywhere.
  const host2 = window.document.createElement('div');
  window.document.body.appendChild(host2);
  Object.defineProperty(window.navigator, 'clipboard', { value: undefined, configurable: true, writable: true });

  // execCommand is what the fallback leans on; jsdom does not implement it, so
  // record whether it was attempted and with what.
  let execTried = false;
  let execValue = null;
  window.document.execCommand = function (cmd) {
    if (cmd === 'copy') {
      execTried = true;
      execValue = window.document.querySelector('textarea')?.value ?? null;
      return true;
    }
    return false;
  };

  mount(host2);
  await sleep(1200);

  await click(btn((x) => (x.getAttribute('aria-label') || '').includes('key')));
  results.push(await record('renewal: falls back to execCommand without navigator.clipboard', async () =>
    (execTried ? '' : 'the fallback never ran — the tap would be a silent no-op')));
  results.push(await record('renewal: the fallback copies the exact key', async () =>
    (execValue === KEY ? '' : `fallback got ${JSON.stringify(execValue)}`)));

  host2.remove();

  console.error('[step] renewal run complete');
  return { results, consoleErrors };
}