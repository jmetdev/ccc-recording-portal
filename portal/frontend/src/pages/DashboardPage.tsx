import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Grid, Group, Loader, Stack, Table, Text, Title } from '@mantine/core';
import { api, LiveChannel } from '../api/client';
import { CallStatusBadge } from '../components/CallStatusBadge';

function useLiveChannels(initial: LiveChannel[]) {
  const [live, setLive] = useState<LiveChannel[]>(initial);

  useEffect(() => {
    setLive(initial);
  }, [initial]);

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const token = localStorage.getItem('access_token');
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    const ws = new WebSocket(`${proto}://${window.location.host}/api/ws/live${qs}`);
    ws.onmessage = () => {
      api.freeswitchLiveChannels().then(setLive).catch(() => undefined);
    };
    return () => ws.close();
  }, []);

  return live;
}

function formatDuration(seconds: number | null | undefined) {
  if (seconds == null) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: api.dashboardStats,
    refetchInterval: 30000,
  });

  const { data: channels = [], isLoading: recLoading } = useQuery({
    queryKey: ['live-channels'],
    queryFn: api.freeswitchLiveChannels,
    refetchInterval: 5000,
  });

  const live = useLiveChannels(channels);

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
          <Title order={4}>Active Recordings</Title>
          <CallStatusBadge status="recording" />
        </Group>
        {recLoading ? (
          <Loader size="sm" />
        ) : live.length === 0 ? (
          <Text c="dimmed">No calls are currently being recorded</Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Near</Table.Th>
                <Table.Th>Far</Table.Th>
                <Table.Th>Ref CI</Table.Th>
                <Table.Th>Leg</Table.Th>
                <Table.Th>Codec</Table.Th>
                <Table.Th>Duration</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {live.map((c) => (
                <Table.Tr key={c.uuid}>
                  <Table.Td>{c.near_addr || c.cid_num || '—'}</Table.Td>
                  <Table.Td>{c.far_addr || '—'}</Table.Td>
                  <Table.Td>{c.refci || '—'}</Table.Td>
                  <Table.Td>{c.leg || '—'}</Table.Td>
                  <Table.Td>{c.read_codec || '—'}</Table.Td>
                  <Table.Td>{formatDuration(c.duration_s)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
