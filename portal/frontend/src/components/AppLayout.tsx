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
  { to: '/storage', label: 'Storage', icon: IconDatabase, perm: 'view_all_calls' },
  { to: '/settings', label: 'Settings', icon: IconAdjustmentsHorizontal, perm: 'manage_users' },
];

function initials(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return name.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function UserMenu({
  username,
  onLogout,
  compact = false,
}: {
  username?: string;
  onLogout: () => void;
  compact?: boolean;
}) {
  return (
    <Group
      gap="sm"
      wrap="nowrap"
      justify={compact ? 'flex-end' : 'space-between'}
      w={compact ? undefined : '100%'}
    >
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
        <div className={classes.avatar} title={username}>
          {initials(username)}
        </div>
        {!compact && (
          <Text size="sm" c="dimmed" truncate style={{ flex: 1, minWidth: 0 }}>
            {username}
          </Text>
        )}
      </Group>
      <Tooltip label="Sign out">
        <ActionIcon variant="subtle" color="gray" onClick={onLogout} aria-label="Logout">
          <IconLogout size={18} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

function AppLayoutInner() {
  const [opened, { toggle, close }] = useDisclosure();
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <AppShell
      header={{ height: { base: 54, sm: 0 } }}
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="lg"
    >
      {/* Mobile-only: burger + compact user. Desktop uses navbar footer instead. */}
      <AppShell.Header className={classes.header} hiddenFrom="sm">
        <Group h="100%" px="md" justify="space-between">
          <Burger opened={opened} onClick={toggle} size="sm" />
          <UserMenu username={user?.username} onLogout={logout} compact />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar className={classes.navbar} p="md">
        <AppShell.Section mb="lg" pl="xs">
          <BrandMark />
        </AppShell.Section>
        <AppShell.Section grow>
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
                  onClick={close}
                >
                  <Icon size={18} stroke={1.8} />
                  {item.label}
                </Link>
              );
            })}
          </Stack>
        </AppShell.Section>
        <AppShell.Section className={classes.userFooter} pt="md">
          <UserMenu username={user?.username} onLogout={logout} />
        </AppShell.Section>
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
