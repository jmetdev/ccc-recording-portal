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

type MonthStat = { month: string; bytes: number; count: number };

/** Zero-fill to a fixed 12-month window ending this month, so a chart with
 * only 1-2 populated months reads as sparse instead of a misleadingly "full"
 * single bar spanning the whole row. */
function last12Months(byMonth: MonthStat[]): MonthStat[] {
  const byKey = new Map(byMonth.map((m) => [m.month, m]));
  const now = new Date();
  const months: MonthStat[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push(byKey.get(key) ?? { month: key, bytes: 0, count: 0 });
  }
  return months;
}

export function StoragePage() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['storage-stats'], queryFn: api.tenant.storageStats });

  if (isLoading || !data) return <Loader />;

  const sourceMax = Math.max(1, ...data.by_source.map((s) => s.bytes));
  const months = last12Months(data.by_month);
  const monthMax = Math.max(1, ...months.map((m) => m.bytes));
  const populatedMonths = months.filter((m) => m.bytes > 0).length;
  const maxMonth = months.reduce((best, m) => (m.bytes > best.bytes ? m : best), months[0]);

  return (
    <Stack gap="lg">
      <Title order={2}>Storage</Title>

      <SimpleGrid cols={{ base: 2, md: 5 }} spacing="md">
        <StatTile label="Total stored" value={formatBytes(data.total_bytes)} />
        <StatTile label="Calls" value={data.call_count.toLocaleString()} />
        <StatTile
          label="Recordings (media files)"
          value={data.recording_count.toLocaleString()}
          hint="A call can have more than one recording leg"
        />
        <StatTile label="Average size" value={formatBytes(data.avg_bytes)} />
        {data.storage_backend && <StatTile label="Backend" value={data.storage_backend} />}
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Card padding="lg" radius="md">
          <Title order={3} mb="md">
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
          <Title order={3} mb={4}>
            Growth (last 12 months)
          </Title>
          {populatedMonths === 0 ? (
            <Text size="sm" c="dimmed">
              No recordings stored yet.
            </Text>
          ) : (
            <>
              {populatedMonths < 3 && (
                <Text size="xs" c="dimmed" mb="sm">
                  Still collecting history — only {populatedMonths} month{populatedMonths === 1 ? '' : 's'} of data so far.
                </Text>
              )}
              <div className={classes.growth}>
                {months.map((m) => (
                  <Tooltip key={m.month} label={`${m.month}: ${formatBytes(m.bytes)} · ${m.count} recording(s)`} withArrow>
                    <div className={classes.growthCol}>
                      {m.month === maxMonth.month && m.bytes > 0 && (
                        <span className={classes.growthValue}>{formatBytes(m.bytes)}</span>
                      )}
                      <div className={classes.growthBar} style={{ height: `${(m.bytes / monthMax) * 100}%` }} />
                      <span className={classes.growthLabel}>{monthLabel(m.month)}</span>
                    </div>
                  </Tooltip>
                ))}
              </div>
            </>
          )}
        </Card>
      </SimpleGrid>

      <Card padding="lg" radius="md">
        <Title order={3} mb="md">
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
