import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { hasPermission } from '../api/client';
import { Center, Loader } from '@mantine/core';

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
