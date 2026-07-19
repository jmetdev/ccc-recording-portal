import { Box, Button, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { CloudCoreLogo } from '../components/CloudCoreLogo';
import { SuiteAppCard } from '../components/SuiteAppCard';
import { suiteApps } from '../suite/hosts';
import { suiteApi } from '../suite/api';
import classes from './SuiteHomePage.module.css';

export function SuiteHomePage() {
  const { user, logout } = useAuth();
  const { data: entitlements } = useQuery({
    queryKey: ['suite-entitlements'],
    queryFn: suiteApi.entitlements,
    // The raw token backing these calls is short-lived; a stale/expired
    // token here just means the launcher falls back to "not licensed"
    // rather than breaking the page.
    retry: false,
  });
  const licensedByApp = new Map((entitlements ?? []).map((e) => [e.app, e]));
  const apps = suiteApps().map((app) => {
    const entitlement = licensedByApp.get(app.id);
    return entitlement ? { ...app, licensed: entitlement.licensed } : app;
  });
  const licensedCount = apps.filter((a) => a.licensed).length;

  useEffect(() => {
    document.title = 'CloudCoreCollab';
  }, []);

  return (
    <Box className={classes.page}>
      <Box className={classes.shell}>
        <Group justify="space-between" align="center" className={classes.header}>
          <CloudCoreLogo height={34} />
          <Group gap="sm">
            <Text className={classes.userEmail}>{user?.email || user?.username}</Text>
            <Button
              variant="default"
              radius="xl"
              size="compact-md"
              className={classes.signOut}
              onClick={logout}
            >
              Sign out
            </Button>
          </Group>
        </Group>

        <Stack gap={14} className={classes.hero}>
          <Text className={classes.eyebrow}>Cloud communications, made practical.</Text>
          <Text className={classes.headline} component="h1">
            Your <span className={classes.gradientWord}>workspace</span>, simplified.
          </Text>
          <Text className={classes.lead}>
            Open the CloudCoreCollab products your organization is licensed for—or go directly to a
            product URL anytime.
          </Text>
        </Stack>

        <Text className={classes.sectionLabel}>01 / Product suite</Text>
        <Text className={classes.sectionTitle} component="h2">
          Focused products. One simpler workday.
        </Text>

        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md" className={classes.grid}>
          {apps.map((app) => (
            <SuiteAppCard
              key={app.id}
              index={app.index}
              title={app.name}
              description={app.description}
              href={app.href}
              licensed={app.licensed}
              meta={app.meta}
              radius={14}
            />
          ))}
        </SimpleGrid>

        <Box className={classes.license}>
          <Text className={classes.sectionLabel}>02 / License</Text>
          <Text className={classes.licenseTitle}>What you can access</Text>
          <Text className={classes.licenseBody}>
            This organization can open {licensedCount} of {apps.length} suite products in this
            environment. Plan, seats, and usage will land here as entitlements move into the suite
            portal.
          </Text>
          <Group gap={8} mt="md">
            {apps
              .filter((a) => a.licensed)
              .map((a) => (
                <Text key={a.id} className={classes.licensePill}>
                  {a.name}
                </Text>
              ))}
          </Group>
        </Box>
      </Box>
    </Box>
  );
}
