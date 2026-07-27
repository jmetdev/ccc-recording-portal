import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  CopyButton,
  Group,
  List,
  Modal,
  Select,
  Stack,
  Table,
  TagsInput,
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

function TranscriptionSettingsCard() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ['tenant-transcription'],
    queryFn: api.tenant.getTranscription,
  });
  const [organizationName, setOrganizationName] = useState('');
  const [hotwords, setHotwords] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!settings.data || dirty) return;
    setOrganizationName(settings.data.organization_name || '');
    setHotwords(settings.data.hotwords || []);
  }, [settings.data, dirty]);

  const save = useMutation({
    mutationFn: () =>
      api.tenant.updateTranscription({
        organization_name: organizationName,
        hotwords,
      }),
    onSuccess: (data) => {
      setOrganizationName(data.organization_name || '');
      setHotwords(data.hotwords || []);
      setDirty(false);
      qc.setQueryData(['tenant-transcription'], data);
    },
  });

  return (
    <Card padding="lg" radius="md" withBorder>
      <Title order={4} mb="xs">
        Transcription
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        These hints are pushed to on-prem Whisper over the connector heartbeat (usually within a
        minute) and applied to new transcriptions.
      </Text>
      <Stack gap="sm">
        <TextInput
          label="Organization Name"
          description="Used as Whisper’s initial prompt so names and terms are recognized more reliably"
          placeholder="Kyrene School District"
          value={organizationName}
          onChange={(e) => {
            setOrganizationName(e.currentTarget.value);
            setDirty(true);
          }}
        />
        <TagsInput
          label="Hotwords"
          description="Press Enter to add. Common names, places, and product terms Whisper should prefer."
          placeholder="Add a hotword"
          value={hotwords}
          onChange={(value) => {
            setHotwords(value);
            setDirty(true);
          }}
          clearable
        />
        <Group justify="flex-end">
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!dirty && !save.isPending}
          >
            Save transcription settings
          </Button>
        </Group>
        {save.isSuccess && !dirty && (
          <Text size="xs" c="green">
            Saved — connectors pick this up on the next heartbeat.
          </Text>
        )}
      </Stack>
    </Card>
  );
}

export function ConnectorsTab() {
  const qc = useQueryClient();
  const connectors = useQuery({ queryKey: ['tenant-connectors'], queryFn: api.tenant.connectors });

  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<string | null>('cucm');
  const [cucmNodes, setCucmNodes] = useState('');
  const [udsUrl, setUdsUrl] = useState('');
  const [udsUser, setUdsUser] = useState('');
  const [udsPassword, setUdsPassword] = useState('');
  const [created, setCreated] = useState<ConnectorCredentialCreated | null>(null);

  const installCmd =
    created && created.kind === 'cucm'
      ? [
          `curl -fsSL https://raw.githubusercontent.com/jmetdev/ccc-recording-portal/main/connector/install.sh \\`,
          `  | sudo bash -s -- --token ${created.token} --portal ${window.location.origin} --cucm-nodes ${cucmNodes.replace(/\s+/g, '')}`,
          udsUrl.trim() ? `  --uds-url ${udsUrl.trim()}` : '',
          udsUrl.trim() && udsUser.trim() ? `  --uds-user ${udsUser.trim()}` : '',
          udsUrl.trim() && udsPassword.trim() ? `  --uds-password ${udsPassword.trim()}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : '';

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

  const remove = useMutation({
    mutationFn: (id: number) => api.tenant.deleteConnector(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-connectors'] }),
  });

  const rows = connectors.data ?? [];

  return (
    <Stack gap="md">
      <TranscriptionSettingsCard />

      <Group justify="space-between">
        <Title order={3}>Connector credentials</Title>
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
                  <Group gap="xs" justify="flex-end" wrap="nowrap">
                    {c.enabled && (
                      <Button
                        size="xs"
                        variant="light"
                        color="orange"
                        loading={revoke.isPending && revoke.variables === c.id}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Revoke connector "${c.name}"? It will stop authenticating immediately.`,
                            )
                          ) {
                            revoke.mutate(c.id);
                          }
                        }}
                      >
                        Revoke
                      </Button>
                    )}
                    <Button
                      size="xs"
                      variant="light"
                      color="red"
                      leftSection={<IconTrash size={14} />}
                      loading={remove.isPending && remove.variables === c.id}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Permanently delete connector "${c.name}"? This cannot be undone.`,
                          )
                        ) {
                          remove.mutate(c.id);
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </Group>
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
          {kind === 'cucm' && (
            <>
              <TextInput
                label="CUCM node IPs"
                description="Required — comma-separated cluster node addresses written into the SIP Switch ACL + BIB dialplan"
                placeholder="10.0.0.10, 10.0.0.11"
                value={cucmNodes}
                onChange={(e) => setCucmNodes(e.currentTarget.value)}
                required
              />
              <TextInput
                label="Cisco UDS URL (optional)"
                description="Enriches near-end labels via on-prem UDS as (Description) Extension, e.g. https://172.25.100.11:8443"
                placeholder="https://172.25.100.11:8443"
                value={udsUrl}
                onChange={(e) => setUdsUrl(e.currentTarget.value)}
              />
              {udsUrl.trim() && (
                <>
                  <TextInput
                    label="UDS username (optional)"
                    description="HTTP Basic auth — only needed if UDS rejects unauthenticated requests"
                    value={udsUser}
                    onChange={(e) => setUdsUser(e.currentTarget.value)}
                  />
                  <TextInput
                    label="UDS password (optional)"
                    type="password"
                    value={udsPassword}
                    onChange={(e) => setUdsPassword(e.currentTarget.value)}
                  />
                </>
              )}
            </>
          )}
          <Button
            onClick={() => create.mutate()}
            disabled={!name || (kind === 'cucm' && !cucmNodes.trim())}
            loading={create.isPending}
          >
            Create
          </Button>
          {create.isError && (
            <Text size="sm" c="red">
              {(create.error as Error).message}
            </Text>
          )}
        </Stack>
      </Modal>

      <Modal
        opened={!!created}
        onClose={() => setCreated(null)}
        title={created?.kind === 'cucm' ? 'Deploy the CUCM connector' : 'Connector token'}
        size="xl"
      >
        <Stack gap="sm">
          <Alert color="orange" variant="light">
            The token is shown only once. {created?.kind === 'cucm' ? 'Copy the command below' : 'Copy it'} now.
          </Alert>

          {created?.kind === 'cucm' ? (
            <>
              <Text size="sm">
                On the on-prem host that can reach your CUCM cluster, run as root:
              </Text>
              <Card padding="sm" radius="md" bg="#0b1021">
                <Text ff="monospace" fz="xs" c="#d6e2ff" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {installCmd}
                </Text>
              </Card>
              <Group justify="flex-end">
                <CopyButton value={installCmd}>
                  {({ copied, copy }) => (
                    <Button
                      variant="light"
                      color={copied ? 'teal' : 'blue'}
                      leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                      onClick={copy}
                    >
                      {copied ? 'Copied' : 'Copy command'}
                    </Button>
                  )}
                </CopyButton>
              </Group>
              <Text size="sm" fw={600} mt="xs">
                What it does
              </Text>
              <List size="sm" type="ordered" spacing={4}>
                <List.Item>
                  Installs Docker-CE and creates the mount layout under{' '}
                  <Text span ff="monospace" fz="xs">
                    /opt/ccc-connector
                  </Text>
                  .
                </List.Item>
                <List.Item>
                  Pulls the shared SIP Switch image and builds the connector.
                </List.Item>
                <List.Item>
                  Renders SIP Switch ACL + BIB dialplan from your CUCM node IPs, vendors hook
                  scripts, then starts the SIP Switch, the connector, and the whisper transcription
                  sidecar (ESL healthcheck + SYS_NICE).
                </List.Item>
                {udsUrl.trim() && (
                  <List.Item>
                    Configures Cisco UDS at{' '}
                    <Text span ff="monospace" fz="xs">
                      {udsUrl.trim()}
                    </Text>{' '}
                    to enrich near-end labels as (Description) Extension when BIB does not supply{' '}
                    <Text span ff="monospace" fz="xs">
                      near_name
                    </Text>
                    .
                  </List.Item>
                )}
                <List.Item>
                  Point CUCM Built-In-Bridge recording at this host SIP{' '}
                  <Text span ff="monospace" fz="xs">
                    :5070
                  </Text>
                  , destination{' '}
                  <Text span ff="monospace" fz="xs">
                    1034
                  </Text>
                  .
                </List.Item>
                <List.Item>
                  This connector flips to <Text span c="green">Active</Text> here once it
                  heartbeats.
                </List.Item>
              </List>
            </>
          ) : (
            <>
              <Text size="sm">
                Store this in the connector's{' '}
                <Text span ff="monospace" fz="xs">
                  CONNECTOR_TOKEN
                </Text>
                .
              </Text>
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
              </Group>
            </>
          )}

          <Group justify="flex-end">
            <Button onClick={() => setCreated(null)}>Done</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
