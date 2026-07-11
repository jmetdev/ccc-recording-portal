import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Anchor, Badge, Card, Group, Loader, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { api, ConnectorHealth, LiveChannel } from '../api/client';
import { CallStatusBadge } from '../components/CallStatusBadge';
import { SourceBadge } from '../components/SourceBadge';
import { StatTile } from '../components/StatTile';
import { useCallPlayer } from '../components/CallPlayerContext';
import { useAuth } from '../auth/AuthContext';
import { hasPermission } from '../api/client';

function useLiveChannels(initial: LiveChannel[]) {
  const [live, setLive] = useState<LiveChannel[]>(initial);
  useEffect(() => setLive(initial), [initial]);
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const token = localStorage.getItem('access_token');
    if (!token) return;
    // Token travels as a WebSocket subprotocol, not a query string, so it
    // never lands in access logs or browser history.
    const ws = new WebSocket(`${proto}://${window.location.host}/api/ws/live`, [token]);
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

const CONNECTOR_COLOR: Record<ConnectorHealth['status'], string> = {
  healthy: 'teal',
  stale: 'orange',
  unseen: 'gray',
  disabled: 'gray',
};

function ConnectorStrip() {
  const { data } = useQuery({
    queryKey: ['system-status'],
    queryFn: api.systemStatus,
    refetchInterval: 30000,
  });
  const connectors = data?.connectors ?? [];
  if (connectors.length === 0) return null;
  return (
    <Card padding="lg" radius="md">
      <Group justify="space-between" mb="sm">
        <Title order={3}>Connectors</Title>
        <Anchor component={Link} to="/settings" size="sm">
          Manage →
        </Anchor>
      </Group>
      <Group gap="sm">
        {connectors.map((c) => (
          <Group key={c.id} gap={8} px="sm" py={6} style={{ border: '1px solid #e9eaed', borderRadius: 8 }}>
            <SourceBadge source={c.kind} />
            <Text size="sm" fw={500} td={!c.enabled ? 'line-through' : undefined}>
              {c.name}
            </Text>
            <Badge size="sm" variant="light" color={CONNECTOR_COLOR[c.status]}>
              {c.status}
            </Badge>
          </Group>
        ))}
      </Group>
    </Card>
  );
}

export function OverviewPage() {
  const { openCall } = useCallPlayer();
  const { user } = useAuth();
  const canManage = hasPermission(user, 'manage_users');

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

  const { data: recentCalls, isLoading: recentLoading } = useQuery({
    queryKey: ['recent-calls'],
    queryFn: () => api.listCalls({ page: '1', page_size: '8' }),
    refetchInterval: 30000,
  });

  const live = useLiveChannels(channels);

  if (statsLoading) return <Loader />;

  return (
    <Stack gap="lg">
      <Title order={2}>Overview</Title>

      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
        <StatTile label="Calls today" value={stats?.calls_today ?? '—'} />
        <StatTile label="Total calls" value={stats?.calls_total ?? '—'} />
        <StatTile label="Currently recording" value={stats?.recording_now ?? '—'} accent="#1997e4" />
        <StatTile label="Extensions enabled" value={stats?.extensions_enabled ?? '—'} />
      </SimpleGrid>

      {canManage && <ConnectorStrip />}

      <Card padding="lg" radius="md">
        <Group justify="space-between" mb="md">
          <Title order={3}>Recent calls</Title>
          <Anchor component={Link} to="/recordings" size="sm">
            View all recordings ({stats?.calls_total ?? 0}) →
          </Anchor>
        </Group>
        {recentLoading ? (
          <Loader size="sm" />
        ) : !recentCalls || recentCalls.items.length === 0 ? (
          <Text c="dimmed">
            No calls recorded yet. Once a call completes on a connected extension or Webex line, it
            will appear here.
          </Text>
        ) : (
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Started</Table.Th>
                <Table.Th>Source</Table.Th>
                <Table.Th>Near</Table.Th>
                <Table.Th>Far</Table.Th>
                <Table.Th>Duration</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {recentCalls.items.map((c) => (
                <Table.Tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => openCall(c.id)}>
                  <Table.Td ff="monospace" fz="xs">
                    {new Date(c.started_at).toLocaleString()}
                  </Table.Td>
                  <Table.Td>
                    <SourceBadge source={c.source} />
                  </Table.Td>
                  <Table.Td>{c.near_name || c.near_addr || '—'}</Table.Td>
                  <Table.Td>{c.far_name || c.far_addr || '—'}</Table.Td>
                  <Table.Td>{formatDuration(c.duration_s)}</Table.Td>
                  <Table.Td>
                    <CallStatusBadge status={c.status} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      <Card padding="lg" radius="md">
        <Group justify="space-between" mb="md">
          <Title order={3}>Active recordings</Title>
          <CallStatusBadge status="recording" />
        </Group>
        {recLoading ? (
          <Loader size="sm" />
        ) : live.length === 0 ? (
          <Text c="dimmed">No calls are currently being recorded.</Text>
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
                  <Table.Td ff="monospace" fz="xs">
                    {c.refci || '—'}
                  </Table.Td>
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
