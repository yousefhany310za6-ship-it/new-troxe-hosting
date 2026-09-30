import { Navigate, Outlet, useLocation } from 'react-router-dom';
import PageLoader from '@/components/PageLoader.jsx';
import { useAuth } from '@/context/AuthContext.jsx';

/** Wrap dashboard routes — redirects guests to sign-in. */
export default function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <PageLoader />;
  if (status === 'guest') return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/** Wrap sign-in / sign-up routes — redirects authed users to dashboard. */
export function GuestOnly({ children, fallbackTo = '/dashboard' }) {
  const { status } = useAuth();
  if (status === 'loading') return <PageLoader />;
  if (status === 'authed') return <Navigate to={fallbackTo} replace />;
  return children;
}