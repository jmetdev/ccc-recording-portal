import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ActionIcon,
  Alert,
  Badge,
  Card,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconBrandDocker,
  IconCheck,
  IconDatabase,
  IconFolder,
  IconHeartbeat,
  IconMicrophone,
  IconPhone,
  IconPlugConnected,
  IconRefresh,
  IconServer,
  IconX,
} from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { api, ConnectorHealth, SystemStatus } from '../api/client';
import { containerStateColor, LogViewer, overallColor, StageBadge } from '../components/health/LogViewer';
import { SourceBadge } from '../components/SourceBadge';
import classes from '../components/health/LogViewer.module.css';

function connectorStatusColor(status: ConnectorHealth['status']): string {
  switch (status) {
    case 'healthy':
      return 'teal';
    case 'stale':
      return 'orange';
    default:
      return 'gray';
  }
}

function connectorStatusLabel(status: ConnectorHealth['status']): string {
  switch (status) {
    case 'healthy':
      return 'Healthy';
    case 'stale':
      return 'Stale';
    case 'unseen':
      return 'Never connected';
    case 'disabled':
      return 'Disabled';
    default:
      return status;
  }
}

function formatStats(stats: Record<string, unknown> | null): string {
  if (!stats || Object.keys(stats).length === 0) return '—';
  return Object.entries(stats)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
}

function formatTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function ContainerIcon({ name }: { name: string }) {
  if (name.includes('db')) return <IconDatabase size={20} />;
  if (name.includes('whisper')) return <IconMicrophone size={20} />;
  if (name.includes('freeswitch')) return <IconPhone size={20} />;
  if (name.includes('frontend')) return <IconServer size={20} />;
  return <IconBrandDocker size={20} />;
}

function ServiceRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <Group justify="space-between" wrap="nowrap">
      <Group gap="xs">
        <ThemeIcon size="sm" variant="light" color={ok ? 'teal' : 'red'} radius="xl">
          {ok ? <IconCheck size={14} /> : <IconX size={14} />}
        </ThemeIcon>
        <Text size="sm">{label}</Text>
      </Group>
      {detail && (
        <Text size="xs" c="dimmed" ta="right">
          {detail}
        </Text>
      )}
    </Group>
  );
}

function StatusBanner({ status }: { status: SystemStatus }) {
  // Uptime (services reachable) and capability (transcription actually covers
  // calls) are reported separately — a healthy stack with incomplete
  // transcription coverage is not "all systems operational".
  const bothOk = status.overall === 'healthy' && status.capability === 'full';
  const color = bothOk ? overallColor(status.overall) : status.overall === 'healthy' ? 'yellow' : overallColor(status.overall);
  const title = bothOk
    ? 'All systems operational'
    : status.overall === 'degraded'
      ? 'Some services need attention'
      : status.overall === 'critical'
        ? 'Critical issues detected'
        : 'Services healthy — transcription coverage incomplete';

  const tx = status.services.transcription;
  const coveragePct = tx.total_calls > 0 ? Math.round((tx.transcribed_calls / tx.total_calls) * 100) : null;

  return (
    <Alert
      className={classes.overallBanner}
      color={color}
      variant="light"
      icon={<IconHeartbeat size={22} />}
      title={title}
    >
      <Group gap="lg">
        <Text size="sm">
          {status.summary.containers_healthy}/{status.summary.containers_total} containers healthy
        </Text>
        <Text size="sm">{status.summary.recent_failures} recent failed call(s)</Text>
        {coveragePct != null && (
          <Text size="sm">
            Transcription coverage {coveragePct}% ({tx.transcribed_calls}/{tx.total_calls} calls)
          </Text>
        )}
        <Text size="xs" c="dimmed">
          Last checked {formatTime(status.checked_at)}
        </Text>
      </Group>
    </Alert>
  );
}

export function HealthStatusPage() {
  const [logSource, setLogSource] = useState('ingest');

  const statusQuery = useQuery({
    queryKey: ['system-status'],
    queryFn: api.systemStatus,
    refetchInterval: 15000,
  });

  const logsQuery = useQuery({
    queryKey: ['system-logs', logSource],
    queryFn: () => api.systemLogs(logSource),
    refetchInterval: 10000,
    enabled: Boolean(statusQuery.data?.log_sources.includes(logSource)),
  });

  const status = statusQuery.data;

  if (statusQuery.isLoading) return <Loader />;
  if (statusQuery.isError || !status) {
    return (
      <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Unable to load system status">
        {statusQuery.error instanceof Error ? statusQuery.error.message : 'Unknown error'}
      </Alert>
    );
  }

  const db = status.services.database;
  const rec = status.services.recordings;
  const fs = status.services.freeswitch;
  const tx = status.services.transcription;

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={2}>Health / Status</Title>
        <Tooltip label="Refresh now">
          <ActionIcon
            variant="light"
            size="lg"
            aria-label="Refresh"
            onClick={() => {
              statusQuery.refetch();
              logsQuery.refetch();
            }}
          >
            <IconRefresh size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <StatusBanner status={status} />

      <div>
        <Text fw={600} mb="sm">
          Containers
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {status.containers.map((container) => (
            <Card key={container.name} withBorder padding="md" radius="md" className={classes.containerCard}>
              <Group justify="space-between" mb="xs">
                <Group gap="xs">
                  <ThemeIcon variant="light" size="md" color={containerStateColor(container.state)}>
                    <ContainerIcon name={container.name} />
                  </ThemeIcon>
                  <Text fw={600} size="sm">
                    {container.name}
                  </Text>
                </Group>
                <Badge color={containerStateColor(container.state)} variant="filled">
                  {container.state}
                </Badge>
              </Group>
              <Stack gap={4}>
                <Text size="xs" c="dimmed">
                  Status: {container.status}
                  {container.health ? ` · health: ${container.health}` : ''}
                </Text>
                {container.image && (
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {container.image}
                  </Text>
                )}
                {container.started_at && (
                  <Text size="xs" c="dimmed">
                    Started {formatTime(container.started_at)}
                  </Text>
                )}
                {container.detail && (
                  <Text size="xs" c="red">
                    {container.detail}
                  </Text>
                )}
              </Stack>
            </Card>
          ))}
        </SimpleGrid>
      </div>

      <Paper withBorder p="md" radius="md">
        <Group mb="md" gap="xs">
          <ThemeIcon variant="light" color="indigo">
            <IconPlugConnected size={18} />
          </ThemeIcon>
          <Text fw={600}>Connectors</Text>
        </Group>
        {status.connectors.length === 0 ? (
          <Text size="sm" c="dimmed">
            No connectors registered for this tenant yet. On-prem CUCM edge stacks and the Webex
            connector both authenticate with a connector credential issued from the platform admin.
          </Text>
        ) : (
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Kind</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Last seen</Table.Th>
                <Table.Th>Version</Table.Th>
                <Table.Th>Stats</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {status.connectors.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td>
                    <Text size="sm" fw={500} td={!c.enabled ? 'line-through' : undefined}>
                      {c.name}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <SourceBadge source={c.kind} />
                  </Table.Td>
                  <Table.Td>
                    <Badge color={connectorStatusColor(c.status)} variant="light" size="sm">
                      {connectorStatusLabel(c.status)}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{formatTime(c.last_seen_at)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {c.version || '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {formatStats(c.stats)}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Paper>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Paper withBorder p="md" radius="md">
          <Group mb="md" gap="xs">
            <ThemeIcon variant="light" color="blue">
              <IconServer size={18} />
            </ThemeIcon>
            <Text fw={600}>Core services</Text>
          </Group>
          <Stack gap="sm">
            <ServiceRow
              ok={Boolean(db.ok)}
              label="PostgreSQL"
              detail={db.ok ? `${db.latency_ms} ms` : db.error}
            />
            <ServiceRow
              ok={Boolean(rec.ok)}
              label="Recordings mount"
              detail={rec.ok ? `${rec.wav_count} WAV files` : rec.error}
            />
            <ServiceRow
              ok={Boolean(rec.readable)}
              label="Recordings readable"
              detail={rec.path}
            />
            <ServiceRow
              ok={Boolean(rec.writable)}
              label="Recordings writable"
              detail={rec.ingest_log_exists ? '.bib-hook.log present' : 'no ingest log yet'}
            />
            <ServiceRow
              ok={fs.fs_cli_configured}
              label="SIP switch CLI"
              detail={
                fs.fs_cli_configured
                  ? `${fs.active_recording_channels} active recording channel(s)`
                  : 'not configured'
              }
            />
            <ServiceRow
              ok={tx.total_calls === 0 || tx.transcribed_calls >= tx.total_calls}
              label="Transcription"
              detail={
                tx.total_calls === 0
                  ? 'No completed calls yet'
                  : `${tx.transcribed_calls}/${tx.total_calls} calls transcribed`
              }
            />
          </Stack>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Group mb="md" gap="xs">
            <ThemeIcon variant="light" color="orange">
              <IconFolder size={18} />
            </ThemeIcon>
            <Text fw={600}>Recent failed calls</Text>
          </Group>
          {status.recent_failures.length === 0 ? (
            <Text size="sm" c="dimmed">
              No failed calls in recent history.
            </Text>
          ) : (
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Call</Table.Th>
                  <Table.Th>Stage</Table.Th>
                  <Table.Th>Reason</Table.Th>
                  <Table.Th>When</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {status.recent_failures.map((row) => (
                  <Table.Tr key={row.call_id}>
                    <Table.Td>
                      <Text component={Link} to={`/recordings/${row.call_id}`} size="sm" fw={500}>
                        #{row.call_id}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {row.refci}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <StageBadge stage={row.stage} />
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" lineClamp={2}>
                        {row.message}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{formatTime(row.ended_at ?? row.started_at)}</Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Paper>
      </SimpleGrid>

      {status.log_sources.length > 0 && (
        <Paper withBorder p="md" radius="md">
          <Group justify="space-between" mb="md">
            <Group gap="xs">
              <ThemeIcon variant="light" color="gray">
                <IconBrandDocker size={18} />
              </ThemeIcon>
              <Text fw={600}>Live logs</Text>
            </Group>
            <SegmentedControl
              size="xs"
              value={logSource}
              onChange={setLogSource}
              data={status.log_sources.map((source) => ({
                label: source.replace('portal-', '').replace('freeswitch', 'SIP switch'),
                value: source,
              }))}
            />
          </Group>
          {logsQuery.isLoading ? (
            <Loader size="sm" />
          ) : (
            <LogViewer lines={logsQuery.data?.lines ?? ['(no log data)']} />
          )}
        </Paper>
      )}
    </Stack>
  );
}
