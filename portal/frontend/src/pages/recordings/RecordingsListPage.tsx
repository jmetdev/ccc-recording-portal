import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Group,
  Loader,
  Menu,
  Pagination,
  Stack,
  Switch,
  Text,
  Title,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconDotsVertical,
  IconExternalLink,
  IconInfoCircle,
  IconPhoneIncoming,
  IconPhoneOutgoing,
} from '@tabler/icons-react';
import { api, hasPermission } from '../../api/client';
import { SourceBadge } from '../../components/SourceBadge';
import { useAuth } from '../../auth/AuthContext';
import { formatParty } from '../../utils/partyLabel';
import {
  SENTIMENT_COLORS,
  TRASH_RETENTION_DAYS,
  callTitle,
  daysUntilTrashPurge,
  formatSentimentLabel,
  formatTime,
  shortDate,
} from './recordingsShared';
import { RecordingsSearchBar, type RecordingsFilters } from './RecordingsSearchBar';
import { SelectedCallPlayer } from './SelectedCallPlayer';
import { useCallMedia } from './useCallMedia';
import classes from './Recordings.module.css';

const PAGE_SIZE = 20;

function statusDotClass(status: string): string {
  switch (status) {
    case 'recording':
      return classes.statusDotRecording;
    case 'processing':
      return classes.statusDotProcessing;
    case 'transcribing':
      return classes.statusDotTranscribing;
    case 'completed':
      return classes.statusDotCompleted;
    case 'failed':
      return classes.statusDotFailed;
    default:
      return classes.statusDotDefault;
  }
}

export function RecordingsListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const canFilterByGroup =
    hasPermission(user, 'view_all_calls') || hasPermission(user, 'view_group_calls');

  const holdingOnly = searchParams.get('holding') === 'true';
  const trashOnly = searchParams.get('trashed') === 'true';
  const callParam = searchParams.get('call');

  const [filters, setFilters] = useState<RecordingsFilters>({
    q: '',
    source: null,
    sentiment: null,
    groupId: null,
    status: null,
  });
  const [holding, setHolding] = useState(holdingOnly);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(
    callParam && Number.isFinite(Number(callParam)) ? Number(callParam) : null,
  );
  const markedReadForCall = useRef<number | null>(null);

  useEffect(() => {
    setHolding(holdingOnly);
  }, [holdingOnly]);

  useEffect(() => {
    if (callParam && Number.isFinite(Number(callParam))) {
      setSelectedId(Number(callParam));
    }
  }, [callParam]);

  useEffect(() => {
    setPage(1);
  }, [filters, holding, trashOnly]);

  const { data: myGroups } = useQuery({
    queryKey: ['groups-mine'],
    queryFn: api.groupsMine,
    staleTime: 60_000,
    enabled: canFilterByGroup,
  });

  const params: Record<string, string> = { page: String(page), page_size: String(PAGE_SIZE) };
  if (filters.q) params.q = filters.q;
  if (filters.source) params.source = filters.source;
  if (filters.sentiment) params.sentiment = filters.sentiment;
  if (filters.groupId) params.group_id = filters.groupId;
  if (filters.status) params.status = filters.status;
  if (holding) params.holding = 'true';
  if (trashOnly) params.trashed = 'true';

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

  const selectedMedia = useCallMedia(selectedId);

  const selectCall = useCallback(
    (id: number) => {
      setSelectedId(id);
      markedReadForCall.current = null;
      const next = new URLSearchParams(searchParams);
      next.set('call', String(id));
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    if (!selectedId || !selectedMedia.call.data) return;
    if (!selectedMedia.call.data.is_unread) return;
    if (markedReadForCall.current === selectedId) return;
    markedReadForCall.current = selectedId;
    void (async () => {
      try {
        await api.markCallRead(selectedId);
        await queryClient.invalidateQueries({ queryKey: ['calls'] });
        queryClient.setQueryData(['call', selectedId], (prev: typeof selectedMedia.call.data) =>
          prev ? { ...prev, is_unread: false } : prev,
        );
      } catch {
        markedReadForCall.current = null;
      }
    })();
  }, [selectedId, selectedMedia.call.data, queryClient]);

  const groupSections = useMemo(() => {
    if (!canFilterByGroup || filters.groupId || items.length === 0) return null;
    const byGroup = new Map<string, typeof items>();
    for (const call of items) {
      const key = call.group_name ?? 'Ungrouped';
      const bucket = byGroup.get(key) ?? [];
      bucket.push(call);
      byGroup.set(key, bucket);
    }
    if (byGroup.size <= 1) return null;
    return [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [canFilterByGroup, filters.groupId, items]);

  const renderCallRow = (c: (typeof items)[number]) => {
    const title = callTitle(c);
    const near = formatParty(c.near_name, c.near_addr);
    const far = formatParty(c.far_name, c.far_addr);
    const dateLine = c.started_at
      ? `${shortDate(c.started_at)} · ${new Date(c.started_at).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        })}`
      : '—';
    const durationLine = c.duration_s != null ? formatTime(c.duration_s) : '—';
    const direction = (c.direction || '').toLowerCase();
    const isSelected = selectedId === c.id;
    const detailHref = trashOnly ? `/recordings/${c.id}?trashed=true` : `/recordings/${c.id}`;

    return (
      <li key={c.id}>
        <div
          className={`${classes.listTableRow}${c.is_unread ? ` ${classes.listTableRowUnread}` : ''}${
            isSelected ? ` ${classes.listTableRowSelected}` : ''
          }`}
        >
          <button type="button" className={classes.listCell} onClick={() => selectCall(c.id)}>
            <Group gap={8} wrap="nowrap" align="flex-start">
              {direction === 'inbound' ? (
                <IconPhoneIncoming size={16} color="#1997e4" style={{ flexShrink: 0, marginTop: 2 }} />
              ) : direction === 'outbound' ? (
                <IconPhoneOutgoing size={16} color="#7450d5" style={{ flexShrink: 0, marginTop: 2 }} />
              ) : null}
              <Box style={{ minWidth: 0 }}>
                <Text className={classes.rowTitle} truncate>
                  {title}
                </Text>
                {c.summary && (
                  <Text className={classes.rowSub} lineClamp={1}>
                    {c.summary}
                  </Text>
                )}
              </Box>
            </Group>
          </button>
          <button type="button" className={classes.listCell} onClick={() => selectCall(c.id)}>
            <Text size="sm" truncate>
              {near}
            </Text>
          </button>
          <button type="button" className={classes.listCell} onClick={() => selectCall(c.id)}>
            <Text size="sm" truncate>
              {far}
            </Text>
          </button>
          <button type="button" className={classes.listCell} onClick={() => selectCall(c.id)}>
            <Text size="sm">{dateLine}</Text>
            {c.trashed_at ? (
              <Text className={classes.rowSub} c="orange">
                {daysUntilTrashPurge(c.trashed_at)}d left
              </Text>
            ) : null}
          </button>
          <button type="button" className={classes.listCell} onClick={() => selectCall(c.id)}>
            <Text size="sm">{durationLine}</Text>
          </button>
          <button type="button" className={classes.listCell} onClick={() => selectCall(c.id)}>
            {c.trashed_at ? (
              <span className={`${classes.statusDot} ${classes.statusDotDefault}`} title="Trash" />
            ) : c.holding ? (
              <span className={`${classes.statusDot} ${classes.statusDotDefault}`} title="Unconfigured" />
            ) : (
              <span
                className={`${classes.statusDot} ${statusDotClass(c.status)}`}
                title={c.status}
              />
            )}
          </button>
          <button type="button" className={classes.listCell} onClick={() => selectCall(c.id)}>
            {c.sentiment ? (
              <Text size="sm" fw={500} c={SENTIMENT_COLORS[c.sentiment] ?? 'gray'}>
                {formatSentimentLabel(c.sentiment)}
              </Text>
            ) : (
              <Text size="sm" c="dimmed">
                —
              </Text>
            )}
          </button>
          <button type="button" className={classes.listCell} onClick={() => selectCall(c.id)}>
            <SourceBadge source={c.source} />
          </button>
          <div className={`${classes.listCell} ${classes.listCellActions}`}>
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" aria-label="Actions">
                  <IconDotsVertical size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconExternalLink size={14} />}
                  onClick={() => navigate(detailHref)}
                >
                  Full Details
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </div>
        </div>
      </li>
    );
  };

  const renderTable = (calls: typeof items) => (
    <div className={classes.listTable}>
      <div className={classes.listTableHeader} aria-hidden="true">
        <span>Recording</span>
        <span>Near</span>
        <span>Far</span>
        <span>Date</span>
        <span>Duration</span>
        <span>Status</span>
        <span>Sentiment</span>
        <span>Source</span>
        <span />
      </div>
      <div className={classes.listTableBody}>
        <ul className={classes.list}>{calls.map(renderCallRow)}</ul>
      </div>
    </div>
  );

  return (
    <Stack gap="md" className={classes.listPage}>
      <Group justify="space-between">
        <Title order={2}>{trashOnly ? 'Trash' : 'Recordings'}</Title>
        <Group gap="xs">
          {!trashOnly && (
            <Button variant="subtle" size="xs" onClick={() => navigate('/recordings?trashed=true')}>
              View trash
            </Button>
          )}
          {trashOnly && (
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
        <RecordingsSearchBar
          filters={filters}
          onChange={setFilters}
          groups={myGroups}
          canFilterByGroup={canFilterByGroup}
          facetItems={items}
        />
        <Switch
          size="sm"
          label="Unconfigured"
          checked={holding}
          onChange={(e) => setHolding(e.currentTarget.checked)}
        />
      </div>

      {selectedId != null && (
        <SelectedCallPlayer
          callId={selectedId}
          trashOnly={trashOnly}
          onTrashed={() => {
            setSelectedId(null);
            const next = new URLSearchParams(searchParams);
            next.delete('call');
            setSearchParams(next, { replace: true });
            navigate('/recordings?trashed=true');
          }}
        />
      )}

      {trashOnly && (
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
          {trashOnly ? 'Trash is empty.' : 'No calls match.'}
        </Text>
      ) : groupSections ? (
        <div>
          {groupSections.map(([groupName, calls]) => (
            <section key={groupName} style={{ marginBottom: 20 }}>
              <Text size="xs" fw={600} c="dimmed" py="xs" tt="uppercase">
                {groupName}
              </Text>
              {renderTable(calls)}
            </section>
          ))}
        </div>
      ) : (
        renderTable(items)
      )}

      <div className={classes.listFooter}>
        <Text size="xs" c="dimmed">
          {total === 0
            ? 'No recordings'
            : `${rangeStart}–${rangeEnd} of ${total.toLocaleString()} recording${total === 1 ? '' : 's'}`}
          {trashOnly ? ' in trash' : ''}
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
