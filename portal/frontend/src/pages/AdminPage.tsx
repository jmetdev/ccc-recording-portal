import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Tabs,
  TextInput,
  Title,
} from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { api } from '../api/client';

export function AdminPage() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['admin-users'], queryFn: api.admin.users });
  const groups = useQuery({ queryKey: ['admin-groups'], queryFn: api.admin.groups });
  const roles = useQuery({ queryKey: ['admin-roles'], queryFn: api.admin.roles });
  const extensions = useQuery({ queryKey: ['admin-extensions'], queryFn: api.admin.extensions });

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
    },
  });

  const deleteUser = useMutation({
    mutationFn: (id: number) => api.admin.deleteUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const [groupName, setGroupName] = useState('');
  const createGroup = useMutation({
    mutationFn: () => api.admin.createGroup(groupName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-groups'] });
      setGroupName('');
    },
  });

  const [extForm, setExtForm] = useState({ extension: '', label: '', enabled: true, group_id: null as number | null });
  const createExt = useMutation({
    mutationFn: () => api.admin.createExtension(extForm),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-extensions'] }),
  });

  const deleteExt = useMutation({
    mutationFn: (id: number) => api.admin.deleteExtension(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-extensions'] }),
  });

  return (
    <Stack gap="lg">
      <Title order={2}>Administration</Title>
      <Tabs defaultValue="users">
        <Tabs.List>
          <Tabs.Tab value="users">Users</Tabs.Tab>
          <Tabs.Tab value="groups">Groups</Tabs.Tab>
          <Tabs.Tab value="roles">Roles</Tabs.Tab>
          <Tabs.Tab value="extensions">Recorded Extensions</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="users" pt="md">
          <Group mb="md">
            <Button leftSection={<IconPlus size={16} />} onClick={() => setUserModal(true)}>
              Add user
            </Button>
          </Group>
          <Table striped>
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
                  <Table.Td>
                    <ActionIcon color="red" variant="subtle" onClick={() => deleteUser.mutate(u.id)}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Tabs.Panel>

        <Tabs.Panel value="groups" pt="md">
          <Group mb="md">
            <TextInput placeholder="Group name" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
            <Button onClick={() => createGroup.mutate()} disabled={!groupName}>
              Add group
            </Button>
          </Group>
          <Table striped>
            <Table.Tbody>
              {groups.data?.map((g) => (
                <Table.Tr key={g.id}>
                  <Table.Td>{g.name}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Tabs.Panel>

        <Tabs.Panel value="roles" pt="md">
          <Table striped>
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
        </Tabs.Panel>

        <Tabs.Panel value="extensions" pt="md">
          <Group mb="md" align="flex-end">
            <TextInput label="Extension" value={extForm.extension} onChange={(e) => setExtForm({ ...extForm, extension: e.target.value })} />
            <TextInput label="Label" value={extForm.label} onChange={(e) => setExtForm({ ...extForm, label: e.target.value })} />
            <Select
              label="Group"
              clearable
              data={groups.data?.map((g) => ({ value: String(g.id), label: g.name })) ?? []}
              value={extForm.group_id ? String(extForm.group_id) : null}
              onChange={(v) => setExtForm({ ...extForm, group_id: v ? Number(v) : null })}
            />
            <Checkbox label="Enabled" checked={extForm.enabled} onChange={(e) => setExtForm({ ...extForm, enabled: e.currentTarget.checked })} />
            <Button onClick={() => createExt.mutate()}>Add</Button>
          </Group>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Extension</Table.Th>
                <Table.Th>Label</Table.Th>
                <Table.Th>Enabled</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {extensions.data?.map((e) => (
                <Table.Tr key={e.id}>
                  <Table.Td>{e.extension}</Table.Td>
                  <Table.Td>{e.label}</Table.Td>
                  <Table.Td>{e.enabled ? 'Yes' : 'No'}</Table.Td>
                  <Table.Td>
                    <ActionIcon color="red" variant="subtle" onClick={() => deleteExt.mutate(e.id)}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Tabs.Panel>
      </Tabs>

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
          <Button onClick={() => createUser.mutate()}>Create</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
