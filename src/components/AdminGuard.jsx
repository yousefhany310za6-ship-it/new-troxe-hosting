import { Navigate, Outlet } from 'react-router-dom';
import PageLoader from '@/components/PageLoader.jsx';
import { useAuth } from '@/context/AuthContext.jsx';

/** Only `role === 'admin'` may enter /admin — everyone else goes home. */
export default function AdminGuard() {
  const { status, user } = useAuth();
  if (status === 'loading') return <PageLoader />;
  if (status === 'guest') return <Navigate to="/signin" replace />;
  if (user?.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}