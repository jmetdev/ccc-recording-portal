import {
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  SimpleGrid,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { IconArrowRight, IconMicrophone2, IconPrinter } from '@tabler/icons-react';
import { useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { SuiteBrandMark } from '../components/SuiteBrandMark';
import { suiteApps, type SuiteApp } from '../suite/hosts';
import classes from './SuiteHomePage.module.css';

const ICONS: Record<string, typeof IconMicrophone2> = {
  recording: IconMicrophone2,
  fax: IconPrinter,
};

function AppTile({ app }: { app: SuiteApp }) {
  const Icon = ICONS[app.id] ?? IconArrowRight;
  if (!app.licensed) {
    return (
      <Box className={classes.appTileDisabled}>
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Group gap="md" wrap="nowrap">
            <Box className={classes.appIcon}>
              <Icon size={22} stroke={1.6} />
            </Box>
            <Stack gap={4}>
              <Text fw={600}>{app.name}</Text>
              <Text size="sm" c="dimmed">
                {app.description}
              </Text>
            </Stack>
          </Group>
          <Badge color="gray" variant="light">
            Not licensed
          </Badge>
        </Group>
      </Box>
    );
  }

  return (
    <UnstyledButton
      className={classes.appTile}
      component="a"
      href={app.href}
      aria-label={`Open ${app.name}`}
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Group gap="md" wrap="nowrap">
          <Box className={classes.appIcon}>
            <Icon size={22} stroke={1.6} />
          </Box>
          <Stack gap={4}>
            <Text fw={600}>{app.name}</Text>
            <Text size="sm" c="dimmed">
              {app.description}
            </Text>
          </Stack>
        </Group>
        <IconArrowRight size={18} stroke={1.6} className={classes.chevron} />
      </Group>
    </UnstyledButton>
  );
}

export function SuiteHomePage() {
  const { user, logout } = useAuth();
  const apps = suiteApps();
  const licensed = apps.filter((a) => a.licensed);

  useEffect(() => {
    document.title = 'CloudCoreCollab';
  }, []);

  return (
    <Box className={classes.page}>
      <Box className={classes.shell}>
        <Group justify="space-between" align="center" mb="xl">
          <SuiteBrandMark size={28} textSize={22} />
          <Group gap="md">
            <Text size="sm" c="dimmed">
              {user?.email || user?.username}
            </Text>
            <Button variant="subtle" color="gray" size="compact-sm" onClick={logout}>
              Sign out
            </Button>
          </Group>
        </Group>

        <Stack gap={6} mb={36}>
          <Text className={classes.headline}>Your apps</Text>
          <Text c="dimmed" maw={480}>
            Open a licensed CloudCoreCollab product, or go directly to a product URL anytime.
          </Text>
        </Stack>

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" mb={48}>
          {apps.map((app) => (
            <AppTile key={app.id} app={app} />
          ))}
        </SimpleGrid>

        <Stack gap="sm" className={classes.licenseBlock}>
          <Text fw={600} size="sm">
            License
          </Text>
          <Text size="sm" c="dimmed">
            This organization can access {licensed.length} of {apps.length} suite products in
            this environment. Plan and seat details will appear here as entitlements move into
            the suite portal.
          </Text>
          <Group gap="xs" mt={4}>
            {licensed.map((a) => (
              <Badge key={a.id} variant="light" color="brandBlue">
                {a.name}
              </Badge>
            ))}
          </Group>
          <Text size="xs" c="dimmed" mt="sm">
            Direct links:{' '}
            {apps.map((a, i) => (
              <span key={a.id}>
                {i > 0 ? ' · ' : ''}
                <Anchor href={a.href} size="xs">
                  {a.id === 'recording' ? 'recorddev' : 'faxdev'}
                </Anchor>
              </span>
            ))}
          </Text>
        </Stack>
      </Box>
    </Box>
  );
}
