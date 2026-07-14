import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Loader, Stack, Text, Title } from '@mantine/core';
import { useAuth } from '../auth/AuthContext';

// Landing page for the server-side Webex/Zoom OAuth flow: the backend redirects
// here with the portal tokens in the URL fragment (never sent to the server).
export function OAuthCallbackPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const access = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (!access || !refreshToken) {
        setError('Sign-in did not return a session. Please try again.');
        return;
      }
      localStorage.setItem('access_token', access);
      localStorage.setItem('refresh_token', refreshToken);
      // Strip the tokens out of the address bar.
      window.history.replaceState(null, '', window.location.pathname);
      await refresh();
      navigate('/', { replace: true });
    })();
  }, [navigate, refresh]);

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
              Completing sign-in
            </Text>
          </Stack>
        )}
      </Card>
    </Stack>
  );
}
