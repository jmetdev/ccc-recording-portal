import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Loader, Stack, Text, Title } from '@mantine/core';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { completeSsoLogin } from '../auth/oidc';
import { isSuiteHost } from '../suite/hosts';
import { setOidcToken } from '../suite/api';

export function SsoCallbackPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [error, setError] = useState('');
  const started = useRef(false);
  const suite = isSuiteHost();

  useEffect(() => {
    // React StrictMode double-invokes effects; the auth code is single-use.
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const idpToken = await completeSsoLogin();
        if (suite) {
          // The suite backend verifies this raw Keycloak token directly (no
          // portal user record needed) — store it before anything else so a
          // brand-new tenant whose admin isn't provisioned in the recording
          // backend yet can still reach the setup wizard.
          setOidcToken(idpToken);
        }
        try {
          const tokens = await api.ssoExchange(idpToken);
          localStorage.setItem('access_token', tokens.access_token);
          localStorage.setItem('refresh_token', tokens.refresh_token);
          await refresh();
        } catch (portalErr) {
          // On the suite host, a pending (not-yet-linked) org is expected to
          // fail the portal exchange (org_not_provisioned) — that's fine,
          // the setup wizard doesn't need a portal session. Any other host,
          // or any other failure, is a real sign-in failure.
          if (!suite) throw portalErr;
        }
        navigate(suite ? '/setup' : '/', { replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'SSO sign-in failed');
      }
    })();
  }, [navigate, refresh, suite]);

  return (
    <Stack align="center" justify="center" mih="100vh" bg="var(--mantine-color-body)">
      <Card withBorder shadow="md" padding="xl" radius="md" w={400}>
        <Title order={3} mb="lg">
          Signing you in…
        </Title>
        {error ? (
          <Stack>
            <Alert color="red">{error}</Alert>
            <Button variant="light" onClick={() => navigate('/login', { replace: true })}>
              Back to sign in
            </Button>
          </Stack>
        ) : (
          <Stack align="center">
            <Loader />
            <Text size="sm" c="dimmed">
              Completing single sign-on
            </Text>
          </Stack>
        )}
      </Card>
    </Stack>
  );
}
