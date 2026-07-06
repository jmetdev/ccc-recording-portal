import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { Alert, Button, Card, Divider, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { beginSsoLogin } from '../auth/oidc';

export function LoginPage() {
  const { user, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);

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
      await beginSsoLogin(sso.issuer, sso.client_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the identity provider');
      setSsoLoading(false);
    }
  };

  return (
    <Stack align="center" justify="center" mih="100vh" bg="var(--mantine-color-body)">
      <Card withBorder shadow="md" padding="xl" radius="md" w={400}>
        <Title order={2} mb="lg" c="blue.6">Call Recording Portal</Title>
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
            <Button type="submit" loading={loading} fullWidth>Sign in</Button>
            {sso?.enabled && (
              <>
                <Divider label="or" labelPosition="center" />
                <Button variant="light" fullWidth loading={ssoLoading} onClick={ssoSignIn}>
                  Sign in with SSO
                </Button>
              </>
            )}
            <Text size="xs" c="dimmed">Use your organization account if SSO is enabled.</Text>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
