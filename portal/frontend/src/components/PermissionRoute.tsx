import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Loader, Center } from '@mantine/core';

export function PermissionRoute({ permission }: { permission: string }) {
  const { hasPermission, loading } = useAuth();
  if (loading) {
    return (
      <Center h="50vh">
        <Loader />
      </Center>
    );
  }
  if (!hasPermission(permission)) return <Navigate to="/" replace />;
  return <Outlet />;
}
