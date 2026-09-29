import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App.jsx';
import { APP_BASE } from './lib/appBase.js';
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

createRoot(document.getElementById('root')).render(
    <BrowserRouter basename={basename}>
        <App />
    </BrowserRouter>
);
