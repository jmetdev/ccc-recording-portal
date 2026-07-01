import { AppShell, Burger, Group, NavLink, Text, ActionIcon, useMantineColorScheme } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconDashboard, IconSearch, IconFileText, IconUsers, IconSun, IconMoon, IconLogout } from '@tabler/icons-react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { hasPermission } from '../api/client';
import { CallPlayerProvider, useCallPlayer } from './CallPlayerContext';
import { CallPlayerDrawer } from './CallPlayerDrawer';

const DRAWER_HEIGHT = 220;

const nav = [
  { to: '/', label: 'Dashboard', icon: IconDashboard, end: true },
  { to: '/calls', label: 'Call Search', icon: IconSearch, end: false },
  { to: '/transcripts', label: 'Transcription Search', icon: IconFileText, perm: 'view_transcripts', end: false },
  { to: '/admin', label: 'Admin', icon: IconUsers, perm: 'manage_users', end: false },
];

function AppLayoutInner() {
  const [opened, { toggle }] = useDisclosure();
  const { user, logout } = useAuth();
  const location = useLocation();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const { callId } = useCallPlayer();

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
      styles={{
        main: {
          paddingBottom: callId != null ? DRAWER_HEIGHT + 16 : undefined,
        },
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
            <ActionIcon
              variant="subtle"
              onClick={() => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle color scheme"
            >
              {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
            </ActionIcon>
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

      <CallPlayerDrawer />
    </AppShell>
  );
}

export function AppLayout() {
  return (
    <CallPlayerProvider>
      <AppLayoutInner />
    </CallPlayerProvider>
  );
}
