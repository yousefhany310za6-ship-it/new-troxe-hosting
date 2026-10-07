import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';

import App from './App.jsx';
import { QueryProvider } from '@/lib/queryProvider.jsx';
import { APP_BASE } from './lib/appBase.js';
import 'flag-icons/css/flag-icons.min.css';
import './index.css';

// BrowserRouter gives clean URLs with no hash ("/signin" instead of "/#/signin").
// StrictMode is intentionally omitted: the original site runs its observers and
// counters exactly once per mount, and StrictMode double-invokes effects in dev.
//
// Direct visits to nested routes need the server to answer with index.html:
// - Hosts with rewrite rules use vercel.json / _redirects (see project root).
// - Hosts without rewrites fall back to 404.html, which bounces the original
//   path back as "/?/path" and the decode script in index.html restores it
//   before the app boots.
const basename = APP_BASE === '/' ? undefined : APP_BASE.replace(/\/+$/, '');

// A deploy replaces the hashed chunks: a tab opened before it fails to import
// the old ones ("Failed to fetch dynamically imported module"). Reload once to
// pick up the new index.html (guarded so a real outage cannot loop).
window.addEventListener('vite:preloadError', (event) => {
    const last = Number(sessionStorage.getItem('troxe:chunk-reload') || 0);
    if (Date.now() - last < 30_000) return;
    sessionStorage.setItem('troxe:chunk-reload', String(Date.now()));
    event.preventDefault();
    window.location.reload();
});

// The app booted: cancel the index.html white-page guard.
if (window.__troxeBootTimer) {
    clearTimeout(window.__troxeBootTimer);
    window.__troxeBootTimer = null;
}
document.getElementById('boot-fail')?.remove();

createRoot(document.getElementById('root')).render(
    <BrowserRouter basename={basename}>
        <QueryProvider>
            <App />
            <Toaster position="top-right" theme="dark" />
        </QueryProvider>
    </BrowserRouter>
);
