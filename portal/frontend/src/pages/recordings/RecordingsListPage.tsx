import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Pagination,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconArrowLeft, IconInfoCircle, IconSearch } from '@tabler/icons-react';
import { api, hasPermission } from '../../api/client';
import { CallStatusBadge } from '../../components/CallStatusBadge';
import { useAuth } from '../../auth/AuthContext';
import { formatParty } from '../../utils/partyLabel';
import {
  SENTIMENT_COLORS,
  TRASH_RETENTION_DAYS,
  callTitle,
  daysUntilTrashPurge,
  formatTime,
  shortDate,
} from './recordingsShared';
import classes from './Recordings.module.css';

const PAGE_SIZE = 20;

export function RecordingsListPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const canFilterByGroup =
    hasPermission(user, 'view_all_calls') || hasPermission(user, 'view_group_calls');

  const holdingOnly = searchParams.get('holding') === 'true';
  const trashOnly = searchParams.get('trashed') === 'true';

  const [q, setQ] = useState('');
  const [source, setSource] = useState<string | null>(null);
  const [sentiment, setSentiment] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [holding, setHolding] = useState(holdingOnly);
  const [trashed, setTrashed] = useState(trashOnly);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setHolding(holdingOnly);
  }, [holdingOnly]);

  useEffect(() => {
    setTrashed(trashOnly);
  }, [trashOnly]);

  useEffect(() => {
    setPage(1);
  }, [q, source, sentiment, groupFilter, holding, trashed]);

  const { data: myGroups } = useQuery({
    queryKey: ['groups-mine'],
    queryFn: api.groupsMine,
    staleTime: 60_000,
    enabled: canFilterByGroup,
  });

  const params: Record<string, string> = { page: String(page), page_size: String(PAGE_SIZE) };
  if (q) params.q = q;
  if (source) params.source = source;
  if (sentiment) params.sentiment = sentiment;
  if (groupFilter) params.group_id = groupFilter;
  if (holding) params.holding = 'true';
  if (trashed) params.trashed = 'true';

  const { data, isLoading } = useQuery({
    queryKey: ['calls', params],
    queryFn: () => api.listCalls(params),
    refetchInterval: 30000,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  const groupSections = useMemo(() => {
    if (!canFilterByGroup || groupFilter || items.length === 0) return null;
    const byGroup = new Map<string, typeof items>();
    for (const call of items) {
      const key = call.group_name ?? 'Ungrouped';
      const bucket = byGroup.get(key) ?? [];
      bucket.push(call);
      byGroup.set(key, bucket);
    }
    if (byGroup.size <= 1) return null;
    return [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [canFilterByGroup, groupFilter, items]);

  const renderCallRow = (c: (typeof items)[number]) => {
    const title = callTitle(c);
    const near = formatParty(c.near_name, c.near_addr);
    const far = formatParty(c.far_name, c.far_addr);
    return (
      <li key={c.id}>
        <button
          type="button"
          className={`${classes.row}${c.is_unread ? ` ${classes.rowUnread}` : ''}`}
          onClick={() =>
            navigate(trashed ? `/recordings/${c.id}?trashed=true` : `/recordings/${c.id}`)
          }
        >
          <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text className={classes.rowTitle} truncate>
                {title}
              </Text>
              <div className={classes.rowMeta}>
                Near: {near} · Far: {far} · {shortDate(c.started_at)}
                {c.started_at
                  ? ` ${new Date(c.started_at).toLocaleTimeString(undefined, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : ''}{' '}
                · {c.duration_s != null ? formatTime(c.duration_s) : '—'} ·{' '}
                {(c.source || '').toUpperCase() || '—'}
                {c.trashed_at ? ` · ${daysUntilTrashPurge(c.trashed_at)}d left` : ''}
              </div>
              {c.summary && (
                <Text className={classes.rowSummary} lineClamp={2}>
                  {c.summary}
                </Text>
              )}
            </Box>
            <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
              {c.sentiment && (
                <Badge size="sm" variant="light" radius="sm" color={SENTIMENT_COLORS[c.sentiment] ?? 'gray'}>
                  {c.sentiment}
                </Badge>
              )}
              {c.holding && (
                <Badge size="sm" variant="light" radius="sm" color="orange">
                  holding
                </Badge>
              )}
              {c.trashed_at ? (
                <Badge size="sm" variant="light" radius="sm" color="gray">
                  trash
                </Badge>
              ) : (
                <CallStatusBadge status={c.status} size="sm" radius="sm" />
              )}
            </Group>
          </Group>
        </button>
      </li>
    );
  };

  return (
    <Stack gap="md" className={classes.listPage}>
      <Group justify="space-between">
        <Title order={2}>{trashed ? 'Trash' : 'Recordings'}</Title>
        <Group gap="xs">
          {!trashed && (
            <Button variant="subtle" size="xs" onClick={() => navigate('/recordings?trashed=true')}>
              View trash
            </Button>
          )}
          {trashed && (
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconArrowLeft size={14} />}
              onClick={() => navigate('/recordings')}
            >
              Back to recordings
            </Button>
          )}
        </Group>
      </Group>

      <div className={classes.filterBar}>
        <TextInput
          size="sm"
          placeholder="Search recordings…"
          leftSection={<IconSearch size={14} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          style={{ flex: '1 1 240px', minWidth: 200 }}
        />
        <Select
          size="sm"
          placeholder="Source"
          aria-label="Filter by source"
          clearable
          data={[
            { value: 'cucm', label: 'CUCM' },
            { value: 'webex', label: 'Webex' },
          ]}
          value={source}
          onChange={setSource}
          style={{ width: 130 }}
        />
        <Select
          size="sm"
          placeholder="Sentiment"
          aria-label="Filter by sentiment"
          clearable
          data={['positive', 'neutral', 'negative']}
          value={sentiment}
          onChange={setSentiment}
          style={{ width: 130 }}
        />
        {canFilterByGroup && (
          <Select
            size="sm"
            placeholder="Group"
            aria-label="Filter by group"
            clearable
            data={(myGroups ?? []).map((g) => ({ value: String(g.id), label: g.name }))}
            value={groupFilter}
            onChange={setGroupFilter}
            style={{ width: 140 }}
          />
        )}
        <Switch
          size="sm"
          label="Unconfigured"
          checked={holding}
          onChange={(e) => setHolding(e.currentTarget.checked)}
        />
        <Switch
          size="sm"
          label="Trash"
          checked={trashed}
          onChange={(e) => {
            const next = e.currentTarget.checked;
            setTrashed(next);
            navigate(next ? '/recordings?trashed=true' : '/recordings');
          }}
        />
      </div>

      {trashed && (
        <Alert variant="light" color="gray" icon={<IconInfoCircle size={16} />}>
          <Text size="sm">
            Trashed recordings can be recovered for {TRASH_RETENTION_DAYS} days, then are permanently
            deleted.
          </Text>
        </Alert>
      )}

      {isLoading ? (
        <Box py="xl">
          <Loader size="sm" />
        </Box>
      ) : items.length === 0 ? (
        <Text c="dimmed" size="sm">
          {trashed ? 'Trash is empty.' : 'No calls match.'}
        </Text>
      ) : groupSections ? (
        <div>
          {groupSections.map(([groupName, calls]) => (
            <section key={groupName}>
              <Text size="xs" fw={600} c="dimmed" py="xs" tt="uppercase">
                {groupName}
              </Text>
              <ul className={classes.list}>{calls.map(renderCallRow)}</ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className={classes.list}>{items.map(renderCallRow)}</ul>
      )}

      <div className={classes.listFooter}>
        <Text size="xs" c="dimmed">
          {total === 0
            ? 'No recordings'
            : `${rangeStart}–${rangeEnd} of ${total.toLocaleString()} recording${total === 1 ? '' : 's'}`}
          {trashed ? ' in trash' : ''}
        </Text>
        {totalPages > 1 && (
          <Pagination
            size="sm"
            total={totalPages}
            value={page}
            onChange={setPage}
            siblings={1}
            boundaries={1}
          />
        )}
      </div>
    </Stack>
  );
}
