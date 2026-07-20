import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Alert,
  Button,
  Card,
  Checkbox,
  Group,
  Modal,
  MultiSelect,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconAdjustmentsHorizontal,
  IconCloud,
  IconEdit,
  IconHeartbeat,
  IconPhone,
  IconPlugConnected,
  IconPlus,
  IconTrash,
  IconUsers,
} from '@tabler/icons-react';
import { api } from '../api/client';
import { ConnectorsTab } from './settings/ConnectorsTab';
import { WebexSetupTab } from './settings/WebexSetupTab';
import { GroupSyncTab } from './settings/GroupSyncTab';
import { HealthStatusPage } from './HealthStatusPage';

function UsersTab() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['admin-users'], queryFn: api.admin.users });
  const groups = useQuery({ queryKey: ['admin-groups'], queryFn: api.admin.groups });
  const roles = useQuery({ queryKey: ['admin-roles'], queryFn: api.admin.roles });

  const [userModal, setUserModal] = useState(false);
  const [form, setForm] = useState({
    email: '',
    username: '',
    password: '',
    group_id: null as number | null,
    role_ids: [] as number[],
  });

  const createUser = useMutation({
    mutationFn: () => api.admin.createUser(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      setUserModal(false);
      setForm({ email: '', username: '', password: '', group_id: null, role_ids: [] });
    },
  });

  const deleteUser = useMutation({
    mutationFn: (id: number) => api.admin.deleteUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  return (
    <Stack gap="md">
      <Group>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setUserModal(true)}>
          Add user
        </Button>
      </Group>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Username</Table.Th>
            <Table.Th>Email</Table.Th>
            <Table.Th>Roles</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {users.data?.map((u) => (
            <Table.Tr key={u.id}>
              <Table.Td>{u.username}</Table.Td>
              <Table.Td>{u.email}</Table.Td>
              <Table.Td>{u.roles.join(', ')}</Table.Td>
              <Table.Td ta="right">
                <ActionIcon color="red" variant="subtle" onClick={() => deleteUser.mutate(u.id)}>
                  <IconTrash size={16} />
                </ActionIcon>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Modal opened={userModal} onClose={() => setUserModal(false)} title="New user">
        <Stack gap="sm">
          <TextInput label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <TextInput label="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <TextInput label="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <Select
            label="Group"
            data={groups.data?.map((g) => ({ value: String(g.id), label: g.name })) ?? []}
            value={form.group_id ? String(form.group_id) : null}
            onChange={(v) => setForm({ ...form, group_id: v ? Number(v) : null })}
          />
          <Select
            label="Role"
            data={roles.data?.map((r) => ({ value: String(r.id), label: r.name })) ?? []}
            value={form.role_ids[0] ? String(form.role_ids[0]) : null}
            onChange={(v) => setForm({ ...form, role_ids: v ? [Number(v)] : [] })}
          />
          <Button onClick={() => createUser.mutate()} loading={createUser.isPending}>
            Create
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

function GroupsRolesTab() {
  const qc = useQueryClient();
  const groups = useQuery({ queryKey: ['admin-groups'], queryFn: api.admin.groups });
  const roles = useQuery({ queryKey: ['admin-roles'], queryFn: api.admin.roles });
  const [groupName, setGroupName] = useState('');
  const createGroup = useMutation({
    mutationFn: () => api.admin.createGroup(groupName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-groups'] });
      setGroupName('');
    },
  });

  return (
    <Stack gap="lg">
      <div>
        <Title order={3} mb="sm">
          Groups
        </Title>
        <Group mb="md">
          <TextInput placeholder="Group name" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
          <Button onClick={() => createGroup.mutate()} disabled={!groupName}>
            Add group
          </Button>
        </Group>
        <Table>
          <Table.Tbody>
            {groups.data?.map((g) => (
              <Table.Tr key={g.id}>
                <Table.Td>{g.name}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>
      <div>
        <Title order={3} mb="sm">
          Roles
        </Title>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Permissions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {roles.data?.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td>{r.name}</Table.Td>
                <Table.Td>{r.permissions.join(', ')}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>
    </Stack>
  );
}

function ExtensionsTab() {
  const qc = useQueryClient();
  const groups = useQuery({ queryKey: ['admin-groups'], queryFn: api.admin.groups });
  const extensions = useQuery({ queryKey: ['admin-extensions'], queryFn: api.admin.extensions });

  const [extForm, setExtForm] = useState({ extension: '', label: '', enabled: true, group_ids: [] as number[] });
  const createExt = useMutation({
    mutationFn: () => api.admin.createExtension(extForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-extensions'] });
      setExtForm({ extension: '', label: '', enabled: true, group_ids: [] });
    },
  });

  const [editExt, setEditExt] = useState<{ id: number; extension: string; label: string; enabled: boolean; group_ids: number[] } | null>(null);
  const updateExt = useMutation({
    mutationFn: () => {
      if (!editExt) throw new Error('No extension selected');
      return api.admin.updateExtension(editExt.id, {
        extension: editExt.extension,
        label: editExt.label || null,
        enabled: editExt.enabled,
        group_ids: editExt.group_ids,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-extensions'] });
      setEditExt(null);
    },
  });

  const deleteExt = useMutation({
    mutationFn: (id: number) => api.admin.deleteExtension(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-extensions'] }),
  });

  return (
    <Stack gap="md">
      <Group align="flex-end">
        <TextInput label="Extension" value={extForm.extension} onChange={(e) => setExtForm({ ...extForm, extension: e.target.value })} />
        <TextInput label="Label" value={extForm.label} onChange={(e) => setExtForm({ ...extForm, label: e.target.value })} />
        <MultiSelect
          label="Groups"
          clearable
          data={groups.data?.map((g) => ({ value: String(g.id), label: g.name })) ?? []}
          value={extForm.group_ids.map(String)}
          onChange={(v) => setExtForm({ ...extForm, group_ids: v.map(Number) })}
        />
        <Checkbox label="Enabled" checked={extForm.enabled} onChange={(e) => setExtForm({ ...extForm, enabled: e.currentTarget.checked })} />
        <Button onClick={() => createExt.mutate()} disabled={!extForm.extension}>
          Add
        </Button>
      </Group>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Extension</Table.Th>
            <Table.Th>Label</Table.Th>
            <Table.Th>Groups</Table.Th>
            <Table.Th>Enabled</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {extensions.data?.map((e) => (
            <Table.Tr key={e.id}>
              <Table.Td>{e.extension}</Table.Td>
              <Table.Td>{e.label}</Table.Td>
              <Table.Td>
                {e.group_ids.map((gid) => groups.data?.find((g) => g.id === gid)?.name ?? String(gid)).join(', ') || '—'}
              </Table.Td>
              <Table.Td>{e.enabled ? 'Yes' : 'No'}</Table.Td>
              <Table.Td>
                <Group gap={4} justify="flex-end">
                  <ActionIcon
                    variant="subtle"
                    onClick={() =>
                      setEditExt({
                        id: e.id,
                        extension: e.extension,
                        label: e.label ?? '',
                        enabled: e.enabled,
                        group_ids: e.group_ids,
                      })
                    }
                  >
                    <IconEdit size={16} />
                  </ActionIcon>
                  <ActionIcon color="red" variant="subtle" onClick={() => deleteExt.mutate(e.id)}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Modal opened={!!editExt} onClose={() => setEditExt(null)} title="Edit extension">
        {editExt && (
          <Stack gap="sm">
            <TextInput label="Extension" value={editExt.extension} onChange={(e) => setEditExt({ ...editExt, extension: e.target.value })} />
            <TextInput label="Label" value={editExt.label} onChange={(e) => setEditExt({ ...editExt, label: e.target.value })} />
            <MultiSelect
              label="Groups"
              clearable
              data={groups.data?.map((g) => ({ value: String(g.id), label: g.name })) ?? []}
              value={editExt.group_ids.map(String)}
              onChange={(v) => setEditExt({ ...editExt, group_ids: v.map(Number) })}
            />
            <Checkbox label="Enabled" checked={editExt.enabled} onChange={(e) => setEditExt({ ...editExt, enabled: e.currentTarget.checked })} />
            <Button onClick={() => updateExt.mutate()} loading={updateExt.isPending} disabled={!editExt.extension}>
              Save
            </Button>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

function DangerZone() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['tenant-settings'], queryFn: api.tenant.getSettings });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [lastResult, setLastResult] = useState<{ calls_deleted: number; files_deleted: number } | null>(null);

  const purgeCallData = useMutation({
    mutationFn: api.admin.purgeCallData,
    onSuccess: (result) => {
      setLastResult(result);
      setConfirmOpen(false);
      setConfirmText('');
      qc.invalidateQueries({ queryKey: ['calls'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      qc.invalidateQueries({ queryKey: ['tenant-storage-stats'] });
      qc.invalidateQueries({ queryKey: ['live-channels'] });
    },
  });

  const slug = settings.data?.slug ?? '';

  return (
    <Alert color="red" title="Danger zone">
      <Group justify="space-between" align="center">
        <Text size="sm">
          Permanently delete every call for this tenant: database records, tags, transcripts, pending
          media jobs, <strong>and the recording audio files on disk</strong>. This cannot be undone and
          is not covered by the retention disposition log.
        </Text>
        <Button color="red" variant="outline" onClick={() => setConfirmOpen(true)}>
          Purge call data
        </Button>
      </Group>
      {lastResult && (
        <Text size="sm" mt="xs" c="green">
          Purged {lastResult.calls_deleted} call{lastResult.calls_deleted === 1 ? '' : 's'} and{' '}
          {lastResult.files_deleted} media file{lastResult.files_deleted === 1 ? '' : 's'}.
        </Text>
      )}
      {purgeCallData.isError && <Text size="sm" mt="xs" c="red">{(purgeCallData.error as Error).message}</Text>}

      <Modal opened={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirm permanent purge">
        <Stack gap="sm">
          <Text size="sm">
            This deletes all call data and audio files for tenant <strong>{slug || '…'}</strong> and cannot be
            undone. Type the tenant slug to confirm.
          </Text>
          <TextInput
            placeholder={slug}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoFocus
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              color="red"
              disabled={!slug || confirmText !== slug}
              loading={purgeCallData.isPending}
              onClick={() => purgeCallData.mutate()}
            >
              Permanently delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Alert>
  );
}

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'users';
  const setTab = (value: string | null) => {
    const next = value && value !== 'users' ? value : null;
    if (next) setSearchParams({ tab: next }, { replace: true });
    else setSearchParams({}, { replace: true });
  };

  return (
    <Stack gap="lg">
      <Title order={2}>Settings</Title>
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="users" leftSection={<IconUsers size={16} />}>
            Users
          </Tabs.Tab>
          <Tabs.Tab value="roles" leftSection={<IconAdjustmentsHorizontal size={16} />}>
            Groups &amp; Roles
          </Tabs.Tab>
          <Tabs.Tab value="extensions" leftSection={<IconPhone size={16} />}>
            Extensions
          </Tabs.Tab>
          <Tabs.Tab value="connectors" leftSection={<IconPlugConnected size={16} />}>
            Connectors
          </Tabs.Tab>
          <Tabs.Tab value="webex" leftSection={<IconCloud size={16} />}>
            Webex setup
          </Tabs.Tab>
          <Tabs.Tab value="group-sync" leftSection={<IconAdjustmentsHorizontal size={16} />}>
            Group sync
          </Tabs.Tab>
          <Tabs.Tab value="system" leftSection={<IconHeartbeat size={16} />}>
            System
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="users" pt="lg">
          <Card padding="lg" radius="md">
            <UsersTab />
          </Card>
        </Tabs.Panel>
        <Tabs.Panel value="roles" pt="lg">
          <Card padding="lg" radius="md">
            <GroupsRolesTab />
          </Card>
        </Tabs.Panel>
        <Tabs.Panel value="extensions" pt="lg">
          <Card padding="lg" radius="md">
            <ExtensionsTab />
          </Card>
        </Tabs.Panel>
        <Tabs.Panel value="connectors" pt="lg">
          <ConnectorsTab />
        </Tabs.Panel>
        <Tabs.Panel value="webex" pt="lg">
          <Card padding="lg" radius="md">
            <WebexSetupTab />
          </Card>
        </Tabs.Panel>
        <Tabs.Panel value="group-sync" pt="lg">
          <Card padding="lg" radius="md">
            <GroupSyncTab />
          </Card>
        </Tabs.Panel>
        <Tabs.Panel value="system" pt="lg">
          <Stack gap="lg">
            <HealthStatusPage />
            <DangerZone />
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
