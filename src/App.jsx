import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

import ScrollManager from './components/ScrollManager.jsx';
import PageLoader from './components/PageLoader.jsx';
import Home from './pages/Home.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import RequireAuth, { GuestOnly } from './components/guards.jsx';

// Auth pages (and their `motion` dependency) stay out of the landing bundle.
const SignIn = lazy(() => import('./pages/SignIn.jsx'));
const SignUp = lazy(() => import('./pages/SignUp.jsx'));
const OAuthCallback = lazy(() => import('./pages/OAuthCallback.jsx'));
const VerifyEmail = lazy(() => import('./pages/EmailFlows.jsx').then((m) => ({ default: m.VerifyEmail })));
const ForgotPassword = lazy(() => import('./pages/EmailFlows.jsx').then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import('./pages/EmailFlows.jsx').then((m) => ({ default: m.ResetPassword })));

// Content pages are also split out so the landing page stays lean.
const About = lazy(() => import('./pages/About.jsx'));
const Contact = lazy(() => import('./pages/Contact.jsx'));
const Terms = lazy(() => import('./pages/Terms.jsx'));
const Privacy = lazy(() => import('./pages/Privacy.jsx'));
const PricingPage = lazy(() => import('./pages/PricingPage.jsx'));
const FaqPage = lazy(() => import('./pages/FaqPage.jsx'));
const FeaturesPage = lazy(() => import('./pages/FeaturesPage.jsx'));
const ServicesPage = lazy(() => import('./pages/ServicesPage.jsx'));

// Dashboard shell + sections (now wired to API).
const DashboardLayout = lazy(() => import('./pages/dashboard/DashboardLayout.jsx'));
const Overview = lazy(() => import('./pages/dashboard/Overview.jsx'));
const Activity = lazy(() => import('./pages/dashboard/Activity.jsx'));
const Servers = lazy(() => import('./pages/dashboard/Servers.jsx'));
const ServerDetail = lazy(() => import('./pages/dashboard/ServerDetail.jsx'));
const CreateServer = lazy(() => import('./pages/dashboard/CreateServer.jsx'));
const Settings = lazy(() => import('./pages/dashboard/Settings.jsx'));

// Admin console (role === 'admin', guarded by AdminGuard).
const AdminGuard = lazy(() => import('./components/AdminGuard.jsx'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout.jsx'));
const AdminOverview = lazy(() => import('./pages/admin/Overview.jsx'));
const AdminUsers = lazy(() => import('./pages/admin/Users.jsx'));
const AdminUserDetail = lazy(() => import('./pages/admin/UserDetail.jsx'));
const AdminServers = lazy(() => import('./pages/admin/Servers.jsx'));
const AdminNodes = lazy(() => import('./pages/admin/Nodes.jsx'));
const AdminPlans = lazy(() => import('./pages/admin/Plans.jsx'));
const AdminAudit = lazy(() => import('./pages/admin/Audit.jsx'));

// The WebGL globe (cobe) is only needed on the 404 route, so it stays out of
// the landing page bundle.
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.jsx'));

export default function App() {
    return (
        <AuthProvider>
            <ScrollManager />
            <Suspense fallback={<PageLoader />}>
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/signin" element={<GuestOnly><SignIn /></GuestOnly>} />
                    <Route path="/login" element={<GuestOnly><SignIn /></GuestOnly>} />
                    <Route path="/signup" element={<GuestOnly><SignUp /></GuestOnly>} />
                    {/* OAuth landing: the backend 302s here after the provider round-trip */}
                    <Route path="/oauth/callback" element={<OAuthCallback />} />
                    <Route path="/forgot-password" element={<GuestOnly><ForgotPassword /></GuestOnly>} />
                    <Route path="/reset-password" element={<GuestOnly><ResetPassword /></GuestOnly>} />
                    <Route path="/about" element={<About />} />
                    <Route path="/contact" element={<Contact />} />
                    <Route path="/terms" element={<Terms />} />
                    <Route path="/privacy" element={<Privacy />} />
                    <Route path="/pricing" element={<PricingPage />} />
                    <Route path="/faq" element={<FaqPage />} />
                    <Route path="/features" element={<FeaturesPage />} />
                    <Route path="/services" element={<ServicesPage />} />
                    <Route element={<RequireAuth />}>
                        <Route path="/verify-email" element={<VerifyEmail />} />
                        <Route path="/dashboard" element={<DashboardLayout />}>
                            <Route index element={<Overview />} />
                            <Route path="servers" element={<Servers />} />
                            <Route path="servers/new" element={<CreateServer />} />
                            <Route path="servers/:id" element={<ServerDetail />} />
                            <Route path="activity" element={<Activity />} />
                            <Route path="settings" element={<Settings />} />
                        </Route>
                        <Route element={<AdminGuard />}>
                            <Route path="/admin" element={<AdminLayout />}>
                                <Route index element={<AdminOverview />} />
                                <Route path="users" element={<AdminUsers />} />
                                <Route path="users/:id" element={<AdminUserDetail />} />
                                <Route path="servers" element={<AdminServers />} />
                                <Route path="servers/new" element={<CreateServer adminMode />} />
                                <Route path="nodes" element={<AdminNodes />} />
                                <Route path="plans" element={<AdminPlans />} />
                                <Route path="audit" element={<AdminAudit />} />
                            </Route>
                        </Route>
                    </Route>
                    {/* Any unknown URL renders the Cosmic 404 page */}
                    <Route path="*" element={<NotFoundPage />} />
                </Routes>
            </Suspense>
        </AuthProvider>
    );
}
