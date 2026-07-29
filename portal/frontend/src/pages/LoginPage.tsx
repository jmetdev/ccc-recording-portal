import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useSearchParams } from 'react-router-dom';
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
  const [searchParams] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const suite = isSuiteHost();
  const autoSsoStarted = useRef(false);

  const { data: sso } = useQuery({ queryKey: ['sso-config'], queryFn: api.ssoConfig, staleTime: Infinity });

  // Resume Keycloak SSO when arriving from the suite product picker (?sso=1)
  // or when RequireAuth bounced an unauthenticated product deep-link here.
  // No idp hint: reuse the existing Keycloak browser session instead of
  // forcing Webex again.
  useEffect(() => {
    if (user || autoSsoStarted.current || !sso?.enabled || !sso.issuer || !sso.client_id) return;
    if (searchParams.get('sso') !== '1') return;
    autoSsoStarted.current = true;
    const next = searchParams.get('next');
    if (next && next.startsWith('/') && !next.startsWith('//')) {
      sessionStorage.setItem('sso_next', next);
    }
    setSsoLoading(true);
    beginSsoLogin(sso.issuer, sso.client_id).catch((err) => {
      setError(err instanceof Error ? err.message : 'Could not reach the identity provider');
      setSsoLoading(false);
    });
  }, [user, sso, searchParams]);

  if (user) return <Navigate to="/" replace />;

  // While auto-resuming SSO from suite / RequireAuth, don't flash the chooser.
  if (searchParams.get('sso') === '1' && sso?.enabled && !error) {
    return (
      <Center mih="100vh" bg={suite ? undefined : '#f7f8fa'} className={suite ? suiteLoginClasses.page : undefined}>
        <Stack align="center" gap="md">
          {suite ? <CloudCoreLogo height={40} /> : <BrandMark size={28} textSize={22} />}
          <Text size="sm" c="dimmed">
            Continuing your sign-in…
          </Text>
        </Stack>
      </Center>
    );
  }

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

  // Break-glass path for the suite host: Keycloak's own hosted login form
  // (no idp hint), so a local Keycloak account works even if Webex is
  // unreachable. Unlike the recording host's local form below, this can't
  // go through the recording backend's local JWT — the suite backend only
  // trusts Keycloak-issued tokens, whichever authenticator produced them.
  const localKeycloakSignIn = async () => {
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
                <Stack>
                  <Text size="sm" c="dimmed">
                    Local accounts (break-glass, not tied to Webex) sign in on the identity
                    provider&apos;s own page.
                  </Text>
                  <Button
                    fullWidth
                    radius="xl"
                    loading={ssoLoading}
                    onClick={localKeycloakSignIn}
                    className={suiteLoginClasses.primaryBtn}
                  >
                    Sign in with a local account
                  </Button>
                  {sso?.enabled && (
                    <Button variant="subtle" fullWidth radius="xl" onClick={() => setShowPasswordForm(false)}>
                      Back to Webex sign-in
                    </Button>
                  )}
                </Stack>
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
              <Stack>
                {sso?.enabled ? (
                  <>
                    <Text size="sm" c="dimmed">
                      Local accounts sign in with username and password through the identity
                      provider. Webex SSO users should use Continue with Webex.
                    </Text>
                    <Button fullWidth loading={ssoLoading} onClick={localKeycloakSignIn}>
                      Sign in with a local account
                    </Button>
                    <Button variant="subtle" fullWidth onClick={() => setShowPasswordForm(false)}>
                      Back to Webex sign-in
                    </Button>
                  </>
                ) : (
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
                    </Stack>
                  </form>
                )}
              </Stack>
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
