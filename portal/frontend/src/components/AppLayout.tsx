import { useEffect, useState } from 'react';
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
  IconChevronLeft,
  IconChevronRight,
} from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { hasPermission } from '../api/client';
import { BrandMark } from './BrandMark';
import classes from './AppLayout.module.css';

const NAV_EXPANDED_KEY = 'ccc.navExpanded';
const NAV_WIDTH_COLLAPSED = 80;
const NAV_WIDTH_EXPANDED = 220;

type NavItem = { to: string; label: string; icon: Icon; perm?: string; end?: boolean };

const nav: NavItem[] = [
  { to: '/', label: 'Overview', icon: IconCloud, end: true },
  { to: '/recordings', label: 'Recordings', icon: IconBroadcast },
  { to: '/search', label: 'Search', icon: IconSearch, perm: 'view_transcripts' },
  { to: '/retention', label: 'Retention', icon: IconLock, perm: 'manage_retention' },
  { to: '/storage', label: 'Storage', icon: IconDatabase, perm: 'view_all_calls' },
  { to: '/settings', label: 'Settings', icon: IconAdjustmentsHorizontal, perm: 'manage_users' },
];

function readNavExpanded(): boolean {
  try {
    return localStorage.getItem(NAV_EXPANDED_KEY) === 'true';
  } catch {
    return false;
  }
}

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
  collapsed = false,
}: {
  username?: string;
  onLogout: () => void;
  compact?: boolean;
  collapsed?: boolean;
}) {
  return (
    <Group
      gap="sm"
      wrap="nowrap"
      justify={compact || collapsed ? 'center' : 'space-between'}
      w={compact || collapsed ? undefined : '100%'}
      className={collapsed ? classes.userFooterCollapsed : undefined}
    >
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
        <div className={classes.avatar} title={username}>
          {initials(username)}
        </div>
        {!compact && !collapsed && (
          <Text size="sm" className={classes.userName} truncate style={{ flex: 1, minWidth: 0 }}>
            {username}
          </Text>
        )}
      </Group>
      {!collapsed && (
        <Tooltip label="Sign out">
          <ActionIcon
            variant="subtle"
            className={classes.logoutBtn}
            onClick={onLogout}
            aria-label="Logout"
          >
            <IconLogout size={18} />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );
}

function AppLayoutInner() {
  const [opened, { toggle, close }] = useDisclosure();
  const [navExpanded, setNavExpanded] = useState(readNavExpanded);
  const { user, logout } = useAuth();
  const location = useLocation();

  useEffect(() => {
    try {
      localStorage.setItem(NAV_EXPANDED_KEY, String(navExpanded));
    } catch {
      /* ignore */
    }
  }, [navExpanded]);

  const desktopExpanded = navExpanded;
  const navWidth = desktopExpanded ? NAV_WIDTH_EXPANDED : NAV_WIDTH_COLLAPSED;

  return (
    <AppShell
      header={{ height: { base: 54, sm: 0 } }}
      navbar={{
        width: { base: NAV_WIDTH_EXPANDED, sm: navWidth },
        breakpoint: 'sm',
        collapsed: { mobile: !opened },
      }}
      padding="lg"
      styles={{
        navbar: {
          backgroundColor: '#1997e4',
          borderRight: 'none',
        },
        header: {
          backgroundColor: '#1997e4',
          borderBottom: 'none',
        },
      }}
    >
      <AppShell.Header className={classes.header} hiddenFrom="sm">
        <Group h="100%" px="md" justify="space-between">
          <Burger opened={opened} onClick={toggle} size="sm" />
          <UserMenu username={user?.username} onLogout={logout} compact />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar
        className={`${classes.navbar}${desktopExpanded ? '' : ` ${classes.navbarCollapsed}`}`}
        p="md"
      >
        <AppShell.Section
          className={`${classes.brandSection}${desktopExpanded ? '' : ` ${classes.brandSectionCollapsed}`}`}
          mb="sm"
        >
          <BrandMark variant="onColor" iconOnly={!desktopExpanded} />
          {desktopExpanded && (
            <Tooltip label="Collapse menu">
              <ActionIcon
                variant="subtle"
                className={classes.navToggle}
                onClick={() => setNavExpanded(false)}
                aria-label="Collapse menu"
                visibleFrom="sm"
              >
                <IconChevronLeft size={18} />
              </ActionIcon>
            </Tooltip>
          )}
        </AppShell.Section>

        {!desktopExpanded && (
          <AppShell.Section mb="sm" visibleFrom="sm">
            <Tooltip label="Expand menu" position="right">
              <ActionIcon
                variant="subtle"
                className={classes.navToggle}
                onClick={() => setNavExpanded(true)}
                aria-label="Expand menu"
                w="100%"
              >
                <IconChevronRight size={18} />
              </ActionIcon>
            </Tooltip>
          </AppShell.Section>
        )}

        <AppShell.Section grow>
          <Stack gap={4}>
            {nav.map((item) => {
              if (item.perm && !hasPermission(user, item.perm)) return null;
              const Icon = item.icon;
              const active = item.end
                ? location.pathname === item.to
                : location.pathname === item.to || location.pathname.startsWith(item.to + '/');
              const link = (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`${classes.navItem}${active ? ` ${classes.navItemActive}` : ''}${
                    desktopExpanded ? '' : ` ${classes.navItemCollapsed}`
                  }`}
                  onClick={close}
                >
                  <Icon size={18} stroke={1.8} className={classes.navIcon} />
                  {desktopExpanded && item.label}
                </Link>
              );
              if (!desktopExpanded) {
                return (
                  <Tooltip key={item.to} label={item.label} position="right">
                    {link}
                  </Tooltip>
                );
              }
              return link;
            })}
          </Stack>
        </AppShell.Section>

        <AppShell.Section className={classes.userFooter} pt="md">
          <UserMenu
            username={user?.username}
            onLogout={logout}
            collapsed={!desktopExpanded}
          />
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
