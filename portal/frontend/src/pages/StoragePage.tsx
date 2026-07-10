import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, Loader, SimpleGrid, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { api } from '../api/client';
import { SourceBadge } from '../components/SourceBadge';
import { StatTile } from '../components/StatTile';
import classes from './StoragePage.module.css';

const SOURCE_COLOR: Record<string, string> = {
  cucm: '#7450d5',
  webex: '#25c7b5',
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function monthLabel(month: string): string {
  // month is YYYY-MM
  const [y, m] = month.split('-');
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleDateString(undefined, { month: 'short' });
}

export function StoragePage() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['storage-stats'], queryFn: api.tenant.storageStats });

  if (isLoading || !data) return <Loader />;

  const sourceMax = Math.max(1, ...data.by_source.map((s) => s.bytes));
  const monthMax = Math.max(1, ...data.by_month.map((m) => m.bytes));

  return (
    <Stack gap="lg">
      <Title order={2}>Storage</Title>

      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
        <StatTile label="Total stored" value={formatBytes(data.total_bytes)} />
        <StatTile label="Recordings" value={data.recording_count.toLocaleString()} />
        <StatTile label="Average size" value={formatBytes(data.avg_bytes)} />
        {data.storage_backend && <StatTile label="Backend" value={data.storage_backend} />}
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Card padding="lg" radius="md">
          <Title order={5} mb="md">
            Storage by source
          </Title>
          {data.by_source.length === 0 ? (
            <Text size="sm" c="dimmed">
              No recordings stored yet.
            </Text>
          ) : (
            data.by_source.map((s) => (
              <div key={s.source} className={classes.sourceRow}>
                <SourceBadge source={s.source} />
                <div className={classes.track}>
                  <div
                    className={classes.fill}
                    style={{
                      width: `${(s.bytes / sourceMax) * 100}%`,
                      backgroundColor: SOURCE_COLOR[s.source] ?? '#74777d',
                    }}
                  />
                </div>
                <Text size="xs" ff="monospace" c="dimmed">
                  {formatBytes(s.bytes)} · {s.count}
                </Text>
              </div>
            ))
          )}
        </Card>

        <Card padding="lg" radius="md">
          <Title order={5} mb="md">
            Growth (last 12 months)
          </Title>
          {data.by_month.length === 0 ? (
            <Text size="sm" c="dimmed">
              No recordings stored yet.
            </Text>
          ) : (
            <div className={classes.growth}>
              {data.by_month.map((m) => (
                <Tooltip key={m.month} label={`${m.month}: ${formatBytes(m.bytes)} · ${m.count} recordings`} withArrow>
                  <div className={classes.growthCol}>
                    <div className={classes.growthBar} style={{ height: `${(m.bytes / monthMax) * 100}%` }} />
                    <span className={classes.growthLabel}>{monthLabel(m.month)}</span>
                  </div>
                </Tooltip>
              ))}
            </div>
          )}
        </Card>
      </SimpleGrid>

      <Card padding="lg" radius="md">
        <Title order={5} mb="md">
          Largest recordings
        </Title>
        {data.largest.length === 0 ? (
          <Text size="sm" c="dimmed">
            No recordings stored yet.
          </Text>
        ) : (
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Call</Table.Th>
                <Table.Th>Source</Table.Th>
                <Table.Th>Leg</Table.Th>
                <Table.Th>Party</Table.Th>
                <Table.Th>Started</Table.Th>
                <Table.Th ta="right">Size</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.largest.map((r) => (
                <Table.Tr
                  key={r.recording_id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/recordings/${r.call_id}`)}
                >
                  <Table.Td ff="monospace" fz="xs">
                    #{r.call_id}
                  </Table.Td>
                  <Table.Td>
                    <SourceBadge source={r.source} />
                  </Table.Td>
                  <Table.Td>{r.leg}</Table.Td>
                  <Table.Td>{r.far_name || r.near_name || '—'}</Table.Td>
                  <Table.Td fz="xs">{r.started_at ? new Date(r.started_at).toLocaleDateString() : '—'}</Table.Td>
                  <Table.Td ta="right" ff="monospace" fz="xs">
                    {formatBytes(r.bytes)}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
