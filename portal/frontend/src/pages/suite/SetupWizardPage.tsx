import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Anchor, Button, Card, Center, Loader, Stack, Text, Title } from '@mantine/core';
import { useAuth } from '../../auth/AuthContext';
import { suiteApi } from '../../suite/api';
import { suiteApps } from '../../suite/hosts';
import suiteLoginClasses from '../SuiteLogin.module.css';

export function SetupWizardPage() {
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const [linkError, setLinkError] = useState('');
  const [linking, setLinking] = useState(false);

  const {
    data: me,
    isLoading,
    error: meError,
  } = useQuery({ queryKey: ['suite-me'], queryFn: suiteApi.me, retry: false });

  const confirmLink = async () => {
    setLinkError('');
    setLinking(true);
    try {
      await suiteApi.link();
      await queryClient.invalidateQueries({ queryKey: ['suite-me'] });
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Could not link this organization');
    } finally {
      setLinking(false);
    }
  };

  const apps = suiteApps();
  const licensedApps = (me?.tenant?.entitlements ?? []).filter((e) => e.licensed);
  const licensedByApp = new Map((me?.tenant?.entitlements ?? []).map((e) => [e.app, e]));
  const recordingApp = (() => {
    const app = apps.find((a) => a.id === 'recording');
    if (!app) return null;
    const entitlement = licensedByApp.get('recording');
    return entitlement ? { ...app, licensed: entitlement.licensed } : app;
  })();

  return (
    <Center mih="100vh" className={suiteLoginClasses.page}>
      <Stack align="center" gap={24} w="100%" maw={480} px="md" py="xl">
        <Stack gap={6} align="center">
          <Text className={suiteLoginClasses.eyebrow}>CloudCoreCollab setup</Text>
          <Title order={1} ta="center" className={suiteLoginClasses.headline}>
            Setting up your <span className={suiteLoginClasses.gradientWord}>workspace</span>
          </Title>
        </Stack>

        <Card padding="xl" radius={14} w="100%" className={suiteLoginClasses.card}>
          {isLoading && (
            <Center py="xl">
              <Loader />
            </Center>
          )}

          {!isLoading && meError && (
            <Stack>
              <Alert color="red" title="Couldn't load your workspace">
                {meError instanceof Error ? meError.message : 'Something went wrong talking to the suite service.'}
              </Alert>
              <Button variant="default" fullWidth radius="xl" onClick={() => window.location.reload()}>
                Try again
              </Button>
              <Button variant="subtle" fullWidth radius="xl" onClick={logout}>
                Sign out
              </Button>
            </Stack>
          )}

          {!isLoading && !meError && me?.status === 'active' && me.tenant && (
            <Stack>
              <Title order={3}>You're all set</Title>
              <Text c="dimmed">
                <strong>{me.tenant.name}</strong> is linked and active.
              </Text>
              {licensedApps.length > 0 && (
                <Stack gap={4}>
                  <Text size="sm" fw={600}>
                    Licensed products
                  </Text>
                  {licensedApps.map((e) => {
                    const app = apps.find((a) => a.id === e.app);
                    return (
                      <Text key={e.app} size="sm" c="dimmed">
                        {app?.name ?? e.app}
                        {e.plan_name ? ` — ${e.plan_name}` : ''}
                      </Text>
                    );
                  })}
                </Stack>
              )}
              {recordingApp?.licensed && recordingApp.href && (
                <Alert color="blue" title="Next: provision your recording connector">
                  Open Cloud Core Record, then go to{' '}
                  <Text span fw={600}>
                    Settings → Connectors
                  </Text>{' '}
                  to create an on-prem CUCM credential (or finish Webex setup). Live recordings and
                  connector status appear there once the edge stack is installed.
                  <Button
                    component="a"
                    href={`${recordingApp.href}/settings?tab=connectors`}
                    fullWidth
                    radius="xl"
                    mt="md"
                    className={suiteLoginClasses.primaryBtn}
                  >
                    Open connector setup
                  </Button>
                </Alert>
              )}
              {!recordingApp?.licensed && (
                <Text size="sm" c="dimmed">
                  Each product also manages its own connectors and org authorization once you open
                  it — visit that product's Settings to finish connecting your calling platform.
                </Text>
              )}
              <Button component={Link} to="/" fullWidth radius="xl" variant="default">
                Go to your workspace
              </Button>
            </Stack>
          )}

          {!isLoading && me?.status === 'pending_match' && me.tenant && (
            <Stack>
              <Title order={3}>Confirm your organization</Title>
              <Text c="dimmed">
                We found a pending workspace for <strong>{me.tenant.admin_email}</strong>:{' '}
                <strong>{me.tenant.name}</strong>. Confirm to link it to this Webex organization.
              </Text>
              {linkError && <Alert color="red">{linkError}</Alert>}
              <Button
                fullWidth
                radius="xl"
                loading={linking}
                onClick={confirmLink}
                className={suiteLoginClasses.primaryBtn}
              >
                Confirm and continue
              </Button>
            </Stack>
          )}

          {!isLoading && me?.status === 'unlinked' && (
            <Stack>
              <Title order={3}>No workspace found</Title>
              <Text c="dimmed">
                {user?.email
                  ? `We couldn't find a pending CloudCoreCollab workspace for ${user.email}.`
                  : "We couldn't find a pending CloudCoreCollab workspace for your account."}{' '}
                Contact CloudCoreCollab to get set up.
              </Text>
              {me.is_superadmin && (
                <Anchor component={Link} to="/admin" size="sm">
                  Go to the admin console
                </Anchor>
              )}
              <Button variant="default" fullWidth radius="xl" onClick={logout}>
                Sign out
              </Button>
            </Stack>
          )}
        </Card>
      </Stack>
    </Center>
  );
}
