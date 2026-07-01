import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Grid, Group, Loader, Stack, Table, Text, Title, Badge } from '@mantine/core';
import { api, Call } from '../api/client';

function useLiveRecording(initial: Call[]) {
  const [live, setLive] = useState<Call[]>(initial);

  useEffect(() => {
    setLive(initial);
  }, [initial]);

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const token = localStorage.getItem('access_token');
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    const ws = new WebSocket(`${proto}://${window.location.host}/api/ws/live${qs}`);
    ws.onmessage = () => {
      api.currentlyRecording().then(setLive).catch(() => undefined);
    };
    return () => ws.close();
  }, []);

  return live;
}

export function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: api.dashboardStats,
    refetchInterval: 30000,
  });

  const { data: recording = [], isLoading: recLoading } = useQuery({
    queryKey: ['currently-recording'],
    queryFn: api.currentlyRecording,
    refetchInterval: 10000,
  });

  const live = useLiveRecording(recording);

  if (statsLoading) return <Loader />;

  return (
    <Stack gap="lg">
      <Title order={2}>Dashboard</Title>
      <Grid>
        {[
          { label: 'Calls today', value: stats?.calls_today },
          { label: 'Total calls', value: stats?.calls_total },
          { label: 'Currently recording', value: stats?.recording_now },
          { label: 'Extensions enabled', value: stats?.extensions_enabled },
        ].map((kpi) => (
          <Grid.Col key={kpi.label} span={{ base: 12, sm: 6, md: 3 }}>
            <Card withBorder padding="lg" radius="md">
              <Text size="sm" c="dimmed">{kpi.label}</Text>
              <Text size="xl" fw={700}>{kpi.value ?? '—'}</Text>
            </Card>
          </Grid.Col>
        ))}
      </Grid>

      <Card withBorder padding="lg" radius="md">
        <Group justify="space-between" mb="md">
          <Title order={4}>Currently Recording</Title>
          <Badge color="red" variant="dot">Live</Badge>
        </Group>
        {recLoading ? (
          <Loader size="sm" />
        ) : live.length === 0 ? (
          <Text c="dimmed">No active recordings</Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Near</Table.Th>
                <Table.Th>Far</Table.Th>
                <Table.Th>Ref CI</Table.Th>
                <Table.Th>Started</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {live.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td>{c.near_name || c.near_addr}</Table.Td>
                  <Table.Td>{c.far_name || c.far_addr}</Table.Td>
                  <Table.Td>{c.refci}</Table.Td>
                  <Table.Td>{new Date(c.started_at).toLocaleString()}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
