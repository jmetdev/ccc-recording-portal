import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActionIcon, Button, Group, Modal, Select, Stack, Table, Text, Title } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { api } from '../../api/client';

function formatTime(value: string | null): string {
  if (!value) return 'never';
  return new Date(value).toLocaleString();
}

export function GroupSyncTab() {
  const qc = useQueryClient();
  const groups = useQuery({ queryKey: ['webex-groups'], queryFn: api.webex.groups });
  const mappings = useQuery({ queryKey: ['webex-group-mappings'], queryFn: api.webex.groupMappings });
  const roles = useQuery({ queryKey: ['admin-roles'], queryFn: api.admin.roles });
  const adminGroups = useQuery({ queryKey: ['admin-groups'], queryFn: api.admin.groups });
  const syncState = useQuery({ queryKey: ['webex-group-sync-state'], queryFn: api.webex.groupSyncState });

  const [modalOpen, setModalOpen] = useState(false);
  const [webexGroupId, setWebexGroupId] = useState<string | null>(null);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => {
      const wg = groups.data?.find((g) => g.id === webexGroupId);
      return api.webex.createGroupMapping({
        webex_group_id: webexGroupId ?? '',
        webex_group_name: wg?.name ?? null,
        role_id: roleId ? Number(roleId) : null,
        group_id: groupId ? Number(groupId) : null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['webex-group-mappings'] });
      setModalOpen(false);
      setWebexGroupId(null);
      setRoleId(null);
      setGroupId(null);
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.webex.deleteGroupMapping(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webex-group-mappings'] }),
  });

  const syncNow = useMutation({
    mutationFn: api.webex.syncGroupsNow,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webex-group-sync-state'] }),
  });

  const rows = mappings.data ?? [];

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={3}>Control Hub group sync</Title>
        <Group>
          <Button
            variant="light"
            loading={syncNow.isPending}
            onClick={() => syncNow.mutate()}
          >
            Sync now
          </Button>
          <Button leftSection={<IconPlus size={16} />} onClick={() => setModalOpen(true)}>
            Map a group
          </Button>
        </Group>
      </Group>
      <Text size="sm" c="dimmed">
        Map a Webex Control Hub group to a role and/or a call-visibility group. Membership is
        re-checked on login and periodically — removing someone from the Control Hub group revokes
        their access here too. Last sync: {formatTime(syncState.data?.last_synced_at ?? null)}
        {syncState.data?.last_sync_status === 'error' && (
          <Text span c="red">
            {' '}
            (failed: {syncState.data.last_sync_error})
          </Text>
        )}
      </Text>

      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Control Hub group</Table.Th>
            <Table.Th>Role</Table.Th>
            <Table.Th>Call-visibility group</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((m) => (
            <Table.Tr key={m.id}>
              <Table.Td>{m.webex_group_name ?? m.webex_group_id}</Table.Td>
              <Table.Td>{roles.data?.find((r) => r.id === m.role_id)?.name ?? '—'}</Table.Td>
              <Table.Td>{adminGroups.data?.find((g) => g.id === m.group_id)?.name ?? '—'}</Table.Td>
              <Table.Td ta="right">
                <ActionIcon color="red" variant="subtle" onClick={() => remove.mutate(m.id)}>
                  <IconTrash size={16} />
                </ActionIcon>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Modal opened={modalOpen} onClose={() => setModalOpen(false)} title="Map a Control Hub group">
        <Stack gap="sm">
          <Select
            label="Control Hub group"
            data={groups.data?.map((g) => ({ value: g.id, label: g.name })) ?? []}
            value={webexGroupId}
            onChange={setWebexGroupId}
            searchable
          />
          <Select
            label="Role"
            clearable
            data={roles.data?.map((r) => ({ value: String(r.id), label: r.name })) ?? []}
            value={roleId}
            onChange={setRoleId}
          />
          <Select
            label="Call-visibility group"
            clearable
            data={adminGroups.data?.map((g) => ({ value: String(g.id), label: g.name })) ?? []}
            value={groupId}
            onChange={setGroupId}
          />
          <Button onClick={() => create.mutate()} disabled={!webexGroupId} loading={create.isPending}>
            Save
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
