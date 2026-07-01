import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Button, Card, PasswordInput, Stack, Text, TextInput, Title, Alert } from '@mantine/core';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const { user, login } = useAuth();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

  return (
    <Stack align="center" justify="center" mih="100vh" bg="var(--mantine-color-body)">
      <Card withBorder shadow="md" padding="xl" radius="md" w={400}>
        <Title order={2} mb="lg" c="momentum.6">Call Recording Portal</Title>
        <form onSubmit={submit}>
          <Stack>
            {error && <Alert color="red">{error}</Alert>}
            <TextInput label="Username" value={username} onChange={(e) => setUsername(e.currentTarget.value)} required />
            <PasswordInput label="Password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} required />
            <Button type="submit" loading={loading} fullWidth>Sign in</Button>
            <Text size="xs" c="dimmed">Default: admin / admin123</Text>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
