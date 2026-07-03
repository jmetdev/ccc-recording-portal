import { AppShell, Burger, Group, NavLink, Text, ActionIcon } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconDashboard, IconSearch, IconFileText, IconUsers, IconLogout, IconHeartbeat } from '@tabler/icons-react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { hasPermission } from '../api/client';
import { ThemeSwitcher } from './ThemeSwitcher';

const nav = [
  { to: '/', label: 'Dashboard', icon: IconDashboard, end: true },
  { to: '/calls', label: 'Call Search', icon: IconSearch, end: false },
  { to: '/transcripts', label: 'Transcription Search', icon: IconFileText, perm: 'view_transcripts', end: false },
  { to: '/health', label: 'Health / Status', icon: IconHeartbeat, perm: 'manage_users', end: false },
  { to: '/admin', label: 'Admin', icon: IconUsers, perm: 'manage_users', end: false },
];

function AppLayoutInner() {
  const [opened, { toggle }] = useDisclosure();
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
      styles={{
        navbar: {
          zIndex: 300,
        },
      }}
    >
      <AppShell.Header style={{ zIndex: 300 }}>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text fw={600} size="lg">
              Call Recording Portal
            </Text>
          </Group>
          <Group>
            <Text size="sm" c="dimmed">
              {user?.username}
            </Text>
            <ThemeSwitcher />
            <ActionIcon variant="subtle" onClick={logout} aria-label="Logout">
              <IconLogout size={18} />
            </ActionIcon>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md" style={{ zIndex: 300 }}>
        {nav.map((item) => {
          if (item.perm && !hasPermission(user, item.perm)) return null;
          const Icon = item.icon;
          const active = item.end
            ? location.pathname === item.to
            : location.pathname === item.to || location.pathname.startsWith(item.to + '/');
          return (
            <NavLink
              key={item.to}
              component={Link}
              to={item.to}
              label={item.label}
              leftSection={<Icon size={18} />}
              active={active}
            />
          );
        })}
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}

export function AppLayout() {
  return <AppLayoutInner />;
}
