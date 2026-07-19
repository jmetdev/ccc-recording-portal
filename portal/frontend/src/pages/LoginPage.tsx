import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { Alert, Button, Card, Center, Divider, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { beginSsoLogin } from '../auth/oidc';
import { BrandMark } from '../components/BrandMark';
import { CloudCoreLogo } from '../components/CloudCoreLogo';
import { isSuiteHost } from '../suite/hosts';
import suiteLoginClasses from './SuiteLogin.module.css';

const PROVIDER_LABELS: Record<string, string> = { webex: 'Webex', zoom: 'Zoom' };

export function LoginPage() {
  const { user, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
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

  if (suite) {
    const webexPrimary = !!sso?.enabled && !showPasswordForm;
    return (
      <Center mih="100vh" className={suiteLoginClasses.page}>
        <Stack align="center" gap={32} w="100%" maw={420} px="md">
          <CloudCoreLogo height={40} />
          <Stack gap={6} align="center">
            <Text className={suiteLoginClasses.eyebrow}>Cloud communications, made practical.</Text>
            <Text className={suiteLoginClasses.headline} component="h1" ta="center">
              Sign in to your <span className={suiteLoginClasses.gradientWord}>workspace</span>
            </Text>
          </Stack>
          <Card padding="xl" radius={14} w="100%" className={suiteLoginClasses.card}>
            <Stack>
              {error && <Alert color="red">{error}</Alert>}

              {webexPrimary && (
                <>
                  <Button
                    fullWidth
                    radius="xl"
                    loading={ssoLoading}
                    onClick={ssoSignIn}
                    className={suiteLoginClasses.primaryBtn}
                  >
                    Continue with Webex
                  </Button>
                  {(sso?.oauth_providers ?? []).map((p) => (
                    <Button
                      key={p}
                      variant="default"
                      fullWidth
                      radius="xl"
                      className={suiteLoginClasses.secondaryBtn}
                      onClick={() => {
                        window.location.href = `/api/auth/oauth/${p}/login`;
                      }}
                    >
                      {`Sign in with ${PROVIDER_LABELS[p] ?? p}`}
                    </Button>
                  ))}
                  <Divider label="or" labelPosition="center" />
                  <Button variant="subtle" fullWidth radius="xl" onClick={() => setShowPasswordForm(true)}>
                    Sign in with username and password
                  </Button>
                </>
              )}

              {!webexPrimary && (
                <form onSubmit={submit}>
                  <Stack>
                    <TextInput
                      label="Username or email"
                      value={username}
                      onChange={(e) => setUsername(e.currentTarget.value)}
                      required
                    />
                    <PasswordInput
                      label="Password"
                      value={password}
                      onChange={(e) => setPassword(e.currentTarget.value)}
                      required
                    />
                    <Button type="submit" loading={loading} fullWidth radius="xl" className={suiteLoginClasses.primaryBtn}>
                      Sign in
                    </Button>
                    {sso?.enabled && (
                      <Button
                        variant="subtle"
                        fullWidth
                        radius="xl"
                        onClick={() => setShowPasswordForm(false)}
                      >
                        Back to Webex sign-in
                      </Button>
                    )}
                  </Stack>
                </form>
              )}
            </Stack>
          </Card>
        </Stack>
      </Center>
    );
  }

  const webexPrimary = !!sso?.enabled && !showPasswordForm;

  return (
    <Center mih="100vh" bg="#f7f8fa">
      <Stack align="center" gap="xl">
        <BrandMark size={28} textSize={22} />
        <Card padding="xl" radius="lg" w={400}>
          <Text size="sm" c="dimmed" mb="lg">
            Sign in to your recording portal
          </Text>
          <Stack>
            {error && <Alert color="red">{error}</Alert>}

            {webexPrimary && (
              <>
                <Button fullWidth loading={ssoLoading} onClick={ssoSignIn}>
                  Continue with Webex
                </Button>
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
                <Divider label="or" labelPosition="center" />
                <Button variant="subtle" fullWidth onClick={() => setShowPasswordForm(true)}>
                  Sign in with username and password
                </Button>
              </>
            )}

            {!webexPrimary && (
              <form onSubmit={submit}>
                <Stack>
                  <TextInput
                    label="Username or email"
                    value={username}
                    onChange={(e) => setUsername(e.currentTarget.value)}
                    required
                  />
                  <PasswordInput
                    label="Password"
                    value={password}
                    onChange={(e) => setPassword(e.currentTarget.value)}
                    required
                  />
                  <Button type="submit" loading={loading} fullWidth>
                    Sign in
                  </Button>
                  {sso?.enabled && (
                    <Button variant="subtle" fullWidth onClick={() => setShowPasswordForm(false)}>
                      Back to Webex sign-in
                    </Button>
                  )}
                  <Text size="xs" c="dimmed">
                    Use your organization account if SSO is enabled.
                  </Text>
                </Stack>
              </form>
            )}
          </Stack>
        </Card>
        <Text size="xs" c="dimmed">
          Part of the CloudCoreCollab suite
        </Text>
      </Stack>
    </Center>
  );
}
