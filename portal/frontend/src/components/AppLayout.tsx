import { useEffect, useState } from 'react';
import { AppShell, Burger, Group } from '@mantine/core';
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
const NAV_WIDTH_COLLAPSED = 88;
const NAV_WIDTH_EXPANDED = 264;

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

  const renderNavLink = (item: NavItem) => {
    const Icon = item.icon;
    const active = item.end
      ? location.pathname === item.to
      : location.pathname === item.to || location.pathname.startsWith(item.to + '/');

    return (
      <Link
        key={item.to}
        to={item.to}
        title={!desktopExpanded ? item.label : undefined}
        className={`${classes.navItem}${active ? ` ${classes.navItemActive}` : ''}${
          desktopExpanded ? '' : ` ${classes.navItemCollapsed}`
        }`}
        onClick={close}
      >
        <span className={classes.navIcon}>
          <Icon size={20} stroke={1.8} />
        </span>
        {desktopExpanded && item.label}
      </Link>
    );
  };

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
          transition: 'width 200ms ease',
          overflow: 'visible',
        },
        header: {
          backgroundColor: '#1997e4',
          borderBottom: 'none',
        },
        main: {
          transition: 'padding-left 200ms ease',
        },
      }}
    >
      <AppShell.Header className={classes.header} hiddenFrom="sm">
        <Group h="100%" px="md" justify="space-between">
          <Burger opened={opened} onClick={toggle} size="sm" />
          <button
            type="button"
            className={`${classes.navItem} ${classes.navItemCollapsed}`}
            onClick={logout}
            aria-label="Logout"
            title="Log out"
          >
            <span className={classes.navIcon}>
              <IconLogout size={20} stroke={1.8} />
            </span>
          </button>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar
        className={`${classes.navbar}${desktopExpanded ? '' : ` ${classes.navbarCollapsed}`}`}
        p={0}
      >
        <button
          type="button"
          className={classes.navPullTab}
          onClick={() => setNavExpanded((v) => !v)}
          aria-label={desktopExpanded ? 'Collapse menu' : 'Expand menu'}
          aria-expanded={desktopExpanded}
          title={desktopExpanded ? 'Collapse menu' : 'Expand menu'}
        >
          {desktopExpanded ? <IconChevronLeft size={15} stroke={2.5} /> : <IconChevronRight size={15} stroke={2.5} />}
        </button>

        <AppShell.Section
          className={`${classes.brandSection}${desktopExpanded ? '' : ` ${classes.brandSectionCollapsed}`}`}
        >
          <BrandMark
            variant="onColor"
            iconOnly={!desktopExpanded}
            size={desktopExpanded ? 44 : 38}
            textSize={desktopExpanded ? 22 : undefined}
          />
        </AppShell.Section>

        <AppShell.Section
          grow
          className={desktopExpanded ? classes.navList : `${classes.navList} ${classes.navListCollapsed}`}
        >
          {nav.map((item) => {
            if (item.perm && !hasPermission(user, item.perm)) return null;
            return renderNavLink(item);
          })}
        </AppShell.Section>

        <AppShell.Section className={`${classes.userFooter}${desktopExpanded ? '' : ` ${classes.userFooterCollapsed}`}`}>
          {desktopExpanded && (
            <div className={classes.userRow}>
              <div className={classes.avatar} title={user?.username}>
                {initials(user?.username)}
              </div>
              <span className={classes.userName}>{user?.username}</span>
            </div>
          )}
          <button
            type="button"
            title={!desktopExpanded ? 'Log out' : undefined}
            className={`${classes.navItem}${desktopExpanded ? '' : ` ${classes.navItemCollapsed}`}`}
            onClick={logout}
            aria-label="Log out"
          >
            <span className={classes.navIcon}>
              <IconLogout size={20} stroke={1.8} />
            </span>
            {desktopExpanded && 'Log out'}
          </button>
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
