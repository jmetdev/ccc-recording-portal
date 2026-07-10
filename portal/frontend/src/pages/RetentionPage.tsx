import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  NumberInput,
  Stack,
  Switch,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { IconInfoCircle, IconLock } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { SourceBadge } from '../components/SourceBadge';

function formatTime(seconds: number | null): string {
  if (seconds == null) return '—';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

function PolicyCard() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['tenant-settings'], queryFn: api.tenant.getSettings });
  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState<number>(365);

  useEffect(() => {
    if (settings.data) {
      setEnabled(settings.data.retention_days != null);
      if (settings.data.retention_days != null) setDays(settings.data.retention_days);
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => api.tenant.updateSettings({ retention_days: enabled ? days : null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-settings'] }),
  });

  return (
    <Card padding="lg" radius="md">
      <Title order={5} mb="xs">
        Retention policy
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        Calls older than the retention window are automatically purged (media and metadata) by a
        periodic sweep. Calls under legal hold are always skipped. Leave disabled to retain
        indefinitely.
      </Text>
      <Group align="flex-end" gap="lg">
        <Switch
          label="Enforce a retention window"
          checked={enabled}
          onChange={(e) => setEnabled(e.currentTarget.checked)}
        />
        <NumberInput
          label="Retain for (days)"
          disabled={!enabled}
          min={1}
          max={36500}
          value={days}
          onChange={(v) => setDays(typeof v === 'number' ? v : 365)}
          w={160}
        />
        <Button onClick={() => save.mutate()} loading={save.isPending}>
          Save policy
        </Button>
      </Group>
      {save.isSuccess && (
        <Text size="sm" c="green" mt="sm">
          Retention policy updated.
        </Text>
      )}
      {save.isError && (
        <Text size="sm" c="red" mt="sm">
          {(save.error as Error).message}
        </Text>
      )}
    </Card>
  );
}

function LegalHoldsCard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const holds = useQuery({
    queryKey: ['calls', { legal_hold: 'true' }],
    queryFn: () => api.listCalls({ page: '1', page_size: '100', legal_hold: 'true' }),
  });

  const release = useMutation({
    mutationFn: (callId: number) => api.setLegalHold(callId, false),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calls', { legal_hold: 'true' }] }),
  });

  const items = holds.data?.items ?? [];

  return (
    <Card padding="lg" radius="md">
      <Group gap="xs" mb="xs">
        <IconLock size={18} color="#f08c00" />
        <Title order={5}>Legal holds</Title>
      </Group>
      {items.length === 0 ? (
        <Text size="sm" c="dimmed">
          No calls are currently under legal hold. Place a hold from a recording's detail rail.
        </Text>
      ) : (
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Started</Table.Th>
              <Table.Th>Source</Table.Th>
              <Table.Th>Far</Table.Th>
              <Table.Th>Duration</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((c) => (
              <Table.Tr key={c.id}>
                <Table.Td ff="monospace" fz="xs" style={{ cursor: 'pointer' }} onClick={() => navigate(`/recordings/${c.id}`)}>
                  {new Date(c.started_at).toLocaleString()}
                </Table.Td>
                <Table.Td>
                  <SourceBadge source={c.source} />
                </Table.Td>
                <Table.Td>{c.far_name || c.far_addr || '—'}</Table.Td>
                <Table.Td>{formatTime(c.duration_s)}</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  <Button
                    size="xs"
                    variant="light"
                    color="orange"
                    loading={release.isPending && release.variables === c.id}
                    onClick={() => release.mutate(c.id)}
                  >
                    Release
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Card>
  );
}

function DispositionLog() {
  const log = useQuery({ queryKey: ['audit', 'retention.purge'], queryFn: () => api.audit('retention.purge', 100) });
  const rows = log.data ?? [];
  return (
    <Card padding="lg" radius="md">
      <Title order={5} mb="xs">
        Disposition log
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        Every automatic purge is recorded here as evidence the retention schedule was applied.
      </Text>
      {rows.length === 0 ? (
        <Alert variant="light" color="gray" icon={<IconInfoCircle size={16} />}>
          No calls have been purged yet.
        </Alert>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>When</Table.Th>
              <Table.Th>Call</Table.Th>
              <Table.Th>Ref CI</Table.Th>
              <Table.Th>Originally started</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td ff="monospace" fz="xs">
                  {new Date(r.created_at).toLocaleString()}
                </Table.Td>
                <Table.Td>
                  <Badge variant="light" color="gray">
                    #{r.resource_id ?? '—'}
                  </Badge>
                </Table.Td>
                <Table.Td ff="monospace" fz="xs">
                  {(r.detail?.refci as string) ?? '—'}
                </Table.Td>
                <Table.Td fz="xs">{(r.detail?.started_at as string) ?? '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Card>
  );
}

export function RetentionPage() {
  return (
    <Stack gap="lg">
      <Title order={2}>Retention</Title>
      <PolicyCard />
      <LegalHoldsCard />
      <DispositionLog />
    </Stack>
  );
}
