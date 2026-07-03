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
  IconRefresh,
  IconServer,
  IconX,
} from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { api, SystemStatus } from '../api/client';
import { containerStateColor, LogViewer, overallColor, StageBadge } from '../components/health/LogViewer';
import classes from '../components/health/LogViewer.module.css';

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
  const color = overallColor(status.overall);
  const title =
    status.overall === 'healthy'
      ? 'All systems operational'
      : status.overall === 'degraded'
        ? 'Some services need attention'
        : 'Critical issues detected';

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
              ok={tx.enabled ? tx.whisper_running : true}
              label="Transcription"
              detail={
                tx.enabled
                  ? tx.whisper_running
                    ? 'Whisper running'
                    : 'Whisper not running'
                  : tx.reason || 'disabled'
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
                      <Text component={Link} to={`/calls/${row.call_id}`} size="sm" fw={500}>
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
    </Stack>
  );
}
