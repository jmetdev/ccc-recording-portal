import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Alert, Anchor, Badge, Card, Group, Loader, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { api, ConnectorHealth, LiveChannel, hasPermission } from '../api/client';
import { CallStatusBadge } from '../components/CallStatusBadge';
import { SourceBadge } from '../components/SourceBadge';
import { StatTile } from '../components/StatTile';
import { useCallPlayer } from '../components/CallPlayerContext';
import { useAuth } from '../auth/AuthContext';

function isForbiddenError(err: unknown): boolean {
  return err instanceof Error && /\b403\b|Forbidden|No call viewing permission/i.test(err.message);
}

function useLiveChannels(initial: LiveChannel[], enabled: boolean) {
  const [live, setLive] = useState<LiveChannel[]>(initial);
  useEffect(() => setLive(initial), [initial]);
  useEffect(() => {
    if (!enabled) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const token = localStorage.getItem('access_token');
    if (!token) return;
    // Token travels as a WebSocket subprotocol, not a query string, so it
    // never lands in access logs or browser history.
    const ws = new WebSocket(`${proto}://${window.location.host}/api/ws/live`, [token]);
    ws.onmessage = () => {
      api.freeswitchLiveChannels().then(setLive).catch(() => undefined);
    };
    // Keep the socket alive through CloudFront/ALB idle timeouts (the server
    // reads and discards inbound frames).
    const ping = window.setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('ping');
    }, 30000);
    return () => {
      window.clearInterval(ping);
      ws.close();
    };
  }, [enabled]);
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

function ConnectorStrip({ connectors }: { connectors: ConnectorHealth[] }) {
  if (connectors.length === 0) return null;
  return (
    <Card padding="lg" radius="md">
      <Group justify="space-between" mb="sm">
        <Title order={3}>Connectors</Title>
        <Anchor component={Link} to="/settings?tab=connectors" size="sm">
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
  const canViewCalls =
    canManage || hasPermission(user, 'view_all_calls') || hasPermission(user, 'view_group_calls');

  const { data: stats, isLoading: statsLoading, error: statsError } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: api.dashboardStats,
    refetchInterval: canViewCalls ? 30000 : false,
    enabled: canViewCalls,
    retry: (count, err) => !isForbiddenError(err) && count < 2,
  });

  const { data: systemStatus } = useQuery({
    queryKey: ['system-status'],
    queryFn: api.systemStatus,
    refetchInterval: 30000,
    enabled: canManage,
    retry: false,
  });
  const connectors = systemStatus?.connectors ?? [];
  const connectorMissing = canManage && systemStatus != null && connectors.length === 0;

  const {
    data: channels = [],
    isLoading: recLoading,
    error: liveError,
    isError: liveIsError,
  } = useQuery({
    queryKey: ['live-channels'],
    queryFn: api.freeswitchLiveChannels,
    // Don't poll a connector that isn't theirs / doesn't exist yet, and stop
    // entirely once we get a 403 (missing call-view permission).
    enabled: canViewCalls && !connectorMissing,
    retry: false,
    refetchInterval: (query) =>
      query.state.error && isForbiddenError(query.state.error) ? false : 5000,
  });
  const liveForbidden = liveIsError && isForbiddenError(liveError);
  const pollLive = canViewCalls && !connectorMissing && !liveForbidden;

  const { data: recentCalls, isLoading: recentLoading } = useQuery({
    queryKey: ['recent-calls'],
    queryFn: () => api.listCalls({ page: '1', page_size: '8' }),
    refetchInterval: canViewCalls ? 30000 : false,
    enabled: canViewCalls && !liveForbidden,
    retry: (count, err) => !isForbiddenError(err) && count < 2,
  });

  const live = useLiveChannels(channels, pollLive);

  if (statsLoading && canViewCalls) return <Loader />;

  return (
    <Stack gap="lg">
      <Title order={2}>Overview</Title>

      {!canViewCalls && (
        <Alert color="yellow" title="Limited access">
          Your account does not have permission to view call activity yet. Ask your tenant admin to
          assign you a role.
        </Alert>
      )}

      {canViewCalls && isForbiddenError(statsError) && (
        <Alert color="red" title="Could not load dashboard">
          Your account is missing call-viewing permissions for this tenant. Sign out and back in if
          you were just made the tenant admin, or ask a platform operator to assign the admin role.
        </Alert>
      )}

      {canViewCalls && (
        <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
          <StatTile label="Calls today" value={stats?.calls_today ?? '—'} />
          <StatTile label="Total calls" value={stats?.calls_total ?? '—'} />
          <StatTile label="Currently recording" value={stats?.recording_now ?? '—'} accent="#1997e4" />
          <StatTile label="Extensions enabled" value={stats?.extensions_enabled ?? '—'} />
        </SimpleGrid>
      )}

      {canManage && <ConnectorStrip connectors={connectors} />}

      {canViewCalls && (
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
      )}

      {canViewCalls && (
        <Card padding="lg" radius="md">
          <Group justify="space-between" mb="md">
            <Title order={3}>Active recordings</Title>
            {!connectorMissing && !liveForbidden && <CallStatusBadge status="recording" />}
          </Group>
          {connectorMissing ? (
            <Alert color="blue" title="Recording connector not set up yet">
              This tenant does not have an on-prem or Webex recording connector yet, so live call
              status is unavailable.{' '}
              <Anchor component={Link} to="/settings?tab=connectors" fw={600}>
                Click here to start that process
              </Anchor>
              .
            </Alert>
          ) : liveForbidden ? (
            <Alert color="yellow" title="Live recordings unavailable">
              Your account cannot view live recording status for this tenant. If you are the tenant
              admin, sign out and back in so your admin role can be applied.
            </Alert>
          ) : recLoading ? (
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
      )}
    </Stack>
  );
}
