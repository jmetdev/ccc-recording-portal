import { AppShell, Burger, Group, NavLink, Text, ActionIcon, useMantineColorScheme } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconDashboard, IconSearch, IconFileText, IconUsers, IconSun, IconMoon, IconLogout } from '@tabler/icons-react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { hasPermission } from '../api/client';
import { useEffect } from 'react';

const nav = [
  { to: '/', label: 'Dashboard', icon: IconDashboard },
  { to: '/calls', label: 'Call Search', icon: IconSearch },
  { to: '/transcripts', label: 'Transcription Search', icon: IconFileText, perm: 'view_transcripts' },
  { to: '/admin', label: 'Admin', icon: IconUsers, perm: 'manage_users' },
];

export function AppLayout() {
  const [opened, { toggle }] = useDisclosure();
  const { user, logout } = useAuth();
  const location = useLocation();
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  useEffect(() => {
    document.body.classList.remove('theme-webex-light', 'theme-webex-dark');
    document.body.classList.add(colorScheme === 'dark' ? 'theme-webex-dark' : 'theme-webex-light');
  }, [colorScheme]);

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
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

      <AppShell.Navbar p="md">
        {nav.map((item) => {
          if (item.perm && !hasPermission(user, item.perm)) return null;
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              component={Link}
              to={item.to}
              label={item.label}
              leftSection={<Icon size={18} />}
              active={location.pathname === item.to || location.pathname.startsWith(item.to + '/')}
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
