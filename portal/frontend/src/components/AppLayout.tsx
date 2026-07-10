import { AppShell, Burger, Group, Stack, Text, ActionIcon, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconCloud,
  IconBroadcast,
  IconSearch,
  IconLock,
  IconDatabase,
  IconAdjustmentsHorizontal,
  IconLogout,
} from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { hasPermission } from '../api/client';
import { BrandMark } from './BrandMark';
import classes from './AppLayout.module.css';

type NavItem = { to: string; label: string; icon: Icon; perm?: string; end?: boolean };

const nav: NavItem[] = [
  { to: '/', label: 'Overview', icon: IconCloud, end: true },
  { to: '/recordings', label: 'Recordings', icon: IconBroadcast },
  { to: '/search', label: 'Search', icon: IconSearch, perm: 'view_transcripts' },
  { to: '/retention', label: 'Retention', icon: IconLock, perm: 'manage_retention' },
  { to: '/storage', label: 'Storage', icon: IconDatabase },
  { to: '/settings', label: 'Settings', icon: IconAdjustmentsHorizontal, perm: 'manage_users' },
];

function initials(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return name.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function AppLayoutInner() {
  const [opened, { toggle }] = useDisclosure();
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <AppShell
      header={{ height: 54 }}
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="lg"
    >
      <AppShell.Header className={classes.header}>
        <Group h="100%" px="lg" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Group gap={7} visibleFrom="sm">
              <span className={classes.chip}>BIB</span>
              <span className={classes.chip}>SIPREC</span>
            </Group>
          </Group>
          <Group gap="md">
            <Text size="sm" c="dimmed" visibleFrom="sm">
              {user?.username}
            </Text>
            <div className={classes.avatar} title={user?.username}>
              {initials(user?.username)}
            </div>
            <Tooltip label="Sign out">
              <ActionIcon variant="subtle" color="gray" onClick={logout} aria-label="Logout">
                <IconLogout size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar className={classes.navbar} p="md">
        <div style={{ marginBottom: 'var(--mantine-spacing-lg)', paddingLeft: 'var(--mantine-spacing-xs)' }}>
          <BrandMark />
        </div>
        <Stack gap={4}>
          {nav.map((item) => {
            if (item.perm && !hasPermission(user, item.perm)) return null;
            const Icon = item.icon;
            const active = item.end
              ? location.pathname === item.to
              : location.pathname === item.to || location.pathname.startsWith(item.to + '/');
            return (
              <Link
                key={item.to}
                to={item.to}
                className={active ? `${classes.navItem} ${classes.navItemActive}` : classes.navItem}
              >
                <Icon size={18} stroke={1.8} />
                {item.label}
              </Link>
            );
          })}
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main className={classes.main}>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}

export function AppLayout() {
  return <AppLayoutInner />;
}
