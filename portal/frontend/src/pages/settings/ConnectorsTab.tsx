import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  CopyButton,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconCheck, IconCopy, IconPlus, IconTrash } from '@tabler/icons-react';
import { api, ConnectorCredentialCreated } from '../../api/client';
import { SourceBadge } from '../../components/SourceBadge';

function formatTime(value: string | null): string {
  if (!value) return 'never';
  return new Date(value).toLocaleString();
}

export function ConnectorsTab() {
  const qc = useQueryClient();
  const connectors = useQuery({ queryKey: ['tenant-connectors'], queryFn: api.tenant.connectors });

  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<string | null>('cucm');
  const [created, setCreated] = useState<ConnectorCredentialCreated | null>(null);

  const create = useMutation({
    mutationFn: () => api.tenant.createConnector({ name, kind: kind ?? 'cucm' }),
    onSuccess: (data) => {
      setCreated(data);
      setModalOpen(false);
      setName('');
      qc.invalidateQueries({ queryKey: ['tenant-connectors'] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: number) => api.tenant.revokeConnector(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-connectors'] }),
  });

  const rows = connectors.data ?? [];

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={5}>Connector credentials</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setModalOpen(true)}>
          New connector
        </Button>
      </Group>
      <Text size="sm" c="dimmed">
        Each on-prem CUCM edge stack or Webex connector authenticates to the portal with its own
        bearer token. Tokens are shown once at creation — store them in the connector's{' '}
        <Text span ff="monospace" fz="xs">
          .env
        </Text>{' '}
        as CONNECTOR_TOKEN.
      </Text>

      {rows.length === 0 ? (
        <Card padding="lg" radius="md">
          <Text size="sm" c="dimmed">
            No connector credentials yet. Create one to provision a connector for this tenant.
          </Text>
        </Card>
      ) : (
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Kind</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Last seen</Table.Th>
              <Table.Th>Version</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((c) => (
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
                  <Text size="xs" c={c.enabled ? 'green' : 'dimmed'}>
                    {c.enabled ? 'Active' : 'Revoked'}
                  </Text>
                </Table.Td>
                <Table.Td fz="xs">{formatTime(c.last_seen_at)}</Table.Td>
                <Table.Td fz="xs" c="dimmed">
                  {c.version || '—'}
                </Table.Td>
                <Table.Td ta="right">
                  {c.enabled && (
                    <Button
                      size="xs"
                      variant="light"
                      color="red"
                      leftSection={<IconTrash size={14} />}
                      loading={revoke.isPending && revoke.variables === c.id}
                      onClick={() => {
                        if (window.confirm(`Revoke connector "${c.name}"? It will stop authenticating immediately.`)) {
                          revoke.mutate(c.id);
                        }
                      }}
                    >
                      Revoke
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={modalOpen} onClose={() => setModalOpen(false)} title="New connector credential">
        <Stack gap="sm">
          <TextInput label="Name" placeholder="hq-cucm-edge" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <Select label="Kind" data={['cucm', 'webex']} value={kind} onChange={setKind} />
          <Button onClick={() => create.mutate()} disabled={!name} loading={create.isPending}>
            Create
          </Button>
          {create.isError && (
            <Text size="sm" c="red">
              {(create.error as Error).message}
            </Text>
          )}
        </Stack>
      </Modal>

      <Modal opened={!!created} onClose={() => setCreated(null)} title="Connector token" size="lg">
        <Stack gap="sm">
          <Alert color="orange" variant="light">
            This token is shown only once. Copy it now and store it in the connector's{' '}
            <Text span ff="monospace" fz="xs">
              CONNECTOR_TOKEN
            </Text>
            .
          </Alert>
          <Card padding="sm" radius="md" bg="#f7f8fa">
            <Text ff="monospace" fz="xs" style={{ wordBreak: 'break-all' }}>
              {created?.token}
            </Text>
          </Card>
          <Group justify="flex-end">
            <CopyButton value={created?.token ?? ''}>
              {({ copied, copy }) => (
                <Button
                  variant="light"
                  color={copied ? 'teal' : 'blue'}
                  leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  onClick={copy}
                >
                  {copied ? 'Copied' : 'Copy token'}
                </Button>
              )}
            </CopyButton>
            <Button onClick={() => setCreated(null)}>Done</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
