import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { Alert, Button, Card, Center, Divider, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { beginSsoLogin } from '../auth/oidc';
import { BrandMark } from '../components/BrandMark';
import { SuiteBrandMark } from '../components/SuiteBrandMark';
import { isSuiteHost } from '../suite/hosts';

const PROVIDER_LABELS: Record<string, string> = { webex: 'Webex', zoom: 'Zoom' };

export function LoginPage() {
  const { user, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const suite = isSuiteHost();

  const { data: sso } = useQuery({ queryKey: ['sso-config'], queryFn: api.ssoConfig, staleTime: Infinity });

  if (user) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const ssoSignIn = async () => {
    if (!sso?.issuer || !sso.client_id) return;
    setError('');
    setSsoLoading(true);
    try {
      // Skip the Keycloak chooser and go straight to the Webex broker.
      await beginSsoLogin(sso.issuer, sso.client_id, { idpHint: 'webex' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the identity provider');
      setSsoLoading(false);
    }
  };

  return (
    <Center mih="100vh" bg="#f7f8fa">
      <Stack align="center" gap="xl">
        {suite ? <SuiteBrandMark size={28} textSize={22} /> : <BrandMark size={28} textSize={22} />}
        <Card padding="xl" radius="lg" w={400}>
          <Text size="sm" c="dimmed" mb="lg">
            {suite ? 'Sign in to CloudCoreCollab' : 'Sign in to your recording portal'}
          </Text>
          <form onSubmit={submit}>
            <Stack>
              {error && <Alert color="red">{error}</Alert>}
              <TextInput
                label="Username or email"
                value={username}
                onChange={(e) => setUsername(e.currentTarget.value)}
                required
              />
              <PasswordInput label="Password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} required />
              <Button type="submit" loading={loading} fullWidth>
                Sign in
              </Button>
              {(sso?.enabled || (sso?.oauth_providers?.length ?? 0) > 0) && (
                <>
                  <Divider label="or" labelPosition="center" />
                  {sso?.enabled && (
                    <Button variant="light" fullWidth loading={ssoLoading} onClick={ssoSignIn}>
                      Continue with Webex
                    </Button>
                  )}
                  {(sso?.oauth_providers ?? []).map((p) => (
                    <Button
                      key={p}
                      variant="light"
                      fullWidth
                      onClick={() => {
                        window.location.href = `/api/auth/oauth/${p}/login`;
                      }}
                    >
                      {`Sign in with ${PROVIDER_LABELS[p] ?? p}`}
                    </Button>
                  ))}
                </>
              )}
              <Text size="xs" c="dimmed">
                Use your organization account if SSO is enabled.
              </Text>
            </Stack>
          </form>
        </Card>
        {!suite && (
          <Text size="xs" c="dimmed">
            Part of the CloudCoreCollab suite
          </Text>
        )}
      </Stack>
    </Center>
  );
}
