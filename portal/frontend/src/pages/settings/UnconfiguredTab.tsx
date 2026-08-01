import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { api } from '../../api/client';
import { formatParty } from '../../utils/partyLabel';
import { SourceBadge } from '../../components/SourceBadge';

function partyKey(p: { kind: string; near_addr: string }) {
  return `${p.kind}:${p.near_addr}`;
}

export function UnconfiguredTab() {
  const qc = useQueryClient();
  const parties = useQuery({ queryKey: ['holding-parties'], queryFn: api.admin.holdingParties });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const rows = parties.data ?? [];
  const selectable = useMemo(() => rows.filter((p) => !p.already_configured), [rows]);
  const allSelected = selectable.length > 0 && selectable.every((p) => selected.has(partyKey(p)));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectable.map(partyKey)));
    }
  };

  const toggleOne = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const enable = useMutation({
    mutationFn: () => {
      const items = rows
        .filter((p) => selected.has(partyKey(p)) && !p.already_configured)
        .map((p) => ({
          kind: p.kind,
          value: p.kind === 'email' ? p.near_addr : p.near_addr.split('@')[0] || p.near_addr,
          display_name: p.near_name,
        }));
      return api.admin.enableHoldingParties({ items });
    },
    onSuccess: (result) => {
      notifications.show({
        color: 'green',
        title: 'Seats enabled',
        message: `Released ${result.calls_released} holding call${result.calls_released === 1 ? '' : 's'} from ${result.extensions_enabled + result.users_enabled} seat${result.extensions_enabled + result.users_enabled === 1 ? '' : 's'}.`,
      });
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['holding-parties'] });
      void qc.invalidateQueries({ queryKey: ['license-usage'] });
      void qc.invalidateQueries({ queryKey: ['calls'] });
      void qc.invalidateQueries({ queryKey: ['admin-extensions'] });
      void qc.invalidateQueries({ queryKey: ['admin-recorded-users'] });
    },
    onError: (err: Error) => {
      notifications.show({ color: 'red', title: 'Enable failed', message: err.message });
    },
  });

  const selectedCount = rows.filter((p) => selected.has(partyKey(p)) && !p.already_configured).length;

  return (
    <Stack gap="md">
      <div>
        <Title order={3}>Unconfigured recordings</Title>
        <Text size="sm" c="dimmed" mt={4}>
          Calls from near parties that are not licensed for recording sit in the holding pool for 7
          days. Enable seats here to release matching calls into normal retention.
        </Text>
      </div>

      {parties.isLoading ? (
        <Loader size="sm" />
      ) : rows.length === 0 ? (
        <Alert color="green" variant="light" title="No holding backlog">
          There are no unconfigured holding calls right now.
        </Alert>
      ) : (
        <>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              {rows.length} near part{rows.length === 1 ? 'y' : 'ies'} ·{' '}
              {rows.reduce((n, p) => n + p.call_count, 0).toLocaleString()} holding calls
            </Text>
            <Button
              size="sm"
              disabled={selectedCount === 0}
              loading={enable.isPending}
              onClick={() => enable.mutate()}
            >
              Enable selected ({selectedCount})
            </Button>
          </Group>

          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={40}>
                  <Checkbox
                    checked={allSelected}
                    indeterminate={selected.size > 0 && !allSelected}
                    onChange={toggleAll}
                    aria-label="Select all unconfigured parties"
                    disabled={selectable.length === 0}
                  />
                </Table.Th>
                <Table.Th>Near party</Table.Th>
                <Table.Th>Kind</Table.Th>
                <Table.Th>Source</Table.Th>
                <Table.Th>Calls</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((p) => {
                const key = partyKey(p);
                return (
                  <Table.Tr key={key} opacity={p.already_configured ? 0.65 : 1}>
                    <Table.Td>
                      <Checkbox
                        checked={selected.has(key)}
                        onChange={() => toggleOne(key)}
                        disabled={p.already_configured}
                        aria-label={`Select ${p.near_addr}`}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {formatParty(p.near_name, p.near_addr)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="light" color={p.kind === 'email' ? 'teal' : 'violet'}>
                        {p.kind === 'email' ? 'WXC user' : 'UCM extension'}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {p.source_hint === 'mixed' ? (
                        <Text size="xs" c="dimmed">
                          Mixed
                        </Text>
                      ) : (
                        <SourceBadge source={p.source_hint} size="xs" />
                      )}
                    </Table.Td>
                    <Table.Td>{p.call_count.toLocaleString()}</Table.Td>
                    <Table.Td>
                      {p.already_configured ? (
                        <Badge size="sm" variant="light" color="gray">
                          Already enabled
                        </Badge>
                      ) : (
                        <Badge size="sm" variant="light" color="orange">
                          Holding
                        </Badge>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </>
      )}
    </Stack>
  );
}
