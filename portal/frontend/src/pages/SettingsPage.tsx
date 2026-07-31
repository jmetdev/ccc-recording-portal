import { useEffect, useState } from 'react';
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
  NumberInput,
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
  IconMail,
  IconMicrophone,
  IconPhone,
  IconPlugConnected,
  IconPlus,
  IconTrash,
  IconUsers,
} from '@tabler/icons-react';
import { api, hasPermission, type User } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ConnectorsTab } from './settings/ConnectorsTab';
import { TranscriptionTab } from './settings/TranscriptionTab';
import { WebexSetupTab } from './settings/WebexSetupTab';
import { GroupSyncTab } from './settings/GroupSyncTab';
import { HealthStatusPage } from './HealthStatusPage';

type UserForm = {
  email: string;
  username: string;
  password: string;
  extension: string;
  group_ids: number[];
  role_ids: number[];
  enable_webex_sso: boolean;
  is_active: boolean;
};

const emptyForm = (): UserForm => ({
  email: '',
  username: '',
  password: '',
  extension: '',
  group_ids: [],
  role_ids: [],
  enable_webex_sso: false,
  is_active: true,
});

function formFromUser(u: User): UserForm {
  return {
    email: u.email,
    username: u.username,
    password: '',
    extension: u.extension ?? '',
    group_ids: u.group_ids?.length ? u.group_ids : u.group_id != null ? [u.group_id] : [],
    role_ids: [],
    enable_webex_sso: false,
    is_active: u.is_active,
  };
}

function UsersTab() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['admin-users'], queryFn: api.admin.users });
  const groups = useQuery({ queryKey: ['admin-groups'], queryFn: api.admin.groups });
  const roles = useQuery({ queryKey: ['admin-roles'], queryFn: api.admin.roles });

  const [userModal, setUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm);

  const openCreate = () => {
    setEditingUser(null);
    setForm(emptyForm());
    setUserModal(true);
  };

  const openEdit = (u: User) => {
    const matchedRoleIds =
      roles.data?.filter((r) => u.roles.includes(r.name)).map((r) => r.id) ?? [];
    setEditingUser(u);
    setForm({ ...formFromUser(u), role_ids: matchedRoleIds });
    setUserModal(true);
  };

  const closeModal = () => {
    setUserModal(false);
    setEditingUser(null);
    setForm(emptyForm());
  };

  const createUser = useMutation({
    mutationFn: () =>
      api.admin.createUser({
        email: form.email,
        username: form.username,
        password: form.password || undefined,
        extension: form.extension || undefined,
        group_ids: form.group_ids,
        role_ids: form.role_ids,
        enable_webex_sso: form.enable_webex_sso,
        is_active: form.is_active,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      closeModal();
    },
  });

  const updateUser = useMutation({
    mutationFn: () => {
      if (!editingUser) throw new Error('No user selected');
      return api.admin.updateUser(editingUser.id, {
        email: form.email,
        username: form.username,
        password: form.password || undefined,
        extension: form.extension || null,
        group_ids: form.group_ids,
        role_ids: form.role_ids,
        is_active: form.is_active,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      closeModal();
    },
  });

  const deleteUser = useMutation({
    mutationFn: (id: number) => api.admin.deleteUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const passwordRequired = !editingUser && !form.enable_webex_sso;
  const saving = createUser.isPending || updateUser.isPending;
  const saveError = createUser.error || updateUser.error;
  const groupOptions = groups.data?.map((g) => ({ value: String(g.id), label: g.name })) ?? [];
  const roleOptions = roles.data?.map((r) => ({ value: String(r.id), label: r.name })) ?? [];

  return (
    <Stack gap="md">
      <Group>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
          Add user
        </Button>
      </Group>
      {roles.isError && (
        <Alert color="red" title="Could not load roles">
          {roles.error instanceof Error ? roles.error.message : 'Unknown error'}
        </Alert>
      )}
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Username</Table.Th>
            <Table.Th>Email</Table.Th>
            <Table.Th>Roles</Table.Th>
            <Table.Th>Extension</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {users.data?.map((u) => (
            <Table.Tr key={u.id}>
              <Table.Td>{u.username}</Table.Td>
              <Table.Td>{u.email}</Table.Td>
              <Table.Td>{u.roles.join(', ')}</Table.Td>
              <Table.Td>{u.extension || '—'}</Table.Td>
              <Table.Td ta="right">
                <Group gap={4} justify="flex-end">
                  <ActionIcon variant="subtle" onClick={() => openEdit(u)} aria-label="Edit user">
                    <IconEdit size={16} />
                  </ActionIcon>
                  <ActionIcon color="red" variant="subtle" onClick={() => deleteUser.mutate(u.id)}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Modal opened={userModal} onClose={closeModal} title={editingUser ? 'Edit user' : 'New user'}>
        <Stack gap="sm">
          {saveError && (
            <Alert color="red" title={editingUser ? 'Could not update user' : 'Could not create user'}>
              {saveError instanceof Error ? saveError.message : 'Unknown error'}
            </Alert>
          )}
          <TextInput
            label="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <TextInput
            label="Username"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
          {!editingUser && (
            <Checkbox
              label="Enable Webex single sign-on"
              description="Creates the portal user only. Their sign-in account is created on first Continue with Webex (pre-creating it blocks Webex login)."
              checked={form.enable_webex_sso}
              onChange={(e) => setForm({ ...form, enable_webex_sso: e.currentTarget.checked })}
            />
          )}
          <TextInput
            label={
              editingUser
                ? 'New password (optional)'
                : passwordRequired
                  ? 'Password'
                  : 'Password (optional portal fallback)'
            }
            type="password"
            required={passwordRequired}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            description={
              editingUser
                ? 'Leave blank to keep the current password.'
                : passwordRequired
                  ? 'Used for username/password sign-in.'
                  : 'Leave blank for Webex-only. If set, used for portal username/password login.'
            }
          />
          <MultiSelect
            label="Groups"
            description="Required for team viewers; optional for managers and self viewers."
            clearable
            data={groupOptions}
            value={form.group_ids.map(String)}
            onChange={(v) => setForm({ ...form, group_ids: v.map(Number) })}
          />
          <TextInput
            label="Extension"
            placeholder="1034"
            description="Required for self viewers — bare DN matched against call near-end."
            value={form.extension}
            onChange={(e) => setForm({ ...form, extension: e.target.value })}
          />
          <Select
            label="Role"
            data={roleOptions}
            value={form.role_ids[0] ? String(form.role_ids[0]) : null}
            onChange={(v) => setForm({ ...form, role_ids: v ? [Number(v)] : [] })}
          />
          {editingUser && (
            <Checkbox
              label="Active"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.currentTarget.checked })}
            />
          )}
          <Button
            onClick={() => (editingUser ? updateUser.mutate() : createUser.mutate())}
            loading={saving}
            disabled={
              !form.email ||
              !form.username ||
              (passwordRequired && form.password.length < 6)
            }
          >
            {editingUser ? 'Save' : 'Create'}
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
  const [editGroup, setEditGroup] = useState<{ id: number; name: string } | null>(null);

  const createGroup = useMutation({
    mutationFn: () => api.admin.createGroup(groupName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-groups'] });
      setGroupName('');
    },
  });

  const updateGroup = useMutation({
    mutationFn: () => {
      if (!editGroup) throw new Error('No group selected');
      return api.admin.updateGroup(editGroup.id, editGroup.name);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-groups'] });
      qc.invalidateQueries({ queryKey: ['groups-mine'] });
      setEditGroup(null);
    },
  });

  const deleteGroup = useMutation({
    mutationFn: (id: number) => api.admin.deleteGroup(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-groups'] });
      qc.invalidateQueries({ queryKey: ['groups-mine'] });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-extensions'] });
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
          <Button onClick={() => createGroup.mutate()} disabled={!groupName.trim()} loading={createGroup.isPending}>
            Add group
          </Button>
        </Group>
        {createGroup.isError && (
          <Alert color="red" mb="sm">
            {createGroup.error instanceof Error ? createGroup.error.message : 'Could not create group'}
          </Alert>
        )}
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {groups.data?.map((g) => (
              <Table.Tr key={g.id}>
                <Table.Td>{g.name}</Table.Td>
                <Table.Td>
                  <Group gap={4} justify="flex-end">
                    <ActionIcon
                      variant="subtle"
                      aria-label="Edit group"
                      onClick={() => setEditGroup({ id: g.id, name: g.name })}
                    >
                      <IconEdit size={16} />
                    </ActionIcon>
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      aria-label="Delete group"
                      loading={deleteGroup.isPending}
                      onClick={() => {
                        if (window.confirm(`Delete group “${g.name}”? Users and extensions keep their other memberships.`)) {
                          deleteGroup.mutate(g.id);
                        }
                      }}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Modal opened={!!editGroup} onClose={() => setEditGroup(null)} title="Edit group">
          {editGroup && (
            <Stack gap="sm">
              {updateGroup.isError && (
                <Alert color="red">
                  {updateGroup.error instanceof Error ? updateGroup.error.message : 'Could not update group'}
                </Alert>
              )}
              <TextInput
                label="Name"
                value={editGroup.name}
                onChange={(e) => setEditGroup({ ...editGroup, name: e.target.value })}
                autoFocus
              />
              <Button
                onClick={() => updateGroup.mutate()}
                loading={updateGroup.isPending}
                disabled={!editGroup.name.trim()}
              >
                Save
              </Button>
            </Stack>
          )}
        </Modal>
      </div>
      <div>
        <Title order={3} mb="sm">
          Roles
        </Title>
        {roles.isError && (
          <Alert color="red" mb="sm">
            {roles.error instanceof Error ? roles.error.message : 'Could not load roles'}
          </Alert>
        )}
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
  const licenseUsage = useQuery({ queryKey: ['license-usage'], queryFn: api.tenant.licenseUsage });

  const [extForm, setExtForm] = useState({ extension: '', label: '', enabled: true, group_ids: [] as number[] });
  const createExt = useMutation({
    mutationFn: () => api.admin.createExtension(extForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-extensions'] });
      qc.invalidateQueries({ queryKey: ['license-usage'] });
      qc.invalidateQueries({ queryKey: ['calls'] });
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
      qc.invalidateQueries({ queryKey: ['license-usage'] });
      qc.invalidateQueries({ queryKey: ['calls'] });
      setEditExt(null);
    },
  });

  const deleteExt = useMutation({
    mutationFn: (id: number) => api.admin.deleteExtension(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-extensions'] }),
  });

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        UCM mode: licensed DNs that may be recorded via on-prem BIB. WXC tenants use Recorded users
        instead.
      </Text>
      {licenseUsage.data && (
        <Card padding="md" radius="md" withBorder>
          <Title order={4} mb="xs">
            Licenses
          </Title>
          <Text size="sm">
            Recording seats:{' '}
            <strong>
              {licenseUsage.data.used} used
              {licenseUsage.data.allotted != null ? ` of ${licenseUsage.data.allotted} allotted` : ''}
            </strong>
            {licenseUsage.data.holding_calls > 0
              ? ` · ${licenseUsage.data.holding_calls} call${licenseUsage.data.holding_calls === 1 ? '' : 's'} from unlicensed owners`
              : ''}
          </Text>
        </Card>
      )}
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

function RecordedUsersTab() {
  const qc = useQueryClient();
  const groups = useQuery({ queryKey: ['admin-groups'], queryFn: api.admin.groups });
  const users = useQuery({ queryKey: ['admin-recorded-users'], queryFn: api.admin.recordedUsers });
  const licenseUsage = useQuery({ queryKey: ['license-usage'], queryFn: api.tenant.licenseUsage });

  const [form, setForm] = useState({ email: '', label: '', enabled: true, group_ids: [] as number[] });
  const createUser = useMutation({
    mutationFn: () => api.admin.createRecordedUser(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-recorded-users'] });
      qc.invalidateQueries({ queryKey: ['license-usage'] });
      qc.invalidateQueries({ queryKey: ['calls'] });
      setForm({ email: '', label: '', enabled: true, group_ids: [] });
    },
  });

  const [editUser, setEditUser] = useState<{
    id: number;
    email: string;
    label: string;
    enabled: boolean;
    group_ids: number[];
  } | null>(null);
  const updateUser = useMutation({
    mutationFn: () => {
      if (!editUser) throw new Error('No user selected');
      return api.admin.updateRecordedUser(editUser.id, {
        email: editUser.email,
        label: editUser.label || null,
        enabled: editUser.enabled,
        group_ids: editUser.group_ids,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-recorded-users'] });
      qc.invalidateQueries({ queryKey: ['license-usage'] });
      qc.invalidateQueries({ queryKey: ['calls'] });
      setEditUser(null);
    },
  });

  const deleteUser = useMutation({
    mutationFn: (id: number) => api.admin.deleteRecordedUser(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-recorded-users'] });
      qc.invalidateQueries({ queryKey: ['license-usage'] });
    },
  });

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        WXC mode: Webex recording owner emails licensed for ingest. Calls from unlisted owners stay in
        the holding pool for seven days.
      </Text>
      {licenseUsage.data && (
        <Card padding="md" radius="md" withBorder>
          <Title order={4} mb="xs">
            Licenses
          </Title>
          <Text size="sm">
            Recording seats:{' '}
            <strong>
              {licenseUsage.data.used} used
              {licenseUsage.data.allotted != null ? ` of ${licenseUsage.data.allotted} allotted` : ''}
            </strong>
          </Text>
        </Card>
      )}
      <Group align="flex-end">
        <TextInput
          label="Email"
          placeholder="agent@customer.com"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.currentTarget.value })}
        />
        <TextInput label="Label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        <MultiSelect
          label="Groups"
          clearable
          data={groups.data?.map((g) => ({ value: String(g.id), label: g.name })) ?? []}
          value={form.group_ids.map(String)}
          onChange={(v) => setForm({ ...form, group_ids: v.map(Number) })}
        />
        <Checkbox label="Enabled" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.currentTarget.checked })} />
        <Button onClick={() => createUser.mutate()} disabled={!form.email.includes('@')}>
          Add
        </Button>
      </Group>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Email</Table.Th>
            <Table.Th>Label</Table.Th>
            <Table.Th>Groups</Table.Th>
            <Table.Th>Enabled</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {users.data?.map((u) => (
            <Table.Tr key={u.id}>
              <Table.Td>{u.email}</Table.Td>
              <Table.Td>{u.label}</Table.Td>
              <Table.Td>
                {u.group_ids.map((gid) => groups.data?.find((g) => g.id === gid)?.name ?? String(gid)).join(', ') || '—'}
              </Table.Td>
              <Table.Td>{u.enabled ? 'Yes' : 'No'}</Table.Td>
              <Table.Td>
                <Group gap={4} justify="flex-end">
                  <ActionIcon
                    variant="subtle"
                    onClick={() =>
                      setEditUser({
                        id: u.id,
                        email: u.email,
                        label: u.label ?? '',
                        enabled: u.enabled,
                        group_ids: u.group_ids,
                      })
                    }
                  >
                    <IconEdit size={16} />
                  </ActionIcon>
                  <ActionIcon color="red" variant="subtle" onClick={() => deleteUser.mutate(u.id)}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Modal opened={!!editUser} onClose={() => setEditUser(null)} title="Edit recorded user">
        {editUser && (
          <Stack gap="sm">
            <TextInput label="Email" value={editUser.email} onChange={(e) => setEditUser({ ...editUser, email: e.target.value })} />
            <TextInput label="Label" value={editUser.label} onChange={(e) => setEditUser({ ...editUser, label: e.target.value })} />
            <MultiSelect
              label="Groups"
              clearable
              data={groups.data?.map((g) => ({ value: String(g.id), label: g.name })) ?? []}
              value={editUser.group_ids.map(String)}
              onChange={(v) => setEditUser({ ...editUser, group_ids: v.map(Number) })}
            />
            <Checkbox label="Enabled" checked={editUser.enabled} onChange={(e) => setEditUser({ ...editUser, enabled: e.currentTarget.checked })} />
            <Button onClick={() => updateUser.mutate()} loading={updateUser.isPending} disabled={!editUser.email.includes('@')}>
              Save
            </Button>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

const DEFAULT_ACCESS_MINUTES = 60;
const DEFAULT_REFRESH_DAYS = 7;

function SessionSettingsCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['tenant-settings'], queryFn: api.tenant.getSettings });
  const canEdit = hasPermission(user, 'manage_users');
  const [accessMinutes, setAccessMinutes] = useState(DEFAULT_ACCESS_MINUTES);
  const [refreshDays, setRefreshDays] = useState(DEFAULT_REFRESH_DAYS);

  useEffect(() => {
    if (!settings.data) return;
    setAccessMinutes(settings.data.session_access_minutes ?? DEFAULT_ACCESS_MINUTES);
    setRefreshDays(settings.data.session_refresh_days ?? DEFAULT_REFRESH_DAYS);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      api.tenant.updateSettings({
        session_access_minutes: accessMinutes,
        session_refresh_days: refreshDays,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-settings'] }),
  });

  return (
    <Card padding="lg" radius="md">
      <Title order={3} mb="xs">
        Session
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        Controls how long users stay signed in to the recording portal. This applies to portal
        sessions after login (including SSO) and is independent of Keycloak realm settings. When the
        access token expires, the app silently refreshes it until the maximum session length is
        reached.
      </Text>
      <Group align="flex-end" gap="lg" wrap="wrap">
        <NumberInput
          label="Access token lifetime (minutes)"
          description="15–1440"
          min={15}
          max={1440}
          value={accessMinutes}
          onChange={(v) => setAccessMinutes(typeof v === 'number' ? v : DEFAULT_ACCESS_MINUTES)}
          disabled={!canEdit}
          w={220}
        />
        <NumberInput
          label="Stay signed in for (days)"
          description="1–90"
          min={1}
          max={90}
          value={refreshDays}
          onChange={(v) => setRefreshDays(typeof v === 'number' ? v : DEFAULT_REFRESH_DAYS)}
          disabled={!canEdit}
          w={220}
        />
        {canEdit && (
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Save session settings
          </Button>
        )}
      </Group>
      {!canEdit && (
        <Text size="sm" c="dimmed" mt="sm">
          Only users with user-management permission can change session settings.
        </Text>
      )}
      {save.isSuccess && (
        <Text size="sm" c="green" mt="sm">
          Session settings updated. New logins use the updated lifetimes; existing sessions pick
          them up on the next token refresh.
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
            UCM extensions
          </Tabs.Tab>
          <Tabs.Tab value="recorded-users" leftSection={<IconMail size={16} />}>
            Recorded users
          </Tabs.Tab>
          <Tabs.Tab value="connectors" leftSection={<IconPlugConnected size={16} />}>
            Connectors
          </Tabs.Tab>
          <Tabs.Tab value="transcription" leftSection={<IconMicrophone size={16} />}>
            Transcription
          </Tabs.Tab>
          <Tabs.Tab value="webex" leftSection={<IconCloud size={16} />}>
            WXC setup
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
        <Tabs.Panel value="recorded-users" pt="lg">
          <Card padding="lg" radius="md">
            <RecordedUsersTab />
          </Card>
        </Tabs.Panel>
        <Tabs.Panel value="connectors" pt="lg">
          <ConnectorsTab />
        </Tabs.Panel>
        <Tabs.Panel value="transcription" pt="lg">
          <TranscriptionTab />
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
            <SessionSettingsCard />
            <HealthStatusPage />
            <DangerZone />
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
