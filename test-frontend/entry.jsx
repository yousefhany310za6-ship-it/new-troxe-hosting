/**
 * Smoke-render entry: imports every routed page and exposes it as a route
 * tree (mirroring App.jsx, minus the auth guards so the PAGES themselves
 * are what gets exercised). Rendered by smoke.mjs with react-dom/server —
 * no effects run, so nothing touches the network.
 */
import { Route, Routes } from 'react-router-dom';

import Home from '../src/pages/Home.jsx';
import SignIn from '../src/pages/SignIn.jsx';
import SignUp from '../src/pages/SignUp.jsx';
import About from '../src/pages/About.jsx';
import Contact from '../src/pages/Contact.jsx';
import Terms from '../src/pages/Terms.jsx';
import Privacy from '../src/pages/Privacy.jsx';
import PricingPage from '../src/pages/PricingPage.jsx';
import FaqPage from '../src/pages/FaqPage.jsx';
import FeaturesPage from '../src/pages/FeaturesPage.jsx';
import ServicesPage from '../src/pages/ServicesPage.jsx';
import NotFoundPage from '../src/pages/NotFoundPage.jsx';

import DashboardLayout from '../src/pages/dashboard/DashboardLayout.jsx';
import Overview from '../src/pages/dashboard/Overview.jsx';
import Servers from '../src/pages/dashboard/Servers.jsx';
import CreateServer from '../src/pages/dashboard/CreateServer.jsx';
import ServerDetail from '../src/pages/dashboard/ServerDetail.jsx';
import Activity from '../src/pages/dashboard/Activity.jsx';
import Settings from '../src/pages/dashboard/Settings.jsx';
// NOTE: ServerFiles is not a route — it is a <ServerFiles server={...} />
// tab inside ServerDetail (App.jsx has no files route), so it is covered
// by the ServerDetail case rather than rendered without its parent.

import AdminLayout from '../src/pages/admin/AdminLayout.jsx';
import AdminOverview from '../src/pages/admin/Overview.jsx';
import AdminUsers from '../src/pages/admin/Users.jsx';
import AdminUserDetail from '../src/pages/admin/UserDetail.jsx';
import AdminServers from '../src/pages/admin/Servers.jsx';
import AdminNodes from '../src/pages/admin/Nodes.jsx';
import AdminPlans from '../src/pages/admin/Plans.jsx';
import AdminAudit from '../src/pages/admin/Audit.jsx';

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../src/context/AuthContext.jsx';

const UID = '123e4567-e89b-12d3-a456-426614174000';

/** a dashboard route nested under its layout (so layout code runs too) */
const dash = (child, el) => (
  <Routes>
    <Route path="/dashboard" element={<DashboardLayout />}>
      <Route index element={child === 'index' ? el : null} />
      <Route path={child} element={el} />
    </Route>
  </Routes>
);

const admin = (child, el) => (
  <Routes>
    <Route path="/admin" element={<AdminLayout />}>
      <Route index element={child === 'index' ? el : null} />
      <Route path={child} element={el} />
    </Route>
  </Routes>
);

const page = (path, el) => (
  <Routes>
    <Route path={path} element={el} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes>
);

export const cases = [
  { name: 'Home', path: '/', el: page('/', <Home />) },
  { name: 'SignIn', path: '/signin', el: page('/signin', <SignIn />) },
  { name: 'SignUp', path: '/signup', el: page('/signup', <SignUp />) },
  { name: 'About', path: '/about', el: page('/about', <About />) },
  { name: 'Contact', path: '/contact', el: page('/contact', <Contact />) },
  { name: 'Terms', path: '/terms', el: page('/terms', <Terms />) },
  { name: 'Privacy', path: '/privacy', el: page('/privacy', <Privacy />) },
  { name: 'Pricing', path: '/pricing', el: page('/pricing', <PricingPage />) },
  { name: 'Faq', path: '/faq', el: page('/faq', <FaqPage />) },
  { name: 'Features', path: '/features', el: page('/features', <FeaturesPage />) },
  { name: 'Services', path: '/services', el: page('/services', <ServicesPage />) },
  { name: 'NotFound', path: '/nope', el: page('/nope', <NotFoundPage />) },

  { name: 'Dashboard/Overview', path: '/dashboard', el: dash('index', <Overview />) },
  { name: 'Dashboard/Servers', path: '/dashboard/servers', el: dash('servers', <Servers />) },
  { name: 'Dashboard/CreateServer', path: '/dashboard/servers/new', el: dash('servers/new', <CreateServer />) },
  { name: 'Dashboard/ServerDetail', path: `/dashboard/servers/${UID}`, el: dash('servers/:id', <ServerDetail />) },
  { name: 'Dashboard/Activity', path: '/dashboard/activity', el: dash('activity', <Activity />) },
  { name: 'Dashboard/Settings', path: '/dashboard/settings', el: dash('settings', <Settings />) },

  { name: 'Admin/Overview', path: '/admin', el: admin('index', <AdminOverview />) },
  { name: 'Admin/Users', path: '/admin/users', el: admin('users', <AdminUsers />) },
  { name: 'Admin/UserDetail', path: `/admin/users/${UID}`, el: admin('users/:id', <AdminUserDetail />) },
  { name: 'Admin/Servers', path: '/admin/servers', el: admin('servers', <AdminServers />) },
  { name: 'Admin/Nodes', path: '/admin/nodes', el: admin('nodes', <AdminNodes />) },
  { name: 'Admin/Plans', path: '/admin/plans', el: admin('plans', <AdminPlans />) },
  { name: 'Admin/Audit', path: '/admin/audit', el: admin('audit', <AdminAudit />) },
];

/** Render every case server-side; returns [{ok,name,html|error}] and never throws. */
export function run() {
  const out = [];
  for (const c of cases) {
    const t0 = Date.now();
    try {
      const html = renderToString(
        createElement(
          MemoryRouter,
          { initialEntries: [c.path] },
          createElement(
            QueryClientProvider,
            { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
            createElement(AuthProvider, null, c.el),
          ),
        ),
      );
      out.push({ ok: true, name: c.name, html, ms: Date.now() - t0 });
    } catch (e) {
      out.push({
        ok: false,
        name: c.name,
        error: String((e && e.message) || e),
        stack: e && e.stack,
        ms: Date.now() - t0,
      });
    }
  }
  return out;
}
