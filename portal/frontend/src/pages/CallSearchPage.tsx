import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Group, Select, Stack, Table, TextInput, Title } from '@mantine/core';
import { api } from '../api/client';
import { CallStatusBadge } from '../components/CallStatusBadge';
import { useCallPlayer } from '../components/CallPlayerContext';

export function CallSearchPage() {
  const { openCall } = useCallPlayer();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [near, setNear] = useState('');
  const [direction, setDirection] = useState<string | null>(null);
  const [sentiment, setSentiment] = useState<string | null>(null);

  const params: Record<string, string> = { page: String(page), page_size: '25' };
  if (q) params.q = q;
  if (near) params.near_addr = near;
  if (direction) params.direction = direction;
  if (sentiment) params.sentiment = sentiment;

  const { data, isLoading } = useQuery({
    queryKey: ['calls', params],
    queryFn: () => api.listCalls(params),
  });

  return (
    <Stack gap="md">
      <Title order={2}>Call Search</Title>
      <Group grow align="flex-end">
        <TextInput label="Search" placeholder="Ref CI, name, extension..." value={q} onChange={(e) => setQ(e.target.value)} />
        <TextInput label="Near extension" value={near} onChange={(e) => setNear(e.target.value)} />
        <Select
          label="Direction"
          clearable
          data={['inbound', 'outbound', 'internal']}
          value={direction}
          onChange={setDirection}
        />
        <Select
          label="Sentiment"
          clearable
          data={['positive', 'neutral', 'negative']}
          value={sentiment}
          onChange={setSentiment}
        />
        <Button onClick={() => setPage(1)}>Apply</Button>
      </Group>

      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Started</Table.Th>
            <Table.Th>Near</Table.Th>
            <Table.Th>Far</Table.Th>
            <Table.Th>Duration</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Sentiment</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && (
            <Table.Tr>
              <Table.Td colSpan={6}>Loading...</Table.Td>
            </Table.Tr>
          )}
          {data?.items.map((c) => (
            <Table.Tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => openCall(c.id)}>
              <Table.Td>{new Date(c.started_at).toLocaleString()}</Table.Td>
              <Table.Td>{c.near_name || c.near_addr}</Table.Td>
              <Table.Td>{c.far_name || c.far_addr}</Table.Td>
              <Table.Td>{c.duration_s ? `${Math.round(c.duration_s)}s` : '—'}</Table.Td>
              <Table.Td>
                <CallStatusBadge status={c.status} />
              </Table.Td>
              <Table.Td>{c.sentiment || '—'}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Group justify="space-between">
        <Button variant="default" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <span>
          Page {page} · {data?.total ?? 0} total
        </span>
        <Button variant="default" disabled={(data?.items.length ?? 0) < 25} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </Group>
    </Stack>
  );
}
