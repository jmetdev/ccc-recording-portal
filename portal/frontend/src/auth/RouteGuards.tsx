import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { hasPermission } from '../api/client';
import { getOidcToken } from '../suite/api';
import { Center, Loader } from '@mantine/core';

/** Gates suite routes (setup wizard, admin console) that only need a raw
 * Keycloak token verified by the suite backend — not a portal user session,
 * which a brand-new or superadmin-only account may never have. */
export function RequireOidcToken() {
  if (!getOidcToken()) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function RequirePermission({ permission }: { permission: string }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user || !hasPermission(user, permission)) return <Navigate to="/" replace />;
  return <Outlet />;
}
